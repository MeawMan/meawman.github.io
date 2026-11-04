// tools.js - the Analysis pane (catchment statistics), the Tools pane (geoprocessing) and the results drawer.
import { state, on, byId, vectors, rasters } from './state.js';
import { $, $$, h, toast, icon, fmt, download, esc } from './ui.js';
import { DEFAULT_SLOPE_BREAKS } from '../engine/zonal.js';
import { crsName, isGeographic, EXTRA, crsLabel } from '../engine/crs.js';
import { projectRaster, clipRaster, mergeRasters, clipVector, dissolve } from './gp.js';
import { openRaster } from '../engine/raster.js';
import { qualColor } from './palettes.js';

let app; // callbacks from main.js
const AREA = { km2: { label: 'km²', f: 1e-6, d: 3 }, ha: { label: 'ha', f: 1e-4, d: 2 }, m2: { label: 'm²', f: 1, d: 0 } };

// ---------------- worker ----------------
let worker = null, jobSeq = 0; const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL(`worker.js?v=${__BUILD__}`, import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; if (e.data.progress != null) p.progress(e.data.progress); else { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); } };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed')); pending.clear(); worker = null; };
  return worker;
}
function runZonal(L, features, mode, opts, progress) {
  const id = ++jobSeq, w = getWorker();
  return { id, promise: new Promise((resolve, reject) => { pending.set(id, { resolve, reject, progress }); w.postMessage({ id, file: L.file, features, mode, opts: { ...opts, crsOverride: L.crsOverride || null }, crsDefs: EXTRA }); }) };
}
function runOverlay(L, features, field, progress) {
  const id = ++jobSeq, w = getWorker();
  const layer = L.fc.features.map((f) => ({ type: 'Feature', properties: { [field]: f.properties[field] }, geometry: f.geometry }));
  return { id, promise: new Promise((resolve, reject) => { pending.set(id, { resolve, reject, progress }); w.postMessage({ id, cmd: 'overlay', features, layer, field, crsDefs: EXTRA }); }) };
}
const cancelAll = () => { for (const id of pending.keys()) worker && worker.postMessage({ id, cmd: 'cancel' }); };

// ---------------- analysis pane ----------------
const A = { zones: '', nameField: '', doSlope: true, dem: '', slopeUnit: 'deg', breaks: DEFAULT_SLOPE_BREAKS.slice(0, -1).join(', '), zFactor: 1,
  doLulc: true, lulc: '', lulcField: '', doSoil: true, soil: '', soilField: '', area: 'km2' };

