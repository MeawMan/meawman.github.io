# Limitations (OpenFFA 0.3.0)

## Methods not implemented
* Kappa and Wakeby distributions; LH-moments; mixed-population (e.g. snowmelt + rain) models.
* Regional frequency analysis (index flood, regional L-moment algorithm, discordancy and heterogeneity
  measures).
* Bayesian estimation (as in FLIKE / RMC-BestFit) and expected-probability adjustments.
* Bulletin 17C **analytical** EMA confidence intervals (Cohn et al. 2001) and the EMA skew MSE.
  OpenFFA's EMA intervals are a parametric bootstrap that re-simulates the same censoring/historic design.
  These intervals are a legitimate alternative with similar widths, but they sit somewhat lower than
  PeakFQ's, especially at the upper limit. At 95 % (500 replicates), the Santa Cruz River 100-year
  interval is 6,534–18,792 ft³/s (OpenFFA) versus 7,474–20,570 ft³/s (PeakFQ). See
  `VALIDATION_NOTES.md`. Do not present them as the B17C interval.
* Station-skew MSE uses the Bulletin 17B formula. It matches PeakFQ for uncensored data (Moose River:
  0.101), but not the EMA-based MSE for censored data.
* Threshold-exceedance plotting positions are implemented for one historic threshold. B17C eqs. 5-3 to 5-5
  (several thresholds) and interval/binomial data (crest-stage gauges, broken records with gaps described
  by thresholds) are not implemented.
* The non-stationary GEV allows linear trends in location and log-scale only, with a constant shape. There
  is no non-stationary GPA or LP3.
* Peaks-over-threshold intervals include the uncertainty of the event rate λ (Poisson event count) but treat the threshold as known.
* The POT event rate uses observed time (number of values × median time step). Irregular records whose step changes over time (e.g. daily, then hourly) are counted at the median step; check the reported observed years.
* Gumbel's method (Gumbel 1958) is provided to reproduce existing reports. It is a less efficient estimator than L-moments or maximum likelihood, and its bootstrap intervals refit with the same method.
* Bootstrap interval coverage: in OpenFFA's simulations (n = 30, 90 % nominal, 100-year flood) the parametric bootstrap covered 86–87 %, the non-parametric percentile bootstrap 74–79 % and the non-parametric BCa 77–85 %. All under-cover somewhat; treat intervals as a lower bound on uncertainty.

## Statistical cautions
* GOF tests have little power for typical record lengths (20–60 years). A large p-value is not evidence
  that a distribution is correct.
* AIC/AICc/BIC are exact comparisons only between maximum-likelihood fits. For other methods the
  likelihood is evaluated at non-ML parameters. Censored-likelihood fits are not ranked against
  uncensored ones.
* Confidence intervals describe sampling uncertainty under the chosen model. They exclude model choice,
  rating-curve and measurement errors, and non-stationarity.
* The MGBT decision can be sensitive near the significance cut-off. In Bulletin 17C Example 2
  (Orestimba Creek), the USGS MGBT R package and OpenFFA find 38 PILFs where PeakFQ 7.1 found 30. Use
  judgement and the manual threshold.
* The Pettitt p-value is the usual asymptotic approximation. Mann-Kendall with the Hamed-Rao correction
  falls back to the plain test when the correction is negative.

## Practical
* The app must be served over http(s) (GitHub Pages or a local server). Opening `index.html` from disk
  does not work, because of browser module/worker security rules.
* Very large daily records (> ~10⁶ values) make parsing and AMS extraction slow in the browser.
* The plotting library is the Plotly "basic" bundle (scatter, bar). Specialised charts would need the
  full bundle.
* No Bangladeshi dataset is bundled; the monsoon sample is synthetic.
