// app.js - application shell: state, navigation, Web Worker client, theme/mode, project files.
// Each step lives in src/ui/pages/<name>.js and exports render(ctx).

import { $, $$, h, toast, download } from './dom.js';
import { SOFTWARE, DEFAULT_SETTINGS } from '../core/analysis.js';
import * as dataPage from './pages/data.js';
import * as checksPage from './pages/checks.js';
import * as fitPage from './pages/fit.js';
import * as designPage from './pages/design.js';
import * as reportPage from './pages/report.js';
import * as potPage from './pages/pot.js';
import * as nonstatPage from './pages/nonstat.js';
import * as aboutPage from './pages/about.js';
import { PRESETS } from './pages/fit.js';

const PAGES = { data: dataPage, checks: checksPage, fit: fitPage, design: designPage, report: reportPage, pot: potPage, nonstat: nonstatPage, about: aboutPage };
const ORDER = ['data', 'checks', 'fit', 'design', 'report'];

export const state = {
  page: 'data',
  mode: 'guided',
  data: null,          // { name, table, map, kind, units, site, series: {values, years}, daily: {records}, ams: {...}, comments }
  settings: structuredClone(DEFAULT_SETTINGS),
  results: null,       // output of runAnalysis (from the worker)
  selected: null,      // index of the selected fit
  plot: { paper: 'gumbel', logY: false },
  pot: {}, nonstat: {},
  dirty: false,
};
state.settings.fits = PRESETS.recommended.fits().map(([distId, method]) => ({ distId, method }));

// ------------------------------------------------------------------ worker client
let worker = null, seq = 0;
const pending = new Map();
function newWorker() {
  worker = new Worker(new URL('../worker/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const { id, type } = ev.data, p = pending.get(id);
    if (!p) return;
    if (type === 'progress') p.onProgress?.(ev.data);
    else { pending.delete(id); type === 'result' ? p.resolve(ev.data.result) : p.reject(new Error(ev.data.message)); }
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Worker error')); pending.clear(); };
}
newWorker();

/** Run a worker command; shows a progress bar with a Cancel button inside `host` (optional). */
export function runInWorker(msg, host) {
  const id = ++seq;
  let ui = null;
  if (host) {
    const bar = h('i'), label = h('span', {}, 'Starting…');
    const cancel = h('button', { class: 'btn danger', type: 'button', onclick: () => cancelAll() }, 'Cancel');
    ui = h('div', { class: 'progress', role: 'status' }, label, h('span', { class: 'bar' }, bar), cancel);
    ui._bar = bar; ui._label = label;
    host.prepend(ui);
  }
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (r) => { ui?.remove(); resolve(r); },
      reject: (e) => { ui?.remove(); reject(e); },
      onProgress: (p) => { if (ui) { ui._bar.style.width = `${Math.round(100 * (p.frac ?? 0))}%`; ui._label.textContent = p.stage ?? ''; } },
    });
    worker.postMessage({ id, ...msg });
  });
}
export function callWorker(fn, args, host) { return runInWorker({ cmd: 'call', fn, args }, host); }
function cancelAll() {
  worker.terminate();
  for (const p of pending.values()) p.reject(new Error('Cancelled'));
  pending.clear();
  newWorker();
  toast('Calculation cancelled.');
}

// ------------------------------------------------------------------ navigation
export function go(page) {
  state.page = page;
  (state.visited ??= {})[page] = true;
  $$('.page').forEach((s) => { s.hidden = s.id !== `page-${page}`; });
  $$('.staff button.step').forEach((b) => (b.dataset.page === page ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  render(page);
  const heading = $(`#page-${page} h2`);
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0 });
  try { history.replaceState(null, '', `#${page}`); } catch { /* file:// or sandbox */ }
}

export function render(page = state.page) {
  const host = $(`#page-${page}`);
  host.replaceChildren();
  try { PAGES[page].render(host, ctx); } catch (e) { console.error(e); host.append(h('div', { class: 'finding bad' }, h('span', { class: 'sym' }, '!'), h('div', {}, `This page failed to draw: ${e.message}`))); }
  updateStaff();
}

function stepDone(p) {
  if (p === 'data') return !!state.data?.series?.values?.length;
  if (p === 'checks') return !!state.results?.diagnostics;
  if (p === 'fit') return !!state.results?.fits?.length;
  if (p === 'design') return !!state.visited?.design && !!state.results?.fits;
  if (p === 'report') return !!state.reportMade;
  return false;
}
function updateStaff() {
  let level = 0;
  ORDER.forEach((p, i) => {
    const b = $(`.staff button.step[data-page="${p}"]`), done = stepDone(p);
    b.classList.toggle('done', done);
    if (done) level = i + 1;
  });
  const ol = $('#steps'), water = $('#water');
  if (ol && water) {
    const items = $$('#steps li');
    // the list is drawn bottom-up (column-reverse): water rises from the base to the last completed step
    const target = level === 0 ? 0 : ol.offsetHeight - items[level - 1].offsetTop;
    water.style.height = `${Math.max(0, Math.min(target, ol.offsetHeight))}px`;
  }
  $('#siteName').textContent = state.data ? [state.data.site, state.data.name].filter(Boolean).join(' · ') : '';
}

