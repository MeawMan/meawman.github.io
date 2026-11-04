// hydroworker.js - keeps one prepared flow model in memory so pour points can be delineated repeatedly.
import proj4 from 'proj4';
import { openRaster } from '../engine/raster.js';
import { ensureCrs, loadExtra, utmFor } from '../engine/crs.js';
import { loadGrid, prepare, streams, snap, watersheds, polygonize, labelStats, cellArea } from '../engine/hydro.js';
import { writeTiff } from '../engine/tiffout.js';
import { featureArea } from '../engine/zonal.js';

let S = null; // {g, dir, acc, flag, filled, cond, fw, inv, name, labels, threshold}

const post = (id, msg, transfer) => self.postMessage({ id, ...msg }, transfer || []);
const lines = (fc) => { const out = []; for (const f of fc ? fc.features : []) { const g = f.geometry; if (!g) continue; if (g.type === 'LineString') out.push(g.coordinates); else if (g.type === 'MultiLineString') out.push(...g.coordinates); else if (g.type === 'Polygon') out.push(...g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => out.push(...p)); } return out; };
const points = (fc) => (fc ? fc.features : []).filter((f) => f.geometry && /Point/.test(f.geometry.type)).flatMap((f) => (f.geometry.type === 'Point' ? [{ c: f.geometry.coordinates, p: f.properties || {} }] : f.geometry.coordinates.map((c) => ({ c, p: f.properties || {} }))));

