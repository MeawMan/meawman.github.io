#!/usr/bin/env node
// Lighthouse runner (performance, accessibility, best-practices, seo) using the system Chrome.
//
//   node scripts/audit/lighthouse.mjs --out <dir> [--base http://localhost:4173] [--paths /,/publications/x/]
//                                     [--form mobile|desktop|both] [--runs 3] [--save-lhr]
//
// Starts its own static server when --base is not given. Each run uses a fresh Chrome profile (first-visit
// state). With --runs N every metric is the median over N runs. Writes <out>/lighthouse.json. The full LHR
// JSONs are only written with --save-lhr, and then to .tmp/lighthouse/ (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs, str, num, pathList, resolveBase, outDir, writeJson, rel, median, round, table, slugForPath, joinUrl,
  fmtBytes, finish, REPO_ROOT } from './_lib.mjs';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const METRICS = {
  fcpMs: 'first-contentful-paint',
  lcpMs: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbtMs: 'total-blocking-time',
  speedIndexMs: 'speed-index',
};

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/lighthouse.mjs --out <dir> [--base URL] [--paths /,/a/] [--form mobile|desktop|both] [--runs N] [--save-lhr]');
  process.exit(0);
}
const out = outDir(args, 'docs/audit/after');
const paths = pathList(args.paths, ['/']);
const formArg = str(args.form, 'both').toLowerCase();
const forms = formArg === 'both' ? ['mobile', 'desktop'] : [formArg];
if (forms.some((f) => f !== 'mobile' && f !== 'desktop')) { console.error('--form must be mobile, desktop or both'); process.exit(2); }
const runs = Math.max(1, Math.round(num(args.runs, 1)));
const saveLhr = Boolean(args['save-lhr']);

// lighthouse + its own chrome-launcher dependency (resolved relative to lighthouse so hoisting does not matter)
const require = createRequire(import.meta.url);
const lighthouse = (await import('lighthouse')).default;
const desktopConfig = (await import('lighthouse/core/config/desktop-config.js')).default;
const lhEntry = require.resolve('lighthouse');
const chromeLauncher = await import(pathToFileURL(createRequire(lhEntry).resolve('chrome-launcher')).href);
const LH_VERSION = require('lighthouse/package.json').version;

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || undefined; // undefined -> chrome-launcher searches itself
}

function summarize(lhr) {
  const scores = {};
  for (const c of CATEGORIES) {
    const s = lhr.categories[c] && lhr.categories[c].score;
    scores[c] = typeof s === 'number' ? Math.round(s * 100) : null;
  }
  const metrics = {};
  for (const [k, id] of Object.entries(METRICS)) metrics[k] = lhr.audits[id] ? lhr.audits[id].numericValue ?? null : null;
  const dom = lhr.audits['dom-size'] || lhr.audits['dom-size-insight'];
  metrics.domElements = dom && typeof dom.numericValue === 'number' ? dom.numericValue : null;
  metrics.totalByteWeight = lhr.audits['total-byte-weight'] ? lhr.audits['total-byte-weight'].numericValue ?? null : null;

  const failed = {};
  for (const c of CATEGORIES) {
    failed[c] = [];
    const cat = lhr.categories[c];
    if (!cat) continue;
    for (const ref of cat.auditRefs) {
      if (ref.group === 'hidden') continue;
      const a = lhr.audits[ref.id];
      if (!a || a.score === null || a.score === undefined) continue;
      if (['manual', 'notApplicable', 'informative', 'error'].includes(a.scoreDisplayMode)) continue;
      if (a.score >= 0.9) continue;
      failed[c].push({ id: a.id, title: a.title, displayValue: a.displayValue || null, score: round(a.score, 2) });
    }
  }
  const runtimeError = lhr.runtimeError ? `${lhr.runtimeError.code}: ${lhr.runtimeError.message}` : null;
  return { scores, metrics, failed, runtimeError, warnings: lhr.runWarnings || [] };
}

async function runOnce(url, form) {
  const chrome = await chromeLauncher.launch({
    chromePath: findChrome(),
    chromeFlags: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio'],
    logLevel: 'silent',
  });
  try {
    const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES };
    const result = form === 'desktop' ? await lighthouse(url, flags, desktopConfig) : await lighthouse(url, flags);
    if (!result || !result.lhr) throw new Error('Lighthouse returned no result');
    return result.lhr;
  } finally {
    try { await chrome.kill(); } catch { /* Windows can refuse to delete the temp profile; harmless */ }
  }
}

