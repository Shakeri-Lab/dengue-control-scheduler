/* The track-record column: how the method's January forecast did against the
   locally acquired cases that followed. Every number comes from
   web/casestudies.json, which web/tools/make_casestudies.py generates by running
   the published model — none is written by hand here. */

import { el, svg, svgText } from "./dom.js";
import { shortDate, fullDate, MONTH_NAMES } from "./format.js";
import { strings } from "./strings.js";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function leadPhrase(days) {
  if (days >= 28 && days <= 34) return "a month";
  const weeks = Math.round(days / 7);
  return `${WORDS[weeks] || weeks} weeks`;
}

const dayIndex = (dates, iso) => {
  const index = dates.indexOf(iso);
  if (index >= 0) return index;
  // Report dates can fall after the last modelled day; clamp rather than drop.
  return iso < dates[0] ? 0 : dates.length - 1;
};

/** A small multiple: forecast risk (with its high season) over the cases that
    followed, on one shared time axis. Two lanes, never two y-axes. */
function miniChart(entry) {
  const { dates, risk_before: risk, high_season: season } = entry.model;
  const year = entry.year;
  const from = dayIndex(dates, `${year}-04-01`);
  const to = dayIndex(dates, `${year}-11-30`);
  const W = 280;
  const H = 104;
  const x = (index) => ((index - from) / (to - from)) * W;
  const peak = Math.max(...risk);

  const riskTop = 6;
  const riskBottom = 50;
  const ry = (value) => riskBottom - (riskBottom - riskTop) * (value / peak);
  const caseTop = 60;
  const caseBottom = 84;

  const node = svg("svg", {
    viewBox: `0 0 ${W} ${H}`, width: "100%", class: "mini", role: "img",
    "aria-label": `${entry.place} ${entry.year}: January forecast high season ` +
      `${season[0]} to ${season[1]}; first locally acquired case ${entry.first_case}.`,
  });

  // High season, spanning both lanes so the eye reads cases against it.
  const s0 = dayIndex(dates, season[0]);
  const s1 = dayIndex(dates, season[1]);
  node.append(svg("rect", {
    x: x(s0), y: 0, width: Math.max(1, x(s1) - x(s0)), height: caseBottom + 2,
    fill: "var(--season)", rx: 2,
  }));

  // Forecast risk, relative to its own peak.
  let line = "";
  for (let i = from; i <= to; i += 1) {
    line += `${i === from ? "M" : "L"}${x(i).toFixed(1)},${ry(risk[i]).toFixed(1)}`;
  }
  node.append(svg("path", { d: `${line}L${W},${riskBottom}L0,${riskBottom}Z`, fill: "var(--base-fill)" }));
  node.append(svg("path", { d: line, fill: "none", stroke: "var(--base-line)", "stroke-width": 1.25 }));
  node.append(svg("line", { x1: 0, x2: W, y1: riskBottom, y2: riskBottom, stroke: "var(--axis)", "stroke-width": 1 }));

  // Cases that followed: cumulative, as a step line, scaled to its final value.
  const series = entry.cumulative_by_report_week;
  const total = series[series.length - 1][1];
  const cy = (value) => caseBottom - (caseBottom - caseTop) * (value / total);
  let step = `M${x(dayIndex(dates, entry.first_case)).toFixed(1)},${caseBottom}`;
  let last = caseBottom;
  for (const [date, value] of series) {
    const px = x(dayIndex(dates, date)).toFixed(1);
    step += `L${px},${last.toFixed(1)}L${px},${cy(value).toFixed(1)}`;
    last = cy(value);
  }
  // A final total runs flat to the edge; a series still being reported stops
  // where the reports stop, so the chart never implies transmission ended.
  if (!entry.censored_after) step += `L${x(to).toFixed(1)},${last.toFixed(1)}`;
  node.append(svg("line", { x1: 0, x2: W, y1: caseBottom, y2: caseBottom, stroke: "var(--axis)", "stroke-width": 1 }));
  node.append(svg("path", { d: step, fill: "none", stroke: "var(--cases)", "stroke-width": 1.75, "stroke-linejoin": "round" }));
  if (entry.censored_after) {
    const end = x(dayIndex(dates, entry.censored_after));
    node.append(svgText({ x: end + 4, y: last + 3, class: "mini-label" },
      `to ${shortDate(entry.censored_after)}`));
  }
  const fc = x(dayIndex(dates, entry.first_case));
  node.append(svg("circle", { cx: fc, cy: caseBottom, r: 3, fill: "var(--cases)", stroke: "var(--surface)", "stroke-width": 1.5 }));

  // Lane labels sit inside the plot, top-left; month initials underneath.
  node.append(svgText({ x: 2, y: riskTop + 8, class: "mini-label" }, strings.trackForecast));
  node.append(svgText({ x: 2, y: caseTop - 2, class: "mini-label" }, strings.trackCases));
  for (let month = 4; month <= 11; month += 1) {
    const index = dayIndex(dates, `${year}-${String(month).padStart(2, "0")}-01`);
    node.append(svgText({ x: x(index) + 2, y: H - 4, class: "mini-tick" }, MONTH_NAMES[month - 1].slice(0, 1)));
  }
  return node;
}

