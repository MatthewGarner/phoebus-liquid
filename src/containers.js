// Data-driven containers. No three/DOM imports (runs in node for simtest).
// profile: half cross-section of the wall CENTRELINE as [r, y] points from rim to base centre.

// Catmull-Rom through control points, `per` samples per segment (for smooth lathe profiles).
function catmull(pts, per = 4) {
  const out = [], n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(pts[n - 1]);
  return out;
}

function teacupProfile() {
  const R = 2.5, H = 2.9, flare = 0.3, yS = 1.5, rb = R - flare;
  const pts = [[R, H], [R - flare * 0.5, H * 0.72], [rb, yS]];
  const n = 9;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI / 2;
    pts.push([rb * Math.cos(a), yS * (1 - Math.sin(a))]);
  }
  return pts;
}

export const TEACUP = {
  id: 'teacup',
  name: 'Teacup',
  group: 'bowls',
  hint: 'Coil him. Tail last.',
  profile: teacupProfile(),
  wallThickness: 0.4,
  colors: { body: '#FFFFFF', shade: '#E8F0EF', stripe: '#E06A47', saucer: '#FFFFFF', saucerShade: '#E8F0EF', line: '#B9C9C8' },
  bands: [{ y: 0.55, height: 0.34, color: 'stripe', extra: 0 }],   // y: fraction of height up the wall
  handle: { side: 1, y: 0.55, radius: 0.72, tube: 0.15 },
  saucer: { rx: 4.1, ry: 0.5 },
};

// Quarter-ellipse sides, wide and shallow.
function saladProfile() {
  const H = 2.3, Rr = 3.2, rb = 1.0, n = 14, pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push([rb + (Rr - rb) * Math.cos(a), H * (1 - Math.sin(a))]); }
  pts.push([0, 0]);
  return pts;
}
export const SALAD = {
  id: 'salad',
  name: 'Salad bowl',
  group: 'bowls',
  hint: "Easy. He's basically already a salad.",
  profile: saladProfile(),
  wallThickness: 0.34,
  colors: { body: '#6FA86A', shade: '#9FC79A', line: '#4F8A4B' },
};

// Straight tapered sides, narrow base, thick rim band (visual).
export const POT = {
  id: 'pot',
  name: 'Flower pot',
  group: 'ridiculous',
  hint: 'Bum first.',
  profile: catmull([[2.35, 3.8], [1.95, 2.5], [1.55, 1.0], [1.4, 0.5], [1.22, 0.17], [0.95, 0.03], [0.55, 0]], 3).concat([[0, 0]]),
  wallThickness: 0.4,
  colors: { body: '#C9764A', shade: '#A85C36', line: '#8A4526' },
  bands: [{ y: 0.9, height: 0.8, color: 'body', extra: 0.2 }],
  frontOpacity: 0.2,
};

// Belly and a narrow neck.
function vaseProfile() {
  const H = 4.8, bel = 2.0, lip = 1.5, neck = 1.38;
  const c = [[lip, H], [neck + 0.02, H - 0.4], [neck, H * 0.78], [neck + 0.15, H * 0.66], [(bel + neck) / 2 + 0.1, H * 0.5],
    [bel, H * 0.34], [bel * 0.9, H * 0.17], [bel * 0.6, 0.05], [0.4, 0]];
  return catmull(c, 4).concat([[0, 0]]);
}
export const VASE = {
  id: 'vase',
  name: 'Vase',
  group: 'ridiculous',
  hint: 'Stretch him long and feed him in.',
  profile: vaseProfile(),
  wallThickness: 0.4,
  colors: { body: '#5B87A6', shade: '#86AAC4', line: '#44698A' },
  bands: [{ y: 0.93, height: 0.3, color: 'shade', extra: 0.05 }],
  frontOpacity: 0.2,
};

// Round glass ball cut off by a narrow opening, sitting on a flat foot.
function fishProfile() {
  const R = 2.15, open = 2.6, t = 0.3, Rc = R + t / 2, flat = 0.9;
  const psi0 = Math.asin((open / 2 + t / 2) / Rc), psi1 = Math.PI - Math.asin(flat / Rc), n = 18, pts = [];
  for (let i = 0; i <= n; i++) { const p = psi0 + ((psi1 - psi0) * i) / n; pts.push([Rc * Math.sin(p), Rc * Math.cos(p) + Rc]); }
  pts.push([0, pts[pts.length - 1][1]]);
  return pts;
}
export const FISHBOWL = {
  id: 'fishbowl',
  name: 'Fishbowl',
  group: 'ridiculous',
  hint: 'Head first, then everything else. Somehow.',
  profile: fishProfile(),
  wallThickness: 0.3,
  colors: { body: '#8EC3D8', shade: '#5F9DB8', line: '#2F6F8C' }, // (a deeper tint and a dark rim line: clear glass against the pale wall was almost invisible)
  glass: true,
  frontOpacity: 0.26,
};

