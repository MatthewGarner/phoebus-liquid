// Target shapes for Phoebus's muscle tone. Every pose is a position for ALL nodes (13 spine, 6 tail, 4 knees, 4 paws)
// in cat-local coordinates: facing +x, y up, x = 0 under the hips, the table at y = 0. The cat mirrors them when he faces left.
// A pose is described by a smooth spine curve (head -> hips), a tail curve and a paw target per leg; this module turns that
// into exact node positions: spine nodes are placed at chord distance L0 * stretch along the curve (so the spine arc length
// is exactly 12 x rest length), legs come from two-bone IK (so every leg has exactly the rig's segment lengths) and the tail
// is resampled at the tail's own spacing. No DOM or three imports.

const hyp = (a, b) => Math.sqrt(a * a + b * b);

// uniform Catmull-Rom through points, dense samples
function curve(pts, per = 24) {
  const out = [], n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(pts[n - 1].slice());
  return out;
}

// Walk along a dense polyline from `start`, placing a point every `steps[k]` of straight-line (chord) distance.
function chordWalk(dense, start, steps) {
  const res = [start.slice()];
  let cur = start, j = 0;
  for (const s of steps) {
    let found = null;
    while (j < dense.length - 1) {
      const a = dense[j], b = dense[j + 1];
      const da = hyp(a[0] - cur[0], a[1] - cur[1]), db = hyp(b[0] - cur[0], b[1] - cur[1]);
      if (da <= s && db >= s) { const t = (s - da) / Math.max(1e-9, db - da); found = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; break; }
      j++;
    }
    if (!found) { // ran off the end of the curve: carry on along its last direction
      const a = dense[dense.length - 2], b = dense[dense.length - 1];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = hyp(dx, dy) || 1; dx /= l; dy /= l;
      found = [cur[0] + dx * s, cur[1] + dy * s];
    }
    res.push(found); cur = found;
  }
  return res;
}

// two-bone IK: knee position for a leg from `a` to a paw at `p`. bend: +1 puts the knee on the left of a->p.
function ik(a, p, seg, bend) {
  let dx = p[0] - a[0], dy = p[1] - a[1], d = hyp(dx, dy);
  if (d > 2 * seg * 0.999) { const k = (2 * seg * 0.999) / d; p = [a[0] + dx * k, a[1] + dy * k]; dx *= k; dy *= k; d = 2 * seg * 0.999; }
  if (d < 0.05) { dx = 0; dy = -0.05; d = 0.05; }
  const ux = dx / d, uy = dy / d, h = Math.sqrt(Math.max(0, seg * seg - (d / 2) * (d / 2)));
  return { knee: [a[0] + ux * d / 2 - uy * h * bend, a[1] + uy * d / 2 + ux * h * bend], paw: p };
}

// two-bone IK with unequal bones (upper l1 from the root, lower l2 to the paw): knee for a leg from (ax, ay) to a paw at (px, py).
// bend: +1 puts the knee on the left of root->paw. Fills out.{kx, ky, px, py} (the paw is pulled in when it is out of reach).
export function ik2(ax, ay, px, py, l1, l2, bend, out) {
  let dx = px - ax, dy = py - ay, d = hyp(dx, dy);
  const lo = Math.abs(l1 - l2) + 0.02, hi = l1 + l2 - 0.01;
  if (d > hi) { const k = hi / d; dx *= k; dy *= k; d = hi; }
  else if (d < lo) { if (d < 1e-6) { dx = 0; dy = -1; d = 1; } const k = lo / d; dx *= k; dy *= k; d = lo; }
  const ux = dx / d, uy = dy / d, a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  out.kx = ax + ux * a - uy * h * bend; out.ky = ay + uy * a + ux * h * bend; out.px = ax + dx; out.py = ay + dy;
  return out;
}

