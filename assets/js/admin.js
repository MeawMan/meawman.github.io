/* Control Room — schema-driven editor for data/content.json.
   "Backend" = your GitHub repo: Publish commits content.json through the
   GitHub REST API, and GitHub Pages redeploys the site automatically. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DRAFT_KEY = 'mrj_draft';
  const GH_KEY = 'mrj_github';

  // ---------------------------------------------------------------- schema
  const f = (key, label, type, opts) => ({ key, label: label || key, type: type || 'text', opts });
  const ICONS = ['github', 'linkedin', 'scholar', 'researchgate', 'orcid', 'link'];
  const SCHEMA = [
    { key: 'profile', label: 'Profile', kind: 'object', help: 'Your name, headline and contact details shown in the hero and contact sections.',
      fields: [f('name', 'Full name'), f('shortName', 'Short name'), f('initials', 'Logo initials'), f('status', 'Status badge (top of hero)'),
        f('roles', 'Typed roles — one per line', 'list'), f('bio', 'Hero bio — wrap words in **double asterisks** to bold them', 'textarea'),
        f('location', 'Location'), f('currentQuest', 'Current quest / main project'), f('availability', 'Availability line (contact section)'),
        f('workEmail', 'Work email'), f('personalEmail', 'Personal email (used for the main Email buttons)'), f('phone', 'Phone'),
        f('office', 'Office address'), f('cvUrl', 'CV / résumé link (upload a PDF in the GitHub tab to get one)')] },
    { key: 'links', label: 'Links', kind: 'array', title: (i) => i.label || 'New link', blank: { label: '', url: '', icon: 'link' },
      help: 'Profile links. Empty URLs are hidden on the site.',
      fields: [f('label', 'Label'), f('url', 'URL'), f('icon', 'Icon', 'select', ICONS)] },
    { key: 'avatar', label: 'Avatar', kind: 'object', help: 'What the pixel avatar in the hero says in its speech bubble.',
      fields: [f('lines', 'Speech lines — one per line', 'list')] },
    { key: 'buddy', label: 'Companion', kind: 'object', help: 'The mini avatar that docks in the corner while scrolling. It says one line the first time each section comes into view (leave a line empty to stay quiet).',
      fields: [f('enabled', 'Show the companion', 'checkbox'), f('sections', 'Lines per section (JSON: {"about": "…", "research": "…"})', 'json')] },
    { key: 'studyAreas', label: 'Study map', kind: 'array', title: (i) => (i.current ? '● ' : '') + (i.name || 'New site'),
      blank: { name: '', lon: 90.4, lat: 23.7, current: false, what: '', org: '', year: '' },
      help: 'Pins on the Bangladesh map. Longitude 88–92.7, latitude 20.6–26.6 (copy them from Google Maps: right-click → coordinates gives “lat, lon”).',
      fields: [f('name', 'Site name'), f('what', 'What you studied', 'textarea'), f('lat', 'Latitude', 'number'), f('lon', 'Longitude', 'number'),
        f('org', 'Organisation / venue'), f('year', 'Year(s)'), f('current', 'Current project (green pin)', 'checkbox')] },
    { key: 'tools', label: 'Tools', kind: 'array', title: (i) => (i.status === 'soon' ? '◌ ' : '') + (i.name || 'New tool'),
      blank: { name: '', tagline: '', description: '', url: '', icon: 'chart', accent: 'cyan', status: 'live', features: [], tags: [] },
      help: 'Tools shown in the homepage Toolbox. “Link” can be a page in this site (e.g. tools/my-tool/) or any web address. Status “soon” shows the card without a launch button.',
      fields: [f('name', 'Tool name'), f('tagline', 'One-line tagline'), f('description', 'Description', 'textarea'), f('url', 'Link (e.g. tools/hydro-series/#minmax)'),
        f('icon', 'Icon', 'select', ['band', 'extend', 'ml', 'chart', 'map', 'wave']), f('accent', 'Colour', 'select', ['cyan', 'violet', 'amber', 'lime', 'pink']),
        f('status', 'Status', 'select', ['live', 'beta', 'soon']), f('features', 'Key features — one per line', 'list'), f('tags', 'Tags — comma separated', 'csv')] },
    { key: 'focusAreas', label: 'Focus areas', kind: 'array', title: (i) => i.title, blank: { icon: 'chip', title: '', text: '' },
      fields: [f('title', 'Title'), f('icon', 'Icon', 'select', ['wave', 'satellite', 'cloud', 'chip']), f('text', 'Description', 'textarea')] },
    { key: 'experience', label: 'Experience', kind: 'array', title: (i) => (i.role || 'New role') + (i.org ? ' — ' + i.org : ''),
      blank: { role: '', org: '', orgNote: '', location: '', mode: 'On-site', start: '', end: '', project: '', people: '', bullets: [], tools: [] },
      help: 'Newest first. Leave “End” empty for your current role.',
      fields: [f('role', 'Role / designation'), f('org', 'Organization'), f('orgNote', 'Organization note'), f('location', 'Location'),
        f('mode', 'Mode', 'select', ['On-site', 'Hybrid', 'Remote']), f('start', 'Start', 'month'), f('end', 'End (empty = present)', 'month'),
        f('project', 'Project', 'textarea'), f('people', 'PI / supervisor'), f('bullets', 'Responsibilities — one per line', 'list'), f('tools', 'Tools — comma separated', 'csv')] },
    { key: 'publications', label: 'Publications', kind: 'array', title: (i) => (i.year ? '[' + i.year + '] ' : '') + (i.title || 'New publication'),
      blank: { type: 'journal', status: 'published', featured: false, year: new Date().getFullYear(), title: '', authors: [], venue: '', volume: '', issue: '', pages: '', doi: '', url: '', tags: [] },
      help: 'APA and BibTeX citations are generated automatically from these fields. Write the DOI without https://doi.org/.',
      fields: [f('title', 'Title', 'textarea'), f('authors', 'Authors — one per line, in order', 'list'), f('type', 'Type', 'select', ['journal', 'conference']),
        f('status', 'Status', 'select', ['published', 'accepted', 'revision', 'review', 'preprint']), f('year', 'Year', 'number'), f('venue', 'Journal / conference'),
        f('volume', 'Volume'), f('issue', 'Issue'), f('pages', 'Pages / article no.'), f('doi', 'DOI (e.g. 10.1016/j.indic.2025.100878)'), f('url', 'Other link'),
        f('tags', 'Tags — comma separated', 'csv'), f('featured', 'Featured', 'checkbox')] },
    { key: 'education', label: 'Education', kind: 'array', title: (i) => i.degree, blank: { degree: '', institution: '', location: '', period: '', status: 'completed', grade: '', note: '' },
      fields: [f('degree', 'Degree'), f('institution', 'Institution'), f('location', 'Location'), f('period', 'Period'), f('status', 'Status', 'select', ['ongoing', 'completed']),
        f('grade', 'Grade / CGPA'), f('note', 'Note', 'textarea')] },
    { key: 'skills', label: 'Skills', kind: 'array', title: (i) => i.group, blank: { group: '', items: [] },
      fields: [f('group', 'Group name'), f('items', 'Skills — comma separated', 'csv')] },
    { key: 'certifications', label: 'Certifications', kind: 'array', title: (i) => i.title, blank: { title: '', issuer: '', date: '', credentialId: '', url: '' },
      fields: [f('title', 'Title'), f('issuer', 'Issuer'), f('date', 'Date'), f('credentialId', 'Credential ID'), f('url', 'Verification URL')] },
    { key: 'leadership', label: 'Leadership', kind: 'array', title: (i) => i.role + (i.org ? ' — ' + i.org : ''), blank: { role: '', org: '', location: '', period: '' },
      fields: [f('role', 'Role'), f('org', 'Organization'), f('location', 'Location'), f('period', 'Period')] },
    { key: 'references', label: 'References', kind: 'array', title: (i) => i.name, blank: { name: '', title: '', org: '', email: '' },
      fields: [f('name', 'Name'), f('title', 'Title'), f('org', 'Organization'), f('email', 'Email')] },
    { key: 'settings', label: 'Site settings', kind: 'object', help: 'Turn sections and effects on or off.',
      fields: [f('showPhone', 'Show phone number publicly', 'checkbox'), f('showUnpublished', 'Show accepted / in-revision / preprint papers (off = published only)', 'checkbox'), f('bootScreen', 'Show boot animation on first visit', 'checkbox'),
        f('flowBackground', 'Animated flow background', 'checkbox'),
        f('sections', 'Visible sections', 'flags', ['about', 'tools', 'experience', 'map', 'research', 'skills', 'education', 'leadership', 'references', 'contact'])] },
    { key: 'meta', label: 'SEO', kind: 'object', help: 'Browser tab title and search-engine description.',
      fields: [f('title', 'Page title'), f('description', 'Meta description', 'textarea'), f('siteUrl', 'Public site URL'), f('updated', 'Last updated', 'date')] },
    { key: '_github', label: 'GitHub & publish', kind: 'github' },
    { key: '_json', label: 'Raw JSON', kind: 'json' },
  ];

  let DATA = null, current = 'profile', dirty = false, baseline = '';

  // ---------------------------------------------------------------- utils
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 2400);
  }
  function setStatus() {
    const s = $('#status');
    const changed = JSON.stringify(DATA) !== baseline;
    dirty = changed;
    s.textContent = changed ? '● Unpublished changes (draft auto-saved)' : '✓ In sync with loaded content';
    s.className = 'status mono' + (changed ? ' warn' : ' ok');
  }
  let saveTimer = 0;
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(DATA)); } catch (e) { /* ignore */ } setStatus(); }, 250);
  }
  function b64encode(str) {
    return bytesToB64(new TextEncoder().encode(str));
  }
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  // ---------------------------------------------------------------- fields
  function fieldHTML(fd, val, id) {
    const lab = '<label for="' + id + '">' + esc(fd.label) + '</label>';
    switch (fd.type) {
      case 'textarea': return lab + '<textarea id="' + id + '" rows="3">' + esc(val) + '</textarea>';
      case 'list': return lab + '<textarea id="' + id + '" rows="' + Math.min(10, Math.max(3, (val || []).length + 1)) + '">' + esc((val || []).join('\n')) + '</textarea>';
      case 'csv': return lab + '<input id="' + id + '" value="' + esc((val || []).join(', ')) + '" />';
      case 'json': return lab + '<input id="' + id + '" class="mono" value="' + esc(val == null ? '' : JSON.stringify(val)) + '" />';
      case 'number': return lab + '<input id="' + id + '" type="number" value="' + esc(val) + '" />';
      case 'month': return lab + '<input id="' + id + '" type="month" value="' + esc(val) + '" />';
      case 'date': return lab + '<input id="' + id + '" type="date" value="' + esc(val) + '" />';
      case 'select': return lab + '<select id="' + id + '">' + fd.opts.map((o) => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
      case 'checkbox': return '<label class="check"><input id="' + id + '" type="checkbox"' + (val ? ' checked' : '') + ' /> ' + esc(fd.label) + '</label>';
      case 'flags': return '<span class="flabel">' + esc(fd.label) + '</span><div class="flags">' + fd.opts.map((o) =>
        '<label class="check"><input type="checkbox" data-flag="' + o + '"' + ((val || {})[o] !== false ? ' checked' : '') + ' /> ' + o + '</label>').join('') + '</div>';
      default: return lab + '<input id="' + id + '" value="' + esc(val) + '" />';
    }
  }
  function readField(fd, el, wrap) {
    switch (fd.type) {
      case 'list': return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
      case 'csv': return el.value.split(',').map((s) => s.trim()).filter(Boolean);
      case 'number': return el.value === '' ? '' : Number(el.value);
      case 'json': {
        try { const v = el.value.trim() ? JSON.parse(el.value) : null; el.style.borderColor = ''; return v; }
        catch (e) { el.style.borderColor = 'var(--bad)'; throw e; }
      }
      case 'checkbox': return el.checked;
      case 'flags': { const o = {}; wrap.querySelectorAll('[data-flag]').forEach((c) => { o[c.dataset.flag] = c.checked; }); return o; }
      default: return el.value;
    }
  }
  let uid = 0;
  function fieldsBlock(fields, obj, onChange) {
    const box = document.createElement('div');
    box.className = 'fields';
    fields.forEach((fd) => {
      const id = 'f' + (++uid);
      const w = document.createElement('div');
      w.className = 'field' + (['textarea', 'list'].includes(fd.type) || fd.type === 'flags' ? ' wide' : '') + (fd.type === 'checkbox' ? ' cb' : '');
      w.innerHTML = fieldHTML(fd, obj[fd.key], id);
      const handler = () => {
        try { obj[fd.key] = readField(fd, w.querySelector('#' + id), w); } catch (e) { return; } // invalid JSON: keep last good value
        onChange && onChange(); changed();
      };
      w.addEventListener('input', handler);
      w.addEventListener('change', handler);
      box.appendChild(w);
    });
    return box;
  }

  // ---------------------------------------------------------------- views
  function renderSide() {
    $('#side').innerHTML = SCHEMA.map((s) => {
      const n = Array.isArray(DATA[s.key]) ? '<em>' + DATA[s.key].length + '</em>' : '';
      return '<button data-k="' + s.key + '" class="' + (s.key === current ? 'on' : '') + (s.key.startsWith('_') ? ' sys' : '') + '">' + esc(s.label) + n + '</button>';
    }).join('');
  }
  function render() {
    renderSide();
    const s = SCHEMA.find((x) => x.key === current);
    const ed = $('#editor');
    ed.innerHTML = '<div class="ed-head"><h1>' + esc(s.label) + '</h1>' + (s.help ? '<p class="muted">' + esc(s.help) + '</p>' : '') + '</div>';
    if (s.kind === 'object') {
      DATA[s.key] = DATA[s.key] || {};
      const card = document.createElement('div'); card.className = 'panel';
      card.appendChild(fieldsBlock(s.fields, DATA[s.key]));
      ed.appendChild(card);
    } else if (s.kind === 'array') renderArray(s, ed);
    else if (s.kind === 'github') renderGithub(ed);
    else if (s.kind === 'json') renderJson(ed);
  }

  function renderArray(s, ed) {
    const arr = DATA[s.key] = DATA[s.key] || [];
    const bar = document.createElement('div');
    bar.className = 'arr-bar';
    bar.innerHTML = '<button class="btn primary sm" data-act="add">+ Add new</button><button class="btn sm" data-act="expand">Expand all</button><button class="btn sm" data-act="collapse">Collapse all</button>';
    ed.appendChild(bar);
    const list = document.createElement('div');
    list.className = 'items';
    arr.forEach((item, i) => {
      const d = document.createElement('details');
      d.className = 'item';
      if (s._open === i) d.open = true;
      const sum = document.createElement('summary');
      const title = document.createElement('span');
      title.className = 'it-title';
      title.textContent = s.title(item) || '(untitled)';
      const tools = document.createElement('span');
      tools.className = 'it-tools';
      tools.innerHTML = '<button title="Move up" data-m="up">↑</button><button title="Move down" data-m="down">↓</button><button title="Duplicate" data-m="dup">⧉</button><button title="Delete" data-m="del" class="del">✕</button>';
      sum.append(title, tools);
      d.appendChild(sum);
      d.appendChild(fieldsBlock(s.fields, item, () => { title.textContent = s.title(item) || '(untitled)'; }));
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        e.preventDefault();
        const m = b.dataset.m;
        if (m === 'up' && i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; s._open = i - 1; }
        else if (m === 'down' && i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; s._open = i + 1; }
        else if (m === 'dup') { arr.splice(i + 1, 0, JSON.parse(JSON.stringify(item))); s._open = i + 1; }
        else if (m === 'del') { if (!confirm('Delete “' + (s.title(item) || 'this item') + '”?')) return; arr.splice(i, 1); s._open = -1; }
        else return;
        changed(); render();
      });
      list.appendChild(d);
    });
    if (!arr.length) list.innerHTML = '<p class="muted empty">Nothing here yet.</p>';
    ed.appendChild(list);
    bar.addEventListener('click', (e) => {
      const a = (e.target.closest('button') || {}).dataset; if (!a || !a.act) return;
      if (a.act === 'add') { arr.unshift(JSON.parse(JSON.stringify(s.blank))); s._open = 0; changed(); render(); }
      else list.querySelectorAll('details').forEach((d) => { d.open = a.act === 'expand'; });
    });
  }

  function renderJson(ed) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.innerHTML = '<textarea id="raw" class="raw" spellcheck="false"></textarea><div class="row"><button class="btn primary" id="applyRaw">Apply JSON</button><button class="btn" id="importBtn">Import file…</button><span class="muted small" id="rawMsg"></span></div>';
    ed.appendChild(p);
    $('#raw').value = JSON.stringify(DATA, null, 2);
    $('#applyRaw').addEventListener('click', () => {
      try { const v = JSON.parse($('#raw').value); validate(v); DATA = v; changed(); toast('JSON applied'); renderSide(); }
      catch (e) { $('#rawMsg').textContent = '✕ ' + e.message; toast('Invalid JSON: ' + e.message, true); }
    });
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
  }

  // ---------------------------------------------------------------- github
  // Storage model:
  //   localStorage  mrj_github      → owner/repo/branch/path (+ the token ENCRYPTED with your PIN when "Remember" is on)
  //   sessionStorage mrj_github_tok → the unlocked token for this tab only (gone when the tab closes, or on Lock / auto-lock)
  // A readable token is never written to localStorage.
  const TOK_KEY = 'mrj_github_tok';
  const AUTO_LOCK_MS = 30 * 60 * 1000;

  function readSettings() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(GH_KEY) || '{}'); } catch (e) { /* ignore */ }
    if (c.token) { delete c.token; try { localStorage.setItem(GH_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } } // migrate old plain-text saves
    if (!c.owner) {
      // Guess owner/repo when hosted on <owner>.github.io/<repo>
      const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
      if (m) { c.owner = m[1]; c.repo = location.pathname.split('/').filter(Boolean).filter((s) => !/\.html$/.test(s))[0] || m[1] + '.github.io'; }
    }
    return Object.assign({ owner: '', repo: '', branch: 'main', path: 'data/content.json', remember: false, enc: null }, c);
  }
  function sessionToken() { try { return sessionStorage.getItem(TOK_KEY) || ''; } catch (e) { return ''; } }
  function setSessionToken(t) { try { if (t) sessionStorage.setItem(TOK_KEY, t); else sessionStorage.removeItem(TOK_KEY); } catch (e) { /* ignore */ } updateLockBadge(); }
  function ghConf() { return Object.assign(readSettings(), { token: sessionToken() }); }
  function saveSettings(s) {
    const keep = { owner: s.owner, repo: s.repo, branch: s.branch, path: s.path, remember: !!s.remember, enc: s.remember ? s.enc : null };
    try { localStorage.setItem(GH_KEY, JSON.stringify(keep)); } catch (e) { /* ignore */ }
  }

  // --- PIN encryption (PBKDF2-SHA256 → AES-GCM 256, all in the browser's WebCrypto) ---
  const b64 = (buf) => bytesToB64(new Uint8Array(buf));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function pinKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(token, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), new TextEncoder().encode(token));
    return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decryptToken(enc, pin) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, await pinKey(pin, unb64(enc.salt)), unb64(enc.ct));
    return new TextDecoder().decode(pt);
  }

  // --- lock state ---
  function lockState() {
    const s = readSettings();
    if (sessionToken()) return 'unlocked';
    return s.enc ? 'locked' : 'none';
  }
  function updateLockBadge() {
    const el = $('#lockState');
    if (!el) return;
    const st = lockState();
    el.textContent = st === 'unlocked' ? '🔓 Unlocked' : st === 'locked' ? '🔒 Locked' : '○ Not connected';
    el.className = 'lock mono ' + st;
    el.title = st === 'unlocked' ? 'Publishing is enabled in this tab. Click to lock now.' : st === 'locked' ? 'Enter your PIN in “GitHub & publish” to unlock' : 'Connect GitHub in “GitHub & publish”';
  }
  function lockNow(quiet) { setSessionToken(''); if (!quiet) toast('Locked — your PIN is needed to publish again'); if (current === '_github') render(); }
  // Auto-lock after 30 minutes without activity
  let lastActive = Date.now();
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  setInterval(() => { if (lockState() === 'unlocked' && readSettings().enc && Date.now() - lastActive > AUTO_LOCK_MS) lockNow(); }, 60000);

  // Make sure a token is available before talking to GitHub
  function needToken() {
    if (sessionToken()) return true;
    current = '_github'; render(); window.scrollTo(0, 0);
    toast(lockState() === 'locked' ? 'Enter your PIN to unlock publishing' : 'Connect your GitHub repo first', true);
    setTimeout(() => { const p = $('#unlockPin') || $('#ghToken'); if (p) p.focus(); }, 50);
    return false;
  }

  async function gh(method, url, body) {
    const c = ghConf();
    if (!c.owner || !c.repo) throw new Error('Fill in owner and repo in “GitHub & publish” first.');
    if (!c.token) throw new Error(lockState() === 'locked' ? 'Locked — enter your PIN first.' : 'Add your token in “GitHub & publish” first.');
    const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + url, {
      method,
      headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && !(method === 'GET' && res.status === 404)) throw new Error((json.message || 'HTTP ' + res.status) + (res.status === 401 ? ' — check the token' : res.status === 404 ? ' — check owner/repo and token access' : ''));
    return { status: res.status, json };
  }
  async function getFile(path) {
    const c = ghConf();
    const r = await gh('GET', '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(c.branch));
    return r.status === 404 ? null : r.json;
  }
  async function putFile(path, b64, message) {
    const c = ghConf();
    const existing = await getFile(path);
    return gh('PUT', '/contents/' + path.split('/').map(encodeURIComponent).join('/'), {
      message, content: b64, branch: c.branch, sha: existing ? existing.sha : undefined,
    });
  }

  function renderGithub(ed) {
    const c = ghConf();
    const st = lockState();

    // Unlock card (only when a PIN-encrypted token is saved and this tab is locked)
    if (st === 'locked') {
      const lk = document.createElement('div');
      lk.className = 'panel lock-card';
      lk.innerHTML = '<h2>🔒 Publishing is locked</h2><p class="muted small">Your token is saved on this device, encrypted with your PIN. Enter the PIN to unlock publishing for this tab.</p>' +
        '<form class="row" id="unlockForm" autocomplete="off"><input id="unlockPin" type="password" inputmode="text" placeholder="PIN" aria-label="PIN" style="max-width:220px" />' +
        '<button class="btn primary" type="submit">Unlock</button><button class="btn" type="button" id="forgetBtn">Forget saved token</button><span class="muted small" id="unlockMsg"></span></form>';
      ed.appendChild(lk);
    } else if (st === 'unlocked') {
      const ok = document.createElement('div');
      ok.className = 'panel lock-card ok';
      ok.innerHTML = '<div class="row" style="margin:0"><b>🔓 Unlocked for this tab.</b><span class="muted small">' +
        (c.enc ? 'Locks automatically after 30 minutes of inactivity or when you close the tab.' : 'The token is kept for this tab only and is cleared when you close it.') +
        '</span><button class="btn sm" id="lockBtn" style="margin-left:auto">Lock now</button>' + (c.enc ? '<button class="btn sm" id="forgetBtn">Forget saved token</button>' : '') + '</div>';
      ed.appendChild(ok);
    }

    const p = document.createElement('div');
    p.className = 'panel';
    const hasToken = st !== 'none';
    p.innerHTML =
      '<div class="fields">' +
      '<div class="field"><label for="ghOwner">GitHub username (owner)</label><input id="ghOwner" value="' + esc(c.owner) + '" placeholder="meawman" /></div>' +
      '<div class="field"><label for="ghRepo">Repository</label><input id="ghRepo" value="' + esc(c.repo) + '" placeholder="meawman.github.io" /></div>' +
      '<div class="field"><label for="ghBranch">Branch</label><input id="ghBranch" value="' + esc(c.branch) + '" /></div>' +
      '<div class="field"><label for="ghPath">Content file path</label><input id="ghPath" value="' + esc(c.path) + '" /></div>' +
      '<div class="field wide"><label for="ghToken">Fine-grained personal access token</label><input id="ghToken" type="password" value="" placeholder="' +
        (hasToken ? 'Saved — leave empty to keep the current token' : 'github_pat_…') + '" autocomplete="off" spellcheck="false" /></div>' +
      '<div class="field wide cb"><label class="check"><input id="ghRemember" type="checkbox"' + (c.remember ? ' checked' : '') + ' /> Remember on this device, locked with a PIN</label></div>' +
      '<div class="field pinf"' + (c.remember ? '' : ' hidden') + '><label for="ghPin">' + (c.enc ? 'New PIN (leave empty to keep)' : 'Choose a PIN (min. 6 characters)') + '</label><input id="ghPin" type="password" autocomplete="new-password" /></div>' +
      '<div class="field pinf"' + (c.remember ? '' : ' hidden') + '><label for="ghPin2">Repeat PIN</label><input id="ghPin2" type="password" autocomplete="new-password" /></div>' +
      '</div>' +
      '<p class="muted small" style="margin-top:10px">Without “Remember”, the token is kept only for this browser tab. With it, the token is stored <b>encrypted</b> and every new session needs your PIN. There is no PIN recovery — if you forget it, click “Forget saved token” and paste the token again (or create a new one on GitHub).</p>' +
      '<div class="row"><button class="btn primary" id="ghSave">Save connection</button><button class="btn" id="ghTest">Test connection</button><button class="btn" id="ghPull">Pull latest from GitHub</button><span class="muted small" id="ghMsg"></span></div>';
    ed.appendChild(p);

    const up = document.createElement('div');
    up.className = 'panel';
    up.innerHTML = '<h2>Upload a file</h2><p class="muted small">Upload your CV (PDF) or an image to <code>assets/files/</code> in the repo. Uploading a PDF can also fill your CV link.</p>' +
      '<div class="row"><input type="file" id="upFile" /><label class="check"><input type="checkbox" id="upCv" checked /> Use as CV link</label><button class="btn primary" id="upBtn">Upload</button><span class="muted small" id="upMsg"></span></div>';
    ed.appendChild(up);

    const help = document.createElement('div');
    help.className = 'panel help';
    help.innerHTML = '<h2>How publishing works</h2><ol>' +
      '<li>Create a <b>fine-grained token</b> at GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li>' +
      '<li>Give it access to <b>only this repository</b>, with <b>Contents: Read and write</b>. Set an expiry date.</li>' +
      '<li>Paste it above and press <b>Save connection</b>, then <b>Test connection</b>.</li>' +
      '<li>Edit any section, use <b>Preview</b> to check, then <b>Publish to GitHub</b>. GitHub Pages redeploys in about a minute, and the Google Sites embed shows the new version automatically.</li>' +
      '</ol><p class="muted small">The token stays in this browser only; it is never written into the site. Anyone without a token can open this page but cannot change anything.</p>';
    ed.appendChild(help);

    const msg = (t) => { $('#ghMsg').textContent = t; };
    const readBasics = () => ({ owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() || 'main',
      path: $('#ghPath').value.trim() || 'data/content.json' });
    // Keep owner/repo/branch/path in sync without touching the token
    const syncBasics = () => { const s = readSettings(); saveSettings(Object.assign(s, readBasics())); };
    $('#ghRemember').addEventListener('change', (e) => document.querySelectorAll('.pinf').forEach((f) => { f.hidden = !e.target.checked; }));

    $('#ghSave').addEventListener('click', async () => {
      const s = Object.assign(readSettings(), readBasics());
      const typed = $('#ghToken').value.trim();
      const remember = $('#ghRemember').checked;
      const pin = remember ? $('#ghPin').value : '', pin2 = remember ? $('#ghPin2').value : '';
      let token = typed || sessionToken();
      if (!s.owner || !s.repo) { msg('✕ Fill in owner and repository'); return; }
      if (!token && !(remember && s.enc && !typed)) { msg(lockState() === 'locked' ? '✕ Unlock with your PIN first, or paste the token again' : '✕ Paste your token'); return; }
      if (remember) {
        const needPin = !!typed || !s.enc || !!pin;
        if (needPin) {
          if (!token) { msg('✕ Unlock first to change the PIN'); return; }
          if (pin.length < 6) { msg('✕ PIN must be at least 6 characters'); return; }
          if (pin !== pin2) { msg('✕ The two PINs don’t match'); return; }
          msg('Encrypting…');
          s.enc = await encryptToken(token, pin);
        }
      } else s.enc = null;
      s.remember = remember;
      saveSettings(s);
      if (token) setSessionToken(token);
      toast(remember ? 'Saved — token encrypted with your PIN' : 'Saved for this tab');
      render();
    });
    $('#ghTest').addEventListener('click', async () => {
      syncBasics();
      if (!needToken()) return;
      msg('Testing…');
      try {
        const r = await gh('GET', '');
        const ok = r.json.permissions ? r.json.permissions.push : true;
        msg(ok ? '✓ Connected to ' + r.json.full_name + ' (write access)' : '⚠ Connected, but the token has no write access');
      } catch (e) { msg('✕ ' + e.message); }
    });
    $('#ghPull').addEventListener('click', async () => {
      syncBasics();
      if (!needToken()) return;
      if (dirty && !confirm('Replace your unpublished changes with the version on GitHub?')) return;
      msg('Pulling…');
      try {
        const file = await getFile(ghConf().path);
        if (!file) throw new Error('File not found on that branch');
        DATA = JSON.parse(b64decode(file.content)); validate(DATA);
        baseline = JSON.stringify(DATA); changed(); msg('✓ Loaded latest from GitHub'); renderSide();
      } catch (e) { msg('✕ ' + e.message); }
    });
    $('#upBtn').addEventListener('click', async () => {
      const file = $('#upFile').files[0];
      if (!file) { $('#upMsg').textContent = 'Choose a file first'; return; }
      if (file.size > 20 * 1024 * 1024) { $('#upMsg').textContent = 'Max 20 MB'; return; }
      syncBasics();
      if (!needToken()) return;
      $('#upMsg').textContent = 'Uploading…';
      try {
        const name = file.name.replace(/[^\w.-]+/g, '-');
        const b64 = bytesToB64(new Uint8Array(await file.arrayBuffer()));
        await putFile('assets/files/' + name, b64, 'Upload ' + name + ' via Control Room');
        if ($('#upCv').checked) { DATA.profile.cvUrl = 'assets/files/' + name; changed(); }
        $('#upMsg').textContent = '✓ Uploaded to assets/files/' + name + ($('#upCv').checked ? ' — CV link set (publish to apply)' : '');
      } catch (e) { $('#upMsg').textContent = '✕ ' + e.message; }
    });

    // Unlock / lock / forget
    let fails = 0, waitUntil = 0;
    const uf = $('#unlockForm');
    if (uf) {
      setTimeout(() => $('#unlockPin').focus(), 30);
      uf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const um = $('#unlockMsg');
        if (Date.now() < waitUntil) { um.textContent = 'Too many tries — wait ' + Math.ceil((waitUntil - Date.now()) / 1000) + 's'; return; }
        um.textContent = 'Checking…';
        try {
          setSessionToken(await decryptToken(readSettings().enc, $('#unlockPin').value));
          fails = 0; toast('Unlocked'); render();
        } catch (err) {
          fails++;
          if (fails >= 3) waitUntil = Date.now() + Math.min(60000, 5000 * Math.pow(2, fails - 3));
          um.textContent = '✕ Wrong PIN';
          $('#unlockPin').select();
        }
      });
    }
    const lb = $('#lockBtn');
    if (lb) lb.addEventListener('click', () => lockNow());
    const fb = $('#forgetBtn');
    if (fb) fb.addEventListener('click', () => {
      if (!confirm('Remove the saved token from this device? You will need to paste the token again to publish.')) return;
      const s = readSettings(); s.enc = null; s.remember = false; saveSettings(s); setSessionToken('');
      toast('Saved token removed from this device'); render();
    });
  }

  async function publish() {
    try { validate(DATA); } catch (e) { toast(e.message, true); return; }
    if (!needToken()) return;
    const c = ghConf();
    const btn = $('#publishBtn');
    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
      DATA.meta = DATA.meta || {};
      DATA.meta.updated = today();
      const text = JSON.stringify(DATA, null, 2) + '\n';
      const r = await putFile(c.path, b64encode(text), 'Update portfolio content (' + today() + ')');
      baseline = JSON.stringify(DATA);
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      setStatus();
      toast('✓ Published — live in about a minute');
      $('#status').innerHTML = '✓ Published · <a href="' + esc(r.json.commit.html_url) + '" target="_blank" rel="noopener">view commit</a>';
    } catch (e) {
      toast('Publish failed: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Publish to GitHub';
    }
  }

  function validate(d) {
    if (!d || typeof d !== 'object') throw new Error('Content must be a JSON object');
    if (!d.profile || !d.profile.name) throw new Error('Profile → Full name is required');
    ['experience', 'publications', 'education', 'skills', 'certifications', 'leadership', 'references', 'links'].forEach((k) => {
      if (d[k] && !Array.isArray(d[k])) throw new Error('“' + k + '” must be a list');
    });
    (d.publications || []).forEach((p, i) => {
      if (!p.title) throw new Error('Publication #' + (i + 1) + ' needs a title');
      if (!Array.isArray(p.authors) || !p.authors.length) throw new Error('Publication “' + p.title.slice(0, 40) + '…” needs at least one author');
    });
  }

  // ---------------------------------------------------------------- init
  async function init() {
    let live = null;
    try {
      const r = await fetch('data/content.json?v=' + Date.now(), { cache: 'no-store' });
      if (r.ok) live = await r.json();
    } catch (e) { /* ignore */ }
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!live && !draft) {
      $('#editor').innerHTML = '<div class="panel"><h1>Could not load content</h1><p class="muted">data/content.json was not reachable. Open this page through the published site or the local server (see README.md).</p></div>';
      $('#status').textContent = 'Offline';
      return;
    }
    baseline = JSON.stringify(live || draft);
    DATA = draft || live;
    if (draft && live && JSON.stringify(draft) !== baseline) toast('Restored your unpublished draft');
    setStatus(); render(); updateLockBadge();
    $('#lockState').addEventListener('click', () => {
      if (lockState() === 'unlocked') lockNow();
      else { current = '_github'; render(); }
    });

    $('#side').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { current = b.dataset.k; render(); window.scrollTo(0, 0); } });
    $('#previewBtn').addEventListener('click', () => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(DATA)); } catch (e) { /* ignore */ }
      window.open('index.html?preview=1', '_blank');
    });
    $('#downloadBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(DATA, null, 2) + '\n'], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'content.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#publishBtn').addEventListener('click', publish);
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const v = JSON.parse(await file.text()); validate(v); DATA = v; changed(); render(); toast('Imported ' + file.name); }
      catch (err) { toast('Import failed: ' + err.message, true); }
      e.target.value = '';
    });
    addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); publish(); } });
  }

  init();
})();
