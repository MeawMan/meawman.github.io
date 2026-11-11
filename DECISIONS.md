# Decisions

Every non-trivial choice made during the redesign, with the alternatives and the reason.
Audiences referred to below: **(P)** professors, supervisors and scholarship reviewers checking the record in a minute or two; **(E)** water-sector employers; **(T)** peers who come for the tools; **(V)** curious visitors.

## 1. Design direction

Three static mockups are kept in [`design-explorations/`](design-explorations/) with screenshots.

| Direction | Idea | P | E | T | V | Constraints (a11y, speed, no-JS, both themes) | Total /25 |
|---|---|---|---|---|---|---|---|
| **A. Field sheet** | Survey paper and ink, serif headings, margin-rail sections, one real river map | 5 | 4 | 4 | 4 | 5 | **22** |
| B. Delta at night | Dark-first, map-led, card gallery, grotesk type | 3 | 4 | 4 | 5 | 3 | 19 |
| C. Monograph | One narrow serif column, reference-list publications, almost no graphics | 5 | 3 | 2 | 2 | 5 | 17 |

- **Chosen: A, with two things taken from the others.** From B, the Natural Earth river map as the single illustration (drawn in A's restrained ink style, not as a glowing hero). From C, publications as a ruled reference list with visible DOIs instead of cards.
- **Why not B:** the record sits below a tall hero and cards are slower to scan than a list; the dark-first look is close to a generic developer portfolio and its light theme is the weaker one.
- **Why not C:** the most credible for P, but the ten tools are undersold and nothing says "water" at a glance, so E, T and V get little.
- **What makes A specific to the owner:** the map of the Padma, Jamuna and Meghna with his twelve study sites; the water-and-silt palette (river blue, sediment ochre); Bangla glosses beside Bangla tool names; record lines computed from the data.

## 2. Personality and the old game layer

- **Removed entirely:** boot splash, XP bar, flow-field canvas, grid/aurora/grain overlays, skills marquee, pixel avatar and its auto-talk, floating "buddy", Konami code, fake terminal, command palette, scramble/typewriter effects, card tilt, cursor spotlight, game labels. Files deleted: `assets/js/app.js`, `avatar.js`, `flow.js`, `assets/css/style.css`; data removed: `avatar`, `buddy`, `settings.bootScreen`, `settings.flowBackground`.
- **Alternative considered:** keep the avatar scene on an opt-in `/lab/` page. Rejected for this PR: it would keep about 500 lines of canvas code alive for a page few visitors reach, and the avatar reads as a stand-in photo, which the brief rules out until a real photo exists. The build already supports a `lab/` folder (footer link and sitemap entry appear if `lab/index.html` exists), so it can return later.
- **Where personality lives now:** the map, the palette, the Bangla glosses, the 404 line "This river ran dry", and plain first-person copy.
- **Exceptional touches and their cost:**
  1. *Study-site map* drawn from Natural Earth 1:10m rivers and country outline (public domain), simplified by `scripts/geo/build-map.mjs`. Used twice (hero locator, numbered map beside the site list) from one inline SVG definition. Cost: about 9 kB of gzipped HTML, no JavaScript, no requests. The numbered list is the accessible equivalent; map pins are pointer-only links kept out of the tab order.
  2. *Sites linked to papers:* four sites link to the papers that studied them. The links come from a new `studyAreas[].related` field holding exact publication titles; only public papers are linked. They were filled from the site descriptions already in the data (same venue and topic), not guessed.
- **Not built:** a live mini-demo of a tool on the homepage (it would need a tool's numerical code on the homepage or a build-time computation whose result could drift from the tool); the old career Gantt chart (durations are now text).

## 3. Content

| Decision | Alternatives | Reason |
|---|---|---|
| Publications are public only when `status` is `published` or `preprint` (or `public: true/false` is set explicitly). Rule lives in `isPublic()` in `src/templates/util.mjs`. | A `settings.showUnpublished` switch (old behaviour). | Data-driven per item; the owner publishes a paper by changing its status in the admin editor. Hidden items get no homepage entry, page, JSON-LD, sitemap entry or count. |
| Journal count is **3**, not the "2" used as an example in the brief. | Count only DOI-bearing articles. | Three journal items render (H2Open Journal, Environmental and Sustainability Indicators, RRI Technical Journal), and the counts must match what renders. |
| H2Open paper: volume 9, **issue 3**, article 100021, June 2026. | Volume and month only. | Crossref lists issue 3 for DOI 10.1016/j.htopen.2026.100021 (checked 10 Nov 2026). |
| ESI paper date set to December 2025. | Year only. | Crossref `published-print` for 10.1016/j.indic.2025.100878. |
| SSRN preprint: authors and title exactly as Crossref returns them; posting date 29 Sep 2026 from the owner's brief (Crossref has only the year). No abstract, no tags. | Copy the Crossref abstract. | The brief says to use only the listed fields. |
| Authorea preprint: venue "Authorea preprint", type `preprint`; the old "Hydrological Processes (Wiley)" label is dropped, with no "submitted to" note. | Keep a secondary "submitted to Hydrological Processes" note. | The data never said "submitted to"; adding it would be a new claim. Listed in TODO for the owner. |
| No abstracts shown. | Use the abstracts Crossref holds for the two preprints. | The brief asks for abstracts only when they are in the data; they are listed in TODO so the owner can paste them. |
| `featured` removed from all publications. | Keep it for the visible ones. | Nothing renders it in the new design; the brief only required removing it from the two hidden papers. |
| Min-Max-Avg Terminal and Series Generator merged into one entry, **Hydro-Series Toolkit**, with both originals preserved under `parts`. | Keep two entries pointing at one page. | They share one page whose title is "Hydro-Series Toolkit"; ten entries now equal ten tool pages. Both descriptions and feature lists are shown on the tool's About page. |
| Tool `status` value `live` renamed `stable`. | Keep `live`. | The brief asks for beta/stable. |
| Tool `icon` and `accent` removed. | Keep unused fields. | They only drove the decorative SVG previews, which are replaced by screenshots. |
| Ababahika gloss: "Ababahika (অববাহিকা) is Bangla for catchment". | Latin-only gloss. | The Bangla spelling is the one already used in `tools/ababahika/README.md`. |
| `profile.office` (street address) removed from the JSON; location is "Dhaka, Bangladesh". | Hide it only in HTML. | The JSON is public. |
| Referee emails removed from the JSON; admin schema no longer has an email field for references. | Hide in HTML only. | The JSON is public. Git history still contains them (see TODO). |
| `profile.currentQuest` renamed `currentProject`; `meta.updated` removed. | Keep. | Game vocabulary; "Last updated" now comes from git. |
| New fields: `profile.headline`, `profile.researchAreas`, `publications[].date/event/note/abstract`, `education[].level`, `tools[].gloss/parts`, `studyAreas[].related`. | — | Needed for the corrections; all are editable in the admin editor. Research areas are the six the owner listed in the brief. |
| HSC and SSC shown as one "Earlier" line. | Drop from the homepage. | Keeps the data visible at low cost. |

## 4. Architecture

| Decision | Alternatives | Reason |
|---|---|---|
| Zero-dependency Node build (`scripts/build.mjs`); devDependencies are test tools only (Playwright, axe-core, Lighthouse). | esbuild for minification. | The GitHub Action needs no `npm install`, so it is fast and cannot break on a registry change. CSS and JS are minified by small conservative functions; the sources are written to suit them. |
| Templates are plain ES modules returning strings (`src/templates/`), imported by the build and by the browser preview straight from `/src/`. | A template engine; duplicating render code for the preview. | One implementation, no bundling. `index.html?preview=1` loads `src/js/preview.js` only in preview mode. |
| Generated HTML is committed; a workflow rebuilds on pushes to `main` and commits with `GITHUB_TOKEN`. Pages keeps deploying from the branch. | Switch Pages to the Actions source. | No repository setting has to change, and the admin flow (commit `content.json` only) keeps working. Risk and fallback are in TODO-FOR-OWNER.md. |
| Dates: footer "Last updated" is the last commit touching `data/content.json`; sitemap `lastmod` per page from the commits touching its inputs; files with uncommitted changes use today's date. | Build date. | Stable output: rebuilding without changes produces no diff. |
| CSS/JS fingerprinted as `assets/dist/site.<hash>.{css,js}`; old hashes are deleted by the build. | Query-string versions. | Safe with GitHub Pages' 10-minute cache. |
| Theme: CSS follows `prefers-color-scheme`; a stored choice (`localStorage.mrj_theme`, the key the tools already use) is applied by a one-line inline script before first paint. | JS-only theming. | No flash, works without JS, shared with the tool pages. |
| Header is sticky only from 768 px up; `scroll-padding-top` keeps focused and targeted elements clear of it. | Sticky everywhere. | On phones without JS the navigation wraps to two rows and would cover too much. |
| Citation dialog is a native `<dialog>` opened with `showModal()`; without JS the Cite link goes to the publication page's citation section. | Custom modal. | Focus moving, trapping, Esc and focus return come from the browser. |
| Fonts: Newsreader 500 (headings), IBM Plex Sans variable 400–600 and italic 400, plus a Noto Sans Bengali subset holding only the Bengali letters present in `content.json`. Self-hosted WOFF2, about 99 kB in total, two preloaded. | Variable Newsreader (132 kB); full Bengali subset (108 kB); system fonts only. | Smallest set that keeps the look. Other Bengali letters fall back to system fonts; re-run `scripts/fonts/fetch.mjs` after adding Bangla text. |
| Tool screenshots: Playwright capture at 1040×650, re-encoded to 800×500 WebP by Chrome's canvas. | `sharp` or another image library. | No extra dependency. |
| Tool "About" content lives in `tools/<slug>/about.json`, extracted from each tool's existing README, validation and limitation files, CITATION.cff and in-app help, with a `sources` map naming file and lines. The build renders `tools/<slug>/about/index.html`. | An in-page panel injected into each tool; storing it in `content.json`. | A static page works without JS, is indexable, and keeps 2,000-line tool files untouched. Missing sections print "Not yet documented". |
| Documents (README, VALIDATION, CITATION.cff) are linked on GitHub, not as raw `.md` files. | Link the files on the site. | GitHub Pages serves `.md` as a download. |
| Share image and favicon redrawn (`scripts/brand.mjs`). | Keep the old ones. | The old image said "PLAYER_01" and showed the pixel avatar as a portrait. |
| JSON-LD: one `@graph` per page. `codeRepository` and `license` are set only where the tool's CITATION.cff or LICENSE states them. | Separate script blocks. | Smaller and easier to validate. |

## 5. After the independent review

Findings and resolutions are in [docs/REVIEW.md](docs/REVIEW.md). Decisions that came out of it:

- The "Current project" line was removed from the Research section (it read as a "currently" strip, which the owner ruled out); `profile.currentProject` stays in the data.
- The current role shows no computed duration, because a static page cannot keep it up to date.
- On phones the hero shows the buttons and profile links before the bio (CSS order only; source order is unchanged).
- Hidden papers stay in `content.json`, as the owner asked, even though that file is public.
- Accessibility defects inside the tools' own interfaces are documented, not fixed, because tool behaviour was out of scope.

## 6. Tool pages and vendor libraries

See the "Tool pages" section of [CHANGES.md](CHANGES.md) for what was changed, kept and why, including the vendor copies deliberately left in place.
