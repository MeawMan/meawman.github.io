// sw.js - service worker: caches the whole app on first visit so it works offline afterwards.
// Bump VERSION whenever files change (scripts/build-sw.mjs regenerates the list).
const VERSION = 'openffa-0.1.0-portfolio-2';
const FILES = [
  'assets/fonts/barlow-semi-condensed-latin-500-normal.woff2',
  'assets/fonts/barlow-semi-condensed-latin-600-normal.woff2',
  'assets/fonts/public-sans-latin-400-italic.woff2',
  'assets/fonts/public-sans-latin-400-normal.woff2',
  'assets/fonts/public-sans-latin-600-normal.woff2',
  'assets/fonts/public-sans-latin-700-normal.woff2',
  'assets/icon.svg',
  'css/app.css',
  'css/portfolio.css',
  'data/README.md',
  'data/coles_fremantle_sea_level.csv',
  'data/coles_port_pirie_sea_level.csv',
  'data/synthetic_monsoon_river_daily.csv',
  'data/usgs_01134500_moose_river_daily.csv',
  'data/usgs_01134500_moose_river_peaks.csv',
  'data/usgs_09480000_santa_cruz_river_peaks.csv',
  'data/usgs_11274500_orestimba_creek_peaks.csv',
  'index.html',
  'src/core/analysis.js',
  'src/core/censored.js',
  'src/core/diagnostics.js',
  'src/core/distributions.js',
  'src/core/fit.js',
  'src/core/gof.js',
  'src/core/lmoments.js',
  'src/core/lmrd_data.js',
  'src/core/mgbt.js',
  'src/core/nct.js',
  'src/core/nonstationary.js',
  'src/core/optim.js',
  'src/core/plotpos.js',
  'src/core/quadrature.js',
  'src/core/rng.js',
  'src/core/series.js',
  'src/core/special.js',
  'src/core/stats.js',
  'src/core/uncertainty.js',
  'src/io/export.js',
  'src/io/parse.js',
  'src/plot/plots.js',
  'src/plot/render.js',
  'src/ui/app.js',
  'src/ui/dom.js',
  'src/ui/help.js',
  'src/ui/pages/about.js',
  'src/ui/pages/checks.js',
  'src/ui/pages/data.js',
  'src/ui/pages/design.js',
  'src/ui/pages/fit.js',
  'src/ui/pages/nonstat.js',
  'src/ui/pages/pot.js',
  'src/ui/pages/report.js',
  'src/worker/worker.js',
  'vendor/plotly.min.js',
  'vendor/xlsx.core.min.js',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', ...FILES]))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))); self.clients.claim(); });
// Network first: online visitors always get the current files (an update shows on the next load, even if VERSION
// was not bumped); every same-origin response is also stored, so the app keeps working offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin;
  if (!same) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error())));
});
