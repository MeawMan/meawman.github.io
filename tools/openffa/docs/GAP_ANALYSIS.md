# Gap analysis: OpenFFA versus existing flood frequency tools

**How to read the table.** I only marked capabilities I could support:

* **✓** confirmed by running the software or reading its source in this work.
* **(✓)** stated in documentation or a secondary source that I read, but not verified by use.
* **–** not offered according to the sources consulted.
* **?** unknown: I found no source either way.

Before publishing, each "(✓)", "–" and "?" cell for third-party tools should be checked against the
current manuals. Tools change, and I could not install the Windows programs.

| Capability | OpenFFA | USGS PeakFQ 7.x / peakfqr 8.2 | HEC-SSP | RMC-BestFit | TUFLOW FLIKE | R (lmom, extRemes, ismev, MGBT) | Python (SciPy, lmoments3, pyextremes) |
|---|---|---|---|---|---|---|---|
| Runs in a web browser, no installation | ✓ | – (desktop; peakfqr is an R/Shiny package) | – (desktop) | – (desktop) | – (desktop) | – (needs R) | – (needs Python) |
| Works offline, data never leave the machine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Open source | ✓ (MIT) | ✓ peakfqr (CC0) | ? | ? | ? | ✓ | ✓ |
| Bulletin 17C EMA + MGBT for LP3 | ✓ (validated vs B17C examples) | ✓ (reference implementation) | (✓) | ? | – | MGBT only (✓) | – |
| L-moments for many distributions | ✓ (10) | – | (✓) | – (Bayesian) | (✓) LH-moments (ARR Book 3) | ✓ lmom | ✓ lmoments3 |
| Maximum likelihood incl. censored/historic data | ✓ | – (EMA) | (✓) | (✓) Bayesian | (✓) Bayesian | ✓ extRemes (uncensored) | partial |
| Side-by-side comparison of many distribution × method pairs | ✓ | – (LP3 only) | (✓) | (✓) | (✓) | manual scripting | manual scripting |
| GOF p-values corrected for estimated parameters (bootstrap) | ✓ | – | ? | ? | ? | partial (eva package) | – |
| Pre-fit diagnostics with plain-language verdict (trend, change point, independence, homogeneity, outliers) | ✓ | partial (MGBT, trend plots in peakfqr) | ? | ? | ? | separate packages (trend) | separate packages |
| Four CI methods (param./non-param. bootstrap, delta, profile likelihood) | ✓ | analytical EMA CI | (✓) | Bayesian credible intervals | Bayesian | ✓ extRemes | partial |
| Peaks over threshold with threshold aids | ✓ | – | ? | ? | (✓) GPA | ✓ extRemes/ismev | ✓ pyextremes |
| Non-stationary GEV | ✓ | – | ? | ? | ? | ✓ extRemes/ismev | partial |
| Daily-series → AMS extraction with water year and completeness | ✓ | – (uses peak files) | (✓) | ? | ? | manual | ✓ pyextremes (block maxima) |
| Auto-generated methods paragraph with citations | ✓ | – | – | ? | ? | – | – |
| Reproducible project file (data, settings, seed, version) | ✓ | input/spec files | study files | project files | project files | scripts | scripts |
| Automated validation suite published with the tool | ✓ (64 tests, 184 quantity groups) | ? | ? | (✓) validated vs HEC-SSP/FLIKE (webinar) | ? | package tests | package tests |

**Sources consulted.** I read the Bulletin 17C text (England et al. 2018, v1.1) and the PeakFQ Fortran
source in USGS `peakfqr` 8.2.0 (code.usgs.gov/water/peakfqr). I read and ran the R packages and Python
libraries listed. For HEC-SSP and RMC-BestFit, my source was the Australian Water School "Fitting the
curve" Q&A report (awschool.com.au). For FLIKE, my source was the TUFLOW product page.

## The gap, stated for the paper

The free tools practitioners use are either agency programs that implement one prescribed procedure
(PeakFQ for LP3/EMA; FLIKE aligned with ARR) or flexible statistical libraries that need programming (R,
Python). No tool found combines three things:

1. **Access**: zero-install, in-browser, offline, private, so it can be used in agencies and teaching
   settings where installing software is hard.
2. **Breadth with guidance**: many distributions and estimators compared on the same footing, with
   diagnostics done first and explained in plain language.
3. **Statistical correctness made visible**: GOF p-values calibrated for estimated parameters, several CI
   methods, the B17C procedure reproduced exactly, a published validation table, and a report that states
   every choice.

The claim of novelty should be framed as this combination, together with transparency and
reproducibility. It should not rest on any single method, since all the individual methods exist
elsewhere.
