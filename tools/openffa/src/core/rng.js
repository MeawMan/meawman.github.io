// rng.js - seedable pseudo-random numbers (xoshiro128**), so bootstraps are reproducible.
// The same seed always gives the same sequence in every browser and in Node.

function splitmix32(a) {
  return function () {
    a |= 0; a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}

export class RNG {
  constructor(seed = 12345) {
    const sm = splitmix32(seed >>> 0);
    this.s = [sm(), sm(), sm(), sm()];
    this._spare = null;
  }
  /** Uniform on [0, 1). */
  random() {
    const s = this.s;
    const rotl = (x, k) => (x << k) | (x >>> (32 - k));
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result / 4294967296;
  }
  /** Uniform on (0, 1), never exactly 0 or 1. */
  uniformOpen() { let u; do { u = this.random(); } while (u === 0); return u; }
  /** Integer in [0, n). */
  int(n) { return Math.floor(this.random() * n); }
  /** Standard normal (Box-Muller). */
  normal() {
    if (this._spare !== null) { const v = this._spare; this._spare = null; return v; }
    const u = this.uniformOpen(), v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this._spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
  /** Poisson variate (Knuth's product method; normal approximation above a mean of 500). */
  poisson(mean) {
    if (!(mean > 0)) return 0;
    if (mean > 500) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean); let k = 0, p = 1;
    do { k++; p *= this.random(); } while (p > L);
    return k - 1;
  }
  /** Resample with replacement. */
  resample(arr) {
    const n = arr.length, out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = arr[this.int(n)];
    return out;
  }
}
