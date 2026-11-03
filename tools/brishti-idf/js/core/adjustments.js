/**
 * adjustments.js — climate-change uplift and areal reduction factors (ARF), applied to design depths.
 * Both are applied as multipliers on the baseline IDF; the UI always shows baseline and adjusted together.
 */

/**
 * Climate-change uplift factor for duration dMin.
 * modes:
 *  'percent'   : constant uplift, e.g. 20 (%)
 *  'perDegree' : Clausius-Clapeyron-type scaling with rate r (%/degC, default 7) and warming dT (degC);
 *                compounding (1 + r)^dT (default) or linear 1 + r dT. Optionally a different rate for short
 *                durations ("super-CC"), interpolated in log-duration between `shortDuration` and 24 h.
 * The ~7%/degC rate is the thermodynamic Clausius-Clapeyron expectation; sub-daily extremes have shown
 * super-CC rates in some regions but not everywhere (Martinkova & Kysely 2020; Fowler et al. 2021).
 */
export function upliftFactor(dMin, cfg) {
  if (!cfg || cfg.mode === 'none') return 1;
  if (cfg.mode === 'percent') return 1 + (cfg.percent ?? 0) / 100;
  if (cfg.mode === 'perDegree') {
    const dT = cfg.warming ?? 0;
    let rate = (cfg.rate ?? 7) / 100;
    if (cfg.shortRate != null) {
      const ds = cfg.shortDuration ?? 60;
      const rs = cfg.shortRate / 100;
      if (dMin <= ds) rate = rs;
      else if (dMin < 1440) {
        const w = Math.log(dMin / ds) / Math.log(1440 / ds);
        rate = rs + w * (rate - rs);
      }
    }
    return cfg.linear ? 1 + rate * dT : Math.pow(1 + rate, dT);
  }
  if (cfg.mode === 'table') return cfg.table?.[dMin] ?? 1;
  return 1;
}

/**
 * Areal reduction factor.
 * modes:
 *  'constant'   : user value (e.g. from a local study or the relevant design guideline)
 *  'table'      : user table by duration
 *  'leclerc'    : EXPERIMENTAL — Leclerc & Schaake (1972) fit to US Weather Bureau TP-29 curves:
 *                 ARF = 1 - exp(-1.1 t^0.25) + exp(-1.1 t^0.25 - 0.01 A), t in hours, A in square miles.
 *                 Coefficients recalled (not verified from an opened source); derived for the USA;
 *                 not validated for Bangladesh.
 */
export function arfFactor(dMin, cfg) {
  if (!cfg || cfg.mode === 'none') return 1;
  if (cfg.mode === 'constant') return cfg.value ?? 1;
  if (cfg.mode === 'table') return cfg.table?.[dMin] ?? 1;
  if (cfg.mode === 'leclerc') {
    const t = dMin / 60;
    const Ami = (cfg.areaKm2 ?? 0) / 2.589988;
    const e = 1.1 * Math.pow(t, 0.25);
    return Math.min(1, 1 - Math.exp(-e) + Math.exp(-e - 0.01 * Ami));
  }
  return 1;
}

/** Combined multiplier. */
export function adjustmentFactor(dMin, climate, arf) {
  return upliftFactor(dMin, climate) * arfFactor(dMin, arf);
}
