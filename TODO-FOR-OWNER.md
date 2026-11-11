# To do — needs the owner

Nothing here was guessed or filled in. Each item says what to provide and where it goes.

## Before or right after merging

1. **Check the first automatic rebuild.** After the merge, open the repository's **Actions** tab and confirm "Build static pages" ran, then confirm a "pages build and deployment" run followed it. If the site does not update after the bot's commit, switch **Settings → Pages → Build and deployment → Source** to **GitHub Actions** and tell me; the workflow then needs an upload/deploy step instead of the commit step.
2. **Workflow permission.** If the workflow fails with "Permission denied" on push, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.
3. **Referee emails are still in git history.** They are gone from `data/content.json` and the site, but earlier commits contain them. Decide whether to rewrite history (for example with `git filter-repo`) and force-push; this cannot be undone and breaks existing clones.

## Content to supply

4. **CV.** Add the PDF as `assets/cv.pdf` (admin editor → GitHub & publish → Upload, with "Use as CV" ticked). The "Download CV (PDF)" buttons appear on the next rebuild.
5. **Professional photo.** None is shown. When you have one, tell me where to place it; it also goes into the structured data.
6. **Heliyon and Journal of Hydrologic Engineering papers.** Both are in the data but hidden. When published, set status to `published`, add the DOI, volume and date in the admin editor.
7. **Authorea preprint.** The old label said "Hydrological Processes (Wiley)". If it is under review there, add that as the publication's "Note"; I did not state it.
8. **Abstracts.** Publication pages show an abstract only if one is in the data. Crossref holds abstracts for both preprints (DOIs 10.22541/au.175741407.71397410/v1 and 10.2139/ssrn.7540708); paste the ones you want.
9. **SSRN preprint topics.** It has no tags yet.
10. **Certificate verification URLs.** All eight are empty; a "Verify" link appears for each one you fill.
11. **HEC-RAS, HEC-HMS, MIKE.** Not listed under Skills. Add them only if you use them.
12. **A site licence.** The repository has no LICENSE for the portfolio itself (three tools have their own MIT licence). Choose one if you want the site code reusable.

## Tools

13. **Validation not documented** for: Composite CN Calculator, Dependability Analyzer, GapLens, Hydro ML Studio, Hydro-Series Toolkit, River Profile Studio. Their About pages say "Not yet documented".
14. **Limitations not documented** for: Composite CN Calculator, Dependability Analyzer.
15. **No CITATION.cff or LICENSE** for seven tools (all except OpenFFA, Brishti IDF, Ababahika).
16. **Zenodo DOIs.** No tool has one. Archiving a release on Zenodo would give each a citable DOI to add to its CITATION.cff.
17. **Version numbers.** GapLens "0.0.1" and DSBC Studio "0.1.0" on the About pages are the versions of their bundled Python packages, the only versions those tools state. Edit `tools/gaplens/about.json` and `tools/dsbc/about.json` if they should differ.
18. **Tool documents mention tests and scripts that are not in this repository** (for example OpenFFA's `scripts/build-sw.mjs`), so their validation cannot be re-run from here.

## Optional

19. **Bangla text.** The Bengali font holds only the letters used today. After adding Bangla text with new letters, run `node scripts/fonts/fetch.mjs` (other letters still display, in a system font).
20. **Custom domain.** If you add one, change `meta.siteUrl` in the admin editor (SEO section); canonical links, the sitemap and structured data follow on the next build. Update `robots.txt` by hand.

## From the independent review

21. **Hidden papers are still readable in `data/content.json`.** They are on no page, but the JSON file is public. If that matters before they are published, delete the two entries and re-add them later.
22. **Accessibility inside the tools' own interfaces** was not changed: colour contrast of some muted and accent text (1–13 elements per tool in the light theme), two ARIA attributes in Ababahika, an unlabelled plot and a scrollable preview in River Profile Studio, and no `<main>` landmark in Composite CN Calculator, Dependability Analyzer and Hydro-Series Toolkit. Details in [docs/REVIEW.md](docs/REVIEW.md).
23. **Tool interfaces still load Google Fonts**, and the theme toggle is worded differently from tool to tool. Self-hosting those fonts and unifying the toggle are follow-ups.
24. **Tool screenshots** show each tool's start screen in the light theme. Capturing them with a sample loaded would show more; `scripts/shots.mjs` is the place.
