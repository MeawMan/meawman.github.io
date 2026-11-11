// Generates design-explorations/a-field-sheet.html (direction A mockup) from the
// real content and map geometry. Run: node design-explorations/build-a.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('data/content.json', 'utf8'));
const g = JSON.parse(readFileSync('data/geo/bangladesh.json', 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const k = 60, cos = Math.cos(23.6 * Math.PI / 180);
const P = ([lon, lat]) => [((lon - g.bbox.w) * cos * k).toFixed(1), ((g.bbox.n - lat) * k).toFixed(1)];
const d = (l, z) => l.map((p, i) => (i ? 'L' : 'M') + P(p).join(' ')).join('') + (z ? 'Z' : '');
const W = Math.round((g.bbox.e - g.bbox.w) * cos * k), H = Math.round((g.bbox.n - g.bbox.s) * k);
const map = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Bangladesh with its major rivers and ${c.studyAreas.length} study sites">
<path class="land" d="${g.outline.map((r) => d(r, true)).join('')}"/>
${g.rivers.map((r) => `<path class="river r${r.scalerank < 4 ? 1 : 2}" d="${r.lines.map((l) => d(l)).join('')}"/>`).join('')}
<text class="lbl" x="${P([89.95, 24.75])[0]}" y="${P([89.95, 24.75])[1]}">Jamuna</text>
<text class="lbl" x="${P([88.75, 23.8])[0]}" y="${P([88.75, 23.8])[1]}">Padma</text>
<text class="lbl" x="${P([90.95, 23.35])[0]}" y="${P([90.95, 23.35])[1]}">Meghna</text>
<text class="lbl sea" x="${P([90.2, 21.05])[0]}" y="${P([90.2, 21.05])[1]}">Bay of Bengal</text>
${c.studyAreas.map((s, i) => { const p = P([s.lon, s.lat]); return `<g class="site${s.current ? ' now' : ''}"><circle cx="${p[0]}" cy="${p[1]}" r="${s.current ? 5 : 3.6}"/></g>`; }).join('')}
</svg>`;

const self = (n) => (n === c.profile.name ? `<b>${esc(n)}</b>` : esc(n));
const pub = (p, venue) => `<li class="pub"><span class="yr">${p.year}</span><div><h4><a href="#">${esc(p.title)}</a></h4>
<p class="au">${p.authors.map(self).join(', ')}</p><p class="ve">${venue}</p>
<p class="act">${p.doi ? `<a href="https://doi.org/${p.doi}">doi.org/${esc(p.doi)}</a>` : `<a href="${esc(p.url)}">ResearchGate</a>`}<a class="chip" href="#">Cite</a></p></div></li>`;
const J = c.publications.filter((p) => p.type === 'journal' && p.status === 'published');
const conf = c.publications.filter((p) => p.type === 'conference');
const order = ['LULC', 'Planform', 'Erosion', 'Landfill', 'Clustering', 'Bivariate'];
conf.sort((a, b) => order.findIndex((w) => a.title.includes(w)) - order.findIndex((w) => b.title.includes(w)));
const pre = c.publications.find((p) => p.status === 'preprint');
const venues = { 'H2Open Journal': '<i>H2Open Journal</i>, 9, 100021 · June 2026', 'Environmental and Sustainability Indicators': '<i>Environmental and Sustainability Indicators</i>, 28, 100878', 'Technical Journal, River Research Institute': '<i>Technical Journal, River Research Institute</i>, 17(1)' };

const tools = [
  ['Data preparation', [['GapLens', '', 'Find, fill & compare gaps in hydroclimate records', 'Beta'], ['Hydro-Series Toolkit', '', 'Min–max–average statistics and a series generator for any time series', 'Stable']]],
  ['Analysis', [['OpenFFA', '', 'Flood frequency analysis, validated against Bulletin 17C', 'Stable'], ['Brishti IDF', 'বৃষ্টি · rain', 'Rainfall IDF curves with every method under your control', 'Stable'], ['Dependability Analyzer', '', 'Dependable water level, flow & rainfall for reports', 'Stable'], ['Composite CN Calculator', '', 'SCS curve number and runoff for every sub-catchment', 'Stable']]],
  ['Modelling & spatial', [['River Profile Studio', '', 'River cross-sections, SOBEK Y-Z profiles & thalweg analysis', 'Stable'], ['Ababahika', 'অববাহিকা · catchment', 'Catchment slope, land cover, soil & drainage units — a GIS in your browser', 'Beta'], ['Hydro ML Studio', '', 'Machine learning for water level, discharge & rainfall', 'Stable'], ['DSBC Studio', '', 'Downscaling & bias correction of climate data', 'Stable']]],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Direction A — Field sheet · design exploration</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Noto+Sans+Bengali:wght@400&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f5ef;--surface:#fffdf8;--ink:#17232d;--muted:#4f5d68;--rule:#d8d2c4;--water:#0b5a8c;--water-soft:#dbe8f0;--silt:#8a5210;--land:#ece7da;
--serif:'Newsreader',Georgia,serif;--sans:'IBM Plex Sans','Noto Sans Bengali',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0e1820;--surface:#14212c;--ink:#e8edf0;--muted:#a3b2bd;--rule:#2a3a48;--water:#86c8f2;--water-soft:#1b3345;--silt:#e2b46a;--land:#16242f}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--ink);font:1rem/1.6 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--water);text-underline-offset:.18em;text-decoration-thickness:1px}a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--water);outline-offset:3px;border-radius:2px}
.wrap{max-width:1160px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--rule)}
header.top .wrap{display:flex;align-items:center;gap:24px;min-height:56px}
.home{font:500 1.125rem var(--serif);color:var(--ink);text-decoration:none;margin-right:auto}
nav a{color:var(--ink);text-decoration:none;font-size:.9375rem;padding:8px 2px;margin-left:20px}nav a:hover{color:var(--water)}
@media (max-width:760px){nav{display:none}}
.hero{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:48px;align-items:center;padding:56px 0 48px}
.eyebrow{font-size:.8125rem;letter-spacing:.08em;text-transform:uppercase;color:var(--silt);font-weight:600;margin:0 0 14px}
h1{font:500 clamp(2.6rem,6.2vw,4.6rem)/1.02 var(--serif);letter-spacing:-.02em;margin:0 0 20px}
.lede{font-size:1.1875rem;line-height:1.55;max-width:38em;margin:0 0 18px}.lede b{font-weight:600}
.record{color:var(--muted);font-size:.9375rem;margin:0 0 26px;font-variant-numeric:tabular-nums}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border:1px solid var(--ink);border-radius:3px;color:var(--ink);text-decoration:none;font-weight:500}
.btn.pri{background:var(--ink);color:var(--bg)}.btn:hover{border-color:var(--water);color:var(--water)}.btn.pri:hover{background:var(--water);color:var(--bg)}
.links{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.9375rem;margin:0;padding:0;list-style:none}.links a{display:inline-block;padding:4px 0}
figure{margin:0}.mapfig svg{display:block;width:100%;height:auto;max-height:520px}
.land{fill:var(--land);stroke:var(--rule);stroke-width:.8}.river{fill:none;stroke:var(--water);stroke-linecap:round;stroke-linejoin:round}.r1{stroke-width:2}.r2{stroke-width:1;opacity:.75}
.lbl{font:italic 11px var(--serif);fill:var(--water)}.lbl.sea{fill:var(--muted);letter-spacing:.2em;font-size:10px}
.site circle{fill:var(--bg);stroke:var(--ink);stroke-width:1.6}.site.now circle{fill:var(--silt);stroke:var(--silt)}
figcaption{font-size:.8125rem;color:var(--muted);border-top:1px solid var(--rule);padding-top:8px;margin-top:6px}
.sec{display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;padding:48px 0;border-top:1px solid var(--rule)}
.sec>header h2{font:500 1.75rem/1.15 var(--serif);margin:0 0 8px;position:sticky;top:80px}.sec>header p{color:var(--muted);font-size:.875rem;margin:0}
h3{font:600 .8125rem var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--silt);margin:28px 0 4px}h3:first-child{margin-top:0}
ul.pubs{list-style:none;margin:0;padding:0}.pub{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;padding:16px 0;border-bottom:1px solid var(--rule)}
.yr{color:var(--muted);font-variant-numeric:tabular-nums;padding-top:2px}.pub h4{font:500 1.1875rem/1.3 var(--serif);margin:0 0 4px}.pub h4 a{color:var(--ink);text-decoration:none}.pub h4 a:hover{color:var(--water);text-decoration:underline}
.pub p{margin:0;font-size:.9375rem}.au{color:var(--muted)}.au b{color:var(--ink);font-weight:600}.act{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:6px!important;overflow-wrap:anywhere}
.chip{border:1px solid var(--rule);border-radius:3px;padding:2px 10px;text-decoration:none;color:var(--ink);font-size:.875rem;min-height:26px;display:inline-flex;align-items:center}
.tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px 20px;margin-bottom:8px}
.tool .shot{aspect-ratio:16/10;background:repeating-linear-gradient(135deg,var(--water-soft) 0 10px,transparent 10px 20px),var(--surface);border:1px solid var(--rule);border-radius:3px;display:grid;place-items:center;color:var(--muted);font-size:.8125rem}
.tool h4{font:500 1.25rem/1.2 var(--serif);margin:10px 0 2px}.tool h4 small{font:400 .8125rem var(--sans);color:var(--muted);margin-left:6px}
.tool p{margin:0 0 6px;font-size:.9375rem;color:var(--muted)}.tool .st{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--silt)}
.tool .go{display:flex;gap:14px;font-size:.9375rem}
.contact p{font:400 1.5rem/1.35 var(--serif);margin:0 0 12px;max-width:26em}.contact dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0}.contact dt{color:var(--muted)}.contact dd{margin:0}
footer{border-top:1px solid var(--rule);padding:24px 0 40px;color:var(--muted);font-size:.875rem}
@media (max-width:900px){.hero{grid-template-columns:1fr;padding:32px 0;gap:28px}.sec{grid-template-columns:1fr;gap:16px;padding:36px 0}.sec>header h2{position:static}.mapfig{max-width:420px}}
</style></head><body>
<header class="top"><div class="wrap"><a class="home" href="#">Mahfujur Rahman Joy</a><nav aria-label="Sections"><a href="#publications">Publications</a><a href="#tools">Tools</a><a href="#">Experience</a><a href="#">Education</a><a href="#contact">Contact</a></nav></div></header>
<main class="wrap">
<section class="hero">
<div><p class="eyebrow">Water resources engineer · Dhaka, Bangladesh</p>
<h1>Mahfujur Rahman Joy</h1>
<p class="lede"><b>Research Consultant at CEGIS</b> and M.Sc. student in Water Resource Development at IWFM, BUET. I build river models, read the Earth from orbit, and use machine learning to understand floods and droughts in a changing climate.</p>
<p class="record">${J.length} journal articles · 2 preprints · ${conf.length} conference papers · 10 web tools</p>
<div class="cta"><a class="btn pri" href="#publications">Publications</a><a class="btn" href="#tools">Tools</a><a class="btn" href="#contact">Contact</a></div>
<ul class="links">${['Google Scholar', 'ORCID', 'ResearchGate', 'GitHub', 'LinkedIn'].map((l) => `<li><a href="${esc(c.links.find((x) => x.label === l).url)}">${l}</a></li>`).join('')}</ul></div>
<figure class="mapfig">${map}<figcaption>${c.studyAreas.length} study sites across Bangladesh; the filled marker is the current project basin. Rivers and outline: Natural Earth.</figcaption></figure>
</section>
<section class="sec" id="publications"><header><h2>Publications</h2><p>Peer-reviewed articles, preprints and conference papers.</p></header><div>
<h3>Journal articles</h3><ul class="pubs">${J.map((p) => pub(p, venues[p.venue])).join('')}</ul>
<h3>Preprints</h3><ul class="pubs">
${pub({ year: 2026, title: 'Climate associated groundwater table changes and drought risk in Bangladesh under CMIP6 projections', authors: ['Ahmad Hasan Nury', 'Abu Sadat Md. Saim', 'Anika Tasnim Sadia', 'Shaswata Roy', 'Gulam Md. Munna', 'Mahfujur Rahman Joy'], doi: '10.2139/ssrn.7540708' }, 'SSRN preprint · posted 29 Sep 2026')}
${pub(pre, 'Authorea preprint · posted 9 Sep 2025')}</ul>
<h3>Conference papers — ICCEI 2025</h3><ul class="pubs">${conf.map((p) => pub(p, esc(p.venue))).join('')}</ul>
</div></section>
<section class="sec" id="tools"><header><h2>Tools</h2><p>Ten hydrology tools that run in the browser. Files never leave your computer.</p></header><div>
${tools.map(([grp, list]) => `<h3>${grp}</h3><div class="tools">${list.map(([n, gl, tag, st]) => `<article class="tool"><div class="shot">screenshot</div><h4>${n}${gl ? `<small>${gl}</small>` : ''}</h4><p>${esc(tag)}</p><p class="st">${st}</p><p class="go"><a href="#">Open tool</a><a href="#">About &amp; methods</a></p></article>`).join('')}</div>`).join('')}
</div></section>
<section class="sec contact" id="contact"><header><h2>Contact</h2></header><div>
<p>Open to research collaboration and graduate opportunities.</p>
<dl><dt>Email</dt><dd><a href="mailto:mahfuj2sust@gmail.com">mahfuj2sust@gmail.com</a></dd><dt>Work</dt><dd><a href="mailto:mrjoy@cegisbd.com">mrjoy@cegisbd.com</a></dd><dt>Location</dt><dd>Dhaka, Bangladesh</dd></dl>
</div></section>
</main>
<footer><div class="wrap">Direction A mockup · “Field sheet”: warm survey paper and ink, serif headings, margin-rail sections, a real river map as the only illustration.</div></footer>
</body></html>`;
writeFileSync('design-explorations/a-field-sheet.html', html);
console.log('wrote a-field-sheet.html', html.length);
