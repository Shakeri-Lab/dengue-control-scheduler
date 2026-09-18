/* Number, date and unit formatting. R0 is an index, so two decimals
   everywhere except the data table; a third digit would overstate it. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MONTH_NAMES = MONTHS;

export const r0 = (value) => value.toFixed(2);
export const r0Precise = (value) => value.toFixed(3);
export const celsius = (value) => `${value.toFixed(1)} °C`;

export function signedPercent(value) {
  if (Math.abs(value) < 0.5) return "no change";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(0)}%`;
}

export function signedR0(value) {
  if (Math.abs(value) < 0.005) return "no change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

/** "25 Jun" — the compact form used on axes and in the readout. */
export function shortDate(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "25 Jun 2026" — the form used in tables, exports and block labels. */
export function fullDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Whole days after an ISO date, still as an ISO date. */
export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

/** Compact mosquito counts: 1.2M, 450K. Used only in the data table. */
export function count(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

/** Axis ticks on a [1, 2, 2.5, 5, 10] ladder, always including zero. */
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const ticks = [];
  for (let value = 0; value < max + step * 0.999; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

/** Contiguous [start, end] index runs where predicate holds. */
export function runsWhere(values, predicate) {
  const runs = [];
  let start = -1;
  values.forEach((value, index) => {
    if (predicate(value)) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push([start, index - 1]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, values.length - 1]);
  return runs;
}
