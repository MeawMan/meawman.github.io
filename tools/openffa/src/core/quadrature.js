// quadrature.js - adaptive Gauss-Kronrod (7/15 points) integration on [a, b].

const XK = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440,
  0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0];
const WK = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919,
  0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828];
const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

function gk15(f, a, b) {
  const c = 0.5 * (a + b), h = 0.5 * (b - a);
  const fc = f(c);
  let k = fc * WK[7], g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XK[j], f1 = f(c - dx), f2 = f(c + dx);
    k += WK[j] * (f1 + f2);
    if (j % 2 === 1) g += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { val: k * h, err: Math.abs((k - g) * h) };
}

/** Integrate f on [a, b] to absolute/relative tolerance tol (global adaptive bisection). */
export function adaptiveSimpsonGK(f, a, b, tol = 1e-10, maxSeg = 2000) {
  const segs = [{ a, b, ...gk15(f, a, b) }];
  for (let it = 0; it < maxSeg; it++) {
    let tot = 0, err = 0, worst = 0;
    for (let i = 0; i < segs.length; i++) { tot += segs[i].val; err += segs[i].err; if (segs[i].err > segs[worst].err) worst = i; }
    if (err <= Math.max(tol, tol * Math.abs(tot))) return tot;
    const s = segs[worst], m = 0.5 * (s.a + s.b);
    segs.splice(worst, 1, { a: s.a, b: m, ...gk15(f, s.a, m) }, { a: m, b: s.b, ...gk15(f, m, s.b) });
  }
  return segs.reduce((t, s) => t + s.val, 0);
}
