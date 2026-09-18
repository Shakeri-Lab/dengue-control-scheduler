import numpy as np
from numba import types
from numba.typed import Dict
from numba import njit


def prepare_inputs2(inps):
    """
    Convert a Python dict into Numba-typed dicts, forcing:
      - all ints -> int32
      - all floats -> float64
    """

    numba_int_scalars = Dict.empty(types.unicode_type, types.int32)
    numba_float_scalars = Dict.empty(types.unicode_type, types.float64)

    numba_int_1d_arrays = Dict.empty(types.unicode_type, types.int32[:])
    numba_float_1d_arrays = Dict.empty(types.unicode_type, types.float64[:])

    numba_int_2d_arrays = Dict.empty(types.unicode_type, types.int32[:, :])
    numba_float_2d_arrays = Dict.empty(types.unicode_type, types.float64[:, :])

    for key, value in inps.items():
        # Scalars
        if np.isscalar(value):
            if isinstance(value, (np.floating, float)):
                numba_float_scalars[key] = np.float64(value)
            elif isinstance(value, (np.integer, int)):
                numba_int_scalars[key] = np.int32(value)
            else:
                raise ValueError(f"Unsupported scalar type for key '{key}': {type(value)}")
            continue

        # Arrays
        arr = np.asarray(value)
        if arr.ndim not in (1, 2):
            raise ValueError(f"Only 1D/2D arrays supported for key '{key}', got ndim={arr.ndim}")

        if np.issubdtype(arr.dtype, np.integer):
            arr = np.ascontiguousarray(arr.astype(np.int32, copy=False))
            if arr.ndim == 1:
                numba_int_1d_arrays[key] = arr
            else:
                numba_int_2d_arrays[key] = arr

        elif np.issubdtype(arr.dtype, np.floating):
            arr = np.ascontiguousarray(arr.astype(np.float64, copy=False))
            if arr.ndim == 1:
                numba_float_1d_arrays[key] = arr
            else:
                numba_float_2d_arrays[key] = arr
        else:
            raise ValueError(f"Unsupported array dtype for key '{key}': {arr.dtype}")

    return (numba_int_scalars, numba_float_scalars,
            numba_int_1d_arrays, numba_float_1d_arrays,
            numba_int_2d_arrays, numba_float_2d_arrays)


