/* Files a practitioner can put in an operations memo. */

import { download } from "./dom.js";
import { MEASURES } from "./store.js";
import { SETTING_KEYS } from "./plan.js";
import { r0Precise, fullDate, addDays, shortDate, signedPercent } from "./format.js";
import { MEASURE_NAMES, strings } from "./strings.js";

const UNIT = {
  larvicide: "added larval mortality per day",
  adulticide: "added adult mortality per day",
  habitat: "fraction of breeding sites removed",
};

export function scheduleCsv(plan, settings) {
  const rows = ["measure,start_date,effect_until,strength,strength_unit,duration_days,duration_meaning"];
  for (const measure of MEASURES) {
    const { strength, duration } = SETTING_KEYS[measure];
    const meaning = measure === "habitat" ? "recovery time" : "active period";
    for (const date of plan[measure]) {
      rows.push([
        MEASURE_NAMES[measure], date,
        measure === "habitat" ? "" : addDays(date, Math.round(settings[duration])),
        settings[strength], `"${UNIT[measure]}"`, settings[duration], meaning,
      ].join(","));
    }
  }
  return `${rows.join("\n")}\n`;
}

export function dailyCsv(data) {
  const { dates, temperature, riskBefore, riskAfter, adultsBefore, adultsAfter, forcing, hasPlan } = data;
  const header = ["date", "temperature_c", "r0_without_control"];
  if (hasPlan) header.push("r0_with_plan");
  header.push("adults_without_control");
  if (hasPlan) header.push("adults_with_plan");
  if (forcing) header.push("larvicide_mortality_per_day", "adulticide_mortality_per_day", "sites_removed_fraction");

  const rows = dates.map((date, index) => {
    const cells = [date, temperature ? temperature[index].toFixed(2) : "",
      r0Precise(riskBefore[index])];
    if (hasPlan) cells.push(r0Precise(riskAfter[index]));
    cells.push(adultsBefore[index].toFixed(0));
    if (hasPlan) cells.push(adultsAfter[index].toFixed(0));
    if (forcing) {
      cells.push(forcing.larvicide[index].toFixed(4),
        forcing.adulticide[index].toFixed(4),
        forcing.habitat[index].toFixed(4));
    }
    return cells.join(",");
  });
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

/** Per-measure date files, in the shape the desktop app's "From CSV…" reads
    (column 0 only, so the measures cannot share one file). */
export function desktopDateFiles(plan) {
  return MEASURES
    .filter((measure) => plan[measure].length)
    .map((measure) => ({
      name: `${measure}_dates.csv`,
      text: `${plan[measure].join("\n")}\n`,
    }));
}

export function summaryText(data, site) {
  const { metrics, plan, settings, hasPlan, climate } = data;
  const lines = [];
  lines.push(`Aedes Control planner — ${site || climate.name}, ${climate.year}`);
  lines.push("");
  if (hasPlan) {
    lines.push(`Days with R0 above 1: ${metrics.daysAboveBefore} without control, ` +
      `${metrics.daysAboveAfter} with this plan.`);
    lines.push(`Highest R0: ${metrics.peakBefore.toFixed(2)} (${shortDate(metrics.peakDateBefore)}) ` +
      `to ${metrics.peakAfter.toFixed(2)} (${shortDate(metrics.peakDateAfter)}).`);
    lines.push(`Average R0 over the year: ${metrics.meanBefore.toFixed(2)} to ${metrics.meanAfter.toFixed(2)}.`);
    lines.push(`Adult mosquitoes, yearly average: ${signedPercent(metrics.adultsChange)}.`);
    lines.push("");
    lines.push("Plan:");
    for (const measure of MEASURES) {
      if (!plan[measure].length) continue;
      const { strength, duration } = SETTING_KEYS[measure];
      lines.push(`  ${MEASURE_NAMES[measure]} (${settings[strength]} ${UNIT[measure]}, ` +
        `${settings[duration]} days): ${plan[measure].map(fullDate).join("; ")}`);
    }
  } else {
    lines.push(`No control scheduled. R0 is above 1 for ${metrics.daysAboveBefore} days; ` +
      `highest ${metrics.peakBefore.toFixed(2)} on ${shortDate(metrics.peakDateBefore)}.`);
  }
  lines.push("");
  lines.push(strings.limitations);
  return `${lines.join("\n")}\n`;
}

export function metadataJson(data, extra) {
  const { plan, settings, climate, metrics, hasPlan } = data;
  return JSON.stringify({
    tool: "Aedes Control planner (web)",
    generated_at: new Date().toISOString().slice(0, 19),
    model_sha: extra.modelSha,
    pyodide: extra.pyodide,
    memoization: extra.memo,
    climate: {
      name: climate.name, year: climate.year, days: climate.dates.length,
      sha256_of_file: climate.key, is_example: Boolean(climate.isExample),
    },
    settings,
    plan,
    outcomes: hasPlan ? {
      days_above_1_without_control: metrics.daysAboveBefore,
      days_above_1_with_plan: metrics.daysAboveAfter,
      peak_r0_without_control: metrics.peakBefore,
      peak_r0_with_plan: metrics.peakAfter,
      mean_r0_without_control: metrics.meanBefore,
      mean_r0_with_plan: metrics.meanAfter,
      adults_change_percent: metrics.adultsChange,
    } : null,
    note: "Modelled index, not a forecast of cases.",
  }, null, 2);
}

/** Rasterise the canvas lanes into one PNG with a provenance footer. */
export async function figurePng(lanesHost, caption) {
  const svgs = [...lanesHost.querySelectorAll("svg")];
  if (!svgs.length) throw new Error("nothing to export");
  const style = getComputedStyle(document.body);
  const resolve = (name) => style.getPropertyValue(name).trim() || "#000";

  const scale = 2;
  const width = svgs[0].clientWidth || 900;
  const heights = svgs.map((node) => node.clientHeight || Number(node.getAttribute("height")));
  const footer = 28;
  const total = heights.reduce((sum, value) => sum + value, 0) + footer;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = total * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = resolve("--surface") || "#ffffff";
  context.fillRect(0, 0, width, total);

  let offset = 0;
  for (let index = 0; index < svgs.length; index += 1) {
    const clone = svgs[index].cloneNode(true);
    // A standalone SVG has no CSS variables; resolve them to literal colours.
    inlineColours(clone, resolve);
    clone.setAttribute("width", width);
    clone.setAttribute("height", heights[index]);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      context.drawImage(image, 0, offset, width, heights[index]);
    } finally {
      URL.revokeObjectURL(url);
    }
    offset += heights[index];
  }

  context.fillStyle = resolve("--ink-2") || "#555";
  context.font = "11px system-ui, sans-serif";
  context.fillText(caption, 8, total - 10);

  return new Promise((resolve_, reject) => {
    canvas.toBlob((blob) => (blob ? resolve_(blob) : reject(new Error("export failed"))), "image/png");
  });
}

function inlineColours(node, resolve) {
  const attributes = ["fill", "stroke"];
  const walk = (element) => {
    for (const attribute of attributes) {
      const value = element.getAttribute && element.getAttribute(attribute);
      if (value && value.startsWith("var(")) {
        element.setAttribute(attribute, resolve(value.slice(4, -1).trim()));
      }
    }
    if (element.tagName === "text") {
      element.setAttribute("fill", element.getAttribute("fill") || resolve("--ink-2"));
      element.setAttribute("font-family", "system-ui, sans-serif");
      element.setAttribute("font-size", element.getAttribute("font-size") || "11");
    }
    for (const child of element.children || []) walk(child);
  };
  walk(node);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = url;
  });
}

export { download };
