/* The four lanes. Each is a pure render(host, data, frame): no state, no
   listeners — the crosshair and readout live above them in canvas.js. */

import { svg, svgText } from "../dom.js";
import { drawTimeAxis, drawValueAxis, linePath, bandPath } from "./frame.js";
import { niceTicks, r0, shortDate, runsWhere } from "../format.js";
import { strings, MEASURE_NAMES } from "../strings.js";

const STRIP = 16;          // season strip above the risk plot
const AXIS_BAND = 22;      // room for month labels inside the lane's height

function laneSvg(frame, height, label) {
  return svg("svg", {
    viewBox: `0 0 ${frame.width} ${height}`,
    width: "100%", height,
    role: "img", "aria-label": label,
    preserveAspectRatio: "none",
  });
}

/** Two rows of segments marking the days with R0 above 1, before and after.
    This replaces a single bracket: it survives several separate spells, shows
    the shift at both ends, and has no text to clip at phone widths. */
function seasonStrip(frame, before, after) {
  const group = svg("g", { class: "season-strip" });
  const rows = [
    { values: before, y: 0, fill: "var(--ink-muted)" },
    { values: after, y: 8, fill: "var(--series-plan)" },
  ];
  for (const row of rows) {
    for (const [from, to] of runsWhere(row.values, (value) => value > 1)) {
      if (to < frame.from || from > frame.to) continue;
      const x1 = frame.x(Math.max(from, frame.from));
      const x2 = frame.x(Math.min(to, frame.to));
      group.append(svg("rect", {
        x: x1, y: row.y, width: Math.max(2, x2 - x1), height: 6, rx: 2, fill: row.fill,
      }));
    }
  }
  return group;
}

export function riskLane(host, data, frame) {
  const { dates, riskBefore, riskAfter, hasPlan } = data;
  const plotHeight = frame.narrow ? 176 : 232;
  const height = STRIP + plotHeight + AXIS_BAND;
  const top = STRIP;

  const maxValue = Math.max(...riskBefore, ...(hasPlan ? riskAfter : [0]), 1.05);
  const ticks = niceTicks(maxValue);
  const domainMax = ticks[ticks.length - 1];
  const y = (value) => top + plotHeight - (plotHeight * value) / domainMax;

  const node = laneSvg(frame, height, describeRisk(data));
  node.append(drawValueAxis(frame, ticks, y, { format: (v) => v.toFixed(1), emphasise: 1 }));
  node.append(drawTimeAxis(frame, top + plotHeight, { labels: true, top }));

  if (hasPlan) {
    // One wash only: what the plan removes. Nothing is filled where the plan
    // is above the baseline — that is a rebound, not a reduction.
    node.append(svg("path", {
      d: bandPath(frame, riskBefore, riskAfter, y, (i) => riskBefore[i] > riskAfter[i]),
      fill: "var(--ink)", "fill-opacity": 0.08, stroke: "none",
    }));
  }

  // R0 = 1: solid hairline, labelled at the emptier end of the window.
  const thresholdY = y(1);
  node.append(svg("line", {
    x1: frame.gutter, x2: frame.width - frame.rightPad, y1: thresholdY, y2: thresholdY,
    stroke: "var(--ink-2)", "stroke-width": 1,
  }));
  const labelLeft = riskBefore[frame.from] < riskBefore[frame.to];
  node.append(svgText({
    x: labelLeft ? frame.gutter + 6 : frame.width - frame.rightPad,
    y: thresholdY - 6,
    "text-anchor": labelLeft ? "start" : "end",
    class: "threshold-label",
  }, strings.thresholdLabel));

  node.append(svg("path", {
    d: linePath(frame, riskBefore, y), fill: "none",
    stroke: "var(--series-baseline)", "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round",
  }));
  if (hasPlan) {
    node.append(svg("path", {
      d: linePath(frame, riskAfter, y), fill: "none",
      stroke: "var(--series-plan)", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      class: data.stale ? "stale" : "",
    }));
  }

  // Direct labels sit at each curve's peak: the curves converge in December,
  // so end-of-line labels would collide there.
  const peakIndex = peakInWindow(riskBefore, frame);
  if (peakIndex >= 0) {
    node.append(peakLabel(frame, peakIndex, y(riskBefore[peakIndex]),
      `${strings.seriesBaseline} · ${r0(riskBefore[peakIndex])}`, "baseline", top));
  }
  if (hasPlan) {
    const planPeak = peakInWindow(riskAfter, frame);
    if (planPeak >= 0) {
      node.append(peakLabel(frame, planPeak, y(riskAfter[planPeak]),
        `${strings.seriesPlan} · ${r0(riskAfter[planPeak])}`, "plan", top));
    }
  }

  node.append(seasonStrip(frame, riskBefore, hasPlan ? riskAfter : []));
  host.replaceChildren(node);
  return { height, y, top, plotHeight };
}

function peakInWindow(values, frame) {
  let best = -1;
  for (let index = frame.from; index <= frame.to; index += 1) {
    if (Number.isFinite(values[index]) && (best < 0 || values[index] > values[best])) best = index;
  }
  return best;
}

function peakLabel(frame, index, yValue, text, kind, top) {
  const x = frame.x(index);
  const toLeft = x > frame.width * 0.6;
  // Keep the label clear of the season strip above the plot; drop it below the
  // peak rather than let it collide.
  const above = yValue - 8;
  const y = above < top + 12 ? yValue + 16 : above;
  return svgText({
    x: toLeft ? x - 8 : x + 8,
    y,
    "text-anchor": toLeft ? "end" : "start",
    class: `direct-label direct-label-${kind}`,
  }, text);
}

