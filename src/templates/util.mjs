// Small pure helpers shared by the templates. No Node or browser APIs, so the
// same module runs in the build (Node) and in the admin preview (browser).

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escaped text with **bold** spans. */
export const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Allow web, mail, phone and relative links; block script and data URLs. */
export const safeUrl = (u) => (u && !/^\s*(javascript|data|vbscript):/i.test(u) ? String(u) : '#');

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Stable page slug for a publication: its own `slug`, or year + the first words of the title. */
export function pubSlug(p) {
  if (p.slug) return slugify(p.slug);
  return (p.year + '-' + slugify(p.title).split('-').slice(0, 7).join('-')).slice(0, 72).replace(/-+$/, '');
}

/** Tool folder name from its URL, e.g. "tools/openffa/" → "openffa". */
export const toolSlug = (t) => (/tools\/([\w-]+)\//.exec(t.url || '') || [])[1] || slugify(t.name);

/**
 * Visibility rule for publications (data-driven): an item is public when its
 * status is "published" or "preprint", unless `public` is set explicitly.
 * Accepted / in-revision / under-review items stay in the data but are not
 * rendered anywhere until the owner updates their status.
 */
export const isPublic = (p) => (typeof p.public === 'boolean' ? p.public : p.status === 'published' || p.status === 'preprint');

export const pubGroup = (p) => (p.status === 'preprint' || p.type === 'preprint' ? 'preprint' : p.type === 'conference' ? 'conference' : 'journal');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-06" → "June 2026"; "2026-09-29" → "29 September 2026"; "2026" → "2026". */
export function fmtDate(iso, short) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(iso || ''));
  if (!m) return '';
  const mon = m[2] ? MONTHS[+m[2] - 1] : '';
  const name = short && mon ? mon.slice(0, 3) : mon;
  return [m[3] ? String(+m[3]) : '', name, m[1]].filter(Boolean).join(' ');
}

/** Months between two "YYYY-MM" strings as "1 yr 4 mos" (inclusive of both ends). */
export function duration(start, end, now) {
  if (!start) return '';
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = (end || now).split('-').map(Number);
  const months = Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
  const y = Math.floor(months / 12), mo = months % 12;
  return [y ? y + ' yr' + (y > 1 ? 's' : '') : '', mo ? mo + ' mo' + (mo > 1 ? 's' : '') : ''].filter(Boolean).join(' ');
}

export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

/** Public publications in their three groups, newest first (conference papers keep the data order). */
export function groupPubs(data) {
  const pubs = (data.publications || []).filter(isPublic);
  const key = (p) => String(p.date || p.year || '');
  const sorted = (g) => pubs.filter((p) => pubGroup(p) === g).map((p, i) => [p, i]).sort((a, b) => (key(b[0]) > key(a[0]) ? 1 : key(b[0]) < key(a[0]) ? -1 : a[1] - b[1])).map((x) => x[0]);
  const conference = pubs.filter((p) => pubGroup(p) === 'conference');
  const events = [...new Set(conference.map((p) => p.event || ''))];
  return {
    all: pubs,
    journal: sorted('journal'),
    preprint: sorted('preprint'),
    conference: events.map((ev) => ({ event: ev, items: conference.filter((p) => (p.event || '') === ev) })),
    conferenceCount: conference.length,
  };
}

/** Tools that have a page to open (status "soon" entries are listed but not counted). */
export const liveTools = (data) => (data.tools || []).filter((t) => t.name && t.url && t.status !== 'soon');

export const primaryEmail = (data) => data.profile.personalEmail || data.profile.workEmail || '';
