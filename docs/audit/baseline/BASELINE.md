# Baseline audit — site before the redesign

- **What was measured:** a pristine export of `main` at commit `8401abc` (`.tmp/baseline-site/`), not the working tree.
- **When / with what:** 2026-11-10/11, Windows 11, Node 24, system Google Chrome (headless, Playwright `channel: 'chrome'`),
  Lighthouse 13.6.0, axe-core 4.14, served locally by `scripts/serve.mjs` (gzip, `Cache-Control: max-age=600`).
- **Raw data:** the JSON files next to this report. Re-run any script with `--out docs/audit/after` to compare.

Commands used (from the repo root):

```
node scripts/audit/lighthouse.mjs   --out docs/audit/baseline --root .tmp/baseline-site --form both --runs 3
node scripts/audit/axe.mjs          --out docs/audit/baseline --root .tmp/baseline-site --settle 4500
node scripts/audit/page-checks.mjs  --out docs/audit/baseline --root .tmp/baseline-site
node scripts/audit/screenshots.mjs  --out docs/audit/baseline --root .tmp/baseline-site --themes light,dark
node scripts/audit/tools-smoke.mjs  --out docs/audit/baseline --root .tmp/baseline-site
node scripts/audit/links.mjs        --out docs/audit/baseline --root .tmp/baseline-site --pages index.html,404.html
node scripts/audit/jsonld.mjs       --out docs/audit/baseline --root .tmp/baseline-site --pages index.html
```

## 1. Lighthouse — `/` (median of 3 runs)

| Form factor | Perf | A11y | Best practices | SEO | FCP | LCP | CLS | TBT | Speed Index | DOM elements | Byte weight |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Mobile (default emulation, simulated slow 4G, 4× CPU) | **75** | 92 | 100 | 100 | 1499 ms | 2587 ms | **0.523** | 46 ms | 3213 ms | 2648 | 119.1 KB |
| Desktop preset | **86** | 92 | 100 | 100 | 510 ms | 820 ms | **0.247** | 0 ms | 1345 ms | 2648 | 119.1 KB |

Per-run spread (performance score / LCP / CLS / TBT):

- Mobile: 95 / 2624 ms / 0.002 / 76 ms · 75 / 2587 ms / 0.523 / 25 ms · 71 / 2555 ms / 1.132 / 46 ms
- Desktop: 86 / 820 ms / 0.246 / 0 ms · 86 / 811 ms / 0.247 / 0 ms · 82 / 834 ms / 0.313 / 0 ms

Mobile CLS is unstable between runs (0.002 to 1.132), which is what moves the mobile performance score between 71 and 95.
Accessibility, best-practices and SEO scores were identical in all six runs.

Failed audits (score < 0.9; mobile and desktop unless noted):

- **Performance:** `cumulative-layout-shift` + `cls-culprits-insight` (desktop 3/3 runs, mobile 2/3), `largest-contentful-paint` (mobile, 2.6 s),
  `speed-index` (mobile 1/3, desktop 2/3), `render-blocking-insight`, `forced-reflow-insight`, `cache-insight` (est. 41 KiB),
  `unminified-css` (est. 2 KiB), `unminified-javascript` (est. 7 KiB), `mainthread-work-breakdown` (mobile, 3.9 s).
- **Accessibility:** `color-contrast`, `heading-order`, `link-in-text-block`.
- **Best practices / SEO:** none.

## 2. axe-core — `/` (WCAG 2.0/2.1/2.2 A + AA, best-practice)

Violating nodes per rule. Theme forced via `localStorage.mrj_theme` + `prefers-color-scheme`; measured 4.5 s after network idle.

| Rule | Impact | light 375×812 | light 1366×900 | dark 375×812 | dark 1366×900 |
|---|---|---|---|---|---|
| `color-contrast` | serious | 29 | 28 | 1 | 1 |
| `aria-allowed-role` | minor | 12 | 12 | 12 | 12 |
| `label-content-name-mismatch` | serious | 1 | 2 | 1 | 2 |
| `link-in-text-block` | serious | 1 | 1 | 1 | 1 |
| `heading-order` | moderate | 1 | 1 | 1 | 1 |
| **Total nodes** | | **44** | **44** | **16** | **17** |

Examples: `color-contrast` → `.q-label`, `.sec-kicker.pixel`, `.edu-top .live.badge`; `aria-allowed-role` → map buttons `button.site-chip[role="listitem"]`;
`label-content-name-mismatch` → `.logo`, `#cmdBtn`; `link-in-text-block` → `#topLink`; `heading-order` → `.ref:nth-child(2) > h4`.
axe also left 177–228 `color-contrast` nodes per run as "incomplete" (could not be decided automatically, mostly because of the layered backgrounds).

