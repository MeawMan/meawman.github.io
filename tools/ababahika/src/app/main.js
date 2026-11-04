// main.js - Ababahika: map, contents (layers), layer properties, identify, attribute table.
import 'ol/ol.css';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import ImageLayer from 'ol/layer/Image.js';
import VectorLayer from 'ol/layer/Vector.js';
import LayerGroup from 'ol/layer/Group.js';
import XYZ from 'ol/source/XYZ.js';
import OSM from 'ol/source/OSM.js';
import ImageStatic from 'ol/source/ImageStatic.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style.js';
import { ScaleLine, Zoom, Attribution } from 'ol/control.js';
import Overlay from 'ol/Overlay.js';
import Draw from 'ol/interaction/Draw.js';
import Snap from 'ol/interaction/Snap.js';
import { register } from 'ol/proj/proj4.js';
import { transformExtent, toLonLat, get as getProj, transform } from 'ol/proj.js';
import { createEmpty, extend as extendExtent, isEmpty } from 'ol/extent.js';
import proj4 from 'proj4';

import { state, on, emit, newId, byId } from './state.js';
import { $, $$, h, toast, icon, iconBtn, fmt, fmtBytes, esc, download } from './ui.js';
import { groupFiles, loadJob, fieldsOf, geomKind, reprojectFC } from './io.js';
import { crsName, isGeographic, metresPerDegree, COMMON, ensureCrs, isKnown } from '../engine/crs.js';
import { SCHEMES, guessScheme, classTable, rampColor, rampCss, hexToRgb, qualColor, RAMPS } from './palettes.js';
import { exportVector, VECTOR_FORMATS } from './gp.js';
import { initTools, useZones } from './tools.js';
import { initHydro } from './hydro.js';

export const VERSION = '0.2.0';
register(proj4);
const reg = () => register(proj4);

// ---------------- theme ----------------
const root = document.documentElement;
$('#themeBtn').addEventListener('click', () => {
  const t = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = t; try { localStorage.setItem('mrj_theme', t); } catch (e) { /* ignore */ }
  setBasemap(state.basemap); emit('theme');
});

// ---------------- map ----------------
const BASEMAPS = {
  light: { label: 'Light grey', src: () => new XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attributions: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }) },
  dark: { label: 'Dark grey', src: () => new XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attributions: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }) },
  osm: { label: 'Streets', src: () => new OSM() },
  imagery: { label: 'Imagery', src: () => new XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attributions: 'Imagery © Esri, Maxar, Earthstar Geographics', maxZoom: 19 }) },
  topo: { label: 'Topographic', src: () => new XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attributions: 'Basemap © Esri and contributors', maxZoom: 19 }) },
  none: { label: 'None', src: null },
};
const baseLayer = new TileLayer({ zIndex: -1 });
const opLayers = new LayerGroup();
const map = new OlMap({
  target: 'map', layers: [baseLayer, opLayers],
  view: new View({ center: transform([90.35, 23.7], 'EPSG:4326', 'EPSG:3857'), zoom: 7, maxZoom: 22 }),
  controls: [new Zoom(), new ScaleLine({ units: 'metric', bar: true, steps: 4, text: false, minWidth: 110 }), new Attribution({ collapsible: true })],
});
state.map = map;
function setBasemap(key) {
  if (key === 'auto' || !key) key = root.dataset.theme === 'dark' ? 'dark' : 'light';
  state.basemap = key; const b = BASEMAPS[key] || BASEMAPS.light;
  baseLayer.setSource(b.src ? b.src() : null);
  $$('#basemaps button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === key));
}
state.basemap = 'auto';
$('#basemaps').append(...Object.entries(BASEMAPS).map(([k, b]) => h('button', { type: 'button', 'data-k': k, on: { click: () => { setBasemap(k); $('#basemapMenu').hidden = true; } } }, b.label)));
$('#basemapBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#basemapMenu').hidden = !$('#basemapMenu').hidden; });
document.addEventListener('click', (e) => { if (!e.target.closest('#basemapMenu')) $('#basemapMenu').hidden = true; });
setBasemap('auto');

// status bar: coordinates
map.on('pointermove', (e) => {
  if (e.dragging) return;
  const [lon, lat] = toLonLat(e.coordinate);
  let s = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
  const L = state.selected && byId(state.selected);
  if (L && L.crs && !isGeographic(L.crs) && L.crs !== 'EPSG:3857') { try { const [x, y] = proj4('EPSG:4326', L.crs, [lon, lat]); s += `  ·  ${fmt(x, 1)} E, ${fmt(y, 1)} N (${crsName(L.crs)})`; } catch (er) { /* ignore */ } }
  $('#coords').textContent = s;
});
map.getView().on('change:resolution', () => { $('#scale').textContent = `1:${Math.round(map.getView().getResolution() * 3779.5275591 * Math.cos(toLonLat(map.getView().getCenter())[1] * Math.PI / 180)).toLocaleString('en-US')}`; });