function source(entry) {
  const first = entry.sources && entry.sources[0];
  if (!first) return null;
  return el("p", { class: "story-source" }, [
    el("span", { text: "Source: " }),
    el("a", { href: first.url, text: first.label, rel: "noopener" }),
  ]);
}

function timingStory(entry, onOpen) {
  const [from, to] = entry.model.high_season;
  return el("article", { class: "story" }, [
    el("p", { class: "story-kicker", text: `${entry.place} · ${entry.year}` }),
    el("h3", { class: "story-title",
               text: `High season forecast ${leadPhrase(entry.lead_days)} before the first local case` }),
    miniChart(entry),
    el("p", { class: "story-body",
              text: `In January the model put the high season at ${shortDate(from)} – ${shortDate(to)}. ` +
                    `The first locally acquired case came in the week of ${shortDate(entry.first_case)}; ` +
                    `${entry.local_cases} followed.` }),
    el("div", { class: "story-foot" }, [
      el("button", { type: "button", class: "link", text: `${strings.trackOpen} →`,
                     onclick: () => onOpen(entry) }),
    ]),
    source(entry),
  ]);
}

function negativeStory(entry) {
  return el("article", { class: "story" }, [
    el("p", { class: "story-kicker", text: `${entry.place} · ${entry.year}` }),
    el("h3", { class: "story-title", text: "No high season — and no outbreak" }),
    el("p", { class: "story-body",
              text: "In the model Aedes aegypti cannot persist here through the winter, so it gives no " +
                    `high season. One locally acquired case was reported on ${fullDate(entry.first_case)}; ` +
                    "health officials found no onward transmission." }),
    source(entry),
  ]);
}

export async function renderCaseStudies(host, onOpen) {
  if (!host) return;
  let data;
  try {
    data = await fetch("web/casestudies.json").then((response) => response.json());
  } catch (error) {
    return;   // the planner works without it
  }
  const stories = data.entries.map((entry) =>
    (entry.kind === "timing" ? timingStory(entry, onOpen) : negativeStory(entry)));
  host.replaceChildren(
    el("h2", { class: "track-heading", text: strings.trackHeading }),
    el("p", { class: "track-lede", text: strings.trackLede }),
    el("div", { class: "stories" }, stories),
    el("p", { class: "track-fine" }, [
      document.createTextNode(`${strings.trackFine} `),
      el("a", { href: "https://github.com/Shakeri-Lab/dengue-control-scheduler/blob/main/docs/track-record.md",
                text: `${strings.trackMethods} →` }),
    ]),
  );
  host.hidden = false;
}
