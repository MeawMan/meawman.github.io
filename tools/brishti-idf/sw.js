/**
 * sw.js — service worker for offline use after the first visit.
 * Strategy: network-first for every same-origin GET. Online, users always get the current files
 * (no stale-version surprises after an update); every successful response is also stored, so the
 * tool keeps working offline with the last copies seen. Nothing is sent anywhere: the cache lives
 * in this browser only. Bump CACHE when the shipped file list changes.
 */
const CACHE = 'brishti-idf-v0.2.0-portfolio-2';
const SHELL = [
  './', './index.html', './css/style.css', './css/portfolio.css', './js/app.js', './js/pipeline.js', './js/worker/worker.js',
  // shared with the other portfolio tools (outside this folder, same origin)
  '../../assets/vendor/plotly-3.2.0.min.js', '../../assets/vendor/xlsx-0.18.5.full.min.js',
  '../../assets/css/tool-shell.css', '../../assets/js/tool-shell.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => { /* partial precache is fine */ }));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())),
  );
});
