/* Tool shell: shared behaviour for the header on the tool pages.
   - Tabs: only on pages that have .ts-tab[data-tab] (hydro-series: #minmax / #generator; hydro-ml: workflow steps).
   - Theme: only buttons marked data-ts-theme are wired here. Pages that wire their own toggle
     (openffa, brishti-idf: #tsTheme; ababahika, river-profile: #themeBtn; dsbc: #theme-toggle) leave the
     attribute off, so each page has exactly one click handler. The choice is stored in localStorage 'mrj_theme'
     ('light' | 'dark'), the same key the portfolio uses; without a stored choice the page follows the system.
   Safe to load more than once and on pages without tabs or a theme button. */
(function () {
  'use strict';
  if (window.__toolShell) return;
  window.__toolShell = true;

  const root = document.documentElement;
  const KEY = 'mrj_theme';

  // Charts size themselves from their container, so nudge a redraw after a tab or theme change
  const redraw = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  /* ---- tabs ---- */
  const tabs = Array.from(document.querySelectorAll('.ts-tab[data-tab]'));
  if (tabs.length) {
    const setTab = (id, push) => {
      if (!tabs.some((t) => t.dataset.tab === id)) id = tabs[0].dataset.tab;
      root.setAttribute('data-tool-tab', id);
      tabs.forEach((t) => {
        const on = t.dataset.tab === id;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
      });
      if (push && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      redraw();
    };
    tabs.forEach((t) => {
      t.addEventListener('click', (e) => { e.preventDefault(); setTab(t.dataset.tab, true); window.scrollTo({ top: 0 }); });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = tabs.indexOf(t), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        setTab(n.dataset.tab, true); n.focus();
      });
    });
    window.addEventListener('hashchange', () => setTab(location.hash.replace('#', ''), false));
    setTab(root.getAttribute('data-tool-tab') || tabs[0].dataset.tab, false);
  }

  /* ---- theme ---- */
  const themeBtns = Array.from(document.querySelectorAll('[data-ts-theme]'));
  if (themeBtns.length) {
    const stored = () => { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } };
    const current = () => (root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    const sync = () => themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(current() === 'dark')));
    const apply = (t, save) => {
      root.setAttribute('data-theme', t);
      if (save) { try { localStorage.setItem(KEY, t); } catch (e) { /* ignore */ } }
      sync(); redraw();
    };
    themeBtns.forEach((b) => {
      if (!b.getAttribute('aria-label') && !b.textContent.trim()) b.setAttribute('aria-label', 'Dark theme');
      b.addEventListener('click', () => apply(current() === 'light' ? 'dark' : 'light', true));
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const follow = (e) => { if (!stored()) apply(e.matches ? 'dark' : 'light', false); };
      if (mq.addEventListener) mq.addEventListener('change', follow);
    }
    sync();
  }
})();
