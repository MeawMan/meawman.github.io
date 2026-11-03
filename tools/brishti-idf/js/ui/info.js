/**
 * info.js — short explanations behind the “i” buttons, keyed by the exact label of a control,
 * or by '§' + the title of a section.
 * dom.js looks a label up here, so adding an entry is all it takes to document a control.
 * Keep each entry to what the option does, when to change it and what it costs. Longer background
 * belongs on the Methods screen.
 */
export const INFO = {
  // ---- data
  'Layout': 'How the file is arranged. Date-time + value suits loggers; Year/Month/1…31 is the BMD daily sheet; an annual-maximum table has one row per year and one column per duration. The tool guesses this from the header; check it.',
  'Units': 'Units of the rainfall values in the file. Everything is converted to millimetres.',
  'Values are': 'Whether the annual-maximum table holds depths (mm) or intensities (mm/h). Intensities are converted to depths with the duration.',
  'Time stamp marks': 'Whether a value’s time stamp is the end of its interval (most loggers: 10:00 means 09:00–10:00) or the start (daily totals dated by the day they fell on). A wrong choice shifts rain by one interval, which matters only for sub-daily windows that cross midnight.',
  'Day/month order': 'How dates like 03/04/2010 are read: day-month-year (Bangladesh, UK) or month-day-year (USA).',
  'Depth per tip (mm)': 'For tipping-bucket logs with one row per tip: the rain depth each tip represents (often 0.2 mm). Tips are summed into regular intervals.',
  'Time step (min)': 'The interval of the regular series built from the records. Leave it to the detected step unless the logger changed resolution.',
  'Station name': 'Shown in tables, figures and the report.',
  'Project name': 'Used for file names and in the report heading.',
  'Include data in the project file': 'Store the rainfall records in the project file so it can be reopened on another computer. Without the data, the file holds only settings and needs the original data files.',
  'Latitude': 'Decimal degrees. Used only for comparing stations and inverse-distance estimates at an ungauged point.',
  'Longitude': 'Decimal degrees. Used only for comparing stations and inverse-distance estimates at an ungauged point.',

  // ---- quality
  'Minimum coverage per year (%)': 'A year is used only if at least this share of its intervals is present. A year with long gaps may have missed its biggest storm, which biases the annual maximum low. 80% is a common default; lower it only if you check the excluded years.',
  'Year starts in': 'January gives calendar years. A hydrological year (e.g. April–March) keeps one monsoon in one year, which avoids splitting a wet season between two years.',
  'Wet-season months': 'Months where a long run of zeros is suspicious (a blocked or failed gauge). Used only for the quality warning.',
  'Zero-rain run that looks suspicious (days)': 'A run of zero rainfall this long inside the wet season is flagged as a possible blocked gauge.',
  'Set negative and implausible values to missing': 'Negative values and values above the world-record envelope for their duration are set to missing instead of being used. Every change is listed and reported.',
  'Keep years below the coverage threshold': 'Use incomplete years anyway. This adds years but risks low annual maxima from years that missed their storm.',

  // ---- annual maxima
  'Durations (min)': 'The rainfall durations to analyse. Durations shorter than the data step cannot be extracted; for daily data they are estimated on the “Short durations” screen.',
  'Windows': 'Sliding windows move one data step at a time and find the true largest total. Fixed blocks use clock intervals (e.g. 09:00–10:00) and underestimate, which is what the fixed-interval correction compensates for.',
  'Fixed-interval correction': 'Multiplies annual maxima whose window spans only one or two observation intervals (e.g. 24 h from daily data, 1 h from hourly data), because a storm split by the reading time is undercounted. 1.13 / 1.04 is the classical average; Weiss’s n/(n − 1/8) is a smooth alternative.',
  'Apply correction to the supplied table': 'Apply the fixed-interval factor to an annual-maximum table you loaded. Only do this if the table was built from fixed clock intervals.',

  // ---- frequency analysis
  'Distribution (all durations)': 'The probability distribution fitted to every duration’s annual maxima. GEV (with L-moments) is the common international choice; Gumbel is GEV with zero shape and is widely used in Bangladesh; LP3 is the US flood standard. Use the candidates table to compare, but prefer one consistent choice over the best score at each duration.',
  'Estimation method': 'L-moments are robust for the 20–40-year records typical of rainfall gauges. Maximum likelihood is efficient for long records and allows likelihood-based comparison. Method of moments is simple but sensitive to the largest values. “Shape fixed” estimates only location and scale with a shape you supply.',
  'Fixed shape k': 'Hosking’s sign convention: k < 0 is a heavy (unbounded) upper tail, k = 0 is Gumbel (or exponential for GPA), k > 0 has an upper bound. A shape estimated from one short record is very uncertain; a regional value (for example from several nearby stations) is often more reliable.',
  'Rank candidates by': 'How the candidates table is sorted. AICc and BIC penalise extra parameters (BIC more strongly); Anderson–Darling weights the tails; PPCC measures straightness on the probability plot; KS is the largest gap between the empirical and fitted distribution.',
  'Plotting position': 'Formula giving each ranked value its empirical probability, F = (i − a)/(n + 1 − 2a). Affects only the points on the probability plot and the PPCC statistic, not the fitted distribution. Gringorten is unbiased for Gumbel/GEV; Weibull is the traditional choice in Bangladeshi reports; Cunnane is a compromise.',
  'Return periods (yr)': 'Average recurrence intervals of annual maxima. Values much longer than the record (e.g. 100 yr from 20 years) are extrapolations; their uncertainty is large, as the confidence intervals show.',
  'Duration': 'Which duration the table and plots on this screen refer to.',
  'Override for this duration': 'Use a different distribution or method for this duration only. Use sparingly: switching distributions between durations can make the IDF curves cross.',
  'Replicates': 'Number of bootstrap resamples. 500 is enough for 90% intervals; more gives smoother limits but takes longer.',
  'Level (%)': 'Coverage of the confidence interval. Percentile bootstrap intervals tend to be too narrow for short records.',
  'Random seed': 'Fixes the random numbers so the same project gives the same intervals every time.',

  // ---- peaks over threshold
  'Compute peaks over threshold': 'Also analyse all independent storms above a threshold (a partial-duration series) and compare their quantiles with the annual-maximum fit.',
  'Use them for the design table': 'Replace the annual-maximum quantiles with peaks-over-threshold quantiles in the design table and the IDF equations. The Koutsoyiannis models are then skipped, because they are fitted to annual maxima.',
  'Events per year': 'Average number of peaks kept per year; it sets the threshold. 2–5 is typical. Too few wastes data; too many brings in ordinary storms that do not follow the tail model. Check the stability table.',
  'Minimum separation (h)': 'Two peaks closer than this (or than the duration) count as one storm, so that peaks are independent. 24 h suits most sub-daily and daily durations.',
  'Excess distribution': 'The generalised Pareto distribution has a shape parameter (tail weight); the exponential fixes it at zero and is steadier for short records.',
  'POT estimation': 'L-moments are robust; maximum likelihood is efficient for many peaks. Both treat the threshold as known.',

  // ---- daily to sub-daily
  'Method used for design': 'How short-duration depths are estimated from the 24-h depths of a daily-only station. Methods calibrated on a nearby station with sub-daily data performed far better than fixed formulas in the hold-out tests.',
  'Calibrate on station': 'A station in this project with sub-daily data. Its depth–duration ratios (or exponent) are transferred to this station.',
  'Exponent n (manual)': 'Exponent of P_t = P_24 (t/24)^n. The IMD formula uses n = 1/3. A value from a local study can be entered here.',
  'Scaling exponent H (manual)': 'Exponent of simple scaling: the mean annual maximum grows as duration^H. Normally estimated from a calibration station.',
  '10-yr 1-h depth for Bell (mm)': 'Bell’s generalised ratios are scaled to the 10-year 1-hour depth, which must come from somewhere else (a nearby sub-daily station or a study). Experimental.',
  'Ratio table P_t/P_24 (duration:ratio, …)': 'Your own ratios of the t-duration depth to the 24-h depth, e.g. from a published local study. Applied to all return periods.',
  'Return period': 'Which return period the comparison chart shows.',

  // ---- IDF equations
  'Time unit in equations': 'Whether t in the fitted equations is in hours or minutes. Parameter values change with the unit; the curves do not.',
  'Least squares on': 'Fitting on log intensities gives each duration similar weight; fitting on intensities lets the short, intense durations dominate.',
  'θ for Koutsoyiannis models': 'θ shifts the duration axis, i(t) ∝ 1/(t + θ)^η. It cannot be estimated without sub-hourly data, so “auto” fixes it at 0 when the shortest duration is 1 h or more.',

  // ---- curves and adjustments
  'Uplift': 'Scale the IDF values for a warmer climate: a fixed percentage, or a rate per °C of warming (about 7%/°C from the Clausius–Clapeyron relation). Use the factor your design guideline requires, if it gives one.',
  'Uplift (%)': 'Percentage increase applied to all intensities.',
  'Rate (%/°C)': 'Increase of extreme rainfall per degree of warming. 7%/°C is the Clausius–Clapeyron rate.',
  'Warming (°C)': 'Expected warming for the design horizon and scenario.',
  'Short-duration rate (%/°C)': 'Optional higher rate for short durations, where some studies find faster increases (“super-Clausius–Clapeyron”).',
  'Duration (min)': 'For the uplift: durations up to this get the short-duration rate. For a design storm: the total storm length.',
  'Linear instead of compounded': 'Apply the rate as rate × warming instead of (1 + rate)^warming.',
  'Areal reduction': 'Point IDF values overstate the average rainfall over a catchment. An areal reduction factor below 1 converts point to areal rainfall. Use a local factor where one exists.',
  'Factor': 'Constant areal reduction factor applied to all durations.',
  'Catchment area (km²)': 'Catchment area for the areal reduction formula.',
  'Use adjusted IDF': 'Build the design storm from the uplifted or area-reduced IDF instead of the baseline.',

  // ---- design storm
  'Method': 'Temporal pattern of the design storm. Alternating block and Chicago nest every shorter duration’s IDF depth inside the storm; SCS and Huff use fixed dimensionless curves from the USA.',
  'Peak position (0–1)': 'Where the peak sits in the storm: 0.5 centres it, smaller values put it earlier.',
  'SCS type': 'NRCS 24-h distribution. Type II is the most intense; none was derived for Bangladesh.',
  'Quartile': 'Huff storms are grouped by the quarter of the storm in which most rain falls.',
  'Return period (yr)': 'Return period of the design storm.',
  'Format': 'File format for the hyetograph: plain CSV, SWMM rain file or [TIMESERIES] block, or HEC-HMS.',

  // ---- figures
  'Width (cm)': 'Exported figure width.',
  'Height (cm)': 'Exported figure height.',
  'DPI': 'Resolution of PNG exports. 300 is typical for reports.',

  // ---- section headings
  '§Outlier screening': 'Grubbs–Beck test on log values, as in US Bulletin 17B: a value outside mean ± K_N·sd (10% significance) is flagged. It flags, it does not remove: an extreme storm is real data.',
  '§Trend test': 'Mann–Kendall: is there a monotonic trend over the years? A significant trend weakens the assumption that every year comes from the same distribution.',
  '§L-moment ratio diagram': 'L-skewness against L-kurtosis of each duration’s sample, with the theoretical curves of common distributions. Samples near a curve suggest that distribution; scatter is large for short records.',
  '§Probability plot': 'Ranked annual maxima at their plotting positions against the fitted curves, on a Gumbel scale where a Gumbel distribution is a straight line.',
  '§Confidence intervals': 'Bootstrap: resample whole years with replacement, refit, and take percentiles of the quantiles. Shows how much the answer could change with a different sample of years.',
  '§Goodness-of-fit p-value (parametric bootstrap)': 'A calibrated p-value for the Anderson–Darling statistic, obtained by simulating from the fitted model and refitting each sample with the same method.',
  '§Peaks over threshold': 'Partial-duration analysis: all independent storms above a threshold, a generalised Pareto fit to the excesses, and Poisson arrivals to convert to annual return periods.',
  '§Models to fit': 'Candidate IDF equations. Simpler forms with fewer parameters are less likely to fit noise; the Koutsoyiannis forms are consistent with the frequency distribution.',
  '§Comparison': 'How well each equation reproduces the design table. Look at the worst-case error as well as R²: an equation can score R² = 0.99 and still miss one duration by 15%.',
};
