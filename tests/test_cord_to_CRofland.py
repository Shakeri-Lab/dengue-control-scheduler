"""Grid lookup returns the zero-based index of the nearest 0.25-degree cell.

Run with:  python -m pytest tests   (or:  python tests/test_cord_to_CRofland.py)
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cord_to_CRofland import cord_to_CRofland  # noqa: E402


def cell_centre(col, row):
    """(latitude, longitude in 0-360) of a grid cell."""
    return 90.0 - 0.25 * col, 0.25 * row


def test_corners_and_known_cells():
    assert cord_to_CRofland(0.0, 90.0) == (0, 0)
    assert cord_to_CRofland(0.0, -90.0) == (720, 0)
    assert cord_to_CRofland(359.9, 0.0) == (360, 0)
    # Miami-Dade default site -> cell centred 25.75 N, 80.25 W
    assert cord_to_CRofland(-80.26, 25.84) == (257, 1119)


def test_longitudes_just_west_of_greenwich_stay_in_bounds():
    # These used to return index 1440 (out of bounds): west London, Accra.
    assert cord_to_CRofland(-0.2, 51.5) == (154, 1439)
    assert cord_to_CRofland(-0.2, 5.6) == (338, 1439)


def test_nearest_cell_everywhere():
    rng = np.random.default_rng(0)
    lon = rng.uniform(-180, 360, 20000)
    lat = rng.uniform(-90, 90, 20000)
    col, row = cord_to_CRofland(lon, lat)
    assert col.min() >= 0 and col.max() <= 720
    assert row.min() >= 0 and row.max() <= 1439
    cell_lat, cell_lon = cell_centre(col, row)
    dlon = np.abs((lon % 360) - cell_lon)
    dlon = np.minimum(dlon, 360 - dlon)
    assert np.all(np.abs(lat - cell_lat) <= 0.125 + 1e-9)
    assert np.all(dlon <= 0.125 + 1e-9)


if __name__ == "__main__":
    test_corners_and_known_cells()
    test_longitudes_just_west_of_greenwich_stay_in_bounds()
    test_nearest_cell_everywhere()
    print("ok")
