/* Wiring: store -> engine -> canvas, timeline and panels. */

import { $, el, announce, download } from "./dom.js";
import {
  MEASURES, DEFAULT_SETTINGS, getState, set, edit, undo, redo, canUndo, canRedo, subscribe,
} from "./store.js";
import {
  planKey, isEmptyPlan, withDates, withoutDate, movedDate, seriesDates,
  parseDateList, clampSetting, metrics as computeMetrics, OUT_FILE, SETTING_KEYS,
} from "./plan.js";
import { Engine } from "./engine.js";
import { Canvas } from "./chart/canvas.js";
import { Timeline } from "./timeline.js";
import {
  renderOutcomes, renderSettings, renderPlanTable, renderDataTable, openPopover, closePopover,
} from "./panels.js";
import {
  parseClimate, toCsv, selectYear, convertFahrenheit, templateCsv,
} from "./climate.js";
import { strings, MEASURE_NAMES } from "./strings.js";
import { addDays, fullDate, shortDate, r0 } from "./format.js";
import {
  scheduleCsv, dailyCsv, desktopDateFiles, summaryText, metadataJson, figurePng,
} from "./exporters.js";

const DEBOUNCE_MS = 700;
const SLOW_UPDATE_MS = 8000;

let engine = null;
let canvas = null;
let timeline = null;
let debounce = null;
let lastRunMs = 0;
let currentKey = null;
let pendingClimate = null;

/* -- results ------------------------------------------------------------- */

