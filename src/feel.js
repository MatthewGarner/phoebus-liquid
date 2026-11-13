// The FEEL layer: a presentation-only secondary-motion layer. The sim reports impact events (cat.impacts, with the contact point, normal, speed and which
// part hit); everything here (springs, squash, wobble, hit-stop, camera and world reactions) lives on the game/render side and NEVER writes sim state.
// No three/DOM imports: it runs in node for simtest.
import { K, NT, LEG0, HIPS } from './cat.js';

const TAU = 6.283185307;
const N = LEG0 + 8;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sp = () => ({ x: 0, v: 0 });
// a damped spring toward `target` (semi-implicit Euler, substepped: stable at any frame time)
function stepSp(s, dt, hz, z, target = 0) {
  const w = TAU * hz, n = Math.min(8, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (-w * w * (s.x - target) - 2 * z * w * s.v) * h; s.x += s.v * h; }
}

export function createFeel(T) {
  const I = T.impact;
  const F = {
    active: false, energy: 0, count: 0,
    ox: new Float32Array(N), oy: new Float32Array(N), or: new Float32Array(N), // the deformed nodes, for rendering
    head: { x: 0, y: 0, angle: 0 },
    // body springs
    sqF: sp(), sqH: sp(), lean: sp(), skid: sp(), headLag: sp(), tailSw: sp(), belly: sp(), st: sp(), spread: sp(), pn: sp(),
    slosh: sp(), fold: sp(), tailA: sp(), headA: sp(), headQ: 0, headQs: 0, popT: 0, sloshDir: 1, foldSide: 1,
    appr: { w: 0, surf: 0, tx: 0 }, tuckW: 0,          // the landing reach (0..1 over the last 0.18 s before a predicted contact) and the apex tuck
    cont: { on: false, x: 0, base: 0 },                // the container he is in (so its rock carries him)
    hindQ: 0, hindS: 0, pnHold: 0, pnPeak: 0,
    pivX: 0, pivY: 0, nx: 0, ny: 1, // where the body is squashed about, and along which direction
    ripA: 0, ripE: 0, ripT: 9, ripI: 6,
    stretchDx: 1, stretchDy: 0,
    flash: 0,                        // the 1-frame white rim flash, in frames left
    // hit-stop
    stopLeft: 0, stopCool: 0, stopTotal: 0,
    // camera (CSS px and a zoom factor)
    camX: sp(), camY: sp(), camZ: sp(),
    // the world
    shelf: [], cRock: sp(), cSq: sp(), toySway: sp(),
    reduced: false, t: 0,
    // events the game layer should react to this step (cleared by the caller)
    out: { ear: 0, tail: 0, dustFeet: 0, dustS: 0, lines: null },
  };
  F.shelf.push(sp(), sp(), sp(), sp(), sp(), sp());
  const strength = (speed) => clamp(speed / 30, 0, 1);

  // what the sim reported. Returns the hit-stop to take, in frames.
  F.onImpact = (e, container) => {
    const s = strength(e.speed);
    if (e.kind === 'containerFloor' && (e.speed < 7 || e.ny < 0.4)) return 0;
    if (e.kind === 'containerFloor' && F.cont.on) { F.slosh.v += TAU * 2.8 * 0.5 * s * (e.x >= F.cont.x ? -1 : 1); F.cSq.v += 0.1 * s * TAU * 4; }
    if (s < 0.08) return 0;
    const reduce = F.reduced ? 0.4 : 1;
    F.out.lines = e; F.out.strength = s; F.count++; F.lastKind = e.kind; F.lastS = s; F.hit = (F.hit | 0) + 1;
    const kick = (spring, hz, a) => { spring.v += a * TAU * hz; };
    const feet = e.kind === 'floor' || e.kind === 'shelf' || e.kind === 'cushion' || e.kind === 'containerFloor' || (e.kind === 'rim' && e.ny > 0.5);
    let stop = 0;
    if (feet && !e.secondary) {
      F.pivX = e.x; F.pivY = e.y; F.nx = 0; F.ny = 1;
      kick(F.sqF, I.springHz, I.maxSquash * s * 1.05);             // front paws and shoulders plant first...
      F.hindQ = I.hindDelay; F.hindS = s;                           // ...the hips arrive a few frames later
      kick(F.belly, I.springHz, 0.25 * s);
      kick(F.headLag, I.springHz * 0.8, 0.6 * s);
      kick(F.tailSw, 2.6, 1.8 * s); F.tailA.v += TAU * 2.2 * (0.9 * s) * -(e.tanSign || 1) * 0 + TAU * 2.2 * 1.1 * s * (e.tanSign || 1); // the tail whips forward over his back, then swings back
      F.headQ = 0.05; F.headQs = s; // the head dips on its own spring a few frames after the shoulders
      F.skid.v += Math.sign(e.tanSign || 1) * Math.min(I.skidMax, e.tan * 0.05) * 6;
      kick(F.lean, 3, clamp(e.tan * 0.012, 0, 0.35) * -(e.tanSign || 1));
      F.out.dustFeet = s; F.out.dustS = e.tan;
      F.out.ear = s;
    } else if (feet) { // the hips arriving after the paws
      kick(F.sqH, I.springHz, I.maxSquash * s * 0.8); kick(F.belly, I.springHz, 0.2 * s);
    } else if (e.kind === 'wall' || e.kind === 'ceiling') { // face first: a pancake against the surface, held through the hit-stop
      F.pivX = e.x; F.pivY = e.y; F.nx = e.nx; F.ny = e.ny;
      const glance = clamp(e.speed / Math.max(1, e.speed + e.tan), 0, 1);
      F.pnPeak = I.bonkSquash * s * (0.4 + 0.6 * glance) * (e.part === 'hips' ? 0.6 : 1);
      F.pn.x = F.pnPeak; F.pn.v = 0; F.pnHold = s > 0.35 ? 0.1 + 0.08 * s : 0.03;
      kick(F.spread, 4, 0.4 * s); kick(F.headLag, 3, 0.8 * s); kick(F.tailSw, 2.6, 1.4 * s);
      F.out.ear = s;
    } else if (e.kind === 'rim') { // he folds over the rim
      F.pivX = e.x; F.pivY = e.y; F.nx = e.nx; F.ny = e.ny;
      F.pnPeak = I.bonkSquash * 0.25 * s; F.pn.x = F.pnPeak; F.pn.v = 0; F.pnHold = 0.02;
      F.foldSide = e.x >= F.cont.x ? 1 : -1; F.fold.v += TAU * 1.5 * 0.55 * s; F.foldPx = e.x; F.foldPy = e.y; // he drapes over the rim: inside half sags, outside half dangles and swings
      kick(F.tailSw, 2.6, 1.0 * s); F.tailA.v += TAU * 2.2 * 0.8 * s;
    }
    // the ripple runs down the spine from the contact point
    F.ripA = Math.max(F.ripA * 0.5, I.rippleAmp * s); F.ripT = 0;
    F.ripI = e.part === 'head' ? 0 : e.part === 'chest' ? 3 : e.part === 'hips' ? 11 : 6;
    // world
    F.out.world = { kind: e.kind, s, x: e.x, y: e.y };
    // camera: one shove along the normal and a recoil (a spring, not jitter)
    if (!F.reduced) {
      const px = I.camMaxPx * s;
      F.camX.v += -e.nx * px * TAU * I.camHz * 0.9; F.camY.v += e.ny * px * TAU * I.camHz * 0.9;
      if (s > 0.6) F.camZ.v += I.camZoom * TAU * I.camHz * 0.9 * s;
    }
    // hit-stop
    if (F.stopCool <= 0 && !e.secondary) {
      stop = s >= 0.6 ? I.stopHeavy : s >= 0.35 ? I.stopMed : 0;
      if ((e.kind === 'wall' || e.kind === 'ceiling') && s >= 0.8) stop = I.stopMax;
      stop = Math.round(stop * reduce); if (stop) { F.stopCool = I.stopCool; F.flash = 1; }
    }
    return stop;
  };
  // the DROP splat: a full pancake held, then a springy re-inflate
  F.onSplat = () => {
    F.nx = 0; F.ny = 1; F.pnPeak = I.splatSquash; F.pn.x = I.splatSquash; F.pn.v = 0; F.pnHold = I.splatHold * (F.reduced ? 0.5 : 1);
    F.spread.x = 0.5; F.spread.v = 0; F.ripA = I.rippleAmp * 1.2; F.ripT = 0; F.ripI = 6; F.out.ear = 1;
    if (!F.reduced) { F.camY.v += I.camMaxPx * TAU * I.camHz; F.camZ.v += I.camZoom * TAU * I.camHz; }
    F.flash = 1; F.stopLeft = Math.max(F.stopLeft, F.reduced ? 3 : I.stopMax); F.stopCool = I.stopCool; F.stopTotal += F.stopLeft;
  };
  F.onLeap = (vx, vy) => { // crouch is already in the pose; the explosive stretch along the launch direction
    const l = Math.hypot(vx, vy) || 1; F.stretchDx = vx / l; F.stretchDy = vy / l;
    F.st.x = I.launchStretch; F.st.v = 0; F.sqF.x = F.sqF.v = F.sqH.x = F.sqH.v = 0; F.pn.x = F.pn.v = 0; F.pnHold = 0;
    F.tailSw.v += 2.5 * (vx > 0 ? -1 : 1);
  };
  // pouring / dropping into a container: his mass piles into the bottom, rides up the far wall (the side he was travelling toward), swings back lower, settles
  F.onPour = (vx, vy, dropped) => {
    const sp0 = Math.hypot(vx, vy), s = clamp(sp0 / 26, 0.25, 1) * (dropped ? 1.5 : 1), d = vx >= 0 ? 1 : -1;
    F.count++; F.lastKind = 'pour'; F.lastS = s; F.sloshDir = d; F.slosh.v += TAU * 2.8 * (0.55 * s) * d;
    F.sqF.v += TAU * I.springHz * 0.1 * s; F.sqH.v += TAU * I.springHz * 0.12 * s; F.belly.v += TAU * 5 * 0.2 * s;
    F.ripA = Math.max(F.ripA, I.rippleAmp * 0.9 * s); F.ripT = 0; F.ripI = 2;
    F.cRock.v += I.containerRock * s * (dropped ? 1.8 : 1) * -d * TAU * 4; F.cSq.v += 0.07 * s * TAU * 4;
    F.popT = 0.5; F.out.ear = 0.4 * s; F.pourS = s;
    if (!F.reduced) F.camY.v += I.camMaxPx * 0.5 * s * TAU * I.camHz * 0.9;
    return s;
  };
  F.onShelf = (i, s) => { if (F.shelf[i]) F.shelf[i].v += I.shelfDip * s * TAU * 3.2 * 1.1; };
  F.onContainer = (s, side) => { F.cRock.v += I.containerRock * s * side * TAU * 4; F.cSq.v += 0.08 * s * TAU * 4; };
  F.onWorldHit = (s) => { F.toySway.v += 0.08 * s * TAU * 1.5; }; // (a hanging toy sways a little: at most ~0.5 units, so the drawn toy never strays far from the one he can grab)

  // advance by dt (the caller does not call this during a hit-stop: the pose is held)
  F.update = (dt, cat) => {
    F.t += dt; F.stopCool -= dt;
    if (F.hindQ > 0) { F.hindQ -= dt; if (F.hindQ <= 0) { F.sqH.v += I.maxSquash * F.hindS * TAU * I.springHz * 1.05; F.hindQ = 0; } }
    if (F.pnHold > 0) { F.pnHold -= dt; F.pn.x = F.pnPeak; F.pn.v = 0; } else stepSp(F.pn, dt, 4.2, 0.28);
    const z = I.springZeta;
    stepSp(F.sqF, dt, I.springHz, z); stepSp(F.sqH, dt, I.springHz * 0.95, z);
    stepSp(F.belly, dt, 5, 0.3); stepSp(F.lean, dt, 3, 0.35); stepSp(F.skid, dt, 2.2, 0.95); stepSp(F.headLag, dt, 4, 0.3);
    stepSp(F.tailSw, dt, 2.6, 0.3); stepSp(F.spread, dt, 4, 0.4);
    // in flight he stretches along his velocity (scaled by speed); otherwise the stretch springs back to nothing
    let stT = 0;
    if (cat && cat.mode === 'air' && cat.M && cat.M.leaping && !cat.kicking) {
      const vx = cat.M.vxc, vy = cat.M.vyc, sg = Math.hypot(vx, vy);
      if (sg > 4) { const k = 1 - Math.exp(-14 * dt); F.stretchDx += (vx / sg - F.stretchDx) * k; F.stretchDy += (vy / sg - F.stretchDy) * k; }
      stT = I.flightStretch * clamp(sg / 30, 0, 1);
    }
    stepSp(F.st, dt, 5, 0.55, stT);
    { const vy = cat && cat.M ? cat.M.vyc : 0, tg = cat && cat.mode === 'air' && cat.M.leaping && !cat.kicking && !cat.M.dropped && F.appr.w < 0.05 ? clamp(1 - Math.abs(vy) / 5, 0, 1) : 0; F.tuckW += (tg - F.tuckW) * (1 - Math.exp(-14 * dt)); } // the legs tuck at the top of the jump
    stepSp(F.camX, dt, I.camHz, I.camZeta); stepSp(F.camY, dt, I.camHz, I.camZeta); stepSp(F.camZ, dt, I.camHz, I.camZeta);
    stepSp(F.slosh, dt, 2.8, 0.22); stepSp(F.fold, dt, 1.5, 0.22); stepSp(F.tailA, dt, 2.2, 0.3); stepSp(F.headA, dt, 3.2, 0.25);
    if (F.headQ > 0) { F.headQ -= dt; if (F.headQ <= 0) { F.headA.v += TAU * 3.2 * 0.7 * F.headQs; F.headQ = 0; } }
    if (F.popT > 0) { F.popT -= dt; if (F.popT <= 0) { F.headA.v += -TAU * 3.2 * 0.35; F.out.ear = 0.9; F.popT = 0; } } // the head and ears pop up last
    stepSp(F.cRock, dt, 4.5, 0.18); stepSp(F.cSq, dt, 5, 0.25); stepSp(F.toySway, dt, 1.5, 0.35);
    for (let i = 0; i < F.shelf.length; i++) stepSp(F.shelf[i], dt, 3.2, 0.22);
    F.ripT += dt; F.ripE = F.ripA * Math.exp(-F.ripT / I.rippleTau); if (F.ripE < 0.002) { F.ripA = 0; F.ripE = 0; }
    if (F.flash > 0) F.flash -= dt * 60;
    let e = Math.abs(F.sqF.x) + Math.abs(F.sqH.x) + Math.abs(F.lean.x) + Math.abs(F.skid.x) + Math.abs(F.headLag.x) + Math.abs(F.tailSw.x) + Math.abs(F.belly.x) + Math.abs(F.st.x) + Math.abs(F.spread.x) + Math.abs(F.pn.x) + F.ripE + Math.abs(F.slosh.x) + Math.abs(F.fold.x) + Math.abs(F.tailA.x) + Math.abs(F.headA.x) + F.appr.w + F.tuckW;
    e += Math.abs(F.slosh.v) * 0.02 + Math.abs(F.fold.v) * 0.02 + Math.abs(F.tailA.v) * 0.02 + Math.abs(F.headA.v) * 0.02 + Math.abs(F.sqF.v) * 0.02 + Math.abs(F.sqH.v) * 0.02 + Math.abs(F.pn.v) * 0.02 + Math.abs(F.st.v) * 0.02;
    F.energy = e; F.active = e > 0.004 && !(cat && (cat.swirlT > 0.45 || cat.kicking));
    if (cat && F.cont.on && (Math.abs(F.cRock.x) > 0.002 || Math.abs(F.cSq.x) > 0.004) && !(cat.swirlT > 0.45)) F.active = true;
    // sanity: nothing may ever blow up
    if (!(e < 50)) F.reset();
  };
  F.reset = () => {
    for (const k of ['slosh', 'fold', 'tailA', 'headA', 'sqF', 'sqH', 'lean', 'skid', 'headLag', 'tailSw', 'belly', 'st', 'spread', 'pn', 'camX', 'camY', 'camZ', 'cRock', 'cSq', 'toySway']) { F[k].x = 0; F[k].v = 0; }
    for (const s of F.shelf) { s.x = 0; s.v = 0; }
    F.ripA = 0; F.ripE = 0; F.appr.w = 0; F.tuckW = 0; F.popT = 0; F.headQ = 0; F.pnHold = 0; F.hindQ = 0; F.energy = 0; F.active = false;
  };
  // the largest displacement left (for the settle test)
  F.maxOffset = () => Math.max(Math.abs(F.sqF.x), Math.abs(F.sqH.x), Math.abs(F.lean.x), Math.abs(F.skid.x), Math.abs(F.headLag.x), Math.abs(F.tailSw.x), Math.abs(F.belly.x), Math.abs(F.st.x), Math.abs(F.spread.x), Math.abs(F.pn.x), F.ripE, Math.abs(F.slosh.x), Math.abs(F.fold.x), Math.abs(F.tailA.x), Math.abs(F.headA.x), Math.abs(F.camX.x) / 10, Math.abs(F.camY.x) / 10, Math.abs(F.cRock.x), Math.abs(F.cSq.x), ...F.shelf.map((s) => Math.abs(s.x)));

  // the deformed nodes (ox, oy, or) from the rig's; the head for the face. Order: flight stretch, impact compress, lean, skid, secondary parts, ripple, starfish.
  // IK for a two-segment leg: the knee that puts the paw at P while the shoulder/hip is at A (segments of LEG_SEG), bending toward `side`
  const ikKnee = (ax, ay, pxx, pyy, side, out) => {
    let dx = pxx - ax, dy = pyy - ay, d = Math.hypot(dx, dy) || 1e-3; const L = 0.75, dd = Math.min(d, 2 * L - 0.02), h = Math.sqrt(Math.max(0, L * L - (dd / 2) * (dd / 2)));
    const ux = dx / d, uy = dy / d; let nx = -uy, ny = ux; if (nx * side < 0) { nx = -nx; ny = -ny; }
    out.x = ax + ux * dd / 2 + nx * h; out.y = ay + uy * dd / 2 + ny * h; out.d = d;
  };
  const kn = { x: 0, y: 0, d: 0 };
  // sx, sy, sr: the body to deform (default: the sim's rig). own: the animator drew this body (and its legs): no reach / tuck / leg IK here, the limbs are solved after the squash with the paws planted
  F.apply = (cat, sx, sy, sr, own) => {
    const x = sx || cat.x, y = sy || cat.y, r = sr || cat.r, ox = F.ox, oy = F.oy, or_ = F.or, face = cat.facing || 1;
    for (let i = 0; i < N && i < cat.N; i++) { ox[i] = x[i]; oy[i] = y[i]; or_[i] = r[i]; }
    let cx = 0, cy = 0; for (let i = 0; i < K; i++) { cx += x[i]; cy += y[i]; } cx /= K; cy /= K;
    const st = F.st.x, sdx = F.stretchDx, sdy = F.stretchDy, sqs = 1 / Math.sqrt(1 + Math.max(-0.5, st));
    const px = F.pivX, py = F.pivY, nx = F.nx, ny = F.ny, tx = -ny, ty = nx;
    const lean = F.lean.x, cl = Math.cos(lean), sl = Math.sin(lean);
    const ripOn = F.ripE > 0.002, rt = F.ripT, rdecay = ripOn ? Math.exp(-rt / I.rippleTau) : 0;
    const ptag = F.pnPeak, wa = own ? 0 : F.appr.w, wt = own ? 0 : F.tuckW;
    // ---- the body: spine and tail
    for (let i = 0; i < LEG0 && i < cat.N; i++) {
      let X = x[i], Y = y[i], R = r[i];
      const u = i < K ? i / (K - 1) : 1;
      if (st > 0.002 || st < -0.002) { const dx = X - cx, dy = Y - cy, a = dx * sdx + dy * sdy, bx = dx - a * sdx, by = dy - a * sdy; X = cx + sdx * a * (1 + st) + bx * sqs; Y = cy + sdy * a * (1 + st) + by * sqs; R *= sqs; }
      if (wa > 0.01) { // reaching for the landing: back arched, head up, tail raised for balance
        if (i < K) Y += 0.3 * wa * Math.sin(Math.PI * u) + (i <= 2 ? 0.12 * wa : 0); else Y += 0.9 * wa * ((i - K + 1) / NT);
      }
      const sq = clamp(F.sqF.x * (1 - u) + F.sqH.x * u, -0.3, 0.75) + (ptag > 0 ? clamp(F.pn.x, -0.3, 0.8) : 0);
      if (sq > 0.002 || sq < -0.002) {
        const dx = X - px, dy = Y - py, dn = dx * nx + dy * ny, dt_ = dx * tx + dy * ty, w = 1 / Math.sqrt(Math.max(0.3, 1 - sq)), sprd = 1 + F.spread.x * 0.2;
        X = px + nx * dn * (1 - sq) + tx * dt_ * w * sprd; Y = py + ny * dn * (1 - sq) + ty * dt_ * w * sprd; R *= w;
      }
      if (i >= 4 && i <= 10) R *= 1 + F.belly.x * 0.5;
      if (lean > 0.002 || lean < -0.002) { const dx = X - px, dy = Y - py; X = px + dx * cl - dy * sl; Y = py + dx * sl + dy * cl; }
      X += F.skid.x;
      ox[i] = X; oy[i] = Y; or_[i] = R;
    }
    // head dips on its own spring about the shoulders; the tail whips about the hips
    { const a = F.headA.x + F.headLag.x * 0.25, ca = Math.cos(a * -face), sa = Math.sin(a * -face), bx = ox[3], by = oy[3];
      if (a > 0.003 || a < -0.003) for (let i = 0; i <= 1; i++) { const dx = ox[i] - bx, dy = oy[i] - by; ox[i] = bx + dx * ca - dy * sa; oy[i] = by + dx * sa + dy * ca; } }
    { const a = F.tailA.x + F.tailSw.x * 0.2, ca = Math.cos(a * face), sa = Math.sin(a * face), bx = ox[HIPS], by = oy[HIPS];
      if (a > 0.003 || a < -0.003) for (let i = K; i < LEG0; i++) { const dx = ox[i] - bx, dy = oy[i] - by; ox[i] = bx + dx * ca - dy * sa; oy[i] = by + dx * sa + dy * ca; } }
    if (ripOn) for (let i = 0; i < K; i++) { const lag = Math.abs(i - F.ripI) * 0.4 / I.rippleSpeed, ph = rt - lag; if (ph > 0) or_[i] *= 1 + F.ripA * rdecay * Math.sin(TAU * I.rippleHz * ph) * Math.exp(-lag * 4); }
    // ---- the legs: planted paws, folding knees (a two-link IK), a reach before the landing, a tuck at the apex
    const sqL = clamp(Math.max(F.sqF.x, F.sqH.x), 0, 0.8), wc = clamp(sqL * 4, 0, 1) + (ptag > 0 ? 0 : 0), wIK = Math.max(wc, wa, wt);
    for (let l = 0; l < 4 && !own; l++) {
      const pi = LEG0 + l * 2 + 1, ki = LEG0 + l * 2, att = l < 2 ? 4 : 11, ax = ox[att], ay = oy[att], front = l < 2, outward = (l & 1) ? 1 : -1;
      let PX = x[pi] + F.skid.x, PY = y[pi], KX = x[ki] + F.skid.x, KY = y[ki];
      if (wt > 0.02) { PX += (ax + face * (front ? 0.55 : -0.25) - PX) * wt; PY += (ay - 0.6 - PY) * wt; }
      if (wa > 0.01) {
        if (front) { const gx = F.appr.tx + face * 0.4 - ax, gy = F.appr.surf + 0.3 - ay, gl = Math.hypot(gx, gy) || 1, rx = ax + gx / gl * 1.45, ry = ay + gy / gl * 1.45; PX += (rx - PX) * wa; PY += (ry - PY) * wa; }
        else { const hx = ax - face * (0.35 - 0.3 * wa), hy = ay - (0.55 + 0.5 * wa); PX += (hx - PX) * wa; PY += (hy - PY) * wa; }
      }
      if (wc > 0.02) { // planted: the paw stays on the surface (it does not sink), splayed a little; the body drops toward it
        const gy = py + or_[pi] ; if (PY < gy + 0.6) { PY = Math.max(gy, PY); PX += outward * 0.35 * wc * (front ? 1 : 1.2) + face * (front ? 0.25 : -0.1) * wc; }
      }
      if (wIK > 0.01) { ikKnee(ax, ay, PX, PY, front ? -face : face, kn); KX += (kn.x - KX) * wIK; KY += (kn.y - KY) * wIK; }
      else { KX = KX; }
      ox[pi] = PX; oy[pi] = PY; ox[ki] = KX; oy[ki] = KY;
    }
    // ---- he drapes over a rim: the two halves bend about the contact point (inside sags in, outside dangles and swings)
    if (F.fold.x > 0.004 || F.fold.x < -0.004) {
      const f = F.fold.x, sg = F.foldSide, fx = F.foldPx, fy = F.foldPy;
      for (let i = 0; i < N && i < cat.N; i++) {
        const out = sg * (ox[i] - fx) > 0, a = out ? -sg * f : sg * f * 0.5, c = Math.cos(a), s2 = Math.sin(a), dx = ox[i] - fx, dy = oy[i] - fy;
        ox[i] = fx + dx * c - dy * s2; oy[i] = fy + dx * s2 + dy * c;
      }
    }
    // ---- in a container: the slosh (mass up the far wall and back; the surface tilts like liquid in a tipped glass) and the container's own rock carries him
    if (F.cont.on) {
      const b = F.cont.base, cxx = F.cont.x, sl2 = F.slosh.x, a = F.cRock.x, sy = 1 - F.cSq.x, ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < N && i < cat.N; i++) {
        let X = ox[i], Y = oy[i];
        if (sl2 > 0.003 || sl2 < -0.003) { const h = Math.max(0, Y - b); X += sl2 * 0.45 * (h + 0.3) * 0.5; Y += sl2 * (X - cxx) * 0.32 * (h > 0.5 ? 1 : 0.4) - Math.abs(sl2) * 0.12 * (1 - Math.min(1, h / 3)); }
        Y = b + (Y - b) * sy; const dx = X - cxx, dy = Y - b; X = cxx + dx * ca - dy * sa; Y = b + dx * sa + dy * ca;
        ox[i] = X; oy[i] = Y;
      }
    }
    // the face follows the deformed head, and its tilt
    const h = F.head; h.x = ox[0]; h.y = oy[0];
    const a2 = Math.atan2(oy[0] - oy[1], ox[0] - ox[1]), a1 = Math.atan2(y[0] - y[1], x[0] - x[1]); let da = a2 - a1; da = Math.atan2(Math.sin(da), Math.cos(da)); h.angle = (own ? a1 : cat.head.angle) + da; h.vx = cat.head.vx; h.vy = cat.head.vy;
  };
  return F;
}
