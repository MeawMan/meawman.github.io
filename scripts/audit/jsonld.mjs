#!/usr/bin/env node
// JSON-LD extractor + sanity checker over HTML files on disk (static markup only; nothing is executed).
//
//   node scripts/audit/jsonld.mjs [--root .] [--pages index.html,publications/**/index.html,...] [--out <dir>] [--require]
//
// Every <script type="application/ld+json"> must parse. Checks: every node has @type; Person has name + url;
// ScholarlyArticle has headline, author[], datePublished; SoftwareApplication has name, url,
// applicationCategory, operatingSystem; URL-valued properties are absolute https; no empty-string values.
// A page without any JSON-LD is a warning (an error with --require). Exit code 1 on any error.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, str, list, outDir, writeJson, rel, table, expandGlobs, finish } from './_lib.mjs';

const DEFAULT_PAGES = ['index.html', 'publications/**/index.html', 'tools/*/about/index.html', 'lab/index.html'];
const URL_KEYS = new Set(['url', '@id', 'sameAs', 'image', 'logo', 'mainEntityOfPage', 'downloadUrl', 'installUrl', 'codeRepository', 'license',
  'contentUrl', 'thumbnailUrl', 'embedUrl', 'isBasedOn', 'target', 'urlTemplate', 'screenshot', 'discussionUrl', 'item']);
const SOFTWARE_TYPES = ['SoftwareApplication', 'WebApplication', 'MobileApplication', 'VideoGame'];

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/jsonld.mjs [--root .] [--pages a.html,dir/**/index.html] [--out <dir>] [--require]');
  process.exit(0);
}
const root = path.resolve(str(args.root, '.'));
const requireBlocks = Boolean(args.require);
const out = args.out ? outDir(args) : null;
const { files: pages, missing: missingGlobs } = expandGlobs(root, list(args.pages, DEFAULT_PAGES));

