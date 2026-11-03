// nonstationary.js - GEV with time-varying parameters, fitted by maximum likelihood
// (Coles 2001, ch. 6):
//   location  xi(t)    = b0 + b1 * c(t)              (model 'loc')
//   + scale   alpha(t) = exp(a0 + a1 * c(t))         (model 'locscale')
// c(t) is a user covariate (default: year, centred to improve conditioning).
// Shape is kept constant (shape trends are rarely identifiable from typical records).
// Model choice: likelihood-ratio test vs the stationary GEV (chi-square, df = extra params) and AIC.
// "Effective" return levels are conditional on a chosen covariate value.

import { GEV } from './distributions.js';
import { nelderMead, numHessian, invertMatrix } from './optim.js';
import { fitDistribution } from './fit.js';
import { gammaQ } from './special.js';
import { mean } from './stats.js';

function params(model, v, c) {
  const xi = v[0] + v[1] * c;
  const a = model === 'locscale' ? Math.exp(v[2] + v[3] * c) : Math.exp(v[2]);
  return [xi, a, v[model === 'locscale' ? 4 : 3]];
}

export function fitNonstationaryGEV(x, covariate, { model = 'loc', kRange = [-0.5, 0.5] } = {}) {
  const n = x.length;
  const cm = mean(covariate), c = covariate.map((v) => v - cm);
  const stat = fitDistribution('GEV', x, 'mle', { kRange });
  if (!stat.ok) return { ok: false, reason: 'Stationary GEV ML fit failed: ' + stat.reason };
  const nll = (v) => {
    const k = v[v.length - 1];
    if (k <= kRange[0] || k >= kRange[1]) return Infinity;
    let s = 0;
    for (let i = 0; i < n; i++) { const l = GEV.logpdf(x[i], params(model, v, c[i])); if (!(l > -Infinity)) return Infinity; s -= l; }
    return s;
  };
  const [xi0, a0, k0] = stat.params;
  const v0 = model === 'locscale' ? [xi0, 0, Math.log(a0), 0, k0] : [xi0, 0, Math.log(a0), k0];
  // second start: OLS slope of x on c
  let sxy = 0, sxx = 0; const mx = mean(x);
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * c[i]; sxx += c[i] * c[i]; }
  const v1 = v0.slice(); v1[1] = sxx > 0 ? sxy / sxx : 0;
  let best = null;
  for (const st of [v0, v1]) {
    if (!isFinite(nll(st))) continue;
    const r = nelderMead(nll, st, { restarts: 6 });
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best) return { ok: false, reason: 'No feasible starting point for the non-stationary model.' };
  const H = numHessian(nll, best.x), V = invertMatrix(H);
  const se = V ? V.map((r, i) => Math.sqrt(Math.max(r[i], 0))) : null;
  const ll = -best.fx, df = model === 'locscale' ? 2 : 1;
  const D = 2 * (ll - stat.loglik);
  const pLR = gammaQ(df / 2, Math.max(D, 0) / 2);
  const kpar = 3 + df;
  const names = model === 'locscale' ? ['b0 (location at mean covariate)', 'b1 (location trend)', 'a0 (log-scale)', 'a1 (log-scale trend)', 'k (shape)'] : ['b0 (location at mean covariate)', 'b1 (location trend)', 'ln alpha', 'k (shape)'];
  return {
    ok: true, model, coef: best.x, se, names, covariateMean: cm, loglik: ll,
    aic: 2 * kpar - 2 * ll, bic: kpar * Math.log(n) - 2 * ll,
    stationary: { params: stat.params, loglik: stat.loglik, aic: stat.aic, bic: stat.bic },
    lrTest: { D, df, p: pLR },
    converged: best.converged,
    paramsAt: (cov) => params(model, best.x, cov - cm),
    quantileAt: (F, cov) => GEV.quantile(F, params(model, best.x, cov - cm)),
  };
}

/** Residuals transformed to standard Gumbel (for Q-Q diagnostics of the non-stationary fit). */
export function gumbelResiduals(fit, x, covariate) {
  return x.map((v, i) => {
    const [xi, a, k] = fit.paramsAt(covariate[i]);
    return Math.abs(k) < 1e-8 ? (v - xi) / a : -Math.log(1 - k * (v - xi) / a) / k;
  });
}
