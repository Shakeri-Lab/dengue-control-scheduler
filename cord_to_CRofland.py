# -*- coding: utf-8 -*-
import numpy as np

def cord_to_CRofland(longitude, latitude):
    """
    Convert longitude and latitude to the zero-based indices of the nearest
    cell of the 0.25-degree climate grids (shape 1440 x 721 x days), where
    longitude index i is i * 0.25 degrees East and latitude index j is
    90 - j * 0.25 degrees North.

    Parameters:
        longitude (float or array-like): Longitude value(s) in the range 0-360 or -180 to 180.
        latitude (float or array-like): Latitude value(s) in the range -90 to 90.

    Returns:
        tuple: A tuple containing:
            - col (int or array-like): Latitude index, 0..720 (second array axis).
            - row (int or array-like): Longitude index, 0..1439 (first array axis).
    """
    # The two formulas below give MATLAB (one-based) indices; subtract 1 for NumPy.
    # Convert latitude to column index
    col = np.ceil(721 - 4 * (latitude + 0.125 + 90)).astype(int) - 1

    # Convert longitude to row index
    row = np.maximum(np.ceil((longitude + 0.125) % 360 / 0.25), 1).astype(int) - 1

    return np.clip(col, 0, 720), row % 1440
