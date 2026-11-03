/**
 * rng.js — seedable pseudo-random numbers (xoshiro128**), so that every
 * bootstrap / optimiser run is exactly reproducible from a stored seed.
 * Not for cryptography.
 */

/** splitmix32: turns one 32-bit integer into a stream used to seed xoshiro. */
function splitmix32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad) >>> 0;
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97) >>> 0;
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  /** @param {number} seed any finite number (integer part used) */
  constructor(seed = 12345) {
    const sm = splitmix32(Math.floor(seed));
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]);
    this._spare = null;
    // warm up
    for (let i = 0; i < 8; i++) this.nextUint32();
  }

  /** Next raw 32-bit unsigned integer. */
  nextUint32() {
    const s = this.s;
    const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform on [0, 1) with 32-bit resolution (never exactly 1). */
  uniform() {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform on (0, 1): safe for log() and quantile functions. */
  uniformOpen() {
    return (this.nextUint32() + 0.5) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.uniform() * n);
  }

  /** Standard normal (Box-Muller, caches the spare value). */
  normal() {
    if (this._spare !== null) { const v = this._spare; this._spare = null; return v; }
    const u = this.uniformOpen();
    const v = this.uniformOpen();
    const r = Math.sqrt(-2 * Math.log(u));
    this._spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Exponential with the given mean. */
  exponential(mean = 1) {
    return -mean * Math.log(this.uniformOpen());
  }

  /** Draw n values with replacement from array x. */
  resample(x) {
    const n = x.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = x[this.int(n)];
    return out;
  }

  /** Poisson variate (Knuth for small mean, normal approximation above 60). */
  poisson(mean) {
    if (mean > 60) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do { k++; p *= this.uniform(); } while (p > L);
    return k - 1;
  }
}