function opt(list, val, label) { return list.map((l) => h('option', { value: l.id, selected: l.id === val }, label ? label(l) : l.name)); }
function pickDefaults() {
  const polys = vectors('polygon'), rs = rasters();
  // catchments: until the user picks one, the best-named polygon layer (layers loaded later can be better: LULC before SubCat)
  if (!A.zonesByUser || !byId(A.zones) || byId(A.zones).geom !== 'polygon') {
    const classLayer = /lulc|land.?use|land.?cover|landcover|soil|texture|hsg/i;
    A.zones = (polys.find((l) => /catch|basin|watershed|sub|zone|union|upazila|district|polder/i.test(l.name) && !classLayer.test(l.name))
      || polys.find((l) => !classLayer.test(l.name)) || polys[0] || {}).id || '';
  }
  const Z = byId(A.zones);
  if (Z && (A.nameZones !== Z.id || !Z.fields.some((f) => f.name === A.nameField))) {
    // a name field only when it tells the catchments apart (every value present and different); otherwise feature numbers
    const unique = (n) => { const v = Z.fc.features.map((ft) => ft.properties[n]); return v.every((x) => x != null && String(x).trim() !== '') && new Set(v.map(String)).size === v.length; };
    const named = Z.fields.filter((f) => /name|id|code|basin|catch/i.test(f.name));
    A.nameField = ((named.find((f) => unique(f.name))) || {}).name || '';
    A.nameZones = Z.id;
  }
  if (!byId(A.dem)) A.dem = (rs.find((l) => l.role === 'dem') || rs.find((l) => l.sym.type === 'continuous') || {}).id || '';
  // land cover: a class raster, or a polygon layer with a class field (e.g. a LULC shapefile)
  if (!byId(A.lulc) || A.lulc === A.zones) A.lulc = (rs.find((l) => l.role === 'lulc') || polys.find((l) => l.id !== A.zones && /lulc|land.?use|land.?cover|landcover|\blu\b|\blc\b/i.test(l.name)) || {}).id || '';
  const L = byId(A.lulc);
  if (L && L.type === 'vector' && !L.fields.some((f) => f.name === A.lulcField)) A.lulcField = (L.fields.find((f) => /lulc|land.?use|land.?cover|class|type|desc|name|category|lu_?\w*/i.test(f.name)) || L.fields[0] || {}).name || '';
  if (!byId(A.soil) || A.soil === A.zones) A.soil = (rs.find((l) => l.role === 'soil') || polys.find((l) => l.id !== A.zones && l.id !== A.lulc && /soil|texture|hsg/i.test(l.name)) || {}).id || '';
  const S = byId(A.soil);
  if (S && S.type === 'vector' && !S.fields.some((f) => f.name === A.soilField)) A.soilField = (S.fields.find((f) => /text|soil|class|type|hsg/i.test(f.name)) || S.fields[0] || {}).name || '';
}
function renderAnalysis() {
  pickDefaults();
  const pane = $('#pane-analysis'); pane.innerHTML = '';
  const polys = vectors('polygon'), rs = rasters();
  pane.append(h('p.lead', 'Slope, land cover and soil composition for every catchment, in one run.'));
  // catchments plus something to summarise: a raster (DEM, LULC, soil) or a second polygon layer (LULC or soil polygons)
  if (!polys.length || (!rs.length && polys.length < 2)) {
    pane.append(h('div.callout', h('b', 'Add your data first'), h('p', 'You need a polygon layer of catchments and at least one map to summarise: a raster (DEM, LULC or soil) or a land-cover / soil polygon layer. Drop the files on the map or use ', h('b', '＋ Add data'), '.'),
      h('p.hint', 'Shapefile (.zip or .shp + .dbf + .prj together), GeoJSON, GeoPackage, KML · GeoTIFF of any size; .img/.asc are converted.'),
      h('button.link', { type: 'button', on: { click: () => $('#demoBtn').click() } }, 'Or load the demo data')));
    return;
  }
  const f = (label, el, hint) => h('label.f', label, el, hint ? h('span.hint', hint) : null);
  const sel = (key, list, label, onch) => h('select', { on: { change: (e) => { A[key] = e.target.value; if (onch) onch(); renderAnalysis(); } } }, opt(list, A[key], label));
  const Z = byId(A.zones);
  pane.append(h('section.step', h('h4', h('span.n', '1'), 'Catchments'),
    f('Polygon layer', sel('zones', polys, (l) => `${l.name} (${l.fc.features.length})`, () => { A.zonesByUser = true; })),
    Z ? f('Name field', h('select', { on: { change: (e) => { A.nameField = e.target.value; } } }, [h('option', { value: '' }, '(feature number)'), ...Z.fields.map((x) => h('option', { value: x.name, selected: x.name === A.nameField }, x.name))])) : null));

  const chk = (key, title) => h('label.check.big', h('input', { type: 'checkbox', checked: A[key], on: { change: (e) => { A[key] = e.target.checked; renderAnalysis(); } } }), h('b', title));
  const sSlope = h('section.step', h('h4', h('span.n', '2'), 'What to calculate'), chk('doSlope', 'Slope & terrain'));
  if (A.doSlope) {
    const D = byId(A.dem);
    sSlope.append(h('div.sub', f('DEM', sel('dem', rs.filter((l) => l.sym.type === 'continuous'), (l) => l.name)),
      D && D.meta && isGeographic(D.crs) ? h('p.hint.ok', '✓ Geographic DEM: slope uses true metre spacing per row — no reprojection needed.') : null,
      h('div.row', f('Class limits', h('input', { type: 'text', value: A.breaks, on: { change: (e) => { A.breaks = e.target.value; } } }), 'upper limit is open'),
        f('Units', h('select', { on: { change: (e) => { A.slopeUnit = e.target.value; A.breaks = e.target.value === 'pct' ? '0, 3, 8, 15, 30, 50' : DEFAULT_SLOPE_BREAKS.slice(0, -1).join(', '); renderAnalysis(); } } },
          h('option', { value: 'deg', selected: A.slopeUnit === 'deg' }, 'degrees'), h('option', { value: 'pct', selected: A.slopeUnit === 'pct' }, 'percent')))),
      h('details', h('summary', 'Z-factor'), f('Vertical unit factor', h('input', { type: 'number', step: 'any', value: A.zFactor, on: { change: (e) => { A.zFactor = +e.target.value || 1; } } }), '1 for elevations in metres; 0.3048 if elevations are in feet.'))));
  }
  sSlope.append(chk('doLulc', 'Land use / land cover'));
  if (A.doLulc) {
    const lsrcs = [...rs.filter((l) => l.sym.type === 'categorical'), ...polys.filter((l) => l.id !== A.zones)];
    const L = byId(A.lulc);
    sSlope.append(h('div.sub', f('Land-cover map (raster or polygons)', sel('lulc', lsrcs, (l) => `${l.name} · ${l.type === 'raster' ? 'raster' : 'polygons'}`)),
      L && L.type === 'vector' ? f('Class field', h('select', { on: { change: (e) => { A.lulcField = e.target.value; } } }, L.fields.map((x) => h('option', { value: x.name, selected: x.name === A.lulcField }, x.name)))) : null,
      !lsrcs.length ? h('p.hint.warn', 'No land-cover map loaded: add a class raster (integer values) or a polygon layer with a class field.') : null));
  }
  sSlope.append(chk('doSoil', 'Soil texture'));
  if (A.doSoil) {
    const srcs = [...rs.filter((l) => l.sym.type === 'categorical'), ...polys.filter((l) => l.id !== A.zones)];
    const S = byId(A.soil);
    sSlope.append(h('div.sub', f('Soil map (raster or polygons)', sel('soil', srcs, (l) => `${l.name} · ${l.type === 'raster' ? 'raster' : 'polygons'}`)),
      S && S.type === 'vector' ? f('Texture field', h('select', { on: { change: (e) => { A.soilField = e.target.value; } } }, S.fields.map((x) => h('option', { value: x.name, selected: x.name === A.soilField }, x.name)))) : null));
  }
  pane.append(sSlope);
  pane.append(h('section.step', h('h4', h('span.n', '3'), 'Run'),
    f('Area unit', h('select', { on: { change: (e) => { A.area = e.target.value; } } }, Object.entries(AREA).map(([k, v]) => h('option', { value: k, selected: k === A.area }, v.label)))),
    h('button.primary.big#runA', { type: 'button', on: { click: run } }, icon('play'), ' Calculate'),
    h('div#runProg')));
}

function parseBreaks() {
  const v = A.breaks.split(/[,;\s]+/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length || v[0] !== 0) v.unshift(0);
  const deg = A.slopeUnit === 'pct' ? v.map((p) => Math.atan(p / 100) * 180 / Math.PI) : v;
  return { user: v, deg: [...deg, 90] };
}

