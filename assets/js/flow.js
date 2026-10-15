/* Background "streamlines" — particles advected through a smooth flow field,
   drifting like a river. The cursor makes a small vortex. */
(function () {
  'use strict';
  const c = document.getElementById('flow');
  if (!c) return;
  const ctx = c.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, parts = [], t = 0, rgb = '91,231,255';
  const mouse = { x: -9999, y: -9999 };

  function readColor() {
    rgb = getComputedStyle(document.documentElement).getPropertyValue('--flow').trim() || rgb;
  }
  function spawn(p) {
    p.x = Math.random() * w; p.y = Math.random() * h;
    p.life = 120 + Math.random() * 220; p.age = 0;
    return p;
  }
  function resize() {
    w = c.width = innerWidth; h = c.height = innerHeight;
    const n = Math.min(380, Math.floor((w * h) / 5000));
    parts = Array.from({ length: n }, () => spawn({}));
  }
  function angle(x, y) {
    const s = 0.0018;
    return Math.sin(x * s * 1.1 + t * 0.0003) * 0.9 +
           Math.cos(y * s * 1.6 - t * 0.0002) * 0.8 +
           Math.sin((x - y) * s * 0.5) * 0.6;
  }
  function frame() {
    if (!document.hidden && !document.body.classList.contains('no-flow')) {
      t += 16;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1;
      for (const p of parts) {
        const a = angle(p.x, p.y);
        let vx = Math.cos(a) * 0.9 + 0.7;
        let vy = Math.sin(a) * 0.9;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 26000) {
          const f = (1 - d2 / 26000) * 2.4;
          vx += (-dy / 160) * f; vy += (dx / 160) * f;
        }
        const nx = p.x + vx, ny = p.y + vy;
        const alpha = Math.sin((p.age / p.life) * Math.PI) * 0.28;
        ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
        p.x = nx; p.y = ny; p.age++;
        if (p.age > p.life || p.x > w + 5 || p.x < -5 || p.y < -5 || p.y > h + 5) spawn(p);
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
  new MutationObserver(readColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  readColor(); resize();
  if (reduce) { for (let i = 0; i < 160; i++) frame(); } else requestAnimationFrame(frame);
})();
