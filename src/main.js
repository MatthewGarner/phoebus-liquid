import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './style.css';

import { TUNE } from './tune.js';
import { createCat, LEG0 } from './cat.js';
import { CONTAINERS } from './containers.js';
import { LEVELS } from './levels.js';
import { SOLUTIONS } from './solutions.js';
import { createSim, launchVelocity, previewArc } from './sim.js';
import { playLine, WARM_FRAMES, DT } from './replay.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { createFx } from './fx.js';
import { createFeel } from './feel.js';
import { createSkeleton } from './skeleton.js';
import { THEMES, themeOfLevel } from './themes.js';
import { createScreens } from './screens.js';
import { createDestroyies } from './destroyies.js';

const QS = new URLSearchParams(location.search);
const DEBUG = QS.has('debug');
const app = document.getElementById('app');

// ---------------------------------------------------------------- progress (versioned: 'liquid.v3'; v2 is migrated)
// { v, levels: { [id]: { done, stars (best treats), purrfect, menace, bestFit } }, coached, dropCoached, toyCoached, menace (0..1), moments: { id: count },
//   destroyiesBest, sound, haptics, seenTitle }
const KEY = 'liquid.v3', OLD_KEY = 'liquid.v2', VERSION = 3;
const freshProgress = () => ({ v: VERSION, levels: {}, coached: false, dropCoached: false, toyCoached: false, menace: 0, moments: {}, destroyiesBest: 0, sound: true, haptics: true, reduceMotion: false, music: true });
function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY), p = JSON.parse(raw || 'null');
    if (p && typeof p === 'object') {
      const f = freshProgress();
      return { ...f, levels: p.levels && typeof p.levels === 'object' ? p.levels : {}, coached: !!p.coached, dropCoached: !!p.dropCoached, toyCoached: !!p.toyCoached,
        menace: Math.max(0, Math.min(1, +p.menace || 0)), moments: p.moments && typeof p.moments === 'object' ? p.moments : {}, destroyiesBest: p.destroyiesBest | 0,
        sound: p.sound !== false, haptics: p.haptics !== false, reduceMotion: !!p.reduceMotion, music: p.music !== false };
    }
  } catch (_) { /* blocked or corrupt */ }
  return freshProgress();
}
function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (_) { /* blocked */ } }
const progress = loadProgress();
const rec = (i) => progress.levels[LEVELS[i].id] || null;
const starsOf = (i) => (rec(i) ? rec(i).stars : 0);
const isDone = (i) => !!(rec(i) && rec(i).done);
const isUnlocked = (i) => i === 0 || isDone(i - 1);

let lvIndex = Math.max(0, Math.min(LEVELS.length - 1, (+QS.get('l') || 1) - 1));

const cat = createCat(TUNE);
const sim = createSim(TUNE, null, { cat });
const props = sim.props;
const audio = createAudio(TUNE);
const rend = createRenderer({ cat, T: TUNE, container: null, parent: app, debug: DEBUG });
const phoebus = rend.phoebus;
const canvas = rend.canvas;
const fx = createFx(app, rend);
const feel = createFeel(TUNE); phoebus.feel = feel;
const skeleton = createSkeleton(TUNE), skCtx = { surfY: null, facing: 1, dt: 1 / 60, vx: 0, vy: 0, mode: 'ground', solid: false, squashF: 0, squashH: 0, t: 0, tailUp: 0, settling: false };
phoebus.skel = skeleton; phoebus.skelCtx = skCtx; let skelOn = !QS.has('noskel');
const SLOW = { k: Math.max(0.05, Math.min(1, +QS.get('slow') || 1)) }; // ?slow=0.25 plays the whole game in slow motion

const newState = () => ({ zk: 0, zT: 1, earT: 0, fxT: 0, phase: 'play', winT: 0, slowT: 0, bannerDone: false, starsShown: 0, squishedT: 0, kickT: 0, tuckN: 0, shake: 0, shakeT: 0, dropFaceT: 0, boingT: 0 });
const state = newState();
let snapshotBlob = null;
let lastResult = { index: 0 };
let replay = null, replayAcc = 0;

const ui = createUI(app, {
  onAgain: () => respawn(),
  onShare: () => share(),
  onCard: () => openCard(),
  onClose: () => closeCard(),
  onAtlas: () => showAtlas(),
  onPlay: (i) => playLevel(i),
  onNext: () => goNext(),
  onMute: () => { setSound(audio.muted); return audio.muted; },
  onTitle: () => goTitle(),
  onMoments: () => showMoments(),
  onSettings: () => showSettings(),
}, { debug: DEBUG });
function setSound(on) { progress.sound = !!on; audio.setMuted(!on); ui.setMuted(!on); saveProgress(); }
function setHaptics(on) { progress.haptics = !!on; audio.setHaptics(on); saveProgress(); }
feel.reduced = progress.reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
audio.setMuted(!progress.sound); audio.setHaptics(progress.haptics); audio.setMusic(progress.music); ui.setMuted(!progress.sound);

// ---------------------------------------------------------------- title, moments, settings
const screens = createScreens(app, {
  onPlay: () => { const m = atlasModel(); ui.wipe(() => { screens.hideTitle(); document.body.classList.remove('in-title'); playLevel(m.next, true); }); },
  onLevels: () => { screens.hideTitle(); document.body.classList.remove('in-title'); showAtlas(); },
  onMoments: () => showMoments(),
  onSettings: () => showSettings(),
  onBack: () => { screens.hideMoments(); if (state.phase === 'title') screens.showTitle(); else showAtlas(); },
  onSound: (on) => setSound(on), onHaptics: (on) => setHaptics(on), onMusic: (on) => { progress.music = on; audio.setMusic(on); saveProgress(); }, onReduce: (on) => { progress.reduceMotion = on; feel.reduced = on || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); saveProgress(); },
  onTitleFromEnd: () => goTitle(),
  onReset: () => { Object.assign(progress, freshProgress(), { sound: progress.sound, haptics: progress.haptics }); saveProgress(); ui.toast('Progress erased'); if (state.phase === 'atlas') showAtlas(); },
});
// ---------------------------------------------------------------- Destroyies (the bonus round)
const dzHead = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
const dz = createDestroyies({
  parent: app, face: phoebus.canvas, audio,
  getBest: () => progress.destroyiesBest, setBest: (v) => { progress.destroyiesBest = v; saveProgress(); },
  tick: (dt) => { const ph = dz.state.phase; phoebus.setExpression(ph === 'outro' ? 'smug' : ph === 'morph' && dz.state.t < 1.35 ? 'yowl' : 'laser'); phoebus.update(dt, dzHead, null); },
  onFinish: (r) => {
    recordMoment('destroyies'); state.phase = 'play'; state.destroyiesReady = false; progress.menace = 0; saveProgress();
    phoebus.setExpression('neutral'); last = performance.now();
    ui.wipe(() => { const i = lvIndex + 1; if (i < LEVELS.length) playLevel(i, true); else { ui.hideWin(); showAtlas(); } });
  },
});
function startDestroyies() {
  ui.hideWin(); state.destroyiesReady = false; cancelAim(); ui.setAim(null);
  // a picture of the room as it is, for the transformation to play over
  rend.render(0, cat.head, null, 0, camState);
  const shot = document.createElement('canvas'), r0 = canvas.getBoundingClientRect(); shot.width = Math.round(r0.width); shot.height = Math.round(r0.height);
  shot.getContext('2d').drawImage(canvas, 0, 0, shot.width, shot.height);
  const h = headClient(), lv = LEVELS[lvIndex], cp = rend.clientFromWorld(sim.cx, lv.container.y + 1.5), def = CONTAINERS[lv.container.id];
  state.phase = 'destroyies'; phoebus.setExpression('yowl');
  dz.start({ seed: (Date.now() & 0xffff) + 1, shot, head: { x: h.x, y: h.y, r: Math.max(24, 0.8 * rend.view.ppw * (rend.view.zoom || 1)) }, cont: { x: cp.x - r0.left, y: cp.y - r0.top, color: def && def.colors ? def.colors.body : '#C9764A' } });
}
function showMoments() { ui.hideAtlas(); screens.showMoments(progress.moments); }
function showSettings() { screens.showSettings(progress); }
function goTitle() {
  ui.hideAtlas(); ui.hideWin(); ui.hideResult(); screens.hideMoments();
  playLevel(0, true); state.phase = 'title'; document.body.classList.add('in-title'); screens.showTitle();
}


// the pull is measured in screen pixels: full power at 24% of the screen height (at most 900 px of it)
function updatePull() { TUNE.pullMaxPx = TUNE.pullMaxFrac * Math.min(rend.view.cssH || window.innerHeight, 900); }

// ---------------------------------------------------------------- game flow
function respawn() {
  replay = null;
  ui.hideResult(); ui.hideWin();
  cancelAim();
  feel.reset(); feel.stopLeft = 0; helpReset();
  sim.reset();
  cat.moving = !!LEVELS[lvIndex].container.move;
  rend.setContainerX(sim.cx);
  rend.updateProps(props.list);
  fx.clear();
  const keepShake = 0;
  Object.assign(state, newState(), { shake: keepShake });
  cat.setRelaxed(false);
  phoebus.setExpression('neutral');
  ui.setAim(null); ui.setDropCoach(false);
  rend.pulseGlow();
  syncHud();
  updateCoach();
}

function playLevel(i, force = false) {
  if (i < 0 || i >= LEVELS.length || (!force && !isUnlocked(i))) return false;
  lvIndex = i;
  const lv = LEVELS[i];
  sim.load(lv);
  cat.moving = !!lv.container.move;
  rend.setLevel(lv);
  rend.buildProps(props.list);
  ui.setHeader(`${lv.id}. ${lv.name}`, lv.hint);
  ui.hideAtlas();
  respawn();
  return true;
}

function showEnd() { // after level 24: a small end screen with the stats
  let stars = 0; const byC = {}; LEVELS.forEach((lv, i) => { const r = rec(i); if (r && r.done) { stars += r.stars; byC[lv.container.id] = (byC[lv.container.id] || 0) + 1; } });
  const fav = Object.keys(byC).sort((a, b) => byC[b] - byC[a])[0] || 'salad', names = { salad: 'the salad bowl', teacup: 'the teacup', pot: 'the flower pot', vase: 'the vase', fishbowl: 'the fishbowl', box: 'the delivery box' };
  state.phase = 'end'; screens.showEnd({ stars, maxStars: LEVELS.length * 3, moments: Object.keys(progress.moments).length, momentsMax: 4, planets: progress.destroyiesBest ? Math.round(progress.destroyiesBest / 100) : 0, favourite: names[fav] || fav });
}
function goNext() {
  if (state.destroyiesReady && !dz.active) { startDestroyies(); return; }
  const i = lvIndex + 1;
  if (i < LEVELS.length) ui.wipe(() => { playLevel(i, true); });
  else ui.wipe(() => { ui.hideWin(); showEnd(); });
}