## 3. Page checks — `/` (fresh context = first visit, light scheme)

JavaScript on:

| Check | 375×812 | 1366×900 |
|---|---|---|
| Console errors / page errors / failed requests | 0 / 0 / 0 | 0 / 0 / 0 |
| Horizontal overflow (`scrollWidth − innerWidth`) | **32 px** (407 vs 375) | 0 px |
| `window.scrollY` 3 s after load (auto-scroll) | **2985 px** | **1722 px** |
| Page height | 17 778 px | 10 435 px |
| `<h1>` elements (visible) | 1 (1) | 1 (1) |
| Visible headings / downward level skips found | 30 / 0 | 31 / 0 |
| Visible text nodes below 12 px (of all visible text nodes) | **54** of 419 (min 10 px) | **72** of 455 (min 10 px) |
| Interactive targets under 24×24 px: raw / excluding inline links / failing after spacing exception | 31 / 30 / 0 (of 113) | 40 / 39 / 0 (of 121) |
| Render-blocking stylesheets (external) | 2 (1: Google Fonts CSS) | 2 (1) |
| Font requests / font hosts | 3 / fonts.gstatic.com | 3 / fonts.gstatic.com |
| External hosts | fonts.googleapis.com, fonts.gstatic.com (62.1 KB) | same |
| Requests / transferred | 12 / 123.9 KB | 12 / 123.9 KB |
| DOM elements | 2668 | 2668 |

- **Overflow at 375:** `body` has `overflow-x: hidden`, so the 32 px is clipped rather than scrollable; hiding `section#home > div.hero-text` removes it.
- **Auto-scroll:** with no URL hash and no user input the page is at Y = 2985 (mobile) / 1722 (desktop) three seconds after load.
  The above-the-fold screenshots show the Education section instead of the hero (the reduced-motion screenshot runs were at Y = 3028 / 1719).
- **Sub-12 px text** (most frequent): `.site-chip .num` 11 px ×11, `.pub-meta .badge.ok` 10.5 px ×9, `.pub-meta .badge.type` 10.5 px ×9,
  `.g-label small` 11.5 px ×5 (desktop), `.g-bar em` 10.5 px ×4 (desktop), `.map-legend span` 11 px ×3, `.edu-top .badge.ok` 10.5 px.
- **Small targets:** mostly `div.tags > button.tag` (22 px high) and, on desktop, a few focusable `h3` elements. None fails WCAG 2.5.8 once the
  24 px spacing exception is applied (approximate check).
- The heading check only flags jumps such as h2 → h4 between consecutive visible headings and found none; axe/Lighthouse flag `.ref:nth-child(2) > h4`.

JavaScript off:

| Check | 375×812 | 1366×900 |
|---|---|---|
| Body text length | 1321 chars | 1348 chars |
| `<h1>` in DOM / with text | 2 / 1 (the `<noscript>` one; `#heroName` is empty) | 2 / 1 |
| Opaque `position: fixed` element covering > 80% of the viewport | **yes — `div#boot`** (100%, z-index 200, `rgb(4, 6, 12)`, pointer-events auto) | **yes — `div#boot`** |
| Other fixed full-viewport layers (transparent, pointer-events none) | `canvas#flow`, `.grid-bg`, `.aurora`, `.grain` | same |

Without JS the boot splash is never removed, so the first screen is the empty splash ("click or press any key to skip") and the
`<noscript>` fallback text sits underneath it (see `home-*-nojs-*-fold.jpg`). The `<h1>` counts as rendered but is covered.

## 4. Tool pages smoke test (1366×900, service workers blocked, load + 6 s)

| Tool | h1 | Console err | Page err | Failed req | Requests | Transferred | External hosts | Buttons / inputs / selects / file | tool-shell css / js |
|---|---|---|---|---|---|---|---|---|---|
| ababahika | 0 | 0 | 0 | 0 | 26 | 455.7 KB | fonts.googleapis.com, fonts.gstatic.com, server.arcgisonline.com | 35 / 0 / 0 / 1 | yes / no |
| brishti-idf | 1 | 0 | 0 | 0 | 51 | 1.92 MB | fonts.googleapis.com, fonts.gstatic.com | 22 / 3 / 0 / 1 | yes / no |
| cn-calculator | 1 | 0 | 0 | 0 | 8 | 72.9 KB | fonts.googleapis.com, fonts.gstatic.com | 7 / 692 / 2 / 0 | yes / yes |
| dependability | 0 | 0 | 0 | 0 | 9 | 285.0 KB | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com | 7 / 17 / 13 / 1 | yes / yes |
| dsbc | 1 | 0 | 0 | 0 | 25 | 32.28 MB | cdn.jsdelivr.net, cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com | 72 / 20 / 50 / 1 | no / no |
| gaplens | **9** | 0 | 0 | 0 | 28 | 34.82 MB | cdn.jsdelivr.net, fonts.googleapis.com, fonts.gstatic.com | 14 / 5 / 15 / 2 | yes / yes |
| hydro-ml | 0 | 0 | 0 | 0 | 15 | 142.8 KB | fonts.googleapis.com, fonts.gstatic.com | 82 / 68 / 29 / 4 | yes / yes |
| hydro-series | 0 | 0 | 0 | 0 | 9 | 119.2 KB | fonts.googleapis.com, fonts.gstatic.com | 32 / 17 / 22 / 2 | yes / yes |
| openffa | 0 | 0 | 0 | 0 | 65 | 687.7 KB | fonts.googleapis.com, fonts.gstatic.com | 18 / 1 / 0 / 1 | yes / no |
| river-profile | 1 | 0 | 0 | 0 | 8 | 283.3 KB | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com | 24 / 40 / 13 / 2 | yes / no |