const numbers = (text) => text.split(/\r?\n/).filter((line) => line.trim()).map(Number);
const lines = (text) => (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function seriesFrom(payload, state) {
  const files = payload.files;
  const dates = lines(files["dates.txt"]);
  const temperature = state.climate
    ? dates.map((date) => {
        const index = state.climate.dates.indexOf(date);
        return index >= 0 ? state.climate.temperature[index] : NaN;
      })
    : null;
  return {
    dates,
    temperature,
    riskBefore: numbers(files["risk_before.txt"]),
    riskAfter: numbers(files["risk_after.txt"]),
    adultsBefore: numbers(files["population_before.txt"]),
    adultsAfter: numbers(files["population_after.txt"]),
    larvaeBefore: numbers(files["larvae_before.txt"] || ""),
    larvaeAfter: numbers(files["larvae_after.txt"] || ""),
    forcing: payload.forcing,
    applied: Object.fromEntries(
      MEASURES.map((measure) => [measure, lines(files[OUT_FILE[measure]])]),
    ),
  };
}

function viewData(state) {
  const result = state.result;
  if (!result) return null;
  const hasPlan = !isEmptyPlan(state.plan);
  return {
    ...result.series,
    plan: state.plan,
    settings: state.settings,
    climate: state.climate,
    hasPlan,
    stale: state.pending,
    metrics: computeMetrics(result.series),
  };
}

/* -- rendering ----------------------------------------------------------- */

function render(state) {
  const data = viewData(state);

  $("status").textContent = statusText(state);
  $("status-row").classList.toggle("busy", state.pending);
  $("undo").disabled = !canUndo();
  $("redo").disabled = !canRedo();
  $("auto-update").checked = state.autoUpdate;
  $("update-now").hidden = state.autoUpdate && !state.pending;

  const hasClimate = Boolean(state.climate);
  $("workspace").hidden = !hasClimate;
  $("example-tag").hidden = !(state.climate && state.climate.isExample);

  if (hasClimate) {
    $("site-summary").textContent = state.climate.summary || "";
    if (!timeline) setupEditors();
    timeline.render(state.plan, state.settings, state.climate.dates);
    renderPlanTable($("plan-table"), state.plan, state.settings, {
      onRemove: removeApplication,
      onAdd: (measure, date, touch, anchor) => addApplication(measure, date, touch, anchor),
    });
    renderSettings($("measure-settings"), state.settings, changeSetting);
  }

  if (data) {
    canvas.render(data);
    renderOutcomes($("outcomes"), data);
    renderDataTable($("data-table"), data);
    $("results").hidden = false;
    $("exports").hidden = false;
  } else {
    $("results").hidden = !hasClimate;
  }

  const message = state.message;
  const box = $("message");
  box.hidden = !message;
  if (message) {
    box.className = `message ${message.kind}`;
    box.replaceChildren(
      el("p", { text: message.text }),
      message.detail
        ? el("details", {}, [el("summary", { text: strings.technicalDetail }),
                             el("pre", { text: message.detail })])
        : null,
      ...(message.actions || []).map((action) =>
        el("button", { type: "button", text: action.label, onclick: action.run })),
    );
  }
}

// Measured share of a cold run taken by each of the model's three solves, so
// one bar can run monotonically instead of restarting at each solve.
const SOLVE_WEIGHT = [0.57, 0.21, 0.22];
const SOLVE_STAGE = [
  "Warming up the population",
  "Calculating the year without control",
  "Applying your plan",
];

/** Update the status line in place, without touching the store. */
function showProgress(message) {
  if (!getState().pending) return;
  const index = Math.max(0, Math.min(2, message.solve - 1));
  const done = SOLVE_WEIGHT.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const overall = done + SOLVE_WEIGHT[index] * (message.cached ? 1 : message.frac);
  $("status").textContent =
    `${SOLVE_STAGE[index]}… ${Math.round(Math.min(1, overall) * 100)}%`;
}

function statusText(state) {
  if (state.status === "booting") {
    return state.bootFiles ? strings.bootProgress(state.bootFiles) : strings.bootStart;
  }
  if (state.status === "failed") return "";
  if (state.pending) {
    const estimate = lastRunMs ? ` about ${Math.max(1, Math.round(lastRunMs / 1000))} s` : "";
    return `${strings.updating}${estimate}`;
  }
  if (!state.autoUpdate) return strings.paused;
  if (!state.climate) return state.memo ? strings.readyMemo : strings.ready;
  return strings.upToDate;
}

/* -- simulation ---------------------------------------------------------- */

function requestRun({ immediate = false } = {}) {
  const state = getState();
  if (!state.climate) return;
  clearTimeout(debounce);
  const run = () => {
    const current = getState();
    const key = planKey(current.climate.key, current.settings, current.plan);
    currentKey = key;
    const cached = engine.peek(key);
    if (cached) {
      applyResult(cached, key);
      return;
    }
    set({ pending: true });
    engine.submit({
      type: "simulate",
      tempCsv: current.climate.csv,
      settings: current.settings,
      plan: current.plan,
    }, key);
  };
  if (immediate || !state.autoUpdate) run();
  else debounce = setTimeout(run, DEBOUNCE_MS);
}

function applyResult(payload, key) {
  if (key !== currentKey) return;
  const state = getState();
  if (!payload.ok) {
    set({ pending: false, message: { kind: "error", text: strings.errorRun, detail: payload.message } });
    return;
  }
  // Only an edit-loop run predicts the next one: the first run on a climate
  // file has to compute the warm-up and the no-control year as well.
  if (payload.timing && payload.timing.reused > 0) lastRunMs = payload.timing.total * 1000;
  const series = seriesFrom(payload, state);
  const result = { key, series, timing: payload.timing };
  set({ result, pending: false, message: null });

  if (lastRunMs > SLOW_UPDATE_MS && state.autoUpdate && payload.timing.reused > 0) {
    set({ autoUpdate: false,
          message: { kind: "info", text: strings.slowDevice(Math.round(lastRunMs / 1000)) } });
  }
  const data = viewData(getState());
  if (data && data.hasPlan) {
    announce(strings.announceResults(
      data.metrics.daysAboveBefore, data.metrics.daysAboveAfter,
      r0(data.metrics.peakBefore), r0(data.metrics.peakAfter),
    ));
  }
}

/* -- plan editing -------------------------------------------------------- */

function addApplication(measure, date, touch, anchor) {
  const state = getState();
  const dates = state.climate.dates;
  openPopover({
    anchor, measure, date, dates,
    onCommit: (chosen) => commitAdd(measure, chosen),
    onRemove: () => {},
    onSeries: (start, interval, times) => {
      const wanted = seriesDates(start, interval, times, dates);
      const outcome = withDates(state.plan, measure, wanted, state.climate.year);
      edit({ plan: outcome.plan }, `${MEASURE_NAMES[measure]} series`);
      announce(`${outcome.accepted.length} ${MEASURE_NAMES[measure].toLowerCase()} applications added.`);
      requestRun();
    },
  });
}

function commitAdd(measure, date) {
  const state = getState();
  const outcome = withDates(state.plan, measure, [date], state.climate.year);
  if (outcome.duplicate.length) {
    set({ message: { kind: "info", text: strings.sameDay(MEASURE_NAMES[measure], fullDate(date)) } });
    return;
  }
  if (outcome.rejected.length) {
    set({ message: { kind: "info", text: strings.outsideYear(state.climate.year) } });
    return;
  }
  edit({ plan: outcome.plan }, `${MEASURE_NAMES[measure]} ${shortDate(date)}`);
  const duration = state.settings[SETTING_KEYS[measure].duration];
  announce(strings.announceAdded(MEASURE_NAMES[measure], fullDate(date),
    fullDate(addDays(date, Math.round(duration)))));
  requestRun();
}

function removeApplication(measure, date) {
  const state = getState();
  edit({ plan: withoutDate(state.plan, measure, date) }, `${MEASURE_NAMES[measure]} ${shortDate(date)}`);
  announce(strings.announceRemoved(MEASURE_NAMES[measure], fullDate(date)));
  requestRun();
}

function moveApplication(measure, from, to, options = {}) {
  const state = getState();
  const outcome = movedDate(state.plan, measure, from, to, state.climate.dates);
  if (outcome.to === from) { render(getState()); return; }
  edit({ plan: outcome.plan }, `${MEASURE_NAMES[measure]} ${shortDate(from)}`);
  announce(outcome.blocked
    ? strings.sameDay(MEASURE_NAMES[measure], fullDate(to))
    : strings.announceMoved(MEASURE_NAMES[measure], fullDate(outcome.to)));
  // edit() renders synchronously, so the replacement block already exists:
  // focus it now rather than in a later frame, or a held-down arrow key would
  // land on the detached node and be lost.
  if (options.keepFocus) {
    const next = document.querySelector(
      `.tl-block[data-measure="${measure}"][data-date="${outcome.to}"]`);
    if (next) next.focus();
  }
  requestRun();
}

function changeSetting(key, value) {
  const clamped = clampSetting(key, value);
  if (clamped === null) return;
  const state = getState();
  if (state.settings[key] === clamped) return;
  edit({ settings: { ...state.settings, [key]: clamped } }, "settings");
  requestRun();
}

/* -- climate ------------------------------------------------------------- */

async function useClimateText(text, name, options = {}) {
  const parsed = parseClimate(text, options);
  if (!parsed.ok) {
    if (parsed.reason === "ambiguous-dates") {
      set({ message: {
        kind: "info", text: "How are dates written in your file?",
        actions: [
          { label: "Day/Month/Year", run: () => useClimateText(text, name, { order: "day" }) },
          { label: "Month/Day/Year", run: () => useClimateText(text, name, { order: "month" }) },
        ],
      } });
      return;
    }
    set({ message: { kind: "error", text: parsed.reason } });
    return;
  }

  if (parsed.years.length > 1 && !options.year) {
    set({ message: {
      kind: "info", text: `This file covers ${parsed.years[0]}–${parsed.years[parsed.years.length - 1]}. Choose one year to plan for.`,
      actions: parsed.years.map((year) => ({
        label: year,
        run: () => useClimateText(toCsv(selectYear(parsed.rows, year)), name, { year: Number(year) }),
      })),
    } });
    return;
  }

  if (parsed.stats.looksFahrenheit && !options.converted) {
    set({ message: {
      kind: "info", text: strings.fahrenheit(parsed.stats.mean.toFixed(0)),
      actions: [
        { label: strings.convertToCelsius,
          run: () => useClimateText(toCsv(convertFahrenheit(parsed.rows)), name, { ...options, converted: true }) },
        { label: strings.alreadyCelsius,
          run: () => useClimateText(text, name, { ...options, converted: true }) },
      ],
    } });
    return;
  }

  const csv = toCsv(parsed.rows);
  pendingClimate = { csv, name, parsed, isExample: Boolean(options.isExample) };
  set({ message: null });
  engine.submit({ type: "climate", tempCsv: csv }, `climate:${name}:${parsed.rows.length}`);
}

function onClimateLoaded(payload) {
  if (!payload.ok) {
    set({ message: { kind: "error", text: "This file could not be used.", detail: payload.message } });
    pendingClimate = null;
    return;
  }
  const info = pendingClimate;
  const stats = info.parsed.stats;
  const previousYear = getState().climate && getState().climate.year;
  const climate = {
    name: info.name,
    csv: info.csv,
    key: payload.climateKey,
    year: payload.year,
    dates: payload.dates,
    temperature: payload.temperature,
    isExample: info.isExample,
    summary: strings.fileSummary(info.name, payload.year, stats.days,
      stats.min.toFixed(1), stats.max.toFixed(1), stats.mean.toFixed(1)),
  };
  pendingClimate = null;

  const state = getState();
  const plan = state.plan;
  const hasPlan = !isEmptyPlan(plan);
  if (hasPlan && previousYear && previousYear !== climate.year) {
    // Never drop the plan silently: offer to carry it across.
    const moved = Object.fromEntries(MEASURES.map((measure) => [
      measure, plan[measure].map((date) => `${climate.year}${date.slice(4)}`)
        .filter((date) => climate.dates.includes(date)),
    ]));
    set({ climate, result: null, message: {
      kind: "info", text: strings.yearChanged(previousYear, climate.year),
      actions: [
        { label: strings.movePlan(climate.year),
          run: () => { edit({ plan: moved }, "move plan"); set({ message: null }); requestRun({ immediate: true }); } },
        { label: strings.startNewPlan,
          run: () => { edit({ plan: { larvicide: [], adulticide: [], habitat: [] } }, "clear plan");
                       set({ message: null }); requestRun({ immediate: true }); } },
      ],
    } });
    return;
  }

  set({ climate, result: null });
  canvas.frame.setDates(climate.dates);
  requestRun({ immediate: true });
}

/* -- views, exports, boot ------------------------------------------------ */

function setView(view) {
  const state = getState();
  if (!state.climate) return;
  const data = viewData(state);
  const dates = state.climate.dates;
  if (view === "season" && data) {
    const runs = data.metrics.runsBefore;
    if (runs.length) {
      const from = Math.max(0, runs[0][0] - 30);
      const to = Math.min(dates.length - 1, runs[runs.length - 1][1] + 30);
      canvas.setWindow(from, to);
    } else {
      const peak = data.riskBefore.indexOf(data.metrics.peakBefore);
      canvas.setWindow(Math.max(0, peak - 60), Math.min(dates.length - 1, peak + 60));
    }
  } else {
    canvas.setWindow(0, dates.length - 1);
  }
  set({ view });
  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
}

function setupEditors() {
  timeline = new Timeline($("timeline"), canvas.frame, {
    onMove: moveApplication,
    onAdd: (measure, date, touch) => addApplication(measure, date, touch, null),
    onRemove: removeApplication,
    onOpen: (measure, date, anchor) => {
      const state = getState();
      openPopover({
        anchor, measure, date, dates: state.climate.dates,
        onCommit: (chosen) => moveApplication(measure, date, chosen),
        onRemove: () => removeApplication(measure, date),
        onSeries: (start, interval, times) => {
          const wanted = seriesDates(start, interval, times, state.climate.dates);
          const outcome = withDates(state.plan, measure, wanted, state.climate.year);
          edit({ plan: outcome.plan }, `${MEASURE_NAMES[measure]} series`);
          requestRun();
        },
      });
    },
    onRefresh: () => render(getState()),
  });
}

function wireExports() {
  const data = () => viewData(getState());
  const stamp = () => {
    const state = getState();
    return strings.stamp(state.modelSha || "unknown", new Date().toISOString().slice(0, 10));
  };
  $("export-schedule").onclick = () => {
    const state = getState();
    download("control_schedule.csv", scheduleCsv(state.plan, state.settings), "text/csv");
  };
  $("export-daily").onclick = () =>
    download("daily_results.csv", dailyCsv(data()), "text/csv");
  $("export-summary").onclick = async () => {
    const text = summaryText(data(), $("site-name").value);
    try { await navigator.clipboard.writeText(text); announce("Summary copied."); }
    catch (_) { download("summary.txt", text, "text/plain"); }
  };
  $("export-metadata").onclick = () => {
    const state = getState();
    download("run_metadata.json", metadataJson(data(), {
      modelSha: state.modelSha, pyodide: state.pyodideVersion, memo: state.memo,
    }), "application/json");
  };
  $("export-figure").onclick = async () => {
    try {
      const caption = `${$("site-name").value || getState().climate.name} · ${stamp()} · Modelled index, not a forecast of cases.`;
      const blob = await figurePng(document.querySelector(".lanes"), caption);
      const url = URL.createObjectURL(blob);
      const anchor = el("a", { href: url, download: "aedes_control_figure.png" });
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      set({ message: { kind: "error", text: "The figure could not be exported.", detail: String(error.message) } });
    }
  };
  $("export-desktop").onclick = () => {
    for (const file of desktopDateFiles(getState().plan)) {
      download(file.name, file.text, "text/csv");
    }
  };
  $("print").onclick = () => window.print();
}

function wireInputs() {
  const fileInput = $("temp-file");
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) useClimateText(await file.text(), file.name);
  });

  const drop = $("dropzone");
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("over"));
  }
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) useClimateText(await file.text(), file.name);
  });

  $("use-example").onclick = async () => {
    const text = await fetch("sample_climate_csv/sample_temperature_2026.csv").then((r) => r.text());
    await useClimateText(text, "sample_temperature_2026.csv", { isExample: true });
    if (isEmptyPlan(getState().plan)) {
      edit({ plan: {
        larvicide: ["2026-06-25"],
        adulticide: ["2026-07-20", "2026-08-05"],
        habitat: ["2026-07-09"],
      } }, "example plan");
    }
  };

  $("template").onclick = () => {
    const year = new Date().getFullYear();
    download(`temperature_template_${year}.csv`, templateCsv(year), "text/csv");
  };

  $("paste-apply").onclick = () => {
    const text = $("paste-area").value;
    if (text.trim()) useClimateText(text, "pasted data");
  };

  $("undo").onclick = () => { const label = undo(); if (label) { announce(`Undone: ${label}`); requestRun(); } };
  $("redo").onclick = () => { const label = redo(); if (label) { announce(`Redone: ${label}`); requestRun(); } };
  $("update-now").onclick = () => requestRun({ immediate: true });
  $("auto-update").onchange = (event) => {
    set({ autoUpdate: event.target.checked });
    if (event.target.checked) requestRun();
  };

  for (const button of document.querySelectorAll("[data-view]")) {
    button.onclick = () => setView(button.dataset.view);
  }

  document.addEventListener("keydown", (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const label = event.shiftKey ? redo() : undo();
      if (label) { announce(`${event.shiftKey ? "Redone" : "Undone"}: ${label}`); requestRun(); }
    }
  });

  $("canvas").addEventListener("keydown", (event) => canvas.handleKey(event));
}

function boot() {
  canvas = new Canvas($("canvas"));
  wireInputs();
  wireExports();

  engine = new Engine("web/worker.js", {
    onBoot: ({ done }) => set({ bootFiles: done }),
    onReady: (message) => set({
      status: "ready", memo: message.memo, modelSha: message.modelSha,
      pyodideVersion: message.versions.pyodide,
    }),
    // Progress arrives several times a second. It must not go through the
    // store: a full re-render per tick is wasted work, and it would pull
    // keyboard focus off the block the user is moving.
    onProgress: (message) => showProgress(message),
    onClimate: onClimateLoaded,
    onResult: applyResult,
    onFatal: (message) => set({
      status: "failed", pending: false,
      message: { kind: "error",
                 text: message === "out of memory" ? strings.errorMemory : strings.errorStart,
                 detail: message },
    }),
  });

  subscribe(render);
  render(getState());
}

boot();