function atlasModel() {
  let total = 0;
  const levels = LEVELS.map((lv, i) => {
    const r = rec(i), unlocked = isUnlocked(i);
    total += r ? r.stars : 0;
    return { index: i, id: lv.id, name: lv.name, def: CONTAINERS[lv.container.id], stars: r ? r.stars : 0, purrfect: !!(r && r.purrfect), menace: !!(r && r.menace), bestFit: r ? r.bestFit : 0, theme: themeOfLevel(lv.id), done: !!(r && r.done), unlocked, lockHint: `Finish level ${LEVELS[i - 1] ? LEVELS[i - 1].id : 1} to unlock` };
  });
  const pct = Math.round((100 * total) / (3 * LEVELS.length));
  let next = levels.findIndex((l) => l.unlocked && !l.done);
  const allDone = next < 0;
  if (allDone) next = 0;
  return { themes: THEMES.map((t) => t.name), menace: progress.menace, levels, count: levels.filter((l) => l.unlocked).length, total: LEVELS.length, pct, next, nextName: LEVELS[next].name, allDone };
}

function showAtlas() {
  replay = null;
  cancelAim();
  state.phase = 'atlas';
  ui.hideResult(); ui.hideWin();
  ui.setAim(null); ui.setDropCoach(false);
  ui.showAtlas(atlasModel());
}

function snapshot() {
  // render and read back in the same tick so the drawing buffer is still valid
  rend.render(0, cat.head, null);
  const src = canvas;
  const sc = src.width / canvas.getBoundingClientRect().width;
  const lv = LEVELS[lvIndex], cx = Math.max(-5.2, Math.min(5.2, lv.container.x));
  const a = rend.clientFromWorld(cx - 5.2, lv.container.y + 9.6), b = rend.clientFromWorld(cx + 5.2, lv.container.y - 1.8);
  const r0 = canvas.getBoundingClientRect();
  let sx = (a.x - r0.left) * sc, sy = (a.y - r0.top) * sc;
  let sw = (b.x - a.x) * sc, sh = sw; // square crop
  sx = Math.max(0, Math.min(src.width - sw, sx)); sy = Math.max(0, Math.min(src.height - sh, sy));
  const out = document.createElement('canvas');
  out.width = out.height = 720;
  const c = out.getContext('2d');
  c.drawImage(src, sx, sy, sw, sh, 0, 0, 720, 720);
  return out;
}

// the polaroid card: only on demand (the share icon)
function openCard() {
  if (state.phase !== 'win') return;
  const out = snapshot();
  const url = out.toDataURL('image/jpeg', 0.9);
  out.toBlob((b) => { snapshotBlob = b; }, 'image/jpeg', 0.9);
  const lv = LEVELS[lvIndex], stars = sim.stars(), fit = cat.fitPct(sim.fitShown);
  lastResult = { index: lvIndex, fit, stars, leaps: sim.completeLeaps };
  ui.showResult({
    url, fit, stars, leaps: sim.completeLeaps, par: lv.par, knocked: sim.completeKnocked, total: props.total,
    menace: props.total > 0 && sim.completeKnocked >= props.total, name: lv.name, newBest: false, hasNext: lvIndex + 1 < LEVELS.length,
  });
}
function closeCard() { ui.hideResult(); }

async function share() {
  if (!snapshotBlob) return;
  const lv = LEVELS[lastResult.index];
  const file = new File([snapshotBlob], `phoebus-level-${lv.id}.jpg`, { type: 'image/jpeg' });
  const text = `Phoebus × ${lv.name} · ${'★'.repeat(lastResult.stars)}${'☆'.repeat(3 - lastResult.stars)} · ${lastResult.fit}% liquid — IF I FITS I SITS`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Phoebus × ${lv.name}`, text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(snapshotBlob); a.download = `phoebus-level-${lv.id}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- the coach (first play)
const wc = { x: 0, y: 0 };
function updateCoach() {
  const show = !progress.coached && state.phase === 'play' && sim.leaps === 0;
  if (!show) { ui.setCoach(false); return; }
  updatePull();
  const lv = LEVELS[lvIndex], lp = cat.launchPoint(wc), r0 = rend.canvas.getBoundingClientRect(), fr = (p) => ({ x: p.x - r0.left, y: p.y - r0.top }), c0 = fr(rend.clientFromWorld(lp.x, lp.y));
  const sol = SOLUTIONS[lv.id] && SOLUTIONS[lv.id].line[0], ang = sol ? sol.a * Math.PI / 180 : null; // (the first coach shows a shot that really lands in the container: the stored first line)
  const f = ang !== null ? (Math.cos(ang) >= 0 ? 1 : -1) : (lv.container.x >= lp.x ? 1 : -1), el = ang !== null ? Math.atan2(Math.sin(ang), Math.abs(Math.cos(ang))) : 1.0, power = sol ? sol.p : 0.6, pm = TUNE.pullMaxPx * power;
  const dxPx = -f * Math.cos(el) * pm, dyPx = Math.sin(el) * pm; // finger pulls away from the way he will go (screen y is down)
  const v = launchVelocity(TUNE, f * Math.cos(el) * power * TUNE.pullMax, Math.sin(el) * power * TUNE.pullMax);
  const pts = previewArc(TUNE, lp.x, lp.y + TUNE.launchHop, v.vx, v.vy, TUNE.aimDots, TUNE.aimPreview, aimPts);
  const dots = pts.slice(0, TUNE.aimDots).map((p) => fr(rend.clientFromWorld(p.x, p.y)));
  ui.setCoach(true, { fx: c0.x, fy: c0.y, dx: dxPx, dy: dyPx, dots });
}

// ---------------------------------------------------------------- input (pull back and let go; tap in the air to drop)
const aimSt = { id: null, sx: 0, sy: 0, fx: 0, fy: 0, on: false, level: 0 };
const aimPts = [];
for (let i = 0; i < 20; i++) aimPts.push({ x: 0, y: 0, t: 0 });
const aimOrigin = { x: 0, y: 0, init: false };
let stretchLast = 0;
const lpTmp = {};

function cancelAim() { if (aimSt.id !== null || aimSt.on) cat.endAim(); aimSt.on = false; aimSt.id = null; aimSt.level = 0; aimOrigin.init = false; ui.setAim(null); }

function pDown(id, cx, cy) {
  audio.unlock();
  if (state.phase !== 'play' || replay) return;
  if (cat.mode === 'air' && cat.M.leaping && !cat.M.dropped) { doDrop(); return; } // tap in the air: DROP
  if (aimSt.id !== null || !cat.canAim) return;
  cat.cancelLick();
  cat.plant(); // the feet are locked from here until he leaps (or the aim is cancelled)
  aimSt.id = id; aimSt.sx = cx; aimSt.sy = cy; aimSt.fx = cx; aimSt.fy = cy; aimSt.on = false; aimSt.level = 0; aimOrigin.init = false;
  audio.tick();
}
// pull vector in pull units (full power = TUNE.pullMax) from the start of the touch and the finger, both client px
function pullOf(sx, sy, fx, fy, out) {
  const k = TUNE.pullMax / TUNE.pullMaxPx, dx = sx - fx, dy = fy - sy; // dragging down = leaping up
  out.px = Math.hypot(dx, dy); out.dx = dx * k; out.dy = dy * k; out.power = Math.min(1, out.px / TUNE.pullMaxPx);
  return out;
}
const pv = { px: 0, dx: 0, dy: 0, power: 0 };
function pMove(id, cx, cy) {
  if (id !== aimSt.id) return;
  aimSt.fx = cx; aimSt.fy = cy;
  updatePull();
  pullOf(aimSt.sx, aimSt.sy, cx, cy, pv);
  if (pv.px >= TUNE.pullDeadPx) {
    if (!aimSt.on) { aimSt.on = true; ui.setCoach(false); }
    cat.aim(pv.dx, pv.dy);
  } else if (aimSt.on) { aimSt.on = false; cat.endAim(); cat.plant(); }
  const p = pv.power, lvl = p >= TUNE.dragFeedback[2] ? 3 : p >= TUNE.dragFeedback[1] ? 2 : p >= TUNE.dragFeedback[0] ? 1 : 0;
  if (lvl > aimSt.level) { audio.aimTick(lvl - 1); audio.haptic(6 + lvl * 3); audio.tick(); }
  aimSt.level = lvl;
}
function pUp(id) {
  if (id !== aimSt.id) return;
  updatePull();
  pullOf(aimSt.sx, aimSt.sy, aimSt.fx, aimSt.fy, pv);
  const was = aimSt.on;
  aimSt.id = null; aimSt.on = false; aimSt.level = 0; aimOrigin.init = false;
  ui.setAim(null);
  if (state.phase !== 'play') { cat.endAim(); return; }
  if (was && pv.px >= TUNE.pullDeadPx) doLeap(pv.dx, pv.dy, pv.power);
  else { cat.endAim(); if (!was && pv.px < TUNE.pullDeadPx) { phoebus.kick(0.35, -1); audio.chirp(); } } // a tap on the ground: cancelled, no movement
}

function doLeap(dx, dy, power) {
  const v = launchVelocity(TUNE, dx, dy, vtmp);
  if (!sim.leap(v.vx, v.vy)) { cat.endAim(); return false; }
  if (!progress.coached) { progress.coached = true; saveProgress(); }
  ui.setCoach(false);
  audio.mrrp(v.power); audio.whoosh(v.power); audio.haptic(14);
  phoebus.kick(0.8, 1);
  fx.startTrail();
  state.dropFaceT = 0;
  return true;
}
const vtmp = {};
function doDrop() {
  if (!sim.drop()) return false;
  if (!progress.dropCoached) { progress.dropCoached = true; saveProgress(); }
  ui.setDropCoach(false);
  return true;
}

// pointer listeners never call preventDefault (the canvas has touch-action:none), so they are passive
const PASSIVE = { passive: true };
const frameRect = () => app.getBoundingClientRect();
// positions are relative to the game frame (the overlay is positioned inside it)
const rel = (e) => { const r = frameRect(); return [e.clientX - r.left, e.clientY - r.top]; };
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const [x, y] = rel(e); pDown(e.pointerId, x, y);
}, PASSIVE);
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== aimSt.id) return;
  const [x, y] = rel(e); pMove(e.pointerId, x, y);
}, PASSIVE);
const up = (e) => pUp(e.pointerId);
canvas.addEventListener('pointerup', up, PASSIVE);
canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === aimSt.id) cancelAim(); }, PASSIVE);
canvas.addEventListener('lostpointercapture', up, PASSIVE);
for (const ev of ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault());

// ---------------------------------------------------------------- per-frame game logic
function syncHud() {
  const lv = LEVELS[lvIndex];
  ui.setLeaps(sim.leaps, lv.par);
  ui.setKnocked(props.knocked, props.total);
  ui.setTreats(sim.treatsGot, 3);
}

