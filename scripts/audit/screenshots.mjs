#!/usr/bin/env node
// Full-page + above-the-fold screenshots (JPEG) with JS enabled and disabled, using the system Chrome.
//
//   node scripts/audit/screenshots.mjs --out <dir> [--base URL] [--paths /] [--themes light,dark]
//                                      [--settle 4000] [--max-height 9000] [--quality 60]
//
// For each path × theme × width (375, 1366) × JS (on, off): reduced motion is emulated, the theme is forced
// before load (localStorage 'mrj_theme' + prefers-color-scheme) and two files are written:
//   <slug>-<width>-<js|nojs>-<theme>.jpg        full page, clipped to --max-height px
//   <slug>-<width>-<js|nojs>-<theme>-fold.jpg   viewport only (first screen, before any scrolling)
// A manifest is written to <out>/screenshots.json.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, num, list, pathList, resolveBase, launchChrome, outDir, writeJson, rel, table, joinUrl, settle,
  slugForPath, VIEWPORTS, attempt, fmtBytes, finish } from './_lib.mjs';

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/screenshots.mjs --out <dir> [--base URL] [--paths /] [--themes light,dark] [--settle 4000] [--max-height 9000] [--quality 60]');
  process.exit(0);
}
const out = outDir(args, 'docs/audit/after');
const paths = pathList(args.paths, ['/']);
const themes = list(args.themes, ['light', 'dark']);
const settleMs = num(args.settle, 4000);
const maxHeight = num(args['max-height'], 9000);
const quality = num(args.quality, 60);

const srv = await resolveBase(args);
const browser = await launchChrome();
const shots = [];

for (const p of paths) {
  for (const theme of themes) {
    for (const viewport of Object.values(VIEWPORTS)) {
      for (const js of [true, false]) {
        const url = joinUrl(srv.base, p);
        const name = `${slugForPath(p)}-${viewport.width}-${js ? 'js' : 'nojs'}-${theme}`;
        const entry = { path: p, theme, width: viewport.width, js, file: `${name}.jpg`, foldFile: `${name}-fold.jpg` };
        const context = await browser.newContext({
          viewport, colorScheme: theme, reducedMotion: 'reduce', javaScriptEnabled: js, serviceWorkers: 'block', deviceScaleFactor: 1,
        });
        await context.addInitScript((t) => { try { localStorage.setItem('mrj_theme', t); } catch { /* storage blocked */ } }, theme);
        const page = await context.newPage();
        const res = await attempt(async () => {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await settle(page, { extraMs: js ? settleMs : 800 });
          entry.scrollYBeforeShot = await page.evaluate(() => Math.round(window.scrollY));
          await page.screenshot({ path: path.join(out, entry.foldFile), type: 'jpeg', quality });
          // Walk down the page once so lazy / reveal-on-scroll content is painted, then return to the top.
          // (Timers do not run in the page when JS is disabled, so the pacing is done from Node.)
          const measure = () => page.evaluate(() => ({
            total: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
            vh: window.innerHeight,
          }));
          let m = await measure();
          const step = Math.max(200, Math.floor(m.vh * 0.8));
          for (let y = 0; y < Math.min(m.total, maxHeight + m.vh); y += step) {
            await page.evaluate((top) => window.scrollTo(0, top), y);
            await page.waitForTimeout(60);
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(400);
          m = await measure();
          const height = m.total;
          entry.pageHeight = height;
          entry.clipped = height > maxHeight;
          const opts = { path: path.join(out, entry.file), type: 'jpeg', quality, fullPage: true };
          if (entry.clipped) opts.clip = { x: 0, y: 0, width: viewport.width, height: maxHeight };
          await page.screenshot(opts);
          entry.bytes = fs.statSync(path.join(out, entry.file)).size;
          entry.foldBytes = fs.statSync(path.join(out, entry.foldFile)).size;
        });
        if (!res.ok) entry.error = res.error;
        shots.push(entry);
        await context.close();
        console.log(entry.error ? `${name}: ERROR ${entry.error}` : `${name}.jpg  ${entry.pageHeight}px${entry.clipped ? ' (clipped to ' + maxHeight + ')' : ''}  ${fmtBytes(entry.bytes)} + fold ${fmtBytes(entry.foldBytes)}`);
      }
    }
  }
}

const totalBytes = shots.reduce((s, e) => s + (e.bytes || 0) + (e.foldBytes || 0), 0);
const file = writeJson(out, 'screenshots.json', {
  generatedAt: new Date().toISOString(),
  base: srv.base,
  settleMs, maxHeight, quality, reducedMotion: true,
  totalBytes,
  shots,
});
console.log('\n' + table(['file', 'page height', 'clipped', 'size'], shots.filter((s) => !s.error).map((s) => [s.file, s.pageHeight, s.clipped ? 'yes' : 'no', fmtBytes(s.bytes)])));
console.log(`\n${shots.filter((s) => !s.error).length * 2} files, ${fmtBytes(totalBytes)} total. Wrote ${rel(file)}`);

await finish(shots.every((s) => s.error) ? 1 : 0, [() => browser.close(), srv.close]);
