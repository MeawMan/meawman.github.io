// slope.js - slope raster (Horn 1981) written as a Float32 GeoTIFF. Same kernel and rules as zonal.js.
import { writeArrayBuffer } from 'geotiff';
import { metresPerDegree, isGeographic } from './crs.js';

export async function slopeRaster(raster, { unit = 'deg', zFactor = 1, onProgress } = {}) {
  const m = raster.meta, W = m.width, H = m.height;
  if (W * H > 250e6) throw new Error(`The slope raster would have ${(W * H / 1e6).toFixed(0)} million cells; clip the DEM first (limit 250 million).`);
  const code = /^EPSG:(\d+)$/.exec(m.crs || '');
  if (!code) throw new Error('Slope raster needs a DEM with an EPSG coordinate system. Project it first.');
  const geo = isGeographic(m.crs), nd = m.nodata, isND = (v) => v === nd || Number.isNaN(v);
  const out = new Float32Array(W * H), NO = -9999;
  const block = Math.max(16, Math.floor(8e6 / W));
  for (let y = 0; y < H; y += block) {
    const y1 = Math.min(H, y + block), win = await raster.read(0, y - 1, W, y1 + 1), d = win.data;
    const at = (r, c) => { const rr = Math.min(Math.max(r, win.y0), win.y0 + win.h - 1) - win.y0, cc = Math.min(Math.max(c, 0), W - 1); return d[rr * W + cc]; };
    for (let r = y; r < y1; r++) {
      let dx = m.rx, dy = m.ry;
      if (geo) { const mp = metresPerDegree(m.top - (r + 0.5) * m.ry); dx = mp.dx * m.rx; dy = mp.dy * m.ry; }
      for (let c = 0; c < W; c++) {
        const v = at(r, c); if (isND(v)) { out[r * W + c] = NO; continue; }
        const g = (rr, cc) => { const u = at(rr, cc); return isND(u) ? v : u; };
        const dzdx = ((g(r - 1, c + 1) + 2 * g(r, c + 1) + g(r + 1, c + 1)) - (g(r - 1, c - 1) + 2 * g(r, c - 1) + g(r + 1, c - 1))) / (8 * dx) * zFactor;
        const dzdy = ((g(r + 1, c - 1) + 2 * g(r + 1, c) + g(r + 1, c + 1)) - (g(r - 1, c - 1) + 2 * g(r - 1, c) + g(r - 1, c + 1))) / (8 * dy) * zFactor;
        const t = Math.hypot(dzdx, dzdy);
        out[r * W + c] = unit === 'pct' ? 100 * t : Math.atan(t) * 180 / Math.PI;
      }
    }
    if (onProgress) onProgress(y1 / H);
  }
  const meta = {
    width: W, height: H, BitsPerSample: [32], SampleFormat: [3], SamplesPerPixel: 1, PhotometricInterpretation: 1,
    ModelPixelScale: [m.rx, m.ry, 0], ModelTiepoint: [0, 0, 0, m.left, m.top, 0], GDAL_NODATA: String(NO),
    GTModelTypeGeoKey: geo ? 2 : 1, GTRasterTypeGeoKey: 1,
    ...(geo ? { GeographicTypeGeoKey: +code[1] } : { ProjectedCSTypeGeoKey: +code[1] }),
  };
  return writeArrayBuffer(out, meta);
}
