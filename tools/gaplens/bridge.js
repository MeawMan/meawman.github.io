/* GapLens in the browser: the page's /api/ requests are answered by the real gaplens Python package,
   running in a Web Worker with Pyodide, instead of a server. Loaded before the page script. */
(function () {
  "use strict";
  var worker = null;
  var seq = 0, waiting = new Map(), running = new Map(), readyResolve, readyReject;
  var ready = new Promise(function (res, rej) { readyResolve = res; readyReject = rej; });
  ready.catch(function () {});

  /* loading card */
  var css = document.createElement("style");
  css.textContent = ".gl-boot{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:50;width:min(360px,calc(100vw - 32px));background:var(--sheet,#fafbfa);color:var(--ink,#11303a);border:1px solid var(--rule,#c9d6d1);border-radius:6px;padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.12);font:14px/1.45 var(--text,system-ui,sans-serif)}" +
    ".gl-boot b{display:block;font:600 1.02rem/1.2 var(--display,system-ui,sans-serif);margin-bottom:4px}.gl-boot progress{width:100%;height:8px;margin:8px 0 4px;accent-color:var(--obs,#1f5f94)}.gl-boot small{color:var(--mute,#566b72)}.gl-boot.err{border-color:var(--bad,#b3261e)}.gl-boot.err b{color:var(--bad,#b3261e)}";
  document.head.appendChild(css);
  var card = document.createElement("div");
  card.className = "gl-boot"; card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite");
  var BOOT_HTML = '<b>Starting GapLens</b><span class="gl-txt">Loading Python in your browser</span><progress class="gl-bar" max="1" value="0.03"></progress><small>The first visit downloads about 40 MB (Python, numpy, pandas, scipy, scikit-learn, statsmodels). Later visits load from the browser cache. Your data stay in this browser.</small>';
  function mount() { if (!card.isConnected) document.body.appendChild(card); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  /* On a phone, a metered or slow connection, wait for a tap before downloading Python (about 40 MB the first time).
     After one successful start the files are in the browser cache, so later visits start straight away. */
  var LOADED_KEY = "gaplens_python_cached";
  function lite() {
    try { if (localStorage.getItem(LOADED_KEY) === "1") return false; } catch (e) { /* ignore */ }
    var c = navigator.connection || {};
    return !!(c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || "") || c.type === "cellular" || matchMedia("(pointer: coarse) and (max-width: 900px)").matches);
  }
  function start() {
    if (worker) return;
    card.innerHTML = BOOT_HTML;
    worker = new Worker("worker.js");
    worker.onmessage = onMessage;
    worker.onerror = function (e) { onMessage({ data: { type: "fatal", error: "The worker failed: " + (e.message || "unknown error") } }); };
  }
  if (lite()) {
    card.innerHTML = '<b>Start GapLens</b><span class="gl-txt">GapLens runs real Python in your browser. The first start downloads about 40 MB, so it waits for you.</span>' +
      '<button type="button" class="gl-go" style="margin:10px 0 6px;font:inherit;font-weight:600;padding:8px 14px;border-radius:6px;border:1px solid var(--obs,#1f5f94);background:var(--obs,#1f5f94);color:#fff;cursor:pointer">Start GapLens (about 40 MB)</button>' +
      '<small>Your data stay in this browser. After the first start the files are cached, so it opens straight away next time.</small>';
    card.querySelector(".gl-go").addEventListener("click", start);
  } else start();
  window.GapLensStart = start;

  function onMessage(e) {
    var m = e.data;
    if (m.type === "status") { card.querySelector(".gl-txt").textContent = m.text; card.querySelector(".gl-bar").value = m.frac; }
    else if (m.type === "ready") { card.remove(); window.GAPLENS_RUNTIME = m; try { localStorage.setItem(LOADED_KEY, "1"); } catch (x) { /* ignore */ } readyResolve(m); }
    else if (m.type === "fatal") {
      card.classList.add("err");
      card.innerHTML = "<b>GapLens could not start</b><span></span><small>Reload the page to try again. The page needs an internet connection on the first visit to load Python from cdn.jsdelivr.net.</small>";
      card.querySelector("span").textContent = m.error; readyReject(new Error(m.error));
    }
    else if (m.type === "reply") { var cb = waiting.get(m.id); waiting.delete(m.id); (m.queued || []).forEach(function (j) { running.set(j, { done: 0, total: 0, message: "waiting", t0: performance.now() }); }); if (cb) cb(m); }
    else if (m.type === "jobstart" && running.has(m.jid)) { running.get(m.jid).message = "starting"; }
    else if (m.type === "progress" && running.has(m.jid)) { var r = running.get(m.jid); r.done = m.done; r.total = m.total; r.message = m.message; }
    else if (m.type === "jobdone") { running.delete(m.jid); }
  }

  function call(method, path, query, body) {
    return ready.then(function () {
      return new Promise(function (res) {
        var id = ++seq; waiting.set(id, res);
        worker.postMessage({ type: "req", id: id, method: method, path: path, query: query, body: body || null }, body ? [body] : []);
      });
    });
  }

  function respond(m) {
    var h = Object.assign({ "Content-Type": m.ctype }, m.headers || {});
    return new Response(m.body, { status: m.status, headers: h });
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var s = typeof input === "string" ? input : (input && input.url) || "";
    if (s.indexOf("/api/") !== 0) return realFetch(input, init);
    var u = new URL(s, "http://gaplens.local");
    var query = {}; u.searchParams.forEach(function (v, k) { query[k] = v; });
    var method = ((init && init.method) || "GET").toUpperCase();
    if (u.pathname === "/api/job" && running.has(query.id)) {  /* the worker is busy with this job: answer from the progress it reports */
      var r = running.get(query.id);
      return Promise.resolve(new Response(JSON.stringify({ id: query.id, status: "running", done: r.done, total: r.total, message: r.message, elapsed: (performance.now() - r.t0) / 1000 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    var body = init && init.body;
    var prep;
    if (body == null) prep = Promise.resolve(null);
    else if (typeof body === "string") prep = Promise.resolve(new TextEncoder().encode(body).buffer);
    else if (body instanceof ArrayBuffer) prep = Promise.resolve(body.slice(0));
    else if (ArrayBuffer.isView(body)) prep = Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    else prep = new Response(body).arrayBuffer();
    // uploads: Excel and hydrometric (e.g. BWDB) files are reshaped into a plain table first; what was done is shown as notes
    var notes = [];
    if (u.pathname === "/api/upload" && window.GapLensImport) {
      prep = prep.then(function (buf) {
        return window.GapLensImport.prepare(buf, query.name || "", query.kind || "data").then(function (r) { notes = r.notes; return r.buf; });
      });
    }
    return prep.then(function (buf) { return call(method, u.pathname, query, buf); }).then(function (m) {
      if (notes.length && /json/.test(m.ctype || "") && m.status === 200) {
        try {
          var j = JSON.parse(new TextDecoder().decode(m.body));
          if (j && !j.error) { j.warnings = notes.concat(j.warnings || []); m.body = new TextEncoder().encode(JSON.stringify(j)).buffer; }
        } catch (x) { /* leave the reply as it is */ }
      }
      return respond(m);
    }, function (err) {
      return new Response(JSON.stringify({ error: String((err && err.message) || err) }), { status: 400, headers: { "Content-Type": "application/json" } });
    });
  };

  /* links to /api/download and /api/report: fetch through the worker and save the file */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    window.fetch(a.getAttribute("href")).then(function (r) {
      return r.blob().then(function (blob) {
        if (!r.ok) { return blob.text().then(function (t) { var msg = t; try { msg = JSON.parse(t).error || t; } catch (x) {} throw new Error(msg); }); }
        var cd = r.headers.get("Content-Disposition") || "";
        var name = (cd.match(/filename="([^"]+)"/) || [])[1] || "gaplens_download";
        var url = URL.createObjectURL(blob), x = document.createElement("a");
        x.href = url; x.download = name; document.body.appendChild(x); x.click(); x.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      });
    }).catch(function (err) { window.console && console.error(err); var t = a.textContent; a.textContent = "Download failed: " + err.message; setTimeout(function () { a.textContent = t; }, 6000); });
  }, true);
})();
