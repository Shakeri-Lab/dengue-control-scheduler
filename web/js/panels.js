/* The pieces around the canvas: outcomes, measure settings, the plan table,
   the popover, and the data table. */

import { el, announce } from "./dom.js";
import { MEASURES, LIMITS } from "./store.js";
import { SETTING_KEYS, totalApplications } from "./plan.js";
import {
  r0, r0Precise, signedPercent, signedR0, fullDate, shortDate, addDays, count, celsius,
} from "./format.js";
import { strings, MEASURE_NAMES } from "./strings.js";

/* -- outcomes ------------------------------------------------------------ */

function delta(before, after, unit, betterIsLower = true) {
  const change = after - before;
  if (Math.abs(change) < 1e-9) return { text: strings.noChange, tone: "flat" };
  const better = betterIsLower ? change < 0 : change > 0;
  const magnitude = unit === "days"
    ? `${Math.abs(change)} ${Math.abs(change) === 1 ? "day" : "days"}`
    : Math.abs(change).toFixed(2);
  return {
    text: better ? `${magnitude} fewer` : `${magnitude} more`,
    tone: better ? "better" : "worse",
  };
}

export function renderOutcomes(host, { metrics, hasPlan, plan, stale }) {
  if (!metrics) {
    host.replaceChildren(el("p", { class: "muted", text: strings.firstRun }));
    return;
  }
  const nodes = [];

  // Hero: the number a programme actually plans around.
  const heroValue = hasPlan ? metrics.daysAboveAfter : metrics.daysAboveBefore;
  const runs = hasPlan ? metrics.runsAfter : metrics.runsBefore;
  const heroSub = [];
  if (hasPlan) {
    const change = delta(metrics.daysAboveBefore, metrics.daysAboveAfter, "days");
    heroSub.push(`${metrics.daysAboveBefore} without control`, change.text);
  }
  if (runs.length > 1) heroSub.push(`${runs.length} periods`);

  nodes.push(el("div", { class: "hero" }, [
    el("div", { class: "hero-label", text: strings.heroLabel }),
    el("div", { class: "hero-value", text: heroValue === 0 ? "None" : `${heroValue} days` }),
    heroSub.length ? el("div", { class: "hero-sub", text: heroSub.join(" · ") }) : null,
  ]));

  const tile = (label, before, after, format, note, betterIsLower = true) => {
    const change = hasPlan ? delta(before, after, "value", betterIsLower) : null;
    return el("div", { class: "tile" }, [
      el("div", { class: "tile-label", text: label }),
      el("div", { class: "tile-value" }, hasPlan ? [
        el("span", { class: "from", text: format(before) }),
        el("span", { class: "arrow", text: " → " }),
        el("span", { text: format(after) }),
      ] : [el("span", { text: format(before) })]),
      change ? el("div", { class: `tile-delta ${change.tone}`, text: change.text }) : null,
      note ? el("div", { class: "tile-note", text: note }) : null,
    ]);
  };

  const tiles = [
    tile(strings.tilePeak, metrics.peakBefore, metrics.peakAfter, r0,
      hasPlan
        ? `${shortDate(metrics.peakDateBefore)} → ${shortDate(metrics.peakDateAfter)}`
        : shortDate(metrics.peakDateBefore)),
    tile(strings.tileMean, metrics.meanBefore, metrics.meanAfter, r0, strings.tileMeanNote),
  ];
  if (hasPlan) {
    tiles.push(el("div", { class: "tile" }, [
      el("div", { class: "tile-label", text: strings.tileAdults }),
      el("div", { class: "tile-value" }, [el("span", { text: signedPercent(metrics.adultsChange) })]),
      el("div", { class: "tile-note", text: strings.tileAdultsNote }),
    ]));
  }

  nodes.push(el("div", { class: "tiles" }, tiles));

  if (hasPlan) {
    const parts = MEASURES
      .filter((measure) => plan[measure].length)
      .map((measure) => `${plan[measure].length} ${MEASURE_NAMES[measure].toLowerCase()}`);
    nodes.push(el("p", {
      class: "plan-count",
      text: strings.planCount(totalApplications(plan), parts.join(", ")),
    }));
  }

  host.replaceChildren(...nodes);
  host.classList.toggle("stale", Boolean(stale));
  host.setAttribute("aria-busy", stale ? "true" : "false");
}

/* -- measure settings ---------------------------------------------------- */

export function renderSettings(host, settings, onChange) {
  const cards = MEASURES.map((measure) => {
    const keys = SETTING_KEYS[measure];
    const isHabitat = measure === "habitat";
    const strengthLabel = isHabitat ? strings.strengthHabitat
      : measure === "larvicide" ? strings.strengthLarvicide : strings.strengthAdulticide;
    const durationLabel = isHabitat ? strings.durationHabitat : strings.durationLarvicide;

    const field = (key, label, step) => {
      const input = el("input", {
        type: "number", id: `set-${key}`, value: settings[key],
        min: LIMITS[key][0], max: LIMITS[key][1], step,
        inputmode: "decimal",
        onchange: (event) => onChange(key, Number(event.target.value)),
      });
      return el("div", { class: "field" }, [
        el("label", { for: `set-${key}`, text: label }), input,
      ]);
    };

    const help = isHabitat
      ? strings.recoveryHelp(settings[keys.duration])
      : strings.rateHelp(settings[keys.strength], settings[keys.duration]);

    return el("div", { class: "measure-card" }, [
      el("h3", { text: MEASURE_NAMES[measure] }),
      el("div", { class: "pair" }, [
        field(keys.strength, strengthLabel, 0.01),
        field(keys.duration, durationLabel, 1),
      ]),
      el("p", { class: "help", text: help }),
    ]);
  });
  host.replaceChildren(...cards);
}

