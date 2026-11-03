# Validation notes — discrepancies found and how they were resolved

These are cases where the reference itself (a package or a published table) disagreed with a careful
calculation. Each was checked by an independent route before deciding.

| # | Where | What we found | Evidence | Resolution in OpenFFA |
|---|---|---|---|---|
| 1 | lmoments3 / R lmom (GEV, PE3, GAM, LN3 by L-moments) | Small differences (1e-7 to 1e-5 relative) | The packages use Hosking's rational approximations; our exact τ3 inversions reproduce the sample τ3 to ~1e-12 (SciPy quadrature) | Tolerances set to the packages' approximation error |
| 2 | SciPy `pearson3.fit` | Converged to a degenerate J-shaped solution (skew 2.49, likelihood unbounded) on one sample | Profile likelihood with α ≥ 1 | ML restricted to \|skew\| ≤ 2, degenerate case flagged |
| 3 | pymannkendall Hamed–Rao test | Returns NaN when the variance correction is negative; tiny differences when residuals tie | Ties are exact in theory (Sen slope is a pairwise slope) | Fall back to the plain test with a note; tolerance 2e-3 |
| 4 | USGS MGBT R package | Default `integrate()` tolerance (~1e-4) gives inaccurate p-values below ~1e-4 | Re-integration in R with rel.tol 1e-11 matches our values | Compare to tight-tolerance values; decisions unaffected |
| 5 | Bulletin 17C Table 10-5 (Moose River) | Quantiles correspond to the station skew 0.397, not the weighted 0.421 stated in the text | 0.2 % AEP: 6313 with G = 0.397 (matches table) vs 6374 with G = 0.421 | Test documents both |
| 6 | Bulletin 17C Ex. 2 (Orestimba) MGBT | PeakFQ 7.1: 30 PILFs (< 782 ft³/s). USGS MGBT R package and our port: 38 PILFs (< 1130) | p(k=38) = 0.00487 vs cut-off 0.005, at a value tied with k = 37 | Manual PILF threshold option; with 782 the EMA results match PeakFQ exactly |
| 7 | Text extraction of Bulletin 17C | Minus signs lost (skews −0.929, −0.462 printed as 0.929, 0.462) | Published quantiles imply the negative skews (rms 4e-5 in log10) | Negative values used |
| 8 | Our first EMA | Bias-correction factors applied to censored terms; wrong skew for censored data | Comparison with Bulletin 17C examples and PeakFQ `emafit.f` source | Fixed; now matches all three examples |

## Confidence intervals for EMA fits: OpenFFA bootstrap versus Bulletin 17C (PeakFQ)

These intervals are not expected to agree, because they come from different methods. They are shown so
users can judge the difference. All intervals are 95 % (PeakFQ: lower 2.5 % / upper 97.5 % limits).
OpenFFA used a parametric bootstrap with the same censoring design, 500 replicates, seed 1, in ft³/s.

| Site | T (yr) | Estimate | OpenFFA bootstrap | Bulletin 17C (PeakFQ) |
|---|---|---|---|---|
| Santa Cruz R. (Ex. 6) | 10 | 4,652 | 3,410 – 6,158 | 3,481 – 6,394 |
| | 100 | 10,974 | 6,534 – 18,792 | 7,474 – 20,570 |
| | 500 | 16,174 | 7,486 – 36,434 | 9,719 – 42,560 |
| Orestimba Cr. (Ex. 2) | 10 | 6,328 | 4,442 – 8,825 | 4,686 – 9,394 |
| | 100 | 13,824 | 9,539 – 22,882 | 9,813 – 27,730 |
| | 500 | 18,150 | 11,267 – 40,307 | 12,040 – 41,610 |

The widths are similar. The bootstrap intervals are shifted down, most at the upper limit. That is
consistent with the percentile bootstrap not correcting for the downward bias of the estimated skew,
whereas Cohn et al. (2001) and Cohn's 2015 improvement (cited in B17C) adjust for it. A bias-corrected
(BCa) bootstrap is a candidate improvement.
