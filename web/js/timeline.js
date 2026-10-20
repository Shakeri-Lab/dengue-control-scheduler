/* The schedule, drawn directly under the risk chart on the same time scale.

   One row per measure. The row's label is a button that opens that measure's
   settings (the model takes one strength and one duration per measure). The
   track shows the forcing the model actually applied, with each application
   as a real HTML button on top — so focus rings, forced colours and screen
   readers work without extra effort.

   Dragging is a mouse/pen accelerator only. Every action is also reachable
   from the popover (date field and ±1/±7 buttons) and from the plan list,
   which is what WCAG 2.5.7 asks for and what a phone needs. */

import { el } from "./dom.js";
import { MEASURES } from "./store.js";
import { SETTING_KEYS } from "./plan.js";
import { forcingSvg } from "./chart/lanes.js";
import { addDays, fullDate, shortDate } from "./format.js";
import { strings, MEASURE_NAMES, SHORT_NAMES } from "./strings.js";

const DRAG_THRESHOLD = 4;

function settingsSummary(measure, settings) {
  const { strength, duration } = SETTING_KEYS[measure];
  if (measure === "habitat") {
    return `${Math.round(settings[strength] * 100)}% removed · ${settings[duration]} d`;
  }
  return `${settings[strength]}/day · ${settings[duration]} d`;
}

export class Timeline {
  constructor(root, frame, handlers) {
    this.root = root;
    this.frame = frame;
    this.handlers = handlers;     // {onMove, onAdd, onRemove, onOpen, onSettings, onRefresh}
    this.dragging = null;
  }

  render(plan, settings, dates, forcing) {
    this.plan = plan;
    this.settings = settings;
    this.dates = dates;
    this.forcing = forcing || null;

    // A result landing mid-edit must not take focus away from the block the
    // user is driving with the keyboard, so remember and restore it.
    const active = document.activeElement;
    const focused = active && active.classList.contains("tl-block")
      ? { measure: active.dataset.measure, date: active.dataset.date } : null;

    this.root.replaceChildren(...MEASURES.map((measure) => this.row(measure)));

    if (focused) {
      const restored = this.root.querySelector(
        `.tl-block[data-measure="${focused.measure}"][data-date="${focused.date}"]`);
      if (restored) restored.focus();
    }
  }

  ratio(index) {
    const { from, to } = this.frame;
    return (index - from) / Math.max(1, to - from);
  }

  indexAtRatio(ratio) {
    const { from, to } = this.frame;
    return Math.round(from + Math.max(0, Math.min(1, ratio)) * (to - from));
  }

  row(measure) {
    const label = el("button", {
      type: "button", class: "sched-label", dataset: { measure },
      "aria-label": `${MEASURE_NAMES[measure]} settings: ${settingsSummary(measure, this.settings)}`,
      onclick: (event) => this.handlers.onSettings(measure, event.currentTarget),
    }, [
      el("span", { class: "sched-name", text: SHORT_NAMES[measure] }),
      el("span", { class: "sched-meta", text: settingsSummary(measure, this.settings) }),
    ]);

    const track = el("div", {
      class: "sched-track",
      dataset: { measure },
      title: `Click to add ${MEASURE_NAMES[measure].toLowerCase()}`,
      onpointerdown: (event) => this.trackPointerDown(event, measure, track),
    });
    track.append(forcingSvg(this.forcing && this.forcing[measure], this.frame,
      this.frame.narrow ? 40 : 30));

    let visible = 0;
    for (const date of this.plan[measure]) {
      const block = this.block(measure, date);
      if (block) { track.append(block); visible += 1; }
    }
    if (!this.plan[measure].length) {
      track.append(el("span", { class: "tl-empty", text: "click to add", "aria-hidden": "true" }));
    } else if (!visible) {
      track.append(el("span", { class: "tl-empty", text: "outside this view", "aria-hidden": "true" }));
    }

    return el("div", { class: "sched-row", role: "group",
                       "aria-label": `${MEASURE_NAMES[measure]} applications` }, [label, track]);
  }

