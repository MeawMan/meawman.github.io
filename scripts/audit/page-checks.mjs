#!/usr/bin/env node
// Structural / behavioural page checks with the system Chrome.
//
//   node scripts/audit/page-checks.mjs --out <dir> [--base URL] [--root <dir>] [--paths /,/a/] [--theme light|dark] [--settle 4500]
//
// Per path at 375×812 and 1366×900 with JS on (fresh context = first visit): console + page errors, failed
// requests, horizontal overflow, scrollY 3 s after load (auto-scroll), h1 count, heading order, visible text
// below 12px, interactive targets below 24×24 CSS px (WCAG 2.5.8), render-blocking stylesheets / scripts,
// font hosts, transferred bytes and request count.
// With JS off: visible body text length, whether a visible <h1> with text exists, and whether a
// position:fixed element covers > 80% of the viewport.
// Writes <out>/page-checks.json.

import { parseArgs, str, num, pathList, resolveBase, launchChrome, outDir, writeJson, rel, table, joinUrl, settle,
  VIEWPORTS, attempt, trackNetwork, trackErrors, fmtBytes, finish } from './_lib.mjs';

const args = parseArgs();
if (args.help) {
  console.log('Usage: node scripts/audit/page-checks.mjs --out <dir> [--base URL] [--root <dir>] [--paths /,/a/] [--theme light|dark] [--settle 4500]');
  process.exit(0);
}
const out = outDir(args, 'docs/audit/after');
const paths = pathList(args.paths, ['/']);
const theme = str(args.theme, 'light');
const settleMs = Math.max(3000, num(args.settle, 4500));

