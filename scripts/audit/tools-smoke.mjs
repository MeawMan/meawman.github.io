#!/usr/bin/env node
// Smoke test for the tool pages (regression detector), using the system Chrome.
//
//   node scripts/audit/tools-smoke.mjs --out <dir> [--base URL] [--root <dir>] [--tools a,b] [--wait 6000]
//                                      [--compare <previous tools-smoke.json>] [--strict]
//
// For each tool page: fresh context with service workers blocked, 1366×900, load + --wait ms, then record
// title, h1s, console / page errors, failed requests, transferred bytes, the 5 largest requests, external
// hosts, control counts, whether tool-shell.css / tool-shell.js were requested, and a viewport JPEG at
// <out>/tools/<slug>.jpg. Writes <out>/tools-smoke.json.
// --compare prints differences against an earlier run (exit 1 with --strict when there are any).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, str, num, list, resolveBase, launchChrome, outDir, writeJson, rel, table, joinUrl, VIEWPORTS,
  attempt, trackNetwork, trackErrors, fmtBytes, finish, TOOL_SLUGS } from './_lib.mjs';

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/tools-smoke.mjs --out <dir> [--base URL] [--root <dir>] [--tools a,b] [--wait 6000] [--compare prev.json] [--strict]');
  process.exit(0);
}
const out = outDir(args, 'docs/audit/after');
const slugs = list(args.tools, TOOL_SLUGS);
const waitMs = num(args.wait, 6000);
const comparePath = str(args.compare, null);
const strict = Boolean(args.strict);

const srv = await resolveBase(args);
const browser = await launchChrome();
const shotDir = path.join(out, 'tools');
fs.mkdirSync(shotDir, { recursive: true });
const strip = (u) => String(u).split(srv.base).join('');
const tools = [];

for (const slug of slugs) {
  const p = `/tools/${slug}/`;
  const url = joinUrl(srv.base, p);
  const t = { slug, path: p };
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await context.newPage();
  const net = trackNetwork(context, { base: srv.base });
  const errs = trackErrors(page);
  process.stdout.write(`${slug} … `);
  const res = await attempt(async () => {
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    t.status = resp ? resp.status() : null;
    t.loadMs = Date.now() - t0;
    await page.waitForTimeout(waitMs);
  });
  if (!res.ok) t.error = res.error;
  // Record whatever state the page reached, even after a navigation timeout.
  const dom = await attempt(() => page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const q = (s) => document.querySelectorAll(s).length;
    return {
      title: document.title,
      h1Count: q('h1'),
      h1Texts: [...document.querySelectorAll('h1')].map(txt),
      controls: {
        buttons: q('button, input[type=button], input[type=submit], input[type=reset], [role=button]'),
        inputs: q('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]), textarea'),
        selects: q('select'),
        fileInputs: q('input[type=file]'),
      },
      iframes: q('iframe'),
      canvases: q('canvas'),
      domElements: document.getElementsByTagName('*').length,
      lang: document.documentElement.getAttribute('lang'),
      theme: document.documentElement.getAttribute('data-theme'),
      hasMetaDescription: !!document.querySelector('meta[name="description"][content]'),
      bodyTextLength: (document.body ? document.body.innerText || '' : '').replace(/\s+/g, ' ').trim().length,
    };
  }));
  if (dom.ok) Object.assign(t, dom.value); else t.error = t.error || dom.error;
  const shot = await attempt(() => page.screenshot({ path: path.join(shotDir, `${slug}.jpg`), type: 'jpeg', quality: 60, timeout: 20000 }));
  t.screenshot = shot.ok ? `tools/${slug}.jpg` : null;

  const n = await net.finish();
  t.consoleErrors = errs.consoleErrors.map((e) => ({ text: strip(e.text), url: e.url ? strip(e.url) : null }));
  t.pageErrors = errs.pageErrors.map(strip);
  t.failedRequests = n.failed.map((f) => ({ url: strip(f.url), status: f.status, error: f.error }));
  t.requestCount = n.requestCount;
  t.pendingRequests = n.all.filter((e) => e.status === null && !e.failed).length;
  t.transferredBytes = n.transferredBytes;
  t.largestRequests = n.largest.map((l) => ({ url: strip(l.url), bytes: l.bytes }));
  t.externalHosts = Object.keys(n.externalHosts).sort();
  t.externalBytes = Object.values(n.externalHosts).reduce((s, h) => s + h.bytes, 0);
  t.toolShellCss = n.all.some((e) => /\/tool-shell\.css(\?|$)/.test(e.url));
  t.toolShellJs = n.all.some((e) => /\/tool-shell\.js(\?|$)/.test(e.url));
  tools.push(t);
  await attempt(() => context.close());
  console.log(t.error ? `ERROR ${t.error}` : `h1 ${t.h1Count}, console ${t.consoleErrors.length}, page ${t.pageErrors.length}, failed ${t.failedRequests.length}, ${fmtBytes(t.transferredBytes)}`);
}

const file = writeJson(out, 'tools-smoke.json', {
  generatedAt: new Date().toISOString(),
  base: srv.base,
  viewport: '1366x900', waitMs, serviceWorkers: 'block',
  note: 'transferredBytes / largestRequests cover what finished within load + waitMs; tools that keep downloading (Pyodide etc.) show pendingRequests > 0 and their byte totals vary between runs. Same-origin URLs are stored relative to the base.',
  tools,
});

