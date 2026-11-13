// One level, headless: the cat, the world (container, shelves, cushions), the props, and the rules (leaps, drop, treats, cucumbers, completion).
// The game, the solver, the tests and the benchmark all run this. No three/DOM imports.
import { createCat } from './cat.js';
import { createProps } from './props.js';
import { CONTAINERS } from './containers.js';

// pull vector (pull units: pullMax = full power; the game converts screen pixels into these) -> launch velocity
export function launchVelocity(T, dx, dy, out = {}) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) { out.vx = out.vy = out.power = 0; out.len = l; return out; }
  const p = Math.min(l, T.pullMax) / T.pullMax, v = p * T.leapSpeedMax;
  out.vx = (dx / l) * v; out.vy = (dy / l) * v; out.power = p; out.len = l;
  return out;
}

// The arc his middle (the centroid of him; the launch point) will follow, integrated the way the rig flies (per-step damping and gravity): n points over tmax seconds from (x0, y0).
export function previewArc(T, x0, y0, vx, vy, n, tmax, out) {
  const dt = 1 / 60, damp = T.airDamp, g = T.gravity * dt * dt, steps = Math.max(1, Math.round(tmax * 60));
  let x = x0, y = y0, dx = vx * dt, dy = vy * dt, k = 1;
  for (let s = 1; s <= steps; s++) {
    dx *= damp; dy *= damp;
    const m2 = dx * dx + dy * dy; if (m2 > T.maxStep * T.maxStep) { const q = T.maxStep / Math.sqrt(m2); dx *= q; dy *= q; }
    x += dx; y += dy + g; dy += g;
    if (s >= (k * steps) / n - 1e-9 && k <= n) { const o = out[k - 1]; o.x = x; o.y = y; o.t = s * dt; k++; }
  }
  return out;
}

