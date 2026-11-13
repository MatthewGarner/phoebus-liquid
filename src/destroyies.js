// DESTROYIES: the bonus round. One opaque 2D canvas over the game (nothing is stacked or blended full-screen): a pre-rendered starfield blitted twice for
// a slow scroll, a giant Phoebus (his face canvas drawn big over a coat-coloured head), two laser beams from his eyes to the finger, and drifting planets
// (pre-rendered sprites). A beam held on a planet cracks it, then pops it. Everything is pooled, nothing allocates per frame.
const DURATION = 10, MORPH = 1.9, INTRO = 0.7, OUTRO = 2.6, MAX_PL = 8, MAX_CH = 96, MAX_TXT = 6, MAX_RING = 8;
const HOLD_CRACK = 0.12, HOLD_POP = 0.3, COMBO_WINDOW = 1.3;
const COMBO_TEXT = ['', 'Double!', 'Triple!', 'Quad!', 'Planet-pocalypse!'];
const KINDS = ['ringed', 'striped', 'cratered', 'flag', 'cucumber'];
const CHUNK_COL = { ringed: '#6FB0D0', striped: '#D4613F', cratered: '#A0A3B0', flag: '#6BBF6E', cucumber: '#5FA94A', home: '#8FB8C8' };
const FACE_PX = 384, FACE_HEAD_PX = 96, EYE_DX = 40.8, EYE_DY = 12; // the face canvas: head radius and eye offsets, in canvas px

function planetSprite(kind) {
  const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'); g.translate(S / 2, S / 2); g.lineJoin = 'round'; g.lineCap = 'round';
  const R = kind === 'flag' ? 40 : kind === 'cucumber' ? 60 : 56;
  const ball = (c0, c1, r = R) => { const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); };
  const rim = (c, w = 4) => { g.strokeStyle = c; g.lineWidth = w; g.stroke(); };
  if (kind === 'ringed') {
    g.save(); g.rotate(-0.35); g.strokeStyle = '#E9C987'; g.lineWidth = 9; g.beginPath(); g.ellipse(0, 0, R * 1.45, R * 0.42, 0, Math.PI, Math.PI * 2); g.stroke(); g.restore();
    ball('#9FD3E8', '#3F7FA8'); g.beginPath(); g.arc(0, 0, R, 0, 7); rim('#25506E');
    g.save(); g.rotate(-0.35); g.strokeStyle = '#F4DDA4'; g.lineWidth = 9; g.beginPath(); g.ellipse(0, 0, R * 1.45, R * 0.42, 0, 0, Math.PI); g.stroke(); g.strokeStyle = '#B98F4A'; g.lineWidth = 2; g.stroke(); g.restore();
  } else if (kind === 'striped') {
    ball('#F4B08A', '#D4613F'); g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
    for (const [y, h, c] of [[-34, 14, '#FFE1B8'], [-8, 20, '#B5472E'], [24, 14, '#FFE1B8'], [42, 16, '#B5472E']]) { g.fillStyle = c; g.globalAlpha = 0.75; g.fillRect(-R, y, R * 2, h); }
    g.restore(); g.beginPath(); g.arc(0, 0, R, 0, 7); rim('#7A2D1C');
  } else if (kind === 'cratered') {
    ball('#C9CBD3', '#7D8190'); g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
    for (const [x, y, r] of [[-20, -18, 14], [22, 10, 17], [-8, 28, 10], [30, -30, 8], [-36, 14, 8]]) { g.fillStyle = 'rgba(70,74,88,0.55)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(x - 1, y - 1, r, 3.4, 5.6); g.stroke(); }
    g.restore(); g.beginPath(); g.arc(0, 0, R, 0, 7); rim('#4B4F5E');
  } else if (kind === 'flag') {
    ball('#B7E39A', '#4E9E54'); g.beginPath(); g.arc(0, 0, R, 0, 7); rim('#2E6A35');
    g.strokeStyle = '#5A4632'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -R + 4); g.lineTo(0, -R - 34); g.stroke();
    g.fillStyle = '#E8483B'; g.strokeStyle = '#8E1F18'; g.lineWidth = 3; g.beginPath(); g.moveTo(1, -R - 34); g.lineTo(26, -R - 26); g.lineTo(1, -R - 18); g.closePath(); g.fill(); g.stroke();
  } else { // the cucumber planet
    g.rotate(-0.5);
    g.beginPath(); g.roundRect(-R, -R * 0.52, R * 2, R * 1.04, R * 0.5); const gr = g.createLinearGradient(0, -R * 0.5, 0, R * 0.5); gr.addColorStop(0, '#8FD072'); gr.addColorStop(1, '#3E8A3A'); g.fillStyle = gr; g.fill(); rim('#24602A');
    g.fillStyle = '#3F8A36'; for (const [x, y] of [[-34, 8], [-14, -12], [8, 12], [28, -8], [40, 10], [-4, 24]]) { g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.roundRect(-R * 0.8, -R * 0.38, R * 1.2, R * 0.16, 8); g.fill();
  }
  return { cv, R };
}

