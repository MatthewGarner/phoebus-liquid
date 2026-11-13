// node scripts/simtest.mjs : headless checks on the cat rig. Exits non-zero on failure.
import { createCat, K, N, L0, HEAD, HIPS, TAIL_TIP, TAIL0, LEG0, paw, knee } from '../src/cat.js';
import { TUNE as T } from '../src/tune.js';
import { CONTAINERS, ORDER, build, capacity } from '../src/containers.js';
import { createSim, launchVelocity, previewArc } from '../src/sim.js';
import { runLeg, DT as DT_ } from '../src/replay.js';
import { LEVELS } from '../src/levels.js';

if (process.env.TUNE_JSON) Object.assign(T, JSON.parse(process.env.TUNE_JSON)); // e.g. TUNE_JSON='{"toneContained":0}' node scripts/simtest.mjs
let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const TOP = 14.5, DT = 1 / 60;
let vinPrev = 0, measuredRise = 15;
let seed = +(process.env.SEED || 12345);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rnd; // deterministic
const now = () => performance.now();

function newCat(def, o = {}) {
  const c = createCat(T); c.top = TOP;
  if (def) c.setContainer(def);
  c.spawn(o.x ?? 0, (def ? c.rimY : 0) + T.dropAbove + 1.5, { dir: o.dir ?? 1, tilt: 0 });
  return c;
}
const spineLen = (c) => { let l = 0; for (let i = 0; i < K - 1; i++) l += Math.hypot(c.x[i + 1] - c.x[i], c.y[i + 1] - c.y[i]); return l; };
const REST = (K - 1) * L0;

