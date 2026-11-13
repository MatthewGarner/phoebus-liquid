// A 2D canvas laid over the game for the juice: the leap trail and speed lines, dust puffs, treat sparkles, the little bonk star, the DROP streak.
// Particles live in world units; each frame the world -> screen map (the camera is orthographic: an affine map) is read once.
export function createFx(parent, rend) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block';
  parent.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const parts = [];       // { kind, x, y, vx, vy, t, life, size, rot, color }
  const trail = [];       // recent head positions { x, y, t } for the leap trail
  let trailOn = 0, streakT = 0, streakX = 0, streakY = 0;
  const A = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }; // screen = (a x + c y + e, b x + d y + f)

  const o0 = {}, o1 = {}, o2 = {};
  let mapVer = -1, dirty = false;
  function resize() { // (sizes come from the renderer's cached view: no layout reads in the frame loop; the soft particles do not need 2x)
    const v = rend.view, w = v.cssW || 1, h = v.cssH || 1;
    if (w === W && h === H) return;
    W = w; H = h; dpr = 1; cv.width = w; cv.height = h; mapVer = -1;
  }
  function readMap() { // the world -> screen map: recomputed only when the camera moved
    if (rend.view.ver === mapVer) return;
    mapVer = rend.view.ver;
    const o = rend.clientFromWorld(0, 0, 0, o0), px = rend.clientFromWorld(1, 0, 0, o1), py = rend.clientFromWorld(0, 1, 0, o2), r = rend.view.rect;
    A.e = o.x - r.left; A.f = o.y - r.top; A.a = px.x - o.x; A.b = px.y - o.y; A.c = py.x - o.x; A.d = py.y - o.y;
  }
  const sx = (x, y) => A.a * x + A.c * y + A.e, sy = (x, y) => A.b * x + A.d * y + A.f;
  const ppu = () => Math.hypot(A.c, A.d);

  const add = (p) => { if (parts.length < 200) parts.push(p); };
  function dust(x, y, strength = 0.5) {
    const n = 4 + Math.round(strength * 6);
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1, v = (1.2 + Math.random() * 2.4) * (0.5 + strength);
      add({ kind: 'dust', x: x + (Math.random() - 0.5) * 1.6, y: y + 0.15, vx: s * v, vy: 0.6 + Math.random() * 1.4, t: 0, life: 0.45 + Math.random() * 0.25, size: 0.3 + Math.random() * 0.3 * (0.5 + strength) });
    }
  }
  function sparkle(x, y) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283 + Math.random() * 0.5, v = 3 + Math.random() * 4;
      add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.5 + Math.random() * 0.2, size: 0.28 + Math.random() * 0.2, color: i % 2 ? '#FFE08A' : '#FFFFFF' });
    }
  }
  function bonk(x, y) { for (let i = 0; i < 3; i++) add({ kind: 'star', x: x + (Math.random() - 0.5) * 1.4, y: y + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, t: 0, life: 0.55, size: 0.45, rot: Math.random() * 6 }); }
  // stuffing and fluff puffing off a toy that is being kicked; and the arc streaks at the kicking feet
  function fluff(x, y, n = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = 2 + Math.random() * 4;
      add({ kind: 'fluff', x: x + Math.cos(a) * 1.1, y: y + Math.sin(a) * 1.1, vx: Math.cos(a) * v * 1.4, vy: Math.sin(a) * v * 1.4 + 1.5, t: 0, life: 0.5 + Math.random() * 0.4, size: 0.07 + Math.random() * 0.13, color: i % 3 ? '#FFF6E2' : '#F7C9D2' });
    }
  }
  function arc(x, y, dir = 1, rot = 0) { add({ kind: 'arc', x, y, vx: 0, vy: 0, t: 0, life: 0.2, size: 0.9 + Math.random() * 0.5, rot: rot + (Math.random() - 0.5) * 0.6, dir }); }
  // impact fx: radial lines at the contact point (a fan around the surface normal), dust that travels along the surface, a ring on heavy hits
  function impact(x, y, nx, ny, s, tanSign = 1, stars = false) {
    const tx = -ny, ty = nx, n = 5 + Math.round(s * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.4, ca = Math.cos(a), sa = Math.sin(a), dx = nx * ca - ny * sa, dy = ny * ca + nx * sa;
      add({ kind: 'line', x: x + dx * 0.4, y: y + dy * 0.4, vx: dx * (3 + 5 * s), vy: dy * (3 + 5 * s), t: 0, life: 0.16 + 0.08 * s, size: 0.5 + 0.9 * s, rot: Math.atan2(dy, dx) });
    }
    const m = 2 + Math.round(s * 4);
    for (let i = 0; i < m; i++) { const sg = i % 2 ? 1 : -1, v = (1.5 + Math.random() * 3.5) * (0.5 + s) * (sg === tanSign ? 1.3 : 1); add({ kind: 'dust', x: x + tx * sg * 0.3, y: y + ty * sg * 0.3 + 0.1, vx: tx * sg * v + nx * 0.6, vy: ty * sg * v * 0.3 + ny * (0.5 + Math.random()), t: 0, life: 0.4 + 0.3 * Math.random(), size: 0.22 + 0.28 * s * Math.random() }); }
    if (s > 0.6) add({ kind: 'ring', x, y, vx: 0, vy: 0, t: 0, life: 0.32, size: 1.2 + 2.2 * s, rot: Math.atan2(ny, nx) });
    if (stars) for (let i = 0; i < 3; i++) add({ kind: 'star', x: x + (Math.random() - 0.5) * 1.4, y: y + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5) * 3 + nx * 2, vy: 2 + Math.random() * 2, t: 0, life: 0.55, size: 0.45, rot: Math.random() * 6 });
  }
  function streak(x, y) { streakT = 0.28; streakX = x; streakY = y; }
  function startTrail() { trailOn = 0.42; trail.length = 0; }
  function clear() { parts.length = 0; trail.length = 0; trailOn = 0; streakT = 0; }

  function star(g, x, y, r, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = rot + (i * Math.PI) / 5; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath();
  }

  // head: where the leading edge of him is; air: is he flying; tNow: seconds
  function update(dt, head, air) {
    resize();
    if (!parts.length && trailOn <= 0 && !trail.length && streakT <= 0) { if (dirty) { ctx.clearRect(0, 0, W, H); dirty = false; } return; } // nothing to draw: do no work at all
    readMap(); dirty = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const U = ppu();
    // trail: speed lines behind him for the first 0.4 s of a leap
    if (trailOn > 0 && head) {
      trailOn -= dt; trail.push({ x: head.x, y: head.y, t: 0 });
    }
    for (let i = trail.length - 1; i >= 0; i--) { trail[i].t += dt; if (trail[i].t > 0.34) trail.splice(i, 1); }
    if (trail.length > 1) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const off of [0, -0.9, 0.9]) {
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) { const p = trail[i], k = off * (1 - p.t / 0.34); ctx.lineTo(sx(p.x, p.y + k), sy(p.x, p.y + k)); }
        ctx.strokeStyle = off === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = off === 0 ? 7 : 3.5;
        ctx.stroke();
      }
    }
    if (streakT > 0) { // the DROP streak: vertical lines above him
      streakT -= dt; const a = Math.max(0, streakT / 0.28);
      ctx.lineCap = 'round'; ctx.strokeStyle = `rgba(255,255,255,${0.75 * a})`; ctx.lineWidth = 3.5;
      for (const dx of [-0.9, -0.3, 0.3, 0.9]) { const x0 = streakX + dx, y0 = streakY + 0.8 + (1 - a) * 1.5; ctx.beginPath(); ctx.moveTo(sx(x0, y0), sy(x0, y0)); ctx.lineTo(sx(x0, y0 + 3.2 + dx * dx), sy(x0, y0 + 3.2 + dx * dx)); ctx.stroke(); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt; if (p.t >= p.life) { parts.splice(i, 1); continue; }
      const k = p.t / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'dust') { p.vx *= 0.96; p.vy -= 3 * dt; }
      else if (p.kind === 'fluff') { p.vx *= 0.97; p.vy -= 3.5 * dt; }
      else if (p.kind === 'arc') { /* in place */ }
      else if (p.kind === 'line') { p.vx *= 0.9; p.vy *= 0.9; }
      else if (p.kind === 'ring') { p.vx = p.vy = 0; }
      else { p.vy -= 9 * dt; }
      const X = sx(p.x, p.y), Y = sy(p.x, p.y), a = 1 - k;
      if (p.kind === 'dust') { ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`; ctx.beginPath(); ctx.arc(X, Y, U * p.size * (1 + 1.4 * k), 0, 7); ctx.fill(); }
      else if (p.kind === 'fluff') { ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, a * 1.6); ctx.beginPath(); ctx.arc(X, Y, U * p.size * (1 + 0.5 * k), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      else if (p.kind === 'line') { ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`; ctx.lineWidth = 3.2 * a + 1; ctx.lineCap = 'round'; const L = U * p.size * (0.4 + k), c = Math.cos(p.rot), sn = Math.sin(p.rot); ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + c * L, Y - sn * L); ctx.stroke(); }
      else if (p.kind === 'ring') { ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`; ctx.lineWidth = 4 * a + 1; ctx.beginPath(); ctx.ellipse(X, Y, U * p.size * (0.3 + 1.2 * k), U * p.size * (0.3 + 1.2 * k) * 0.35, 0, 0, 7); ctx.stroke(); }
      else if (p.kind === 'arc') { ctx.strokeStyle = `rgba(255,255,255,${0.9 * a})`; ctx.lineWidth = 4 * a + 1.5; ctx.lineCap = 'round'; const r0 = U * p.size * (0.7 + 0.5 * k), c = p.rot, w = 1.0 * p.dir; ctx.beginPath(); ctx.arc(X, Y, r0, c - w, c + w); ctx.stroke(); }
      else if (p.kind === 'spark') { ctx.fillStyle = p.color; ctx.globalAlpha = a; star(ctx, X, Y, U * p.size * (1 - 0.4 * k), p.t * 6); ctx.fill(); ctx.globalAlpha = 1; }
      else if (p.kind === 'star') { ctx.fillStyle = '#FFD25A'; ctx.strokeStyle = '#C98A14'; ctx.lineWidth = 2; ctx.globalAlpha = a; star(ctx, X, Y, U * p.size, p.rot + p.t * 4); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1; }
    }
  }
  const busy = () => parts.length > 0 || trailOn > 0 || trail.length > 0 || streakT > 0;
  return { impact, busy, fluff, arc, dust, sparkle, bonk, streak, startTrail, clear, update, resize, canvas: cv };
}
