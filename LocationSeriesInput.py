# -*- coding: utf-8 -*-
"""
Loader/validator for single-location daily climate CSVs (temperature or
precipitation), used as an alternative to the whole-world .mat grid files.
"""

import calendar
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat

from cord_to_CRofland import cord_to_CRofland


def load_annual_series_csv(filepath, value_column=None, return_dates=False):
    """
    Load a one-location daily time series covering one complete calendar year.
    The file must run from January 1 through December 31, with 365 rows or 366
    in a leap year. Set return_dates=True to return (dates, values).
    """
    df = pd.read_csv(filepath)
    if df.shape[1] < 2:
        raise ValueError(f"{filepath}: expected at least a date column and a value column.")

    date_col = None
    for cand in df.columns:
        if str(cand).strip().lower() in ("date", "dates", "day"):
            date_col = cand
            break
    if date_col is None:
        date_col = df.columns[0]

    if value_column is None:
        value_cols = [c for c in df.columns if c != date_col]
        if len(value_cols) != 1:
            raise ValueError(
                f"{filepath}: expected exactly one value column besides the date "
                f"column '{date_col}', found {value_cols}."
            )
        value_column = value_cols[0]

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    if df[date_col].isna().any():
        raise ValueError(f"{filepath}: could not parse one or more dates in column '{date_col}'.")

    df = df.sort_values(date_col).reset_index(drop=True)

    if df[date_col].duplicated().any():
        raise ValueError(f"{filepath}: contains duplicate dates.")

    diffs = df[date_col].diff().dropna()
    if len(diffs) > 0 and not (diffs == pd.Timedelta(days=1)).all():
        raise ValueError(f"{filepath}: dates must be consecutive calendar days with no gaps.")

    if df[date_col].dt.year.nunique() != 1:
        raise ValueError(f"{filepath}: CSV data must belong to one calendar year.")

    year = int(df[date_col].dt.year.iloc[0])
    expected_dates = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")
    dates = pd.DatetimeIndex(df[date_col].dt.normalize())
    if not dates.equals(expected_dates):
        expected_rows = 366 if calendar.isleap(year) else 365
        raise ValueError(
            f"{filepath}: expected every date from {year}-01-01 through {year}-12-31 "
            f"({expected_rows} consecutive rows)."
        )

    if df[value_column].isna().any():
        raise ValueError(f"{filepath}: column '{value_column}' has missing values.")

    values = df[value_column].astype(float).to_numpy()
    if return_dates:
        return dates, values
    return values


def _is_csv(filepath):
    return str(filepath).strip().lower().endswith('.csv')


def load_temperature_series(adtemp, longitude, latitude):
    """
    Returns one calendar year of daily average temperature in degrees Celsius
    (365 values, or 366 for a leap-year CSV).
    Uses a single-location CSV (date, temperature-in-Celsius) if adtemp ends
    in .csv, otherwise looks up the (longitude, latitude) grid cell in the
    whole-world .mat file.
    """
    if _is_csv(adtemp):
        return load_annual_series_csv(adtemp)

    col, row = cord_to_CRofland(longitude, latitude)
    temp_data = loadmat(adtemp)
    temp = (np.squeeze(temp_data['dailyaverage'][row, col, range(temp_data['indexend'][0][0])]).astype(float) /
            (np.squeeze(temp_data['scaling'][0][0]).astype(float)) - 273.15)
    return temp


def load_precipitation_series(adpre, longitude, latitude):
    """
    Returns one calendar year of daily total precipitation in meters/day
    (365 values, or 366 for a leap-year CSV),
    (the unit the model's Kt thresholds, 0.0084 and 0.0038, are calibrated
    to). Uses a single-location CSV (date, precipitation-in-meters/day) if
    adpre ends in .csv, otherwise looks up the (longitude, latitude) grid
    cell in the whole-world .mat file, which decodes to the same unit.
    """
    if _is_csv(adpre):
        return load_annual_series_csv(adpre)

    col, row = cord_to_CRofland(longitude, latitude)
    pre_data = loadmat(adpre)
    pre = (np.squeeze(pre_data['dailytot'][row, col, range(pre_data['indexend'][0][0])]).astype(float) /
           (np.squeeze(pre_data['scaling']).astype(float)))
    return pre


def climate_uses_csv(adtemp, adpre):
    """Return True when either climate input supplies an explicit calendar."""
    return _is_csv(adtemp) or _is_csv(adpre)


def _mat_dates(values):
    """Assign a neutral calendar to undated MATLAB climatology values."""
    if len(values) == 365:
        return pd.date_range("2001-01-01", "2001-12-31", freq="D")
    if len(values) == 366:
        return pd.date_range("2000-01-01", "2000-12-31", freq="D")
    raise ValueError(f"MATLAB climate data must contain 365 or 366 daily values; got {len(values)}.")


def map_annual_series(source_dates, source_values, target_dates):
    """Map an annual cycle by month/day, interpolating February 29 if needed."""
    lookup = {
        (date.month, date.day): float(value)
        for date, value in zip(pd.DatetimeIndex(source_dates), np.asarray(source_values, dtype=float))
    }
    if (2, 29) not in lookup:
        lookup[(2, 29)] = (lookup[(2, 28)] + lookup[(3, 1)]) / 2.0

    try:
        return np.asarray(
            [lookup[(date.month, date.day)] for date in pd.DatetimeIndex(target_dates)],
            dtype=float,
        )
    except KeyError as error:
        month, day = error.args[0]
        raise ValueError(f"Climate series has no value for {month:02d}-{day:02d}.") from error


def load_climate_inputs(adtemp, adpre, longitude, latitude, target_year=None):
    """Return one aligned simulation calendar plus temperature/precipitation.

    A CSV supplies the calendar year. If both inputs are CSV, their dates must
    match exactly. MATLAB-only runs require target_year because MATLAB values
    are an undated annual climatology.
    """
    if _is_csv(adtemp):
        temp_dates, temp_values = load_annual_series_csv(adtemp, return_dates=True)
    else:
        temp_values = load_temperature_series(adtemp, longitude, latitude)
        temp_dates = _mat_dates(temp_values)

    if _is_csv(adpre):
        pre_dates, pre_values = load_annual_series_csv(adpre, return_dates=True)
    else:
        pre_values = load_precipitation_series(adpre, longitude, latitude)
        pre_dates = _mat_dates(pre_values)

    csv_calendars = []
    if _is_csv(adtemp):
        csv_calendars.append((Path(str(adtemp)).name, temp_dates))
    if _is_csv(adpre):
        csv_calendars.append((Path(str(adpre)).name, pre_dates))
    if len(csv_calendars) == 2 and not csv_calendars[0][1].equals(csv_calendars[1][1]):
        raise ValueError(
            f"{csv_calendars[0][0]} and {csv_calendars[1][0]} must contain exactly the same dates."
        )

    if csv_calendars:
        simulation_dates = csv_calendars[0][1]
        csv_year = int(simulation_dates[0].year)
        if target_year is not None and int(target_year) != csv_year:
            raise ValueError(f"The selected CSV calendar is {csv_year}, not {target_year}.")
        date_source = "csv"
    else:
        if target_year is None:
            raise ValueError("A simulation year is required when MATLAB climate data is used.")
        simulation_dates = pd.date_range(
            f"{int(target_year)}-01-01", f"{int(target_year)}-12-31", freq="D"
        )
        date_source = "matlab"

    temperature = map_annual_series(temp_dates, temp_values, simulation_dates)
    precipitation = map_annual_series(pre_dates, pre_values, simulation_dates)
    return simulation_dates, temperature, precipitation, date_source