// distance from a point to a capsule axis
function capDist(cp, X, Y) {
  const [ax, ay, bx, by] = cp, ex = bx - ax, ey = by - ay;
  const u = Math.max(0, Math.min(1, ((X - ax) * ex + (Y - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(X - ax - u * ex, Y - ay - u * ey);
}
// did the segment p->q cross the capsule's axis?
function crossed(cp, p0x, p0y, qx, qy) {
  const [ax, ay, bx, by] = cp, ex = bx - ax, ey = by - ay;
  const s1 = ex * (p0y - ay) - ey * (p0x - ax), s2 = ex * (qy - ay) - ey * (qx - ax);
  if (s1 * s2 >= 0) return false;
  const t = s1 / (s1 - s2), mx = p0x + (qx - p0x) * t, my = p0y + (qy - p0y) * t;
  const u = ((mx - ax) * ex + (my - ay) * ey) / (ex * ex + ey * ey);
  return u >= 0 && u <= 1;
}

// ------------------------------------------------------------------ 1. violent drags
console.log('violent drags (random fast drags of random nodes, through walls)');
for (const id of ORDER) {
  const def = CONTAINERS[id], B = build(def), c = newCat(def, { x: 0.5 });
  let draped = 0, soft = 0, nan = 0, deep = 0, tunnel = 0, limit = 0, oob = 0, maxDeep = 0, minSeg = 9, maxSeg = 0;
  const grabs = [];
  const pp = new Float32Array(N * 2);
  const FR = 1500;
  for (let f = 0; f < FR; f++) {
    if (f % 30 === 0) { // new random grab / retarget
      while (grabs.length && rnd() < 0.5) c.endGrab(grabs.pop().g);
      if (grabs.length < 2) { const i = Math.floor(rnd() * N), g = c.beginGrab(c.x[i], c.y[i]); if (g) grabs.push({ g, tx: 0, ty: 0 }); }
      for (const gr of grabs) { gr.tx = (rnd() - 0.5) * 11; gr.ty = rnd() * 13; }
    }
    for (const gr of grabs) {
      // very fast finger: jumps most of the way to the target each frame
      c.moveGrab(gr.g, gr.tx, gr.ty);
    }
    for (let i = 0; i < N; i++) { pp[i * 2] = c.x[i]; pp[i * 2 + 1] = c.y[i]; }
    c.step(DT);
    for (let i = 0; i < N; i++) {
      const X = c.x[i], Y = c.y[i];
      if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(c.r[i])) nan++;
      if (Math.abs(X) > T.roomHalfW + 0.01 || Y < -0.01 || Y > TOP + 0.01) oob++;
      let bad = false;
      for (const cp of B.capsules) {
        const dist = capDist(cp, X, Y), pen = (cp[4] + c.r[i]) - dist;
        if (pen > maxDeep) maxDeep = pen;
        if (dist < cp[4] * 0.5) { deep++; bad = true; } // the node's centre is more than half way into the wall body
        if (!bad && crossed(cp, pp[i * 2], pp[i * 2 + 1], X, Y)) tunnel++;
      }
    }
    for (let i = 0; i < K - 1; i++) {
      const d = Math.hypot(c.x[i + 1] - c.x[i], c.y[i + 1] - c.y[i]) / L0;
      if (d > T.spineMax * 1.03 || d < T.spineMin * 0.97) {
        // two fat nodes straddling a thin wall (a cat hooked over a rim) cannot be within the limit: counted separately
        let drape = false;
        for (const cp of B.capsules) if (crossed(cp, c.x[i], c.y[i], c.x[i + 1], c.y[i + 1])) { drape = true; break; }
        if (drape) draped++; else {
          soft++;
          if (d < minSeg) minSeg = d; if (d > maxSeg) maxSeg = d;
          if (d > T.spineMax * 1.25 || d < T.spineMin * 0.75) limit++;
        }
      } else { if (d < minSeg) minSeg = d; if (d > maxSeg) maxSeg = d; }
    }
  }
  check(nan === 0, `${id.padEnd(8)} no NaN`);
  check(oob === 0, `${id.padEnd(8)} nodes stay inside the world`);
  check(deep === 0, `${id.padEnd(8)} no node centre half way into a wall (deepest overlap of a node's rim ${maxDeep.toFixed(2)}, events ${deep})`);
  check(tunnel === 0, `${id.padEnd(8)} no tunnelling (events ${tunnel})`);
  check(limit <= FR * (K - 1) * 0.001, `${id.padEnd(8)} spine segments within hard limits (+-25%, isolated frames only: < 0.1%) (seen ${minSeg.toFixed(2)}..${maxSeg.toFixed(2)} x L0; beyond +-3% in ${soft} of ${FR * (K - 1)} segment-frames, beyond 25% in ${limit}; draped across a wall, excluded: ${draped})`);
}

// ------------------------------------------------------------------ 2. hang by the head
console.log('lifted by the head');
{
  const c = newCat(null); c.spawn(0, 5, { dir: 1, tilt: 0 });
  const g = c.beginGrab(c.x[HEAD], c.y[HEAD]);
  for (let f = 0; f < 40; f++) { c.moveGrab(g, c.x[HEAD], 5 + f * 0.17); c.step(DT); }
  for (let f = 0; f < 240; f++) { c.moveGrab(g, 0, 11.8); c.step(DT); }
  const len = spineLen(c) / REST;
  let legsBelow = 0; for (let l = 0; l < 4; l++) if (c.y[paw(l)] < c.y[2] - 0.3 || c.y[paw(l)] < c.y[11] - 0.3) legsBelow++;
  console.log(`  head y ${c.y[HEAD].toFixed(2)} hips y ${c.y[HIPS].toFixed(2)} length x${len.toFixed(2)} max segment x${c.stretch.toFixed(2)} paws below body ${legsBelow}/4`);
  check(len >= 1.25, `hangs long (spine x${len.toFixed(2)} of rest)`);
  check(c.y[HIPS] < c.y[HEAD] - 3.5 && legsBelow === 4, 'hips trail below the head and the legs dangle');
}

// ------------------------------------------------------------------ 3. recovery on the bare floor
console.log('release on the bare floor');
{
  const c = newCat(null); c.spawn(0, 0.9, { dir: 1, tilt: 0 });
  for (let f = 0; f < 60; f++) c.step(DT);
  const a = c.beginGrab(c.x[HEAD], c.y[HEAD]), b = c.beginGrab(c.x[HIPS], c.y[HIPS]);
  for (let f = 0; f < 90; f++) { c.moveGrab(a, 4.6 + 0 * f, 0.8); c.moveGrab(b, -4.6, 0.8); c.step(DT); }
  const stretched = spineLen(c) / REST;
  c.endGrab(a); c.endGrab(b);
  let t = -1;
  for (let f = 0; f < 150; f++) { c.step(DT); if (t < 0 && Math.abs(spineLen(c) / REST - 1) <= 0.08) t = f / 60; }
  const len = spineLen(c) / REST;
  console.log(`  stretched to x${stretched.toFixed(2)}, within 8% after ${t < 0 ? 'never' : t.toFixed(2) + ' s'}, at 2.5 s x${len.toFixed(2)}`);
  check(t >= 0 && t <= 1.5, 'back within 8% of rest length inside 1.5 s');
}

// ------------------------------------------------------------------ 4. capacities
console.log('capacity: cat rest area vs container interior');
{
  const c = newCat(null);
  for (const id of ORDER) {
    const area = capacity(CONTAINERS[id]);
    console.log(`  ${id.padEnd(8)} interior ${area.toFixed(2)}  cat ${c.restArea.toFixed(2)}  ratio ${(c.restArea / area).toFixed(2)}`);
  }
}

// ------------------------------------------------------------------ 5. packing bot
function stepN(c, n, hook) { for (let f = 0; f < n; f++) { if (hook) hook(f); c.step(DT); } }
function dragTo(c, g, pts, frames) {
  // move the finger along a polyline over `frames` frames
  const segs = [], tot = [0];
  let sx = g.fx, sy = g.fy;
  const P = [[sx, sy], ...pts];
  let L = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segs.push(d); L += d; tot.push(L); }
  for (let f = 1; f <= frames; f++) {
    let dd = (f / frames) * L, i = 0;
    while (i < segs.length - 1 && dd > segs[i]) { dd -= segs[i]; i++; }
    const t = segs[i] ? Math.min(1, dd / segs[i]) : 1;
    c.moveGrab(g, P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t);
    c.step(DT);
  }
}
function botAction(c, node, depth, jitter) {
  const B = build(c.__def);
  const g = c.beginGrab(c.x[node], c.y[node]);
  if (!g) return false;
  const bottom = B.inner[B.inner.length - 1][1];
  const tx = jitter, ty = Math.max(bottom + 0.9, c.rimY - depth);
  dragTo(c, g, [[g.fx, c.rimY + 3.2], [tx, c.rimY + 3.0], [tx, ty]], 100);
  stepN(c, 8, () => c.moveGrab(g, tx, ty));
  c.endGrab(g);
  stepN(c, 70);
  return true;
}
const botResults = [];
console.log('bot: grab head, lift, lower, release; then re-feed each spilled part (up to 10 times)');
for (const id of ORDER) {
  const def = CONTAINERS[id];
  const c = newCat(def, { x: 0 }); c.__def = def;
  stepN(c, 150); // drop and settle (draped)
  const log = [];
  const pct = () => c.fitPct(c.computeFit());
  log.push(pct());
  botAction(c, HEAD, 1.6, 0);
  log.push(pct());
  let actions = 1;
  for (let k = 0; k < 10; k++) {
    c.computeFit();
    if (c.outN === 0) break;
    // largest spilled node (by area), tail/paw tip preferred on ties
    let best = -1, ba = 0;
    for (let i = 0; i < N; i++) if (!c.inside[i]) { const a = c.r0[i] * c.r0[i] + (i === TAIL_TIP ? 0.2 : 0); if (a > ba) { ba = a; best = i; } }
    botAction(c, best, 0.8 + 0.25 * k, (rnd() - 0.5) * 0.8);
    actions++;
    log.push(pct());
  }
  c.computeFit();
  const finalPct = pct();
  console.log(`  ${id.padEnd(8)} fit after each action: ${log.join(' ')}  | final ${finalPct}%  spilling: ${c.spillNames.join(', ') || 'nothing'}`);
  // does a well-packed cat stay in while he wriggles for 30 s?
  let minFit = 100, outFrames = 0;
  for (let f = 0; f < 1800; f++) { c.step(DT); if (f % 6 === 0) { const p = c.fitPct(c.computeFit()); if (p < minFit) minFit = p; if (p < 100) outFrames++; } }
  console.log(`           then 30 s of wriggling: lowest fit ${minFit}%, not perfect in ${outFrames} of 300 samples`);
  botResults.push({ id, finalPct, actions, spill: c.spillNames.join(', '), minFit });
}
for (const r of botResults) if (r.id === 'salad' || r.id === 'teacup') { check(r.finalPct >= 90, `bot reaches >= 90% in the ${r.id} (${r.finalPct}%)`); check(r.minFit >= 70, `a packed cat stays >= 70% (he may squirm a paw or his bum out) in the ${r.id} while wriggling (lowest ${r.minFit}%)`); }

// ------------------------------------------------------------------ 6a. muscle tone: drop, sit, righting, modes
console.log('muscle tone');
{
  // is he sitting? head the highest node (>= 2.2 up), front paws on the table under the chest, hips on the table, spine at rest length
  const sitting = (c) => {
    let hi = 0; for (let i = 1; i < N; i++) if (c.y[i] > c.y[hi]) hi = i;
    let len = 0; for (let i = 0; i < K - 1; i++) len += Math.hypot(c.x[i + 1] - c.x[i], c.y[i + 1] - c.y[i]);
    const pawsUnder = [0, 1].every((l) => Math.abs(c.x[paw(l)] - c.x[2]) < 0.6 && c.y[paw(l)] < 0.7);
    const info = `head ${c.y[HEAD].toFixed(2)} high=${hi === HEAD} paws dx ${[0, 1].map((l) => (c.x[paw(l)] - c.x[2]).toFixed(2)).join('/')} hips bottom ${(c.y[HIPS] - c.r[HIPS]).toFixed(2)} spine x${(len / REST).toFixed(3)} mode ${c.mode}`;
    return { ok: hi === HEAD && c.y[HEAD] >= 2.2 && pawsUnder && c.y[HIPS] - c.r[HIPS] <= 0.5 && Math.abs(len / REST - 1) <= 0.05 && c.mode === 'ground', info };
  };
  // 1. drop from 3 units onto the bare table
  for (const dir of [1, -1]) {
    const c = createCat(T); c.top = TOP; c.spawn(0, 3, { pose: 'sit', dir });
    const F = 180, traj = [];
    let landed = -1;
    for (let f = 0; f < F; f++) { c.step(DT); if (landed < 0 && c.mode === 'ground') landed = f; traj.push({ x: Float32Array.from(c.x), y: Float32Array.from(c.y), ke: c.ke }); }
    const fin = traj[F - 1];
    const dev = (t) => { let m = 0; for (let i = 0; i < N; i++) if (i < TAIL0 || i >= LEG0) m = Math.max(m, Math.hypot((t.x[i] - t.x[HIPS]) - (fin.x[i] - fin.x[HIPS]), t.y[i] - fin.y[i])); return m; };
    let settle = -1;
    for (let f = landed; f < F && settle < 0; f++) { let ok = true; for (let g = f; g < F; g++) if (dev(traj[g]) > 0.05) { ok = false; break; } if (ok) settle = (f - landed) / 60; }
    let worst = 0, prev = traj[landed + 15].ke; // kinetic energy must not climb back up after the first 0.25 s (0.1 is below anything visible)
    for (let f = landed + 16; f < F; f++) { worst = Math.max(worst, traj[f].ke - prev); prev = Math.min(prev, traj[f].ke) ; }
    console.log(`  drop from 3 units (facing ${dir}): lands at ${(landed / 60).toFixed(2)} s, within 0.05 of final pose after ${settle < 0 ? 'never' : settle.toFixed(2) + ' s'}, ke at 0.25 s ${traj[landed + 15].ke.toFixed(2)}, at 0.6 s ${traj[landed + 36].ke.toFixed(3)}, largest rise after 0.25 s ${worst.toFixed(3)}`);
    check(settle >= 0 && settle < 0.6, `after a drop he is within 0.05 of his final pose inside 0.6 s of landing (${settle.toFixed(2)} s)`);
    check(worst < 0.1, `kinetic energy decays after 0.25 s (no rebound above 0.1; largest rise ${worst.toFixed(3)})`);
  }
  // 2. sit on the bare table, 3 s after spawning (spawned in a sitting pose, and spawned the old way: draped horizontally)
  for (const [label, o] of [['dropped sitting', { pose: 'sit' }], ['dropped lying flat', {}]]) for (const dir of [1, -1]) {
    const c = createCat(T); c.top = TOP; c.spawn(0, 1.5, { dir, tilt: 0, ...o });
    for (let f = 0; f < 180; f++) c.step(DT);
    const s = sitting(c);
    console.log(`  ${label}, facing ${dir}: ${s.info}`);
    check(s.ok, `3 s after spawning (${label}, facing ${dir}) he is sitting`);
  }
  // 3. righting: released upside-down, 6 units up, spinning
  for (const [spin, dir] of [[8, 1], [-8, 1], [12, -1], [-14, -1]]) {
    const c = createCat(T); c.top = TOP; c.spawn(0, 6, { dir, tilt: 0 });
    let cx = 0, cy = 0; for (let i = 0; i < N; i++) { cx += c.x[i]; cy += c.y[i]; } cx /= N; cy /= N;
    const rot = (X, Y, a) => { const co = Math.cos(a), si = Math.sin(a); for (let i = 0; i < N; i++) { const dx = X[i] - cx, dy = Y[i] - cy; X[i] = cx + co * dx - si * dy; Y[i] = cy + si * dx + co * dy; } };
    rot(c.x, c.y, Math.PI);                     // upside-down
    for (let i = 0; i < N; i++) { c.px[i] = c.x[i]; c.py[i] = c.y[i]; }
    rot(c.px, c.py, -spin * DT);                // ... and turning
    let low = 1e9; for (let i = 0; i < N; i++) low = Math.min(low, c.y[i] - c.r0[i]);
    for (let i = 0; i < N; i++) { c.y[i] += 6 - low; c.py[i] += 6 - low; }
    let landed = -1, oneUp = false;
    for (let f = 0; f < 72; f++) { c.step(DT); if (landed < 0 && c.mode === 'ground') landed = f; }
    const s = sitting(c);
    const spine = (i) => c.y[i]; let pawsBelow = true; for (let l = 0; l < 4; l++) for (let i = 0; i < K; i++) if (c.y[paw(l)] > c.y[i]) pawsBelow = false;
    console.log(`  released upside-down, spin ${spin} rad/s, facing ${dir}: lands at ${(landed / 60).toFixed(2)} s; at 1.2 s: ${s.info} paws below spine ${pawsBelow}`);
    check(landed >= 0 && pawsBelow && s.ok, `released upside-down (spin ${spin}) he lands on his paws and is sitting within 1.2 s`);
  }
  // 4. modes and tone: lifted -> limp, put down -> firm
  {
    const c = createCat(T); c.top = TOP; c.spawn(0, 1.5, { pose: 'sit', dir: 1 });
    c.M.idleT = 1e9; // (no idle life in this one: he must be in his default pose at the end)
    for (let f = 0; f < 120; f++) c.step(DT);
    const modeSit = c.mode, toneSit = c.tone;
    const g = c.beginGrab(c.x[HEAD], c.y[HEAD]);
    for (let f = 0; f < 60; f++) { c.moveGrab(g, c.x[HEAD], 2.5 + f * 0.1); c.step(DT); }
    const modeHeld = c.mode, toneHeld = c.tone;
    for (let f = 0; f < 120; f++) { c.moveGrab(g, 0, 10); c.step(DT); }
    const hung = spineLen(c) / REST;
    c.endGrab(g);
    let tAir = c.mode; for (let f = 0; f < 5; f++) c.step(DT);
    const airMode = c.mode;
    for (let f = 0; f < 240; f++) c.step(DT);
    const s = sitting(c);
    console.log(`  sitting: ${modeSit} tone ${toneSit.toFixed(2)}; lifted by the head: ${modeHeld} tone ${toneHeld.toFixed(2)} (spine x${hung.toFixed(2)}); let go: ${airMode}; 4 s later: ${s.info} tone ${c.tone.toFixed(2)}`);
    check(modeSit === 'ground' && toneSit > T.toneGround * 0.95, 'on the table his tone is the ground tone');
    check(modeHeld === 'held' && toneHeld < T.toneHeld + 0.03, `held by the head: tone ramps down to ${T.toneHeld} inside a second (${toneHeld.toFixed(3)})`);
    check(airMode === 'air', 'released in mid-air he is in the air mode');
    check(s.ok, 'dropped from the lifted position he sits again');
  }
  // 5. contained: packed into the teacup by the bot, the tone must not push him out (same thresholds as the packing bot above)
  {
    const res = {};
    for (const tone of [0, T.toneContained]) {
      const Ts = T.toneContained; T.toneContained = tone;
      const def = CONTAINERS.teacup, c = newCat(def, { x: 0 }); c.__def = def;
      stepN(c, 150); botAction(c, HEAD, 1.6, 0);
      for (let k = 0; k < 10; k++) { c.computeFit(); if (c.outN === 0) break; let best = -1, ba = 0; for (let i = 0; i < N; i++) if (!c.inside[i]) { const a = c.r0[i] * c.r0[i]; if (a > ba) { ba = a; best = i; } } botAction(c, best, 0.8 + 0.25 * k, 0); }
      let sum = 0, n = 0, modes = new Set();
      for (let f = 0; f < 600; f++) { c.step(DT); if (f % 6 === 0) { sum += c.fitPct(c.computeFit()); n++; modes.add(c.mode); } }
      res[tone] = { fit: sum / n, modes: [...modes].join(',') };
      T.toneContained = Ts;
    }
    console.log(`  packed teacup, mean fit over 10 s: toneContained 0 -> ${res[0].fit.toFixed(1)}%, ${T.toneContained} -> ${res[T.toneContained].fit.toFixed(1)}% (modes ${res[T.toneContained].modes})`);
    check(res[T.toneContained].fit >= res[0].fit - 3, 'the contained tone does not push him out of the teacup (mean fit within 3 points of toneContained 0)');
  }
  // 6. idle life: a minute of sitting on the table: things happen, none of them wobbly
  {
    const c = createCat(T); c.top = TOP; c.spawn(0, 1.5, { pose: 'sit', dir: 1, intro: true });
    const seen = new Set(); let air = 0, nan = 0;
    for (let f = 0; f < 60 * 90; f++) { c.step(DT); seen.add(c.poseName); if (c.mood) seen.add('mood:' + c.mood); if (c.mode === 'air') air++; if (!Number.isFinite(c.x[0])) nan++; }
    const sBlink = c.M.blinks;
    console.log(`  90 s of sitting: poses/moods seen ${[...seen].join(' ')}; frames in the air ${air}; slow blinks pending ${sBlink}`);
    check(nan === 0 && air < 30, 'idle life never launches him or breaks the sim');
    check(seen.size >= 4, 'idle life: he does several different things (poses, looks, yawns)');
  }
}

// ------------------------------------------------------------------ 7. the pounce
console.log('pounce: levels, leaps, walls, props');
const wallsOf = (cat) => { const W = cat.world, out = []; for (let c = 0; c < W.nCap; c++) { const o = c * 6; out.push([W.cap[o], W.cap[o + 1], W.cap[o] + W.cap[o + 2], W.cap[o + 1] + W.cap[o + 3], W.cap[o + 5]]); } return out; };
const underSpan = (cp, X, Y) => { const ex = cp[2] - cp[0], ey = cp[3] - cp[1], u = ((X - cp[0]) * ex + (Y - cp[1]) * ey) / (ex * ex + ey * ey); return u >= 0 && u <= 1; };
const calmStop = (c) => { let k = 0; return (f) => { if (f > 20 && (c.mode === 'ground' || c.mode === 'contained') && c.ke < 0.15) return ++k > (c.mode === 'contained' ? 150 : 12); k = 0; return false; }; };
const cenX = (c) => { let a = 0; for (let i = 0; i < c.N; i++) a += c.x[i]; return a / c.N; };
const cenY = (c) => { let a = 0; for (let i = 0; i < c.N; i++) a += c.y[i]; return a / c.N; };
const isSitting = (c) => {
  let hi = 0; for (let i = 1; i < N; i++) if (c.y[i] > c.y[hi]) hi = i;
  let len = 0; for (let i = 0; i < K - 1; i++) len += Math.hypot(c.x[i + 1] - c.x[i], c.y[i + 1] - c.y[i]);
  const base = c.anchor.ay, pawsUnder = [0, 1].every((l) => Math.abs(c.x[paw(l)] - c.x[2]) < 0.8 && c.y[paw(l)] - base < 0.7);
  return hi === HEAD && c.y[HEAD] - base >= 2.2 && pawsUnder && Math.abs(len / REST - 1) <= 0.06 && c.mode === 'ground';
};
// a winning shot (first one found on a grid) for a level: the tests that need "a good shot" use it, whatever the physics are tuned to
function findWin(lv, drops = [null]) {
  for (const d of drops) for (let p = 0.5; p <= 1.001; p += 0.1) for (let a = 40; a <= 90; a += 5) {
    const sim = createSim(T, lv), c = sim.cat;
    for (let f = 0; f < 45; f++) sim.step(DT);
    if (runLeg(sim, { a, p, d }, calmStop(c)) && sim.complete) return { a, p, d };
  }
  return null;
}
{
  // 7a. random leaps per level (some with a DROP at a random moment): no NaN, nothing in a wall or shelf, nothing tunnels
  const tag = (id) => `level ${String(id).padStart(2)}`;
  const NL = +(process.env.LEAPS || 120);
  for (const lv of LEVELS) {
    if (process.env.LEVEL && +process.env.LEVEL !== lv.id) continue;
    const sim = createSim(T, lv), c = sim.cat, N27 = c.N, moving = !!lv.container.move;
    let caps = wallsOf(c);
    for (let f = 0; f < 45; f++) sim.step(DT);
    const root = sim.snapshot();
    let nan = 0, deep = 0, tunnel = 0, maxDeep = 0, oob = 0, leaps = 0, landed = 0, propBad = 0, drops = 0;
    const pp = new Float32Array(N27 * 2), propPrev = [];
    for (let k = 0; k < NL; k++) {
      sim.restore(root);
      const a = (-45 + rnd() * 270) * Math.PI / 180, p = 0.25 + rnd() * 0.75, L = p * T.pullMax, dropAt = rnd() < 0.5 ? Math.floor(6 + rnd() * 90) : -1;
      c.aim(Math.cos(a) * L, Math.sin(a) * L);
      for (let f = 0; f < 14; f++) sim.step(DT);
      sim.leapPull(Math.cos(a) * L, Math.sin(a) * L); leaps++;
      for (let f = 0; f < 240; f++) {
        if (moving) caps = wallsOf(c);
        for (let i = 0; i < N27; i++) { pp[i * 2] = c.x[i]; pp[i * 2 + 1] = c.y[i]; }
        for (let j = 0; j < sim.props.list.length; j++) { const q = sim.props.list[j]; propPrev[j] = [q.x, q.y]; }
        if (f === dropAt && sim.drop()) drops++;
        const rep0 = c.repairs; sim.step(DT); c.events.length = 0; const repaired = c.repairs !== rep0; // (a tear repair is a deliberate teleport)
        for (let i = 0; i < N27; i++) {
          const X = c.x[i], Y = c.y[i];
          if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(c.r[i])) { nan++; continue; }
          if (Math.abs(X) > T.roomHalfW + (i >= 13 && i < 19 ? 0.6 : 0.1) || Y < -0.01) { oob++; if (process.env.VERBOSE && oob < 3) console.log(`   (oob: level ${lv.id} shot ${k} frame ${f} node ${i} mode ${c.mode} at ${X.toFixed(2)},${Y.toFixed(2)} kicking ${c.kicking} frozen ${c.frozen})`); }
          let bad = false;
          if (c.anchor.on) continue; // (posed on his spot: a drawn pose, which may overlap the decor by a paw's width; the rig is what must never be inside a wall)
          for (const cp of caps) {
            if (X < Math.min(cp[0], cp[2]) - 2.5 || X > Math.max(cp[0], cp[2]) + 2.5 || Y < Math.min(cp[1], cp[3]) - 2.5 || Y > Math.max(cp[1], cp[3]) + 2.5) continue;
            const dist = capDist(cp, X, Y), pen = (cp[4] + c.r[i]) - dist;
            if (pen > maxDeep) maxDeep = pen;
            if (dist < cp[4] * 0.5) { deep++; bad = true; if (process.env.VERBOSE && deep < 3) console.log(`   (deep: level ${lv.id} shot ${k} frame ${f} node ${i} mode ${c.mode} anchor ${c.anchor.on} at ${X.toFixed(2)},${Y.toFixed(2)} cap ${cp.map((v) => v.toFixed(2))} cx ${sim.cx} kicks ${sim.kicks} kicking ${c.kicking} frozen ${c.frozen})`); }
            if (!bad && !moving && !repaired && crossed(cp, pp[i * 2], pp[i * 2 + 1], X, Y)) { tunnel++; if (process.env.VERBOSE && tunnel < 4) console.log(`   (tunnel: level ${lv.id} shot ${k} frame ${f} node ${i} mode ${c.mode} anchor ${c.anchor.on} from ${pp[i * 2].toFixed(2)},${pp[i * 2 + 1].toFixed(2)} to ${X.toFixed(2)},${Y.toFixed(2)} cap ${cp.map((v) => v.toFixed(2))})`); }
          }
        }
        for (let j = 0; j < sim.props.list.length; j++) { // props: never through a shelf, the container or the floor
          const q = sim.props.list[j];
          if (q.state === 'gone') continue;
          if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) { propBad++; continue; }
          if (q.y < q.r - 1e-3 || Math.abs(q.x) > T.roomHalfW + 0.001) propBad++;
          if (moving) continue;
          for (const cp of caps) {
            const deepP = capDist(cp, q.x, q.y) < cp[4] * 0.5, crossP = !deepP && crossed(cp, propPrev[j][0], propPrev[j][1], q.x, q.y) && underSpan(cp, q.x, q.y);
            if (deepP || crossP) propBad++;
          }
        }
        if (sim.complete) break;
      }
      if (c.mode === 'ground' || c.mode === 'contained' || c.mode === 'pour' || c.canAim || (lv.cushions && c.mode === 'air')) landed++;
    }
    check(nan === 0, `${tag(lv.id)} ${leaps} random leaps (${drops} with a DROP): no NaN`);
    check(oob === 0, `${tag(lv.id)} nodes stay inside the room`);
    check(moving ? deep <= 6 : deep === 0, `${tag(lv.id)} no node centre half way into a wall, shelf or cushion${moving ? ' (a driving vac may sweep a leg for a few frames)' : ''} (deepest overlap of a node's rim ${maxDeep.toFixed(2)}, events ${deep})`);
    check(tunnel === 0, `${tag(lv.id)} nothing tunnels through a wall or shelf (events ${tunnel})`);
    check(propBad === 0, `${tag(lv.id)} props never tunnel through a shelf, the container or the floor (events ${propBad})`);
    check(landed >= NL * 0.93, `${tag(lv.id)} he is on his feet or in the container 4 s after a leap (${landed}/${NL})`);
  }

  // 7b. regression: pose matching must never push a node through a wall (a forced SIT overlapped the teacup wall)
  {
    const def = CONTAINERS.teacup, B = build(def);
    let worst = 0, deepN = 0, crossN = 0, cases = 0;
    for (const f of [1, -1]) for (const x0 of [-3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2]) for (const pose of ['sit', 'loaf', 'stand']) {
      const c = createCat(T); c.top = TOP; c.noRepair = true; c.setContainer(def, 0, 0);
      c.snap(pose, x0, f); cases++;
      const pp = new Float32Array(N * 2);
      for (let k = 0; k < 90; k++) {
        for (let i = 0; i < N; i++) { pp[i * 2] = c.x[i]; pp[i * 2 + 1] = c.y[i]; }
        c.step(DT);
        for (let i = 0; i < N; i++) for (const cp of B.capsules) {
          const dist = capDist(cp, c.x[i], c.y[i]), pen = cp[4] + c.r[i] - dist;
          if (pen > worst) worst = pen;
          if (dist < cp[4] * 0.5) deepN++;
          else if (crossed(cp, pp[i * 2], pp[i * 2 + 1], c.x[i], c.y[i])) crossN++;
        }
      }
    }
    check(deepN === 0 && crossN === 0, `forced poses next to the teacup (${cases} cases, 90 steps each): no node ends a step inside or through the wall (deepest overlap ${worst.toFixed(3)}, deep ${deepN}, crossed ${crossN})`);
    check(worst < 0.1, `... and contacts are the last word: no node overlaps a wall by more than 0.1 (${worst.toFixed(3)})`);
    const shelf = [{ x: 0, y: 2.2, w: 6 }];
    let deep2 = 0, cross2 = 0, w2 = 0;
    for (const f of [1, -1]) for (const y0 of [0, 1.0]) {
      const c = createCat(T); c.top = TOP; c.noRepair = true; c.setContainer(CONTAINERS.salad, 99, 0, shelf);
      c.snap('sit', 0, f);
      if (y0) for (let i = 0; i < N; i++) { c.y[i] += y0; c.py[i] += y0; }
      c.depenetrate(); const caps = wallsOf(c), pp = new Float32Array(N * 2);
      for (let k = 0; k < 120; k++) {
        for (let i = 0; i < N; i++) { pp[i * 2] = c.x[i]; pp[i * 2 + 1] = c.y[i]; }
        c.step(DT);
        for (let i = 0; i < N; i++) for (const cp of caps) {
          if (cp[0] > 50) continue;
          const dist = capDist(cp, c.x[i], c.y[i]), pen = cp[4] + c.r[i] - dist; if (pen > w2) w2 = pen;
          if (dist < cp[4] * 0.5) deep2++; else if (crossed(cp, pp[i * 2], pp[i * 2 + 1], c.x[i], c.y[i])) cross2++;
        }
      }
    }
    check(deep2 === 0 && cross2 === 0, `a forced SIT squeezed under a shelf never goes through it (deepest overlap ${w2.toFixed(3)})`);
  }

  // 7c. launch: speed and the reach it gives (gravity 30: ~16 high, a 45 degree shot carries across the room)
  {
    const v = launchVelocity(T, 0, 99); check(Math.abs(v.vy - T.leapSpeedMax) < 1e-6 && v.power === 1, 'a pull beyond pullMax is clamped to full power');
    const v2 = launchVelocity(T, T.pullMax / 2, 0); check(Math.abs(v2.vx - T.leapSpeedMax / 2) < 1e-6, 'half the pull is half the speed');
    const c = createCat(T); c.top = 60; c.clearContainer();
    c.spawnAt(0, 0, 1); for (let f = 0; f < 60; f++) c.step(DT);
    const lp = {}; c.launchPoint(lp); const y0 = lp.y; c.aim(0, T.pullMax); for (let f = 0; f < 16; f++) c.step(DT);
    c.launchPoint(lp); const y1 = lp.y; c.leap(0, T.leapSpeedMax);
    let top = y1, f = 0; for (; f < 200; f++) { c.step(DT); c.launchPoint(lp); top = Math.max(top, lp.y); if (f > 20 && c.mode === 'ground') break; }
    measuredRise = top - y0;
    console.log(`  straight up at full power: his middle rises ${(top - y1).toFixed(2)} (crouch height ${y1.toFixed(2)}, sitting ${y0.toFixed(2)})`);
    check(top - y0 > 13.5 && top - y0 < 16.5, `max leap height is about 15 (${(top - y0).toFixed(2)} from sitting)`);
    const d = createCat(T); d.top = 60; d.clearContainer(); d.spawnAt(-6, 0, 1); for (let f = 0; f < 60; f++) d.step(DT);
    d.aim(T.pullMax * 0.7071, T.pullMax * 0.7071); for (let f = 0; f < 16; f++) d.step(DT);
    d.leap(T.leapSpeedMax * 0.7071, T.leapSpeedMax * 0.7071);
    const wall = T.leapBounce; T.leapBounce = 0; // (count the reach before the wall bounce)
    let hmax = -99; for (let f = 0; f < 120; f++) { d.step(DT); hmax = Math.max(hmax, d.x[HEAD]); if (f > 20 && d.mode === 'ground') break; }
    T.leapBounce = wall;
    console.log(`  45 degrees at full power from x -6: his head reaches x ${hmax.toFixed(2)} (the wall is at ${T.roomHalfW}; he is stopped by it)`);
    check(hmax > T.roomHalfW - 0.9, 'a full-power 45 degree leap carries his head across the room to the far wall');
  }

  // 7d. the wind-up, the turn, the leap, the tap
  {
    const sim = createSim(T, LEVELS[0]), c = sim.cat;
    for (let f = 0; f < 45; f++) sim.step(DT);
    check(c.mode === 'ground' && c.canAim && c.facing === 1, 'level 1: he sits on the floor facing the bowl and can be aimed');
    c.plant(); c.aim(1.5, 1.5); for (let f = 0; f < 20; f++) sim.step(DT);
    check(c.poseName === 'crouch' && c.mode === 'ground' && c.mood === 'curious', 'aiming: crouch pose, still on the ground, curious face');
    const x0 = c.x[HEAD];
    c.aim(-1.5, 1.5); let turned = -1, nan = 0;
    for (let f = 0; f < 30; f++) { sim.step(DT); if (turned < 0 && c.facing === -1 && !c.anchor.flipping) turned = f; for (let i = 0; i < N; i++) if (!Number.isFinite(c.x[i])) nan++; }
    check(c.facing === -1 && turned >= 0 && turned <= 14 && nan === 0, `he turns round to face the other way in ~0.2 s (done after ${turned} steps)`);
    console.log(`  after the turn: head x ${x0.toFixed(2)} -> ${c.x[HEAD].toFixed(2)}, pose ${c.poseName}, facing ${c.facing}`);
    check(c.x[HEAD] < x0 - 1.5 && c.poseName === 'crouch', 'after the turn his head is on the other side and he is still crouched');
    c.endAim(); const L0 = sim.leaps; for (let f = 0; f < 30; f++) sim.step(DT);
    check(sim.leaps === L0 && c.mode === 'ground', 'cancelling an aim does not make him leap');
    c.plant(); c.aim(1.5, 1.5); for (let f = 0; f < 16; f++) sim.step(DT);
    { const sn = sim.snapshot(); sim.step(DT); sim.restore(sn); } // (snapshot round trip)
    const ok = sim.leapPull(1.5, 1.5); sim.step(DT);
    check(ok && c.mode === 'air' && sim.leaps === L0 + 1, 'release: he is in the air and the leap is counted');
    check(!c.canAim && !sim.leapPull(1, 1) && sim.leaps === L0 + 1, 'he cannot be aimed or launched again in mid-air');
    let air = 0; for (let f = 0; f < 60 && c.mode === 'air'; f++) { sim.step(DT); air++; }
    check(air > 8, `he stays in the air for the arc (${air} frames)`);
  }

  // 7e. the good shot into the bowl: pours in, tucks, loafs; won; stars are treats
  {
    const win = findWin(LEVELS[0]); check(!!win, 'level 1 has a winning shot'); const shot = win || { a: 55, p: 0.7 };
    const sim = createSim(T, LEVELS[0]), c = sim.cat;
    for (let f = 0; f < 45; f++) sim.step(DT);
    const a = shot.a * Math.PI / 180, L = shot.p * T.pullMax;
    c.plant(); c.aim(Math.cos(a) * L, Math.sin(a) * L); for (let f = 0; f < 16; f++) sim.step(DT);
    sim.leapPull(Math.cos(a) * L, Math.sin(a) * L);
    const seen = new Set(), ev = []; let tPour = -1, tIn = -1, tDone = -1; const shown = [];
    for (let f = 0; f < 360; f++) {
      sim.step(DT); seen.add(c.mode); for (const e of c.events) ev.push(e); c.events.length = 0;
      if (tPour < 0 && c.mode === 'pour') tPour = f; if (tIn < 0 && c.mode === 'contained') tIn = f; if (tDone < 0 && sim.complete) tDone = f;
      if (tDone >= 0) shown.push(sim.fitShown);
      if (tDone >= 0 && f > tDone + 240) break;
    }
    console.log(`  good shot at the bowl: pour at ${(tPour / 60).toFixed(2)} s, complete at ${(tDone / 60).toFixed(2)} s, entered at ${((sim.enterT - 45 / 60 - 16 / 60) ).toFixed(2)} s, fit ${(sim.completeFit * 100).toFixed(0)}%, treats ${sim.completeTreats}, events ${[...new Set(ev)].join(' ')}`);
    check(tDone > 0 && seen.has('pour'), 'the bowl: air -> pour -> won');
    const lag = sim.completeT - sim.enterT;
    check(lag <= 0.45 + 1e-6 && lag + T.bannerDelay <= 0.9, `the win banner starts <= 0.9 s after his head and chest are in (complete ${lag.toFixed(2)} s after entering + ${T.bannerDelay} s beat = ${(lag + T.bannerDelay).toFixed(2)} s)`);
    let mono = true; for (let i = 1; i < shown.length; i++) if (shown[i] < shown[i - 1] - 1e-9) mono = false;
    check(mono && shown.length > 100 && shown[shown.length - 1] >= sim.completeFit - 1e-9, `after the win the displayed fit only ever goes up (${(shown[0] * 100).toFixed(0)}% -> ${(shown[shown.length - 1] * 100).toFixed(0)}%)`);
    check(sim.stars() === sim.completeTreats && sim.purrfect() === (sim.completeTreats >= 3 && sim.completeLeaps <= LEVELS[0].par), `stars are the treats he had at the finish (${sim.stars()}); 3 treats within par is Purrfect`);
    let wriggles = 0; { const sim2 = createSim(T, LEVELS[0]); const c2 = sim2.cat; for (let f = 0; f < 45; f++) sim2.step(DT); c2.plant(); c2.aim(Math.cos(a) * L, Math.sin(a) * L); for (let f = 0; f < 16; f++) sim2.step(DT); sim2.leapPull(Math.cos(a) * L, Math.sin(a) * L); for (let f = 0; f < 300; f++) { sim2.step(DT); if (sim2.complete) break; } for (let f = 0; f < 600; f++) { sim2.step(DT); if (c2.events.includes('squirm')) wriggles++; c2.events.length = 0; } }
    check(wriggles === 0, 'wriggling is off for the rest of the level once he has won');
  }

  // 7f. props: knocked off a shelf, counted once, gone after about a second
  {
    const lv = { ...LEVELS[0], container: { id: 'vase', x: -5.4, y: 0 }, cat: { x: 5.8, y: 0, facing: 1 }, platforms: [{ x: 3.0, y: 7.2, w: 4 }], props: [{ type: 'mug', x: 4.0, y: 7.2 }, { type: 'orange', x: 1.4, y: 7.2 }], treats: [] };
    const sim = createSim(T, lv), P = sim.props;
    for (let f = 0; f < 90; f++) sim.step(DT);
    const rest = P.list.every((p, i) => Math.abs(p.x - (i === 0 ? 4.0 : 1.4)) < 0.05) && P.list[0].asleep;
    check(rest && P.knocked === 0 && P.total === 2, 'props sit still on their shelf (nothing knocked, 2 elevated)');
    const o = P.list[1]; o.asleep = false; o.x = -0.6; o.y = 1.5; o.vx = 0;
    let knockT = -1, evs = 0;
    for (let f = 0; f < 240; f++) { sim.step(DT); for (const e of P.events) if (e.type === 'knock') evs++; P.events.length = 0; if (knockT < 0 && P.knocked >= 1) knockT = f; }
    check(P.knocked === 1 && evs === 1, `a prop that rolls off the shelf and hits the floor is knocked, once (knocked ${P.knocked}, events ${evs}, after ${(knockT / 60).toFixed(2)} s)`);
    check(P.list.filter((p) => p.state === 'knocked' || p.state === 'gone').length === P.knocked, 'only knocked props are knocked');
    for (let f = 0; f < 90; f++) sim.step(DT);
    check(P.list.filter((p) => p.state === 'gone').length === P.knocked, 'knocked props have faded away after a second or so');
    const lv2 = { ...LEVELS[0], cat: { x: -6.5, y: 0, facing: 1 }, props: [{ type: 'yarn', x: -0.2, y: 0 }], treats: [] };
    const s2 = createSim(T, lv2), c2 = s2.cat; for (let f = 0; f < 60; f++) s2.step(DT);
    c2.plant(); c2.aim(3.2, 0.9); for (let f = 0; f < 16; f++) s2.step(DT); const yx0 = s2.props.list[0].x; s2.leapPull(3.2, 0.9);
    let pushed = 0; for (let f = 0; f < 50; f++) { s2.step(DT); pushed = Math.max(pushed, s2.props.list[0].x - yx0); }
    console.log(`  a yarn ball in his way was pushed ${pushed.toFixed(2)} along`);
    check(pushed > 0.3, 'a leap through a yarn ball pushes it');
  }
}

