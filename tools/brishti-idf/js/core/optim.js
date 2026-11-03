/**
 * optim.js — derivative-free optimisers (no dependencies, seedable).
 *
 *  nelderMead      local simplex search with restarts
 *  differentialEvolution   global search (Storn & Price 1997, DE/rand/1/bin)
 *  multiStart      Latin-hypercube starts polished by Nelder-Mead
 *
 * All objective functions must return a finite number (use a large penalty or
 * Infinity for infeasible points; Infinity is handled).
 * The optimisers support cooperative cancellation and progress callbacks so that
 * they can run inside a Web Worker.
 */
import { Rng } from './rng.js';

/**
 * Nelder-Mead simplex.
 * @param {(x:number[])=>number} f
 * @param {number[]} x0 starting point
 * @param {{step?:number|number[], maxIter?:number, tol?:number, restarts?:number}} opt
 * @returns {{x:number[], fx:number, iterations:number, converged:boolean}}
 */
export function nelderMead(f, x0, opt = {}) {
  const n = x0.length;
  const maxIter = opt.maxIter ?? 400 * n;
  const tol = opt.tol ?? 1e-10;
  const restarts = opt.restarts ?? 2;
  const stepOf = (i, x) => {
    if (Array.isArray(opt.step)) return opt.step[i];
    const s = opt.step ?? 0.1;
    return x[i] !== 0 ? s * Math.abs(x[i]) : s * 0.1 + 1e-4;
  };

  let best = { x: x0.slice(), fx: f(x0), iterations: 0, converged: false };
  let start = x0.slice();
  for (let r = 0; r <= restarts; r++) {
    const res = nmRun(f, start, stepOf, maxIter, tol);
    best.iterations += res.iterations;
    if (res.fx < best.fx || r === 0) { best.x = res.x; best.fx = res.fx; best.converged = res.converged; }
    start = best.x.slice(); // restart from the best point to escape degenerate simplices
  }
  return best;
}

function nmRun(f, x0, stepOf, maxIter, tol) {
  const n = x0.length;
  const simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += stepOf(i, x0);
    simplex.push(p);
  }
  let fs = simplex.map((p) => { const v = f(p); return Number.isNaN(v) ? Infinity : v; });
  let it = 0;
  let converged = false;
  const alpha = 1; const gamma = 2; const rho = 0.5; const sigma = 0.5;
  while (it < maxIter) {
    it++;
    // sort
    const idx = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    const sx = idx.map((i) => simplex[i]);
    const sf = idx.map((i) => fs[i]);
    for (let i = 0; i <= n; i++) { simplex[i] = sx[i]; fs[i] = sf[i]; }
    // convergence: both function spread and simplex size are tiny
    let size = 0;
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) size = Math.max(size, Math.abs(simplex[i][j] - simplex[0][j]));
    const fspread = Math.abs(fs[n] - fs[0]);
    if ((fspread <= tol * (Math.abs(fs[0]) + tol) && size <= Math.sqrt(tol)) || (size < 1e-14)) { converged = true; break; }
    // centroid of all but the worst
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const refl = c.map((cj, j) => cj + alpha * (cj - worst[j]));
    let fr = f(refl); if (Number.isNaN(fr)) fr = Infinity;
    if (fr < fs[0]) {
      const exp = c.map((cj, j) => cj + gamma * (refl[j] - cj));
      let fe = f(exp); if (Number.isNaN(fe)) fe = Infinity;
      if (fe < fr) { simplex[n] = exp; fs[n] = fe; } else { simplex[n] = refl; fs[n] = fr; }
    } else if (fr < fs[n - 1]) {
      simplex[n] = refl; fs[n] = fr;
    } else {
      const outside = fr < fs[n];
      const base = outside ? refl : worst;
      const con = c.map((cj, j) => cj + rho * (base[j] - cj));
      let fc = f(con); if (Number.isNaN(fc)) fc = Infinity;
      if (fc < (outside ? fr : fs[n])) {
        simplex[n] = con; fs[n] = fc;
      } else {
        // shrink
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + sigma * (v - simplex[0][j]));
          const v = f(simplex[i]); fs[i] = Number.isNaN(v) ? Infinity : v;
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i <= n; i++) if (fs[i] < fs[bi]) bi = i;
  return { x: simplex[bi], fx: fs[bi], iterations: it, converged };
}

/**
 * Differential evolution (DE/rand/1/bin) with box bounds.
 * @param {(x:number[])=>number} f
 * @param {[number,number][]} bounds
 * @param {{popSize?:number, maxGen?:number, F?:number, CR?:number, seed?:number, tol?:number,
 *          onProgress?:(info:{gen:number,best:number})=>void, shouldCancel?:()=>boolean, x0?:number[][]}} opt
 */
