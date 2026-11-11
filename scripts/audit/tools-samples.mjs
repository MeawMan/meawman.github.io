#!/usr/bin/env node
// Functional checks for the tool pages, using the system Chrome (run after tools-smoke.mjs).
//
//   node scripts/audit/tools-samples.mjs --out <dir> [--base URL] [--port 4322] [--tools a,b] [--skip-heavy] [--heavy-timeout 180000]
//
// For every tool page:
//   shell    exactly one <h1> with the tool's name, header + footer present, About link, tool-shell.css/js requested,
//            no request to cdnjs, and no Pyodide request within 6 s of opening the page
//   theme    one click on the page's theme control flips html[data-theme] once and stores it in localStorage.mrj_theme
//   sample   the bundled sample / example control is used and a result must appear, with no console or page errors
//            (GapLens and DSBC Studio start Pyodide here; a slow CDN is reported as "not verified: timeout")
//   mobile   at 375 px wide: document.documentElement.scrollWidth vs innerWidth (horizontal overflow)
// Writes <out>/tools-samples.json and exits 1 when a check fails (timeouts of the heavy tools do not fail the run).

import { parseArgs, str, num, list, resolveBase, launchChrome, outDir, writeJson, rel, table, joinUrl, attempt, finish, TOOL_SLUGS } from './_lib.mjs';

const NAMES = {
  'gaplens': 'GapLens', 'hydro-series': 'Hydro-Series Toolkit', 'openffa': 'OpenFFA', 'brishti-idf': 'Brishti IDF',
  'dependability': 'Dependability Analyzer', 'cn-calculator': 'Composite CN Calculator', 'river-profile': 'River Profile Studio',
  'ababahika': 'Ababahika', 'hydro-ml': 'Hydro ML Studio', 'dsbc': 'DSBC Studio',
};
const THEME_BTN = { 'ababahika': '#themeBtn', 'river-profile': '#themeBtn', 'dsbc': '#theme-toggle' }; // default #tsTheme
const HEAVY = new Set(['gaplens', 'dsbc']);

const args = parseArgs();
const out = outDir(args, '.tmp/tools-samples');
const slugs = list(args.tools, TOOL_SLUGS);
const heavyTimeout = num(args['heavy-timeout'], 180000);
const skipHeavy = Boolean(args['skip-heavy']);
const srv = await resolveBase({ ...args, port: args.port ?? 4322 });
const browser = await launchChrome();

const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });

// Each returns a short description of what was seen; throws when the result does not appear.
const SAMPLES = {
  async 'ababahika'(page) {
    await page.click('#demoBtn');
    await page.waitForFunction(() => document.querySelectorAll('#layerList li').length >= 4, null, { timeout: 60000 });
    return `${await page.locator('#layerList li').count()} layers after "Demo: catchment statistics"`;
  },
  async 'brishti-idf'(page) {
    await page.getByRole('button', { name: 'Synthetic daily record (40 years)' }).click();
    await page.waitForFunction(() => /40 years|station|record/i.test(document.querySelector('#rail-status')?.textContent || ''), null, { timeout: 30000 });
    const step = page.locator('#steps button', { hasText: 'Frequency analysis' }).first();
    await step.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('#steps button')].find((x) => /Frequency analysis/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 30000 });
    await step.click();
    await page.waitForSelector('.js-plotly-plot', { state: 'attached', timeout: 90000 });
    return `Plotly chart on "Frequency analysis" (Plotly ${await page.evaluate(() => window.Plotly && window.Plotly.version)}, SheetJS ${await page.evaluate(() => window.XLSX && window.XLSX.version)})`;
  },
  async 'cn-calculator'(page) {
    const n = await page.locator('#results tbody tr').count();
    if (n !== 3) throw new Error(`expected 3 result rows, found ${n}`);
    return '3 pre-loaded sample rows in #results';
  },
  async 'dependability'(page) {
    await page.click('#btnExample');
    await visible(page, '#banner');
    await page.waitForFunction(() => document.querySelector('#results') && document.querySelector('#results').children.length > 0, null, { timeout: 15000 });
    return `example series: banner shown, results rendered (SheetJS ${await page.evaluate(() => window.XLSX && window.XLSX.version)})`;
  },
  async 'dsbc'(page) {
    await page.click('#btn-demo');
    await page.waitForFunction(() => /Demo data loaded/.test(document.querySelector('#data-status')?.textContent || '')
      || document.querySelector('#engine')?.dataset.state === 'error', null, { timeout: heavyTimeout });
    const st = await page.evaluate(() => ({ state: document.querySelector('#engine').dataset.state, text: document.querySelector('#engine-text').textContent, status: document.querySelector('#data-status').textContent }));
    if (st.state === 'error') throw new Error(st.text);
    // a chart: preview of the first dataset on the Data view
    const charts = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      return { plots: document.querySelectorAll('.js-plotly-plot').length, plotly: window.Plotly && window.Plotly.version, xlsx: window.XLSX && window.XLSX.version };
    });
    return `demo data loaded after lazy Python start; ${charts.plots} Plotly chart(s) on the page (Plotly ${charts.plotly}, SheetJS ${charts.xlsx})`;
  },
  async 'gaplens'(page) {
    await page.click('#exgo');
    await page.waitForFunction(() => { const r = document.querySelector('#recbar'); return (r && !r.hidden) || document.querySelector('.gl-boot.err'); }, null, { timeout: heavyTimeout });
    if (await page.locator('.gl-boot.err').count()) throw new Error(await page.locator('.gl-boot.err').innerText());
    const done = await page.evaluate(() => document.querySelector('#nav [data-k="data"]')?.classList.contains('done'));
    return `example loaded after lazy Python start (#recbar visible, Data step done: ${done})`;
  },
  async 'hydro-ml'(page) {
    await page.click('#dSample');
    await visible(page, '#dBadge');
    await page.click('.ts-tab[data-tab="train"]');
    await visible(page, '#tTrain');
    await page.click('#tTrain');
    // the app goes to #results when training has finished
    await page.waitForFunction(() => document.documentElement.getAttribute('data-tool-tab') === 'results', null, { timeout: 180000 });
    await visible(page, '#rKpis');
    return 'example data trained; Results tab opened with KPIs';
  },
  async 'hydro-series'(page) {
    await page.click('#wSample');
    await visible(page, '#results');
    await page.click('.ts-tab[data-tab="generator"]');
    await visible(page, '#gwSample');
    await page.click('#gwSample');
    await visible(page, '#gFillRun');
    await page.click('#gFillRun');
    await visible(page, '#gResults', 60000);
    return 'Min-Max-Avg example results and Series Generator fill results shown';
  },
  async 'openffa'(page) {
    await page.click('#steps .step[data-page="data"]');
    await page.getByText('Sample data', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Use this record' }).first().click();
    await page.waitForTimeout(800);
    await page.click('#steps .step[data-page="fit"]');
    await page.getByRole('button', { name: 'Fit selected distributions' }).click();
    await page.waitForSelector('#page-fit table', { state: 'visible', timeout: 90000 });
    await page.click('#steps .step[data-page="design"]');
    await page.waitForSelector('#page-design .js-plotly-plot', { state: 'attached', timeout: 90000 });
    return 'sample record fitted; results table and design-flood Plotly chart rendered';
  },
  async 'river-profile'(page) {
    await page.waitForFunction(() => /Sample survey loaded \(9 sections in 2 reaches\)/.test(document.querySelector('#loadStatus')?.textContent || ''), null, { timeout: 15000 });
    if (await page.locator('#dlDef').isDisabled()) throw new Error('#dlDef is disabled');
    await page.click('#btnModeThalweg');
    await page.waitForSelector('#thPlot svg, svg#thPlot', { state: 'attached', timeout: 15000 });
    return `sample survey loaded, thalweg profile drawn (SheetJS ${await page.evaluate(() => window.XLSX && window.XLSX.version)})`;
  },
};

