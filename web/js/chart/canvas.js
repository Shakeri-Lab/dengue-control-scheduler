/* The planner chart: relative risk, the schedule directly beneath it, one shared
   month axis, and optional driver lanes — all on one time scale with one
   crosshair. The readout is a single quiet line, not a floating tooltip: a
   finger hides a floating box, and a line survives printing. */

import { el } from "../dom.js";
import { Frame } from "./frame.js";
import { riskLane, axisLane, adultsLane, temperatureLane } from "./lanes.js";
import { celsius, fullDate } from "../format.js";
import { strings, MEASURE_NAMES } from "../strings.js";
import { activeOn } from "../plan.js";

const pct = (value) => `${Math.round(value * 100)}%`;

export class Canvas {
  constructor(root) {
    this.root = root;
    this.frame = new Frame();
    this.data = null;
    this.showDrivers = false;
    this.build();
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.lanes);
    this.frame.onHover(() => this.paintHover());
  }

  build() {
    this.readout = el("p", { class: "readout", "aria-live": "off" });
    this.lanes = el("div", { class: "lanes" });
    this.riskHost = el("div", { class: "lane lane-risk" });
    this.scheduleHost = el("div", { class: "schedule", id: "schedule" });
    this.axisHost = el("div", { class: "lane lane-axis" });
    this.temperatureHost = el("div", { class: "lane" });
    this.adultsHost = el("div", { class: "lane" });
    this.drivers = el("div", { class: "drivers", hidden: true }, [
      el("p", { class: "driver-label", text: strings.laneTemperature }),
      this.temperatureHost,
      el("p", { class: "driver-label", text: `${strings.laneAdults} — ${strings.adultsNote}` }),
      this.adultsHost,
    ]);
    this.crosshair = el("div", { class: "crosshair", hidden: true });

    this.lanes.append(this.riskHost, this.scheduleHost, this.axisHost, this.drivers, this.crosshair);
    this.root.replaceChildren(this.lanes, this.readout);

    this.lanes.addEventListener("pointermove", (event) => this.pointerToHover(event));
    this.lanes.addEventListener("pointerleave", () => this.frame.setHover(null));
  }

  pointerToHover(event) {
    if (!this.data) return;
    const box = this.riskHost.getBoundingClientRect();
    const scale = this.frame.width / box.width;
    this.frame.setHover(this.frame.indexAt((event.clientX - box.left) * scale));
  }

  measure() {
    const width = this.lanes.clientWidth;
    if (!width) return;
    const before = this.frame.narrow;
    this.frame.setWidth(width);
    this.applyGeometry();
    if (this.data) {
      this.render(this.data);
      if (before !== this.frame.narrow && this.onLayout) this.onLayout();
    }
  }

  /** The schedule rows are HTML; share the chart's gutter and right edge with
      them through CSS, and switch their layout when the chart is narrow. */
  applyGeometry() {
    this.root.style.setProperty("--gutter", `${this.frame.gutter}px`);
    this.root.style.setProperty("--right", `${this.frame.rightPad}px`);
    this.root.classList.toggle("narrow", Boolean(this.frame.narrow));
  }

  setWindow(from, to) {
    this.frame.setWindow(from, to);
    if (this.data) this.render(this.data);
  }

  setDrivers(show) {
    this.showDrivers = show;
    this.drivers.hidden = !show;
    if (this.data) this.render(this.data);
  }

  render(data) {
    this.data = data;
    if (this.frame.dates !== data.dates) {
      const resetWindow = this.frame.dates.length !== data.dates.length;
      this.frame.dates = data.dates;
      if (resetWindow || this.frame.to === 0) this.frame.setWindow(0, data.dates.length - 1);
    }
    if (!this.frame.width || this.frame.width === 900) {
      const width = this.lanes.clientWidth;
      if (width) {
        this.frame.setWidth(width);
        this.applyGeometry();
      }
    }
    riskLane(this.riskHost, data, this.frame);
    axisLane(this.axisHost, this.frame);
    if (this.showDrivers) {
      if (data.temperature) temperatureLane(this.temperatureHost, data, this.frame);
      if (data.adultsBefore) adultsLane(this.adultsHost, data, this.frame);
    }
    this.paintHover();
  }

  paintHover() {
    const index = this.frame.hover;
    if (!this.data || index < 0) {
      this.crosshair.hidden = true;
      this.renderReadout(-1);
      return;
    }
    const box = this.riskHost.getBoundingClientRect();
    const hostBox = this.lanes.getBoundingClientRect();
    const scale = box.width / this.frame.width;
    this.crosshair.hidden = false;
    this.crosshair.style.left = `${box.left - hostBox.left + this.frame.x(index) * scale}px`;
    this.renderReadout(index);
  }

  renderReadout(index) {
    const data = this.data;
    if (!data || index < 0) {
      this.readout.replaceChildren(el("span", {
        class: "readout-hint",
        text: "Point at the chart, or focus it and use the arrow keys, to read a day.",
      }));
      return;
    }
    const peak = Math.max(...data.riskBefore) || 1;
    const before = data.riskBefore[index] / peak;
    const parts = [el("b", { text: fullDate(data.dates[index]) })];
    if (data.hasPlan) {
      const after = data.riskAfter[index] / peak;
      parts.push(el("span", { text: `risk ${pct(before)} of peak → ` }),
        el("b", { class: "plan-ink", text: `${pct(after)} with plan` }));
    } else {
      parts.push(el("span", { text: `risk ${pct(before)} of peak` }));
    }
    if (data.temperature && Number.isFinite(data.temperature[index])) {
      parts.push(el("span", { text: celsius(data.temperature[index]) }));
    }
    for (const entry of activeOn(data.plan, data.settings, data.dates, index)) {
      parts.push(el("span", { text: `${MEASURE_NAMES[entry.measure]} ${entry.text}` }));
    }
    const nodes = [];
    parts.forEach((part, i) => {
      if (i) nodes.push(el("span", { class: "sep", text: "·", "aria-hidden": "true" }));
      nodes.push(part);
    });
    this.readout.replaceChildren(...nodes);
  }

  /** Keyboard reading: day, week, month, ends, and the high-season edges. */
  handleKey(event) {
    if (!this.data) return false;
    const { key, shiftKey } = event;
    const current = this.frame.hover < 0 ? this.frame.from : this.frame.hover;
    const season = this.data.metrics && this.data.metrics.highSeason;
    let next = null;
    if (key === "ArrowRight") next = current + (shiftKey ? 7 : 1);
    else if (key === "ArrowLeft") next = current - (shiftKey ? 7 : 1);
    else if (key === "PageDown") next = current + 30;
    else if (key === "PageUp") next = current - 30;
    else if (key === "Home") next = this.frame.from;
    else if (key === "End") next = this.frame.to;
    else if (key === "[" && season) next = season.first;
    else if (key === "]" && season) next = season.last;
    if (next === null) return false;
    event.preventDefault();
    this.frame.setHover(next);
    return true;
  }
}
