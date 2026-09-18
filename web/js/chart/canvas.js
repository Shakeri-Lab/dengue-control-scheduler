/* The planner canvas: four lanes on one time axis, one crosshair, one readout.

   The readout is a pinned row above the lanes rather than a floating tooltip —
   a finger hides a floating box, it survives print, and it keeps every value
   reachable without hovering. */

import { $, el, svg } from "../dom.js";
import { Frame } from "./frame.js";
import { riskLane, scheduleLane, adultsLane, temperatureLane } from "./lanes.js";
import { r0, signedR0, celsius, fullDate, signedPercent } from "../format.js";
import { strings, MEASURE_NAMES } from "../strings.js";
import { activeOn } from "../plan.js";

export class Canvas {
  constructor(root, { onHover } = {}) {
    this.root = root;
    this.frame = new Frame();
    this.data = null;
    this.onHover = onHover;
    this.build();
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.lanesHost);
    this.frame.onHover(() => this.paintHover());
  }

  build() {
    this.readout = el("div", { class: "readout", id: "readout", "aria-live": "off" });
    this.lanesHost = el("div", { class: "lanes" });
    this.hosts = {
      risk: el("div", { class: "lane lane-risk" }),
      schedule: el("div", { class: "lane lane-schedule" }),
      adults: el("div", { class: "lane lane-adults" }),
      temperature: el("div", { class: "lane lane-temperature" }),
    };
    this.crosshair = el("div", { class: "crosshair", hidden: true });

    const labelled = (host, title, note) => el("div", { class: "lane-block" }, [
      el("div", { class: "lane-head" }, [
        el("h3", { text: title }),
        note ? el("span", { class: "lane-note", text: note }) : null,
      ]),
      host,
    ]);

    this.lanesHost.append(
      labelled(this.hosts.risk, strings.laneRisk),
      labelled(this.hosts.schedule, strings.laneSchedule),
      labelled(this.hosts.adults, strings.laneAdults, strings.adultsNote),
      labelled(this.hosts.temperature, strings.laneTemperature, strings.temperatureNote),
      this.crosshair,
    );

    this.root.replaceChildren(this.readout, this.lanesHost);

    this.lanesHost.addEventListener("pointermove", (event) => this.pointerToHover(event));
    this.lanesHost.addEventListener("pointerleave", () => this.frame.setHover(null));
    this.lanesHost.addEventListener("pointerdown", (event) => this.pointerToHover(event));
  }

  pointerToHover(event) {
    if (!this.data) return;
    const box = this.hosts.risk.getBoundingClientRect();
    const scale = this.frame.width / box.width;
    this.frame.setHover(this.frame.indexAt((event.clientX - box.left) * scale));
  }

  measure() {
    const width = this.lanesHost.clientWidth;
    if (!width) return;
    this.frame.setWidth(width);
    if (this.data) this.render(this.data);
  }

  setWindow(from, to) {
    this.frame.setWindow(from, to);
    if (this.data) this.render(this.data);
  }

  render(data) {
    this.data = data;
    if (!this.frame.dates.length || this.frame.dates !== data.dates) {
      this.frame.dates = data.dates;
      if (this.frame.to === 0) this.frame.setWindow(0, data.dates.length - 1);
    }
    if (!this.frame.width) this.frame.setWidth(this.lanesHost.clientWidth || 900);

    riskLane(this.hosts.risk, data, this.frame);
    scheduleLane(this.hosts.schedule, data, this.frame);
    if (data.adultsBefore) adultsLane(this.hosts.adults, data, this.frame);
    if (data.temperature) temperatureLane(this.hosts.temperature, data, this.frame);
    this.paintHover();
  }

  paintHover() {
    const index = this.frame.hover;
    if (!this.data || index < 0) {
      this.crosshair.hidden = true;
      this.renderReadout(-1);
      return;
    }
    const box = this.hosts.risk.getBoundingClientRect();
    const hostBox = this.lanesHost.getBoundingClientRect();
    const scale = box.width / this.frame.width;
    this.crosshair.hidden = false;
    this.crosshair.style.left = `${box.left - hostBox.left + this.frame.x(index) * scale}px`;
    this.renderReadout(index);
    if (this.onHover) this.onHover(index);
  }

  renderReadout(index) {
    const data = this.data;
    if (!data || index < 0) {
      this.readout.replaceChildren(
        el("span", { class: "readout-hint", text: "Point at the chart, or use the arrow keys, to read a day." }),
      );
      return;
    }
    const items = [];
    const add = (label, value, strong) =>
      items.push(el("span", { class: `readout-item${strong ? " strong" : ""}` }, [
        el("span", { class: "readout-label", text: label }),
        el("b", { text: value }),
      ]));

    add("Date", fullDate(data.dates[index]), true);
    if (data.hasPlan) {
      add("R0 with plan", r0(data.riskAfter[index]), true);
      add("without control", r0(data.riskBefore[index]));
      add("difference", signedR0(data.riskAfter[index] - data.riskBefore[index]));
    } else {
      add("R0 without control", r0(data.riskBefore[index]), true);
    }
    const value = data.hasPlan ? data.riskAfter[index] : data.riskBefore[index];
    add("", value > 1 ? "above 1" : "below 1");
    if (data.adultsBefore) {
      const change = (data.adultsAfter[index] / data.adultsBefore[index] - 1) * 100;
      add("Adults", data.hasPlan ? signedPercent(change) : "—");
    }
    if (data.temperature) add("Temperature", celsius(data.temperature[index]));

    const active = activeOn(data.plan, data.settings, data.dates, index);
    for (const entry of active) {
      add(MEASURE_NAMES[entry.measure], entry.text);
    }
    this.readout.replaceChildren(...items);
  }

  /** Keyboard reading: day, week, month, ends, and threshold crossings. */
  handleKey(event) {
    if (!this.data) return false;
    const { key, shiftKey } = event;
    const current = this.frame.hover < 0 ? this.frame.from : this.frame.hover;
    const values = this.data.hasPlan ? this.data.riskAfter : this.data.riskBefore;
    let next = null;
    if (key === "ArrowRight") next = current + (shiftKey ? 7 : 1);
    else if (key === "ArrowLeft") next = current - (shiftKey ? 7 : 1);
    else if (key === "PageDown") next = current + 30;
    else if (key === "PageUp") next = current - 30;
    else if (key === "Home") next = this.frame.from;
    else if (key === "End") next = this.frame.to;
    else if (key === "]" || key === "[") {
      const step = key === "]" ? 1 : -1;
      let probe = current + step;
      while (probe > this.frame.from && probe < this.frame.to) {
        if ((values[probe] > 1) !== (values[probe - step] > 1)) { next = probe; break; }
        probe += step;
      }
      if (next === null) next = step > 0 ? this.frame.to : this.frame.from;
    }
    if (next === null) return false;
    event.preventDefault();
    this.frame.setHover(next);
    return true;
  }
}