function describeRisk(data) {
  const { metrics, hasPlan } = data;
  if (!metrics) return strings.laneRisk;
  const base = `Without control, R0 is above 1 for ${metrics.daysAboveBefore} days`;
  return hasPlan
    ? `${base}. With this plan, ${metrics.daysAboveAfter} days.`
    : `${base}.`;
}

/* -- schedule ------------------------------------------------------------ */

/** One step-area per measure showing the forcing the model actually applied:
    overlap reads as height, and the habitat measure's decay is drawn as it is
    rather than as a rectangle that ends at the "recovery time". */
export function scheduleLane(host, data, frame) {
  const { forcing, settings } = data;
  const rowHeight = frame.narrow ? 40 : 30;
  const measures = ["larvicide", "adulticide", "habitat"];
  const height = rowHeight * measures.length;
  const node = laneSvg(frame, height, strings.laneSchedule);
  node.append(drawTimeAxis(frame, height));

  measures.forEach((measure, row) => {
    const top = row * rowHeight;
    const bottom = top + rowHeight - 6;
    const values = (forcing && forcing[measure]) || [];
    const peak = Math.max(1e-9, ...values);
    const y = (value) => bottom - (rowHeight - 12) * (value / peak);

    node.append(svg("line", {
      x1: frame.gutter, x2: frame.width - frame.rightPad, y1: bottom, y2: bottom,
      stroke: "var(--grid)", "stroke-width": 1,
    }));

    if (values.length) {
      const points = [];
      for (let index = frame.from; index <= frame.to; index += 1) {
        points.push(`${frame.x(index).toFixed(1)},${y(values[index] || 0).toFixed(1)}`);
      }
      node.append(svg("path", {
        d: `M${frame.x(frame.from).toFixed(1)},${bottom}L${points.join("L")}L${frame.x(frame.to).toFixed(1)},${bottom}Z`,
        fill: "var(--ink)", "fill-opacity": 0.16, stroke: "none",
      }));
      node.append(svg("path", {
        d: `M${points.join("L")}`, fill: "none",
        stroke: "var(--ink-2)", "stroke-width": 1,
      }));
    }

    node.append(svgText({
      x: frame.gutter - 8, y: top + rowHeight / 2 + 4, "text-anchor": "end", class: "lane-tag",
    }, MEASURE_NAMES[measure]));

    if (values.length && peak > 1e-6) {
      const unit = measure === "habitat" ? "" : " /day";
      node.append(svgText({
        x: frame.width - frame.rightPad, y: top + 12, "text-anchor": "end", class: "tick",
      }, measure === "habitat" ? `${Math.round(peak * 100)}%` : `${peak.toFixed(2)}${unit}`));
    }
  });

  host.replaceChildren(node);
  return { height, rowHeight };
}

/* -- adults and temperature ---------------------------------------------- */

export function adultsLane(host, data, frame) {
  const { adultsBefore, adultsAfter, hasPlan } = data;
  const plotHeight = 108;
  const height = plotHeight + AXIS_BAND;
  const peak = Math.max(...adultsBefore, ...(hasPlan ? adultsAfter : [0]), 1);
  const y = (value) => plotHeight - (plotHeight - 8) * (value / peak);

  const node = laneSvg(frame, height, strings.laneAdults);
  node.append(drawTimeAxis(frame, plotHeight, { labels: true }));
  for (const share of [0.5, 1]) {
    node.append(svg("line", {
      x1: frame.gutter, x2: frame.width - frame.rightPad, y1: y(peak * share), y2: y(peak * share),
      stroke: "var(--grid)", "stroke-width": 1,
    }));
    node.append(svgText({
      x: frame.gutter - 8, y: y(peak * share) + 4, "text-anchor": "end", class: "tick",
    }, `${Math.round(share * 100)}%`));
  }
  node.append(svg("path", {
    d: linePath(frame, adultsBefore, y), fill: "none",
    stroke: "var(--series-baseline)", "stroke-width": 2, "stroke-linejoin": "round",
  }));
  if (hasPlan) {
    node.append(svg("path", {
      d: linePath(frame, adultsAfter, y), fill: "none",
      stroke: "var(--series-plan)", "stroke-width": 2, "stroke-linejoin": "round",
      class: data.stale ? "stale" : "",
    }));
  }
  host.replaceChildren(node);
  return { height };
}

export function temperatureLane(host, data, frame) {
  const { temperature } = data;
  const plotHeight = 56;
  const height = plotHeight + AXIS_BAND;
  const low = Math.min(...temperature);
  const high = Math.max(...temperature);
  const span = Math.max(1, high - low);
  const y = (value) => plotHeight - 6 - (plotHeight - 18) * ((value - low) / span);

  const node = laneSvg(frame, height, strings.laneTemperature);
  node.append(drawTimeAxis(frame, plotHeight, { labels: true }));
  node.append(svg("path", {
    d: linePath(frame, temperature, y), fill: "none",
    stroke: "var(--ink-muted)", "stroke-width": 2, "stroke-linejoin": "round",
  }));
  for (const [value, anchor] of [[high, "max"], [low, "min"]]) {
    const index = temperature.indexOf(value);
    if (index < frame.from || index > frame.to) continue;
    node.append(svgText({
      x: frame.x(index), y: anchor === "max" ? y(value) - 5 : y(value) + 13,
      "text-anchor": "middle", class: "tick",
    }, `${value.toFixed(0)} °C`));
  }
  host.replaceChildren(node);
  return { height };
}
