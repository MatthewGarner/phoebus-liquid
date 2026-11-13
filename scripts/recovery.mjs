// node scripts/recovery.mjs : touchdown -> aimable (and settled into his pose) times, for a floor landing, a shelf landing and a rim landing, light / heavy and after a splat
import { createSim } from '../src/sim.js';
import { TUNE as T } from '../src/tune.js';
const DT = 1 / 60;
const lv = { id: 90, par: 1, container: { id: 'pot', x: 6, y: 0 }, cat: { x: -6, y: 0, facing: 1 }, platforms: [{ x: -2, y: 6, w: 6 }], props: [], treats: [] };
function run(label, drop0, x0, height, doDrop) {
  const sim = createSim(T, lv), c = sim.cat; for (let f = 0; f < 60; f++) sim.step(DT);
  c.spawn(x0, height, { pose: 'stand', dir: 1 }); let land = -1, aim = -1, pose = -1, minH = 9;
  for (let f = 0; f < 400; f++) {
    if (doDrop && f === 4) { c.M.leaping = true; sim.drop(); }
    sim.step(DT); const ev = c.events; if (land < 0 && (ev.includes('land') || ev.includes('splat'))) land = f; ev.length = 0;
    if (land >= 0 && aim < 0 && c.canAim && c.mode === 'ground') { let ok = true; for (let k = 0; k < 6; k++) { if (!c.canAim) ok = false; } if (ok) aim = f; }
    if (land >= 0 && pose < 0 && c.anchor.on && c.M.crouch < 0.08 && c.M.splat < 0.08 && c.canAim) pose = f;
  }
  console.log(`${label.padEnd(26)} touchdown f${land}: aimable after ${aim >= 0 ? ((aim - land) / 60).toFixed(2) : 'never'} s, settled in pose after ${pose >= 0 ? ((pose - land) / 60).toFixed(2) : 'never'} s`);
}
run('floor, light (h 2)', 0, -6, 2.5); run('floor, medium (h 7)', 0, -6, 7); run('floor, heavy (h 14)', 0, -6, 14);
run('shelf, medium (h 6+4)', 0, -2, 10.5); run('shelf, heavy (h 6+11)', 0, -2, 17); run('floor, DROP splat', 0, -6, 14, true);
