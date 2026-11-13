// node scripts/fixn.mjs: re-derive every stored leg's frame count n by replaying the line to the win (some legs ended a few frames before the container
// pours him in; replaying with that n then stops early). Rewrites src/solutions.js in place.
import { writeFileSync } from 'node:fs';
import { createSim } from '../src/sim.js';
import { TUNE as T } from '../src/tune.js';
import { runLeg, WARM_FRAMES, DT } from '../src/replay.js';
import { LEVELS } from '../src/levels.js';
import { SOLUTIONS } from '../src/solutions.js';
for (const id of Object.keys(SOLUTIONS)) {
  const sol = SOLUTIONS[id], sim = createSim(T, LEVELS.find((l) => l.id === +id));
  for (let f = 0; f < WARM_FRAMES; f++) sim.step(DT);
  sol.line.forEach((shot, k) => { const last = k === sol.line.length - 1; const r = runLeg(sim, shot, () => false, last ? 420 : shot.n); if (!r) { console.log('level', id, 'leg', k, 'could not leap'); return; } if (last) shot.n = r.frames; });
}
writeFileSync(new URL('../src/solutions.js', import.meta.url), `// The most robust 3-star line for every level (angle in degrees, 0 = right; power 0..1; d = seconds after the leap to DROP; n = frames the leap runs).\n// Written by scripts/solve.mjs --write (then scripts/fixn.mjs); GAME.debug.replay(i) plays them.\nexport const SOLUTIONS = ${JSON.stringify(SOLUTIONS)};\n`);
console.log('rewrote src/solutions.js');
