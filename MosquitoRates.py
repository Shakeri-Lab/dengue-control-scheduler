# -*- coding: utf-8 -*-
import numpy as np


def linear(temp, x1, x2, y1, y2):
    return y1 + (y2 - y1) * (temp - x1) / (x2 - x1)


def AEDES_AEGYPTI_L_dev_mor(temp):
    Dlr = np.zeros(temp.shape)
    dum = (temp >= 11.5) & (temp <= 40)
    b = np.array([-1.847, 8.291e-1, -1.457e-1, 1.304e-2, -6.461e-4, 1.796e-5, -2.617e-7, 1.551e-9])
    Dlr[dum] = b[0] + b[1]*temp[dum] + b[2]*temp[dum]**2 + b[3]*temp[dum]**3 + b[4]*temp[dum]**4 + b[5]*temp[dum]**5 + b[6]*temp[dum]**6 + b[7]*temp[dum]**7
    Dlr = np.maximum(Dlr, 0)

    gamd = np.zeros(temp.shape)
    dum = (temp >= 4.2) & (temp <= 45.4)
    b = np.array([2.315, -4.191e-1, 2.735e-2, -7.538e-4, 7.503e-6])
    gamd[dum] = b[0] + b[1]*temp[dum] + b[2]*temp[dum]**2 + b[3]*temp[dum]**3 + b[4]*temp[dum]**4
    gamd[~dum] = 1
    return Dlr, gamd


def AEDES_AEGYPTI_P_dev_mor(temp):
    Dlr = np.zeros(temp.shape)
    dum = (temp >= 9.9) & (temp <= 40.3)
    b = np.array([-0.426869237527704, 0.062496053850089, -0.002038578933687, 0,
                  9.421108489840427e-07, 2.566279862691307e-08, 2.288289917484751e-11,
                  -1.065058060341299e-14, -5.873515428269140e-13])
    Dlr[dum] = b[0] + b[1]*temp[dum] + b[2]*temp[dum]**2 + b[3]*temp[dum]**3 + b[4]*temp[dum]**4 + b[5]*temp[dum]**5 + b[6]*temp[dum]**6 + b[7]*temp[dum]**7 + b[8]*temp[dum]**8
    Dlr = np.maximum(Dlr, 0)

    gamd = np.zeros(temp.shape)
    dum = (temp >= 7) & (temp <= 37)
    b = np.array([4.256e-1, -3.248e-2, 7.06e-4, 4.395e-7])
    gamd[dum] = b[0] + b[1]*temp[dum] + b[2]*temp[dum]**2 + b[3]*temp[dum]**3
    gamd[~dum] = 1
    return Dlr, gamd


def AEDES_AEGYPTI_E_dev_mor(temp):
    Dlr = np.zeros(temp.shape)
    dum1 = (temp > 7.2) & (temp < 16)
    dum2 = (temp >= 16) & (temp < 31)
    dum3 = (temp >= 31) & (temp < 38)
    dum4 = ~(dum1 | dum2 | dum3)
    b = np.array([-0.00157, 2.21e-04])
    Dlr[dum1] = b[0] + b[1]*temp[dum1]
    b = np.array([-0.017651, 0.001273, -1.1166e-06])
    Dlr[dum2] = b[0] + b[1]*temp[dum2] + b[2]*temp[dum2]**2
    b = np.array([-0.240513, 0.01, -2.761574e-06, -1.43213e-07, -5.91e-09, -3.883e-10, -2.792e-11])
    Dlr[dum3] = b[0] + b[1]*temp[dum3] + b[2]*temp[dum3]**2 + b[3]*temp[dum3]**3 + b[4]*temp[dum3]**4 + b[5]*temp[dum3]**5 + b[6]*temp[dum3]**6
    Dlr[dum4] = 0
    Dlr = Dlr * 24

    x = np.array([-6.2, 1.1, 16, 22, 25, 28, 31, 35, 40, 45])
    y = np.array([2, 0.0274, 0.0102, 0.0145, 0.0123, 0.0249, 0.0858, 0.290, 0.48, 2])
    gamd = np.zeros(temp.shape)
    it = np.nditer(temp, flags=['multi_index'])
    while not it.finished:
        idx = it.multi_index
        if temp[idx] <= -6.2 or temp[idx] > 45:
            gamd[idx] = 2
        else:
            ind = np.where(x < temp[idx])[0][-1]
            gamd[idx] = linear(temp[idx], x[ind], x[ind + 1], y[ind], y[ind + 1])
        it.iternext()

    return Dlr, gamd


