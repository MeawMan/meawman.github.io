#!/usr/bin/env node
// Offline link checker over files on disk.
//
//   node scripts/audit/links.mjs [--root .] [--pages index.html,404.html,publications/**/index.html,...]
//                                [--out <dir>] [--external] [--site https://meawman.github.io]
//
// For every HTML page: extracts href / src / srcset / poster, url() in inline styles and <style> blocks, and
// og:image / twitter:image. Internal targets (relative, root-relative or https://meawman.github.io/…) must
// exist on disk (directory -> index.html) and `#fragment` targets must match an id in the target page.
// External links are listed, and only fetched with --external (15 s timeout; 403/429/999 from LinkedIn,
// ResearchGate, Google Scholar and doi.org count as "blocked, not broken").
// Exit code 1 when an internal link is broken.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, str, list, outDir, writeJson, rel, table, expandGlobs, parseTags, stripCode, SITE_ORIGIN, finish } from './_lib.mjs';

const DEFAULT_PAGES = ['index.html', '404.html', 'publications/**/index.html', 'tools/*/about/index.html', 'lab/index.html'];
const BLOCKING_HOSTS = /(^|\.)(linkedin\.com|researchgate\.net|scholar\.google\.[a-z.]+|doi\.org)$/i;

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/links.mjs [--root .] [--pages a.html,dir/**/index.html] [--out <dir>] [--external] [--site ' + SITE_ORIGIN + ']');
  process.exit(0);
}
const root = path.resolve(str(args.root, '.'));
const site = str(args.site, SITE_ORIGIN).replace(/\/+$/, '');
const checkExternal = Boolean(args.external);
const out = args.out ? outDir(args) : null;
const { files: pages, missing: missingGlobs } = expandGlobs(root, list(args.pages, DEFAULT_PAGES));

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const ids = new Set();
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch { /* unreadable */ }
    for (const t of parseTags(stripCode(html))) {
      if (t.attrs.id) ids.add(t.attrs.id);
      if (t.name === 'a' && t.attrs.name) ids.add(t.attrs.name);
    }
    idCache.set(file, ids);
  }
  return idCache.get(file);
}

/** Map a site pathname to a file on disk (GitHub Pages rules). Returns null when nothing matches. */
function fileFor(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  const abs = path.resolve(root, '.' + p);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
  if (isFile(abs)) return abs;
  if (isDir(abs)) { const idx = path.join(abs, 'index.html'); return isFile(idx) ? idx : null; }
  if (!path.extname(abs) && isFile(abs + '.html')) return abs + '.html';
  return null;
}

function extract(html) {
  const refs = [];
  const add = (attr, value) => { const v = String(value || '').trim(); if (v) refs.push({ attr, value: v }); };
  const cssUrls = (css, attr) => { for (const m of String(css).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) add(attr, m[1] ?? m[2] ?? m[3]); };
  for (const t of parseTags(stripCode(html))) {
    const a = t.attrs;
    if (a.href !== undefined) add(`${t.name}[href]`, a.href);
    if (a['xlink:href'] !== undefined) add(`${t.name}[xlink:href]`, a['xlink:href']);
    if (a.src !== undefined) add(`${t.name}[src]`, a.src);
    if (a.poster !== undefined) add(`${t.name}[poster]`, a.poster);
    for (const k of ['srcset', 'imagesrcset']) {
      if (a[k]) for (const part of a[k].split(',')) add(`${t.name}[${k}]`, part.trim().split(/\s+/)[0]);
    }
    if (a.style) cssUrls(a.style, `${t.name}[style]`);
    if (t.name === 'meta' && a.content && /^(og:image|og:url|twitter:image)$/i.test(a.property || a.name || '')) add(`meta[${a.property || a.name}]`, a.content);
  }
  for (const m of String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) cssUrls(m[1], 'style url()');
  return refs;
}

const report = { generatedAt: new Date().toISOString(), root: rel(root), site, pagesChecked: pages, patternsWithoutMatch: missingGlobs, pages: [], external: [] };
const externalMap = new Map(); // url -> Set(pages)
let brokenTotal = 0;

