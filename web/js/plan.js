/* Pure functions over a plan: keys, editing rules, parsing, and the metrics
   read off a result. No DOM, so these are the parts worth trusting. */

import { MEASURES, LIMITS } from "./store.js";
import { addDays, daysBetween, runsWhere } from "./format.js";

export const DATES_KEY = {
  larvicide: "larvicide_dates",
  adulticide: "insecticide_dates",      // the model's own name for it
  habitat: "habitat_dates",
};

export const OUT_FILE = {
  larvicide: "larvicide_application_dates.txt",
  adulticide: "insecticide_application_dates.txt",
  habitat: "habitat_removal_application_dates.txt",
};

export const SETTING_KEYS = {
  larvicide: { strength: "ls_ef", duration: "len_lr" },
  adulticide: { strength: "is_ef", duration: "len_ins" },
  habitat: { strength: "cl_ef", duration: "len_cr" },
};

/** Identity of a computation: same key, same result. */
export function planKey(climateKey, settings, plan) {
  const parts = [climateKey];
  for (const measure of MEASURES) {
    const { strength, duration } = SETTING_KEYS[measure];
    parts.push(`${measure}:${settings[strength]}:${settings[duration]}:${plan[measure].join("|")}`);
  }
  return parts.join(";");
}

export const isEmptyPlan = (plan) => MEASURES.every((m) => plan[m].length === 0);

export function totalApplications(plan) {
  return MEASURES.reduce((sum, measure) => sum + plan[measure].length, 0);
}

/** Add dates to one measure. Repeated dates are dropped: the model counts one
    application per day per measure, so keeping two would silently lose a dose. */
export function withDates(plan, measure, dates, year) {
  const accepted = [];
  const rejected = [];
  const duplicate = [];
  const existing = new Set(plan[measure]);
  for (const date of dates) {
    if (year && !date.startsWith(String(year))) rejected.push(date);
    else if (existing.has(date)) duplicate.push(date);
    else { existing.add(date); accepted.push(date); }
  }
  const next = { ...plan, [measure]: [...plan[measure], ...accepted].sort() };
  return { plan: next, accepted, rejected, duplicate };
}

export function withoutDate(plan, measure, date) {
  return { ...plan, [measure]: plan[measure].filter((entry) => entry !== date) };
}

/** Move one application, clamped to the year and refusing an occupied day. */
export function movedDate(plan, measure, from, to, dates) {
  if (!dates.length) return { plan, to: from, blocked: false };
  const first = dates[0];
  const last = dates[dates.length - 1];
  let target = to < first ? first : to > last ? last : to;
  const taken = new Set(plan[measure].filter((entry) => entry !== from));
  if (taken.has(target)) {
    // Nearest free day, searching outward, so a drag never silently vanishes.
    let offset = 1;
    let found = null;
    while (offset < 30 && !found) {
      for (const candidate of [addDays(target, offset), addDays(target, -offset)]) {
        if (!taken.has(candidate) && candidate >= first && candidate <= last) { found = candidate; break; }
      }
      offset += 1;
    }
    if (!found) return { plan, to: from, blocked: true };
    target = found;
  }
  const next = { ...plan, [measure]: plan[measure].map((e) => (e === from ? target : e)).sort() };
  return { plan: next, to: target, blocked: target !== to };
}

/** "every N days, M times" from a start date. */
export function seriesDates(start, interval, times, dates) {
  const last = dates[dates.length - 1];
  const out = [];
  for (let index = 0; index < times; index += 1) {
    const date = addDays(start, interval * index);
    if (date > last) break;
    out.push(date);
  }
  return out;
}

export function parseDateList(text) {
  const iso = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return [...new Set(iso)].filter((date) => !Number.isNaN(Date.parse(date))).sort();
}

export function clampSetting(key, value) {
  const [low, high] = LIMITS[key];
  if (!Number.isFinite(value)) return null;
  return Math.min(high, Math.max(low, value));
}

/* -- metrics ------------------------------------------------------------- */

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function metrics(series) {
  const { dates, riskBefore, riskAfter, adultsBefore, adultsAfter } = series;
  const peakIndexBefore = riskBefore.indexOf(Math.max(...riskBefore));
  const peakIndexAfter = riskAfter.indexOf(Math.max(...riskAfter));
  const above = (values) => runsWhere(values, (value) => value > 1);
  const runsBefore = above(riskBefore);
  const runsAfter = above(riskAfter);
  const days = (runs) => runs.reduce((sum, [from, to]) => sum + (to - from + 1), 0);

  return {
    daysAboveBefore: days(runsBefore),
    daysAboveAfter: days(runsAfter),
    runsBefore, runsAfter,
    peakBefore: riskBefore[peakIndexBefore],
    peakAfter: riskAfter[peakIndexAfter],
    peakDateBefore: dates[peakIndexBefore],
    peakDateAfter: dates[peakIndexAfter],
    meanBefore: mean(riskBefore),
    meanAfter: mean(riskAfter),
    adultsChange: (mean(adultsAfter) / mean(adultsBefore) - 1) * 100,
    seasonBefore: runsBefore.length
      ? [dates[runsBefore[0][0]], dates[runsBefore[runsBefore.length - 1][1]]] : null,
    seasonAfter: runsAfter.length
      ? [dates[runsAfter[0][0]], dates[runsAfter[runsAfter.length - 1][1]]] : null,
  };
}

/** Which treatments are acting on a given day, for the readout. */
export function activeOn(plan, settings, dates, index) {
  const date = dates[index];
  const active = [];
  for (const measure of MEASURES) {
    const duration = settings[SETTING_KEYS[measure].duration];
    for (const start of plan[measure]) {
      const elapsed = daysBetween(start, date);
      if (elapsed < 0) continue;
      if (measure === "habitat") {
        // Removal decays exponentially; report what is still gone.
        const remaining = Math.exp(-elapsed / duration);
        if (remaining > 0.05) {
          active.push({ measure, text: `${Math.round(remaining * settings.cl_ef * 100)}% of sites still removed` });
        }
      } else if (elapsed < duration + 1) {
        active.push({ measure, text: `day ${elapsed + 1} of ${duration}` });
      }
    }
  }
  return active;
}
