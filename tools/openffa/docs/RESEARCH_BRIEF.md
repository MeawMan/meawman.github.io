# Research brief (Phase 1), updated after validation

## Source status
**Fully opened and used:**
* Bulletin 17C (England et al. 2018, v1.1, USGS TM 4-B5): appendices 5, 6, 7 and 10, read from the PDF.
* USGS `peakfqr` 8.2.0 source (`emafit.f`, Cohn's EMA), read but not compiled. Compiling it was blocked
  as external code.
* USGS MGBT R package 1.1.8 source.
* R lmom, extRemes, ismev, trend; Python SciPy, lmoments3, pymannkendall, pyhomogeneity. All installed
  and run.

**Known only from search excerpts or abstracts**, cited as such: ARR 2019 Book 3; FEH / WINFAP (Kjeldsen &
Jones 2004 abstract); the Bangladesh studies listed below; HEC-SSP, RMC-BestFit and FLIKE capabilities.

## Practice
* **USA (Bulletin 17C):** LP3 by EMA, with MGBT for potentially influential low floods (PILFs), interval
  and perception-threshold data, and regional skew weighting. The default plotting position is Weibull
  (a = 0), with Cunnane, Gringorten and Hazen as alternatives (B17C Table 5-1).
* **Australia (ARR 2019):** no single distribution is mandated. LP3 and GEV are emphasised, and FLIKE is
  Bayesian. Sources: TUFLOW FLIKE page; abstracts from Western Sydney University.
* **UK (FEH):** GLO fitted by L-moments for single-site analysis (Kjeldsen & Jones 2004, abstract).
* **Bangladesh:** no official distribution was found in an accessible manual. Published studies disagree:
  * Rahman & Ahmed (1986, abstract) recommended EV1;
  * Ferdows (2005) reports that BWDB uses Gumbel for large projects, with LN and LP3 also used;
  * Karim & Chowdhury (abstract) eliminated LN, Gumbel and LP3;
  * Teesta at Kaunia: Pearson III fitted best (ASCE JHE, abstract);
  * NE flash floods: six distributions, 2.33-yr and 5-yr levels (ASCE JHE, abstract);
  * an L-moment regional analysis of NE Bangladesh (Water 2025, 17(12), 1771; excerpt).

  Common design return periods: 2.33 (mean annual flood), 5, 10, 25, 50 and 100 years. Hence the tool
  compares several distributions and prescribes none.
* **Water year:** April–March is used in BWDB/FFWC modelling material (seen in a JAXA presentation).
  This was not found as an official standard, so it is the default but configurable.

## What changed after validation
* **EMA bias factors:** B17C eqs. 7-4/7-5 and PeakFQ's `moms_p3` apply c2 and c3 only to the exact-value
  sums, with n = number of exact values in PeakFQ's default `bcf = 1997`. My first implementation
  applied them to all terms and was wrong for censored data.
* **Skew sign in the PDF text:** the skews −0.929 and −0.462 appear as 0.929 and 0.462 in a text
  extraction of the PDF, because the minus signs are lost. The published quantile tables confirm the
  negative values.
* See `VALIDATION_NOTES.md` for all discrepancies.

## Reference list status
The report generator cites standard references: Hosking 1990; Hosking & Wallis 1997; Hosking, Wallis &
Wood 1985; Coles 2001; Cohn et al. 1997 and 2013; Mann 1945; Kendall 1975; Hamed & Rao 1998; Sen 1968;
Pettitt 1979; Wald & Wolfowitz 1943; Lilliefors 1967; Efron & Tibshirani 1993; Akaike 1974; Hurvich &
Tsai 1989; Cunnane 1978; Griffis et al. 2004; Stedinger et al. 1993; IACWD 1982.

Their bibliographic details (volume, pages) were written from knowledge and **must be checked against
the originals** before publication. Of these, I opened only Bulletin 17C, which itself cites Cohn et al.
1997, 2001 and 2013, Griffis et al. 2004, Hirsch & Stedinger 1987 and Stedinger et al. 1993.

## Links consulted
* Bulletin 17C: https://pubs.usgs.gov/publication/tm4B5 (PDF: https://pubs.usgs.gov/tm/04/b05/tm4b5.pdf)
* USGS memo on B17C/PeakFQ: https://water.usgs.gov/admin/memo/SW/sw17.15.pdf
* USGS peakfqr: https://code.usgs.gov/water/peakfqr
* FLIKE / ARR Book 3: https://tuflow.com/products/flike/
* HEC-SSP / RMC-BestFit Q&A: https://awschool.com.au/wp-content/uploads/Fitting-the-Curve_QA-Report.pdf
* Kjeldsen & Jones 2004: https://hess.copernicus.org/articles/8/183/2004/
* Bangladesh studies:
  * https://ascelibrary.com/doi/10.1061/%28ASCE%29HE.1943-5584.0000299
  * https://ascelibrary.com/doi/10.1061/%28ASCE%29HE.1943-5584.0001760
  * https://agris.fao.org/search/ar/records/6471be6a77fd37171a6e2301
  * https://ph02.tci-thaijo.org/index.php/SciTechAsia/article/download/41576/34363/95710
  * https://www.mdpi.com/2073-4441/17/12/1771
* GOF with estimated parameters: https://arxiv.org/pdf/0803.4322
* Pyodide size: https://lwn.net/Articles/855875
