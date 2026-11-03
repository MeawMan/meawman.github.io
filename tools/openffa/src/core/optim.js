// optim.js - small, dependency-free optimisers and root finders.
//   brent        : bracketed root finder (robust, derivative free)
//   nelderMead   : unconstrained simplex minimiser with restarts
//   numGradient / numHessian : central finite differences
//   invertMatrix : Gauss-Jordan inverse for the small matrices used here

/** Brent's method. f(a) and f(b) must have opposite signs. Returns root or NaN. */
export function brent(f, a, b, tol = 1e-13, maxIter = 200) {
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return NaN;
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      let p, q;
      const s = fb / fa;
      if (a === c) { p = 2 * xm * s; q = 1 - s; }
      else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = xm; e = d; }
    } else { d = xm; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : (xm > 0 ? tol1 : -tol1);
    fb = f(b);
  }
  return b;
}

/** Scan [lo, hi] on n sub-intervals for a sign change and refine the first one with brent. */
export function findRoot(f, lo, hi, n = 60, tol = 1e-13) {
  let x0 = lo, f0 = f(x0);
  for (let i = 1; i <= n; i++) {
    const x1 = lo + (hi - lo) * i / n, f1 = f(x1);
    if (isFinite(f0) && isFinite(f1) && f0 * f1 <= 0) return brent(f, x0, x1, tol);
    x0 = x1; f0 = f1;
  }
  return NaN;
}

/**
 * Nelder-Mead simplex. f: R^n -> R (return Infinity for infeasible points).
 * Restarts from the best point until the improvement is negligible.
 */
export function nelderMead(f, x0, opts = {}) {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 2000 * n;
  const tolF = opts.tolF ?? 1e-12, tolX = opts.tolX ?? 1e-10;
  const step = opts.step ?? x0.map((v) => (Math.abs(v) > 1e-8 ? 0.1 * Math.abs(v) : 0.1));
  let best = null, evals = 0;
  const ff = (x) => { evals++; const v = f(x); return Number.isNaN(v) ? Infinity : v; };

  for (let restart = 0; restart < (opts.restarts ?? 4); restart++) {
    const start = best ? best.x.slice() : x0.slice();
    let simplex = [start.slice()];
    for (let i = 0; i < n; i++) {
      const p = start.slice();
      p[i] += step[i] * (restart ? 0.5 : 1);
      simplex.push(p);
    }
    let fv = simplex.map(ff);
    let iter = 0;
    for (; iter < maxIter; iter++) {
      const idx = fv.map((v, i) => i).sort((a, b) => fv[a] - fv[b]);
      simplex = idx.map((i) => simplex[i]); fv = idx.map((i) => fv[i]);
      const fRange = Math.abs(fv[n] - fv[0]);
      let xRange = 0;
      for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) {
        xRange = Math.max(xRange, Math.abs(simplex[i][j] - simplex[0][j]));
      }
      if ((fRange <= tolF * (1 + Math.abs(fv[0])) || !isFinite(fRange)) && xRange <= tolX * (1 + Math.max(...simplex[0].map(Math.abs))) ) break;
      const cen = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
      const pt = (t) => cen.map((c, j) => c + t * (simplex[n][j] - c));
      const xr = pt(-1), fr = ff(xr);
      if (fr < fv[0]) {
        const xe = pt(-2), fe = ff(xe);
        if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
      } else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
      else {
        const outside = fr < fv[n];
        const xc = pt(outside ? -0.5 : 0.5), fc = ff(xc);
        if (fc < (outside ? fr : fv[n])) { simplex[n] = xc; fv[n] = fc; }
        else {
          for (let i = 1; i <= n; i++) {
            simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
            fv[i] = ff(simplex[i]);
          }
        }
      }
    }
    const idx = fv.indexOf(Math.min(...fv));
    const cand = { x: simplex[idx].slice(), fx: fv[idx], iterations: iter, evals, converged: iter < maxIter };
    const improved = !best || best.fx - cand.fx > 1e-10 * (1 + Math.abs(best.fx));
    if (!best || cand.fx < best.fx) best = cand;
    if (!improved) break;
  }
  best.evals = evals;
  return best;
}

export function numGradient(f, x, h = 1e-6) {
  return x.map((xi, i) => {
    const s = h * Math.max(1, Math.abs(xi));
    const xp = x.slice(), xm = x.slice(); xp[i] += s; xm[i] -= s;
    return (f(xp) - f(xm)) / (2 * s);
  });
}

export function numHessian(f, x, h = 1e-4) {
  const n = x.length, H = Array.from({ length: n }, () => new Array(n).fill(0));
  const hs = x.map((xi) => h * Math.max(1, Math.abs(xi)));
  const f0 = f(x);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const p = (si, sj) => { const y = x.slice(); y[i] += si * hs[i]; y[j] += sj * hs[j]; return f(y); };
      let v;
      if (i === j) v = (p(1, 0) - 2 * f0 + p(-1, 0)) / (hs[i] * hs[i]);
      else v = (p(1, 1) - p(1, -1) - p(-1, 1) + p(-1, -1)) / (4 * hs[i] * hs[j]);
      H[i][j] = H[j][i] = v;
    }
  }
  return H;
}

/** Gauss-Jordan inverse; returns null if singular. */
export function invertMatrix(M) {
  const n = M.length;
  const a = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const m = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= m * a[c][j];
    }
  }
  return a.map((r) => r.slice(n));
}
