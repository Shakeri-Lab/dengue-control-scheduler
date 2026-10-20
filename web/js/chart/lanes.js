/* The lanes. Each is a pure render(host, data, frame): no state, no listeners —
   the crosshair and readout live above them in canvas.js.

   Risk is drawn relative to the site's own uncontrolled peak. The model's R0 is
   exactly linear in a breeding-site density it assumes rather than measures, so
   its absolute level is not a property of the site, while the shape is. */

import { svg, svgText } from "../dom.js";
import { drawTimeAxis, linePath } from "./frame.js";
import { shortDate } from "../format.js";
import { strings } from "../strings.js";
import { HIGH_SEASON } from "../plan.js";

function laneSvg(frame, height, label) {
  return svg("svg", {
    viewBox: `0 0 ${frame.width} ${height}`,
    width: "100%", height,
    role: "img", "aria-label": label,
    preserveAspectRatio: "none",
  });
}

function areaPath(frame, values, y, base) {
  const line = linePath(frame, values, y);
  if (!line) return "";
  return `${line}L${frame.x(frame.to).toFixed(1)},${base}L${frame.x(frame.from).toFixed(1)},${base}Z`;
}

/* -- risk ---------------------------------------------------------------- */

export function riskLane(host, data, frame) {
  const { riskBefore, riskAfter, hasPlan, metrics } = data;
  const top = 26;
  const plotHeight = frame.narrow ? 176 : 232;
  const bottom = top + plotHeight;
  const height = bottom + 4;

  const peak = Math.max(...riskBefore) || 1;
  const rel = (values) => values.map((value) => value / peak);
  const before = rel(riskBefore);
  const after = hasPlan ? rel(riskAfter) : null;
  // A plan can rebound above the uncontrolled curve; never clip it.
  const domain = Math.max(1, after ? Math.max(...after) : 0) * 1.06;
  const y = (value) => bottom - (plotHeight * value) / domain;

  const node = laneSvg(frame, height, describeRisk(data));
  const season = metrics && metrics.highSeason;

  // High season: one quiet column, the thing this tool is for.
  if (season && season.last >= frame.from && season.first <= frame.to) {
    const x1 = frame.x(Math.max(season.first, frame.from));
    const x2 = frame.x(Math.min(season.last, frame.to));
    node.append(svg("rect", {
      x: x1, y: top - 22, width: Math.max(2, x2 - x1), height: plotHeight + 22,
      fill: "var(--season)", rx: 2,
    }));
    const label = `${strings.highSeason} · ${shortDate(season.from)} – ${shortDate(season.to)}`;
    const roomRight = frame.width - frame.rightPad - x1;
    node.append(svgText({
      x: roomRight > 170 ? x1 + 8 : x2 - 8, y: top - 8,
      "text-anchor": roomRight > 170 ? "start" : "end", class: "season-label",
    }, label));
  }

  node.append(drawTimeAxis(frame, bottom, { top }));

  // Hairlines at the levels the page talks about: zero, half the peak, the peak.
  for (const [value, text] of [[0, "0"], [HIGH_SEASON, "50%"], [1, "100%"]]) {
    node.append(svg("line", {
      x1: frame.gutter, x2: frame.width - frame.rightPad, y1: y(value), y2: y(value),
      stroke: value === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1,
    }));
    node.append(svgText({
      x: frame.gutter - 10, y: y(value) + 4, "text-anchor": "end", class: "tick",
    }, text));
  }

  // Without control: a soft area — context. With the plan: one line — emphasis.
  node.append(svg("path", {
    d: areaPath(frame, before, y, bottom), fill: "var(--base-fill)", stroke: "none",
  }));
  node.append(svg("path", {
    d: linePath(frame, before, y), fill: "none", stroke: "var(--base-line)",
    "stroke-width": 1.5, "stroke-linejoin": "round",
  }));
  if (after) {
    node.append(svg("path", {
      d: linePath(frame, after, y), fill: "none", stroke: "var(--plan)",
      "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
      class: data.stale ? "stale" : "",
    }));
  }

  host.replaceChildren(node);
  return { height, y, top, bottom };
}

function describeRisk(data) {
  const season = data.metrics && data.metrics.highSeason;
  if (!season) return `${strings.laneRisk}. ${strings.noSeason}`;
  return `${strings.laneRisk}, ${strings.riskAxis}. High season ${season.from} to ${season.to}.`;
}

/* -- schedule forcing, drawn inside each schedule row's track ------------- */