function aggregate(runSummaries) {
  const ok = runSummaries.filter((r) => !r.error);
  if (!ok.length) return { error: runSummaries.map((r) => r.error).join(' | ') };
  const scores = {};
  for (const c of CATEGORIES) scores[c] = round(median(ok.map((r) => r.scores[c])), 0);
  const metrics = {};
  for (const k of [...Object.keys(METRICS), 'domElements', 'totalByteWeight']) {
    const m = median(ok.map((r) => r.metrics[k]));
    metrics[k] = k === 'cls' ? round(m, 3) : round(m, 0);
  }
  // Failed audits: union over runs, with the number of runs in which each one failed.
  const failed = {};
  for (const c of CATEGORIES) {
    const byId = new Map();
    for (const r of ok) {
      for (const f of r.failed[c]) {
        const cur = byId.get(f.id);
        if (cur) cur.failedRuns++;
        else byId.set(f.id, { id: f.id, title: f.title, displayValue: f.displayValue, failedRuns: 1 });
      }
    }
    failed[c] = [...byId.values()];
  }
  return { scores, metrics, failed };
}

const srv = await resolveBase(args);
const results = [];
let hadError = false;
console.log(`Lighthouse ${LH_VERSION} · base ${srv.base} · ${runs} run(s) per path × form factor`);

for (const p of paths) {
  for (const form of forms) {
    const url = joinUrl(srv.base, p);
    const perRun = [];
    for (let i = 0; i < runs; i++) {
      process.stdout.write(`  ${p} [${form}] run ${i + 1}/${runs} … `);
      try {
        const lhr = await runOnce(url, form);
        const s = summarize(lhr);
        if (s.runtimeError) throw new Error(s.runtimeError);
        perRun.push(s);
        console.log(`perf ${s.scores.performance} a11y ${s.scores.accessibility} bp ${s.scores['best-practices']} seo ${s.scores.seo}`);
        if (saveLhr) {
          const dir = path.join(REPO_ROOT, '.tmp', 'lighthouse');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${slugForPath(p)}-${form}-run${i + 1}.json`), JSON.stringify(lhr));
        }
      } catch (err) {
        const msg = String((err && err.message) || err).split('\n')[0];
        perRun.push({ error: msg });
        hadError = true;
        console.log('ERROR ' + msg);
      }
    }
    const agg = aggregate(perRun);
    results.push({
      path: p, url, formFactor: form, runs,
      ...agg,
      perRun: perRun.map((r) => (r.error ? { error: r.error } : { scores: r.scores, metrics: Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, k === 'cls' ? round(v, 3) : round(v, 0)])) })),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  tool: 'lighthouse',
  lighthouseVersion: LH_VERSION,
  base: srv.base,
  note: `Scores are 0-100. Metrics are the median of ${runs} run(s); times in ms, totalByteWeight in bytes. Mobile = Lighthouse default (Moto G Power emulation, simulated slow 4G, 4x CPU slowdown); desktop = Lighthouse desktop preset. failed[] lists audits with score < 0.9 (union over runs).`,
  results,
};
const file = writeJson(out, 'lighthouse.json', report);

console.log('\n' + table(
  ['path', 'form', 'Perf', 'A11y', 'BP', 'SEO', 'FCP ms', 'LCP ms', 'CLS', 'TBT ms', 'SI ms', 'DOM', 'Bytes'],
  results.map((r) => (r.error
    ? [r.path, r.formFactor, 'ERROR: ' + r.error]
    : [r.path, r.formFactor, r.scores.performance, r.scores.accessibility, r.scores['best-practices'], r.scores.seo,
      r.metrics.fcpMs, r.metrics.lcpMs, r.metrics.cls, r.metrics.tbtMs, r.metrics.speedIndexMs, r.metrics.domElements, fmtBytes(r.metrics.totalByteWeight)])),
));
for (const r of results) {
  if (r.error) continue;
  for (const c of CATEGORIES) {
    if (!r.failed[c].length) continue;
    console.log(`\n${r.path} [${r.formFactor}] ${c} — failed audits:`);
    for (const f of r.failed[c]) console.log(`  - ${f.id}${f.displayValue ? ' (' + f.displayValue + ')' : ''}: ${f.title}`);
  }
}
console.log(`\nWrote ${rel(file)}`);

await finish(hadError && results.every((r) => r.error) ? 1 : 0, [srv.close]);
