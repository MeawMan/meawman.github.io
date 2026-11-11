// Regenerates the share image and the PNG favicons from the design tokens and map data:
//   assets/og-image.png (1200 × 630), assets/favicon-32.png, favicon-48.png, apple-touch-icon.png
//   node scripts/brand.mjs      (uses Playwright + the installed Chrome)
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { heroMap, mapSprite } from '../src/templates/map.mjs';
import { recordLine } from '../src/templates/site.mjs';
import { esc } from '../src/templates/util.mjs';

const data = JSON.parse(readFileSync('data/content.json', 'utf8'));
const geo = JSON.parse(readFileSync('data/geo/bangladesh.json', 'utf8'));
const font = (f) => 'data:font/woff2;base64,' + readFileSync('assets/fonts/' + f).toString('base64');
const p = data.profile;

const og = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:N;src:url('${font('newsreader-500.woff2')}')}@font-face{font-family:P;font-weight:400 600;src:url('${font('plex-sans-var.woff2')}')}
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#f7f5ef;color:#17232d;font-family:P;display:grid;grid-template-columns:1fr 430px;align-items:center;padding:0 40px 0 72px;overflow:hidden}
.e{font-weight:600;font-size:21px;letter-spacing:.08em;text-transform:uppercase;color:#8a5210;margin-bottom:22px}
h1{font:500 92px/1 N;letter-spacing:-.02em;margin-bottom:30px}
.s{font-size:30px;line-height:1.35;margin-bottom:26px;max-width:640px}.r{font-size:23px;color:#4f5d68}
svg{width:100%;height:auto}.sprite{position:absolute;width:0;height:0}
.map-land{fill:#ece7da;stroke:#d8d2c4;stroke-width:.8}.map-river{fill:none;stroke:#0b5a8c;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.map-river.minor{stroke-width:.9;opacity:.7}
.map-lbl{font:italic 500 12px N;fill:#0b5a8c}.map-lbl.sea{fill:#4f5d68;letter-spacing:.18em}.map-dot{fill:#f7f5ef;stroke:#17232d;stroke-width:1.6}.map-dot.now{fill:#8a5210;stroke:#8a5210}
</style>${mapSprite(geo)}<div><p class="e">${esc([p.headline, p.location].filter(Boolean).join(' · '))}</p><h1>${esc(p.name)}</h1><p class="s">${esc(p.status)}</p><p class="r">${esc(recordLine(data))}</p></div><div>${heroMap(data, geo)}</div>`;

const icon = readFileSync('assets/favicon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(og, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync('assets/og-image.png', await page.screenshot({ type: 'png' }));
  for (const [file, size] of [['favicon-32.png', 32], ['favicon-48.png', 48], ['apple-touch-icon.png', 180]]) {
    const pg = await browser.newPage({ viewport: { width: size, height: size } });
    await pg.setContent('<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>' + icon);
    writeFileSync('assets/' + file, await pg.screenshot({ type: 'png', omitBackground: true }));
    await pg.close();
  }
  console.log('wrote og-image.png and favicons');
} finally { await browser.close(); }
