// Progressive enhancement only: every page is complete without this file.
const root = document.documentElement;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

// Theme: follows the system until the visitor chooses; the choice is remembered.
function currentTheme() {
  return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function labelTheme(btn) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
  btn.title = 'Switch to ' + next + ' theme';
}
function initTheme() {
  const btn = $('.theme-btn');
  if (!btn) return;
  labelTheme(btn);
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('mrj_theme', next); } catch (e) { /* private mode */ }
    labelTheme(btn);
  });
}

// Small-screen menu
function initMenu() {
  const btn = $('.menu-btn'), top = $('.top');
  if (!btn || !top) return;
  const set = (open) => { top.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => set(!top.classList.contains('open')));
  $$('.top nav a').forEach((a) => a.addEventListener('click', () => set(false)));
}

// Copy buttons
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    flash(btn, 'Copied');
  } catch (e) {
    flash(btn, 'Press Ctrl+C');
  }
}
function initCopy() {
  if (!navigator.clipboard) return;
  $$('[data-copy], [data-copy-from]').forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const from = btn.getAttribute('data-copy-from');
      copyText(from ? document.getElementById(from).textContent : btn.getAttribute('data-copy'), btn);
    });
  });
}

// Citation dialog. Without JS the Cite link simply opens the publication page.
// The native <dialog> moves focus in, keeps it inside, closes on Esc and returns focus.
function initCite() {
  const dlg = $('#cite-dlg');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest ? e.target.closest('a.cite') : null;
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    $('#cite-apa').textContent = a.getAttribute('data-apa');
    $('#cite-bib').textContent = a.getAttribute('data-bib');
    dlg.showModal();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// Study-site map: pointing at a pin highlights its entry in the list, and the reverse.
function initSites() {
  const pins = $$('.map-pin');
  if (!pins.length) return;
  const mark = (n, on) => {
    const li = document.getElementById('site-' + n), pin = pins[n - 1];
    if (li) li.classList.toggle('on', on);
    if (pin) pin.classList.toggle('on', on);
  };
  pins.forEach((pin) => {
    const n = +pin.getAttribute('data-site');
    pin.addEventListener('pointerenter', () => mark(n, true));
    pin.addEventListener('pointerleave', () => mark(n, false));
  });
  $$('.site-list li').forEach((li, i) => {
    li.addEventListener('pointerenter', () => mark(i + 1, true));
    li.addEventListener('pointerleave', () => mark(i + 1, false));
  });
}

function init() {
  initTheme(); initMenu(); initCopy(); initCite(); initSites();
}
init();

// Admin preview: admin.html opens index.html?preview=1 to show the unsaved draft.
if (new URLSearchParams(location.search).has('preview')) {
  import(new URL('../../src/js/preview.js', import.meta.url).href).then((m) => m.preview(init)).catch((e) => console.error(e));
}
