# Suggested paper: outline, venue, abstract draft, figures, case study

## Title options
1. *OpenFFA: a validated, browser-based tool for at-site flood frequency analysis with L-moments, maximum likelihood and the Bulletin 17C Expected Moments Algorithm*
2. *Zero-install flood frequency analysis: design, validation and application of an open browser tool, with a case study for Bangladesh*
3. *Making flood frequency analysis transparent: diagnostics-first, bootstrap-calibrated model comparison in the browser*

## Journal fit
| Journal | Why it fits | Notes |
|---|---|---|
| **Environmental Modelling & Software** (Elsevier) | Publishes software/methods papers in hydrology with validation; high visibility | Expect a strong validation section and a real case study; a "software availability" section is required |
| **SoftwareX** (Elsevier) | Short software papers; code must be public | Fastest route; less room for the case study |
| **Journal of Open Source Software (JOSS)** | Reviews the code and documentation, not the science | Very short paper; good complement to a full paper elsewhere |
| **Journal of Hydroinformatics** (IWA) | Hydroinformatics tools, broad readership in South Asia | Open access options |
| **Hydrology** or **Water** (MDPI) | Fast, open access, many Bangladesh FFA papers | Lower prestige; check APCs |

Suggested route: a full paper in *Environmental Modelling & Software* or the *Journal of Hydroinformatics*,
with the code archived on Zenodo (DOI), and optionally a JOSS submission.

## Abstract (draft, about 250 words)
Flood frequency analysis (FFA) underpins the design of embankments, bridges, culverts and flood
forecasts. In practice, however, it is often done with agency programs that implement one prescribed
procedure, or with statistical libraries that require programming. We present OpenFFA, an open-source
FFA tool that runs entirely in a web browser, without installation or data upload, and works offline.

OpenFFA checks the record before fitting, reporting the evidence and a plain-language verdict on whether
stationary FFA is defensible. The checks cover trend (Mann-Kendall with the Hamed-Rao correction),
change points (Pettitt), serial dependence, homogeneity and low outliers (Multiple Grubbs-Beck).

It fits eleven distributions by L-moments, maximum likelihood (including censored and historic data),
moments, probability-weighted moments and the Expected Moments Algorithm (EMA) of Bulletin 17C. It ranks
them with goodness-of-fit p-values calibrated by parametric bootstrap, information criteria and the
L-moment ratio diagram, and it reports design floods with four kinds of confidence interval. Peaks over
threshold and a non-stationary GEV extend the analysis. Each run produces a reproducible project file
and an automatically written methods-and-results report.

All estimators are tested against R (lmom, extRemes, ismev, MGBT), SciPy and the Bulletin 17C worked
examples. EMA moments and design floods match USGS PeakFQ to the published precision for systematic,
low-outlier and historic-data cases. The tests also revealed inaccuracies in widely used reference
implementations and an inconsistency in one published example.

[Case-study sentence: e.g. "Applied to N BWDB stations on the Ganges-Brahmaputra-Meghna system, the
tool shows that … and that the choice of distribution changes the 100-year design discharge by X–Y %,
more than the sampling uncertainty."]

## Structure
1. **Introduction.** Why FFA matters (Bangladesh flood context, design standards). The current practice
   is fragmented: no distribution is prescribed in Bangladesh, and studies variously recommend Gumbel,
   LN, LP3, P3 or GEV. State the gap (see `GAP_ANALYSIS.md`).
2. **Methods implemented**, with equations kept brief and cited:
   * data model (intervals, perception thresholds, zeros);
   * diagnostics;
   * distributions and estimators;
   * EMA as implemented;
   * GOF with bootstrap calibration;
   * uncertainty;
   * POT;
   * non-stationary GEV.
3. **Software design**:
   * pure JavaScript numerics, with no DOM in the core;
   * Web Worker;
   * seeded RNG;
   * offline service worker;
   * guided and expert modes;
   * report generator.

   Justify JS over Pyodide: load size, offline use, maintainability (`DECISIONS.md`).
4. **Verification and validation**:
   * the reference-generation pipeline;
   * the validation table (`VALIDATION.md`, condensed);
   * the Bulletin 17C examples;
   * Coles (2001) examples;
   * the statistical calibration studies (GOF size, bootstrap coverage);
   * discrepancies found in references (`VALIDATION_NOTES.md`). This is a genuine contribution: it
     reports inaccurate default p-values in MGBT, approximation error in lmom/lmoments3, the Table 10-5
     inconsistency in B17C, and the degenerate SciPy Pearson III ML solution.
5. **Case study (Bangladesh)**: see the plan below.
6. **Discussion**:
   * model uncertainty versus sampling uncertainty;
   * when stationary FFA is not defensible;
   * bootstrap versus analytical EMA intervals;
   * limitations (`LIMITATIONS.md`);
   * use in teaching and agencies.
7. **Conclusions, software availability** (URL, DOI, licence, requirements), data availability.

## Figures
1. **Workflow and architecture**: data → checks → fit → design floods → report; core, worker and UI layers.
2. **Validation summary**: our value versus the reference, for all quantities (log-scale error
   histogram), or a table.
3. **Bulletin 17C reproduction**: frequency curves for Orestimba and Santa Cruz with PeakFQ quantiles
   overlaid.
4. **GOF calibration**: rejection rate of bootstrap versus table-based KS/AD tests under the null
   (Lilliefors effect).
5. **Case study**: L-moment ratio diagram of the Bangladesh stations.
6. **Case study**: design discharge (100-yr) by distribution and method per station, with CIs. This shows
   model versus sampling uncertainty.
7. **Case study**: a station with a trend or change point (e.g. after embankment or channel works);
   stationary versus non-stationary GEV effective return levels.
8. **Screenshot**: guided mode, the checks page.

## Case-study plan
* **Data (to obtain):** BWDB Processing & Flood Forecasting Circle / FFWC annual maximum discharge and
  water level for 5–10 long-record stations. Candidates include:
  * Bahadurabad (Brahmaputra-Jamuna);
  * Hardinge Bridge (Ganges);
  * Bhairab Bazar (Upper Meghna);
  * Kaunia/Dalia (Teesta);
  * Sherpur or Sheola (Kushiyara/Surma) in the north-east, for flash-flood behaviour;
  * a smaller river (e.g. Dharla at Kurigram).

  Record lengths at the main stations are typically 40–60 years. Use the April–March water year. Agree
  the data terms with BWDB/CEGIS, and state in the paper whether the data can be shared. If they cannot,
  publish the derived AMS only if permitted.
* **Questions:**
  1. Is stationary FFA defensible at each station (diagnostics)?
  2. Which distributions are supported? Compare with the earlier Bangladesh studies cited in the
     research brief.
  3. How large is the spread in 100-yr design floods across defensible distributions, compared with the
     CI width?
  4. For stations with low outliers, or with historic floods such as 1988 and 1998, what does B17C
     censoring or historic information change?
* **Reproducibility:** publish the project files (`.openffa.json`) for every station with the paper.
* **Public fallback** if BWDB data cannot be published: use the USGS Bulletin 17C examples, which are
  already bundled, plus one openly licensed record. The latter could be GRDC data, if licence terms
  allow, or Global Runoff Reanalysis data, clearly identified.

## Things to verify before submission
* Re-check every reference in the report generator against the original papers. Some citation details
  were written from memory; see `RESEARCH_BRIEF.md`.
* Re-check the third-party capability cells in `GAP_ANALYSIS.md` against current manuals.
* If allowed, run PeakFQ or peakfqr directly on the case-study stations and add the comparison.