// A square delivery box riding a flat round robot vacuum (the vacuum patrols the floor; see levels.js `move`). Straight walls, 4.6 wide and 3.0 deep
// inside. `square` makes the renderer draw it flat (with its flaps open) instead of as a lathe; `extra` are more wall capsules (the vacuum, under
// the box: [ax, ay, bx, by, r] relative to the box's own origin, so the box is placed ON the vacuum: container y = 0.7 puts the vacuum on the floor).
export const BOX = {
  id: 'box',
  name: 'Delivery box',
  group: 'boxes',
  hint: 'It drives. Lead it.',
  profile: [[2.5, 3.4], [2.5, 0.2], [0, 0.2]],
  size: 1,
  square: true,
  wallThickness: 0.4,
  colors: { body: '#CFA66B', shade: '#B98C4E', line: '#8F6A33', tape: '#E9D5A8', vac: '#4B5563', vacShade: '#374151', vacRing: '#9CA3AF', vacLight: '#34D399' },
  extra: [[-2.9, -0.35, 2.9, -0.35, 0.35]],
  vacH: 0.7,
};

// Every container is drawn this much smaller than its profile numbers: the cat must be a squeeze, not a guest.
export const CONTAINER_SIZE = 0.88;
export const ORDER = ['salad', 'teacup', 'pot', 'vase', 'fishbowl', 'box'];
export const CONTAINERS = { teacup: TEACUP, salad: SALAD, pot: POT, vase: VASE, fishbowl: FISHBOWL, box: BOX };

// Builds derived data: capsules, interior polygon, lathe outline, rim info. Cached on the def.
export function build(def) {
  if (def._built) return def._built;
  const t = def.wallThickness;
  // lift so the lowest centreline sits t/2 above the table
  const SIZE = def.size ?? CONTAINER_SIZE;
  const minY = Math.min(...def.profile.map((p) => p[1])) * SIZE;
  const lift = t / 2 - minY;
  const prof = def.profile.map(([r, y]) => [r * SIZE, y * SIZE + lift]);

  // per-vertex inward offset (miter-ish) for the interior outline and the outer outline
  const n = prof.length;
  const inner = [], outer = [];
  for (let i = 0; i < n; i++) {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    // inward normal for a rim->base path is (dy, -dx)
    const nx = dy, ny = -dx;
    inner.push([prof[i][0] + nx * t / 2, prof[i][1] + ny * t / 2]);
    outer.push([prof[i][0] - nx * t / 2, prof[i][1] - ny * t / 2]);
  }
  inner[0][1] = prof[0][1];
  inner[n - 1][0] = 0;
  outer[n - 1][0] = 0;

  const capsules = [];
  for (let i = 0; i < n - 1; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
    capsules.push([r0, y0, r1, y1, t / 2]);
    capsules.push([-r0, y0, -r1, y1, t / 2]);
  }

  // Invisible fence that closes the wedge between the floor and a flared body, so nothing can be jammed under it.
  // It sits where the underside is FENCE_GAP above the floor: nodes wider than that are stopped by the wall itself.
  const FENCE_GAP = 1.0;
  for (let i = n - 1; i > 0; i--) {
    const a = outer[i], b = outer[i - 1];
    if (a[1] < FENCE_GAP && b[1] >= FENCE_GAP) {
      const u = (FENCE_GAP - a[1]) / (b[1] - a[1]), rx = Math.max(0, a[0] + (b[0] - a[0]) * u) - 0.1;
      if (rx > 0.3) { capsules.push([rx, 0, rx, FENCE_GAP, 0.2]); capsules.push([-rx, 0, -rx, FENCE_GAP, 0.2]); }
      break;
    }
  }

  const interior = [];
  for (let i = 0; i < n; i++) interior.push(inner[i][0], inner[i][1]);
  for (let i = n - 2; i >= 0; i--) interior.push(-inner[i][0], inner[i][1]);

  // lathe outline: inner rim->base, then outer base->rim, closed with a flat rim cap
  const outline = [];
  for (let i = 0; i < n; i++) outline.push([inner[i][0], inner[i][1]]);
  for (let i = n - 1; i >= 0; i--) outline.push([outer[i][0], outer[i][1]]);
  outline.push([inner[0][0], inner[0][1]]);

  const rimY = prof[0][1];
  const rimHalf = inner[0][0];
  def._built = { capsules, interior, outline, rimY, rimHalf, outerRimR: outer[0][0], height: rimY + t / 2, prof, inner, outer, lift };
  return def._built;
}

export function polygonArea(poly) {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += poly[2 * j] * poly[2 * i + 1] - poly[2 * i] * poly[2 * j + 1];
  }
  return Math.abs(a) / 2;
}

export function capacity(def) {
  return polygonArea(build(def).interior);
}

export function pointInPolygon(poly, px, py) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
