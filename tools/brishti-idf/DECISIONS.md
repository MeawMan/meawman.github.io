# DECISIONS.md — key design choices and why

Version 0.1.0 · started 2026-10-26. Newest entries at the bottom of each section.

## D1. Numerical engine: pure JavaScript (own implementations), verified against SciPy
**Options evaluated:** (a) pure JS with our own verified implementations; (b) Pyodide + SciPy in the browser.

| Criterion | Pure JS | Pyodide/SciPy |
|---|---|---|
| Accuracy | Equal once verified against SciPy reference values (see `docs/VALIDATION.md`) | Reference-grade out of the box |
| First-load size | tens of kB | ~10 MB+ runtime plus SciPy wheels |
| Offline use | Trivial (static files, optional service worker) | Possible but heavy to cache |
| Editable by a hydrologist | Yes, plain readable modules | Opaque runtime; Python code runs inside it |
| Maintenance | We own every line, so tests are mandatory | Upstream maintains numerics |

**Decision:** pure JavaScript. Every numerical routine is tested against SciPy/closed-form values with stated tolerances. SciPy is used only offline, by `tests/reference/make_reference.py`, to generate reference numbers.

## D2. No build step; ES modules
Plain ES modules loaded with `<script type="module">`. Tests run with Node's built-in `node:test` (Node 22 here, no dependencies).
Consequence: a browser blocks ES modules on `file://`. README says to use GitHub Pages or `python3 -m http.server`.

## D3. Parameter conventions
GEV, GLO and GPD use **Hosking's shape k** (k>0 bounded above; k<0 heavy upper tail; Gumbel at k=0), the convention of Hosking & Wallis (1997) and of IDF_CC (Schardong et al. 2020, eqs 3–15). Many R packages use the opposite sign (xi = −k). The UI shows both.

## D4. Unified (Koutsoyiannis) duration-dependent GEV is the primary IDF model
Koutsoyiannis et al. (1998) show that fitting a separate T-dependence `a·T^m` after per-duration fits is inconsistent with a Gumbel/GEV parent and diverges at large T (their Fig. 3, T=500 and 5000 yr). So the primary model is `i(d,T) = a(T) / (d+θ)^η` with `a(T)` taken from the fitted distribution. Sherman/Talbot/Bernard/Kimijima/general forms are offered as comparison models, ranked with an overfitting caution.

## D5. Fixed-interval (Hershfield/Weiss) correction
Rolling-window (true sliding) extraction is the default whenever sub-daily data exist. A fixed→sliding multiplier is applied to annual maxima of windows spanning n observation intervals. Default presets are the multipliers Koutsoyiannis et al. (1998) cite (1.13 for n = 1, 1.04 for n = 2). A Weiss-type option n/(n − 1/8) is offered; its form comes from a **search-result snippet** of the Papalexiou et al. EGU 2014 poster, not from Weiss (1964) itself, so it is not the default. When sub-daily data exist the tool reports the empirical factor (ratio of mean sliding to mean fixed 24-h annual maxima): 1.071 for Denver and 1.122 for the synthetic series, against the standard 1.13. *(Corrected 2026-10-27: an earlier version of this entry said Weiss was not implemented.)*

## D6. Daily-only disaggregation is EXPERIMENTAL until validated on real sub-daily truth
Implemented: IMD power-law reduction `P_t = P_24 (t/24)^(1/3)`; the same law with a locally calibrated exponent; user-supplied ratio table; simple-scaling transfer of a calibrated exponent; Bell (1969) shape (needs a 10-yr 1-h reference depth). WMO ratio tables are **not** hard-coded because the values were not verified. Real Bangladesh sub-daily truth was not available to the build, so the hold-out validation uses a seeded synthetic generator and (where obtainable) a public gauge dataset; this limitation is stated in `docs/LIMITATIONS.md`.

## D7. Missing data and incomplete years
Years below a configurable coverage threshold (default 80%) are flagged and excluded from the AMS by default, with a switch to keep them. They are never dropped silently; every exclusion is listed in the data-quality report and in the generated report.

## D8. Reproducibility
Every stochastic routine takes an explicit seed (xoshiro128** seeded via splitmix32). The JSON project file stores settings, seed and tool version.

## D9. Estimators offered
Gumbel: MoM, L-moments, MLE. GEV: L-moments, MLE (shape bounded to [-0.5, 0.5]), and a penalised-likelihood variant with the Martins–Stedinger geophysical prior (**experimental**: prior recalled, not opened). LP3: MoM on logs (at-site skew), L-moments on logs. Log-normal, Gamma, Pearson III, GLO, GPD (for POT) as specified in `core/distributions.js`.

## D10. Default IDF equation: rule-based, explained, user-overridable (2026-10-27)
Previously the lowest-AICc model was selected silently. That contradicted D4 and, on real data, picked an 18-parameter per-return-period Sherman fit while the screen recommended the Koutsoyiannis model. Rule now: (1) a Koutsoyiannis model is selected if it reproduces the per-duration quantiles within 10% for T ≤ 10 yr (where those quantiles are reliable); preference order Gumbel-robust, GEV-robust, GEV-ML, Gumbel-ML, then one-step variants. (2) Otherwise the equation with the **smallest worst-case error** is chosen, not the lowest AICc: an equation's job is to reproduce the design table, and pooled-log-residual AICc favoured K·Tᵐ/(t+b)ⁿ despite a 27% worst-case error. (3) When nothing fits within 10%, the screen and report say so and point to the quantile table. The reason is shown on the IDF screen and in the report. The 10% threshold is a judgement call, not a published standard.