// ------------------------------------------------------------------ 8. planted aim, no unbidden movement
console.log('planted aim, spawn, idle');
{
  const narrow = { id: 99, par: 1, container: { id: 'salad', x: 7, y: 0 }, cat: { x: -3, y: 8, facing: 1 }, platforms: [{ x: -3, y: 8, w: 5.6 }], props: [], treats: [] };
  const spots = [['the floor', LEVELS[0]], ['a narrow shelf', narrow]];
  for (const [label, lv] of spots) {
    for (const dir of [1, -1]) { // the circle swept both ways round
      const sim = createSim(T, lv), c = sim.cat;
      for (let f = 0; f < 60; f++) sim.step(DT);
      c.plant();
      const pins = [0, 1, 2, 3].filter((l) => c.anchor.pin[l]);
      for (let f = 0; f < 12; f++) sim.step(DT);
      const home = pins.map((l) => [c.x[paw(l)], c.y[paw(l)]]), surface = c.anchor.ay;
      let slide = 0, onGround = 0, fell = 0, nan = 0, cmax = 0;
      const hind = pins.map((l, k) => ({ l, k })); // (all the planted paws)
      const hc0 = [hind.reduce((a, o) => a + home[o.k][0], 0) / hind.length, hind.reduce((a, o) => a + home[o.k][1], 0) / hind.length];
      c.aim(3, 0.5);
      for (let f = 0; f < 180; f++) {
        const ang = dir * (f / 180) * Math.PI * 2, rr = 3.2;
        c.aim(Math.cos(ang) * rr, Math.sin(ang) * rr); sim.step(DT);
        if (c.anchor.flipping) continue; // (mid-turn he is edge-on: the paws are not where they will be, for 0.2 s)
        pins.forEach((l, k) => { const i = paw(l); if (c.y[i] - c.r0[i] - surface < 0.1) { onGround++; slide = Math.max(slide, Math.hypot(c.x[i] - c.anchor.pinX[l], c.y[i] - c.anchor.pinY[l])); } });
        const hx = hind.reduce((a, o) => a + c.x[paw(o.l)], 0) / hind.length, hy = hind.reduce((a, o) => a + c.y[paw(o.l)], 0) / hind.length;
        cmax = Math.max(cmax, Math.hypot(hx - hc0[0], hy - hc0[1]));
        if (c.mode !== 'ground') fell++;
        for (let i = 0; i < N; i++) if (!Number.isFinite(c.x[i])) nan++;
      }
      console.log(`  held aim swept through a full circle (${dir > 0 ? 'ccw' : 'cw'}) on ${label}: ${pins.length} planted paws; a paw on the ground moved at most ${slide.toFixed(3)} off its spot; centroid of the planted paws moved at most ${cmax.toFixed(4)}`);
      check(pins.length >= 2 && cmax < 0.05 && slide < 0.05 && onGround > 100 && fell === 0 && nan === 0, `planted: the centroid of the ground-contact nodes moves < 0.05 over 3 s of held aim on ${label} (${cmax.toFixed(4)}; feet on the ground never slide: ${slide.toFixed(3)})`);
      c.endAim(); for (let f = 0; f < 90; f++) sim.step(DT);
      check(c.mode === 'ground' && sim.leaps === 0, `cancelling the aim on ${label}: still on his spot, no leap`);
    }
  }
  // the cancel: the whole cat's centre of mass barely moves
  {
    const sim = createSim(T, LEVELS[0]), c = sim.cat;
    for (let f = 0; f < 60; f++) sim.step(DT);
    const x0 = cenX(c), h0 = c.x[HIPS];
    c.plant(); c.aim(2, 2); for (let f = 0; f < 40; f++) sim.step(DT); c.aim(0.1, 0.05); c.endAim(); for (let f = 0; f < 90; f++) sim.step(DT);
    check(Math.abs(cenX(c) - x0) < 0.4 && Math.abs(c.x[HIPS] - h0) < 0.05, `drag out, drag back inside the dead zone and release: no movement (centre ${Math.abs(cenX(c) - x0).toFixed(2)}, hips ${Math.abs(c.x[HIPS] - h0).toFixed(3)})`);
  }
  // preview vs flight: the arc drawn from his middle is the arc he flies, over the first 0.3 s
  {
    let worst = 0, worstHead = 0; const cases = [];
    for (const [a, p] of [[50, 0.7], [60, 0.6], [60, 0.9], [75, 0.8], [90, 0.9], [105, 0.7], [115, 0.6]]) {
      const sim = createSim(T, LEVELS[0]), c = sim.cat;
      for (let f = 0; f < 60; f++) sim.step(DT);
      const [dx, dy] = [Math.cos(a * Math.PI / 180) * p * T.pullMax, Math.sin(a * Math.PI / 180) * p * T.pullMax];
      c.plant(); c.aim(dx, dy); for (let f = 0; f < 18; f++) sim.step(DT);
      const v = launchVelocity(T, dx, dy), lp = {}; c.launchPoint(lp);
      const pre = []; for (let i = 0; i < 18; i++) pre.push({ x: 0, y: 0, t: 0 }); previewArc(T, lp.x, lp.y + T.launchHop, v.vx, v.vy, 18, 0.3, pre);
      sim.leapPull(dx, dy);
      let e = 0, eh = 0;
      for (let f = 1; f <= 18; f++) { sim.step(DT); c.launchPoint(lp); const q = pre[f - 1]; e = Math.max(e, Math.hypot(lp.x - q.x, lp.y - q.y)); }
      worst = Math.max(worst, e); cases.push(`${a}/${p}: ${e.toFixed(2)}`);
    }
    console.log(`  preview vs flight (his middle, first 0.3 s): ${cases.join('  ')}`);
    check(worst < 0.35, `the aim preview matches the flight of his middle over the first 0.3 s within 0.35 units (worst ${worst.toFixed(2)})`);
  }
  // spawn: clean, still, clear of the container
  for (const lv of LEVELS) {
    const sim = createSim(T, lv), c = sim.cat, caps = wallsOf(c);
    let cx06 = 0, ok = true, minGap = 1e9;
    for (let f = 0; f <= 180; f++) { if (f === 36) cx06 = cenX(c); sim.step(DT); }
    const cx3 = cenX(c); if (Math.abs(cx3 - cx06) > 0.1) ok = false;
    const g = lv.container.move ? wallsOf(c).slice(0, 0) : null; // (the moving box: measured at its nearest)
    for (let i = 0; i < N; i++) for (const cp of caps.slice(0, sim.cat.world.grpStart[1])) minGap = Math.min(minGap, capDist(cp, c.x[i], c.y[i]) - cp[4] - c.r[i]);
    let mg = minGap;
    if (lv.container.move) { // nearest the box ever comes to him
      const mv = lv.container.move; const sx = c.x.slice(); let worstG = 1e9;
      for (const bx of [mv.x0, mv.x1]) { c.moveContainer(bx); const cs = wallsOf(c); for (let i = 0; i < N; i++) for (const cp of cs.slice(0, sim.cat.world.grpStart[1])) worstG = Math.min(worstG, capDist(cp, sx[i], c.y[i]) - cp[4] - c.r[i]); }
      c.moveContainer(lv.container.x); mg = Math.min(mg, worstG);
    }
    { // winding up (the crouch) and turning round (a mirror about his planted paws) must not push his body into the container either
      const sim2 = createSim(T, lv), c2 = sim2.cat, P = c2.poses; let worst = 1e9; const f0 = c2.facing, hx = c2.x[HIPS], ay = c2.anchor.ay;
      let pm = 0; for (let l = 0; l < 4; l++) pm += P.sit[2 * paw(l)] / 4;
      const xs = lv.container.move ? [lv.container.move.x0, lv.container.move.x1] : [lv.container.x];
      for (const bx of xs) {
        c2.moveContainer(bx); const cs = wallsOf(c2).slice(0, c2.world.grpStart[1]);
        for (const [pose, hx2, f2] of [['crouch', hx, f0], ['sit', hx + 2 * f0 * pm, -f0], ['crouch', hx + 2 * f0 * pm, -f0]]) for (let i = 0; i < N; i++) for (const cp of cs) worst = Math.min(worst, capDist(cp, hx2 + f2 * P[pose][2 * i], ay + P[pose][2 * i + 1]) - cp[4] - c2.r0[i]);
      }
      check(worst >= 0.2, `level ${String(lv.id).padStart(2)} spawn: his crouch, and himself turned round on his paws, stay clear of the container (${worst.toFixed(2)})`);
    }
    check(ok && sim.cat.mode === 'ground', `level ${String(lv.id).padStart(2)} spawn: he stands still (centre moved ${Math.abs(cx3 - cx06).toFixed(3)} between 0.6 s and 3 s)`);
    check(mg >= 1.0, `level ${String(lv.id).padStart(2)} spawn: at least 1 unit clear of the container (${mg.toFixed(2)})`);
  }
  // idle: 60 s on a 5-wide shelf: no drift, never off it
  {
    const lv = { id: 98, par: 1, container: { id: 'salad', x: 7, y: 0 }, cat: { x: 0, y: 8, facing: 1 }, platforms: [{ x: 0, y: 8, w: 5 }], props: [], treats: [] };
    const sim = createSim(T, lv), c = sim.cat; const poses = new Set();
    let hmin = 1e9, hmax = -1e9, off = 0, nan = 0, xmin = 1e9, xmax = -1e9;
    for (let f = 0; f < 60 * 60; f++) {
      sim.step(DT); poses.add(c.poseName); if (c.mood) poses.add('mood:' + c.mood);
      hmin = Math.min(hmin, c.x[HIPS]); hmax = Math.max(hmax, c.x[HIPS]);
      if (c.mode !== 'ground' || c.y[HIPS] < 7.9) off++;
      for (let i = 0; i < N; i++) { if (!Number.isFinite(c.x[i])) nan++; if (i < TAIL0 || i >= LEG0) { xmin = Math.min(xmin, c.x[i]); xmax = Math.max(xmax, c.x[i]); } }
    }
    console.log(`  60 s idle on a 5-wide shelf: hips x range ${(hmax - hmin).toFixed(4)}, body x ${xmin.toFixed(2)}..${xmax.toFixed(2)} (shelf -2.5..2.5), things he did: ${[...poses].join(' ')}`);
    check(hmax - hmin < 0.05 && off === 0 && nan === 0, `idle for 60 s on a 5-wide shelf: no drift (hips ${(hmax - hmin).toFixed(4)}), never off it`);
    check(xmin > -2.5 - 1.2 && xmax < 2.5 + 1.2, 'idle poses do not reach out far past the ends of the shelf');
    check(poses.size >= 3, 'idle life: he still does several different things (a shelf this narrow keeps him to sitting, looking and yawning)');
  }
  // landing half off a shelf: he hops on (<= 0.6 units, once) or falls off at once
  {
    const lv = { id: 97, par: 1, container: { id: 'salad', x: 7.5, y: 0 }, cat: { x: -7, y: 0, facing: 1 }, platforms: [{ x: 3, y: 8, w: 6 }], props: [], treats: [] };
    let hop = 0, tip = 0, bad = 0;
    for (const dx of [-1.4, -0.9, -0.5, -0.2, 0, 0.5, 1.5]) {
      const sim = createSim(T, lv), c = sim.cat;
      c.setPose(null);
      // drop him sitting from just above the shelf with his support centre dx from the left edge (0)
      c.spawn(0 + dx + 1.0, 8.6, { pose: 'sit', dir: 1, clear: false }); for (let i = 0; i < N; i++) { /* placed */ }
      let t0 = -1, x0 = null, outOf = false;
      for (let f = 0; f < 240; f++) {
        sim.step(DT);
        if (t0 < 0 && c.anchor.on) { t0 = f; x0 = c.x[HIPS]; }
      }
      if (c.anchor.on) { const sc = Math.abs(c.anchor.hx - x0); if (sc > 0.7) bad++; hop++; } else { tip++; if (c.y[HIPS] > 7.9 && c.mode === 'ground') bad++; }
    }
    check(bad === 0 && hop + tip === 7, `landing across an edge: he hops fully on (<= 0.6 scoot) or falls off, never creeps (${hop} on, ${tip} off)`);
  }
}


