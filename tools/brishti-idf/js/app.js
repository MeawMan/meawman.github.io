/**
 * app.js — application state, worker management, navigation.
 * The analysis itself lives in pipeline.js (run in the worker); step screens live in ui/steps.js.
 */
import { DEFAULT_SETTINGS, withDefaults, TOOL_VERSION } from './pipeline.js';
import { STEPS, renderStep, kindLabel } from './ui/steps.js';
import { h, clear } from './ui/dom.js';

const state = {
  project: { name: 'Untitled project', created: new Date().toISOString() },
  settings: structuredClone(DEFAULT_SETTINGS),
  stations: [],
  results: {},       // stationId -> pipeline result
  ci: {},            // stationId -> bootstrap result
  storm: {},         // stationId -> last design storm summary
  active: null,
  step: 'data',
  mode: safeGet('brishti.mode') || 'beginner',
  dirty: new Set(),  // stations needing recomputation
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------------------
// Worker with cancel (terminate + respawn)
// ---------------------------------------------------------------------------
let worker = null;
let jobSeq = 0;
const pending = new Map();
function spawn() {
  worker = new Worker(new URL('./worker/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const { id, type } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    if (type === 'progress') p.onProgress?.(ev.data.info);
    else { pending.delete(id); type === 'result' ? p.resolve(ev.data.result) : p.reject(new Error(ev.data.message)); }
  };
  worker.onerror = (e) => { for (const [, p] of pending) p.reject(new Error(e.message || 'worker error')); pending.clear(); };
}
spawn();

function runJob(job, payload, onProgress) {
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, job, payload });
  });
}
function cancelJobs() {
  worker.terminate();
  for (const [, p] of pending) p.reject(new Error('cancelled'));
  pending.clear();
  spawn();
  setBusy(null);
}

