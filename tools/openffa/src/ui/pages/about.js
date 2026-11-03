// pages/about.js - Methods and references: what every option computes, with equations, the evidence
// behind the numbers (validation), the known limitations and the sources. The distribution and method
// tables are read from the code, so this page cannot drift from what the tool fits.
import { h } from '../dom.js';
import { SOFTWARE } from '../../core/analysis.js';
import { DISTRIBUTIONS, DIST_ORDER } from '../../core/distributions.js';
import { AVAILABLE_METHODS, METHOD_LABELS } from '../../core/fit.js';
import { CI_METHODS } from '../../core/uncertainty.js';
import { REFERENCES } from '../../io/export.js';

const eq = (...lines) => h('pre', { class: 'eq' }, lines.join('\n'));
const p = (...c) => h('p', {}, ...c);
const b = (t) => h('b', {}, t);
const sec = (id, title, ...c) => h('div', { class: 'sheet methods', id: `m-${id}` }, h('h3', {}, title), ...c);

export function render(host) {
  const toc = [
    ['workflow', 'Workflow'], ['data', 'Data, water year and annual maxima'], ['checks', 'Checks before fitting'],
    ['dist', 'Distributions'], ['est', 'Estimation methods'], ['cens', 'Low outliers, zeros and historic floods'],
    ['gof', 'Comparing fits'], ['ci', 'Design floods and confidence intervals'], ['pot', 'Peaks over threshold'],
    ['ns', 'Non-stationary GEV'], ['valid', 'Validation'], ['limits', 'Limitations'], ['refs', 'References'], ['cite', 'Citing'],
  ];
  host.append(h('h2', { id: 'h-about' }, 'Methods and references'),
    h('p', { class: 'lede' }, `${SOFTWARE.name} ${SOFTWARE.version} runs entirely in your browser; no data are uploaded. This page gives the equations behind every option, how the numbers were checked, and the limits of the methods. The ? buttons next to each option give the short version.`),
    h('nav', { class: 'toc', 'aria-label': 'On this page' }, h('ol', {}, toc.map(([id, t]) => h('li', {}, h('a', { href: `#m-${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t))))));

  host.append(sec('workflow', 'Workflow',
    p('Record → checks (trend, change point, independence, homogeneity, outliers) → fits of several distribution × method pairs → comparison (goodness of fit, information criteria, plots) → design floods with confidence intervals → report. Peaks over threshold and the non-stationary GEV are optional further analyses.'),
    p('All probabilities are non-exceedance probabilities F. The return period of an annual maximum is T = 1/(1 − F) and its annual exceedance probability AEP = 1/T.')));

  host.append(sec('data', 'Data, water year and annual maxima',
    p('A daily or sub-daily series is reduced to one maximum per water year. The water year starts in the month you choose (default April, so the Bangladesh monsoon stays in one year; USGS uses October). A year is used only if its share of days with data reaches the completeness you set; an incomplete year with an unusually large maximum is flagged rather than silently dropped, because gauges often fail during big floods.'),
    p('Units are labels only; nothing is converted. Water levels can be analysed, but log-based distributions (LN2, LP3) assume a natural zero, so for stages prefer GEV, Gumbel or Pearson III, or subtract a datum.')));

  host.append(sec('checks', 'Checks before fitting',
    p('Stationary frequency analysis assumes every year comes from the same distribution, independently. The checks look for evidence against that:'),
    eq('Mann–Kendall   S = Σ_{i<j} sgn(x_j − x_i),  Z = (S − sgn S)/√Var(S)  (ties corrected)',
      '               Hamed & Rao (1998): Var(S) inflated by n/n* from the autocorrelation of the ranks',
      '               of the detrended series; falls back to the plain test if the correction is negative',
      'Theil–Sen      slope = median_{i<j} (x_j − x_i)/(t_j − t_i)',
      'Pettitt        K = max_t |U_t|,  U_t = Σ_{i≤t} Σ_{j>t} sgn(x_j − x_i),  p ≈ 2 exp(−6K²/(n³ + n²))',
      'Lag-1          r1 with Anderson (1942) limits (−1 ± z√(n − 2))/(n − 1)',
      'Wald–Wolfowitz R = Σ y_i y_{i+1} (circular, y = x − mean), normal approximation',
      'Mann–Whitney   two halves of the record, rank-sum test of equal location',
      'Grubbs–Beck    (Bulletin 17B) log10 values outside mean ± K_N·sd, K_N = −0.9043 + 3.345√log N − 0.4046 log N',
      'Multiple G–B   (Bulletin 17C, Cohn et al. 2013) sweeps the k smallest values with exact p-values; α_out = 0.005'),
    p('The screen turns the results into a plain-language verdict. Low power is the rule: with 30–60 years a real trend of modest size is often not significant, so a “no trend” result is not proof of stationarity.')));

  host.append(sec('dist', 'Distributions',
    p('GEV, GLO and GPA use Hosking’s shape k (k < 0 heavy upper tail, k > 0 bounded; many R packages use ξ = −k). LP3 is fitted to log10 flows, LN2 to natural logs.'),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'l' }, 'Distribution'), h('th', { class: 'l' }, 'Parameters'), h('th', { class: 'l' }, 'Methods'))),
      h('tbody', {}, DIST_ORDER.map((d) => h('tr', {}, h('td', { class: 'l' }, DISTRIBUTIONS[d].name), h('td', { class: 'l' }, DISTRIBUTIONS[d].paramNames.join(', ')),
        h('td', { class: 'l' }, [...AVAILABLE_METHODS[d].map((m) => METHOD_LABELS[m]), ...(d === 'LP3' ? ['EMA (Bulletin 17C)'] : [])].join('; '))))))),
    eq('Gumbel   x(F) = ξ − α ln(−ln F)',
      'GEV      x(F) = ξ + (α/k)[1 − (−ln F)^k]',
      'GLO      x(F) = ξ + (α/k)[1 − ((1 − F)/F)^k]',
      'GPA      x(F) = ξ + (α/k)[1 − (1 − F)^k]',
      'P3       x(F) = μ + σ K(F; γ)          LP3: log10 x(F) = μ + σ K(F; γ)',
      'LN2/LN3  x(F) = ζ + exp(μ + σ z),  z = Φ⁻¹(F)   (LN2: ζ = 0)',
      'Weibull  x(F) = λ (−ln(1 − F))^(1/κ)')));

  host.append(sec('est', 'Estimation methods',
    p(b('L-moments'), ' (Hosking 1990): λ1 = b0, λ2 = 2b1 − b0, λ3 = 6b2 − 6b1 + b0 from unbiased probability-weighted moments; parameters match λ1, λ2 and τ3 = λ3/λ2. Robust and nearly unbiased in small samples; the default for at-site work (Hosking & Wallis 1997).'),
    p(b('Maximum likelihood'), ': Nelder–Mead with restarts on the negative log-likelihood; the GEV/GLO/GPA shape is kept within −1 < k < 1 (a fit on the bound is flagged) and the Pearson III skew to |γ| ≤ 2 (beyond that the likelihood is unbounded). Uses censored and historic information directly (interval likelihood).'),
    p(b('Method of moments'), ': mean, standard deviation and bias-adjusted skew; for LP3 this is the Bulletin 17B procedure on log10 flows, with optional regional-skew weighting.'),
    p(b('Probability-weighted moments (plotting-position)'), ': L-moments from plotting-position estimators of b_r (a = 0.35), as in older practice.'),
    p(b('Expected Moments Algorithm'), ' (Cohn et al. 1997; Bulletin 17C): LP3 moments estimated iteratively from exact flows and flow intervals (censored low floods, historic years below a perception threshold), with B17C bias corrections and regional skew weighting through the equivalent record length (eq. 7-10).'),
    eq('Weighted skew  G_w = (MSE_R·G + MSE_G·G_R)/(MSE_R + MSE_G)'),
    p(b('Gumbel’s method'), ' (Gumbel 1958; Chow et al. 1988): the textbook frequency-factor calculation for the Gumbel distribution, used widely in South Asian practice. ȳ_n and σ_n are the mean and standard deviation of the reduced variates of the Weibull plotting positions; OpenFFA computes them exactly for any n instead of reading a table (n = 10: 0.4952 and 0.9496, as printed). It is a Gumbel fit with α = s/σ_n and ξ = x̄ − α ȳ_n, less efficient than L-moments; it is offered so results can be matched with reports.'),
    eq('x_T = x̄ + K s,   K = (y_T − ȳ_n)/σ_n,   y_T = −ln(−ln(1 − 1/T))',
      'y_i = −ln(−ln(i/(n + 1))),   ȳ_n = mean(y_i),   σ_n = √(Σ(y_i − ȳ_n)²/n)')));

  host.append(sec('cens', 'Low outliers, zeros and historic floods',
    p(b('Potentially influential low floods'), ' found by the Multiple Grubbs–Beck test (or a threshold you set) are not deleted: they are treated as “less than the threshold”. Only ML (interval likelihood) and EMA fits use this; other methods use the zero-flow adjustment.'),
    p(b('Zero flows'), ': with the conditional-probability adjustment the positive values are fitted and combined with the share p0 of zero years:'),
    eq('F_total(x) = p0 + (1 − p0) F_positive(x)   →   x_T from F_positive = (F − p0)/(1 − p0)'),
    p(b('Historic information'), ': a historic period of h years with perception threshold X_h; floods above X_h are entered as exact values, the other years as “< X_h”. Plotting positions follow Bulletin 17C threshold-exceedance rules (one threshold).')));

  host.append(sec('gof', 'Comparing fits',
    eq('KS  D = max_i max(i/n − F_i, F_i − (i − 1)/n)',
      'AD  A² = −n − (1/n) Σ (2i − 1)[ln F_i + ln(1 − F_{n+1−i})]',
      'CvM W² = 1/(12n) + Σ (F_i − (2i − 1)/(2n))²',
      'PPCC = corr(x_(i), x(p_i)),   p_i = (i − a)/(n + 1 − 2a)',
      'AIC = −2 ln L + 2k,  AICc = AIC + 2k(k + 1)/(n − k − 1),  BIC = −2 ln L + k ln n'),
    p('Because the parameters come from the same data, the classical KS/AD tables are wrong (Lilliefors 1967). OpenFFA computes p-values by parametric bootstrap with re-fitting by the same method. Plotting positions: Weibull a = 0 (default), Gringorten 0.44, Cunnane 0.40, Hazen 0.5, Blom 0.375; they affect only the plotted points and PPCC. Information criteria are exact comparisons only between ML fits; censored fits are not ranked against uncensored ones.')));

  host.append(sec('ci', 'Design floods and confidence intervals',
    h('ul', {}, Object.entries(CI_METHODS).map(([k, v]) => h('li', {}, v))),
    p(b('Bootstraps'), ' simulate records of the same length from the fitted model (parametric) or resample the data (non-parametric), refit by the same method, and turn the replicate quantiles into limits. For censored and EMA fits the parametric bootstrap re-simulates the same censoring and historic design.'),
    p(b('Bootstrap limits'), ': percentile, bias-corrected (BC) or bias-corrected and accelerated (BCa, Efron 1987):'),
    eq('z0 = Φ⁻¹(share of replicates below the estimate)',
      'a  = Σ d³ / (6 (Σ d²)^1.5),  d = mean of jackknife estimates − jackknife estimate   (BCa only)',
      'limits at the replicate quantiles Φ(z0 + (z0 ± z)/(1 − a(z0 ± z)))'),
    p('Evidence from OpenFFA’s simulations (n = 30, 90 % nominal, 100-year flood): the parametric percentile bootstrap covered the truth 86–87 % of the time and BC did not change that; the non-parametric percentile bootstrap covered 74–79 %, and BCa 77–85 %. So: prefer the parametric bootstrap, and use BCa if you choose the non-parametric one. On the Bulletin 17C examples BC moved the EMA intervals closer to PeakFQ for Santa Cruz River but further for Orestimba Creek, so percentile limits remain the default.'),
    p(b('Delta method'), ': var(x_T) ≈ ∇x_Tᵀ H⁻¹ ∇x_T with the observed information H (ML only). For LN2 and LP3, which are fitted on logarithms, the interval is formed for log x_T and transformed back, so it is asymmetric and always positive. ', b('Profile likelihood'), ': the set of x_T with 2[ℓ(θ̂) − ℓ_p(x_T)] ≤ χ²₁(level); asymmetric and usually best for long return periods (Coles 2001, sec. 3.3.3).')));

  host.append(sec('pot', 'Peaks over threshold',
    p('Daily values above the threshold form events; two peaks are separate floods only if they are at least the minimum number of days apart and the flow between them drops below the chosen fraction of the smaller peak. A GPA with location fixed at the threshold u is fitted to the peaks. The event rate λ is peaks per ', b('observed'), ' year: the number of values × the usual time step, so gaps in the record are not counted as flood-free time.'),
    eq('G(y) = 1 − (1 − k y/α)^(1/k),   y = x − u',
      'annual-maximum T (default):  G(x_T) = 1 + ln(1 − 1/T)/λ        (Poisson arrivals; Stedinger et al. 1993)',
      'average interval T:          G(x_T) = 1 − 1/(λT)',
      'conversion:  T_AM = 1/(1 − exp(−1/T_PD))   (Langbein 1949)'),
    p('Threshold aids: mean residual life (mean excess against u, linear above a valid threshold) and parameter stability (shape k and modified scale α + k·u constant above a valid threshold). Confidence intervals: parametric bootstrap in which the number of events is drawn from Poisson(λ × years), so the uncertainty of λ is included; holding λ fixed understates the width at short return periods.')));

  host.append(sec('ns', 'Non-stationary GEV',
    eq('ξ(t) = ξ0 + ξ1·c(t),   ln α(t) = a0 + a1·c(t) (optional),   k constant',
      'Likelihood-ratio test:  D = 2[ℓ(non-stationary) − ℓ(stationary)] ~ χ²(number of extra parameters)'),
    p('The covariate c is centred. Return levels become “effective” return levels for a given covariate value and must be read with care; residuals are transformed to the standard Gumbel scale for checking (Coles 2001, ch. 6).')));

  host.append(sec('valid', 'Validation',
    p('Every estimator is tested automatically against independent software and published results: R packages lmom, extRemes, ismev, MGBT (USGS) and trend; SciPy, lmoments3, pymannkendall and pyhomogeneity; and the worked examples of Bulletin 17C (Moose River, Orestimba Creek, Santa Cruz River), whose EMA moments are reproduced to the printed 4 decimals and quantiles to 4 significant figures; and Coles (2001) for the GEV (Port Pirie) and the non-stationary GEV (Fremantle). The full table is in docs/VALIDATION.md; discrepancies found in the references and how they were resolved are in docs/VALIDATION_NOTES.md. Run ', h('code', {}, 'npm test'), ' in the source folder to repeat them.')));

  host.append(sec('limits', 'Limitations',
    h('ul', {}, [
      'Not implemented: Kappa and Wakeby distributions, LH-moments, regional frequency analysis, Bayesian estimation, mixed-population models.',
      'EMA confidence intervals are a parametric bootstrap of the censoring design, not the analytical Bulletin 17C interval (Cohn et al. 2001); on the B17C examples they are similar in width but sit lower, especially at the upper limit. The station-skew MSE uses the Bulletin 17B formula.',
      'Historic information: one perception threshold only; no interval or binomial data.',
      'Goodness-of-fit tests have low power for short records; passing them does not show a distribution is correct.',
      'Confidence intervals exclude model choice, rating-curve and measurement errors, and non-stationarity.',
      'The MGBT decision can flip near its cut-off (B17C Example 2: 38 PILFs here and in the USGS R package, 30 in PeakFQ 7.1); use judgement and the manual threshold.',
      'The non-stationary GEV allows linear changes in location and log-scale only, with a constant shape.',
      'No Bangladeshi dataset is bundled; the monsoon sample is synthetic.',
    ].map((t) => h('li', {}, t)))));

  host.append(sec('refs', 'References', h('ol', { class: 'refs' }, Object.values(REFERENCES).sort().map((r) => h('li', {}, r)))));
  host.append(sec('cite', 'Citing',
    h('p', { class: 'eq-text' }, `Joy, M. R. (2026). ${SOFTWARE.name}: browser-based flood frequency analysis (version ${SOFTWARE.version}) [software]. https://meawman.github.io/tools/openffa/`),
    p('Cite the methods named in the report as well (for example Hosking 1990; England et al. 2018).')));
}
