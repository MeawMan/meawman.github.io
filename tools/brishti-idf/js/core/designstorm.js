/**
 * designstorm.js — design hyetographs from an IDF relationship, and export formats.
 *
 * Every generator returns blocks of equal length dt (minutes): { t: end time of block (min), depth (mm),
 * intensity (mm/h), cumulative (mm) }. Total depth always equals the IDF depth for (duration, T),
 * except where the method is a dimensionless pattern scaled to that depth (SCS, Huff), which is
 * conserved by construction.
 *
 * Methods:
 *  alternatingBlock  Chow, Maidment & Mays (1988): increments of the IDF depth-duration curve arranged
 *                    with the largest block at the peak position r and the rest alternating around it.
 *  chicago           Keifer & Chu (1957): for any depth-duration function D(t) the cumulative depth on each
 *                    side of the peak is r*D(t_b/r) and (1-r)*D(t_a/(1-r)); every centred window then matches
 *                    the IDF depth exactly. Implemented generally (no closed-form IDF needed).
 *  scs               NRCS Type I/IA/II/III 24-h dimensionless mass curves (scs_tables.js). For durations
 *                    < 24 h the central (steepest) part of the curve is used and renormalised — a common
 *                    practice, flagged as an approximation.
 *  huff              Huff (1990) median point time distributions, quartiles 1-4 (ISWS Circular 173, Table 3).
 *  triangular        Yen & Chow (1980): triangle with peak at r*duration, peak intensity 2P/duration.
 *  uniform           constant intensity (reference case).
 */
import { SCS, SCS_STEP_HOURS } from './scs_tables.js';

/**
 * Huff (1990) — "Median Time Distributions of Heavy Storm Rainfall at a Point", ISWS Circular 173, Table 3.
 * Cumulative % of storm rainfall at 0,5,...,100 % of storm time. (0 and 100 added.)
 * Transcribed from the circular via text extraction; columns were checked to be monotone.
 */
export const HUFF_POINT = {
  1: [0, 16, 33, 43, 52, 60, 66, 71, 75, 79, 82, 84, 86, 88, 90, 92, 94, 96, 97, 98, 100],
  2: [0, 3, 8, 12, 16, 22, 29, 39, 51, 62, 70, 76, 81, 85, 88, 91, 93, 95, 97, 98, 100],
  3: [0, 3, 6, 9, 12, 15, 19, 23, 27, 32, 38, 45, 57, 70, 79, 85, 89, 92, 95, 97, 100],
  4: [0, 2, 5, 8, 10, 13, 16, 19, 22, 25, 28, 32, 35, 39, 45, 51, 59, 72, 84, 92, 100],
};

function blocksFromCumulative(cum, dt) {
  const out = [];
  let prev = 0;
  for (let j = 0; j < cum.length; j++) {
    const depth = Math.max(0, cum[j] - prev);
    out.push({ t: (j + 1) * dt, depth, intensity: depth / (dt / 60), cumulative: cum[j] });
    prev = cum[j];
  }
  return out;
}

/** Linear interpolation helper on a uniform grid. */
function interpUniform(ys, stepX, x) {
  const p = x / stepX;
  const i = Math.floor(p);
  if (i >= ys.length - 1) return ys[ys.length - 1];
  if (i < 0) return ys[0];
  return ys[i] + (p - i) * (ys[i + 1] - ys[i]);
}

/**
 * @param {(dMin:number)=>number} depthFn  IDF depth (mm) for duration dMin at the chosen T
 * @param {number} duration storm duration (min)
 * @param {number} dt time step (min); duration must be a multiple of dt
 * @param {{method:string, peak?:number, scsType?:string, quartile?:number}} opt
 */