  block(measure, date) {
    const index = this.dates.indexOf(date);
    if (index < this.frame.from || index > this.frame.to) return null;
    const duration = this.settings[SETTING_KEYS[measure].duration];
    const until = addDays(date, Math.round(duration));
    const name = measure === "habitat"
      ? strings.blockNameHabitat(MEASURE_NAMES[measure], fullDate(date), duration)
      : strings.blockName(MEASURE_NAMES[measure], fullDate(date), fullDate(until));

    const node = el("button", {
      type: "button",
      class: "tl-block",
      style: { left: `${this.ratio(index) * 100}%` },
      "aria-label": name,
      "aria-describedby": "tl-hint",
      dataset: { measure, date },
      onkeydown: (event) => this.blockKeyDown(event, measure, date),
      onclick: (event) => {
        if (this.suppressClick) { this.suppressClick = false; return; }
        event.stopPropagation();
        this.handlers.onOpen(measure, date, node);
      },
      onpointerdown: (event) => this.blockPointerDown(event, measure, date, node),
    }, [el("span", { class: "tl-pin" })]);
    return node;
  }

  /* -- pointer ---------------------------------------------------------- */

  blockPointerDown(event, measure, date, node) {
    event.stopPropagation();
    if (event.pointerType === "touch") return;      // tap opens the popover
    const track = node.parentElement;
    this.dragging = {
      measure, date, node, box: track.getBoundingClientRect(),
      startX: event.clientX, moved: false, flag: null,
    };
    node.setPointerCapture(event.pointerId);
    node.addEventListener("pointermove", this.onDragMove = (e) => this.dragMove(e));
    node.addEventListener("pointerup", this.onDragEnd = (e) => this.dragEnd(e));
    node.addEventListener("pointercancel", this.onDragCancel = () => this.dragCancel());
    node.addEventListener("keydown", this.onDragEscape = (e) => {
      if (e.key === "Escape") this.dragCancel();
    });
  }

  dragMove(event) {
    const drag = this.dragging;
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const index = this.indexAtRatio((event.clientX - drag.box.left) / drag.box.width);
    drag.target = this.dates[index];
    drag.node.style.left = `${this.ratio(index) * 100}%`;
    drag.node.classList.add("dragging");
    if (!drag.flag) {
      drag.flag = el("span", { class: "tl-flag" });
      drag.node.append(drag.flag);
    }
    drag.flag.textContent = `${shortDate(drag.date)} → ${shortDate(drag.target)}`;
  }

  dragEnd(event) {
    const drag = this.dragging;
    if (!drag) return;
    this.cleanupDrag(event);
    if (drag.moved && drag.target && drag.target !== drag.date) {
      this.suppressClick = true;
      this.handlers.onMove(drag.measure, drag.date, drag.target);
    } else if (drag.moved) {
      this.handlers.onRefresh();
    }
  }

  dragCancel() {
    if (this.dragging) {
      this.cleanupDrag();
      this.handlers.onRefresh();
    }
  }

  cleanupDrag(event) {
    const drag = this.dragging;
    if (!drag) return;
    if (event) {
      try { drag.node.releasePointerCapture(event.pointerId); } catch (_) { /* gone */ }
    }
    drag.node.removeEventListener("pointermove", this.onDragMove);
    drag.node.removeEventListener("pointerup", this.onDragEnd);
    drag.node.removeEventListener("pointercancel", this.onDragCancel);
    drag.node.removeEventListener("keydown", this.onDragEscape);
    drag.node.classList.remove("dragging");
    if (drag.flag) drag.flag.remove();
    this.dragging = null;
  }

  trackPointerDown(event, measure, track) {
    if (event.target.closest(".tl-block")) return;
    const box = track.getBoundingClientRect();
    const index = this.indexAtRatio((event.clientX - box.left) / box.width);
    this.handlers.onAdd(measure, this.dates[index], event.pointerType === "touch", track);
  }

  /* -- keyboard --------------------------------------------------------- */

  blockKeyDown(event, measure, date) {
    const { key, shiftKey } = event;
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      this.handlers.onRemove(measure, date);
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const step = (key === "ArrowRight" ? 1 : -1) * (shiftKey ? 7 : 1);
      this.handlers.onMove(measure, date, addDays(date, step), { keepFocus: true });
    }
  }
}