def AEDES_AEGYPTI_Ad_mor(temp):
    x = np.array([0, 4.4, 10, 34, 35, 42])
    y = np.array([2, 1/3, 0.0925, 0.05946, 0.1, 2])
    b = np.array([0.8692, -0.1590, 0.01116, -0.0003408, 0.000003809])
    gamd = np.zeros(temp.shape)
    it = np.nditer(temp, flags=['multi_index'])
    while not it.finished:
        idx = it.multi_index
        if temp[idx] <= 0 or temp[idx] > 42:
            gamd[idx] = 2
        elif temp[idx] <= 34 or temp[idx] > 10:
            gamd[idx] = b[0] + b[1]*temp[idx] + b[2]*temp[idx]**2 + b[3]*temp[idx]**3 + b[4]*temp[idx]**4
        else:
            ind = np.where(x < temp[idx])[0][-1]
            gamd[idx] = linear(temp[idx], x[ind], x[ind + 1], y[ind], y[ind + 1])
        it.iternext()
    return gamd


def AEDES_AEGYPTI_gonr(temp):
    RR = 1.987
    rho = 0.00898
    d1 = 15725
    d2 = 1756481
    d3 = 447.17

    Dlr = np.zeros(temp.shape)
    dum = (temp <= 31.33)

    T = 31.33 + 273  # Set T to max temperature in Kelvin
    Dlr[~dum] = ((rho * T / 298) * np.exp((d1 / RR) * ((1 / 298) - (1 / T)))) / \
        (1 + np.exp((d2 / RR) * ((1 / d3) - (1 / T))))

    T = temp[dum] + 273
    Dlr[dum] = ((rho * T / 298) * np.exp((d1 / RR) * ((1 / 298) - (1 / T)))) / \
        (1 + np.exp((d2 / RR) * ((1 / d3) - (1 / T))))

    Dlr = Dlr * 24
    return Dlr


def AEDES_AEGYPTI_numeg(temp):
    x = np.array([10, 15.3, 16.5, 20, 21.79, 25.64, 27.64, 31.33, 33.41, 40])
    y = np.array([0, 2, 7.3, 14, 13, 17, 17.6, 15.5, 11.73, 0])
    numeg = np.zeros(temp.shape)
    it = np.nditer(temp, flags=['multi_index'])
    while not it.finished:
        idx = it.multi_index
        if temp[idx] <= 10 or temp[idx] > 40:
            numeg[idx] = 0.0
        else:
            ind = np.where(x < temp[idx])[0][-1]
            numeg[idx] = linear(temp[idx], x[ind], x[ind + 1], y[ind], y[ind + 1])
        it.iternext()
    return numeg


def AEDES_AEGYPTI_phihv(temp):
    phihv = np.zeros(temp.shape)
    dum = (temp >= 12.3) & (temp <= 32.461)
    phihv[dum] = 0.001044 * temp[dum] * (temp[dum] - 12.286) * ((32.461 - temp[dum]) ** 0.5)
    phihv[~dum] = 0.0
    return phihv


def AEDES_AEGYPTI_phivh(temp):
    phivh = np.zeros(temp.shape)
    dum1 = (temp < 13.4)
    dum2 = (temp > 27)
    dum3 = ~(dum1 | dum2)
    phivh[dum3] = 0.0729 * temp[dum3] - 0.97
    phivh[dum1] = 0.0
    phivh[dum2] = 1.0
    return phivh


def AEDES_AEGYPTI_gamaV(temp):
    temp = temp + 273.15  # Convert to Kelvin
    out = (
        (0.003359 / 298) * temp * np.exp((15000 / 1.9872) * (1 / 298 - 1 / temp)) /
        (1 + np.exp((6.203e21 / 1.9872) * (1 / (-2.176e30) - 1 / temp)))
    ) * 24
    return out


def calculate_rates_AEDES_AEGYPTI(TT, NumNMS):
    rates = np.zeros((14, TT.size))

    Dlr, gamd = AEDES_AEGYPTI_E_dev_mor(TT)
    rates[0, :] = NumNMS * Dlr
    rates[1, :] = gamd

    Dlr, gamd = AEDES_AEGYPTI_L_dev_mor(TT)
    rates[2, :] = NumNMS * Dlr
    rates[3, :] = gamd

    Dlr, gamd = AEDES_AEGYPTI_P_dev_mor(TT)
    rates[4, :] = NumNMS * Dlr
    rates[5, :] = gamd

    gamd = AEDES_AEGYPTI_Ad_mor(TT)
    rates[6, :] = 5 * gamd
    rates[7, :] = gamd

    Dlr = AEDES_AEGYPTI_gonr(TT)
    rates[8, :] = NumNMS * Dlr
    rates[9, :] = Dlr

    rates[10, :] = AEDES_AEGYPTI_numeg(TT)
    rates[11, :] = AEDES_AEGYPTI_phihv(TT)
    rates[12, :] = AEDES_AEGYPTI_phivh(TT)
    rates[13, :] = AEDES_AEGYPTI_gamaV(TT)

    return rates
