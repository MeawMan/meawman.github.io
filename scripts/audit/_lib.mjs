// Shared helpers for the audit scripts. No dependencies beyond playwright (loaded lazily).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE_ORIGIN = 'https://meawman.github.io';

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1366, height: 900 },
};

export const TOOL_SLUGS = ['ababahika', 'brishti-idf', 'cn-calculator', 'dependability', 'dsbc', 'gaplens', 'hydro-ml',
  'hydro-series', 'openffa', 'river-profile'];

/** Minimal `--key value` / `--key=value` / `--flag` parser. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

export function str(v, fallback) { return v === undefined || v === true || v === '' ? fallback : String(v); }
export function num(v, fallback) { const n = Number(v); return v === undefined || v === true || !Number.isFinite(n) ? fallback : n; }
export function list(v, fallback = []) {
  if (v === undefined || v === true || v === '') return fallback;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Git Bash (MSYS) rewrites arguments that look like POSIX paths: `--paths /` arrives as
 * `C:/Program Files/Git/`. Undo that so `/` and `/a/b/` survive on Windows.
 */
export function normalizeUrlPath(p) {
  let s = String(p).trim().replace(/\\/g, '/');
  const msys = s.match(/^[A-Za-z]:\/(?:Program Files(?: \(x86\))?\/Git|msys64|git-sdk-64|usr)(\/.*)?$/i);
  if (msys) s = msys[1] || '/';
  if (/^https?:\/\//i.test(s)) { const u = new URL(s); s = u.pathname + u.search; }
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

export function pathList(v, fallback = ['/']) {
  // A comma list mangled by MSYS becomes `C:/Program Files/Git/,/x/` or `/;C:/...`; split on both separators.
  if (v === undefined || v === true || v === '') return fallback;
  return String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean).map(normalizeUrlPath);
}

/** '/' -> 'home', '/publications/x/' -> 'publications-x', '/404.html' -> '404' */
export function slugForPath(p) {
  const s = String(p).split('?')[0].split('#')[0].replace(/index\.html$/i, '').replace(/\.html?$/i, '')
    .replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'home';
}

export function joinUrl(base, p) {
  return String(base).replace(/\/+$/, '') + (String(p).startsWith('/') ? p : '/' + p);
}

/** Use --base if given, otherwise start the bundled static server (free port if 4173 is busy). */
export async function resolveBase(args, { root = REPO_ROOT } = {}) {
  const given = str(args.base, null);
  if (given) return { base: given.replace(/\/+$/, ''), close: async () => {}, own: false };
  const s = await startServer({ port: num(args.port, 4173), root: str(args.root, root) });
  return { base: s.url, close: s.close, own: true };
}

/** Launch the system Chrome through Playwright. Never downloads a browser. */
export async function launchChrome(extra = {}) {
  const { chromium } = await import('playwright');
  return chromium.launch({ channel: 'chrome', headless: true, ...extra });
}

export function outDir(args, fallback = null) {
  const d = str(args.out, fallback);
  if (!d) return null;
  const abs = path.resolve(d);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function writeJson(dir, name, data) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

export function rel(file) { return path.relative(process.cwd(), file).replace(/\\/g, '/') || '.'; }

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function round(n, digits = 0) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function fmtBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** Plain-text table. rows: array of arrays (cells are stringified). */
export function table(headers, rows) {
  const all = [headers, ...rows].map((r) => r.map((c) => (c === null || c === undefined ? '-' : String(c))));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] || '').length)));
  const line = (r) => r.map((c, i) => (c || '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(all[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...all.slice(1).map(line)].join('\n');
}

/** Wait for load, then (capped) network idle, then a fixed settle delay. Never throws. */
export async function settle(page, { idleTimeout = 15000, extraMs = 1500 } = {}) {
  let networkIdle = true;
  try { await page.waitForLoadState('load', { timeout: idleTimeout }); } catch { /* keep going */ }
  try { await page.waitForLoadState('networkidle', { timeout: idleTimeout }); } catch { networkIdle = false; }
  if (extraMs > 0) await page.waitForTimeout(extraMs);
  return { networkIdle };
}

/**
 * Track every request of a page: transferred bytes, failures, hosts.
 * Returns { finish(): Promise<summary> }.
 */
export function trackNetwork(page, { base } = {}) {
  const baseHost = base ? new URL(base).host : null;
  const entries = new Map(); // request -> entry
  const pending = [];
  const isFavicon = (u) => /\/favicon\.ico(\?|$)/i.test(u);

  page.on('request', (req) => {
    entries.set(req, { url: req.url(), method: req.method(), type: req.resourceType(), status: null, bytes: 0, failed: null, fromCache: false });
  });
  page.on('response', (res) => {
    const e = entries.get(res.request());
    if (e) { e.status = res.status(); e.fromServiceWorker = res.fromServiceWorker(); }
  });
  page.on('requestfinished', (req) => {
    const e = entries.get(req);
    if (!e) return;
    pending.push(req.sizes().then((s) => {
      e.bytes = (s.responseBodySize || 0) + (s.responseHeadersSize || 0);
      e.bodyBytes = s.responseBodySize || 0;
    }).catch(() => {}));
  });
  page.on('requestfailed', (req) => {
    const e = entries.get(req);
    if (e) e.failed = (req.failure() && req.failure().errorText) || 'failed';
  });

  return {
    entries,
    async finish() {
      await Promise.allSettled(pending);
      const all = [...entries.values()].filter((e) => !e.url.startsWith('data:') && !e.url.startsWith('blob:') && !e.url.startsWith('chrome-extension:'));
      const failed = all
        .filter((e) => !isFavicon(e.url) && ((e.status !== null && e.status >= 400) || (e.failed && !/ERR_ABORTED/.test(e.failed))))
        .map((e) => ({ url: e.url, status: e.status, error: e.failed || null, type: e.type }));
      const aborted = all.filter((e) => e.failed && /ERR_ABORTED/.test(e.failed)).map((e) => e.url);
      const hosts = {};
      for (const e of all) {
        let h; try { h = new URL(e.url).host; } catch { continue; }
        if (baseHost && h === baseHost) continue;
        hosts[h] = hosts[h] || { requests: 0, bytes: 0 };
        hosts[h].requests++; hosts[h].bytes += e.bytes || 0;
      }
      const largest = [...all].sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 5)
        .map((e) => ({ url: e.url, bytes: e.bytes || 0, type: e.type }));
      return {
        requestCount: all.length,
        transferredBytes: all.reduce((s, e) => s + (e.bytes || 0), 0),
        failed,
        aborted,
        externalHosts: hosts,
        largest,
        all,
      };
    },
  };
}

