// hydro.js - the Hydrology pane: DEM -> conditioned flow model (embankments, sluices, khals) -> drainage units.
import { state, on, byId, vectors, rasters } from './state.js';
import { $, h, toast, icon, fmt, download } from './ui.js';
import { EXTRA, isGeographic, metresPerDegree } from '../engine/crs.js';
import { MAX_CELLS } from '../engine/hydro.js';

let app, worker = null, seq = 0; const pending = new Map();
function call(msg, onStep) {
  if (!worker) {
    worker = new Worker(new URL(`hydroworker.js?v=${__BUILD__}`, import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; if (e.data.step != null || e.data.progress != null) { p.step(e.data.step, e.data.progress); return; } pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Hydrology worker stopped (out of memory?)')); pending.clear(); worker = null; model = null; render(); };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, step: onStep || (() => {}) }); worker.postMessage({ id, ...msg }); });
}

const P = { dem: '', cell: 'native', customCell: 90, walls: '', wallHeight: 100, sluices: '', openingRadius: 1, khals: '', khalDepth: 10, threshold: 1,
  outletSrc: 'sluices', outlets: '', snap: 60, mode: 'separate' };
let model = null; // summary of the prepared model {key, ...}
const keyOf = () => JSON.stringify([P.dem, P.cell, P.customCell, P.walls, P.wallHeight, P.sluices, P.openingRadius, P.khals, P.khalDepth, layerSig(P.walls), layerSig(P.sluices), layerSig(P.khals)]);
const layerSig = (id) => { const L = byId(id); return L ? L.fc.features.length : 0; };

function cellMetres(L) { const m = L.meta; return isGeographic(L.crs) ? m.rx * metresPerDegree((m.top + m.bottom) / 2).dx : m.rx; }
function estCells(L) {
  const m = L.meta, c = cellMetres(L), t = P.cell === 'native' ? c : P.cell === 'custom' ? +P.customCell : +P.cell;
  return m.width * m.height * (c / Math.max(c, t)) ** 2;
}

function sel(list, val, onch, none) {
  return h('select', { on: { change: (e) => { onch(e.target.value); render(); } } }, [none ? h('option', { value: '' }, none) : null, ...list.map((l) => h('option', { value: l.id, selected: l.id === val }, l.name))]);
}
const f = (label, el, hint) => h('label.f', label, el, hint ? h('span.hint', hint) : null);
const drawBtn = (kind, name, prefix, key) => h('button', { type: 'button', 'data-draw': key, title: `Draw on the map`, on: { click: async () => { const L = await app.startDraw(kind, name, { prefix, sym: kind === 'Point' ? { fill: '#ff6b8b', stroke: '#ffffff' } : { stroke: '#c46a2b', width: 3 } }); P[key] = L.id; render(); } } }, '✎ Draw');

function render() {
  const pane = $('#pane-hydro'); pane.innerHTML = '';
  const dems = rasters().filter((l) => l.sym.type === 'continuous'), lines = vectors().filter((l) => l.geom === 'line' || l.geom === 'polygon'), pts = vectors('point');
  if (!byId(P.dem)) P.dem = (dems.find((l) => l.role === 'dem') || dems[0] || {}).id || '';
  if (P.walls && !byId(P.walls)) P.walls = '';
  if (!P.walls) P.walls = (lines.find((l) => /emb|dyke|dike|bund|polder|levee|bandh|badh/i.test(l.name)) || {}).id || '';
  if (!P.sluices) P.sluices = (pts.find((l) => /sluice|regulator|gate|outlet|culvert/i.test(l.name)) || {}).id || '';
  if (P.sluices && !byId(P.sluices)) P.sluices = '';
  if (!P.khals) P.khals = (lines.find((l) => /khal|canal|river|stream|drain|channel/i.test(l.name)) || {}).id || '';
  if (P.khals && !byId(P.khals)) P.khals = '';
  pane.append(h('p.lead', 'Drainage units from a DEM, with embankments as walls, sluices as openings and outlets, and khals as channels. D8 flow, Priority-Flood filling.'));
  if (!dems.length) { pane.append(h('div.callout', h('b', 'Add a DEM first'), h('p', 'Drop a GeoTIFF DEM on the map. Embankments, sluices and khals can be added as shapefiles or drawn here.'))); return; }

  const D = byId(P.dem), est = D ? estCells(D) : 0;
  pane.append(h('section.step', h('h4', h('span.n', '1'), 'DEM and cell size'),
    f('DEM', sel(dems, P.dem, (v) => { P.dem = v; })),
    h('div.row', f('Cell size', h('select', { on: { change: (e) => { P.cell = e.target.value; render(); } } },
      [['native', `DEM's own (${D ? fmt(cellMetres(D), 1) : '?'} m)`], ['30', '30 m'], ['90', '90 m'], ['250', '250 m'], ['custom', 'Custom…']].map(([v, t]) => h('option', { value: v, selected: P.cell === v }, t)))),
    P.cell === 'custom' ? f('Metres', h('input', { type: 'number', min: 1, step: 'any', value: P.customCell, on: { change: (e) => { P.customCell = +e.target.value; render(); } } })) : null),
    h('p.hint' + (est > MAX_CELLS ? '.warn' : ''), `${fmt(est / 1e6, 1)} million cells${est > MAX_CELLS ? ` — over the ${MAX_CELLS / 1e6} million limit: choose a coarser cell or clip the DEM (Tools → Clip raster).` : ''}`),
    h('p.hint', 'A coarser cell averages the DEM. Embankments narrower than a cell are still kept as continuous walls.')));

  pane.append(h('section.step', h('h4', h('span.n', '2'), 'Embankments, sluices, khals'),
    h('div.inl', f('Embankments (walls)', sel(lines, P.walls, (v) => { P.walls = v; }, 'None')), drawBtn('LineString', 'Embankments (drawn)', 'Embankment', 'walls')),
    h('div.inl', f('Sluices / regulators (openings)', sel(pts, P.sluices, (v) => { P.sluices = v; }, 'None')), drawBtn('Point', 'Sluices (drawn)', 'Sluice', 'sluices')),
    P.walls && !P.sluices ? h('p.hint.warn', 'With embankments but no sluices, water inside a closed polder has nowhere to go and is routed over the lowest point of the wall.') : null,
    h('div.inl', f('Khals / rivers (burned in)', sel(lines, P.khals, (v) => { P.khals = v; }, 'None')), drawBtn('LineString', 'Khals (drawn)', 'Khal', 'khals')),
    P.khals ? h('p.hint', 'Khals should reach the sluices; a khal that stops short ends in a filled hollow.') : null,
    h('details', h('summary', 'Burning settings'), h('div.row',
      f('Wall height (m)', h('input', { type: 'number', step: 'any', value: P.wallHeight, on: { change: (e) => { P.wallHeight = +e.target.value; } } })),
      f('Khal depth (m)', h('input', { type: 'number', step: 'any', value: P.khalDepth, on: { change: (e) => { P.khalDepth = +e.target.value; } } })),
      f('Opening (cells)', h('input', { type: 'number', min: 0, max: 5, step: 1, value: P.openingRadius, on: { change: (e) => { P.openingRadius = +e.target.value; } } }))),
    h('p.hint', 'Walls are added to the DEM along the embankment lines (4-connected, so flow cannot slip through diagonally). Around each sluice the wall is lowered to the lowest neighbouring ground.'))));

  const fresh = model && model.key === keyOf();
  const prepBtn = h('button.primary.big', { type: 'button', disabled: est > MAX_CELLS, on: { click: prep } }, icon('play'), fresh ? ' Rebuild flow model' : ' Build flow model');
  pane.append(h('section.step', h('h4', h('span.n', '3'), 'Flow model'),
    h('div.row', f('Stream threshold (km²)', h('input', { type: 'number', min: 0.001, step: 'any', value: P.threshold, on: { change: async (e) => { P.threshold = +e.target.value; if (model) await redoStreams(); } } }), 'Upstream area that starts a drawn stream')),
    prepBtn, h('div#hprog'), model ? summary(fresh) : null));

  if (model) {
    pane.append(h('section.step', h('h4', h('span.n', '4'), 'Drainage units'),
      f('Outlets', h('select', { on: { change: (e) => { P.outletSrc = e.target.value; render(); } } },
        h('option', { value: 'sluices', selected: P.outletSrc === 'sluices' }, 'The sluices above'), h('option', { value: 'layer', selected: P.outletSrc === 'layer' }, 'Another point layer / drawn points'))),
      P.outletSrc === 'layer' ? h('div.inl', f('Pour points', sel(pts, P.outlets, (v) => { P.outlets = v; }, '—')), drawBtn('Point', 'Pour points (drawn)', 'Outlet', 'outlets')) : null,
      h('div.row', f('Snap distance (m)', h('input', { type: 'number', min: 0, step: 'any', value: P.snap, on: { change: (e) => { P.snap = +e.target.value; } } }), 'moves each point to the largest flow nearby'),
        f('Units', h('select', { on: { change: (e) => { P.mode = e.target.value; } } }, h('option', { value: 'separate', selected: P.mode === 'separate' }, 'Separate (no overlap)'), h('option', { value: 'full', selected: P.mode === 'full' }, 'Full upstream area')))),
      h('button.primary.big', { type: 'button', on: { click: delineate } }, icon('map'), ' Delineate'),
      h('div#dprog')));
    pane.append(h('section.step', h('h4', 'Download rasters'), h('p.hint', 'GeoTIFF in the DEM’s coordinate system, at the model cell size.'),
      h('div.dl', [['dir', 'Flow direction (D8, ESRI codes)'], ['acc', 'Flow accumulation (cells)'], ['acckm2', 'Upstream area (km²)'], ['filled', 'Filled DEM (conditioned)'], ['dem', 'DEM at model cell size'], ['labels', 'Drainage unit raster']]
        .map(([k, t]) => h('button', { type: 'button', on: { click: () => exportRaster(k, t) } }, icon('download', 13), ' ', t)))));
  }
}

function summary(fresh) {
  const m = model;
  const box = h('div.summary',
    h('span', 'Cells'), h('b', `${fmt(m.cells / 1e6, 2)} M · ${fmt(m.cellM, 1)} m`),
    h('span', 'Time'), h('b', `${fmt(m.seconds, 1)} s`),
    m.cond.wallCells ? [h('span', 'Wall cells'), h('b', fmt(m.cond.wallCells, 0))] : null,
    m.cond.openedCells ? [h('span', 'Opened at sluices'), h('b', fmt(m.cond.openedCells, 0))] : null,
    m.cond.streamCells ? [h('span', 'Khal cells burned'), h('b', fmt(m.cond.streamCells, 0))] : null,
    h('span', 'Flat (no downslope)'), h('b', `${fmt(m.flatPct, 1)} %`), h('span', 'Raised by filling'), h('b', `${fmt(m.filledPct, 1)} %`));
  const out = [box];
  if (!fresh) out.push(h('p.hint.warn', 'Inputs changed since this model was built — rebuild before delineating.'));
  if (m.flatPct + m.filledPct > 40) out.push(h('div.warnbox', h('b', `${fmt(m.flatPct + m.filledPct, 0)} % of the area is flat or filled. `), 'Here flow paths are set by the filling algorithm, not the terrain. Trust drainage units only where embankments, khals and sluices define them; check each unit\'s flat % in the table.'));
  return out;
}

async function prep() {
  const D = byId(P.dem); if (!D) return;
  const prog = $('#hprog'); prog.replaceChildren(h('div.prog', h('span#hstep', 'Starting…'), h('i', h('b#hbar', { style: { width: '0%' } }))));
  const cellSize = P.cell === 'native' ? null : P.cell === 'custom' ? +P.customCell : +P.cell;
  const fc = (id) => (byId(id) ? byId(id).fc : null);
  try {
    const r = await call({ cmd: 'prep', file: D.file, crsOverride: D.crsOverride || null, crsDefs: EXTRA, cellSize: cellSize && Math.abs(cellSize - cellMetres(D)) > 0.01 * cellMetres(D) ? cellSize : null,
      cond: { walls: fc(P.walls), wallHeight: P.wallHeight, openings: fc(P.sluices), openingRadius: P.openingRadius, streams: fc(P.khals), streamDepth: P.khalDepth }, threshold: P.threshold },
    (s, p) => { if (s) $('#hstep') && ($('#hstep').textContent = s + '…'); if (p != null && $('#hbar')) $('#hbar').style.width = `${Math.round(p * 100)}%`; });
    model = { ...r, key: keyOf(), cellM: cellMetres(D) * (r.rx / D.meta.rx), demName: D.name };
    P.snap = Math.max(P.snap, Math.round(2 * model.cellM));
    await showStreams(r.streams);
    toast(`Flow model ready in ${fmt(r.seconds, 1)} s.`, 'ok');
  } catch (e) { toast(e.message, 'error', 10000); console.error(e); }
  render();
}
async function redoStreams() { try { await showStreams(await call({ cmd: 'streams', threshold: P.threshold })); } catch (e) { toast(e.message, 'error'); } }
async function showStreams(fc) {
  const old = state.layers.find((l) => l.role === 'streams'); if (old) app.removeLayer(old.id);
  if (!fc.features.length) { toast('No streams at this threshold — lower it.', 'warn'); return; }
  await app.addLayer({ type: 'vector', name: `Streams ≥ ${P.threshold} km²`, fc, role: 'streams', sym: { stroke: '#3a8dde', fill: '#3a8dde', width: 1.2, widthBy: 'order' } });
}

async function delineate() {
  const src = P.outletSrc === 'sluices' ? byId(P.sluices) : byId(P.outlets);
  if (!src || !src.fc.features.length) { toast(P.outletSrc === 'sluices' ? 'Add or draw sluice points first.' : 'Choose or draw pour points first.', 'warn'); return; }
  if (model.key !== keyOf()) { toast('Inputs changed — rebuild the flow model first.', 'warn'); return; }
  const pts = src.fc.features.filter((x) => x.geometry && x.geometry.type === 'Point').map((x) => ({ c: x.geometry.coordinates, p: x.properties }));
  $('#dprog').replaceChildren(h('p.hint', `Delineating ${pts.length} unit(s)…`));
  try {
    const r = await call({ cmd: 'delineate', pts, snapRadius: P.snap, mode: P.mode, useOpenings: P.outletSrc === 'sluices' && !!P.walls });
    $('#dprog').replaceChildren();
    if (!r.catchments.features.length) { toast('No drainage unit could be made — are the points inside the DEM?', 'error'); return; }
    for (const nm of ['Drainage units', 'Snapped outlets']) { const o = state.layers.find((l) => l.name === nm); if (o) app.removeLayer(o.id); }
    await app.addLayer({ type: 'vector', name: 'Snapped outlets', fc: r.snapped, sym: { fill: '#ffd400', stroke: '#222222' } });
    const U = await app.addLayer({ type: 'vector', name: 'Drainage units', fc: r.catchments, sym: { label: 'name', fillOpacity: 0.18, width: 2 } });
    app.zoomTo(U);
    if (r.missed) toast(`${r.missed} point(s) were outside the DEM and were skipped.`, 'warn', 8000);
    showTable(U);
  } catch (e) { $('#dprog').replaceChildren(); toast(e.message, 'error', 10000); console.error(e); }
}

function showTable(U) {
  const cols = [['name', 'Unit'], ['area_km2', 'Area (km²)'], ['up_km2', 'Upstream area at outlet (km²)'], ['outlet', 'Outlet'], ['snap_m', 'Snapped (m)'], ['flat_pct', 'Flat (%)'], ['filled_pct', 'Filled (%)'], ['drains_to', 'Drains to']];
  const rows = U.fc.features.map((x) => x.properties);
  const tbl = h('table.grid', h('thead', h('tr', cols.map(([, t]) => h('th', t)))),
    h('tbody', rows.map((p, i) => h('tr', { on: { click: () => app.highlight(U, U.fc.features[i].id, true) } }, cols.map(([k]) => {
      const v = p[k]; if (typeof v !== 'number') return h('td', v ?? '');
      return h('td.n', { class: (k === 'flat_pct' || k === 'filled_pct') && v > 50 ? 'warnv' : '' }, fmt(v, k === 'snap_m' ? 0 : 2));
    })))));
  app.openDrawer(`Drainage units — ${rows.length}`, h('div.scroll', tbl), [
    h('button', { type: 'button', on: { click: () => { app.useZones(U.id); } } }, 'Slope / LULC / soil for these units →'),
    h('button', { type: 'button', on: { click: () => navigator.clipboard.writeText([cols.map((c) => c[1]).join('\t'), ...rows.map((p) => cols.map(([k]) => p[k] ?? '').join('\t'))].join('\n')).then(() => toast('Copied.', 'ok', 2000)) } }, 'Copy table'),
  ]);
}

async function exportRaster(what, title) {
  try { const buf = await call({ cmd: 'export', what }); download(new Blob([buf], { type: 'image/tiff' }), `${(model.demName || 'dem').replace(/[^\w-]+/g, '_')}_${what}.tif`); }
  catch (e) { toast(`${title}: ${e.message}`, 'error'); }
}

export function initHydro(callbacks) {
  app = callbacks; render();
  on('layers', () => { if (!document.activeElement || !$('#pane-hydro').contains(document.activeElement)) render(); });
}