/* -- plan table (equal editor, and the phone's main one) ----------------- */

export function renderPlanTable(host, plan, settings, handlers) {
  const rows = [];
  for (const measure of MEASURES) {
    for (const date of plan[measure]) {
      const duration = settings[SETTING_KEYS[measure].duration];
      rows.push(el("tr", {}, [
        el("td", { text: MEASURE_NAMES[measure] }),
        el("td", { text: fullDate(date) }),
        el("td", {
          text: measure === "habitat"
            ? `recovers over ${duration} days`
            : `to ${shortDate(addDays(date, Math.round(duration)))}`,
        }),
        el("td", {}, [
          el("button", {
            type: "button", class: "quiet",
            "aria-label": `Remove ${MEASURE_NAMES[measure]}, ${fullDate(date)}`,
            text: strings.remove,
            onclick: () => handlers.onRemove(measure, date),
          }),
        ]),
      ]));
    }
  }

  const table = el("table", { class: "plan-table" }, [
    el("thead", {}, el("tr", {}, ["Measure", "Date", "Effect", ""].map(
      (heading) => el("th", { scope: "col", text: heading }),
    ))),
    el("tbody", {}, rows.length ? rows : [
      el("tr", {}, el("td", { colspan: 4, class: "muted", text: strings.emptyPlan })),
    ]),
  ]);

  const adders = MEASURES.map((measure) => el("button", {
    type: "button",
    text: `${strings.add} ${MEASURE_NAMES[measure].toLowerCase()}`,
    onclick: (event) => handlers.onAdd(measure, null, false, event.currentTarget),
  }));

  host.replaceChildren(table, el("div", { class: "row-actions" }, adders));
}

/* -- popover ------------------------------------------------------------- */

export function openPopover({ anchor, measure, date, dates, onCommit, onRemove, onSeries }) {
  closePopover();
  const isNew = !date;
  const initial = date || dates[Math.floor(dates.length / 2)];
  const input = el("input", {
    type: "date", value: initial, min: dates[0], max: dates[dates.length - 1],
    "aria-label": "Date",
  });

  const step = (days) => el("button", {
    type: "button", class: "quiet", text: days > 0 ? `+${days}` : `${days}`,
    onclick: () => {
      const next = addDays(input.value, days);
      if (next >= dates[0] && next <= dates[dates.length - 1]) input.value = next;
    },
  });

  const interval = el("input", { type: "number", value: 7, min: 1, max: 120, "aria-label": "Every N days" });
  const times = el("input", { type: "number", value: 4, min: 2, max: 40, "aria-label": "How many" });

  const popover = el("div", { class: "popover", role: "dialog", "aria-label": `${MEASURE_NAMES[measure]} application` }, [
    el("h4", { text: MEASURE_NAMES[measure] }),
    el("div", { class: "popover-row" }, [input]),
    el("div", { class: "popover-row" }, [step(-7), step(-1), step(1), step(7)]),
    el("div", { class: "popover-actions" }, [
      el("button", {
        type: "button", class: "primary", text: isNew ? strings.add : "Move here",
        onclick: () => { onCommit(input.value); closePopover(); },
      }),
      !isNew ? el("button", {
        type: "button", class: "quiet", text: strings.remove,
        onclick: () => { onRemove(); closePopover(); },
      }) : null,
      el("button", { type: "button", class: "quiet", text: "Cancel", onclick: closePopover }),
    ]),
    el("details", { class: "popover-series" }, [
      el("summary", { text: strings.addSeries }),
      el("div", { class: "popover-row" }, [
        el("span", { text: "every" }), interval, el("span", { text: "days," }),
        times, el("span", { text: "times" }),
      ]),
      el("button", {
        type: "button", text: strings.add,
        onclick: () => {
          onSeries(input.value, Number(interval.value), Number(times.value));
          closePopover();
        },
      }),
    ]),
  ]);

  document.body.append(popover);
  const box = anchor ? anchor.getBoundingClientRect() : { left: 40, bottom: 120, top: 120 };
  const width = popover.offsetWidth;
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left))}px`;
  popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 8, box.bottom + 6)}px`;
  input.focus();

  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closePopover(); if (anchor) anchor.focus(); }
  });
  setTimeout(() => document.addEventListener("pointerdown", outsideClose), 0);
  return popover;
}

function outsideClose(event) {
  const popover = document.querySelector(".popover");
  if (popover && !popover.contains(event.target)) closePopover();
}

export function closePopover() {
  document.removeEventListener("pointerdown", outsideClose);
  const popover = document.querySelector(".popover");
  if (popover) popover.remove();
}

/* -- data table ---------------------------------------------------------- */

export function renderDataTable(host, data) {
  const { dates, riskBefore, riskAfter, adultsBefore, adultsAfter, temperature, hasPlan } = data;
  const headings = hasPlan
    ? ["Date", "°C", "R0 without", "R0 with plan", "Adults without", "Adults with plan"]
    : ["Date", "°C", "R0 without", "Adults without"];

  const rows = dates.map((date, index) => {
    const cells = [date, temperature ? temperature[index].toFixed(1) : "—",
      r0Precise(riskBefore[index])];
    if (hasPlan) cells.push(r0Precise(riskAfter[index]));
    cells.push(count(adultsBefore[index]));
    if (hasPlan) cells.push(count(adultsAfter[index]));
    return el("tr", {}, cells.map((value) => el("td", { text: value })));
  });

  host.replaceChildren(
    el("thead", {}, el("tr", {}, headings.map((h) => el("th", { scope: "col", text: h })))),
    el("tbody", {}, rows),
  );
}
