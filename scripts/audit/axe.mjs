#!/usr/bin/env node
// axe-core accessibility audit across theme × viewport, using the system Chrome through Playwright.
//
//   node scripts/audit/axe.mjs --out <dir> [--base URL] [--paths /,/a/] [--themes light,dark] [--settle 1500] [--strict]
//
// For each path × theme (light, dark) × viewport (375×812, 1366×900): the theme is forced before load
// (localStorage 'mrj_theme' + prefers-color-scheme), the page is given network idle + settle ms, then axe runs
// with wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa and best-practice rules.
// Writes <out>/axe.json. Exit code 1 with --strict when any violation is found.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs, num, list, pathList, resolveBase, launchChrome, outDir, writeJson, rel, table, joinUrl, settle,
  VIEWPORTS, attempt, finish } from './_lib.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/axe.mjs --out <dir> [--base URL] [--paths /,/a/] [--themes light,dark] [--settle 1500] [--strict]');
  process.exit(0);
}
const out = outDir(args, 'docs/audit/after');
const paths = pathList(args.paths, ['/']);
const themes = list(args.themes, ['light', 'dark']);
const settleMs = num(args.settle, 1500);
const strict = Boolean(args.strict);

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const axeVersion = require('axe-core/package.json').version;

const srv = await resolveBase(args);
const browser = await launchChrome();
const runs = [];

for (const p of paths) {
  for (const theme of themes) {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      const url = joinUrl(srv.base, p);
      const run = { path: p, url, theme, viewport: `${viewport.width}x${viewport.height}`, viewportName: vpName };
      const context = await browser.newContext({
        viewport, colorScheme: theme, serviceWorkers: 'block',
        ...(vpName === 'mobile' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
      });
      await context.addInitScript((t) => { try { localStorage.setItem('mrj_theme', t); } catch { /* storage blocked */ } }, theme);
      const page = await context.newPage();
      const res = await attempt(async () => {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        const st = await settle(page, { extraMs: settleMs });
        await page.evaluate(axeSource);
        const result = await page.evaluate(async (tags) => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
          const pack = (v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            tags: v.tags.filter((t) => /^wcag\d|best-practice/.test(t)),
            nodes: v.nodes.length,
            examples: v.nodes.slice(0, 5).map((n) => ({
              target: n.target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(' | '),
              html: String(n.html || '').replace(/\s+/g, ' ').slice(0, 220),
              summary: String(n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 300),
            })),
          });
          return {
            appliedTheme: document.documentElement.getAttribute('data-theme'),
            violations: r.violations.map(pack),
            incomplete: r.incomplete.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
            passes: r.passes ? r.passes.length : null,
          };
        }, TAGS);
        return { ...result, networkIdle: st.networkIdle };
      });
      if (res.ok) {
        Object.assign(run, res.value);
        run.violationCount = run.violations.length;
        run.violationNodes = run.violations.reduce((s, v) => s + v.nodes, 0);
      } else {
        run.error = res.error;
      }
      runs.push(run);
      await context.close();
      const label = `${p} [${theme} ${run.viewport}]`;
      if (run.error) console.log(`${label}: ERROR ${run.error}`);
      else console.log(`${label}: ${run.violationCount} rule(s), ${run.violationNodes} node(s)` + (run.violations.length ? ' — ' + run.violations.map((v) => `${v.id}:${v.nodes}`).join(', ') : ''));
    }
  }
}

// rule × run matrix
const ruleIds = [...new Set(runs.flatMap((r) => (r.violations || []).map((v) => v.id)))].sort();
const impactOf = (id) => { for (const r of runs) { const v = (r.violations || []).find((x) => x.id === id); if (v) return v.impact; } return null; };
const summary = {
  totalRuns: runs.length,
  erroredRuns: runs.filter((r) => r.error).length,
  totalViolationNodes: runs.reduce((s, r) => s + (r.violationNodes || 0), 0),
  byRule: Object.fromEntries(ruleIds.map((id) => [id, {
    impact: impactOf(id),
    nodesByRun: Object.fromEntries(runs.filter((r) => !r.error).map((r) => [`${r.path}|${r.theme}|${r.viewport}`, ((r.violations.find((v) => v.id === id) || {}).nodes) || 0])),
  }])),
};

const report = {
  generatedAt: new Date().toISOString(),
  tool: 'axe-core',
  axeVersion,
  tags: TAGS,
  base: srv.base,
  settleMs,
  summary,
  runs,
};
const file = writeJson(out, 'axe.json', report);

const okRuns = runs.filter((r) => !r.error);
console.log('\nViolations (nodes) by rule:');
if (!ruleIds.length) console.log('  none');
else {
  console.log(table(
    ['rule', 'impact', ...okRuns.map((r) => `${paths.length > 1 ? r.path + ' ' : ''}${r.theme}/${r.viewport.split('x')[0]}`)],
    ruleIds.map((id) => [id, impactOf(id), ...okRuns.map((r) => ((r.violations.find((v) => v.id === id) || {}).nodes) || 0)]),
  ));
}
console.log(`\nWrote ${rel(file)}`);

const anyViolations = summary.totalViolationNodes > 0;
await finish((strict && anyViolations) || summary.erroredRuns === runs.length ? 1 : 0, [() => browser.close(), srv.close]);
