"""The browser driver's memoization must be invisible in the results.

Run with:  python -m pytest tests/test_web_memo.py
(add the repository root to sys.path; web/pyshim must come first so the model
runs the same NumPy path the browser uses)
"""
import json
import os
import sys

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "web", "pyshim"))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))
sys.path.insert(0, ROOT)

import driver  # noqa: E402

SAMPLES = os.path.join(ROOT, "sample_climate_csv")
SETTINGS = {"len_lr": 15, "ls_ef": 0.05, "len_ins": 2, "is_ef": 0.05,
            "len_cr": 20, "cl_ef": 0.3}

PLAN_A = {"larvicide": ["2026-06-25"],
          "adulticide": ["2026-07-20", "2026-08-05"],
          "habitat": ["2026-07-09"]}
PLAN_B = {"larvicide": ["2026-05-02", "2026-08-30"],
          "adulticide": ["2026-06-11"],
          "habitat": []}
SETTINGS_B = {"len_lr": 22, "ls_ef": 0.2, "len_ins": 5, "is_ef": 0.3,
              "len_cr": 33, "cl_ef": 0.5}
EMPTY_PLAN = {"larvicide": [], "adulticide": [], "habitat": []}

# Per-run metadata that is not a model output: a timestamp, and the absolute
# paths of the input files, which differ because each session has its own
# working directory.
VOLATILE = {"generated_at", "inputs"}


@pytest.fixture(scope="module")
def temperature_csv():
    with open(os.path.join(SAMPLES, "sample_temperature_2026.csv"), encoding="utf-8") as handle:
        return handle.read()


def files_of(payload):
    """Result files with the timestamp removed, so runs are comparable."""
    assert payload["ok"], payload.get("message")
    files = dict(payload["files"])
    metadata = json.loads(files.pop("run_metadata.json"))
    for key in VOLATILE:
        metadata.pop(key, None)
    files["run_metadata.json"] = json.dumps(metadata, sort_keys=True)
    return files


def session(tmp_path, name, enabled=True):
    return driver.Session(workdir=str(tmp_path / name), enabled=enabled)


def test_plan_independent_solves_are_identical(tmp_path, temperature_csv):
    """The premise: with zero levels, times and durations cannot matter.

    Different unseeded placeholder schedules and different durations must give
    byte-identical warm-up and no-control solutions.
    """
    captured = []

    def capture(enabled_session, settings):
        solutions = []
        original = driver.MemoSolve.__call__

        def spy(self, fun, *positional, **keyword):
            solution = original(self, fun, *positional, **keyword)
            if len(solutions) < 2:
                solutions.append(np.array(solution.y, copy=True))
            return solution

        driver.MemoSolve.__call__ = spy
        try:
            enabled_session.run(temperature_csv, None, settings, PLAN_A)
        finally:
            driver.MemoSolve.__call__ = original
        return solutions

    np.random.seed(1)
    captured.append(capture(session(tmp_path, "premise_a", enabled=False), SETTINGS))
    np.random.seed(999)
    captured.append(capture(session(tmp_path, "premise_b", enabled=False), SETTINGS_B))

    for first, second in zip(captured[0], captured[1]):
        assert np.array_equal(first, second)


def test_cached_session_matches_plain_runs(tmp_path, temperature_csv):
    """Fill the cache under one plan, consume it under others."""
    warm = session(tmp_path, "warm")
    order = [
        ("empty", EMPTY_PLAN, SETTINGS),
        ("plan_a", PLAN_A, SETTINGS),
        ("plan_b", PLAN_B, SETTINGS_B),      # different durations and strengths
        ("habitat", {"larvicide": [], "adulticide": [], "habitat": ["2026-07-01"]}, SETTINGS),
        ("zero_strength", PLAN_A, dict(SETTINGS, ls_ef=0, is_ef=0, cl_ef=0)),
    ]

    for name, plan, settings in order:
        cached = warm.run(temperature_csv, None, settings, plan)
        plain = session(tmp_path, f"plain_{name}", enabled=False).run(
            temperature_csv, None, settings, plan
        )
        assert files_of(cached) == files_of(plain), name

        solves = cached["timing"]["solves"]
        assert len(solves) == 3, name
        if name == "empty":
            # First run: nothing to reuse. Its third solve keys the same as the
            # second, so the no-control result is reused at once.
            assert [s["cached"] for s in solves] == [False, False, True], name
        else:
            assert [s["cached"] for s in solves[:2]] == [True, True], name


