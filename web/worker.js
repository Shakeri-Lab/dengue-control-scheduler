/* Runs the repository's unmodified Python model in the browser with Pyodide.
   Nothing is uploaded: the CSV text is handed to Python inside this worker. */

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
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

const DRIVER = `
import json, os, shutil, sys, time

APP = "/app"
sys.path.insert(0, APP + "/pyshim")
sys.path.insert(0, APP)
os.chdir(APP)


def run_fixed(temp_csv, pre_csv, params_json, progress):
    import pandas as pd
    import Run_AEDES_AEGYPTI as model
    from LocationSeriesInput import load_annual_series_csv

    p = json.loads(params_json)
    try:
        with open("user_temperature.csv", "w", encoding="utf-8") as f:
            f.write(temp_csv)
        if pre_csv:
            with open("user_precipitation.csv", "w", encoding="utf-8") as f:
                f.write(pre_csv)
        else:
            # The loader requires a precipitation series; an all-zero year on
            # the temperature calendar satisfies it.
            dates, _ = load_annual_series_csv("user_temperature.csv", return_dates=True)
            pd.DataFrame(
                {"date": dates.strftime("%Y-%m-%d"), "precipitation": 0.0}
            ).to_csv("user_precipitation.csv", index=False)

        out = "results"
        shutil.rmtree(out, ignore_errors=True)

        # Report which of the three ODE solves is running (warm-up, without
        # control, with control) without touching the model source.
        original = model.solve_ivp
        state = {"n": 0}

        def reporting_solve_ivp(*args, **kwargs):
            state["n"] += 1
            progress(state["n"])
            return original(*args, **kwargs)

        model.solve_ivp = reporting_solve_ivp
        started = time.time()
        try:
            model.Run_AEDES_AEGYPTI(
                len_ins=p["len_ins"], is_ef=p["is_ef"],
                len_lr=p["len_lr"], ls_ef=p["ls_ef"],
                len_cr=p["len_cr"], cl_ef=p["cl_ef"],
                larvicide_dates=p["larvicide_dates"],
                insecticide_dates=p["insecticide_dates"],
                habitat_dates=p["habitat_dates"],
                adtemp="user_temperature.csv",
                adpre="user_precipitation.csv",
                adsave=out,
            )
        finally:
            model.solve_ivp = original

        files = {}
        for name in sorted(os.listdir(out)):
            with open(os.path.join(out, name), encoding="utf-8") as f:
                files[name] = f.read()
        return json.dumps({"ok": True, "seconds": time.time() - started, "files": files})
    except Exception as error:  # surfaced to the page verbatim
        return json.dumps({"ok": False, "kind": type(error).__name__, "message": str(error)})
`;

let pyodide = null;
let runFixed = null;

function status(message) {
  self.postMessage({ type: "status", message });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response.text();
}

async function init() {
  status("Downloading the Python runtime (first visit only, about 35 MB)…");
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
  status("Loading NumPy, SciPy and pandas…");
  await pyodide.loadPackage(["numpy", "scipy", "pandas"]);

  status("Loading the mosquito model…");
  pyodide.FS.mkdirTree("/app/pyshim/numba");
  for (const name of MODEL_FILES) {
    pyodide.FS.writeFile(`/app/${name}`, await fetchText(`../${name}`));
  }
  for (const name of SHIM_FILES) {
    pyodide.FS.writeFile(`/app/pyshim/${name}`, await fetchText(`pyshim/${name}`));
  }
  pyodide.runPython(DRIVER);
  runFixed = pyodide.globals.get("run_fixed");
  self.postMessage({ type: "ready" });
}

const ready = init().catch((error) => {
  self.postMessage({ type: "fatal", message: String(error && error.message ? error.message : error) });
  throw error;
});

self.onmessage = async (event) => {
  const request = event.data;
  if (request.type !== "run") return;
  try {
    await ready;
    const progress = (step) => self.postMessage({ type: "progress", id: request.id, step });
    const raw = runFixed(request.tempCsv, request.preCsv || "", JSON.stringify(request.params), progress);
    self.postMessage({ type: "result", id: request.id, payload: JSON.parse(raw) });
  } catch (error) {
    self.postMessage({
      type: "result",
      id: request.id,
      payload: { ok: false, kind: "RuntimeError", message: String(error && error.message ? error.message : error) },
    });
  }
};
