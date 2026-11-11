// End-to-end checks of the built site. Run: npm test  (uses the installed Google Chrome)
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { groupPubs, liveTools, pubSlug, toolSlug } from '../src/templates/util.mjs';

const data = JSON.parse(readFileSync('data/content.json', 'utf8'));
const pubs = groupPubs(data);
const hidden = data.publications.filter((p) => !pubs.all.includes(p));
const tools = liveTools(data);

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('homepage', () => {
  test('first screen identifies the owner and links to publications, tools and contact', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(data.profile.name);
    const hero = page.locator('.hero');
    for (const name of ['Publications', 'Tools', 'Contact']) await expect(hero.getByRole('link', { name, exact: true })).toBeInViewport();
    await expect(hero).toContainText('CEGIS');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.scrollY), 'page must not scroll by itself').toBe(0);
    expect(errors).toEqual([]);
  });

  test('publications: three groups, correct counts, pending papers hidden', async ({ page }) => {
    await page.goto('/');
    const sec = page.locator('#publications');
    await expect(sec.locator('.pub')).toHaveCount(pubs.all.length);
    await expect(sec.getByRole('heading', { name: 'Journal articles' })).toBeVisible();
    await expect(sec.getByRole('heading', { name: 'Preprints' })).toBeVisible();
    await expect(sec.getByRole('heading', { name: /Conference papers — ICCEI 2025/ })).toBeVisible();
    const html = await page.content();
    for (const p of hidden) expect(html, 'hidden paper leaked: ' + p.title).not.toContain(p.title);
    for (const p of pubs.all.filter((x) => x.doi)) await expect(sec.locator('a[href="https://doi.org/' + p.doi + '"]')).toHaveCount(1);
    await expect(page.locator('.record')).toContainText(pubs.journal.length + ' journal article');
    await expect(page.locator('.record')).toContainText(tools.length + ' web tools');
  });

  test('tools: every tool has a screenshot, status and links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tools .tool')).toHaveCount(tools.length);
    for (const t of tools) {
      const card = page.locator('#tools .tool', { has: page.getByRole('heading', { name: t.name, exact: true }) });
      await expect(card.locator('img')).toHaveAttribute('alt', /Screenshot of /);
      await expect(card.locator('img')).toHaveAttribute('width', /\d+/);
      await expect(card.getByRole('link', { name: /Open tool/ })).toHaveAttribute('href', t.url);
      await expect(card.getByRole('link', { name: /About & methods/ })).toHaveAttribute('href', 'tools/' + toolSlug(t) + '/about/');
    }
  });

  test('privacy: one primary email, work email once, no referee contact details, no street address', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const emails = [...new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [])].filter((e) => !/^[\d.]+$/.test(e));
    expect(emails.sort()).toEqual([data.profile.personalEmail, data.profile.workEmail].sort());
    expect((html.match(new RegExp(data.profile.workEmail, 'g')) || []).length, 'work email appears once (text + href)').toBe(2);
    expect(html).not.toContain('Agargaon');
    await expect(page.locator('#references')).toContainText('Contact details available on request.');
    const json = readFileSync('data/content.json', 'utf8');
    expect(json).not.toMatch(/sust\.edu|niaz\.sust/);
  });

  test('no horizontal overflow on a phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    for (const path of ['/', '/publications/', '/publications/' + pubSlug(pubs.all[0]) + '/', '/tools/' + toolSlug(tools[0]) + '/about/']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
    }
    await page.close();
  });

  test('works with JavaScript disabled', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#publications .pub')).toHaveCount(pubs.all.length);
    await expect(page.locator('#tools .tool')).toHaveCount(tools.length);
    await expect(page.locator('#contact')).toContainText(data.profile.personalEmail);
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Publications' })).toBeVisible();
    await page.locator('#publications .cite').first().click();
    await expect(page).toHaveURL(/publications\/.+\/#cite$/);
    await expect(page.locator('#bib')).toContainText('@');
    await ctx.close();
  });

  test('theme: follows the system, toggle persists', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await bg();
    await page.locator('.theme-btn').click();
    expect(await bg()).not.toBe(dark);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg()).not.toBe(dark);
    await ctx.close();
  });

  test('keyboard: skip link, then citation dialog traps and returns focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    const cite = page.locator('#publications .cite').first();
    await cite.focus();
    await page.keyboard.press('Enter');
    const dlg = page.locator('#cite-dlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#cite-bib')).toContainText('@');
    expect(await page.evaluate(() => document.querySelector('#cite-dlg').contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('#cite-dlg').contains(document.activeElement)), 'focus stays inside the dialog').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(cite).toBeFocused();
  });

  test('structured data parses and covers people, papers and tools', async ({ page }) => {
    await page.goto('/');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const nodes = blocks.flatMap((b) => JSON.parse(b)['@graph']);
    const count = (t) => nodes.filter((n) => n['@type'] === t).length;
    expect(count('Person')).toBe(1);
    expect(count('WebSite')).toBe(1);
    expect(count('ScholarlyArticle')).toBe(pubs.all.filter((p) => p.doi || p.url).length);
    expect(count('SoftwareApplication')).toBe(tools.length);
    const person = nodes.find((n) => n['@type'] === 'Person');
    expect(person.email).toBe(data.profile.personalEmail);
    expect(person.sameAs).toContain('https://orcid.org/0009-0003-4202-9776');
    expect(JSON.stringify(nodes)).not.toContain(hidden[0] ? hidden[0].title : '\u0000');
  });
});