function updateAimVisuals(dt) {
  if (!aimSt.on) return;
  updatePull();
  pullOf(aimSt.sx, aimSt.sy, aimSt.fx, aimSt.fy, pv);
  cat.launchPoint(lpTmp);
  const k = aimOrigin.init ? 1 - Math.exp(-TUNE.previewSmooth * Math.max(dt, 1 / 120)) : 1;
  aimOrigin.x += (lpTmp.x - aimOrigin.x) * k; aimOrigin.y += (lpTmp.y - aimOrigin.y) * k; aimOrigin.init = true;
  const v = launchVelocity(TUNE, pv.dx, pv.dy, vtmp), n = Math.min(16, TUNE.aimDots);
  previewArc(TUNE, aimOrigin.x, aimOrigin.y + (cat.anchor.on ? TUNE.launchHop : 0), v.vx, v.vy, n, TUNE.aimPreview, aimPts);
  const dots = [];
  for (let i = 0; i < n; i++) { const c = rend.clientFromWorld(aimPts[i].x, aimPts[i].y, 0, cwTmp), r0 = rend.view.rect, f = i / Math.max(1, n - 1); dots.push({ x: c.x - r0.left, y: c.y - r0.top, r: 7 - 3.6 * f, a: 1 - 0.55 * f }); }
  ui.setAim({ sx: aimSt.sx, sy: aimSt.sy, fx: aimSt.fx, fy: aimSt.fy, power: pv.power, dots });
}

const head2 = {};
const cwTmp = {};
function headClient() { const c = rend.clientFromWorld(cat.head.x, cat.head.y, 0, cwTmp); const r = rend.view.rect; head2.x = c.x - r.left; head2.y = c.y - r.top; return head2; }
function lowest() { let y = 1e9, x = 0; for (let i = 0; i < cat.N; i++) { const b = cat.y[i] - cat.r[i]; if (b < y) { y = b; x = cat.x[i]; } } return { x, y }; }

function onComplete() {
  state.phase = 'win'; state.winT = 0; state.slowT = TUNE.winSlowTime; state.bannerDone = false; state.starsShown = 0;
  cancelAim(); ui.setAim(null); ui.setCoach(false); ui.setDropCoach(false);
  const lv = LEVELS[lvIndex], treats = sim.completeTreats, purr = sim.purrfect(), menace = props.total > 0 && sim.completeKnocked >= props.total;
  const prev = rec(lvIndex);
  progress.levels[lv.id] = { done: true, stars: Math.max(treats, prev ? prev.stars : 0), purrfect: !!(purr || (prev && prev.purrfect)), menace: !!(menace || (prev && prev.menace)), bestFit: Math.max(cat.fitPct(sim.completeFit), prev ? prev.bestFit : 0) };
  { // the menace meter: every NEW treat and every prop knocked fills it; it is always full after the last level
    const r = progress.levels[lv.id], newTreats = Math.max(0, treats - (prev ? prev.stars : 0)), newKnocks = Math.max(0, sim.completeKnocked - (prev && prev.knocked ? prev.knocked : 0));
    r.knocked = Math.max(sim.completeKnocked, prev && prev.knocked ? prev.knocked : 0);
    progress.menace = Math.min(1, progress.menace + newTreats * TUNE.menacePerTreat + newKnocks * TUNE.menacePerProp);
    if (lvIndex === LEVELS.length - 1) progress.menace = 1;
  }
  state.destroyiesReady = progress.menace >= 1;
  saveProgress();
  audio.purr(); audio.haptic([20, 40, 20, 40, 60]);
  const h = headClient();
  ui.burst(h.x, h.y - 10);
  // call-outs: the way he came in
  const co = [];
  if (sim.flight.dropped) co.push('Nose dive!'); else if (sim.flight.rim) co.push('Rim shot!');
  if (sim.flight.bonk) co.push('Off the wall!');
  if (menace) co.push('Menace!');
  if (purr) co.push('Purrfect!');
  if (treats === 3 && lv.container.id !== 'box') { state.swirl = 0.0001; state.swirlTold = false; audio.swirl(); audio.haptic(12); recordMoment('swirlies'); }
  co.slice(0, 3).forEach((t, i) => ui.callout(t, h.x, h.y - 40 - i * 4, i * 380));
}
// SWIRLIES: a render-only coil (see Phoebus.writeSwirl). The rig keeps simulating underneath; the body drawing and the face follow the coil instead.
// the banner sits clear above him (above the top of the coil, or of his head), never on him
function bannerY() {
  const topW = state.swirl > 0 ? cat.swirlY + 2.6 : cat.head.y + 2.0, p = rend.clientFromWorld(cat.head.x, topW, 0, cwTmp), r0 = rend.view.rect;
  return Math.max(130, p.y - r0.top - 150);
}
function updateSwirl(dt) {
  if (state.phase !== 'win' || !(state.swirl > 0)) { cat.swirlT = 0; return; }
  if (state.winT < 1.8 && (Math.abs(feel.slosh.x) > 0.03 || Math.abs(feel.slosh.v) > 0.5 || feel.popT > 0)) return; // (the coil starts from the settled slosh)
  state.swirl = Math.min(1, state.swirl + dt / 1.5);
  if (!state.swirlTold && state.swirl > 0.2) { state.swirlTold = true; const h = headClient(); ui.callout('Swirlies', h.x, h.y + 110, 0, 1700); }
  const t = state.swirl; cat.swirlT = 0.46 + 0.54 * ease(t);
  cat.swirlX = sim.cx; cat.swirlY = cat.rimY - 0.1; cat.swirlR = 1.9;
  const h = cat.head; h.x = cat.swirlX + 0.05; h.y = cat.swirlY + 0.05; h.angle = 0.25; h.vx = h.vy = 0;
}
function recordMoment(id) { progress.moments[id] = (progress.moments[id] | 0) + 1; saveProgress(); }

