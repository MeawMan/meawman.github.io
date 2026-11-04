// hydro.js - D8 hydrology on a DEM held in memory: resampling, conditioning (stream burning, embankment walls,
// sluice openings), depression filling, flow direction, flow accumulation, stream network with Strahler order,
// pour-point snapping, watersheds and raster-to-polygon conversion.
//
// Methods
//  - Resampling to a coarser cell: mean of the valid source cells whose centres fall in each output cell.
//  - Burning: lines rasterised as 4-connected (supercover) cell chains, so D8 cannot slip diagonally through a wall.
//    Streams are lowered by a depth, walls raised by a height; openings restore the lowest neighbouring ground.
//  - Filling: Priority-Flood (Barnes, Lehman & Mulla 2014). Exact fill for reporting; Priority-Flood+epsilon for
//    routing, which gives every filled or flat cell a minimal gradient toward its spill point, so D8 is defined
//    everywhere and flow leaves flats toward the outlet. Edges and NoData borders are outlets.
//  - D8 (O'Callaghan & Mark 1984): steepest drop / distance; distances in metres (per row for geographic DEMs).
//    ESRI encoding: E 1, SE 2, S 4, SW 8, W 16, NW 32, N 64, NE 128 (same as ArcGIS Flow Direction, pysheds default).
//  - Accumulation in topological order (cells and area); Strahler order on the cell graph.
//  - Watersheds: each cell takes the label of the first pour point reached downstream ("separate" = ArcGIS Watershed);
//    "full" gives each point its whole upstream area.
import { metresPerDegree, cellAreaGeo, isGeographic } from './crs.js';

export const MAX_CELLS = 40e6; // ~1.1 GB peak in the worker
// neighbour order = ESRI code order
const CODES = [1, 2, 4, 8, 16, 32, 64, 128];
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const CODE_INDEX = new Int8Array(256).fill(-1); CODES.forEach((c, i) => { CODE_INDEX[c] = i; });

// ---------------- loading / resampling ----------------
/**
 * Read a raster into a grid. cellSize (metres, optional) coarsens the grid by averaging.
 * Returns {W,H,left,top,rx,ry,crs,geographic,z:Float32Array (NaN = NoData)}.
 */
export async function loadGrid(raster, { cellSize = null, onProgress } = {}) {
  const m = raster.meta, geo = isGeographic(m.crs);
  let rx = m.rx, ry = m.ry;
  if (cellSize) {
    const mid = (m.top + m.bottom) / 2;
    const tx = geo ? cellSize / metresPerDegree(mid).dx : cellSize, ty = geo ? cellSize / metresPerDegree(mid).dy : cellSize;
    if (tx < m.rx * 0.999 || ty < m.ry * 0.999) throw new Error('The cell size must be the DEM\'s own or coarser.');
    rx = tx; ry = ty;
  }
  const W = Math.max(1, Math.round((m.right - m.left) / rx)), H = Math.max(1, Math.round((m.top - m.bottom) / ry));
  if (W * H > MAX_CELLS) throw new Error(`${(W * H / 1e6).toFixed(0)} million cells is too many for flow routing in the browser (limit ${MAX_CELLS / 1e6} million). Choose a coarser cell size or clip the DEM to your area.`);
  rx = (m.right - m.left) / W; ry = (m.top - m.bottom) / H;
  const nd = m.nodata;
  const z = new Float32Array(W * H);
  const same = Math.abs(rx - m.rx) < 1e-9 * m.rx && Math.abs(ry - m.ry) < 1e-9 * m.ry && W === m.width && H === m.height;
  // read whole tile rows at a time so each compressed tile is decoded once
  const th = m.tiled ? m.tileH : 1, block = Math.max(th, Math.floor(8e6 / m.width / th) * th);
  const ndv = Number.isFinite(nd) ? nd : NaN;
  if (same) {
    for (let y = 0; y < H; y += block) {
      const win = await raster.read(0, y, W, Math.min(H, y + block)), d = win.data, o = y * W;
      for (let i = 0; i < d.length; i++) { const v = d[i]; z[o + i] = v === ndv || v !== v || v < -1e30 ? NaN : v; }
      if (onProgress) onProgress(Math.min(1, (y + block) / H));
    }
  } else {
    const sum = new Float64Array(W * H), cnt = new Uint32Array(W * H), colMap = new Int32Array(m.width);
    for (let c = 0; c < m.width; c++) colMap[c] = Math.min(W - 1, Math.floor((c + 0.5) * m.rx / rx));
    for (let y = 0; y < m.height; y += block) {
      const win = await raster.read(0, y, m.width, Math.min(m.height, y + block)), d = win.data;
      for (let r = 0; r < win.h; r++) {
        const R = Math.floor((y + r + 0.5) * m.ry / ry); if (R < 0 || R >= H) continue;
        const o = R * W, io = r * m.width;
        for (let c = 0; c < m.width; c++) {
          const v = d[io + c]; if (v === ndv || v !== v || v < -1e30) continue;
          const k = o + colMap[c]; sum[k] += v; cnt[k]++;
        }
      }
      if (onProgress) onProgress(Math.min(1, (y + block) / m.height));
    }
    for (let i = 0; i < z.length; i++) z[i] = cnt[i] ? sum[i] / cnt[i] : NaN;
  }
  return { W, H, left: m.left, top: m.top, rx, ry, crs: m.crs, geographic: geo, z };
}

