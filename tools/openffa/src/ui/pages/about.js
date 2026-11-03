// pages/about.js - what the tool does, how it is validated, limitations, citation.
import { h } from '../dom.js';
import { SOFTWARE } from '../../core/analysis.js';

export function render(host) {
  host.append(h('h2', { id: 'h-about' }, `About ${SOFTWARE.name} ${SOFTWARE.version}`),
    h('div', { class: 'sheet' }, h('p', {}, 'OpenFFA is a flood frequency analysis tool that runs entirely in your web browser. No data are uploaded anywhere; after the first visit it also works offline.'),
      h('p', {}, 'It fits 11 distributions (Normal, log-normal 2/3, Gumbel, GEV, Pearson III, log-Pearson III, gamma, Weibull, generalised logistic, generalised Pareto) by L-moments, maximum likelihood, moments, probability-weighted moments and, for log-Pearson III, the Expected Moments Algorithm of Bulletin 17C, with historic, censored and zero-flow data, bootstrap-calibrated goodness of fit, four kinds of confidence interval, peaks over threshold and a non-stationary GEV.')),
    h('div', { class: 'sheet' }, h('h3', {}, 'How the numbers are checked'),
      h('p', {}, 'Every estimator is tested automatically against independent software and published results: R packages lmom, extRemes, ismev, MGBT (USGS) and trend; SciPy, lmoments3 and pymannkendall; and the worked examples of Bulletin 17C (Moose River, Orestimba Creek, Santa Cruz River), whose EMA moments and design floods are reproduced to the printed precision. The full table is in docs/VALIDATION.md; known discrepancies in the references are explained in docs/VALIDATION_NOTES.md.')),
    h('div', { class: 'sheet' }, h('h3', {}, 'Limitations'),
      h('ul', {}, [
        'Not implemented: Kappa and Wakeby distributions, regional frequency analysis, Bayesian estimation, mixed-population models, LH-moments.',
        'EMA confidence intervals are a parametric bootstrap that re-simulates the censoring design, not the analytical Bulletin 17C intervals; the station-skew MSE uses the Bulletin 17B formula.',
        'Goodness-of-fit tests have low power for short records; passing them does not show a distribution is correct.',
        'Confidence intervals do not include model (distribution choice) uncertainty or measurement error in the flows (rating curves).',
        'The non-stationary GEV allows linear changes in location and scale only; the shape is held constant.',
      ].map((t) => h('li', {}, t)))),
    h('div', { class: 'sheet' }, h('h3', {}, 'Citing'),
      h('p', {}, `${SOFTWARE.name} (version ${SOFTWARE.version}): browser-based flood frequency analysis. Software, 2026. (Replace with the archived DOI, e.g. Zenodo, when published.)`)));
}
