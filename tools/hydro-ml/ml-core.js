/* Hydro ML Studio — model engine (no libraries).
   Runs inside a Web Worker (ml-worker.js) or, as a fallback, on the page.
   Models: linear / ridge, KNN, regression tree, random forest, gradient boosting, MLP.
   All take X as an array of rows (arrays of numbers) and y as an array of numbers. */
(function (root) {
  'use strict';
  const HML = {};

  // ---------------------------------------------------------------- utilities
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  HML.rng = mulberry32;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function fitScaler(X) {
    const n = X.length, d = n ? X[0].length : 0;
    const mu = new Float64Array(d), sd = new Float64Array(d);
    for (const r of X) for (let j = 0; j < d; j++) mu[j] += r[j];
    for (let j = 0; j < d; j++) mu[j] /= n || 1;
    for (const r of X) for (let j = 0; j < d; j++) { const e = r[j] - mu[j]; sd[j] += e * e; }
    for (let j = 0; j < d; j++) { sd[j] = Math.sqrt(sd[j] / Math.max(1, n - 1)); if (!(sd[j] > 1e-12)) sd[j] = 1; }
    return { mu, sd };
  }
  const scaleRow = (r, s) => { const o = new Float64Array(r.length); for (let j = 0; j < r.length; j++) o[j] = (r[j] - s.mu[j]) / s.sd[j]; return o; };
  function meanStd(y) {
    let m = 0; for (const v of y) m += v; m /= y.length || 1;
    let s = 0; for (const v of y) s += (v - m) * (v - m);
    return { m, s: Math.sqrt(s / Math.max(1, y.length - 1)) || 1 };
  }

  // ---------------------------------------------------------------- metrics
  // NSE, KGE (Gupta et al. 2009), R², RMSE, MAE, PBIAS (Moriasi et al. 2007 sign: + = underestimation), RSR
  HML.metrics = function (obs, pred) {
    const n = obs.length;
    if (!n) return null;
    let so = 0, sp = 0;
    for (let i = 0; i < n; i++) { so += obs[i]; sp += pred[i]; }
    const mo = so / n, mp = sp / n;
    let sse = 0, sae = 0, sso = 0, ssp = 0, sop = 0, sd = 0;
    for (let i = 0; i < n; i++) {
      const e = obs[i] - pred[i], a = obs[i] - mo, b = pred[i] - mp;
      sse += e * e; sae += Math.abs(e); sso += a * a; ssp += b * b; sop += a * b; sd += e;
    }
    const r = sso > 0 && ssp > 0 ? sop / Math.sqrt(sso * ssp) : 0;
    const alpha = sso > 0 ? Math.sqrt(ssp / sso) : NaN;
    const beta = mo !== 0 ? mp / mo : NaN;
    const rmse = Math.sqrt(sse / n);
    return {
      n,
      nse: sso > 0 ? 1 - sse / sso : NaN,
      kge: 1 - Math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2),
      r2: r * r, r, rmse, mae: sae / n,
      pbias: so !== 0 ? (100 * sd) / so : NaN,
      rsr: sso > 0 ? rmse / Math.sqrt(sso / n) : NaN,
    };
  };

  // ---------------------------------------------------------------- linear algebra
  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => Float64Array.from([...row, b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) continue;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return Array.from({ length: n }, (_, i) => (Math.abs(M[i][i]) < 1e-14 ? 0 : M[i][n] / M[i][i]));
  }

  // ---------------------------------------------------------------- models
  const MODELS = {};

  // Linear regression: OLS, ridge (L2), lasso (L1) or elastic net, on standardized inputs (intercept not penalized).
  // Ridge / OLS use the closed form; lasso and elastic net use cyclic coordinate descent.
  MODELS.linear = {
    fit(X, y, p) {
      const pen = p.penalty || 'ridge';
      if (pen === 'lasso' || pen === 'elastic') return MODELS.linear.fitCD(X, y, p, pen === 'lasso' ? 1 : Math.min(1, Math.max(0, p.l1ratio == null ? 0.5 : p.l1ratio)));
      const s = fitScaler(X), Z = X.map((r) => scaleRow(r, s)), d = s.mu.length, n = X.length;
      const ym = y.reduce((a, v) => a + v, 0) / n;
      const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
      for (let i = 0; i < n; i++) {
        const z = Z[i], e = y[i] - ym;
        for (let j = 0; j < d; j++) { b[j] += z[j] * e; const zj = z[j]; const Aj = A[j]; for (let k = j; k < d; k++) Aj[k] += zj * z[k]; }
      }
      const lam = (pen === 'none' ? 0 : Number(p.lambda) || 0) * n + 1e-9 * n;
      for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j][k] = A[k][j]; A[j][j] += lam; }
      const beta = solve(A, b);
      return { s, beta, ym, imp: beta.map((v) => Math.abs(v)) };
    },
    // minimise (1/2n)||y − Zβ||² + λ( r·|β|₁ + (1−r)/2·||β||² )
    fitCD(X, y, p, r) {
      const s = fitScaler(X), Z = X.map((row) => scaleRow(row, s)), d = s.mu.length, n = X.length;
      const ym = y.reduce((a, v) => a + v, 0) / n, lam = Math.max(1e-8, Number(p.lambda) || 0.01);
      const beta = new Float64Array(d), res = Float64Array.from(y, (v) => v - ym), zz = new Float64Array(d);
      for (let j = 0; j < d; j++) { let a = 0; for (let i = 0; i < n; i++) a += Z[i][j] * Z[i][j]; zz[j] = a / n; }
      const soft = (v, t) => (v > t ? v - t : v < -t ? v + t : 0);
      for (let it = 0; it < 2000; it++) {
        let maxd = 0;
        for (let j = 0; j < d; j++) {
          let rho = 0; for (let i = 0; i < n; i++) rho += Z[i][j] * res[i];
          rho = rho / n + zz[j] * beta[j];
          const nb = soft(rho, lam * r) / (zz[j] + lam * (1 - r)), dl = nb - beta[j];
          if (dl !== 0) { for (let i = 0; i < n; i++) res[i] -= dl * Z[i][j]; beta[j] = nb; if (Math.abs(dl) > maxd) maxd = Math.abs(dl); }
        }
        if (maxd < 1e-7) break;
      }
      return { s, beta: Array.from(beta), ym, imp: Array.from(beta, (v) => Math.abs(v)), nonzero: Array.from(beta).filter((v) => v !== 0).length };
    },
    predict(m, X) {
      return X.map((r) => { let v = m.ym; for (let j = 0; j < r.length; j++) v += m.beta[j] * (r[j] - m.s.mu[j]) / m.s.sd[j]; return v; });
    },
  };

  // K-nearest neighbours on standardized inputs
  MODELS.knn = {
    fit(X, y, p) {
      const s = fitScaler(X);
      return { s, Z: X.map((r) => scaleRow(r, s)), y: Float64Array.from(y), k: Math.max(1, Math.min(X.length, Math.round(p.k || 7))), w: p.weights || 'distance' };
    },
    predict(m, X, prog) {
      const out = new Float64Array(X.length), k = m.k, n = m.Z.length;
      const bd = new Float64Array(k), bi = new Int32Array(k);
      for (let q = 0; q < X.length; q++) {
        const z = scaleRow(X[q], m.s);
        bd.fill(Infinity); bi.fill(-1);
        for (let i = 0; i < n; i++) {
          const zi = m.Z[i]; let dist = 0;
          for (let j = 0; j < z.length; j++) { const e = z[j] - zi[j]; dist += e * e; if (dist >= bd[k - 1]) break; }
          if (dist < bd[k - 1]) {
            let pos = k - 1;
            while (pos > 0 && bd[pos - 1] > dist) { bd[pos] = bd[pos - 1]; bi[pos] = bi[pos - 1]; pos--; }
            bd[pos] = dist; bi[pos] = i;
          }
        }
        let sw = 0, sv = 0;
        for (let t = 0; t < k; t++) {
          if (bi[t] < 0) continue;
          const w = m.w === 'distance' ? 1 / (Math.sqrt(bd[t]) + 1e-9) : 1;
          sw += w; sv += w * m.y[bi[t]];
        }
        out[q] = sv / sw;
        if (prog && q % 500 === 0) prog(q / X.length);
      }
      return Array.from(out);
    },
  };

  // ---- histogram-based regression trees (shared by tree, forest, boosting)
  const NB = 64;
  function makeBins(X) {
    const n = X.length, d = X[0].length, edges = [], B = [];
    for (let j = 0; j < d; j++) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = X[i][j];
      const sorted = Float64Array.from(col).sort();
      const e = [];
      for (let b = 1; b < NB; b++) {
        const v = sorted[Math.min(n - 1, Math.floor((b / NB) * n))];
        if (!e.length || v > e[e.length - 1]) e.push(v);
      }
      if (e.length && e[e.length - 1] >= sorted[n - 1]) e.pop(); // the top edge would put everything left
      const bins = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        let lo = 0, hi = e.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (col[i] <= e[mid]) hi = mid; else lo = mid + 1; }
        bins[i] = lo;
      }
      edges.push(e); B.push(bins);
    }
    return { edges, B, d };
  }

  function growTree(bins, y, idx, p, rng, imp) {
    const { B, edges, d } = bins;
    const maxDepth = p.maxDepth || 10, minLeaf = Math.max(1, p.minLeaf || 1);
    const mtry = Math.max(1, Math.min(d, Math.round(p.mtry || d)));
    const T = { f: [], t: [], b: [], l: [], r: [], v: [] };
    const cnt = new Float64Array(NB), sum = new Float64Array(NB);
    const feats = Array.from({ length: d }, (_, j) => j);
    const stack = [{ idx, depth: 0, node: 0 }];
    T.f.push(-1); T.t.push(0); T.b.push(0); T.l.push(-1); T.r.push(-1); T.v.push(0);
    while (stack.length) {
      const { idx: I, depth, node } = stack.pop();
      const n = I.length;
      let S = 0; for (let q = 0; q < n; q++) S += y[I[q]];
      T.v[node] = S / n;
      if (depth >= maxDepth || n < 2 * minLeaf) continue;
      // random feature subset
      for (let q = d - 1; q > 0; q--) { const r = Math.floor(rng() * (q + 1)); const tmp = feats[q]; feats[q] = feats[r]; feats[r] = tmp; }
      let bestGain = 1e-12, bestF = -1, bestB = -1;
      const base = (S * S) / n;
      for (let fi = 0; fi < mtry; fi++) {
        const j = feats[fi], e = edges[j];
        if (!e.length) continue;
        cnt.fill(0, 0, e.length + 1); sum.fill(0, 0, e.length + 1);
        const Bj = B[j];
        let bmin = NB, bmax = -1;
        for (let q = 0; q < n; q++) { const i = I[q], b = Bj[i]; cnt[b]++; sum[b] += y[i]; if (b < bmin) bmin = b; if (b > bmax) bmax = b; }
        if (p.random) {
          // Extra Trees: one random cut point between the node's smallest and largest value
          if (bmax <= bmin) continue;
          const cut = bmin + Math.floor(rng() * (bmax - bmin));
          let nl = 0, sl = 0;
          for (let b = 0; b <= cut; b++) { nl += cnt[b]; sl += sum[b]; }
          const nr = n - nl;
          if (nl < minLeaf || nr < minLeaf) continue;
          const sr = S - sl, gain = (sl * sl) / nl + (sr * sr) / nr - base;
          if (gain > bestGain) { bestGain = gain; bestF = j; bestB = cut; }
          continue;
        }
        let nl = 0, sl = 0;
        for (let b = 0; b < e.length; b++) {
          nl += cnt[b]; sl += sum[b];
          const nr = n - nl;
          if (nl < minLeaf) continue;
          if (nr < minLeaf) break;
          const sr = S - sl, gain = (sl * sl) / nl + (sr * sr) / nr - base;
          if (gain > bestGain) { bestGain = gain; bestF = j; bestB = b; }
        }
      }
      if (bestF < 0) continue;
      const Bf = B[bestF], L = [], R = [];
      for (let q = 0; q < n; q++) { const i = I[q]; (Bf[i] <= bestB ? L : R).push(i); }
      imp[bestF] += bestGain;
      const li = T.f.length, ri = li + 1;
      T.f[node] = bestF; T.t[node] = edges[bestF][bestB]; T.b[node] = bestB; T.l[node] = li; T.r[node] = ri;
      T.f.push(-1, -1); T.t.push(0, 0); T.b.push(0, 0); T.l.push(-1, -1); T.r.push(-1, -1); T.v.push(0, 0);
      stack.push({ idx: R, depth: depth + 1, node: ri }, { idx: L, depth: depth + 1, node: li });
    }
    return T;
  }
  const treeValue = (T, x) => { let k = 0; while (T.f[k] >= 0) k = x[T.f[k]] <= T.t[k] ? T.l[k] : T.r[k]; return T.v[k]; };
  const treeValueBinned = (T, B, i) => { let k = 0; while (T.f[k] >= 0) k = B[T.f[k]][i] <= T.b[k] ? T.l[k] : T.r[k]; return T.v[k]; };
  const normImp = (imp) => { const s = imp.reduce((a, v) => a + v, 0) || 1; return Array.from(imp, (v) => v / s); };

  MODELS.tree = {
    fit(X, y, p) {
      const bins = makeBins(X), imp = new Float64Array(bins.d);
      const idx = Array.from({ length: X.length }, (_, i) => i);
      const T = growTree(bins, y, idx, { maxDepth: p.maxDepth || 8, minLeaf: p.minLeaf || 5, mtry: bins.d }, mulberry32(p.seed || 1), imp);
      return { trees: [T], imp: normImp(imp) };
    },
    predict(m, X) { return X.map((x) => treeValue(m.trees[0], x)); },
  };

  MODELS.forest = {
    fit(X, y, p, prog) {
      const bins = makeBins(X), n = X.length, imp = new Float64Array(bins.d), rng = mulberry32(p.seed || 1);
      const nT = Math.max(1, Math.round(p.nTrees || 100)), frac = Math.min(1, Math.max(0.1, p.sampleFrac || 1));
      const mtry = Math.max(1, Math.round((p.mtryFrac || 0.33) * bins.d));
      const trees = [];
      // out-of-bag estimate
      const oobSum = new Float64Array(n), oobCnt = new Uint16Array(n);
      for (let t = 0; t < nT; t++) {
        const m = Math.round(frac * n), idx = new Array(m), inBag = new Uint8Array(n);
        for (let q = 0; q < m; q++) { const i = Math.floor(rng() * n); idx[q] = i; inBag[i] = 1; }
        const T = growTree(bins, y, idx, { maxDepth: p.maxDepth || 14, minLeaf: p.minLeaf || 3, mtry }, rng, imp);
        trees.push(T);
        for (let i = 0; i < n; i++) if (!inBag[i]) { oobSum[i] += treeValueBinned(T, bins.B, i); oobCnt[i]++; }
        if (prog) prog((t + 1) / nT);
      }
      const oo = [], op = [];
      for (let i = 0; i < n; i++) if (oobCnt[i]) { oo.push(y[i]); op.push(oobSum[i] / oobCnt[i]); }
      return { trees, imp: normImp(imp), oob: oo.length > 10 ? HML.metrics(oo, op) : null };
    },
    predict(m, X) {
      const k = m.trees.length;
      return X.map((x) => { let s = 0; for (const T of m.trees) s += treeValue(T, x); return s / k; });
    },
  };

  // Extremely randomized trees (Geurts et al. 2006): whole sample per tree, random cut points
  MODELS.extra = {
    fit(X, y, p, prog) {
      const bins = makeBins(X), n = X.length, imp = new Float64Array(bins.d), rng = mulberry32(p.seed || 1);
      const nT = Math.max(1, Math.round(p.nTrees || 150)), mtry = Math.max(1, Math.round((p.mtryFrac || 0.7) * bins.d));
      const idx = Array.from({ length: n }, (_, i) => i), trees = [];
      for (let t = 0; t < nT; t++) {
        trees.push(growTree(bins, y, idx, { maxDepth: p.maxDepth || 16, minLeaf: p.minLeaf || 2, mtry, random: true }, rng, imp));
        if (prog) prog((t + 1) / nT);
      }
      return { trees, imp: normImp(imp) };
    },
    predict(m, X) { const k = m.trees.length; return X.map((x) => { let s = 0; for (const T of m.trees) s += treeValue(T, x); return s / k; }); },
  };

  // ε-Support Vector Regression with an RBF kernel, solved by SMO with second-order working-set
  // selection (Fan, Chen & Lin 2005) — the same algorithm as LIBSVM. Inputs and target are standardized.
  MODELS.svr = {
    fit(X, y, p, prog) {
      const rng = mulberry32(p.seed || 1);
      let Xs = X, ys = y;
      const maxN = Math.max(200, Math.round(p.maxRows || 3000));
      if (X.length > maxN) { // evenly spaced subsample keeps every season and year represented
        const pick = []; for (let k = 0; k < maxN; k++) pick.push(Math.floor((k * X.length) / maxN));
        Xs = pick.map((i) => X[i]); ys = pick.map((i) => y[i]);
      }
      const s = fitScaler(Xs), Z = Xs.map((r) => scaleRow(r, s)), ysd = meanStd(ys), Y = ys.map((v) => (v - ysd.m) / ysd.s);
      const l = Z.length, d = s.mu.length, C = Number(p.C) || 10, eps = p.epsilon == null || p.epsilon === '' || !isFinite(+p.epsilon) ? 0.05 : Math.max(0, +p.epsilon);
      const tStart = now(), tLimit = 1000 * (Number(p.maxSeconds) || 120);
      let timedOut = false;
      const gamma = Number(p.gamma) > 0 ? Number(p.gamma) : 1 / d, TAU = 1e-12, tol = p.tol || 1e-3;
      const kern = (a, b) => { let q = 0; for (let j = 0; j < d; j++) { const e = a[j] - b[j]; q += e * e; } return Math.exp(-gamma * q); };
      // kernel row cache (least-recently-used)
      const cache = new Map(), cacheMax = Math.max(64, Math.floor(60e6 / (4 * l)));
      const krow = (i) => {
        let r = cache.get(i);
        if (r) { cache.delete(i); cache.set(i, r); return r; }
        r = new Float32Array(l); const zi = Z[i];
        for (let t = 0; t < l; t++) r[t] = kern(zi, Z[t]);
        cache.set(i, r); if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
        return r;
      };
      const L2 = 2 * l, alpha = new Float64Array(L2), G = new Float64Array(L2), sg = new Int8Array(L2);
      for (let i = 0; i < l; i++) { sg[i] = 1; sg[i + l] = -1; G[i] = eps - Y[i]; G[i + l] = eps + Y[i]; }
      const Qcol = (i, t, Ki) => sg[i] * sg[t] * Ki[t % l];
      const up = (t) => alpha[t] >= C, low = (t) => alpha[t] <= 0;
      const maxIter = Math.max(10000000, 100 * L2);
      let iter = 0;
      for (; iter < maxIter; iter++) {
        // select i
        let Gmax = -Infinity, gi = -1;
        for (let t = 0; t < L2; t++) {
          if (sg[t] === 1) { if (!up(t) && -G[t] >= Gmax) { Gmax = -G[t]; gi = t; } }
          else if (!low(t) && G[t] >= Gmax) { Gmax = G[t]; gi = t; }
        }
        if (gi < 0) break;
        const Ki = krow(gi % l);
        let Gmax2 = -Infinity, gj = -1, best = Infinity;
        for (let t = 0; t < L2; t++) {
          if (sg[t] === 1) {
            if (low(t)) continue;
            const gd = Gmax + G[t]; if (G[t] >= Gmax2) Gmax2 = G[t];
            if (gd > 0) { const q = 2 - 2 * sg[gi] * Qcol(gi, t, Ki); const ob = -(gd * gd) / (q > 0 ? q : TAU); if (ob <= best) { best = ob; gj = t; } }
          } else {
            if (up(t)) continue;
            const gd = Gmax - G[t]; if (-G[t] >= Gmax2) Gmax2 = -G[t];
            if (gd > 0) { const q = 2 + 2 * sg[gi] * Qcol(gi, t, Ki); const ob = -(gd * gd) / (q > 0 ? q : TAU); if (ob <= best) { best = ob; gj = t; } }
          }
        }
        if (Gmax + Gmax2 < tol || gj < 0) break;
        const i = gi, j = gj, Kj = krow(j % l), Qij = Qcol(i, j, Ki);
        const oi = alpha[i], oj = alpha[j];
        if (sg[i] !== sg[j]) {
          const quad = Math.max(TAU, 2 + 2 * Qij), delta = (-G[i] - G[j]) / quad, diff = alpha[i] - alpha[j];
          alpha[i] += delta; alpha[j] += delta;
          if (diff > 0) { if (alpha[j] < 0) { alpha[j] = 0; alpha[i] = diff; } } else if (alpha[i] < 0) { alpha[i] = 0; alpha[j] = -diff; }
          if (diff > 0) { if (alpha[i] > C) { alpha[i] = C; alpha[j] = C - diff; } } else if (alpha[j] > C) { alpha[j] = C; alpha[i] = C + diff; }
        } else {
          const quad = Math.max(TAU, 2 - 2 * Qij), delta = (G[i] - G[j]) / quad, sum = alpha[i] + alpha[j];
          alpha[i] -= delta; alpha[j] += delta;
          if (sum > C) { if (alpha[i] > C) { alpha[i] = C; alpha[j] = sum - C; } } else if (alpha[j] < 0) { alpha[j] = 0; alpha[i] = sum; }
          if (sum > C) { if (alpha[j] > C) { alpha[j] = C; alpha[i] = sum - C; } } else if (alpha[i] < 0) { alpha[i] = 0; alpha[j] = sum; }
        }
        const dai = alpha[i] - oi, daj = alpha[j] - oj;
        if (dai || daj) for (let t = 0; t < L2; t++) G[t] += sg[i] * sg[t] * Ki[t % l] * dai + sg[j] * sg[t] * Kj[t % l] * daj;
        if (iter % 2000 === 0) {
          if (prog) prog(Math.min(0.95, (now() - tStart) / tLimit + 0.02));
          if (now() - tStart > tLimit) { timedOut = true; break; }
        }
      }
      // bias
      let nf = 0, sf = 0, ub = Infinity, lb = -Infinity;
      for (let t = 0; t < L2; t++) {
        const yG = sg[t] * G[t];
        if (up(t)) { if (sg[t] === -1) ub = Math.min(ub, yG); else lb = Math.max(lb, yG); }
        else if (low(t)) { if (sg[t] === 1) ub = Math.min(ub, yG); else lb = Math.max(lb, yG); }
        else { nf++; sf += yG; }
      }
      const rho = nf > 0 ? sf / nf : (ub + lb) / 2;
      const sv = [], coef = [];
      for (let k = 0; k < l; k++) { const c = alpha[k] - alpha[k + l]; if (Math.abs(c) > 1e-10) { sv.push(Array.from(Z[k])); coef.push(c); } }
      return { s, ys: ysd, gamma, rho, sv, coef, nSV: sv.length, nTrain: l, iterations: iter, timedOut };
    },
    predict(m, X) {
      return X.map((x) => {
        const z = scaleRow(x, m.s); let f = -m.rho;
        for (let k = 0; k < m.sv.length; k++) { const v = m.sv[k]; let q = 0; for (let j = 0; j < z.length; j++) { const e = z[j] - v[j]; q += e * e; } f += m.coef[k] * Math.exp(-m.gamma * q); }
        return f * m.ys.s + m.ys.m;
      });
    },
  };

  // Gradient boosting (squared error), stochastic subsampling, early stopping on a validation set
  MODELS.gbm = {
    fit(X, y, p, prog, val) {
      const bins = makeBins(X), n = X.length, imp = new Float64Array(bins.d), rng = mulberry32(p.seed || 1);
      const nEst = Math.max(1, Math.round(p.nEst || 300)), lr = p.lr || 0.05, sub = Math.min(1, Math.max(0.2, p.subsample || 0.8));
      const f0 = y.reduce((a, v) => a + v, 0) / n, F = new Float64Array(n).fill(f0), r = new Float64Array(n);
      const trees = [], curve = [];
      const vF = val ? new Float64Array(val.X.length).fill(f0) : null;
      let best = Infinity, bestN = 0, since = 0;
      const patience = p.patience || 40;
      for (let t = 0; t < nEst; t++) {
        for (let i = 0; i < n; i++) r[i] = y[i] - F[i];
        const m = Math.round(sub * n), idx = [];
        if (sub >= 1) for (let i = 0; i < n; i++) idx.push(i);
        else for (let i = 0; i < n; i++) if (rng() < sub) idx.push(i);
        if (idx.length < 2 * (p.minLeaf || 5)) for (let q = 0; q < m; q++) idx.push(Math.floor(rng() * n));
        const T = growTree(bins, r, idx, { maxDepth: p.maxDepth || 4, minLeaf: p.minLeaf || 5, mtry: bins.d }, rng, imp);
        for (let k = 0; k < T.v.length; k++) T.v[k] *= lr;
        trees.push(T);
        let se = 0;
        for (let i = 0; i < n; i++) { F[i] += treeValueBinned(T, bins.B, i); se += (y[i] - F[i]) ** 2; }
        const pt = { i: t + 1, train: Math.sqrt(se / n) };
        if (val) {
          let vs = 0;
          for (let i = 0; i < vF.length; i++) { vF[i] += treeValue(T, val.X[i]); vs += (val.y[i] - vF[i]) ** 2; }
          pt.val = Math.sqrt(vs / vF.length);
          if (pt.val < best - 1e-12) { best = pt.val; bestN = t + 1; since = 0; } else if (++since >= patience && p.earlyStop !== false) { curve.push(pt); break; }
        }
        curve.push(pt);
        if (prog && t % 5 === 0) prog((t + 1) / nEst);
      }
      const keep = val && p.earlyStop !== false && bestN ? bestN : trees.length;
      return { f0, trees: trees.slice(0, keep), imp: normImp(imp), curve, bestIter: keep };
    },
    predict(m, X) { return X.map((x) => { let v = m.f0; for (const T of m.trees) v += treeValue(T, x); return v; }); },
  };

  // Multilayer perceptron, Adam optimiser, early stopping
  MODELS.mlp = {
    fit(X, y, p, prog, val) {
      const rng = mulberry32(p.seed || 1), s = fitScaler(X), Z = X.map((r) => scaleRow(r, s));
      const ys = meanStd(y), Y = y.map((v) => (v - ys.m) / ys.s);
      const VZ = val ? val.X.map((r) => scaleRow(r, s)) : null, VY = val ? val.y.map((v) => (v - ys.m) / ys.s) : null;
      const hidden = String(p.hidden || '32,16').split(/[,\s]+/).map(Number).filter((v) => v > 0).slice(0, 4);
      const sizes = [s.mu.length, ...hidden, 1], L = sizes.length - 1;
      const act = p.activation === 'tanh' ? 'tanh' : 'relu';
      const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      const W = [], b = [], mW = [], vW = [], mb = [], vb = [];
      for (let l = 0; l < L; l++) {
        const fanIn = sizes[l], sc = act === 'relu' ? Math.sqrt(2 / fanIn) : Math.sqrt(1 / fanIn);
        W.push(Float64Array.from({ length: sizes[l] * sizes[l + 1] }, () => gauss() * sc));
        b.push(new Float64Array(sizes[l + 1]));
        mW.push(new Float64Array(W[l].length)); vW.push(new Float64Array(W[l].length));
        mb.push(new Float64Array(sizes[l + 1])); vb.push(new Float64Array(sizes[l + 1]));
      }
      const A = sizes.map((k) => new Float64Array(k)), D = sizes.map((k) => new Float64Array(k));
      const gW = W.map((w) => new Float64Array(w.length)), gb = b.map((v) => new Float64Array(v.length));
      const f = act === 'relu' ? (v) => (v > 0 ? v : 0.01 * v) : Math.tanh;
      const df = act === 'relu' ? (a) => (a > 0 ? 1 : 0.01) : (a) => 1 - a * a;
      function forward(x) {
        A[0].set(x);
        for (let l = 0; l < L; l++) {
          const inp = A[l], out = A[l + 1], w = W[l], bi = b[l], ni = sizes[l], no = sizes[l + 1];
          for (let o = 0; o < no; o++) {
            let z = bi[o]; const off = o * ni;
            for (let i = 0; i < ni; i++) z += w[off + i] * inp[i];
            out[o] = l === L - 1 ? z : f(z);
          }
        }
        return A[L][0];
      }
      const lr0 = p.lr || 0.003, l2 = p.l2 == null ? 1e-4 : p.l2, bs = Math.max(1, Math.round(p.batch || 64));
      const epochs = Math.max(1, Math.round(p.epochs || 200)), patience = p.patience || 25;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;
      const order = Array.from({ length: Z.length }, (_, i) => i);
      let step = 0, best = Infinity, bestW = null, since = 0;
      const curve = [];
      const mse = (ZZ, YY) => { let e = 0; for (let i = 0; i < ZZ.length; i++) e += (forward(ZZ[i]) - YY[i]) ** 2; return e / ZZ.length; };
      for (let ep = 0; ep < epochs; ep++) {
        for (let q = order.length - 1; q > 0; q--) { const r = Math.floor(rng() * (q + 1)); const t = order[q]; order[q] = order[r]; order[r] = t; }
        let tl = 0;
        for (let st = 0; st < order.length; st += bs) {
          const end = Math.min(order.length, st + bs), m = end - st;
          for (const g of gW) g.fill(0); for (const g of gb) g.fill(0);
          for (let q = st; q < end; q++) {
            const i = order[q], out = forward(Z[i]), e = out - Y[i];
            tl += e * e;
            D[L][0] = e;
            for (let l = L - 1; l >= 0; l--) {
              const ni = sizes[l], no = sizes[l + 1], w = W[l], inp = A[l], dOut = D[l + 1], gw = gW[l], gbl = gb[l];
              for (let o = 0; o < no; o++) { const dv = dOut[o]; gbl[o] += dv; const off = o * ni; for (let i2 = 0; i2 < ni; i2++) gw[off + i2] += dv * inp[i2]; }
              if (l > 0) {
                const dIn = D[l];
                for (let i2 = 0; i2 < ni; i2++) { let sacc = 0; for (let o = 0; o < no; o++) sacc += w[o * ni + i2] * dOut[o]; dIn[i2] = sacc * df(inp[i2]); }
              }
            }
          }
          step++;
          const c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
          for (let l = 0; l < L; l++) {
            const w = W[l], gw = gW[l], mw = mW[l], vw = vW[l];
            for (let k = 0; k < w.length; k++) {
              const g = gw[k] / m + l2 * w[k];
              mw[k] = b1 * mw[k] + (1 - b1) * g; vw[k] = b2 * vw[k] + (1 - b2) * g * g;
              w[k] -= (lr0 * (mw[k] / c1)) / (Math.sqrt(vw[k] / c2) + eps);
            }
            const bb = b[l], gbb = gb[l], mbb = mb[l], vbb = vb[l];
            for (let k = 0; k < bb.length; k++) {
              const g = gbb[k] / m;
              mbb[k] = b1 * mbb[k] + (1 - b1) * g; vbb[k] = b2 * vbb[k] + (1 - b2) * g * g;
              bb[k] -= (lr0 * (mbb[k] / c1)) / (Math.sqrt(vbb[k] / c2) + eps);
            }
          }
        }
        const pt = { i: ep + 1, train: Math.sqrt(tl / Z.length) * ys.s };
        if (VZ && VZ.length) {
          pt.val = Math.sqrt(mse(VZ, VY)) * ys.s;
          if (pt.val < best - 1e-12) { best = pt.val; since = 0; bestW = { W: W.map((w) => Float64Array.from(w)), b: b.map((v) => Float64Array.from(v)), ep: ep + 1 }; }
          else if (++since >= patience && p.earlyStop !== false) { curve.push(pt); break; }
        }
        curve.push(pt);
        if (prog) prog((ep + 1) / epochs);
      }
      const fw = bestW && p.earlyStop !== false ? bestW : { W, b, ep: curve.length };
      return { s, ys, sizes, act, W: fw.W, b: fw.b, curve, bestIter: fw.ep };
    },
    predict(m, X) {
      const L = m.sizes.length - 1, f = m.act === 'relu' ? (v) => (v > 0 ? v : 0.01 * v) : Math.tanh;
      const A = m.sizes.map((k) => new Float64Array(k));
      return X.map((x) => {
        A[0].set(scaleRow(x, m.s));
        for (let l = 0; l < L; l++) {
          const inp = A[l], out = A[l + 1], w = m.W[l], bi = m.b[l], ni = m.sizes[l], no = m.sizes[l + 1];
          for (let o = 0; o < no; o++) { let z = bi[o]; const off = o * ni; for (let i = 0; i < ni; i++) z += w[off + i] * inp[i]; out[o] = l === L - 1 ? z : f(z); }
        }
        return A[L][0] * m.ys.s + m.ys.m;
      });
    },
  };
  HML.MODELS = MODELS;

  // ---------------------------------------------------------------- explanations
  HML.permutation = function (type, model, X, y, seed) {
    const rng = mulberry32(seed || 7), M = MODELS[type];
    const base = HML.metrics(y, M.predict(model, X)).nse, d = X[0].length, out = [];
    for (let j = 0; j < d; j++) {
      const col = X.map((r) => r[j]);
      for (let q = col.length - 1; q > 0; q--) { const r = Math.floor(rng() * (q + 1)); const t = col[q]; col[q] = col[r]; col[r] = t; }
      const Xp = X.map((r, i) => { const c = Array.from(r); c[j] = col[i]; return c; });
      out.push(Math.max(0, base - HML.metrics(y, M.predict(model, Xp)).nse));
    }
    return out;
  };
  HML.pdp = function (type, model, X, j, points) {
    const vals = X.map((r) => r[j]).sort((a, b) => a - b), grid = [];
    const P = points || 20;
    for (let k = 0; k < P; k++) { const v = vals[Math.min(vals.length - 1, Math.round((k / (P - 1)) * (vals.length - 1)))]; if (!grid.length || v > grid[grid.length - 1]) grid.push(v); }
    const M = MODELS[type];
    const pd = grid.map((v) => { const Xp = X.map((r) => { const c = Array.from(r); c[j] = v; return c; }); const pr = M.predict(model, Xp); return pr.reduce((a, b) => a + b, 0) / pr.length; });
    return { grid, pd };
  };

  // ---------------------------------------------------------------- cross-validation
  // 'timeseries': expanding window — fold f trains on everything before block f+1 and tests on it (no future leakage).
  // 'blocked': k contiguous blocks; each block is the test set once, the rest train (classic k-fold without shuffling).
  HML.cvSplits = function (n, k, kind) {
    const out = [];
    if (kind === 'blocked') {
      for (let f = 0; f < k; f++) {
        const a = Math.floor((f * n) / k), b = Math.floor(((f + 1) * n) / k), tr = [];
        for (let i = 0; i < n; i++) if (i < a || i >= b) tr.push(i);
        const te = []; for (let i = a; i < b; i++) te.push(i);
        out.push({ tr, te });
      }
    } else {
      const size = Math.floor(n / (k + 1));
      for (let f = 1; f <= k; f++) {
        const tr = [], te = [];
        for (let i = 0; i < size * f; i++) tr.push(i);
        for (let i = size * f; i < (f === k ? n : size * (f + 1)); i++) te.push(i);
        out.push({ tr, te });
      }
    }
    return out;
  };
  const higherBetter = (metric) => metric !== 'rmse' && metric !== 'mae';
  // Mean score over folds for one parameter set
  HML.cvScore = function (type, X, y, params, opt, onFold) {
    const M = MODELS[type], splits = HML.cvSplits(X.length, opt.folds || 5, opt.cvType || 'timeseries'), folds = [];
    splits.forEach((s, fi) => {
      let trI = s.tr;
      let val = null;
      if (type === 'gbm' || type === 'mlp') {
        const vN = Math.floor(trI.length * 0.15);
        if (vN > 5) { const vI = trI.slice(-vN); trI = trI.slice(0, -vN); val = { X: vI.map((i) => X[i]), y: vI.map((i) => y[i]) }; }
      }
      const m = M.fit(trI.map((i) => X[i]), trI.map((i) => y[i]), Object.assign({ seed: opt.seed }, params), null, val);
      const yt = s.te.map((i) => y[i]);
      folds.push(Object.assign({ fold: fi + 1, nTrain: s.tr.length, nTest: s.te.length }, HML.metrics(yt, M.predict(m, s.te.map((i) => X[i])))));
      if (onFold) onFold(fi + 1, splits.length);
    });
    const metric = opt.metric || 'nse';
    const vals = folds.map((f) => f[metric]).filter(isFinite);
    const mean = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1));
    return { folds, mean, sd };
  };

  // ---------------------------------------------------------------- hyper-parameter search
  // space: [{ name, kind: 'int'|'float'|'choice', min, max, log, values }]
  function encode(space, p) {
    return space.map((s) => {
      if (s.kind === 'choice') return s.values.length > 1 ? s.values.indexOf(p[s.name]) / (s.values.length - 1) : 0.5;
      const lo = s.log ? Math.log(s.min) : s.min, hi = s.log ? Math.log(s.max) : s.max, v = s.log ? Math.log(p[s.name]) : p[s.name];
      return hi > lo ? (v - lo) / (hi - lo) : 0.5;
    });
  }
  function decode(space, u) {
    const p = {};
    space.forEach((s, i) => {
      const t = Math.min(1, Math.max(0, u[i]));
      if (s.kind === 'choice') { p[s.name] = s.values[Math.min(s.values.length - 1, Math.round(t * (s.values.length - 1)))]; return; }
      const lo = s.log ? Math.log(s.min) : s.min, hi = s.log ? Math.log(s.max) : s.max;
      let v = lo + t * (hi - lo); if (s.log) v = Math.exp(v);
      p[s.name] = s.kind === 'int' ? Math.round(v) : +v.toPrecision(4);
    });
    return p;
  }
  function gridOf(space, cap) {
    let combos = [{}];
    for (const s of space) {
      const vals = s.values && s.values.length ? s.values : [s.min, s.max];
      const next = [];
      for (const c of combos) for (const v of vals) { next.push(Object.assign({}, c, { [s.name]: v })); if (next.length > cap) break; }
      combos = next.slice(0, cap);
    }
    return combos;
  }
  // Gaussian-process surrogate (RBF kernel) + Expected Improvement, for Bayesian optimisation
  function gpFit(Xs, ys) {
    const n = Xs.length, ls = 0.25, noise = 1e-4;
    const ym = ys.reduce((a, v) => a + v, 0) / n, ysd = Math.sqrt(ys.reduce((a, v) => a + (v - ym) ** 2, 0) / Math.max(1, n - 1)) || 1;
    const Y = ys.map((v) => (v - ym) / ysd);
    const k = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2; return Math.exp(-d / (2 * ls * ls)); };
    const K = Xs.map((a, i) => Xs.map((b, j) => k(a, b) + (i === j ? noise : 0)));
    // Cholesky
    const Lm = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = K[i][j]; for (let t = 0; t < j; t++) s -= Lm[i][t] * Lm[j][t];
      Lm[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / Lm[j][j];
    }
    const fwd = (b) => { const z = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let t = 0; t < i; t++) s -= Lm[i][t] * z[t]; z[i] = s / Lm[i][i]; } return z; };
    const bwd = (z) => { const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let t = i + 1; t < n; t++) s -= Lm[t][i] * x[t]; x[i] = s / Lm[i][i]; } return x; };
    const alpha = bwd(fwd(Y));
    return (x) => {
      const ks = Xs.map((a) => k(x, a));
      let mu = 0; for (let i = 0; i < n; i++) mu += ks[i] * alpha[i];
      const v = fwd(ks); let vv = 0; for (let i = 0; i < n; i++) vv += v[i] * v[i];
      return { mu: mu * ysd + ym, sd: Math.sqrt(Math.max(1e-12, 1 + noise - vv)) * ysd };
    };
  }
  const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  HML.tune = function (msg, post) {
    const { type, X, y, space } = msg, opt = { folds: msg.folds || 3, cvType: msg.cvType || 'timeseries', metric: msg.metric || 'nse', seed: msg.seed || 1 };
    const sign = higherBetter(opt.metric) ? 1 : -1, rng = mulberry32(opt.seed + 101);
    const trials = [];
    const total = msg.method === 'grid' ? null : Math.max(2, msg.nIter || 20);
    const run = (params, how) => {
      const full = Object.assign({}, msg.base || {}, params);
      const r = HML.cvScore(type, X, y, full, opt);
      const t = { i: trials.length + 1, params, mean: r.mean, sd: r.sd, how };
      trials.push(t);
      const best = trials.reduce((b, c) => (sign * c.mean > sign * b.mean ? c : b), trials[0]);
      post({ id: msg.id, cmd: 'trial', trial: t, best, done: trials.length, total: total || msg.gridSize });
      return t;
    };
    if (msg.method === 'grid') {
      const combos = gridOf(space, msg.maxGrid || 300);
      msg.gridSize = combos.length;
      for (const c of combos) run(c, 'grid');
    } else if (msg.method === 'random') {
      for (let i = 0; i < total; i++) run(decode(space, space.map(() => rng())), 'random');
    } else {
      // Bayesian: a few random starts, then maximise Expected Improvement over random candidates
      const init = Math.min(total, Math.max(4, Math.ceil(total * 0.3)));
      for (let i = 0; i < init; i++) run(decode(space, space.map(() => rng())), 'random start');
      while (trials.length < total) {
        const Xs = trials.map((t) => encode(space, t.params)), ys = trials.map((t) => sign * t.mean);
        const gp = gpFit(Xs, ys), bestY = Math.max(...ys);
        let bestU = null, bestEI = -1;
        for (let c = 0; c < 600; c++) {
          const u = space.map(() => rng()), { mu, sd } = gp(u), z = (mu - bestY - 0.01) / sd;
          const ei = (mu - bestY - 0.01) * normCdf(z) + sd * normPdf(z);
          if (ei > bestEI) { bestEI = ei; bestU = u; }
        }
        const cand = decode(space, bestU);
        const key = JSON.stringify(cand);
        run(trials.some((t) => JSON.stringify(t.params) === key) ? decode(space, space.map(() => rng())) : cand, 'bayes');
      }
    }
    const best = trials.reduce((b, c) => (sign * c.mean > sign * b.mean ? c : b), trials[0]);
    post({ id: msg.id, cmd: 'tuned', trials, best, metric: opt.metric });
  };

  // ---------------------------------------------------------------- message handler (worker or page)
  const store = new Map();
  function sample(X, y, max, seed) {
    if (X.length <= max) return { X, y };
    const rng = mulberry32(seed || 3), idx = Array.from({ length: X.length }, (_, i) => i);
    for (let q = idx.length - 1; q > 0; q--) { const r = Math.floor(rng() * (q + 1)); const t = idx[q]; idx[q] = idx[r]; idx[r] = t; }
    const pick = idx.slice(0, max).sort((a, b) => a - b);
    return { X: pick.map((i) => X[i]), y: y ? pick.map((i) => y[i]) : null };
  }
  HML.handle = function (msg, post) {
    const { cmd, id } = msg;
    const key = msg.model || id;
    try {
      if (cmd === 'ping') { post({ id, cmd: 'pong' }); return; }
      if (cmd === 'train') {
        const M = MODELS[msg.type];
        if (!M) throw new Error('Unknown model ' + msg.type);
        const t0 = now();
        const prog = (f) => post({ id, cmd: 'progress', f });
        const usesVal = (msg.type === 'gbm' || msg.type === 'mlp') && msg.val && msg.val.X.length > 5;
        const fitX = usesVal ? msg.X.slice(0, msg.X.length - msg.val.X.length) : msg.X;
        const fitY = usesVal ? msg.y.slice(0, msg.y.length - msg.val.y.length) : msg.y;
        const params = Object.assign({ seed: msg.seed }, msg.params);
        const model = M.fit(fitX, fitY, params, prog, usesVal ? msg.val : null);
        const fitMs = now() - t0;
        const pred = M.predict(model, msg.Xall, (f) => post({ id, cmd: 'progress', f, phase: 'predict' }));
        store.set(key, { type: msg.type, model });
        const info = {};
        for (const k of ['nSV', 'nTrain', 'iterations', 'timedOut', 'nonzero']) if (model[k] != null) info[k] = model[k];
        post({ id, cmd: 'trained', pred, imp: model.imp || null, curve: model.curve || null, bestIter: model.bestIter || null, oob: model.oob || null, info, ms: now() - t0, fitMs });
      } else if (cmd === 'export') {
        const s = store.get(key); if (!s) throw new Error('Model not found — train it again');
        // typed arrays → plain arrays so the model survives JSON
        // 9 significant digits keeps predictions identical to ~1e-8 while making files much smaller
        const r9 = (v) => (typeof v === 'number' && isFinite(v) && !Number.isInteger(v) ? +v.toPrecision(9) : v);
        post({ id, cmd: 'exported', type: s.type, model: JSON.parse(JSON.stringify(s.model, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v, r9) : r9(v)))) });
      } else if (cmd === 'import') {
        if (!MODELS[msg.type]) throw new Error('Unknown model type ' + msg.type);
        store.set(key, { type: msg.type, model: msg.data });
        post({ id, cmd: 'imported' });
      } else if (cmd === 'predict') {
        const s = store.get(key); if (!s) throw new Error('Model not found — train it again');
        post({ id, cmd: 'predicted', pred: MODELS[s.type].predict(s.model, msg.X), tag: msg.tag });
      } else if (cmd === 'perm') {
        const s = store.get(key); if (!s) throw new Error('Model not found — train it again');
        const sm = sample(msg.X, msg.y, msg.max || 1500, msg.seed);
        post({ id, cmd: 'perm', imp: HML.permutation(s.type, s.model, sm.X, sm.y, msg.seed) });
      } else if (cmd === 'pdp') {
        const s = store.get(key); if (!s) throw new Error('Model not found — train it again');
        const sm = sample(msg.X, null, msg.max || 400, msg.seed);
        post({ id, cmd: 'pdp', res: HML.pdp(s.type, s.model, sm.X, msg.j, 24), j: msg.j });
      } else if (cmd === 'cv') {
        const r = HML.cvScore(msg.type, msg.X, msg.y, msg.params, { folds: msg.folds || 5, cvType: msg.cvType, metric: 'nse', seed: msg.seed },
          (f, k) => post({ id, cmd: 'progress', f: f / k }));
        post({ id, cmd: 'cv', folds: r.folds });
      } else if (cmd === 'tune') {
        HML.tune(msg, post);
      } else if (cmd === 'clear') {
        store.clear();
      }
    } catch (e) {
      post({ id, cmd: 'error', message: e && e.message ? e.message : String(e) });
    }
  };

  root.HML = HML;
})(typeof self !== 'undefined' ? self : this);