// ------------------------------------------------------------------ 8b. perches: frozen wherever he can be aimed
console.log('perches');
{
  const scen = [
    ['the floor', { id: 90, par: 1, container: { id: 'salad', x: 7.5, y: 0 }, cat: { x: -5, y: 0, facing: 1 }, platforms: [], props: [], treats: [] }, null],
    ['a shelf', { id: 91, par: 1, container: { id: 'salad', x: 7.5, y: 0 }, cat: { x: -3, y: 8, facing: 1 }, platforms: [{ x: -3, y: 8, w: 7 }], props: [], treats: [] }, null],
    ['a cushion', { id: 92, par: 1, container: { id: 'salad', x: 7.5, y: 0 }, cat: { x: -3, y: 0.9, facing: 1 }, platforms: [], cushions: [{ x: -3, y: 0, w: 7 }], props: [], treats: [] }, null],
    ['the teacup rim', { id: 93, par: 1, container: { id: 'teacup', x: 0, y: 0 }, cat: { x: -6, y: 0, facing: 1 }, platforms: [], props: [], treats: [] }, [0.9, 3.8]],
    ['the top of the vase', { id: 94, par: 1, container: { id: 'vase', x: 0, y: 0 }, cat: { x: -6, y: 0, facing: 1 }, platforms: [], props: [], treats: [] }, [0.0, 5.6]],
    ['the box on its vac', { id: 95, par: 1, container: { id: 'box', x: 0, y: 0.7, move: { x0: -2, x1: 2, speed: 2.2 } }, cat: { x: -6.5, y: 0, facing: 1 }, platforms: [], props: [], treats: [] }, [1.2, 5.6]],
  ];
  for (const [label, lv, drop] of scen) {
    for (const dx0 of drop ? [0, 0.7, -0.7] : [0]) {
      const sim = createSim(T, lv), c = sim.cat;
      if (drop) { c.spawn(drop[0] + dx0, drop[1], { pose: 'sit', dir: 1, clear: false, seed: 5 }); } 
      let t = 0; for (; t < 360 && !(c.canAim && (c.frozen || c.anchor.on) && c.M.groundT > 0.2); t++) sim.step(DT);
      const settle = t / 60;
      if (!(c.canAim && (c.frozen || c.anchor.on))) { console.log(`   (${label} dx ${dx0}: he never came to rest aimable: mode ${c.mode}; skipped)`); continue; }
      const sup = c.frozen ? [...Array(N).keys()].filter((i) => c.fz.touch[i]) : [0, 1, 2, 3].map(paw);
      const home = sup.map((i) => [c.x[i], c.y[i]]), hc = [home.reduce((a, h) => a + h[0], 0) / home.length, home.reduce((a, h) => a + h[1], 0) / home.length], cx0 = cenX(c), cy0 = cenY(c);
      let worst = 0, cw = 0, nan = 0;
      c.plant();
      for (let f = 0; f < 180; f++) { const a = (f / 180) * Math.PI; c.aim(Math.cos(a) * 3.2, Math.sin(a) * 3.2); sim.step(DT);
        if (c.frozen) sup.forEach((i, k) => { worst = Math.max(worst, Math.hypot(c.x[i] - home[k][0], c.y[i] - home[k][1])); });
        else if (!c.anchor.flipping) { let sx = 0, sy = 0; sup.forEach((i) => { sx += c.x[i]; sy += c.y[i]; }); worst = Math.max(worst, Math.hypot(sx / sup.length - hc[0], sy / sup.length - hc[1])); } // (posed: the turn mirrors the feet about their centre, so their centroid is what stays)
        if (!lv.container.move) cw = Math.max(cw, c.frozen ? Math.hypot(cenX(c) - cx0, cenY(c) - cy0) : 0); for (let i = 0; i < N; i++) if (!Number.isFinite(c.x[i])) nan++; }
      console.log(`  ${label} (${dx0}): settled and aimable after ${settle.toFixed(2)} s (${c.frozen ? 'frozen' : 'posed'}, ${sup.length} support nodes); 3 s aim sweep 0-180: support moved at most ${worst.toFixed(4)}, centroid ${cw.toFixed(4)}`);
      if (!lv.container.move) check(nan === 0 && worst < 0.02 && cw < 0.05, `never moves while aimed on ${label} (support ${worst.toFixed(4)}, centroid ${cw.toFixed(4)})`);
      else check(nan === 0, `on ${label}: aim sweep is clean (he rides the box)`);
      if (c.frozen) { // the preview is the launch: from the frozen centroid
        const v = launchVelocity(T, 1.2, 2.6), lp = {}; c.launchPoint(lp); const pre = []; for (let i = 0; i < 18; i++) pre.push({ x: 0, y: 0, t: 0 }); previewArc(T, lp.x, lp.y, v.vx, v.vy, 18, 0.3, pre);
        c.aim(1.2, 2.6); for (let f = 0; f < 10; f++) sim.step(DT); c.launchPoint(lp); const pre2 = []; for (let i = 0; i < 18; i++) pre2.push({ x: 0, y: 0, t: 0 }); previewArc(T, lp.x, lp.y, v.vx, v.vy, 18, 0.3, pre2);
        sim.leapPull(1.2, 2.6); let e = 0; for (let f = 1; f <= 18; f++) { sim.step(DT); c.launchPoint(lp); e = Math.max(e, Math.hypot(lp.x - pre2[f - 1].x, lp.y - pre2[f - 1].y)); }
        check(e < 0.45, `launch from a frozen perch matches the preview over 0.3 s (${e.toFixed(2)})`);
      }
    }
  }
}