function starfield(W, H) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#171538'); gr.addColorStop(0.5, '#0A0B22'); gr.addColorStop(1, '#171538'); // (the same at both ends: it scrolls without a seam)
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const nb = g.createRadialGradient(W * 0.3, H * 0.3, 10, W * 0.3, H * 0.3, W * 0.8); nb.addColorStop(0, 'rgba(120,70,200,0.28)'); nb.addColorStop(1, 'rgba(120,70,200,0)'); g.fillStyle = nb; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 140; i++) { const r = rnd() < 0.1 ? 1.8 : 1; g.fillStyle = `rgba(255,255,${200 + (rnd() * 55) | 0},${0.35 + rnd() * 0.6})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, 7); g.fill(); }
  return cv;
}


// a soft flare sprite for the eyes and the beam ends (drawn additively; built once)
function flareSprite() {
  const S = 96, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,170,150,0.85)'); gr.addColorStop(0.5, 'rgba(255,60,80,0.35)'); gr.addColorStop(1, 'rgba(255,60,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return cv;
}
// the little home planet: the room he just left, squeezed into a ball
function homeSprite(shot) {
  const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), R = 56;
  g.translate(S / 2, S / 2); g.beginPath(); g.arc(0, 0, R, 0, 7); g.save(); g.clip();
  if (shot) { const k = (R * 2) / Math.min(shot.width, shot.height) * 1.5; g.drawImage(shot, -shot.width * k / 2, -shot.height * k / 2, shot.width * k, shot.height * k); } else { g.fillStyle = '#8FC8D8'; g.fillRect(-R, -R, R * 2, R * 2); }
  const sh = g.createRadialGradient(-R * 0.4, -R * 0.45, R * 0.1, 0, 0, R * 1.1); sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.6, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(10,20,60,0.6)'); g.fillStyle = sh; g.fillRect(-R, -R, R * 2, R * 2); g.restore();
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.strokeStyle = '#2A4A7A'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = 'rgba(160,220,255,0.55)'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, R + 4, 0, 7); g.stroke(); // a thin atmosphere
  return { cv, R };
}
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const ease = (t) => t * t * (3 - 2 * t);
const sc = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function createDestroyies({ parent, face, audio, onFinish, getBest, setBest, tick }) {
  const root = document.createElement('div'); root.className = 'dz'; root.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas'); root.appendChild(canvas); parent.appendChild(root);
  const ctx = canvas.getContext('2d', { alpha: false });
  const sprites = {}; for (const k of KINDS) sprites[k] = planetSprite(k);
  const flare = flareSprite();
  let W = 0, H = 0, dpr = 1, stars = null;
  const pl = Array.from({ length: MAX_PL }, () => ({ on: false, kind: 'ringed', x: 0, y: 0, vx: 0, vy: 0, r: 0, rot: 0, vr: 0, heat: 0 }));
  const ch = Array.from({ length: MAX_CH }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, kind: 'ringed', rot: 0, vr: 0, spark: false }));
  const rings = Array.from({ length: MAX_RING }, () => ({ on: false, x: 0, y: 0, r: 0, t: 0, flash: false }));
  const tx = Array.from({ length: MAX_TXT }, () => ({ on: false, t: 0, x: 0, y: 0, s: '', big: 1 }));
  const S = { on: false, phase: 'off', t: 0, score: 0, count: 0, combo: 0, comboT: 0, spawnT: 0, shake: 0, scroll: 0, best: 0, newBest: false, seed: 1, touched: false };
  const finger = { down: false, x: 0, y: 0, sx: 0, sy: 0, id: -1 };
  const eye = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  const geo = { cx: 0, cy: 0, R: 0 };   // the final giant head
  let shot = null, src = { hx: 0, hy: 0, hr: 40, cx: 0, cy: 0, col: '#C9764A' }, home = null, last = 0, raf = 0, morphChunks = false;
  const rand = () => { S.seed = (S.seed * 1664525 + 1013904223) >>> 0; return S.seed / 4294967296; };

  function resize() {
    const r = parent.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === W && h === H && stars) return;
    W = w; H = h; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    stars = starfield(Math.round(W * dpr), Math.round(H * dpr));
  }
  function layout() { geo.R = Math.min(W * 0.31, H * 0.17); geo.cx = W / 2; geo.cy = H - geo.R * 2.15; }

  const addText = (s, x, y, big = 1) => { for (const t of tx) if (!t.on) { t.on = true; t.t = 0; t.x = x; t.y = y; t.s = s; t.big = big; return; } };
  const addRing = (x, y, r, flash) => { for (const g of rings) if (!g.on) { g.on = true; g.x = x; g.y = y; g.r = r; g.t = 0; g.flash = flash; return; } };
  const addChunk = (x, y, vx, vy, life, size, kind, spark) => { for (const c of ch) if (!c.on) { c.on = true; c.x = x; c.y = y; c.vx = vx; c.vy = vy; c.life = life; c.size = size; c.kind = kind; c.spark = spark; c.rot = rand() * 6; c.vr = (rand() - 0.5) * 14; return; } };
  function spawn() {
    for (const p of pl) {
      if (p.on) continue;
      p.on = true; p.kind = KINDS[(rand() * KINDS.length) | 0]; p.heat = 0;
      p.r = (p.kind === 'flag' ? 0.07 : 0.1 + rand() * 0.05) * Math.min(W, H * 0.7) * 1.25;
      const side = rand() < 0.5 ? -1 : 1, fromSide = rand() < 0.35;
      p.x = fromSide ? (side < 0 ? -p.r : W + p.r) : W * (0.12 + rand() * 0.76);
      p.y = fromSide ? H * (0.1 + rand() * 0.25) : -p.r;
      const sp = (90 + rand() * 70) * (1 + S.t * 0.02);
      p.vx = fromSide ? -side * sp : (rand() - 0.5) * 50; p.vy = fromSide ? sp * 0.25 : sp * 0.8; p.rot = rand() * 6; p.vr = (rand() - 0.5) * 1.2;
      return;
    }
  }
  function pop(p) {
    S.count++; S.combo = S.comboT > 0 ? S.combo + 1 : 0; S.comboT = COMBO_WINDOW;
    const pts = 100 * (1 + S.combo); S.score += pts;
    const n = 8 + ((rand() * 5) | 0);
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rand() * 0.6, v = 120 + rand() * 260; addChunk(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, 0.8 + rand() * 0.5, (0.12 + rand() * 0.2) * p.r, p.kind, false); }
    addRing(p.x, p.y, p.r, false); addRing(p.x, p.y, p.r * 0.6, true); // a flash on the planet itself and a ring that expands
    S.shake = 9; audio.boom(S.combo); audio.haptic(S.combo ? [10, 20, 14] : 14);
    addText('+1', p.x, p.y - p.r * 0.5, 0.9); if (S.combo > 0) addText(COMBO_TEXT[Math.min(S.combo, COMBO_TEXT.length - 1)], W / 2, H * 0.3, 1.3);
    p.on = false;
  }

  function morphUpdate(dt) {
    if (S.t > 0.22 && !morphChunks) { morphChunks = true; // the container pops off
      for (let i = 0; i < 14; i++) { const a = -0.3 - rand() * 2.5, v = 220 + rand() * 360; addChunk(src.cx, src.cy, Math.cos(a) * v, Math.sin(a) * v - 120, 1.2, 7 + rand() * 12, 'cont', false); }
      audio.boom(2);
    }
    if (S.t > MORPH) { S.phase = 'intro'; S.t = 0; spawnHome(); audio.sting(); }
  }
  function spawnHome() {
    home = homeSprite(shot);
    const p = pl[0]; p.on = true; p.kind = 'home'; p.heat = 0; p.r = geo.R * 0.3; p.x = Math.min(W - p.r - 4, geo.cx + geo.R * 1.3); p.y = geo.cy + geo.R * 1.05; p.vx = 0; p.vy = 0; p.rot = 0; p.vr = 0.15;
    sprites.home = { cv: home.cv, R: home.R };
  }

  function update(dt) {
    S.t += dt; S.scroll = (S.scroll + dt * 14) % H;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 40); if (S.comboT > 0) S.comboT -= dt;
    if (finger.down) { const k = 1 - Math.exp(-26 * dt); finger.sx += (finger.x - finger.sx) * k; finger.sy += (finger.y - finger.sy) * k; }
    let beamHit = false;
    if (S.phase === 'morph') morphUpdate(dt);
    else if (S.phase === 'intro' && S.t > INTRO) { S.phase = 'play'; S.t = INTRO; S.spawnT = 0.5; }
    else if (S.phase === 'play') {
      S.spawnT -= dt; if (S.spawnT <= 0) { spawn(); S.spawnT = 0.7 + rand() * 0.5; }
      if (S.t > INTRO + DURATION) { S.phase = 'outro'; S.t = 0; S.newBest = S.score > S.best; if (S.newBest) { S.best = S.score; setBest(S.score); } audio.laser(false); audio.sting(); }
    } else if (S.phase === 'outro' && S.t > OUTRO) { finish(); return; }
    const aiming = S.phase === 'play' && finger.down;
    for (const p of pl) {
      if (!p.on) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind === 'home' && S.phase === 'play' && S.t > INTRO + 4) { p.vx += 30 * dt; p.vy -= 20 * dt; } // (it drifts off if nobody burns it)
      if (p.y > H + p.r * 2 || p.x < -p.r * 3 || p.x > W + p.r * 3 || p.y < -p.r * 3) { p.on = false; continue; }
      if (aiming) {
        const dx = finger.sx - p.x, dy = finger.sy - p.y;
        if (dx * dx + dy * dy < p.r * p.r * 1.15) {
          if (p.heat < HOLD_CRACK && p.heat + dt >= HOLD_CRACK) audio.crack();
          p.heat += dt; beamHit = true;
          if (rand() < 0.7) { const a = rand() * 6.283, v = 80 + rand() * 160; addChunk(finger.sx, finger.sy, Math.cos(a) * v, Math.sin(a) * v, 0.25, 2 + rand() * 2.5, 'spark', true); } // impact sparks
          if (p.heat >= HOLD_POP) pop(p);
        } else p.heat = Math.max(0, p.heat - dt * 1.5);
      } else p.heat = Math.max(0, p.heat - dt * 1.5);
    }
    audio.laser(aiming); if (aiming) audio.laserPitch(beamHit ? 1 : 0.2);
    for (const c of ch) if (c.on) { c.life -= dt; if (c.life <= 0) { c.on = false; continue; } c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.985; c.vy *= 0.985; c.rot += c.vr * dt; if (c.kind === 'cont') c.vy += 500 * dt; }
    for (const g of rings) if (g.on) { g.t += dt; if (g.t > 0.4) g.on = false; }
    for (const t of tx) if (t.on) { t.t += dt; if (t.t > 1.1) t.on = false; }
  }

  // the giant Phoebus: head, shoulders, both front paws; a slow menacing sway
  function drawGiant(cx, cy, R, sway) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(sway); ctx.translate(-cx, -cy);
    ctx.fillStyle = '#24222B';
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 1.45, R * 1.75, R * 1.0, 0, 0, 7); ctx.fill();                      // shoulders
    for (const sg of [-1, 1]) { // front legs and mittens
      ctx.fillStyle = '#24222B'; ctx.beginPath(); ctx.roundRect(cx + sg * R * 1.0 - R * 0.28, cy + R * 0.9, R * 0.56, R * 1.1, R * 0.25); ctx.fill();
      ctx.fillStyle = '#F6F1E7'; ctx.strokeStyle = '#B9B2A4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx + sg * R * 1.0, cy + R * 1.78, R * 0.42, R * 0.28, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#C8C0B0'; ctx.lineWidth = 2; for (const o of [-0.16, 0, 0.16]) { ctx.beginPath(); ctx.moveTo(cx + sg * R + o * R, cy + R * 1.7); ctx.lineTo(cx + sg * R + o * R, cy + R * 1.9); ctx.stroke(); }
    }
    ctx.fillStyle = '#24222B'; ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.2, R * 1.05, R * 1.0, 0, 0, 7); ctx.fill(); // head
    const fk = R / FACE_HEAD_PX, fs = FACE_PX * fk;
    ctx.drawImage(face, cx - fs / 2, cy - fs / 2, fs, fs);
    ctx.restore();
    for (let i = 0; i < 2; i++) { const sg = i ? 1 : -1, ex = sg * EYE_DX * fk, ey = -EYE_DY * fk, c = Math.cos(sway), s2 = Math.sin(sway); eye[i].x = cx + ex * c - ey * s2; eye[i].y = cy + ex * s2 + ey * c; }
  }
  const drawStars = (ox, oy, zoom) => {
    if (zoom === 1) { ctx.drawImage(stars, ox, S.scroll + oy, W, H); ctx.drawImage(stars, ox, S.scroll - H + oy, W, H); }
    else { const w = W * zoom, h = H * zoom; ctx.drawImage(stars, W / 2 - w / 2 + ox, H / 2 - h / 2 + oy, w, h); }
  };

  function drawChunks() {
    for (const c of ch) {
      if (!c.on) continue; ctx.globalAlpha = Math.min(1, c.life * 2.2);
      if (c.spark) { ctx.fillStyle = '#FFF6C8'; ctx.beginPath(); ctx.arc(c.x, c.y, c.size, 0, 7); ctx.fill(); continue; }
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.kind === 'cont' ? src.col : CHUNK_COL[c.kind]; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
      const z = Math.max(3, c.size); ctx.beginPath(); ctx.moveTo(-z, -z * 0.6); ctx.lineTo(z * 0.9, -z); ctx.lineTo(z, z * 0.5); ctx.lineTo(-z * 0.3, z); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawMorph() {
    const T = S.t, sh = (T < 1.1 ? 2 + 10 * (T / 1.1) : 4) * (Math.random() - 0.5);
    const cxs = src.hx, cys = src.hy, fillR = Math.max(W, H) * 0.9;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (T < 1.15) {
      ctx.fillStyle = '#9db9b4'; ctx.fillRect(0, 0, W, H);
      if (shot) ctx.drawImage(shot, sh, sh * 0.6, W, H);
      // he inflates: out of the container, then until he fills the room
      const u = T < 0.55 ? easeIn(T / 0.55) * 0.35 : 0.35 + 0.65 * easeIn(sc((T - 0.55) / 0.6));
      const R = src.hr * (1 + (fillR / src.hr - 1) * u * u * 0.95 + 0.6 * u), cx = cxs + (W / 2 - cxs) * u, cy = cys + (H * 0.55 - cys) * u;
      if (T > 0.5) { // the room cracks
        const k = sc((T - 0.5) / 0.55); ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3; ctx.beginPath();
        for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3, l = k * Math.max(W, H) * 0.7; ctx.moveTo(cx, cy); let x = cx, y = cy; for (let s2 = 1; s2 <= 5; s2++) { const aa = a + Math.sin(i * 7 + s2 * 3) * 0.35; x += Math.cos(aa) * l / 5; y += Math.sin(aa) * l / 5; ctx.lineTo(x, y); } }
        ctx.stroke(); ctx.strokeStyle = 'rgba(20,20,40,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      drawGiant(cx, cy - R * 0.0, R, 0); drawChunks();
    } else { // the room falls away and the camera rushes back: house -> a tiny planet beside him -> space
      const e = ease(sc((T - 1.15) / (MORPH - 1.15))), zoom = 3.2 - 2.2 * easeOut(sc((T - 1.15) / (MORPH - 1.15)));
      ctx.fillStyle = '#0A0B22'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = sc((T - 1.15) / 0.4); drawStars(0, 0, zoom); ctx.globalAlpha = 1;
      // the room shrinks into the home planet
      const hp = pl[0], pr = geo.R * 0.3, tx0 = Math.min(W - pr - 4, geo.cx + geo.R * 1.3), ty0 = geo.cy + geo.R * 1.05;
      const rr = (Math.max(W, H) * 0.75) * (1 - e) + pr * e, hx = W / 2 + (tx0 - W / 2) * e, hy = H * 0.5 + (ty0 - H * 0.5) * e + (1 - e) * H * 0.12 * e * 3;
      ctx.save(); ctx.beginPath(); ctx.arc(hx, hy, rr, 0, 7); ctx.clip(); const k2 = (rr * 2) / Math.min(W, H) * 1.5; if (shot) ctx.drawImage(shot, hx - W * k2 / 2, hy - H * k2 / 2, W * k2, H * k2); ctx.restore();
      ctx.strokeStyle = `rgba(160,220,255,${0.4 + 0.5 * e})`; ctx.lineWidth = 3 + 4 * e; ctx.beginPath(); ctx.arc(hx, hy, rr, 0, 7); ctx.stroke();
      const R = (fillR + (geo.R - fillR) * e), cx = W / 2 + (geo.cx - W / 2) * e, cy = H * 0.55 + (geo.cy - H * 0.55) * e;
      drawGiant(cx, cy, Math.max(geo.R, R), 0);
    }
  }

  function draw() {
    const T = S.t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.phase === 'morph') { drawMorph(); drawHud(); return; }
    const sh = S.shake, ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.globalAlpha = 1; drawStars(ox, oy, 1);
    ctx.save(); ctx.translate(ox, oy);
    for (const p of pl) {
      if (!p.on) continue;
      const sp = sprites[p.kind], k = p.r / sp.R, sz = 160 * k, hot = p.heat / HOLD_POP, j = hot > 0 ? (Math.random() - 0.5) * hot * 6 : 0;
      ctx.save(); ctx.translate(p.x + j, p.y + j); ctx.rotate(p.kind === 'flag' ? 0 : p.rot); ctx.drawImage(sp.cv, -sz / 2, -sz / 2, sz, sz);
      if (hot > 0.15) { ctx.globalAlpha = Math.min(0.6, hot * 0.7); ctx.fillStyle = '#FFE3B0'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } // heating up
      if (p.heat > HOLD_CRACK) { ctx.rotate(p.kind === 'flag' ? 0 : -p.rot); ctx.strokeStyle = '#FFF3B0'; ctx.lineWidth = 2.5; ctx.beginPath(); const n = 3 + ((hot * 6) | 0); for (let i = 0; i < n; i++) { const a = i * 2.1 + 0.4; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * p.r * 0.5, Math.sin(a) * p.r * 0.5); ctx.lineTo(Math.cos(a + 0.35) * p.r * 0.95, Math.sin(a + 0.35) * p.r * 0.95); } ctx.stroke(); }
      ctx.restore();
    }
    drawChunks();
    ctx.globalAlpha = 1;
    for (const g of rings) { if (!g.on) continue; const k = g.t / 0.4; if (g.flash) { ctx.globalAlpha = (1 - k) * 0.9; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (1 + 0.2 * k), 0, 7); ctx.fill(); } else { ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#FFF1C2'; ctx.lineWidth = 8 * (1 - k) + 1; ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (0.6 + 1.7 * easeOut(k)), 0, 7); ctx.stroke(); } }
    ctx.globalAlpha = 1;
    // Phoebus: huge; he swells a touch in the intro and sways slowly
    const grow = S.phase === 'outro' ? 1 - 0.55 * easeOut(sc((T - 1.1) / 1.2)) : 1, R = geo.R * grow, sway = Math.sin(performance.now() / 1000 * 1.1 + 0.3) * 0.025 * (S.phase === 'outro' ? 0 : 1);
    const cx = geo.cx + Math.sin(performance.now() / 1000 * 0.8) * 6, cy = geo.cy + (S.phase === 'outro' ? easeOut(sc((T - 1.1) / 1.2)) * H * 0.22 : 0) + (S.phase === 'intro' ? (1 - easeOut(sc(T / 0.5))) * 40 : 0);
    drawGiant(cx, cy, R, sway);
    if (S.phase === 'play' || S.phase === 'intro') { // eyes: a flare on each, and a pulse
      ctx.globalCompositeOperation = 'lighter';
      for (const e of eye) { const fz = R * (0.55 + 0.08 * Math.sin(T * 30)); ctx.drawImage(flare, e.x - fz, e.y - fz, fz * 2, fz * 2); }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (S.phase === 'play' && finger.down) {
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const flick = 0.85 + 0.15 * Math.sin(T * 60 + i * 2);
        ctx.strokeStyle = `rgba(255,40,80,${0.32 * flick})`; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(eye[i].x, eye[i].y); ctx.lineTo(finger.sx, finger.sy); ctx.stroke();   // coloured glow
        ctx.strokeStyle = `rgba(255,120,100,${0.85 * flick})`; ctx.lineWidth = 8; ctx.stroke();                                                                                         // body of the beam
        ctx.strokeStyle = 'rgba(255,255,245,1)'; ctx.lineWidth = 3; ctx.stroke();                                                                                                         // hot white core
      }
      const fz = 34 + 8 * Math.sin(T * 40); ctx.drawImage(flare, finger.sx - fz, finger.sy - fz, fz * 2, fz * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    drawHud();
  }
  function drawHud() {
    const T = S.t; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 28px Fredoka, system-ui, sans-serif'; ctx.lineJoin = 'round';
    if (S.phase === 'play' || S.phase === 'intro') {
      ctx.fillText(String(S.score), W / 2, 54); ctx.font = '600 13px Fredoka, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(`${S.count} planets`, W / 2, 74);
      const left = sc((INTRO + DURATION - T) / DURATION); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(W * 0.2, 90, W * 0.6, 6); ctx.fillStyle = '#FF6F7A'; ctx.fillRect(W * 0.2, 90, W * 0.6 * left, 6);
      if (S.phase === 'play' && T < INTRO + 2.4 && !S.touched) { ctx.font = '600 16px Fredoka, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('Drag a finger. Burn the planets.', W / 2, H * 0.28); }
    }
    if (S.phase === 'intro' || (S.phase === 'morph' && S.t > 1.5)) { const a = S.phase === 'intro' ? Math.sin(Math.PI * sc(T / INTRO)) : sc((S.t - 1.5) / 0.3); ctx.globalAlpha = a; ctx.font = '700 46px Fredoka, system-ui, sans-serif'; ctx.fillStyle = '#FFE066'; ctx.strokeStyle = '#7A1F2B'; ctx.lineWidth = 7; ctx.strokeText('Destroyies', W / 2, H * 0.22); ctx.fillText('Destroyies', W / 2, H * 0.22); ctx.globalAlpha = 1; }
    for (const t of tx) { if (!t.on) continue; ctx.globalAlpha = 1 - sc((t.t - 0.6) / 0.5); ctx.font = `700 ${Math.round(26 * t.big)}px Fredoka, system-ui, sans-serif`; ctx.fillStyle = '#FFE066'; ctx.strokeStyle = '#7A1F2B'; ctx.lineWidth = 5; const y = t.y - t.t * 40; ctx.strokeText(t.s, t.x, y); ctx.fillText(t.s, t.x, y); }
    ctx.globalAlpha = 1;
    if (S.phase === 'outro') {
      ctx.globalAlpha = easeOut(sc(T / 0.5)); ctx.fillStyle = '#fff'; ctx.font = '700 34px Fredoka, system-ui, sans-serif'; ctx.fillText(`${S.count} planets destroyed`, W / 2, H * 0.3);
      ctx.font = '600 20px Fredoka, system-ui, sans-serif'; ctx.fillStyle = '#FFE066'; ctx.fillText(`Score ${S.score}`, W / 2, H * 0.3 + 38);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 15px Fredoka, system-ui, sans-serif'; ctx.fillText(S.newBest ? 'New best!' : `Best ${S.best}`, W / 2, H * 0.3 + 64); ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    if (!S.on) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (dt <= 0) return;
    step(dt);
  }
  function step(dt) { if (tick) tick(dt); update(dt); if (S.on) draw(); }
  function finish() { S.on = false; S.phase = 'off'; cancelAnimationFrame(raf); audio.laser(false); root.classList.remove('on'); onFinish({ score: S.score, count: S.count, best: S.best, newBest: S.newBest }); }

  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { if (finger.down) return; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } const [x, y] = pt(e); finger.down = true; finger.id = e.pointerId; finger.x = finger.sx = x; finger.y = finger.sy = y; S.touched = true; audio.unlock(); });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerId !== finger.id) return; const [x, y] = pt(e); finger.x = x; finger.y = y; });
  const up = (e) => { if (e.pointerId === finger.id) { finger.down = false; finger.id = -1; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);

  return {
    get active() { return S.on; },
    state: S,
    // opts: { seed, shot: a canvas holding the room as it looked, head: { x, y, r } (screen px), cont: { x, y, color } }
    start(opts = {}) {
      resize(); layout(); shot = opts.shot || null;
      src = { hx: opts.head ? opts.head.x : W / 2, hy: opts.head ? opts.head.y : H * 0.7, hr: opts.head ? opts.head.r : 40, cx: opts.cont ? opts.cont.x : W / 2, cy: opts.cont ? opts.cont.y : H * 0.8, col: opts.cont ? opts.cont.color : '#C9764A' };
      Object.assign(S, { on: true, phase: shot ? 'morph' : 'intro', t: 0, score: 0, count: 0, combo: 0, comboT: 0, spawnT: 0, shake: 0, best: getBest(), newBest: false, seed: (opts.seed | 0) >>> 0 || 1, touched: false });
      morphChunks = false;
      for (const p of pl) p.on = false; for (const c of ch) c.on = false; for (const t of tx) t.on = false; for (const g of rings) g.on = false;
      if (!shot) spawnHome();
      finger.down = false; finger.id = -1; root.classList.add('on'); audio.haptic([20, 40, 20, 60]);
      last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); step(0.0001);
    },
    // test hooks: advance by hand, hold the beam at a point, read what is on screen
    step,
    beamAt(x, y) { finger.down = true; finger.x = finger.sx = x; finger.y = finger.sy = y; S.touched = true; },
    release() { finger.down = false; },
    planets: pl,
    size: () => ({ W, H }),
    resize,
    stop() { if (S.on) finish(); },
  };
}
