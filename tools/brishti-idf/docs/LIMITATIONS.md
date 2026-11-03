# Limitations

Grouped by severity for a user who will base a design on the output.

## 1. Evidence for the daily-to-sub-daily methods
- **No Bangladeshi sub-daily truth was available.** The hold-out tests (`docs/HOLDOUT.md`) use one real station (Denver, Colorado: semi-arid, convective, July-only, units as distributed in the R package extRemes) and one synthetic series. Neither represents Bangladesh's monsoon climate. Every daily-to-sub-daily result is therefore labelled experimental or "accuracy not validated".
- The split-sample tests transfer ratios or exponents **in time at one station**. Real use transfers them **in space** between stations, which will usually be less accurate.
- Bell (1969) coefficients and the Leclerc–Schaake ARF formula were recalled, not checked against the original papers (labelled EXPERIMENTAL). WMO depth-ratio tables are not built in because their values were not verified; users can type any ratio table.

## 2. The synthetic generator
- It is a demonstration and testing device, not a rainfall model of any place. Its parameters were tuned to typical duration ratios recalled from US practice (TP-40/HYDRO-35 type), not to Bangladeshi data.
- It under-represents depth growth between 1 h and 3 h (annual maxima at 1, 2 and 3 h are often nearly equal). As a result no IDF equation fits its quantiles within 10%, which is a property of the generator and not evidence about real rainfall.

## 3. Statistical
- Stationarity is assumed. A Mann–Kendall test (no correction for serial correlation) is reported, but there is no non-stationary IDF model.
- Bootstrap percentile intervals under-cover. In the tool's own tests, nominal 90% intervals covered the truth about 80% of the time for 40-year records, and the screen says so.
- Koutsoyiannis ML fits treat maxima of different durations as independent (they are not), so likelihood-based standard errors are too small; bootstrap is preferred.
- GEV ML shape is bounded to [−0.5, 0.5]. The penalised-likelihood (Martins–Stedinger prior) option is experimental because the prior's parameters were recalled.
- Peaks over threshold (v0.2) uses a known threshold equal to the smallest selected peak and Poisson arrivals. Threshold choice is left to the user (a stability table helps). There are no bootstrap intervals for POT quantiles, and when POT is used for design the Koutsoyiannis models are not fitted.
- Outlier screening is the single Grubbs–Beck test of Bulletin 17B; one outlier can mask another. The multiple Grubbs–Beck test of Bulletin 17C is not implemented. Flags are never acted on automatically.
- A fixed GEV shape is only as good as its source. Entering a shape from a different climate or a single short record can make long-return-period values worse, not better.
- The default-model rule (Koutsoyiannis within 10% for T ≤ 10 yr, else smallest worst-case error) is a judgement call documented in DECISIONS D10, not a published standard.
- The regional (Hosking–Wallis) module has only been checked for internal identities, not against lmomRFA, and is labelled experimental. Inverse-distance interpolation of IDF values has no statistical basis and is for screening only.

## 4. Fixed-interval correction
- 1.13/1.04 are average factors. Papalexiou et al. (2016) show the correction is random from year to year. The empirical factor at Denver was 1.071, which made 24-h quantiles from daily data 5–9% too high in the hold-out. Where sub-daily data exist, use the empirical factor the tool reports.
- The Weiss-type factor n/(n − 1/8) comes from a search-result summary, not the original paper, and is not the default.

## 5. Climate change and areal reduction
- Climate uplift is a simple multiplier (% or %/°C). It does not downscale GCMs (see IDF_CC for that), and the choice of rate (≈7%/°C Clausius–Clapeyron, or more for short durations) is left to the user with literature pointers.
- No Bangladesh-specific areal reduction factors are built in.

## 6. Software
- Pure-JavaScript numerics: these are tested against SciPy (`docs/VALIDATION.md`) but are not a reference implementation. Very short records (< 10 years), heavy ties and zero-rain years are handled and flagged, but results there are fragile.
- The user interface is tested by a headless-browser smoke test (Chromium only). It has not been tested with assistive technologies beyond keyboard navigation and ARIA labelling, nor on Safari or Firefox.
- Browsers block ES modules on `file://`, so the folder must be served (GitHub Pages or `python3 -m http.server`).
- Large 1-minute records (decades) need several hundred MB of memory in the browser.
