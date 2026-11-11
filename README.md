# Mahfujur Rahman Joy — portfolio

Water resources engineer and researcher, Dhaka, Bangladesh. This repository is the source of **[meawman.github.io](https://meawman.github.io/)**: publications, ten browser-based hydrology tools, and a CV-style record.

The site is static HTML, generated from one JSON file. It works without JavaScript.

## Edit content

Everything on the homepage and publication pages comes from [`data/content.json`](data/content.json).

- **In the browser:** open [`/admin.html`](https://meawman.github.io/admin.html), connect it to this repository with a fine-grained personal access token (Contents: read and write, this repository only), edit, **Preview**, then **Publish to GitHub**. The token stays in your browser and is never written to the repository.
- **By hand:** edit `data/content.json` and commit.

Either way, the **Build static pages** workflow regenerates the HTML and commits it; GitHub Pages redeploys within a couple of minutes.

Rules the build applies:

- A publication is public only when its `status` is `published` or `preprint`. Other statuses (`accepted`, `revision`, `review`) keep it out of the homepage, its own page, the sitemap, structured data and the counts.
- The "Download CV (PDF)" link appears only when `assets/cv.pdf` exists.
- Counts ("3 journal articles · 2 preprints · …") are computed from what is rendered.

## Build locally

Needs Node 20 or newer. The build itself has no dependencies.

```bash
node scripts/build.mjs
```

```bash
node scripts/serve.mjs --port 4173
```

Then open http://localhost:4173/. The server mirrors GitHub Pages (gzip, 404 page).

| File or folder | Role |
|---|---|
| `data/content.json` | All content |
| `src/templates/` | Page templates (shared by the build and the admin preview) |
| `src/css/site.css`, `src/js/site.js` | Stylesheet and progressive enhancement, minified into `assets/dist/` |
| `scripts/build.mjs` | Generates `index.html`, `404.html`, `publications/**`, `tools/*/about/`, `sitemap.xml` |
| `tools/<name>/` | The tools (hand-written pages); `about.json` feeds each tool's About page |
| `assets/tools/` | Tool screenshots (`npm run shots`) |
| `admin.html` | Content editor |

Do not edit the generated files by hand; change the data or the templates and rebuild.

## Test

Tests and audits need the dev dependencies and an installed Google Chrome.

```bash
npm install
```

```bash
npm test
```

```bash
npm run audit
```

`npm test` runs the Playwright suite in `tests/`. `npm run audit` runs the link checker, JSON-LD check, page checks, axe-core, the tool smoke test, screenshots and Lighthouse, writing to `docs/audit/after/`. The baseline of the previous site is in [`docs/audit/baseline/`](docs/audit/baseline/BASELINE.md).

## Add a tool

1. Put the page at `tools/<name>/index.html` with the shared header (copy it from another tool; it loads `assets/css/tool-shell.css` and `assets/js/tool-shell.js`).
2. Add `tools/<name>/about.json` (copy an existing one; use only text that is documented for the tool, `null` where nothing exists).
3. Add the tool under **Tools** in the admin editor with the link `tools/<name>/`.
4. Run `npm run shots` and `node scripts/build.mjs`, then commit.

## Deploy

GitHub Pages serves the `main` branch root (**Settings → Pages → Deploy from a branch**). No other setting is needed. See [TODO-FOR-OWNER.md](TODO-FOR-OWNER.md) for the one check to make after the first merge.

## More

[CHANGES.md](CHANGES.md) · [DECISIONS.md](DECISIONS.md) · [PLAN.md](PLAN.md) · [TODO-FOR-OWNER.md](TODO-FOR-OWNER.md)

Map data: Natural Earth (public domain). Fonts: Newsreader, IBM Plex Sans, Noto Sans Bengali (SIL Open Font License).