// ------------------------------------------------------------------ 9. treats, DROP, cushion, cucumber, the moving box
console.log('treats, drop, cushion, cucumber, box');
{
  // treats: any part of him touching one collects it once; reset gives them back
  {
    const lv = { ...LEVELS[0], treats: [{ x: -5, y: 3 }, { x: -5, y: 30 }, { x: 8, y: 1 }] };
    const sim = createSim(T, lv);
    for (let f = 0; f < 30; f++) sim.step(DT);
    check(sim.treatsGot === 1 && sim.treats[0].got && !sim.treats[1].got, 'treats: one touched by his body is collected (and only that one)');
    for (let f = 0; f < 30; f++) sim.step(DT);
    check(sim.treatsGot === 1, 'treats: collected once');
    sim.reset(); check(sim.treatsGot === 0 && sim.treats.every((t) => !t.got), 'treats come back with the attempt');
  }
  // DROP: horizontal speed dies, he dives, a splat on the floor recovers to sitting
  {
    const lv = { ...LEVELS[0], container: { id: 'salad', x: 7.4, y: 0 }, cat: { x: -6, y: 0, facing: 1 }, treats: [] };
    const sim = createSim(T, lv), c = sim.cat;
    for (let f = 0; f < 45; f++) sim.step(DT);
    const a = 55 * Math.PI / 180, L = 0.6 * T.pullMax;
    c.plant(); c.aim(Math.cos(a) * L, Math.sin(a) * L); for (let f = 0; f < 16; f++) sim.step(DT);
    sim.leapPull(Math.cos(a) * L, Math.sin(a) * L);
    for (let f = 0; f < 20; f++) sim.step(DT);
    const vx0 = c.M.vxc, vy0 = c.M.vyc;
    check(!c.dropped && sim.drop() && c.dropped, 'DROP: works in the air after a leap');
    check(!sim.drop(), 'DROP: only once per leap');
    for (let f = 0; f < 9; f++) sim.step(DT);
    const vx = c.M.vxc, vy = c.M.vyc;
    console.log(`  DROP: horizontal speed ${vx0.toFixed(1)} -> ${vx.toFixed(1)} after 0.15 s, vertical ${vy0.toFixed(1)} -> ${vy.toFixed(1)}`);
    check(Math.abs(vx) < 0.15 * Math.abs(vx0) && vy < vy0 - 10, 'DROP: horizontal speed < 15% within 0.15 s and he is kicked downward');
    let t = 0; while (c.mode === 'air' && t < 400) { sim.step(DT); t++; }
    const landedOnFloor = c.mode === 'ground' || c.anchor.on;
    let rec = -1, f2 = 0, minH = 99; for (; f2 < 120; f2++) { sim.step(DT); if (c.anchor.on) minH = Math.min(minH, c.y[HEAD] - c.anchor.ay); if (rec < 0 && isSitting(c)) rec = f2; }
    console.log(`  DROP splat on the floor: landed after ${(t / 60).toFixed(2)} s, sitting again ${(rec / 60).toFixed(2)} s later (lowest his head went ${minH.toFixed(2)} above the floor)`);
    check(landedOnFloor && rec >= 0 && rec < 60, `DROP splat recovers to sitting in < 1 s (${(rec / 60).toFixed(2)} s)`);
    check(!sim.drop(), 'DROP: not on the ground');
  }
  // DROP into the vase pours him straight in
  {
    const lv = LEVELS.find((l) => l.id === 4), w = findWin(lv, [0.5, 0.65, 0.8, 0.95, 1.1, 1.25]);
    let dropped = false;
    if (w) { const sim = createSim(T, lv), c = sim.cat; for (let f = 0; f < 45; f++) sim.step(DT); const r = runLeg(sim, w, calmStop(c)); dropped = sim.complete && r.dropFrame >= 0; }
    check(dropped, `DROP into the vase opening: he goes straight in and the level is won (${w ? w.a + ' deg, power ' + w.p.toFixed(1) + ', drop at ' + w.d + ' s' : 'no line found'})`);
  }
  // cushion: he is thrown back along the normal with 0.85 of the speed; the same leap
  {
    const lv = { id: 96, par: 1, container: { id: 'salad', x: 7, y: 12 }, cat: { x: -7, y: 0, facing: 1 }, platforms: [], cushions: [{ x: 0, y: 0, w: 6 }], props: [], treats: [] };
    const sim = createSim(T, lv), c = sim.cat;
    for (let f = 0; f < 30; f++) sim.step(DT);
    for (let i = 0; i < N; i++) { c.y[i] += 12; c.py[i] += 12; c.x[i] += 7; c.px[i] += 7; } // up and over the cushion
    c.anchor.on = false; c.M.leaping = true; c.M.leapT = 0.3; c.M.airT = 1;
    for (let i = 0; i < N; i++) { c.px[i] = c.x[i]; c.py[i] = c.y[i] + 0.2; } // falling
    let vin = 0, vout = 0, boing = false, lp = {}; const L = sim.leaps;
    for (let f = 0; f < 200 && !boing; f++) { c.launchPoint(lp); const y0 = lp.y; sim.step(DT); c.launchPoint(lp); const v = (lp.y - y0) * 60; if (c.events.includes('boing')) { boing = true; vin = Math.min(-vinPrev, T.cushionCap); } else vinPrev = v; c.events.length = 0; }
    { c.launchPoint(lp); const y0 = lp.y; sim.step(DT); c.launchPoint(lp); vout = (lp.y - y0) * 60 + 0.5; } // (the next step's displacement, plus the gravity it includes)
    console.log(`  cushion: arrived at ${vin.toFixed(1)} u/s, left at ${vout.toFixed(1)} u/s (ratio ${(vout / vin).toFixed(2)})`);
    check(boing && vout > 0.6 * vin && vout < 0.85 * vin && sim.leaps === L, 'cushion: re-launches him with ~0.72 of the incoming speed along the normal, and it is the same leap');
  }
  // cucumber: startled straight up, once, 1.15 x the highest leap; it rolls off and fades
  {
    const lv = { id: 95, par: 1, container: { id: 'salad', x: -7, y: 0 }, cat: { x: 2, y: 0, facing: 1 }, platforms: [], cucumbers: [{ x: 7.4, y: 0 }], props: [], treats: [] };
    const sim = createSim(T, lv), c = sim.cat; c.top = 60; c.M.rest = 'loaf'; // (a loaf: his head is low, close to the floor)
    let started = false, top = 0, lp = {}, vy0 = 0, startles = 0;
    for (let f = 0; f < 240; f++) {
      sim.step(DT); c.launchPoint(lp); for (const e of c.events) if (e === 'startle') startles++;
      if (!started && c.startled) { started = true; vy0 = c.M.vyc; }
      if (started) top = Math.max(top, lp.y); c.events.length = 0;
    }
    const base = 1.9, maxRise = measuredRise;
    console.log(`  cucumber: startled ${startles}x, rose ${(top - base).toFixed(1)} (1.15 x the highest leap, ${maxRise.toFixed(1)} = ${(T.startleHeight * maxRise).toFixed(1)}), take-off speed ${vy0.toFixed(1)}`);
    check(started && startles === 1, 'cucumber: his head near it startles him, once');
    check(top - base > 0.9 * T.startleHeight * maxRise && top - base < 1.1 * T.startleHeight * maxRise, 'cucumber: an instant super-jump about 1.15 x the highest leap');
    check(sim.cucumbers[0].state === 'gone', 'cucumber: it rolled away and faded');
    sim.reset(); check(sim.cucumbers[0].state === 'live', 'cucumber: back for the next attempt');
  }
  // the box on its robo-vac: the cat inside stays inside while it drives and turns
  {
    const lv = LEVELS.find((l) => l.id === 10), sim = createSim(T, lv), c = sim.cat, w10 = findWin(lv, [null, 0.55]);
    check(!!w10, 'level 10 (the box on the robo-vac) has a winning shot');
    for (let f = 0; f < 45; f++) sim.step(DT);
    if (w10) runLeg(sim, w10, calmStop(c));
    let minIn = 1e9, xmin = 1e9, xmax = -1e9, turns = 0, dir = sim.cdir, out = 0;
    for (let f = 0; f < 60 * 12; f++) {
      sim.step(DT); c.events.length = 0; xmin = Math.min(xmin, sim.cx); xmax = Math.max(xmax, sim.cx);
      if (sim.cdir !== dir) { turns++; dir = sim.cdir; }
      if (f > 90) { let n = 0; for (let i = 0; i < N; i++) if (c.inside[i]) n++; minIn = Math.min(minIn, n); if (!c.inside[HEAD] || !c.inside[3]) out++; }
    }
    console.log(`  moving box: x ${xmin.toFixed(1)}..${xmax.toFixed(1)}, ${turns} turns in 12 s, fewest nodes inside ${minIn}/${N}`);
    check(sim.complete && turns >= 2 && xmin <= lv.container.move.x0 + 0.01 && xmax >= lv.container.move.x1 - 0.01, 'moving box: he won and the box drove between its limits and turned');
    check(out === 0 && minIn >= 20, `moving box: the cat inside stays inside while it drives and turns (head and chest always in; fewest nodes in ${minIn})`);
  }
  // the 3-star lines of the solver (when there are any): replaying them gives 3 treats
  try {
    const { SOLUTIONS } = await import('../src/solutions.js');
    const ids = Object.keys(SOLUTIONS).map(Number);
    if (ids.length) {
      const { verifyLine } = await import('./solvelib.mjs');
      let bad = 0; for (const id of ids) { const v = verifyLine(LEVELS.find((l) => l.id === id), SOLUTIONS[id].line); if (!(v.complete && v.treats >= 3)) { bad++; console.log('   level', id, JSON.stringify(v)); } }
      check(bad === 0, `the stored 3-star lines replay to 3 treats (${ids.length} levels)`);
    }
  } catch (e) { console.log('   (no stored lines)', e.message); }
}

