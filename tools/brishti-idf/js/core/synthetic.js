/**
 * synthetic.js — a seeded stochastic rainfall generator for TESTING and DEMONSTRATION ONLY.
 *
 * It is NOT a calibrated model of any real place. It produces a 1-minute (or coarser) series with:
 *  - storms arriving as a Poisson process with a monthly rate (default: monsoon-like seasonality),
 *  - storm duration ~ exponential, each storm made of rain cells (Neyman-Scott-like clustering),
 *  - each cell has an intensity (mm/h) ~ exponential with a heavy-tail mixture, and a duration
 *    ~ Gamma(shape 2) with a 5-min floor; depth = intensity x duration.
 * Version 2 (2026-10-27): v1 drew cell DEPTH and allowed one-step cells, which put whole cells into
 * 5 minutes and gave implausible short-duration extremes (10-yr 5-min depth ~74 mm, 1-h ~190 mm).
 * v2 defaults were tuned (grid search, seed 2026) to typical depth-duration RATIOS at T = 10 yr:
 * 5-min/1-h ~0.29, 15-min/1-h ~0.57 (US TP-40/HYDRO-35-type ratios, recalled, not from an opened source),
 * 1-h/24-h ~0.40. Achieved over seeds 2026/11/99 (30 yr): 5 min 24-25 mm, 1 h 99-110 mm, 24 h 211-248 mm,
 * ~2,750 mm/yr: plausible for a humid monsoon climate, NOT a calibration to any gauge.
 * The output is used for (a) unit tests with known structure, (b) the demo dataset shipped in data/,
 * clearly labelled synthetic, and (c) the hold-out disaggregation experiment, where the "truth" is a
 * synthetic sub-daily series (weaker evidence than real gauge data; stated in docs/LIMITATIONS.md).
 */
import { Rng } from './rng.js';

const MONSOON_RATE = [0.4, 0.6, 1.5, 3.5, 6, 9, 10, 9, 7, 3, 0.8, 0.3]; // storms per month (Jan..Dec)

/**
 * @param {{years?:number, startYear?:number, step?:number, seed?:number, monthlyStorms?:number[],
 *          meanStormHours?:number, cellsPerStorm?:number, meanCellMinutes?:number, meanCellIntensity?:number,
 *          minCellMinutes?:number, heavyFraction?:number, heavyFactor?:number, scale?:number}} opt
 * @returns {{origin:number, step:number, values:Float64Array, label:string}}
 */
export function generateSynthetic(opt = {}) {
  const years = opt.years ?? 30;
  const startYear = opt.startYear ?? 1991;
  const step = opt.step ?? 5;
  const rng = new Rng(opt.seed ?? 2026);
  const rates = opt.monthlyStorms ?? MONSOON_RATE;
  const meanStormH = opt.meanStormHours ?? 20;
  const cells = opt.cellsPerStorm ?? 25;
  const meanCellMin = opt.meanCellMinutes ?? 15;
  const meanCellIntensity = (opt.meanCellIntensity ?? 7) * (opt.scale ?? 1); // mm/h
  const heavyFraction = opt.heavyFraction ?? 0.03;
  const heavyFactor = opt.heavyFactor ?? 3;
  const minCellMin = opt.minCellMinutes ?? 5; // independent of step: the same seed gives the same storms at any resolution

  const origin = Date.UTC(startYear, 0, 1);
  const end = Date.UTC(startYear + years, 0, 1);
  const n = Math.round((end - origin) / (step * 60000));
  const values = new Float64Array(n);
  const stepMs = step * 60000;

  for (let y = startYear; y < startYear + years; y++) {
    for (let m = 0; m < 12; m++) {
      const mStart = Date.UTC(y, m, 1);
      const mEnd = Date.UTC(y, m + 1, 1);
      const nStorms = rng.poisson(rates[m]);
      for (let s = 0; s < nStorms; s++) {
        const t0 = mStart + rng.uniform() * (mEnd - mStart);
        const stormMs = rng.exponential(meanStormH) * 3600000;
        const nc = 1 + rng.poisson(cells - 1);
        // monsoon storms slightly heavier in peak months
        const seasonal = 0.7 + 0.6 * (rates[m] / Math.max(...rates));
        for (let c = 0; c < nc; c++) {
          const cs = t0 + rng.uniform() * stormMs;
          // Gamma(2) duration: sum of two exponentials with half the mean each (rarely very short)
          const durMin = Math.max(minCellMin, rng.exponential(meanCellMin / 2) + rng.exponential(meanCellMin / 2));
          const durMs = durMin * 60000;
          let intensity = rng.exponential(meanCellIntensity) * seasonal;
          if (rng.uniform() < heavyFraction) intensity *= heavyFactor * (0.5 + rng.uniform());
          const depth = intensity * durMin / 60;
          // spread depth uniformly over the cell's duration
          let a = cs; const b = cs + durMs;
          while (a < b) {
            const i = Math.floor((a - origin) / stepMs);
            const binEnd = origin + (i + 1) * stepMs;
            const seg = Math.min(b, binEnd) - a;
            if (i >= 0 && i < n) values[i] += depth * seg / durMs;
            a += seg;
          }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) values[i] = Math.round(values[i] * 100) / 100; // 0.01 mm resolution
  return { origin, step, values, label: `SYNTHETIC (seed ${opt.seed ?? 2026}) — not real data` };
}
