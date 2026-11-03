// io.js - reading user files into layers (vectors as GeoJSON in lon/lat, rasters as streamed GeoTIFF handles).
import shp from 'shpjs';
import proj4 from 'proj4';
import { openRaster } from '../engine/raster.js';
import { ensureCrs, registerWkt, isKnown } from '../engine/crs.js';
import { gdalToGeoJSON, gdalToGeoTiff } from './gp.js';

const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const base = (n) => n.replace(/\.[^.]+$/, '');

/** Group a FileList into load jobs: shapefile part sets, single files. */
export function groupFiles(files) {
  const jobs = [], shpParts = new Map();
  for (const f of files) {
    const e = ext(f.name);
    if (['shp', 'dbf', 'prj', 'cpg', 'shx', 'sbn', 'sbx', 'xml'].includes(e)) {
      const k = base(f.name).replace(/\.shp$/i, '').toLowerCase();
      if (!shpParts.has(k)) shpParts.set(k, { name: base(f.name).replace(/\.shp$/i, ''), parts: {} });
      shpParts.get(k).parts[e] = f;
    } else jobs.push({ kind: 'file', file: f });
  }
  for (const s of shpParts.values()) if (s.parts.shp) jobs.push({ kind: 'shp', ...s });
  return jobs;
}

/** Load one job. Returns an array of layer specs: {type:'vector', name, fc, srcCrs} or {type:'raster', name, raster, file}. */
export async function loadJob(job, onStatus = () => {}) {
  if (job.kind === 'shp') {
    const p = job.parts;
    const prj = p.prj ? await p.prj.text() : null;
    const fc = await shp({ shp: await p.shp.arrayBuffer(), dbf: p.dbf ? await p.dbf.arrayBuffer() : undefined, prj: prj || undefined, cpg: p.cpg ? await p.cpg.text() : undefined });
    checkLonLat(fc, job.name);
    return [{ type: 'vector', name: job.name, fc: tidy(fc), srcCrs: prj ? registerWkt(prj) : null, warn: prj ? null : 'No .prj file: coordinates assumed to be longitude/latitude (WGS 84).' }];
  }
  const f = job.file, e = ext(f.name);
  if (e === 'zip') {
    const buf = await f.arrayBuffer();
    let out = await shp(buf);
    out = Array.isArray(out) ? out : [out];
    out.forEach((fc) => checkLonLat(fc, f.name));
    return out.map((fc) => ({ type: 'vector', name: fc.fileName ? fc.fileName.split('/').pop() : base(f.name), fc: tidy(fc) }));
  }
  if (e === 'geojson' || e === 'json') {
    const fc = JSON.parse(await f.text());
    const name = (fc.crs && fc.crs.properties && fc.crs.properties.name) || '';
    const m = /EPSG::?(\d+)/.exec(name);
    let srcCrs = 'EPSG:4326';
    if (m && m[1] !== '4326' && m[1] !== '84') { srcCrs = await ensureCrs(`EPSG:${m[1]}`); reprojectFC(fc, srcCrs, 'EPSG:4326'); }
    return [{ type: 'vector', name: base(f.name), fc: tidy(fc.type === 'Feature' ? { type: 'FeatureCollection', features: [fc] } : fc), srcCrs }];
  }
  if (e === 'tif' || e === 'tiff' || e === 'gtiff') {
    const raster = await openRaster(f, base(f.name));
    if (raster.meta.crs && !isKnown(raster.meta.crs)) { onStatus(`Looking up ${raster.meta.crs}…`); await ensureCrs(raster.meta.crs); }
    return [{ type: 'raster', name: base(f.name), raster, file: f }];
  }
  if (['kml', 'kmz', 'gpkg', 'gml', 'gpx', 'csv', 'tab', 'mif'].includes(e)) {
    onStatus('Loading GDAL (first time only, ~40 MB)…');
    const layers = await gdalToGeoJSON(f);
    return layers.map((l) => ({ type: 'vector', name: l.name, fc: tidy(l.fc), srcCrs: l.srcCrs }));
  }
  if (['img', 'asc', 'bil', 'dem', 'nc', 'hdf', 'jp2', 'vrt', 'sdat', 'rst', 'flt', 'hgt'].includes(e)) {
    onStatus('Loading GDAL (first time only, ~40 MB)…');
    const blob = await gdalToGeoTiff(f);
    const file = new File([blob], base(f.name) + '.tif', { type: 'image/tiff' });
    const raster = await openRaster(file, base(f.name));
    if (raster.meta.crs && !isKnown(raster.meta.crs)) await ensureCrs(raster.meta.crs);
    return [{ type: 'raster', name: base(f.name), raster, file, converted: true }];
  }
  throw new Error(`${f.name}: unsupported file type`);
}

/** shpjs silently keeps projected coordinates when it cannot read a .prj: refuse rather than misplace the layer. */
function checkLonLat(fc, name) {
  for (const ft of (fc.features || []).slice(0, 50)) {
    if (!ft.geometry) continue;
    let c = ft.geometry.coordinates; while (Array.isArray(c[0])) c = c[0];
    if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw new Error(`${name}: its .prj could not be read, so the coordinates cannot be placed. Re-save the layer with a standard .prj (e.g. Project tool in ArcGIS to WGS 84 or UTM) or load it as GeoPackage.`);
    return;
  }
}

/** Drop features without geometry, give every feature an id. */
function tidy(fc) {
  fc.features = (fc.features || []).filter((f) => f && f.geometry);
  fc.features.forEach((f, i) => { f.properties = f.properties || {}; f.id = i; });
  return fc;
}

export function reprojectFC(fc, from, to) {
  const fw = proj4(from, to).forward;
  const walk = (c) => (typeof c[0] === 'number' ? fw([c[0], c[1]]) : c.map(walk));
  for (const f of fc.features || []) if (f.geometry) {
    if (f.geometry.type === 'GeometryCollection') f.geometry.geometries.forEach((g) => { g.coordinates = walk(g.coordinates); });
    else f.geometry.coordinates = walk(f.geometry.coordinates);
  }
  return fc;
}

/** Field names and types of a FeatureCollection. */
export function fieldsOf(fc) {
  const m = new Map();
  for (const f of fc.features.slice(0, 500)) for (const [k, v] of Object.entries(f.properties || {})) {
    if (v == null || v === '') continue;
    const t = typeof v === 'number' ? 'number' : 'text';
    if (!m.has(k)) m.set(k, t); else if (m.get(k) !== t) m.set(k, 'text');
  }
  return [...m].map(([name, type]) => ({ name, type }));
}
export function geomKind(fc) {
  const t = fc.features[0] && fc.features[0].geometry.type;
  return /Polygon/.test(t) ? 'polygon' : /Line/.test(t) ? 'line' : /Point/.test(t) ? 'point' : 'mixed';
}
