// node scripts/solve.mjs [levelIds...] [--quick] [--write]
// For every level: search lines (angle, power and optional mid-air DROP time per leap, up to par + 2 successive leaps) with the same sim run headlessly, and report
//   - completable (must be yes)
//   - the best number of treats (stars) within par and within par + 1
//   - the share of first shots (angle x power) that at least complete the level within par + 2 leaps (levels 1-3 >= 10%, every level >= 1.5%)
//   - the most robust 3-star line (angle in degrees, power, drop time per leap), which GAME.debug.replay(i) plays; --write stores them in src/solutions.js
// Deeper leaps are searched with a beam (the most promising landing spots on each surface), so the counts are lower bounds. Exits non-zero on a failure.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { solveLevel, mostRobust, MODES } from './solvelib.mjs';
import { LEVELS } from '../src/levels.js';

if (!isMainThread) {
  const lv = LEVELS.find((l) => l.id === workerData.id);
  const r = solveLevel(lv, workerData.opts);
  if (!r.cands || !r.cands.length) { // the coarse grid missed it: look again on the quick grid (other angles and powers)
    const q = solveLevel(lv, { ...MODES.quick, phases: workerData.opts.phases });
    if (q.cands && q.cands.length) { r.cands = q.cands; r.completable = r.completable || q.completable; r.legs += q.legs; r.bestTreatsPar = Math.max(r.bestTreatsPar, q.bestTreatsPar); r.bestTreatsPar1 = Math.max(r.bestTreatsPar1, q.bestTreatsPar1); }
  }
  r.robust = r.cands && r.cands.length ? mostRobust(lv, r.cands) : null;
  delete r.cands;
  parentPort.postMessage(r);
} else {
  const args = process.argv.slice(2), ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const opts = args.includes('--quick') ? MODES.quick : MODES.full;
  const todo = LEVELS.filter((l) => !ids.length || ids.includes(l.id));
  const t0 = Date.now(), out = [];
  let running = 0, next = 0;
  const fmtLine = (lines) => lines.map((s) => `${s.a.toFixed(0)}deg ${s.p.toFixed(2)}${s.d !== null && s.d !== undefined ? ' drop@' + s.d.toFixed(2) + 's' : ''}`).join('  ->  ');
  const done = () => {
    out.sort((a, b) => a.id - b.id);
    console.log('\nlevel par | completable | best stars within par / par+1 | first shots completing within par+2 | 3-star line');
    let bad = 0;
    const sol = {};
    for (const r of out) {
      const pct = (100 * r.share).toFixed(1);
      const l3 = r.robust;
      console.log(`${String(r.id).padStart(5)} ${r.par}   | ${r.completable ? 'yes' : 'NO '}         | ${r.bestTreatsPar} / ${r.bestTreatsPar1}                         | ${pct.padStart(5)}%                              | ${l3 ? `${l3.leaps} leap(s), ${(l3.score * 100).toFixed(0)}% robust: ${fmtLine(l3.lines)}` : 'NONE'}`);
      if (!r.completable) bad++;
      if (!l3) { console.log(`      ^ level ${r.id} has no 3-star line within par`); bad++; }
      else sol[r.id] = { leaps: l3.leaps, score: +l3.score.toFixed(2), line: l3.lines };
      if (r.id <= 3 && r.share < 0.10) { console.log(`      ^ level ${r.id} is not forgiving enough (< 10% of first shots complete within par+2)`); bad++; }
      if (r.share < 0.015) { console.log(`      ^ level ${r.id}: under 1.5% of first shots complete within par+2`); bad++; }
    }
    console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s, ${out.reduce((a, r) => a + r.legs, 0)} legs`);
    if (args.includes('--write') && !ids.length) {
      writeFileSync(new URL('../src/solutions.js', import.meta.url), `// The most robust 3-star line for every level (angle in degrees, 0 = right; power 0..1; d = seconds after the leap to DROP; n = frames the leap runs).\n// Written by scripts/solve.mjs --write; GAME.debug.replay(i) plays them.\nexport const SOLUTIONS = ${JSON.stringify(sol)};\n`);
      console.log('wrote src/solutions.js');
    }
    process.exit(bad ? 1 : 0);
  };
  const launch = () => {
    while (running < 8 && next < todo.length) {
      const lv = todo[next++]; running++;
      const w = new Worker(new URL(import.meta.url), { workerData: { id: lv.id, opts } });
      w.on('message', (r) => { out.push(r); console.log(`level ${r.id}: ${r.completable ? 'completable' : 'NOT completable'}, stars ${r.bestTreatsPar}/${r.bestTreatsPar1}, ${(100 * r.share).toFixed(1)}% first shots, ${r.legs} legs`); });
      w.on('error', (e) => { console.error('level', lv.id, e); out.push({ id: lv.id, par: lv.par, completable: false, share: 0, legs: 0, bestTreatsPar: 0, bestTreatsPar1: 0, robust: null }); });
      w.on('exit', () => { running--; if (next >= todo.length && running === 0) done(); else launch(); });
    }
  };
  launch();
}