const rowMetres = (g, r) => { if (!g.geographic) return { dx: g.rx, dy: g.ry }; const mp = metresPerDegree(g.top - (r + 0.5) * g.ry); return { dx: mp.dx * g.rx, dy: mp.dy * g.ry }; };
export const cellArea = (g, r) => (g.geographic ? cellAreaGeo(g.top - r * g.ry, g.top - (r + 1) * g.ry, g.rx) : g.rx * g.ry);

// ---------------- burning ----------------
/** Cells crossed by a polyline (grid CRS coords), 4-connected supercover (Amanatides & Woo 1987 traversal). */
export function lineCells(g, coords, out = new Set()) {
  for (let k = 0; k + 1 < coords.length; k++) {
    let x0 = (coords[k][0] - g.left) / g.rx, y0 = (g.top - coords[k][1]) / g.ry;
    const x1 = (coords[k + 1][0] - g.left) / g.rx, y1 = (g.top - coords[k + 1][1]) / g.ry;
    let cx = Math.floor(x0), cy = Math.floor(y0); const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0, sx = Math.sign(dx), sy = Math.sign(dy);
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
    let tmx = dx ? ((sx > 0 ? cx + 1 - x0 : x0 - cx) * tdx) : Infinity, tmy = dy ? ((sy > 0 ? cy + 1 - y0 : y0 - cy) * tdy) : Infinity;
    const put = () => { if (cx >= 0 && cy >= 0 && cx < g.W && cy < g.H) out.add(cy * g.W + cx); };
    put();
    let guard = 0;
    while ((cx !== ex || cy !== ey) && guard++ < 1e7) {
      if (tmx < tmy) { tmx += tdx; cx += sx; } else { tmy += tdy; cy += sy; }
      put();
    }
    void x0;
  }
  return out;
}

/**
 * Condition the DEM. lines are arrays of coordinate arrays in grid CRS.
 * opts: streams, streamDepth (m), walls, wallHeight (m), openings (points), openingRadius (cells)
 * Returns { zc: Float64Array conditioned elevations, wallCells, streamCells }.
 */
export function condition(g, { streams = [], streamDepth = 10, walls = [], wallHeight = 100, openings = [], openingRadius = 1 } = {}) {
  const zc = Float64Array.from(g.z);
  const sc = new Set(); for (const l of streams) lineCells(g, l, sc);
  for (const i of sc) if (!Number.isNaN(zc[i])) zc[i] -= streamDepth;
  const wc = new Set(); for (const l of walls) lineCells(g, l, wc);
  for (const i of wc) if (!Number.isNaN(zc[i]) && !sc.has(i)) zc[i] += wallHeight;
  let opened = 0; const openingCells = [];
  for (const p of openings) {
    const mine = []; openingCells.push(mine);
    const c = Math.floor((p[0] - g.left) / g.rx), r = Math.floor((g.top - p[1]) / g.ry);
    for (let y = r - openingRadius; y <= r + openingRadius; y++) for (let x = c - openingRadius; x <= c + openingRadius; x++) {
      if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
      const i = y * g.W + x; if (!wc.has(i)) continue;
      let low = Infinity;
      for (let k = 0; k < 8; k++) { const xx = x + DX[k], yy = y + DY[k]; if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H) continue; const j = yy * g.W + xx; if (!wc.has(j) && zc[j] < low) low = zc[j]; }
      if (Number.isFinite(low)) { zc[i] = low; opened++; mine.push(i); }
    }
  }
  return { zc, wallCells: wc.size, streamCells: sc.size, openedCells: opened, openingCells };
}