// ---------------- adding data ----------------
async function addFiles(files) {
  const jobs = groupFiles([...files]);
  if (!jobs.length) return;
  for (const job of jobs) {
    const nm = job.kind === 'shp' ? job.name : job.file.name;
    const t = toast(`Loading ${nm}…`, 'info', 60000);
    try {
      const specs = await loadJob(job, (s) => { t.textContent = s || `Loading ${nm}…`; });
      for (const s of specs) {
        if (s.needsCrs) {
          t.textContent = `${s.name}: which coordinate system?`;
          const code = await askCrs(s);
          if (!code) { toast(`${s.name} not added (no coordinate system).`, 'warn'); continue; }
          reprojectFC(s.fc, code, 'EPSG:4326'); s.srcCrs = code;
          toast(`${s.name}: read as ${crsName(code)} and converted to WGS 84.`, 'info', 7000);
        }
        const L = await addLayer(s); if (s.info) toast(s.info, 'info', 8000); if (s.warn) toast(s.warn, 'warn', 8000); if (L) zoomTo(L);
      }
    } catch (e) { toast(e.message, 'error', 9000); console.error(e); }
    t.remove();
  }
}
$('#addBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const mapEl = $('#mapWrap');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); mapEl.classList.add('drop'); } }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; mapEl.classList.remove('drop'); }));
document.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
$('#demoBtn')?.addEventListener('click', () => loadDemo('catchments'));
$('#demoPolderBtn')?.addEventListener('click', async () => { await loadDemo('polder'); openPanel('hydro'); });

async function loadDemo(kind = 'catchments') {
  const t = toast('Loading demo data…', 'info', 60000);
  try {
    const base = new URL('../data/demo/', import.meta.url);
    const names = kind === 'polder' ? ['polder_dem.tif', 'embankment.geojson', 'sluices.geojson', 'khals.geojson'] : ['catchments.zip', 'dem_utm.tif', 'lulc.tif', 'soil_poly.zip'];
    const files = await Promise.all(names.map(async (n) => new File([await (await fetch(new URL(n, base))).blob()], n)));
    await addFiles(files);
    const lu = state.layers.find((l) => l.name === 'lulc'); if (lu) { lu.name = 'LULC (demo classes)'; renderContents(); }
  } catch (e) { toast('Demo data could not be loaded: ' + e.message, 'error'); }
  t.remove();
}

/** Add a layer from a spec. Returns the layer. */
export async function addLayer(spec) {
  const L = { id: newId(), name: spec.name, type: spec.type, visible: true, opacity: spec.type === 'raster' ? 0.85 : 1 };
  if (spec.type === 'vector') {
    spec.fc.features = (spec.fc.features || []).filter((f) => f && f.geometry);
    spec.fc.features.forEach((f, i) => { f.id = i; f.properties = f.properties || {}; });
    Object.assign(L, { fc: spec.fc, crs: spec.srcCrs || 'EPSG:4326', geom: geomKind(spec.fc), fields: fieldsOf(spec.fc) });
    const color = qualColor(state.layers.filter((l) => l.type === 'vector').length + 1);
    L.sym = { stroke: color, fill: color, fillOpacity: L.geom === 'polygon' ? 0.12 : 0.8, width: L.geom === 'line' ? 2 : 1.6, label: '', choro: null, ...(spec.sym || {}) };
    if (spec.role) L.role = spec.role;
    L.source = new VectorSource({ features: new GeoJSON().readFeatures(spec.fc, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }) });
    L.ol = new VectorLayer({ source: L.source, style: (f) => vectorStyle(L, f), declutter: false });
  } else {
    Object.assign(L, { raster: spec.raster, file: spec.file, meta: spec.raster.meta, crs: spec.raster.meta.crs });
    L.ol = new LayerGroup();
    if (!L.crs) {
      const m = spec.raster.meta;
      const code = await askCrsDialog(spec.name, `The coordinate system is not stored in this GeoTIFF (top-left corner ${fmt(m.left, 1)}, ${fmt(m.top, 1)}). Choose the one it was made in; for an ArcGIS raster it is under Layer Properties → Source → Spatial Reference.`, guessXY(m.left, m.top), 'Use');
      if (!code) { toast(`${spec.name} not added (no coordinate system).`, 'warn'); return null; }
      L.crs = code; L.meta.crs = L.crs; L.meta.geographic = isGeographic(L.crs); L.crsOverride = L.crs;
    }
    reg();
    await prepareRaster(L);
    renderRaster(L);
  }
  L.ol.setOpacity(L.opacity);
  // like a desktop GIS: new vectors go on top, new rasters go above other rasters but under all vectors
  if (L.type === 'raster') { const i = state.layers.findIndex((l) => l.type === 'raster'); state.layers.splice(i < 0 ? state.layers.length : i, 0, L); }
  else state.layers.unshift(L);
  syncOrder(); renderContents(); select(L.id, false);
  emit('layers');
  return L;
}

export function removeLayer(id) {
  const i = state.layers.findIndex((l) => l.id === id); if (i < 0) return;
  opLayers.getLayers().remove(state.layers[i].ol);
  state.layers.splice(i, 1);
  if (state.selected === id) state.selected = state.layers[0]?.id || null;
  renderContents(); renderLayerPanel(); emit('layers');
}
function syncOrder() {
  const col = opLayers.getLayers(); col.clear();
  [...state.layers].reverse().forEach((l) => col.push(l.ol));
}
export function zoomTo(L) {
  let ext;
  if (L.type === 'vector') ext = L.source.getExtent();
  else ext = transformExtent([L.meta.left, L.meta.bottom, L.meta.right, L.meta.top], L.crs, 'EPSG:3857', 16);
  if (ext && !isEmpty(ext) && ext.every(Number.isFinite)) map.getView().fit(ext, { padding: [40, 40, 40, 40], duration: 300, maxZoom: 18 });
}
function zoomAll() {
  const e = createEmpty();
  for (const L of state.layers) {
    const x = L.type === 'vector' ? L.source.getExtent() : transformExtent([L.meta.left, L.meta.bottom, L.meta.right, L.meta.top], L.crs, 'EPSG:3857', 16);
    if (x.every(Number.isFinite)) extendExtent(e, x);
  }
  if (!isEmpty(e)) map.getView().fit(e, { padding: [40, 40, 40, 40], duration: 300 });
}
$('#zoomAllBtn').addEventListener('click', zoomAll);