async function run() {
  const Z = byId(A.zones); if (!Z) return;
  const btn = $('#runA'), prog = $('#runProg');
  const tasks = [];
  if (A.doSlope && byId(A.dem)) tasks.push({ key: 'slope', L: byId(A.dem), mode: 'slope' });
  if (A.doLulc && byId(A.lulc)) tasks.push({ key: 'lulc', L: byId(A.lulc), mode: byId(A.lulc).type === 'raster' ? 'categorical' : 'overlay', field: A.lulcField });
  if (A.doSoil && byId(A.soil)) tasks.push({ key: 'soil', L: byId(A.soil), mode: byId(A.soil).type === 'raster' ? 'categorical' : 'overlay', field: A.soilField });
  if (!tasks.length) { toast('Choose at least one dataset to calculate.', 'warn'); return; }
  // Layers made in different coordinate systems: say so, then bring them together and carry on
  const used = [Z, ...tasks.map((t) => t.L)].filter((L, i, a) => a.indexOf(L) === i);
  const crsSet = [...new Set(used.map((L) => L.crs || 'EPSG:4326'))];
  if (crsSet.length > 1 && !(await confirmCrs(used))) return;
  const br = parseBreaks();
  btn.disabled = true; btn.textContent = 'Calculating…';
  prog.replaceChildren(...tasks.map((t) => h('div.prog', { 'data-k': t.key }, h('span', `${t.key === 'slope' ? 'Slope' : t.key === 'lulc' ? 'Land cover' : 'Soil'} · ${t.L.name}`), h('i', h('b', { style: { width: '0%' } })))));
  prog.append(h('button.link', { type: 'button', on: { click: cancelAll } }, 'Cancel'));
  const features = Z.fc.features.map((ft) => ({ type: 'Feature', properties: ft.properties, geometry: ft.geometry }));
  const out = { crsMixed: crsSet.length > 1 ? used.map((L) => `"${L.name}" (${crsLabel(L.crs || 'EPSG:4326')})`) : null, zones: Z.id, zonesName: Z.name, nameField: A.nameField, area: A.area, names: features.map((ft, i) => (A.nameField ? String(ft.properties[A.nameField] ?? i + 1) : String(i + 1))), breaks: br, slopeUnit: A.slopeUnit, at: new Date() };
  const t0 = performance.now();
  try {
    await Promise.all(tasks.map(async (t) => {
      const bar = prog.querySelector(`[data-k="${t.key}"] b`);
      if (t.mode === 'overlay') {
        // polygon class layer (soil or land cover): intersect each catchment with the class polygons
        out[t.key] = (await runOverlay(t.L, features, t.field, (p) => { bar.style.width = `${Math.round(p * 100)}%`; }).promise).result;
        out[t.key + 'Src'] = { name: t.L.name, type: 'polygons', field: t.field }; bar.style.width = '100%'; return;
      }
      const job = runZonal(t.L, features, t.mode, { breaks: br.deg, zFactor: A.zFactor }, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
      const r = await job.promise; bar.style.width = '100%';
      out[t.key] = r.result;
      const names = t.L.sym.type === 'categorical' ? new Map(t.L.sym.classes.map((c) => [c.value, c])) : null;
      out[t.key + 'Src'] = { name: t.L.name, type: 'raster', crs: r.meta.crs, cell: r.meta.rx, geographic: r.meta.geographic, classNames: names ? Object.fromEntries([...names].map(([k, c]) => [k, { name: c.name, color: c.color }])) : null, bytes: r.meta.bytes };
    }));
    out.seconds = (performance.now() - t0) / 1000;
    state.result = out;
    joinToLayer(out);
    showResults(out);
    toast(`Done in ${out.seconds.toFixed(1)} s. Results were added to ${Z.name}'s attributes.`, 'ok');
  } catch (e) { toast(e.message === 'Cancelled' ? 'Cancelled.' : e.message, e.message === 'Cancelled' ? 'info' : 'error', 9000); console.error(e); }
  btn.disabled = false; btn.replaceChildren(icon('play'), ' Calculate');
}

/** Tell the user the inputs are in different coordinate systems and how they are matched. Resolves true to continue. */
function confirmCrs(layers) {
  return new Promise((res) => {
    const list = h('ul', layers.map((L) => h('li', h('b', L.name), ' — ', crsLabel(L.crs || 'EPSG:4326'))));
    let done = false;
    const end = (ok) => { if (done) return; done = true; if (d.open) d.close(); d.remove(); res(ok); };
    const btn = (sel, label, ok, extra = {}) => h(sel, { type: 'button', ...extra, on: { click: () => end(ok) } }, label);
    const d = h('dialog.modal', h('form', { on: { submit: (e) => e.preventDefault() } },
      h('header', h('h3', 'Layers in different coordinate systems'), btn('button.ib', icon('x'), false, { 'aria-label': 'Close' })),
      h('div.form', h('p', 'The selected layers were made in different coordinate systems:'), list,
        h('p', 'They will be matched automatically: polygon layers are already converted to WGS 84 (with the datum shift), catchments are reprojected onto each raster’s own grid, and areas are measured in each catchment’s UTM zone. Nothing in your files is changed.')),
      h('footer', btn('button', 'Cancel', false), btn('button.primary', 'Reproject and continue', true))));
    document.body.append(d);
    d.addEventListener('close', () => end(false)); // Esc
    d.showModal();
  });
}

// ---------------- results ----------------
const clsName = (src, v) => (src && src.classNames && src.classNames[v] ? src.classNames[v].name : String(v));
function classColumns(rows, src) {
  const vals = new Map();
  rows.forEach((r) => (r.classes || []).forEach((c) => { if (!vals.has(c.value)) vals.set(c.value, 0); vals.set(c.value, vals.get(c.value) + c.area); }));
  const keys = [...vals.keys()].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : vals.get(b) - vals.get(a)));
  return keys.map((k) => ({ key: k, name: clsName(src, k), color: src && src.classNames && src.classNames[k] ? src.classNames[k].color : null }));
}
function breaksLabels(o) { const u = o.breaks.user, unit = o.slopeUnit === 'pct' ? '%' : '°'; return u.map((b, i) => (i < u.length - 1 ? `${b}–${u[i + 1]}${unit}` : `>${b}${unit}`)); }

