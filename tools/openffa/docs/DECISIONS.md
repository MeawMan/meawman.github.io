# DECISIONS.md — key design choices and why

Newest decisions at the bottom. "Verified" means checked by an automated test against an
independent implementation (see `docs/VALIDATION.md`).

## D1. Numerical engine: pure JavaScript, no Pyodide
* **Options considered:** (a) pure JS with own implementations; (b) Pyodide + SciPy in the browser.
* **Chosen:** (a). Reasons: load time (Pyodide + NumPy + SciPy is tens of MB vs. ~150 kB of core
  JS); works offline after first load via a small service worker; no WebAssembly/MIME issues on
  GitHub Pages; code is readable and editable by a hydrologist; runs unchanged in Node, so the same
  code is tested in CI.
* **Cost:** every estimator is ours, so accuracy must be proven. Mitigation: reference values are
  produced by *running* SciPy 1.18, lmoments3, pymannkendall, pyhomogeneity and R (lmom, extRemes,
  ismev, MGBT, trend) — never typed from memory — and compared in `tests/`.

## D2. Parameter conventions follow Hosking & Wallis (1997)
GEV/GLO/GPA use (ξ location, α scale, k shape) with **k > 0 = bounded upper tail** (the sign
convention of R `lmom`, Python `lmoments3` and SciPy `genextreme`'s `c`). The opposite convention
(ξ_Coles = −k, used by extRemes/ismev) is converted only at display time, and the UI states which is
shown. Pearson III uses (mean, sd, skew), as in Bulletin 17C.

## D3. Exact L-moment inversions instead of rational approximations
Hosking's approximations (GEV k, PE3 α, gamma α, GNO) are used only as starting values; we then solve
the exact τ3 equations (e.g. τ3 = 6 I_{1/3}(α, 2α) − 3 for PE3). Tests showed our solutions are more
exact than lmoments3/lmom (verified by SciPy quadrature), so tolerances against those packages are set
to *their* approximation error (documented in the test source).

## D4. Maximum likelihood: regular region only
* Pearson III / LP3 ML is restricted to |skew| ≤ 2 (α ≥ 1). For α < 1 the likelihood is unbounded
  (J-shaped density). SciPy's unconstrained `pearson3.fit` converges to that degenerate solution on one
  of our test samples; we flag it and compare against a constrained SciPy profile instead.
* GEV/GLO/GPA ML shape is bounded to (−1, 1) and a warning is issued for |k| > 0.5 and for n < 25.
* LN3 ML uses the profile likelihood over the lower bound; the known singularity as ζ → min(x) is
  detected and reported.

## D5. Goodness of fit: parametric bootstrap, never tables
KS/AD/CvM tables assume known parameters. With fitted parameters they are badly conservative (our
test shows the KS table rejects < 3 % at a nominal 10 %). We calibrate p-values by parametric
bootstrap with re-fitting using the same estimation method (verified to hold its size at 10 %). The
UI says plainly that no test proves a distribution correct.

## D6. Model ranking is transparent and caveated
User-selectable criterion (AICc default, AIC, BIC, AD, PPCC). AIC/BIC are evaluated at whichever
parameters were estimated, so they favour ML fits; this is stated beside the table.

## D7. Uncertainty
Parametric and non-parametric percentile bootstrap (seeded, any estimator), delta method and profile
likelihood (ML only). Profile likelihood is implemented for every distribution whose first parameter is
a location shift (in log space for LN2/LP3), by re-parameterising the location through x_T.
Verified: delta-method SE and normal-approximation CIs vs extRemes on Port Pirie; profile CI vs
extRemes (within its 400-point grid resolution) and vs the exact Normal-mean profile interval.

## D8. Multiple Grubbs-Beck test: port of the USGS MGBT R package
A first Monte-Carlo implementation was replaced by a line-by-line port of MGBT 1.1.8 (Cohn's
algorithm), including a new AS 243 non-central t CDF and an inverse incomplete beta. Number of PILFs and
thresholds match MGBT on 6 datasets. Our p-values match R's integral at tight tolerance; MGBT's
default `integrate()` tolerance (~1e-4) is inaccurate for p < 1e-4 (not decision-relevant).

## D9. Censored / historic data: EMA (validated vs Bulletin 17C) and censored ML
* **EMA** follows PeakFQ's `emafit.f` (USGS `peakfqr` 8.2.0 source, read but not run): start from
  (0, 1, 0); bias factors c2 = n_e/(n_e−1), c3 = n_e²/((n_e−1)(n_e−2)) with n_e = number of *exact*
  values, applied **only to the exact-value sums** (Bulletin 17C eqs. 7-4/7-5 as printed use
  n_s + n_h^>); skew floor −1.41 each iteration; regional skew through eq. 7-10 with
  n_G = N·MSE_station/MSE_regional. A first version that applied the factors to all terms gave
  wrong skews for censored data (e.g. −1.65 instead of −0.929 for Orestimba); this was found only by
  testing against the published examples.
* **Validated** against Bulletin 17C App. 10: Moose River (systematic + weighted skew), Orestimba Creek
  (12 zeros + 30 PILFs), Santa Cruz River (22-yr historic period + 10 PILFs). Moments agree to the
  printed 4 decimals and quantiles to the printed 4 significant figures.
* **Not implemented:** the Bulletin 17C analytical EMA confidence intervals (Cohn et al. 2001) and the
  EMA skew MSE. Instead, a parametric bootstrap that re-simulates the same censoring/historic design
  is provided and labelled as such. Station-skew MSE uses the Bulletin 17B formula (identical to
  PeakFQ's value for uncensored data, e.g. 0.101 for Moose River).
* **Censored ML** (any distribution) is verified against an independent SciPy likelihood.
* **Zeros:** for EMA and censored ML, zeros are treated as below the PILF threshold (B17C); other
  methods use the conditional-probability adjustment.
* **Findings in Bulletin 17C itself** (see docs/VALIDATION_NOTES.md): Table 10-5 (Moose River)
  matches the station-skew analysis (0.397), not the weighted-skew analysis the text describes.
  For Orestimba Creek, the USGS MGBT R package (and our port) find 38 PILFs where PeakFQ 7.1 found
  30; the deciding p-value (0.00487) is just below the 0.005 cut-off at a tied value. The tool
  therefore lets the analyst set the PILF threshold manually, as Bulletin 17C permits.

## D10. Water year default: April–March
BWDB hydrological analyses commonly use April–March years (seen in BWDB/FFWC modelling material; not
found in an official standard), which keeps the whole monsoon (June–October) in one year. User-configurable.

## D11. Zero flows
Conditional-probability adjustment: fit positive values, F(x) = p0 + (1 − p0) G(x).

## D12. Non-stationary GEV
Location (and optionally log-scale) linear in a centred covariate, constant shape, ML; likelihood-ratio
test and AIC against the stationary model. Verified against extRemes on the Fremantle data (Coles 2001).

## D13. Not implemented (stated as limitations)
Kappa and Wakeby distributions; regional frequency analysis; Bayesian estimation; B17C EMA confidence
intervals; LH-moments; mixed populations. See `docs/LIMITATIONS.md`.

## D14. Plotting and spreadsheets: vendored Plotly.js and SheetJS
Plotly gives interactive plots and SVG/PNG export at any size and scale without extra code. SheetJS
reads/writes XLSX. Both are copied into `vendor/` (no CDN at run time). No build step: native ES
modules served as static files.

## D15. Plotting positions with historic data
With a historic period, observed points use the threshold-exceedance plotting positions of Bulletin 17C
App. 5 (eqs. 5-1, 5-2; Hirsch & Stedinger 1987) for one threshold. Floods equal to the threshold count as
exceeding it (B17C Ex. 6: the two 12,000 ft³/s floods "exceed the historical threshold").

## D16. EMA confidence intervals and ranking
EMA and censored-ML fits get a parametric bootstrap that re-simulates the censoring design (same
systematic length, PILF threshold and historic period). Compared at 95 %, these intervals have similar
widths to PeakFQ's analytical intervals but are shifted lower (`VALIDATION_NOTES.md`). EMA is not a
likelihood method, so its log-likelihood is evaluated at the EMA estimates. Fits whose likelihood uses
censored data are ranked only against other censored fits.

## D17. Interface
* Five-step workflow drawn as a river gauge staff that reads upwards and fills as steps are completed
  (the one decorative element).
* Guided mode hides expert options and adds recommendations; expert mode shows every option.
* Inline help popovers carry the explanations and references.
* Default fit set: GEV, GLO, PE3, GUM and LN3 by L-moments; LP3 by EMA; LN2 and GEV by ML. This mixes
  the families used in Bangladesh studies with the B17C, FEH and ARR choices.
* Plotly's basic bundle (1.1 MB) is used instead of the full one (4.8 MB).
* Fonts (Public Sans, Barlow Semi Condensed) are vendored for offline use.