// ------------------------------------------------------------------ 8c. the moments: kickies and lickies (swirlies and destroyies are drawing only)
{
  // cushion: at most 2-3 bounces, then he sits
  {
    const lv = { id: 94, par: 1, container: { id: 'salad', x: 7, y: 12 }, cat: { x: -7, y: 0, facing: 1 }, platforms: [], cushions: [{ x: 0, y: 0, w: 6 }], props: [], treats: [] };
    const sim = createSim(T, lv), c = sim.cat;
    for (let f = 0; f < 30; f++) sim.step(DT);
    for (let i = 0; i < N; i++) { c.y[i] += 14; c.py[i] += 14; c.x[i] += 7; c.px[i] += 7; }
    c.anchor.on = false; c.M.leaping = true; c.M.leapT = 0.3; c.M.airT = 1;
    for (let i = 0; i < N; i++) { c.px[i] = c.x[i]; c.py[i] = c.y[i] + 0.4; }
    let boings = 0; for (let f = 0; f < 600; f++) { sim.step(DT); for (const e of c.events) if (e === 'boing') boings++; c.events.length = 0; }
    check(boings >= 1 && boings <= 3, `cushion: a fall onto it bounces ${boings} time(s) (at most 3), then he sits`);
  }
  // kickies on level 17: find a leap that grabs the mouse
  const lv = LEVELS.find((l) => l.id === 17);
  let hit = null;
  for (let a = 25; a <= 80 && !hit; a += 5) for (const p of [0.6, 0.75, 0.9]) {
    const sim = createSim(T, lv), c = sim.cat; for (let f = 0; f < 45; f++) sim.step(DT);
    const L = p * T.pullMax, ar = a * Math.PI / 180; c.aim(Math.cos(ar) * L, Math.sin(ar) * L); for (let f = 0; f < 14; f++) sim.step(DT);
    sim.leapPull(Math.cos(ar) * L, Math.sin(ar) * L);
    for (let f = 0; f < 150 && !sim.kicks; f++) sim.step(DT);
    if (sim.kicks) { hit = { a, p, sim }; break; }
  }
  check(!!hit, `kickies: a leap into the mouse on level 17 grabs it (${hit ? hit.a + ' deg, power ' + hit.p : 'none found'})`);
  if (hit) {
    const sim = hit.sim, c = sim.cat, snap = sim.snapshot();
    for (let f = 0; f < 20; f++) sim.step(DT);
    check(c.kicking && c.canAim, 'kickies: he hangs, kicking, and can be aimed');
    check(sim.leaps === 1, `kickies: the grab is not a leap (leaps ${sim.leaps})`);
    let c0 = 0, cy0 = 0; for (let i = 0; i < N; i++) { c0 += c.x[i]; cy0 += c.y[i]; } c0 /= N; cy0 /= N;
    for (let f = 0; f < 60; f++) sim.step(DT);
    let c1 = 0, cy1 = 0; for (let i = 0; i < N; i++) { c1 += c.x[i]; cy1 += c.y[i]; } c1 /= N; cy1 /= N;
    check(Math.hypot(c1 - c0, cy1 - cy0) < 0.25, `kickies: he hangs in place while kicking (moved ${Math.hypot(c1 - c0, cy1 - cy0).toFixed(2)})`);
    for (let f = 0; f < 200 && c.kicking; f++) sim.step(DT);
    check(!c.kicking, 'kickies: with no aim he lets go and falls within ~1.6 s');
    sim.restore(snap);
    for (let f = 0; f < 20; f++) sim.step(DT);
    c.aim(-8, 9); for (let f = 0; f < 20; f++) sim.step(DT);
    check(c.kicking, 'kickies: he keeps hanging while the aim is held');
    sim.leapPull(-8, 9); for (let f = 0; f < 4; f++) sim.step(DT);
    const toy = sim.props.list.find((q) => q.toy);
    check(sim.leaps === 1 && !c.kicking, `kickies: the re-launch is not a leap (leaps ${sim.leaps})`);
    check(toy && toy.state === 'live' && Math.hypot(toy.vx, toy.vy) > 2 && toy.vx > 0, `kickies: the toy is kicked the opposite way (vx ${toy ? toy.vx.toFixed(1) : '?'}), a real prop`);
  }
  // lickies: after ~5 s of sitting he licks a paw; a touch cancels it at once and he can still be aimed
  {
    const d = createCat(T); d.top = TOP; d.spawn(0, 1.5, { pose: 'sit', dir: 1 });
    let licked = 0, first = -1; for (let f = 0; f < 60 * 10; f++) { d.step(DT); for (const e of d.events) if (e === 'lickies') { licked++; if (first < 0) first = f / 60; } d.events.length = 0; if (d.licking && f / 60 > first && first > 0) break; }
    check(licked >= 1 && first > 4 && first < 8.5, `lickies: he licks a paw after sitting still (first at ${first.toFixed(1)} s)`);
    check(d.licking && d.canAim, 'lickies: he can be aimed while licking');
    d.cancelLick(); d.step(DT);
    check(!d.licking, 'lickies: a touch cancels it at once');
  }
}

