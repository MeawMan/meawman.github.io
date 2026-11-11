// APA and BibTeX citations generated from a publication's fields.
import { pubGroup } from './util.mjs';

function splitName(full) {
  const parts = String(full).replace(/\s+/g, ' ').trim().split(' ');
  const last = parts.pop();
  return { last, given: parts };
}
function apaAuthor(full) {
  const n = splitName(full);
  const ini = n.given.map((g) => g.replace(/\./g, '')[0].toUpperCase() + '.').join(' ');
  return n.last + (ini ? ', ' + ini : '');
}
const venueName = (p) => String(p.venue || '').replace(/\s+—.*$/, '');
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function apa(p) {
  const a = (p.authors || []).map(apaAuthor);
  const authors = a.length <= 1 ? a[0] || '' : a.length === 2 ? a[0] + ', & ' + a[1] : a.slice(0, -1).join(', ') + ', & ' + a[a.length - 1];
  let s = authors + ' (' + p.year + '). ' + p.title + (/[.?!]$/.test(p.title) ? '' : '.');
  if (pubGroup(p) === 'preprint') {
    s += ' ' + venueName(p).replace(/\s*preprint$/i, '') + ' [Preprint].';
  } else {
    s += ' ' + venueName(p);
    if (p.volume) s += ', ' + p.volume + (p.issue ? '(' + p.issue + ')' : '');
    if (p.pages) s += ', ' + p.pages;
    s += '.';
  }
  if (p.doi) s += ' https://doi.org/' + p.doi;
  else if (p.url) s += ' ' + p.url;
  return s;
}

export function bibtex(p) {
  const first = splitName((p.authors || [])[0] || 'anon').last.toLowerCase().replace(/[^a-z]/g, '');
  const word = (p.title.split(/\s+/).find((w) => w.length > 3 && !/^(the|and|with|using|under|from|into)$/i.test(w)) || 'paper').toLowerCase().replace(/[^a-z]/g, '');
  const group = pubGroup(p);
  const kind = group === 'conference' ? 'inproceedings' : group === 'preprint' ? 'misc' : 'article';
  const b = (v) => String(v).replace(/&/g, '\\&');
  const lines = [
    '  title={' + b(p.title) + '}',
    '  author={' + (p.authors || []).map((n) => { const s = splitName(n); return s.last + ', ' + s.given.join(' '); }).join(' and ') + '}',
    '  ' + (group === 'conference' ? 'booktitle' : group === 'preprint' ? 'howpublished' : 'journal') + '={' + b(venueName(p)) + '}',
    '  year={' + p.year + '}',
  ];
  const month = /^\d{4}-(\d{2})/.exec(p.date || '');
  if (month) lines.push('  month=' + MON[+month[1] - 1]);
  if (p.volume) lines.push('  volume={' + p.volume + '}');
  if (p.issue) lines.push('  number={' + p.issue + '}');
  if (p.pages) lines.push('  pages={' + p.pages + '}');
  if (p.doi) lines.push('  doi={' + p.doi + '}');
  else if (p.url) lines.push('  url={' + p.url + '}');
  return '@' + kind + '{' + first + p.year + word + ',\n' + lines.join(',\n') + '\n}';
}
