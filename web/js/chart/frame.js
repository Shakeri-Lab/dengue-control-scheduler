/* The shared time frame. Every lane draws against this one day-to-pixel scale
   and one hover index, so the lanes read as a single figure with one x-axis.
   Zoom is a view, never a filter: outcomes are always computed on the full year. */

import { svg, svgText } from "../dom.js";
import { MONTH_NAMES } from "../format.js";

export class Frame {
  constructor() {
    this.dates = [];
    this.from = 0;
    this.to = 0;
    this.width = 900;
    this.gutter = 44;
    this.rightPad = 12;
    this.hover = -1;
    this.listeners = new Set();
  }

  setDates(dates) {
    this.dates = dates;
    this.from = 0;
    this.to = Math.max(0, dates.length - 1);
    this.emit();
  }

  setWindow(from, to) {
    const last = this.dates.length - 1;
    this.from = Math.max(0, Math.min(from, last - 1));
    this.to = Math.min(last, Math.max(to, this.from + 1));
    this.emit();
  }

  setWidth(width) {
    const narrow = width < 560;
    this.width = width;
    this.gutter = narrow ? 34 : 44;
    this.narrow = narrow;
  }

  setHover(index) {
    const next = index === null || index < 0 ? -1
      : Math.max(this.from, Math.min(this.to, index));
    if (next === this.hover) return;
    this.hover = next;
    for (const listener of this.listeners) listener(this.hover);
  }

  onHover(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() { /* lanes re-render from the caller; kept for symmetry */ }

  get plotWidth() { return Math.max(40, this.width - this.gutter - this.rightPad); }
  get span() { return Math.max(1, this.to - this.from); }

  /** Day index -> x in the lane's own coordinate system. */
  x(index) {
    return this.gutter + (this.plotWidth * (index - this.from)) / this.span;
  }

  /** x -> nearest day index. */
  indexAt(x) {
    const raw = this.from + ((x - this.gutter) / this.plotWidth) * this.span;
    return Math.round(Math.max(this.from, Math.min(this.to, raw)));
  }

  /** Month boundaries inside the window, thinned when the lane is narrow. */
  monthTicks() {
    const ticks = [];
    for (let index = this.from; index <= this.to; index += 1) {
      const date = this.dates[index];
      if (!date || !date.endsWith("-01")) continue;
      const month = Number(date.slice(5, 7));
      ticks.push({ index, month, label: MONTH_NAMES[month - 1] });
    }
    // Keep labels from colliding: drop every other one when they are tight.
    const spacing = this.plotWidth / Math.max(1, ticks.length);
    const step = spacing < 34 ? 3 : spacing < 52 ? 2 : 1;
    return ticks.filter((_, position) => position % step === 0);
  }
}

/** Month hairlines plus the month labels, shared by every lane. */
export function drawTimeAxis(frame, height, { labels = false, top = 0 } = {}) {
  const group = svg("g", { class: "axis-x" });
  for (const tick of frame.monthTicks()) {
    const x = frame.x(tick.index);
    group.append(svg("line", {
      x1: x, x2: x, y1: top, y2: height, stroke: "var(--grid)", "stroke-width": 1,
    }));
    if (labels) {
      group.append(svgText({
        x, y: height + 15, "text-anchor": "middle", class: "tick",
      }, tick.label));
    }
  }
  return group;
}

/** Y ticks and their hairlines. */
export function drawValueAxis(frame, ticks, y, { format = String, emphasise = null } = {}) {
  const group = svg("g", { class: "axis-y" });
  for (const tick of ticks) {
    const isEmphasised = emphasise !== null && Math.abs(tick - emphasise) < 1e-9;
    group.append(svg("line", {
      x1: frame.gutter, x2: frame.width - frame.rightPad, y1: y(tick), y2: y(tick),
      stroke: tick === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1,
    }));
    group.append(svgText({
      x: frame.gutter - 8, y: y(tick) + 4, "text-anchor": "end",
      class: isEmphasised ? "tick tick-strong" : "tick",
    }, format(tick)));
  }
  return group;
}

/** A polyline through a series, skipping non-finite points. */
export function linePath(frame, values, y) {
  let path = "";
  let penDown = false;
  for (let index = frame.from; index <= frame.to; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) { penDown = false; continue; }
    path += `${penDown ? "L" : "M"}${frame.x(index).toFixed(1)},${y(value).toFixed(1)}`;
    penDown = true;
  }
  return path;
}

/** Closed area between two series, over the indices where `include` holds. */
export function bandPath(frame, upper, lower, y, include) {
  const segments = [];
  let current = null;
  for (let index = frame.from; index <= frame.to; index += 1) {
    const ok = Number.isFinite(upper[index]) && Number.isFinite(lower[index])
      && (!include || include(index));
    if (ok) {
      if (!current) { current = []; segments.push(current); }
      current.push(index);
    } else {
      current = null;
    }
  }
  return segments
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const top = segment.map((i) => `${frame.x(i).toFixed(1)},${y(upper[i]).toFixed(1)}`);
      const bottom = segment.slice().reverse()
        .map((i) => `${frame.x(i).toFixed(1)},${y(lower[i]).toFixed(1)}`);
      return `M${top.join("L")}L${bottom.join("L")}Z`;
    })
    .join("");
}
