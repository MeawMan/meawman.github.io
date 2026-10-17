/* Hydro ML Studio — tiny SVG charts (line with hover + drag-to-zoom, scatter, bars, histogram, heatmap).
   Colours are resolved from CSS variables at draw time so exported SVG/PNG files look right. */
(function (root) {
  'use strict';
  const HC = {};
  const NS = 'http://www.w3.org/2000/svg';
  const css = (v, fb) => (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb);
  HC.css = css;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtN = (v) => {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3);
  };
  HC.fmtN = fmtN;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtD = (ms, full) => { const t = new Date(ms); return full ? t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear() : MONTHS[t.getUTCMonth()] + ' ' + String(t.getUTCFullYear()).slice(2); };
  HC.fmtD = fmtD;

  function nice(min, max, n) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(12));
    return { lo, hi, ticks };
  }
  function timeTicks(a, b, n) {
    const D = 86400000, spanD = (b - a) / D;
    const steps = [[1, 'd'], [2, 'd'], [7, 'd'], [14, 'd'], [1, 'm'], [2, 'm'], [3, 'm'], [6, 'm'], [1, 'y'], [2, 'y'], [5, 'y'], [10, 'y']];
    const pick = steps.find(([k, u]) => spanD / (u === 'd' ? k : u === 'm' ? k * 30.4 : k * 365.25) <= n) || [20, 'y'];
    const out = [], t = new Date(a);
    let cur;
    if (pick[1] === 'd') cur = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    else if (pick[1] === 'm') cur = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (t.getUTCMonth() % pick[0]), 1);
    else cur = Date.UTC(t.getUTCFullYear() - (t.getUTCFullYear() % pick[0]), 0, 1);
    while (cur <= b) {
      if (cur >= a) out.push(cur);
      const c = new Date(cur);
      cur = pick[1] === 'd' ? cur + pick[0] * D : pick[1] === 'm' ? Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + pick[0], 1) : Date.UTC(c.getUTCFullYear() + pick[0], 0, 1);
    }
    return { ticks: out, unit: pick[1] };
  }
  const tickLabel = (ms, unit) => { const t = new Date(ms); return unit === 'y' ? String(t.getUTCFullYear()) : unit === 'm' ? fmtD(ms) : t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()]; };

  function frame(el, h) {
    const W = Math.max(280, el.clientWidth || 600), H = h || 300;
    el.innerHTML = '';
    el.style.position = 'relative';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('font-family', "'JetBrains Mono', Consolas, monospace"); svg.setAttribute('font-size', '11');
    svg.classList.add('hc');
    el.appendChild(svg);
    return { svg, W, H };
  }
  const add = (svg, html) => svg.insertAdjacentHTML('beforeend', html);
  function tipEl(el) { const t = document.createElement('div'); t.className = 'hc-tip'; t.hidden = true; el.appendChild(t); return t; }

  // Keep at most ~2 points per pixel (min + max per bucket) so long records stay fast
  function decimate(xs, ys, x0, x1, px) {
    const n = xs.length, outX = [], outY = [];
    if (n <= px * 2) { for (let i = 0; i < n; i++) if (xs[i] >= x0 && xs[i] <= x1) { outX.push(xs[i]); outY.push(ys[i]); } return [outX, outY]; }
    const bw = (x1 - x0) / px;
    let b = -1, mi = -1, ma = -1;
    const flush = () => { if (mi < 0) return; const a = Math.min(mi, ma), c = Math.max(mi, ma); outX.push(xs[a]); outY.push(ys[a]); if (c !== a) { outX.push(xs[c]); outY.push(ys[c]); } };
    for (let i = 0; i < n; i++) {
      const x = xs[i]; if (x < x0 || x > x1) continue;
      const bb = Math.floor((x - x0) / bw);
      if (bb !== b) { flush(); b = bb; mi = ma = -1; }
      const y = ys[i]; if (!isFinite(y)) { flush(); mi = ma = -1; outX.push(x); outY.push(NaN); continue; }
      if (mi < 0 || y < ys[mi]) mi = i; if (ma < 0 || y > ys[ma]) ma = i;
    }
    flush();
    return [outX, outY];
  }

  // ---------------------------------------------------------------- line chart
  HC.line = function (el, o) {
    const { svg, W, H } = frame(el, o.height);
    const m = { l: 56, r: 14, t: 14, b: 30 };
    const series = o.series.filter((s) => s.x.length);
    if (!series.length) { add(svg, '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="' + css('--dim', '#888') + '">No data</text>'); return; }
    let xmin = Infinity, xmax = -Infinity;
    for (const s of series) { if (s.x[0] < xmin) xmin = s.x[0]; if (s.x[s.x.length - 1] > xmax) xmax = s.x[s.x.length - 1]; }
    if (o.domain) { xmin = o.domain[0]; xmax = o.domain[1]; }
    let ymin = Infinity, ymax = -Infinity;
    for (const s of series) for (let i = 0; i < s.x.length; i++) { const x = s.x[i], y = s.y[i]; if (x < xmin || x > xmax || !isFinite(y)) continue; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    if (o.yZero && ymin > 0) ymin = 0;
    const ny = nice(ymin, ymax, Math.max(3, Math.round(H / 60)));
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = (v) => m.l + ((v - xmin) / (xmax - xmin || 1)) * pw, Y = (v) => m.t + ph - ((v - ny.lo) / (ny.hi - ny.lo || 1)) * ph;
    const grid = css('--line', '#223'), dim = css('--dim', '#889'), ink = css('--strong', '#eee');
    let g = '';
    for (const t of ny.ticks) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="' + grid + '"/><text x="' + (m.l - 6) + '" y="' + (Y(t) + 3.5).toFixed(1) + '" text-anchor="end" fill="' + dim + '">' + fmtN(t) + '</text>';
    if (o.xTime !== false) {
      const tt = timeTicks(xmin, xmax, Math.max(3, Math.round(pw / 90)));
      for (const t of tt.ticks) g += '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + grid + '" stroke-dasharray="2 4"/><text x="' + X(t).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + dim + '">' + tickLabel(t, tt.unit) + '</text>';
    } else {
      const nx = nice(xmin, xmax, Math.max(3, Math.round(pw / 80)));
      for (const t of nx.ticks) if (t >= xmin && t <= xmax) g += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + dim + '">' + fmtN(t) + '</text>';
    }
    if (o.yLabel) g += '<text x="' + m.l + '" y="' + (m.t - 2) + '" fill="' + dim + '" font-size="10">' + esc(o.yLabel) + '</text>';
    for (const sh of o.shade || []) {
      const a = Math.max(xmin, sh.from), b = Math.min(xmax, sh.to);
      if (b > a) g += '<rect x="' + X(a).toFixed(1) + '" y="' + m.t + '" width="' + (X(b) - X(a)).toFixed(1) + '" height="' + ph + '" fill="' + (sh.color || css('--accent', '#0cf')) + '" opacity="' + (sh.opacity || 0.07) + '"/>' +
        (sh.label ? '<text x="' + (X(a) + 6).toFixed(1) + '" y="' + (m.t + 12) + '" fill="' + dim + '" font-size="10">' + esc(sh.label) + '</text>' : '');
    }
    for (const v of o.vlines || []) if (v.x >= xmin && v.x <= xmax) g += '<line x1="' + X(v.x).toFixed(1) + '" x2="' + X(v.x).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + (v.color || dim) + '" stroke-dasharray="4 3"/>';
    if (o.hline != null && o.hline >= ny.lo && o.hline <= ny.hi) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(o.hline).toFixed(1) + '" y2="' + Y(o.hline).toFixed(1) + '" stroke="' + dim + '"/>';
    for (const s of series) {
      const [dx, dy] = decimate(s.x, s.y, xmin, xmax, pw);
      let d = '', pen = false;
      for (let i = 0; i < dx.length; i++) {
        if (!isFinite(dy[i])) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(dx[i]).toFixed(1) + ' ' + Y(dy[i]).toFixed(1); pen = true;
      }
      if (s.dots) {
        for (let i = 0; i < dx.length; i++) if (isFinite(dy[i])) g += '<circle cx="' + X(dx[i]).toFixed(1) + '" cy="' + Y(dy[i]).toFixed(1) + '" r="' + (s.r || 1.8) + '" fill="' + s.color + '"/>';
      } else {
        g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 1.5) + '" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + (s.opacity ? ' opacity="' + s.opacity + '"' : '') + '/>';
      }
    }
    add(svg, g);
    add(svg, '<line class="hc-x" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + dim + '" stroke-dasharray="3 3" visibility="hidden"/><rect class="hc-brush" y="' + m.t + '" height="' + ph + '" fill="' + css('--accent', '#0cf') + '" opacity=".15" visibility="hidden"/>');
    // legend
    if (o.legend !== false && series.length > 1) {
      const lg = document.createElement('div'); lg.className = 'hc-legend';
      lg.innerHTML = series.filter((s) => !s.noLegend).map((s) => '<span><i style="background:' + s.color + (s.dash ? ';opacity:.7' : '') + '"></i>' + esc(s.name) + '</span>').join('');
      el.appendChild(lg);
    }
    // hover + zoom
    const tip = tipEl(el), xl = svg.querySelector('.hc-x'), br = svg.querySelector('.hc-brush');
    const ref = series[0];
    const toX = (e) => { const r = svg.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
    let drag = null;
    svg.addEventListener('pointermove', (e) => {
      const px = toX(e);
      if (drag != null) { const a = Math.min(drag, px), b = Math.max(drag, px); br.setAttribute('x', a); br.setAttribute('width', b - a); br.setAttribute('visibility', 'visible'); return; }
      if (px < m.l || px > W - m.r) { tip.hidden = true; xl.setAttribute('visibility', 'hidden'); return; }
      const xv = xmin + ((px - m.l) / pw) * (xmax - xmin);
      let lo = 0, hi = ref.x.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ref.x[mid] < xv) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(ref.x[lo - 1] - xv) < Math.abs(ref.x[lo] - xv)) lo--;
      const xr = ref.x[lo];
      xl.setAttribute('x1', X(xr)); xl.setAttribute('x2', X(xr)); xl.setAttribute('visibility', 'visible');
      const rows = series.filter((s) => !s.noTip).map((s) => {
        let k = s === ref ? lo : -1;
        if (k < 0) { let a = 0, b = s.x.length - 1; while (a < b) { const mid = (a + b) >> 1; if (s.x[mid] < xr) a = mid + 1; else b = mid; } k = s.x[a] === xr ? a : -1; }
        return k < 0 ? '' : '<div><i style="background:' + s.color + '"></i>' + esc(s.name) + ' <b>' + fmtN(s.y[k]) + '</b></div>';
      }).join('');
      tip.innerHTML = '<div class="hc-tip-h">' + (o.xTime === false ? fmtN(xr) : fmtD(xr, true)) + '</div>' + rows;
      tip.hidden = false;
      const rect = svg.getBoundingClientRect(), left = (X(xr) / W) * rect.width;
      tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
      tip.style.top = '8px';
    });
    svg.addEventListener('pointerleave', () => { if (drag == null) { tip.hidden = true; xl.setAttribute('visibility', 'hidden'); } });
    if (o.zoom !== false) {
      svg.style.cursor = 'crosshair';
      svg.addEventListener('pointerdown', (e) => { drag = toX(e); svg.setPointerCapture(e.pointerId); tip.hidden = true; });
      svg.addEventListener('pointerup', (e) => {
        if (drag == null) return;
        const a = Math.min(drag, toX(e)), b = Math.max(drag, toX(e)); drag = null; br.setAttribute('visibility', 'hidden');
        if (b - a > 8 && o.onZoom) o.onZoom([xmin + ((a - m.l) / pw) * (xmax - xmin), xmin + ((b - m.l) / pw) * (xmax - xmin)]);
      });
      svg.addEventListener('dblclick', () => o.onZoom && o.onZoom(null));
    }
  };

  // ---------------------------------------------------------------- scatter with 1:1 line and fit
  HC.scatter = function (el, o) {
    const { svg, W, H } = frame(el, o.height || 340);
    const m = { l: 56, r: 16, t: 16, b: 38 };
    const xs = o.x, ys = o.y;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < xs.length; i++) { lo = Math.min(lo, xs[i], ys[i]); hi = Math.max(hi, xs[i], ys[i]); }
    const n = nice(lo, hi, 5), pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = (v) => m.l + ((v - n.lo) / (n.hi - n.lo)) * pw, Y = (v) => m.t + ph - ((v - n.lo) / (n.hi - n.lo)) * ph;
    const grid = css('--line', '#223'), dim = css('--dim', '#889');
    let g = '';
    for (const t of n.ticks) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="' + grid + '"/><text x="' + (m.l - 6) + '" y="' + (Y(t) + 3.5) + '" text-anchor="end" fill="' + dim + '">' + fmtN(t) + '</text><text x="' + X(t) + '" y="' + (H - 20) + '" text-anchor="middle" fill="' + dim + '">' + fmtN(t) + '</text>';
    g += '<text x="' + (m.l + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" fill="' + dim + '" font-size="10">' + esc(o.xLabel || 'Observed') + '</text>';
    g += '<text x="' + m.l + '" y="' + (m.t - 4) + '" fill="' + dim + '" font-size="10">' + esc(o.yLabel || 'Predicted') + '</text>';
    const step = Math.max(1, Math.floor(xs.length / 4000));
    for (let i = 0; i < xs.length; i += step) g += '<circle cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="2.2" fill="' + o.color + '" opacity=".45"/>';
    g += '<line x1="' + X(n.lo) + '" y1="' + Y(n.lo) + '" x2="' + X(n.hi) + '" y2="' + Y(n.hi) + '" stroke="' + dim + '" stroke-dasharray="5 4"/><text x="' + (X(n.hi) - 4) + '" y="' + (Y(n.hi) + 14) + '" text-anchor="end" fill="' + dim + '" font-size="10">1:1</text>';
    // least-squares fit
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const N = xs.length;
    for (let i = 0; i < N; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const slope = (N * sxy - sx * sy) / (N * sxx - sx * sx || 1), icpt = (sy - slope * sx) / N;
    g += '<line x1="' + X(n.lo) + '" y1="' + Y(icpt + slope * n.lo) + '" x2="' + X(n.hi) + '" y2="' + Y(icpt + slope * n.hi) + '" stroke="' + o.color + '" stroke-width="1.6"/>';
    g += '<text x="' + (m.l + 8) + '" y="' + (m.t + 14) + '" fill="' + css('--strong', '#eee') + '" font-size="11">y = ' + fmtN(slope) + 'x ' + (icpt >= 0 ? '+ ' : '− ') + fmtN(Math.abs(icpt)) + (o.note ? '   ' + esc(o.note) : '') + '</text>';
    add(svg, g);
  };

  // ---------------------------------------------------------------- horizontal bars
  HC.bars = function (el, o) {
    const n = o.labels.length, rowH = o.rowH || 22;
    const { svg, W } = frame(el, Math.max(80, n * rowH + 26));
    const lw = Math.min(260, Math.max(90, Math.max(...o.labels.map((l) => l.length)) * 7 + 10));
    const vmax = Math.max(...o.values.map((v) => Math.abs(v)), 1e-12), hasNeg = o.values.some((v) => v < 0);
    const pw = W - lw - 70, zero = hasNeg ? lw + pw / 2 : lw;
    const sc = hasNeg ? pw / 2 / vmax : pw / vmax;
    const dim = css('--dim', '#889'), ink = css('--fg', '#ccc');
    let g = '';
    o.labels.forEach((l, i) => {
      const v = o.values[i], y = 10 + i * rowH, w = Math.abs(v) * sc, x = v >= 0 ? zero : zero - w;
      const col = typeof o.color === 'function' ? o.color(v, i) : o.color;
      g += '<text x="' + (lw - 8) + '" y="' + (y + rowH / 2 + 3) + '" text-anchor="end" fill="' + ink + '">' + esc(l) + '</text>' +
        '<rect x="' + x.toFixed(1) + '" y="' + (y + 3) + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + (rowH - 8) + '" rx="2" fill="' + col + '"/>' +
        '<text x="' + ((v >= 0 ? x + w : x) + (v >= 0 ? 6 : -6)).toFixed(1) + '" y="' + (y + rowH / 2 + 3) + '" text-anchor="' + (v >= 0 ? 'start' : 'end') + '" fill="' + dim + '">' + (o.fmt ? o.fmt(v) : fmtN(v)) + '</text>';
    });
    if (hasNeg) g += '<line x1="' + zero + '" x2="' + zero + '" y1="6" y2="' + (10 + n * rowH) + '" stroke="' + dim + '"/>';
    add(svg, g);
  };

  // ---------------------------------------------------------------- vertical bars (e.g. monthly skill)
  HC.columns = function (el, o) {
    const { svg, W, H } = frame(el, o.height || 260);
    const m = { l: 50, r: 10, t: 16, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const vals = o.values.filter(isFinite), ny = nice(Math.min(0, ...vals), Math.max(...vals, o.min != null ? o.min : 0), 4);
    const Y = (v) => m.t + ph - ((v - ny.lo) / (ny.hi - ny.lo || 1)) * ph, bw = pw / o.labels.length;
    const grid = css('--line', '#223'), dim = css('--dim', '#889');
    let g = '';
    for (const t of ny.ticks) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="' + grid + '"/><text x="' + (m.l - 6) + '" y="' + (Y(t) + 3.5) + '" text-anchor="end" fill="' + dim + '">' + fmtN(t) + '</text>';
    o.labels.forEach((l, i) => {
      const v = o.values[i], x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
      if (isFinite(v)) { const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); g += '<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y1 - y0).toFixed(1) + '" rx="2" fill="' + (typeof o.color === 'function' ? o.color(v) : o.color) + '"><title>' + esc(l) + ': ' + fmtN(v) + '</title></rect>'; }
      g += '<text x="' + (m.l + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + dim + '">' + esc(l) + '</text>';
    });
    if (o.yLabel) g += '<text x="' + m.l + '" y="' + (m.t - 4) + '" fill="' + dim + '" font-size="10">' + esc(o.yLabel) + '</text>';
    add(svg, g);
  };

  // ---------------------------------------------------------------- histogram
  HC.hist = function (el, o) {
    const v = o.values.filter(isFinite);
    if (!v.length) { frame(el, 120); return; }
    const k = o.bins || 30;
    let lo = Math.min(...v), hi = Math.max(...v); if (lo === hi) { lo -= 1; hi += 1; }
    const counts = new Array(k).fill(0), bw = (hi - lo) / k;
    for (const x of v) counts[Math.min(k - 1, Math.floor((x - lo) / bw))]++;
    const { svg, W, H } = frame(el, o.height || 220);
    const m = { l: 44, r: 10, t: 12, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b, cmax = Math.max(...counts);
    const dim = css('--dim', '#889'), grid = css('--line', '#223');
    let g = '';
    counts.forEach((c, i) => { const h = (c / cmax) * ph; g += '<rect x="' + (m.l + (i * pw) / k + 0.5).toFixed(1) + '" y="' + (m.t + ph - h).toFixed(1) + '" width="' + Math.max(1, pw / k - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + o.color + '" opacity=".8"/>'; });
    const nx = nice(lo, hi, 5);
    for (const t of nx.ticks) if (t >= lo && t <= hi) g += '<text x="' + (m.l + ((t - lo) / (hi - lo)) * pw).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + dim + '">' + fmtN(t) + '</text>';
    if (lo < 0 && hi > 0) { const zx = m.l + ((0 - lo) / (hi - lo)) * pw; g += '<line x1="' + zx + '" x2="' + zx + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + dim + '" stroke-dasharray="4 3"/>'; }
    g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph) + '" stroke="' + grid + '"/>';
    if (o.xLabel) g += '<text x="' + m.l + '" y="' + (m.t - 2) + '" fill="' + dim + '" font-size="10">' + esc(o.xLabel) + '</text>';
    add(svg, g);
  };

  // ---------------------------------------------------------------- correlation heatmap
  HC.heatmap = function (el, o) {
    const n = o.labels.length, lw = Math.min(170, Math.max(...o.labels.map((l) => l.length)) * 7 + 12);
    const W0 = Math.max(280, el.clientWidth || 500), cell = Math.max(14, Math.min(44, (W0 - lw - 10) / n));
    const { svg } = frame(el, lw + n * cell + 6);
    const pos = css('--accent', '#0cf'), neg = css('--hi', '#f84'), dim = css('--fg', '#ccc');
    let g = '';
    for (let i = 0; i < n; i++) {
      g += '<text x="' + (lw - 6) + '" y="' + (i * cell + cell / 2 + 4) + '" text-anchor="end" fill="' + dim + '" font-size="10">' + esc(o.labels[i]) + '</text>';
      g += '<text transform="translate(' + (lw + i * cell + cell / 2 + 3) + ',' + (n * cell + 6) + ') rotate(-55)" text-anchor="end" fill="' + dim + '" font-size="10">' + esc(o.labels[i]) + '</text>';
      for (let j = 0; j < n; j++) {
        const v = o.matrix[i][j], a = isFinite(v) ? Math.min(1, Math.abs(v)) : 0;
        g += '<rect x="' + (lw + j * cell) + '" y="' + i * cell + '" width="' + (cell - 1) + '" height="' + (cell - 1) + '" rx="2" fill="' + (v >= 0 ? pos : neg) + '" opacity="' + (0.08 + a * 0.85).toFixed(2) + '"><title>' + esc(o.labels[i] + ' × ' + o.labels[j]) + ': r = ' + (isFinite(v) ? v.toFixed(2) : '—') + '</title></rect>';
        if (cell >= 30) g += '<text x="' + (lw + j * cell + cell / 2) + '" y="' + (i * cell + cell / 2 + 4) + '" text-anchor="middle" font-size="9" fill="' + (a > 0.55 ? '#06080f' : dim) + '">' + (isFinite(v) ? v.toFixed(2) : '') + '</text>';
      }
    }
    svg.setAttribute('height', lw + n * cell);
    svg.setAttribute('viewBox', '0 0 ' + svg.getAttribute('width') + ' ' + (n * cell + lw));
    add(svg, g);
  };

  // ---------------------------------------------------------------- export
  HC.svgOf = function (el, title) {
    const svg = el.querySelector('svg.hc');
    if (!svg) return null;
    const c = svg.cloneNode(true), W = +svg.getAttribute('width'), H = +svg.getAttribute('height');
    c.setAttribute('xmlns', NS);
    c.insertAdjacentHTML('afterbegin', '<rect width="100%" height="100%" fill="' + css('--panel', '#fff') + '"/>');
    c.querySelectorAll('.hc-x,.hc-brush').forEach((n) => n.remove());
    const legend = el.querySelector('.hc-legend');
    let extra = 0;
    if (legend || title) {
      // title, then legend entries flowing onto extra rows when they do not fit the width
      const put = []; let x = 10, row = 0;
      if (title) { put.push({ title, x: 10, row: 0 }); x = 20 + title.length * 7.5; }
      if (legend) legend.querySelectorAll('span').forEach((s) => {
        const w = 30 + s.textContent.length * 7;
        if (x + w > W - 6 && x > 10) { row++; x = 10; }
        put.push({ col: s.querySelector('i').style.background, text: s.textContent, x, row }); x += w;
      });
      extra = 12 + (row + 1) * 16;
      c.setAttribute('height', H + extra); c.setAttribute('viewBox', '0 -' + extra + ' ' + W + ' ' + (H + extra));
      const items = put.map((p) => {
        const y = -extra + 17 + p.row * 16;
        return p.title ? '<text x="10" y="' + (y + 1) + '" fill="' + css('--strong', '#000') + '" font-size="12" font-weight="700">' + esc(p.title) + '</text>'
          : '<rect x="' + p.x + '" y="' + (y - 6) + '" width="12" height="4" fill="' + p.col + '"/><text x="' + (p.x + 16) + '" y="' + y + '" fill="' + css('--fg', '#333') + '" font-size="11">' + esc(p.text) + '</text>';
      }).join('');
      c.insertAdjacentHTML('afterbegin', '<rect y="-' + extra + '" width="100%" height="' + extra + '" fill="' + css('--panel', '#fff') + '"/>' + items);
    }
    return { text: new XMLSerializer().serializeToString(c), W, H: H + extra };
  };
  // PNG of the chart in el (2× resolution); resolves to a Blob, or null if there is no chart
  HC.pngBlob = function (el, title) {
    const s = HC.svgOf(el, title); if (!s) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(new Blob([s.text], { type: 'image/svg+xml' }));
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = s.W * 2; cv.height = s.H * 2;
        const x = cv.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG failed')); };
      img.src = url;
    });
  };
  HC.savePng = function (el, name, title) {
    HC.pngBlob(el, title).then((b) => { if (b) HIO.download(b, name + '.png'); })
      .catch(() => { const s = HC.svgOf(el, title); if (s) HIO.download(new Blob([s.text], { type: 'image/svg+xml' }), name + '.svg'); });
  };
  HC.saveSvg = function (el, name, title) { const s = HC.svgOf(el, title); if (s) HIO.download(new Blob([s.text], { type: 'image/svg+xml' }), name + '.svg'); };

  root.HC = HC;
})(typeof self !== 'undefined' ? self : this);
