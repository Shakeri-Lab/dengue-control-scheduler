/* The schedule editor: real HTML buttons positioned on the same time scale as
   the SVG lanes, so they inherit focus rings, forced-colors and screen-reader
   support for free.

   Dragging is a mouse/pen accelerator only. Every action is also reachable
   from the popover (a date field and ±1/±7 day buttons) and from the plan
   table, which is what WCAG 2.5.7 asks for and what a phone needs at 0.8 px
   per day. */

import { el, announce } from "./dom.js";
import { MEASURES } from "./store.js";
import { SETTING_KEYS } from "./plan.js";
import { addDays, fullDate, shortDate, daysBetween } from "./format.js";
import { strings, MEASURE_NAMES } from "./strings.js";

const DRAG_THRESHOLD = 4;

export class Timeline {
  constructor(root, frame, handlers) {
    this.root = root;
    this.frame = frame;
    this.handlers = handlers;     // {onMove, onAdd, onRemove, onOpen}
    this.state = null;
    this.dragging = null;
  }

  render(plan, settings, dates) {
    this.plan = plan;
    this.settings = settings;
    this.dates = dates;
    // A result landing mid-edit must not take focus away from the block the
    // user is driving with the keyboard, so remember and restore it.
    const active = document.activeElement;
    const focused = active && active.classList.contains("tl-block")
      ? { measure: active.dataset.measure, date: active.dataset.date } : null;

    const rows = MEASURES.map((measure) => this.row(measure));
    this.root.replaceChildren(...rows);

    if (focused) {
      const restored = this.root.querySelector(
        `.tl-block[data-measure="${focused.measure}"][data-date="${focused.date}"]`);
      if (restored) restored.focus();
    }
  }

  row(measure) {
    const track = el("div", {
      class: "tl-track",
      dataset: { measure },
      onpointerdown: (event) => this.trackPointerDown(event, measure, track),
    });

    for (const date of this.plan[measure]) {
      track.append(this.block(measure, date));
    }
    if (!this.plan[measure].length) {
      track.append(el("span", { class: "tl-empty", text: strings.emptyLane }));
    }
    return el("div", { class: "tl-row" }, [
      el("div", { class: "tl-label", text: MEASURE_NAMES[measure] }),
      track,
    ]);
  }

  block(measure, date) {
    const duration = this.settings[SETTING_KEYS[measure].duration];
    const index = this.dates.indexOf(date);
    if (index < 0) return el("span");
    const until = addDays(date, Math.round(duration));
    const label = measure === "habitat"
      ? strings.blockNameHabitat(MEASURE_NAMES[measure], fullDate(date), duration)
      : strings.blockName(MEASURE_NAMES[measure], fullDate(date), fullDate(until));

    const left = (index / Math.max(1, this.dates.length - 1)) * 100;
    const node = el("button", {
      type: "button",
      class: "tl-block",
      style: { left: `${left}%` },
      "aria-label": label,
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
    if (event.pointerType === "touch") return;      // tap opens the popover
    event.stopPropagation();
    const track = node.parentElement;
    const box = track.getBoundingClientRect();
    this.dragging = {
      measure, date, node, box,
      startX: event.clientX,
      moved: false,
      flag: null,
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
    const ratio = (event.clientX - drag.box.left) / drag.box.width;
    const index = Math.round(Math.max(0, Math.min(1, ratio)) * (this.dates.length - 1));
    drag.target = this.dates[index];
    drag.node.style.left = `${(index / (this.dates.length - 1)) * 100}%`;
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
    if (event.target !== track && !event.target.classList.contains("tl-empty")) return;
    const box = track.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.round(Math.max(0, Math.min(1, ratio)) * (this.dates.length - 1));
    this.handlers.onAdd(measure, this.dates[index], event.pointerType === "touch");
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