// ---------------- Priority-Flood ----------------
class Heap { // min-heap of cell indices keyed by z
  constructor(z, cap) { this.z = z; this.a = new Int32Array(Math.max(16, cap)); this.n = 0; }
  push(i) {
    if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, z = this.z; let k = this.n++; a[k] = i;
    while (k > 0) { const p = (k - 1) >> 1; if (z[a[p]] <= z[a[k]]) break; const t = a[p]; a[p] = a[k]; a[k] = t; k = p; }
  }
  pop() {
    const a = this.a, z = this.z, top = a[0], last = a[--this.n];
    if (this.n > 0) {
      a[0] = last; let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < this.n && z[a[l]] < z[a[m]]) m = l; if (r < this.n && z[a[r]] < z[a[m]]) m = r; if (m === k) break; const t = a[m]; a[m] = a[k]; a[k] = t; k = m; }
    }
    return top;
  }
}
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
/** Next float64 above v (for positive and negative finite v). */
function nextUp(v) { if (v === 0) return Number.MIN_VALUE; F64[0] = v; U64[0] += v > 0 ? 1n : -1n; return F64[0]; }

/**
 * Fill depressions in place on z (Float64Array, NaN = NoData). epsilon=true imposes a minimal gradient on filled/flat
 * areas (Priority-Flood+epsilon). Returns {seeds} count. Cells on the grid edge or next to NoData are outlets.
 */
export function fill(g, z, { epsilon = true, onProgress } = {}) {
  const { W, H } = g, n = W * H, closed = new Uint8Array(n), pit = [];
  const heap = new Heap(z, 2 * (W + H));
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c; if (Number.isNaN(z[i])) { closed[i] = 1; continue; }
    let edge = r === 0 || c === 0 || r === H - 1 || c === W - 1;
    if (!edge) for (let k = 0; k < 8; k++) if (Number.isNaN(z[(r + DY[k]) * W + c + DX[k]])) { edge = true; break; }
    if (edge) { closed[i] = 1; heap.push(i); }
  }
  let done = 0, pi = 0;
  while (heap.n > 0 || pi < pit.length) {
    let c;
    if (pi < pit.length) { c = pit[pi++]; if (pi > 65536 && pi === pit.length) { pit.length = 0; pi = 0; } } else c = heap.pop();
    const r = (c / W) | 0, x = c - r * W, zc = z[c];
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = r + DY[k]; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx; if (closed[j]) continue; closed[j] = 1;
      if (z[j] <= zc) { z[j] = epsilon ? nextUp(zc) : zc; pit.push(j); } else heap.push(j);
    }
    if (onProgress && (++done & 0xfffff) === 0) onProgress(done / n);
  }
}

// ---------------- D8 ----------------
/** D8 directions (ESRI codes) on z; cells with no downslope neighbour on the edge/NoData border point outward; else 0. */
export function d8(g, z) {
  const { W, H } = g, dir = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) {
    const { dx, dy } = rowMetres(g, r), dd = Math.hypot(dx, dy), dist = [dx, dd, dy, dd, dx, dd, dy, dd];
    for (let c = 0; c < W; c++) {
      const i = r * W + c, zi = z[i]; if (Number.isNaN(zi)) continue;
      let best = 0, bk = -1, out = -1;
      for (let k = 0; k < 8; k++) {
        const xx = c + DX[k], yy = r + DY[k];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { if (out < 0) out = k; continue; }
        const zj = z[yy * W + xx]; if (Number.isNaN(zj)) { if (out < 0) out = k; continue; }
        const s = (zi - zj) / dist[k]; if (s > best) { best = s; bk = k; }
      }
      dir[i] = bk >= 0 ? CODES[bk] : out >= 0 ? CODES[out] : 0;
    }
  }
  return dir;
}
const downstream = (g, dir, i) => { const k = CODE_INDEX[dir[i]]; if (k < 0) return -1; const r = (i / g.W) | 0, c = i - r * g.W, xx = c + DX[k], yy = r + DY[k]; return xx < 0 || yy < 0 || xx >= g.W || yy >= g.H ? -1 : yy * g.W + xx; };
export { downstream };

