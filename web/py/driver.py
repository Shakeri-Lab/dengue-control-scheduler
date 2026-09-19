# -*- coding: utf-8 -*-
"""Browser driver for the Aedes Control model.

Runs the repository's unmodified `Run_AEDES_AEGYPTI` (in Pyodide, or natively in
the tests) and adds two things the page needs and the model does not provide:

1. `MemoSolve` — memoizes the two `solve_ivp` calls that do not depend on the
   control plan, so editing a plan re-solves only the third. See `cache_key` for
   why that is exact rather than approximate.
2. Daily series for the control forcing the model actually applied, recovered
   from the arguments passed to `solve_ivp` (never re-derived from the inputs).

Nothing here modifies the model. `install` rebinds the module-level name
`solve_ivp` inside `Run_AEDES_AEGYPTI` for the duration of one run, the same
technique the previous worker used for progress reporting, and restores it
afterwards.
"""

import gc
import hashlib
import json
import os
import shutil
import sys
import time

import numpy as np
import pandas as pd

# Treatment-time array -> the level array that multiplies its profile. When
# every level is zero the times and profiles cannot reach the ODE's right-hand
# side at all (see cache_key), which is what makes memoization exact.
LEVEL_OF = {"lstim": "lslev", "istim": "islev", "taucl": "alpha"}

# Treatment-time array -> (profile array, its sample step). The ODE reads
# profile[int((t - time) / step)], so these bound the reachable index.
PROFILE_OF = {
    "lstim": ("sprofil_lr", "del_sprofil"),
    "istim": ("sprofil_ins", "del_sprofil"),
    "taucl": ("deltaprofil", "del_delta"),
}

# Entries left out of the cache key, by position in the solve_ivp args tuple.
# Index 3 is inps1f (float 1-D), index 5 is inps2f (float 2-D). The `dr*`
# derivative profiles are read only by the backward pass, which this driver
# never runs. Everything not listed is hashed, so a key the model gains later
# is covered by default.
ANNIHILATED = {
    3: {
        "sprofil_lr", "drsprofil_lr",
        "sprofil_ins", "drsprofil_ins",
        "deltaprofil", "drdeltaprofil",
    },
    5: set(LEVEL_OF) | set(LEVEL_OF.values()),
}

ALLOWED_KWARGS = {"method", "t_eval", "args", "rtol"}

MODEL_FILES = (
    "Run_AEDES_AEGYPTI.py",
    "Dif_functions.py",
    "MosquitoRates.py",
    "LocationSeriesInput.py",
    "cord_to_CRofland.py",
)


class Bypass(Exception):
    """This call cannot be keyed safely; run the real solver."""


def _feed(digest, tag, value):
    array = np.ascontiguousarray(value)
    if array.dtype.kind not in "fiub":
        raise Bypass(f"unhashable dtype at {tag}")
    digest.update(f"{tag}|{array.dtype.str}|{array.shape}|".encode())
    digest.update(array.tobytes())