// ------------------------------------------------------------------ analysis
/** Inputs for runAnalysis from the current state. */
export function analysisInput() {
  const s = state.data.series;
  return { values: s.values, years: s.years, units: state.data.units, site: state.data.site };
}
export async function runFullAnalysis(host) {
  if (!state.data?.series) { toast('Enter data first.'); go('data'); return null; }
  const res = await runInWorker({ cmd: 'analyze', input: analysisInput(), settings: state.settings }, host);
  state.results = res;
  if (state.selected === null || !res.fits[state.selected]?.ok) state.selected = res.ranking.order[0] ?? null;
  state.dirty = false;
  return res;
}
/** Diagnostics only (fast): runs the analysis with no fits. */
export async function runDiagnostics(host) {
  const res = await runInWorker({ cmd: 'analyze', input: analysisInput(), settings: { ...state.settings, fits: [], ciMethod: 'none', gofBoot: 0 } }, host);
  state.results = { ...(state.results ?? {}), diagnostics: res.diagnostics, lmoments: res.lmoments, lmomentsLog: res.lmomentsLog, diagOnly: !state.results?.fits };
  return res;
}

export const ctx = { state, go, render, runInWorker, callWorker, runFullAnalysis, runDiagnostics, markDirty: () => { state.dirty = true; } };

// ------------------------------------------------------------------ mode, theme, project files
function setMode(m) {
  state.mode = m;
  document.body.classList.toggle('guided', m === 'guided');
  document.body.classList.toggle('expert', m === 'expert');
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  try { localStorage.setItem('openffa-mode', m); } catch { /* storage unavailable */ }
  render();
}
// Theme: light or dark, shared with the portfolio through the 'mrj_theme' key (set before first paint in index.html).
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mrj_theme', t); } catch { /* ignore */ }
  if (state.page) render(); // plots read their colours from CSS variables
}

export function projectJSON() {
  return {
    software: SOFTWARE, savedAt: new Date().toISOString(), format: 'openffa-project-1',
    mode: state.mode, data: state.data && { ...state.data, daily: undefined, dailyRecords: state.data.daily?.records?.map((r) => [r.date.getTime ? r.date.getTime() : r.date, r.value]) },
    settings: state.settings, plot: state.plot, selected: state.selected, pot: state.pot.settings ?? null, nonstat: state.nonstat.settings ?? null,
    resultsSummary: state.results?.fits ? state.results.fits.map((f) => ({ distId: f.distId, method: f.method, ok: f.ok, params: f.params, quantiles: f.quantiles })) : null,
  };
}
function saveProject() {
  if (!state.data) { toast('Nothing to save yet: enter data first.'); return; }
  const name = (state.data.site || state.data.name || 'openffa').replace(/[^\w.-]+/g, '_');
  download(`${name}.openffa.json`, JSON.stringify(projectJSON(), null, 1), 'application/json');
  toast('Project saved (data, settings and software version).');
}
async function openProject(file) {
  try {
    const p = JSON.parse(await file.text());
    if (p.format !== 'openffa-project-1') throw new Error('This is not an OpenFFA project file.');
    state.data = p.data;
    if (p.data?.dailyRecords) state.data.daily = { records: p.data.dailyRecords.map(([t, v]) => ({ date: new Date(t), value: v })) };
    state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...p.settings };
    state.plot = p.plot ?? state.plot; state.selected = p.selected ?? null;
    state.pot = { settings: p.pot ?? undefined }; state.nonstat = { settings: p.nonstat ?? undefined };
    state.results = null;
    if (p.mode) setMode(p.mode);
    toast(`Opened project saved with ${p.software?.name} ${p.software?.version}. Re-running the analysis…`);
    go('fit');
    await runFullAnalysis($('#page-fit'));
    go('fit');
  } catch (e) { toast(`Could not open the project: ${e.message}`, 6000); }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#versionFoot').textContent = `${SOFTWARE.name} ${SOFTWARE.version} · runs in your browser; data never leave this computer`;
  $$('.staff button.step').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#tsTheme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#saveProjectBtn').addEventListener('click', saveProject);
  $('#openProjectBtn').addEventListener('click', () => $('#projectFile').click());
  $('#projectFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openProject(f); e.target.value = ''; });
  let m = 'guided';
  try { m = localStorage.getItem('openffa-mode') || 'guided'; } catch { /* ignore */ }
  if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  state.mode = m; document.body.classList.toggle('guided', m === 'guided'); document.body.classList.toggle('expert', m === 'expert');
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  const start = (location.hash || '#data').slice(1);
  go(PAGES[start] ? start : 'data');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('resize', () => updateStaff());
});