/** Collect console errors and uncaught page errors. */
export function trackErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    consoleErrors.push({ text: msg.text().slice(0, 500), url: loc && loc.url ? loc.url : null });
  });
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err).slice(0, 500)));
  return { consoleErrors, pageErrors };
}

/** Run fn, never throw: returns { ok, value | error }. */
export async function attempt(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, error: String((err && err.message) || err).split('\n')[0].slice(0, 400) }; }
}

/** Close everything and exit with an explicit code so no stray handle keeps node alive. */
export async function finish(code, closers = []) {
  for (const c of closers) { try { await c(); } catch { /* ignore */ } }
  process.exitCode = code;
  // Give stdout a tick to flush, then force exit (Chrome child processes can leave handles on Windows).
  setTimeout(() => process.exit(code), 200).unref();
}

// ---- file helpers for the offline checkers (links, jsonld) ----------------------------------------------

/** Convert a simple glob (`*` = within one path segment, `**` = any depth) to a RegExp over posix paths. */
export function globToRegExp(glob) {
  const g = String(glob).split('\\').join('/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += '.+^${}()|[]\\'.includes(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}

/** All files under root (posix relative paths), skipping node_modules, .git, .tmp and docs/audit. */
export function walkFiles(root, { skip = ['node_modules', '.git', '.tmp'] } = {}) {
  const out = [];
  const walk = (dir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const relPath = relDir ? relDir + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!skip.includes(e.name)) walk(path.join(dir, e.name), relPath); } else if (e.isFile()) out.push(relPath);
    }
  };
  walk(path.resolve(root), '');
  return out;
}

/** Expand globs against root. Patterns that match nothing are returned in `missing` (not an error). */
export function expandGlobs(root, patterns) {
  const hasWild = patterns.some((p) => /[*?]/.test(p));
  const all = hasWild ? walkFiles(root) : [];
  const files = [];
  const missing = [];
  for (const raw of patterns) {
    const p = String(raw).split('\\').join('/').replace(/^\.\//, '');
    let matched;
    if (/[*?]/.test(p)) { const re = globToRegExp(p); matched = all.filter((f) => re.test(f)); } else matched = fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile() ? [p] : [];
    if (!matched.length) missing.push(p);
    for (const m of matched) if (!files.includes(m)) files.push(m);
  }
  return { files, missing };
}

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

/** Tokenise the tags of an HTML string: [{ name, attrs: {name: value} }]. Comments are ignored. */
export function parseTags(html) {
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const tags = [];
  const tagRe = /<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const attrRe = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[2]))) {
      const name = a[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    tags.push({ name: m[1].toLowerCase(), attrs });
  }
  return tags;
}

/** HTML with the bodies of <script> and <style> blanked (so strings inside code are not mistaken for markup). */
export function stripCode(html, { keepStyle = false } = {}) {
  let s = String(html).replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2');
  if (!keepStyle) s = s.replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
  return s;
}
