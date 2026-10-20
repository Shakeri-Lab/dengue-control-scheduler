/* The track-record column: how the model has done at sites that went on to
   have locally acquired dengue.

   The misses are rendered with the same weight as the hits. A panel that
   showed only the successes would be the overclaiming the page's own
   limitations note warns against. */

import { el } from "./dom.js";
import { fullDate, shortDate } from "./format.js";

const VERDICT = {
  timing:   { label: "Timing matched",     tone: "good" },
  negative: { label: "Correctly ruled out", tone: "good" },
  miss:     { label: "Missed",             tone: "bad" },
  context:  { label: "Not a usable test",  tone: "flat" },
};

function windowText(block) {
  if (!block) return null;
  if (!block.window) return `stayed below the threshold (peak R0 ${block.peak.toFixed(2)})`;
  return `${shortDate(block.window[0])} – ${shortDate(block.window[1])} ` +
         `(peak R0 ${block.peak.toFixed(2)} on ${shortDate(block.peakDate)})`;
}

function entryCard(entry) {
  const verdict = VERDICT[entry.verdict] || VERDICT.context;
  const rows = [];

  const modelText = windowText(entry.model);
  if (modelText) rows.push(["Model said", modelText]);

  const cases = entry.cases === 1 ? "1 locally acquired case"
    : `${entry.cases} locally acquired cases`;
  const firstSeen = entry.observed.first
    ? `first ${fullDate(entry.observed.first)}` : null;
  rows.push(["What happened",
    [cases, firstSeen, entry.observed.peakMonth ? `peak ${entry.observed.peakMonth}` : null]
      .filter(Boolean).join(", ")]);

  if (entry.lead !== null && entry.lead !== undefined) {
    rows.push(["Warning time", entry.lead >= 0
      ? `window opened ${entry.lead} days before the first case`
      : `window opened ${Math.abs(entry.lead)} days after the first case`]);
  }
  if (entry.forecast) {
    rows.push(["From climatology alone", windowText(entry.forecast)]);
  }

  return el("article", { class: `case case-${verdict.tone}` }, [
    el("header", { class: "case-head" }, [
      el("span", { class: `case-verdict ${verdict.tone}`, text: verdict.label }),
      el("h4", { text: `${entry.site}, ${entry.year}` }),
    ]),
    el("p", { class: "case-headline", text: entry.headline }),
    el("dl", { class: "case-rows" }, rows.flatMap(([term, value]) => [
      el("dt", { text: term }),
      el("dd", { text: value }),
    ])),
    el("p", { class: "case-note", text: entry.comment }),
    entry.observed.note
      ? el("p", { class: "case-source", text: entry.observed.note })
      : null,
  ]);
}

export async function renderCaseStudies(host) {
  let data;
  try {
    data = await fetch("web/casestudies.json").then((response) => response.json());
  } catch (error) {
    host.hidden = true;                       // absent data is not an error
    return;
  }

  host.replaceChildren(
    el("h2", { id: "h-track", text: data.title }),
    el("p", { class: "case-claim", text: data.claim }),
    el("p", { class: "case-caveat", text: data.caveat }),
    el("div", { class: "case-list" }, data.entries.map(entryCard)),
    el("details", { class: "case-method" }, [
      el("summary", { text: "How this was checked" }),
      el("p", { text: data.summary }),
      el("ul", {}, data.sources.map((source) => el("li", {}, [
        el("a", { href: source.url, text: source.label, rel: "noreferrer" }),
      ]))),
      el("p", { class: "case-source", text: `Compiled ${data.generated}.` }),
    ]),
  );
  host.hidden = false;
}
