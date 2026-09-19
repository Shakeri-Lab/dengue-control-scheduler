/* Reading the user's temperature file.

   JavaScript only normalises the text to ISO CSV — the model's own loader
   stays the single validator, so the page can never accept a file the model
   would reject. */

import { strings } from "./strings.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function splitRows(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitCells(line) {
  // Semicolon files (common where the decimal separator is a comma) and tabs.
  const separator = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
  return line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function toNumber(text) {
  // A decimal comma is unambiguous here: these are temperatures, never lists.
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Day-first vs month-first cannot be guessed from an unambiguous file alone;
    report which it is so the page can ask only when it matters. */
function detectOrder(parts) {
  let dayFirst = false;
  let monthFirst = false;
  for (const [a, b] of parts) {
    if (a > 12) dayFirst = true;
    if (b > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return "day";
  if (monthFirst && !dayFirst) return "month";
  return "ambiguous";
}

/**
 * Parse a pasted or uploaded file.
 * Returns {ok, rows:[{date, value}], year, order, stats} or {ok:false, reason}.
 */
export function parseClimate(text, { order = "auto", year = null } = {}) {
  const lines = splitRows(text);
  if (!lines.length) return { ok: false, reason: "The file is empty." };

  const rows = [];
  const slashParts = [];
  let singleColumn = true;

  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length >= 2) singleColumn = false;
  }

  if (singleColumn && year) {
    // One column of values plus a stated year: number them from 1 January.
    const values = lines.map(toNumber).filter((value) => value !== null);
    const start = Date.UTC(year, 0, 1);
    values.forEach((value, index) => {
      rows.push({
        date: new Date(start + index * 86400000).toISOString().slice(0, 10),
        value,
      });
    });
    return finish(rows, "iso");
  }

  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length < 2) continue;
    const value = toNumber(cells[cells.length - 1]);
    if (value === null) continue;                       // header row
    const raw = cells[0];
    if (ISO.test(raw)) {
      rows.push({ date: raw, value });
      continue;
    }
    const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (slash) {
      const [, a, b, y] = slash.map(Number);
      slashParts.push([a, b]);
      rows.push({ raw: [a, b, y < 100 ? 2000 + y : y], value });
    }
  }

  if (!rows.length) {
    return { ok: false, reason: "We could not find a date column and a temperature column." };
  }

  if (slashParts.length) {
    const detected = detectOrder(slashParts);
    const resolved = order === "auto" ? detected : order;
    if (resolved === "ambiguous") {
      return { ok: false, reason: "ambiguous-dates", rowCount: rows.length };
    }
    for (const row of rows) {
      if (!row.raw) continue;
      const [a, b, y] = row.raw;
      const day = resolved === "day" ? a : b;
      const month = resolved === "day" ? b : a;
      row.date = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      delete row.raw;
    }
  }

  return finish(rows.filter((row) => row.date), "iso");
}

function finish(rows) {
  if (!rows.length) return { ok: false, reason: "No dated rows were found." };
  rows.sort((first, second) => (first.date < second.date ? -1 : 1));
  const years = [...new Set(rows.map((row) => row.date.slice(0, 4)))];
  const values = rows.map((row) => row.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    ok: true,
    rows,
    years,
    year: Number(years[0]),
    stats: {
      days: rows.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      // Well above any plausible daily mean in Celsius.
      looksFahrenheit: mean > 45,
      looksKelvin: mean > 200,
    },
  };
}

export function toCsv(rows) {
  return `date,temperature\n${rows.map((row) => `${row.date},${row.value}`).join("\n")}\n`;
}

export function selectYear(rows, year) {
  return rows.filter((row) => row.date.startsWith(String(year)));
}

export function convertFahrenheit(rows) {
  return rows.map((row) => ({ ...row, value: (row.value - 32) * (5 / 9) }));
}

/** A blank year of dates for the user to fill in from their own records. */
export function templateCsv(year) {
  const rows = [];
  const date = new Date(Date.UTC(year, 0, 1));
  while (date.getUTCFullYear() === year) {
    rows.push(`${date.toISOString().slice(0, 10)},`);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return `date,temperature\n${rows.join("\n")}\n`;
}
