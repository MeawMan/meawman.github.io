// zonal.js - zonal statistics of rasters over polygons, streamed in row blocks.
//
// Cell selection: a cell belongs to a polygon when its centre is inside (even-odd rule over all rings, so holes
// are excluded) - the same rule as GDAL rasterize / rasterio / rasterstats (all_touched = false) and ArcGIS
// Zonal Statistics. Areas use the true cell area: |rx * ry| for projected rasters, the exact ellipsoidal area of
// each row's cells for geographic (lon/lat) rasters.
//
// Slope: Horn (1981) 3x3 finite difference, as ArcGIS Slope and gdaldem slope. Cell spacing in metres; for
// geographic rasters the spacing is computed per row from the WGS 84 radii of curvature. NoData neighbours take
// the centre value (ArcGIS rule); raster edges replicate the edge row/column.

import { transformer, cellAreaGeo, metresPerDegree, ringAreaPlanar, ringAreaGeo, isGeographic, utmFor } from './crs.js';
import { bboxToWindow } from './raster.js';
import proj4 from 'proj4';

// ---------- polygons ----------
/** GeoJSON features (lon/lat) -> polygons in the raster CRS: {id, props, rings:[Float64Array x,y,...], bbox}. */
export function preparePolygons(features, toCrs, fromCrs = 'EPSG:4326') {
  const f = transformer(fromCrs, toCrs);
  return features.map((ft, i) => {
    const g = ft.geometry; if (!g) return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const rings = []; const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polys) for (const ring of p) {
      const a = new Float64Array(ring.length * 2);
      ring.forEach((c, k) => { const [x, y] = f([c[0], c[1]]); a[2 * k] = x; a[2 * k + 1] = y; bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); });
      rings.push(a);
    }
    return rings.length ? { index: i, props: ft.properties || {}, rings, bbox: bb } : null;
  });
}

/** Area of a GeoJSON (lon/lat) polygon feature in m²: geodesic on WGS 84 (via a local equal-area projection). */
export function featureArea(ft) {
  const g = ft.geometry; if (!g) return NaN;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let lon = 0, lat = 0, k = 0; for (const p of polys) for (const c of p[0]) { lon += c[0]; lat += c[1]; k++; }
  const laea = `+proj=laea +lat_0=${lat / k} +lon_0=${lon / k} +x_0=0 +y_0=0 +ellps=WGS84 +towgs84=0,0,0 +units=m +no_defs`; // proj4js needs x_0/y_0 spelled out
  const fw = proj4('EPSG:4326', laea).forward;
  let a = 0;
  for (const p of polys) p.forEach((ring, j) => { const ar = ringAreaPlanar(ring.map((c) => fw([c[0], c[1]]))); a += j ? -ar : ar; });
  return a;
}

/**
 * Column ranges [c0, c1] (inclusive) filled on raster row r - GDAL's scanline rule (gdalrasterize.cpp
 * GDALdllImageFilledPolygon) in pixel coordinates: an edge crosses the row centre y+0.5 when
 * min(y1,y2) <= yc < max(y1,y2); a span [xa, xb) fills columns floor(xa+0.5) .. floor(xb+0.5)-1.
 */
function rowSpans(poly, r, m) {
  const yc = r + 0.5, xs = [];
  for (const ring of poly.rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = (ring[2 * j] - m.left) / m.rx, y1 = (m.top - ring[2 * j + 1]) / m.ry;
      const x2 = (ring[2 * i] - m.left) / m.rx, y2 = (m.top - ring[2 * i + 1]) / m.ry;
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      if (yc >= lo && yc < hi) xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1));
    }
  }
  if (xs.length < 2) return [];
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const c0 = Math.floor(xs[k] + 0.5), c1 = Math.floor(xs[k + 1] + 0.5) - 1;
    if (c1 >= c0) out.push(c0, c1);
  }
  return out;
}

// ---------- accumulators ----------
export const DEFAULT_SLOPE_BREAKS = [0, 2, 5, 10, 15, 30, 90];
const HBINS = 9001; // 0.01 degree bins for the slope median/percentiles

