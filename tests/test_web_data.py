"""The page's generated data must match the model and be internally consistent.

Fast: reads web/casestudies.json and web/example.json without running the model.
If the model files change, regenerate with web/tools/make_casestudies.py and
web/tools/make_example.py — this test fails until you do.
"""
import datetime
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

import driver  # noqa: E402


def load(name):
    with open(os.path.join(ROOT, "web", name), encoding="utf-8") as handle:
        return json.load(handle)


def test_casestudies_built_from_current_model():
    data = load("casestudies.json")
    assert data["provenance"]["model"] == driver.model_hashes(ROOT), (
        "web/casestudies.json was generated from different model files; "
        "rerun web/tools/make_casestudies.py")


def test_casestudy_inputs_unchanged():
    data = load("casestudies.json")
    for case_id, digest in data["provenance"]["inputs"].items():
        entry = next(e for e in data["entries"] if e["id"] == case_id)
        with open(os.path.join(ROOT, entry["temperature_csv"]), "rb") as handle:
            assert hashlib.sha256(handle.read()).hexdigest() == digest, case_id


def test_high_season_and_lead_follow_from_the_stored_series():
    """Recompute every displayed timing number from the stored model output."""
    for entry in load("casestudies.json")["entries"]:
        if entry["kind"] != "timing":
            continue
        model = entry["model"]
        risk, dates = model["risk_before"], model["dates"]
        cut = 0.5 * max(risk)
        inside = [i for i, value in enumerate(risk) if value >= cut]
        assert [dates[inside[0]], dates[inside[-1]]] == model["high_season"], entry["id"]
        lead = (datetime.date.fromisoformat(entry["first_case"])
                - datetime.date.fromisoformat(model["high_season"][0])).days
        assert lead == entry["lead_days"], entry["id"]
        assert lead > 0, f"{entry['id']}: high season did not open before the first case"


def test_case_series_are_cumulative_and_end_at_the_total():
    for entry in load("casestudies.json")["entries"]:
        values = [value for _, value in entry["cumulative_by_report_week"]]
        assert values == sorted(values), entry["id"]
        dates = [date for date, _ in entry["cumulative_by_report_week"]]
        assert dates == sorted(dates), entry["id"]


def test_example_matches_its_plan_and_climate():
    example = load("example.json")
    assert example["provenance"]["model"] == driver.model_hashes(ROOT), (
        "web/example.json was generated from different model files; rerun web/tools/make_example.py")
    series = example["series"]
    assert len(series["dates"]) == len(series["riskBefore"]) == len(series["riskAfter"])
    # A plan can only lower risk on the day it acts if it has any effect at all.
    assert max(series["riskAfter"]) <= max(series["riskBefore"]) + 1e-12