def test_leap_year_is_a_separate_key(tmp_path):
    dates = np.arange("2024-01-01", "2025-01-01", dtype="datetime64[D]")
    values = 22 + 6 * np.sin(np.arange(dates.size) / dates.size * 2 * np.pi - 1.8)
    csv = "date,temperature\n" + "\n".join(
        f"{day},{value}" for day, value in zip(dates.astype(str), values)
    ) + "\n"
    leap = session(tmp_path, "leap")
    payload = leap.run(csv, None, SETTINGS, {"larvicide": ["2024-06-25"],
                                             "adulticide": [], "habitat": []})
    assert payload["ok"]
    assert len(payload["files"]["dates.txt"].strip().split("\n")) == 366


@pytest.mark.parametrize("tamper", [
    "level", "recovery_one", "temps_ulp", "y0_ulp", "t_eval_ulp",
    "rtol", "extra_kwarg", "extra_key", "shape",
])
def test_tampered_calls_miss_the_cache(temperature_csv, tamper):
    """Every one of these must fall through to the real solver."""
    import Dif_functions

    def key_for(mutate=None, extra=None, drop=None):
        scalars = {"del_sprofil": 0.01, "del_delta": 0.01}
        profiles = {"sprofil_lr": np.ones(200_000), "sprofil_ins": np.ones(200_000),
                    "deltaprofil": np.ones(200_000),
                    "drsprofil_lr": np.zeros(3), "drsprofil_ins": np.zeros(3),
                    "drdeltaprofil": np.zeros(3)}
        arrays = {
            "lstim": np.array([[10.0]]), "lslev": np.array([[0.0]]),
            "istim": np.array([[10.0]]), "islev": np.array([[0.0]]),
            "taucl": np.array([[10.0]]), "alpha": np.array([[0.0]]),
            "temps": np.full((1, 366), 25.0), "Cl0t": np.full((1, 366), 6e5),
            "Kt": np.ones((1, 366)), "rates": np.ones((14, 281)),
        }
        args = ({"Nhr": 10_000_000, "R": 1}, scalars, {"eind": np.arange(50)},
                profiles, {}, arrays)
        keyword = {"method": "RK45", "t_eval": np.arange(0.2, 365.9, 0.1),
                   "args": args, "rtol": 1e-4}
        positional = ([0.2, 365.8], np.full(400, 2000.0))
        if mutate:
            mutate(positional, keyword, args)
        if extra:
            keyword.update(extra)
        return driver.cache_key(
            Dif_functions.odeforward_AEDES_AEGYPTI,
            Dif_functions.odeforward_AEDES_AEGYPTI, positional, keyword,
        )

    baseline = key_for()

    def nudge(array):
        array.flat[0] = np.nextafter(array.flat[0], np.inf)

    mutations = {
        # A level below any physical value must still bypass, not hash to a hit.
        "level": lambda p, k, a: a[5].__setitem__("lslev", np.array([[1e-300]])),
        # deltaprofil overflows to NaN for a recovery time below ~1.4 days.
        "recovery_one": lambda p, k, a: a[3].__setitem__(
            "deltaprofil", np.concatenate([np.ones(199_999), [np.nan]])),
        "temps_ulp": lambda p, k, a: nudge(a[5]["temps"]),
        "y0_ulp": lambda p, k, a: nudge(p[1]),
        "t_eval_ulp": lambda p, k, a: nudge(k["t_eval"]),
        "rtol": lambda p, k, a: k.__setitem__("rtol", 1e-5),
        "extra_key": lambda p, k, a: a[5].__setitem__("newthing", np.ones((1, 3))),
        "shape": lambda p, k, a: a[5].__setitem__("lslev", np.zeros((2, 1))),
    }

    if tamper in ("level", "recovery_one", "shape"):
        with pytest.raises(driver.Bypass):
            key_for(mutations[tamper])
    elif tamper == "extra_kwarg":
        with pytest.raises(driver.Bypass):
            key_for(extra={"atol": 1e-9})
    else:
        assert key_for(mutations[tamper]) != baseline


def test_cached_arrays_are_read_only(tmp_path, temperature_csv):
    warm = session(tmp_path, "readonly")
    warm.run(temperature_csv, None, SETTINGS, PLAN_A)
    for _, solution, _ in warm.memo.cached():
        assert not solution.y.flags.writeable
        assert not solution.t.flags.writeable


def test_model_lock_matches_the_model(tmp_path):
    with open(os.path.join(ROOT, "web", "model.lock.json"), encoding="utf-8") as handle:
        lock = json.load(handle)
    assert lock["files"] == driver.model_hashes(ROOT), (
        "web/model.lock.json is stale: regenerate it with "
        "python web/tools/make_lock.py after re-running these tests"
    )
