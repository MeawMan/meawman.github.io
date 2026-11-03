// palettes.js - class schemes for common land-cover / soil products, colour ramps.

export const SCHEMES = {
  worldcover: {
    name: 'ESA WorldCover (10 m)',
    classes: [[10, 'Tree cover', '#006400'], [20, 'Shrubland', '#ffbb22'], [30, 'Grassland', '#ffff4c'], [40, 'Cropland', '#f096ff'],
      [50, 'Built-up', '#fa0000'], [60, 'Bare / sparse vegetation', '#b4b4b4'], [70, 'Snow and ice', '#f0f0f0'], [80, 'Permanent water bodies', '#0064c8'],
      [90, 'Herbaceous wetland', '#0096a0'], [95, 'Mangroves', '#00cf75'], [100, 'Moss and lichen', '#fae6a0']],
  },
  esri: {
    name: 'Esri Land Cover (Sentinel-2 10 m)',
    classes: [[1, 'Water', '#1a5bab'], [2, 'Trees', '#358221'], [4, 'Flooded vegetation', '#87d19e'], [5, 'Crops', '#ffdb5c'],
      [7, 'Built area', '#ed022a'], [8, 'Bare ground', '#ede9e4'], [9, 'Snow / ice', '#f2faff'], [10, 'Clouds', '#c8c8c8'], [11, 'Rangeland', '#c6ad8d']],
  },
  dynamicworld: {
    name: 'Google Dynamic World',
    classes: [[0, 'Water', '#419bdf'], [1, 'Trees', '#397d49'], [2, 'Grass', '#88b053'], [3, 'Flooded vegetation', '#7a87c6'], [4, 'Crops', '#e49635'],
      [5, 'Shrub and scrub', '#dfc35a'], [6, 'Built', '#c4281b'], [7, 'Bare', '#a59b8f'], [8, 'Snow and ice', '#b39fe1']],
  },
  usda: {
    name: 'USDA soil texture (12 classes, OpenLandMap order)',
    classes: [[1, 'Clay', '#d5c36b'], [2, 'Silty clay', '#b96947'], [3, 'Sandy clay', '#9d3706'], [4, 'Clay loam', '#ae868f'], [5, 'Silty clay loam', '#f86714'],
      [6, 'Sandy clay loam', '#46d143'], [7, 'Loam', '#368f20'], [8, 'Silt loam', '#3e5a14'], [9, 'Sandy loam', '#ffd557'], [10, 'Silt', '#fff72e'],
      [11, 'Loamy sand', '#ff5a9d'], [12, 'Sand', '#ff005b']],
  },
};

const QUAL = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
export const qualColor = (i) => QUAL[i % QUAL.length];

/** Pick the scheme whose class values contain all values present (best match), or null. */
export function guessScheme(values) {
  let best = null, bestScore = 0;
  for (const [key, s] of Object.entries(SCHEMES)) {
    const set = new Set(s.classes.map((c) => c[0]));
    const hit = values.filter((v) => set.has(v)).length;
    if (hit === values.length && values.length >= 2) { const score = hit / s.classes.length + (key === 'usda' ? -0.2 : 0); if (score > bestScore) { best = key; bestScore = score; } }
  }
  return best;
}
/** Class table [{value, name, color}] for a list of values, from a scheme or automatic colours. */
export function classTable(values, schemeKey) {
  const s = schemeKey && SCHEMES[schemeKey];
  const lut = new Map(s ? s.classes.map((c) => [c[0], c]) : []);
  return values.map((v, i) => { const c = lut.get(v); return { value: v, name: c ? c[1] : `Class ${v}`, color: c ? c[2] : qualColor(i) }; });
}

// Continuous ramps: arrays of [t, r, g, b]
export const RAMPS = {
  terrain: [[0, 38, 115, 77], [0.2, 104, 168, 86], [0.4, 214, 206, 139], [0.6, 191, 142, 86], [0.8, 150, 110, 90], [1, 245, 245, 245]],
  slope: [[0, 56, 168, 0], [0.25, 176, 224, 0], [0.5, 255, 225, 0], [0.75, 255, 115, 0], [1, 200, 0, 0]],
  viridis: [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]],
  greys: [[0, 20, 20, 20], [1, 245, 245, 245]],
  blues: [[0, 239, 243, 255], [0.5, 107, 174, 214], [1, 8, 69, 148]],
};
export function rampColor(ramp, t) {
  const r = RAMPS[ramp] || RAMPS.viridis; t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < r.length; i++) if (t <= r[i][0]) {
    const a = r[i - 1], b = r[i], f = (t - a[0]) / (b[0] - a[0] || 1);
    return [a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), a[3] + f * (b[3] - a[3])];
  }
  const l = r[r.length - 1]; return [l[1], l[2], l[3]];
}
export const rampCss = (ramp) => `linear-gradient(90deg,${(RAMPS[ramp] || RAMPS.viridis).map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${s[0] * 100}%`).join(',')})`;
export const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