// ---------------- vector styling ----------------
const styleCache = new Map();
function vectorStyle(L, f) {
  const s = L.sym, sel = state.highlight && state.highlight.layer === L.id && state.highlight.fid === f.getId();
  let fill = s.fill;
  if (s.choro && s.choro.field) {
    const v = f.get(s.choro.field), { min, max } = s.choro;
    if (Number.isFinite(v)) { const c = rampColor(s.choro.ramp, max > min ? (v - min) / (max - min) : 0.5); fill = `rgb(${c.map(Math.round).join(',')})`; } else fill = '#999999';
  }
  const fo = s.choro && s.choro.field ? Math.max(0.6, s.fillOpacity) : s.fillOpacity;
  const label = s.label ? String(f.get(s.label) ?? '') : '';
  const wd = s.widthBy ? s.width * (0.4 + 0.45 * (Number(f.get(s.widthBy)) || 1)) : s.width;
  const key = `${fill}|${fo}|${s.stroke}|${wd}|${label}|${sel}|${L.geom}|${root.dataset.theme}|${s.dash || ''}`;
  if (styleCache.has(key)) return styleCache.get(key);
  const rgb = fill.startsWith('#') ? hexToRgb(fill) : fill.match(/\d+/g).map(Number);
  const fillC = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${fo})`;
  const stroke = new Stroke({ color: sel ? '#ffd400' : s.stroke, width: sel ? wd + 2 : wd, lineDash: s.dash || undefined });
  const st = new Style({
    fill: new Fill({ color: fillC }), stroke,
    image: new CircleStyle({ radius: 5, fill: new Fill({ color: s.fill }), stroke: new Stroke({ color: '#fff', width: 1.2 }) }),
    text: label ? new Text({ text: label, font: '600 12px "Space Grotesk", system-ui, sans-serif', overflow: true, fill: new Fill({ color: root.dataset.theme === 'dark' ? '#eef3fb' : '#0b1222' }), stroke: new Stroke({ color: root.dataset.theme === 'dark' ? 'rgba(6,8,15,.85)' : 'rgba(255,255,255,.9)', width: 3 }) }) : undefined,
  });
  styleCache.set(key, st); return st;
}
export function refreshVector(L) { styleCache.clear(); L.ol.changed(); }
on('theme', () => { styleCache.clear(); state.layers.forEach((l) => l.type === 'vector' && l.ol.changed()); });

/** Replace a vector layer's features (e.g. after joining results), keeping its style. */
export function updateVectorData(L, fc) {
  L.fc = fc; L.fields = fieldsOf(fc);
  L.source.clear(); L.source.addFeatures(new GeoJSON().readFeatures(fc, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
  renderLayerPanel();
}

// ---------------- raster rendering ----------------
async function prepareRaster(L) {
  const m = L.meta;
  const pv = await L.raster.preview(1400);
  L.preview = pv;
  const nd = m.nodata, isND = (v) => v === nd || Number.isNaN(v);
  const vals = []; const step = Math.max(1, Math.floor(pv.data.length / 200000));
  const uniq = new Set(); let integer = /int/.test(m.dtype);
  for (let i = 0; i < pv.data.length; i += step) { const v = pv.data[i]; if (isND(v)) continue; vals.push(v); if (uniq.size <= 64) uniq.add(v); if (integer === false) continue; }
  vals.sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0);
  L.stats = { min: vals[0], max: vals[vals.length - 1], p2: q(0.02), p98: q(0.98) };
  const categorical = integer && uniq.size <= 64 && m.bands === 1;
  if (categorical) {
    // gather the full value list from the preview (all of it, not the sample)
    const all = new Set(); for (const v of pv.data) if (!isND(v)) all.add(v);
    const values = [...all].sort((a, b) => a - b), scheme = guessScheme(values);
    L.sym = { type: 'categorical', scheme, classes: classTable(values, scheme).map((c) => ({ ...c, show: true })) };
    L.role = scheme === 'usda' ? 'soil' : 'lulc';
  } else {
    const isDem = /dem|srtm|alos|elev|dtm|dsm|height|aster|fabdem|copdem|nasadem/i.test(L.name) || (m.dtype.startsWith('float') || /int16/.test(m.dtype));
    L.sym = { type: 'continuous', ramp: isDem ? 'terrain' : 'viridis', min: L.stats.p2, max: L.stats.p98, hillshade: isDem, invert: false };
    L.role = isDem ? 'dem' : 'continuous';
  }
}

function paint(L, data, w, h, cellX, cellY) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false }), img = ctx.createImageData(w, h), px = img.data;
  const s = L.sym, nd = L.meta.nodata, isND = (v) => v === nd || Number.isNaN(v);
  if (s.type === 'categorical') {
    const lut = new Map(s.classes.filter((k) => k.show).map((k) => [k.value, hexToRgb(k.color)]));
    for (let i = 0; i < data.length; i++) { const col = lut.get(data[i]); if (!col) continue; px[4 * i] = col[0]; px[4 * i + 1] = col[1]; px[4 * i + 2] = col[2]; px[4 * i + 3] = 255; }
  } else {
    const span = s.max - s.min || 1;
    let hs = null;
    if (s.hillshade && cellX > 0) {
      hs = new Float32Array(data.length);
      const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, zen = Math.PI / 2 - alt, azr = 2 * Math.PI - az + Math.PI / 2;
      const g = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); const v = data[y * w + x]; return isND(v) ? NaN : v; };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const z = g(x, y); if (!Number.isFinite(z)) continue;
        const f = (xx, yy) => { const v = g(xx, yy); return Number.isFinite(v) ? v : z; };
        const dzdx = ((f(x + 1, y - 1) + 2 * f(x + 1, y) + f(x + 1, y + 1)) - (f(x - 1, y - 1) + 2 * f(x - 1, y) + f(x - 1, y + 1))) / (8 * cellX);
        const dzdy = ((f(x - 1, y + 1) + 2 * f(x, y + 1) + f(x + 1, y + 1)) - (f(x - 1, y - 1) + 2 * f(x, y - 1) + f(x + 1, y - 1))) / (8 * cellY);
        const slope = Math.atan(1.6 * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
        hs[y * w + x] = Math.max(0, Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(azr - aspect));
      }
    }
    for (let i = 0; i < data.length; i++) {
      const v = data[i]; if (isND(v)) continue;
      let t = (v - s.min) / span; if (s.invert) t = 1 - t;
      const col = rampColor(s.ramp, t), k = hs ? 0.45 + 0.65 * hs[i] : 1;
      px[4 * i] = Math.min(255, col[0] * k); px[4 * i + 1] = Math.min(255, col[1] * k); px[4 * i + 2] = Math.min(255, col[2] * k); px[4 * i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function metricCell(L, rx, ry, latMid) {
  if (!isGeographic(L.crs)) return [rx, ry];
  const mp = metresPerDegree(latMid); return [rx * mp.dx, ry * mp.dy];
}
export function renderRaster(L) {
  const m = L.meta, pv = L.preview;
  const [cx, cy] = metricCell(L, m.rx * m.width / pv.w, m.ry * m.height / pv.h, (m.top + m.bottom) / 2);
  const cv = paint(L, pv.data, pv.w, pv.h, cx, cy);
  const ext = [m.left, m.bottom, m.right, m.top];
  const base = new ImageLayer({ source: new ImageStatic({ url: cv.toDataURL(), imageExtent: ext, projection: L.crs, interpolate: false }) });
  L.ol.getLayers().clear(); L.ol.getLayers().push(base);
  L.detailKey = null; scheduleDetail();
}
// sharper rendering of the visible part when zoomed in beyond the preview resolution
let detailTimer = 0, detailGen = 0;
function scheduleDetail() { clearTimeout(detailTimer); detailTimer = setTimeout(renderDetails, 250); }
map.on('moveend', scheduleDetail);
async function renderDetails() {
  const gen = ++detailGen, size = map.getSize(); if (!size) return;
  const view3857 = map.getView().calculateExtent(size), res3857 = map.getView().getResolution();
  for (const L of state.layers) {
    if (L.type !== 'raster' || !L.visible) continue;
    const m = L.meta, pv = L.preview;
    let ve; try { ve = transformExtent(view3857, 'EPSG:3857', L.crs, 8); } catch (e) { continue; }
    const pvRes = m.rx * m.width / pv.w;
    const viewRes = (ve[2] - ve[0]) / size[0];
    const layers = L.ol.getLayers();
    if (viewRes > pvRes * 0.7) { while (layers.getLength() > 1) layers.pop(); continue; }
    const x0 = Math.max(0, Math.floor((ve[0] - m.left) / m.rx)), x1 = Math.min(m.width, Math.ceil((ve[2] - m.left) / m.rx));
    const y0 = Math.max(0, Math.floor((m.top - ve[3]) / m.ry)), y1 = Math.min(m.height, Math.ceil((m.top - ve[1]) / m.ry));
    if (x1 <= x0 || y1 <= y0) continue;
    const key = `${x0},${y0},${x1},${y1},${JSON.stringify(L.sym)}`; if (key === L.detailKey) continue;
    const scale = Math.min(1, (size[0] * 1.5) / (x1 - x0), (size[1] * 1.5) / (y1 - y0));
    const w = Math.max(1, Math.round((x1 - x0) * scale)), hgt = Math.max(1, Math.round((y1 - y0) * scale));
    try {
      const r = await L.raster.img.readRasters({ window: [x0, y0, x1, y1], width: w, height: hgt, samples: [0], resampleMethod: 'nearest', interleave: false });
      if (gen !== detailGen) return;
      const left = m.left + x0 * m.rx, top = m.top - y0 * m.ry, right = m.left + x1 * m.rx, bottom = m.top - y1 * m.ry;
      const [cx, cy] = metricCell(L, (right - left) / w, (top - bottom) / hgt, (top + bottom) / 2);
      const cv = paint(L, r[0], w, hgt, cx, cy);
      while (layers.getLength() > 1) layers.pop();
      layers.push(new ImageLayer({ source: new ImageStatic({ url: cv.toDataURL(), imageExtent: [left, bottom, right, top], projection: L.crs, interpolate: false }) }));
      L.detailKey = key;
    } catch (e) { console.warn(e); }
  }
  void res3857;
}

// ---------------- contents panel ----------------
let dragId = null;
export function renderContents() {
  const ul = $('#layerList'); ul.innerHTML = '';
  $('#emptyLayers').hidden = state.layers.length > 0;
  for (const L of state.layers) {
    const sw = L.type === 'vector' ? h('span.sw.' + L.geom, { style: { '--c': L.sym.stroke, '--f': L.sym.fill } })
      : L.sym.type === 'categorical' ? h('span.sw.cat', { style: { background: `conic-gradient(${L.sym.classes.slice(0, 6).map((c, i, a) => `${c.color} ${i / a.length * 100}% ${(i + 1) / a.length * 100}%`).join(',')})` } })
        : h('span.sw.ramp', { style: { background: rampCss(L.sym.ramp) } });
    const li = h('li.layer', { draggable: true, 'data-id': L.id, 'aria-selected': state.selected === L.id,
      on: { click: (e) => { if (!e.target.closest('button')) select(L.id); }, dragstart: () => { dragId = L.id; li.classList.add('dragging'); }, dragend: () => li.classList.remove('dragging'),
        dragover: (e) => { e.preventDefault(); }, drop: (e) => { e.preventDefault(); e.stopPropagation(); reorder(dragId, L.id); }, dblclick: () => zoomTo(L) } },
    iconBtn(L.visible ? 'eye' : 'eyeoff', L.visible ? 'Hide' : 'Show', () => { L.visible = !L.visible; L.ol.setVisible(L.visible); renderContents(); if (L.visible) scheduleDetail(); }, L.visible ? '' : 'off'),
    sw,
    h('span.lname', { title: L.name }, L.name, h('small', L.type === 'vector' ? `${L.fc.features.length} ${L.geom}${L.fc.features.length === 1 ? '' : 's'}` : `${L.meta.width}×${L.meta.height} · ${fmtCell(L)}`)),
    iconBtn('zoom', 'Zoom to layer', () => zoomTo(L)),
    );
    ul.append(li);
  }
}
function fmtCell(L) { const m = L.meta; return isGeographic(L.crs) ? `${(m.rx * 3600).toPrecision(3)}″` : `${+m.rx.toPrecision(4)} m`; }
function reorder(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const a = state.layers.findIndex((l) => l.id === fromId), b = state.layers.findIndex((l) => l.id === toId);
  const [L] = state.layers.splice(a, 1); state.layers.splice(b, 0, L); syncOrder(); renderContents();
}
export function select(id, open = true) {
  state.selected = id; renderContents(); renderLayerPanel(); if (open) openPanel('layer');
}

// ---------------- right panel: layer ----------------
export function openPanel(tab) {
  $$('#sideTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('.sidepane').forEach((p) => { p.hidden = p.id !== `pane-${tab}`; });
  $('#side').classList.remove('collapsed');
  if (matchMedia('(max-width: 900px)').matches && !$('#drawer').hidden) { $('#drawer').hidden = true; map.updateSize(); }
}
$$('#sideTabs button').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.tab)));

function field(label, input, hint) { return h('label.f', label, input, hint ? h('span.hint', hint) : null); }
function select_(opts, val, onchange) {
  const s = h('select', { on: { change: (e) => onchange(e.target.value) } }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(val) }, t)));
  return s;
}

export function renderLayerPanel() {
  const pane = $('#pane-layer'); pane.innerHTML = '';
  const L = state.selected && byId(state.selected);
  if (!L) { pane.append(h('p.empty', 'Add data with ', h('b', '＋'), ' or drop files on the map, then select a layer here.')); return; }
  const nameIn = h('input', { type: 'text', value: L.name, on: { change: (e) => { L.name = e.target.value || L.name; renderContents(); emit('layers'); } } });
  pane.append(h('div.pane-head', nameIn, h('div.actions',
    iconBtn('zoom', 'Zoom to layer', () => zoomTo(L)),
    L.type === 'vector' ? iconBtn('table', 'Attribute table', () => showAttributes(L)) : null,
    iconBtn('download', 'Export', () => exportDialog(L)),
    iconBtn('trash', 'Remove layer', () => { if (confirm(`Remove ${L.name}?`)) removeLayer(L.id); }, 'danger'))));
  const op = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: L.opacity, on: { input: (e) => { L.opacity = +e.target.value; L.ol.setOpacity(L.opacity); } } });
  pane.append(h('div.grp', field('Transparency', op)));
  if (L.type === 'vector') vectorSymbology(pane, L); else rasterSymbology(pane, L);
  pane.append(h('details.props', h('summary', 'Properties'), propsTable(L)));
}
function propsTable(L) {
  const rows = [['Coordinate system', `${crsName(L.crs)}${L.crs && L.crs.startsWith('EPSG') ? ` (${L.crs})` : ''}`]];
  if (L.type === 'raster') {
    const m = L.meta;
    rows.push(['Size', `${m.width} × ${m.height} cells, ${m.bands} band${m.bands > 1 ? 's' : ''}`], ['Cell size', isGeographic(L.crs) ? `${m.rx.toPrecision(6)}° × ${m.ry.toPrecision(6)}° (${(m.rx * 3600).toPrecision(3)}″)` : `${m.rx} × ${m.ry} m`],
      ['Data type', m.dtype], ['NoData', m.nodata ?? 'none'], ['Extent', `${fmt(m.left, 4)}, ${fmt(m.bottom, 4)} — ${fmt(m.right, 4)}, ${fmt(m.top, 4)}`],
      ['File', `${L.file.name} · ${fmtBytes(m.bytes)}${m.tiled ? ' · tiled' : ' · striped'}${m.overviews ? ` · ${m.overviews} overview(s)` : ''}`],
      ['Values (sampled)', `${fmt(L.stats.min, 3)} to ${fmt(L.stats.max, 3)}`]);
  } else {
    rows.push(['Features', L.fc.features.length], ['Geometry', L.geom], ['Fields', L.fields.map((f) => f.name).join(', ') || 'none'],
      ['Shown as', 'WGS 84 internally; exported in any coordinate system']);
  }
  return h('table.kv', rows.map(([k, v]) => h('tr', h('th', k), h('td', String(v)))));
}

function vectorSymbology(pane, L) {
  const s = L.sym, upd = () => { refreshVector(L); renderContents(); };
  const col = (k) => h('input', { type: 'color', value: s[k].startsWith('#') ? s[k] : '#4e79a7', on: { input: (e) => { s[k] = e.target.value; upd(); } } });
  const g = h('div.grp', h('h4', 'Symbology'));
  g.append(h('div.row', L.geom !== 'line' ? field('Fill', col('fill')) : null, field('Outline', col('stroke')),
    field('Width', h('input', { type: 'number', min: 0, max: 10, step: 0.5, value: s.width, on: { input: (e) => { s.width = +e.target.value; upd(); } } }))));
  if (L.geom === 'polygon') g.append(field('Fill opacity', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.fillOpacity, on: { input: (e) => { s.fillOpacity = +e.target.value; upd(); } } })));
  g.append(field('Labels', select_([['', 'None'], ...L.fields.map((f) => [f.name, f.name])], s.label, (v) => { s.label = v; upd(); })));
  const nums = L.fields.filter((f) => f.type === 'number');
  if (nums.length) {
    const choro = s.choro || { field: '', ramp: 'slope' };
    const setField = (v) => {
      if (!v) { s.choro = null; upd(); renderLayerPanel(); return; }
      const vals = L.fc.features.map((f) => f.properties[v]).filter(Number.isFinite);
      s.choro = { field: v, ramp: choro.ramp, min: Math.min(...vals), max: Math.max(...vals) }; upd(); renderLayerPanel();
    };
    g.append(field('Colour by value', select_([['', 'Single colour'], ...nums.map((f) => [f.name, f.name])], choro.field, setField)));
    if (s.choro) {
      g.append(h('div.row', field('Ramp', select_(Object.keys(RAMPS).map((k) => [k, k]), s.choro.ramp, (v) => { s.choro.ramp = v; upd(); renderLayerPanel(); })),
        field('Min', h('input', { type: 'number', step: 'any', value: +s.choro.min.toPrecision(6), on: { change: (e) => { s.choro.min = +e.target.value; upd(); } } })),
        field('Max', h('input', { type: 'number', step: 'any', value: +s.choro.max.toPrecision(6), on: { change: (e) => { s.choro.max = +e.target.value; upd(); } } }))));
      g.append(h('div.legend-ramp', h('span.bar', { style: { background: rampCss(s.choro.ramp) } }), h('span', fmt(s.choro.min)), h('span', fmt(s.choro.max))));
    }
  }
  pane.append(g);
}

function rasterSymbology(pane, L) {
  const s = L.sym, g = h('div.grp', h('h4', 'Symbology'));
  const rerender = () => { renderRaster(L); renderContents(); };
  g.append(field('Show as', select_([['continuous', 'Stretched (continuous)'], ['categorical', 'Unique values (classes)']], s.type, async (v) => {
    if (v === 'categorical') {
      const all = new Set(); for (const x of L.preview.data) if (x !== L.meta.nodata && !Number.isNaN(x)) { all.add(x); if (all.size > 256) break; }
      if (all.size > 256) { toast('More than 256 distinct values: not a class raster.', 'warn'); renderLayerPanel(); return; }
      const values = [...all].sort((a, b) => a - b), scheme = guessScheme(values);
      L.sym = { type: 'categorical', scheme, classes: classTable(values, scheme).map((c) => ({ ...c, show: true })) };
    } else L.sym = { type: 'continuous', ramp: 'terrain', min: L.stats.p2, max: L.stats.p98, hillshade: false };
    rerender(); renderLayerPanel();
  })));
  if (s.type === 'continuous') {
    g.append(h('div.row', field('Colour ramp', select_(Object.keys(RAMPS).map((k) => [k, k]), s.ramp, (v) => { s.ramp = v; rerender(); renderLayerPanel(); })),
      field('Min', h('input', { type: 'number', step: 'any', value: +(+s.min).toPrecision(6), on: { change: (e) => { s.min = +e.target.value; rerender(); } } })),
      field('Max', h('input', { type: 'number', step: 'any', value: +(+s.max).toPrecision(6), on: { change: (e) => { s.max = +e.target.value; rerender(); } } }))));
    g.append(h('div.legend-ramp', h('span.bar', { style: { background: rampCss(s.ramp) } }), h('span', fmt(s.min)), h('span', fmt(s.max))));
    g.append(h('div.row',
      h('label.check', h('input', { type: 'checkbox', checked: !!s.hillshade, on: { change: (e) => { s.hillshade = e.target.checked; rerender(); } } }), ' Hillshade'),
      h('label.check', h('input', { type: 'checkbox', checked: !!s.invert, on: { change: (e) => { s.invert = e.target.checked; rerender(); } } }), ' Invert'),
      h('button.link', { type: 'button', on: { click: () => { s.min = L.stats.min; s.max = L.stats.max; rerender(); renderLayerPanel(); } } }, 'Full range')));
  } else {
    g.append(field('Class names', select_([['', 'Custom'], ...Object.entries(SCHEMES).map(([k, v]) => [k, v.name])], s.scheme || '', (v) => {
      s.scheme = v || null; const t = classTable(s.classes.map((c) => c.value), s.scheme);
      if (v) s.classes = t.map((c, i) => ({ ...c, show: s.classes[i].show })); rerender(); renderLayerPanel();
    })));
    const tb = h('table.classes');
    s.classes.forEach((c) => tb.append(h('tr',
      h('td', h('input', { type: 'checkbox', checked: c.show, title: 'Show', on: { change: (e) => { c.show = e.target.checked; rerender(); } } })),
      h('td', h('input', { type: 'color', value: c.color, on: { input: (e) => { c.color = e.target.value; rerender(); } } })),
      h('td.v', String(c.value)),
      h('td', h('input', { type: 'text', value: c.name, on: { change: (e) => { c.name = e.target.value; s.scheme = null; emit('layers'); } } })))));
    g.append(h('div.scrolly', tb));
    g.append(h('p.hint', 'Values come from a reduced preview; rare classes may be missing here but are always counted in analyses. ',
      h('button.link', { type: 'button', on: { click: () => pasteNames(L) } }, 'Paste class names…')));
  }
  pane.append(g);
}
function pasteNames(L) {
  const txt = prompt('Paste "value, name" lines (e.g. from Excel):'); if (!txt) return;
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\t]\s*(.+?)\s*$/.exec(line); if (!m) continue;
    const c = L.sym.classes.find((k) => k.value === +m[1]);
    if (c) c.name = m[2]; else L.sym.classes.push({ value: +m[1], name: m[2], color: qualColor(L.sym.classes.length), show: true });
  }
  L.sym.classes.sort((a, b) => a.value - b.value); L.sym.scheme = null; renderLayerPanel(); renderRaster(L); emit('layers');
}

// ---------------- export ----------------
function exportDialog(L) {
  if (L.type === 'raster') { download(L.file, L.file.name.endsWith('.tif') ? L.file.name : L.name + '.tif'); return; }
  const fmtSel = h('select', Object.entries(VECTOR_FORMATS).map(([k, v]) => h('option', { value: k }, v.label)));
  const crsSel = crsPicker('EPSG:4326');
  const dlg = modal(`Export ${L.name}`, h('div.form', field('Format', fmtSel), field('Coordinate system', crsSel.el),
    h('p.hint', 'Shapefile/GeoPackage exports carry a .prj with the chosen coordinate system. KML is always WGS 84.')),
  [h('button.primary', { type: 'button', on: { click: async () => {
    const b = dlg.querySelector('.primary'); b.disabled = true; b.textContent = 'Exporting…';
    try { const crs = await crsSel.value(); const { blob, filename } = await exportVector(L.fc, L.name, { format: fmtSel.value, crs }, (m) => { if (m) b.textContent = m; }); download(blob, filename); dlg.close(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Export'; }
  } } }, 'Export')]);
}
/** A coordinate system picker: common systems + any EPSG code. Returns {el, value():Promise<code>}. */
/** A first guess from the coordinates in metres: northings below 1 500 000 are BTM as used in Bangladesh, larger ones UTM. */
function guessXY(x, y) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'EPSG:4326';
  if (y < 1.5e6 && x > 2e5 && x < 8e5) return 'BTM:BD';
  return 'EPSG:32646';
}
function guessCrs(fc) {
  for (const f of fc.features || []) {
    if (!f.geometry) continue;
    let c = f.geometry.coordinates; while (Array.isArray(c[0])) c = c[0];
    return guessXY(c[0], c[1]);
  }
  return 'EPSG:32646';
}
/** Ask which coordinate system a layer without a usable .prj uses. Resolves to a code, or null when cancelled. */
function askCrs(spec) {
  return askCrsDialog(spec.name, `The coordinates are in metres, but ${spec.why}. Choose the coordinate system the data was made in; the layer will be converted to WGS 84.`, guessCrs(spec.fc), 'Use and convert');
}
/** The coordinate-system question (list of common systems, or any EPSG code). Resolves to a code, or null. */
function askCrsDialog(name, text, def, okLabel) {
  const pk = crsPicker(def);
  return new Promise((res) => {
    const d = modal(`${name}: coordinate system`, h('div.form', h('p', text), pk.el), [h('button.primary', { value: 'ok' }, okLabel)]);
    let done = false;
    const end = async (ok) => { if (done) return; done = true; if (d.open) d.close(); if (!ok) return res(null); try { res(await pk.value()); } catch (e) { toast(e.message, 'error'); res(null); } };
    // answered from the buttons themselves (not only the dialog's close event)
    d.addEventListener('click', (e) => { const b = e.target.closest('button[value]'); if (!b) return; e.preventDefault(); end(b.value === 'ok'); });
    d.addEventListener('close', () => end(false));
  });
}
export function crsPicker(def) {
  const sel = h('select', [...COMMON.map((c) => h('option', { value: c, selected: c === def }, `${crsName(c)} — ${c}`)), h('option', { value: 'other' }, 'Other EPSG code…')]);
  const inp = h('input', { type: 'text', placeholder: 'EPSG code, e.g. 32645', hidden: true });
  sel.addEventListener('change', () => { inp.hidden = sel.value !== 'other'; if (!inp.hidden) inp.focus(); });
  return { el: h('div.crs', sel, inp), async value() { if (sel.value !== 'other') return sel.value; const c = `EPSG:${inp.value.replace(/\D/g, '')}`; await ensureCrs(c); reg(); return c; } };
}
export function modal(title, body, actions = []) {
  const d = h('dialog.modal', h('form', { method: 'dialog' }, h('header', h('h3', title), h('button.ib', { value: 'x', 'aria-label': 'Close' }, icon('x'))), body,
    h('footer', h('button', { value: 'cancel' }, 'Cancel'), ...actions)));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d;
}

// ---------------- attribute table (bottom drawer) ----------------
export function openDrawer(title, content, tools = []) {
  const d = $('#drawer'); d.hidden = false;
  if (matchMedia('(max-width: 900px)').matches) $('#side').classList.add('collapsed'); // phone: one bottom sheet at a time
  $('#drawerTitle').textContent = title; $('#drawerTools').replaceChildren(...tools.filter(Boolean)); $('#drawerBody').replaceChildren(content);
  map.updateSize();
}
$('#drawerClose').addEventListener('click', () => { $('#drawer').hidden = true; map.updateSize(); });
function showAttributes(L) {
  const cols = L.fields.map((f) => f.name);
  const tb = h('table.grid', h('thead', h('tr', h('th', '#'), cols.map((c) => h('th', c)))),
    h('tbody', L.fc.features.slice(0, 5000).map((f, i) => h('tr', { on: { click: () => highlight(L, f.id, true) } }, h('td', i + 1),
      cols.map((c) => { const v = f.properties[c]; return h('td', { class: typeof v === 'number' ? 'n' : '' }, typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 3) : v ?? ''); })))));
  openDrawer(`${L.name} — ${L.fc.features.length} features`, h('div.scroll', tb));
}
export function highlight(L, fid, zoom) {
  state.highlight = { layer: L.id, fid }; styleCache.clear(); L.ol.changed();
  if (zoom) { const f = L.source.getFeatureById(fid); if (f) map.getView().fit(f.getGeometry().getExtent(), { padding: [60, 60, 60, 60], duration: 300, maxZoom: 17 }); }
}

// ---------------- drawing (points / lines) ----------------
let drawing = null;
/** Draw features into a layer (created if needed). kind 'Point' | 'LineString'. Returns the layer. */
export async function startDraw(kind, name, spec = {}) {
  stopDraw();
  let L = state.layers.find((l) => l.type === 'vector' && l.name === name);
  if (!L) L = await addLayer({ type: 'vector', name, fc: { type: 'FeatureCollection', features: [] }, ...spec });
  L.geom = kind === 'Point' ? 'point' : 'line';
  const draw = new Draw({ source: L.source, type: kind });
  const snaps = state.layers.filter((l) => l.type === 'vector' && l.visible).map((l) => new Snap({ source: l.source, pixelTolerance: 10 }));
  draw.on('drawend', (e) => {
    const gj = new GeoJSON().writeFeatureObject(e.feature, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    const n = L.fc.features.length + 1;
    gj.properties = { name: `${spec.prefix || (kind === 'Point' ? 'Point' : 'Line')} ${n}` }; gj.id = n - 1;
    e.feature.setId(n - 1); e.feature.setProperties(gj.properties);
    L.fc.features.push(gj); L.fields = fieldsOf(L.fc); renderContents(); emit('layers');
  });
  map.addInteraction(draw); snaps.forEach((x) => map.addInteraction(x));
  drawing = { draw, snaps, L };
  $('#drawBar').hidden = false; $('#drawMsg').textContent = kind === 'Point' ? `Click to add points to “${name}”.` : `Click to add vertices to “${name}”, double-click to finish a line.`;
  return L;
}
export function stopDraw() {
  if (!drawing) return;
  map.removeInteraction(drawing.draw); drawing.snaps.forEach((x) => map.removeInteraction(x));
  drawing = null; $('#drawBar').hidden = true; emit('layers');
}
$('#drawDone').addEventListener('click', stopDraw);
$('#drawUndo').addEventListener('click', () => {
  if (!drawing) return;
  if (drawing.L.geom === 'line') { try { drawing.draw.removeLastPoint(); } catch (e) { /* ignore */ } }
  const L = drawing.L, last = L.fc.features.pop(); if (!last) return;
  const f = L.source.getFeatureById(last.id); if (f) L.source.removeFeature(f); renderContents(); emit('layers');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopDraw(); });

// ---------------- identify ----------------
const popup = new Overlay({ element: $('#popup'), autoPan: { animation: { duration: 200 } }, positioning: 'bottom-center', offset: [0, -10] });
map.addOverlay(popup);
$('#popupClose').addEventListener('click', () => popup.setPosition(undefined));
map.on('singleclick', async (e) => {
  if (drawing) return;
  const parts = [];
  let hit = null;
  map.forEachFeatureAtPixel(e.pixel, (f, layer) => { if (!hit) { const L = state.layers.find((l) => l.ol === layer); if (L) hit = { L, f }; } }, { hitTolerance: 4 });
  if (hit) {
    highlight(hit.L, hit.f.getId());
    const props = hit.f.getProperties(); delete props.geometry;
    parts.push(h('div.pop-sec', h('b', hit.L.name), h('table.kv', Object.entries(props).slice(0, 40).map(([k, v]) => h('tr', h('th', k), h('td', typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 3) : String(v ?? '')))))));
  }
  for (const L of state.layers) {
    if (L.type !== 'raster' || !L.visible) continue;
    let p; try { p = transform(e.coordinate, 'EPSG:3857', L.crs); } catch (er) { continue; }
    const m = L.meta, c = Math.floor((p[0] - m.left) / m.rx), r = Math.floor((m.top - p[1]) / m.ry);
    if (c < 0 || r < 0 || c >= m.width || r >= m.height) continue;
    const { data } = await L.raster.read(c, r, c + 1, r + 1);
    const v = data[0], isND = v === m.nodata || Number.isNaN(v);
    let txt = isND ? 'NoData' : fmt(v, Number.isInteger(v) ? 0 : 3);
    if (!isND && L.sym.type === 'categorical') { const k = L.sym.classes.find((q) => q.value === v); if (k) txt += ` — ${k.name}`; }
    parts.push(h('div.pop-sec', h('b', L.name), h('div', txt)));
  }
  if (!parts.length) { popup.setPosition(undefined); return; }
  const [lon, lat] = toLonLat(e.coordinate);
  $('#popupBody').replaceChildren(...parts, h('div.hint', `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`));
  popup.setPosition(e.coordinate);
});

// ---------------- panels ----------------
$('#sideToggle').addEventListener('click', () => { $('#side').classList.toggle('collapsed'); setTimeout(() => map.updateSize(), 220); });
$('#contentsToggle').addEventListener('click', () => { $('#contents').classList.toggle('collapsed'); setTimeout(() => map.updateSize(), 220); });
$('#ver').textContent = 'v' + VERSION;
window.addEventListener('resize', () => map.updateSize());

$('#helpBtn').addEventListener('click', () => modal('How to use Ababahika', h('div.prose',
  h('h4', '1 · Add data'), h('p', 'Drop files on the map or press ＋ Add data. Shapefiles: a .zip, or select the .shp, .dbf and .prj together. Rasters: GeoTIFF of any size (read in pieces, never loaded whole); .img, .asc and others are converted with GDAL.'),
  h('h4', '2 · Catchment stats'), h('p', 'Pick the catchment layer and the DEM, land-cover and soil maps, then Calculate. You get slope statistics and slope classes, the area and percentage of every land-cover and soil class for each catchment, an Excel workbook, a methods paragraph, and the results joined to the catchment layer (coloured by mean slope).'),
  h('h4', '3 · Hydrology'), h('p', 'Build a D8 flow model from a DEM, with embankments burned in as walls, sluices as openings and khals as channels (shapefiles, or draw them on the map). Each sluice gets its drainage unit; other outlets can be clicked or loaded and are snapped to the largest flow nearby. Download flow direction (ESRI codes), accumulation and filled DEM as GeoTIFF. In flat polder land, read the Flat % and Filled % of each unit: where they are high the terrain did not decide the boundary.'),
  h('h4', '4 · Tools'), h('p', 'Project, clip, merge and dissolve run real GDAL in the browser; results appear as new layers. Export any vector layer as shapefile, GeoPackage, GeoJSON or KML in any coordinate system.'),
  h('h4', 'How the numbers are made'), h('ul',
    h('li', 'A cell counts for a catchment when its centre is inside the polygon (GDAL/ArcGIS rule).'),
    h('li', 'Slope: Horn (1981) 3×3 method, as ArcGIS Slope. Geographic DEMs (degrees) are handled with true metre spacing per row, so you do not need to project them first.'),
    h('li', 'Areas use true cell areas (exact on the WGS 84 ellipsoid for geographic rasters); catchment areas are geodesic.'),
    h('li', 'Checked against rasterio, rasterstats, shapely and pyproj on test data: identical cell counts, slope statistics to 1e-9°, class areas to the square metre.')),
  h('p.hint', 'Your files never leave this computer. Basemap tiles come from Esri and OpenStreetMap.'))));
if (matchMedia('(max-width: 900px)').matches) { $('#contents').classList.add('collapsed'); $('#side').classList.add('collapsed'); }

renderContents(); renderLayerPanel();
const callbacks = { startDraw, stopDraw, addLayer, removeLayer, useZones, openDrawer, openPanel, refreshVector, updateVectorData, highlight, crsPicker, modal, renderLayerPanel, zoomTo };
initTools(callbacks); initHydro(callbacks);
openPanel('analysis');
if (/[?&]demo=polder\b/.test(location.search)) loadDemo('polder').then(() => openPanel('hydro')); else if (/[?&]demo\b/.test(location.search)) loadDemo();
void isKnown; void getProj;
