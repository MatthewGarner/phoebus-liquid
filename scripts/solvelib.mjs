// The level solver (see scripts/solve.mjs, the command line).
// It searches lines (src/replay.js): for each leap an angle x power grid and an optional DROP time, up to par + 2 successive leaps, with the same sim run
// headlessly. For every level it reports
//   - completable
//   - the best number of treats (stars) on a line within par leaps, and within par + 1
//   - the share of first shots (angle x power; any drop) that at least complete the level within par + 2 leaps
//   - the best 3-star line, picked for robustness (nearby shots also win)
// Deeper leaps are searched with a beam (the most promising landing spots on each surface), so the numbers are lower bounds.
import { createSim } from '../src/sim.js';
import { TUNE as T } from '../src/tune.js';
import { runLeg, DT, WARM_FRAMES } from '../src/replay.js';

export const MODES = {
  full:  { aMin: -45, aMax: 225, aStep: 5, powers: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], coarse: 2, beam1: 12, beam2: 7, dropTimes: ['T', 0.3, 0.55, 0.8, 1.1], dropStep: 10, maxExtra: 2 },
  quick: { aMin: -30, aMax: 210, aStep: 7.5, powers: [0.35, 0.5, 0.65, 0.8, 0.95], coarse: 2, beam1: 6, beam2: 4, dropTimes: ['T', 0.5, 0.9], dropStep: 15, maxExtra: 1 },
};

const settleStop = () => { let calm = 0; return (cat) => (f) => { if (cat.kicking && cat.kickT > 0.05) return true; // he grabbed a toy: the leg ends here, the next aim is a kickies re-aim
    if (f > 20 && (cat.mode === 'ground' || cat.mode === 'contained') && cat.ke < 0.15) { return ++calm > (cat.mode === 'contained' ? 150 : 12); } calm = 0; return false; }; };