const results = [];
let failures = 0;
for (const slug of slugs) {
  const r = { slug, name: NAMES[slug], checks: {} };
  const url = joinUrl(srv.base, `/tools/${slug}/`);
  process.stdout.write(`${slug} … `);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  let t0 = Date.now();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message || e).slice(0, 300)));
  context.on('request', (q) => requests.push({ url: q.url(), t: Date.now() - t0 }));

  // ---- shell -------------------------------------------------------------------------------------------
  const shell = await attempt(async () => {
    t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(6000);
    const d = await page.evaluate(() => ({
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
      bar: !!document.querySelector('header.ts-bar'), foot: !!document.querySelector('footer.ts-foot'),
      crumb: [...document.querySelectorAll('.ts-bar .ts-crumb a')].map((a) => a.getAttribute('href')),
      about: !!document.querySelector('.ts-bar a[href="about/"]') && !!document.querySelector('.ts-foot a[href="about/"]'),
      footText: (document.querySelector('.ts-foot p') || {}).textContent || '',
      unnamed: [...document.querySelectorAll('.ts-bar button, .ts-bar a, .ts-foot a')].filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim())).length,
      small: [...document.querySelectorAll('.ts-bar *, .ts-foot *')].filter((el) => el.children.length === 0 && el.textContent.trim() && el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.className || el.tagName),
      pixel: [...document.querySelectorAll('.ts-bar *, .ts-foot *')].some((el) => /^["']?Silkscreen/i.test(getComputedStyle(el).fontFamily)),
      tiny: [...document.querySelectorAll('.ts-bar a, .ts-bar button, .ts-foot a')].filter((el) => { const b = el.getBoundingClientRect(); return b.width && (b.height < 24 || b.width < 24); }).map((el) => el.textContent.trim().slice(0, 20)),
    }));
    const problems = [];
    if (d.h1.length !== 1 || d.h1[0] !== NAMES[slug]) problems.push(`h1 = ${JSON.stringify(d.h1)}`);
    if (!d.bar) problems.push('no header.ts-bar');
    if (!d.foot) problems.push('no footer.ts-foot');
    if (d.crumb.join(' ') !== '../../ ../../#tools') problems.push(`breadcrumb links ${d.crumb.join(' ')}`);
    if (!d.about) problems.push('About link missing in header or footer');
    if (!d.footText.startsWith(`${NAMES[slug]} is one of the hydrology tools by`)) problems.push('footer sentence');
    if (d.unnamed) problems.push(`${d.unnamed} shell control(s) without an accessible name`);
    if (d.small.length) problems.push(`shell text under 12px: ${d.small.join(', ')}`);
    if (d.pixel) problems.push('Silkscreen used in the shell');
    if (d.tiny.length) problems.push(`shell targets under 24px: ${d.tiny.join(', ')}`);
    if (!requests.some((q) => /\/tool-shell\.css/.test(q.url))) problems.push('tool-shell.css not requested');
    if (!requests.some((q) => /\/tool-shell\.js/.test(q.url))) problems.push('tool-shell.js not requested');
    const cdn = requests.filter((q) => /cdnjs\.cloudflare\.com/.test(q.url)).map((q) => q.url);
    if (cdn.length) problems.push(`cdnjs requested: ${cdn.join(', ')}`);
    const py = requests.filter((q) => /pyodide/i.test(q.url) && q.t <= 6000).map((q) => q.url);
    if (py.length) problems.push(`Pyodide requested within 6 s: ${py[0]} (+${py.length - 1})`);
    if (problems.length) throw new Error(problems.join('; '));
    return 'ok';
  });
  r.checks.shell = shell.ok ? 'ok' : `FAIL: ${shell.error}`;

  // ---- theme -------------------------------------------------------------------------------------------
  const theme = await attempt(async () => {
    const sel = THEME_BTN[slug] || '#tsTheme';
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.click(sel);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), s: localStorage.getItem('mrj_theme') }));
    if (after.t === before) throw new Error(`data-theme stayed ${before} after one click on ${sel}`);
    if (after.s !== after.t) throw new Error(`localStorage.mrj_theme = ${after.s}, data-theme = ${after.t}`);
    await page.click(sel);
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (back !== before) throw new Error(`second click gave ${back}, expected ${before}`);
    return `${before} -> ${after.t} -> ${back}`;
  });
  r.checks.theme = theme.ok ? `ok (${theme.value})` : `FAIL: ${theme.error}`;

  // ---- sample ------------------------------------------------------------------------------------------
  if (HEAVY.has(slug) && skipHeavy) r.checks.sample = 'not verified: skipped (--skip-heavy)';
  else {
    const before = errors.length;
    const s = await attempt(() => SAMPLES[slug](page));
    const newErrors = errors.slice(before);
    if (!s.ok && HEAVY.has(slug) && /Timeout|timeout/.test(s.error)) r.checks.sample = `not verified: timeout after ${heavyTimeout / 1000} s (${s.error.slice(0, 120)})`;
    else if (!s.ok) r.checks.sample = `FAIL: ${s.error.slice(0, 400)}`;
    else if (newErrors.length) r.checks.sample = `FAIL: result appeared (${s.value}) but with errors: ${newErrors.slice(0, 3).join(' | ')}`;
    else r.checks.sample = `ok (${s.value})`;
  }
  r.errors = errors.slice(0, 10);
  if (errors.length && !/FAIL/.test(r.checks.sample)) r.checks.errors = `FAIL: ${errors.length} console/page error(s): ${errors[0]}`;
  await attempt(() => page.screenshot({ path: `${out}/${slug}-sample.jpg`, type: 'jpeg', quality: 60, timeout: 20000 }));
  await attempt(() => context.close());

  // ---- mobile ------------------------------------------------------------------------------------------
  const mob = await attempt(async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block', colorScheme: 'light' });
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth,
      bar: document.querySelector('header.ts-bar').scrollWidth, barClient: document.querySelector('header.ts-bar').clientWidth,
      foot: document.querySelector('footer.ts-foot').scrollWidth }));
    await ctx.close();
    return m;
  });
  if (mob.ok) {
    r.mobile = mob.value;
    const shellOverflow = mob.value.bar > mob.value.barClient || mob.value.bar > mob.value.innerWidth || mob.value.foot > mob.value.innerWidth;
    r.checks.mobile = shellOverflow ? `FAIL: shell wider than the viewport ${JSON.stringify(mob.value)}`
      : mob.value.scrollWidth > mob.value.innerWidth ? `page overflow ${mob.value.scrollWidth} > ${mob.value.innerWidth} (not from the shell)` : 'ok';
  } else r.checks.mobile = `FAIL: ${mob.error}`;

  const failed = Object.values(r.checks).filter((c) => /^FAIL/.test(c));
  failures += failed.length;
  results.push(r);
  console.log(failed.length ? `${failed.length} FAILED` : 'ok');
}

const file = writeJson(out, 'tools-samples.json', { generatedAt: new Date().toISOString(), base: srv.base, heavyTimeout, tools: results });
console.log('\n' + table(['tool', 'shell', 'theme', 'mobile 375', 'sample'],
  results.map((r) => [r.slug, r.checks.shell.slice(0, 60), r.checks.theme.slice(0, 40), r.checks.mobile.slice(0, 50), r.checks.sample.slice(0, 110)])));
for (const r of results) for (const [k, v] of Object.entries(r.checks)) if (/^FAIL/.test(v)) console.log(`  [${r.slug}] ${k}: ${v}`);
console.log(`\nWrote ${rel(file)}`);
await finish(failures ? 1 : 0, [() => browser.close(), srv.close]);