// ---------------------------------------------------------------------------
// Busy indicator
// ---------------------------------------------------------------------------
const busyEl = () => document.getElementById('busy');
function setBusy(info) {
  const el = busyEl();
  if (!info) { el.classList.remove('on'); return; }
  el.classList.add('on');
  el.querySelector('.busy-text').textContent = info.text;
  const pr = el.querySelector('progress');
  if (info.value != null) { pr.value = info.value; pr.max = 1; } else pr.removeAttribute('value');
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
let analyseTimer = null;
let analysing = null;

function stationById(id) { return state.stations.find((s) => s.id === id); }

async function analyse(id) {
  const st = stationById(id);
  if (!st) return;
  const ctx = {};
  const calId = state.settings.disagg.calibStation;
  if (calId && calId !== id && stationById(calId)) {
    if (!state.results[calId] || state.dirty.has(calId)) await analyse(calId);
    const cr = state.results[calId];
    if (cr && cr.kind !== 'daily') ctx.calibration = { name: stationById(calId).name, rows: cr.observed.rows, returnPeriods: cr.observed.returnPeriods, ams: cr.ams };
  }
  setBusy({ text: `Analysing ${st.name}…` });
  const res = await runJob('analyse', { station: { id: st.id, name: st.name, data: st.data }, settings: state.settings, ctx },
    (info) => setBusy({ text: `${st.name}: ${info.stage}` }));
  state.results[id] = res;
  state.dirty.delete(id);
  delete state.ci[id]; // intervals belong to the previous settings
  setBusy(null);
}

/** Recompute the active station (debounced); cancels any running analysis. */
function scheduleAnalysis(delay = 350) {
  for (const s of state.stations) state.dirty.add(s.id);
  clearTimeout(analyseTimer);
  analyseTimer = setTimeout(async () => {
    if (!state.active) return render();
    if (analysing) cancelJobs();
    analysing = analyse(state.active);
    try { await analysing; } catch (e) { if (e.message !== 'cancelled') toast(`Analysis failed: ${e.message}`, 'error'); }
    analysing = null;
    render();
  }, delay);
}

async function ensureResult(id) {
  if (!state.results[id] || state.dirty.has(id)) {
    try { await analyse(id); } catch (e) { if (e.message !== 'cancelled') toast(`Analysis failed: ${e.message}`, 'error'); return null; }
  }
  return state.results[id];
}

// ---------------------------------------------------------------------------
// Public app API for the step screens
// ---------------------------------------------------------------------------
export const app = {
  state,
  version: TOOL_VERSION,
  runJob,
  cancelJobs,
  setBusy,
  ensureResult,
  result: () => (state.active ? state.results[state.active] : null),
  station: () => stationById(state.active),
  /** Update settings with a function and recompute. */
  set(fn, { recompute = true } = {}) {
    fn(state.settings);
    state.settings = withDefaults(state.settings);
    if (recompute) scheduleAnalysis(); else render();
  },
  addStations(list) {
    for (const s of list) state.stations.push(s);
    if (!state.active && list.length) state.active = list[0].id;
    for (const s of list) state.dirty.add(s.id);
    scheduleAnalysis(0);
  },
  removeStation(id) {
    state.stations = state.stations.filter((s) => s.id !== id);
    delete state.results[id]; delete state.ci[id];
    if (state.settings.disagg.calibStation === id) state.settings.disagg.calibStation = null;
    if (state.active === id) state.active = state.stations[0]?.id ?? null;
    scheduleAnalysis(0);
  },
  setActive(id) { state.active = id; if (!state.results[id] || state.dirty.has(id)) scheduleAnalysis(0); else render(); },
  go(step) { state.step = step; render(); document.querySelector('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); },
  render: () => render(),
  toast: (m, k) => toast(m, k),
  loadProjectState(p) {
    state.project.name = p.name || 'Loaded project';
    state.settings = withDefaults(p.settings);
    state.stations = p.stations.filter((s) => s.data);
    state.results = {}; state.ci = {}; state.storm = {};
    state.active = state.stations[0]?.id ?? null;
    if (p.mode) setMode(p.mode);
    scheduleAnalysis(0);
  },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  renderRail();
  const main = document.getElementById('main-content');
  clear(main);
  const after = [];
  try {
    renderStep(state.step, app, main, after);
  } catch (e) {
    console.error(e);
    main.append(h('div.note.error', `This screen failed to render: ${e.message}`));
  }
  requestAnimationFrame(() => after.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }));
}

function renderRail() {
  const nav = document.getElementById('steps');
  clear(nav);
  const res = app.result();
  for (const s of STEPS) {
    const disabled = s.needs === 'result' ? !res : s.needs === 'station' ? !state.stations.length : false;
    nav.append(h('li', { class: s.id === 'methods' ? 'sep' : null }, h('button', {
      type: 'button', 'aria-current': state.step === s.id ? 'step' : null, disabled: disabled || null,
      onclick: () => app.go(s.id), title: s.hint ? `${s.label}: ${s.hint}` : s.title,
    }, h('span.step-text', s.label, s.hint ? h('small.step-hint', s.hint) : null))));
  }
  renderStatus(res);
  const pick = document.getElementById('station-pick');
  clear(pick);
  if (state.stations.length > 1) { // one station: the project card already names it
    pick.append(h('label', { for: 'station-select' }, 'Active station'),
      h('select#station-select', { onchange: (e) => app.setActive(e.target.value) },
        state.stations.map((s) => h('option', { value: s.id, selected: s.id === state.active ? true : null }, s.name))));
  }
}

// Project card at the foot of the rail: what to do first, then what is loaded and what the analysis produced.
function renderStatus(res) {
  const box = document.getElementById('rail-status');
  if (!box) return;
  clear(box);
  const st = state.stations.find((s) => s.id === state.active);
  if (!st) {
    box.append(h('b', 'No data yet'), h('p', 'Start on ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); app.go('data'); } }, 'Your data'), ': drop a file, paste a table or try an example.'));
    return;
  }
  const rows = [['Station', st.name], ['Record', kindLabel(st)]];
  if (state.stations.length > 1) rows.push(['Stations', `${state.stations.length} in project`]);
  if (res?.ams) rows.push(['Maxima', `${res.ams.years.length} years, ${res.ams.durations.length} durations`]);
  if (res?.design?.returnPeriods?.length) { const T = res.design.returnPeriods; rows.push(['Design', `T = ${T[0]}–${T[T.length - 1]} yr`]); }
  box.append(h('b', 'This project'), h('dl', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])));
  if (!res) box.append(h('p.muted', 'Analysing…'));
}

function toast(message, kind = '') {
  const t = h(`div.note${kind ? '.' + kind : ''}`, { role: 'status', style: { position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 50, maxWidth: '28rem' } }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4000);
}

// ---------------------------------------------------------------------------
// Mode and theme
// ---------------------------------------------------------------------------
function setMode(m) {
  state.mode = m; document.body.dataset.mode = m; safeSet('brishti.mode', m);
  document.querySelectorAll('[data-mode-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeBtn === m)));
}
// Theme: light or dark, shared with the portfolio through the 'mrj_theme' key (set before first paint in index.html).
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  safeSet('mrj_theme', t);
  render(); // charts read their colours from CSS variables, so redraw them
}

document.querySelectorAll('[data-mode-btn]').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.modeBtn); render(); }));
document.getElementById('tsTheme')?.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
document.getElementById('methods-link')?.addEventListener('click', (e) => { e.preventDefault(); app.go('methods'); });
document.getElementById('cancel-job').addEventListener('click', () => { cancelJobs(); toast('Computation cancelled.'); });
setMode(state.mode);
if (!document.documentElement.getAttribute('data-theme')) {
  const saved = safeGet('mrj_theme');
  document.documentElement.setAttribute('data-theme', saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
}
document.getElementById('version').textContent = TOOL_VERSION;
render();

// Offline use after the first visit (network-first service worker; see sw.js). Not on file://.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support unavailable; the tool still works online */ });
}
