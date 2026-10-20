# -*- coding: utf-8 -*-
"""Write web/casestudies.json: the track record shown beside the planner.

Every number on the page's track-record column comes from here. For each case
the published model is run (through the same driver and numba stand-in the
browser uses) on the January forecast temperatures — the ten preceding years'
climatology, so the high season it gives was knowable before the season began
— and compared with locally acquired cases from tools/case_data.json.

The high season is level-free on purpose: the first to last day on which the
uncontrolled risk is at least half its annual peak. The model's R0 is exactly
linear in a breeding-site density that is assumed, not measured, so the R0 = 1
crossing depends on that assumption while the shape of the season does not
(scaling the density by 0.7 or 1.3 scales the peak by exactly that factor and
leaves the normalized curve unchanged to 3e-5).

    uv run --python 3.12 --with numpy,scipy,pandas python web/tools/make_casestudies.py
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "web", "pyshim"))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))
sys.path.insert(0, ROOT)

import driver  # noqa: E402

HALF = 0.5
NO_PLAN = {"larvicide": [], "adulticide": [], "habitat": []}
SETTINGS = {"ls_ef": 0.05, "len_lr": 15, "is_ef": 0.05, "len_ins": 2,
            "cl_ef": 0.3, "len_cr": 20}


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def git_sha():
    try:
        sha = subprocess.run(["git", "-C", ROOT, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", ROOT, "status", "--porcelain", "--",
                                *driver.MODEL_FILES],
                               capture_output=True, text=True, check=True).stdout.strip()
        return sha + ("-dirty" if dirty else "")
    except Exception:
        return "unknown"


def high_season(dates, risk):
    peak = max(risk)
    inside = [i for i, value in enumerate(risk) if value >= HALF * peak]
    return dates[inside[0]], dates[inside[-1]]


def days(a, b):
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


def main():
    with open(os.path.join(ROOT, "web", "tools", "case_data.json"), encoding="utf-8") as handle:
        spec = json.load(handle)

    session = driver.Session(workdir="/tmp/aedes_casestudies")
    entries = []
    for case in spec["cases"]:
        entry = {key: case[key] for key in (
            "id", "place", "year", "local_cases", "local_cases_note",
            "first_case", "first_case_note", "cumulative_by_report_week",
            "censored_after", "sources")}

        if case["temperature_csv"] is None:
            # No receptive season to time: Aedes aegypti cannot overwinter here.
            entry.update({"kind": "negative", "model": None})
            entries.append(entry)
            continue

        path = os.path.join(ROOT, case["temperature_csv"])
        with open(path, encoding="utf-8") as handle:
            csv = handle.read()
        result = session.run(csv, None, SETTINGS, NO_PLAN)
        if not result["ok"]:
            raise SystemExit(f"{case['id']}: model failed: {result.get('message')}")

        files = result["files"]
        dates = [d.strip() for d in files["dates.txt"].splitlines() if d.strip()]
        risk = [float(v) for v in files["risk_before.txt"].split()]
        adults = [float(v) for v in files["population_before.txt"].split()]
        temperature_by_date = {}
        for line in csv.splitlines()[1:]:
            if line.strip():
                date, value = line.split(",")[:2]
                temperature_by_date[date.strip()] = float(value)
        peak = max(risk)
        start, end = high_season(dates, risk)
        entry.update({
            "kind": "timing",
            "temperature_csv": case["temperature_csv"],
            "temperature_label": f"January forecast: {case['climatology_years']} climatology",
            "model": {
                "dates": dates,
                # Absolute model output, so the planner can open this case
                # without waiting for the runtime; the page divides by the
                # peak, the only form that does not depend on the assumed
                # breeding-site density.
                "risk_before": [round(v, 6) for v in risk],
                "adults_before": [round(v, 1) for v in adults],
                "temperature": [temperature_by_date.get(d) for d in dates],
                "high_season": [start, end],
                "high_season_days": days(start, end) + 1,
                "peak_date": dates[risk.index(peak)],
            },
            "lead_days": days(start, case["first_case"]),
        })
        entries.append(entry)
        print(f"{case['id']:24s} high season {start} .. {end}  "
              f"first case {case['first_case']}  lead {entry['lead_days']:+d} d")

    payload = {
        "generated": datetime.date.today().isoformat(),
        "high_season_rule": "first to last day on which uncontrolled risk is at least half its annual peak",
        "entries": entries,
        "provenance": {
            "git": git_sha(),
            "model": driver.model_hashes(ROOT),
            "inputs": {e["id"]: sha256(os.path.join(ROOT, e["temperature_csv"]))
                       for e in entries if e.get("temperature_csv")},
            "generator": "web/tools/make_casestudies.py",
            "case_data": "web/tools/case_data.json",
            "temperatures": "Open-Meteo ERA5 archive (Copernicus Climate Change Service), retrieved 2026-10-20",
        },
    }
    out = os.path.join(ROOT, "web", "casestudies.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), allow_nan=False)
        handle.write("\n")
    print(f"wrote {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
