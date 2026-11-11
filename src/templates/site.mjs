// Page templates. Pure functions: (ctx) → HTML string.
//   ctx.data   content.json
//   ctx.build  { siteUrl, updated, year, now, cvExists, css, js, shots, abouts, geo, repo }
// Used by scripts/build.mjs (Node) and by the admin preview (browser).
import { apa, bibtex } from './cite.mjs';
import { heroMap, mapSprite, sitesMap } from './map.mjs';
import { articleLd, graph, homeLd, personLd, toolLd } from './schema.mjs';
import { duration, esc, fmtDate, groupPubs, liveTools, md, plural, primaryEmail, pubGroup, pubSlug, safeUrl, toolSlug } from './util.mjs';

const ICON = {
  ext: '<svg class="ic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  theme: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
};
const NAV = [['publications', 'Publications', 'research'], ['tools', 'Tools', 'tools'], ['experience', 'Experience', 'experience'], ['education', 'Education', 'education'], ['contact', 'Contact', 'contact']];
const on = (ctx, key) => ((ctx.data.settings || {}).sections || {})[key] !== false;
const ext = (url, label, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(safeUrl(url)) + '" rel="noopener">' + label + '</a>';

// ------------------------------------------------------------------ shell
function head(ctx, o) {
  const b = ctx.build, r = o.root || '';
  const url = b.siteUrl.replace(/\/$/, '') + '/' + (o.path || '');
  const img = b.siteUrl.replace(/\/$/, '') + '/assets/og-image.png';
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(o.title) + '</title>\n<meta name="description" content="' + esc(o.description) + '">\n' +
    (o.noindex ? '<meta name="robots" content="noindex">\n' : '<link rel="canonical" href="' + esc(url) + '">\n') +
    '<meta name="author" content="' + esc(ctx.data.profile.name) + '">\n' +
    (o.scholar || '') +
    '<meta property="og:type" content="' + (o.ogType || 'website') + '">\n<meta property="og:site_name" content="' + esc(ctx.data.profile.name) + '">\n' +
    '<meta property="og:url" content="' + esc(url) + '">\n<meta property="og:title" content="' + esc(o.title) + '">\n<meta property="og:description" content="' + esc(o.description) + '">\n' +
    '<meta property="og:image" content="' + img + '">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(o.title) + '">\n<meta name="twitter:description" content="' + esc(o.description) + '">\n<meta name="twitter:image" content="' + img + '">\n' +
    '<meta name="theme-color" content="#f7f5ef" media="(prefers-color-scheme: light)">\n<meta name="theme-color" content="#0e1820" media="(prefers-color-scheme: dark)">\n' +
    '<link rel="icon" href="' + r + 'assets/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="' + r + 'assets/favicon-32.png" sizes="32x32" type="image/png">\n<link rel="apple-touch-icon" href="' + r + 'assets/apple-touch-icon.png">\n' +
    '<link rel="preload" href="' + r + 'assets/fonts/plex-sans-var.woff2" as="font" type="font/woff2" crossorigin>\n<link rel="preload" href="' + r + 'assets/fonts/newsreader-500.woff2" as="font" type="font/woff2" crossorigin>\n' +
    '<link rel="stylesheet" href="' + r + b.css + '">\n' +
    // Stored theme choice is applied before first paint; without one the CSS follows the system setting.
    '<script>try{var t=localStorage.getItem("mrj_theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}document.documentElement.classList.add("js")</script>\n' +
    (o.jsonld ? '<script type="application/ld+json">' + o.jsonld.replace(/</g, '\\u003c') + '</script>\n' : '') +
    '</head>\n';
}

function header(ctx, r, home) {
  const p = ctx.data.profile;
  const links = NAV.filter((n) => on(ctx, n[2])).map(([id, label]) => '<li><a href="' + (home ? '' : r) + '#' + id + '">' + label + '</a></li>').join('');
  return '<a class="skip" href="#main">Skip to content</a>\n<header class="top"><div class="wrap">' +
    '<a class="home" href="' + (home ? '#top' : r || './') + '">' + esc(p.name) + '</a>' +
    '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>' +
    '<nav id="site-nav" aria-label="Sections"><ul>' + links + '</ul></nav>' +
    '<button class="theme-btn" type="button" aria-label="Switch colour theme" title="Switch colour theme">' + ICON.theme + '</button>' +
    '</div></header>\n';
}

function footer(ctx, r) {
  const b = ctx.build;
  return '<footer class="foot"><div class="wrap">' +
    '<p>© ' + b.year + ' ' + esc(ctx.data.profile.name) + '. Last updated <time datetime="' + esc(b.updated) + '">' + fmtDate(b.updated) + '</time>.</p>' +
    '<p><a href="' + r + '#top">Back to top</a>' + (b.lab ? ' · <a href="' + r + 'lab/">Lab</a>' : '') + (b.repo ? ' · ' + ext(b.repo, 'Source on GitHub') : '') + '</p>' +
    '</div></footer>\n';
}

function page(ctx, o, body) {
  const r = o.root || '';
  return head(ctx, o) + '<body id="top">\n' + (o.sprite || '') + header(ctx, r, o.home) + '<main id="main">\n' + body + '</main>\n' + footer(ctx, r) +
    '<script type="module" src="' + r + ctx.build.js + '"></script>\n</body>\n</html>\n';
}

const sec = (id, title, note, body, alias) => '<section class="sec" id="' + id + '" aria-labelledby="h-' + id + '">' + (alias ? '<span class="anchor" id="' + alias + '"></span>' : '') +
  '<header class="rail"><h2 id="h-' + id + '">' + title + '</h2>' + (note ? '<p>' + note + '</p>' : '') + '</header><div class="body">' + body + '</div></section>\n';

// ------------------------------------------------------------- publications
const selfName = (ctx, n) => (n === ctx.data.profile.name ? '<b>' + esc(n) + '</b>' : esc(n));

export function venueLine(p) {
  const group = pubGroup(p);
  if (group === 'preprint') return esc(p.venue) + (p.date ? ', posted ' + fmtDate(p.date) : '');
  if (group === 'conference') return esc(p.venue);
  return '<i>' + esc(p.venue) + '</i>' + (p.volume ? ', ' + esc(p.volume) + (p.issue ? '(' + esc(p.issue) + ')' : '') : '') + (p.pages ? ', ' + esc(p.pages) : '') +
    (p.date ? ' · ' + fmtDate(p.date) : '');
}

function pubLinks(p) {
  if (p.doi) return ext('https://doi.org/' + p.doi, 'doi.org/' + esc(p.doi), 'doi');
  if (p.url) return ext(p.url, (/researchgate\.net/.test(p.url) ? 'ResearchGate' : 'Full text') + ' ' + ICON.ext);
  return '';
}

function pubItem(ctx, p, r, level) {
  const href = r + 'publications/' + pubSlug(p) + '/';
  const h = 'h' + (level || 4);
  return '<li class="pub"><span class="yr">' + esc(p.year) + '</span><div>' +
    '<' + h + '><a href="' + href + '">' + esc(p.title) + '</a></' + h + '>' +
    '<p class="au">' + (p.authors || []).map((n) => selfName(ctx, n)).join(', ') + '</p>' +
    '<p class="ve">' + venueLine(p) + '</p>' +
    '<p class="act">' + pubLinks(p) + '<a class="chip cite" href="' + href + '#cite" data-apa="' + esc(apa(p)) + '" data-bib="' + esc(bibtex(p)) + '">Cite<span class="vh">: ' + esc(p.title) + '</span></a></p>' +
    '</div></li>';
}

function pubGroups(ctx, r, level) {
  const g = groupPubs(ctx.data), h = 'h' + (level || 3);
  const list = (items) => '<ul class="pubs">' + items.map((p) => pubItem(ctx, p, r, (level || 3) + 1)).join('') + '</ul>';
  return (g.journal.length ? '<' + h + ' class="kicker">Journal articles</' + h + '>' + list(g.journal) : '') +
    (g.preprint.length ? '<' + h + ' class="kicker">Preprints</' + h + '>' + list(g.preprint) : '') +
    g.conference.map((c) => '<' + h + ' class="kicker">Conference papers' + (c.event ? ' — ' + esc(c.event) : '') + '</' + h + '>' + list(c.items)).join('');
}

export function recordLine(data) {
  const g = groupPubs(data), tools = liveTools(data).length;
  return [g.journal.length && plural(g.journal.length, 'journal article'), g.preprint.length && plural(g.preprint.length, 'preprint'),
    g.conferenceCount && plural(g.conferenceCount, 'conference paper'), tools && plural(tools, 'web tool')].filter(Boolean).join(' · ');
}

// -------------------------------------------------------------------- tools
const STATUS = { stable: 'Stable', live: 'Stable', beta: 'Beta', soon: 'Coming soon' };

function toolCard(ctx, t, r) {
  const slug = toolSlug(t), shot = (ctx.build.shots || {})[slug], about = (ctx.build.abouts || {})[slug];
  const open = t.status !== 'soon' && t.url;
  const img = shot
    ? '<img src="' + r + esc(shot.src) + '" width="' + shot.w + '" height="' + shot.h + '" loading="lazy" decoding="async" alt="Screenshot of ' + esc(t.name) + ': ' + esc(shot.alt || t.tagline) + '">'
    : '<span class="noshot">' + esc(t.name) + '</span>';
  const links = [open && '<a href="' + r + esc(safeUrl(t.url)) + '">Open tool<span class="vh">: ' + esc(t.name) + '</span></a>'];
  if (about !== undefined) {
    links.push('<a href="' + r + 'tools/' + slug + '/about/">About &amp; methods<span class="vh">: ' + esc(t.name) + '</span></a>');
    if (about && about.validation) links.push('<a href="' + r + 'tools/' + slug + '/about/#validation">Validation<span class="vh">: ' + esc(t.name) + '</span></a>');
    if (about && about.cite) links.push('<a href="' + r + 'tools/' + slug + '/about/#cite">Cite<span class="vh">: ' + esc(t.name) + '</span></a>');
  }
  return '<li class="tool">' + (open ? '<a class="shot" href="' + r + esc(safeUrl(t.url)) + '" tabindex="-1">' + img + '</a>' : '<div class="shot">' + img + '</div>') +
    '<h4>' + esc(t.name) + '</h4>' +
    (t.gloss ? '<p class="gloss">' + esc(t.gloss) + '</p>' : '') +
    '<p class="tag">' + esc(t.tagline || '') + '</p>' +
    '<p class="st"><span class="status ' + esc(t.status) + '">' + (STATUS[t.status] || esc(t.status)) + '</span></p>' +
    '<p class="go">' + links.filter(Boolean).join('') + '</p></li>';
}

function toolsSection(ctx, r) {
  const tools = (ctx.data.tools || []).filter((t) => t.name);
  const groups = [...new Set(tools.map((t) => t.group || ''))];
  return groups.map((g) => (g ? '<h3 class="kicker">' + esc(g) + '</h3>' : '') + '<ul class="tools">' + tools.filter((t) => (t.group || '') === g).map((t) => toolCard(ctx, t, r)).join('') + '</ul>').join('');
}

// --------------------------------------------------------------------- home
function hero(ctx) {
  const d = ctx.data, p = d.profile, b = ctx.build;
  const cta = [on(ctx, 'research') && '<a class="btn pri" href="#publications">Publications</a>', on(ctx, 'tools') && '<a class="btn" href="#tools">Tools</a>',
    b.cvExists && p.cvUrl && '<a class="btn" href="' + esc(safeUrl(p.cvUrl)) + '">Download CV (PDF)</a>', on(ctx, 'contact') && '<a class="btn" href="#contact">Contact</a>'].filter(Boolean).join('');
  const links = (d.links || []).filter((l) => l.url).map((l) => '<li>' + ext(l.url, esc(l.label)) + '</li>').join('') +
    (primaryEmail(d) ? '<li><a href="mailto:' + esc(primaryEmail(d)) + '">Email</a></li>' : '');
  const record = recordLine(d);
  return '<section class="hero" aria-labelledby="h-name"><div class="hero-text">' +
    '<p class="eyebrow">' + esc([p.headline, p.location].filter(Boolean).join(' · ')) + '</p>' +
    '<h1 id="h-name">' + esc(p.name) + '</h1>' +
    '<p class="lede">' + md(p.bio) + '</p>' +
    ((p.researchAreas || []).length ? '<p class="areas"><span>Research areas</span> ' + p.researchAreas.map(esc).join(' · ') + '</p>' : '') +
    '<div class="cta">' + cta + '</div>' +
    '<ul class="links" aria-label="Profiles">' + links + '</ul>' +
    (record ? '<p class="record">' + record + '</p>' : '') +
    '</div>' +
    (b.geo && on(ctx, 'map') && (d.studyAreas || []).length ? '<figure class="hero-map"><a href="#sites" aria-label="Study sites: jump to the list">' + heroMap(d, b.geo) + '</a><figcaption>' +
      plural(d.studyAreas.length, 'study site') + ' across Bangladesh; the filled marker is the current project basin. <a href="#sites">See the list</a></figcaption></figure>' : '') +
    '</section>\n';
}

function aboutSection(ctx) {
  const d = ctx.data;
  const areas = (d.focusAreas || []).map((f) => '<li><h3>' + esc(f.title) + '</h3><p>' + esc(f.text) + '</p></li>').join('');
  const now = d.profile.currentProject ? '<p class="now"><span class="kicker">Current project</span> ' + esc(d.profile.currentProject) + '</p>' : '';
  return sec('about', 'Research', (d.profile.roles || []).map(esc).join(' · '), now + '<ul class="focus">' + areas + '</ul>');
}

function sitesSection(ctx) {
  const d = ctx.data, sites = d.studyAreas || [];
  const pubs = groupPubs(d).all;
  const items = sites.map((s, i) => {
    const rel = (s.related || []).map((title) => pubs.find((p) => p.title === title)).filter(Boolean)
      .map((p) => '<a href="publications/' + pubSlug(p) + '/">' + esc(p.title) + '</a>');
    return '<li id="site-' + (i + 1) + '"' + (s.current ? ' class="now"' : '') + '><h3>' + esc(s.name) + (s.current ? ' <span class="status now">Current</span>' : '') + '</h3>' +
      '<p>' + esc(s.what) + '</p><p class="meta">' + esc([s.org, s.year].filter(Boolean).join(' · ')) + '</p>' +
      (rel.length ? '<p class="rel">Paper' + (rel.length > 1 ? 's' : '') + ': ' + rel.join('; ') + '</p>' : '') + '</li>';
  }).join('');
  return sec('sites', 'Study sites', 'Where the projects and papers are located. Rivers and outline: Natural Earth.',
    '<div class="sites"><figure class="sites-map">' + sitesMap(d, ctx.build.geo) + '</figure><ol class="site-list">' + items + '</ol></div>', 'map');
}

function experienceSection(ctx) {
  const now = ctx.build.now;
  const items = (ctx.data.experience || []).map((e) => '<li class="job"><div class="when"><span>' + (fmtDate(e.start, true) || '') + ' – ' + (e.end ? fmtDate(e.end, true) : 'present') + '</span>' +
    '<span>' + esc([duration(e.start, e.end, now), e.mode, e.location].filter(Boolean).join(' · ')) + '</span></div><div>' +
    '<h3>' + esc(e.role) + '</h3><p class="org">' + esc(e.org) + (e.orgNote ? ' <span class="muted">(' + esc(e.orgNote) + ')</span>' : '') + '</p>' +
    (e.project ? '<p class="proj"><span class="kicker">Project</span> ' + esc(e.project) + '</p>' : '') +
    (e.people ? '<p class="muted">' + esc(e.people) + '</p>' : '') +
    ((e.bullets || []).length ? '<ul class="bul">' + e.bullets.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
    ((e.tools || []).length ? '<p class="used"><span class="vh">Software: </span>' + e.tools.map(esc).join(' · ') + '</p>' : '') + '</div></li>').join('');
  return sec('experience', 'Experience', '', '<ol class="jobs">' + items + '</ol>');
}

function educationSection(ctx) {
  const d = ctx.data, edu = d.education || [];
  const main = edu.filter((e) => e.level !== 'school'), school = edu.filter((e) => e.level === 'school');
  const items = main.map((e) => '<li class="job"><div class="when"><span>' + esc(e.period) + '</span>' + (e.status === 'ongoing' ? '<span>ongoing</span>' : '') + '</div><div>' +
    '<h3>' + esc(e.degree) + '</h3><p class="org">' + esc(e.institution) + (e.location ? ', ' + esc(e.location) : '') + '</p>' +
    (e.note ? '<p class="muted">' + esc(e.note) + '</p>' : '') + (e.grade ? '<p>' + esc(e.grade) + '</p>' : '') + '</div></li>').join('');
  const earlier = school.length ? '<p class="earlier"><span class="kicker">Earlier</span> ' + school.map((e) => esc(e.degree) + ', ' + esc(e.institution) + (e.period ? ' (' + esc(e.period) + ')' : '')).join('; ') + '.</p>' : '';
  const certs = (d.certifications || []).length && on(ctx, 'certifications')
    ? '<h3 class="kicker" id="certifications">Certifications and training</h3><ul class="certs">' + d.certifications.map((c) => '<li><span class="t">' + esc(c.title) + '</span><span class="muted">' + esc([c.issuer, c.date].filter(Boolean).join(', ')) +
      (c.credentialId ? ' · ID ' + esc(c.credentialId) : '') + '</span>' + (c.url ? ext(c.url, 'Verify<span class="vh"> ' + esc(c.title) + '</span> ' + ICON.ext) : '') + '</li>').join('') + '</ul>' : '';
  return sec('education', 'Education', '', '<ol class="jobs">' + items + '</ol>' + earlier + certs);
}

function skillsSection(ctx) {
  return sec('skills', 'Skills', '', '<dl class="skills">' + (ctx.data.skills || []).map((g) => '<div><dt>' + esc(g.group) + '</dt><dd>' + (g.items || []).map(esc).join(' · ') + '</dd></div>').join('') + '</dl>');
}

function leadershipSection(ctx) {
  return sec('leadership', 'Leadership and service', '', '<ul class="lead">' + (ctx.data.leadership || []).map((l) => '<li><span><b>' + esc(l.role) + '</b>, ' + esc(l.org) + (l.location ? ' · ' + esc(l.location) : '') + '</span><span class="muted">' + esc(l.period) + '</span></li>').join('') + '</ul>');
}

function referencesSection(ctx) {
  return sec('references', 'References', '', '<ul class="refs">' + (ctx.data.references || []).map((x) => '<li><b>' + esc(x.name) + '</b><span>' + esc(x.title) + '</span><span class="muted">' + esc(x.org) + '</span></li>').join('') +
    '</ul><p class="muted">Contact details available on request.</p>');
}

function contactSection(ctx) {
  const d = ctx.data, p = d.profile, mail = primaryEmail(d);
  const rows = [
    mail && ['Email', '<a href="mailto:' + esc(mail) + '">' + esc(mail) + '</a> <button class="chip copy" type="button" data-copy="' + esc(mail) + '" hidden>Copy<span class="vh"> email address</span></button>'],
    p.workEmail && p.workEmail !== mail && ['Work email', '<a href="mailto:' + esc(p.workEmail) + '">' + esc(p.workEmail) + '</a>'],
    (d.settings || {}).showPhone && p.phone && ['Phone', '<a href="tel:' + esc(p.phone.replace(/[^+\d]/g, '')) + '">' + esc(p.phone) + '</a>'],
    p.location && ['Location', esc(p.location)],
    ['Profiles', (d.links || []).filter((l) => l.url).map((l) => ext(l.url, esc(l.label))).join(' · ')],
    ctx.build.cvExists && p.cvUrl && ['CV', '<a href="' + esc(safeUrl(p.cvUrl)) + '">Download CV (PDF)</a>'],
  ].filter(Boolean);
  return sec('contact', 'Contact', '', (p.availability ? '<p class="big">' + esc(p.availability) + '.</p>' : '') +
    '<dl class="contact">' + rows.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>');
}

const citeDialog = '<dialog class="cite-dlg" id="cite-dlg" aria-labelledby="cite-h"><form method="dialog"><div class="dlg-head"><h2 id="cite-h">Cite this work</h2><button class="chip" value="close">Close</button></div>' +
  '<h3 class="kicker">APA</h3><pre id="cite-apa" tabindex="0"></pre><h3 class="kicker">BibTeX</h3><pre id="cite-bib" tabindex="0"></pre>' +
  '<p class="dlg-act"><button class="btn" type="button" data-copy-from="cite-apa">Copy APA</button><button class="btn pri" type="button" data-copy-from="cite-bib">Copy BibTeX</button></p></form></dialog>\n';

export function renderHomeBody(ctx) {
  const d = ctx.data, g = groupPubs(d);
  return hero(ctx) + '<div class="wrap">' +
    (on(ctx, 'about') ? aboutSection(ctx) : '') +
    (on(ctx, 'research') && g.all.length ? sec('publications', 'Publications', recordLine({ ...d, tools: [] }) + '. Each title opens a page with the full citation.', pubGroups(ctx, '', 3), 'research') : '') +
    (on(ctx, 'tools') && (d.tools || []).length ? sec('tools', 'Tools', plural(liveTools(d).length, 'hydrology tool') + ' that run in the browser. Free to use; files are processed on your computer and never uploaded.', toolsSection(ctx, '')) : '') +
    (on(ctx, 'map') && (d.studyAreas || []).length && ctx.build.geo ? sitesSection(ctx) : '') +
    (on(ctx, 'experience') && (d.experience || []).length ? experienceSection(ctx) : '') +
    (on(ctx, 'education') && (d.education || []).length ? educationSection(ctx) : '') +
    (on(ctx, 'skills') && (d.skills || []).length ? skillsSection(ctx) : '') +
    (on(ctx, 'leadership') && (d.leadership || []).length ? leadershipSection(ctx) : '') +
    (on(ctx, 'references') && (d.references || []).length ? referencesSection(ctx) : '') +
    (on(ctx, 'contact') ? contactSection(ctx) : '') +
    '</div>\n' + citeDialog;
}

export function renderHome(ctx) {
  const d = ctx.data;
  return page(ctx, { title: d.meta.title, description: d.meta.description, path: '', home: true, ogType: 'profile', jsonld: homeLd(ctx), sprite: mapSprite(ctx.build.geo) }, renderHomeBody(ctx));
}

// --------------------------------------------------------- publication pages
function scholarMeta(p) {
  const m = (n, v) => (v ? '<meta name="' + n + '" content="' + esc(v) + '">\n' : '');
  const group = pubGroup(p), venue = String(p.venue || '').replace(/\s+—.*$/, '');
  return m('citation_title', p.title) + (p.authors || []).map((a) => m('citation_author', a)).join('') +
    m('citation_publication_date', String(p.date || p.year).replace(/-/g, '/')) +
    (group === 'journal' ? m('citation_journal_title', venue) : group === 'conference' ? m('citation_conference_title', venue) : m('citation_publisher', venue.replace(/\s*preprint$/i, ''))) +
    m('citation_volume', p.volume) + m('citation_issue', p.issue) + m('citation_firstpage', p.pages) + m('citation_doi', p.doi) +
    (p.pdf ? m('citation_pdf_url', p.pdf) : '');
}

const crumbs = (r, trail) => '<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="' + (r || './') + '">Home</a></li>' + trail.map(([href, label]) => '<li>' + (href ? '<a href="' + href + '">' + label + '</a>' : '<span aria-current="page">' + label + '</span>') + '</li>').join('') + '</ol></nav>';

export function renderPublication(ctx, p) {
  const r = '../../', group = pubGroup(p);
  const kind = group === 'preprint' ? 'Preprint' : group === 'conference' ? 'Conference paper' : 'Journal article';
  const sites = (ctx.data.studyAreas || []).map((s, i) => [s, i]).filter(([s]) => (s.related || []).includes(p.title));
  const body = '<article class="wrap doc">' + crumbs(r, [[r + 'publications/', 'Publications'], ['', kind]]) +
    '<p class="eyebrow">' + kind + (p.year ? ' · ' + esc(p.year) : '') + '</p>' +
    '<h1>' + esc(p.title) + '</h1>' +
    '<p class="au big">' + (p.authors || []).map((n) => selfName(ctx, n)).join(', ') + '</p>' +
    '<p class="ve">' + venueLine(p) + '</p>' +
    '<p class="act">' + pubLinks(p) + (p.doi && p.url ? ext(p.url, 'Full text ' + ICON.ext) : '') + '</p>' +
    (group === 'preprint' ? '<p class="note">This is a preprint. It has not been peer reviewed.</p>' : '') +
    (p.note ? '<p class="note">' + esc(p.note) + '</p>' : '') +
    (p.abstract ? '<h2>Abstract</h2><p class="abstract">' + esc(p.abstract) + '</p>' : '') +
    ((p.tags || []).length ? '<h2>Topics</h2><p>' + p.tags.map(esc).join(' · ') + '</p>' : '') +
    (sites.length ? '<h2>Study site</h2><ul>' + sites.map(([s, i]) => '<li><a href="' + r + '#site-' + (i + 1) + '">' + esc(s.name) + '</a>: ' + esc(s.what) + '</li>').join('') + '</ul>' : '') +
    '<h2 id="cite">How to cite</h2><h3 class="kicker">APA</h3><pre id="apa" tabindex="0">' + esc(apa(p)) + '</pre><p><button class="chip copy" type="button" data-copy-from="apa" hidden>Copy APA</button></p>' +
    '<h3 class="kicker">BibTeX</h3><pre id="bib" tabindex="0">' + esc(bibtex(p)) + '</pre><p><button class="chip copy" type="button" data-copy-from="bib" hidden>Copy BibTeX</button></p>' +
    '<p class="back"><a href="' + r + 'publications/">All publications</a></p></article>\n';
  const desc = kind + ' by ' + (p.authors || []).join(', ') + ' (' + p.year + '). ' + String(p.venue || '').replace(/\s+—.*$/, '') + '.';
  return page(ctx, { title: p.title + ' · ' + ctx.data.profile.name, description: desc.slice(0, 300), path: 'publications/' + pubSlug(p) + '/', root: r, ogType: 'article',
    scholar: scholarMeta(p), jsonld: graph([articleLd(ctx, p), personLd(ctx)]) }, body);
}

export function renderPublicationsIndex(ctx) {
  const r = '../', d = ctx.data;
  const body = '<div class="wrap doc">' + crumbs(r, [['', 'Publications']]) + '<h1>Publications</h1><p class="big">' + recordLine({ ...d, tools: [] }) + '.</p>' +
    '<p class="links-inline">' + (d.links || []).filter((l) => /scholar|orcid|researchgate/i.test(l.icon + l.label)).map((l) => ext(l.url, esc(l.label))).join(' · ') + '</p>' +
    pubGroups(ctx, r, 2) + '</div>\n' + citeDialog;
  return page(ctx, { title: 'Publications · ' + d.profile.name, description: 'Journal articles, preprints and conference papers by ' + d.profile.name + ': ' + recordLine({ ...d, tools: [] }) + '.', path: 'publications/', root: r,
    jsonld: graph([personLd(ctx), ...groupPubs(d).all.filter((p) => p.doi || p.url).map((p) => articleLd(ctx, p))]) }, body);
}

// ------------------------------------------------------------- tool about
const NA = '<p class="muted">Not yet documented.</p>';
const paras = (v) => (Array.isArray(v) ? (v.length > 1 ? '<ul>' + v.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p>' + esc(v[0] || '') + '</p>') : '<p>' + esc(v) + '</p>');

export function renderToolAbout(ctx, t) {
  const r = '../../../', slug = toolSlug(t), a = (ctx.build.abouts || {})[slug] || {}, shot = (ctx.build.shots || {})[slug];
  const gh = (path) => (ctx.build.repo ? ctx.build.repo.replace(/\/$/, '') + '/blob/main/' + path : r + path);
  const parts = (t.parts || []).map((x) => '<h3>' + esc(x.name) + '</h3><p>' + esc(x.description) + '</p>' + ((x.features || []).length ? '<ul>' + x.features.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
    '<p><a href="' + r + esc(safeUrl(x.url)) + '">Open ' + esc(x.name) + '</a></p>').join('');
  const body = '<article class="wrap doc">' + crumbs(r, [[r + '#tools', 'Tools'], [r + 'tools/' + slug + '/', esc(t.name)], ['', 'About']]) +
    '<p class="eyebrow">' + esc([t.group, STATUS[t.status] || t.status, a.version ? 'version ' + a.version : ''].filter(Boolean).join(' · ')) + '</p>' +
    '<h1>About ' + esc(t.name) + '</h1>' +
    (t.gloss ? '<p class="gloss">' + esc(t.gloss) + '.</p>' : '') +
    '<p class="big">' + esc(t.tagline || '') + '</p>' +
    '<p class="cta"><a class="btn pri" href="' + r + esc(safeUrl(t.url)) + '">Open ' + esc(t.name) + '</a></p>' +
    (shot ? '<p class="shot wide"><img src="' + r + esc(shot.src) + '" width="' + shot.w + '" height="' + shot.h + '" alt="Screenshot of ' + esc(t.name) + ': ' + esc(shot.alt || t.tagline) + '"></p>' : '') +
    '<h2 id="overview">What it does</h2><p>' + esc(t.description || '') + '</p>' + ((t.features || []).length ? '<ul>' + t.features.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') + parts +
    '<h2 id="problem">Problem</h2>' + (a.problem ? paras(a.problem) : NA) +
    '<h2 id="method">Method</h2>' + (a.method ? paras(a.method) : NA) +
    (a.references ? '<h3 class="kicker">References used by the tool</h3><ul class="reflist">' + a.references.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
    '<h2 id="data">Data</h2>' + (a.data ? paras(a.data) : NA) +
    ((a.samples || []).length ? '<h3 class="kicker">Bundled sample data</h3><ul>' + a.samples.map((x) => '<li>' + esc(x.label) + '</li>').join('') + '</ul>' : '') +
    '<h2 id="validation">Validation</h2>' + (a.validation ? paras(a.validation) : NA) +
    '<h2 id="limitations">Limitations</h2>' + (a.limitations ? paras(a.limitations) : NA) +
    '<h2 id="cite">How to cite</h2>' + (a.cite ? '<pre id="tool-cite" tabindex="0">' + esc(a.cite.text) + '</pre><p><button class="chip copy" type="button" data-copy-from="tool-cite" hidden>Copy citation</button> ' + ext(gh(a.cite.cff), 'CITATION.cff ' + ICON.ext) + '</p>' : NA) +
    '<h2 id="source">Source and documents</h2>' +
    ((a.docs || []).length || a.repository || a.license ? '<ul>' + (a.docs || []).map((x) => '<li>' + ext(gh(x.path), esc(x.label) + ' ' + ICON.ext) + '</li>').join('') +
      (a.license ? '<li>Licence: ' + esc(a.license.name) + '</li>' : '') + (a.repository ? '<li>' + ext(a.repository, 'Code repository ' + ICON.ext) + '</li>' : '') + '</ul>' : NA) +
    '<p class="back"><a href="' + r + '#tools">All tools</a></p></article>\n';
  return page(ctx, { title: 'About ' + t.name + ' · ' + ctx.data.profile.name, description: (t.name + ': ' + (t.tagline || '') + '. Problem, method, data, validation, limitations and how to cite.').slice(0, 300),
    path: 'tools/' + slug + '/about/', root: r, jsonld: graph([toolLd(ctx, t), personLd(ctx)]) }, body);
}

// ---------------------------------------------------------------------- 404
export function render404(ctx) {
  // Served for any missing URL, so every link is root-relative.
  const body = '<div class="wrap doc lost"><p class="eyebrow">Error 404</p><h1>This river ran dry</h1><p class="big">The page you were looking for is not here. It may have moved, or the link may be mistyped.</p>' +
    '<p class="cta"><a class="btn pri" href="/">Back to the homepage</a><a class="btn" href="/#publications">Publications</a><a class="btn" href="/#tools">Tools</a></p></div>\n';
  return page(ctx, { title: 'Page not found · ' + ctx.data.profile.name, description: 'This page does not exist.', path: '404.html', root: '/', noindex: true }, body);
}