- All ten pages loaded with HTTP 200, no console errors, no page errors, no failed requests, no requests still pending after 6 s.
- **h1:** five tools have no `<h1>` (ababahika, dependability, hydro-ml, hydro-series, openffa); gaplens has nine
  ("GapLens", "Data", "Diagnose", "Suggest", "Compare", "Fill", "Validate two series", "Rating curve", "Methods").
- **Weight:** dsbc and gaplens download Pyodide from cdn.jsdelivr.net on load (largest single file: SciPy, 13.9 MB and 13.4 MB).
  gaplens transferred 41.1 MB in an earlier test run and 34.8 MB in this one: byte totals for these two depend on timing.
  Largest files elsewhere: brishti-idf `vendor/plotly-3.2.0.min.js` 1.48 MB, openffa `vendor/plotly.min.js` 370 KB,
  ababahika `dist/app.js` 307 KB, dependability and river-profile `xlsx.full.min.js` (cdnjs) 202 KB.
- Regression check later: `node scripts/audit/tools-smoke.mjs --out docs/audit/after --compare docs/audit/baseline/tools-smoke.json`.

## 5. Links and structured data (static files)

- **Links** (`index.html`, `404.html`): 43 references, 31 internal, 0 broken internal links or fragments. 9 unique external URLs
  (Google Fonts ×4, GitHub, ORCID, Google Scholar, LinkedIn, ResearchGate) were listed but not fetched.
- **JSON-LD** (`index.html`): **0** `<script type="application/ld+json">` blocks in the static HTML. The old site only creates one
  `Person` node at runtime in `assets/js/app.js` (`renderMeta()`), so crawlers that do not run JS see no structured data.
  The checker reports this as a warning, not an error (use `--require` to make it an error).

## 6. Screenshots

Full-page JPEGs (quality 60, reduced motion, clipped to 9000 px) plus a viewport-only `-fold.jpg` for each. Total 2.64 MB.

| File | Page height | Clipped | Size |
|---|---|---|---|
| `home-375-js-light.jpg` | 17 778 px | yes | 319 KB |
| `home-375-nojs-light.jpg` | 4547 px | no | 70 KB |
| `home-1366-js-light.jpg` | 10 435 px | yes | 722 KB |
| `home-1366-nojs-light.jpg` | 4592 px | no | 114 KB |
| `home-375-js-dark.jpg` | 17 778 px | yes | 319 KB |
| `home-375-nojs-dark.jpg` | 4547 px | no | 70 KB |
| `home-1366-js-dark.jpg` | 10 435 px | yes | 715 KB |
| `home-1366-nojs-dark.jpg` | 4592 px | no | 114 KB |

Fold shots: the same eight names with `-fold.jpg`. Tool screenshots (1366×900): `tools/ababahika.jpg`, `tools/brishti-idf.jpg`,
`tools/cn-calculator.jpg`, `tools/dependability.jpg`, `tools/dsbc.jpg`, `tools/gaplens.jpg`, `tools/hydro-ml.jpg`,
`tools/hydro-series.jpg`, `tools/openffa.jpg`, `tools/river-profile.jpg`.

Notes: the no-JS light and dark files are identical in appearance because the theme is applied by script; with JS off the site
always renders its dark default. With reduced motion emulated the boot splash is skipped, so the JS-on shots show the settled page.

## 7. Caveats

- Lighthouse ran against a local server on a development machine; absolute timings will differ from GitHub Pages. Compare
  before/after on the same machine.
- Lighthouse mobile CLS varied widely between runs; the mobile performance score ranged from 71 to 95 (median 75).
- The target-size and heading checks in `page-checks.mjs` are approximations; axe and Lighthouse remain the reference for those rules.
- External links were not fetched for the baseline.
