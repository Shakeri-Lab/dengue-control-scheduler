/* Runs the repository's unmodified Python model in the browser with Pyodide.
   Nothing is uploaded: the CSV text is handed to Python inside this worker.

   Protocol v2
     in   {v:2, type:"climate",  id, tempCsv}
          {v:2, type:"simulate", id, tempCsv, settings, plan}
     out  {type:"boot", file, fromCache, done, total}
          {type:"ready", protocol, modelSha, memo, versions}
          {type:"climate", id, payload}
          {type:"progress", id, solve, cached, frac}
          {type:"result", id, payload}
          {type:"fatal", message}
*/

const PROTOCOL = 2;
const PYODIDE_VERSION = "0.27.7";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
importScripts(PYODIDE_BASE + "pyodide.js");

// Model sources are fetched from the repository root, so the page always runs
// the same files as the desktop application.
const MODEL_FILES = [
  "Run_AEDES_AEGYPTI.py",
  "Dif_functions.py",
  "MosquitoRates.py",
  "LocationSeriesInput.py",
  "cord_to_CRofland.py",
];
const SHIM_FILES = ["numba/__init__.py", "numba/typed.py"];

let pyodide = null;
let session = null;
let driver = null;
let modelSha = null;
let memoEnabled = false;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response.text();
}

/* Pyodide 0.27 reports no byte progress, so count files instead: the resource
   timeline gives one entry per download, and transferSize 0 means it came from
   the browser cache. */
function watchDownloads() {
  const seen = new Set();
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.startsWith(PYODIDE_BASE)) continue;
        const file = entry.name.slice(PYODIDE_BASE.length);
        if (seen.has(file)) continue;
        seen.add(file);
        self.postMessage({
          type: "boot", file, fromCache: entry.transferSize === 0, done: seen.size,
        });
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch (error) {
    observer = null;   // no resource timing: boot runs without progress
  }
  return () => observer && observer.disconnect();
}

async function init() {
  const stopWatching = watchDownloads();
  pyodide = await loadPyodide({
    indexURL: PYODIDE_BASE,
    packages: ["numpy", "scipy", "pandas"],
  });

  pyodide.FS.mkdirTree("/app/pyshim/numba");
  pyodide.FS.mkdirTree("/app/py");
  const sources = {};
  for (const name of MODEL_FILES) {
    sources[name] = await fetchText(`../${name}`);
    pyodide.FS.writeFile(`/app/${name}`, sources[name]);
  }
  for (const name of SHIM_FILES) {
    pyodide.FS.writeFile(`/app/pyshim/${name}`, await fetchText(`pyshim/${name}`));
  }
  pyodide.FS.writeFile("/app/py/driver.py", await fetchText("py/driver.py"));

  // Memoization is enabled only for the exact model files it was verified
  // against; any change falls back to plain, uncached runs.
  const lock = JSON.parse(await fetchText("model.lock.json"));
  const hashes = {};
  for (const name of MODEL_FILES) hashes[name] = await sha256Hex(sources[name]);
  memoEnabled = MODEL_FILES.every((name) => lock.files[name] === hashes[name]);
  modelSha = (await sha256Hex(MODEL_FILES.map((n) => hashes[n]).join(""))).slice(0, 12);

  // Import here, not on the first run: the scipy import alone takes seconds, so
  // "ready" should mean ready.
  pyodide.runPython(`
import sys
sys.path.insert(0, "/app/pyshim")
sys.path.insert(0, "/app/py")
sys.path.insert(0, "/app")
import driver
`);
  driver = pyodide.pyimport("driver");
  session = driver.Session("/app/run", memoEnabled);

  stopWatching();
  self.postMessage({
    type: "ready",
    protocol: PROTOCOL,
    modelSha,
    memo: memoEnabled,
    versions: { pyodide: PYODIDE_VERSION },
  });
}

const ready = init().catch((error) => {
  self.postMessage({ type: "fatal", message: String(error && error.message ? error.message : error) });
  throw error;
});

function fail(id, kind, error) {
  self.postMessage({
    type: kind,
    id,
    payload: { ok: false, kind: "RuntimeError", message: String(error && error.message ? error.message : error) },
  });
}

self.onmessage = async (event) => {
  const request = event.data;
  if (!request || request.v !== PROTOCOL) return;
  try {
    await ready;
    if (request.type === "climate") {
      const raw = driver.load_climate_json(session, request.tempCsv, "");
      self.postMessage({ type: "climate", id: request.id, payload: JSON.parse(raw) });
    } else if (request.type === "simulate") {
      const progress = (solve, cached, frac) =>
        self.postMessage({ type: "progress", id: request.id, solve, cached, frac });
      const raw = driver.run_json(
        session, request.tempCsv, "",
        JSON.stringify(request.settings), JSON.stringify(request.plan), progress,
      );
      self.postMessage({ type: "result", id: request.id, payload: JSON.parse(raw) });
    }
  } catch (error) {
    fail(request.id, request.type === "climate" ? "climate" : "result", error);
  }
};