const typesOf = (node) => (node && node['@type'] !== undefined ? [].concat(node['@type']).map(String) : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (node, key) => {
  const v = node[key];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

function checkNode(node, where, depth, res) {
  const types = typesOf(node);
  const keys = Object.keys(node);
  const isRef = keys.every((k) => k === '@id' || k === '@context');
  const isValue = '@value' in node || '@list' in node || '@set' in node;
  if (!types.length) {
    if (depth === 0 && '@graph' in node) { /* container */ } else if (!isRef && !isValue) res.errors.push(`${where}: node without @type (keys: ${keys.slice(0, 6).join(', ')})`);
  }
  for (const t of types) res.types[t] = (res.types[t] || 0) + 1;

  const need = (props, label) => { for (const p of props) if (!has(node, p)) res.errors.push(`${where}: ${label} is missing "${p}"`); };
  if (types.includes('Person')) {
    if (!has(node, 'name')) res.errors.push(`${where}: Person is missing "name"`);
    if (!has(node, 'url')) {
      // A nested Person (e.g. a co-author) may be given by name only; a top-level Person must have a url.
      if (depth === 0) res.errors.push(`${where}: Person is missing "url"`);
      else if (!has(node, '@id')) res.warnings.push(`${where}: nested Person "${node.name || '?'}" has no url/@id`);
    }
  }
  if (types.includes('ScholarlyArticle')) {
    need(['headline', 'datePublished'], 'ScholarlyArticle');
    if (!Array.isArray(node.author) || !node.author.length) res.errors.push(`${where}: ScholarlyArticle "author" must be a non-empty array`);
    if (typeof node.datePublished === 'string' && !/^\d{4}(-\d{2}(-\d{2}(T.*)?)?)?$/.test(node.datePublished)) res.errors.push(`${where}: ScholarlyArticle datePublished "${node.datePublished}" is not an ISO 8601 date`);
  }
  if (types.some((t) => SOFTWARE_TYPES.includes(t))) need(['name', 'url', 'applicationCategory', 'operatingSystem'], 'SoftwareApplication');

  for (const [k, v] of Object.entries(node)) {
    const here = `${where}.${k}`;
    const visit = (val, w) => {
      if (typeof val === 'string') {
        if (val.trim() === '') res.errors.push(`${w}: empty string`);
        else if (URL_KEYS.has(k) && !/^https:\/\/[^\s/]+/.test(val)) {
          if (k === '@id' && /^(#|_:)/.test(val)) return; // local / blank-node ids are legal
          res.errors.push(`${w}: URL is not absolute https ("${val.slice(0, 80)}")`);
        }
      } else if (Array.isArray(val)) val.forEach((x, i) => visit(x, `${w}[${i}]`));
      else if (isObj(val)) checkNode(val, w, depth + 1, res);
    };
    if (k === '@context') {
      const ctx = typeof v === 'string' ? v : null;
      if (ctx !== null && !/^https:\/\/schema\.org\/?$/.test(ctx)) res.warnings.push(`${here}: expected "https://schema.org" (got "${ctx}")`);
      continue;
    }
    if (k === '@graph') { [].concat(v).forEach((x, i) => { if (isObj(x)) checkNode(x, `${where}@graph[${i}]`, 0, res); else res.errors.push(`${where}@graph[${i}]: not an object`); }); continue; }
    if (k === '@type') { [].concat(v).forEach((x) => { if (typeof x !== 'string' || !x.trim()) res.errors.push(`${here}: empty @type`); }); continue; }
    visit(v, here);
  }
}

const report = { generatedAt: new Date().toISOString(), root: rel(root), pagesChecked: pages, patternsWithoutMatch: missingGlobs, pages: [] };
let errorTotal = 0;

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const res = { page, blocks: 0, nodes: 0, types: {}, errors: [], warnings: [] };
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\btype\s*=\s*(["']?)application\/ld\+json\1/i.test(m[1])) continue;
    res.blocks++;
    const where = `block ${res.blocks}`;
    let data;
    try { data = JSON.parse(m[2]); } catch (err) { res.errors.push(`${where}: JSON syntax error — ${err.message}`); continue; }
    const tops = Array.isArray(data) ? data : [data];
    tops.forEach((node, i) => {
      const w = tops.length > 1 ? `${where}[${i}]` : where;
      if (!isObj(node)) { res.errors.push(`${w}: top-level value is not an object`); return; }
      if (!('@context' in node)) res.warnings.push(`${w}: no @context`);
      checkNode(node, w, 0, res);
    });
  }
  res.nodes = Object.values(res.types).reduce((s, n) => s + n, 0);
  // JSON-LD created at runtime is invisible to crawlers that do not execute JS; note when the page does that.
  res.injectsJsonLdWithJs = /application\/ld\+json/.test(html.replace(re, (all, attrs) => (/application\/ld\+json/i.test(attrs) ? '' : all)));
  if (!res.blocks) {
    const msg = 'no <script type="application/ld+json"> in the static HTML';
    if (requireBlocks) res.errors.push(msg); else res.warnings.push(msg);
  }
  errorTotal += res.errors.length;
  report.pages.push(res);
}
report.summary = {
  pages: pages.length,
  blocks: report.pages.reduce((s, p) => s + p.blocks, 0),
  pagesWithoutJsonLd: report.pages.filter((p) => !p.blocks).map((p) => p.page),
  errors: errorTotal,
  warnings: report.pages.reduce((s, p) => s + p.warnings.length, 0),
};

if (missingGlobs.length) console.log('Patterns without a matching file (ignored): ' + missingGlobs.join(', '));
if (!pages.length) console.log('No pages matched.');
else console.log(table(['page', 'blocks', '@type counts', 'errors', 'warnings'], report.pages.map((p) => [p.page, p.blocks,
  Object.entries(p.types).map(([t, n]) => `${t}×${n}`).join(', ') || '-', p.errors.length, p.warnings.length])));
for (const p of report.pages) {
  for (const e of p.errors) console.log(`  ERROR ${p.page}: ${e}`);
  for (const w of p.warnings) console.log(`  warn  ${p.page}: ${w}`);
}
if (out) console.log(`Wrote ${rel(writeJson(out, 'jsonld.json', report))}`);
console.log(errorTotal ? `\n${errorTotal} JSON-LD error(s).` : '\nJSON-LD OK (no errors).');

await finish(errorTotal ? 1 : 0);
