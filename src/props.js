// Knockables: single-circle rigid bodies that roll, bounce and fall. They collide with the floor, the side walls, shelves, the
// container's walls and every node of the cat (the cat pushes them; they do not push him). No three/DOM imports.
//
// A prop that starts up on a shelf and later reaches the floor is KNOCKED: it wobbles and fades for ~1 s, and is gone.

export const PROP_TYPES = {
  mug:    { r: 0.58, drag: 0.05,  bounce: 0.22 },
  orange: { r: 0.5,  drag: 0.004, bounce: 0.5 },
  yarn:   { r: 0.64, drag: 0.007, bounce: 0.35 },
  plant:  { r: 0.7,  drag: 0.06,  bounce: 0.12 },
  mouse:  { r: 0.55, drag: 0.03,  bounce: 0.4 },   // the catnip mouse once it has been kicked
};
export const MAX_PROPS = 6;
const SPEED_MAX = 30;
const bnc = (vn, e) => (vn > 1.5 ? e : 0); // restitution only for real impacts

export function createProps(T) {
  const list = [];
  const props = { list, total: 0, knocked: 0, events: [], awake: 0 };
  let cat = null;

  const ev = (e) => { if (props.events.length < 64) props.events.push(e); };

  function load(level, c) {
    cat = c;
    list.length = 0;
    for (const d of (level.props || []).slice(0, MAX_PROPS)) {
      const t = PROP_TYPES[d.type];
      if (!t) continue;
      list.push({ type: d.type, r: t.r, drag: t.drag, bounce: t.bounce, x0: d.x, y0: d.y + t.r, x: d.x, y: d.y + t.r, vx: 0, vy: 0, ang: 0, w: 0,
        elev: d.y > 0.2, state: 'live', sleep: 0, asleep: false, knockT: 0, alpha: 1, wob: 0, hitT: 0, nx: 0, ny: 0 });
    }
    for (const d of level.toys || []) { // one hidden slot per toy: it becomes a real prop when it is kicked
      const t = PROP_TYPES[d.type === 'yarn' ? 'yarn' : 'mouse'];
      list.push({ type: d.type === 'yarn' ? 'yarn' : 'mouse', toy: true, r: t.r, drag: t.drag, bounce: t.bounce, x0: d.x, y0: d.y, x: d.x, y: d.y, vx: 0, vy: 0, ang: 0, w: 0,
        elev: false, state: 'gone', sleep: 0, asleep: false, knockT: 0, alpha: 1, wob: 0, hitT: 0, nx: 0, ny: 0 });
    }
    reset();
  }
  function reset() {
    props.knocked = 0; props.events.length = 0; props.total = 0;
    for (const p of list) {
      p.x = p.x0; p.y = p.y0; p.vx = p.vy = p.ang = p.w = 0; p.state = p.toy ? 'gone' : 'live'; p.sleep = 0; p.asleep = false; p.knockT = 0; p.alpha = 1; p.wob = 0; p.hitT = 0;
      if (p.elev) props.total++;
    }
  }

  // a toy kicked free: a real prop from here on
  function launchToy(slot, x, y, vx, vy) { const p = list[slot]; if (!p) return; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.w = vx * 0.5; p.state = 'live'; p.asleep = false; p.sleep = 0; p.alpha = 1; p.kicked = 2.5; }
  function step(dt) {
    if (dt > 1 / 60) dt = 1 / 60;
    if (!cat) return;
    const W = cat.world, cap = W.cap, grpBox = W.grpBox, grpStart = W.grpStart, nGrp = W.nGrp;
    const nodes = cat.N, cx = cat.x, cy = cat.y, cpx = cat.px, cpy = cat.py, cr = cat.r;
    const g = T.propGravity * dt, inv = 1 / dt;
    let awake = 0;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (p.state === 'gone') continue;
      p.hitT = Math.max(0, p.hitT - dt);
      if (p.kicked > 0) { // a kicked toy is a rigid thing in the room: it bowls other props over
        p.kicked -= dt;
        for (let m = 0; m < list.length; m++) {
          const q = list[m]; if (q === p || q.state !== 'live') continue;
          const dx = q.x - p.x, dy = q.y - p.y, R = q.r + p.r, d2 = dx * dx + dy * dy;
          if (d2 < R * R && d2 > 1e-6) { const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny; if (rel > 0) { q.vx += nx * rel * 1.1; q.vy += ny * rel * 1.1 + 2; q.asleep = false; q.sleep = 0; p.vx -= nx * rel * 0.25; } }
        }
      }
      if (p.state === 'knocked') {
        p.knockT += dt; p.wob = Math.sin(p.knockT * 38) * Math.max(0, 1 - p.knockT / T.propFade) * 0.45;
        p.alpha = p.knockT < 0.4 ? 1 : Math.max(0, 1 - (p.knockT - 0.4) / Math.max(0.1, T.propFade - 0.4));
        if (p.knockT >= T.propFade) { p.state = 'gone'; continue; }
      }
      const r = p.r;
      if (p.asleep) { // wakes when the cat gets near
        let wake = false;
        for (let i = 0; i < nodes; i++) {
          const dx = p.x - cx[i], dy = p.y - cy[i], R = r + cr[i] + 0.7;
          if (dx * dx + dy * dy < R * R) { wake = true; break; }
        }
        if (!wake) continue;
        p.asleep = false; p.sleep = 0;
      }
      awake++;
      const x0 = p.x, y0 = p.y; // where it started the step (for the swept shelf test)
      p.vy += g;
      let sp2 = p.vx * p.vx + p.vy * p.vy;
      if (sp2 > SPEED_MAX * SPEED_MAX) { const s = SPEED_MAX / Math.sqrt(sp2); p.vx *= s; p.vy *= s; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      let touched = false, nx = 0, ny = 0, hard = 0;
      // the cat's nodes push him first, so the walls and shelves have the last word (nothing is ever pushed through one)
      for (let i = 0; i < nodes; i++) {
        const dx0 = p.x - cx[i], dy0 = p.y - cy[i], R = r + cr[i];
        if (dx0 * dx0 + dy0 * dy0 >= R * R) continue;
        let d = Math.sqrt(dx0 * dx0 + dy0 * dy0), dx = dx0, dy = dy0;
        if (d < 1e-4) { dx = 0; dy = 1; d = 0; } else { dx /= d; dy /= d; }
        const push = R - d > 0.45 ? 0.45 : R - d;
        p.x += dx * push; p.y += dy * push;
        const nvx = (cx[i] - cpx[i]) * inv, nvy = (cy[i] - cpy[i]) * inv;
        const rel = (p.vx - nvx) * dx + (p.vy - nvy) * dy;
        if (rel < 0) {
          const e = 0.45;
          p.vx -= (1 + e) * rel * dx; p.vy -= (1 + e) * rel * dy;
          if (-rel > hard) hard = -rel;
          p.w += (dx * (p.vy - nvy) - dy * (p.vx - nvx)) * 0.2; // a swat also spins it
        }
        p.asleep = false; p.sleep = 0;
      }
      for (let pass = 0; pass < 2; pass++) {
        // shelves and the container
        for (let gi = 0; gi < nGrp; gi++) {
          const b = gi * 4;
          if (p.x < grpBox[b] - r || p.x > grpBox[b + 1] + r || p.y < grpBox[b + 2] - r || p.y > grpBox[b + 3] + r) continue;
          for (let c = grpStart[gi], ce = grpStart[gi + 1]; c < ce; c++) {
            const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3], R = r + cap[o + 5];
            { // swept: never end the step on the far side of a shelf or wall from where it started
              const s1 = ex * (y0 - ay) - ey * (x0 - ax), s2 = ex * (p.y - ay) - ey * (p.x - ax);
              if (s1 * s2 < 0) {
                const t = s1 / (s1 - s2), mx = x0 + (p.x - x0) * t, my = y0 + (p.y - y0) * t, uu = ((mx - ax) * ex + (my - ay) * ey) * cap[o + 4];
                if (uu >= 0 && uu <= 1) { const l = Math.sqrt(ex * ex + ey * ey) || 1, sg = s1 > 0 ? 1 : -1; p.x = mx - sg * (ey / l) * R; p.y = my + sg * (ex / l) * R; }
              }
            }
            let u = ((p.x - ax) * ex + (p.y - ay) * ey) * cap[o + 4];
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            let dx = p.x - ax - u * ex, dy = p.y - ay - u * ey;
            const d2 = dx * dx + dy * dy;
            if (d2 >= R * R) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-5) { const l = Math.sqrt(ex * ex + ey * ey) || 1; dx = -ey / l; dy = ex / l; d = 0; } else { dx /= d; dy /= d; }
            p.x += dx * (R - d); p.y += dy * (R - d);
            const vn = -(p.vx * dx + p.vy * dy);
            if (vn > 0) { const k2 = 1 + bnc(vn, p.bounce); p.vx += dx * vn * k2; p.vy += dy * vn * k2; if (vn > hard) hard = vn; }
            if (dy > 0.3 && pass === 0) { touched = true; nx += dx; ny += dy; }
          }
        }
        // floor and side walls
        if (p.y < r) {
          const vn = -p.vy; p.y = r; if (vn > 0) { p.vy = vn * bnc(vn, p.bounce); if (vn > hard) hard = vn; }
          if (pass === 0) { touched = true; ny += 1; }
        }
        const WL = T.roomHalfW;
        if (p.x < -WL + r) { const vn = -p.vx; p.x = -WL + r; if (vn > 0) { p.vx = vn * bnc(vn, T.leapBounce); if (vn > hard) hard = vn; } }
        else if (p.x > WL - r) { const vn = p.vx; p.x = WL - r; if (vn > 0) { p.vx = -vn * bnc(vn, T.leapBounce); if (vn > hard) hard = vn; } }
      }
      // rolling: spin follows the surface it rolls on; rolling friction slows it
      if (touched) {
        const l = Math.sqrt(nx * nx + ny * ny) || 1, tx = -ny / l, ty = nx / l, vt = p.vx * tx + p.vy * ty;
        p.w += (vt / r - p.w) * Math.min(1, 14 * dt);
        p.vx -= tx * vt * p.drag; p.vy -= ty * vt * p.drag;
      } else p.w *= 0.998;
      p.ang += p.w * dt;
      if (hard > 4 && p.hitT <= 0) { ev({ type: 'clink', v: hard, prop: p }); p.hitT = 0.12; }
      // knocked: an elevated prop reaches the floor
      if (p.elev && p.state === 'live' && p.y <= r + 0.05) {
        p.state = 'knocked'; p.knockT = 0; props.knocked++; ev({ type: 'knock', prop: p, v: hard });
      }
      // sleep
      if (touched && p.vx * p.vx + p.vy * p.vy < T.propSleepSpeed * T.propSleepSpeed && Math.abs(p.w) < 0.6 && p.state === 'live') {
        p.sleep += dt; if (p.sleep > 0.3) { p.asleep = true; p.vx = p.vy = p.w = 0; }
      } else p.sleep = 0;
    }
    props.awake = awake;
  }

  const F = ['x', 'y', 'vx', 'vy', 'ang', 'w', 'state', 'sleep', 'asleep', 'knockT', 'alpha', 'wob', 'hitT'];
  function snapshot() { return { k: props.knocked, l: list.map((p) => { const o = {}; for (const f of F) o[f] = p[f]; return o; }) }; }
  function restore(S) { props.knocked = S.k; S.l.forEach((o, i) => { for (const f of F) list[i][f] = o[f]; }); props.events.length = 0; }
  Object.assign(props, { load, reset, step, snapshot, restore, launchToy });
  return props;
}