// G: the rig's geometry (K, NT, N, L0, TAIL0, LEG0, LEG_ATTACH, LEG_SEG, TAIL_ATT, TAIL_SP, legOffset, SPINE_R)
export function buildPoses(G, defs = DEFS) {
  const { K, NT, N, L0, TAIL0, LEG0, LEG_ATTACH, LEG_SEG, TAIL_ATT, TAIL_SP, legOffset, SPINE_R } = G;
  const poses = {};
  for (const name in defs) {
    const D = defs[name], P = new Float32Array(2 * N);
    const legScale = (D.legScale || [1, 1, 1, 1]).slice();
    P.bend = D.legs.map((l) => l.bend);
    P.legScale = legScale; // legs may be longer in a pose: sitting up, his front legs reach further down than they do when he stands
    const sp = L0 * (D.stretch || 1);
    // spine: from the hips, every segment has length sp and a heading (degrees, 0 = +x, 90 = up) interpolated smoothly
    // through D.heads (listed hips -> head). So the arc length is exactly 12 x rest length whatever the curve.
    const chain = new Array(K);
    const hx = 0, hy = D.hipsY;
    chain[K - 1] = [hx, hy];
    for (let s = 0; s < K - 1; s++) {
      const u = (s + 0.5) / (K - 1) * (D.heads.length - 1), i0 = Math.min(D.heads.length - 2, Math.floor(u)), f = u - i0;
      const h = D.heads, p0 = h[Math.max(0, i0 - 1)], p1 = h[i0], p2 = h[i0 + 1], p3 = h[Math.min(h.length - 1, i0 + 2)];
      const ang = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
      const a = ang * Math.PI / 180, q = chain[K - 1 - s];
      chain[K - 2 - s] = [q[0] + Math.cos(a) * sp, q[1] + Math.sin(a) * sp];
    }
    let lift = 0; // nothing may start below the table
    for (let i = 0; i < K; i++) lift = Math.max(lift, SPINE_R[i] - chain[i][1]);
    for (let i = 0; i < K; i++) { chain[i][1] += lift; P[2 * i] = chain[i][0]; P[2 * i + 1] = chain[i][1]; }
    // tail: control points are relative to the hips
    const hy2 = chain[K - 1][1];
    const tdense = curve([[0, 0], ...D.tail].map((q) => [hx + q[0], hy2 + q[1]]));
    const tchain = chordWalk(tdense, [hx, hy2], [TAIL_ATT, ...Array(NT - 1).fill(TAIL_SP)]);
    for (let j = 0; j < NT; j++) { P[2 * (TAIL0 + j)] = tchain[j + 1][0]; P[2 * (TAIL0 + j) + 1] = tchain[j + 1][1]; }
    // legs (belly faces -y for a cat facing +x, exactly like the rig's side = -1)
    for (let l = 0; l < 4; l++) {
      const i = LEG_ATTACH[l], a = i - 1, b = i + 1;
      let tx = P[2 * a] - P[2 * b], ty = P[2 * a + 1] - P[2 * b + 1];
      const len = hyp(tx, ty) || 1; tx /= len; ty /= len;
      const o = SPINE_R[i] * legOffset * -1;
      const anchor = [P[2 * i] - ty * o, P[2 * i + 1] + tx * o];
      const L = D.legs[l], target = L.x !== undefined ? [L.x, L.y ?? 0.3] : L.dy !== undefined ? [anchor[0] + L.dx, anchor[1] + L.dy] : [anchor[0] + L.dx, L.y ?? 0.3]; // (x: absolute, from under the hips)
      if (legScale[l] === 'fit') { // as long as it takes to stand on the table, a touch bent
        legScale[l] = Math.max(1, Math.min(2.4, hyp(target[0] - anchor[0], target[1] - anchor[1]) / (2 * LEG_SEG) * 1.04));
      }
      const r = ik(anchor, target, LEG_SEG * legScale[l], L.bend);
      P[2 * (LEG0 + 2 * l)] = r.knee[0]; P[2 * (LEG0 + 2 * l) + 1] = r.knee[1];
      P[2 * (LEG0 + 2 * l + 1)] = r.paw[0]; P[2 * (LEG0 + 2 * l + 1) + 1] = r.paw[1];
    }
    poses[name] = P;
  }
  return poses;
}