/** Tables as arrays of rows (first row = header), shared by the drawer and the Excel export. */
function tables(o, unitKey = o.area) {
  const U = AREA[unitKey], T = {};
  const nm = o.names;
  const covWarn = (r) => (r && Number.isFinite(r.coverage) && r.coverage < 0.98 ? `${(r.coverage * 100).toFixed(1)}%` : '');
  // class polygons that overlap each other count the shared area in each class: their total is then more than the catchment
  const overlapWarn = (r) => (r && r.type === 'overlay' && r.coverage > 1.0005 ? `${(r.coverage * 100).toFixed(1)}%` : '');
  // summary
  const head = ['Catchment', `Catchment area (${U.label})`];
  if (o.slope) head.push('Mean slope (°)', 'Median slope (°)', 'Mean slope (%)', 'Mean elevation', 'Relief');
  const lc = o.lulc ? classColumns(o.lulc, o.lulcSrc) : null, sc = o.soil ? classColumns(o.soil, o.soilSrc) : null;
  if (o.lulc) head.push('Dominant land cover', 'Share (%)');
  if (o.soil) head.push('Dominant soil', 'Share (%)');
  head.push('Notes');
  T.summary = [head, ...nm.map((n, i) => {
    const r = [n], s = o.slope && o.slope[i], l = o.lulc && o.lulc[i], so = o.soil && o.soil[i];
    const area = (s || l || so || {}).polygonArea; r.push(area * U.f);
    if (o.slope) r.push(s.mean, s.median, s.meanPct, s.elevMean, s.relief);
    const dom = (x, src) => { if (!x || !x.classes || !x.classes.length) return ['', NaN]; const c = x.classes.reduce((a, b) => (b.area > a.area ? b : a)); return [clsName(src, c.value), c.pct]; };
    if (o.lulc) r.push(...dom(l, o.lulcSrc));
    if (o.soil) r.push(...dom(so, o.soilSrc));
    const notes = [];
    [['DEM', s], ['LULC', l], ['soil', so]].forEach(([k, x]) => { if (x && covWarn(x)) notes.push(`${k} covers ${covWarn(x)}`); if (x && overlapWarn(x)) notes.push(`${k} polygons overlap: classes add up to ${overlapWarn(x)} of the catchment`); if (x && x.cells === 0) notes.push(`no ${k} cells`); });
    r.push(notes.join('; '));
    return r;
  })];
  if (o.slope) {
    T.slope = [['Catchment', `Area (${U.label})`, 'Cells', 'Mean (°)', 'SD (°)', 'Min (°)', 'P10 (°)', 'Median (°)', 'P90 (°)', 'Max (°)', 'Mean (%)', 'Elev. mean', 'Elev. min', 'Elev. max', 'Relief', 'Hypsometric integral', 'DEM coverage (%)'],
      ...o.slope.map((s, i) => [nm[i], s.polygonArea * U.f, s.cells, s.mean, s.sd, s.min, s.p10, s.median, s.p90, s.max, s.meanPct, s.elevMean, s.elevMin, s.elevMax, s.relief, s.hypsometric, 100 * s.coverage])];
    const lab = breaksLabels(o);
    T.slopeClasses = [['Catchment', ...lab.map((l) => `${l} (${U.label})`), ...lab.map((l) => `${l} (%)`)],
      ...o.slope.map((s, i) => [nm[i], ...(s.classes || []).map((c) => c.area * U.f), ...(s.classes || []).map((c) => c.pct)])];
  }
  // catchment area, then the area the classes add up to (cells with data, or the overlaid class polygons), then each class
  const classTable = (rows, cols) => [['Catchment', `Catchment area (${U.label})`, `Classes total (${U.label})`, ...cols.map((c) => `${c.name} (${U.label})`), ...cols.map((c) => `${c.name} (%)`), 'Coverage (%)'],
    ...rows.map((x, i) => { const m = new Map((x.classes || []).map((c) => [c.value, c])); return [nm[i], x.polygonArea * U.f, x.validArea * U.f, ...cols.map((c) => (m.get(c.key)?.area || 0) * U.f), ...cols.map((c) => m.get(c.key)?.pct || 0), 100 * x.coverage]; })];
  if (o.lulc) T.lulc = classTable(o.lulc, lc);
  if (o.soil) T.soil = classTable(o.soil, sc);
  T._cols = { lc, sc };
  return T;
}

