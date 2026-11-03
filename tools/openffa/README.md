# OpenFFA — browser-based flood frequency analysis

Live: **https://meawman.github.io/tools/openffa/** (part of the portfolio of Mahfujur Rahman Joy). Version 0.3.0.

### New in 0.3.0 (methods audit)
* **Fixed:** the peaks-over-threshold event rate now counts only observed time, so gaps in a daily record no longer bias return levels low.
* **Fixed:** delta-method intervals for LN2 and LP3 are formed in log space (asymmetric, never negative).
* **Fixed:** profile likelihood is refused for a 3-parameter generalised Pareto with a free location (its likelihood is unbounded).
* **New:** peaks-over-threshold return levels on the annual-maximum basis (default), directly comparable with the design-flood table.
* **New:** Gumbel's finite-sample method (Gumbel 1958; x_T = x̄ + K s), as used in textbooks and many reports, with ȳn and σn computed exactly.

### New in 0.2.0
* Bootstrap limits: percentile, bias-corrected (BC) or bias-corrected and accelerated (BCa), with a coverage study.
* Peaks-over-threshold intervals now include the uncertainty of the event rate (Poisson event count).
* A ? button with an explanation on every option, and a **Methods and references** page with the equations.
* Portfolio header, fonts and colours; light/dark theme shared with the portfolio; further analyses reachable on phones.

OpenFFA is a flood frequency analysis (FFA) tool that runs entirely in a web browser, with no server, no
installation and no data upload. It is meant for water-resources engineers and researchers, with
Bangladesh-style records (BWDB discharge and water-level series, April–March water years) as the main
context, and it works for any annual-maximum or daily record.

**What it does**

* **Data**: paste, CSV/TXT or Excel upload, with delimiter, header and date-format detection. Supports annual
  maxima or daily/sub-daily series with water-year extraction and completeness checks, historic floods
  (perception threshold), zero flows, low outliers and manual thresholds.
* **Checks before fitting**:
  * record length and gaps;
  * Mann-Kendall trend with the Hamed-Rao correction, plus the Theil-Sen slope;
  * Pettitt change point;
  * lag-1 autocorrelation and the Wald-Wolfowitz test;
  * Mann-Whitney homogeneity;
  * Grubbs-Beck (B17B) and Multiple Grubbs-Beck (B17C) outlier tests.

  The result is a plain-language verdict on whether stationary FFA is defensible.
* **11 distributions**: Normal, LN2, LN3, Gumbel, GEV, Pearson III, log-Pearson III, Gamma, Weibull, GLO, GPA.
* **6 estimation methods**: L-moments, maximum likelihood (including censored/historic data), method of
  moments (B17B), PWM, the Expected Moments Algorithm of Bulletin 17C, and Gumbel's finite-sample method.
* **Model comparison**:
  * KS, AD, CvM and PPCC statistics with bootstrap-calibrated p-values (not tables);
  * AIC, AICc and BIC;
  * L-moment ratio diagram;
  * a transparent ranking with caveats.
* **Bootstrap limits**: percentile, BC or BCa (Efron 1987).
* **Design floods**: any return periods; parametric/non-parametric bootstrap (percentile, BC or BCa limits),
  delta-method and profile-likelihood intervals; probability paper (Gumbel, normal, log-T, Weibull axes).
* **Further analyses**: peaks over threshold (declustering, mean residual life and parameter-stability plots,
  GPA, intervals that include the event-rate uncertainty) and a non-stationary GEV (trend in location/scale with a
  likelihood-ratio test).
* **Outputs**:
  * PNG/SVG figures at any size and DPI;
  * CSV and XLSX tables;
  * a JSON project file (data, settings and software version, for exact reproduction);
  * a self-contained methods-and-results report (HTML, printable to PDF) with citations.
* **Interface**: guided mode with recommendations and inline help, expert mode with every option, light/dark
  theme, keyboard accessible, works on phones. Heavy calculations run in a Web Worker with progress and Cancel.
  Bootstrap results are reproducible from a seed.

## Validation

Every estimator is compared automatically with independent implementations and published results. The
full table is in [`docs/VALIDATION.md`](docs/VALIDATION.md), and the reference discrepancies found are in
[`docs/VALIDATION_NOTES.md`](docs/VALIDATION_NOTES.md). The references are:

* **R**: `lmom` 3.3 (Hosking), `extRemes` 2.2.1, `ismev` 1.43, `MGBT` 1.1.8 (USGS), `trend` 1.1.10.
* **Python**: SciPy 1.18, `lmoments3`, `pymannkendall`, `pyhomogeneity`.
* **Bulletin 17C, Appendix 10** (PeakFQ results):
  * Moose River (systematic record, weighted skew);
  * Orestimba Creek (12 zeros, 30 low outliers);
  * Santa Cruz River (22-year historic period plus 10 low outliers).

  EMA moments are reproduced to the printed 4 decimals and quantiles to the printed 4 significant figures.
* **Coles (2001)**: Port Pirie (GEV ML, standard errors, normal and profile-likelihood intervals) and
  Fremantle (GEV with a linear trend).

Run the tests (Node.js 20 or newer; no packages needed):

```bash
npm test             # the full test-suite (counts in docs/VALIDATION.md)
npm run validate     # tests + regenerate docs/VALIDATION.md
```

Reference values are generated by `npm run gen-reference`. This needs Python with SciPy, lmoments3,
pymannkendall and pyhomogeneity, and R with lmom, extRemes, ismev, MGBT, trend and jsonlite. Reference
values were produced by running these packages, never typed from memory.

## Using it

* **Online**: open the GitHub Pages address of your copy (see below). After the first visit it also
  works offline.
* **Locally**: the app uses JavaScript modules and a Web Worker, so it must be served over http. Opening
  `index.html` directly from the disk will not work. From this folder run:

```bash
python -m http.server 8000      # then open http://localhost:8000
```

1. **Data**: load a file, paste, or pick a sample. Check the column roles, units and (for daily data)
   the water year.
2. **Checks**: read the findings. Decide whether to censor low outliers.
3. **Fit**: choose a preset or tick distribution × method combinations, then fit.
4. **Design floods**: select a fit, set return periods and the interval method, and compare fits.
5. **Report**: open or download the report; export tables and the project file.

## Publishing in the portfolio

The folder is built to sit at `tools/openffa/` in the `meawman.github.io` repository. It links the portfolio's
`assets/favicon.svg` and `assets/css/tool-shell.css` with `../../` and stores the theme under `mrj_theme`.

1. Copy the contents of this folder to `tools/openffa/` in the portfolio repository.
2. Add the Tools card to `data/content.json` (the entry is in `PORTFOLIO_ENTRY.json`).
3. Commit and push; the tool appears at `https://meawman.github.io/tools/openffa/`.

Served on its own (e.g. `python -m http.server`), the portfolio header images are missing; everything else works.
`node tools/browser_smoke.cjs out/` drives the interface in headless Chromium (needs Playwright);
`SITE_ROOT=<portfolio> BASE=/tools/openffa/ node tools/browser_smoke.cjs out/` does the same inside the portfolio.

There is no build step. The file `.nojekyll` stops GitHub from processing the files. After changing files,
run `node scripts/build-sw.mjs` so the offline cache picks up the new version.

## Folder layout

```
index.html              page shell
css/app.css             all styles (design tokens at the top)
src/core/               numerics, no DOM: distributions, fitting, L-moments, GOF, uncertainty,
                        diagnostics, MGBT, EMA/censored data, POT, non-stationary GEV, analysis driver
src/io/                 parsing (CSV/XLSX/dates) and exports (CSV/XLSX/report)
src/plot/               Plotly figure builders and export
src/ui/                 interface: app shell, help texts, one file per page in src/ui/pages/
src/worker/worker.js    Web Worker entry point
tests/                  automated tests; tests/reference/ holds reference generators and values
data/                   sample datasets (see data/README.md)
docs/                   validation, validation notes, decisions, limitations
vendor/                 Plotly.js (basic bundle) and SheetJS, copied locally with their licences
assets/                 fonts (SIL Open Font Licence) and icon
scripts/                helper scripts (vendor update, sample data, validation table, offline cache)
sw.js                   service worker for offline use
```

Numerics live in `src/core` and never touch the page, so a hydrologist can read or edit a method
without reading UI code. Each file starts with a comment explaining what it implements and which
references it follows.

## Citation

> Joy, M. R. (2026). *OpenFFA: browser-based flood frequency analysis* (version 0.3.0) [software].
> https://meawman.github.io/tools/openffa/

A `CITATION.cff` file is included so GitHub shows a "Cite this repository" button.

## Licence

The code is released under the MIT licence (see `LICENSE`). MIT is a permissive choice that suits a
tool you want agencies and consultants to adopt; GPL-3.0 is the alternative if you want derivatives to
stay open. The bundled third-party files keep their own licences:

* Plotly.js: MIT.
* SheetJS Community Edition: Apache-2.0.
* Public Sans and Barlow fonts: SIL OFL 1.1.

The sample data are public domain (USGS) or come from Coles (2001) via R `ismev`, cited in each file.
