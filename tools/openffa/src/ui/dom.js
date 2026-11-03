// dom.js - tiny DOM helpers (no framework) and number formatting.

/** Create an element: h('div', {class: 'x', onclick: fn}, child, 'text', ...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a number to n significant figures without exponent for normal magnitudes. */
export function fmt(v, sig = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(sig - 1);
  if (a >= 10 ** sig) return Math.round(v).toLocaleString('en-US');
  const s = Number(v.toPrecision(sig));
  return a >= 1000 ? s.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(s);
}
export const fmtP = (p) => (p === null || p === undefined || !Number.isFinite(p) ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));

let toastTimer;
export function toast(msg, ms = 3500) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  const live = document.getElementById('live'); if (live) live.textContent = msg;
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Simple table from an array of row arrays. */
export function table(head, rows, { classes = [], rowAttrs = () => ({}) } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: classes[i] || '', scope: 'col' }, c)))),
    h('tbody', {}, rows.map((r, ri) => h('tr', rowAttrs(ri), r.map((c, i) => h('td', { class: classes[i] || '' }, c)))))));
}

export function field(label, control, hint, helpKey) {
  const key = helpKey ?? (HELP[label] ? label : null); // every field with an entry in help.js gets a ? button
  return h('label', { class: 'field' }, h('span', {}, label, key ? helpButton(key) : null), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

// help popovers -----------------------------------------------------------------------------
import { HELP } from './help.js';
let openPop = null;
export function helpButton(key) {
  const b = h('button', { type: 'button', class: 'help', 'aria-label': `Help: ${HELP[key]?.title ?? key}`, 'aria-expanded': 'false' }, '?');
  b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (openPop) { const same = openPop.owner === b; closePop(); if (same) return; }
    const info = HELP[key] ?? { title: key, body: '' };
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': info.title },
      h('strong', {}, info.title), ...info.body.split('\n\n').map((p) => h('p', { html: p })));
    document.body.append(pop);
    const r = b.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 20, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12))}px`;
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    b.setAttribute('aria-expanded', 'true');
    openPop = { el: pop, owner: b };
  });
  return b;
}
function closePop() { if (!openPop) return; openPop.el.remove(); openPop.owner.setAttribute('aria-expanded', 'false'); openPop.owner.focus(); openPop = null; }
document.addEventListener('click', (e) => { if (openPop && !openPop.el.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
