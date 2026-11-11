# Independent review — findings and resolutions

A reviewer agent that had not seen the plan, decisions or commit history was given only the built site, `data/content.json`, the constraints and the audiences. It found **no blockers** and confirmed the publication record, privacy rules, counts, structured data, keyboard behaviour, no-JS rendering and all ten tools (each bundled sample ran). Its findings and what was done:

## Fixed

| # | Finding | Resolution |
|---|---|---|
| A2 | "Current project" line in the Research section reads as a "currently" strip | Removed. The project remains in Experience and is marked Current in Study sites. |
| A3 | Publication page showed the study site's description, which described a different paper | Publication pages now show the site name only. |
| A4 | "Aug 2026 – present · 4 mos" would go stale between builds | No computed duration for the current role. |
| A5 | Conference citations dropped the paper number | APA, BibTeX and `citation_conference_title` keep "Paper 514" etc. |
| A6 | Builder notes (`sources`) were published in `assets/dist/build-meta.json` | Stripped from the build output; they stay in `tools/*/about.json` as provenance. |
| A7 | CN Calculator About page used owner-facing wording ("your workbook") | Reworded from the same in-app text. |
| A8 | Ababahika feature said flow direction was "validated against pysheds"; its VALIDATION.md says only fill and accumulation were | Now "fill and accumulation validated against pysheds". |
| B1 (part) | Eight tool pages had no skip link | The shared shell adds "Skip to the tool" where a page has none. |
| B2 | Bangla text not marked with `lang` | Wrapped in `<span lang="bn">`. |
| B4 | "Copied" was not announced | One polite status region, updated only on copy. |
| B5 | Seven links named only "ResearchGate" | Each carries the paper title for assistive technology. |
| B6 | If the script file failed to load, the phone menu was hidden with no way to open it | The page falls back to the no-JS layout when the module fails to load. |
| B7 | Esc did not close the phone menu; two adjacent links to the same target in the hero; unnamed focusable citation blocks | Esc closes the menu and returns focus; the hero map is an image and the caption carries the link; citation blocks are labelled. |
| C1 | In preview mode handlers were bound twice, so the theme button toggled twice | Page-level handlers bind once; only content handlers re-bind after a preview render. |
| C2 | `safeUrl()` could be bypassed with control characters (`java\tscript:`) | Control characters and whitespace are stripped, then only http, https, mailto, tel and relative URLs pass. |
| D1 (part) | Tool pages lacked `og:*`, `twitter:*` and `theme-color` | Added to all ten. |
| D2 | CLS 0.108 at 375 px with slow fonts | 0.003 after the hero change (measured with fonts delayed 900 ms). |
| D3 | Three pairs of publication pages shared a meta description | Descriptions now start with the title. |
| D4 | `theme-color` ignored the manual toggle | Updated when the theme is switched. |
| E1 | On a phone, role and routes sat below a nine-line bio | A one-line role under the name; on phones the buttons and profile links come before the bio. |
| E2 | Map: pins 4 and 11 overlapped; labels collided with pins | Close pins are moved apart; labels repositioned and given a halo. |
| E3 | A `.now` style meant for one paragraph also hit the first study site | Style removed with the paragraph. |

## Not changed, with reasons

| # | Finding | Reason |
|---|---|---|
| A1 | The two hidden papers are readable in the served `data/content.json` | The owner asked to keep them in `content.json` so they can be switched on from the editor. They appear in no page, structured data, sitemap or count. Listed in TODO-FOR-OWNER.md with the alternative (remove them until published). |
| B1 (rest) | Colour-contrast failures inside the tools' own working areas (1–13 elements per tool), two ARIA issues in Ababahika, two in River Profile Studio, three tools without a `<main>` landmark | These pre-date the redesign and sit in each tool's own interface, which this PR was told not to change in behaviour. Listed in TODO-FOR-OWNER.md. |
| B3 | Theme-toggle wording differs between tools | Each tool keeps its own toggle wiring; unifying it means editing each tool's script. Listed in TODO. |
| D1 (rest) | Tool working areas still load Google Fonts; Ababahika requests map tiles | Tool interfaces were left as they are; the shared header and footer use the self-hosted fonts. Listed in TODO. |
| E4 | Tool pages are only partly coherent with the portfolio (own typeface and palette below the shared bar) | Same reason. The shared header, footer and names are consistent. |
| E5 | Tool screenshots are light-theme captures of the start screen | Kept: consistent and honest. Capturing each tool with a loaded sample is listed as an optional improvement. |
| E6 | The phone homepage is long | All publications and tools are meant to be visible without tabs or "show more". |
| E7 | Certificates show credential IDs without verify links | The URLs are not in the data (TODO item). |
