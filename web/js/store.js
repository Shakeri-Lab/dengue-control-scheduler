/* One store, with undo. Nothing renders from a DOM read, so an edit can never
   lose keyboard focus the way the previous rebuild-everything approach did. */

export const MEASURES = ["larvicide", "adulticide", "habitat"];

export const DEFAULT_SETTINGS = {
  ls_ef: 0.05, len_lr: 15,     // larvicide: added mortality per day, active days
  is_ef: 0.05, len_ins: 2,     // adulticide
  cl_ef: 0.3,  len_cr: 20,     // habitat: fraction removed, recovery time
};

// Recovery times below about 1.4 days overflow the model's habitat profile to
// NaN (exp(tau / len_cr) with tau up to ~960), so the floor is 2.
export const LIMITS = {
  ls_ef: [0, 1], is_ef: [0, 1], cl_ef: [0, 1],
  len_lr: [1, 365], len_ins: [1, 365], len_cr: [2, 365],
};

const initialState = {
  status: "booting",            // booting | ready | failed
  memo: false,
  modelSha: null,
  climate: null,                // {name, year, dates, temperature, key, isExample}
  settings: { ...DEFAULT_SETTINGS },
  plan: { larvicide: [], adulticide: [], habitat: [] },
  baseline: null,               // result of the empty plan for this climate
  result: null,                 // current result, or null while none is valid
  pending: false,
  bootFiles: 0,
  message: null,                // {kind, text, detail}
  view: "year",                 // year | season
  autoUpdate: true,
};

let state = Object.freeze({ ...initialState });
const listeners = new Set();
const past = [];
const future = [];
const UNDO_LIMIT = 50;

export const getState = () => state;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next) {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

/** Change state without touching the undo history (results, progress, status). */
export function set(patch) {
  commit({ ...state, ...patch });
}

/** Change the plan or settings, recording an undo step. */
export function edit(patch, label) {
  past.push({ plan: state.plan, settings: state.settings, label });
  if (past.length > UNDO_LIMIT) past.shift();
  future.length = 0;
  commit({ ...state, ...patch });
}

export function undo() {
  const entry = past.pop();
  if (!entry) return null;
  future.push({ plan: state.plan, settings: state.settings, label: entry.label });
  commit({ ...state, plan: entry.plan, settings: entry.settings });
  return entry.label;
}

export function redo() {
  const entry = future.pop();
  if (!entry) return null;
  past.push({ plan: state.plan, settings: state.settings, label: entry.label });
  commit({ ...state, plan: entry.plan, settings: entry.settings });
  return entry.label;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export const lastUndoLabel = () => (past.length ? past[past.length - 1].label : null);