for (const page of pages) {
  const abs = path.join(root, page);
  const html = fs.readFileSync(abs, 'utf8');
  const pageUrl = new URL(site + '/' + page.replace(/(^|\/)index\.html$/, '$1'));
  const refs = extract(html);
  const entry = { page, links: refs.length, internal: 0, external: 0, skipped: 0, broken: [] };
  const seen = new Set();
  for (const ref of refs) {
    const v = ref.value;
    if (/^(mailto:|tel:|sms:|javascript:|data:|blob:|about:)/i.test(v)) { entry.skipped++; continue; }
    let u;
    try { u = new URL(v, pageUrl); } catch { entry.broken.push({ link: v, attr: ref.attr, reason: 'unparseable URL' }); continue; }
    if (!/^https?:$/.test(u.protocol)) { entry.skipped++; continue; }
    if (u.origin !== site) {
      entry.external++;
      const key = u.href;
      if (!externalMap.has(key)) externalMap.set(key, new Set());
      externalMap.get(key).add(page);
      continue;
    }
    entry.internal++;
    const dedupe = ref.attr + ' ' + v;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const file = fileFor(u.pathname);
    if (!file) { entry.broken.push({ link: v, attr: ref.attr, reason: `no file for ${u.pathname}` }); continue; }
    const frag = decodeURIComponent(u.hash.slice(1));
    if (frag && frag !== 'top' && /\.html?$/i.test(file) && !idsOf(file).has(frag)) {
      entry.broken.push({ link: v, attr: ref.attr, reason: `no element with id="${frag}" in ${rel(file)} (static HTML)` });
    }
  }
  brokenTotal += entry.broken.length;
  report.pages.push(entry);
}

async function probe(url) {
  const once = async (method) => {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-checker)', Accept: '*/*' } });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return res.status;
  };
  let status = null, error = null;
  try { status = await once('HEAD'); if (status >= 400) status = await once('GET'); } catch (e1) {
    try { status = await once('GET'); } catch (e2) { error = String((e2 && (e2.cause?.code || e2.name || e2.message)) || e1); }
  }
  const host = new URL(url).hostname;
  let verdict = 'ok';
  if (error) verdict = 'error';
  else if ([403, 429, 999].includes(status) && BLOCKING_HOSTS.test(host)) verdict = 'blocked, not broken';
  else if (status >= 400) verdict = 'broken';
  return { status, error, verdict };
}

const externals = [...externalMap.entries()].map(([url, set]) => ({ url, pages: [...set] })).sort((a, b) => a.url.localeCompare(b.url));
if (checkExternal) {
  console.log(`Checking ${externals.length} external link(s) …`);
  let i = 0;
  const worker = async () => { while (i < externals.length) { const e = externals[i++]; Object.assign(e, await probe(e.url)); } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
report.external = externals;
report.summary = {
  pages: pages.length,
  links: report.pages.reduce((s, p) => s + p.links, 0),
  internal: report.pages.reduce((s, p) => s + p.internal, 0),
  externalUnique: externals.length,
  brokenInternal: brokenTotal,
  externalChecked: checkExternal,
  brokenExternal: checkExternal ? externals.filter((e) => e.verdict === 'broken' || e.verdict === 'error').length : null,
  blockedExternal: checkExternal ? externals.filter((e) => e.verdict === 'blocked, not broken').length : null,
};

if (missingGlobs.length) console.log('Patterns without a matching file (ignored): ' + missingGlobs.join(', '));
if (!pages.length) console.log('No pages matched.');
else console.log(table(['page', 'links', 'internal', 'external', 'skipped', 'broken internal'], report.pages.map((p) => [p.page, p.links, p.internal, p.external, p.skipped, p.broken.length])));
for (const p of report.pages) for (const b of p.broken) console.log(`  BROKEN ${p.page}: ${b.attr} "${b.link}" — ${b.reason}`);
console.log(`\n${externals.length} unique external link(s)` + (checkExternal ? ':' : ' (not fetched; pass --external to check them)'));
if (checkExternal) for (const e of externals) if (e.verdict !== 'ok') console.log(`  ${e.verdict.toUpperCase()} ${e.status ?? e.error} ${e.url}`);
if (out) console.log(`Wrote ${rel(writeJson(out, 'links.json', report))}`);
console.log(brokenTotal ? `\n${brokenTotal} broken internal link(s).` : '\nNo broken internal links.');

await finish(brokenTotal ? 1 : 0);
