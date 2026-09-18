# -*- coding: utf-8 -*-

import json
import numpy as np
import pandas as pd
from scipy.integrate import solve_ivp
from datetime import datetime
import time
import os
from MosquitoRates import calculate_rates_AEDES_AEGYPTI
from Dif_functions import prepare_inputs2, odeforward_AEDES_AEGYPTI, odebackward_AEDES_AEGYPTI, dfdci_AEDES_AEGYPTI
from LocationSeriesInput import climate_uses_csv, load_climate_inputs, map_annual_series


def Optimize_AEDES_AEGYPTI(
        longitude='-80.26',
        latitude='25.84',
        len_ins='2',
        len_lr='20',
        len_cr='40',
        numtrls='2',
        ls_ef='0.8',
        numtris='2',
        is_ef='0.2',
        numtrcl='2',
        cl_ef='0.5',
        adtemp='temp_2023_daily_average_py.mat',
        adpre='pre_pastyearsav_py.mat',
        adsave="Aedes_Aegypti",
):

    # Convert inputs to appropriate types
    longitude = float(longitude)
    latitude = float(latitude)
    len_ins = float(len_ins)
    len_lr = float(len_lr)
    len_cr = float(len_cr)
    numtrls = int(numtrls)
    ls_ef = float(ls_ef)
    numtris = int(numtris)
    is_ef = float(is_ef)
    numtrcl = int(numtrcl)
    cl_ef = float(cl_ef)
    
    if (numtrls==0) or (len_lr==0):
        numtrls=1
        len_lr=5
        ls_ef=0
        
    if (numtris==0) or (len_ins==0):
        numtris=1
        len_ins=5
        is_ef=0 
        
    if (numtrcl==0) or (len_cr==0):
        numtrcl=1
        len_cr=5
        cl_ef=0         
        
        
    # Resolve the calendar once, before any model preparation. CSV inputs use
    # their own full calendar year; undated MATLAB climatology uses this year.
    target_year = None if climate_uses_csv(adtemp, adpre) else datetime.today().year
    simulation_dates, annual_temp, annual_pre, date_source = load_climate_inputs(
        adtemp, adpre, longitude, latitude, target_year=target_year
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

    prlrn = 10
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

    # Delta profile 
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
    inps['eind'] = np.arange(0, numNMst)  # 1 to 50
    inps['lind'] = np.arange(inps['eind'][-1] + 1, inps['eind'][-1] + numNMst + 1)  # Last of eind + 1 to Last of eind + 50
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

    # Initial conditions and solver setup
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

    #######################
    Nep = 600

    # Previous initialization (kept for reference): split the year into equal
    # sections and draw one treatment time from each section.
    #
    # numtr_ls = numtrls
    # bounds = np.linspace(10, lendat - 10, numtr_ls + 1, dtype=int)
    # lstim = np.vstack([
    #     np.random.randint(bounds[i], bounds[i + 1], size=R)
    #     for i in range(numtr_ls)
    # ]).astype(float)
    # lslev = np.full_like(lstim, ls_ef)
    #
    # numtr_is = numtris
    # bounds = np.linspace(10, lendat - 10, numtr_is + 1, dtype=int)
    # istim = np.vstack([
    #     np.random.randint(bounds[i], bounds[i + 1], size=R)
    #     for i in range(numtr_is)
    # ]).astype(float)
    # islev = np.full_like(istim, is_ef)
    #
    # numtr_cl = numtrcl
    # bounds = np.linspace(10, lendat - 10, numtr_cl + 1, dtype=int)
    # taucl = np.vstack([
    #     np.random.randint(bounds[i], bounds[i + 1], size=R)
    #     for i in range(numtr_cl)
    # ]).astype(float)
    # alpha1 = np.mean(Cl0t[0, :]) / Nhr * cl_ef
    # alpha = np.zeros(taucl.shape)
    # alpha[0:numtrcl, 0:R] = alpha1

    # New initialization: find the uncontrolled adult-mosquito peak in the
    # simulation-year portion of the warm-up solution, then initialize every
    # treatment randomly within 90 days before or after that peak.
    target_time_mask = (t >= stdum + 1) & (t <= stdum + len(simulation_dates))
    target_time_indices = np.flatnonzero(target_time_mask)
    if target_time_indices.size == 0:
        raise RuntimeError("Could not locate the simulation year in the warm-up solution.")

    state_count = y.shape[0] // R
    warmup_adults = np.zeros(target_time_indices.size)
    for rr in range(R):
        adult_rows = inps['ainds'] + rr * state_count
        warmup_adults += np.sum(y[np.ix_(adult_rows, target_time_indices)], axis=0)
    warmup_adults /= R

    peak_time = t[target_time_indices[int(np.nanargmax(warmup_adults))]]
    peak_day = int(np.clip(np.rint(peak_time - stdum), 1, lendat - 1))
    peak_date = pd.Timestamp(dates[peak_day])
    initialization_start = max(1, peak_day - 120)
    initialization_end = min(lendat - 1, peak_day + 60)
    initialization_days = np.arange(initialization_start, initialization_end + 1, dtype=int)

    def random_times_near_peak(number_of_treatments):
        result = np.empty((number_of_treatments, R), dtype=float)
        for rr in range(R):
            result[:, rr] = np.sort(
                np.random.choice(initialization_days, size=number_of_treatments, replace=True)
            )
        return result

    numtr_ls = numtrls
    lstim = random_times_near_peak(numtr_ls)
    lslev = np.full_like(lstim, ls_ef)

    numtr_is = numtris
    istim = random_times_near_peak(numtr_is)
    islev = np.full_like(istim, is_ef)

    numtr_cl = numtrcl
    taucl = random_times_near_peak(numtr_cl)
    alpha1 = np.mean(Cl0t[0, :]) / Nhr * cl_ef
    alpha = np.full_like(taucl, alpha1)

    lstimep = np.zeros((numtr_ls, R, Nep + 1))
    lstimep[:, :, 0] = lstim
    istimep = np.zeros((numtr_is, R, Nep + 1))
    istimep[:, :, 0] = istim
    tauclep = np.zeros((numtr_cl, R, Nep + 1))
    tauclep[:, :, 0] = taucl

    valtomin = np.zeros((Nep + 1, R))

    # Initialize dFdt arrays as 2D arrays
    dFdtls = np.zeros((numtr_ls, R))
    dFdtlsmov = np.zeros((numtr_ls, R))
    dFdtlsSQmov = np.zeros((numtr_ls, R))

    dFdtis = np.zeros((numtr_is, R))
    dFdtismov = np.zeros((numtr_is, R))
    dFdtisSQmov = np.zeros((numtr_is, R))

    dFdtau = np.zeros((numtr_cl, R))
    dFdtaumov = np.zeros((numtr_cl, R))
    dFdtauSQmov = np.zeros((numtr_cl, R))

    inps['a'] = np.zeros((len(tspan), R))
    inps['l'] = np.zeros((len(tspan), R))
    inps['en'] = np.zeros((len(tspan), R))

    for ep in range(Nep):
        start_time = time.time()

        inps['lstim'] = lstimep[:, :, ep]
        inps['istim'] = istimep[:, :, ep]
        inps['lslev'] = lslev
        inps['islev'] = islev
        inps['taucl'] = tauclep[:, :, ep]
        inps['alpha'] = alpha

        inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
        solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                              args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
        t = solution.t
        y = solution.y

        mxin = round(y.shape[0] / R)
        for rr in range(R):
            ofs = rr * mxin
            inps['a'][:, rr] = np.sum(y[inps['ainds'] + ofs, ], axis=0)
            inps['l'][:, rr] = np.sum(y[inps['lind'] + ofs, ], axis=0)
            inps['en'][:, rr] = np.sum(y[inps['eind'][-1:] + ofs, ], axis=0)

        inps['weis'] = np.ones(R)
        inps['t0el'] = tspan[0]
        inps['deltel'] = np.round(tspan[1] - tspan[0], 1)
        tauspan = np.round(lendat - tspan[::-1], 1)
        tauspan[0] = tauspan[0] + 0.01
        tauspan[-1] = tauspan[-1] - 0.01
        inps['ff'] = float(lendat)
        inps['mode'] = 1

        inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
        lam0 = np.zeros(y0.shape)

        solution = solve_ivp(odebackward_AEDES_AEGYPTI, [tauspan[0], tauspan[-1]], lam0, method='RK45', t_eval=tauspan,
                              args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
        tau = solution.t
        lam = solution.y
        lam = lam / Nhr

        Tm = (inps['temps'][:, np.floor(t).astype(int)]).T
        dum = ((Tm + 70) / 0.5)
        ind = np.floor(dum).astype(np.int32)
        dum = dum - ind

        gamadRisk = inps['rates'][7, ind] * (1 - dum) + inps['rates'][7, ind + 1] * (dum)
        gamaeRisk = inps['rates'][9, ind] * (1 - dum) + inps['rates'][9, ind + 1] * (dum)
        BC = (inps['rates'][11, ind] * (1 - dum) + inps['rates'][11, ind + 1] * (dum)) * (inps['rates'][12, ind] * (1 - dum) + inps['rates'][12, ind + 1] * (dum))
        gamaV = inps['rates'][13, ind] * (1 - dum) + inps['rates'][13, ind + 1] * (dum)
        Biti = 0.8
        sigh = 1 / 4
        R0 = (inps['a'] / Nhr) * (((Biti * gamaeRisk) ** 2) * BC) / (sigh * gamadRisk * (1 + gamadRisk / gamaV))

        valtomin[ep, :] = np.mean(R0, axis=0)

        dfdldrt, dfdadrt, dfdalph_kt = dfdci_AEDES_AEGYPTI(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f, lam, y, tspan, mxin)

        for num in range(numtr_ls):
            tuc = lstimep[num, :, ep]
            tuc = tuc[:, None]
            inrw = ((tspan - tuc) / del_sprofil)
            ind = np.maximum(0, np.floor(inrw).astype(np.int32))
            dum = np.maximum(0, inrw - ind)
            dum2 = ((1 - dum) * drsprofil_lr[ind] + dum * drsprofil_lr[ind + 1]) * dfdldrt
            dFdtls[num, :] = np.sum(dum2[:, 1:] + dum2[:, :-1], axis=1) * (inps['deltel'] * lslev[num, ] * 0.5)

        for num in range(numtr_is):
            tuc = istimep[num, :, ep]
            tuc = tuc[:, None]
            inrw = ((tspan - tuc) / del_sprofil)
            ind = np.maximum(0, np.floor(inrw).astype(np.int32))
            dum = np.maximum(0, inrw - ind)
            dum2 = ((1 - dum) * drsprofil_ins[ind] + dum * drsprofil_ins[ind + 1]) * dfdadrt
            dFdtis[num, :] = np.sum(dum2[:, 1:] + dum2[:, :-1], axis=1) * (inps['deltel'] * islev[num, ] * 0.5)

        for num in range(numtr_cl):
            tuc = tauclep[num, :, ep]
            tuc = tuc[:, None]
            inrw = ((tspan - tuc) / del_delta)
            ind = np.maximum(0, np.floor(inrw).astype(np.int32))
            dum = np.maximum(0, inrw - ind)
            dum2 = -((1 - dum) * drdeltaprofil[ind] + dum * drdeltaprofil[ind + 1]) * dfdalph_kt
            dFdtau[num, :] = np.sum(dum2[:, 1:] + dum2[:, :-1], axis=1) * (inps['deltel'] * alpha[num, ] * Nhr * 0.5)

        ##########################################################
        if ep < 100:
            fr1 = (ep) / (ep + 1)
            fr2 = fr1
        else:
            fr1 = 0.99
            fr2 = 0.99

        dFdtlsmov = fr1 * dFdtlsmov + (1 - fr1) * dFdtls
        dFdtlsSQmov = fr2 * dFdtlsSQmov + (1 - fr2) * (dFdtls) ** 2

        dFdtismov = fr1 * dFdtismov + (1 - fr1) * dFdtis
        dFdtisSQmov = fr2 * dFdtisSQmov + (1 - fr2) * (dFdtis) ** 2

        dFdtaumov = fr1 * dFdtaumov + (1 - fr1) * dFdtau
        dFdtauSQmov = fr2 * dFdtauSQmov + (1 - fr2) * (dFdtau) ** 2

        lr = 1

        delttls = lr * dFdtlsmov / (np.sqrt(dFdtlsSQmov) + 1e-12)
        delttis = lr * dFdtismov / (np.sqrt(dFdtisSQmov) + 1e-12)
        delttau = lr * dFdtaumov / (np.sqrt(dFdtauSQmov) + 1e-12)

        lstimep[:, :, ep + 1] = np.minimum(lendat - 1, np.maximum(lstimep[:, :, ep] - delttls, 1))
        istimep[:, :, ep + 1] = np.minimum(lendat - 1, np.maximum(istimep[:, :, ep] - delttis, 1))
        tauclep[:, :, ep + 1] = np.minimum(lendat - 1, np.maximum(tauclep[:, :, ep] - delttau, 1))

        end_time = time.time()

        print(f"time and epoch : {end_time - start_time} and {ep}")
        print(f"valtomin: {np.mean(valtomin[ep, :])}")

        ########################################################################################

    arr = valtomin[0:-1, 0:R]

    min_value = np.min(arr)
    min_index = np.unravel_index(np.argmin(arr), arr.shape)

    inps['lstim'] = lstimep[:, :, min_index[0]]
    inps['istim'] = istimep[:, :, min_index[0]]
    inps['taucl'] = tauclep[:, :, min_index[0]]
    inps['lslev'] = 0.0 * lslev
    inps['islev'] = 0.0 * islev
    inps['alpha'] = 0.0 * alpha
    inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
    solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                          args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
    t = solution.t
    y = solution.y
    mxin = round(y.shape[0] / R)

    ofs1 = min_index[1] * mxin
    initial = {}
    initial['a'] = np.sum(y[inps['ainds'] + ofs1, ], axis=0)
    initial['l'] = np.sum(y[inps['lind'] + ofs1, ], axis=0)
    initial['e'] = np.sum(y[inps['eind'] + ofs1, ], axis=0)

    Tm = inps['temps'][min_index[1], np.floor(t).astype(int)]
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

    inps['lslev'] = lslev
    inps['islev'] = islev
    inps['alpha'] = alpha
    inps0i, inps0f, inps1i, inps1f, inps2i, inps2f = prepare_inputs2(inps)
    solution = solve_ivp(odeforward_AEDES_AEGYPTI, [tspan[0], tspan[-1]], y0, method='RK45', t_eval=tspan,
                          args=(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f), **options)
    y = solution.y

    final = {}
    final['a'] = np.sum(y[inps['ainds'] + ofs1, ], axis=0)
    final['l'] = np.sum(y[inps['lind'] + ofs1, ], axis=0)
    final['e'] = np.sum(y[inps['eind'] + ofs1, ], axis=0)
    final['risk'] = ((((Biti * gamaeRisk) ** 2) * BC) / (sigh * gamadRisk * (1 + gamadRisk / gamaV))) * (final['a'] / Nhr)

    datels = np.sort(dates[np.round(lstimep[0:numtrls, min_index[1], min_index[0]]).astype(np.int32)])
    dateis = np.sort(dates[np.round(istimep[0:numtris, min_index[1], min_index[0]]).astype(np.int32)])
    datetau = np.sort(dates[np.round(tauclep[0:numtrcl, min_index[1], min_index[0]]).astype(np.int32)])

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

    out = arr[:, min_index[1]]
    np.savetxt(os.path.join(pref, 'optimization_convergence.txt'), out, delimiter=' ')

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
        "run_type": "optimization",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "date_source": date_source,
        "simulation_start": simulation_dates[0].date().isoformat(),
        "simulation_end": simulation_dates[-1].date().isoformat(),
        "simulation_year": int(simulation_dates[0].year),
        "treatment_initialization": {
            "basis": "uncontrolled_warmup_adult_population_peak",
            "peak_date": peak_date.date().isoformat(),
            "window_start": pd.Timestamp(dates[initialization_start]).date().isoformat(),
            "window_end": pd.Timestamp(dates[initialization_end]).date().isoformat(),
            "window_radius_days": 90,
        },
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