def cache_key(fun, expected_fun, positional, keyword):
    """Content key for a `solve_ivp` call, or raise `Bypass`.

    The model reaches the control terms only as `level * profile[index]`
    (Dif_functions.odeforward_AEDES_AEGYPTI). With every level exactly 0.0 the
    products are bit-exactly zero and adding them changes nothing, so the
    treatment times and the profile shapes cannot influence the solution. They
    are therefore excluded from the key — which is what lets a cached warm-up
    and no-control year serve a different plan, and different durations.

    Three conditions have to hold for that argument to be airtight, and each is
    checked below rather than assumed:

    A1  every level is 0.0 (or empty). A NaN level fails `== 0.0`.
    A2  the profiles are finite, so `0.0 * profile` is 0.0 and not NaN.
    A3  the reachable profile index is in range, so the uncached call would not
        have raised IndexError while the cache quietly answered.
    """
    if fun is not expected_fun or len(positional) != 2:
        raise Bypass("unexpected call shape")
    if set(keyword) - ALLOWED_KWARGS or not {"args", "t_eval"} <= set(keyword):
        raise Bypass("unexpected keyword arguments")

    t_span, y0 = positional
    args = keyword["args"]
    if len(args) != 6 or not all(isinstance(entry, dict) for entry in args):
        raise Bypass("unexpected args tuple")

    scalars, profiles, levels = args[1], args[3], args[5]
    t_max = float(np.max(t_span))

    for time_key, level_key in LEVEL_OF.items():
        if time_key not in levels or level_key not in levels:
            raise Bypass(f"missing {time_key}/{level_key}")
        times = np.asarray(levels[time_key], dtype=float)
        level = np.asarray(levels[level_key], dtype=float)
        if times.shape != level.shape:
            raise Bypass(f"{time_key} and {level_key} disagree in shape")
        if level.size and not np.all(level == 0.0):       # A1
            raise Bypass(f"{level_key} is not zero")

        profile_key, step_key = PROFILE_OF[time_key]
        profile = np.asarray(profiles[profile_key])
        step = float(scalars[step_key])
        if not np.all(np.isfinite(profile)):              # A2
            raise Bypass(f"{profile_key} is not finite")
        if times.size:                                    # A3
            if not np.all(np.isfinite(times)):
                raise Bypass(f"{time_key} is not finite")
            reachable = int((t_max - float(times.min())) / step) + 1
            if reachable >= profile.shape[0] - 1:
                raise Bypass(f"{profile_key} index out of range")

    digest = hashlib.sha256()
    digest.update(
        f"{fun.__module__}.{fun.__qualname__}"
        f"|{keyword.get('method')!r}|{keyword.get('rtol')!r}|".encode()
    )
    _feed(digest, "t_span", np.asarray(t_span, dtype=float))
    _feed(digest, "y0", y0)
    _feed(digest, "t_eval", keyword["t_eval"])
    for position, mapping in enumerate(args):
        for key in sorted(mapping):
            if key not in ANNIHILATED.get(position, ()):
                _feed(digest, f"{position}.{key}", mapping[key])
    return digest.hexdigest()


def daily_forcing(keyword):
    """Per-day control forcing, exactly as the ODE applied it.

    Reconstructed from the arrays handed to `solve_ivp`, sampled at the same
    whole days the model writes to its output files: added larval and adult
    mortality (per day) and the fraction of breeding sites removed.
    """
    scalars, profiles, arrays = keyword["args"][1], keyword["args"][3], keyword["args"][5]
    integers = keyword["args"][0]
    day_count = arrays["temps"].shape[1]
    days = np.arange(1, day_count, dtype=float)

    def summed(time_key, level_key, profile_key, step_key, scale):
        times = np.asarray(arrays[time_key], dtype=float)
        levels = np.asarray(arrays[level_key], dtype=float)
        profile = np.asarray(profiles[profile_key], dtype=float)
        step = float(scalars[step_key])
        total = np.zeros(days.shape)
        for row in range(times.shape[0]):
            offset = (days - times[row, 0]) / step
            index = np.maximum(0, np.floor(offset).astype(np.int64))
            index = np.minimum(index, profile.shape[0] - 2)
            frac = np.maximum(0.0, offset - index)
            total += levels[row, 0] * (
                (1 - frac) * profile[index] + frac * profile[index + 1]
            )
        return total * scale

    capacity = float(np.asarray(arrays["Cl0t"])[0, 0])
    return {
        "larvicide": summed("lstim", "lslev", "sprofil_lr", "del_sprofil", 1.0),
        "adulticide": summed("istim", "islev", "sprofil_ins", "del_sprofil", 1.0),
        # alpha is a fraction of Nhr; as a share of the baseline capacity it is
        # the fraction of breeding sites removed.
        "habitat": summed(
            "taucl", "alpha", "deltaprofil", "del_delta",
            float(integers["Nhr"]) / capacity if capacity else 0.0,
        ),
    }


