// Static build: data/content.json + src/ → prerendered HTML at the repo root.
//   node scripts/build.mjs          (Node 20+, no dependencies)
//
// Writes: index.html, 404.html, publications/index.html, publications/<slug>/index.html,
//         tools/<slug>/about/index.html, sitemap.xml, assets/dist/site.<hash>.{css,js},
//         assets/dist/build-meta.json (used by the admin preview).
// GitHub Pages serves the repo as-is, so the generated files are committed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render404, renderHome, renderPublication, renderPublicationsIndex, renderToolAbout } from '../src/templates/site.mjs';
import { groupPubs, liveTools, pubSlug, toolSlug } from '../src/templates/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => join(ROOT, ...p);
const read = (p) => readFileSync(at(p), 'utf8');
const json = (p) => JSON.parse(read(p));
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn('  ! ' + m); };

function write(path, text) {
  mkdirSync(dirname(at(path)), { recursive: true });
  const old = existsSync(at(path)) ? read(path) : null;
  if (old !== text) writeFileSync(at(path), text);
  return path;
}

// ---- dates from git (fall back to today when git or history is unavailable)
const today = new Date().toISOString().slice(0, 10);
function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
/** Date of the last commit touching any of the paths; today if they have uncommitted changes or no history. */
function lastChanged(...paths) {
  if (git(['status', '--porcelain', '--', ...paths])) return today;
  return git(['log', '-1', '--format=%cs', '--', ...paths]) || today;
}

// ---- minifiers (deliberately conservative; the sources are written to suit them)
const minCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,])\s*/g, '$1').replace(/:\s+/g, ':').replace(/;}/g, '}').trim() + '\n';
const minJs = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n') + '\n';
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

// ---- inputs
const data = json('data/content.json');
const geo = existsSync(at('data/geo/bangladesh.json')) ? json('data/geo/bangladesh.json') : null;
if (!geo) warn('data/geo/bangladesh.json is missing: the study-site map is left out (run node scripts/geo/build-map.mjs)');
const shots = existsSync(at('assets/tools/shots.json')) ? json('assets/tools/shots.json') : {};
const abouts = {};
for (const t of liveTools(data)) {
  const slug = toolSlug(t);
  if (!existsSync(at('tools', slug, 'index.html'))) { warn('tool "' + t.name + '" points to tools/' + slug + '/ which has no index.html'); continue; }
  abouts[slug] = existsSync(at('tools', slug, 'about.json')) ? json('tools/' + slug + '/about.json') : {};
  delete abouts[slug].sources; // provenance notes stay in about.json only
  if (!shots[slug]) warn('no screenshot for ' + slug + ' (run npm run shots)');
  else if (!existsSync(at(shots[slug].src))) { warn('screenshot file missing: ' + shots[slug].src); delete shots[slug]; }
}
const cvUrl = data.profile.cvUrl || '';
const cvExists = !!cvUrl && !/^https?:/.test(cvUrl) ? existsSync(at(cvUrl)) : !!cvUrl;
if (cvUrl && !cvExists) warn('CV not found at ' + cvUrl + ': the "Download CV (PDF)" link is left out until the file is added');

// ---- assets
mkdirSync(at('assets/dist'), { recursive: true });
const css = minCss(read('src/css/site.css')), js = minJs(read('src/js/site.js'));
const cssFile = 'assets/dist/site.' + hash(css) + '.css', jsFile = 'assets/dist/site.' + hash(js) + '.js';
for (const f of readdirSync(at('assets/dist'))) if (/^site\.[0-9a-f]+\.(css|js)$/.test(f) && !cssFile.endsWith(f) && !jsFile.endsWith(f)) rmSync(at('assets/dist', f));
write(cssFile, css); write(jsFile, js);

const siteUrl = (data.meta.siteUrl || 'https://meawman.github.io/').replace(/\/?$/, '/');
const updated = lastChanged('data/content.json');
const build = {
  siteUrl, updated, year: +updated.slice(0, 4), now: today.slice(0, 7), cvExists, css: cssFile, js: jsFile, shots, abouts, geo,
  repo: 'https://github.com/MeawMan/meawman.github.io', lab: existsSync(at('lab/index.html')),
};
const ctx = { data, build };
write('assets/dist/build-meta.json', JSON.stringify(build) + '\n');

// ---- pages
const pages = []; // [path, lastmod, priority]
const srcDate = lastChanged('data/content.json', 'src', 'scripts/build.mjs', 'data/geo', 'assets/tools');
write('index.html', renderHome(ctx)); pages.push(['', srcDate, '1.0']);
write('404.html', render404(ctx));

const pubs = groupPubs(data).all;
const slugs = new Set();
for (const p of pubs) {
  const slug = pubSlug(p);
  if (slugs.has(slug)) throw new Error('Two publications share the slug "' + slug + '": give one of them a "slug" in content.json');
  slugs.add(slug);
  write('publications/' + slug + '/index.html', renderPublication(ctx, p)); pages.push(['publications/' + slug + '/', srcDate, '0.7']);
}
write('publications/index.html', renderPublicationsIndex(ctx)); pages.push(['publications/', srcDate, '0.8']);
// remove pages of publications that are no longer public
if (existsSync(at('publications'))) for (const d of readdirSync(at('publications'))) {
  if (statSync(at('publications', d)).isDirectory() && !slugs.has(d)) rmSync(at('publications', d), { recursive: true });
}
for (const s of data.studyAreas || []) for (const title of s.related || []) {
  if (!pubs.some((p) => p.title === title)) warn('study site "' + s.name + '" names a related paper that is not public or not found: ' + title);
}

for (const t of liveTools(data)) {
  const slug = toolSlug(t);
  if (!(slug in abouts)) continue;
  pages.push(['tools/' + slug + '/', lastChanged('tools/' + slug), '0.8']);
  write('tools/' + slug + '/about/index.html', renderToolAbout(ctx, t)); pages.push(['tools/' + slug + '/about/', lastChanged('tools/' + slug + '/about.json', 'data/content.json'), '0.5']);
}
if (build.lab) pages.push(['lab/', lastChanged('lab'), '0.3']);

write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.map(([p, d, pr]) => '  <url><loc>' + siteUrl + p + '</loc><lastmod>' + d + '</lastmod><priority>' + pr + '</priority></url>').join('\n') + '\n</urlset>\n');

console.log('Built ' + pages.length + ' pages · ' + pubs.length + ' publications · ' + Object.keys(abouts).length + ' tools · css ' + css.length + ' B · js ' + js.length + ' B · updated ' + updated);
if (warnings.length) console.log(warnings.length + ' warning(s) — see above.');
