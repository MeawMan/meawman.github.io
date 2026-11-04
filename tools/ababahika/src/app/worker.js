// worker.js - raster work off the main thread.
// {id, file, features, mode, opts, crsDefs} -> zonal statistics; {id, cmd:'slopeRaster', file, opts} -> GeoTIFF bytes;
// {id, cmd:'overlay', features, layer, field} -> class areas per catchment from a polygon class layer (land cover, soil).
import { openRaster } from '../engine/raster.js';
import { zonal, overlayAreas } from '../engine/zonal.js';
import { intersect, featureCollection } from '@turf/turf';
import { slopeRaster } from '../engine/slope.js';
import { ensureCrs, loadExtra } from '../engine/crs.js';

const jobs = new Map();
self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  if (cmd === 'cancel') { const c = jobs.get(id); if (c) c.abort(); return; }
  const ctl = new AbortController(); jobs.set(id, ctl);
  let last = 0;
  const progress = (f) => { const t = Date.now(); if (t - last > 120 || f === 1) { last = t; self.postMessage({ id, progress: f }); } };
  try {
    const { file, features, mode, opts = {}, crsDefs } = e.data;
    loadExtra(crsDefs);
    if (cmd === 'overlay') {
      // one catchment at a time, yielding in between so that Cancel gets through
      const out = [], inter = (a, b) => intersect(featureCollection([a, b]));
      for (let i = 0; i < features.length; i++) {
        if (ctl.signal.aborted) throw new Error('Cancelled');
        const [r] = overlayAreas([features[i]], e.data.layer, e.data.field, inter); r.index = i; out.push(r);
        progress((i + 1) / features.length);
        await new Promise((res) => setTimeout(res, 0));
      }
      self.postMessage({ id, result: out });
      return;
    }
    const raster = await openRaster(file, file.name);
    if (opts.crsOverride) { raster.meta.crs = opts.crsOverride; }
    if (raster.meta.crs) await ensureCrs(raster.meta.crs);
    if (cmd === 'slopeRaster') {
      const buf = await slopeRaster(raster, { ...opts, onProgress: progress });
      self.postMessage({ id, result: buf }, [buf]);
      return;
    }
    const res = await zonal(raster, features, mode, { ...opts, signal: ctl.signal, onProgress: progress });
    self.postMessage({ id, result: res, meta: raster.meta });
  } catch (err) { self.postMessage({ id, error: err.message || String(err) }); }
  finally { jobs.delete(id); }
};