@njit
def odeforward_AEDES_AEGYPTI(t, y, inps0i, inps0f, inps1i, inps1f, inps2i, inps2f):

    R = int(inps0i['R'])
    flrt = int(np.floor(t))

    Kt = inps2f['Kt'][:, flrt]

    Cl0t = inps2f['Cl0t']
    if Cl0t.shape[1] > 1:
        Cl0t = Cl0t[:, flrt]
    else:
        Cl0t = Cl0t[:, 0]

    del_delta = inps0f['del_delta']
    taucl = inps2f['taucl']
    shsh = taucl.shape
    taucl = np.ascontiguousarray(taucl).ravel()
    inrw = (t - taucl) / del_delta
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    alpha = np.ascontiguousarray(inps2f['alpha']).ravel()
    Clt = inps0i['Nhr'] * alpha * (
        (1 - dum) * inps1f['deltaprofil'][ind] + dum * inps1f['deltaprofil'][ind + 1]
    )
    Clt = Clt.reshape(shsh)
    Clt = np.sum(Clt, axis=0)
    Clt = np.maximum(Cl0t - Clt, 0) * Kt

    del_sprofil = inps0f['del_sprofil']
    istim = inps2f['istim']
    shsh = istim.shape
    istim = np.ascontiguousarray(istim).ravel()
    inrw = (t - istim) / del_sprofil
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    islev = np.ascontiguousarray(inps2f['islev']).ravel()
    isdr = islev * (
        (1 - dum) * inps1f['sprofil_ins'][ind] + dum * inps1f['sprofil_ins'][ind + 1]
    )
    isdr = isdr.reshape(shsh)
    isdr = np.sum(isdr, axis=0)

    lstim = inps2f['lstim']
    shsh = lstim.shape
    lstim = np.ascontiguousarray(lstim).ravel()
    inrw = (t - lstim) / del_sprofil
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    lslev = np.ascontiguousarray(inps2f['lslev']).ravel()
    lsdr = lslev * (
        (1 - dum) * inps1f['sprofil_lr'][ind] + dum * inps1f['sprofil_lr'][ind + 1]
    )
    lsdr = lsdr.reshape(shsh)
    lsdr = np.sum(lsdr, axis=0)

    # Rates
    Tm = inps2f['temps'][:, flrt]
    dum = ((Tm + 70) / 0.5)
    ind = np.floor(dum).astype(np.int32)
    dum = dum - ind
    rates = inps2f['rates'][:, ind] * (1 - dum) + inps2f['rates'][:, ind + 1] * (dum)

    y = y.reshape(R, -1).T

    lt = np.sum(y[inps1i['lind'], :], axis=0)
    dum = (Clt != 0)
    kcof = 2.5
    kk = np.zeros(R)
    kk[dum] = 1.0 / (1 + np.exp(2 * kcof * ((lt[dum] / Clt[dum]) - 0.5)))

    dydt = np.zeros(y.shape, float)

    dydt[inps1i['lind'], :] = -(rates[2, :] + rates[3, :] + lsdr) * y[inps1i['lind'], :]
    dydt[inps1i['lind'][1:], :] = dydt[inps1i['lind'][1:], :] + rates[2, :] * y[inps1i['lind'][:-1], :]
    dydt[inps1i['lind'][0], :] = dydt[inps1i['lind'][0], :] + (rates[0, :] * kk) * y[inps1i['eind'][-1], :]

    dydt[inps1i['pind'], :] = -(rates[4, :] + rates[5, :]) * y[inps1i['pind'], :]
    dydt[inps1i['pind'][1:], :] = dydt[inps1i['pind'][1:], :] + rates[4, :] * y[inps1i['pind'][:-1], :]
    dydt[inps1i['pind'][0], :] = dydt[inps1i['pind'][0], :] + rates[2, :] * y[inps1i['lind'][-1], :]

    decay = rates[8, :] + rates[6, :] + isdr

    dydt[inps1i['ainds'], :] = rates[8, :] * y[inps1i['Shainds'], :] - decay * y[inps1i['ainds'], :]
    dydt[inps1i['a1ind'][0], :] = dydt[inps1i['a1ind'][0], :] + 0.5 * rates[4, :] * y[inps1i['pind'][-1], :]
    dydt[inps1i['a2to5inds'], :] = dydt[inps1i['a2to5inds'], :] + rates[6, :] * y[inps1i['a1to4inds'], :]

    dydt[inps1i['eind'], :] = -(rates[0, :] + rates[1, :]) * y[inps1i['eind'], :]
    dydt[inps1i['eind'][1:], :] = dydt[inps1i['eind'][1:], :] + rates[0, :] * y[inps1i['eind'][:-1], :]
    dydt[inps1i['eind'][0], :] = dydt[inps1i['eind'][0], :] + (rates[8, :] * rates[10, :]) * np.sum(y[inps1i['aindslast'], :], axis=0)

    test = dydt.T.ravel()
    return test