/** Flow accumulation: cells (including itself, as ArcGIS + 1) and upstream area (m²). Also returns topological order. */
export function accumulate(g, dir, valid) {
  const { W, H } = g, n = W * H, indeg = new Uint8Array(n), cells = new Uint32Array(n), order = new Int32Array(n);
  const ds = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (valid(i)) { const j = downstream(g, dir, i); if (j >= 0 && valid(j)) { ds[i] = j; indeg[j]++; } }
  const rowA = new Float64Array(H); for (let r = 0; r < H; r++) rowA[r] = cellArea(g, r);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (valid(i) && indeg[i] === 0) order[tail++] = i;
  const area = new Float64Array(n); // upstream area, m²
  for (let i = 0; i < n; i++) if (valid(i)) { cells[i] = 1; area[i] = rowA[(i / W) | 0]; }
  while (head < tail) {
    const i = order[head++], j = ds[i]; if (j < 0) continue;
    cells[j] += cells[i]; area[j] += area[i];
    if (--indeg[j] === 0) order[tail++] = j;
  }
  return { cells, area, order, nOrder: tail, ds };
}

// ---------------- streams ----------------
/** Stream polylines (grid CRS) for cells with upstream area >= thresholdM2, with Strahler order. */
export function streams(g, dir, acc, thresholdM2) {
  const { W } = g, { area, order, nOrder, ds } = acc, n = area.length;
  const isS = new Uint8Array(n); for (let i = 0; i < n; i++) if (area[i] >= thresholdM2) isS[i] = 1;
  const up = new Uint8Array(n), strah = new Uint8Array(n), maxIn = new Uint8Array(n), nMax = new Uint8Array(n);
  for (let t = 0; t < nOrder; t++) { const i = order[t]; if (!isS[i]) continue; const j = ds[i]; if (j >= 0 && isS[j]) up[j]++; }
  for (let t = 0; t < nOrder; t++) {
    const i = order[t]; if (!isS[i]) continue;
    strah[i] = up[i] === 0 ? 1 : (nMax[i] >= 2 ? maxIn[i] + 1 : maxIn[i]);
    const j = ds[i]; if (j >= 0 && isS[j]) { if (strah[i] > maxIn[j]) { maxIn[j] = strah[i]; nMax[j] = 1; } else if (strah[i] === maxIn[j]) nMax[j]++; }
  }
  const xy = (i) => { const r = (i / W) | 0, c = i - r * W; return [g.left + (c + 0.5) * g.rx, g.top - (r + 0.5) * g.ry]; };
  const lines = [];
  for (let t = 0; t < nOrder; t++) {
    const s = order[t]; if (!isS[s] || up[s] === 1) continue; // segment starts at a head or a junction
    const pts = [xy(s)]; let i = s, j = ds[i], last = s;
    while (j >= 0 && isS[j]) { pts.push(xy(j)); last = j; if (up[j] !== 1) break; i = j; j = ds[i]; }
    if (j < 0) { const k = CODE_INDEX[dir[i]]; if (k >= 0) { const [x, y] = xy(i); pts.push([x + DX[k] * g.rx * 0.5, y - DY[k] * g.ry * 0.5]); } }
    if (pts.length > 1) lines.push({ coords: pts, order: strah[s], areaM2: area[last] });
  }
  return { lines, isStream: isS };
}