const TAB_NAMES = { summary: 'Summary', slope: 'Slope', slopeClasses: 'Slope classes', lulc: 'Land cover', soil: 'Soil' };
let view = { tab: 'summary', unit: null, pct: true };
function showResults(o) {
  view.unit = view.unit || o.area;
  const T = tables(o, view.unit), tabs = Object.keys(TAB_NAMES).filter((k) => T[k]);
  if (!T[view.tab]) view.tab = 'summary';
  const tabBar = h('div.dtabs', tabs.map((k) => h('button', { type: 'button', 'aria-selected': k === view.tab, on: { click: () => { view.tab = k; showResults(o); } } }, TAB_NAMES[k])));
  let rows = T[view.tab];
  if ((view.tab === 'lulc' || view.tab === 'soil' || view.tab === 'slopeClasses')) {
    const hd = rows[0], keep = hd.map((c, i) => i === 0 || (view.pct ? /\(%\)$/.test(c) || /^Coverage/.test(c) : !/\(%\)$/.test(c)));
    rows = rows.map((r) => r.filter((_, i) => keep[i]));
  }
  const cols = view.tab === 'lulc' ? T._cols.lc : view.tab === 'soil' ? T._cols.sc : null;
  const colorOf = (hdr) => { if (!cols) return null; const c = cols.find((k) => hdr.startsWith(k.name + ' (')); return c && c.color; };
  const tbl = h('table.grid', h('thead', h('tr', rows[0].map((c) => h('th', colorOf(c) ? h('span.dot', { style: { background: colorOf(c) } }) : null, c)))),
    h('tbody', rows.slice(1).map((r, i) => h('tr', { on: { click: () => { const Z = byId(o.zones); if (Z) app.highlight(Z, Z.fc.features[i].id, true); } } },
      r.map((v, j) => {
        if (typeof v !== 'number') return h('td', { class: rows[0][j] === 'Notes' ? 'note' : '' }, v);
        const isPct = /%\)$/.test(rows[0][j]) && j > 1;
        return h('td.n', isPct && view.tab !== 'summary' ? h('span.bar', { style: { '--w': `${Math.min(100, v)}%`, '--c': colorOf(rows[0][j]) || 'var(--accent)' } }, fmt(v, 1)) : fmt(v, /Cells/.test(rows[0][j]) ? 0 : /\((km²|ha)\)/.test(rows[0][j]) ? AREA[view.unit].d : 2));
      })))));
  const unitSel = h('select', { title: 'Area unit', on: { change: (e) => { view.unit = e.target.value; showResults(o); } } }, Object.entries(AREA).map(([k, v]) => h('option', { value: k, selected: k === view.unit }, v.label)));
  const pctBtn = ['lulc', 'soil', 'slopeClasses'].includes(view.tab) ? h('div.seg', h('button', { type: 'button', 'aria-pressed': view.pct, on: { click: () => { view.pct = true; showResults(o); } } }, '%'), h('button', { type: 'button', 'aria-pressed': !view.pct, on: { click: () => { view.pct = false; showResults(o); } } }, 'Area')) : null;
  app.openDrawer(`Catchment statistics — ${o.zonesName}`, h('div.res', tabBar, h('div.scroll', tbl)), [
    pctBtn, unitSel,
    h('button', { type: 'button', on: { click: () => exportExcel(o) } }, icon('download'), ' Excel'),
    h('button', { type: 'button', on: { click: () => copyText(toTSV(rows)) } }, 'Copy table'),
    h('button', { type: 'button', on: { click: () => methodsDialog(o) } }, 'Methods text'),
  ]);
}
const toTSV = (rows) => rows.map((r) => r.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toPrecision(8) : '') : v)).join('\t')).join('\n');
function copyText(t) { navigator.clipboard.writeText(t).then(() => toast('Copied — paste into Excel or Word.', 'ok', 2500), () => toast('Clipboard blocked by the browser.', 'warn')); }

/** Add result fields to the catchment layer, and colour it by mean slope. */
function joinToLayer(o) {
  const Z = byId(o.zones); if (!Z) return;
  const fc = { type: 'FeatureCollection', features: Z.fc.features.map((ft, i) => {
    const p = { ...ft.properties };
    for (const k of Object.keys(p)) if (/^(slp_|elev_|lc_|so_|area_km2)/.test(k)) delete p[k];
    const s = o.slope && o.slope[i], l = o.lulc && o.lulc[i], so = o.soil && o.soil[i];
    p.area_km2 = +(((s || l || so || {}).polygonArea || 0) / 1e6).toFixed(4);
    if (s) Object.assign(p, { slp_mean: r4(s.mean), slp_med: r4(s.median), slp_pct: r4(s.meanPct), elev_mean: r4(s.elevMean), elev_rel: r4(s.relief) });
    // shapefile-safe (<= 10 characters, unique) field names: lc_<class value> for rasters, so_<abbreviation> for soil polygons
    const add = (x, pre, src) => (x && x.classes ? x.classes : []).forEach((c) => { p[fieldName(pre, c.value, src)] = r4(c.pct); });
    add(l, 'lc_', o.lulcSrc); add(so, 'so_', o.soilSrc);
    return { ...ft, properties: p };
  }) };
  app.updateVectorData(Z, fc);
  if (o.slope) { const v = o.slope.map((s) => s.mean).filter(Number.isFinite); Z.sym.choro = { field: 'slp_mean', ramp: 'slope', min: Math.min(...v), max: Math.max(...v) }; Z.sym.label = Z.sym.label || o.nameField; app.refreshVector(Z); app.renderLayerPanel(); }
}
const fieldNames = new Map();
function fieldName(pre, value, src) {
  const k = pre + '|' + value; if (fieldNames.has(k)) return fieldNames.get(k);
  let base = typeof value === 'number' ? pre + value : pre + String(value).split(/\s+/).map((w) => w.slice(0, 3)).join('').replace(/[^\w]+/g, '');
  base = base.slice(0, 10); let n = base, i = 2;
  const used = new Set(fieldNames.values()); while (used.has(n)) n = base.slice(0, 9 - String(i).length) + '_' + i++;
  fieldNames.set(k, n); void src; return n;
}
const r4 = (v) => (Number.isFinite(v) ? +v.toPrecision(6) : null);

