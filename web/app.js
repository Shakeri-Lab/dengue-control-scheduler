"use strict";

/* ---------- configuration ---------- */

// Defaults mirror Run_AEDES_AEGYPTI's own defaults.
const MEASURES = [
  {
    id: "larvicide", title: "Larvicide", rug: "Larvicide",
    what: "Adds mortality to larvae while the treatment is active.",
    strength: { key: "ls_ef", label: "Added larval mortality (per day)", value: 0.05, min: 0, max: 5, step: 0.01 },
    length: { key: "len_lr", label: "Active for (days)", value: 15, min: 1, max: 365, step: 1 },
    datesKey: "larvicide_dates", outFile: "larvicide_application_dates.txt",
  },
  {
    id: "adulticide", title: "Adulticide", rug: "Adulticide",
    what: "Adds mortality to adult mosquitoes while the treatment is active.",
    strength: { key: "is_ef", label: "Added adult mortality (per day)", value: 0.05, min: 0, max: 5, step: 0.01 },
    length: { key: "len_ins", label: "Active for (days)", value: 2, min: 1, max: 365, step: 1 },
    datesKey: "insecticide_dates", outFile: "insecticide_application_dates.txt",
  },
  {
    id: "habitat", title: "Habitat removal", rug: "Habitat",
    what: "Removes breeding sites, which then reappear over time.",
    strength: { key: "cl_ef", label: "Fraction of breeding sites removed (0–1)", value: 0.3, min: 0, max: 1, step: 0.05 },
    length: { key: "len_cr", label: "Recovery time (days)", value: 20, min: 1, max: 365, step: 1 },
    datesKey: "habitat_dates", outFile: "habitat_removal_application_dates.txt",
  },
];

const STEPS = {
  1: "Warming up the population (about two model years)…",
  2: "Simulating the year without control…",
  3: "Simulating the year with your plan…",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------- state ---------- */

const state = {
  ready: false, running: false, runId: 0, startedAt: 0, timer: null,
  tempCsv: null, preCsv: null, year: null,
  dates: { larvicide: [], adulticide: [], habitat: [] },
  notes: {},
  result: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/* ---------- worker ---------- */

const worker = new Worker("web/worker.js");
worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "status") setStatus(msg.message);
  else if (msg.type === "ready") { state.ready = true; setStatus("Ready."); refreshRunButton(); }
  else if (msg.type === "fatal") { setStatus(""); showError(`The Python runtime could not start: ${msg.message}`); }
  else if (msg.type === "progress" && msg.id === state.runId) state.stepText = STEPS[msg.step] || "Simulating…";
  else if (msg.type === "result" && msg.id === state.runId) finishRun(msg.payload);
};
worker.onerror = (event) => showError(`Worker error: ${event.message}`);

function setStatus(text) { $("status").textContent = text; }
function showError(text) { const box = $("error"); box.textContent = text; box.hidden = !text; }

/* ---------- climate files ---------- */

function previewCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(",");
    if (cells.length < 2) continue;
    const date = cells[0].trim().replace(/^"|"$/g, "");
    const value = Number(cells[1]);
    if (!/\d/.test(date) || cells[1].trim() === "" || !Number.isFinite(value)) continue; // header or junk
    rows.push({ date, value });
  }
  if (!rows.length) return null;
  const iso = rows[0].date.match(/(\d{4})/);
  const values = rows.map((r) => r.value);
  return {
    n: rows.length,
    year: iso ? Number(iso[1]) : null,
    min: Math.min(...values), max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

function describe(kind, info, name) {
  const box = $(kind === "temp" ? "temp-summary" : "pre-summary");
  box.hidden = false;
  box.classList.remove("warn");
  if (!info) { box.textContent = `${name}: no date,value rows found.`; box.classList.add("warn"); return; }
  let text; let warn = "";
  if (kind === "temp") {
    text = `${name}: ${info.n} days, ${info.year ?? "year ?"}; ${info.min.toFixed(1)} to ${info.max.toFixed(1)} °C, mean ${info.mean.toFixed(1)} °C.`;
    if (info.mean > 45 || info.min > 60) warn = " These values look like Fahrenheit or Kelvin; the model expects °C.";
  } else {
    text = `${name}: ${info.n} days, ${info.year ?? "year ?"}; mean ${(info.mean * 1000).toFixed(2)} mm/day.`;
    if (info.max > 1) warn = " These values look like mm/day; the model expects metres per day.";
  }
  if (info.n !== 365 && info.n !== 366) warn += " A full calendar year has 365 or 366 rows.";
  box.textContent = text + warn;
  if (warn) box.classList.add("warn");
}

function setTemperature(text, name) {
  state.tempCsv = text;
  const info = previewCsv(text);
  describe("temp", info, name);
  const year = info ? info.year : null;
  if (year !== state.year) {
    state.year = year;
    for (const m of MEASURES) state.dates[m.id] = state.dates[m.id].filter((d) => year && d.startsWith(String(year)));
    renderPlan();
  }
  $("year-note").textContent = year ? ` (${year})` : "";
  refreshRunButton();
}

function setPrecipitation(text, name) {
  state.preCsv = text;
  describe("pre", previewCsv(text), name);
}

async function readFile(input, handler) {
  const file = input.files && input.files[0];
  if (!file) return;
  handler(await file.text(), file.name);
}

$("temp-file").addEventListener("change", (e) => readFile(e.target, setTemperature));
$("pre-file").addEventListener("change", (e) => readFile(e.target, setPrecipitation));
$("use-sample").addEventListener("click", async () => {
  try {
    const [t, p] = await Promise.all([
      fetch("sample_climate_csv/sample_temperature_2026.csv").then((r) => r.text()),
      fetch("sample_climate_csv/sample_precipitation_2026.csv").then((r) => r.text()),
    ]);
    $("temp-file").value = ""; $("pre-file").value = "";
    setTemperature(t, "sample_temperature_2026.csv");
    setPrecipitation(p, "sample_precipitation_2026.csv");
    if (!MEASURES.some((m) => state.dates[m.id].length)) {
      state.dates.larvicide = ["2026-06-25"];
      state.dates.adulticide = ["2026-07-20", "2026-08-05"];
      state.dates.habitat = ["2026-07-09"];
      renderPlan();
    }
  } catch (error) { showError(`Could not load the sample files: ${error.message}`); }
});

/* ---------- control plan ---------- */

function parseDateList(text) {
  const found = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return found.filter((d) => !Number.isNaN(Date.parse(d)));
}

function addDates(measureId, list) {
  const year = state.year;
  const ok = list.filter((d) => !year || d.startsWith(String(year)));
  const merged = new Set([...state.dates[measureId], ...ok]); // the model counts a repeated date once
  state.dates[measureId] = [...merged].sort();
  const rejected = list.length - ok.length;
  // renderPlan rebuilds the cards, so the message travels through state.
  state.notes[measureId] = !list.length ? "No dates in YYYY-MM-DD form found."
    : rejected ? `${rejected} date${rejected > 1 ? "s" : ""} outside ${year} skipped.` : "";
  renderPlan();
}

function renderPlan() {
  const host = $("plan");
  const values = {};
  host.querySelectorAll("input[type=number]").forEach((i) => { values[i.id] = i.value; });
  host.replaceChildren();
  for (const m of MEASURES) {
    const numberField = (spec) => el("div", {}, [
      el("label", { for: spec.key, text: spec.label }),
      el("input", { id: spec.key, type: "number", min: spec.min, max: spec.max, step: spec.step, value: values[spec.key] ?? spec.value, inputmode: "decimal" }),
    ]);
    const dateInput = el("input", { type: "date", "aria-label": `${m.title} application date` });
    if (state.year) { dateInput.min = `${state.year}-01-01`; dateInput.max = `${state.year}-12-31`; }
    const note = el("p", { class: "hint", text: state.notes[m.id] || "" });
    const add = () => { if (dateInput.value) addDates(m.id, [dateInput.value]); };
    const chips = el("ul", { class: "chips", "aria-label": `${m.title} application dates` });
    if (!state.dates[m.id].length) chips.append(el("li", { class: "none", text: "No applications" }));
    for (const d of state.dates[m.id]) {
      chips.append(el("li", {}, [
        document.createTextNode(d),
        el("button", { type: "button", "aria-label": `Remove ${d}`, text: "×", onclick: () => { state.dates[m.id] = state.dates[m.id].filter((x) => x !== d); renderPlan(); } }),
      ]));
    }
    const paste = el("textarea", { "aria-label": `Paste ${m.title} dates`, placeholder: "2026-06-01, 2026-07-15" });
    host.append(el("div", { class: "card" }, [
      el("h3", { text: m.title }),
      el("p", { class: "what", text: m.what }),
      el("div", { class: "pair" }, [numberField(m.strength), numberField(m.length)]),
      el("label", { text: "Application dates" }),
      el("div", { class: "add-row" }, [dateInput, el("button", { type: "button", text: "Add", onclick: add })]),
      chips, note,
      el("details", {}, [
        el("summary", { text: "Paste a list of dates" }),
        paste,
        el("button", { type: "button", text: "Add all", onclick: () => addDates(m.id, parseDateList(paste.value)) }),
      ]),
    ]));
  }
}

/* ---------- run ---------- */

function refreshRunButton() {
  $("run").disabled = !(state.ready && state.tempCsv && !state.running);
}

function readParams() {
  const params = {};
  for (const m of MEASURES) {
    for (const spec of [m.strength, m.length]) {
      const value = Number($(spec.key).value);
      if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
        throw new Error(`${m.title}: "${spec.label}" must be between ${spec.min} and ${spec.max}.`);
      }
      params[spec.key] = String(value);
    }
    params[m.datesKey] = state.dates[m.id].join(",");
  }
  return params;
}