// ---- in-page collectors (run in the browser; must be self-contained) -------------------------------------
function collectDom() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const path2 = (el) => { const p = el.parentElement; return (p && p !== document.body ? sel(p) + ' > ' : '') + sel(el); };
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  // headings
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const visHs = hs.filter(visible);
  const headings = visHs.map((h) => ({ level: +h.tagName[1], text: text(h).slice(0, 70) }));
  const skips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) skips.push(`h${headings[i - 1].level} "${headings[i - 1].text.slice(0, 40)}" -> h${headings[i].level} "${headings[i].text.slice(0, 40)}"`);
  }
  const h1All = [...document.querySelectorAll('h1')];

  // small text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const visCache = new Map();
  const isVis = (el) => { if (!visCache.has(el)) visCache.set(el, visible(el)); return visCache.get(el); };
  let textNodes = 0, small = 0, smallAriaHidden = 0, smallChars = 0;
  const groups = new Map();
  let minSize = Infinity;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
    if (!isVis(el)) continue;
    textNodes++;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (!(fs < 12)) continue;
    small++; smallChars += t.length;
    if (fs < minSize) minSize = fs;
    if (el.closest('[aria-hidden="true"]')) smallAriaHidden++;
    const key = `${path2(el)} @ ${Math.round(fs * 100) / 100}px`;
    const g = groups.get(key) || { selector: path2(el), fontSizePx: Math.round(fs * 100) / 100, count: 0, sample: t.slice(0, 50) };
    g.count++; groups.set(key, g);
  }
  const smallTop = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  // interactive targets (WCAG 2.5.8 Target Size Minimum, 24×24 CSS px)
  const tSel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
  const targets = [...new Set(document.querySelectorAll(tSel))].filter((el) => {
    if (el.disabled || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < vw; // ignore things parked off-canvas
  }).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const parentText = el.parentElement ? text(el.parentElement) : '';
    const own = text(el);
    const inline = el.tagName === 'A' && cs.display.startsWith('inline') && cs.display === 'inline' && parentText.length > own.length + 1;
    return { el, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, inline, small: r.width < 24 || r.height < 24 };
  });
  const undersized = targets.filter((t) => t.small);
  const notInline = undersized.filter((t) => !t.inline);
  // Spacing exception: a 24px circle centred on the undersized target must not touch another target
  // (or another undersized target's circle).
  const failSpacing = notInline.filter((t) => {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    return targets.some((o) => {
      if (o === t || o.el.contains(t.el) || t.el.contains(o.el)) return false;
      if (o.small) { const ox = o.x + o.w / 2, oy = o.y + o.h / 2; return Math.hypot(cx - ox, cy - oy) < 24; }
      const nx = Math.max(o.x, Math.min(cx, o.x + o.w)), ny = Math.max(o.y, Math.min(cy, o.y + o.h));
      return Math.hypot(cx - nx, cy - ny) < 12;
    });
  });
  const describe = (t) => ({
    selector: path2(t.el), size: `${Math.round(t.w * 10) / 10}x${Math.round(t.h * 10) / 10}`,
    text: (text(t.el) || t.el.getAttribute('aria-label') || t.el.getAttribute('title') || '').slice(0, 40), inlineLink: t.inline,
  });

  // horizontal overflow
  const docW = document.documentElement.scrollWidth;
  const overflowers = [];
  // Find the culprits by bisection: hide an element, see whether the document gets narrower, descend.
  // (Bounding boxes alone miss pseudo-elements, transforms and content clipped by an ancestor.)
  if (docW > vw) {
    const width = () => document.documentElement.scrollWidth;
    const probe = (parent, depth) => {
      let found = false;
      for (const el of [...parent.children]) {
        if (overflowers.length >= 8) return true;
        if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
        const prev = el.style.getPropertyValue('display'), prio = el.style.getPropertyPriority('display');
        el.style.setProperty('display', 'none', 'important');
        const w = width();
        if (prev) el.style.setProperty('display', prev, prio); else el.style.removeProperty('display');
        if (w >= docW) continue;
        found = true;
        const deeper = depth < 12 && probe(el, depth + 1);
        if (!deeper) {
          const r = el.getBoundingClientRect();
          overflowers.push({ selector: path2(el), reducesOverflowByPx: docW - w, boxRight: Math.round(r.right), boxWidth: Math.round(r.width) });
        }
      }
      return found;
    };
    probe(document.body, 0);
  }

  // fixed overlays
  const fixed = [];
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const cover = (iw * ih) / (vw * vh);
    if (cover <= 0.8) continue;
    const bg = cs.backgroundColor;
    const alpha = /rgba?\(/.test(bg) ? (bg.startsWith('rgba') ? parseFloat(bg.split(',')[3]) : 1) : 1;
    // "opaque" = solid background colour; gradient/image backgrounds are reported separately (hasBackgroundImage).
    const opaque = alpha > 0.5 && parseFloat(cs.opacity) > 0.5;
    fixed.push({ selector: path2(el), coverage: Math.round(cover * 100) / 100, zIndex: cs.zIndex, opacity: cs.opacity, backgroundColor: bg,
      hasBackgroundImage: cs.backgroundImage !== 'none', pointerEvents: cs.pointerEvents, tag: el.tagName.toLowerCase(), opaque });
  }

  // render-blocking resources declared in <head>
  const origin = location.origin;
  const blockingCss = [...document.querySelectorAll('link[rel~="stylesheet"]')]
    .filter((l) => !l.disabled && (!l.media || l.media === 'all' || l.media === 'screen' || matchMedia(l.media).matches) && l.media !== 'print')
    .map((l) => ({ href: l.href, external: !l.href.startsWith(origin), inHead: !!l.closest('head') }));
  const blockingJs = [...document.querySelectorAll('head script[src]')]
    .filter((s) => !s.async && !s.defer && s.type !== 'module')
    .map((s) => ({ src: s.src, external: !s.src.startsWith(origin) }));

  const bodyText = document.body ? (document.body.innerText || '').replace(/\s+/g, ' ').trim() : '';
  const visH1 = h1All.filter((h) => visible(h) && text(h).length > 0);
  return {
    innerWidth: vw, scrollWidth: docW, bodyScrollWidth: document.body ? document.body.scrollWidth : null,
    horizontalOverflowPx: Math.max(0, docW - vw), overflowingElements: overflowers,
    rootOverflowX: { html: getComputedStyle(document.documentElement).overflowX, body: document.body ? getComputedStyle(document.body).overflowX : null },
    pageHeight: document.documentElement.scrollHeight,
    domElements: document.getElementsByTagName('*').length,
    appliedTheme: document.documentElement.getAttribute('data-theme'),
    h1Count: h1All.length, h1Visible: visH1.length, h1Texts: h1All.map((h) => text(h).slice(0, 80)),
    headingCount: headings.length, headingSkips: skips, headingOrder: headings.slice(0, 200).map((h) => `h${h.level}: ${h.text}`),
    visibleTextNodes: textNodes,
    smallText: { count: small, chars: smallChars, insideAriaHidden: smallAriaHidden, minFontSizePx: small ? minSize : null, top: smallTop },
    targets: {
      total: targets.length, under24: undersized.length, under24ExcludingInlineLinks: notInline.length,
      failingSpacingException: failSpacing.length,
      examples: (failSpacing.length ? failSpacing : notInline).slice(0, 15).map(describe),
    },
    fixedCoveringViewport: fixed,
    opaqueFixedOverlay: fixed.some((f) => f.opaque),
    renderBlockingStylesheets: blockingCss, renderBlockingHeadScripts: blockingJs,
    bodyTextLength: bodyText.length, bodyTextSample: bodyText.slice(0, 160),
    hasVisibleH1WithText: visH1.length > 0,
    linkCount: document.querySelectorAll('a[href]').length,
  };
}

// ---- run ----------------------------------------------------------------------------------------------------
const srv = await resolveBase(args);
const browser = await launchChrome();
const results = [];