function newSlopeAcc(nb) {
  return { n: 0, area: 0, sum: 0, sum2: 0, wsum: 0, min: Infinity, max: -Infinity, pctSum: 0, hist: new Float64Array(HBINS), cls: new Float64Array(nb),
    zSum: 0, zMin: Infinity, zMax: -Infinity, nodataArea: 0 };
}
function newCatAcc() { return { cls: new Map(), area: 0, nodataArea: 0, n: 0 }; }
function newContAcc() { return { n: 0, area: 0, sum: 0, sum2: 0, wsum: 0, min: Infinity, max: -Infinity, nodataArea: 0 }; }

const histQuantile = (h, n, p) => { if (!n) return NaN; const target = p * (n - 1); let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c > target) return i * 0.01; } return (h.length - 1) * 0.01; };

// ---------- the streamed pass ----------
/**
 * Run zonal statistics.
 *  raster   : handle from openRaster
 *  features : GeoJSON features in lon/lat (fromCrs) - reprojected to the raster CRS here
 *  mode     : 'slope' | 'categorical' | 'continuous'
 *  opts     : { breaks, zFactor, unit:'deg'|'pct', onProgress(fraction), signal }
 * Returns one result per feature.
 */
export async function zonal(raster, features, mode, opts = {}) {
  const m = raster.meta;
  if (!m.crs) throw new Error(`${m.name} has no recognised coordinate system`);
  const geo = isGeographic(m.crs), nd = m.nodata, isND = (v) => v === nd || Number.isNaN(v) || (nd != null && Math.abs(v - nd) < 1e-6 * Math.max(1, Math.abs(nd)));
  const polys = preparePolygons(features, m.crs, opts.fromCrs || 'EPSG:4326');
  const breaks = opts.breaks || DEFAULT_SLOPE_BREAKS, zf = opts.zFactor || 1;
  const acc = polys.map(() => (mode === 'slope' ? newSlopeAcc(breaks.length - 1) : mode === 'categorical' ? newCatAcc() : newContAcc()));
  const live = polys.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (!live.length) return [];
  // union window of all polygons
  const ub = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of live) { const b = polys[i].bbox; ub[0] = Math.min(ub[0], b[0]); ub[1] = Math.min(ub[1], b[1]); ub[2] = Math.max(ub[2], b[2]); ub[3] = Math.max(ub[3], b[3]); }
  const [X0, Y0, X1, Y1] = bboxToWindow(m, ub, 1);
  const res = polys.map((p) => (p ? { outside: !(p.bbox[2] > m.left && p.bbox[0] < m.right && p.bbox[3] > m.bottom && p.bbox[1] < m.top) } : null));
  if (X1 <= X0 || Y1 <= Y0) return finish();
  const wid = X1 - X0;
  const th = m.tiled ? m.tileH : 1, block = Math.max(th, Math.floor(Math.max(16, Math.min(2048, 16e6 / Math.max(1, wid))) / th) * th); // ~16 M cells, whole tile rows
  const cellAreaRow = (r) => (geo ? cellAreaGeo(m.top - r * m.ry, m.top - (r + 1) * m.ry, m.rx) : m.rx * m.ry);
  const halo = mode === 'slope' ? 1 : 0;

  for (let y = Y0; y < Y1; y += block) {
    if (opts.signal && opts.signal.aborted) throw new Error('Cancelled');
    const yEnd = Math.min(Y1, y + block);
    const win = await raster.read(X0 - halo, y - halo, X1 + halo, yEnd + halo);
    const d = win.data, ww = win.w, wx0 = win.x0, wy0 = win.y0;
    const at = (r, c) => { // value at absolute row/col, edge-replicated
      const rr = Math.min(Math.max(r, wy0), wy0 + win.h - 1) - wy0, cc = Math.min(Math.max(c, wx0), wx0 + ww - 1) - wx0;
      return d[rr * ww + cc];
    };
    const cand = live.filter((i) => { const b = polys[i].bbox; return b[1] <= m.top - y * m.ry && b[3] >= m.top - yEnd * m.ry; });
    for (let r = y; r < yEnd; r++) {
      const yc = m.top - (r + 0.5) * m.ry, ca = cellAreaRow(r);
      let dx = m.rx, dy = m.ry;
      if (geo) { const mp = metresPerDegree(yc); dx = mp.dx * m.rx; dy = mp.dy * m.ry; }
      for (const i of cand) {
        const p = polys[i]; if (p.bbox[1] > yc || p.bbox[3] < yc) continue;
        const sp = rowSpans(p, r, m), a = acc[i];
        for (let k = 0; k < sp.length; k += 2) {
          const c0 = Math.max(sp[k], X0), c1 = Math.min(sp[k + 1], X1 - 1);
          for (let c = c0; c <= c1; c++) {
            const v = at(r, c);
            if (isND(v)) { a.nodataArea += ca; continue; }
            if (mode === 'categorical') {
              a.cls.set(v, (a.cls.get(v) || 0) + ca); a.area += ca; a.n++;
            } else if (mode === 'continuous') {
              a.n++; a.area += ca; a.sum += v; a.sum2 += v * v; a.wsum += v * ca; if (v < a.min) a.min = v; if (v > a.max) a.max = v;
            } else {
              const g = (rr, cc) => { const u = at(rr, cc); return isND(u) ? v : u; };
              const z1 = g(r - 1, c - 1), z2 = g(r - 1, c), z3 = g(r - 1, c + 1), z4 = g(r, c - 1), z6 = g(r, c + 1), z7 = g(r + 1, c - 1), z8 = g(r + 1, c), z9 = g(r + 1, c + 1);
              const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * dx) * zf;
              const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * dy) * zf;
              const tn = Math.sqrt(dzdx * dzdx + dzdy * dzdy), s = Math.atan(tn) * 180 / Math.PI;
              a.n++; a.area += ca; a.sum += s; a.sum2 += s * s; a.wsum += s * ca; a.pctSum += tn * 100;
              if (s < a.min) a.min = s; if (s > a.max) a.max = s;
              a.hist[Math.min(HBINS - 1, Math.floor(s * 100))]++;
              let b = breaks.length - 2; for (let q = 0; q < breaks.length - 1; q++) if (s < breaks[q + 1]) { b = q; break; }
              a.cls[b] += ca;
              a.zSum += v; if (v < a.zMin) a.zMin = v; if (v > a.zMax) a.zMax = v;
            }
          }
        }
      }
    }
    if (opts.onProgress) opts.onProgress((yEnd - Y0) / (Y1 - Y0));
  }
  return finish();

  function finish() {
    return polys.map((p, i) => {
      if (!p) return { index: i, empty: true };
      const a = acc[i], base = { index: i, props: p.props, polygonArea: featureArea(features[i]), cells: a.n, validArea: a.area, nodataArea: a.nodataArea, outside: res[i] && res[i].outside };
      base.coverage = base.polygonArea > 0 ? a.area / base.polygonArea : NaN;
      if (mode === 'categorical') {
        const classes = [...a.cls].sort((x, y) => x[0] - y[0]).map(([value, area]) => ({ value, area, pct: a.area ? 100 * area / a.area : NaN }));
        return { ...base, classes };
      }
      if (!a.n) return { ...base, mean: NaN };
      const mean = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sum2 / a.n - mean * mean));
      if (mode === 'continuous') return { ...base, mean, areaMean: a.wsum / a.area, sd, min: a.min, max: a.max };
      const classes = breaks.slice(0, -1).map((b0, q) => ({ from: b0, to: breaks[q + 1], area: a.cls[q], pct: 100 * a.cls[q] / a.area }));
      const zMean = a.zSum / a.n;
      return {
        ...base, mean, areaMean: a.wsum / a.area, sd, min: a.min, max: a.max, meanPct: a.pctSum / a.n,
        median: histQuantile(a.hist, a.n, 0.5), p10: histQuantile(a.hist, a.n, 0.1), p90: histQuantile(a.hist, a.n, 0.9), classes,
        elevMean: zMean, elevMin: a.zMin, elevMax: a.zMax, relief: a.zMax - a.zMin, hypsometric: a.zMax > a.zMin ? (zMean - a.zMin) / (a.zMax - a.zMin) : NaN,
      };
    });
  }
}