test.describe('publication pages', () => {
  for (const p of pubs.all) {
    test('page for: ' + p.title.slice(0, 50), async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('/publications/' + pubSlug(p) + '/');
      await expect(page.locator('h1')).toHaveText(p.title);
      await expect(page.locator('meta[name="citation_title"]')).toHaveAttribute('content', p.title);
      await expect(page.locator('meta[name="citation_author"]')).toHaveCount(p.authors.length);
      if (p.doi) {
        await expect(page.locator('meta[name="citation_doi"]')).toHaveAttribute('content', p.doi);
        await expect(page.locator('main a[href="https://doi.org/' + p.doi + '"]')).toBeVisible();
      }
      await expect(page.locator('meta[name="citation_pdf_url"]')).toHaveCount(0);
      if (!p.abstract) await expect(page.getByRole('heading', { name: 'Abstract' })).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', data.meta.siteUrl + 'publications/' + pubSlug(p) + '/');
      expect(errors).toEqual([]);
    });
  }
  test('hidden papers have no page', async ({ request }) => {
    for (const p of hidden) expect((await request.get('/publications/' + pubSlug(p) + '/')).status()).toBe(404);
  });
});

test.describe('tool pages', () => {
  for (const t of tools) {
    test(t.name + ': one h1 with the portfolio name, about page linked', async ({ page }) => {
      await page.goto('/' + t.url.replace(/#.*$/, ''));
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText(t.name);
      await expect(page.locator('a[href="about/"]').first()).toBeAttached();
      await page.goto('/tools/' + toolSlug(t) + '/about/');
      await expect(page.locator('h1')).toHaveText('About ' + t.name);
      for (const h of ['Problem', 'Method', 'Data', 'Validation', 'Limitations', 'How to cite']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    });
  }
});

test.describe('admin editor', () => {
  test('loads the content and lists every section', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/admin.html');
    await expect(page.locator('#side button')).toHaveCount(16);
    await expect(page.locator('#editor h1')).toHaveText('Profile');
    await page.locator('#side button', { hasText: 'Publications' }).click();
    await expect(page.locator('#editor .item')).toHaveCount(data.publications.length);
    await page.locator('#side button', { hasText: 'References' }).click();
    await expect(page.locator('#editor')).not.toContainText('Email');
    expect(errors).toEqual([]);
  });

  test('preview renders the unsaved draft with the shared templates', async ({ page }) => {
    const errors = watchErrors(page);
    const draft = JSON.parse(JSON.stringify(data));
    draft.profile.name = 'Draft Name For Preview';
    draft.publications.find((p) => p.status === 'accepted').status = 'published';
    await page.addInitScript((d) => localStorage.setItem('mrj_draft', d), JSON.stringify(draft));
    await page.goto('/index.html?preview=1');
    await expect(page.locator('h1')).toHaveText('Draft Name For Preview');
    await expect(page.locator('.preview-bar')).toBeVisible();
    await expect(page.locator('#publications .pub')).toHaveCount(pubs.all.length + 1);
    await expect(page.locator('#tools .tool img').first()).toBeAttached();
    expect(errors).toEqual([]);
  });
});

test('404 page uses the site design and root-relative links', async ({ page }) => {
  const res = await page.goto('/no/such/page/');
  expect(res.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('This river ran dry');
  await expect(page.getByRole('link', { name: 'Back to the homepage' })).toHaveAttribute('href', '/');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('IBM Plex Sans');
});