// ---------------------------------------------------------------------------------------------------------------
// Designer frame: x forward, y up. Spine control points run head -> hips; legs are [front near, front far, hind near, hind far];
// legScale lengthens the legs in that pose (the rig blends it); each leg is a paw target (dx from where the leg joins the body, and y; default on the table) and a bend (+1 knee forward for a leg pointing down, -1 knee back). Tail points are relative to the hips.
export const DEFS = {
  // SIT: haunches on the table, back rising in a wedge, chest over the front paws, head on top; tail trails behind on the table
  sit: {
    hipsY: 0.76, heads: [20, 40, 62, 72, 65, 55], legScale: ['fit', 'fit', 1, 1],
    legs: [{ dx: -0.25, bend: -1 }, { dx: 0.15, bend: -1 }, { dx: 0.5, bend: 1 }, { dx: 0.9, bend: 1 }],
    tail: [[-0.3, -0.4], [-1.1, -0.5], [-1.8, -0.4], [-2.3, 0.1]],
  },
  // LOAF: a dome of a back, head up at the front, paws tucked under
  loaf: {
    hipsY: 0.8, heads: [80, 50, 15, -15, -45, -5],
    legs: [{ dx: 0.6, bend: 1 }, { dx: 1.0, bend: 1 }, { dx: 0.2, bend: 1 }, { dx: 0.6, bend: 1 }],
    tail: [[0.3, -0.4], [-0.5, -0.5], [-1.2, -0.4], [-1.7, -0.1]],
  },
  // STAND: level back at leg height, four legs down, head forward and up, tail up in a hook
  stand: {
    hipsY: 2.35, heads: [0, 0, 8, 22, 40, 50],
    legs: [{ dx: 0, bend: -1 }, { dx: 0.5, bend: -1 }, { dx: 0, bend: 1 }, { dx: 0.5, bend: 1 }],
    tail: [[-0.4, 0.7], [-0.6, 1.5], [-0.3, 2.15], [0.45, 2.4]],
  },
  // CROUCH: the pounce wind-up, planted. Chest down and forward, bum up and wiggling, head low and ahead of the paws. The paws are exactly where the
  // SIT pose has them (x from under the hips), so a cat that sits down planted can wind up on the same feet: nothing slides.
  crouch: {
    hipsY: 1.8, heads: [-26, -22, -15, -6, 3, 11], legScale: [1.6, 1.6, 1.6, 1.6], // (long legs: the planted paws stay within reach as he leans)
    legs: [{ x: 2.29, bend: -1 }, { x: 2.69, bend: -1 }, { x: 1.17, bend: 1 }, { x: 1.57, bend: 1 }],
    tail: [[-0.5, -0.1], [-1.2, -0.5], [-1.9, -0.9]],
  },
  // LEAP: stretched out long in the air: spine nearly straight and 30% longer, front paws reaching forward, hind legs trailing, tail streaming
  leap: {
    stretch: 1.3, hipsY: 1.4, heads: [-4, -1, 2, 5, 8, 10],
    legs: [{ dx: 1.35, dy: 0.15, bend: 1 }, { dx: 1.2, dy: -0.15, bend: 1 }, { dx: -1.3, dy: -0.15, bend: 1 }, { dx: -1.2, dy: -0.4, bend: 1 }],
    tail: [[-0.8, 0.1], [-1.5, 0.1], [-2.1, 0.0]],
  },
  // DROP: the mid-air dive. A vertical long cat, head down, 25% longer (and so thinner), front paws together ahead of the nose, hind legs and tail streaming up
  drop: {
    stretch: 1.25, hipsY: 0, heads: [-90, -90, -90, -90, -90, -90],
    legs: [{ dx: 0.55, dy: -1.3, bend: -1 }, { dx: 0.75, dy: -1.3, bend: -1 }, { dx: 0.55, dy: 1.3, bend: 1 }, { dx: 0.75, dy: 1.3, bend: 1 }],
    tail: [[0.1, 0.7], [0.15, 1.5], [0.2, 2.2]],
  },
  // LICK: sitting, one front mitten raised to the mouth
  lick: {
    hipsY: 0.76, heads: [20, 40, 62, 72, 65, 55], legScale: ['fit', 'fit', 1, 1],
    legs: [{ x: 2.7, y: 4.5, bend: -1 }, { dx: 0.15, bend: -1 }, { dx: 0.5, bend: 1 }, { dx: 0.9, bend: 1 }],
    tail: [[-0.3, -0.4], [-1.1, -0.5], [-1.8, -0.4], [-2.3, 0.1]],
  },
  // HANG: what he looks like limp, held up by the head (the spine straight, legs and tail trailing behind): the pose he is pulled to
  // very gently while held, so it does not fight the stretch. Not an idle pose.
  hang: {
    hipsY: 1.0, heads: [0, 0, 0, 0, 0, 0],
    legs: [{ dx: -1.4, dy: -0.15, bend: 1 }, { dx: -1.3, dy: -0.25, bend: 1 }, { dx: -1.4, dy: -0.15, bend: -1 }, { dx: -1.3, dy: -0.25, bend: -1 }],
    tail: [[-0.6, 0], [-1.2, 0], [-1.8, 0], [-2.3, 0]],
  },
  // STRETCH: stand with a 15% longer spine, bum up, chest down, front paws reaching
  stretch: {
    stretch: 1.15, hipsY: 3.0, heads: [-10, -20, -25, -20, -10],
    legs: [{ dx: 1.6, bend: -1 }, { dx: 2.0, bend: -1 }, { dx: 0.0, bend: 1 }, { dx: 0.4, bend: 1 }],
    tail: [[0.0, 0.6], [0.0, 1.4], [0.3, 2.0]],
  },
};
