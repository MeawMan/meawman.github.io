/**
 * methods.js — the “Methods and references” screen: what every option computes, with equations and sources.
 * Equation forms for the IDF models and the distribution list are read from the code (FORMS, KMODELS,
 * DISTRIBUTIONS), so this page cannot drift from what the tool actually fits.
 */
import { h } from './dom.js';
import { DISTRIBUTIONS, AMS_DISTRIBUTIONS, METHOD_LABELS } from '../core/distributions.js';
import { FORMS, KMODELS } from '../core/idf.js';
import { DISAGG_METHODS } from '../core/disaggregation.js';
import { REFS } from '../report/report.js';
import { TOOL_VERSION } from '../pipeline.js';

const eq = (...lines) => h('pre.eq', lines.join('\n'));
const p = (...c) => h('p', ...c);
const b = (t) => h('b', t);
const sec = (id, title, ...c) => h('section.block.methods', { id: `m-${id}` }, h('h3', title), ...c);

export function renderMethods(main) {
  const toc = [
    ['workflow', 'Workflow'], ['data', 'Data and quality checks'], ['ams', 'Annual maxima'], ['dist', 'Distributions'],
    ['est', 'Estimation methods'], ['choice', 'Comparing distributions'], ['screen', 'Trend and outlier screening'],
    ['pot', 'Peaks over threshold'], ['unc', 'Uncertainty'], ['daily', 'Short durations from daily data'],
    ['idf', 'IDF equations'], ['adj', 'Adjustments and design storms'], ['valid', 'Validation and limitations'], ['refs', 'References'],
  ];
  main.append(h('nav.toc', { 'aria-label': 'On this page' }, h('ol', toc.map(([id, t]) => h('li', h('a', { href: `#m-${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t))))));

  main.append(sec('workflow', 'Workflow',
    p('Rainfall record → quality checks → annual maxima for each duration → a probability distribution per duration → design depths for chosen return periods → (for daily-only gauges) short-duration estimates → an IDF equation through the design table → curves, tables, adjustments and design storms → report.'),
    p('Every numerical routine is a plain JavaScript module in ', h('code', 'js/core/'), ', and runs in your browser; nothing is uploaded. Each screen has “i” buttons with short explanations; this page gives the equations. All probabilities are non-exceedance probabilities F; the return period of an annual maximum is T = 1/(1 − F).')));

  main.append(sec('data', 'Data and quality checks',
    p('Records are placed on a regular time grid at the data step (missing intervals stay missing; nothing is interpolated). Tipping-bucket logs are summed into intervals. The checks flag negative values, values above the world-record depth–duration envelope, repeated identical values (stuck sensors), long zero runs inside the wet season (blocked gauges) and the share of each year that is present. A year is used only if its coverage is at least the minimum you set (default 80%).')));

  main.append(sec('ams', 'Annual maxima',
    p('For each duration d, the largest total over any window of length d in each year. ', b('Sliding windows'), ' move one data step at a time. A window that contains a missing interval is not used. ', b('Fixed blocks'), ' use clock intervals only.'),
    p('When a duration spans only n = 1 or 2 observation intervals, the largest fixed-interval total underestimates the largest true total. The ', b('fixed-interval correction'), ' multiplies these annual maxima by an average factor:'),
    eq('table:  f(1) = 1.13,  f(2) = 1.04,  f(n ≥ 3) = 1       (Koutsoyiannis et al. 1998, after Linsley et al.)',
      'Weiss:  f(n) = n / (n − 1/8)'),
    p('If the record is hourly or finer, the tool also measures the 24-h sliding-to-fixed ratio directly and reports it.')));

  main.append(sec('dist', 'Distributions',
    p('Hosking’s sign convention is used for the shape k of GEV, GLO, GPA and LN3: k < 0 gives a heavy upper tail, k > 0 an upper bound. Many R packages use ξ = −k.'),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', 'Distribution'), h('th', 'Parameters'), h('th', 'Methods'))),
      h('tbody', AMS_DISTRIBUTIONS.map((d) => h('tr', h('td.txt', DISTRIBUTIONS[d].label), h('td.txt', DISTRIBUTIONS[d].paramNames.join(', ')),
        h('td.txt', [...DISTRIBUTIONS[d].methods.map((m) => METHOD_LABELS[m]), ...(d === 'gev' ? ['L-moments, shape fixed'] : [])].join('; '))))))),
    eq('Gumbel   x(F) = ξ − α ln(−ln F)',
      'GEV      x(F) = ξ + (α/k) [1 − (−ln F)^k]',
      'GLO      x(F) = ξ + (α/k) [1 − ((1 − F)/F)^k]',
      'LN3      x(F) = ξ + (α/k) [1 − exp(−k z)],   z = Φ⁻¹(F)      (generalised normal form)',
      'LN2      x(F) = exp(μ + σ z)',
      'P3       x(F) = μ + σ K(F; γ)       LP3: the same on ln x',
      'Gamma    F(x) = P(a, x/b)            (regularised incomplete gamma)'),
    p('LN3 in this form equals SciPy’s lognorm(s = −k, loc = ξ + α/k, scale = −α/k) when k < 0.')));

  main.append(sec('est', 'Estimation methods',
    p(b('L-moments'), ' (Hosking 1990): sample L-moments from unbiased probability-weighted moments b_r; parameters chosen so the distribution’s λ1, λ2 (and τ3) equal the sample’s. GEV uses exact Newton inversion of τ3(k); LN3 uses Hosking’s rational approximation (PELGNO). Robust for short records, which is why it is the default.'),
    eq('b_r = n⁻¹ Σ_{j=r+1..n} [(j−1)(j−2)…(j−r)] / [(n−1)(n−2)…(n−r)] x_(j)',
      'λ1 = b0,  λ2 = 2b1 − b0,  λ3 = 6b2 − 6b1 + b0,  τ3 = λ3/λ2'),
    p(b('Method of moments'), ': mean, standard deviation and bias-adjusted skewness. ', b('Maximum likelihood'), ': Nelder–Mead on the negative log-likelihood (closed forms for Gumbel and LN2), with restarts; the GEV shape is bounded to [−0.5, 0.5].'),
    p(b('L-moments, shape fixed'), ': for GEV, k is set by you (for example a regional shape) and only ξ and α are estimated from λ1 and λ2. This removes the most uncertain parameter from a short record; AICc and BIC count two free parameters.'),
    eq('GEV, k fixed:  α = λ2 k / [(1 − 2^(−k)) Γ(1 + k)],   ξ = λ1 − α [1 − Γ(1 + k)] / k'),
    p(b('Penalised maximum likelihood'), ' (Martins & Stedinger 2000) is offered for GEV but labelled EXPERIMENTAL: the prior’s parameters were not verified from the paper.')));

  main.append(sec('choice', 'Comparing distributions',
    p('For each duration every distribution–method pair is fitted and scored. Statistics are computed against the fitted model, so they rank candidates rather than test them.'),
    eq('AICc = −2 ln L + 2p + 2p(p + 1)/(n − p − 1)        BIC = −2 ln L + p ln n',
      'A²   = −n − (1/n) Σ (2i − 1) [ln F(x_(i)) + ln(1 − F(x_(n+1−i)))]',
      'KS D = max_i max(i/n − F(x_(i)), F(x_(i)) − (i−1)/n)',
      'PPCC = corr(x_(i), x(F_i)),  F_i = (i − a)/(n + 1 − 2a)'),
    p('Plotting-position constant a: Weibull 0, Blom 0.375, Cunnane 0.40, Gringorten 0.44, Hazen 0.5. The L-moment ratio diagram plots each duration’s sample (τ3, τ4) against the theoretical curves; with 20–40 years the sampling scatter is large, so read it as a tendency.')));

  main.append(sec('screen', 'Trend and outlier screening',
    p(b('Mann–Kendall'), ' (two-sided, tie-corrected, continuity-corrected) with Sen’s slope, per duration. Serial correlation is not corrected for.'),
    p(b('Grubbs–Beck'), ' (Bulletin 17B, Appendix 4) on base-10 logs of the positive annual maxima, 10% significance:'),
    eq('K_N = −0.9043 + 3.345 √(log10 N) − 0.4046 log10 N',
      'low limit = 10^(m − K_N s),   high limit = 10^(m + K_N s)'),
    p('Values outside the limits are flagged, not removed. One extreme value can hide another (masking); the newer multiple Grubbs–Beck test of Bulletin 17C is not implemented.')));

  main.append(sec('pot', 'Peaks over threshold',
    p('For each duration, the d-duration rolling depth is computed; peaks are taken largest first, and any window closer than max(separation, d) to a chosen peak is excluded, so peaks are independent storms. The number of peaks is about (events per year) × (observed years). The threshold u is the smallest selected peak; excesses y = x − u of the peaks above it are fitted with a generalised Pareto distribution with u known:'),
    eq('G(y) = 1 − (1 − k y/α)^(1/k)                 (k = 0: 1 − exp(−y/α), exponential)',
      'L-moments of the excesses:  k = λ1/λ2 − 2,   α = (1 + k) λ1',
      'Poisson arrivals at rate λ per year:  P(annual max ≤ x) = exp{−λ [1 − G(x − u)]}',
      'so for return period T:  x_T = u + y(F*),   F* = 1 + ln(1 − 1/T) / λ'),
    p('This gives annual-maximum return periods, so POT and AMS quantiles are directly comparable. The stability table shows k and the 10-year depth for several event rates: choose a rate where they stay roughly constant. Peaks over threshold need a time series; they are not available from an annual-maximum table.')));

  main.append(sec('unc', 'Uncertainty',
    p(b('Non-parametric bootstrap'), ': whole years are resampled with replacement (keeping each year’s maxima for all durations together, so the dependence between durations is preserved), every duration is refitted with the same choices, and percentile intervals are taken. Optionally the IDF equation is refitted to each replicate to give parameter intervals.'),
    p(b('Parametric bootstrap p-value'), ' for Anderson–Darling: samples are simulated from the fitted model, refitted with the same method, and p = share of simulated A² ≥ observed. ', b('Delta method'), ' intervals are shown for ML fits only, as a normal approximation.'),
    p('In this tool’s tests, nominal 90% percentile intervals covered the true quantile about 80% of the time for 40-year records: treat them as optimistic.')));

  main.append(sec('daily', 'Short durations from daily data',
    p('A daily gauge cannot see sub-daily bursts, so short-duration depths must be estimated from the 24-h depth P24 (after the fixed-interval factor):'),
    eq('IMD formula         P_t = P24 (t/24)^(1/3)',
      'Power law           P_t = P24 (t/24)^n,   n fitted to a sub-daily station’s quantiles',
      'Simple scaling      E[max_t] ∝ t^H,        H from the calibration station’s mean annual maxima',
      'Ratio transfer      P_t = r_t · P24,       r_t measured at the calibration station',
      'Ratio table         your own r_t'),
    h('div.table-wrap', h('table.data', h('thead', h('tr', h('th', 'Method'), h('th', 'Status'))),
      h('tbody', Object.values(DISAGG_METHODS).map((m) => h('tr', h('td.txt', m.label), h('td.txt', { 'verified-formula': 'formula checked; accuracy not validated', verified: 'implementation tested', experimental: 'EXPERIMENTAL', user: 'your input' }[m.status] ?? m.status)))))),
    p(b('Evidence. '), 'At a real hourly station (Denver, 42 Julys) the IMD formula underestimated 1-hour quantiles by about 40% and the 1–12 h range by 32% on average; calibrated methods were within about 5–9%. On a synthetic monsoon-like record it overestimated 5-min quantiles by about 45% and underestimated 30 min–1 h by about 35%. Transferring ratios kept the error lowest. These tests transfer in time at one station; between stations the error will be larger. No method has been validated on Bangladeshi sub-daily records.')));

  main.append(sec('idf', 'IDF equations',
    p('An equation summarises the design table (intensity i in mm/h, duration t in the unit you choose). Parameters are fitted by multi-start Nelder–Mead on log intensities (or intensities), with differential evolution for the harder Koutsoyiannis fits.'),
    p(b('Koutsoyiannis general IDF'), ' (Koutsoyiannis et al. 1998): i(t, T) = a(T)/b(t), with a(T) the quantile of a distribution and b(t) = (t + θ)^η. It is consistent with the frequency distribution at every T, so it extrapolates in T sensibly. Estimation: robust (two-step, Kruskal–Wallis-based η), one-step least squares, or maximum likelihood over all durations.'),
    eq(...Object.values(KMODELS).map((m) => `${m.label.padEnd(36)} ${m.expr}`)),
    p(b('Empirical forms'), ' are fitted separately for each return period (per-T) or with T inside the formula (unified):'),
    eq(...Object.values(FORMS).map((f) => `${(f.label + (f.kind === 'perT' ? ' (per T)' : '')).padEnd(40)} ${f.expr}`)),
    p('Models are compared with R², RMSE, NSE, KGE, bias, the largest absolute error and AICc, and checked for crossing curves and for depth that decreases with duration. By default a Koutsoyiannis model is selected if it reproduces the per-duration quantiles within 10% for T ≤ 10 yr; otherwise the equation with the smallest worst-case error. You can select any model.')));

  main.append(sec('adj', 'Adjustments and design storms',
    eq('Climate uplift   i′ = i (1 + p)                    fixed percentage',
      '                 i′ = i (1 + r)^ΔT  or  i (1 + r ΔT)   rate r per °C of warming ΔT',
      'Areal reduction  i′ = ARF · i'),
    p(b('Design storms'), ': alternating block and Chicago (Keifer & Chu 1957) contain the IDF depth of every shorter duration; SCS Type I/IA/II/III (TR-55, as in HEC-HMS) and Huff quartiles (Illinois) are fixed dimensionless curves; triangular (Yen & Chow 1980) and uniform are simple shapes. Export to CSV, SWMM and HEC-HMS.')));

  main.append(sec('valid', 'Validation and limitations',
    p(`Version ${TOOL_VERSION}. The numerical core is tested against SciPy ${'1.18'} and the lmoments3 package: special functions, every distribution’s cdf, pdf and quantile, every estimator, goodness-of-fit statistics, the IDF fitting, design storms and the time-series functions (sliding maxima, aggregation, gaps). The new v0.2 methods (LN3, fixed-shape GEV, peaks over threshold, Grubbs–Beck) have their own reference tests. Run `, h('code', 'npm test'), ' in the source folder to repeat them.'),
    h('ul',
      h('li', 'Stationarity is assumed; the trend test only warns.'),
      h('li', 'Bootstrap intervals under-cover (≈80% for nominal 90% at n = 40).'),
      h('li', 'Daily-to-sub-daily methods are not validated for Bangladesh.'),
      h('li', 'Threshold choice for peaks over threshold is left to you; use the stability table.'),
      h('li', 'The regional (L-moment) module and inverse-distance estimates are for screening only.'),
      h('li', 'The fixed-interval factors are averages; their real value varies by station and year.'))));

  main.append(sec('refs', 'References',
    h('ol.refs', Object.values(REFS).map((r) => h('li', r)))));
}