// ------------------------------------------------------------------ 9. the feel layer: impact events from the sim, and a presentation layer that never touches the sim
{
  const { createFeel } = await import('../src/feel.js');
  const lv = { id: 93, par: 1, container: { id: 'salad', x: 7, y: 0 }, cat: { x: -7, y: 0, facing: 1 }, platforms: [], props: [], treats: [] };
  const drop = (h, withFeel) => {
    const sim = createSim(T, lv), c = sim.cat, feel = withFeel ? createFeel(T) : null; for (let f = 0; f < 30; f++) sim.step(DT);
    c.spawn(-4, h, { pose: 'stand', dir: 1 }); const evs = []; let stops = 0;
    for (let f = 0; f < 240; f++) {
      sim.step(DT);
      while (c.impacts.length) { const e = c.impacts.shift(); evs.push(e); if (feel) stops += feel.onImpact(e); }
      if (feel) feel.update(DT, c);
    }
    return { evs, snap: JSON.stringify(c.snapshot()), stops };
  };
  const speeds = [];
  for (const h of [2, 5, 10, 18]) {
    const r = drop(h, false), prim = r.evs.filter((e) => !e.secondary && e.kind === 'floor'), first = prim[0];
    check(prim.length >= 1 && prim.length <= 3, `impact events: a drop from ${h} gives a floor landing (${prim.length} primary events in 4 s)`);
    if (first) { check(Math.abs(first.nx) < 0.01 && first.ny > 0.99, `impact events: a floor impact has the surface normal (0, 1) (${first.nx.toFixed(2)}, ${first.ny.toFixed(2)})`); speeds.push(first.speed); }
  }
  check(speeds.length === 4 && speeds.every((v, i) => i === 0 || v > speeds[i - 1]), `impact strength rises with the fall height (${speeds.map((v) => v.toFixed(1)).join(' < ')})`);
  // the layer on or off: identical sim state
  const a = drop(10, false), b = drop(10, true);
  check(a.snap === b.snap, 'the feel layer never changes sim state (the same fall with the layer on and off: identical snapshots)');
  // springs settle, never explode, under rapid repeated impacts; hit-stop is bounded
  const F = createFeel(T); let bad = 0, stopFrames = 0, frames = 0, cool = 0;
  const kinds = ['floor', 'shelf', 'wall', 'ceiling', 'rim', 'cushion'];
  for (let f = 0; f < 3000; f++) {
    if (f % 7 === 0 && f < 2400) { const k = kinds[(f / 7) % kinds.length | 0]; const st = F.onImpact({ kind: k, x: 0, y: 0, nx: k === 'wall' ? 1 : 0, ny: k === 'ceiling' ? -1 : 1, speed: 6 + (f * 7919 % 25), tan: (f * 31 % 20), tanSign: f % 2 ? 1 : -1, part: 'paws', secondary: false }); if (st) stopFrames += st; }
    if (f % 190 === 0 && f < 2400) F.onSplat();
    if (stopFrames > 0 && f % 3 === 0) { stopFrames--; frames++; continue; } // (a stopped frame: nothing advances)
    F.update(DT, null);
    for (const k of ['sqF', 'sqH', 'lean', 'skid', 'pn', 'camX', 'camY', 'camZ']) if (!Number.isFinite(F[k].x) || Math.abs(F[k].x) > 40) bad++;
    frames++;
  }
  check(bad === 0, 'feel springs: no NaN and nothing explodes under 340 rapid repeated impacts');
  for (let f = 0; f < 72; f++) F.update(DT, null);
  check(F.maxOffset() < 0.01, `feel springs: every offset under 1% within 1.2 s of the last impact (${F.maxOffset().toFixed(4)})`);
  const G2 = createFeel(T); let totalStop = 0, t = 0; for (let f = 0; f < 600; f++) { const st = G2.onImpact({ kind: 'wall', x: 0, y: 0, nx: 1, ny: 0, speed: 30, tan: 0, tanSign: 1, part: 'head', secondary: false }); totalStop += st; t += 1 + st; G2.update(DT, null); G2.stopCool -= 0; }
  check(totalStop / Math.max(1, t) < 0.4, `hit-stop is bounded: at most once per 0.25 s, ${(100 * totalStop / t).toFixed(0)}% of time frozen under constant full-speed impacts`);
}

