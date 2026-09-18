# -*- coding: utf-8 -*-
import numpy as np

def cord_to_CRofland(longitude, latitude):
    """
    Convert longitude and latitude to grid column and row indices.

    Parameters:
        longitude (float or array-like): Longitude value(s) in the range 0-360 or -180 to 180.
        latitude (float or array-like): Latitude value(s) in the range -90 to 90.

    Returns:
        tuple: A tuple containing:
            - col (int or array-like): Column index.
            - row (int or array-like): Row index.
    """
    # Convert latitude to column index
    col = np.ceil(721 - 4 * (latitude + 0.125 + 90)).astype(int)

    # Convert longitude to row index
    row = np.maximum(np.ceil((longitude + 0.125) % 360 / 0.25), 1).astype(int)

    return col, row