## D11. No silent disaggregation for sub-daily stations (2026-10-27)
Bug found during browser review: an hourly station's 5–30 min rows were filled by the IMD formula from the 24-h quantile and mixed into the design table. The IDF equations were then fitted to that mix, and the Koutsoyiannis model appeared to miss by up to 294% (it is within 6% of the observed rows). Now durations finer than the record are left out and reported as a warning. An expert opt-in extrapolates them with a power law calibrated on the station's own quantiles, labelled EXPERIMENTAL.

## D12. Depth-ratio transfer added as a daily-to-sub-daily method (2026-10-27)
On the synthetic series no single exponent reproduces 5 min–24 h (oracle power-law MAPE ≈ 20%), because depth–duration curves bend. Transferring the ratios P_t/P_24 measured at a station with sub-daily data keeps that curvature (split-sample MAPE 11–14% vs 24–25% for IMD and the calibrated power law; Denver ≈ 8–9%, similar to the power law). Ratios are geometric means over return periods and are interpolated log-log, never extrapolated. Limitation: the hold-out transfers in time at one station, while real use transfers in space.

## D13. Synthetic generator v2 (2026-10-27)
v1 drew cell depths and allowed one-step cells, which gave implausible extremes (10-yr 5-min depth ≈ 74 mm, 1-h ≈ 190 mm). v2 draws cell intensity and a Gamma(2) duration (5-min floor, independent of the output step, so a given seed yields the same storms at any resolution). Its parameters were grid-searched on duration ratios (5-min/1-h ≈ 0.29, 15-min/1-h ≈ 0.57, 1-h/24-h ≈ 0.40; recalled typical values, not from an opened source). It still under-represents depth growth between 1 h and 3 h (`docs/LIMITATIONS.md`). All hold-out and demo numbers were regenerated with v2.

## D14. Status labels say what was checked
"Formula verified" for IMD read as an endorsement. Labels now distinguish "formula checked · accuracy not validated" (IMD), "implementation tested" (calibrated methods: the code is tested; accuracy depends on local data), "experimental" and "user input".

## D15. Offline support via a network-first service worker
Vendoring alone does not make the app work offline after the first visit. `sw.js` fetches from the network when online, so users never see a stale version, and falls back to the cached copy offline. It is tested by `tools/browser_smoke.cjs`, which reloads and analyses with the network switched off.


## D16. Portfolio release, v0.2.0 (2026-11-03)
The tool is published as a page of meawman.github.io (`tools/brishti-idf/`) rather than as a paper companion. The paper-only documents (outline, research brief, gap analysis) were removed from the shipped folder; validation, hold-out results and limitations stay, because they are what a user needs to judge the output. The page uses the portfolio header, fonts and colour palette, and shares the portfolio's theme key (`mrj_theme`, light or dark), so the tool opens in the theme the visitor already chose. Report figures are always drawn in the light palette (`plots.setRenderRoot`), whatever the screen theme.

## D17. More control over the frequency analysis
Added, because each is a standard choice a hydrologist may need to match a guideline or a previous study: the three-parameter log-normal (Hosking's generalised-normal form, L-moments by PELGNO and ML; checked against SciPy `lognorm`); GEV by L-moments with a user-fixed shape (for a regional shape, or k = 0 to force Gumbel within the GEV family; two free parameters in AICc/BIC); a choice of ranking criterion (AICc, BIC, A², PPCC, KS); a choice of plotting position (Gringorten default, Weibull, Cunnane, Hazen, Blom), which affects only the empirical points and PPCC. Gringorten stays the default because it is close to unbiased for Gumbel/GEV; Weibull is offered because Bangladeshi reports commonly use it.

## D18. Peaks over threshold wired into the analysis
`peaksOverThreshold` existed in v0.1 but was not reachable from the interface. It is now an optional analysis on the Frequency screen: independent peaks (separation ≥ max(24 h, d)), a known threshold equal to the smallest selected peak, GPA (or exponential) excesses by L-moments or ML, and the Poisson–GPA conversion F* = 1 + ln(1 − 1/T)/λ, which yields annual-maximum return periods so POT and AMS can be compared directly. The rate uses observed (non-missing) time. When POT quantiles are used for design, the Koutsoyiannis models are skipped (they are fitted to annual maxima), and bootstrap intervals are labelled as referring to the AMS fit. A threshold-stability table (k and the 10-yr depth against the event rate) is shown for the 24-h duration. Bootstrap intervals for POT are not implemented.

## D19. Outlier screening flags, never removes
The Bulletin 17B Grubbs–Beck test (log values, 10% significance) is applied to every duration and shown on the Annual maxima screen and in the report. Nothing is removed automatically: in rainfall records a flagged high value is usually a real storm, and a low value usually means a failed gauge that the coverage rule should catch. The multiple Grubbs–Beck test (Bulletin 17C) is not implemented; masking by a second outlier is mentioned on the Methods screen.

## D20. Documentation lives next to each control
Every control and section with an entry in `js/ui/info.js` gets an “i” button automatically (lookup by its label), so documentation cannot be forgotten when a control is added. Explanations float over the form so opening one never moves other controls; one is open at a time, and Escape or a click elsewhere closes it. A Methods screen gives the equations; the IDF-equation forms and the distribution list on it are read from the code, so the page cannot drift from what is fitted. The Report screen adds a plain-text methods paragraph that states only what was done for the active station.
