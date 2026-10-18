/* Portfolio app — loads data/content.json and renders every section.
   Content is edited from admin.html and committed to GitHub. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Allow normal web, mail, phone and relative links; block script/data URLs
  const safeUrl = (u) => (u && !/^\s*(javascript|data|vbscript):/i.test(u) ? u : '#');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SECTIONS = [
    ['about', 'About'], ['tools', 'Tools'], ['experience', 'Experience'], ['map', 'Map'], ['research', 'Research'],
    ['skills', 'Skills'], ['education', 'Education'], ['leadership', 'Leadership'], ['contact', 'Contact'],
  ];

  const ICONS = {
    github: '<path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/>',
    linkedin: '<path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.5c0-1.3-.02-3-1.83-3-1.84 0-2.12 1.43-2.12 2.9V21H9z"/>',
    scholar: '<path fill="currentColor" d="M12 3 1 9.5l4 2.6V17c0 1 3.1 3 7 3s7-2 7-3v-4.9l2-1.3V16h2V9.5zM12 5.3l7.3 4.2L12 13.8 4.7 9.5z"/>',
    researchgate: '<path fill="currentColor" d="M3 3h18v18H3zm4.5 4v10h2v-4h1.2l2.3 4h2.3l-2.6-4.4A3 3 0 0 0 10.5 7zm2 2h1a1 1 0 1 1 0 2h-1z"/>',
    orcid: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 7.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7.2 10h1.6v7H7.2zm3 0h3.1c2.6 0 3.8 1.9 3.8 3.5 0 1.8-1.4 3.5-3.8 3.5h-3.1zm1.6 1.4v4.2h1.4c1.8 0 2.3-1.3 2.3-2.1 0-1.2-.8-2.1-2.3-2.1z"/>',
    mail: '<path fill="currentColor" d="M3 5h18v14H3zm2 2v.5l7 4.5 7-4.5V7zm14 2.9-7 4.5-7-4.5V17h14z"/>',
    link: '<path fill="currentColor" d="M10.6 13.4a1 1 0 0 0 1.4 0l4-4a3 3 0 0 0-4.2-4.2l-1.5 1.5 1.4 1.4 1.5-1.5a1 1 0 0 1 1.4 1.4l-4 4a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-4 4a3 3 0 0 0 4.2 4.2l1.5-1.5-1.4-1.4-1.5 1.5a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 0 0-1.4z"/>',
  };
  const FOCUS_ICONS = {
    wave: 'M2 8h2v2h2v2h4V10h2V8h2v2h2v2h4v2h-4v-2h-2v-2h-2v2h-2v2H6v-2H4v-2H2zm0 6h2v2h2v2h4v-2h2v-2h2v2h2v2h4v2h-4v-2h-2v-2h-2v2h-2v2H6v-2H4v-2H2z',
    satellite: 'M10 2h4v2h-4zM8 4h2v2H8zm6 0h2v2h-2zM2 10h6v4H2zm14 0h6v4h-6zm-6-4h4v12h-4zm-2 14h8v2H8z',
    cloud: 'M8 4h6v2h2v2h2v2h2v6h-2v2H4v-2H2v-4h2V8h2V6h2zm-1 16h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z',
    chip: 'M7 7h10v10H7zm2 2v6h6V9zM9 3h2v3H9zm4 0h2v3h-2zM9 18h2v3H9zm4 0h2v3h-2zM3 9h3v2H3zm0 4h3v2H3zm15-4h3v2h-3zm0 4h3v2h-3z',
  };
  const STATUS = {
    published: ['Published', 'ok'], accepted: ['Accepted', 'acc'], revision: ['In revision', 'rev'],
    review: ['Under review', 'rev'], preprint: ['Preprint', 'pre'],
  };
  const svg = (p, s) => '<svg viewBox="0 0 24 24" width="' + (s || 18) + '" height="' + (s || 18) + '" aria-hidden="true">' + p + '</svg>';

  let DATA = null, avatar = null;
  const state = { pubType: 'all', query: '' };

  // ------------------------------------------------------------------ load
  async function load() {
    const params = new URLSearchParams(location.search);
    if (params.has('preview')) {
      try {
        const draft = localStorage.getItem('mrj_draft');
        if (draft) { document.body.classList.add('is-preview'); return JSON.parse(draft); }
      } catch (e) { /* ignore */ }
    }
    const res = await fetch('data/content.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---------------------------------------------------------------- helpers
  function monthLabel(ym) {
    if (!ym) return 'Present';
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleString('en', { month: 'short' }) + ' ' + y;
  }
  function duration(start, end) {
    if (!start) return '';
    const [sy, sm] = start.split('-').map(Number);
    const e = end ? end.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const months = Math.max(1, (e[0] - sy) * 12 + (e[1] - sm) + 1);
    const y = Math.floor(months / 12), m = months % 12;
    return [y ? y + ' yr' + (y > 1 ? 's' : '') : '', m ? m + ' mo' + (m > 1 ? 's' : '') : ''].filter(Boolean).join(' ');
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (er) { /* ignore */ }
      ta.remove();
    }
    toast((label || 'Copied') + ' ✓');
  }
  function highlightSelf(name) {
    const self = DATA.profile.name.toLowerCase();
    return name.toLowerCase() === self ? '<b class="self">' + esc(name) + '</b>' : esc(name);
  }
  function primaryEmail() { return DATA.profile.personalEmail || DATA.profile.workEmail; }

  // ------------------------------------------------------------- citations
  function splitName(full) {
    const parts = full.replace(/\s+/g, ' ').trim().split(' ');
    const last = parts.pop();
    return { last, given: parts };
  }
  function apaAuthor(full) {
    const n = splitName(full);
    const ini = n.given.map((g) => g.replace(/\./g, '')[0].toUpperCase() + '.').join(' ');
    return n.last + (ini ? ', ' + ini : '');
  }
  function apa(p) {
    const a = p.authors.map(apaAuthor);
    const authors = a.length === 1 ? a[0] : a.length === 2 ? a[0] + ', & ' + a[1] : a.slice(0, -1).join(', ') + ', & ' + a[a.length - 1];
    let s = authors + ' (' + p.year + '). ' + p.title + '. ' + p.venue.replace(/\s+—.*$/, '');
    if (p.volume) s += ', ' + p.volume + (p.issue ? '(' + p.issue + ')' : '');
    if (p.pages) s += ', ' + p.pages;
    s += '.';
    if (p.doi) s += ' https://doi.org/' + p.doi;
    else if (p.url) s += ' ' + p.url;
    return s;
  }
  function bibtex(p) {
    const first = splitName(p.authors[0] || 'anon').last.toLowerCase().replace(/[^a-z]/g, '');
    const word = (p.title.split(/\s+/).find((w) => w.length > 3 && !/^(the|and|with|using|under|from|into)$/i.test(w)) || 'paper').toLowerCase().replace(/[^a-z]/g, '');
    const kind = p.type === 'conference' ? 'inproceedings' : 'article';
    const venueKey = p.type === 'conference' ? 'booktitle' : 'journal';
    const b = (v) => String(v).replace(/&/g, '\\&');
    const lines = [
      '  title={' + b(p.title) + '}',
      '  author={' + p.authors.map((n) => { const s = splitName(n); return s.last + ', ' + s.given.join(' '); }).join(' and ') + '}',
      '  ' + venueKey + '={' + b(p.venue.replace(/\s+—.*$/, '')) + '}',
      '  year={' + p.year + '}',
    ];
    if (p.volume) lines.push('  volume={' + p.volume + '}');
    if (p.issue) lines.push('  number={' + p.issue + '}');
    if (p.pages) lines.push('  pages={' + p.pages + '}');
    if (p.doi) lines.push('  doi={' + p.doi + '}');
    return '@' + kind + '{' + first + p.year + word + ',\n' + lines.join(',\n') + '\n}';
  }

  // ---------------------------------------------------------------- render
  function renderMeta() {
    const m = DATA.meta || {};
    if (m.title) document.title = m.title;
    const d = $('meta[name="description"]'); if (d && m.description) d.setAttribute('content', m.description);
    const p = DATA.profile;
    const ld = {
      '@context': 'https://schema.org', '@type': 'Person', name: p.name,
      jobTitle: (DATA.experience[0] || {}).role, email: 'mailto:' + primaryEmail(),
      worksFor: (DATA.experience[0] || {}).org ? { '@type': 'Organization', name: DATA.experience[0].org } : undefined,
      alumniOf: DATA.education.map((e) => ({ '@type': 'CollegeOrUniversity', name: e.institution })),
      sameAs: DATA.links.filter((l) => l.url).map((l) => l.url),
      address: { '@type': 'PostalAddress', addressLocality: p.location },
    };
    const s = document.createElement('script'); s.type = 'application/ld+json'; s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  function renderNav() {
    const on = DATA.settings.sections || {};
    $('#navLinks').innerHTML = SECTIONS.filter(([id]) => on[id] !== false)
      .map(([id, label]) => '<a href="#' + id + '" data-sec="' + id + '">' + label + '</a>').join('');
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el && on[id] === false) el.hidden = true; });
    if (on.references === false) $('#refs').hidden = true;
    // Number the visible sections 01, 02, … so hiding/adding sections never needs renumbering
    let n = 0;
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id);
      const idx = el && !el.hidden && el.querySelector('.sec-idx');
      if (idx) idx.textContent = String(++n).padStart(2, '0');
    });
  }

  // ------------------------------------------------------------ tools
  const TOOL_COLORS = { cyan: 'var(--accent)', violet: 'var(--violet)', amber: 'var(--accent-2)', lime: 'var(--accent-3)', pink: 'var(--pink)' };
  const TOOL_ICONS = {
    band: '<path d="M3 15c2-3 4-6 7-4s4 4 7 1 3-5 4-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 19c2-2 4-4 7-3s4 2 7 0 3-3 4-4M3 11c2-4 4-7 7-6s4 3 7 0 3-5 4-6" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
    extend: '<path d="M3 16c1.5-2 3-5 5-4s3 3 4 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 13c2-3 3-6 5-4s2 3 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 2.5"/><path d="M12 4v16" stroke="currentColor" stroke-width="1" opacity=".5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    ml: '<path d="M5 6l7 6-7 6M12 12h7M19 5l0 0M19 19l0 0" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".55"/><circle cx="5" cy="6" r="2.2" fill="currentColor"/><circle cx="5" cy="18" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="19" cy="6" r="2.2" fill="currentColor"/><circle cx="19" cy="18" r="2.2" fill="currentColor"/><path d="M12 12l7-6M12 12l7 6" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".55"/>',
    map: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>',
    wave: '<path d="M2 9c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 16c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    depend: '<path d="M3 4c3 1 5 4 8 7s5 5 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 3v18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
    gap: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 14l2.5-3.5 2 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 11.5l2 3.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 13l4-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="1.6 1.6" opacity=".7"/>',
  };
  // Small decorative preview drawn from a seeded pseudo-random series
  function toolArt(kind) {
    let s = 7;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const N = 48, W = 320, H = 150, pad = 12;
    const pts = Array.from({ length: N }, (_, i) => 0.5 + 0.28 * Math.sin(i / 5.5) + 0.12 * Math.sin(i / 1.7) + (rnd() - 0.5) * 0.08);
    const x = (i) => (pad + (i / (N - 1)) * (W - 2 * pad)).toFixed(1);
    const y = (v) => (H - pad - v * (H - 2 * pad)).toFixed(1);
    const line = (arr, from, to) => arr.slice(from, to).map((v, k) => (k ? 'L' : 'M') + x(from + k) + ' ' + y(v)).join(' ');
    let g = '';
    for (let i = 1; i < 4; i++) g += '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + (pad + i * (H - 2 * pad) / 4) + '" y2="' + (pad + i * (H - 2 * pad) / 4) + '" class="ta-grid"/>';
    if (kind === 'ml') {
      // observed series with a model prediction tracking it, plus a train/test divider
      const pred = pts.map((v, i) => v + Math.sin(i * 1.3) * 0.025 + (rnd() - 0.5) * 0.05);
      const cut = 30;
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g +
        '<rect x="' + pad + '" y="' + pad + '" width="' + (x(cut) - pad) + '" height="' + (H - 2 * pad) + '" class="ta-train"/>' +
        '<text x="' + (pad + 6) + '" y="' + (pad + 12) + '" class="ta-lbl2">train</text><text x="' + (+x(cut) + 6) + '" y="' + (pad + 12) + '" class="ta-lbl2">test</text>' +
        '<path d="' + line(pts, 0, N) + '" class="ta-obs"/><path d="' + line(pred, 0, N) + '" class="ta-avg"/></svg>';
    }
    if (kind === 'depend') {
      // dependability curve: values ranked high to low with plotting position, and the target line at P
      const ranked = pts.slice().sort((a, b) => b - a), cut = Math.round(0.88 * (N - 1));
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g +
        '<path d="' + line(ranked, 0, N) + '" class="ta-avg"/>' +
        '<line x1="' + x(cut) + '" x2="' + x(cut) + '" y1="' + pad + '" y2="' + (H - pad) + '" class="ta-div"/>' +
        '<circle cx="' + x(cut) + '" cy="' + y(ranked[cut]) + '" r="4" class="ta-dot"/>' +
        '<text x="' + (+x(cut) - 6) + '" y="' + (H - pad - 6) + '" text-anchor="end" class="ta-lbl">97% dependable</text></svg>';
    }
    if (kind === 'gap') {
      // observed record with a missing stretch (shaded) and the filled values bridging it
      const a = 19, b = 31;
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g +
        '<rect x="' + x(a) + '" y="' + pad + '" width="' + (x(b) - x(a)) + '" height="' + (H - 2 * pad) + '" class="ta-fill"/>' +
        '<path d="' + line(pts, 0, a + 1) + '" class="ta-real"/><path d="' + line(pts, b, N) + '" class="ta-real"/>' +
        '<path d="' + line(pts, a, b + 1) + '" class="ta-gen"/>' +
        '<text x="' + (+x(a) + 6) + '" y="' + (pad + 12) + '" class="ta-lbl">filled</text></svg>';
    }
    if (kind === 'extend') {
      const cut = 18;
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g +
        '<rect x="' + x(cut) + '" y="' + pad + '" width="' + (W - pad - x(cut)) + '" height="' + (H - 2 * pad) + '" class="ta-fill"/>' +
        '<line x1="' + x(cut) + '" x2="' + x(cut) + '" y1="' + pad + '" y2="' + (H - pad) + '" class="ta-div"/>' +
        '<path d="' + line(pts, 0, cut + 1) + '" class="ta-real"/><path d="' + line(pts, cut, N) + '" class="ta-gen"/>' +
        '<text x="' + (+x(cut) + 6) + '" y="' + (pad + 12) + '" class="ta-lbl">generated →</text></svg>';
    }
    const hi = pts.map((v) => Math.min(1, v + 0.1 + rnd() * 0.06)), lo = pts.map((v) => Math.max(0, v - 0.1 - rnd() * 0.06));
    const band = hi.map((v, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(v)).join(' ') + ' ' + lo.map((v, i) => 'L' + x(N - 1 - i) + ' ' + y(lo[N - 1 - i])).join(' ') + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g + '<path d="' + band + '" class="ta-band"/><path d="' + line(pts, 0, N) + '" class="ta-avg"/></svg>';
  }

  function renderTools() {
    const tools = (DATA.tools || []).filter((t) => t.name);
    const box = $('#toolbox');
    if (!tools.length) { $('#tools').hidden = true; return; }
    const STATUS_T = { live: 'LIVE', beta: 'BETA', soon: 'SOON' };
    box.innerHTML = '<div class="tb-tabs" role="tablist" aria-label="Tools">' + tools.map((t, i) =>
      '<button class="tb-tab" role="tab" id="tbt-' + i + '" aria-controls="tbp" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-i="' + i + '" style="--tc:' + (TOOL_COLORS[t.accent] || TOOL_COLORS.cyan) + '">' +
      '<span class="tb-ico">' + svg(TOOL_ICONS[t.icon] || TOOL_ICONS.chart, 20) + '</span>' +
      '<span class="tb-txt"><b>' + esc(t.name) + '</b><small>' + esc(t.tagline || '') + '</small></span></button>').join('') +
      '<div class="tb-more mono">+ more tools coming</div></div>' +
      '<div class="tb-panel" id="tbp" role="tabpanel"></div>';
    const panel = $('#tbp');
    const show = (i) => {
      const t = tools[i];
      $$('.tb-tab', box).forEach((b) => { const on = +b.dataset.i === i; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
      panel.setAttribute('aria-labelledby', 'tbt-' + i);
      panel.style.setProperty('--tc', TOOL_COLORS[t.accent] || TOOL_COLORS.cyan);
      const st = t.status || 'live', live = st !== 'soon' && t.url;
      panel.innerHTML = '<div class="tb-info">' +
        '<p class="pixel tb-kicker">TOOL ' + String(i + 1).padStart(2, '0') + ' · <span class="tb-st ' + st + '">' + (STATUS_T[st] || st.toUpperCase()) + '</span></p>' +
        '<h3>' + esc(t.name) + '</h3><p class="tb-desc">' + esc(t.description || '') + '</p>' +
        ((t.features || []).length ? '<ul class="tb-feat">' + t.features.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
        '<div class="tb-foot"><div class="tags">' + (t.tags || []).map((g) => '<span class="tag">' + esc(g) + '</span>').join('') + '</div>' +
        '<div class="tb-actions">' + (live ? '<a class="btn primary tb-launch" href="' + esc(safeUrl(t.url)) + '">Launch tool <span aria-hidden="true">→</span></a>' +
          '<a class="mini" href="' + esc(safeUrl(t.url)) + '" target="_blank" rel="noopener" title="Open in a new tab">↗</a>' : '<span class="mini">Coming soon</span>') + '</div></div></div>' +
        '<div class="tb-art">' + toolArt(t.icon) + '<span class="tb-art-cap mono">preview</span></div>';
    };
    box.addEventListener('click', (e) => { const b = e.target.closest('.tb-tab'); if (b) show(+b.dataset.i); });
    box.addEventListener('keydown', (e) => {
      const b = e.target.closest('.tb-tab'); if (!b) return;
      const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!k) return;
      e.preventDefault();
      const n = (+b.dataset.i + k + tools.length) % tools.length;
      show(n); $('#tbt-' + n).focus();
    });
    show(0);
  }

  function renderHero() {
    const p = DATA.profile;
    // full name, plus a shorter "Mahfujur R. Joy" form that phones show instead of a cut-off name
    const nw = p.name.split(' '), short = nw.length > 2 ? nw[0] + ' ' + nw.slice(1, -1).map((w) => w[0] + '.').join(' ') + ' ' + nw[nw.length - 1] : p.name;
    $('#navName').innerHTML = '<span class="nm-full">' + esc(p.name) + '</span><span class="nm-short">' + esc(short) + '</span>';
    $('#heroStatus').textContent = p.status;
    $('#heroLocation').textContent = (p.location || '').toUpperCase();
    $('#heroBio').innerHTML = md(p.bio);
    $('#heroQuest').textContent = p.currentQuest || '';
    $('#footName').textContent = p.name;
    const nameEl = $('#heroName');
    nameEl.setAttribute('aria-label', p.name);
    const words = p.name.split(' ');
    nameEl.innerHTML = words.map((w, i) => '<span class="w' + (i === words.length - 1 ? ' accent' : '') + '" aria-hidden="true">' + esc(w) + '</span>').join(' ');
    scramble($$('.w', nameEl));

    if (p.cvUrl) { const b = $('#cvBtn'); b.hidden = false; b.href = safeUrl(p.cvUrl); }

    const links = DATA.links.filter((l) => l.url);
    const mail = { label: 'Email', url: 'mailto:' + primaryEmail(), icon: 'mail' };
    $('#socials').innerHTML = [mail].concat(links).map((l) =>
      '<a class="social" href="' + esc(safeUrl(l.url)) + '" ' + (l.icon === 'mail' ? '' : 'target="_blank" rel="noopener"') + ' title="' + esc(l.label) + '">' +
      svg(ICONS[l.icon] || ICONS.link, 16) + '<span>' + esc(l.label) + '</span></a>').join('');

    typeRoles(p.roles || []);
  }

  function renderStats() {
    const pubs = DATA.publications;
    const journals = pubs.filter((p) => p.type === 'journal').length;
    const starts = DATA.experience.map((e) => e.start).filter(Boolean).sort();
    let years = 0;
    if (starts[0]) {
      const [y, m] = starts[0].split('-').map(Number);
      const now = new Date();
      years = Math.max(1, Math.round(((now.getFullYear() - y) * 12 + now.getMonth() + 1 - m) / 12));
    }
    const stats = [
      [pubs.length, 'Publications'], [journals, 'Journal articles'], [DATA.certifications.length, 'Certifications'],
    ];
    if (years) stats.push([years, 'Years in research']);
    $('#stats').innerHTML = stats.map(([n, l]) =>
      '<div class="stat"><b data-count="' + n + '">' + n + '</b><span>' + esc(l) + '</span></div>').join('');
    $('#sceneMode').textContent = 'CLASS: HYDRO · ' + pubs.length + ' PAPERS';
  }

  function renderFocus() {
    $('#focusGrid').innerHTML = (DATA.focusAreas || []).map((f, i) =>
      '<article class="card focus reveal" style="--d:' + i * 70 + 'ms">' +
      '<div class="focus-icon">' + svg('<path fill="currentColor" d="' + (FOCUS_ICONS[f.icon] || FOCUS_ICONS.chip) + '"/>', 28) + '</div>' +
      '<h3>' + esc(f.title) + '</h3><p>' + esc(f.text) + '</p></article>').join('');
  }

  function renderExperience() {
    $('#expNote').textContent = DATA.experience.length + ' quests completed or in progress';
    $('#timeline').innerHTML = DATA.experience.map((e, i) => {
      const current = !e.end;
      return '<li class="tl-item reveal' + (current ? ' current' : '') + '">' +
        '<span class="tl-node" aria-hidden="true"></span>' +
        '<article class="card exp">' +
        '<button class="exp-head" aria-expanded="' + (i === 0) + '">' +
        '<div class="exp-title"><h3>' + esc(e.role) + '</h3>' + (current ? '<span class="badge live">ACTIVE QUEST</span>' : '') +
        '<p class="org">' + esc(e.org) + '</p></div>' +
        '<div class="exp-when mono"><span>' + monthLabel(e.start) + ' — ' + monthLabel(e.end) + '</span><small>' + esc([duration(e.start, e.end), e.mode, e.location].filter(Boolean).join(' · ')) + '</small></div>' +
        '<span class="chev" aria-hidden="true">▾</span></button>' +
        '<div class="exp-body"' + (i === 0 ? '' : ' hidden') + '>' +
        (e.orgNote ? '<p class="muted small">' + esc(e.orgNote) + '</p>' : '') +
        (e.project ? '<div class="project"><span class="pixel">PROJECT</span><p>' + esc(e.project) + '</p></div>' : '') +
        (e.people ? '<p class="muted small mono">' + esc(e.people) + '</p>' : '') +
        '<ul class="bullets">' + (e.bullets || []).map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' +
        ((e.tools || []).length ? '<div class="tags">' + e.tools.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
        '</div></article></li>';
    }).join('');
    $$('.exp-head').forEach((btn) => btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    }));
  }

  function renderPubTabs() {
    const pubs = DATA.publications;
    const types = [['all', 'All', pubs.length], ['journal', 'Journal', pubs.filter((p) => p.type === 'journal').length],
      ['conference', 'Conference', pubs.filter((p) => p.type === 'conference').length]];
    $('#pubTypes').innerHTML = types.map(([k, l, n]) =>
      '<button role="tab" data-type="' + k + '" aria-selected="' + (state.pubType === k) + '">' + l + ' <em>' + n + '</em></button>').join('');
    $$('#pubTypes button').forEach((b) => b.addEventListener('click', () => {
      state.pubType = b.dataset.type; renderPubTabs(); renderPubs();
    }));
    const pub = pubs.filter((p) => p.status === 'published').length;
    $('#pubNote').textContent = pub + ' published' + (pubs.length > pub ? ' · ' + (pubs.length - pub) + ' accepted / in pipeline' : '');
  }

  function renderPubs() {
    const q = state.query.toLowerCase();
    const list = DATA.publications
      .map((p, i) => Object.assign({ _i: i }, p))
      .filter((p) => state.pubType === 'all' || p.type === state.pubType)
      .filter((p) => !q || [p.title, p.venue, p.authors.join(' '), (p.tags || []).join(' '), p.year].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.year - a.year) || (b.featured - a.featured) || (a._i - b._i));
    const el = $('#pubList');
    if (!list.length) { el.innerHTML = '<p class="empty mono">No results. Try “CMIP6”, “flood” or “Nury”.</p>'; return; }
    let lastYear = null;
    el.innerHTML = list.map((p) => {
      const st = STATUS[p.status] || [p.status, 'pre'];
      const link = p.doi ? 'https://doi.org/' + p.doi : p.url;
      const head = p.year !== lastYear ? '<h3 class="year-head pixel"><span>' + esc(p.year) + '</span><i></i><small class="mono">' +
        (() => { const n = list.filter((q) => q.year === p.year).length; return n + (n === 1 ? ' paper' : ' papers'); })() + '</small></h3>' : '';
      lastYear = p.year;
      return head + '<article class="card pub reveal in">' +
        '<div class="pub-meta mono"><span class="year">' + esc(p.year) + '</span>' +
        '<span class="badge ' + st[1] + '">' + esc(st[0]) + '</span>' +
        '<span class="badge type">' + (p.type === 'journal' ? 'Journal' : 'Conference') + '</span>' +
        (p.featured ? '<span class="badge star" title="Featured">★ Featured</span>' : '') + '</div>' +
        '<h3>' + (link ? '<a href="' + esc(safeUrl(link)) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' : esc(p.title)) + '</h3>' +
        '<p class="authors">' + p.authors.map(highlightSelf).join(', ') + '</p>' +
        '<p class="venue mono">' + esc(p.venue) + (p.volume ? ', Vol. ' + esc(p.volume) : '') + (p.issue ? '(' + esc(p.issue) + ')' : '') + (p.pages ? ', ' + esc(p.pages) : '') + '</p>' +
        '<div class="pub-foot"><div class="tags">' + (p.tags || []).map((t) => '<button class="tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
        '<div class="pub-actions">' + (link ? '<a class="mini" href="' + esc(safeUrl(link)) + '" target="_blank" rel="noopener">' + (p.doi ? 'DOI' : /researchgate\.net/.test(link) ? 'ResearchGate' : 'Link') + ' ↗</a>' : '') +
        '<button class="mini" data-cite="' + p._i + '">Cite</button></div></div></article>';
    }).join('');
  }

  function renderSkills() {
    $('#inventory').innerHTML = DATA.skills.map((g, i) =>
      '<div class="card inv reveal" style="--d:' + i * 60 + 'ms"><p class="pixel inv-title">' + esc(g.group) + '</p>' +
      '<div class="slots">' + g.items.map((s) => '<span class="slot">' + esc(s) + '</span>').join('') + '</div></div>').join('');
    $('#certCount').textContent = DATA.certifications.length + ' / ' + DATA.certifications.length;
    $('#achievements').innerHTML = DATA.certifications.map((c, i) =>
      '<article class="card ach reveal" style="--d:' + (i % 4) * 50 + 'ms">' +
      '<div class="trophy" aria-hidden="true">' + svg('<path fill="currentColor" d="M6 2h12v2h3v5h-2v2h-2v2h-2v2h-2v3h4v4H7v-4h4v-3H9v-2H7v-2H5V9H3V4h3zm0 4H5v3h1zm12 0v3h1V6z"/>', 22) + '</div>' +
      '<div><p class="mono small issuer">' + esc(c.issuer) + ' · ' + esc(c.date) + '</p><h4>' + esc(c.title) + '</h4>' +
      (c.credentialId ? '<button class="cred mono" data-copytext="' + esc(c.credentialId) + '" title="Copy credential ID">ID ' + esc(c.credentialId) + '</button>' : '') +
      (c.url ? ' <a class="mini" href="' + esc(safeUrl(c.url)) + '" target="_blank" rel="noopener">Verify ↗</a>' : '') +
      '</div></article>').join('');
  }

  function renderEducation() {
    $('#eduGrid').innerHTML = DATA.education.map((e, i) =>
      '<article class="card edu reveal' + (e.status === 'ongoing' ? ' current' : '') + '" style="--d:' + i * 60 + 'ms">' +
      '<div class="edu-top mono"><span>' + esc(e.period) + '</span><span class="badge ' + (e.status === 'ongoing' ? 'live' : 'ok') + '">' + (e.status === 'ongoing' ? 'IN PROGRESS' : 'SAVED') + '</span></div>' +
      '<h3>' + esc(e.degree) + '</h3><p class="org">' + esc(e.institution) + (e.location ? ' · ' + esc(e.location) : '') + '</p>' +
      (e.note ? '<p class="muted small">' + esc(e.note) + '</p>' : '') +
      (e.grade ? '<p class="mono small grade">' + esc(e.grade) + '</p>' : '') + '</article>').join('');
  }

  function renderLeadership() {
    $('#guilds').innerHTML = DATA.leadership.map((l) =>
      '<li class="reveal"><div><b>' + esc(l.role) + '</b><span class="muted">' + esc(l.org) + (l.location ? ' · ' + esc(l.location) : '') + '</span></div><span class="mono small">' + esc(l.period) + '</span></li>').join('');
    $('#refs').innerHTML = '<p class="pixel sec-kicker">REFERENCES</p>' + DATA.references.map((r) =>
      '<article class="card ref reveal"><h4>' + esc(r.name) + '</h4><p class="small">' + esc(r.title) + '</p><p class="muted small">' + esc(r.org) + '</p>' +
      (r.email ? '<a class="mono small" href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '') + '</article>').join('');
  }

  function renderContact() {
    const p = DATA.profile;
    $('#contactAvail').textContent = p.availability || '';
    $('#mailBtn').href = 'mailto:' + primaryEmail();
    const rows = [
      ['whoami', p.name + ' — ' + ((DATA.experience[0] || {}).role || '')],
      ['email --work', p.workEmail], ['email --personal', p.personalEmail],
      DATA.settings.showPhone && p.phone ? ['phone', p.phone] : null,
      ['location', p.office || p.location],
    ].filter((r) => r && r[1]);
    $('#termBody').innerHTML = rows.map(([k, v]) => {
      const isMail = /@/.test(v) && !/\s/.test(v);
      const val = isMail ? '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>' : (k === 'phone' ? '<a href="tel:' + esc(v.replace(/[^+\d]/g, '')) + '">' + esc(v) + '</a>' : esc(v));
      return '<p><span class="prompt">$</span> ' + esc(k) + '</p><p class="out">' + val + '</p>';
    }).join('');
  }

  function renderMarquee() {
    const items = DATA.skills.flatMap((g) => g.items).concat((DATA.focusAreas || []).map((f) => f.title));
    const row = items.map((s) => '<span>' + esc(s) + '</span><i>✦</i>').join('');
    $('#marquee').innerHTML = row + row; // duplicated for a seamless loop
  }

  // Horizontal career chart: one bar per role, from the first start month to today
  function renderGantt() {
    const ym = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + (m - 1); };
    const now = new Date(), nowM = now.getFullYear() * 12 + now.getMonth();
    const rows = DATA.experience.filter((e) => e.start).map((e) => ({ e, a: ym(e.start), b: e.end ? ym(e.end) + 1 : nowM + 1 }));
    if (!rows.length) { $('#gantt').closest('.gantt-card').hidden = true; return; }
    const min = Math.min.apply(null, rows.map((r) => r.a)) - 1, max = nowM + 2, span = max - min;
    const pct = (m) => ((m - min) / span * 100).toFixed(2) + '%';
    let ticks = '';
    for (let m = min; m <= max; m++) {
      if (m % 12 === 0) ticks += '<span class="g-tick year" style="left:' + pct(m) + '"><b>' + (m / 12) + '</b></span>';
      else if (m % 3 === 0) ticks += '<span class="g-tick" style="left:' + pct(m) + '"></span>';
    }
    ticks += '<span class="g-now" style="left:' + pct(nowM + 0.5) + '"><b>now</b></span>';
    $('#gantt').innerHTML = '<div class="g-axis">' + ticks + '</div>' + rows.slice().reverse().map((r, i) =>
      '<div class="g-row"><span class="g-label">' + esc(r.e.role) + '<small>' + esc(r.e.org.split(/[,(—]/)[0].trim()) + '</small></span>' +
      '<div class="g-track">' + ticks.replace(/<b>.*?<\/b>/g, '') +
      '<span class="g-bar' + (r.e.end ? '' : ' live') + '" style="left:' + pct(r.a) + ';width:calc(' + pct(r.b) + ' - ' + pct(r.a) + ');--d:' + i * 90 + 'ms" title="' +
      esc(monthLabel(r.e.start) + ' — ' + monthLabel(r.e.end) + ' · ' + duration(r.e.start, r.e.end)) + '"><em>' + esc(duration(r.e.start, r.e.end)) + '</em></span></div></div>').join('');
    $('#ganttLegend').innerHTML = '<span><i class="lg-live"></i>current</span><span><i class="lg-past"></i>completed</span>';
  }

  // Pixel dot-map of Bangladesh with rivers and study sites
  const BD = [[88.45, 26.63], [88.75, 26.3], [89.05, 26.28], [89.35, 26.0], [89.6, 26.05], [89.85, 25.95], [89.85, 25.3], [90.4, 25.17], [91.2, 25.2], [92.0, 25.15],
    [92.45, 25.0], [92.3, 24.75], [92.2, 24.45], [91.9, 24.25], [91.65, 24.15], [91.4, 24.15], [91.25, 23.95], [91.2, 23.7], [91.3, 23.3], [91.2, 23.05], [91.4, 22.95],
    [91.6, 22.95], [91.75, 23.25], [92.0, 23.6], [92.25, 23.7], [92.35, 23.3], [92.5, 22.9], [92.6, 22.2], [92.6, 21.4], [92.35, 21.1], [92.3, 20.75], [92.05, 21.15],
    [91.95, 21.55], [91.85, 22.2], [91.65, 22.6], [91.45, 22.85], [91.1, 22.7], [90.85, 22.4], [90.6, 22.05], [90.3, 21.85], [89.9, 21.9], [89.5, 21.75], [89.1, 21.65],
    [89.05, 22.1], [88.95, 22.6], [88.85, 23.2], [88.6, 23.6], [88.75, 24.25], [88.3, 24.45], [88.05, 24.7], [88.1, 25.1], [88.45, 25.25], [88.6, 25.5], [88.2, 25.8],
    [88.1, 26.2], [88.35, 26.45]];
  const RIVERS = {
    Padma: [[88.1, 24.55], [88.6, 24.3], [89.0, 24.05], [89.4, 23.95], [89.75, 23.82], [90.2, 23.6], [90.6, 23.25]],
    Jamuna: [[89.68, 25.95], [89.7, 25.4], [89.75, 24.9], [89.72, 24.4], [89.7, 24.0], [89.75, 23.82]],
    Meghna: [[90.98, 24.05], [90.75, 23.6], [90.6, 23.25], [90.7, 22.8], [90.8, 22.45]],
    Surma: [[91.87, 24.9], [91.5, 24.75], [91.2, 24.5], [91.0, 24.2], [90.98, 24.05]],
    Teesta: [[88.95, 26.2], [89.3, 25.9], [89.68, 25.6]],
  };
  const proj = (lon, lat) => [20 + (lon - 88.0) / 4.7 * 360, 20 + (26.75 - lat) / 6.15 * 440];
  function inPoly(lon, lat) {
    let inside = false;
    for (let i = 0, j = BD.length - 1; i < BD.length; j = i++) {
      const [xi, yi] = BD[i], [xj, yj] = BD[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function renderMap() {
    const sites = DATA.studyAreas || [];
    const svgEl = $('#bdMap');
    if (!sites.length) { $('#map').hidden = true; return; }
    let dots = '';
    for (let lat = 26.7; lat > 20.6; lat -= 0.1) for (let lon = 88.0; lon < 92.75; lon += 0.1) {
      if (!inPoly(lon, lat)) continue;
      const [x, y] = proj(lon, lat);
      dots += '<rect x="' + (x - 2.4).toFixed(1) + '" y="' + (y - 2.4).toFixed(1) + '" width="4.8" height="4.8"/>';
    }
    const line = (pts) => pts.map((p) => proj(p[0], p[1]).map((v) => v.toFixed(1)).join(',')).join(' ');
    const rivers = Object.keys(RIVERS).map((k) => '<polyline class="river" points="' + line(RIVERS[k]) + '"><title>' + k + '</title></polyline>' +
      '<polyline class="river flow" points="' + line(RIVERS[k]) + '"/>').join('');
    const pins = sites.map((s, i) => {
      const [x, y] = proj(s.lon, s.lat);
      return '<g class="pin' + (s.current ? ' now' : '') + '" data-site="' + i + '" tabindex="0" transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')">' +
        '<circle class="pulse" r="10"/><rect x="-5" y="-5" width="10" height="10"/><title>' + esc(s.name) + '</title></g>';
    }).join('');
    svgEl.innerHTML = '<g class="dots">' + dots + '</g>' + rivers +
      '<text class="map-label" x="' + proj(90.9, 25.65)[0] + '" y="' + proj(90.9, 25.65)[1] + '">BANGLADESH</text>' +
      '<text class="map-label sm" x="' + proj(90.6, 21.2)[0] + '" y="' + proj(90.6, 21.2)[1] + '">Bay of Bengal</text>' + pins +
      '<g class="map-tip" id="mapTip" opacity="0"><rect rx="4" height="24"/><text x="10" y="16"></text></g>';
    // Side panel: one detail card for the selected site + a compact numbered index
    const num = (i) => String(i + 1).padStart(2, '0');
    $('#mapSide').innerHTML =
      '<article class="card site-detail" id="siteDetail" aria-live="polite"></article>' +
      '<div class="site-index-head mono"><span>All sites</span><span>' + sites.length + '</span></div>' +
      '<div class="site-list" role="list">' + sites.map((s, i) =>
        '<button class="site-chip' + (s.current ? ' now' : '') + '" data-site="' + i + '" role="listitem" title="' + esc(s.name) + '">' +
        '<span class="num mono">' + num(i) + '</span><span class="nm">' + esc(s.name) + '</span></button>').join('') + '</div>' +
      '<p class="muted small nationwide"><b>Nationwide:</b> CMIP6 drought projection, GCM precipitation reliability and soil-moisture drought studies cover all of Bangladesh.</p>';

    const tip = $('#mapTip'), detail = $('#siteDetail');
    let selected = Math.max(0, sites.findIndex((s) => s.current));
    function show(i) {
      const s = sites[i];
      detail.classList.toggle('now', !!s.current);
      detail.innerHTML = '<p class="pixel sd-kicker">SITE ' + num(i) + ' / ' + num(sites.length - 1) + (s.current ? ' · <span>CURRENT PROJECT</span>' : '') + '</p>' +
        '<h3>' + esc(s.name) + '</h3><p class="sd-what">' + esc(s.what) + '</p>' +
        '<p class="sd-meta mono">' + esc([s.org, s.year].filter(Boolean).join(' · ')) + '<span>' + s.lat.toFixed(2) + '°N, ' + s.lon.toFixed(2) + '°E</span></p>';
      document.querySelectorAll('[data-site]').forEach((el) => el.classList.toggle('active', +el.dataset.site === i));
    }
    // The label over the map only appears while a site is hovered or keyboard-focused
    function tipOn(i) {
      const s = sites[i], [x, y] = proj(s.lon, s.lat);
      const label = num(i) + ' · ' + s.name;
      tip.querySelector('text').textContent = label;
      const w = Math.max(80, label.length * 6.4 + 20);
      tip.querySelector('rect').setAttribute('width', w);
      tip.setAttribute('transform', 'translate(' + Math.min(400 - w - 4, Math.max(4, x - w / 2)).toFixed(1) + ',' + Math.max(4, y - 40).toFixed(1) + ')');
      tip.setAttribute('opacity', '1');
    }
    const tipOff = () => tip.setAttribute('opacity', '0');
    show(selected);
    // Hover previews, click/Enter selects; leaving restores the selected site
    const siteOf = (e) => { const el = e.target.closest('[data-site]'); return el ? +el.dataset.site : -1; };
    $('#map').addEventListener('pointerover', (e) => { const i = siteOf(e); if (i >= 0) { show(i); tipOn(i); } });
    $('#map').addEventListener('pointerout', (e) => { if (siteOf(e) >= 0) tipOff(); });
    $('.map-wrap').addEventListener('pointerleave', () => { show(selected); tipOff(); });
    $('#map').addEventListener('click', (e) => { const i = siteOf(e); if (i >= 0) { selected = i; show(i); } });
    $('#map').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const i = siteOf(e); if (i >= 0) { e.preventDefault(); selected = i; show(i); } } });
    $('#map').addEventListener('focusin', (e) => { const i = siteOf(e); if (i >= 0) { show(i); tipOn(i); } });
    $('#map').addEventListener('focusout', tipOff);
  }

  // ------------------------------------------------------------ effects
  function scramble(nodes) {
    const glyphs = '01░▒▓<>/\\{}[]#*+=';
    nodes.forEach((n, wi) => {
      const final = n.textContent;
      if (reduced) return;
      let frame = 0;
      const total = 18 + wi * 6;
      const iv = setInterval(() => {
        n.textContent = final.split('').map((ch, i) => (frame > total * (i / final.length) + wi * 3 ? ch : glyphs[(Math.random() * glyphs.length) | 0])).join('');
        if (++frame > total + final.length) { n.textContent = final; clearInterval(iv); }
      }, 40);
    });
  }

  function typeRoles(roles) {
    const el = $('#typed');
    if (!roles.length) return;
    if (reduced) { el.textContent = roles[0]; return; }
    let r = 0, i = 0, dir = 1;
    (function tick() {
      const word = roles[r];
      i += dir;
      el.textContent = word.slice(0, i);
      let delay = dir > 0 ? 55 : 25;
      if (i === word.length) { dir = -1; delay = 1800; }
      if (i === 0 && dir < 0) { dir = 1; r = (r + 1) % roles.length; delay = 300; }
      setTimeout(tick, delay);
    })();
  }

  function countUp() {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const b = en.target, n = +b.dataset.count;
      io.unobserve(b);
      if (reduced) { b.textContent = n; return; }
      const t0 = performance.now();
      (function step(t) {
        const k = Math.min(1, (t - t0) / 900);
        b.textContent = Math.round(n * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }), { threshold: 0.6 });
    $$('[data-count]').forEach((b) => io.observe(b));
  }

  function reveal() {
    if (reduced || !('IntersectionObserver' in window)) { $$('.reveal').forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal:not(.in)').forEach((e) => io.observe(e));
  }

  function scrollSpy() {
    const links = $$('#navLinks a');
    const fill = $('#xpFill'), label = $('#xpLabel'), nav = $('#nav');
    function onScroll() {
      const max = document.documentElement.scrollHeight - innerHeight;
      const pct = max > 0 ? Math.min(100, Math.round((scrollY / max) * 100)) : 0;
      fill.style.width = pct + '%';
      label.textContent = 'XP ' + pct + '%';
      nav.classList.toggle('scrolled', scrollY > 20);
      let cur = '';
      SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el && !el.hidden && el.getBoundingClientRect().top < innerHeight * 0.35) cur = id; });
      links.forEach((a) => a.classList.toggle('active', a.dataset.sec === cur));
    }
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function tilt() {
    const card = $('#avatarCard');
    if (reduced || matchMedia('(pointer: coarse)').matches) return;
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = 'perspective(900px) rotateY(' + (x * 8) + 'deg) rotateX(' + (-y * 8) + 'deg)';
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  }

  // ------------------------------------------------------------ theme
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('mrj_theme', t); } catch (e) { /* ignore */ }
    if (avatar) avatar.setTheme(t);
    if (buddy) buddy.react('smile', 900);
    $('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f3f5fa' : '#06080f');
  }
  const toggleTheme = () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');

  // ------------------------------------------------------------ avatar
  function initAvatar() {
    const av = DATA.avatar || {};
    avatar = new window.PixelAvatar($('#scene'), $('#bubble'), { lines: av.lines });
    avatar.setTheme(document.documentElement.getAttribute('data-theme'));
    const rainBtn = $('#rainBtn'), shadesBtn = $('#shadesBtn');
    const rain = () => { const on = avatar.toggleRain(); rainBtn.setAttribute('aria-pressed', on); };
    const shades = () => { const on = avatar.toggleShades(); shadesBtn.setAttribute('aria-pressed', on); if (buddy) buddy.shades = on; };
    $('#scene').addEventListener('click', () => avatar.poke());
    rainBtn.addEventListener('click', rain);
    shadesBtn.addEventListener('click', shades);
    $('#sayBtn').addEventListener('click', () => {
      const l = avatar.lines; avatar.lineIdx = (avatar.lineIdx + 1) % l.length; avatar.react('smile', 1500); avatar.say(l[avatar.lineIdx]);
    });
    return { rain, shades, poke: () => avatar.poke() };
  }

  // ------------------------------------------------------------ companion
  // A mini Joy docks in the corner once the hero is off-screen and comments on each section.
  let buddy = null;
  function initBuddy(actions) {
    const cfg = DATA.buddy || {};
    const el = $('#buddy');
    if (cfg.enabled === false) { el.remove(); return; }
    buddy = new window.PixelAvatar($('#buddyCanvas'), $('#buddyBubble'), { mini: true, autoTalk: false });
    const hero = $('#home');
    new IntersectionObserver(([en]) => el.classList.toggle('show', !en.isIntersecting), { threshold: 0.15 }).observe(hero);
    const said = {};
    const lines = cfg.sections || {};
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting || !el.classList.contains('show')) return;
      const id = en.target.id;
      if (!lines[id] || said[id]) return;
      said[id] = true;
      buddy.react(id === 'contact' ? 'smile' : 'wink', 1200);
      buddy.say(lines[id]);
    }), { threshold: 0.35 });
    SECTIONS.forEach(([id]) => { const s = document.getElementById(id); if (s && !s.hidden) io.observe(s); });
    let clickT = 0;
    $('#buddyBtn').addEventListener('click', () => {
      // single click = reaction, double click = command palette
      clearTimeout(clickT);
      clickT = setTimeout(() => buddy.poke(), 220);
    });
    $('#buddyBtn').addEventListener('dblclick', () => { clearTimeout(clickT); actions.palette(); });
  }

  // ------------------------------------------------------------ palette
  function initPalette(actions) {
    const ov = $('#palette'), input = $('#palIn'), list = $('#palList');
    const go = (id) => () => document.getElementById(id).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    const cmds = SECTIONS.filter(([id]) => !document.getElementById(id).hidden).map(([id, l]) => ({ k: 'Go to ' + l, h: 'section', f: go(id) }))
      .concat([
        { k: 'Toggle light / dark theme', h: 'theme', f: toggleTheme },
        { k: 'Copy email address', h: primaryEmail(), f: () => copy(primaryEmail(), 'Email copied') },
        { k: 'Make it rain (flood mode)', h: 'avatar', f: actions.rain },
        { k: 'Put on sunglasses', h: 'avatar', f: actions.shades },
        { k: 'Say hi to Joy', h: 'avatar', f: () => { go('home')(); setTimeout(actions.poke, 400); } },
        { k: 'Print / save as PDF', h: 'cv', f: () => window.print() },
      ])
      .concat((DATA.tools || []).filter((t) => t.url && t.status !== 'soon').map((t) => ({ k: 'Open tool: ' + t.name, h: 'tool', f: () => { location.href = t.url; } })))
      .concat(DATA.links.filter((l) => l.url).map((l) => ({ k: 'Open ' + l.label, h: 'link', f: () => window.open(l.url, '_blank', 'noopener') })))
      .concat(DATA.publications.map((p) => ({ k: p.title, h: 'paper · ' + p.year, f: () => { go('research')(); state.query = p.title.split(' ').slice(0, 4).join(' '); $('#pubSearch').value = state.query; renderPubs(); } })));
    let sel = 0, shown = [];
    function draw() {
      const q = input.value.toLowerCase().trim();
      shown = cmds.filter((c) => !q || (c.k + ' ' + c.h).toLowerCase().includes(q)).slice(0, 9);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((c, i) => '<li role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '"><span>' + esc(c.k) + '</span><small class="mono">' + esc(c.h) + '</small></li>').join('') : '<li class="none mono">No matching command</li>';
    }
    function open() { ov.hidden = false; input.value = ''; sel = 0; draw(); setTimeout(() => input.focus(), 10); }
    function close() { ov.hidden = true; }
    function run(i) { const c = shown[i]; if (!c) return; close(); c.f(); }
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % shown.length; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % shown.length; draw(); e.preventDefault(); }
      else if (e.key === 'Enter') run(sel);
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) run(+li.dataset.i); });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    $('#cmdBtn').addEventListener('click', open);
    actions.palette = open;
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ov.hidden ? open() : close(); }
      else if (e.key === 'Escape') { close(); closeModal(); }
      else if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); open(); }
    });
  }

  // ------------------------------------------------------------ modal
  function closeModal() { $('#citeModal').hidden = true; }
  function initModal() {
    const m = $('#citeModal');
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) closeModal();
      const c = e.target.closest('[data-copy]');
      if (c) copy($('#' + c.dataset.copy).textContent, 'Citation copied');
    });
  }

  // ------------------------------------------------------------ terminal
  function initTerminal(actions) {
    const body = $('#termBody'), input = $('#termIn');
    const p = DATA.profile;
    const cmds = {
      help: () => 'commands: whoami, email, papers, skills, quest, rain, theme, socials, clear',
      whoami: () => p.name + ' · ' + p.status,
      email: () => { copy(primaryEmail(), 'Email copied'); return primaryEmail() + '  (copied)'; },
      papers: () => DATA.publications.length + ' papers — latest: “' + DATA.publications[0].title + '”',
      skills: () => DATA.skills.map((s) => s.group + ': ' + s.items.slice(0, 3).join(', ')).join('\n'),
      quest: () => p.currentQuest,
      rain: () => { actions.rain(); return 'toggled precipitation ☔'; },
      theme: () => { toggleTheme(); return 'theme → ' + document.documentElement.getAttribute('data-theme'); },
      socials: () => DATA.links.filter((l) => l.url).map((l) => l.label + ': ' + l.url).join('\n') || 'none yet',
      sudo: () => 'nice try 🙂',
      clear: () => { body.innerHTML = ''; return null; },
    };
    $('#termForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim(); input.value = '';
      if (!v) return;
      const fn = cmds[v.toLowerCase().split(' ')[0]];
      const out = fn ? fn() : 'command not found: ' + v + " — try 'help'";
      if (out === null) return;
      body.insertAdjacentHTML('beforeend', '<p><span class="prompt">$</span> ' + esc(v) + '</p><p class="out">' + esc(out).replace(/\n/g, '<br>') + '</p>');
      body.scrollTop = body.scrollHeight;
    });
  }

  // ------------------------------------------------------------ boot
  function boot(enabled) {
    const el = $('#boot');
    let seen = false;
    try { seen = sessionStorage.getItem('mrj_booted'); } catch (e) { /* ignore */ }
    if (!enabled || seen || reduced) { el.remove(); return; }
    try { sessionStorage.setItem('mrj_booted', '1'); } catch (e) { /* ignore */ }
    const lines = ['JOY.OS v2.6 — hydro edition', '> mounting river_basins/ ........ ok', '> loading CMIP6 ensembles ......... ok',
      '> calibrating SOBEK 1D/2D ......... ok', '> syncing satellite imagery ....... ok', '> spawning player_01 .............. ready'];
    const log = $('#bootLog'), fill = $('#bootFill');
    let i = 0, done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 500); };
    const iv = setInterval(() => {
      log.textContent += lines[i] + '\n';
      fill.style.width = ((i + 1) / lines.length * 100) + '%';
      if (++i >= lines.length) { clearInterval(iv); setTimeout(finish, 350); }
    }, 170);
    el.addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
  }

  // ------------------------------------------------------------ konami
  function konami(actions) {
    const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let pos = 0;
    addEventListener('keydown', (e) => {
      pos = e.key === code[pos] ? pos + 1 : (e.key === code[0] ? 1 : 0);
      if (pos === code.length) { pos = 0; actions.shades(); toast('Cheat code accepted · +10 style'); }
    });
  }

  // ------------------------------------------------------------ init
  function bindGlobal() {
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#menuBtn').addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      $('#menuBtn').setAttribute('aria-expanded', open);
    });
    $('#navLinks').addEventListener('click', () => document.body.classList.remove('menu-open'));
    // Both avatars look down and "read" while you type in search
    const reading = (on) => { if (avatar) avatar.setReading(on); if (buddy) buddy.setReading(on); };
    let readT = 0;
    $('#pubSearch').addEventListener('input', (e) => {
      state.query = e.target.value; renderPubs();
      reading(true); clearTimeout(readT); readT = setTimeout(() => reading(false), 1400);
    });
    $('#pubSearch').addEventListener('blur', () => reading(false));
    // Soft spotlight that follows the cursor across cards
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
    $('#copyMailBtn').addEventListener('click', () => copy(primaryEmail(), 'Email copied'));
    $('#topLink').addEventListener('click', (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); });
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cite]');
      if (c) {
        const p = DATA.publications[+c.dataset.cite];
        $('#apaBox').textContent = apa(p); $('#bibBox').textContent = bibtex(p);
        $('#citeModal').hidden = false;
      }
      const t = e.target.closest('[data-tag]');
      if (t) { state.query = t.dataset.tag; $('#pubSearch').value = state.query; renderPubs(); }
      const ct = e.target.closest('[data-copytext]');
      if (ct) copy(ct.dataset.copytext, 'Credential ID copied');
    });
  }

  async function init() {
    $('#year').textContent = new Date().getFullYear();
    try { DATA = await load(); }
    catch (err) {
      document.getElementById('boot') && document.getElementById('boot').remove();
      $('#main').innerHTML = '<section class="section"><div class="card"><h2>Content failed to load</h2><p class="muted">Could not read <code>data/content.json</code> (' + esc(err.message) +
        '). If you opened this file directly from disk, run it through a local web server instead — see README.md.</p></div></section>';
      return;
    }
    const settings = DATA.settings || (DATA.settings = {});
    // accepted / in-revision / preprint papers stay in the data but are only shown when switched on in admin
    if (!settings.showUnpublished) DATA.publications = (DATA.publications || []).filter((p) => p.status === 'published');
    boot(settings.bootScreen !== false);
    if (settings.flowBackground === false) document.body.classList.add('no-flow');
    $('#updated').textContent = (DATA.meta && DATA.meta.updated) || '';
    renderMeta(); renderNav(); renderHero(); renderStats(); renderMarquee(); renderFocus(); renderTools(); renderExperience(); renderGantt(); renderMap();
    renderPubTabs(); renderPubs(); renderSkills(); renderEducation(); renderLeadership(); renderContact();
    const actions = initAvatar();
    bindGlobal(); initPalette(actions); initBuddy(actions); initModal(); initTerminal(actions); konami(actions);
    countUp(); reveal(); scrollSpy(); tilt();
    if (document.body.classList.contains('is-preview')) toast('Preview mode — showing your unsaved draft');
  }

  init();
})();
