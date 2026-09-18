# -*- coding: utf-8 -*-

import json
import numpy as np
import pandas as pd
from scipy.integrate import solve_ivp
from datetime import datetime
import os
from MosquitoRates import calculate_rates_AEDES_AEGYPTI
from Dif_functions import prepare_inputs2, odeforward_AEDES_AEGYPTI
from LocationSeriesInput import climate_uses_csv, load_climate_inputs, map_annual_series


def _parse_dates(datestr):
    items = [d.strip() for d in datestr.split(',') if d.strip()]
    if not items:
        return pd.to_datetime([]).date
    return pd.to_datetime(items).date


def Run_AEDES_AEGYPTI(
        longitude='-80.26',
        latitude='25.84',
        len_ins='2',
        len_lr='15',
        len_cr='20',
        ls_ef='0.05',
        is_ef='0.05',
        cl_ef='0.3',
        larvicide_dates='',
        insecticide_dates='',
        habitat_dates='',
        adtemp='temp_pastyearsav_py.mat',
        adpre='pre_pastyearsav_py.mat',
        adsave="Aedes_Aegypti_FixedSchedule",
):
    """Evaluate a single, user-specified application schedule (no search/optimization).

    larvicide_dates / insecticide_dates / habitat_dates are comma-separated
    'YYYY-MM-DD' strings. A blank list means that control is not applied.
    """

    longitude = float(longitude)
    latitude = float(latitude)
    len_ins = float(len_ins)
    len_lr = float(len_lr)
    len_cr = float(len_cr)
    ls_ef = float(ls_ef)
    is_ef = float(is_ef)
    cl_ef = float(cl_ef)

    larvicide_targets = _parse_dates(larvicide_dates)
    insecticide_targets = _parse_dates(insecticide_dates)
    habitat_targets = _parse_dates(habitat_dates)

    # Resolve one canonical calendar before warm-up or schedule construction.
    # A CSV supplies its year. MATLAB-only runs infer one year from treatments.
    all_targets = [
        date
        for target_group in (larvicide_targets, insecticide_targets, habitat_targets)
        for date in target_group
    ]
    if climate_uses_csv(adtemp, adpre):
        target_year = None
    else:
        treatment_years = sorted({date.year for date in all_targets})
        if len(treatment_years) > 1:
            years_text = ", ".join(str(year) for year in treatment_years)
            raise ValueError(
                "MATLAB climate data represents one annual cycle. All treatment "
                f"dates must use the same year; found {years_text}."
            )
        target_year = treatment_years[0] if treatment_years else datetime.today().year

    simulation_dates, annual_temp, annual_pre, date_source = load_climate_inputs(
        adtemp, adpre, longitude, latitude, target_year=target_year
    )
    valid_treatment_dates = set(simulation_dates.date)
    outside_dates = sorted({date for date in all_targets if date not in valid_treatment_dates})
    if outside_dates:
        invalid_text = ", ".join(date.isoformat() for date in outside_dates[:6])
        if len(outside_dates) > 6:
            invalid_text += ", …"
        raise ValueError(
            f"Treatment dates must be between {simulation_dates[0].date()} and "
            f"{simulation_dates[-1].date()}. Outside this period: {invalid_text}."
        )

    warmup_days = 596
    model_dates = pd.date_range(
        simulation_dates[0] - pd.Timedelta(days=warmup_days + 1),
        simulation_dates[-1],
        freq="D",
    )
    dates = model_dates.to_numpy()
    temp = map_annual_series(simulation_dates, annual_temp, model_dates)
    pre = map_annual_series(simulation_dates, annual_pre, model_dates)
    pre_ma = pd.Series(pre).rolling(window=15, min_periods=15).mean().bfill().to_numpy()

    prlrn = 1
    temps = np.tile(temp, (prlrn, 1))
    pres = np.tile(pre_ma, (prlrn, 1))
    del temp, pre, pre_ma, annual_temp, annual_pre

    # Profiles for larval and adult stages control measures
    del_sprofil = 0.01
    sprofil_ins = np.concatenate((np.zeros(1), np.arange(0, 1 + del_sprofil, del_sprofil),
                                   np.ones(int(max(len_ins-1,0) / del_sprofil)), np.arange(1, 0, -del_sprofil),
                                   np.zeros(int(len(dates) / del_sprofil))))
    f1tu = np.concatenate((np.zeros(1), sprofil_ins[0:-3]))
    f_1tu = sprofil_ins[1:-1]
    drsprofil_ins = (f1tu - f_1tu) / (2 * del_sprofil)

    sprofil_lr = np.concatenate((np.zeros(1), np.arange(0, 1 + del_sprofil, del_sprofil),
                                  np.ones(int(max(len_lr-1,0) / del_sprofil)), np.arange(1, 0, -del_sprofil),
                                  np.zeros(int(len(dates) / del_sprofil))))

    f1tu = np.concatenate((np.zeros(1), sprofil_lr[0:-3]))
    f_1tu = sprofil_lr[1:-1]
    drsprofil_lr = (f1tu - f_1tu) / (2 * del_sprofil)

    # Delta profile for carrying capacity 
    del_delta = 0.01
    tau = np.concatenate((np.arange(0, 4 + del_delta, del_delta),
                           4 + np.arange(del_delta, len(dates), del_delta)))

    sigma = np.concatenate((np.zeros(1), np.arange(0, 2 + del_delta, del_delta),
                             np.arange(2 - del_delta, 0, -del_delta),
                             np.zeros(len(np.arange(del_delta, len(dates), del_delta))))) / 4

    eta = 1 / len_cr
    dum = sigma * np.exp(eta * tau)
    int_profile = np.concatenate((np.zeros(1), np.cumsum(dum[:-1] + dum[1:]) * del_delta / 2))
    deltaprofil = int_profile * np.exp(-eta * tau)
    f1tu = np.concatenate((np.zeros(1), deltaprofil[0:-3]))
    f_1tu = deltaprofil[1:-1]
    drdeltaprofil = (f1tu - f_1tu) / (2 * del_delta)

    del f1tu, f_1tu, dum, tau, int_profile, sigma

    Nhr = 10000000
    R = temps.shape[0]

    dum1 = pres < 0.001
    dum2 = (pres >= 0.001) & (pres < 0.002)
    dum3 = (pres >= 0.002) & (pres < 0.004)
    dum4 = (pres >= 0.004) & (pres < 0.006)
    dum5 = (pres >= 0.006) & (pres < 0.008)
    dum6 = (pres >= 0.008) & (pres < 0.01)
    dum7 = pres >= 0.01
    
    Kt = (
        dum1 * 1.00
        + dum2 * 1.28
        + dum3 * 1.78
        + dum4 * 1.57
        + dum5 * 1.43
        + dum6 * 1.28
        + dum7 * 0.85
    )
    Kt= Kt*0 +1.0 # comment this line if you want to account for the precipitaion effect
    Cl0t = 0.06 * np.ones(Kt.shape) * Nhr
    del dum1, dum2, dum3, dum4, dum5, dum6, dum7

    # Placeholder trial timings, zero level, used only to run the 3-year warm-up
    numtr_ls = 2
    lendat = len(dates)
    bounds = np.linspace( 10, lendat - 10 , numtr_ls + 1, dtype=int)
    lstim = np.vstack([
        np.random.randint(bounds[i], bounds[i + 1] , size=R)
        for i in range(numtr_ls)
    ]).astype(float)    
    lslev = np.zeros(lstim.shape)
    
    numtr_is = 2
    bounds = np.linspace( 10, lendat - 10 , numtr_is + 1, dtype=int)
    istim = np.vstack([
        np.random.randint(bounds[i], bounds[i + 1] , size=R)
        for i in range(numtr_is)
    ]).astype(float)    
    islev = np.zeros(istim.shape)

    
    numtr_cl = 1
    bounds = np.linspace( 10, lendat - 10 , numtr_cl + 1, dtype=int)
    taucl = np.vstack([
        np.random.randint(bounds[i], bounds[i + 1] , size=R)
        for i in range(numtr_cl)
    ]).astype(float)    
    alpha = np.zeros(taucl.shape)




    inps = {
        "lstim": lstim, "lslev": lslev,
        "istim": istim, "islev": islev,
        "taucl": taucl, "alpha": alpha,
        "sprofil_lr": sprofil_lr, "drsprofil_lr": drsprofil_lr,
        "sprofil_ins": sprofil_ins, "drsprofil_ins": drsprofil_ins,
        "del_sprofil": del_sprofil,
        "deltaprofil": deltaprofil, "drdeltaprofil": drdeltaprofil,
        "del_delta": del_delta
    }

    inps.update({"temps": temps, "Nhr": Nhr, "R": R, "Cl0t": Cl0t, "Kt": Kt})
    numNMst = 50
    inps['eind'] = np.arange(0, numNMst)
    inps['lind'] = np.arange(inps['eind'][-1] + 1, inps['eind'][-1] + numNMst + 1)
    inps['pind'] = np.arange(inps['lind'][-1] + 1, inps['lind'][-1] + numNMst + 1)
    inps['a1ind'] = np.arange(inps['pind'][-1] + 1, inps['pind'][-1] + numNMst + 1)
    inps['a2ind'] = np.arange(inps['a1ind'][-1] + 1, inps['a1ind'][-1] + numNMst + 1)
    inps['a3ind'] = np.arange(inps['a2ind'][-1] + 1, inps['a2ind'][-1] + numNMst + 1)
    inps['a4ind'] = np.arange(inps['a3ind'][-1] + 1, inps['a3ind'][-1] + numNMst + 1)
    inps['a5ind'] = np.arange(inps['a4ind'][-1] + 1, inps['a4ind'][-1] + numNMst + 1)

    inps['ainds'] = np.hstack([inps['a1ind'], inps['a2ind'], inps['a3ind'], inps['a4ind'], inps['a5ind']])
    inps['a2to5inds'] = np.hstack([inps['a2ind'], inps['a3ind'], inps['a4ind'], inps['a5ind']])
    inps['a1to4inds'] = np.hstack([inps['a1ind'], inps['a2ind'], inps['a3ind'], inps['a4ind']])
    inps['aindsfirst'] = np.hstack([inps['a1ind'][0], inps['a2ind'][0], inps['a3ind'][0], inps['a4ind'][0], inps['a5ind'][0]])
    inps['aindslast'] = np.hstack([inps['a1ind'][-1], inps['a2ind'][-1], inps['a3ind'][-1], inps['a4ind'][-1], inps['a5ind'][-1]])
    inps['Shainds'] = np.hstack([inps['a1ind'][-1], inps['a1ind'][:-1],
                                  inps['a2ind'][-1], inps['a2ind'][:-1],
                                  inps['a3ind'][-1], inps['a3ind'][:-1],
                                  inps['a4ind'][-1], inps['a4ind'][:-1],
                                  inps['a5ind'][-1], inps['a5ind'][:-1]])

    inps['Shainds_bk'] = np.hstack([inps['a1ind'][1:], inps['a1ind'][0],
                                     inps['a2ind'][1:], inps['a2ind'][0],
                                     inps['a3ind'][1:], inps['a3ind'][0],
                                     inps['a4ind'][1:], inps['a4ind'][0],
                                     inps['a5ind'][1:], inps['a5ind'][0]])

    TT = np.arange(-70, 70.5, 0.5)
    inps.update({'rates': calculate_rates_AEDES_AEGYPTI(TT, numNMst)})

    # Initial conditions and solver setup - 3-year warm-up run, no controls
    y0 = np.zeros((R, 8 * numNMst))
    y0[np.arange(R), ] = (10 / 50) * (Nhr / 1000)
    y0 = y0.ravel()

    tspan = np.arange(0.1, len(dates), 0.1)
    options = {'rtol': 1e-4}
    inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
    solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                          args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
    t = solution.t
    y = solution.y

    #####################################################################################################################
    lendat = len(dates)
    stdum = len(dates) - (len(simulation_dates) + 1)
    endum = lendat
    dates = dates[stdum:endum]
    lendat = len(dates)
    y0 = np.ascontiguousarray(y[:, int(np.where(np.isclose(t, stdum + 0.1, atol=1e-6))[0][0])])
    tspan = np.round(np.arange(0.2, lendat - 0.1, 0.1), 1)
    temps = temps[:, stdum:endum]
    pres = pres[:, stdum:endum]
    Cl0t = Cl0t[:, stdum:endum]
    Kt = Kt[:, stdum:endum]
    inps.update(Cl0t=Cl0t, Kt=Kt, temps=temps)

    #####################################################################################################################
    # Build the fixed application schedule from the user-supplied calendar dates
    d = pd.to_datetime(dates).date

    idx = np.where(np.isin(d, larvicide_targets))[0]
    numtr_ls = len(idx)
    lstim = idx.astype(float).reshape(-1, 1)
    lslev = np.zeros(lstim.shape)
    lslev[0:numtr_ls, 0:R] = ls_ef

    idx = np.where(np.isin(d, insecticide_targets))[0]
    numtr_is = len(idx)
    istim = idx.astype(float).reshape(-1, 1)
    islev = np.zeros(istim.shape)
    islev[0:numtr_is, 0:R] = is_ef

    idx = np.where(np.isin(d, habitat_targets))[0]
    numtr_cl = len(idx)
    taucl = idx.astype(float).reshape(-1, 1)
    alpha1 = np.mean(Cl0t[0, :]) / Nhr * cl_ef
    alpha = np.zeros(taucl.shape)
    alpha[0:numtr_cl, 0:R] = alpha1

    inps['lstim'] = lstim
    inps['istim'] = istim
    inps['taucl'] = taucl

    # Baseline run: no controls applied
    inps['lslev'] = 0.0 * lslev
    inps['islev'] = 0.0 * islev
    inps['alpha'] = 0.0 * alpha
    inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
    solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                          args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
    t = solution.t
    y = solution.y

    initial = {}
    initial['a'] = np.sum(y[inps['ainds'], ], axis=0)
    initial['l'] = np.sum(y[inps['lind'], ], axis=0)
    initial['e'] = np.sum(y[inps['eind'], ], axis=0)

    Tm = inps['temps'][0, np.floor(t).astype(int)]
    dum = ((Tm + 70) / 0.5)
    ind = np.floor(dum).astype(np.int32)
    dum = dum - ind
    gamadRisk = inps['rates'][7, ind] * (1 - dum) + inps['rates'][7, ind + 1] * (dum)
    gamaeRisk = inps['rates'][9, ind] * (1 - dum) + inps['rates'][9, ind + 1] * (dum)
    BC = (inps['rates'][11, ind] * (1 - dum) + inps['rates'][11, ind + 1] * (dum)) * (inps['rates'][12, ind] * (1 - dum) + inps['rates'][12, ind + 1] * (dum))
    gamaV = inps['rates'][13, ind] * (1 - dum) + inps['rates'][13, ind + 1] * (dum)
    Biti = 0.8
    sigh = 1 / 4
    initial['risk'] = ((((Biti * gamaeRisk) ** 2) * BC) / (sigh * gamadRisk * (1 + gamadRisk / gamaV))) * (initial['a'] / Nhr)

    # After-control run: larvicide, insecticide and habitat elimination all applied together
    inps['lslev'] = lslev
    inps['islev'] = islev
    inps['alpha'] = alpha
    inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
    solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                          args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
    y = solution.y

    final = {}
    final['a'] = np.sum(y[inps['ainds'], ], axis=0)
    final['l'] = np.sum(y[inps['lind'], ], axis=0)
    final['e'] = np.sum(y[inps['eind'], ], axis=0)
    final['risk'] = ((((Biti * gamaeRisk) ** 2) * BC) / (sigh * gamadRisk * (1 + gamadRisk / gamaV))) * (final['a'] / Nhr)

    datels = np.sort(dates[np.round(lstim).astype(np.int32)])
    dateis = np.sort(dates[np.round(istim).astype(np.int32)])
    datetau = np.sort(dates[np.round(taucl).astype(np.int32)])

    inddtints = np.searchsorted(tspan, np.arange(1, len(dates), 1))
    ain = pd.Series(initial['a']).rolling(window=7, center=True).mean()
    lin = pd.Series(initial['l']).rolling(window=7, center=True).mean()
    ein = pd.Series(initial['e']).rolling(window=7, center=True).mean()
    riskin = pd.Series(initial['risk']).rolling(window=7, center=True).mean()

    af = pd.Series(final['a']).rolling(window=7, center=True).mean()
    lf = pd.Series(final['l']).rolling(window=7, center=True).mean()
    ef = pd.Series(final['e']).rolling(window=7, center=True).mean()
    riskf = pd.Series(final['risk']).rolling(window=7, center=True).mean()

    pref = adsave
    os.makedirs(pref, exist_ok=True)

    out = riskf[inddtints]
    np.savetxt(os.path.join(pref, 'risk_after.txt'), out, delimiter=' ')
    out = riskin[inddtints]
    np.savetxt(os.path.join(pref, 'risk_before.txt'), out, delimiter=' ')

    out = af[inddtints]
    np.savetxt(os.path.join(pref, 'population_after.txt'), out, delimiter=' ')
    out = ain[inddtints]
    np.savetxt(os.path.join(pref, 'population_before.txt'), out, delimiter=' ')

    out = lf[inddtints]
    np.savetxt(os.path.join(pref, 'larvae_after.txt'), out, delimiter=' ')
    out = lin[inddtints]
    np.savetxt(os.path.join(pref, 'larvae_before.txt'), out, delimiter=' ')

    out = (dates[np.arange(1, len(dates), 1)]).astype('datetime64[D]')
    np.savetxt(os.path.join(pref, 'dates.txt'), out.astype(str), fmt='%s', delimiter=' ')

    out = datels.astype('datetime64[D]')
    np.savetxt(os.path.join(pref, 'larvicide_application_dates.txt'), out.astype(str), fmt='%s', delimiter=' ')
    out = dateis.astype('datetime64[D]')
    np.savetxt(os.path.join(pref, 'insecticide_application_dates.txt'), out.astype(str), fmt='%s', delimiter=' ')
    out = datetau.astype('datetime64[D]')
    np.savetxt(os.path.join(pref, 'habitat_removal_application_dates.txt'), out.astype(str), fmt='%s', delimiter=' ')

    run_metadata = {
        "schema_version": 1,
        "run_type": "fixed_schedule",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "date_source": date_source,
        "simulation_start": simulation_dates[0].date().isoformat(),
        "simulation_end": simulation_dates[-1].date().isoformat(),
        "simulation_year": int(simulation_dates[0].year),
        "location": {"latitude": latitude, "longitude": longitude},
        "treatments": {
            "larvicide": {
                "duration_days": len_lr,
                "efficiency": ls_ef,
                "application_count": int(len(datels)),
            },
            "insecticide": {
                "duration_days": len_ins,
                "efficiency": is_ef,
                "application_count": int(len(dateis)),
            },
            "habitat": {
                "duration_days": len_cr,
                "efficiency": cl_ef,
                "application_count": int(len(datetau)),
            },
        },
        "inputs": {"temperature": adtemp, "precipitation": adpre},
    }
    with open(os.path.join(pref, "run_metadata.json"), "w", encoding="utf-8") as metadata_file:
        json.dump(run_metadata, metadata_file, indent=2)
