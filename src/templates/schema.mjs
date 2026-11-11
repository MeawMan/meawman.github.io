// schema.org JSON-LD, written statically into the HTML.
import { groupPubs, liveTools, primaryEmail, pubGroup, pubSlug, toolSlug } from './util.mjs';

const clean = (o) => {
  if (Array.isArray(o)) return o.map(clean).filter((v) => v != null && v !== '');
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) { const c = clean(v); if (c != null && c !== '' && !(Array.isArray(c) && !c.length)) out[k] = c; }
    return Object.keys(out).length ? out : undefined;
  }
  return o;
};

const abs = (site, path) => site.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '');

export function personLd(ctx) {
  const { data, build } = ctx;
  const p = data.profile, job = (data.experience || []).find((e) => !e.end) || (data.experience || [])[0] || {};
  const site = build.siteUrl;
  const edu = (e) => ({ '@type': e.level === 'university' ? 'CollegeOrUniversity' : 'EducationalOrganization', name: e.institution });
  return clean({
    '@type': 'Person', '@id': abs(site, '#person'), name: p.name, url: site,
    jobTitle: job.role, email: primaryEmail(data),
    worksFor: job.org ? { '@type': 'Organization', name: job.org } : undefined,
    affiliation: (data.education || []).filter((e) => e.status === 'ongoing').map(edu),
    alumniOf: (data.education || []).filter((e) => e.status !== 'ongoing').map(edu),
    knowsAbout: p.researchAreas,
    address: { '@type': 'PostalAddress', addressLocality: (p.location || '').split(',')[0].trim(), addressCountry: (p.location || '').split(',')[1]?.trim() },
    image: build.photo ? abs(site, build.photo) : undefined,
    sameAs: (data.links || []).filter((l) => l.url).map((l) => l.url),
  });
}

export function websiteLd(ctx) {
  const site = ctx.build.siteUrl;
  return clean({ '@type': 'WebSite', '@id': abs(site, '#website'), url: site, name: ctx.data.profile.name, description: ctx.data.meta.description, inLanguage: 'en', author: { '@id': abs(site, '#person') } });
}

export function articleLd(ctx, p) {
  const site = ctx.build.siteUrl;
  const group = pubGroup(p);
  const container = group === 'journal' ? { '@type': 'Periodical', name: String(p.venue).replace(/\s+—.*$/, '') }
    : group === 'conference' ? { '@type': 'CreativeWork', name: String(p.venue).replace(/\s+—.*$/, '') } : undefined;
  return clean({
    '@type': 'ScholarlyArticle', '@id': abs(site, 'publications/' + pubSlug(p) + '/#article'),
    headline: p.title, name: p.title,
    author: (p.authors || []).map((n) => (n === ctx.data.profile.name ? { '@type': 'Person', name: n, '@id': abs(site, '#person') } : { '@type': 'Person', name: n })),
    datePublished: p.date || String(p.year),
    isPartOf: container,
    publisher: group === 'preprint' ? { '@type': 'Organization', name: String(p.venue).replace(/\s*preprint$/i, '') } : undefined,
    creativeWorkStatus: group === 'preprint' ? 'Preprint' : undefined,
    volumeNumber: p.volume, issueNumber: p.issue, pagination: p.pages,
    identifier: p.doi ? { '@type': 'PropertyValue', propertyID: 'DOI', value: p.doi } : undefined,
    sameAs: p.doi ? 'https://doi.org/' + p.doi : p.url,
    url: abs(site, 'publications/' + pubSlug(p) + '/'),
    abstract: p.abstract, keywords: (p.tags || []).join(', '),
  });
}

export function toolLd(ctx, t) {
  const site = ctx.build.siteUrl, slug = toolSlug(t), about = (ctx.build.abouts || {})[slug] || {};
  const shot = (ctx.build.shots || {})[slug];
  return clean({
    '@type': 'SoftwareApplication', '@id': abs(site, 'tools/' + slug + '/#software'),
    name: t.name, description: t.tagline || t.description,
    applicationCategory: 'ScienceApplication', applicationSubCategory: t.group, operatingSystem: 'Web browser',
    url: abs(site, 'tools/' + slug + '/'),
    softwareVersion: about.version || undefined,
    softwareHelp: abs(site, 'tools/' + slug + '/about/'),
    screenshot: shot ? abs(site, shot.src) : undefined,
    codeRepository: about.repository || undefined,
    license: about.license ? abs(site, about.license.path) : undefined,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@id': abs(site, '#person') },
  });
}

export const graph = (nodes) => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });

export function homeLd(ctx) {
  const pubs = groupPubs(ctx.data).all.filter((p) => p.doi || p.url);
  return graph([personLd(ctx), websiteLd(ctx), ...pubs.map((p) => articleLd(ctx, p)), ...liveTools(ctx.data).map((t) => toolLd(ctx, t))]);
}
