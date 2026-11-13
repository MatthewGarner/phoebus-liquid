// A "line" is a list of leaps: [{ a: angle in degrees (0 = right, 90 = up), p: power 0..1, d: seconds after the leap at which to DROP (or null), n: frames the leap runs before the next one }].
// The solver searches lines headlessly with runLeg; the game replays the stored ones with playLine (one sim step per yield), the same operations in the
// same order, so a replay reaches exactly the state the solver saw (the sim is deterministic).
export const DT = 1 / 60;
export const AIM_FRAMES = 16;      // the wind-up: he is planted and aiming this long before the leap
export const WARM_FRAMES = 45;     // the level runs this long before the first aim

export function pullOf(T, shot) {
  const r = (shot.a * Math.PI) / 180, L = shot.p * T.pullMax;
  return [Math.cos(r) * L, Math.sin(r) * L];
}

// Synchronous: wait until he can aim, wind up, leap, drop at shot.d seconds (shot.d === 'T': when his head is over the container's opening), then
// run until `stop(f)` says so (or `n` frames). Returns { frames, dropFrame } or null when he could not leap.
export function runLeg(sim, shot, stop, n = 0, onStep = null) {
  const cat = sim.cat, [dx, dy] = pullOf(sim.T, shot);
  let w = 0;
  while (!cat.canAim && w < 300) { sim.step(DT); w++; }
  if (!cat.canAim || sim.complete) return null;
  cat.plant(); cat.aim(dx, dy);
  for (let f = 0; f < AIM_FRAMES; f++) sim.step(DT);
  if (!sim.leapPull(dx, dy)) return null;
  const dropAt = typeof shot.d === 'number' ? Math.round(shot.d * 60) : -1, lv = sim.level;
  let dropFrame = -1, f = 0;
  const cnt = {};
  for (; ; f++) {
    if (dropFrame < 0) {
      if (shot.d === 'T') { if (cat.mode === 'air' && Math.abs(cat.x[0] - sim.cx) < 0.35 && cat.y[0] > cat.rimY + 0.5 && cat.y[0] < cat.rimY + 6 && cat.M.vyc < -1) { sim.drop(); dropFrame = f; } }
      else if (f === dropAt) { sim.drop(); dropFrame = f; }
    }
    sim.step(DT);
    for (let k = 0; k < cat.events.length; k++) cnt[cat.events[k]] = (cnt[cat.events[k]] || 0) + 1;
    cat.events.length = 0;
    if (onStep) onStep(f);
    if (sim.complete) { f++; break; }
    if (n ? f + 1 >= n : (f >= 420 || stop(f))) { f++; break; }
  }
  return { frames: f, dropFrame, cnt };
}

// The same, one step per yield, for the game: playLine(sim, line) -> generator
export function* playLine(sim, line, warm = WARM_FRAMES, drain = true) {
  const cat = sim.cat;
  for (let f = 0; f < warm; f++) { sim.step(DT); yield; }
  for (const shot of line) {
    const [dx, dy] = pullOf(sim.T, shot);
    let w = 0;
    while (!cat.canAim && w < 300) { sim.step(DT); w++; yield; }
    if (!cat.canAim || sim.complete) return;
    cat.plant(); cat.aim(dx, dy);
    for (let f = 0; f < AIM_FRAMES; f++) { sim.step(DT); yield; }
    if (!sim.leapPull(dx, dy)) return;
    const dropAt = typeof shot.d === 'number' ? Math.round(shot.d * 60) : -1;
    for (let f = 0; f < shot.n; f++) {
      if (f === dropAt) sim.drop();
      sim.step(DT); if (drain) cat.events.length = 0; yield;
      if (sim.complete) break;
    }
  }
}
