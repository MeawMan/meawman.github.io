# Joy — Portfolio

A pixel-futurist portfolio for **Mahfujur Rahman Joy**, built as a plain static site (HTML, CSS and JavaScript, with no build step), plus a **Control Room** admin panel that publishes edits straight to GitHub.

```
index.html            the site
admin.html            Control Room (content editor + publish)
data/content.json     ALL site content: edit this, or use admin.html
assets/js/avatar.js   pixel avatar + river/satellite/rain scene
assets/js/flow.js     animated streamline background
assets/js/app.js      renders content, command palette, terminal, citations
assets/js/admin.js    admin editor + GitHub publishing
assets/css/           styles
assets/files/         uploaded CV / images (created by the admin panel)
tools/serve.ps1       local preview server (Windows, no installs needed)
```

## Features
- **Interactive pixel avatar** (hand-drawn 56×64). Its head and eyes follow the cursor, and it blinks and breathes. Clicking it gives a reaction (wink, laugh, smile, surprise), and five quick clicks earn a remark. It looks down to "read" while you search, and it falls asleep with floating z's after 25 seconds of no activity. The ☔ button floods the river, and 😎 or the Konami code (↑↑↓↓←→←→BA) adds sunglasses.
- **Companion**: a mini avatar docks bottom-right once you scroll past the hero. It comments on each section the first time you reach it. Click it for a reaction; double-click it for the command palette. Edit its lines in the admin panel under **Companion**.
- **Field map**: a pixel dot-map of Bangladesh with animated major rivers and pulsing study-site pins. Edit sites in the admin panel under **Study map** (copy latitude and longitude from Google Maps).
- **Career timeline chart** above the experience list, built automatically from the roles' start and end months.
- Command palette (`Ctrl + K` or `/`) and a working mini terminal in the contact section (`help`).
- Publications with search, filters, tag search and auto-generated **APA + BibTeX** citations.
- Dark and light themes, an XP-bar scroll progress meter, a boot screen, reduced-motion support, and a clean printable CV (`Ctrl + P`).

## Preview locally
```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```
Open http://localhost:5500 (site) and http://localhost:5500/admin.html (Control Room).
Opening `index.html` by double-clicking will not work, because browsers block reading `content.json` from disk.

---

## 1. Publish on GitHub Pages
1. Create a new **public** repository on GitHub, e.g. `portfolio` (or `meawman.github.io` for a root URL).
2. Upload everything in this folder: on the repo page, click **Add file → Upload files**, drag in all files and folders, then commit. GitHub Desktop or `git push` also work.
3. Go to **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main` / root**, and save.
4. After about a minute the site is live at `https://meawman.github.io/portfolio/`.

## 2. Turn on "backend control" (Control Room)
The repo is the backend. The admin page edits `data/content.json` and commits it through the GitHub API, and Pages redeploys automatically.

1. On GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories → your portfolio repo**
   - Permissions: **Contents → Read and write**
   - Set an expiry date (for example, 1 year).
2. Open `https://meawman.github.io/portfolio/admin.html` → **GitHub & publish**, fill in the owner, repo and token, then press **Save connection** and **Test connection**.
3. Edit any section, press **Preview** to see your draft, then **Publish to GitHub** (or `Ctrl + S`). The site is live about 1 minute later.

**PIN lock:** if you tick *Remember on this device*, you choose a PIN of at least 6 characters, and the token is saved only in encrypted form (PBKDF2-SHA256 with 310k iterations, then AES-256-GCM, using the browser's built-in crypto). Each new browser session starts **🔒 Locked**: enter the PIN to unlock publishing for that tab. It locks again when you close the tab, after 30 minutes without activity, or when you click the 🔓 badge. Three wrong PINs in a row add a waiting period. There is **no PIN recovery**: click *Forget saved token* and paste the token again, or make a new one on GitHub. Without *Remember*, the token is kept only for the current tab.

Notes: the token stays in your browser only. It is never written into the site, and without it the admin page can't change anything. Drafts autosave in the browser. You can also upload your CV PDF from the admin panel, and it fills the "Download CV" button.

## 3. Show it on Google Sites
1. In a new Google Site, choose **Insert → Embed → By URL** and paste your GitHub Pages URL.
2. Choose **Whole page**, insert it, and stretch the embed to full width and height. Hide the Sites header if you like.
3. **Publish**. Each later "Publish to GitHub" from the Control Room appears inside Google Sites automatically, because it embeds the live URL.

**Custom domain on Google Sites:** Settings → Custom domains → Start setup. Verify the domain with Google Search Console, then add the `CNAME` record it gives you (`ghs.googlehosted.com`) at your domain registrar.

> **Recommendation:** Google Sites shows the portfolio inside an iframe. That means scrolling happens inside a frame, and search engines index the Sites page rather than your content. For the best result, point the custom domain at **GitHub Pages** directly:
> - Repo **Settings → Pages → Custom domain** → enter `yourdomain.com` (this creates a `CNAME` file) → tick **Enforce HTTPS**.
> - At your registrar, add `A` records for the root domain → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, and a `CNAME` for `www` → `meawman.github.io`.
> You can still keep a Google Site that embeds or links to it.

## Link preview image
`assets/og-image.png` (1200×630) is shown when the site link is shared on LinkedIn, WhatsApp, Facebook and similar sites. Many of these sites need an absolute URL. Once your final address is known, edit the two `og:image` / `twitter:image` lines in `index.html` to the full URL, for example `https://yourdomain.com/assets/og-image.png`.

## Editing without the admin panel
Edit `data/content.json` directly (in the GitHub web editor or locally) and commit.
- `experience[].start` and `end` use `YYYY-MM` format. Leave `end` empty for a current role.
- `publications[].doi` is the bare DOI (`10.xxxx/...`). Citations are generated from the structured fields.
- `settings.sections` turns sections on and off. `settings.showPhone` hides or shows your phone number.
