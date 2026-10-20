# Track record: methods and full results

An independent retrospective check of the published model against locally acquired
dengue in the United States, 2024–2026. It is not part of the paper and has not been
peer reviewed. Everything the planner's *Track record* column shows comes from here.

## The claim it supports

**A within-season timing tool for places where *Aedes aegypti* is established.** From
temperature alone the model locates the site's high season — and it does so from
temperatures knowable the January before. It says **when**, not **whether**: it marks a
high season wherever the mosquito is established, whether or not an outbreak follows.

## Why the page shows relative risk

The model's transmission index is `R0(t) = f(T(t)) · A(t) / N_H`, and adult abundance
`A` scales with a breeding-site density the model assumes (0.06 per person, everywhere)
rather than measures. The system is homogeneous of degree one in that density —
density dependence acts through larvae per breeding site, and every control is either a
mortality rate or a fraction of sites — so after the warm-up, scaling the density scales
`R0(t)` by exactly the same factor.

Checked numerically on a scratch copy of the model with the density multiplied by 0.7
and 1.3 (Tampa Bay 2026 January forecast, with a plan):

| Density | Peak R0 | Shape vs ×1.0 (max abs diff of R0/peak) | Plan's relative reduction | Days with R0 > 1 |
|---|---|---|---|---|
| ×0.7 | 0.544 (×0.7000) | 2.8e-5 | 9.5075% | 0 |
| ×1.0 | 0.777 | — | 9.5080% | 0 |
| ×1.3 | 1.010 (×1.3000) | 2.9e-5 | 9.5090% | 5 |

So the shape of the season and a plan's percentage effect are properties of the site and
the schedule; the absolute level, and anything defined by crossing R0 = 1, are properties
of the assumption. The page therefore shows risk as a share of the site's uncontrolled
peak, defines the high season by that share, and reports a plan's effect in percent.

## Method

- **Model:** this repository, unmodified, run through `web/py/driver.py` with the Numba
  stand-in — the same code path as the browser. No control plan.
- **January forecast:** day-of-year mean daily temperature over the ten preceding years
  (ERA5 via the Open-Meteo archive), one-week smoothed as in the paper. Only information
  available before the season began.
- **High season (fixed before looking at the cases):** first to last day on which the
  uncontrolled risk is at least **half** its annual peak.
- **Cases:** locally acquired dengue by county of **exposure** from Florida DOH weekly
  arbovirus reports (final or latest revision), and the Virginia DOH clinician letter of
  4 August 2026. Florida reports are cumulative by **report** week, which lags onset.

## Results

| Site | Cases | January high season | First local case | Lead |
|---|---|---|---|---|
| Tampa Bay, FL · 2026 | 347 (Hillsborough 310, Pinellas 37) | 8 Jun – 28 Sep | week of 19 Jul | **+41 days** |
| Brevard County, FL · 2025 | 35 | 19 Jun – 30 Sep | week of 20 Jul | **+31 days** |
| Northern Virginia · 2026 | 1, no onward transmission | none — *Ae. aegypti* cannot persist | 4 Aug | correct negative |

Tampa Bay 2026 had 28 weeks without a local case, then Florida's onsets ran July (21),
August (159) and September (188; still being revised) — inside the forecast window.
Brevard's cluster grew from late July to September, also inside it. The Northern
Virginia case was one mosquito bridging a returning traveller to a neighbour; the model
gives the site no high season at all, consistent with the absence of onward spread.

**Robustness to the cut** (January forecast):

| Cut | Tampa Bay 2026 lead | Brevard 2025 lead |
|---|---|---|
| 40% of peak | +53 days | +42 days |
| 50% (used) | +41 days | +31 days |
| 60% of peak | +29 days | +28 days |

## Limits, stated plainly

- **It says when, not whether.** Every Florida site examined has a high season, outbreak or
  not: mid-May to early October on the temperatures each year actually had, and from 8–19
  June to late September or early October on the January forecasts (Miami-Dade 2026: 13 Jun
  – 10 Oct). Where the vector is established this is close to the climatological summer;
  the model adds a site- and year-specific window and a way to compare schedules within
  it, not an outbreak forecast.
- **Los Angeles 2024 is a miss.** Run on the temperatures that year actually had, its high
  season is 10 Sep – 9 Oct; LA County's 18 local cases ran August–November. The model
  shifts Southern California later, in the right direction, but too far and too narrowly.
- **R0 = 1 is not an alarm threshold, and the level does not rank sites.** On the January
  forecast the uncontrolled R0 never reached 1 at either Florida outbreak site (peaks 0.78
  and 0.79). For 2026 it put Miami-Dade (peak 0.92) above Tampa Bay (0.78) — the year Tampa
  Bay had 347 local cases and Miami-Dade 9. Both follow from the uncalibrated level
  described above.
- **Small n.** Two clean continental events. Florida 2024 cannot test seasonal timing
  (transmission in 11 of 12 months, multiple introductions); Puerto Rico is year-round.

## Reproducing

```bash
uv run --python 3.12 --with numpy,scipy,pandas python web/tools/make_casestudies.py
```

Inputs: `web/cases/*.csv` (January forecast temperatures) and `web/tools/case_data.json`
(case counts with their sources). Output: `web/casestudies.json`, which records the git
commit, the SHA-256 of the model files and of each input.

## Sources

- Florida Department of Health, weekly arbovirus surveillance reports:
  [week 40 2026](https://www.floridahealth.gov/wp-content/uploads/2026/10/fl-arbovirus-report-w40-2026.pdf),
  [week 53 2025](https://www.floridahealth.gov/wp-content/uploads/2026/01/2025Week53ArbovirusReport_1-5-26-4.pdf).
- DOH-Brevard, [mosquito-borne illness alert, 30 Jul 2025](https://brevard.floridahealth.gov/2025/07/30/doh-brevard-issues-mosquito-borne-illness-alert/).
- Virginia Department of Health, [clinician letter, 4 Aug 2026](https://www.vdh.virginia.gov/clinicians/clinician-letters/vdh-identifies-a-locally-acquired-case-of-dengue-virus-infection-in-northern-virginia-resident/).
- CDC, [dengue data and statistics](https://www.cdc.gov/dengue/data-research/facts-stats/index.html).
- Temperatures: [Open-Meteo historical weather API](https://open-meteo.com/en/docs/historical-weather-api), ERA5 reanalysis (Hersbach et al., 2020); contains modified Copernicus Climate Change Service information.