console.log('\n' + table(
  ['tool', 'h1', 'console err', 'page err', 'failed req', 'requests', 'transferred', 'ext hosts', 'btn/input/select/file', 'shell css/js', 'title'],
  tools.map((t) => [t.slug, t.h1Count ?? '?', t.consoleErrors.length, t.pageErrors.length, t.failedRequests.length,
    `${t.requestCount}${t.pendingRequests ? ' (+' + t.pendingRequests + ' pending)' : ''}`, fmtBytes(t.transferredBytes), t.externalHosts.length,
    t.controls ? `${t.controls.buttons}/${t.controls.inputs}/${t.controls.selects}/${t.controls.fileInputs}` : '?',
    `${t.toolShellCss ? 'y' : 'n'}/${t.toolShellJs ? 'y' : 'n'}`, (t.error ? 'ERROR ' + t.error : t.title || '').slice(0, 60)]),
));
for (const t of tools) {
  for (const e of t.consoleErrors.slice(0, 3)) console.log(`  [${t.slug}] console: ${e.text.slice(0, 200)}`);
  for (const e of t.pageErrors.slice(0, 3)) console.log(`  [${t.slug}] pageerror: ${e.slice(0, 200)}`);
  for (const f of t.failedRequests.slice(0, 5)) console.log(`  [${t.slug}] failed: ${f.status || f.error} ${f.url.slice(0, 160)}`);
}
console.log(`\nWrote ${rel(file)}`);

// ---- compare ---------------------------------------------------------------------------------------------
let diffs = 0;
if (comparePath) {
  if (!fs.existsSync(comparePath)) {
    console.log(`\n--compare: ${comparePath} not found, skipping comparison.`);
  } else {
    const prev = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
    const prevBy = new Map((prev.tools || []).map((t) => [t.slug, t]));
    const lines = [];
    const setDiff = (a, b) => a.filter((x) => !b.includes(x));
    for (const t of tools) {
      const o = prevBy.get(t.slug);
      if (!o) { lines.push(`${t.slug}: not in previous run`); continue; }
      const d = [];
      if (Boolean(o.error) !== Boolean(t.error)) d.push(`load error: ${o.error || 'none'} -> ${t.error || 'none'}`);
      if (o.h1Count !== t.h1Count) d.push(`h1 count ${o.h1Count} -> ${t.h1Count}`);
      if (JSON.stringify(o.h1Texts) !== JSON.stringify(t.h1Texts)) d.push(`h1 text ${JSON.stringify(o.h1Texts)} -> ${JSON.stringify(t.h1Texts)}`);
      if (o.title !== t.title) d.push(`title "${o.title}" -> "${t.title}"`);
      const oc = (o.consoleErrors || []).map((e) => e.text), nc = t.consoleErrors.map((e) => e.text);
      if (oc.length !== nc.length) d.push(`console errors ${oc.length} -> ${nc.length}`);
      for (const x of [...new Set(setDiff(nc, oc))].slice(0, 5)) d.push(`  new console error: ${x.slice(0, 200)}`);
      for (const x of [...new Set(setDiff(oc, nc))].slice(0, 5)) d.push(`  gone console error: ${x.slice(0, 200)}`);
      if ((o.pageErrors || []).length !== t.pageErrors.length) d.push(`page errors ${(o.pageErrors || []).length} -> ${t.pageErrors.length}`);
      for (const x of [...new Set(setDiff(t.pageErrors, o.pageErrors || []))].slice(0, 5)) d.push(`  new page error: ${x.slice(0, 200)}`);
      const of = (o.failedRequests || []).map((f) => `${f.status || f.error} ${f.url}`), nf = t.failedRequests.map((f) => `${f.status || f.error} ${f.url}`);
      if (of.length !== nf.length) d.push(`failed requests ${of.length} -> ${nf.length}`);
      for (const x of setDiff(nf, of).slice(0, 5)) d.push(`  new failed request: ${x.slice(0, 200)}`);
      for (const x of setDiff(of, nf).slice(0, 5)) d.push(`  gone failed request: ${x.slice(0, 200)}`);
      for (const k of ['buttons', 'inputs', 'selects', 'fileInputs']) {
        const a = o.controls ? o.controls[k] : undefined, b = t.controls ? t.controls[k] : undefined;
        if (a !== b) d.push(`${k} ${a} -> ${b}`);
      }
      if (o.toolShellCss !== t.toolShellCss) d.push(`tool-shell.css requested ${o.toolShellCss} -> ${t.toolShellCss}`);
      if (o.toolShellJs !== t.toolShellJs) d.push(`tool-shell.js requested ${o.toolShellJs} -> ${t.toolShellJs}`);
      const newHosts = setDiff(t.externalHosts, o.externalHosts || []), goneHosts = setDiff(o.externalHosts || [], t.externalHosts);
      if (newHosts.length) d.push(`new external hosts: ${newHosts.join(', ')}`);
      if (goneHosts.length) d.push(`external hosts no longer contacted: ${goneHosts.join(', ')}`);
      if (d.length) { diffs += d.length; lines.push(`${t.slug}:`, ...d.map((x) => '  ' + x)); }
    }
    if (!args.tools) for (const slug of prevBy.keys()) if (!tools.some((t) => t.slug === slug)) lines.push(`${slug}: in previous run but not tested now`);
    console.log(`\nComparison with ${comparePath}:`);
    console.log(lines.length ? lines.join('\n') : '  no differences in h1, errors, failed requests, controls, shell assets or external hosts');
  }
}

await finish(strict && diffs > 0 ? 1 : 0, [() => browser.close(), srv.close]);
