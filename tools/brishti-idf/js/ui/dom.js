/**
 * dom.js — tiny DOM helpers (no framework). `h('div.cls#id', {attrs}, ...children)`.
 * Controls and section headings get an “i” button automatically when ui/info.js has an entry for their label.
 */
import { INFO } from './info.js';

export function h(spec, attrs = {}, ...children) {
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(d));

export function durLabel(d) {
  if (d < 60) return `${d} min`;
  if (d % 1440 === 0) return `${d / 1440} d`;
  if (d % 60 === 0) return `${d / 60} h`;
  return `${(d / 60).toFixed(2)} h`;
}

/**
 * “i” button with a short explanation that opens below it. Returns null when there is no text.
 * The button lives inside <label> elements, so its click must not reach the label (which would focus the control).
 */
let ibSeq = 0;
function closeInfo(except = null) {
  document.querySelectorAll('.ib[aria-expanded="true"]').forEach((b) => {
    if (b === except) return;
    b.setAttribute('aria-expanded', 'false');
    const pop = document.getElementById(b.getAttribute('aria-controls'));
    if (pop) pop.hidden = true;
  });
}
if (typeof document !== 'undefined') {
  // One explanation open at a time; a click elsewhere or Escape closes it.
  document.addEventListener('click', (e) => { if (!e.target.closest?.('.ib, .ib-pop')) closeInfo(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });
}
export function infoButton(key, text = INFO[key]) {
  if (!text) return null;
  const id = `ib-${++ibSeq}`;
  const pop = h('span.ib-pop', { id, role: 'note', hidden: true, onclick: (e) => { e.preventDefault(); e.stopPropagation(); } }, text);
  const btn = h('button.ib', { type: 'button', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': `About: ${String(key).replace(/^§/, '')}`, title: 'What is this?',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); const open = btn.getAttribute('aria-expanded') !== 'true'; closeInfo(btn); btn.setAttribute('aria-expanded', String(open)); pop.hidden = !open; } }, 'i');
  return [btn, pop];
}

/** Label text plus its info button (if any); the explanation is placed after the control by the caller. */
function labelParts(label, opt) {
  const ib = infoButton(opt.infoKey || label, opt.info);
  return { title: h('span.lbl', label, ib ? ib[0] : null), pop: ib ? ib[1] : null };
}

/** Section block with heading. */
export function block(title, ...children) {
  const ib = infoButton(`§${title}`);
  return h('section.block', h('h3', title, ib ? ib[0] : null), ib ? ib[1] : null, ...children);
}

export function note(text, kind = '') {
  return h(`div.note${kind ? '.' + kind : ''}`, { role: kind === 'error' ? 'alert' : null }, text);
}

/** Collapsible inline help. */
export function help(summary, ...content) {
  return h('details.help', h('summary', summary), h('div', ...content));
}

export function tag(kind) {
  const map = { experimental: ['exp', 'Experimental'], verified: ['ver', 'Implementation tested'], 'verified-formula': ['exp', 'Formula checked · accuracy not validated'], user: ['user', 'User input'] };
  const [c, t] = map[kind] || ['user', kind];
  return h(`span.tag.${c}`, t);
}

/**
 * Data table. columns: [{key|get, label, fmt?, cls?}], rows: objects.
 * opt.rowClass(row) -> class name.
 */
export function table(columns, rows, opt = {}) {
  // Evaluate every cell once, then classify columns: text columns are left-aligned (numbers stay
  // right-aligned for comparison) and columns with long text wrap instead of scrolling sideways.
  const cells = rows.map((r, i) => columns.map((c) => {
    const v = c.get ? c.get(r, i) : r[c.key];
    return { v, content: v instanceof Node ? v : c.fmt ? c.fmt(v, r) : v == null ? '—' : v };
  }));
  const isNum = (x) => typeof x === 'number' || (typeof x === 'string' && /^[-−+]?[\d.,]+(e[-+]?\d+)?\s*%?$|^—$|^$/i.test(x.trim())) || x instanceof Node;
  const colCls = columns.map((c, j) => {
    const vals = cells.map((row) => row[j].content);
    const text = vals.some((x) => !isNum(x));
    const long = vals.some((x) => typeof x === 'string' && x.length > 48);
    return [text ? 'txt' : null, long ? 'wrap' : null].filter(Boolean).join(' ') || null;
  });
  const thead = h('thead', h('tr', columns.map((c, j) => h('th', { scope: 'col', title: c.title || null, class: colCls[j] }, c.label))));
  const tbody = h('tbody', rows.map((r, i) => h('tr', { class: opt.rowClass ? opt.rowClass(r, i) || null : null },
    columns.map((c, j) => {
      const { v, content } = cells[i][j];
      const cls = [colCls[j], c.cls ? c.cls(v, r) : null].filter(Boolean).join(' ') || null;
      return h('td', { class: cls }, content);
    }))));
  return h('div.table-wrap', h('table.data', opt.caption ? h('caption', opt.caption) : null, thead, tbody));
}

/** Labelled select. options: [[value, label]] */
export function select(label, value, options, onChange, opt = {}) {
  const s = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, l)));
  const L = labelParts(label, opt);
  return h('label.field', { class: opt.cls || null }, L.title, s, opt.hint ? h('span.hint', opt.hint) : null, L.pop);
}

export function numberInput(label, value, onChange, opt = {}) {
  const i = h('input', { type: 'number', value: value ?? '', step: opt.step ?? 'any', min: opt.min, max: opt.max, 'aria-label': label,
    onchange: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)) });
  const L = labelParts(label, opt);
  return h('label.field', { class: opt.cls || null }, L.title, i, opt.hint ? h('span.hint', opt.hint) : null, L.pop);
}

export function textInput(label, value, onChange, opt = {}) {
  const i = h('input', { type: 'text', value: value ?? '', placeholder: opt.placeholder || '', 'aria-label': label, onchange: (e) => onChange(e.target.value) });
  const L = labelParts(label, opt);
  return h('label.field', { class: opt.cls || null }, L.title, i, opt.hint ? h('span.hint', opt.hint) : null, L.pop);
}

export function checkbox(label, checked, onChange, opt = {}) {
  const ib = infoButton(opt.infoKey || label, opt.info);
  if (!ib) return h('label.check', { class: opt.cls || null }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label);
  return h('span.check-wrap', { class: opt.cls || null },
    h('label.check', h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label), ib[0], ib[1]);
}

export function button(label, onClick, opt = {}) {
  return h(`button.btn${opt.quiet ? '.quiet' : ''}${opt.danger ? '.danger' : ''}`, { type: 'button', onclick: onClick, disabled: opt.disabled || null, title: opt.title || null }, label);
}

export function segmented(label, value, options, onChange) {
  return h('div.seg', { role: 'group', 'aria-label': label },
    options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onChange(v) }, l)));
}

/** Trigger a file download from a string or Blob. */
export function download(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Parse a list like "2, 5, 10" into numbers. */
export function parseList(s) {
  return String(s).split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
}