class MemoSolve:
    """A `solve_ivp` stand-in that reuses plan-independent solutions."""

    def __init__(self, original, expected_fun, on_progress=None, enabled=True):
        self.original = original
        self.expected_fun = expected_fun
        self.on_progress = on_progress
        self.enabled = enabled
        self.slots = {}          # "warmup" | "year" -> (key, solution, forcing)
        self.log = []

    def begin_run(self):
        self.log = []

    def forget(self):
        self.slots.clear()
        gc.collect()

    def cached(self):
        """(key, solution, forcing) for each populated slot; used by tests."""
        return list(self.slots.values())

    def __call__(self, fun, *positional, **keyword):
        index = len(self.log) + 1
        # The role picks a storage slot only; correctness rests on the key.
        role = "warmup" if index == 1 else "year"
        started = time.perf_counter()

        reason = None
        try:
            key = cache_key(fun, self.expected_fun, positional, keyword) if self.enabled else None
        except Bypass as bypass:
            key, reason = None, str(bypass)

        stored = self.slots.get(role)
        hit = key is not None and stored is not None and stored[0] == key
        if self.on_progress:
            self.on_progress(index, hit, 1.0 if hit else 0.0)

        if hit:
            solution, forcing = stored[1], stored[2]
        else:
            if key is not None:
                # Release the old result before allocating the new one.
                self.slots.pop(role, None)
                if role == "warmup":
                    self.slots.clear()
                gc.collect()
            solution = self.original(self._reporting(fun, positional, index), *positional, **keyword)
            forcing = (
                daily_forcing(keyword)
                if role == "year" and getattr(solution, "success", False)
                else None
            )
            if key is not None and getattr(solution, "success", False):
                solution.t.setflags(write=False)
                solution.y.setflags(write=False)
                self.slots[role] = (key, solution, forcing)

        self.log.append({
            "solve": index,
            "role": role,
            "cached": hit,
            "bypass": reason,
            "forcing": forcing,
            "seconds": time.perf_counter() - started,
        })
        return solution

    def _reporting(self, fun, positional, index):
        """Wrap the right-hand side to report progress; behaviour unchanged."""
        if not self.on_progress or len(positional) != 2:
            return fun
        low, high = float(positional[0][0]), float(positional[0][-1])
        span = (high - low) or 1.0
        last = [time.perf_counter()]

        def reporting_rhs(t, y, *rest):
            now = time.perf_counter()
            if now - last[0] > 0.25:
                last[0] = now
                self.on_progress(index, False, (t - low) / span)
            return fun(t, y, *rest)

        return reporting_rhs


def _model_dir():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def model_hashes(directory=None):
    directory = directory or _model_dir()
    digests = {}
    for name in MODEL_FILES:
        with open(os.path.join(directory, name), "rb") as handle:
            digests[name] = hashlib.sha256(handle.read()).hexdigest()
    return digests