export function differentialEvolution(f, bounds, opt = {}) {
  const n = bounds.length;
  const NP = opt.popSize ?? Math.max(20, 10 * n);
  const maxGen = opt.maxGen ?? 300;
  const F = opt.F ?? 0.7;
  const CR = opt.CR ?? 0.9;
  const tol = opt.tol ?? 1e-12;
  const rng = new Rng(opt.seed ?? 1);
  const pop = [];
  const fit = [];
  const seeds = opt.x0 ?? [];
  for (let i = 0; i < NP; i++) {
    const p = i < seeds.length
      ? seeds[i].map((v, j) => Math.min(bounds[j][1], Math.max(bounds[j][0], v)))
      : bounds.map(([lo, hi]) => lo + rng.uniform() * (hi - lo));
    pop.push(p);
    const v = f(p);
    fit.push(Number.isNaN(v) ? Infinity : v);
  }
  let evals = NP;
  let gen = 0;
  let stall = 0;
  let lastBest = Math.min(...fit);
  for (; gen < maxGen; gen++) {
    if (opt.shouldCancel && opt.shouldCancel()) return finish(true);
    for (let i = 0; i < NP; i++) {
      let a, b, c;
      do { a = rng.int(NP); } while (a === i);
      do { b = rng.int(NP); } while (b === i || b === a);
      do { c = rng.int(NP); } while (c === i || c === a || c === b);
      const jr = rng.int(n);
      const trial = pop[i].slice();
      for (let j = 0; j < n; j++) {
        if (rng.uniform() < CR || j === jr) {
          let v = pop[a][j] + F * (pop[b][j] - pop[c][j]);
          const [lo, hi] = bounds[j];
          if (v < lo) v = lo + rng.uniform() * (pop[i][j] - lo); // bounce back
          else if (v > hi) v = hi - rng.uniform() * (hi - pop[i][j]);
          trial[j] = v;
        }
      }
      let ft = f(trial); if (Number.isNaN(ft)) ft = Infinity;
      evals++;
      if (ft <= fit[i]) { pop[i] = trial; fit[i] = ft; }
    }
    const best = Math.min(...fit);
    if (opt.onProgress && gen % 5 === 0) opt.onProgress({ gen, best });
    if (Math.abs(lastBest - best) <= tol * (Math.abs(best) + tol)) stall++; else stall = 0;
    lastBest = best;
    if (stall >= 25) { gen++; break; }
  }
  return finish(false);

  function finish(cancelled) {
    let bi = 0;
    for (let i = 1; i < NP; i++) if (fit[i] < fit[bi]) bi = i;
    return { x: pop[bi], fx: fit[bi], generations: gen, evaluations: evals, cancelled };
  }
}

/**
 * Multi-start: Latin-hypercube starting points polished by Nelder-Mead.
 * Returns all local optima sorted by objective value, so callers can inspect
 * identifiability (several different parameter sets with near-equal fit).
 */
export function multiStart(f, bounds, opt = {}) {
  const nStarts = opt.nStarts ?? 20;
  const n = bounds.length;
  const rng = new Rng(opt.seed ?? 1);
  // Latin hypercube
  const lhs = Array.from({ length: nStarts }, () => new Array(n));
  for (let j = 0; j < n; j++) {
    const perm = Array.from({ length: nStarts }, (_, i) => i);
    for (let i = nStarts - 1; i > 0; i--) { const k = rng.int(i + 1); [perm[i], perm[k]] = [perm[k], perm[i]]; }
    for (let i = 0; i < nStarts; i++) {
      lhs[i][j] = bounds[j][0] + ((perm[i] + rng.uniform()) / nStarts) * (bounds[j][1] - bounds[j][0]);
    }
  }
  const bounded = (x) => {
    for (let j = 0; j < n; j++) if (x[j] < bounds[j][0] || x[j] > bounds[j][1]) return Infinity;
    return f(x);
  };
  const results = [];
  for (let s = 0; s < nStarts; s++) {
    if (opt.shouldCancel && opt.shouldCancel()) break;
    const starts = opt.x0 && s < opt.x0.length ? opt.x0[s] : lhs[s];
    const r = nelderMead(bounded, starts, { maxIter: opt.maxIter ?? 600 * n, tol: opt.tol ?? 1e-12, restarts: 1 });
    results.push(r);
    if (opt.onProgress) opt.onProgress({ start: s + 1, of: nStarts, best: Math.min(...results.map((q) => q.fx)) });
  }
  results.sort((a, b) => a.fx - b.fx);
  return { best: results[0], all: results };
}