// ---------------- Excel ----------------
let xlsxP = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return (xlsxP = xlsxP || new Promise((res, rej) => { const s = h('script', { src: new URL('../vendor/xlsx.core.min.js', import.meta.url).href }); s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Excel library failed to load')); document.head.append(s); }));
}
async function exportExcel(o) {
  const X = await loadXlsx(), T = tables(o, view.unit || o.area), wb = X.utils.book_new();
  for (const k of Object.keys(TAB_NAMES)) if (T[k]) {
    const ws = X.utils.aoa_to_sheet(T[k].map((r) => r.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toPrecision(10) : null) : v))));
    ws['!cols'] = T[k][0].map((c, i) => ({ wch: i ? Math.max(10, Math.min(28, String(c).length + 2)) : 22 }));
    X.utils.book_append_sheet(wb, ws, TAB_NAMES[k]);
  }
  const fm = [['Field in catchment layer', 'Meaning'], ['area_km2', 'Catchment area (km², geodesic)'], ['slp_mean / slp_med', 'Mean / median slope (°)'], ['slp_pct', 'Mean slope (%)'], ['elev_mean / elev_rel', 'Mean elevation / relief'],
    ...[['lc_', o.lulcSrc, 'Land cover'], ['so_', o.soilSrc, 'Soil']].flatMap(([pre, src, what]) => [...fieldNames].filter(([k]) => k.startsWith(pre + '|')).map(([k, f]) => [f, `${what} share (%): ${clsName(src, isNaN(+k.split('|')[1]) ? k.split('|')[1] : +k.split('|')[1])}`]))];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(fm), 'Map fields');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(methodsText(o).split('\n\n').map((p) => [p])), 'Methods');
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${o.zonesName.replace(/[^\w-]+/g, '_')}_catchment_statistics.xlsx`);
}

// ---------------- methods text ----------------
function methodsText(o) {
  const p = [];
  const cell = (s) => (s.geographic ? `${(s.cell * 3600).toPrecision(3)} arc-second` : `${+s.cell.toPrecision(4)} m`);
  p.push(`Catchment statistics were computed for ${o.names.length} polygons (${o.zonesName}) with Ababahika v0.2 (Joy 2026), which runs in the web browser. Polygons were reprojected to each raster's coordinate system with PROJ (proj4js). A cell was assigned to a catchment when its centre lies inside the polygon (GDAL rasterisation rule, equivalent to ArcGIS Zonal Statistics). Areas are true cell areas${[o.slopeSrc, o.lulcSrc, o.soilSrc].some((s) => s && s.geographic) ? ' (exact ellipsoidal WGS 84 cell areas for rasters in geographic coordinates)' : ''}; catchment areas are geodesic on WGS 84.`);
  if (o.slope) p.push(`Slope was derived from the ${cell(o.slopeSrc)} DEM "${o.slopeSrc.name}" with Horn's (1981) third-order finite-difference method, as in ArcGIS Slope and GDAL gdaldem${o.slopeSrc.geographic ? '; for the geographic DEM the horizontal spacing of each row was converted to metres from the WGS 84 radii of curvature at its latitude' : ''}. NoData neighbours were replaced by the centre cell value. For each catchment the mean, standard deviation, median and 10th/90th percentiles of slope (degrees; percent slope = 100·tan θ) and the area in the classes ${breaksLabels(o).join(', ')} are reported, with the mean, minimum and maximum elevation, relief and hypsometric integral (mean − min)/(max − min).`);
  if (o.crsMixed) p.push(`The input layers were in different coordinate systems (${o.crsMixed.join('; ')}). Vector layers were converted to WGS 84 on loading (Gulshan 303 to WGS 84 by EPSG transformation 1919: ΔX = 283.729, ΔY = 735.942, ΔZ = 261.143 m, where applicable) and the catchments were reprojected to each raster's coordinate system before the statistics were computed.`);
  if (o.lulc) p.push(o.lulcSrc.type === 'polygons'
    ? `Land cover was summarised by intersecting the catchments with the land-cover polygons "${o.lulcSrc.name}" (field ${o.lulcSrc.field}) using Turf.js, as the area and percentage of each class within each catchment; areas are geodesic on WGS 84, and percentages are of the total area of the land-cover classes within the catchment. Where land-cover polygons overlap one another, the shared area is counted in each class, so the classes can add up to slightly more than the catchment (reported as coverage above 100%).`
    : `Land cover was summarised from "${o.lulcSrc.name}" (${cell(o.lulcSrc)} cells) as the area and percentage of each class within each catchment; percentages are of the catchment area with valid (non-NoData) cells.`);
  if (o.soil) p.push(o.soilSrc.type === 'polygons' ? `Soil texture shares were computed by intersecting the catchments with the soil polygons "${o.soilSrc.name}" (field ${o.soilSrc.field}) using Turf.js; areas are geodesic on WGS 84.` : `Soil texture was summarised from "${o.soilSrc.name}" (${cell(o.soilSrc)} cells) in the same way as land cover.`);
  p.push('References: Horn, B.K.P. (1981). Hill shading and the reflectance map. Proceedings of the IEEE, 69(1), 14–47. · Strahler, A.N. (1952). Hypsometric (area-altitude) analysis of erosional topography. GSA Bulletin, 63, 1117–1142.');
  return p.join('\n\n');
}
function methodsDialog(o) {
  const t = methodsText(o);
  app.modal('Methods paragraph', h('div.prose', t.split('\n\n').map((x) => h('p', x))), [h('button.primary', { type: 'button', on: { click: () => copyText(t) } }, 'Copy')]);
}