class Session:
    """One page session: holds the model import and the memo cache."""

    def __init__(self, workdir="/app/run", enabled=True):
        import Run_AEDES_AEGYPTI as model
        from Dif_functions import odeforward_AEDES_AEGYPTI

        self.model = model
        self.workdir = workdir
        self.memo = MemoSolve(model.solve_ivp, odeforward_AEDES_AEGYPTI, enabled=enabled)
        os.makedirs(workdir, exist_ok=True)

    # -- inputs ---------------------------------------------------------

    def _write_inputs(self, temperature_csv, precipitation_csv=None):
        from LocationSeriesInput import load_annual_series_csv

        temperature_path = os.path.join(self.workdir, "temperature.csv")
        precipitation_path = os.path.join(self.workdir, "precipitation.csv")
        with open(temperature_path, "w", encoding="utf-8") as handle:
            handle.write(temperature_csv)
        if precipitation_csv:
            with open(precipitation_path, "w", encoding="utf-8") as handle:
                handle.write(precipitation_csv)
        else:
            # The model requires a precipitation series; it has no effect on the
            # results in this version (Kt is forced to 1), so zeros are exact.
            dates, _ = load_annual_series_csv(temperature_path, return_dates=True)
            pd.DataFrame(
                {"date": dates.strftime("%Y-%m-%d"), "precipitation": 0.0}
            ).to_csv(precipitation_path, index=False)
        return temperature_path, precipitation_path

    def load_climate(self, temperature_csv, precipitation_csv=None):
        """Validate through the model's own loader and return the calendar."""
        from LocationSeriesInput import load_climate_inputs

        temperature_path, precipitation_path = self._write_inputs(
            temperature_csv, precipitation_csv
        )
        dates, temperature, precipitation, source = load_climate_inputs(
            temperature_path, precipitation_path, 0.0, 0.0, target_year=None
        )
        return {
            "ok": True,
            "dates": [stamp.strftime("%Y-%m-%d") for stamp in dates],
            "temperature": [float(value) for value in temperature],
            "precipitation": [float(value) for value in precipitation],
            "source": source,
            "year": int(dates[0].year),
            "climateKey": hashlib.sha256(temperature_csv.encode()).hexdigest()[:16],
        }

    # -- simulation -----------------------------------------------------

    def run(self, temperature_csv, precipitation_csv, settings, plan, on_progress=None):
        temperature_path, precipitation_path = self._write_inputs(
            temperature_csv, precipitation_csv
        )
        output = os.path.join(self.workdir, "results")
        shutil.rmtree(output, ignore_errors=True)

        self.memo.on_progress = on_progress
        self.memo.begin_run()
        original = self.model.solve_ivp
        self.model.solve_ivp = self.memo
        started = time.perf_counter()
        try:
            self.model.Run_AEDES_AEGYPTI(
                len_ins=str(settings["len_ins"]), is_ef=str(settings["is_ef"]),
                len_lr=str(settings["len_lr"]), ls_ef=str(settings["ls_ef"]),
                len_cr=str(settings["len_cr"]), cl_ef=str(settings["cl_ef"]),
                larvicide_dates=",".join(plan.get("larvicide", [])),
                insecticide_dates=",".join(plan.get("adulticide", [])),
                habitat_dates=",".join(plan.get("habitat", [])),
                adtemp=temperature_path, adpre=precipitation_path, adsave=output,
            )
        finally:
            self.model.solve_ivp = original
            self.memo.on_progress = None
        elapsed = time.perf_counter() - started

        files = {}
        for name in sorted(os.listdir(output)):
            with open(os.path.join(output, name), encoding="utf-8") as handle:
                files[name] = handle.read()

        warnings = []
        forcing = None
        if len(self.memo.log) != 3:
            warnings.append(f"expected 3 solves, saw {len(self.memo.log)}")
        else:
            forcing = self.memo.log[-1]["forcing"]
        if forcing is not None:
            forcing = {key: [float(v) for v in values] for key, values in forcing.items()}

        return {
            "ok": True,
            "files": files,
            "forcing": forcing,
            "warnings": warnings,
            "timing": {
                "total": elapsed,
                "solves": [
                    {"solve": entry["solve"], "cached": entry["cached"],
                     "seconds": entry["seconds"], "bypass": entry["bypass"]}
                    for entry in self.memo.log
                ],
                "reused": sum(1 for entry in self.memo.log if entry["cached"]),
            },
        }


def run_json(session, temperature_csv, precipitation_csv, settings_json, plan_json, on_progress=None):
    """JSON in, JSON out, so the worker never touches a Python object."""
    try:
        payload = session.run(
            temperature_csv, precipitation_csv or None,
            json.loads(settings_json), json.loads(plan_json), on_progress,
        )
    except Exception as error:  # surfaced to the page verbatim
        payload = {"ok": False, "kind": type(error).__name__, "message": str(error)}
    return json.dumps(payload, allow_nan=False)


def load_climate_json(session, temperature_csv, precipitation_csv=None):
    try:
        payload = session.load_climate(temperature_csv, precipitation_csv or None)
    except Exception as error:
        payload = {"ok": False, "kind": type(error).__name__, "message": str(error)}
    return json.dumps(payload, allow_nan=False)
