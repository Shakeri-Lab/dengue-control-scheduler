/* The pieces around the chart: the three figures, a measure's settings, the
   plan as a list, the date popover, and the daily table. */

import { el } from "./dom.js";
import { MEASURES, LIMITS } from "./store.js";
import { SETTING_KEYS } from "./plan.js";
import { r0Precise, fullDate, shortDate, addDays } from "./format.js";
import { strings, MEASURE_NAMES } from "./strings.js";

/* -- figures ------------------------------------------------------------- */

const signedPct = (value) => {
  if (Math.abs(value) < 0.5) return "no change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(0)}%`;
};

/** Three figures, plain type, no cards. The first is the claim — when; the
    other two are a plan's effect, as percentages, because percentages are the
    only form of the model's output that does not depend on what it assumes. */
export function renderFigures(host, { metrics, hasPlan, resultHasPlan, stale }) {
  if (!metrics) {
    host.replaceChildren(el("p", { class: "muted", text: strings.firstRun }));
    return;
  }
  const figure = (label, value, note, extra = "") =>
    el("div", { class: `figure ${extra}` }, [
      el("div", { class: "figure-label", text: label }),
      el("div", { class: "figure-value", text: value }),
      note ? el("div", { class: "figure-note", text: note }) : null,
    ]);

  const season = metrics.highSeason;
  const nodes = [
    figure(strings.figureSeason,
      season ? `${shortDate(season.from)} – ${shortDate(season.to)}` : "None",
      season ? strings.figureSeasonNote(season.days) : strings.noSeason, "lead"),
  ];
  if (hasPlan && !resultHasPlan) {
    // The plan exists but has not been simulated yet: say so, not "no change".
    nodes.push(
      figure(strings.figureSeasonRisk, "…", strings.updating, "empty"),
      figure(strings.figurePeak, "…", strings.updating, "empty"),
    );
  } else if (hasPlan) {
    nodes.push(
      figure(strings.figureSeasonRisk, signedPct(metrics.seasonChange), strings.figureWithPlan,
        metrics.seasonChange > 0.5 ? "worse" : ""),
      figure(strings.figurePeak, signedPct(metrics.peakChange), strings.figureWithPlan,
        metrics.peakChange > 0.5 ? "worse" : ""),
    );
  } else {
    nodes.push(figure(strings.figureSeasonRisk, "—", strings.figureNoPlan, "empty"));
  }
  host.replaceChildren(...nodes);
  host.classList.toggle("stale", Boolean(stale));
  host.setAttribute("aria-busy", stale ? "true" : "false");
}

/** One measure's two settings, opened from its schedule row. */
export function openSettings({ anchor, measure, settings, onChange }) {
  closePopover();
  const keys = SETTING_KEYS[measure];
  const isHabitat = measure === "habitat";
  const strengthLabel = isHabitat ? strings.strengthHabitat
    : measure === "larvicide" ? strings.strengthLarvicide : strings.strengthAdulticide;
  const durationLabel = isHabitat ? strings.durationHabitat : strings.durationLarvicide;
  const help = el("p", { class: "help" });
  const describe = () => {
    help.textContent = isHabitat
      ? strings.recoveryHelp(Number(duration.value))
      : strings.rateHelp(Number(strength.value), Number(duration.value));
  };
  const field = (key, label, step) => el("input", {
    type: "number", id: `set-${key}`, value: settings[key],
    min: LIMITS[key][0], max: LIMITS[key][1], step, inputmode: "decimal",
    "aria-label": label,
    oninput: () => describe(),
    onchange: (event) => onChange(key, Number(event.target.value)),
  });
  const strength = field(keys.strength, strengthLabel, 0.01);
  const duration = field(keys.duration, durationLabel, 1);
  describe();

  const popover = el("div", { class: "popover", role: "dialog",
                              "aria-label": `${MEASURE_NAMES[measure]} settings` }, [
    el("h4", { text: MEASURE_NAMES[measure] }),
    el("label", { class: "popover-field" }, [el("span", { text: strengthLabel }), strength]),
    el("label", { class: "popover-field" }, [el("span", { text: durationLabel }), duration]),
    help,
    el("p", { class: "help", text: strings.durationShared }),
    el("div", { class: "popover-actions" }, [
      el("button", { type: "button", class: "primary", text: "Done",
                     onclick: () => { closePopover(); if (anchor) anchor.focus(); } }),
    ]),
  ]);
  place(popover, anchor);
  strength.focus();
}

function place(popover, anchor) {
  document.body.append(popover);
  const box = anchor ? anchor.getBoundingClientRect() : { left: 40, bottom: 120 };
  const width = popover.offsetWidth;
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left))}px`;
  popover.style.top = `${Math.max(8, Math.min(window.innerHeight - popover.offsetHeight - 8, box.bottom + 6))}px`;
  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closePopover(); if (anchor) anchor.focus(); }
  });
  setTimeout(() => document.addEventListener("pointerdown", outsideClose), 0);
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

export function openPopover({ anchor, measure, date, dates, onCommit, onRemove, onSeries, isNew = false }) {
  closePopover();
  // A new application may arrive with a suggested date (the day clicked on the
  // track), so "new" is stated by the caller, never inferred from the date.
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

  place(popover, anchor);
  input.focus();
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
  const { dates, riskBefore, riskAfter, temperature, hasPlan } = data;
  const peak = Math.max(...riskBefore) || 1;
  const headings = hasPlan
    ? ["Date", "°C", "Risk, no control", "Risk, with plan", "Model R0, no control", "Model R0, with plan"]
    : ["Date", "°C", "Risk, no control", "Model R0, no control"];
  const pct = (value) => `${(100 * value / peak).toFixed(0)}%`;
  const rows = dates.map((date, index) => {
    const cells = [date, temperature && Number.isFinite(temperature[index]) ? temperature[index].toFixed(1) : "—",
      pct(riskBefore[index])];
    if (hasPlan) cells.push(pct(riskAfter[index]));
    cells.push(r0Precise(riskBefore[index]));
    if (hasPlan) cells.push(r0Precise(riskAfter[index]));
    return el("tr", {}, cells.map((value) => el("td", { text: value })));
  });
  host.replaceChildren(
    el("caption", { text: "Risk as a share of the site’s peak without control. Model R0 is the " +
      "raw index; its level depends on an assumed breeding-site density." }),
    el("thead", {}, el("tr", {}, headings.map((h) => el("th", { scope: "col", text: h })))),
    el("tbody", {}, rows),
  );
}
