# -*- coding: utf-8 -*-
"""Write web/example.json: a precomputed run shown before the runtime loads.

The page needs about half a minute to download Python and the scientific
stack. Without this the first thing a visitor sees is an empty form, so the
page renders this result immediately, labelled as an example, and replaces it
with a live run once the model is ready.

Generated through the same driver and the same numba stand-in the browser
uses, so the numbers match what the page computes for itself.

    uv run --python 3.12 --with numpy,scipy,pandas python web/tools/make_example.py
"""
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "web", "pyshim"))     # the browser's code path
sys.path.insert(0, os.path.join(ROOT, "web", "py"))
sys.path.insert(0, ROOT)

import driver  # noqa: E402

SETTINGS = {"ls_ef": 0.05, "len_lr": 15, "is_ef": 0.05, "len_ins": 2,
            "cl_ef": 0.3, "len_cr": 20}
PLAN = {"larvicide": ["2026-06-25"],
        "adulticide": ["2026-07-20", "2026-08-05"],
        "habitat": ["2026-07-09"]}
CSV = os.path.join(ROOT, "sample_climate_csv", "sample_temperature_2026.csv")


def numbers(text):
    return [float(line) for line in text.splitlines() if line.strip()]


def git_sha():
    try:
        out = subprocess.run(["git", "-C", ROOT, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, check=True)
        dirty = subprocess.run(["git", "-C", ROOT, "status", "--porcelain"],
                               capture_output=True, text=True, check=True)
        return out.stdout.strip() + ("-dirty" if dirty.stdout.strip() else "")
    except Exception:
        return "unknown"


def main():
    with open(CSV, encoding="utf-8") as handle:
        csv = handle.read()

    session = driver.Session(workdir="/tmp/aedes_example")
    climate = session.load_climate(csv)
    result = session.run(csv, None, SETTINGS, PLAN)
    if not result["ok"]:
        raise SystemExit(f"model failed: {result.get('message')}")

    files = result["files"]
    dates = [line.strip() for line in files["dates.txt"].splitlines() if line.strip()]
    by_date = dict(zip(climate["dates"], climate["temperature"]))

    payload = {
        "name": os.path.basename(CSV),
        "year": climate["year"],
        "climateKey": climate["climateKey"],
        "settings": SETTINGS,
        "plan": PLAN,
        "series": {
            "dates": dates,
            "temperature": [by_date.get(date) for date in dates],
            "riskBefore": numbers(files["risk_before.txt"]),
            "riskAfter": numbers(files["risk_after.txt"]),
            "adultsBefore": numbers(files["population_before.txt"]),
            "adultsAfter": numbers(files["population_after.txt"]),
            "forcing": result["forcing"],
        },
        "provenance": {
            "git": git_sha(),
            "model": driver.model_hashes(ROOT),
            "climate_sha256": hashlib.sha256(csv.encode()).hexdigest(),
            "note": "Precomputed so the page has something to show while the "
                    "Python runtime loads. Regenerate with web/tools/make_example.py.",
        },
    }

    out = os.path.join(ROOT, "web", "example.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), allow_nan=False)
        handle.write("\n")
    print(f"wrote {out} ({os.path.getsize(out) // 1024} KB, {len(dates)} days)")


if __name__ == "__main__":
    main()