@njit
def odebackward_AEDES_AEGYPTI(t, y, inps0i, inps0f, inps1i, inps1f, inps2i, inps2f):

    ff = inps0f['ff']
    tre = ff - t
    flrt = int(np.floor(tre))
    R = int(inps0i['R'])

    t0el = inps0f['t0el']
    deltel = inps0f['deltel']

    inrw = (tre - t0el) / deltel
    ind = np.maximum(0, int(np.floor(inrw)))
    dum = np.maximum(0, inrw - ind)
    et = (1 - dum) * inps2f['en'][ind, :] + dum * inps2f['en'][ind + 1, :]
    lt = (1 - dum) * inps2f['l'][ind, :] + dum * inps2f['l'][ind + 1, :]

    del_sprofil = inps0f['del_sprofil']

    istim = inps2f['istim']
    shsh = istim.shape
    istim = np.ascontiguousarray(istim).ravel()
    inrw = (tre - istim) / del_sprofil
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    islev = np.ascontiguousarray(inps2f['islev']).ravel()
    isdr = islev * (
        (1 - dum) * inps1f['sprofil_ins'][ind] + dum * inps1f['sprofil_ins'][ind + 1]
    )
    isdr = isdr.reshape(shsh)
    isdr = np.sum(isdr, axis=0)

    lstim = inps2f['lstim']
    shsh = lstim.shape
    lstim = np.ascontiguousarray(lstim).ravel()
    inrw = (tre - lstim) / del_sprofil
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    lslev = np.ascontiguousarray(inps2f['lslev']).ravel()
    lsdr = lslev * (
        (1 - dum) * inps1f['sprofil_lr'][ind] + dum * inps1f['sprofil_lr'][ind + 1]
    )
    lsdr = lsdr.reshape(shsh)
    lsdr = np.sum(lsdr, axis=0)

    Kt = inps2f['Kt'][:, flrt]

    Cl0t = inps2f['Cl0t']
    if Cl0t.shape[1] > 1:
        Cl0t = Cl0t[:, flrt]
    else:
        Cl0t = Cl0t[:, 0]

    del_delta = inps0f['del_delta']

    taucl = inps2f['taucl']
    shsh = taucl.shape
    taucl = np.ascontiguousarray(taucl).ravel()
    inrw = (tre - taucl) / del_delta
    ind = np.maximum(0, np.floor(inrw).astype(np.int32))
    dum = np.maximum(0, inrw - ind)
    alpha = np.ascontiguousarray(inps2f['alpha']).ravel()
    Clt = inps0i['Nhr'] * alpha * (
        (1 - dum) * inps1f['deltaprofil'][ind] + dum * inps1f['deltaprofil'][ind + 1]
    )
    Clt = Clt.reshape(shsh)
    Clt = np.sum(Clt, axis=0)
    Clt = np.maximum(Cl0t - Clt, 0) * Kt

    Tm = inps2f['temps'][:, flrt]
    dum = ((Tm + 70) / 0.5)
    ind = np.floor(dum).astype(np.int32)
    dum = dum - ind
    rates = inps2f['rates'][:, ind] * (1 - dum) + inps2f['rates'][:, ind + 1] * (dum)

    dum = (Clt != 0)
    kcof = 2.5
    jdum = 1.0 / (1 + np.exp(2 * kcof * ((lt[dum] / Clt[dum]) - 0.5)))
    neg_djdum_dcldum = 2 * kcof * ((jdum * (1 - jdum)) / Clt[dum])
    rrr = np.zeros(R)
    rrr[dum] = neg_djdum_dcldum
    rr = np.zeros(R)
    rr[dum] = jdum

    y = y.reshape(R, -1).T
    dydt = np.zeros(y.shape, float)
    rrr = rrr * et * rates[0, :] * y[inps1i['lind'][0], :]

    dydt[inps1i['lind'], :] = -(rates[2, :] + rates[3, :] + lsdr) * y[inps1i['lind'], :] - rrr
    dydt[inps1i['lind'][:-1], :] = dydt[inps1i['lind'][:-1], :] + rates[2, :] * y[inps1i['lind'][1:], :]
    dydt[inps1i['lind'][-1], :] = dydt[inps1i['lind'][-1], :] + rates[2, :] * y[inps1i['pind'][0], :]

    dydt[inps1i['pind'], :] = -(rates[4, :] + rates[5, :]) * y[inps1i['pind'], :]
    dydt[inps1i['pind'][:-1], :] = dydt[inps1i['pind'][:-1], :] + rates[4, :] * y[inps1i['pind'][1:], :]
    dydt[inps1i['pind'][-1], :] = dydt[inps1i['pind'][-1], :] + 0.5 * rates[4, :] * y[inps1i['a1ind'][0], :]

    decay = rates[8, :] + rates[6, :] + isdr
    dydt[inps1i['ainds'], :] = rates[8, :] * y[inps1i['Shainds_bk'], :] - decay * y[inps1i['ainds'], :]

    dydt[inps1i['a1to4inds'], :] = dydt[inps1i['a1to4inds'], :] + rates[6, :] * y[inps1i['a2to5inds'], :]
    dydt[inps1i['aindslast'], :] = dydt[inps1i['aindslast'], :] + (rates[8, :] * rates[10, :]) * y[inps1i['eind'][0], :]

    dydt[inps1i['eind'], :] = -(rates[0, :] + rates[1, :]) * y[inps1i['eind'], :]
    dydt[inps1i['eind'][:-1], :] = dydt[inps1i['eind'][:-1], :] + rates[0, :] * y[inps1i['eind'][1:], :]
    dydt[inps1i['eind'][-1], :] = dydt[inps1i['eind'][-1], :] + rr * rates[0, :] * y[inps1i['lind'][0], :]

    if inps0i['mode'] == 1:

        Biti = 0.8
        sigh = 1 / 4
        R0ova_N = (((Biti * rates[9, ]) ** 2) * rates[11, ] * rates[12, ]) / (sigh * rates[7, ] * (1 + rates[7, ] / rates[13, ]))
        duds = (R0ova_N > 0) * inps1f['weis']
        dydt[inps1i['ainds'], :] = dydt[inps1i['ainds'], :] - R0ova_N * duds

    elif inps0i['mode'] == 2:

        dydt[inps1i['ainds'], :] = dydt[inps1i['ainds'], :] - inps1f['weis']

    test = dydt.T.ravel()
    return test


