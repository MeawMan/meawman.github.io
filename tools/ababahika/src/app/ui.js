// ui.js - tiny DOM helpers, toasts, icons, downloads.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
/** h('div.cls#id', {attrs, on:{click}}, ...children) */
export function h(tag, attrs, ...kids) {
  const [, t, rest] = /^([a-z0-9]+)(.*)$/i.exec(tag);
  const el = document.createElement(t);
  (rest.match(/[.#][\w-]+/g) || []).forEach((p) => (p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1))));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export function toast(msg, kind = 'info', ms = 4200) {
  const box = $('#toasts');
  const t = h(`div.toast.${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}
export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : Math.abs(v) >= 1e6 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtBytes = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' kB');
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const P = {
  plus: 'M12 5v14M5 12h14', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z', eyeoff: 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.1 6.1C3.6 7.8 2 12 2 12s4 7 10 7a10 10 0 005-1.4',
  zoom: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5', more: 'M12 5h.01M12 12h.01M12 19h.01', x: 'M6 6l12 12M18 6L6 18', layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14', home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z', info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z',
  tool: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.6-.4-.4-2.6z', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  style: 'M12 3a9 9 0 000 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.4-4-8-9-8zM7.5 12a1 1 0 100-2 1 1 0 000 2zM10.5 8a1 1 0 100-2 1 1 0 000 2zM15.5 8a1 1 0 100-2 1 1 0 000 2z',
  pointer: 'M5 3l14 8-6 2-2 6z', play: 'M6 4l14 8-14 8z', chevron: 'M6 9l6 6 6-6', globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3', upload: 'M12 21V9m0 0l-5 5m5-5l5 5M4 3h16',
};
export const icon = (n, s = 16) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('width', s); e.setAttribute('height', s); e.setAttribute('aria-hidden', 'true'); e.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`; return e; };
export const iconBtn = (n, title, on, cls = '') => h(`button.ib${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': title, on: { click: on } }, icon(n));
