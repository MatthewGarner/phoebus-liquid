// node scripts/soak.mjs [levelIds...]  [--leaps N]
// The softlock soak bot: on every level, random leaps (random power and angle, random DROPs, and a kickies re-aim when he is hanging on a toy). Whenever he is at rest
// and aimable, 8 full-power directions are tried from a snapshot; if none of them moves his centre more than 2 units, that is a softlock and it is logged.
import { createSim, launchVelocity } from '../src/sim.js';
import { TUNE as T } from '../src/tune.js';
import { LEVELS } from '../src/levels.js';
import { N } from '../src/cat.js';
const DT = 1 / 60, args = process.argv.slice(2), ids = args.filter((a) => /^\d+$/.test(a)).map(Number), li = args.indexOf('--leaps');
const LEAPS = li >= 0 ? +args[li + 1] : 300;
let seed = 987654321; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const centre = (c) => { let x = 0, y = 0; for (let i = 0; i < N; i++) { x += c.x[i]; y += c.y[i]; } return [x / N, y / N]; };
let peak = 0, noAim = 0;
function shoot(sim, a, p, dropAt, track) {
  const c = sim.cat, L = p * T.pullMax, ar = a * Math.PI / 180;
  if (!c.canAim) { noAim++; return false; }
  c.plant(); c.aim(Math.cos(ar) * L, Math.sin(ar) * L); for (let f = 0; f < 14; f++) sim.step(DT);
  if (!sim.leapPull(Math.cos(ar) * L, Math.sin(ar) * L)) return false;
  const c0 = track ? centre(c) : null; peak = 0;
  for (let f = 0; f < 150; f++) { sim.step(DT); if (f === dropAt) sim.drop(); if (track) { const q = centre(c); peak = Math.max(peak, Math.hypot(q[0] - c0[0], q[1] - c0[1])); } if (sim.complete) break; if (c.kicking && f > 40) break; }
  return true;
}
const rest = (sim) => { const c = sim.cat; for (let f = 0; f < 420; f++) { if (sim.complete) return false; if (c.canAim && c.cat !== null && c.ke < 0.6 && (c.mode === 'ground' || c.mode === 'contained' || c.frozen || c.anchor.on)) { let ok = true; for (let k = 0; k < 20; k++) { sim.step(DT); if (!c.canAim) ok = false; } if (ok) return true; } sim.step(DT); } return false; };
let total = 0, locks = 0; const out = [];
for (const lv of LEVELS) {
  if (ids.length && !ids.includes(lv.id)) continue;
  seed = 1000 + lv.id * 7919; const sim = createSim(T, lv), c = sim.cat; for (let f = 0; f < 60; f++) sim.step(DT);
  let tested = 0, lockL = 0;
  for (let k = 0; k < LEAPS; k++) {
    if (sim.complete) { sim.reset(); for (let f = 0; f < 60; f++) sim.step(DT); }
    if (c.kicking) { shoot(sim, 180 * rnd(), 0.4 + 0.6 * rnd(), -1); }
    else shoot(sim, -20 + 220 * rnd(), 0.35 + 0.65 * rnd(), rnd() < 0.3 ? Math.floor(5 + rnd() * 80) : -1);
    if (!rest(sim)) continue;
    tested++; const snap = sim.snapshot(), c0 = centre(c); let best = 0;
    if (process.env.LIVE) { shoot(sim, 45, 1, -1, true); best = peak; if (best < 2.5) console.log('   live shot also stuck', peak.toFixed(2));
    if (best < 2.5 && process.env.TRACE && !globalThis.__t) { globalThis.__t = 1; sim.restore(snap); const L = T.pullMax, ar = 45 * Math.PI / 180; console.log('mode0', c.mode, 'frozen', c.frozen, 'anchor', c.anchor.on, 'canAim', c.canAim, 'facing', c.facing); c.plant(); c.aim(Math.cos(ar) * L, Math.sin(ar) * L); for (let f = 0; f < 14; f++) sim.step(DT); console.log('after aim: mode', c.mode, 'frozen', c.frozen, 'anchor', c.anchor.on, 'flip', c.M.flip, 'canAim', c.canAim, 'facing', c.facing); const r = sim.leapPull(Math.cos(ar) * L, Math.sin(ar) * L); console.log('leap', r, 'pending', JSON.stringify(c.M.pending)); for (let f = 0; f < 40; f++) { sim.step(DT); if (f % 4 === 0) { const q = centre(c); console.log(f, q[0].toFixed(2), q[1].toFixed(2), c.mode, 'vy', c.M.vyc.toFixed(1), 'leaping', c.M.leaping, 'flip', c.M.flip); } } sim.restore(snap); } sim.restore(snap); }
    for (let d = 0; d < 8 && best < 2.5; d++) {
      sim.restore(snap); shoot(sim, d * 45, 1, -1, true); best = Math.max(best, peak);
      if (sim.complete) best = 99;
    }
    sim.restore(snap);
    if (best < 2.5) { // maybe he frees himself (the wriggle): wait 6 s and look again
      let resc = 0, minInn = 9, maxInn = 0; for (let f = 0; f < 360; f++) { sim.step(DT); for (const e of c.events) if (e === 'rescue') resc++; c.events.length = 0; minInn = Math.min(minInn, c.M.inn); maxInn = Math.max(maxInn, c.M.inn); if (f % 60 === 0 && process.env.WAIT) console.log('   t', f / 60, 'inn', c.M.inn.toFixed(2), 'mode', c.mode, 'ke', c.ke.toFixed(2), 'rescueT', c.M.rescueT.toFixed(2), 'aim', c.M.aim.on, 'planted', c.anchor.planted, 'kicking', c.kicking); }
      if (process.env.WAIT && !globalThis.__r) { globalThis.__r = 1; console.log('   rescues', resc, 'inn range', minInn.toFixed(2), maxInn.toFixed(2)); }
      if (process.env.WAIT && !globalThis.__w) { globalThis.__w = 1; console.log('after 6s: mode', c.mode, 'inn', c.M.inn.toFixed(2), 'stuck', c.M.stuck, 'rescueT', c.M.rescueT.toFixed(2), 'canAim', c.canAim, 'ke', c.ke.toFixed(2), 'planted', c.anchor.planted, 'relaxed', c.relaxed); }
      if (c.canAim) { const snap2 = sim.snapshot(), cc0 = centre(c); best = 0; if (process.env.WAIT && !globalThis.__w2) { globalThis.__w2 = 1; for (let d = 0; d < 8; d++) { sim.restore(snap2); shoot(sim, d * 45, 1, -1, true); console.log('   dir', d * 45, peak.toFixed(2), c.mode, 'x', centre(c)[0].toFixed(2)); } console.log('   x0', cc0.map((v) => v.toFixed(2)).join(','), 'nodes x', Array.from(c.x).slice(0, 13).map((v) => v.toFixed(1)).join(' ')); } for (let d = 0; d < 8 && best < 2.5; d++) { sim.restore(snap2); shoot(sim, d * 45, 1, -1, true); best = Math.max(best, peak); } sim.restore(snap2); void cc0; }
      else best = 0;
      sim.restore(snap);
    }
    if (best < 2.5 && process.env.TR2 && !globalThis.__tr2) { globalThis.__tr2 = 1; sim.restore(snap); const L = T.pullMax; c.plant(); c.aim(0, L); for (let f = 0; f < 14; f++) sim.step(DT); console.log('pre-leap mode', c.mode, 'anchor', c.anchor.on, 'canAim', c.canAim, 'facing', c.facing, 'aimS', c.M.aimS); console.log('leap', sim.leapPull(0, L)); for (let f = 0; f < 12; f++) { sim.step(DT); console.log(f, 'cy', centre(c)[1].toFixed(2), 'head', c.x[0].toFixed(2), c.y[0].toFixed(2), 'hips', c.x[12].toFixed(2), c.y[12].toFixed(2), 'vyc', c.M.vyc.toFixed(1), c.mode, 'flip', c.M.flip, 'pending', JSON.stringify(c.M.pending)); } sim.restore(snap); }
    if (best < 2.5 && process.env.VERBOSE) { for (let d = 0; d < 8; d++) { sim.restore(snap); const ok = shoot(sim, d * 45, 1, -1, true); console.log('   dir', d * 45, ok, peak.toFixed(2), c.mode, 'leaps', sim.leaps); } sim.restore(snap); }
    if (best < 2.5 && process.env.DUMP && !globalThis.__d) { globalThis.__d = 1; console.log('x', Array.from(c.x).map((v) => v.toFixed(2)).join(' ')); console.log('y', Array.from(c.y).map((v) => v.toFixed(2)).join(' ')); console.log('top', c.top, 'rimY', c.rimY, 'mode', c.mode, 'M', JSON.stringify({ leapT: c.M.leapT, flip: c.M.flip, stuck: c.M.stuck, inn: c.M.inn })); }
    if (best < 2.5 && process.env.EXP && !globalThis.__e) {
      globalThis.__e = 1; const cc = c; const LEG0 = 19, TAIL0 = 13;
      for (const a of [0, 90, 180]) { sim.restore(snap); shoot(sim, a, 1, -1, true); console.log('  dir', a, 'peak', peak.toFixed(2)); }
      sim.restore(snap); for (let i = TAIL0; i < LEG0; i++) { cc.x[i] = cc.x[12] + 0.4 * (i - TAIL0 + 1) * (cc.x[12] > cc.x[0] ? 1 : -1); cc.y[i] = cc.y[12] + 0.1; cc.px[i] = cc.x[i]; cc.py[i] = cc.y[i]; } shoot(sim, 90, 1, -1, true); console.log('  tail moved, up:', peak.toFixed(2));
      sim.restore(snap); console.log('  contHit etc: facing', cc.facing, 'M.aim', cc.M.aim.on);
    }
    if (best < 2.5) { lockL++; if (lockL <= 3) out.push(`  level ${lv.id}: SOFTLOCK at (${c0[0].toFixed(2)}, ${c0[1].toFixed(2)}) mode ${c.mode} anchor ${c.anchor.on} frozen ${c.frozen} cont ${c.mode === 'contained'}`); }
  }
  total += tested; locks += lockL;
  console.log(`level ${String(lv.id).padStart(2)}: ${tested} rest states tested, ${lockL} softlocks`);
}
for (const l of out) console.log(l);
console.log(`\n${total} rest states, ${locks} softlocks (${noAim} shots refused because he was not aimable after a restore)`);
process.exit(locks ? 1 : 0);