/**
 * Polygon-on-polygon overlay areas (e.g. a soil map over catchments): area of each attribute value inside each zone.
 * Both layers are GeoJSON in lon/lat; areas are computed in the UTM zone of each zone's centroid (or opts.crs).
 * intersect: a function(polyA, polyB) -> GeoJSON geometry|null (turf.intersect), passed in to keep this module light.
 */
export function overlayAreas(zones, layer, field, intersect, opts = {}) {
  // Class polygons are split into their parts, each with its own box; a part that reaches a catchment's box is first cut
  // to that box (Sutherland–Hodgman, linear time) so the exact intersection only sees the vertices near the catchment.
  // Same result, far faster for detailed land-cover maps (hundreds of thousands of vertices).
  const parts = [];
  for (const f of layer) {
    const g = f && f.geometry; if (!g) continue;
    const key = f.properties ? String(f.properties[field]) : '';
    for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) parts.push({ key, rings, box: bboxOf({ coordinates: rings }) });
  }
  return zones.map((z, i) => {
    let lon = 0, lat = 0, k = 0;
    const g = z.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const c of p[0]) { lon += c[0]; lat += c[1]; k++; }
    const crs = opts.crs || utmFor(lon / k, lat / k), fw = proj4('EPSG:4326', crs).forward;
    // areas are geodesic on the WGS 84 ellipsoid (as for raster cells), or planar in opts.crs when one is given
    const area = (geom) => {
      const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      let a = 0; for (const p of ps) p.forEach((ring, j) => { const ar = opts.crs ? ringAreaPlanar(ring.map((c) => fw([c[0], c[1]]))) : ringAreaGeo(ring); a += j ? -ar : ar; }); return a;
    };
    const zb = bboxOf(z), out = new Map(); let total = 0;
    const pad = Math.max(zb[2] - zb[0], zb[3] - zb[1]) * 1e-3, cb = [zb[0] - pad, zb[1] - pad, zb[2] + pad, zb[3] + pad];
    // the parts near this catchment, cut to its box and gathered per class: one exact intersection per class
    const near = new Map();
    for (const pt of parts) {
      if (!overlaps(zb, pt.box)) continue;
      const inside = pt.box[0] >= cb[0] && pt.box[1] >= cb[1] && pt.box[2] <= cb[2] && pt.box[3] <= cb[3];
      let rings = pt.rings;
      if (!inside) {
        const outer = clipRing(pt.rings[0], cb); if (outer.length < 4) continue; // nothing of this part is in the box
        rings = [outer, ...pt.rings.slice(1).map((r) => clipRing(r, cb)).filter((r) => r.length >= 4)];
      }
      if (!near.has(pt.key)) near.set(pt.key, []);
      near.get(pt.key).push(rings);
    }
    for (const [key, polys] of near) {
      const x = intersect(z, { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }); if (!x) continue;
      const a = area(x.geometry || x); if (!(a > 0)) continue;
      out.set(key, (out.get(key) || 0) + a); total += a;
    }
    const zoneArea = area(g);
    return { index: i, type: 'overlay', props: z.props || z.properties, polygonArea: zoneArea, validArea: total, coverage: zoneArea ? total / zoneArea : NaN, crs: opts.crs || 'geodesic (WGS 84)',
      classes: [...out].sort((a, b) => b[1] - a[1]).map(([value, a]) => ({ value, area: a, pct: total ? 100 * a / total : NaN })) };
  });
}
/** Cut a closed ring to a box (Sutherland–Hodgman). Returns a closed ring, or [] when nothing is left. */
function clipRing(ring, b) {
  let pts = ring;
  const edges = [[(c) => c[0] >= b[0], (p, q) => [b[0], p[1] + (q[1] - p[1]) * (b[0] - p[0]) / (q[0] - p[0])]],
    [(c) => c[0] <= b[2], (p, q) => [b[2], p[1] + (q[1] - p[1]) * (b[2] - p[0]) / (q[0] - p[0])]],
    [(c) => c[1] >= b[1], (p, q) => [p[0] + (q[0] - p[0]) * (b[1] - p[1]) / (q[1] - p[1]), b[1]]],
    [(c) => c[1] <= b[3], (p, q) => [p[0] + (q[0] - p[0]) * (b[3] - p[1]) / (q[1] - p[1]), b[3]]]];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out = []; let prev = pts[pts.length - 1], pin = inside(prev);
    for (const cur of pts) {
      const cin = inside(cur);
      if (cin) { if (!pin) out.push(cut(prev, cur)); out.push(cur); } else if (pin) out.push(cut(prev, cur));
      prev = cur; pin = cin;
    }
    pts = out;
  }
  if (pts.length < 3) return [];
  const f = pts[0], l = pts[pts.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) pts.push([f[0], f[1]]);
  return pts;
}
export function bboxOf(f) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  walk((f.geometry || f).coordinates); return b;
}
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export { ringAreaGeo };