// ---------------- tools pane (geoprocessing) ----------------
const TOOLS = [
  { k: 'projectR', t: 'Project raster', d: 'Change a raster’s coordinate system', ic: 'globe' },
  { k: 'clipR', t: 'Clip raster', d: 'Cut a raster to polygons or the map view', ic: 'tool' },
  { k: 'mosaic', t: 'Merge rasters', d: 'Mosaic tiles into one raster', ic: 'layers' },
  { k: 'slopeR', t: 'Slope raster', d: 'Make a slope map from a DEM', ic: 'chart' },
  { k: 'clipV', t: 'Clip vector', d: 'Keep features inside polygons', ic: 'tool' },
  { k: 'mergeV', t: 'Merge vectors', d: 'Append layers into one', ic: 'layers' },
  { k: 'dissolve', t: 'Dissolve', d: 'Merge polygons by a field', ic: 'map' },
  { k: 'projectV', t: 'Project / export vector', d: 'Save a layer in any CRS and format', ic: 'download' },
];
let openTool = null;
function renderTools() {
  const pane = $('#pane-tools'); pane.innerHTML = '';
  if (!openTool) {
    pane.append(h('p.lead', 'Geoprocessing runs GDAL in your browser. Results are added as new layers.'));
    pane.append(h('div.toolgrid', TOOLS.map((t) => h('button.toolcard', { type: 'button', on: { click: () => { openTool = t.k; renderTools(); } } }, icon(t.ic, 20), h('b', t.t), h('span', t.d)))));
    pane.append(h('p.hint', 'Inputs and outputs of these tools must fit in memory (about 2 GB). Catchment statistics have no size limit.'));
    return;
  }
  const T = TOOLS.find((t) => t.k === openTool);
  pane.append(h('div.toolhead', h('button.link', { type: 'button', on: { click: () => { openTool = null; renderTools(); } } }, '← All tools'), h('h4', T.t)));
  const form = h('div.form'); pane.append(form);
  const f = (label, el, hint) => h('label.f', label, el, hint ? h('span.hint', hint) : null);
  const layerSel = (list, multi) => h('select', { multiple: multi || undefined, size: multi ? Math.min(6, Math.max(3, list.length)) : undefined }, list.map((l, i) => h('option', { value: l.id, selected: !multi && l.id === state.selected || (multi && i < 2) }, l.name)));
  const rs = rasters(), vs = vectors(), polys = vectors('polygon');
  const go = (label, fn) => {
    const b = h('button.primary.big', { type: 'button' }, label), st = h('div.status');
    b.addEventListener('click', async () => {
      b.disabled = true; st.textContent = 'Working…';
      try { await fn((m) => { if (m) st.textContent = m; }); st.textContent = 'Done.'; } catch (e) { st.textContent = ''; toast(e.message || String(e), 'error', 9000); console.error(e); }
      b.disabled = false;
    });
    form.append(b, st);
  };
  const need = (ok, msg) => { if (!ok) { form.append(h('p.callout', msg)); return false; } return true; };
  const addRaster = async (blob, name) => { const file = new File([blob], name.replace(/[^\w.-]+/g, '_') + '.tif', { type: 'image/tiff' }); const raster = await openRaster(file, name); return app.addLayer({ type: 'raster', name, raster, file }); };
  const addVector = (fc, name) => app.addLayer({ type: 'vector', name, fc, srcCrs: 'EPSG:4326' });
  const resampSel = () => h('select', h('option', { value: 'near' }, 'Nearest (classes, LULC, soil)'), h('option', { value: 'bilinear' }, 'Bilinear (DEM, continuous)'), h('option', { value: 'cubic' }, 'Cubic'));

  if (openTool === 'projectR') {
    if (!need(rs.length, 'Add a raster first.')) return;
    const inp = layerSel(rs), crs = app.crsPicker('EPSG:32646'), rsm = resampSel(), cs = h('input', { type: 'number', step: 'any', placeholder: 'keep (auto)' });
    form.append(f('Raster', inp), f('Output coordinate system', crs.el), f('Resampling', rsm), f('Cell size (output units)', cs, 'Leave empty to let GDAL choose. Use metres for UTM/BTM.'));
    inp.addEventListener('change', () => { const L = byId(inp.value); if (L) rsm.value = L.sym.type === 'categorical' ? 'near' : 'bilinear'; }); inp.dispatchEvent(new Event('change'));
    go('Project', async (st) => { const L = byId(inp.value), c = await crs.value(); const b = await projectRaster(L.file, { crs: c, resampling: rsm.value, res: cs.value ? +cs.value : null }, st); await addRaster(b, `${L.name}_${c.replace(':', '')}`); });
  } else if (openTool === 'clipR') {
    if (!need(rs.length, 'Add a raster first.')) return;
    const inp = layerSel(rs), by = h('select', h('option', { value: 'poly' }, 'Polygon layer'), h('option', { value: 'view' }, 'Current map view'));
    const pl = layerSel(polys), selOnly = h('input', { type: 'checkbox' }), plWrap = h('div', f('Polygon layer', pl), h('label.check', selOnly, ' Only the highlighted feature'));
    by.addEventListener('change', () => { plWrap.hidden = by.value !== 'poly'; });
    if (!polys.length) by.value = 'view', plWrap.hidden = true;
    form.append(f('Raster', inp), f('Clip to', by), plWrap);
    go('Clip', async (st) => {
      const L = byId(inp.value); let b;
      if (by.value === 'poly') {
        const P = byId(pl.value); let feats = P.fc.features;
        if (selOnly.checked) { if (!state.highlight || state.highlight.layer !== P.id) throw new Error('Click a feature of that layer on the map first.'); feats = feats.filter((x) => x.id === state.highlight.fid); }
        b = await clipRaster(L.file, { polygons: { type: 'FeatureCollection', features: feats }, nodata: L.meta.nodata ?? (L.sym.type === 'categorical' ? 0 : -9999) }, st);
      } else {
        const e = state.map.getView().calculateExtent(state.map.getSize());
        b = await clipRaster(L.file, { extent: e, extentCrs: 'EPSG:3857' }, st);
      }
      await addRaster(b, `${L.name}_clip`);
    });
  } else if (openTool === 'mosaic') {
    if (!need(rs.length >= 2, 'Add two or more rasters (e.g. DEM tiles).')) return;
    const inp = layerSel(rs, true), rsm = resampSel(), crs = app.crsPicker('EPSG:4326'), keep = h('input', { type: 'checkbox', checked: true });
    form.append(f('Rasters (Ctrl/Shift-click to choose)', inp), h('label.check', keep, ' Keep the first raster’s coordinate system'), f('…or output coordinate system', crs.el), f('Resampling', rsm));
    go('Merge', async (st) => {
      const Ls = [...inp.selectedOptions].map((o) => byId(o.value)); if (Ls.length < 2) throw new Error('Choose at least two rasters.');
      const b = await mergeRasters(Ls.map((l) => l.file), { crs: keep.checked ? null : await crs.value(), resampling: rsm.value, nodata: Ls[0].meta.nodata }, st);
      await addRaster(b, `${Ls[0].name}_mosaic`);
    });
  } else if (openTool === 'slopeR') {
    const dems = rs.filter((l) => l.sym.type === 'continuous');
    if (!need(dems.length, 'Add a DEM first.')) return;
    const inp = layerSel(dems), unit = h('select', h('option', { value: 'deg' }, 'Degrees'), h('option', { value: 'pct' }, 'Percent rise'));
    form.append(f('DEM', inp), f('Output', unit), h('p.hint', 'Horn (1981), same as ArcGIS Slope; works on geographic DEMs directly.'));
    go('Create slope raster', async (st) => {
      const L = byId(inp.value); const id = ++jobSeq, w = getWorker();
      const r = await new Promise((resolve, reject) => { pending.set(id, { resolve, reject, progress: (p) => st(`Computing… ${Math.round(p * 100)}%`) }); w.postMessage({ id, cmd: 'slopeRaster', file: L.file, opts: { unit: unit.value, crsOverride: L.crsOverride || null }, crsDefs: EXTRA }); });
      await addRaster(new Blob([r.result]), `${L.name}_slope_${unit.value}`);
    });
  } else if (openTool === 'clipV') {
    if (!need(vs.length && polys.length, 'Add a vector layer and a polygon layer.')) return;
    const inp = layerSel(vs), pl = layerSel(polys);
    form.append(f('Input layer', inp), f('Clip polygons', pl));
    go('Clip', async (st) => { const L = byId(inp.value), P = byId(pl.value); const out = await clipVector(L.fc, P.fc, st); if (!out.features.length) throw new Error('Nothing inside the clip polygons.'); await addVector(out, `${L.name}_clip`); });
  } else if (openTool === 'mergeV') {
    if (!need(vs.length >= 2, 'Add two or more vector layers.')) return;
    const inp = layerSel(vs, true), srcF = h('input', { type: 'checkbox', checked: true });
    form.append(f('Layers (Ctrl/Shift-click)', inp), h('label.check', srcF, ' Add a "source" field with the layer name'));
    go('Merge', async () => {
      const Ls = [...inp.selectedOptions].map((o) => byId(o.value)); if (Ls.length < 2) throw new Error('Choose at least two layers.');
      const feats = Ls.flatMap((L) => L.fc.features.map((ft) => ({ type: 'Feature', geometry: ft.geometry, properties: { ...ft.properties, ...(srcF.checked ? { source: L.name } : {}) } })));
      await addVector({ type: 'FeatureCollection', features: feats }, 'merged');
    });
  } else if (openTool === 'dissolve') {
    if (!need(polys.length, 'Add a polygon layer.')) return;
    const inp = layerSel(polys), fld = h('select');
    const fill = () => { const L = byId(inp.value); fld.replaceChildren(h('option', { value: '' }, '(all into one)'), ...(L ? L.fields : []).map((x) => h('option', { value: x.name }, x.name))); };
    inp.addEventListener('change', fill); fill();
    form.append(f('Polygon layer', inp), f('Dissolve field', fld));
    go('Dissolve', async (st) => { const L = byId(inp.value); const out = await dissolve(L.fc, fld.value, st); await addVector(out, `${L.name}_dissolved`); });
  } else if (openTool === 'projectV') {
    if (!need(vs.length, 'Add a vector layer.')) return;
    form.append(h('p', 'Select the layer in Contents and press ', icon('download'), ' Export in its panel, or choose it here:'));
    const inp = layerSel(vs);
    form.append(f('Layer', inp));
    go('Open export…', async () => { app.renderLayerPanel(); const L = byId(inp.value); state.selected = L.id; app.renderLayerPanel(); app.openPanel('layer'); document.querySelector('#pane-layer [aria-label="Export"]').click(); });
  }
}

/** Point the catchment-statistics pane at a polygon layer (e.g. new drainage units). */
export function useZones(id) { A.zones = id; A.zonesByUser = true; A.nameZones = id; const Z = byId(id); A.nameField = Z && Z.fields.some((x) => x.name === 'name') ? 'name' : ''; renderAnalysis(); app.openPanel('analysis'); }

export function initTools(callbacks) {
  app = callbacks;
  renderAnalysis(); renderTools();
  on('layers', () => { renderAnalysis(); if (openTool) renderTools(); });
  void qualColor; void esc; void crsName; void $$;
}