const camKick = (px, nx, ny) => { if (feel.reduced) return; const w = 6.2832 * TUNE.impact.camHz * 0.9; feel.camX.v += -nx * px * w; feel.camY.v += ny * px * w; };
// the impact events from the sim -> the presentation: body squash and wobble (feel), hit-stop, camera, fx, sound and haptics, and the world's reaction
// read-only look ahead: where will he touch down, and how soon? (a ray along his velocity onto the floor and the shelf tops; drives the reach pose)
function predictLanding() {
  const A = feel.appr; A.w = 0;
  if (cat.mode !== 'air' || cat.kicking || cat.M.dropped || cat.M.vyc > -3 || state.phase === 'win') return;
  let low = 1e9, cx = 0; for (let i = 0; i < cat.N; i++) { cx += cat.x[i]; const b = cat.y[i] - cat.r[i]; if (b < low) low = b; } cx /= cat.N;
  let surf = 0; const pl = LEVELS[lvIndex].platforms || [];
  for (let k = 0; k < pl.length; k++) { const p = pl[k]; if (Math.abs(cx - p.x) < p.w / 2 && low >= p.y - 0.15 && p.y > surf) surf = p.y; }
  const t = (low - surf) / -cat.M.vyc; if (t < 0 || t > 0.18) return;
  const u = 1 - t / 0.18; A.w = u * u * (3 - 2 * u); A.surf = surf; A.tx = cx + cat.M.vxc * t;
}
function feelContainer() { const lv = LEVELS[lvIndex], c = feel.cont; c.on = cat.mode === 'contained' || cat.mode === 'pour' || cat.M.inn > 0.5; c.x = sim.cx; c.base = lv.container.y; }
function applyWorldFeel() { // the world's springs -> the render layer (only touches things that moved)
  const lv = LEVELS[lvIndex];
  for (let k = 0; k < (lv.platforms || []).length && k < feel.shelf.length; k++) rend.setShelfDip(k, feel.shelf[k].x);
  rend.setContainerFx(feel.cRock.x, feel.cSq.x); rend.setToySway(feel.toySway.x);
}
function handleImpacts() {
  const q = cat.impacts;
  for (let i = 0; i < q.length; i++) {
    const e = q[i], stop = feel.onImpact(e), s = feel.out.strength || 0;
    if (!feel.out.lines) continue;
    feel.out.lines = null;
    const lv = LEVELS[lvIndex], mat = lv.container.id, big = s >= 0.6, heavyHead = (e.kind === 'wall' || e.kind === 'ceiling') && e.part === 'head';
    if (stop > feel.stopLeft) { feel.stopLeft = stop; feel.stopTotal += stop; }
    fx.impact(e.x, e.y, e.nx, e.ny, s, e.tanSign, heavyHead && s > 0.3);
    if (!e.secondary) audio.impact(e.kind, s, mat);
    if (s > 0.25) { if (s >= 0.6) audio.haptic([22, 28, 30, 36]); else if (s >= 0.4) audio.haptic([12, 22, 12]); else audio.haptic(8); }
    if (e.kind === 'shelf') { for (let k = 0; k < (lv.platforms || []).length; k++) { const p = lv.platforms[k]; if (Math.abs(e.y - p.y) < 0.8 && Math.abs(e.x - p.x) < p.w / 2 + 0.6) { feel.onShelf(k, s); feel.onWorldHit(s * 0.5); break; } } }
    else if (e.kind === 'rim' || e.kind === 'containerFloor') { feel.onContainer(s, e.x < sim.cx ? -1 : 1); if (s > 0.3 && !e.secondary && (mat === 'teacup')) audio.clink(s * 18); }
    else if (e.kind === 'wall' || e.kind === 'ceiling') feel.onWorldHit(s);
    if (e.kind === 'floor' && s > 0.55) feel.onWorldHit(s * 0.4);
    if (s > 0.35 && (e.kind === 'floor' || e.kind === 'shelf') && !e.secondary) setTimeout(() => audio.mrrp(0.3), 90); // an "mrrp" as he lands
    if (s > 0.15) phoebus.kick(Math.min(1, s * 1.1), -1); // the face and ears jiggle with it
    if (s > 0.25) skeleton.react(s); // ears flat, whiskers back
  }
  q.length = 0;
}
// ---- soft help: never a fail screen. Two leaps in a row that go nowhere, or being unable to aim for 4 s, pulse the Again chip; many leaps over par pulse the hint, then show a ghost of the stored first shot.
let moodLast = -1;
const HELP = { start: null, active: false, near: 0, unaim: 0, hint: false, ghost: false, t: 0 };
function helpReset() { HELP.active = false; HELP.near = 0; HELP.unaim = 0; HELP.hint = false; HELP.ghost = false; HELP.start = null; }
function helpUpdate(dt) {
  if (state.phase !== 'play' || replay) return;
  const cx = (() => { let x = 0, y = 0; for (let i = 0; i < cat.N; i++) { x += cat.x[i]; y += cat.y[i]; } return [x / cat.N, y / cat.N]; })();
  if (cat.mode === 'air' && cat.M.leaping && !HELP.active) { HELP.active = true; HELP.start = HELP.start || cx; }
  else if (HELP.active && cat.canAim && cat.mode !== 'air' && cat.M.leapT <= 0 && !cat.kicking) {
    HELP.active = false; const d = Math.hypot(cx[0] - HELP.start[0], cx[1] - HELP.start[1]); HELP.start = null;
    HELP.near = d < 1.5 ? HELP.near + 1 : 0; if (HELP.near >= 2) { ui.pulse('again'); HELP.near = 0; }
  }
  HELP.unaim = !cat.canAim ? HELP.unaim + dt : 0; if (HELP.unaim > 4) { ui.pulse('again'); HELP.unaim = -6; }
  const lv = LEVELS[lvIndex];
  if (!HELP.hint && sim.leaps > lv.par + 4 && !sim.complete) { HELP.hint = true; ui.pulse('hint'); }
  if (!HELP.ghost && sim.leaps > lv.par + 9 && !sim.complete && SOLUTIONS[lv.id]) { HELP.ghost = true; showGhost(SOLUTIONS[lv.id].line[0]); }
}
function showGhost(shot) { // a ghost finger and arc for the stored first shot (the coach machinery)
  updatePull(); const lp = cat.launchPoint(wc), r0 = rend.view.rect, fr = (p) => ({ x: p.x - r0.left, y: p.y - r0.top }), c0 = fr(rend.clientFromWorld(lp.x, lp.y));
  const a = shot.a * Math.PI / 180, pm = TUNE.pullMaxPx * shot.p, dxPx = -Math.cos(a) * pm, dyPx = Math.sin(a) * pm;
  const v = launchVelocity(TUNE, Math.cos(a) * shot.p * TUNE.pullMax, Math.sin(a) * shot.p * TUNE.pullMax), pts = previewArc(TUNE, lp.x, lp.y + TUNE.launchHop, v.vx, v.vy, TUNE.aimDots, TUNE.aimPreview, aimPts);
  ui.setCoach(true, { fx: c0.x, fy: c0.y, dx: dxPx, dy: dyPx, dots: pts.slice(0, TUNE.aimDots).map((p) => fr(rend.clientFromWorld(p.x, p.y))) });
  ui.toast('Try this one'); setTimeout(() => ui.setCoach(false), 4200);
}
function game(dt, impact) {
  const T = TUNE;
  // events from the rig, the props and the rules
  const ce = cat.events;
  for (let i = 0; i < ce.length; i++) {
    const e = ce[i];
    if (e === 'pour') { audio.squish(0.35); audio.haptic([8, 30, 8]); feel.onPour(cat.M.vxc, cat.M.vyc, !!cat.dropped || state.dropFaceT > 0); }
    else if (e === 'tuck') audio.pop(state.tuckN++);
    else if (e === 'settle') { state.tuckN = 0; audio.haptic(10); audio.purr(); }
    else if (e === 'land') { /* the landing is the impact event (sound, fx, camera, squash): see handleImpacts */ }
    else if (e === 'splat') { audio.splat(); feel.onSplat(); state.squishedT = 0.55; const lo = lowest(); fx.impact(lo.x, lo.y, 0, 1, 1, 1); audio.haptic([10, 20, 18, 30, 40]); }
    else if (e === 'leap') { feel.onLeap(cat.M.vxc, cat.M.vyc); const lo = lowest(); fx.dust(lo.x, lo.y, 0.5); }
    else if (e === 'bonk') { audio.bonk(); audio.ack(); fx.bonk(cat.evData.bonkX * 0.98, cat.evData.bonkY); audio.haptic(10); }
    else if (e === 'boing') { audio.boing(); rend.squashCushion(cat.evData.cushion, 1); camKick(5, 0, 1); audio.haptic(12); phoebus.kick(0.9, 1); }
    else if (e === 'drop') { audio.blorp(); fx.streak(cat.head.x, cat.head.y); state.dropFaceT = 1.2; audio.haptic([12, 18, 10]); phoebus.kick(0.8, -1); }
    else if (e === 'lickies') { const h = headClient(); ui.callout('Lickies', h.x, h.y - 40); audio.lickies(); audio.haptic(8); recordMoment('lickies'); state.earT = 0.75; }
    else if (e === 'kickfall') { audio.thump(0.3); }
    else if (e === 'startle') { audio.screech(); audio.haptic([18, 30, 18]); phoebus.kick(1, 1); fx.startTrail(); }
  }
  ce.length = 0; sim.evIdx = 0;
  const se = sim.events;
  for (let i = 0; i < se.length; i++) {
    const e = se[i];
    if (e.type === 'treat') { audio.blip(e.n); audio.haptic(8); audio.tick(); fx.sparkle(e.x, e.y); }
    else if (e.type === 'startle') { const h = headClient(); ui.callout('Startled!', h.x, h.y - 30); }
    else if (e.type === 'kickies') { const h = headClient(); ui.callout('Back leg kickies', h.x, h.y - 40); audio.kickies(); audio.haptic([8, 20, 8, 20, 8]); fx.dust(e.x, e.y, 0.7); camKick(4, 0, 1); recordMoment('kickies'); if (!progress.toyCoached) { progress.toyCoached = true; saveProgress(); } }
    else if (e.type === 'complete') onComplete();
  }
  se.length = 0;
  const pe = props.events;
  for (let i = 0; i < pe.length; i++) {
    const e = pe[i];
    if (e.type === 'knock') { audio.crash(e.v); audio.haptic([14, 30, 14]); }
    else if (e.type === 'clink') audio.clink(e.v);
  }
  pe.length = 0;

  if (cat.kicking) { // the whole time he holds it: fluff off the toy, arc streaks at the kicking feet
    state.fxT -= dt;
    if (state.fxT <= 0) { state.fxT = 0.07; const K = cat.kickToy; fx.fluff(K.toyX, K.toyY, 3); const l = 2 + ((cat.time * 14) | 0) % 2, i = LEG0 + l * 2 + 1; fx.arc(cat.x[i], cat.y[i], cat.facing, cat.facing > 0 ? 1.2 : 1.9); }
  }
  if (state.earT > 0) { state.earT -= dt; if (state.earT <= 0) phoebus.kick(0.9, 1); } // (one ear flick mid-lick)
  if (!cat.licking) state.earT = 0;
  state.kickT = Math.max(0, state.kickT - dt);
  if (impact > T.squishedImpact * 4) state.squishedT = Math.max(state.squishedT, 0.4);
  state.squishedT = Math.max(0, state.squishedT - dt);
  state.dropFaceT = Math.max(0, state.dropFaceT - dt);
  if (state.shakeT > 0) { state.shakeT -= dt; if (state.shakeT <= 0) state.shake = 0; }

  // the win, inline: a short slow-motion beat, the stars pop one by one, then Next and Again slide up
  if (state.phase === 'win') {
    state.winT += dt;
    if (!state.bannerDone && state.winT >= T.bannerDelay) {
      state.bannerDone = true;
      const h = headClient();
      ui.showWin({ treats: sim.completeTreats, fit: cat.fitPct(sim.fitShown), purrfect: sim.purrfect(), menace: props.total > 0 && sim.completeKnocked >= props.total, anchor: { x: h.x, y: bannerY() }, swirl: state.swirl > 0, hasNext: lvIndex + 1 < LEVELS.length, destroyies: !!state.destroyiesReady, menaceFill: progress.menace });
    }
    if (state.bannerDone) {
      const h = headClient(); ui.moveWin(h.x, bannerY(), cat.fitPct(sim.fitShown));
      const n = Math.floor((state.winT - T.bannerDelay) / 0.2) + 1;
      while (state.starsShown < Math.min(3, n)) {
        const i = state.starsShown++;
        ui.popStar(i);
        if (i < sim.completeTreats) audio.chime(i); // a rising three-note chime, one note per star earned
      }
    }
  }

  syncHud();
  if (state.phase === 'play' && !replay) {
    if (!progress.coached && sim.leaps === 0) { /* the coach stays up until the first leap */ } else ui.setCoach(false);
    // level 4 teaches DROP: when he is above the vase
    const lv = LEVELS[lvIndex];
    const over = lv.id === 4 && !progress.dropCoached && cat.mode === 'air' && cat.M.leaping && !cat.M.dropped && Math.abs(cat.x[0] - sim.cx) < 3.2 && cat.y[0] > cat.rimY + 0.5;
    const toyHint = lv.toys && lv.toys.length && !progress.toyCoached && cat.mode === 'air' && cat.M.leaping && !cat.kicking; // the first toy level: touch the mouse in mid-air
    ui.setDropCoach(over || toyHint, toyHint && !over ? 'Touch the mouse in the air. Then aim again.' : 'Tap in the air to drop.');
  }

  // expression
  let ex = 'neutral';
  if (state.phase === 'win') ex = 'smug';
  else if (cat.startled) ex = 'yowl';
  else if (state.squishedT > 0) ex = 'squished';
  else if (cat.dropped || state.dropFaceT > 0) ex = 'determined';
  else if (sim.glanceT > 0) ex = 'smug';
  else if (cat.M.stuck) ex = 'grumpy';
  else if (cat.kicking) ex = 'wild';
  else if (cat.licking) ex = 'lick';
  else if (cat.mood) ex = cat.mood;
  phoebus.setExpression(ex);
}

// ---------------------------------------------------------------- main loop
// Real elapsed time: one step of min(dt, 1/60) per frame (a 120 Hz display steps by 1/120), two steps when the frame is
// slow, and slow motion beyond that. Never catch-up.
let last = performance.now(), dbgT = 0, lastSteps = 0;
let frozen = false; // debug: the loop does nothing (step by hand with GAME.debug.advance)
function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) { last = now; return; }
  const ms = now - last;
  last = now;
  if (ms <= 0) return;
  rend.trackFrame(Math.min(ms, 250)); noteInterval(ms);
  if (state.phase === 'atlas' || state.phase === 'destroyies' || dz.active) return; // (the level list, or the bonus round, covers the canvas)
  realFrame = true; tick(Math.min(ms / 1000, 0.1)); realFrame = false;
}

const camState = { zoom: 1, fx: 0, fy: 0, sx: 0, sy: 0, lift: 0 };
const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function cameraFor(dt) {
  const T = TUNE;
  let z = 1;
  if (state.phase === 'win') { const t = state.winT; z = 1 + (T.winZoom - 1) * ease(t / 0.55); } // (he is centred and held while the banner is up)
  const lv = LEVELS[lvIndex];
  camState.zoom = z; camState.fx = sim.cx; camState.fy = lv.container.y + 2.5; camState.cxk = state.phase === 'win' ? Math.max(0, Math.min(1, (z - 1) / (T.winZoom - 1))) : undefined; // (the camera centres on him as it zooms)
  { // a punch-in toward him while he kicks (1.25x) or licks (1.3x): eased in, and back out quickly (instantly when a touch cancels the lick)
    const want = state.phase === 'play' ? (cat.kicking ? 1.25 : cat.licking ? 1.3 : 0) : 0;
    if (want) { state.zT = want; state.zk = Math.min(1, state.zk + dt * (cat.kicking ? 3 : 2.4)); } else state.zk = Math.max(0, state.zk - dt * (state.phase === 'play' ? 7 : 20));
    if (state.zk > 0 && state.phase !== 'win') {
      const k = ease(state.zk), zz = 1 + (state.zT - 1) * k, B = (rend.view.w / 2) * (1 - 1 / zz), sx = cat.kicking ? cat.kickToy.toyX : cat.head.x, sy = cat.kicking ? cat.kickToy.toyY : cat.head.y;
      camState.zoom = zz; camState.fx = Math.max(-B, Math.min(B, sx * k)); camState.fy = sy; camState.cxk = 1; camState.cyk = k;
    }
  }
  if (state.phase === 'title') { camState.zoom = 1.45; camState.fx = cat.x[0]; camState.fy = cat.y[0] + 3.4; camState.cxk = 1; camState.cyk = 1; } else if (!(state.zk > 0 && state.phase !== 'win')) camState.cyk = undefined;
  if (LAB.on) { let cx = 0, cy = 0; const bx = skeleton.active ? skeleton.X : cat.x, by = skeleton.active ? skeleton.Y : cat.y; for (let i = 0; i < 13; i++) { cx += bx[i]; cy += by[i]; } cx /= 13; cy /= 13; cy = Math.max(cy, 1.6); camState.zoom = 2.0; camState.fx = cx - (cat.facing || 1) * 0.5; camState.fy = cy - 0.3; camState.cxk = 1; camState.cyk = 1; }
  // (the container climbs the screen while the win buttons are up, so he stays above them)
  camState.lift = state.phase === 'win' && cat.rimY < 12 ? 6.2 * ease(state.winT / 0.6) : 0;
  const k = state.shake > 0 && !feel.reduced ? state.shake / Math.max(1, rend.view.ppw) : 0, ppw = Math.max(1, rend.view.ppw);
  camState.sx = (k ? (Math.random() - 0.5) * 2 * k : 0) + feel.camX.x / ppw; camState.sy = (k ? (Math.random() - 0.5) * 2 * k : 0) + feel.camY.x / ppw; // (a spring: one shove and a recoil)
  if (feel.camZ.x > 0.0005) camState.zoom *= 1 + feel.camZ.x;
  return camState;
}