self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  try {
    if (cmd === 'prep') {
      const { file, crsOverride, crsDefs, cellSize, cond, threshold } = e.data;
      loadExtra(crsDefs); S = null;
      const raster = await openRaster(file, file.name);
      if (crsOverride) raster.meta.crs = crsOverride;
      await ensureCrs(raster.meta.crs);
      const step = (s, f) => post(id, { step: s, progress: f });
      step('Reading DEM', 0);
      const g = await loadGrid(raster, { cellSize, onProgress: (f) => post(id, { step: 'Reading DEM', progress: f }) });
      const fw = proj4('EPSG:4326', g.crs).forward, inv = proj4(g.crs, 'EPSG:4326').forward;
      const toG = (cs) => cs.map((c) => fw([c[0], c[1]]));
      const t0 = Date.now();
      const st = prepare(g, {
        streams: lines(cond.streams).map(toG), streamDepth: cond.streamDepth,
        walls: lines(cond.walls).map(toG), wallHeight: cond.wallHeight,
        openings: points(cond.openings).map((q) => fw(q.c)), openingRadius: cond.openingRadius,
      }, (s) => step(s));
      S = { ...st, fw, inv, name: raster.meta.name };
      let valid = 0, flat = 0, filled = 0; for (let i = 0; i < g.z.length; i++) { if (g.z[i] === g.z[i]) { valid++; if (st.flag[i] === 2) flat++; else if (st.flag[i] === 1) filled++; } }
      const net = buildStreams(threshold);
      post(id, { result: { W: g.W, H: g.H, rx: g.rx, ry: g.ry, crs: g.crs, geographic: g.geographic, cells: valid, flatPct: 100 * flat / valid, filledPct: 100 * filled / valid,
        cond: { wallCells: st.cond.wallCells, streamCells: st.cond.streamCells, openedCells: st.cond.openedCells }, seconds: (Date.now() - t0) / 1000, streams: net } });
    } else if (cmd === 'streams') {
      if (!S) throw new Error('Run the flow preparation first.');
      post(id, { result: buildStreams(e.data.threshold) });
    } else if (cmd === 'delineate') {
      if (!S) throw new Error('Run the flow preparation first.');
      const { pts, snapRadius, mode, useOpenings } = e.data, g = S.g;
      const cellM = g.geographic ? cellSizeMetres(g) : g.rx;
      const R = Math.max(0, Math.round(snapRadius / cellM));
      // sluices that opened a wall drain through their opened cells; other points snap to the largest flow nearby
      const opened = useOpenings ? S.cond.openingCells : [];
      const sn = pts.map((q, k) => {
        const oc = opened[k] && opened[k].length ? opened[k] : null;
        if (oc) { const best = oc.reduce((a, b) => (S.acc.area[b] > S.acc.area[a] ? b : a)); const r = (best / g.W) | 0, c = best - r * g.W; return { ...q, cells: oc, s: { cell: best, xy: [g.left + (c + 0.5) * g.rx, g.top - (r + 0.5) * g.ry], moved: 0, opening: true } }; }
        return { ...q, s: snap(g, S.acc, S.fw(q.c), R) };
      });
      const outlets = sn.map((q) => (q.cells ? q.cells : q.s ? q.s.cell : -1));
      const ws = watersheds(g, S.acc, outlets), K = pts.length;
      S.labels = ws.labels;
      const stats = labelStats(S, ws.labels, K);
      // full mode: each point also gets everything upstream of it (all units whose chain of parents reaches it)
      const members = Array.from({ length: K + 1 }, (_, k) => new Set([k]));
      if (mode === 'full') for (let k = 1; k <= K; k++) { let p = ws.parent[k - 1], guard = 0; while (p && guard++ < K) { members[p].add(k); p = ws.parent[p - 1]; } }
      const feats = [];
      const polysSep = mode === 'full' ? null : polygonize(g, ws.labels, (L) => L);
      for (let k = 1; k <= K; k++) {
        const q = sn[k - 1]; if (!q.s) { feats.push(null); continue; }
        let mp = polysSep ? polysSep.get(k) : polygonize(g, ws.labels, (L) => (members[k].has(L) ? 1 : 0)).get(1);
        if (!mp || !mp.length) { feats.push(null); continue; }
        mp = mp.map((poly) => poly.map((ring) => ring.map((c) => S.inv(c))));
        let cells = 0, area = 0, fl = 0, ft = 0; for (const m of members[k]) { const s = stats[m]; cells += s.cells; area += s.area; fl += s.flat; ft += s.filled; }
        const props = { ...pickName(q.p, k), unit: k, area_km2: +(area / 1e6).toFixed(4), up_km2: +((q.cells ? outflow(q.cells) : S.acc.area[q.s.cell]) / 1e6).toFixed(4), snap_m: q.s.opening ? 0 : +(q.s.moved * cellM).toFixed(1), outlet: q.s.opening ? 'sluice opening' : 'snapped point',
          flat_pct: +(100 * fl / area).toFixed(1), filled_pct: +(100 * ft / area).toFixed(1), drains_to: ws.parent[k - 1] ? pickName(sn[ws.parent[k - 1] - 1].p, ws.parent[k - 1]).name : '' };
        feats.push({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: mp } });
      }
      const snapped = sn.map((q, k) => (q.s ? { type: 'Feature', properties: { ...pickName(q.p, k + 1), snap_m: +(q.s.moved * cellM).toFixed(1) }, geometry: { type: 'Point', coordinates: S.inv(q.s.xy) } } : null)).filter(Boolean);
      const fc = { type: 'FeatureCollection', features: feats.filter(Boolean) };
      fc.features.forEach((f) => { f.properties.area_km2 = +(featureArea(f) / 1e6).toFixed(4); });
      post(id, { result: { catchments: fc, snapped: { type: 'FeatureCollection', features: snapped }, missed: sn.filter((q) => !q.s).length } });
    } else if (cmd === 'export') {
      if (!S) throw new Error('Run the flow preparation first.');
      const g = S.g, w = e.data.what;
      let buf;
      if (w === 'dir') buf = writeTiff(S.dir, g, { nodata: 0 });
      else if (w === 'acc') { const a = new Float32Array(S.acc.cells.length); for (let i = 0; i < a.length; i++) a[i] = g.z[i] === g.z[i] ? S.acc.cells[i] : -1; buf = writeTiff(a, g, { nodata: -1 }); }
      else if (w === 'acckm2') { const a = new Float32Array(S.acc.area.length); for (let i = 0; i < a.length; i++) a[i] = g.z[i] === g.z[i] ? S.acc.area[i] / 1e6 : -1; buf = writeTiff(a, g, { nodata: -1 }); }
      else if (w === 'filled') { const a = Float32Array.from(S.filled, (v) => (v === v ? v : -9999)); buf = writeTiff(a, g, { nodata: -9999 }); }
      else if (w === 'dem') { const a = Float32Array.from(g.z, (v) => (v === v ? v : -9999)); buf = writeTiff(a, g, { nodata: -9999 }); }
      else if (w === 'labels') { if (!S.labels) throw new Error('Delineate first.'); buf = writeTiff(S.labels, g, { nodata: 0 }); }
      post(id, { result: buf }, [buf]);
    }
  } catch (err) { post(id, { error: err.message || String(err) }); }
};

function buildStreams(thresholdKm2) {
  const g = S.g, net = streams(g, S.dir, S.acc, thresholdKm2 * 1e6);
  const fc = { type: 'FeatureCollection', features: net.lines.map((l) => ({ type: 'Feature', properties: { order: l.order, up_km2: +(l.areaM2 / 1e6).toFixed(3) }, geometry: { type: 'LineString', coordinates: l.coords.map((c) => S.inv(c)) } })) };
  return fc;
}
/** Total flow leaving a group of cells (e.g. a sluice opening): accumulation of members whose downstream cell is outside the group. */
function outflow(cells) { const set = new Set(cells); let a = 0; for (const c of cells) if (!set.has(S.acc.ds[c])) a += S.acc.area[c]; return a; }
function cellSizeMetres(g) { const a = cellArea(g, Math.floor(g.H / 2)); return Math.sqrt(a); }
function pickName(p, k) {
  const key = Object.keys(p || {}).find((x) => /^(name|sluice|regulator|id|code|label)/i.test(x));
  return { name: key ? String(p[key]) : `Point ${k}` };
}
void utmFor;
