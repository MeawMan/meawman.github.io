// lmoments.js - sample L-moments and probability-weighted moments (Hosking 1990).
//
// Unbiased estimators of beta_r (Landwehr et al. 1979 / Hosking 1990 eq. 2.3):
//   b_r = (1/n) sum_{i=r+1}^{n} [ (i-1)(i-2)...(i-r) / ((n-1)(n-2)...(n-r)) ] x_(i)
// L-moments: l1=b0, l2=2b1-b0, l3=6b2-6b1+b0, l4=20b3-30b2+12b1-b0.
// "pwm" estimation in this tool uses the plotting-position estimator
//   b_r = (1/n) sum p_i^r x_(i),  p_i = (i-0.35)/n   (Landwehr et al. 1979),
// which is asymptotically equivalent but differs in small samples.

import { sortedCopy } from './stats.js';

export function pwmUnbiased(x, nmom = 4) {
  const xs = sortedCopy(x), n = xs.length, b = new Array(nmom).fill(0);
  for (let r = 0; r < nmom; r++) {
    let s = 0;
    for (let i = r + 1; i <= n; i++) {
      let w = 1;
      for (let j = 1; j <= r; j++) w *= (i - j) / (n - j);
      s += w * xs[i - 1];
    }
    b[r] = s / n;
  }
  return b;
}

export function pwmPlottingPosition(x, nmom = 4, a = 0.35) {
  const xs = sortedCopy(x), n = xs.length, b = new Array(nmom).fill(0);
  for (let i = 1; i <= n; i++) {
    const p = (i - a) / n;
    for (let r = 0; r < nmom; r++) b[r] += Math.pow(p, r) * xs[i - 1] / n;
  }
  return b;
}

export function lmomFromPwm(b) {
  const l1 = b[0], l2 = 2 * b[1] - b[0];
  const l3 = b.length > 2 ? 6 * b[2] - 6 * b[1] + b[0] : NaN;
  const l4 = b.length > 3 ? 20 * b[3] - 30 * b[2] + 12 * b[1] - b[0] : NaN;
  return { l1, l2, l3, l4, t: l2 / l1, t3: l3 / l2, t4: l4 / l2 };
}

/** Sample L-moments and ratios. method 'unbiased' (default) or 'pp' (plotting position). */
export function sampleLmoments(x, method = 'unbiased') {
  const b = method === 'pp' ? pwmPlottingPosition(x) : pwmUnbiased(x);
  const l = lmomFromPwm(b);
  l.n = x.length;
  return l;
}

// Closed-form L-kurtosis of the three-parameter families (Hosking & Wallis 1997, App. A),
// checked against numerical integration in tests/lmrd.test.js.
export const tau4 = {
  GLO: (k) => (1 + 5 * k * k) / 6,
  GPA: (k) => ((1 - k) * (2 - k)) / ((3 + k) * (4 + k)),
  GEV: (k) => (5 * (1 - 4 ** -k) - 10 * (1 - 3 ** -k) + 6 * (1 - 2 ** -k)) / (1 - 2 ** -k),
};
export const tau3 = {
  GLO: (k) => -k,
  GPA: (k) => (1 - k) / (3 + k),
  GEV: (k) => 2 * (1 - 3 ** -k) / (1 - 2 ** -k) - 3,
};
