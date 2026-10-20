/* Every user-facing string. Centralised so wording can be reviewed in one
   place, and so the page can be translated later without touching logic. */

export const MEASURE_NAMES = {
  larvicide: "Larvicide",
  adulticide: "Adulticide",
  habitat: "Breeding-site removal",
};

/** For the schedule rows, where the label shares a narrow gutter with its
    settings; the full name stays in every accessible label and popover. */
export const SHORT_NAMES = {
  larvicide: "Larvicide",
  adulticide: "Adulticide",
  habitat: "Breeding sites",
};

export const strings = {
  title: "Aedes Control",
  headline: "When is your site’s dengue high season — and how much does a control plan lower it?",
  purpose:
    "A within-season timing tool for places where Aedes aegypti is established. From " +
    "temperature alone it shows when transmission risk peaks at your site, and how much a " +
    "schedule of larvicide, adulticide or breeding-site removal brings it down.",
  privacy: "Your file is read on this device. It is never uploaded.",

  // Site strip
  siteHeading: "Site temperatures",
  fileRequirement:
    "One year of daily average air temperature in °C: a date column and a temperature " +
    "column, one row per day, 1 January to 31 December.",
  choose: "Choose a CSV file, or drop it here",
  useExample: "Use the example",
  template: "Download a blank template",
  exampleTag: "Example — not your site",
  exampleNote:
    "This is an example: sample temperatures for 2026 and a sample plan. " +
    "Load your own temperatures to plan for your site.",

  // Boot and run
  bootStart: "Preparing the model on this device. The first visit downloads about 30 MB; " +
    "later visits start faster. You can explore the example meanwhile.",
  bootProgress: (done) => `Preparing the model on this device — ${done} files loaded.`,
  exampleWhileLoading: "The example below is precomputed.",
  ready: "Model ready.",
  readyMemo: "Model ready. Changes to the plan update the results in a few seconds.",
  firstRun: "Calculating the year without control — about 30 seconds.",
  updating: "Updating results…",
  upToDate: "Results are up to date.",
  paused: "Auto-update is paused.",
  update: "Update results",
  slowDevice: (n) =>
    `This device needs about ${n} s per update, so results now update when you choose “Update results”.`,

  // Canvas
  laneRisk: "Transmission risk",
  riskAxis: "% of this site’s peak without control",
  highSeason: "High season",
  highSeasonRule: "risk at least half its peak",
  laneSchedule: "Control schedule",
  laneAdults: "Adult female mosquitoes (modelled)",
  laneTemperature: "Daily temperature (°C)",
  r0Explained:
    "Risk is the model’s transmission index (R0) as a share of its peak without control. " +
    "The shape of the season comes from temperature alone; the absolute level depends on a " +
    "breeding-site density the model assumes, so it is not shown.",
  seriesBaseline: "Without control",
  seriesPlan: "With this plan",
  bandLabel: "Reduction from this plan",
  adultsNote:
    "Model units for a reference city. Read the shape and the percentage change, not the count.",
  temperatureNote: "drives the season",
  viewFullYear: "Full year",
  viewSeason: "High season",
  showDrivers: "Show temperature and mosquito numbers",
  hideDrivers: "Hide temperature and mosquito numbers",

  noSeason: "No high season: Aedes aegypti cannot persist at this site in the model.",

  // Outcomes
  figureSeason: "High season",
  figureSeasonNote: (days) => `${days} days at or above half the peak`,
  figureSeasonRisk: "Risk across the high season",
  figurePeak: "Peak risk",
  figureWithPlan: "with this plan",
  figureNoPlan: "Add a treatment to see its effect",
  noChange: "No change",

  // Plan
  planHeading: "Control plan",
  emptyPlan:
    "No control scheduled yet. The curve shows the year without control. " +
    "Add an application to see the change.",
  emptyLane: "None scheduled.",
  add: "Add",
  addSeries: "Add a series…",
  remove: "Remove",
  undo: "Undo",
  redo: "Redo",
  settings: "Settings",
  laneSummary: (count, days, rate, unit) =>
    `${count} ${count === 1 ? "application" : "applications"} · active ${days} days · ${rate} ${unit}`,
  habitatSummary: (count, days, fraction) =>
    `${count} ${count === 1 ? "campaign" : "campaigns"} · ${fraction} removed · recovers over ${days} days`,
  planCount: (total, parts) => `This plan: ${total} ${total === 1 ? "application" : "applications"} — ${parts}.`,

  strengthLarvicide: "Added larval mortality (per day)",
  strengthAdulticide: "Added adult mortality (per day)",
  strengthHabitat: "Breeding sites removed (0–1)",
  durationLarvicide: "Active for (days)",
  durationAdulticide: "Active for (days)",
  durationHabitat: "Recovery time (days)",
  rateHelp: (rate, days) =>
    `${rate} per day means the treatment kills about ${Math.round((1 - Math.exp(-rate)) * 100)}% ` +
    `of them each day it is active, on top of natural losses — about ` +
    `${Math.round((1 - Math.exp(-rate * days)) * 100)}% of those exposed for the whole ${days} days.`,
  recoveryHelp: (days) =>
    `Sites return gradually; about two-thirds are back after ${days} days.`,
  durationShared: "Applies to every application of this measure in the plan.",
  overlapNote: "Overlapping applications are allowed; the model adds their effects.",

  // Messages
  sameDay: (measure, date) =>
    `${measure} is already scheduled for ${date}. The model counts one application per day for each measure.`,
  outsideYear: (year) => `Dates must be in ${year}, the year of your temperature file.`,
  yearChanged: (oldYear, newYear) =>
    `Your plan has dates in ${oldYear}; this file is for ${newYear}.`,
  movePlan: (year) => `Move the plan to ${year}`,
  startNewPlan: "Start a new plan",
  fahrenheit: (mean) => `These look like °F (mean ${mean}). The model needs °C.`,
  convertToCelsius: "Convert to °C",
  alreadyCelsius: "They are already °C",
  fileSummary: (name, year, days, min, max, mean) =>
    `${name} · ${year} · ${days} days · ${min} to ${max} °C, mean ${mean} °C`,

  errorStart:
    "The model could not start in this browser. Reload the page, or try a current version " +
    "of Chrome, Edge, Firefox or Safari. Your plan has been kept.",
  errorRun: "The results could not be updated. The last results are still shown.",
  errorMemory:
    "This device ran out of memory. Close other tabs and reload, or use a computer.",
  technicalDetail: "Technical detail",
  tryAgain: "Try again",

  // Limitations and provenance
  limitations:
    "A planning aid for places where Aedes aegypti is already established. It says when in " +
    "the year conditions favour transmission, and how much a schedule lowers that — not " +
    "whether an outbreak will happen. Use it alongside local surveillance and judgement.",
  aboutHeading: "About this model",
  includes:
    "Temperature-dependent development, survival and egg-laying of Aedes aegypti from egg to " +
    "adult; the effect of larvicide, adulticide and breeding-site removal on those stages; a " +
    "temperature-dependent transmission index based on adult mosquitoes per person.",
  leavesOut:
    "Rainfall (not used in this version). Local breeding-site density — the same reference " +
    "value per person is used everywhere. Human immunity, imported cases and reported case " +
    "counts. Insecticide resistance, coverage and operational limits. Cost. Year-to-year " +
    "change: the model assumes earlier years had the same temperatures.",
  bestDates:
    "This page tests the dates you choose. The desktop application can search for the dates " +
    "that lower average R0 most; that search takes 30–40 minutes.",
  stamp: (sha, date) => `Model code ${sha} · computed in your browser · ${date}`,
  citation:
    "Vajdi A, Cohnstaedt LW, Scoglio CM, Shakeri H. Optimal scheduling of dengue vector " +
    "control. Journal of Theoretical Biology 637:112617 (2027). doi:10.1016/j.jtbi.2026.112617",

  // Live region
  announceAdded: (measure, date, until) =>
    `${measure} added, ${date}, active until ${until}. Updating results.`,
  announceMoved: (measure, date) => `${measure} moved to ${date}. Updating results.`,
  announceRemoved: (measure, date) => `${measure} on ${date} removed.`,
  announceResults: (season, peak) =>
    `Results updated. Risk across the high season ${season}; peak risk ${peak}.`,
  blockName: (measure, date, until) => `${measure}, ${date}, active until ${until}`,
  blockNameHabitat: (measure, date, days) =>
    `${measure}, ${date}, sites recover over about ${days} days`,
  blockHint:
    "Press Enter for options. Arrow keys move by one day, with Shift by one week. Delete removes.",

  // Track record
  trackHeading: "Track record",
  trackLede: "Forecasts made from temperatures knowable the January before, checked against " +
    "the locally acquired cases that followed.",
  trackOpen: "Open in planner",
  trackCases: "local cases, cumulative",
  trackForecast: "January forecast",
  trackFine: "It says when, not whether: the model marks a high season wherever the " +
    "mosquito is established, whether or not an outbreak follows.",
  trackMethods: "Methods and full results",
};