// the skeleton's inputs, read from the sim (never written): the floor/shelf/cushion under a foot, flight velocity, mode, the feel layer's squash
function surfaceUnder(x) {
  let low = 1e9; for (let i = 0; i < cat.N; i++) { const b = cat.y[i] - cat.r[i]; if (b < low) low = b; }
  const lv = LEVELS[lvIndex]; let s = 0;
  for (const p of lv.platforms || []) if (Math.abs(x - p.x) < p.w / 2 + 0.1 && p.y <= low + 0.9 && p.y > s) s = p.y;
  for (const c of lv.cushions || []) if (Math.abs(x - c.x) < c.w / 2 && c.y + TUNE.cushionH <= low + 0.9 && c.y + TUNE.cushionH > s) s = c.y + TUNE.cushionH;
  return s;
}
function skelPrep(dt) {
  const c = skCtx; c.surfY = surfaceUnder; c.facing = cat.facing || 1; c.dt = dt; c.vx = cat.M.vxc; c.vy = cat.M.vyc; c.mode = cat.mode; c.t = cat.time;
  c.squashF = feel.sqF.x; c.squashH = feel.sqH.x;
  c.solid = skelOn && (cat.mode === 'ground' || cat.mode === 'air') && !cat.kicking && cat.M.splat < 0.25 && !(cat.swirlT > 0.45) && state.phase !== 'destroyies';
  c.tailUp = cat.mode === 'ground' && !cat.M.aim.on && cat.poseName === 'stand' ? 1 : 0;
  if (c.solid) { skeleton.advance(cat, c); skeleton.fresh = true; } else skeleton.fresh = false; // the animator steps with the sim (so the debug hooks that step by hand animate too)
}
function tick(dtReal) {
  cat.impact = 0;
  updatePull();
  // slow motion for the beat as he pours in
  let scale = SLOW.k;
  if (state.phase === 'win' && state.slowT > 0) { scale = TUNE.winSlow * SLOW.k; state.slowT -= dtReal; }
  else if (cat.kicking && cat.kickT < TUNE.kickTime) scale = TUNE.kickSlow * SLOW.k;
  const t0 = performance.now();
  let n = 1;
  // a finished, settled win: nothing in the sim can change any more (relaxed, not driving, no prop awake), so it is not stepped at all
  const asleep = state.phase === 'win' && state.winT > 2.2 && !cat.moving && props.awake === 0 && !replay;
  const stopped = feel.stopLeft > 0; // hit-stop: the sim (and the body layer) hold for a few frames, the pose frozen mid-squash; input and drawing carry on
  if (stopped) { n = 0; feel.stopLeft--; }
  else if (asleep) n = 0;
  else if (replay) { // a stored line: exactly one 1/60 step at a time, the same ones the solver took
    replayAcc += dtReal * scale; n = 0;
    while (replayAcc >= DT && n < 3) { replayAcc -= DT; const r = replay.next(); n++; if (r.done) { replay = null; break; } }
  } else {
    // all of the frame's time is simulated: as many near-1/60 steps as it takes (a 30 Hz frame is two, a 36 ms frame is three of 12 ms), never dropped
    const dt = dtReal * scale;
    n = Math.min(TUNE.maxFrameSteps, Math.max(1, Math.ceil(dt * 60 - 0.1)));
    const h = Math.min(1 / 60, dt / n);
    for (let i = 0; i < n; i++) sim.step(h);
  }
  const t1 = performance.now();
  lastSteps = n;
  rend.perf.steps = n;
  if (n) rend.perf.simMs += ((t1 - t0) / n - rend.perf.simMs) * 0.1; else rend.perf.simMs *= 0.9;
  P_.sim += ((t1 - t0) - P_.sim) * 0.1;
  rend.setContainerX(sim.cx);
  if (!stopped) { predictLanding(); feelContainer(); handleImpacts(); feel.update(dtReal * scale, cat); } else cat.impacts.length = 0;
  applyWorldFeel();
  helpUpdate(dtReal);
  { const m = state.phase === 'win' ? 2 : cat.mode === 'air' ? 1 : 0; if (m !== moodLast) { moodLast = m; audio.setMood(m); } }
  game(dtReal, cat.impact);
  updateSwirl(dtReal);
  updateAimVisuals(dtReal);
  { const sa = aimSt.on ? Math.round(pv.power * 20) / 20 : 0; if (sa !== stretchLast) { stretchLast = sa; audio.setStretch(sa, aimSt.on); } } // (the crouch stretch: a rising hum while he winds up)

  for (let k = cat.takeBlinks(); k > 0; k--) phoebus.doBlink(true);
  rend.updateProps(props.list);
  rend.updateTreats(sim.treats, cat.time);
  rend.updateCucumbers(sim.cucumbers); rend.updateToys(sim.toys, cat.time);
  rend.updateCushions(dtReal);
  const cam = cameraFor(dtReal);
  const t2 = performance.now();
  skelPrep(stopped ? 0 : dtReal * scale);
  pendDt += dtReal;
  const skipDraw = asleep && (skipFlip = !skipFlip) && state.winT > 3 && !fx.busy(); // (a settled win only blinks: it is drawn every other frame, with the time it missed)
  if (!skipDraw) { rend.render(pendDt, feel.active ? feel.head : cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, cam); }
  labDraw();
  const t3 = performance.now();
  if (!skipDraw) { fx.update(pendDt, cat.head, cat.mode === 'air'); pendDt = 0; }
  const t4 = performance.now();
  P_.game += ((t2 - t1) - P_.game) * 0.1; P_.rend += ((t3 - t2) - P_.rend) * 0.1; P_.fx += ((t4 - t3) - P_.fx) * 0.1;
  governor(dtReal);

  if (DEBUG) {
    dbgT += dtReal;
    if (dbgT > 0.25) { // (at most 4 times a second: the strings are only built here)
      dbgT = 0;
      const P = rend.perf, busy = P_.sim + P_.game + P_.rend + P_.fx, mode = intervalMode();
      ui.setDebug(`fps ${P.fps.toFixed(0)}  int ${mode.ms}ms (cap ${mode.cap}%)  px ${P.pixelRatio} ${P.canvas}\nsim ${P_.sim.toFixed(1)} game ${P_.game.toFixed(1)} rend ${P_.rend.toFixed(1)} fx ${P_.fx.toFixed(1)}  steps ${lastSteps}\nbusy ${busy.toFixed(1)}  other ${Math.max(0, P.frameMs - busy).toFixed(1)}  worst ${P.worstMs.toFixed(0)}\nL${LEVELS[lvIndex].id} ${cat.mode} ${state.phase}  props ${props.awake}`);
    }
  }
}

// per-section frame timings (smoothed ms), the mode of the rAF interval, and the resolution governor
let pendDt = 0, skipFlip = false;
const P_ = { sim: 0, game: 0, rend: 0, fx: 0 };
const ivHist = new Uint8Array(64), ivRing = new Uint8Array(90); let ivI = 0, ivN = 0;
function noteInterval(ms) { // 1 ms buckets up to 63: the mode shows a 30 Hz cap (33) or a 60 Hz display (17) at a glance
  const b = Math.min(63, Math.round(ms)); if (ivN === 90) ivHist[ivRing[ivI]]--; else ivN++;
  ivRing[ivI] = b; ivHist[b]++; ivI = (ivI + 1) % 90;
}
function intervalMode() { let best = 0, bc = 0, near = 0; for (let i = 0; i < 64; i++) { const c = ivHist[i]; if (c > bc) { bc = c; best = i; } if (i >= 31 && i <= 36) near += c; } return { ms: best, cap: ivN ? Math.round(100 * near / ivN) : 0 }; }
const GOV = { ratios: [2, 1.5, 1.25, 1], i: 0, bad: 0, good: 0, t: 0 };
let realFrame = false;
function governor(dt) {
  if (!realFrame) return; // (only real animation frames: not the debug hooks stepping by hand) // lower the WebGL resolution when the device misses its budget for real (not when it is just capped at 30 Hz with idle time); only at rest
  GOV.t += dt; if (GOV.t < 0.5) return; GOV.t = 0;
  const P = rend.perf, mode = intervalMode(), busy = P_.sim + P_.game + P_.rend + P_.fx;
  const capped = mode.ms >= 28 && mode.ms <= 38 && busy < mode.ms * 0.6; // 30 Hz with room to spare: not a reason to drop
  const budget = mode.ms >= 28 ? 33 : 16.7, over = P.frameMs > budget * 1.35 && !capped;
  const calm = cat.mode !== 'air' && !cat.M.leaping && !cat.kicking && state.phase !== 'destroyies';
  if (over) { GOV.bad++; GOV.good = 0; } else if (P.frameMs < budget * 1.1) { GOV.good++; GOV.bad = 0; } else { GOV.bad = 0; GOV.good = 0; }
  if (calm && GOV.bad >= 4 && GOV.i < GOV.ratios.length - 1) { GOV.i++; GOV.bad = 0; rend.setPR(GOV.ratios[GOV.i]); } // (4 slow half-seconds in a row)
  else if (calm && GOV.good >= 60 && GOV.i > 0) { GOV.i--; GOV.good = 0; rend.setPR(GOV.ratios[GOV.i]); }  // (30 s of comfort to climb back)
}