export function solveLevel(level, opts) {
  const sim = createSim(T, level), cat = sim.cat;
  const par = level.par, maxLeaps = par + 1 + (opts.maxExtra ?? 1) + ((level.toys || []).length ? 2 : 0);
  const phases = level.container.move ? (opts.phases || [0, 25, 50, 75, 100, 125]) : [0];
  const tx = level.container.x, ty = cat.rimY + 1;
  const stats = { legs: 0 };

  const angles = []; for (let a = opts.aMin; a <= opts.aMax + 1e-9; a += opts.aStep) angles.push(a);
  const grid = []; for (const a of angles) for (const p of opts.powers) grid.push({ a, p });
  const coarse = grid.filter((s, i) => (Math.round(s.a / opts.aStep) % opts.coarse === 0) && (opts.powers.indexOf(s.p) % 2 === 1));
  const dropGrid = grid.filter((s) => (Math.round(s.a / opts.aStep) % Math.max(1, Math.round(opts.dropStep / opts.aStep)) === 0) && (opts.powers.indexOf(s.p) % 2 === 0 || opts.powers.length < 5));
  const coarse2 = grid.filter((s) => (Math.round(s.a / opts.aStep) % (opts.coarse * 2) === 0) && (opts.powers.indexOf(s.p) % 3 === 1 || s.p === 1));
  const dropGrid2 = dropGrid.filter((s, i) => i % 2 === 0);
  const withDrops = (list) => { const out = list.map((s) => ({ ...s, d: null })); return out; };

  function describe() {
    let cx = 0, cy = 0;
    const lp = cat.launchPoint({}); cx = lp.x; cy = lp.y;
    let lo = 1e9; for (let i = 0; i < cat.N; i++) lo = Math.min(lo, cat.y[i] - cat.r[i]);
    const surf = Math.round(lo * 2) / 2;
    const mask = sim.treats.reduce((m, t, i) => m | (t.got ? 1 << i : 0), 0);
    return { key: `${surf}|${Math.round(cx / 0.8)}|${cat.mode}|${mask}|${cat.kicking ? 'k' : ''}`, surf, mask, dist: Math.hypot(0.5 * (cx - sim.cx), cy - ty) + (3 - sim.treatsGot) * 3 };
  }

  // one leg from the current state; returns the outcome (with a snapshot unless complete)
  function leg(shot) {
    stats.legs++;
    const r = runLeg(sim, shot, settleStop()(cat));
    if (!r) return null;
    const d = describe();
    const line = { a: shot.a, p: shot.p, d: r.dropFrame >= 0 ? +(r.dropFrame / 60).toFixed(3) : null, n: r.frames };
    Object.defineProperty(line, 'cnt', { value: r.cnt, enumerable: false });
    return { complete: sim.complete, fit: sim.completeFit, treats: sim.complete ? sim.completeTreats : sim.treatsGot, leaps: sim.leaps, knocked: sim.props.knocked, drops: sim.drops, line, ...d, snap: sim.complete ? null : sim.snapshot() };
  }

  const wins = []; // every completing line found (phase 0 search only)
  function search(phase) {
    sim.reset();
    for (let f = 0; f < WARM_FRAMES + phase; f++) sim.step(DT);
    const root = sim.snapshot();
    const res = { firstWin: 0, firstTotal: grid.length, wins: [] };
    const record = (o, lines, store) => { if (o.complete) { res.wins.push({ ...o, lines }); return true; } return false; };
    const memo = new Map();
    // beam expansion from a snapshot with `left` leaps still allowed; true if some continuation completes
    function expand(snap, left, lines, B, shots, drops) {
      let won = false;
      const outs = [];
      for (const s of shots.concat(drops)) {
        sim.restore(snap);
        const o = leg(s);
        if (!o) continue;
        const ln = lines.concat([o.line]);
        if (record(o, ln)) { won = true; continue; }
        if (left > 1) outs.push({ ...o, lines: ln });
      }
      if (left > 1 && outs.length && !won) {
        const seen = new Set(), per = new Map(), pick = [];
        outs.sort((a, b) => a.dist - b.dist);
        for (const o of outs) { if (seen.has(o.key)) continue; seen.add(o.key); const n = per.get(o.surf) || 0; if (n >= 3) continue; per.set(o.surf, n + 1); pick.push(o); }
        for (const o of pick.slice(0, B)) {
          const mk = o.key + '@' + left;
          let r = memo.get(mk);
          if (r === undefined) { const deep = left - 1 > 1; r = expand(o.snap, left - 1, o.lines, deep ? 3 : Math.max(3, B >> 1), (deep ? coarse2 : coarse).map((s) => ({ ...s, d: null })), dropShots(deep ? dropGrid2 : dropGrid)); memo.set(mk, r); }
          if (r) won = true;
        }
      }
      return won;
    }
    function dropShots(list) { const out = []; for (const s of list) for (const d of opts.dropTimes) out.push({ ...s, d }); return out; }

    // depth 1: every first shot (and the coarse grid with drops)
    sim.restore(root);
    const first = [], winRoots = new Set();
    for (const s of grid.map((q) => ({ ...q, d: null })).concat(dropShots(dropGrid))) {
      sim.restore(root);
      const o = leg(s);
      if (!o) continue;
      const id = s.a + '|' + s.p;
      if (record(o, [o.line])) { winRoots.add(id); continue; }
      first.push({ ...o, lines: [o.line], id });
    }
    let nWin1 = winRoots.size;
    if (maxLeaps >= 2) {
      const groups = new Map();
      for (const o of first) { const g = groups.get(o.key) || { o, ids: new Set() }; g.ids.add(o.id); groups.set(o.key, g); }
      const bySurf = new Map(), byDist = [], pick = [];
      for (const g of [...groups.values()].sort((a, b) => a.o.dist - b.o.dist)) { const n = bySurf.get(g.o.surf) || 0; if (n >= 4) continue; bySurf.set(g.o.surf, n + 1); byDist.push(g); }
      const bySize = [...groups.values()].sort((a, b) => b.ids.size - a.ids.size); // the biggest groups (the commonest ways to land) carry the most first shots
      const half = Math.ceil(opts.beam1 / 2);
      for (const g of byDist.slice(0, half).concat(bySize.slice(0, half))) if (!pick.includes(g)) pick.push(g);
      for (const g of pick) {
        const shots = maxLeaps === 2 ? grid.map((s) => ({ ...s, d: null })) : coarse.map((s) => ({ ...s, d: null }));
        const r = expand(g.o.snap, maxLeaps - 1, g.o.lines, opts.beam2, shots, dropShots(dropGrid));
        if (r) for (const id of g.ids) winRoots.add(id);
      }
    }
    res.firstWin = winRoots.size;
    return res;
  }

  const out = { id: level.id, par, completable: false, bestTreatsPar: 0, bestTreatsPar1: 0, share: 0, grid: grid.length, legs: 0, line3: null, bestLine: null, wins: 0 };
  let shareSum = 0;
  phases.forEach((ph, k) => {
    const r = search(ph);
    shareSum += r.firstWin / r.firstTotal;
    if (k === 0) {
      out.wins = r.wins.length;
      for (const w of r.wins) {
        out.completable = true;
        if (w.leaps <= par && w.treats > out.bestTreatsPar) out.bestTreatsPar = w.treats;
        if (w.leaps <= par + 1 && w.treats > out.bestTreatsPar1) out.bestTreatsPar1 = w.treats;
      }
      const best = r.wins.filter((w) => w.treats >= 3 && w.leaps <= par).sort((a, b) => a.leaps - b.leaps || b.fit - a.fit);
      out.allWins = opts.keepWins ? r.wins.map((w) => ({ lines: w.lines, leaps: w.leaps, fit: w.fit, treats: w.treats, drops: w.drops, knocked: w.knocked })) : null;
      out.cands = best.slice(0, 40).map((w) => ({ lines: w.lines, leaps: w.leaps, fit: w.fit, treats: w.treats, drops: w.drops, knocked: w.knocked }));
      const any = r.wins.sort((a, b) => b.treats - a.treats || a.leaps - b.leaps);
      out.bestLine = any[0] ? { lines: any[0].lines, leaps: any[0].leaps, treats: any[0].treats } : null;
    }
  });
  out.share = shareSum / phases.length;
  out.legs = stats.legs;
  return out;
}

// replay a line from the start of the level; returns { complete, treats, leaps, fit }
export function verifyLine(level, line, phase = 0) {
  const sim = createSim(T, level), cat = sim.cat;
  for (let f = 0; f < WARM_FRAMES + phase; f++) sim.step(DT);
  for (const shot of line) { if (!runLeg(sim, shot, null, shot.n)) break; if (sim.complete) break; }
  return { complete: sim.complete, treats: sim.complete ? sim.completeTreats : sim.treatsGot, leaps: sim.leaps, fit: sim.completeFit };
}

// of the candidate 3-star lines, the one that survives the most nudges (angle +-1.5 degrees, power +-0.03 on every leap)
export function mostRobust(level, cands, phase = 0) {
  let best = null;
  for (const c of cands) {
    let ok = 0, tot = 0;
    for (const da of [0, -1.5, 1.5]) for (const dp of [0, -0.03, 0.03]) {
      const ln = c.lines.map((s) => ({ ...s, a: s.a + da, p: Math.min(1, s.p + dp) }));
      const v = verifyLine(level, ln, phase); tot++;
      if (v.complete && v.treats >= 3) ok++;
    }
    const score = ok / tot;
    if (!best || score > best.score || (score === best.score && c.leaps < best.leaps)) best = { ...c, score };
  }
  return best;
}