/** The forcing the model applied for one measure, in the track's own width.
    Overlap reads as height, and the habitat measure's decay is drawn as it is
    rather than as a rectangle ending at the "recovery time". */
export function forcingSvg(values, frame, height = 30) {
  const width = frame.plotWidth;
  const node = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, width: "100%", height,
    preserveAspectRatio: "none", "aria-hidden": "true", class: "forcing",
  });
  for (const tick of frame.monthTicks()) {
    const x = frame.px(tick.index);
    node.append(svg("line", { x1: x, x2: x, y1: 0, y2: height, stroke: "var(--grid)", "stroke-width": 1 }));
  }
  if (!values || !values.length) return node;
  const peak = Math.max(...values.slice(frame.from, frame.to + 1));
  if (!(peak > 1e-9)) return node;
  const yy = (value) => height - 3 - (height - 9) * (value / peak);
  const points = [];
  for (let index = frame.from; index <= frame.to; index += 1) {
    points.push(`${frame.px(index).toFixed(1)},${yy(values[index] || 0).toFixed(1)}`);
  }
  node.append(svg("path", {
    d: `M0,${height - 3}L${points.join("L")}L${width},${height - 3}Z`,
    fill: "var(--forcing)", stroke: "none",
  }));
  return node;
}

/** Month labels: one row under the chart and the schedule, shared by both. */
export function axisLane(host, frame) {
  const height = 20;
  const node = svg("svg", {
    viewBox: `0 0 ${frame.width} ${height}`, width: "100%", height,
    preserveAspectRatio: "none", "aria-hidden": "true",
  });
  for (const tick of frame.monthTicks()) {
    node.append(svgText({
      x: frame.x(tick.index) + 3, y: 13, "text-anchor": "start", class: "tick",
    }, frame.narrow ? tick.label.slice(0, 1) : tick.label));
  }
  host.replaceChildren(node);
}

/* -- drivers (shown on request) ------------------------------------------ */

export function adultsLane(host, data, frame) {
  const { adultsBefore, adultsAfter, hasPlan } = data;
  const plotHeight = 72;
  const height = plotHeight + 6;
  const peak = Math.max(...adultsBefore, ...(hasPlan ? adultsAfter : [0]), 1);
  const y = (value) => plotHeight - (plotHeight - 8) * (value / peak);

  const node = laneSvg(frame, height, strings.laneAdults);
  node.append(drawTimeAxis(frame, plotHeight));
  node.append(svg("line", {
    x1: frame.gutter, x2: frame.width - frame.rightPad, y1: plotHeight, y2: plotHeight,
    stroke: "var(--axis)", "stroke-width": 1,
  }));
  node.append(svgText({ x: frame.gutter - 10, y: y(peak) + 4, "text-anchor": "end", class: "tick" }, "peak"));
  node.append(svg("path", {
    d: linePath(frame, adultsBefore, y), fill: "none",
    stroke: "var(--base-line)", "stroke-width": 1.5, "stroke-linejoin": "round",
  }));
  if (hasPlan) {
    node.append(svg("path", {
      d: linePath(frame, adultsAfter, y), fill: "none",
      stroke: "var(--plan)", "stroke-width": 2, "stroke-linejoin": "round",
      class: data.stale ? "stale" : "",
    }));
  }
  host.replaceChildren(node);
  return { height };
}

export function temperatureLane(host, data, frame) {
  const { temperature } = data;
  const plotHeight = 52;
  const height = plotHeight + 6;
  const valid = temperature.filter(Number.isFinite);
  const low = Math.min(...valid);
  const high = Math.max(...valid);
  const span = Math.max(1, high - low);
  const y = (value) => plotHeight - 6 - (plotHeight - 18) * ((value - low) / span);

  const node = laneSvg(frame, height, strings.laneTemperature);
  node.append(drawTimeAxis(frame, plotHeight));
  node.append(svgText({ x: frame.gutter - 10, y: y(high) + 4, "text-anchor": "end", class: "tick" },
    `${high.toFixed(0)} °C`));
  node.append(svgText({ x: frame.gutter - 10, y: y(low) + 4, "text-anchor": "end", class: "tick" },
    `${low.toFixed(0)} °C`));
  node.append(svg("path", {
    d: linePath(frame, temperature, y), fill: "none",
    stroke: "var(--base-line)", "stroke-width": 1.5, "stroke-linejoin": "round",
  }));
  host.replaceChildren(node);
  return { height };
}