export function createSim(T, level, opts = {}) {
  const cat = opts.cat || createCat(T);
  cat.top = opts.top ?? T.roomTop;
  const props = createProps(T);
  const sim = {
    T, cat, props, level: null, leaps: 0, complete: false, completeFit: 0, completeLeaps: 0, completeKnocked: 0, completeTreats: 0, completeT: 0, enterT: -1,
    time: 0, glanceT: 0, keS: 0, events: [], treats: [], treatsGot: 0, cucumbers: [], drops: 0, cx: 0, cdir: 1, fitShown: 0, fitMax: 0,
    flight: { rim: false, bonk: 0, dropped: false }, evIdx: 0, lastBonk: -9, toys: [], kickToy: -1, kicks: 0, kickV: [0, 0],
  };

  function load(lv) {
    sim.level = lv;
    cat.setContainer(CONTAINERS[lv.container.id], lv.container.x, lv.container.y, lv.platforms || [], lv.cushions || []);
    cat.moving = !!lv.container.move;
    props.load(lv, cat);
    sim.toys = (lv.toys || []).map((t, k) => ({ x0: t.x, y0: t.y, x: t.x, y: t.y, type: t.type || 'mouse', state: 'live', slot: props.list.length - (lv.toys.length - k) }));
    sim.treats = (lv.treats || []).map((t) => ({ x: t.x, y: t.y, got: false, t: 0 }));
    sim.cucumbers = (lv.cucumbers || []).map((c) => ({ x: c.x, y: c.y, state: 'live', t: 0, dir: 1 }));
    reset();
  }
  function reset() {
    const lv = sim.level;
    sim.cx = lv.container.x; sim.cdir = lv.container.move ? (lv.container.move.dir || 1) : 1;
    cat.moveContainer(sim.cx);
    cat.spawnAt(lv.cat.x, lv.cat.y, lv.cat.facing, { seed: 1000 + lv.id * 17 });
    cat.setRelaxed(false);
    props.reset();
    for (const t of sim.treats) { t.got = false; t.t = 0; }
    for (const c of sim.cucumbers) { c.state = 'live'; c.t = 0; }
    for (const t of sim.toys) { t.state = 'live'; t.x = t.x0; t.y = t.y0; }
    sim.kickToy = -1; sim.kicks = 0;
    sim.treatsGot = 0; sim.drops = 0; sim.fitShown = 0; sim.fitMax = 0; sim.enterT = -1; sim.events.length = 0;
    sim.flight.rim = false; sim.flight.bonk = 0; sim.flight.dropped = false; sim.evIdx = 0; sim.lastBonk = -9;
    sim.leaps = 0; sim.complete = false; sim.completeFit = 0; sim.completeTreats = 0; sim.completeT = 0; sim.time = 0; sim.glanceT = 0; sim.knockSeen = 0; sim.keS = 99; cat.M.calm = false;
    cat.computeFit();
  }

  function step(dt) {
    sim.time += dt;
    const mv = sim.level.container.move;
    if (mv) { // the robo-vac drives left and right; whatever rides in the box rides with it
      let nx = sim.cx + sim.cdir * mv.speed * dt;
      if (nx >= mv.x1) { nx = mv.x1; sim.cdir = -1; } else if (nx <= mv.x0) { nx = mv.x0; sim.cdir = 1; }
      const dx = cat.moveContainer(nx); sim.cx = nx;
      if (dx !== 0 && (cat.mode === 'contained' || cat.mode === 'pour' || cat.frozenOnContainer)) cat.carry(dx);
    }
    cat.step(dt);
    { // how he came in (call-outs): read the rig's events, without consuming them
      const ev = cat.events;
      if (ev.length < sim.evIdx) sim.evIdx = 0;
      for (let k = sim.evIdx; k < ev.length; k++) {
        const e = ev[k];
        if (e === 'rim') sim.flight.rim = true;
        else if (e === 'drop') sim.flight.dropped = true;
        else if (e === 'bonk' && sim.time - sim.lastBonk > 0.25) { sim.flight.bonk++; sim.lastBonk = sim.time; }
      }
      sim.evIdx = ev.length;
    }
    props.step(dt);
    const frac = cat.computeFit();
    sim.keS += (cat.ke - sim.keS) * Math.min(1, dt / 0.25);
    const ins = cat.inside, x = cat.x, y = cat.y, r = cat.r, N = cat.N;
    if (sim.kickToy >= 0 && cat.kicking) { const t = sim.toys[sim.kickToy], K = cat.kickToy; t.x = K.toyX; t.y = K.toyY; }
    if (sim.kickToy >= 0 && !cat.kicking) { // he let go (or launched): the toy is a prop now
      const t = sim.toys[sim.kickToy]; t.state = 'kicked'; const sg = sim.kickV[0] >= 0 ? 1 : -1; props.launchToy(t.slot, t.x + sg * 2.4, t.y + 0.3, sim.kickV[0], sim.kickV[1]); sim.kickToy = -1; // (out of the curl, on the side it is kicked to)
    }
    if (!sim.complete && !cat.kicking && cat.mode === 'air' && (cat.M.leaping || cat.startled)) { // a toy in the way of his front half: he grabs it
      for (let k = 0; k < sim.toys.length; k++) {
        const t = sim.toys[k]; if (t.state !== 'live') continue;
        let hit = false;
        for (let i = 0; i < 6 && !hit; i++) { const dx = x[i] - t.x, dy = y[i] - t.y, R = 0.75 + r[i]; if (dx * dx + dy * dy < R * R) hit = true; }
        if (hit && cat.kickStart(t.x, t.y)) { t.state = 'held'; sim.kickToy = k; sim.kicks++; sim.kickV = [0, -2]; sim.events.push({ type: 'kickies', x: t.x, y: t.y }); break; }
      }
    }
    if (!sim.complete) {
      // treats: any part of him touching one
      const R = T.treatR;
      for (let k = 0; k < sim.treats.length; k++) {
        const t = sim.treats[k]; if (t.got) continue;
        for (let i = 0; i < N; i++) {
          const dx = x[i] - t.x, dy = y[i] - t.y, rr = R + r[i];
          if (dx * dx + dy * dy < rr * rr) { t.got = true; t.t = sim.time; sim.treatsGot++; sim.events.push({ type: 'treat', index: k, n: sim.treatsGot, x: t.x, y: t.y }); break; }
        }
      }
      // cucumbers: his head comes within range and he is STARTLED
      for (let k = 0; k < sim.cucumbers.length; k++) {
        const c = sim.cucumbers[k]; if (c.state !== 'live' || cat.M.aim.on) continue; // (not while he is winding up: his long crouch reaches a long way)
        const hx = x[0], hy = y[0], px = hx - c.x, sx = px < -0.8 ? -0.8 : px > 0.8 ? 0.8 : px, ddx = px - sx, ddy = hy - (c.y + 0.45);
        const R = T.cucumberRange + r[0] + 0.4; // (the gap between his head and the cucumber)
        if (ddx * ddx + ddy * ddy < R * R) {
          c.state = 'rolling'; c.t = 0; c.dir = px >= 0 ? 1 : -1;
          const vx = cat.M.vxc; // he jumps up, and on the way he keeps the side he was going to (else away from the cucumber)
          cat.startle(Math.abs(vx) > 1 ? (vx > 0 ? 1 : -1) : c.dir); sim.events.push({ type: 'startle', index: k, x: c.x, y: c.y });
        }
      }
      // won: head and chest in the container (pouring in, or in), and enough of him in
      const headIn = ins[0] === 1 && ins[3] === 1;
      if (headIn && sim.enterT < 0) sim.enterT = sim.time;
      if (headIn && (cat.mode === 'pour' || cat.mode === 'contained') && frac >= T.completeFit) {
        sim.complete = true; sim.completeFit = frac; sim.completeLeaps = sim.leaps; sim.completeKnocked = props.knocked; sim.completeTreats = sim.treatsGot; sim.completeT = sim.time;
        cat.setRelaxed(true); // no more wriggling: he tucks in and is done
        sim.events.push({ type: 'complete' });
      }
    }
    for (const c of sim.cucumbers) if (c.state === 'rolling') { c.t += dt; if (c.t > 1.2) c.state = 'gone'; }
    // the fit the player sees only ever goes up (and ramps)
    if (frac > sim.fitMax) sim.fitMax = frac;
    sim.fitShown += Math.min(sim.fitMax - sim.fitShown, (T.fitRamp / 100) * dt);
    if (sim.glanceT > 0) sim.glanceT -= dt;
    if (props.knocked > sim.knockSeen) { sim.knockSeen = props.knocked; sim.glanceT = T.glance; }
  }

  function leap(vx, vy) {
    if (!cat.canAim || sim.complete) return false;
    if (cat.kicking) sim.kickV = [-vx * 0.55, -vy * 0.55 + 3]; // the toy flies the other way
    else sim.leaps++;
    sim.flight.rim = false; sim.flight.bonk = 0; sim.flight.dropped = false;
    return cat.leap(vx, vy);
  }
  const leapPull = (dx, dy) => { const v = launchVelocity(T, dx, dy); return leap(v.vx, v.vy); };
  function drop() { if (sim.complete) return false; const ok = cat.drop(); if (ok) sim.drops++; return ok; }

  // fit as the percentage the game shows
  const pct = () => cat.fitPct(cat.fit);
  const shownPct = () => cat.fitPct(sim.fitShown);
  // stars = the treats he had when he finished (0..3); purrfect = all three within par
  function stars() { return sim.complete ? sim.completeTreats : 0; }
  function purrfect() { return sim.complete && sim.completeTreats >= 3 && sim.completeLeaps <= sim.level.par; }

  const K = ['kickToy', 'kicks', 'leaps', 'complete', 'completeFit', 'completeLeaps', 'completeKnocked', 'completeTreats', 'completeT', 'enterT', 'time', 'glanceT', 'knockSeen', 'keS', 'treatsGot', 'drops', 'cx', 'cdir', 'fitShown', 'fitMax'];
  function snapshot() {
    const o = { cat: cat.snapshot(), props: props.snapshot(), tr: sim.treats.map((t) => [t.got, t.t]), cu: sim.cucumbers.map((c) => [c.state, c.t, c.dir]), tys: sim.toys.map((t) => [t.state, t.x, t.y]), kv: sim.kickV || [0, 0], kt: sim.kickToy, kn: sim.kicks };
    for (const k of K) o[k] = sim[k];
    return o;
  }
  function restore(S) {
    for (const k of K) sim[k] = S[k];
    cat.moveContainer(sim.cx); cat.moving = !!sim.level.container.move;
    cat.restore(S.cat); props.restore(S.props);
    S.tr.forEach((t, i) => { sim.treats[i].got = t[0]; sim.treats[i].t = t[1]; });
    S.tys.forEach((st, i) => { sim.toys[i].state = st[0]; sim.toys[i].x = st[1]; sim.toys[i].y = st[2]; }); sim.kickV = S.kv; sim.kickToy = S.kt === undefined ? -1 : S.kt; sim.kicks = S.kn | 0;
    S.cu.forEach((c, i) => { sim.cucumbers[i].state = c[0]; sim.cucumbers[i].t = c[1]; sim.cucumbers[i].dir = c[2]; });
    sim.events.length = 0;
  }
  Object.assign(sim, { load, reset, step, leap, leapPull, drop, pct, shownPct, stars, purrfect, snapshot, restore });
  if (level) load(level);
  return sim;
}
