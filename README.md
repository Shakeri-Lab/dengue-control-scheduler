# dengue-control-scheduler

**Aedes Control** — simulation and adjoint-based optimal scheduling of *Aedes aegypti*
vector control (larvicide, adulticide, breeding-site removal), driven by a
temperature-dependent, non-Markovian model of the mosquito life cycle.

Code accompanying:

> A. Vajdi, L. W. Cohnstaedt, C. M. Scoglio, H. Shakeri. *Optimal Scheduling of Dengue
> Vector Control.* arXiv:2605.12441, 2026.

The population model is from:

> A. Vajdi, L. W. Cohnstaedt, C. M. Scoglio. *Assessing dengue risk globally using
> non-Markovian models.* Journal of Theoretical Biology 591:111865, 2024.

Code by Aram Vajdi.

## What it does

For a location and a calendar year the application solves the mosquito population model
twice — without control and with a control plan — and reports the adult population and
the transmission-risk index (R0) before and after.

- **Optimize** — you fix how many applications of each measure, their duration and
  strength; an adjoint-gradient search finds the application dates that minimise the
  time-averaged R0.
- **Fixed schedule** — you give the dates; the application evaluates that plan.

See [User_Manual.pdf](User_Manual.pdf) for the GUI.

## Install

Python 3.10 or later.

```bash
pip install -r requirements.txt
```

`tkinter` ships with the standard Windows and macOS Python installers; on Debian/Ubuntu
install `python3-tk`. `tkintermapview` is optional (map-based location picker; it
downloads OpenStreetMap tiles).

## Web version

`index.html` is a browser version of the **Fixed schedule** mode for users who bring their
own climate CSV. It runs the same Python files as the desktop application, unmodified,
inside the browser with [Pyodide](https://pyodide.org) (`web/worker.js`); the CSV never
leaves the user's computer. Pyodide has no Numba, so `web/pyshim/numba/` provides a
stand-in that runs the `@njit` functions as plain NumPy — results agree with the desktop
run to solver tolerance (about 5e-5 relative), and a run takes roughly 20–40 s.
Optimize mode and the worldwide climate grids are desktop-only.

Serve the repository root over HTTP to try it locally (`python -m http.server`, then open
`http://localhost:8000`), or publish the repository root with GitHub Pages.

## Climate data (required for location lookup)

The two worldwide climate grids are too large for git (GitHub rejects files over
100 MB). They are attached to the repository's **Releases** page, together with a zip of
the complete application.

| File | Size | SHA-256 |
|---|---|---|
| `temp_pastyearsav_py.mat` | 242 MB | `51cb20df72f15d54e62128dd4d58dd3d5306975195ab4d4b8c25435cef12e872` |
| `pre_pastyearsav_py.mat` | 425 MB | `095f27373c80a666045e0df4cf6afa168c8c723d0a498775093826b9ca4037b4` |
| `AedasAegypti_forPaper.zip` (everything) | 668 MB | `f5253449b4fa399dd66460ad57a86e1cbfddcfd4d9faa2d9596a98aba45ed153` |

Download the two `.mat` files into the repository root (next to `Main.py`). The grids are
daily climatologies on the ERA5 0.25° grid (1440 × 721 × 365), derived from the ERA5
reanalysis (Hersbach et al., 2020; contains modified Copernicus Climate Change Service
information).

The grids are **not** needed if you supply your own one-year daily CSV files for
temperature (°C) and precipitation (m/day); see `sample_climate_csv/` and Section 8 of
the manual.

## Run

Start the GUI from the repository root (default data paths are relative to the working
directory):

```bash
python Main.py
```

Headless use — both entry points take strings, as the GUI passes them:

```python
from Run_AEDES_AEGYPTI import Run_AEDES_AEGYPTI
from Optimize_AEDES_AEGYPTI import Optimize_AEDES_AEGYPTI

Run_AEDES_AEGYPTI(
    adtemp="sample_climate_csv/sample_temperature_2026.csv",
    adpre="sample_climate_csv/sample_precipitation_2026.csv",
    larvicide_dates="2026-06-25", insecticide_dates="2026-07-20,2026-08-05",
    habitat_dates="", adsave="results_fixed",
)

Optimize_AEDES_AEGYPTI(
    adtemp="sample_climate_csv/sample_temperature_2026.csv",
    adpre="sample_climate_csv/sample_precipitation_2026.csv",
    numtrls="1", numtris="2", numtrcl="1", adsave="results_opt",
)
```

Pass `adtemp` explicitly to `Optimize_AEDES_AEGYPTI`; its built-in default names a file
that is not distributed. A fixed-schedule run takes well under a minute; an optimisation
(600 gradient iterations × 10 random starts) takes roughly half an hour on a laptop.

## Things to know about this version

- **"Efficiency" is a rate, not a fraction.** For larvicide and adulticide the value is
  the added mortality rate in day⁻¹ while the treatment is active (the paper's *E_l*,
  *E_a*). For habitat removal it is the fraction of breeding sites removed, which then
  recover with an e-folding time equal to the "duration".
- **Precipitation is switched off.** `Kt = Kt*0 + 1.0` in `Optimize_AEDES_AEGYPTI.py`
  and `Run_AEDES_AEGYPTI.py` fixes the precipitation multiplier at 1, as in the paper's
  results. A precipitation input is still required. Comment that line out to enable it.
- **Optimisation results vary between runs.** Initial dates are random and unseeded, and
  the objective has many near-equivalent local minima; the reported schedule is the best
  one visited across 10 starts.
- With the `.mat` grids the simulated calendar year is the year in which you run the tool.

## Files

| File | Purpose |
|---|---|
| `Main.py` | tkinter GUI |
| `Optimize_AEDES_AEGYPTI.py` | adjoint-gradient optimisation of application dates |
| `Run_AEDES_AEGYPTI.py` | fixed-schedule evaluation |
| `Dif_functions.py` | forward population ODE, backward adjoint ODE, gradient terms (Numba) |
| `MosquitoRates.py` | temperature-dependent development, mortality, oviposition and transmission rates |
| `LocationSeriesInput.py`, `cord_to_CRofland.py` | climate input: `.mat` grid lookup by lat/lon, or CSV |
| `sample_climate_csv/` | example one-year temperature and precipitation CSVs |

Each run writes plain-text series (`dates.txt`, `population_*.txt`, `risk_*.txt`,
`*_application_dates.txt`) and `run_metadata.json` into the chosen results folder.

## Acknowledgment

Supported by the United States Department of Agriculture, Agricultural Research Service,
under agreement 58-3022-3-025.