// ---------------- pour points & watersheds ----------------
/** Snap a point (grid CRS) to the cell of largest upstream area within radius (cells). */
export function snap(g, acc, p, radius) {
  const c0 = Math.floor((p[0] - g.left) / g.rx), r0 = Math.floor((g.top - p[1]) / g.ry);
  let best = -1, ba = -1;
  for (let r = r0 - radius; r <= r0 + radius; r++) for (let c = c0 - radius; c <= c0 + radius; c++) {
    if (r < 0 || c < 0 || r >= g.H || c >= g.W || (r - r0) ** 2 + (c - c0) ** 2 > radius * radius) continue;
    const i = r * g.W + c; if (acc.area[i] > ba) { ba = acc.area[i]; best = i; }
  }
  if (best < 0) return null;
  const r = (best / g.W) | 0, c = best - r * g.W;
  return { cell: best, xy: [g.left + (c + 0.5) * g.rx, g.top - (r + 0.5) * g.ry], moved: Math.hypot(c - c0, r - r0) };
}

/**
 * Labels (1..K) of the area draining first to each outlet ("separate"); 0 elsewhere.
 * An outlet is a cell index or an array of cells (e.g. all the opened wall cells of one sluice).
 */
export function watersheds(g, acc, outlets) {
  const n = g.W * g.H, lab = new Int32Array(n), ds = acc.ds, { order, nOrder } = acc;
  const cellsOf = (o) => (Array.isArray(o) ? o : o != null && o >= 0 ? [o] : []);
  outlets.forEach((o, k) => cellsOf(o).forEach((c) => { lab[c] = k + 1; }));
  // reverse topological order: downstream cells resolved before their upstream cells
  for (let t = nOrder - 1; t >= 0; t--) { const i = order[t]; if (lab[i]) continue; const j = ds[i]; if (j >= 0 && lab[j]) lab[i] = lab[j]; }
  // nesting: the outlet each outlet drains into
  const parent = outlets.map((o, k) => {
    const cs = cellsOf(o); for (const c of cs) { let j = ds[c]; while (j >= 0 && lab[j] === k + 1) j = ds[j]; while (j >= 0 && !lab[j]) j = ds[j]; if (j >= 0 && lab[j] !== k + 1) return lab[j]; }
    return 0;
  });
  return { labels: lab, parent };
}

// ---------------- raster to polygons ----------------
/**
 * Polygons of cells whose label satisfies keep(label) -> id (non-zero id = polygon id). Edges follow cell borders;
 * diagonal-only contacts are separated (4-connected regions). Returns Map id -> GeoJSON coordinates (MultiPolygon) in grid CRS.
 */
export function polygonize(g, labels, idOf) {
  const { W, H } = g;
  const id = (r, c) => (r < 0 || c < 0 || r >= H || c >= W ? 0 : idOf(labels[r * W + c]));
  // directed edges keyed by start vertex (vertex index v = y*(W+1)+x), region on the right (y down)
  const edges = new Map(); // id -> Map(startVertex -> [endVertex,...])
  const add = (L, a, b) => { let m = edges.get(L); if (!m) edges.set(L, (m = new Map())); const l = m.get(a); if (l) l.push(b); else m.set(a, [b]); };
  const V = (x, y) => y * (W + 1) + x;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const L = id(r, c); if (!L) continue;
    if (id(r - 1, c) !== L) add(L, V(c, r), V(c + 1, r));
    if (id(r, c + 1) !== L) add(L, V(c + 1, r), V(c + 1, r + 1));
    if (id(r + 1, c) !== L) add(L, V(c + 1, r + 1), V(c, r + 1));
    if (id(r, c - 1) !== L) add(L, V(c, r + 1), V(c, r));
  }
  const out = new Map();
  const toXY = (v) => { const y = Math.floor(v / (W + 1)), x = v - y * (W + 1); return [g.left + x * g.rx, g.top - y * g.ry]; };
  for (const [L, m] of edges) {
    const rings = [];
    for (const [start] of m) {
      while (m.get(start) && m.get(start).length) {
        const ring = [start]; let prev = start, cur = m.get(start).pop(); if (!m.get(start).length) m.delete(start);
        let guard = 0;
        while (cur !== start && guard++ < 1e8) {
          ring.push(cur);
          const cand = m.get(cur);
          let nxt;
          if (cand.length === 1) nxt = cand.pop();
          else { // pinch vertex: turn right (keeps diagonal neighbours apart)
            const dIn = dirOf(prev, cur, W);
            let bi = 0, bs = 9; cand.forEach((v, q) => { const s = turnRank(dIn, dirOf(cur, v, W)); if (s < bs) { bs = s; bi = q; } });
            nxt = cand.splice(bi, 1)[0];
          }
          if (!cand.length) m.delete(cur);
          prev = cur; cur = nxt;
        }
        rings.push(simplifyRing(ring, W).map(toXY));
      }
    }
    // outer rings: counter-clockwise in map coordinates (positive area, RFC 7946); holes clockwise
    const outer = [], holes = [];
    // traced with the region on the screen-right, so in map coordinates outer rings come out clockwise: reverse all
    for (const r of rings) { r.push(r[0]); r.reverse(); (signedArea(r) > 0 ? outer : holes).push(r); }
    const polys = outer.map((r) => [r]);
    for (const hr of holes) {
      let best = -1, ba = Infinity;
      polys.forEach((p, q) => { const a = signedArea(p[0]); if (a < ba && pointInRing(hr[0], p[0])) { ba = a; best = q; } });
      if (best >= 0) polys[best].push(hr);
    }
    out.set(L, polys);
  }
  return out;
}
const DIRV = { '1,0': 0, '0,1': 1, '-1,0': 2, '0,-1': 3 }; // E, S, W, N in y-down grid
function dirOf(a, b, W) { const ay = Math.floor(a / (W + 1)), ax = a - ay * (W + 1), by = Math.floor(b / (W + 1)), bx = b - by * (W + 1); return DIRV[`${Math.sign(bx - ax)},${Math.sign(by - ay)}`]; }
function turnRank(din, dout) { const t = (dout - din + 4) % 4; return t === 1 ? 0 : t === 0 ? 1 : 2; } // right, straight, left
function simplifyRing(ring, W) {
  const n = ring.length, out = [];
  for (let k = 0; k < n; k++) { const a = ring[(k + n - 1) % n], b = ring[k], c = ring[(k + 1) % n]; if (dirOf(a, b, W) !== dirOf(b, c, W)) out.push(b); }
  return out.length >= 3 ? out : ring;
}
function signedArea(r) { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; }
function pointInRing(p, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins; } return ins; }

