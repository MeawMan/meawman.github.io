/* Tool shell: theme toggle (shared with the portfolio) and the tool tabs (#minmax / #generator). */
(function () {
  'use strict';
  const root = document.documentElement;
  const tabs = Array.from(document.querySelectorAll('.ts-tab'));

  // Charts size themselves from their container, so nudge a redraw after a tab or theme change
  const redraw = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  function setTab(id, push) {
    if (!tabs.some((t) => t.dataset.tab === id)) id = tabs.length ? tabs[0].dataset.tab : id;
    root.setAttribute('data-tool-tab', id);
    tabs.forEach((t) => {
      const on = t.dataset.tab === id;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    if (push && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    redraw();
  }

  tabs.forEach((t) => {
    t.addEventListener('click', (e) => { e.preventDefault(); setTab(t.dataset.tab, true); window.scrollTo({ top: 0 }); });
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = tabs.indexOf(t), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(n.dataset.tab, true); n.focus();
    });
  });
  window.addEventListener('hashchange', () => setTab(location.hash.replace('#', ''), false));
  setTab(root.getAttribute('data-tool-tab') || 'minmax', false);

  const themeBtn = document.getElementById('tsTheme');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const t = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('mrj_theme', t); } catch (e) { /* ignore */ }
    redraw();
  });
})();