def dfdci_AEDES_AEGYPTI(inps0i, inps0f, inps1i, inps1f, inps2i, inps2f, lam, y, tspan, mxin):

    lam_t = lam[:, ::-1]

    R = inps0i['R']
    dum = lam.shape[1]
    dfdadrt = np.zeros((R, dum))
    dfdldrt = np.zeros((R, dum))
    laml11 = np.zeros((R, dum))
    eend = np.zeros((R, dum))
    L = np.zeros((R, dum))

    for rr in range(R):
        ofs = rr * mxin
        dfdadrt[rr, :] = np.sum(lam_t[inps1i['ainds'] + ofs, ] * y[inps1i['ainds'] + ofs, ], axis=0)
        dfdldrt[rr, :] = np.sum(lam_t[inps1i['lind'] + ofs, ] * y[inps1i['lind'] + ofs, ], axis=0)

        laml11[rr, :] = lam_t[inps1i['lind'][0] + ofs, ]
        eend[rr, :] = y[inps1i['eind'][-1] + ofs, ]
        L[rr, :] = np.sum(y[inps1i['lind'] + ofs, ], axis=0)

    ########################################################################
    flrt = np.floor(tspan).astype(np.int32)
    Kt = inps2f['Kt'][:, flrt]

    Cl0t = inps2f['Cl0t']
    if Cl0t.shape[1] > 1:
        Cl0t = Cl0t[:, flrt]
    else:
        Cl0t = Cl0t[:, 0:1]

    del_delta = inps0f['del_delta']
    ts = tspan[None, :]
    taucl = inps2f['taucl']
    Clt = 0
    for i in range(taucl.shape[0]):
        tuc = taucl[i, :]
        alpha = inps2f['alpha'][i, ]
        alpha = alpha[:, None]
        tuc = tuc[:, None]
        inrw = ((ts - tuc) / del_delta)
        ind = np.maximum(0, np.floor(inrw).astype(np.int32))
        dum = np.maximum(0, inrw - ind)
        Clt = Clt + inps0i['Nhr'] * alpha * (
            (1 - dum) * inps1f['deltaprofil'][ind] + dum * inps1f['deltaprofil'][ind + 1]
        )

    Clt = np.maximum(Cl0t - Clt, 0) * Kt

    dum = (Clt != 0)
    kcof = 2.5
    jdum = 1.0 / (1 + np.exp(2 * kcof * ((L[dum] / Clt[dum]) - 0.5)))
    djdum_dcldum_e = 2 * kcof * (jdum * (1 - jdum) * L[dum] * eend[dum] / (Clt[dum] ** 2))
    rrr = np.zeros(Clt.shape)
    rrr[dum] = djdum_dcldum_e

    Tm = inps2f['temps'][:, flrt]
    dum = ((Tm + 70) / 0.5)
    ind = np.floor(dum).astype(np.int32)
    dum = dum - ind
    gam_el1 = inps2f['rates'][0, ]
    rates = gam_el1[ind] * (1 - dum) + gam_el1[ind + 1] * (dum)

    dfdalph_kt = -(rrr * laml11 * rates * Kt)

    return dfdldrt, dfdadrt, dfdalph_kt