$("run").addEventListener("click", () => {
  showError("");
  let params;
  try { params = readParams(); } catch (error) { showError(error.message); return; }
  state.running = true; state.runId += 1; state.startedAt = performance.now();
  state.stepText = "Preparing…";
  state.lastParams = params;
  refreshRunButton();
  $("results").style.opacity = "0.5";
  state.timer = setInterval(() => {
    const s = Math.round((performance.now() - state.startedAt) / 1000);
    setStatus(`${state.stepText} ${s} s`);
  }, 250);
  worker.postMessage({ type: "run", id: state.runId, tempCsv: state.tempCsv, preCsv: state.preCsv, params });
});

function finishRun(payload) {
  clearInterval(state.timer);
  state.running = false;
  refreshRunButton();
  $("results").style.opacity = "";
  const seconds = Math.round((performance.now() - state.startedAt) / 1000);
  if (!payload.ok) {
    setStatus("The run stopped.");
    showError(payload.message || payload.kind);
    return;
  }
  setStatus(`Done in ${seconds} s.`);
  state.result = parseResult(payload.files);
  renderResults();
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- results ---------- */

const numbers = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map(Number);
const lines = (text) => (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function parseResult(files) {
  const dates = lines(files["dates.txt"]);
  const schedule = {};
  for (const m of MEASURES) schedule[m.id] = state.dates[m.id].length ? lines(files[m.outFile]) : [];
  return {
    files, dates, schedule,
    popBefore: numbers(files["population_before.txt"]),
    popAfter: numbers(files["population_after.txt"]),
    riskBefore: numbers(files["risk_before.txt"]),
    riskAfter: numbers(files["risk_after.txt"]),
    params: state.lastParams,
  };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const argmax = (a) => a.reduce((best, v, i) => (v > a[best] ? i : best), 0);
const fmtR = (v) => v.toFixed(2);
const fmtPop = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
const fmtDay = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };

function tile(label, value, note) {
  const v = el("div", { class: "value" });
  if (Array.isArray(value)) v.append(el("span", { class: "from", text: `${value[0]} → ` }), document.createTextNode(value[1]));
  else v.textContent = value;
  return el("div", { class: "tile" }, [el("div", { class: "label", text: label }), v, note ? el("div", { class: "note", text: note }) : null]);
}

function renderResults() {
  const r = state.result;
  $("results").hidden = false;

  const popChange = (mean(r.popAfter) / mean(r.popBefore) - 1) * 100;
  const iB = argmax(r.riskBefore); const iA = argmax(r.riskAfter);
  const above = (a) => a.filter((v) => v > 1).length;
  const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  $("tiles").replaceChildren(
    tile("Average adult population", signed(popChange), "with your plan, against no control"),
    tile("Peak R0", [fmtR(r.riskBefore[iB]), fmtR(r.riskAfter[iA])], `peaks ${fmtDay(r.dates[iB])} → ${fmtDay(r.dates[iA])}`),
    tile("Average R0 over the year", [fmtR(mean(r.riskBefore)), fmtR(mean(r.riskAfter))]),
    tile("Days with R0 above 1", [String(above(r.riskBefore)), String(above(r.riskAfter))], `of ${r.dates.length} days`),
  );

  const series = (before, after) => [
    { name: "Without control", color: "var(--series-1)", values: before },
    { name: "With your plan", color: "var(--series-2)", values: after },
  ];
  drawChart("risk", { series: series(r.riskBefore, r.riskAfter), format: (v) => v.toFixed(3), tick: (v) => String(v), refLine: { y: 1, label: "R0 = 1" }, label: "R0 by day" });
  drawChart("pop", { series: series(r.popBefore, r.popAfter), format: fmtPop, tick: fmtPop, label: "Adult female mosquitoes by day" });
  renderTable();
}

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const charts = {};

function drawChart(id, spec) {
  charts[id] = spec;
  const r = state.result;
  const host = $(`chart-${id}`);
  const legend = $(`legend-${id}`);
  legend.replaceChildren(...spec.series.map((s) => el("span", {}, [el("span", { class: "key", style: `border-color:${s.color}` }), document.createTextNode(s.name)])));

  const rugRows = MEASURES.filter((m) => r.schedule[m.id].length);
  const W = Math.max(320, host.clientWidth);
  const M = { left: 58, right: 18, top: 10 + rugRows.length * 15 + (rugRows.length ? 6 : 0), bottom: 26 };
  const H = (W < 520 ? 220 : 280) + M.top;
  const pw = W - M.left - M.right; const ph = H - M.top - M.bottom;
  const n = r.dates.length;
  const x = (i) => M.left + (pw * i) / (n - 1);
  const dataMax = Math.max(...spec.series.flatMap((s) => s.values), spec.refLine ? spec.refLine.y * 1.05 : 0);
  const ticks = niceTicks(dataMax);
  const yMax = ticks[ticks.length - 1];
  const y = (v) => M.top + ph - (ph * v) / yMax;
  const dayIndex = new Map(r.dates.map((d, i) => [d, i]));

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: "0", "aria-label": `${spec.label}: ${spec.series.map((s) => s.name).join(" and ")}. Use the left and right arrow keys to read values.` });

  for (const t of ticks) {
    svg.append(svgEl("line", { x1: M.left, x2: W - M.right, y1: y(t), y2: y(t), stroke: t === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
    const label = svgEl("text", { x: M.left - 8, y: y(t) + 4, "text-anchor": "end" }); label.textContent = spec.tick(t); svg.append(label);
  }
  r.dates.forEach((d, i) => {
    if (!d.endsWith("-01")) return;
    const month = Number(d.slice(5, 7));
    if (W < 520 && month % 2 === 0) return;
    svg.append(svgEl("line", { x1: x(i), x2: x(i), y1: M.top + ph, y2: M.top + ph + 4, stroke: "var(--axis)" }));
    const label = svgEl("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : "middle" }); label.textContent = MONTHS[month - 1]; svg.append(label);
  });

  // Application windows, one row per measure, in neutral ink.
  rugRows.forEach((m, row) => {
    const yy = 8 + row * 15;
    const label = svgEl("text", { x: M.left - 8, y: yy + 4, "text-anchor": "end", class: "rug-label" }); label.textContent = m.rug; svg.append(label);
    const length = Number(r.params[m.length.key]);
    for (const d of r.schedule[m.id]) {
      const i0 = dayIndex.get(d); if (i0 === undefined) continue;
      const i1 = Math.min(n - 1, dayIndex.get(addDaysIso(d, Math.round(length))) ?? n - 1);
      svg.append(svgEl("rect", { x: x(i0), y: yy - 2, width: Math.max(3, x(i1) - x(i0)), height: 6, rx: 2, fill: "var(--ink-muted)" }));
    }
  });

  if (spec.refLine && spec.refLine.y <= yMax) {
    const yy = y(spec.refLine.y);
    svg.append(svgEl("line", { x1: M.left, x2: W - M.right, y1: yy, y2: yy, stroke: "var(--ink-muted)", "stroke-width": 1 }));
    const label = svgEl("text", { x: W - M.right, y: yy - 5, "text-anchor": "end" }); label.textContent = spec.refLine.label; svg.append(label);
  }

  for (const s of spec.series) {
    const path = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    svg.append(svgEl("path", { d: path, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }

  const cross = svgEl("line", { y1: M.top, y2: M.top + ph, stroke: "var(--ink-muted)", "stroke-width": 1, visibility: "hidden" });
  svg.append(cross);
  const dots = spec.series.map((s) => { const c = svgEl("circle", { r: 4, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }); svg.append(c); return c; });
  const hit = svgEl("rect", { x: M.left, y: M.top, width: pw, height: ph, fill: "transparent" });
  svg.append(hit);

  const tip = $("tooltip");
  let current = -1;
  const show = (i, clientX, clientY) => {
    current = Math.max(0, Math.min(n - 1, i));
    cross.setAttribute("x1", x(current)); cross.setAttribute("x2", x(current)); cross.setAttribute("visibility", "visible");
    spec.series.forEach((s, k) => { dots[k].setAttribute("cx", x(current)); dots[k].setAttribute("cy", y(s.values[current])); dots[k].setAttribute("visibility", "visible"); });
    tip.replaceChildren(el("div", { class: "when", text: `${fmtDay(r.dates[current])} ${r.dates[current].slice(0, 4)}` }),
      ...spec.series.map((s) => el("div", { class: "row" }, [el("span", { class: "key", style: `border-color:${s.color}` }), el("b", { text: spec.format(s.values[current]) }), el("span", { class: "name", text: s.name })])));
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const px = clientX ?? box.left + (x(current) / W) * box.width;
    const py = clientY ?? box.top + (M.top / H) * box.height + 20;
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    tip.style.left = `${px + 14 + tw > window.innerWidth ? px - 14 - tw : px + 14}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - th - 8, py - th / 2))}px`;
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); tip.hidden = true; current = -1; };
  hit.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    show(Math.round(((sx - M.left) / pw) * (n - 1)), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const stepSize = e.shiftKey ? 7 : 1;
    show((current < 0 ? argmax(spec.series[0].values) : current) + (e.key === "ArrowRight" ? stepSize : -stepSize));
  });
  svg.addEventListener("blur", hide);

  host.replaceChildren(svg);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.result) for (const [id, spec] of Object.entries(charts)) drawChart(id, spec); }, 120);
});

function renderTable() {
  const r = state.result;
  const head = el("thead", {}, el("tr", {}, ["Date", "R0 without control", "R0 with plan", "Adults without control", "Adults with plan"].map((h) => el("th", { text: h, scope: "col" }))));
  const body = el("tbody");
  r.dates.forEach((d, i) => body.append(el("tr", {}, [d, r.riskBefore[i].toFixed(4), r.riskAfter[i].toFixed(4), Math.round(r.popBefore[i]).toLocaleString("en-US"), Math.round(r.popAfter[i]).toLocaleString("en-US")].map((c) => el("td", { text: c })))));
  $("data-table").replaceChildren(head, body);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("dl-csv").addEventListener("click", () => {
  const r = state.result; const f = r.files;
  const larvaeB = numbers(f["larvae_before.txt"] || ""); const larvaeA = numbers(f["larvae_after.txt"] || "");
  const rows = ["date,risk_before,risk_after,population_before,population_after,larvae_before,larvae_after"];
  r.dates.forEach((d, i) => rows.push([d, r.riskBefore[i], r.riskAfter[i], r.popBefore[i], r.popAfter[i], larvaeB[i] ?? "", larvaeA[i] ?? ""].join(",")));
  download("aedes_control_results.csv", rows.join("\n") + "\n", "text/csv");
});
$("dl-meta").addEventListener("click", () => download("run_metadata.json", state.result.files["run_metadata.json"], "application/json"));

renderPlan();
