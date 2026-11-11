// Captures one screenshot per tool page and writes optimised WebP files plus a manifest:
//   assets/tools/<slug>.webp   (800 × 500)
//   assets/tools/shots.json    { slug: { src, w, h, alt } }
//
//   node scripts/shots.mjs [--only openffa,dsbc]
//
// Uses the installed Google Chrome through Playwright (devDependency); WebP encoding is
// done by Chrome itself (canvas), so no image library is needed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { liveTools, toolSlug } from '../src/templates/util.mjs';

const VIEW = { width: 1040, height: 650 }, OUT = { w: 800, h: 500 };
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const data = JSON.parse(readFileSync('data/content.json', 'utf8'));
const manifestPath = 'assets/tools/shots.json';
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
mkdirSync('assets/tools', { recursive: true });

const srv = await startServer({ port: 0, root: '.' });
const base = srv.url.endsWith('/') ? srv.url : srv.url + '/';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const t of liveTools(data)) {
    const slug = toolSlug(t);
    if (only.length && !only.includes(slug)) continue;
    const ctx = await browser.newContext({ viewport: VIEW, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('mrj_theme', 'light'); } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    await page.goto(new URL('tools/' + slug + '/', base).href, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(5000);
    const png = await page.screenshot({ type: 'png' });
    // re-encode as WebP at the output size inside the browser
    const enc = await ctx.newPage();
    const b64 = await enc.evaluate(async ({ src, w, h }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/webp', 0.8).split(',')[1];
    }, { src: png.toString('base64'), ...OUT });
    const buf = Buffer.from(b64, 'base64');
    writeFileSync('assets/tools/' + slug + '.webp', buf);
    manifest[slug] = { src: 'assets/tools/' + slug + '.webp', w: OUT.w, h: OUT.h, alt: (manifest[slug] && manifest[slug].alt) || '' };
    console.log(slug.padEnd(16), (buf.length / 1024).toFixed(1) + ' kB');
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