for (const p of paths) {
  const url = joinUrl(srv.base, p);
  const entry = { path: p, url, js: {}, nojs: {} };

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const key = `${viewport.width}x${viewport.height}`;
    // JS on
    {
      const context = await browser.newContext({ viewport, colorScheme: theme, serviceWorkers: 'block' });
      const page = await context.newPage();
      const net = trackNetwork(page, { base: srv.base });
      const errs = trackErrors(page);
      const r = { viewport: key, viewportName: vpName };
      const res = await attempt(async () => {
        const t0 = Date.now();
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        r.loadMs = Date.now() - t0;
        await page.waitForTimeout(3000);
        r.scrollYAfter3s = await page.evaluate(() => Math.round(window.scrollY));
        r.autoScrolled = r.scrollYAfter3s > 0;
        const st = await settle(page, { extraMs: settleMs - 3000 });
        r.networkIdle = st.networkIdle;
        Object.assign(r, await page.evaluate(collectDom));
      });
      if (!res.ok) r.error = res.error;
      const n = await net.finish();
      r.consoleErrors = errs.consoleErrors;
      r.pageErrors = errs.pageErrors;
      r.failedRequests = n.failed.map((f) => ({ ...f, url: f.url.replace(srv.base, '') }));
      r.requestCount = n.requestCount;
      r.transferredBytes = n.transferredBytes;
      r.externalHosts = n.externalHosts;
      r.fontHosts = [...new Set(n.all.filter((e) => e.type === 'font').map((e) => new URL(e.url).host))];
      r.fontRequests = n.all.filter((e) => e.type === 'font').length;
      r.largestRequests = n.largest.map((l) => ({ ...l, url: l.url.replace(srv.base, '') }));
      entry.js[key] = r;
      await context.close();
    }
    // JS off
    {
      const context = await browser.newContext({ viewport, colorScheme: theme, javaScriptEnabled: false, serviceWorkers: 'block' });
      const page = await context.newPage();
      const r = { viewport: key, viewportName: vpName };
      const res = await attempt(async () => {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await settle(page, { extraMs: 1000 });
        const d = await page.evaluate(collectDom);
        Object.assign(r, {
          bodyTextLength: d.bodyTextLength, bodyTextSample: d.bodyTextSample, hasVisibleH1WithText: d.hasVisibleH1WithText,
          h1Count: d.h1Count, h1Visible: d.h1Visible, h1Texts: d.h1Texts, headingCount: d.headingCount, linkCount: d.linkCount,
          fixedCoveringViewport: d.fixedCoveringViewport, opaqueFixedOverlay: d.opaqueFixedOverlay,
          pageHeight: d.pageHeight, horizontalOverflowPx: d.horizontalOverflowPx,
        });
      });
      if (!res.ok) r.error = res.error;
      entry.nojs[key] = r;
      await context.close();
    }
  }
  results.push(entry);
}

const file = writeJson(out, 'page-checks.json', {
  generatedAt: new Date().toISOString(),
  base: srv.base, theme, settleMs,
  note: 'JS-on runs use a fresh browser context (first visit, no storage). smallText counts visible text nodes with computed font-size < 12px. targets.under24 = interactive elements smaller than 24 CSS px in either dimension; failingSpacingException additionally applies the WCAG 2.5.8 inline and spacing exceptions (approximation).',
  results,
});

for (const e of results) {
  console.log(`\n${e.path} — JS on`);
  const rows = Object.values(e.js).map((r) => (r.error ? [r.viewport, 'ERROR ' + r.error] : [
    r.viewport, r.consoleErrors.length, r.pageErrors.length, r.failedRequests.length, r.horizontalOverflowPx, r.scrollYAfter3s,
    `${r.h1Count} (${r.h1Visible} vis)`, r.headingSkips.length, r.smallText.count, `${r.targets.under24}/${r.targets.under24ExcludingInlineLinks}/${r.targets.failingSpacingException}`,
    r.renderBlockingStylesheets.filter((s) => s.external).length, r.fontHosts.join(',') || '-', r.requestCount, fmtBytes(r.transferredBytes), r.domElements,
  ]));
  console.log(table(['viewport', 'console err', 'page err', 'failed req', 'overflow px', 'scrollY@3s', 'h1', 'heading skips', 'text<12px',
    'targets<24 raw/non-inline/strict', 'ext blocking css', 'font hosts', 'requests', 'transferred', 'DOM'], rows));
  for (const r of Object.values(e.js)) {
    if (r.error) continue;
    if (r.smallText.top.length) console.log(`  ${r.viewport} smallest text: ` + r.smallText.top.slice(0, 5).map((g) => `${g.selector} ${g.fontSizePx}px ×${g.count}`).join('; '));
    if (r.overflowingElements.length) console.log(`  ${r.viewport} overflowing: ` + r.overflowingElements.map((o) => `${o.selector} (-${o.reducesOverflowByPx}px when hidden)`).join('; '));
  }
  console.log(`${e.path} — JS off`);
  console.log(table(['viewport', 'body text chars', 'visible h1 with text', 'h1 in DOM', 'opaque fixed overlay >80%', 'fixed >80% elements'],
    Object.values(e.nojs).map((r) => (r.error ? [r.viewport, 'ERROR ' + r.error] : [r.viewport, r.bodyTextLength, r.hasVisibleH1WithText ? 'yes' : 'no', r.h1Count,
      r.opaqueFixedOverlay ? 'YES' : 'no', r.fixedCoveringViewport.map((f) => f.selector).join(', ') || '-']))));
}
console.log(`\nWrote ${rel(file)}`);

await finish(0, [() => browser.close(), srv.close]);
