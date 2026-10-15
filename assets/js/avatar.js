/* =====================================================================
   PixelAvatar — hand-drawn 56×64 pixel portrait of Joy (proportions traced
   from his photos: long face, swept-up quiff with short faded sides,
   thick brows over deep-set eyes, thin moustache, short neat beard).

   Interactive: head + eyes follow the cursor, blinks, breathes, reacts to
   hover/clicks with expressions (smile, wink, laugh, surprised), "reads"
   while you type, and dozes off when left alone. Two modes:
     • scene  – full card with river, satellite, rain/flood
     • mini   – transparent head-and-shoulders companion
   ===================================================================== */
(function () {
  'use strict';

  const SW = 56, SH = 64;                  // sprite size
  const BW = 80, BH = 56;                  // scene background grid (drawn at 2×)

  // ------------------------------------------------------------------ palette
  const PAL = {
    '#': '#070506', K: '#0b0709',
    H: '#15100f', h: '#30231f', f: '#3d2b22',                          // hair, highlight, faded sides
    B: '#120b0a',                                                    // brows
    L: '#d49b70', S: '#bc835b', s: '#9f6945', d: '#7d4d31', e: '#55301d', // skin ramp
    W: '#efe9e1', E: '#24150e',                                      // eyes
    M: '#211715', m: '#4b3427',                                      // beard, stubble edge
    R: '#6e3a30', r: '#8d5040',                                      // lips
    J: '#1f2b47', j: '#151d33', T: '#34446c', X: '#17171c', x: '#2e2e38', o: '#3c3c47', k: '#0b1020', b: '#0b0e18', // navy suit
  };

  // Face, left half (28 cols) mirrored around the centre.
  const FACE = [
    '', '', '', '', '', '', '', '', '',
    '..................SSSSSSSSSS', // 9
    '..................SSSSSSSSSS',
    '.................KSSSSSSSSSS',
    '.................KSSSSSSSSSS',
    '.................KSSSSSSSSSS',
    '.................KSSSSSSSSSS',
    '.................KSSSSSSSSSS', // 15
    '.................KSSBBBBBSSS', // 16 brow
    '.................KSBBBBBBBSS', // 17 brow (thicker inner end)
    '...............KsKSddddddSSS', // 18 ear, lid crease
    '...............KsdSKWEEWKSSS', // 19 eye
    '...............KsdSsWEEWsSSS', // 20 eye
    '...............KsdSSSSSSSdSS', // 21 nose side
    '...............KsdSSSSSSSdSS',
    '...............KsmSSSSSSSdSS', // 23 sideburn meets jaw
    '................KmSSSSSSSdsS', // 24
    '................KMmSSSSSsssS', // 25 nose tip, beard starts on the jawline
    '.................KMmSSSSSedd', // 26 nostril
    '.................KMmSSmMMMMM', // 27 thin moustache
    '.................KMmSSmmRRRR', // 28 upper lip
    '..................KMmSSmmrrr', // 29 lower lip
    '..................KMmmmMMMMm', // 30 soul patch
    '...................KMMmMMMMM', // 31 chin beard
    '...................KMMMMMMMM',
    '....................KMMMMMMM',
    '.....................KMMMMMM',
    '......................KMMMMM', // 35
    '.......................KKKKK', // 36 chin
    '......................KdddSS', // 37 neck
    '......................KddsSS',
    '......................KdsSSS',
    '......................KsSSSS', // 40
  ];

  // Hair, full width: [startCol, pixels]. Rounded quiff, fringe dips on the viewer's left.
  const HAIR = [
    [22, '#########'],
    [19, '###HHHHHHHH###'],
    [17, '##HHHHHhhHHHHHHH###'],
    [15, '##HHHHhhHHHHHHhhHHHHH##'],
    [14, '#HHHhhHHHHHHhhHHHHHHhhHH#'],
    [14, '#HHhHHHHHhhHHHHHHHhHHHHHH#'],        // 5
    [14, '#HHHHHhHHHHHHHhHHHHHHHhHHH#'],
    [14, '#HHHHHHHHHhHHHHHHHHHHHHHHH#'],
    [14, '#HHHHHHHhHHHHHHHHHHhHHHHHHH#'],
    [14, '#HHHHHHHHHHH..........HHHHH#'],      // 9 hairline
    [14, '#HHHHHHHH...............HHH#'],      // 10
    [14, '#HHHHH..................HHH#'],
    [14, '#HHH.....................HH#'],
    [14, '#HHH.....................HH#'],
    [14, '#HHf....................fHH#'],
    [14, '#Hff....................ffH#'],      // 15 faded sides
    [15, '#ff....................ff#'],
    [15, '#ff....................ff#'],
  ];

  // Navy suit over an open-collar black shirt (left half, rows 41–63).
  const SUIT = [
    '..................KxxxKdsSSS', // 41
    '...............KKJTxxxxKsSSS',
    '.............KKJJJTXxxxxKsSS',
    '...........KKJJJJJTXXxxxKsSS',
    '.........KKJJJJJJJJTXXXXXXXX', // 45
    '.......KKJJJJJJJJJJJTXXXXXXX',
    '.....KKJJJJJjJJJJJJJJTXXXXXo',
    '...KKJJJJJJJjJJJJJJJJJTXXXXX',
    '..KJJJJJJJJJjJJJJJJJJJJTXXXX',
    '.KJJJJJJJJJJjJJJJJJJJJJJTXXX', // 50
    'KJJJJJJJJJJJjJJJJJJJJJJJJTXo',
    'KJJJJJJJJJJJjJJJJJJJJJJJJJTX',
  ].concat(Array(11).fill('KJJJJJJJJJJJjJJJJJJJJJJJJJJk'));

  // ------------------------------------------------------------------ build layers
  const pad = (row) => (row + '.'.repeat(SW)).slice(0, SW);
  const mirror = (half) => half + half.split('').reverse().join('');

  function buildHead() {
    const g = [];
    for (let y = 0; y < SH; y++) g.push(pad(FACE[y] ? mirror(FACE[y]) : '').split(''));
    HAIR.forEach((seg, y) => seg[1].split('').forEach((c, i) => { if (c !== '.') g[y][seg[0] + i] = c; }));
    // Light from the viewer's right
    for (let y = 9; y <= 40; y++) for (let x = 0; x < SW; x++) {
      if (g[y][x] === 'S' && x >= 30) g[y][x] = 'L';
      else if (g[y][x] === 'S' && x <= 19) g[y][x] = 's';
    }
    for (let y = 19; y <= 24; y++) { g[y][27] = 'S'; g[y][28] = 'L'; }   // nose bridge
    for (let y = 21; y <= 23; y++) g[y][30] = 's';
    g[26][30] = 'e';
    // Ear inner shading
    g[20][16] = 'd'; g[21][16] = 'd'; g[20][39] = 's'; g[21][39] = 's';
    return g;
  }

  function buildBody() {
    const g = [];
    for (let y = 0; y < SH; y++) g.push('.'.repeat(SW).split(''));
    SUIT.forEach((row, i) => { g[41 + i] = pad(mirror(row)).split(''); });
    g[55][27] = g[55][28] = g[60][27] = g[60][28] = 'b';                 // jacket buttons
    for (let x = 35; x <= 40; x++) g[51][x] = 'T';                       // breast pocket welt
    return g;
  }

  function texture(ch, x, y) {
    let c = PAL[ch] || '#000';
    if ((ch === 'H' || ch === 'M') && (x * 7 + y * 3) % 11 === 0) c = ch === 'H' ? '#261b19' : '#2d201c';
    return c;
  }

  function toCanvas(grid) {
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const x = c.getContext('2d');
    grid.forEach((row, y) => row.forEach((ch, i) => {
      if (ch === '.') return;
      x.fillStyle = texture(ch, i, y); x.fillRect(i, y, 1, 1);
    }));
    return c;
  }

  const HEAD = toCanvas(buildHead());
  const BODY = toCanvas(buildBody());
  const EYES = [19, 31];               // x of each 6-wide eye box (lash corners at x and x+5), rows 19–20
  const BROWS = [[19, 25], [30, 36]];  // brow spans (rows 16–17)

  // ------------------------------------------------------------------ component
  function PixelAvatar(canvas, bubbleEl, opts) {
    opts = opts || {};
    this.mini = !!opts.mini;
    this.W = this.mini ? SW : 160;
    this.H = this.mini ? 48 : 96;
    this.AX = (this.W - SW) / 2;
    this.AY = this.mini ? 1 : this.H - SH;
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.bubble = bubbleEl;
    this.lines = opts.lines || ['Hi!'];
    this.autoTalk = opts.autoTalk !== false;
    this.theme = 'night';
    this.raining = false;
    this.shades = false;
    this.lookX = 0; this.lookY = 0;
    this.headX = 0;
    this.talking = false;
    this.expr = null;                    // { name, until }
    this.blinkUntil = 0;
    this.nextBlink = 1500;
    this.lastActive = performance.now();
    this.sleeping = false;
    this.zs = [];
    this.level = 0;
    this.drops = [];
    this.flash = 0;
    this.hop = 0;
    this.t0 = performance.now();
    this.lastFrame = 0;
    this.lineIdx = 0;
    this.clicks = [];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stars = Array.from({ length: 26 }, () => ({ x: Math.floor(Math.random() * BW), y: Math.floor(Math.random() * 30), p: Math.random() * 6 }));
    this.clouds = [{ x: 6, y: 9, w: 12 }, { x: 48, y: 4, w: 9 }, { x: 70, y: 14, w: 10 }];

    canvas.width = this.W; canvas.height = this.H;
    this.x.imageSmoothingEnabled = false;
    (PixelAvatar.instances = PixelAvatar.instances || []).push(this);

    const wake = () => {
      const now = performance.now();
      if (this.sleeping) { this.sleeping = false; this.react('surprised', 900); if (!this.mini) this.say('Oh! I’m awake 😅'); }
      this.lastActive = now;
    };
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.35);
      this.lookX = Math.abs(dx) < Math.max(40, r.width * 0.12) ? 0 : (dx < 0 ? -1 : 1);
      this.lookY = dy < -Math.max(60, r.height * 0.5) ? -1 : 0;
      wake();
    }, { passive: true });
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('keydown', wake);
    canvas.addEventListener('pointerenter', () => { this.hop = performance.now() + 260; if (!this.expr) this.react('surprised', 700); });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    if (this.autoTalk) {
      setTimeout(() => this.say(this.lines[0]), 900);
      this.cycle = setInterval(() => {
        if (document.hidden || this.talking || this.sleeping) return;
        this.lineIdx = (this.lineIdx + 1) % this.lines.length;
        this.say(this.lines[this.lineIdx]);
      }, 10000);
    }
  }

  PixelAvatar.prototype.setTheme = function (t) { this.theme = t === 'light' ? 'day' : 'night'; };
  PixelAvatar.prototype.toggleShades = function () { this.shades = !this.shades; this.react('smile', 1200); return this.shades; };
  PixelAvatar.prototype.react = function (name, ms) { this.expr = { name, until: performance.now() + (ms || 1200) }; };
  PixelAvatar.prototype.toggleRain = function () {
    this.raining = !this.raining;
    if (this.raining) this.flash = 6;
    this.react(this.raining ? 'surprised' : 'smile', 1200);
    this.say(this.raining ? 'Rain ON — watch the river rise 🌧️' : 'Flood receding… model stable ✅');
    return this.raining;
  };
  // Clicking the avatar: a different reaction each time, and a remark if you keep poking
  PixelAvatar.prototype.poke = function () {
    const now = performance.now();
    this.clicks = this.clicks.filter((t) => now - t < 2500).concat(now);
    this.hop = now + 220;
    if (this.clicks.length >= 5) { this.clicks = []; this.react('laugh', 1800); this.say('Okay, okay! I model floods, not pokes 😄'); return; }
    const r = [['wink', 'Hey there 😉'], ['laugh', 'Haha, that tickles!'], ['smile', 'Nice to meet you 👋'], ['surprised', 'Whoa!']];
    const pick = r[(this.pokeIdx = ((this.pokeIdx || 0) + 1) % r.length)];
    this.react(pick[0], 1400);
    this.say(pick[1]);
  };
  PixelAvatar.prototype.setReading = function (on) { this.reading = on; if (on) this.lastActive = performance.now(); };

  PixelAvatar.prototype.say = function (text) {
    if (!this.bubble) return;
    clearTimeout(this._hide); clearInterval(this._type);
    const b = this.bubble;
    b.textContent = '';
    b.classList.add('show');
    this.talking = true;
    const chars = Array.from(text);
    let i = 0;
    this._type = setInterval(() => {
      b.textContent += chars[i++] || '';
      if (i >= chars.length) {
        clearInterval(this._type);
        this.talking = false;
        this._hide = setTimeout(() => b.classList.remove('show'), this.mini ? 3200 : 4200);
      }
    }, this.reduced ? 0 : 30);
  };

  PixelAvatar.prototype.px = function (x, y, c, w, h) {
    this.x.fillStyle = c; this.x.fillRect(x | 0, y | 0, w || 1, h || 1);
  };

  // ------------------------------------------------------------------ scene (80×56 grid at 2×)
  PixelAvatar.prototype.drawSky = function (t) {
    const day = this.theme === 'day';
    const storm = this.raining;
    const bands = day
      ? (storm ? ['#6f8aa3', '#7f99b0', '#90a8bc'] : ['#79c2f2', '#98d3f6', '#bde5fa'])
      : (storm ? ['#080b16', '#0c1120', '#10172b'] : ['#090e22', '#0e1531', '#131c3e']);
    for (let i = 0; i < 3; i++) this.px(0, i * 14, bands[i], BW, 14);
    for (let i = 1; i < 3; i++) for (let x = (i % 2); x < BW; x += 2) this.px(x, i * 14 - 1, bands[i]);
    this.px(0, 42, bands[2], BW, 14);
    if (!day && !storm) {
      for (const s of this.stars) if (Math.sin(t / 600 + s.p) > -0.2) this.px(s.x, s.y, Math.sin(t / 300 + s.p) > 0.7 ? '#ffffff' : '#7f8fc4');
    }
    const bx = 68, by = 14, body = day ? '#ffd95a' : '#efe6c4';
    if (!storm) {
      this.px(bx - 2, by - 4, body, 5, 1); this.px(bx - 3, by - 3, body, 7, 1);
      this.px(bx - 4, by - 2, body, 9, 5); this.px(bx - 3, by + 3, body, 7, 1); this.px(bx - 2, by + 4, body, 5, 1);
      if (!day) { this.px(bx - 1, by - 1, '#d4c9a3', 2, 2); this.px(bx + 2, by + 1, '#d4c9a3'); } else this.px(bx - 1, by - 1, '#ffe98f', 2, 2);
    }
    const cc = storm ? (day ? '#5d6f80' : '#1b2238') : (day ? '#ffffff' : '#1d2648');
    const cs = storm ? (day ? '#4b5b6a' : '#151a2c') : (day ? '#dcefff' : '#171f3d');
    const speed = storm ? 0.006 : 0.0025;
    this.clouds.forEach((c, i) => {
      const x = ((c.x + t * speed * (1 + i * 0.3)) % (BW + 20)) - 14;
      this.px(x + 2, c.y + 6, cc, c.w - 4, 1); this.px(x, c.y + 7, cc, c.w, 2); this.px(x + 1, c.y + 9, cs, c.w - 2, 1);
    });
    if (storm) for (let i = 0; i < 3; i++) {
      const x = ((i * 31 + t * 0.004) % (BW + 24)) - 18;
      this.px(x, 8 + i * 3, cc, 18, 3); this.px(x + 2, 11 + i * 3, cs, 14, 1);
    }
  };

  PixelAvatar.prototype.drawSatellite = function (t) {
    const p = (t % 16000) / 16000;
    const x = Math.round(-10 + p * (BW + 20)), y = 11;
    if (x > 4 && x < 76 && (x < 22 || x > 58) && !this.raining) {
      this.x.fillStyle = this.theme === 'day' ? 'rgba(10,143,184,0.16)' : 'rgba(91,231,255,0.13)';
      this.x.beginPath(); this.x.moveTo(x + 1, y + 2); this.x.lineTo(x - 7, 42); this.x.lineTo(x + 9, 42); this.x.closePath(); this.x.fill();
    }
    this.px(x - 3, y, '#3d8bff', 3, 1); this.px(x + 2, y, '#3d8bff', 3, 1);
    this.px(x, y - 1, '#d6deeb', 2, 3); this.px(x, y + 2, '#8792a8');
    if (Math.floor(t / 400) % 2) this.px(x + 1, y - 2, '#ff5d6c');
  };

  PixelAvatar.prototype.drawLand = function (t) {
    const day = this.theme === 'day';
    for (let x = 0; x < BW; x++) {
      const h = Math.round(3 + Math.sin(x * 0.17) * 2 + Math.sin(x * 0.05 + 1) * 2);
      this.px(x, 40 - h, day ? '#6fae8a' : '#16213f', 1, h + 2);
    }
    this.px(0, 41, day ? '#4c8f63' : '#101a33', BW, 15);
    this.level += ((this.raining ? 6 : 0) - this.level) * 0.004;
    const top = 45 - Math.round(this.level), bottom = 50;
    const hi = day ? '#bff3ff' : '#5be7ff';
    this.px(0, top, day ? '#2f7fc1' : '#1b4f86', BW, bottom - top + 1);
    this.px(0, bottom + 1, day ? '#3d7a52' : '#0c1428', BW, 1);
    for (let i = 0; i < 9; i++) {
      const x = Math.round((i * 11 + t * 0.012 * (1 + (i % 3) * 0.4)) % (BW + 6)) - 3;
      this.px(x, top + 1 + (i % Math.max(1, bottom - top)), hi, 2 + (i % 2), 1);
    }
  };

  PixelAvatar.prototype.drawRain = function () {
    if (this.raining && this.drops.length < 70) for (let i = 0; i < 3; i++) this.drops.push({ x: Math.random() * (BW + 20), y: 6 - Math.random() * 10, v: 1.4 + Math.random() * 0.8 });
    const col = this.theme === 'day' ? '#e6f4ff' : '#7fb9ff';
    const water = 45 - Math.round(this.level);
    this.drops = this.drops.filter((d) => {
      d.y += d.v; d.x -= d.v * 0.35;
      if (d.y > water) { this.px(d.x - 1, water - 1, col); this.px(d.x + 1, water - 1, col); return false; }
      this.px(d.x, d.y, col, 1, 2);
      return true;
    });
    if (this.flash > 0) { this.x.fillStyle = 'rgba(255,255,255,' + (this.flash / 12) + ')'; this.x.fillRect(0, 0, BW, BH); this.flash--; }
  };

  // ------------------------------------------------------------------ portrait
  PixelAvatar.prototype.drawAvatar = function (t) {
    const now = performance.now();
    if (this.expr && now > this.expr.until) this.expr = null;
    if (!this.sleeping && !this.reading && now - this.lastActive > (this.mini ? 40000 : 25000)) { this.sleeping = true; this.expr = null; }
    const ex = this.sleeping ? 'sleep' : this.expr ? this.expr.name : this.reading ? 'read' : null;

    let bob = this.reduced ? 0 : (Math.sin(t / (this.sleeping ? 1300 : 700)) > 0.55 ? -1 : 0);
    if (now < this.hop) bob -= 2;
    // Head turns toward the cursor (eases one pixel at a time)
    let lookX = this.sleeping ? 0 : this.lookX;
    if (!this.sleeping && now - this.lastActive > 4000) lookX = Math.sin(t / 1800) > 0.6 ? 1 : (Math.sin(t / 1800) < -0.6 ? -1 : 0);
    if (ex === 'read') lookX = 0;
    if (Math.floor(t / 90) !== this._turnTick) { this._turnTick = Math.floor(t / 90); this.headX += Math.sign(lookX - this.headX); }
    const hx = this.reduced ? 0 : this.headX;

    const ox = this.AX, oy = this.AY + bob;
    this.x.drawImage(BODY, ox, oy);
    this.x.drawImage(HEAD, ox + hx, oy);
    const fx = ox + hx;          // face origin

    // Brows: lifted for surprise
    const lift = ex === 'surprised' || (ex === 'laugh');
    if (lift) BROWS.forEach(([a, b], i) => {
      this.px(fx + a, oy + 17, i ? PAL.L : PAL.S, b - a + 1, 1);
      this.px(fx + a + 1, oy + 15, PAL.B, b - a - 1, 1);
      this.px(fx + a, oy + 16, PAL.B, b - a + 1, 1);
    });

    // Eyes
    if (now > this.nextBlink) { this.blinkUntil = now + 130; this.nextBlink = now + 2200 + Math.random() * 3200; }
    const blink = now < this.blinkUntil;
    EYES.forEach((x0, i) => {
      const ex0 = fx + x0 + 1, ey = oy + 19;
      const closed = ex === 'sleep' || blink || (ex === 'wink' && i === 0) || ex === 'laugh';
      if (closed) {
        this.px(ex0, ey, i ? PAL.L : PAL.S, 4, 1);
        if (ex === 'laugh') { this.px(ex0, ey + 1, '#3a2418', 4, 1); this.px(ex0 + 1, ey, '#3a2418', 2, 1); } // happy ^ ^
        else this.px(ex0 - 1, ey + 1, '#3a2418', 6, 1);
        return;
      }
      const big = ex === 'surprised';
      this.px(ex0, ey, PAL.W, 4, 2);
      if (big) this.px(ex0, ey - 1, PAL.W, 4, 1);
      const p = ex === 'read' ? 1 : 1 + lookX;
      if (ex === 'read') {                                                        // lowered lids, eyes down
        this.px(ex0, ey, i ? PAL.L : PAL.S, 4, 1);
        this.px(ex0 + p, ey + 1, PAL.E, 2, 1);
        return;
      }
      this.px(ex0 + p, ey, PAL.E, 2, 2);
      this.px(ex0 + p, ey, '#f6efe6', 1, 1);                                      // catchlight
    });

    // Mouth
    const mx = fx + 24, my = oy + 28;
    if (ex === 'smile' || ex === 'wink') {
      this.px(mx + 1, my, '#f2e8de', 6, 1);              // teeth
      this.px(mx, my - 1, PAL.R, 1, 1); this.px(mx + 7, my - 1, PAL.R, 1, 1);
      this.px(mx + 1, my + 1, PAL.r, 6, 1);
    } else if (ex === 'laugh') {
      this.px(mx + 1, my, '#f2e8de', 6, 1);
      this.px(mx + 1, my + 1, '#2a110e', 6, 1);
      this.px(mx + 2, my + 2, '#2a110e', 4, 1);
    } else if (ex === 'surprised') {
      this.px(mx + 3, my, '#2a110e', 2, 2);
    } else if (this.talking && Math.floor(t / 110) % 2 === 0) {
      this.px(mx + 1, my + 1, '#2a110e', 6, 1);
    }

    if (this.shades) {
      const y = oy + 18;
      this.px(fx + 18, y, '#050506', 20, 1);
      this.px(fx + 19, y + 1, '#050506', 7, 3); this.px(fx + 30, y + 1, '#050506', 7, 3);
      this.px(fx + 20, y + 1, '#3e4a66', 2, 1); this.px(fx + 31, y + 1, '#3e4a66', 2, 1);
    }

    // Sleepy Zs drifting up
    if (ex === 'sleep' && !this.reduced) {
      if (!this._zt || now - this._zt > 1100) { this._zt = now; this.zs.push({ x: fx + 40, y: oy + 8, born: now }); }
      const zc = this.mini ? '#9fb3d9' : '#cfe3ff';
      this.zs = this.zs.filter((z) => {
        const a = (now - z.born) / 2600;
        if (a > 1) return false;
        const x = Math.round(z.x + a * 8), y = Math.round(z.y - a * 14);
        this.px(x, y, zc, 3, 1); this.px(x + 1, y + 1, zc, 1, 1); this.px(x, y + 2, zc, 3, 1);
        return true;
      });
    } else this.zs = [];
  };

  PixelAvatar.prototype.loop = function (now) {
    requestAnimationFrame(this.loop);
    if (document.hidden) return;
    if (now - this.lastFrame < 33) return; // ~30fps, retro feel
    this.lastFrame = now;
    const t = now - this.t0;
    const ctx = this.x;
    if (this.mini) {
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawAvatar(t);
      return;
    }
    ctx.setTransform(2, 0, 0, 2, 0, -16);
    this.drawSky(t); this.drawSatellite(t); this.drawLand(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawAvatar(t);
    ctx.setTransform(2, 0, 0, 2, 0, -16);
    this.drawRain();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  PixelAvatar.HEAD = HEAD;
  PixelAvatar.BODY = BODY;
  window.PixelAvatar = PixelAvatar;
})();