// ---------------- the whole preparation ----------------
/**
 * Full preparation from a loaded grid. Returns a state object kept by the worker for later delineations.
 */
export function prepare(g, cond = {}, onStep = () => {}) {
  onStep('Conditioning DEM');
  const c = condition(g, cond);
  let z = c.zc; c.zc = null;
  const z0 = Float32Array.from(z); // conditioned, unfilled (for the filled/flat flags)
  onStep('Filling depressions (Priority-Flood)');
  fill(g, z, { epsilon: true });
  onStep('Flow direction (D8)');
  const dir = d8(g, z);
  // flags: 1 = raised by filling, 2 = no lower neighbour on the conditioned surface (flat)
  const flag = new Uint8Array(g.W * g.H);
  for (let r = 0; r < g.H; r++) for (let x = 0; x < g.W; x++) {
    const i = r * g.W + x, v0 = z0[i]; if (v0 !== v0) continue;
    if (z[i] - v0 > 1e-3) { flag[i] = 1; continue; }
    let lower = false;
    for (let k = 0; k < 8; k++) { const xx = x + DX[k], yy = r + DY[k]; if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H) { lower = true; break; } const v = z0[yy * g.W + xx]; if (v !== v || v < v0 - 1e-6) { lower = true; break; } }
    if (!lower) flag[i] = 2;
  }
  const filled = Float32Array.from(z); z = null;
  onStep('Flow accumulation');
  const valid = (i) => g.z[i] === g.z[i];
  const acc = accumulate(g, dir, valid);
  return { g, dir, acc, flag, filled, cond: c };
}

/** Per-label statistics: cells, area, % filled, % flat (no downslope neighbour). */
export function labelStats(st, labels, K) {
  const { g, flag } = st, s = Array.from({ length: K + 1 }, () => ({ cells: 0, area: 0, filled: 0, flat: 0 }));
  for (let r = 0; r < g.H; r++) { const a = cellArea(g, r); for (let c = 0; c < g.W; c++) { const i = r * g.W + c, L = labels[i]; if (L <= 0 || L > K) continue; const q = s[L]; q.cells++; q.area += a; if (flag[i] === 1) q.filled += a; else if (flag[i] === 2) q.flat += a; } }
  return s;
}