// ------------------------------------------------------------------ 10. the animator (presentation): invariants over every clip
{
  const { createSkeleton, PROP, LIM, LEN } = await import('../src/skeleton.js');
  const surfOf = (lv, c) => (x) => { // the same surface rule as the game: the floor, or the shelf / cushion top within reach under him
    let low = 1e9; for (let i = 0; i < c.N; i++) { const b = c.y[i] - c.r[i]; if (b < low) low = b; }
    let s = 0; for (const p of lv.platforms || []) if (Math.abs(x - p.x) < p.w / 2 + 0.1 && p.y <= low + 0.9 && p.y > s) s = p.y;
    for (const q of lv.cushions || []) if (Math.abs(x - q.x) < q.w / 2 && q.y + T.cushionH <= low + 0.9 && q.y + T.cushionH > s) s = q.y + T.cushionH;
    return s; };
  const mkCtx = (lv, c) => ({ surfY: surfOf(lv, c), facing: 1, dt: DT, vx: 0, vy: 0, mode: 'ground', solid: true, squashF: 0, squashH: 0, t: 0, tailUp: 0 });
  const prep = (ctx, c) => { ctx.facing = c.facing; ctx.vx = c.M.vxc; ctx.vy = c.M.vyc; ctx.mode = c.mode; ctx.t = c.time; ctx.solid = !c.kicking && (c.mode === 'ground' || c.mode === 'air') && c.M.splat < 0.25; };
  const newStats = () => ({ frames: 0, nan: 0, lenBad: 0, limBad: 0, maxLenErr: 0, minElbow: 9, maxElbow: 0, minKnee: 9, maxKnee: 0, minHock: 9, maxHock: 0, minWrist: 9, maxWrist: 0, minSh: 9, maxSh: -9, minHip: 9, maxHip: -9, centBad: 0, maxCent: 0, flightFrames: 0, srcs: [0, 0, 0] });
  const L_ = LEN;
  const metrics = (SK, c, st) => { // the skeleton's own geometry, every frame
    const J = SK.J, f = SK.f; st.frames++;
    for (let i = 0; i < 32; i++) if (!Number.isFinite(J[i])) st.nan++;
    for (let i = 0; i < 27; i++) if (!Number.isFinite(SK.X[i]) || !Number.isFinite(SK.Y[i]) || !Number.isFinite(SK.R[i])) st.nan++;
    for (let i = 0; i < 8; i++) if (!Number.isFinite(SK.tip[i]) || !Number.isFinite(SK.FT[i])) st.nan++;
    st.srcs[SK.src]++;
    // body axis at the shoulder / hip for the shoulder and hip angles
    const ax = (i) => { let fx = SK.X[i - 1] - SK.X[i + 1], fy = SK.Y[i - 1] - SK.Y[i + 1]; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l; let ux = -fy * f, uy = fx * f; if (SK.src === 1 && uy < 0) { ux = -ux; uy = -uy; } return [fx, fy, ux, uy]; };
    const [sfx, sfy, sux, suy] = ax(4), [hfx, hfy, hux, huy] = ax(11);
    const lim = (v, r, key) => { if (v < r[0] - 0.02 || v > r[1] + 0.02) { st.limBad++; (st.by = st.by || {})[key] = (st.by[key] || 0) + 1; { const kk = SK.clip + '/' + key; st.byc = st.byc || {}; const o = st.byc[kk] || (st.byc[kk] = { n: 0, w: 0 }); o.n++; if (Math.abs(v) > Math.abs(o.w)) o.w = +v.toFixed(2); } (st.ex = st.ex || {})[key] = v; if (!st.first) st.first = { f: st.frames, src: SK.src, clip: SK.clip, key, v, f_: SK.f, facing: c.facing, side: +c.side.toFixed(2), vy: +c.M.vyc.toFixed(1), vx: +c.M.vxc.toFixed(1), age: +c.M.leapAge.toFixed(2), J: Array.from(SK.J.slice(16, 24)).map((q) => +q.toFixed(2)), n11: [+SK.X[11].toFixed(2), +SK.Y[11].toFixed(2), +SK.X[9].toFixed(2), +SK.Y[9].toFixed(2)] }; } };
    for (let l = 0; l < 4; l++) {
      const j = l * 8, P = (k) => [J[j + k * 2], J[j + k * 2 + 1]], a = P(0), b = P(1), cc = P(2), d = P(3), D = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      const l1 = l < 2 ? L_.hum : L_.fem, l2 = l < 2 ? L_.fore : L_.tib, l3 = l < 2 ? L_.paw : L_.meta;
      const err = Math.max(Math.abs(D(a, b) - l1) / l1, Math.abs(D(b, cc) - l2) / l2, Math.abs(D(cc, d) - l3) / l3);
      st.maxLenErr = Math.max(st.maxLenErr, err); if (err > 0.01) st.lenBad++;
      const mid = S_angle(a, b, cc), end = S_angle(b, cc, d);
      if (l < 2) {
        st.minElbow = Math.min(st.minElbow, mid); st.maxElbow = Math.max(st.maxElbow, mid); lim(mid, LIM.elbow, 'elbow');
        st.minWrist = Math.min(st.minWrist, end); st.maxWrist = Math.max(st.maxWrist, end); lim(end, LIM.wrist, 'wrist');
        const hx = b[0] - a[0], hy = b[1] - a[1], sh = Math.atan2(-(hx * sfx + hy * sfy), -(hx * sux + hy * suy)); // + = swung back
        if (SK.src !== 0 && SK.clip !== 'turn') { st.minSh = Math.min(st.minSh, sh); st.maxSh = Math.max(st.maxSh, sh); lim(sh, LIM.shoulder, 'shoulder'); } // (the sim-drawn states, a cat on his back in a container, keep today's drawing: only elbow, wrist, knee and hock are limited there)
      } else {
        st.minKnee = Math.min(st.minKnee, mid); st.maxKnee = Math.max(st.maxKnee, mid); lim(mid, LIM.knee, 'knee');
        st.minHock = Math.min(st.minHock, end); st.maxHock = Math.max(st.maxHock, end); lim(end, LIM.hock, 'hock');
        const hx = b[0] - a[0], hy = b[1] - a[1], hp = Math.atan2(hx * hfx + hy * hfy, -(hx * hux + hy * huy)); // + = forward
        if (SK.src !== 0 && SK.clip !== 'turn') { st.minHip = Math.min(st.minHip, hp); st.maxHip = Math.max(st.maxHip, hp); lim(hp, LIM.hip, 'hip'); }
      }
    }
    if (SK.src === 1 && SK.clip !== 'turn' && SK.clip !== 'land') { // silhouette rules on the ground: no elbow above the back line, knee ahead of the hip, hock behind the knee
      const back = SK.Y[4] + SK.R[4] + 0.05; let bad = 0;
      for (let l = 0; l < 2; l++) if (J[l * 8 + 3] > back && !SK.swinging[l]) bad++;
      for (let l = 2; l < 4; l++) { const j = l * 8; if (SK.swinging[l]) continue; if (f * (J[j + 2] - J[j]) < -0.05 || f * (J[j + 4] - J[j + 2]) > 0.05) bad++; }
      if (bad) { st.silBad = (st.silBad || 0) + 1; if (!st.silFirst) st.silFirst = SK.clip; } }
    if (SK.src === 2 && SK.blendE === 1) { // in flight the drawn body stays within 0.6 of the sim's centroid
      let sx = 0, sy = 0, dx = 0, dy = 0; for (let i = 0; i < 13; i++) { sx += c.x[i]; sy += c.y[i]; dx += SK.X[i]; dy += SK.Y[i]; }
      const d = Math.hypot((sx - dx) / 13, (sy - dy) / 13); st.flightFrames++; st.maxCent = Math.max(st.maxCent, d); if (d > 0.6) st.centBad++;
    }
  };
  const S_angle = (a, b, c) => { const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1]; return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1)))); };
  const merge = (A, B) => { for (const k of ['frames', 'nan', 'lenBad', 'limBad', 'centBad', 'flightFrames']) A[k] += B[k]; if (B.first && !A.first) A.first = B.first; if (B.byc) { A.byc = A.byc || {}; for (const k in B.byc) { const o = A.byc[k] || (A.byc[k] = { n: 0, w: 0 }); o.n += B.byc[k].n; if (Math.abs(B.byc[k].w) > Math.abs(o.w)) o.w = B.byc[k].w; } } if (B.by) { A.by = A.by || {}; for (const k in B.by) A.by[k] = (A.by[k] || 0) + B.by[k]; } for (const k of ['maxLenErr', 'maxCent', 'maxElbow', 'maxKnee', 'maxHock', 'maxWrist', 'maxSh', 'maxHip']) A[k] = Math.max(A[k], B[k]); for (const k of ['minElbow', 'minKnee', 'minHock', 'minWrist', 'minSh', 'minHip']) A[k] = Math.min(A[k], B[k]); for (let i = 0; i < 3; i++) A.srcs[i] += B.srcs[i]; };
  const run = (lv, nLeaps, withSk) => { // random leaps, 150 frames each
    const sim = createSim(T, lv), c = sim.cat, SK = withSk ? createSkeleton(T) : null, ctx = mkCtx(lv, c); for (let f = 0; f < 45; f++) sim.step(DT);
    const stats = newStats();
    const upd = () => { if (!SK) return; prep(ctx, c); if (!ctx.solid) { metricsSkip = true; } SK.update(c, c.x, c.y, c.r, ctx); metrics(SK, c, stats); };
    let metricsSkip = false;
    let rs = 777; const rr = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
    for (let k = 0; k < nLeaps; k++) {
      if (sim.complete) { sim.reset(); for (let f = 0; f < 45; f++) sim.step(DT); }
      const a = (-20 + 220 * rr()) * Math.PI / 180, L = (0.35 + 0.65 * rr()) * T.pullMax;
      if (c.canAim) { c.plant(); c.aim(Math.cos(a) * L, Math.sin(a) * L); for (let f = 0; f < 14; f++) { sim.step(DT); upd(); } sim.leapPull(Math.cos(a) * L, Math.sin(a) * L); }
      for (let f = 0; f < 150; f++) { sim.step(DT); upd(); if (sim.complete) break; }
    }
    return { stats, snap: JSON.stringify(c.snapshot()) };
  };
  const all = newStats(); all.maxLenErr = 0;
  for (const id of [1, 8, 11, 18]) { const lv = LEVELS.find((l) => l.id === id), r = run(lv, 300, true); merge(all, r.stats); }
  check(all.nan === 0, `animator: no NaN over ${all.frames} frames of 300 random leaps on each of levels 1, 8, 11, 18`);
  check(all.lenBad === 0, `animator: bone lengths constant (largest error ${(100 * all.maxLenErr).toFixed(3)}%)`);
  check(all.limBad === 0, `animator: every elbow, wrist, knee, hock, shoulder and hip stays inside its joint limits over the leaps (elbow ${all.minElbow.toFixed(2)}..${all.maxElbow.toFixed(2)}, wrist ${all.minWrist.toFixed(2)}..${all.maxWrist.toFixed(2)}, knee ${all.minKnee.toFixed(2)}..${all.maxKnee.toFixed(2)}, hock ${all.minHock.toFixed(2)}..${all.maxHock.toFixed(2)}, shoulder ${all.minSh.toFixed(2)}..${all.maxSh.toFixed(2)}, hip ${all.minHip.toFixed(2)}..${all.maxHip.toFixed(2)}; ${all.limBad} frames out ${JSON.stringify(all.by || {})} first ${JSON.stringify(all.first)} ${JSON.stringify(all.byc)})`);
  check(all.flightFrames > 2000 && all.centBad === 0, `animator: in flight the drawn body stays within 0.6 units of the sim's centroid (${all.flightFrames} frames, worst ${all.maxCent.toFixed(3)})`);
  check(all.srcs[1] > 1000 && all.srcs[2] > 1000, `animator: the ground and flight sources both ran (${all.srcs.join(' / ')} frames: sim / ground / flight)`);
  const lv8 = LEVELS.find((l) => l.id === 8), r0 = run(lv8, 40, false), r1 = run(lv8, 40, true);
  check(r0.snap === r1.snap, 'the animator never changes sim state (the same run with it on and off: identical snapshots)');
  // clips: stand / sit / aim sweeps / walk / turn / sit-stand: joint stats, and planted feet never slide
  { const sweep = new (class { constructor() { this.worst = 0; this.n = 0; } })();
    const clipRun = (label, setup, frames, perFrame, slideFrom = 40) => {
      const sim = createSim(T, lv8), c = sim.cat, SK = createSkeleton(T), ctx = mkCtx(lv8, c); for (let f = 0; f < 30; f++) sim.step(DT);
      c.spawnAt(-2, 0, 1); const st = newStats(); let prev = null, slide = 0, sw = 0;
      if (setup) setup(c, SK, sim);
      for (let f = 0; f < frames; f++) {
        if (perFrame) perFrame(f, c, SK, sim);
        sim.step(DT); prep(ctx, c); SK.update(c, c.x, c.y, c.r, ctx); metrics(SK, c, st);
        if (SK.src === 1 && f > 5) for (let l = 0; l < 4; l++) if (!SK.swinging[l]) { const yy = SK.J[l * 8 + 7] - SK.Y[0] * 0; if (yy < 0.08) st.floorBad = (st.floorBad || 0) + 1; }
        if (f >= slideFrom && prev) for (let l = 0; l < 4; l++) if (!SK.swinging[l] && !prev.sw[l] && !(l === 0 && SK.lickW > 0.005)) { const d = Math.abs(SK.FT[l * 2] - prev.ft[l * 2]); if (d > slide) slide = d; }
        prev = { ft: SK.FT.slice(), sw: SK.swinging.slice() };
      }
      return { st, slide, SK, c };
    };
    const lims = (r) => r.st.nan === 0 && r.st.lenBad === 0 && r.st.limBad === 0 && !r.st.floorBad && !r.st.silBad;
    const note = (label, r) => `${label}: nan ${r.st.nan}, bones ${r.st.lenBad}, limits ${r.st.limBad}, feet below the floor ${r.st.floorBad || 0}, silhouette-rule frames ${r.st.silBad || 0} ${r.st.silFirst || ''}${r.st.by ? ' ' + JSON.stringify(r.st.by) + ' first ' + JSON.stringify(r.st.first) : ''}, feet slide ${r.slide.toFixed(4)}`;
    const stand = clipRun('stand', (c) => { c.M.rest = 'stand'; }, 300);
    check(lims(stand) && stand.slide < 0.03, `animator: stand idle (breathing, weight shift, tail): ${note('', stand)}`);
    const sit = clipRun('sit', null, 300);
    check(lims(sit) && sit.slide < 0.03, `animator: sit idle: ${note('', sit)}`);
    const loaf = clipRun('loaf', (c) => { c.M.rest = 'loaf'; }, 300);
    check(lims(loaf) && loaf.slide < 0.03, `animator: loaf: ${note('', loaf)}`);
    const ss = clipRun('sit<>stand', null, 520, (f, c) => { if (f === 20) c.M.rest = 'stand'; if (f === 200) c.M.rest = 'sit'; if (f === 380) c.M.rest = 'stand'; }, 9999);
    check(lims(ss), `animator: sit to stand to sit transitions: ${note('', ss)}`);
    // aim sweeps: power 0.3 / 0.6 / 1.0, the pull angle sweeps from 10 to 150 degrees on one side (no turn) and back: feet planted, no sliding
    for (const pw of [0.3, 0.6, 1.0]) {
      const r = clipRun('aim', (c) => { c.M.rest = 'sit'; }, 400, (f, c) => { const a = (10 + 80 * (0.5 + 0.5 * Math.sin(f / 40))) * Math.PI / 180, L = pw * T.pullMax; if (f === 20) c.plant(); if (f >= 20) c.aim(Math.cos(a) * L, Math.sin(a) * L); }, 120);
      check(lims(r) && r.slide < 0.03, `animator: aim sweep at ${(pw * 100) | 0}% power, feet planted while the direction changes: ${note('', r)}`);
    }
    const walk = clipRun('walk', (c, SK) => { c.M.rest = 'stand'; }, 420, (f, c, SK) => { if (f === 60) SK.cmd.walk = 1; if (f === 330) SK.cmd.walk = 0; }, 9999);
    check(lims(walk) && walk.SK.stepCount >= 8, `animator: walk (lateral-sequence gait, ${walk.SK.stepCount} steps): ${note('', walk)}`);
    const turn = clipRun('turn', (c) => { c.M.rest = 'sit'; }, 300, (f, c) => { if (f >= 30 && f < 200) { const a = 40 * Math.PI / 180, L = 0.5 * T.pullMax; if (f === 30) c.plant(); c.aim(-Math.cos(a) * L, Math.sin(a) * L); } if (f === 200) c.endAim(); }, 9999);
    check(lims(turn) && turn.SK.f === -1, `animator: step-round turn: ${note('', turn)}, facing ${turn.SK.f}`);
  }
  // the hind-leg Z is real: standing, the hock is off the floor and behind the toes; sitting it is flat
  { const sim = createSim(T, lv8), c = sim.cat, SK = createSkeleton(T), ctx = mkCtx(lv8, c); for (let f = 0; f < 30; f++) sim.step(DT); c.spawnAt(-2, 0, 1); c.M.rest = 'stand';
    for (let f = 0; f < 200; f++) { sim.step(DT); prep(ctx, c); SK.update(c, c.x, c.y, c.r, ctx); }
    const hockH = SK.J[2 * 8 + 5], ballX = SK.J[2 * 8 + 6], hockX = SK.J[2 * 8 + 4], sh = SK.Y[4] + 0.7, bl = PROP.BL;
    check(hockH > 0.6 && hockX < ballX, `standing: the hind hock is held off the floor (${hockH.toFixed(2)} high) and points back of the toes`);
    check(Math.abs(sh / bl - 0.52) < 0.04, `standing: shoulder height ${(sh / bl).toFixed(2)} BL (target 0.52), hips ${((SK.Y[12] + 0.54) / bl).toFixed(2)} BL (target 0.55)`);
    c.M.rest = 'sit'; for (let f = 0; f < 200; f++) { sim.step(DT); prep(ctx, c); SK.update(c, c.x, c.y, c.r, ctx); }
    check(SK.J[2 * 8 + 5] < 0.5, `sitting: the hocks fold flat (${SK.J[2 * 8 + 5].toFixed(2)} high)`);
  }
  // cost: advance + limbs per frame (node; the bench has the no-JIT number)
  { const sim = createSim(T, lv8), c = sim.cat, SK = createSkeleton(T), ctx = mkCtx(lv8, c); for (let f = 0; f < 60; f++) sim.step(DT); prep(ctx, c); const t0 = now(); for (let f = 0; f < 600; f++) { ctx.t = f / 60; SK.update(c, c.x, c.y, c.r, ctx); } const per = (now() - t0) / 600;
    console.log(`cost: ${per.toFixed(4)} ms/frame for the animator in node`); check(per < 0.1, 'animator update under 0.1 ms in node'); }
}

// ------------------------------------------------------------------ 6. cost
{
  const c = newCat(CONTAINERS.vase); c.spawn(0, c.rimY + 3);
  const g = c.beginGrab(c.x[HEAD], c.y[HEAD]);
  let tot = 0, n = 600;
  for (let f = 0; f < n; f++) { c.moveGrab(g, Math.sin(f / 30) * 3, c.rimY + 1 + Math.cos(f / 25)); const t0 = now(); c.step(DT); tot += now() - t0; }
  console.log(`cost: ${(tot / n).toFixed(3)} ms/step in node (vase, held)`);
  check(tot / n < 0.25, 'step under 0.25 ms in node');
  const d = createCat(T); d.top = TOP; d.spawn(0, 1.5, { pose: 'sit', dir: 1 }); for (let f = 0; f < 120; f++) d.step(DT);
  let t2 = 0; for (let f = 0; f < 600; f++) { const t0 = now(); d.step(DT); t2 += now() - t0; }
  console.log(`cost: ${(t2 / 600).toFixed(3)} ms/step in node (sitting on the table)`);
  check(t2 / 600 < 0.25, 'sitting step under 0.25 ms in node');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
