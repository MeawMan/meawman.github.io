// Downloads the self-hosted font files into assets/fonts/ (run once; the files are committed).
//   node scripts/fonts/fetch.mjs
// Fonts: Newsreader, IBM Plex Sans, Noto Sans Bengali — all SIL Open Font License 1.1 (see assets/fonts/README.md).
// Latin subsets come from Google Fonts. The Bengali file holds only the Bengali characters that
// occur in data/content.json, so re-run this script after adding Bangla text with new letters.
import { readFile, writeFile } from 'node:fs/promises';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const content = await readFile('data/content.json', 'utf8');
const bengali = [...new Set(content.match(/[\u0980-\u09FF]/g) || [])].sort().join('');
const WANT = [
  ['newsreader-500.woff2', 'Newsreader:wght@500', 'latin'],
  ['plex-sans-var.woff2', 'IBM+Plex+Sans:wght@400..600', 'latin'],
  ['plex-sans-italic-400.woff2', 'IBM+Plex+Sans:ital,wght@1,400', 'latin'],
  ['noto-bengali-subset.woff2', 'Noto+Sans+Bengali:wght@400&text=' + encodeURIComponent(bengali), null],
];
for (const [file, query, subset] of WANT) {
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + query, { headers: { 'User-Agent': UA } })).text();
  const blocks = [...css.matchAll(/(?:\/\* ([\w-]+) \*\/\s*)?@font-face \{([^}]+)\}/g)];
  const b = blocks.find((x) => (subset ? x[1] === subset : true));
  if (!b) throw new Error('no @font-face for ' + query);
  const buf = Buffer.from(await (await fetch(/url\(([^)]+)\)/.exec(b[2])[1])).arrayBuffer());
  if (buf.subarray(0, 4).toString() !== 'wOF2') throw new Error(file + ' is not a woff2 file');
  await writeFile('assets/fonts/' + file, buf);
  console.log(file, buf.length, 'bytes', /unicode-range: ([^;]+)/.exec(b[2])?.[1] || '');
}
console.log('Bengali characters in the subset:', bengali);