export function designStorm(depthFn, duration, dt, opt) {
  const n = Math.round(duration / dt);
  if (Math.abs(n * dt - duration) > 1e-9) throw new Error('storm duration must be a multiple of the time step');
  const r = opt.peak ?? 0.5;
  const P = depthFn(duration);
  switch (opt.method) {
    case 'alternatingBlock': {
      const inc = [];
      let prev = 0;
      for (let j = 1; j <= n; j++) { const D = depthFn(j * dt); inc.push(Math.max(0, D - prev)); prev = D; }
      // positions ordered by distance from the peak block, alternating (right first when r >= 0.5)
      const peakIdx = Math.min(n - 1, Math.max(0, Math.round(r * n - 0.5)));
      const order = [peakIdx];
      let left = peakIdx - 1; let right = peakIdx + 1; let takeRight = r >= 0.5;
      while (order.length < n) {
        if ((takeRight && right < n) || left < 0) order.push(right++);
        else order.push(left--);
        takeRight = !takeRight;
      }
      const depth = new Array(n).fill(0);
      order.forEach((pos, k) => { depth[pos] = inc[k]; });
      let c = 0;
      return depth.map((v, j) => { c += v; return { t: (j + 1) * dt, depth: v, intensity: v / (dt / 60), cumulative: c }; });
    }
    case 'chicago': {
      const tp = r * duration;
      const cumAt = (t) => {
        // cumulative depth from storm start to time t
        if (t <= tp) {
          const tb = tp - t; // time before peak not yet reached
          return r * depthFn(tp / r) - (tb > 0 ? r * depthFn(tb / r) : 0);
        }
        const ta = t - tp;
        return r * depthFn(tp / r) + (1 - r) * depthFn(ta / (1 - r));
      };
      const safe = (t) => (t <= 0 ? 0 : cumAt(t));
      // depthFn(0) is 0; guard r = 0 or 1
      if (r <= 0 || r >= 1) throw new Error('Chicago storm needs 0 < peak position < 1');
      const cum = []; for (let j = 1; j <= n; j++) cum.push(safe(j * dt));
      // normalise tiny numerical drift so the total equals D(duration) exactly
      const scale = P / cum[n - 1];
      return blocksFromCumulative(cum.map((v) => v * scale), dt);
    }
    case 'scs': {
      const table = SCS[opt.scsType ?? 'II'];
      if (!table) throw new Error('unknown SCS type');
      const durH = duration / 60;
      if (durH > 24 + 1e-9) throw new Error('SCS distributions are defined for durations up to 24 h');
      // choose the window of length durH with the largest depth fraction (steepest part)
      let best = 0; let bestStart = 0;
      for (let s = 0; s + durH <= 24 + 1e-9; s += 0.1) {
        const f = interpUniform(table, SCS_STEP_HOURS, s + durH) - interpUniform(table, SCS_STEP_HOURS, s);
        if (f > best + 1e-12) { best = f; bestStart = s; }
      }
      const base = interpUniform(table, SCS_STEP_HOURS, bestStart);
      const cum = [];
      for (let j = 1; j <= n; j++) cum.push(P * (interpUniform(table, SCS_STEP_HOURS, bestStart + (j * dt) / 60) - base) / best);
      return blocksFromCumulative(cum, dt);
    }
    case 'huff': {
      const q = HUFF_POINT[opt.quartile ?? 2];
      const cum = [];
      for (let j = 1; j <= n; j++) cum.push((P * interpUniform(q, 5, (100 * j) / n)) / 100);
      return blocksFromCumulative(cum, dt);
    }
    case 'triangular': {
      const ta = r * duration;
      const h = 2 * P / duration; // mm per min at the peak
      const F = (t) => (t <= ta ? (h * t * t) / (2 * ta) : P - (h * (duration - t) ** 2) / (2 * (duration - ta)));
      const cum = []; for (let j = 1; j <= n; j++) cum.push(Math.min(P, F(j * dt)));
      return blocksFromCumulative(cum, dt);
    }
    case 'uniform': {
      const cum = []; for (let j = 1; j <= n; j++) cum.push((P * j) / n);
      return blocksFromCumulative(cum, dt);
    }
    default: throw new Error(`unknown design-storm method ${opt.method}`);
  }
}

/** Maximum depth over any window of k consecutive blocks (used to check IDF consistency). */
export function maxWindowDepth(blocks, k) {
  let best = 0; let s = 0;
  for (let i = 0; i < blocks.length; i++) {
    s += blocks[i].depth;
    if (i >= k) s -= blocks[i - k].depth;
    if (i >= k - 1) best = Math.max(best, s);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------

const pad = (v, w = 2) => String(v).padStart(w, '0');

/** Generic CSV. */
export function stormToCSV(blocks, meta = {}) {
  const lines = [];
  for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v}`);
  lines.push('time_end_min,depth_mm,intensity_mm_per_h,cumulative_mm');
  for (const b of blocks) lines.push([b.t, b.depth.toFixed(4), b.intensity.toFixed(4), b.cumulative.toFixed(4)].join(','));
  return lines.join('\n') + '\n';
}

/**
 * EPA SWMM 5 rain-gauge data file (one record per line: Station Year Month Day Hour Minute Value).
 * Use with a Rain Gage whose Data Source is FILE, format INTENSITY (mm/h) or VOLUME (mm) to match `format`,
 * and Rain Interval equal to dt.  Start date is arbitrary (design storm).
 */
export function stormToSWMMDat(blocks, dt, { station = 'IDF1', start = Date.UTC(2000, 0, 1), format = 'INTENSITY' } = {}) {
  const lines = [];
  blocks.forEach((b, j) => {
    const t = new Date(start + j * dt * 60000);
    const v = format === 'VOLUME' ? b.depth : b.intensity;
    lines.push(`${station} ${t.getUTCFullYear()} ${t.getUTCMonth() + 1} ${t.getUTCDate()} ${t.getUTCHours()} ${t.getUTCMinutes()} ${v.toFixed(4)}`);
  });
  return lines.join('\n') + '\n';
}

/** SWMM [TIMESERIES] section text (intensity, mm/h; time as H:MM from start; first point at 0). */
export function stormToSWMMTimeseries(blocks, dt, name = 'DesignStorm') {
  const lines = ['[TIMESERIES]', ';;Name           Date       Time       Value'];
  blocks.forEach((b, j) => {
    const m = j * dt;
    lines.push(`${name.padEnd(16)} ${''.padEnd(10)} ${Math.floor(m / 60)}:${pad(m % 60)}      ${b.intensity.toFixed(4)}`);
  });
  const end = blocks.length * dt;
  lines.push(`${name.padEnd(16)} ${''.padEnd(10)} ${Math.floor(end / 60)}:${pad(end % 60)}      0`);
  return lines.join('\n') + '\n';
}

/**
 * HEC-HMS: table for manual entry in a Precipitation Gage time-series (incremental depth, mm, at dt),
 * or for the "Specified Hyetograph" method. HEC-HMS stores gage data in DSS, which a browser cannot
 * write; paste the values (or use HEC-DSSVue's import) — see docs/README.
 */
export function stormToHecHms(blocks, dt, start = Date.UTC(2000, 0, 1)) {
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const lines = ['Date,Time,Precipitation (MM)'];
  blocks.forEach((b, j) => {
    const t = new Date(start + (j + 1) * dt * 60000);
    lines.push(`${pad(t.getUTCDate())}${mon[t.getUTCMonth()]}${t.getUTCFullYear()},${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())},${b.depth.toFixed(4)}`);
  });
  return lines.join('\n') + '\n';
}
