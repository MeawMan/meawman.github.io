/* Runs the gaplens Python package with Pyodide and answers the page's API requests (see bridge.js). */
"use strict";
var VERSIONS = ["0.27.7", "0.26.4"];  /* tried in order; each is served by cdn.jsdelivr.net */
var pyodide = null, call = null, runNext = null, pendingIds = null;

function status(text, frac) { postMessage({ type: "status", text: text, frac: frac }); }

async function boot() {
  var version = null;
  for (var i = 0; i < VERSIONS.length && !version; i++) {
    try { importScripts("https://cdn.jsdelivr.net/pyodide/v" + VERSIONS[i] + "/full/pyodide.js"); version = VERSIONS[i]; } catch (e) { /* try the next one */ }
  }
  if (!version) throw new Error("Python (Pyodide) could not be downloaded from cdn.jsdelivr.net.");
  status("Starting Python (Pyodide " + version + ")", 0.1);
  pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v" + version + "/full/" });
  status("Loading numpy, pandas and scipy", 0.25);
  await pyodide.loadPackage(["numpy", "pandas", "scipy"]);
  status("Loading scikit-learn and statsmodels", 0.55);
  await pyodide.loadPackage(["scikit-learn", "statsmodels"]);
  status("Loading GapLens", 0.85);
  var r = await fetch("gaplens.zip", { cache: "no-cache" });
  if (!r.ok) throw new Error("gaplens.zip was not found next to the page (HTTP " + r.status + ").");
  pyodide.unpackArchive(await r.arrayBuffer(), "zip", { extractDir: "/home/pyodide/app" });
  pyodide.globals.set("_progress", function (jid, done, total, message) { postMessage({ type: "progress", jid: jid, done: done, total: total, message: message }); });
  pyodide.runPython([
    "import sys, json, time",
    "sys.path.insert(0, '/home/pyodide/app')",
    "import gaplens, gaplens.webapp as W",
    "W.SYNC_JOBS = True",
    "W.PROGRESS_HOOK = _progress",
    "def _call(method, path, query_json, body_js):",
    "    body = body_js.to_bytes() if body_js is not None else b''",
    "    code, ctype, out, headers = W.dispatch(method, path, json.loads(query_json), body)",
    "    return code, ctype, out, json.dumps(headers), json.dumps([p[0] for p in W.PENDING])",
    "def _run_next():",
    "    if not W.PENDING:",
    "        return ''",
    "    jid, fn, args, kw = W.PENDING.pop(0)",
    "    W.JOBS[jid]['t0'] = time.time()",
    "    W._run_job(jid, fn, args, kw)",
    "    return jid",
    "def _pending():",
    "    return json.dumps([p[0] for p in W.PENDING])",
  ].join("\n"));
  call = pyodide.globals.get("_call");
  runNext = pyodide.globals.get("_run_next");
  pendingIds = pyodide.globals.get("_pending");
  var v = pyodide.runPython("gaplens.__version__");
  var n = pyodide.runPython("from gaplens.methods import REGISTRY\nlen(REGISTRY)");
  status("Ready", 1);
  postMessage({ type: "ready", pyodide: version, gaplens: v, methods: n });
}

var booted = boot().catch(function (e) { postMessage({ type: "fatal", error: String((e && e.message) || e) }); throw e; });

function runPending() {
  for (;;) {
    var ids = JSON.parse(pendingIds());
    if (!ids.length) return;
    postMessage({ type: "jobstart", jid: ids[0] });
    var jid = runNext();
    postMessage({ type: "jobdone", jid: jid });
  }
}

self.onmessage = async function (e) {
  var m = e.data;
  if (m.type !== "req") return;
  try { await booted; } catch (err) {
    var b = new TextEncoder().encode(JSON.stringify({ error: "Python did not start: " + err.message }));
    postMessage({ type: "reply", id: m.id, status: 503, ctype: "application/json", body: b.buffer, headers: {} }, [b.buffer]);
    return;
  }
  var res = null, out = null;
  try {
    res = call(m.method, m.path, JSON.stringify(m.query || {}), m.body ? new Uint8Array(m.body) : null);
    var code = res.get(0), ctype = res.get(1), headers = JSON.parse(res.get(3)), queued = JSON.parse(res.get(4));
    out = res.get(2);
    var buf = out.getBuffer("u8"), data = buf.data.slice(); buf.release();
    postMessage({ type: "reply", id: m.id, status: code, ctype: ctype, body: data.buffer, headers: headers, queued: queued }, [data.buffer]);
    if (queued.length) setTimeout(runPending, 0);
  } catch (err) {
    var eb = new TextEncoder().encode(JSON.stringify({ error: "Browser runtime error: " + String((err && err.message) || err) }));
    postMessage({ type: "reply", id: m.id, status: 500, ctype: "application/json", body: eb.buffer, headers: {} }, [eb.buffer]);
  } finally {
    if (out) out.destroy();
    if (res) res.destroy();
  }
};
