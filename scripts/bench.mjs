// Engine benchmark for the whole sim step (cat + props + rules) on the heaviest level (16: the moving box, a cushion, a cucumber, six props) while he
// sits, winds up, leaps (mid-leap: the soft-body rig, contacts and awake props all running), lands and settles:
//   node scripts/bench.mjs
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc --useJIT=false -m scripts/bench.mjs
// (JIT off, like the owner's iPhone.) Budget: the whole step under 2.5 ms.
import { createSim } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';
import { TUNE } from '../src/tune.js';
const now = typeof preciseTime === 'function' ? () => preciseTime() * 1000 : () => performance.now();
const out = typeof print === 'function' ? print : console.log;
const DT = 1 / 60;

const base = LEVELS[15];
const lv = { ...base, props: [
  { type: 'yarn', x: 3.5, y: 14 }, { type: 'orange', x: 4.5, y: 14 }, { type: 'mug', x: 2.6, y: 14 },
  { type: 'plant', x: -4.3, y: 20 }, { type: 'mug', x: -5.4, y: 20 }, { type: 'orange', x: -6.4, y: 20 }] };

const sim = createSim(TUNE, lv), cat = sim.cat;
for (const p of sim.props.list) p.asleep = false;
const times = { 'sitting': [], 'wind-up': [], 'mid-leap': [], 'landing': [], 'settle': [] };
const run = (label, n, hook) => { for (let f = 0; f < n; f++) { if (hook) hook(f); const t0 = now(); sim.step(DT); times[label].push(now() - t0); } };
run('sitting', 90);
const ang = 150 * Math.PI / 180, L = 0.8 * TUNE.pullMax, dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
cat.plant(); cat.aim(dx, dy); run('wind-up', 60, () => { cat.aim(dx, dy); });
sim.leapPull(dx, dy);
run('mid-leap', 45);
run('landing', 60);
run('settle', 200);
const stat = (a) => { const s = a.slice().sort((x, y) => x - y); return { mean: a.reduce((x, y) => x + y, 0) / a.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
let worst = 0;
for (const k in times) { const s = stat(times[k]); worst = Math.max(worst, s.p95); out(`${k.padEnd(9)} mean ${s.mean.toFixed(3)} ms/step  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(3)}   (${times[k].length} steps)`); }
out(`props awake at the end: ${sim.props.awake}; knocked ${sim.props.knocked}; cat ${cat.mode}; worst p95 ${worst.toFixed(3)} ms (budget 2.5)`);

// kickies: level 17's mouse. He grabs it in flight, hangs and kicks for ~1.6 s (the held pose, the hind-leg pump, the toy), then launches again.
{
  const sim2 = createSim(TUNE, LEVELS.find((l) => l.id === 17)), c2 = sim2.cat, ts = [];
  for (let f = 0; f < 45; f++) sim2.step(DT);
  const a = 45 * Math.PI / 180, p = 0.75 * TUNE.pullMax, ax = Math.cos(a) * p, ay = Math.sin(a) * p;
  c2.plant(); c2.aim(ax, ay); for (let f = 0; f < 14; f++) sim2.step(DT);
  sim2.leapPull(ax, ay);
  for (let f = 0; f < 150; f++) { const t0 = now(); sim2.step(DT); if (c2.kicking) ts.push(now() - t0); if (f === 100 && c2.kicking) c2.aim(-6, 8); }
  const s = stat(ts.length ? ts : [0]);
  out(`kickies   mean ${s.mean.toFixed(3)} ms/step  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(3)}   (${ts.length} steps while kicking)`);
  worst = Math.max(worst, s.p95);
}
out(`all scenarios: worst p95 ${worst.toFixed(3)} ms (budget 2.5)`);

// won and settled: what a step costs while he sits finished and relaxed in the container (the game loop no longer steps it at all once the win has settled)
{
  const lv1 = LEVELS[0], sim3 = createSim(TUNE, lv1), c3 = sim3.cat, ts = [];
  for (let f = 0; f < 45; f++) sim3.step(DT);
  const a = 75 * Math.PI / 180, p = 1.0 * TUNE.pullMax, ax = Math.cos(a) * p, ay = Math.sin(a) * p;
  c3.plant(); c3.aim(ax, ay); for (let f = 0; f < 14; f++) sim3.step(DT);
  sim3.leapPull(ax, ay);
  for (let f = 0; f < 400 && !sim3.complete; f++) sim3.step(DT);
  for (let f = 0; f < 200; f++) sim3.step(DT); // (let it settle)
  for (let f = 0; f < 200; f++) { const t0 = now(); sim3.step(DT); ts.push(now() - t0); }
  const s = stat(ts);
  out(`won+settled mean ${s.mean.toFixed(3)} ms/step  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(3)}   (complete ${sim3.complete}; the loop skips these steps: 0 ms)`);
}

// the feel layer (presentation: springs + the body deformation written for rendering) while a heavy impact is playing out
{
  const { createFeel } = await import('../src/feel.js');
  const sim4 = createSim(TUNE, LEVELS[0]), c4 = sim4.cat, F = createFeel(TUNE), ts = [];
  for (let f = 0; f < 60; f++) sim4.step(DT);
  F.onImpact({ kind: 'floor', x: 0, y: 0, nx: 0, ny: 1, speed: 28, tan: 8, tanSign: 1, part: 'paws', secondary: false });
  for (let f = 0; f < 90; f++) { const t0 = now(); F.update(DT, c4); if (F.active) F.apply(c4); ts.push(now() - t0); if (f === 40) F.onImpact({ kind: 'wall', x: 8, y: 5, nx: -1, ny: 0, speed: 20, tan: 3, tanSign: 1, part: 'head', secondary: false }); }
  const s = stat(ts);
  out(`feel layer mean ${s.mean.toFixed(3)} ms/frame  p95 ${s.p95.toFixed(3)}  max ${s.max.toFixed(3)}   (update + apply over a heavy impact; idle it is 0: it is off when nothing moves)`);
}

// the animator (presentation): the whole drawn pose (state machine, key-point spline, feet, four legs, tail) every frame, per scenario. Budget: under 0.1 ms per frame, no JIT.
{
  const { createSkeleton } = await import('../src/skeleton.js');
  const lvA = LEVELS[7], sim5 = createSim(TUNE, lvA), c5 = sim5.cat, SK = createSkeleton(TUNE);
  const ctx = { surfY: () => 0, facing: 1, dt: DT, vx: 0, vy: 0, mode: 'ground', solid: true, squashF: 0, squashH: 0, t: 0 };
  const prep = () => { ctx.facing = c5.facing; ctx.vx = c5.M.vxc; ctx.vy = c5.M.vyc; ctx.mode = c5.mode; ctx.t = c5.time; ctx.solid = !c5.kicking && (c5.mode === 'ground' || c5.mode === 'air'); };
  const rows = {};
  const frame = (label) => { prep(); const t0 = now(); SK.update(c5, c5.x, c5.y, c5.r, ctx); (rows[label] = rows[label] || []).push(now() - t0); };
  for (let f = 0; f < 90; f++) { sim5.step(DT); prep(); }
  for (let f = 0; f < 200; f++) { sim5.step(DT); frame('stand/sit idle'); }
  c5.M.rest = 'stand'; for (let f = 0; f < 120; f++) { sim5.step(DT); frame('sit<>stand'); }
  SK.cmd.walk = 1; for (let f = 0; f < 200; f++) { sim5.step(DT); frame('walk'); } SK.cmd.walk = 0;
  c5.M.rest = 'sit'; for (let f = 0; f < 60; f++) { sim5.step(DT); frame('sit<>stand'); }
  const ang = 60 * Math.PI / 180, L = 1.0 * TUNE.pullMax;
  c5.plant(); c5.aim(Math.cos(ang) * L, Math.sin(ang) * L); for (let f = 0; f < 90; f++) { c5.aim(Math.cos(ang) * L, Math.sin(ang) * L); sim5.step(DT); frame('aim crouch'); }
  sim5.leapPull(Math.cos(ang) * L, Math.sin(ang) * L);
  for (let f = 0; f < 140; f++) { sim5.step(DT); frame(c5.mode === 'air' ? 'flight' : 'landing / settle'); }
  for (let f = 0; f < 100; f++) { sim5.step(DT); frame('landing / settle'); }
  let worstA = 0;
  for (const k in rows) { const s = stat(rows[k]); worstA = Math.max(worstA, s.p95); out(`animator  ${k.padEnd(16)} mean ${s.mean.toFixed(4)} ms/frame  p95 ${s.p95.toFixed(4)}  max ${s.max.toFixed(4)}   (${rows[k].length} frames)`); }
  out(`animator worst p95 ${worstA.toFixed(4)} ms (budget 0.1)`);
}