// ---------------------------------------------------------------- the motion lab (?lab or GAME.debug.lab()): him large and side-on on a plain floor, with buttons for each motion, slow motion and a bones overlay
const LAB = { on: false, bones: true, cv: null, ctx: null, panel: null };
function labStart() {
  if (LAB.on) return; LAB.on = true; document.body.classList.add('lab');
  // a clear floor: the container is parked high on the left, out of every leap's path (a lab-only level, added for this page session; its id picks the light kitchen theme)
  if (!LEVELS.some((l) => l.id === 1.5)) LEVELS.push({ id: 1.5, name: 'Lab', hint: '', par: 1, container: { id: 'teacup', x: 7.2, y: 26 }, cat: { x: -4.5, y: 0, facing: 1 }, platforms: [{ x: 7.2, y: 26, w: 3.5 }], props: [], treats: [] });
  playLevel(levelIndexOf(1.5), true); state.phase = 'play'; screens.hideTitle(); document.body.classList.remove('in-title'); ui.hideAtlas(); ui.setCoach(false);
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:45'; app.appendChild(cv); LAB.cv = cv; LAB.ctx = cv.getContext('2d');
  const panel = document.createElement('div'); panel.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:60;display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:rgba(255,255,255,.9);font:600 11px system-ui'; LAB.panel = panel;
  const L = (name, fn) => { const b = document.createElement('button'); b.textContent = name; b.style.cssText = 'font:600 11px system-ui;padding:4px 7px;border-radius:8px;border:1px solid #888;background:#fff'; b.onclick = fn; panel.appendChild(b); };
  const ga = () => window.GAME_API_LAB;
  L('stand', () => labPose('stand')); L('sit', () => labPose('sit')); L('loaf', () => labPose('loaf'));
  for (const pw of [0.3, 0.6, 1]) L(`crouch ${pw * 100 | 0}%`, () => labAim(pw));
  for (const pw of [0.35, 0.7, 1]) L(`leap ${pw * 100 | 0}%`, () => labLeap(pw, false));
  L('drop landing', () => labLeap(0.8, true)); L('tumble', () => labTumble()); L('walk', () => labWalk(1)); L('turn', () => labTurn()); L('sit<>stand', () => labSitStand());
  L('step 1f', () => { frozen = true; tick(1 / 60); rend.render(0, cat.head, null, cat.annoyance, camState); }); L('run/pause', () => { frozen = !frozen; });
  L('bones', () => { LAB.bones = !LAB.bones; }); L('1x', () => { SLOW.k = 1; }); L('0.25x', () => { SLOW.k = 0.25; }); L('0.1x', () => { SLOW.k = 0.1; });
  L('skeleton on/off', () => { skelOn = !skelOn; }); app.appendChild(panel);
}
function labPose(name) { cancelAim(); skeleton.cmd.walk = 0; skeleton.cmd.walkTo = null; respawn(); cat.spawnAt(-2.5, 0, 1); cat.M.rest = name; for (let i = 0; i < 70; i++) tick(1 / 60); }
function labAim(pw, deg = 55) { cancelAim(); labPose('sit'); updatePull(); const k = TUNE.pullMax * pw, a = deg * Math.PI / 180; pDown('lab', 187, 500); pMove('lab', 187 - Math.cos(a) * k * (TUNE.pullMaxPx / TUNE.pullMax), 500 + Math.sin(a) * k * (TUNE.pullMaxPx / TUNE.pullMax)); }
function labAimTo(pw, deg) { const k = TUNE.pullMax * pw, a = deg * Math.PI / 180; pMove('lab', 187 - Math.cos(a) * k * (TUNE.pullMaxPx / TUNE.pullMax), 500 + Math.sin(a) * k * (TUNE.pullMaxPx / TUNE.pullMax)); }
function labLeap(pw, drop, deg = 60, back = false) { cancelAim(); respawn(); for (let i = 0; i < 90; i++) tick(1 / 60); const a = (back ? 180 - deg : deg) * Math.PI / 180, L = pw * TUNE.pullMax; cat.plant(); cat.aim(Math.cos(a) * L, Math.sin(a) * L); for (let i = 0; i < 14; i++) tick(1 / 60); sim.leapPull(Math.cos(a) * L, Math.sin(a) * L); if (drop) { for (let i = 0; i < 25; i++) tick(1 / 60); sim.drop(); } }
function labTumble() { cancelAim(); respawn(); for (let i = 0; i < 90; i++) tick(1 / 60); const a = 150 * Math.PI / 180, L = TUNE.pullMax; cat.plant(); cat.aim(Math.cos(a) * L, Math.sin(a) * L); for (let i = 0; i < 14; i++) tick(1 / 60); sim.leapPull(Math.cos(a) * L, Math.sin(a) * L); }
function labWalk(dir) { cancelAim(); labPose('stand'); skeleton.cmd.walk = dir; }
function labTurn() { cancelAim(); skeleton.cmd.walk = 0; const f = cat.facing || 1; updatePull(); const k = TUNE.pullMax * 0.4 * (TUNE.pullMaxPx / TUNE.pullMax); pDown('lab', 187, 500); pMove('lab', 187 + f * k, 500 + 0.3 * k); setTimeout(() => cancelAim(), 700); }
function labSitStand() { cancelAim(); skeleton.cmd.walk = 0; cat.M.rest = cat.M.rest === 'sit' ? 'stand' : 'sit'; }
function labDraw() {
  if (!LAB.on) return; const cv = LAB.cv, c = LAB.ctx, r = rend.view.rect, w = Math.round(r.width), h = Math.round(r.height); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } c.clearRect(0, 0, w, h);
  const P = (x, y) => rend.clientFromWorld(x, y, 0, cwTmp), q = (x, y) => { const p = P(x, y); return [p.x - r.left, p.y - r.top]; };
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; const g0 = q(-20, 0), g1 = q(20, 0); c.beginPath(); c.moveTo(g0[0], g0[1]); c.lineTo(g1[0], g1[1]); c.stroke(); // the ground line
  if (!LAB.bones) return;
  c.lineWidth = 1; c.strokeStyle = 'rgba(255,200,0,.8)'; c.beginPath(); for (let i = 0; i < 13; i++) { const p = q(cat.x[i], cat.y[i]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke(); // (the sim's spine, thin yellow: what the drawing may differ from)
  const F = feel.active ? { x: feel.ox, y: feel.oy } : skeleton.active ? { x: skeleton.X, y: skeleton.Y } : { x: cat.x, y: cat.y }; c.lineWidth = 2; c.strokeStyle = '#fff'; c.beginPath(); for (let i = 0; i < 13; i++) { const p = q(F.x[i], F.y[i]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke();
  const cols = ['#e33', '#a00', '#37f', '#139']; const J = skeleton.J;
  if (skeleton.active) for (let l = 0; l < 4; l++) { const j = l * 8; c.strokeStyle = cols[l]; c.fillStyle = cols[l]; c.beginPath(); for (let k = 0; k < 4; k++) { const p = q(J[j + k * 2], J[j + k * 2 + 1]); k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke(); for (let k = 0; k < 4; k++) { const p = q(J[j + k * 2], J[j + k * 2 + 1]); c.beginPath(); c.arc(p[0], p[1], 3, 0, 7); c.fill(); } }
}
// ---------------------------------------------------------------- debug hooks
let SS = null;
const levelIndexOf = (n) => { if (typeof n === 'string') n = +n; const i = LEVELS.findIndex((l) => l.id === n); return i >= 0 ? i : Math.max(0, Math.min(LEVELS.length - 1, n | 0)); };
// client px (inside the frame) of a held pull, for the debug hooks: the pull vector is in pull units
const pxPerUnit = () => TUNE.pullMaxPx / TUNE.pullMax;
const GAME_API = {
  feel, cat, sim, props, tune: TUNE, renderer: rend.renderer, state, rend, respawn, progress, ui, fx,
  play: (n = 1) => playLevel(levelIndexOf(n), true), // a level id (1..16); ignores locks
  atlas: () => showAtlas(),
  levels: LEVELS,
  solutions: SOLUTIONS,
  setStars(id, stars, fit = 100, extra = {}) { progress.levels[id] = { done: true, stars, bestFit: fit, purrfect: false, menace: false, ...extra }; saveProgress(); },
  get perf() { return rend.perf; },
  get fps() { return rend.perf.fps; },
  debug: {
    // direct launch (world units per second): counts as a leap
    leap(vx, vy) { cancelAim(); const ok = sim.leap(vx, vy); if (ok) { audio.mrrp(0.6); ui.setCoach(false); fx.startTrail(); } return ok; },
    // hold an aim (pull vector in pull units) so the wind-up and the arc can be screenshotted; release() lets go. Goes through the real pointer path.
    aim(dx, dy) {
      cancelAim(); updatePull();
      const r = rend.canvas.getBoundingClientRect(), k = pxPerUnit(), sx = r.width * 0.5, sy = r.height * 0.62;
      pDown('dbg', sx, sy); pMove('dbg', sx - dx * k, sy + dy * k); // (screen y is down: a pull down launches up)
      updateAimVisuals(1 / 60);
      return launchVelocity(TUNE, dx, dy);
    },
    release() { if (aimSt.id === null) return false; pUp('dbg'); return true; },
    // a drag through the real pointer path (client px inside the frame)
    pointer(down, move, up) { if (dz.active) { if (up) dz.release(); else dz.beamAt((move || down)[0], (move || down)[1]); return 'dz'; } const id = 'dbg'; pDown(id, down[0], down[1]); if (move) pMove(id, move[0], move[1]); if (up) pUp(id); return id; },
    // a filmstrip of the pose around a contact: 6 frames before to 24 after (1/60 s apart), cropped to him. setup() starts the event; opts { w, h, yb, max }
    filmstrip(setup, opts = {}) {
      const R = rend, cv = canvas, frames = [], W = opts.w || 7, H = opts.h || 7; let contact = -1; setup(); frozen = true; let c0 = feel.count;
      for (let i = 0; i < (opts.max || 220); i++) {
        if (opts.onFrame) opts.onFrame(i);
        tick(1 / 60);
        updateAimVisuals(1 / 60); rend.render(0, feel.active ? feel.head : cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, camState); fx.update(0.0001, cat.head, false);
        let ly = 1e9, cx = 0, cyc = 0; for (let n = 0; n < cat.N; n++) { cx += cat.x[n]; cyc += cat.y[n]; if (cat.y[n] < ly) ly = cat.y[n]; } cx /= cat.N; cyc /= cat.N;
        const yb = opts.follow ? cyc - H / 2 : opts.yb !== undefined ? opts.yb : ly - 0.8, a = R.clientFromWorld(cx - W / 2, yb + H), b = R.clientFromWorld(cx + W / 2, yb), r0 = cv.getBoundingClientRect(), sc = cv.width / r0.width;
        const sx = (a.x - r0.left) * sc, sy = (a.y - r0.top) * sc, sw = (b.x - a.x) * sc, sh = (b.y - a.y) * sc, cell = document.createElement('canvas'); cell.width = cell.height = 125;
        const g = cell.getContext('2d'); g.fillStyle = '#e7f0ee'; g.fillRect(0, 0, 125, 125); g.drawImage(cv, sx, sy, sw, sh, 0, 0, 125, 125); const q = fx.canvas.width / cv.width; g.drawImage(fx.canvas, sx * q, sy * q, sw * q, sh * q, 0, 0, 125, 125); if (LAB.on && LAB.bones) g.drawImage(LAB.cv, sx / sc, sy / sc, sw / sc, sh / sc, 0, 0, 125, 125);
        frames.push(cell); if (contact < 0 && feel.count > c0 && (!opts.kind || feel.lastKind === opts.kind) && feel.lastS >= (opts.minS || 0)) contact = frames.length - 1; else if (contact < 0 && feel.count > c0) c0 = feel.count; if (contact >= 0 && frames.length > contact + 28) break;
      }
      const st = Math.max(0, (contact < 0 ? frames.length - 36 : contact) - 8), out = document.createElement('canvas'); out.width = 750; out.height = 750; const g = out.getContext('2d');
      for (let i = 0; i < 36; i++) { const fr = frames[st + i]; if (!fr) break; g.drawImage(fr, (i % 6) * 125, Math.floor(i / 6) * 125); g.fillStyle = '#000'; g.font = '10px monospace'; g.fillText(String(i - 8), (i % 6) * 125 + 3, Math.floor(i / 6) * 125 + 11); }
      let img = document.getElementById('sheet') || document.createElement('img'); img.id = 'sheet'; img.style.cssText = 'position:fixed;left:0;top:0;width:375px;z-index:9999'; img.src = out.toDataURL(); document.body.appendChild(img);
      return { contact, n: frames.length, impacts: feel.count - c0 };
    },
    // a contact sheet of a motion: run setup(), then every `every` ticks (1/60 s each) draw him, cropped to a w x h world box that follows his centroid (or fixed at `box` [x0, y0]); cells are n total. onTick(i) runs before each tick. The sheet is shown over the page (click to dismiss).
    film(opts = {}) {
      const R = rend, cv = canvas, n = opts.n || 12, every = opts.every || 3, W = opts.w || 8, H = opts.h || 6.5, cols = opts.cols || 4, cs = opts.cell || 180, cells = [];
      const was = frozen; frozen = true; if (opts.setup) opts.setup();
      for (let i = 0; i < n * every + (opts.skip || 0); i++) {
        if (opts.onTick) opts.onTick(i);
        tick(1 / 60);
        if (i < (opts.skip || 0) || (i - (opts.skip || 0)) % every !== every - 1) { if (i >= (opts.skip || 0) && 0) continue; continue; }
        updateAimVisuals(1 / 60); rend.render(0, cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, camState); fx.update(0.0001, cat.head, false);
        let cx = 0, cyc = 0, bx = skeleton.active ? skeleton.X : cat.x, by = skeleton.active ? skeleton.Y : cat.y; for (let k = 0; k < 13; k++) { cx += bx[k]; cyc += by[k]; } cx /= 13; cyc /= 13;
        const x0 = opts.box ? opts.box[0] : cx - W / 2, y0 = opts.box ? opts.box[1] : Math.max(-0.5, cyc - H / 2), a = R.clientFromWorld(x0, y0 + H), b = R.clientFromWorld(x0 + W, y0), r0 = cv.getBoundingClientRect(), sc = cv.width / r0.width;
        const sx = (a.x - r0.left) * sc, sy = (a.y - r0.top) * sc, sw = (b.x - a.x) * sc, sh = (b.y - a.y) * sc, cell = document.createElement('canvas'); cell.width = cs; cell.height = Math.round(cs * H / W);
        const g = cell.getContext('2d'); g.fillStyle = '#e7f0ee'; g.fillRect(0, 0, cell.width, cell.height); g.drawImage(cv, sx, sy, sw, sh, 0, 0, cell.width, cell.height); const q = fx.canvas.width / cv.width; g.drawImage(fx.canvas, sx * q, sy * q, sw * q, sh * q, 0, 0, cell.width, cell.height);
        if (LAB.on && LAB.bones) g.drawImage(LAB.cv, sx / sc, sy / sc, sw / sc, sh / sc, 0, 0, cell.width, cell.height);
        g.fillStyle = '#000'; g.font = 'bold 11px monospace'; g.fillText(((i + 1) / 60).toFixed(2) + 's ' + (skeleton.clip || '') + (opts.label ? ' ' + opts.label : ''), 3, 12);
        cells.push(cell);
      }
      const rows = Math.ceil(cells.length / cols), ch = cells[0].height, out = document.createElement('canvas'); out.width = cols * cs; out.height = rows * ch; const g2 = out.getContext('2d');
      cells.forEach((c, i) => { g2.drawImage(c, (i % cols) * cs, Math.floor(i / cols) * ch); g2.strokeStyle = '#999'; g2.strokeRect((i % cols) * cs, Math.floor(i / cols) * ch, cs, ch); });
      let img = document.getElementById('film') || document.createElement('img'); img.id = 'film'; img.style.cssText = 'position:fixed;left:0;top:0;width:375px;z-index:9999;background:#fff'; img.onclick = () => img.remove(); img.src = out.toDataURL(); document.body.appendChild(img);
      frozen = was; return { cells: cells.length };
    },
    // The sim/view consistency self-test: every level, every impact kind at strengths 0.3 and 1, then the stored replay line; every frame each DRAWN object must sit where the sim says
    // (within the documented presentation offsets, which must be back to zero once settled). Returns a table: [{ level, ok, issues }]
    selftest(onlyLevel) {
      const rows = [], was = frozen; frozen = true;
      const chk = (lv, issues, tag, loose) => {
        const P = rend.drawnProbe(), tolC = loose ? 0.45 : 0.02, tolS = loose ? 0.5 : 0.02, bad = (m) => { if (issues.length < 6) issues.push(`${tag}: ${m}`); };
        if (Math.abs(P.cont.x - sim.cx) > tolC) bad(`container x ${P.cont.x.toFixed(2)} vs sim ${sim.cx.toFixed(2)}`);
        if (Math.abs(P.cont.y - lv.container.y) > tolC) bad(`container y ${P.cont.y.toFixed(2)} vs level ${lv.container.y}`);
        P.shelves.forEach((v, k) => { if (Math.abs(v) > tolS) bad(`shelf ${k} offset ${v.toFixed(2)}`); });
        P.props.forEach((m, k) => { const q = props.list[k]; if (q && q.state !== 'gone' && m.v && (Math.abs(m.x - q.x) > 0.6 || Math.abs(m.y - q.y) > 0.6)) bad(`prop ${k} drawn ${m.x.toFixed(1)},${m.y.toFixed(1)} sim ${q.x.toFixed(1)},${q.y.toFixed(1)}`); });
        P.treats.forEach((m, k) => { const t = sim.treats[k]; if (t && !t.got && m.v && (Math.abs(m.x - t.x) > 0.01 || Math.abs(m.y - t.y) > 0.4)) bad(`treat ${k} drawn ${m.x.toFixed(2)},${m.y.toFixed(2)} sim ${t.x},${t.y}`); });
        P.toys.forEach((m, k) => { const t = sim.toys[k]; if (t && m.v && (Math.abs(m.x - t.x) > 1.2 || Math.abs(m.y - t.y) > 7)) bad(`toy ${k} drawn ${m.x.toFixed(1)},${m.y.toFixed(1)} sim ${t.x.toFixed(1)},${t.y.toFixed(1)}`); });
        // the drawn body against the sim: the spine centroid of what is drawn (the animator's body) must sit near the sim's: within 0.6 in flight, 2.0 on the ground (his pose, a sit or a stand, is not the sim's low-slung rig)
        if (!(cat.swirlT > 0.45) && !feel.active && skeleton.active) { let sx = 0, sy = 0, dx = 0, dy = 0; for (let i = 0; i < 13; i++) { sx += cat.x[i]; sy += cat.y[i]; dx += skeleton.X[i]; dy += skeleton.Y[i]; } const d = Math.hypot((sx - dx) / 13, (sy - dy) / 13), tol = skeleton.src === 2 ? 0.7 : 2.4; if (d > tol) bad(`drawn spine centroid ${(dx / 13).toFixed(1)},${(dy / 13).toFixed(1)} vs sim ${(sx / 13).toFixed(1)},${(sy / 13).toFixed(1)} (${skeleton.clip})`); }
        if (!Number.isFinite(P.body.x) || !Number.isFinite(P.cont.x)) bad('NaN in a drawn position');
      };
      const frame = () => { tick(1 / 60); rend.render(0, feel.active ? feel.head : cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, camState); };
      for (let li = 0; li < LEVELS.length; li++) {
        if (onlyLevel && LEVELS[li].id !== onlyLevel) continue;
        const lv = LEVELS[li], issues = []; playLevel(li, true); for (let i = 0; i < 60; i++) frame(); chk(lv, issues, 'start', false);
        for (const kind of ['floor', 'shelf', 'wall', 'rim', 'cushion']) for (const s of [0.3, 1]) {
          window.GAME.debug.impact(kind, s); for (let i = 0; i < 40; i++) { frame(); chk(lv, issues, `${kind} ${s} t${i}`, true); }
          const cnt0 = feel.count; for (let i = 0; i < 120; i++) frame(); // settle
          if (feel.maxOffset() > 0.02 && !cat.kicking && cat.mode !== "air" && feel.count === cnt0) issues.push(`${kind} ${s}: presentation offsets not back to zero (${feel.maxOffset().toFixed(3)})`);
          chk(lv, issues, `${kind} ${s} settled`, false);
        }
        const sol = SOLUTIONS[lv.id];
        if (sol) { window.GAME.debug.replay(lv.id); let n = 0; while (state.phase !== 'win' && n < 1500) { frame(); n++; if (n % 6 === 0) chk(lv, issues, `replay f${n}`, true); } if (state.phase !== 'win') issues.push('stored replay did not win'); }
        rows.push({ level: lv.id, ok: issues.length === 0, issues: issues.slice(0, 4) });
      }
      frozen = was; return rows;
    },
    // ---- feel-layer tools: fire a reaction in place, slow motion, and a repeatable throw at a surface
    impact(kind = 'floor', s = 0.6) {
      const lo = lowest(), n = { floor: [0, 1], shelf: [0, 1], cushion: [0, 1], containerFloor: [0, 1], rim: [0.2, 0.98], wall: [-1, 0], ceiling: [0, -1] }[kind] || [0, 1];
      cat.impacts.push({ kind, x: kind === 'wall' ? (cat.x[0] > 0 ? 9 : -9) : lo.x, y: kind === 'ceiling' ? cat.top : lo.y, nx: kind === 'wall' && cat.x[0] > 0 ? 1 : n[0], ny: n[1], speed: s * 30, tan: 0, tanSign: 1, part: kind === 'wall' || kind === 'ceiling' ? 'head' : 'paws', secondary: false, t: cat.time });
      if (kind === 'wall' && cat.x[0] > 0) cat.impacts[cat.impacts.length - 1].nx = -1;
      return true;
    },
    lab(on = true) { if (on) labStart(); return LAB.on; },
    labApi: { level: (id) => { playLevel(levelIndexOf(id), true); state.phase = 'play'; }, freeze: (ph = -1) => { skeleton.cmd.freeze = ph; }, aimTo: (p, d) => labAimTo(p, d), release: () => pUp('lab'), pose: (n) => labPose(n), aim: (p, d) => labAim(p, d), leap: (p, d, deg, back) => labLeap(p, d, deg, back), tumble: () => labTumble(), walk: (d) => labWalk(d), turn: () => labTurn(), sitStand: () => labSitStand(), bones: (b) => { LAB.bones = b; }, skeleton: (b) => { skelOn = b; }, sk: skeleton },
    slow(k = 1) { SLOW.k = Math.max(0.02, Math.min(1, k)); return SLOW.k; },
    // throw him at a surface: speed (units/s), angle from the surface normal in degrees (0 = straight in), surface 'floor' | 'shelf' | 'wall' | 'ceiling'
    landTest(speed = 20, angleDeg = 0, surface = 'floor') {
      cancelAim(); feel.reset(); feel.stopLeft = 0; feel.stopCool = 0;
      if (surface === 'wall' || surface === 'ceiling') { // a real leap from a stand-off, so he flies head-first like in play: wall = a flat shot off level 8's floor, ceiling = straight up
        playLevel(levelIndexOf(surface === 'wall' ? 8 : 1), true); for (let i = 0; i < 160; i++) tick(1 / 60);
        const a = (surface === 'wall' ? 38 + angleDeg : 90 - angleDeg) * Math.PI / 180, v = Math.min(speed, TUNE.leapSpeedMax * 1.0);
        const vx = Math.cos(a) * v * (surface === 'wall' ? -1 : 1), vy = Math.sin(a) * v; return { ok: sim.leap(vx, vy), vx, vy };
      }
      if (surface === 'shelf') playLevel(levelIndexOf(2), true);
      const a = angleDeg * Math.PI / 180, dt = 1 / 60, T0 = 0.22, vx = speed * Math.sin(a), vy = -speed * Math.cos(a);
      const sy = surface === 'shelf' ? LEVELS[lvIndex].platforms[0].y : 0, sx = surface === 'shelf' ? LEVELS[lvIndex].platforms[0].x : -6.5, X = sx - vx * T0, Y = sy + 1.4 - vy * T0;
      cat.spawn(X, Math.max(0.3, Y - 1.4), { dir: vx >= 0 ? 1 : -1, pose: 'stand' });
      for (let i = 0; i < cat.N; i++) { cat.px[i] = cat.x[i] - vx * dt; cat.py[i] = cat.y[i] - vy * dt; }
      cat.M.leaping = false; cat.M.leapT = 0; cat.M.airT = 1; cat.M.vxc = vx; cat.M.vyc = vy; cat.M.comVy = cat.M.comVy1 = cat.M.comVy2 = vy;
      return { X, Y, vx, vy };
    },
    drop() { return doDrop(); },
    // fire a signature moment for looking at: 'lickies' | 'kickies' | 'swirlies' | 'destroyies'
    moment(id) {
      if (id === 'lickies') { cancelAim(); cat.startLick && cat.startLick(); return cat.licking; }
      if (id === 'kickies') { // a toy appears in his paws wherever he is (or the level's own first toy is grabbed)
        cancelAim(); cat.M.leaping = true; if (cat.kicking) return true;
        if (!sim.toys.length) { playLevel(levelIndexOf(17), true); for (let i = 0; i < 60; i++) tick(1 / 60); } // (this level has no toy: use the first toy level)
        const t = sim.toys[0], lp = cat.launchPoint({});
        t.x = lp.x; t.y = lp.y; t.state = 'live';
        return cat.kickStart(t.x, t.y) && (t.state = 'held', sim.kickToy = 0, sim.kicks++, sim.events.push({ type: 'kickies', x: t.x, y: t.y }), true);
      }
      if (id === 'swirlies') { sim.completeTreats = 3; state.phase = 'win'; state.winT = 0.01; state.swirl = 0.0001; cat.setRelaxed(true); audio.swirl(); ui.callout('Swirlies', headClient().x, headClient().y - 40); recordMoment('swirlies'); return true; }
      if (id === 'destroyies') { startDestroyies(); return true; }
      return false;
    },
    destroyies() { startDestroyies(); return dz; },
    dzPointer(x, y, down = true) { if (down) dz.beamAt(x, y); else dz.release(); },
    dz,
    freeze(on = true) { frozen = on; },
    // play the stored 3-star line of a level (by index or id) from the start, one sim step per frame
    replay(i = lvIndex) {
      const idx = levelIndexOf(i), lv = LEVELS[idx], sol = SOLUTIONS[lv.id];
      if (!sol) return false;
      playLevel(idx, true);
      replayAcc = 0; ui.setCoach(false);
      replay = playLine(sim, sol.line, WARM_FRAMES, false);
      return true;
    },
    // snap him into a pose on the floor and render it (pose(null) lets him go)
    pose(name, x = 0, facing = 1, bare = false) { if (bare) cat.clearContainer(); if (name) cat.snap(name, x, facing); else cat.setPose(null); rend.render(0, cat.head, null, cat.annoyance); },
    // run the frame logic synchronously (useful when rAF is throttled, e.g. a hidden tab)
    advance(seconds, render = true) {
      const n = Math.round(seconds * 60);
      if (dz.active) { for (let i = 0; i < n; i++) dz.step(1 / 60); return; } // (the bonus round steps by hand too)
      for (let i = 0; i < n; i++) tick(1 / 60);
      if (render) { updateAimVisuals(1 / 60); rend.render(0, cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, camState); fx.update(0.0001, cat.head, false); }
    },
    // contact sheets: stripStart(box [x0, y0, x1, y1] in world units, columns, cell width px), stripShot(label) any number of times, stripShow()
    stripStart(box = [-9, -0.6, 9, 31], cols = 4, cellW = 200) { SS = { box, cols, cellW, shots: [] }; },
    stripShot(label = '') {
      if (!SS) return;
      updateAimVisuals(1 / 60); rend.updateProps(props.list); rend.updateTreats(sim.treats, cat.time); rend.updateCucumbers(sim.cucumbers); rend.updateToys(sim.toys, cat.time); rend.render(0, cat.head, cat.gaze.on ? cat.gaze : null, cat.annoyance, camState);
      const a = rend.clientFromWorld(SS.box[0], SS.box[3]), b = rend.clientFromWorld(SS.box[2], SS.box[1]), r0 = canvas.getBoundingClientRect(), sc = canvas.width / r0.width;
      const sx = (a.x - r0.left) * sc, sy = (a.y - r0.top) * sc, sw = (b.x - a.x) * sc, sh = (b.y - a.y) * sc;
      const cv = document.createElement('canvas'); cv.width = SS.cellW; cv.height = Math.round(SS.cellW * sh / sw);
      const c = cv.getContext('2d'); c.drawImage(canvas, sx, sy, sw, sh, 0, 0, cv.width, cv.height); { const q = fx.canvas.width / canvas.width; c.drawImage(fx.canvas, sx * q, sy * q, sw * q, sh * q, 0, 0, cv.width, cv.height); }
      c.font = 'bold 13px monospace'; c.fillStyle = '#000'; c.fillText(label, 4, 14);
      SS.shots.push(cv);
    },
    stripShow() {
      if (!SS || !SS.shots.length) return;
      const n = SS.shots.length, cols = Math.min(SS.cols, n), rows = Math.ceil(n / cols), cw = SS.shots[0].width, ch = SS.shots[0].height;
      const out = document.createElement('canvas'); out.width = cw * cols; out.height = ch * rows;
      const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
      SS.shots.forEach((s, i) => { c.drawImage(s, (i % cols) * cw, Math.floor(i / cols) * ch); c.strokeStyle = '#888'; c.strokeRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, ch); });
      let img = document.getElementById('strip-overlay');
      if (!img) { img = document.createElement('img'); img.id = 'strip-overlay'; img.style.cssText = 'position:fixed;left:0;top:0;width:100%;z-index:1000;background:#fff'; img.onclick = () => img.remove(); document.body.appendChild(img); }
      img.src = out.toDataURL('image/png');
    },
    stats() {
      const lv = LEVELS[lvIndex], A = cat.anchor;
      return { level: lv.id, mode: cat.mode, fit: cat.fitPct(cat.fit), leaps: sim.leaps, par: lv.par, knocked: props.knocked, props: props.total, stars: sim.complete ? sim.stars() : 0, treats: sim.treatsGot, drop: !!cat.dropped, drops: sim.drops, phase: state.phase, simMs: rend.perf.simMs, complete: sim.complete, anchor: { x: A.hx, y: A.ay, on: A.on, planted: A.planted }, perch: { frozen: cat.frozen, onContainer: cat.frozenOnContainer, canAim: cat.canAim, kicking: cat.kicking, licking: cat.licking, swirl: cat.swirlT || 0 }, menace: progress.menace, moments: progress.moments };
    },
  },
};

if (DEBUG || QS.has('lab')) window.GAME = GAME_API; // (the debug hooks only exist with ?debug)
ui.setHeader(`${LEVELS[lvIndex].id}. ${LEVELS[lvIndex].name}`, LEVELS[lvIndex].hint);
if (QS.has('lab')) { playLevel(0, true); setTimeout(labStart, 50); } else if (!QS.has('l')) goTitle(); else playLevel(lvIndex, true);
for (let i = 0; i < 4; i++) tick(1 / 60); // (draw a first frame at once: a throttled or hidden tab still shows the room, not a flat canvas)

// ---------------------------------------------------------------- robustness: pause when hidden, no zoom / scroll / callouts, upright card
let hiddenPaused = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenPaused = true; frozen = true; audio.laser(false); audio.suspend(); }
  else { ui.flushWipe(); if (hiddenPaused) { hiddenPaused = false; frozen = false; last = performance.now(); audio.resume(); } }
});
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.atlas, .moment-grid')) e.preventDefault(); }, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTap = 0;
document.addEventListener('touchend', (e) => { const t = performance.now(); if (t - lastTap < 320) e.preventDefault(); lastTap = t; }, { passive: false });
document.addEventListener('selectstart', (e) => e.preventDefault());
requestAnimationFrame(frame);

// ---------------------------------------------------------------- robustness: loading screen, lost WebGL context, an error boundary, offline play
{
  const boot = document.getElementById('boot'), oops = document.getElementById('oops');
  const hideBoot = () => { if (boot && !boot.classList.contains('out')) { boot.classList.add('out'); setTimeout(() => boot.remove(), 400); } };
  Promise.race([document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]).then(() => { requestAnimationFrame(() => requestAnimationFrame(hideBoot)); setTimeout(hideBoot, 700); }); // (the timer too: a hidden tab has no animation frames)
  const fail = (msg) => { if (!oops || oops.style.display === 'flex') return; document.getElementById('oops-t').textContent = msg; oops.style.display = 'flex'; };
  if (oops) document.getElementById('oops-b').onclick = () => location.reload();
  let errs = 0; window.addEventListener('error', () => { if (++errs >= 3) fail('Something went wrong.'); }); window.addEventListener('unhandledrejection', () => { if (++errs >= 3) fail('Something went wrong.'); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); frozen = true; fail('Graphics were interrupted.'); });
  canvas.addEventListener('webglcontextrestored', () => { if (oops) oops.style.display = 'none'; frozen = false; last = performance.now(); phoebus.tex.needsUpdate = true; rend.resize(true); });
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
