# Plan — research-first redesign

Written after the audit and the design explorations, before production code changed. Reasons for each choice are in [DECISIONS.md](DECISIONS.md); the baseline is in [docs/audit/baseline/BASELINE.md](docs/audit/baseline/BASELINE.md).

## Direction

**"Field sheet"** (direction A, with the river map from B and the reference-list publications from C). A hydrologist's survey sheet: warm paper, ink, river blue and silt ochre; serif headings over a quiet sans; section titles in a left margin rail; one illustration, a real map of Bangladesh's rivers with the study sites.

## Information architecture

Homepage, top to bottom. Publications and Tools are reachable from the first screen through the header and the hero buttons.

1. Hero: headline and location, name, bio, research areas, buttons (Publications, Tools, CV when the file exists, Contact), profile links, record line, locator map
2. Research: current project and four focus areas
3. Publications: journal articles, preprints, conference papers by event
4. Tools: ten cards with screenshots, grouped by workflow stage
5. Study sites: numbered map and list, linked to papers
6. Experience
7. Education, earlier schooling in one line, certifications
8. Skills
9. Leadership and service
10. References (names, titles, affiliations)
11. Contact

Other pages: `publications/` (index), `publications/<slug>/` (one per public paper, with Google Scholar tags and citations), `tools/<slug>/about/` (problem, method, data, validation, limitations, how to cite, documents), `404.html`.

## Architecture

```
data/content.json          single source of truth (edited by admin.html)
data/geo/bangladesh.json   map geometry (generated once by scripts/geo/build-map.mjs)
tools/<slug>/about.json    per-tool documentation extracted from the tool's own files
src/templates/*.mjs        render functions shared by the build and the admin preview
src/css/site.css           stylesheet source          src/js/site.js   progressive enhancement
scripts/build.mjs          → index.html, 404.html, publications/**, tools/*/about/, sitemap.xml,
                             assets/dist/site.<hash>.{css,js}, assets/dist/build-meta.json
scripts/shots.mjs          tool screenshots → assets/tools/*.webp + shots.json
.github/workflows/build.yml  rebuild and commit on pushes to main
tests/, scripts/audit/     Playwright tests; Lighthouse, axe, link, JSON-LD and tool smoke checks
```

Public pages make no runtime request for `content.json`. JavaScript adds only the theme toggle, the small-screen menu, copy buttons, the citation dialog and map/list highlighting.

## Design tokens

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f7f5ef` | `#0e1820` |
| `--surface` | `#fffdf8` | `#14212c` |
| `--ink` | `#17232d` | `#e8edf0` |
| `--muted` | `#4f5d68` | `#a3b2bd` |
| `--rule` | `#d8d2c4` | `#2a3a48` |
| `--water` (links, rivers) | `#0b5a8c` | `#86c8f2` |
| `--silt` (labels, status, current marker) | `#8a5210` | `#e2b46a` |

Type: Newsreader 500 for headings; IBM Plex Sans 400–600 for text (16 px body, nothing under 12 px); Noto Sans Bengali subset for Bangla. Radius 3 px, 1 px rules, no shadows. Motion: colour transitions and smooth scrolling only, none under `prefers-reduced-motion`.

## Commit sequence

1. Audit tooling and baseline
2. Design explorations
3. Build pipeline, templates, design system, map data, fonts
4. Content corrections and admin schema
5. Generated pages; game layer removed
6. Workflow, tests, robots.txt, share image
7. Tool pages: shared header and footer, one `<h1>`, vendor de-duplication, lazy loading
8. Documentation
9. Fixes from verification and the independent review

## Risks

| Risk | Mitigation |
|---|---|
| Pages may not redeploy after a `GITHUB_TOKEN` commit | Documented check and fallback in TODO-FOR-OWNER.md |
| Tool regressions from the shared header or moved vendor files | Smoke test of all ten tools against the baseline; sample runs; service-worker cache names bumped |
| Admin preview drifting from the build | Same templates; covered by a test |
| Hidden papers leaking | Single `isPublic()` rule; tests check HTML, JSON-LD and that no page exists |
| Font swap causing layout shift | Two preloaded fonts, metric-matched fallbacks |
