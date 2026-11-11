# What changed and why

A visitor-facing summary of the redesign. Reasons and alternatives are in [DECISIONS.md](DECISIONS.md); measurements are in `docs/audit/`.

## The site

- **New design.** A calm "field sheet" look: paper and ink, serif headings, river blue and silt ochre, and a real map of Bangladesh's rivers with the twelve study sites. Light and dark themes follow your system setting; the toggle remembers your choice.
- **Complete without JavaScript.** Every page is plain HTML. Before, a black boot screen covered everything when JavaScript was off.
- **No more game layer.** The boot splash, XP bar, pixel avatar, floating companion, command palette, fake terminal, Konami code, animated backgrounds and labels such as "QUEST LOG" and "ACHIEVEMENTS UNLOCKED" are gone. Headings say what each section is.
- **The page no longer scrolls itself** to the Tools section on load.
- **First screen:** name, role, affiliation, research areas, and direct routes to Publications, Tools, Contact and the profile links (Google Scholar, ORCID, ResearchGate, GitHub, LinkedIn).
- **Honest counts.** The record line ("3 journal articles · 2 preprints · 6 conference papers · 10 web tools") is computed from what the page shows. The old strip counted eleven tools and three journal articles including a preprint.
- **Faster.** No Google Fonts requests (fonts are self-hosted and subset), no runtime fetch of the content file, minified and fingerprinted CSS and JS, lazy-loaded screenshots.

## Publications

- Three groups: **Journal articles**, **Preprints**, **Conference papers — ICCEI 2025** (water papers first, earthquake papers last).
- Every DOI is a visible `doi.org` link.
- Each paper has its own page with APA and BibTeX citations and Google Scholar metadata, plus a publications index at `/publications/`.
- Corrections, each checked against Crossref on 10 November 2026:
  - *Assessing the Reliability of Global Circulation Models…*: H2Open Journal, volume 9, issue 3, article 100021, June 2026.
  - *Drought prediction in Bangladesh under changing climate…*: Environmental and Sustainability Indicators, volume 28, 100878, December 2025.
  - *Hydroclimatic Trend Analysis…*: now labelled an Authorea preprint (posted 9 September 2025), not a Hydrological Processes paper.
  - Added the SSRN preprint *Climate associated groundwater table changes and drought risk in Bangladesh under CMIP6 projections* (posted 29 September 2026).
- The two papers without a public record (Heliyon, Journal of Hydrologic Engineering) are hidden until published. They stay in the data; changing their status in the editor makes them appear.

## Tools

- All ten tools are visible at once, grouped as Data preparation, Analysis, and Modelling & Spatial, each with a real screenshot, a one-line description, a Stable or Beta label, and links to open it and read about it.
- **Hydro-Series Toolkit** is one entry (it was listed as "Min-Max-Avg Terminal" and "Series Generator", which share a page).
- **Ababahika** and **Brishti IDF** show what their Bangla names mean.
- **River Profile Studio** no longer describes the thalweg and longitudinal profiler as upcoming; it shipped on 9 November 2026.
- The "+ more tools coming" line is gone.
- Each tool has an **About** page: problem, method and references, data, validation, limitations, how to cite, and links to its documents. Sections with nothing documented say "Not yet documented".

## Privacy and contact

- Referees are listed by name, title and affiliation only, with "Contact details available on request." Their email addresses were removed from the public data file as well as from the page.
- One primary email everywhere (personal); the work email appears once, in Contact, labelled as such.
- The office street address was removed; the location is "Dhaka, Bangladesh".

## Other content

- BUET entry: "M.Sc. in Water Resource Development", IWFM, BUET, April 2026 session (classes from Oct 2026), ongoing.
- HSC and SSC are one "Earlier" line under Education.
- "Download CV (PDF)" appears automatically once `assets/cv.pdf` exists. There is no placeholder CV.
- New share image and favicon without the pixel avatar or "PLAYER_01".

## Accessibility

- 0 axe-core violations on the homepage, publication pages, tool About pages and the 404 page, in both themes (before: 44 violating elements in the light theme, 16–17 in dark).
- Body text is 16 px; nothing is smaller than 12 px (before: 54–72 text nodes under 12 px).
- No horizontal overflow at 375 px (before: 32 px).
- The citation dialog moves focus in, keeps it there, closes with Esc and returns focus. Nothing intercepts keys or announces unsolicited messages.

## For search engines

- Static structured data: Person, WebSite, one ScholarlyArticle per public paper, one SoftwareApplication per tool.
- Unique title, description, canonical link and share metadata on every page; sitemap dates come from git.
- `robots.txt` no longer lists `/admin.html` (the page keeps its `noindex` tag).

## For the maintainer

- `data/content.json` is still the single source of truth and `admin.html` still edits and publishes it, including Preview.
- A GitHub Action rebuilds the pages after each content change. See [README.md](README.md).
- Tests (`npm test`) and audits (`npm run audit`) are in the repository.

## Tool pages

All ten tools behave as before; their calculations were not touched.

- **Shared header and footer on every tool.** Breadcrumb back to the portfolio and the tools list, the tool's name as the page's one `<h1>`, an "About this tool" link and one theme toggle. The footer links to About and, where documented, Validation, Limitations and Cite. Before, five tools had no `<h1>` and GapLens had nine.
- **Names match the portfolio.** For example "DSBC Studio" (the page used to say "Downscaling and bias correction studio") and "Hydro-Series Toolkit".
- **GapLens no longer downloads about 30 MB on opening.** Python starts when you press Start, load an example or load a file; a card explains this and shows progress.
- **DSBC Studio** starts its Python engine the same way: on the demo, a file, or the first step that needs it.
- **Shared libraries.** One SheetJS 0.18.5 and one Plotly 3.2.0 now live in `assets/vendor/` and serve Brishti IDF, Dependability Analyzer, DSBC Studio, River Profile Studio and GapLens (SheetJS) and Brishti IDF and DSBC Studio (Plotly). Those tools no longer contact cdnjs. DSBC Studio moved from Plotly 3.1.0 to 3.2.0; its charts were checked.
- **Offline caches refreshed.** Brishti IDF and OpenFFA cache names were bumped (`brishti-idf-v0.2.0-portfolio-2`, `openffa-0.3.0-portfolio-2`) and now include the shared files, so returning visitors get the new pages.
- **DSBC Studio** no longer overflows sideways on a phone.

Deliberately left as they were:

- OpenFFA keeps its own smaller Plotly (basic 3.1.2, 1.1 MB); the full build is over four times larger and OpenFFA loads and caches it up front.
- OpenFFA and Ababahika keep their `xlsx.core` copies. Ababahika loads it from a compiled bundle whose build script is not in this repository, and River Profile Studio's fallback points at that file.
- Ababahika's GDAL files (already loaded only on demand) and the two different Pyodide versions used by GapLens and DSBC Studio.
- The tools' own working areas still load their existing fonts from Google Fonts; only the shared header and footer use the portfolio's self-hosted fonts.

Not verified: upgrade from an old offline cache on a returning visitor's device, real phones, and importing a real `.xls` file in each tool (the library loads and the bundled samples run).
