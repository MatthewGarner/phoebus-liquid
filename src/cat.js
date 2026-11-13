// Phoebus as an articulated, stretchy cat rig. Position-based dynamics on 27 nodes:
//   spine 0..12 (0 = head, 12 = hips), tail 13..18, legs 19..26 (knee, paw) x 4.
// No three/DOM imports (runs in node for simtest and bench).
import { build, pointInPolygon } from './containers.js';
import { buildPoses, ik2 } from './poses.js';

export const SHELF_R = 0.25;            // shelves are capsules this thick (radius), top surface at the shelf's y
export const K = 13, NT = 6, NL = 4;
export const TAIL0 = K;                 // first tail node (13)
export const LEG0 = K + NT;             // first leg node (19)
export const N = LEG0 + NL * 2;         // 27
export const L0 = 0.40;                 // spine rest spacing
export const HEAD = 0, HIPS = K - 1, TAIL_TIP = TAIL0 + NT - 1;
export const LEG_ATTACH = [4, 4, 11, 11];          // front near, front far, hind near, hind far
export const knee = (l) => LEG0 + l * 2;
export const paw = (l) => LEG0 + l * 2 + 1;
export const P_HEAD = 0, P_SPINE = 1, P_TAIL = 2, P_KNEE = 3, P_PAW = 4;

const SPINE_R = [0.80, 0.50, 0.72, 0.80, 0.82, 0.84, 0.84, 0.84, 0.84, 0.82, 0.80, 0.78, 0.74];
const TAIL_R = [0.24, 0.22, 0.20, 0.19, 0.17, 0.16];
const TAIL_SP = 0.34, TAIL_ATT = 0.55, KNEE_R = 0.26, PAW_R = 0.30;
export const LEG_SEG = 0.75;           // each of the two leg segments
export const GEOM = { K, NT, N, L0, TAIL0, LEG0, LEG_ATTACH, LEG_SEG, TAIL_ATT, TAIL_SP, SPINE_R, PAW_R, TAIL_R, KNEE_R };
const HANDLES = new Set([HEAD, HIPS, paw(0), paw(1), paw(2), paw(3), TAIL_TIP, 6]);
const margin0 = 0.8; // broad-phase reach beyond a node's radius; no node may travel further than this in a step
const hyp = (a, b) => Math.sqrt(a * a + b * b); // Math.hypot is slow in an interpreter
const MAXC = 40; // capsules remembered per node per step

// Groups for "Spilling: ..." naming.
const GROUPS = [
  { name: 'head', nodes: [0, 1] },
  { name: 'his middle', nodes: [2, 3, 4, 5, 6, 7, 8, 9] },
  { name: 'bum', nodes: [10, 11, 12] },
  { name: 'tail', nodes: [13, 14, 15, 16, 17, 18] },
  { name: 'paw', nodes: [19, 20] }, { name: 'paw', nodes: [21, 22] }, { name: 'paw', nodes: [23, 24] }, { name: 'paw', nodes: [25, 26] },
];
const PAW_WORDS = ['', 'one paw', 'two paws', 'three paws', 'all four paws'];

export function createCat(T) {
  const x = new Float32Array(N), y = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N);
  const r = new Float32Array(N), r0 = new Float32Array(N), invMass = new Float32Array(N);
  const part = new Uint8Array(N), baseInv = new Float32Array(N);
  const inside = new Uint8Array(N), heldMask = new Uint8Array(N);
  for (let i = 0; i < K; i++) { r0[i] = SPINE_R[i]; part[i] = i === 0 ? P_HEAD : P_SPINE; invMass[i] = i === 0 ? 0.85 : 1; }
  for (let j = 0; j < NT; j++) { const i = TAIL0 + j; r0[i] = TAIL_R[j]; part[i] = P_TAIL; invMass[i] = 2.5; }
  for (let l = 0; l < NL; l++) {
    r0[knee(l)] = KNEE_R; part[knee(l)] = P_KNEE; invMass[knee(l)] = 2.5;
    r0[paw(l)] = PAW_R; part[paw(l)] = P_PAW; invMass[paw(l)] = 2.5;
  }
  r.set(r0); baseInv.set(invMass);
  let totalArea = 0;
  const area = new Float32Array(N);
  for (let i = 0; i < N; i++) { area[i] = Math.PI * r0[i] * r0[i]; totalArea += area[i]; }

  // ---- constraint list: one tight loop per iteration ----
  const ca = [], cb = [], crest = [], ck = [], clo = [], chi = [];
  const addC = (a, b, rest, k, lo = 0, hi = 1e9) => { ca.push(a); cb.push(b); crest.push(rest); ck.push(k); clo.push(lo); chi.push(hi); };
  // order matters: the spine segments (hard limits) go last so nothing else can leave them over-stretched
  for (let i = 0; i < K - 2; i++) addC(i, i + 2, 2 * L0, 0);
  for (let i = 0; i < K - 3; i++) addC(i, i + 3, 3 * L0, 0);
  addC(HIPS, TAIL0, TAIL_ATT, 1);
  for (let j = 0; j < NT - 1; j++) addC(TAIL0 + j, TAIL0 + j + 1, TAIL_SP, 1);
  for (let j = 0; j < NT - 2; j++) addC(TAIL0 + j, TAIL0 + j + 2, 2 * TAIL_SP, 0);
  for (let l = 0; l < NL; l++) addC(knee(l), paw(l), LEG_SEG, 1); // the shoulder-to-knee link is solved against a belly-side anchor below
  for (let i = 0; i < K - 1; i++) addC(i, i + 1, L0, 0, 0, 0);
  const nC = ca.length, spineC0 = nC - (K - 1);
  const Ca = Int16Array.from(ca), Cb = Int16Array.from(cb), Crest = Float32Array.from(crest), Ck = Float32Array.from(ck);
  const Clo = Float32Array.from(clo), Chi = Float32Array.from(chi);
  function refreshConstraints() {
    let c = 0;
    for (let i = 0; i < K - 2; i++, c++) Ck[c] = T.bendK;
    for (let i = 0; i < K - 3; i++, c++) { Ck[c] = T.archK; Crest[c] = 3 * L0 * T.archRest; }
    for (let k = 0; k < NT; k++, c++) Ck[c] = T.legK;
    for (let j = 0; j < NT - 2; j++, c++) Ck[c] = T.tailBendK;
    for (let l = 0; l < NL; l++, c++) { Ck[c] = T.legK; Crest[c] = legLen[l]; }
    for (let i = 0; i < K - 1; i++, c++) { Ck[c] = T.spineStretchK; Clo[c] = T.spineMin * L0; Chi[c] = T.spineMax * L0; }
  }

  // ---- self-collision pairs (spine nodes >= 3 apart) ----
  const sa = [], sb = [];
  for (let i = 0; i < K; i++) for (let j = i + 3; j < K; j++) { sa.push(i); sb.push(j); }
  const nS = sa.length;
  const Sa = Int16Array.from(sa), Sb = Int16Array.from(sb);

  // ---- world: the container (anywhere: offset ox, oy) and platforms, as capsules in groups ----
  // group 0 is the container, then one group per platform. Every group has a box, so a node only tests the groups it is near.
  let def = null, B = null, rimY = 3.5, rimHalf = 2.4, outerRimR = 2.7, interior = null, ox = 0, oy = 0;
  let nCap = 0, cap = new Float32Array(0);
  let fenceR = 0, fenceTop = 0;
  let worldObj = null, nGrp = 0, grpBox = new Float32Array(0), grpStart = new Int16Array(1), platforms = [], cushions = [];
  let grpKind = new Uint8Array(0), grpRef = new Int16Array(0), capGrp = new Int16Array(0); // kind: 0 container, 1 shelf, 2 cushion
  const near = new Int16Array(N * MAXC), nearN = new Uint8Array(N);
  function setContainer(d, X = 0, Y = 0, plats = [], cush = []) {
    def = d; ox = X; oy = Y; platforms = plats; cushions = cush;
    const caps = [], groups = [], kinds = [], refs = []; // caps: [ax, ay, bx, by, r]
    if (d) {
      B = build(d);
      rimY = B.rimY + oy; rimHalf = B.rimHalf; outerRimR = B.outerRimR; interior = B.interior;
      groups.push(caps.length); kinds.push(0); refs.push(-1);
      for (const c of B.capsules) caps.push([c[0] + ox, c[1] + oy, c[2] + ox, c[3] + oy, c[4]]);
      for (const c of d.extra || []) caps.push([c[0] + ox, c[1] + oy, c[2] + ox, c[3] + oy, c[4]]); // (the robo-vac under a box)
    } else { B = null; interior = null; }
    plats.forEach((p, k) => { // a shelf: a horizontal capsule, SHELF_R * 2 thick, top surface at p.y
      groups.push(caps.length); kinds.push(1); refs.push(k);
      caps.push([p.x - p.w / 2 + SHELF_R, p.y - SHELF_R, p.x + p.w / 2 - SHELF_R, p.y - SHELF_R, SHELF_R]);
    });
    cush.forEach((c, k) => { // a cushion: a stadium, T.cushionH thick, top surface at c.y + cushionH
      const h = T.cushionH;
      groups.push(caps.length); kinds.push(2); refs.push(k);
      caps.push([c.x - c.w / 2 + h / 2, c.y + h / 2, c.x + c.w / 2 - h / 2, c.y + h / 2, h / 2]);
    });
    fenceR = 0; fenceTop = 0;
    if (d) for (const c of B.capsules) if (c[0] === c[2] && c[4] === 0.2 && c[1] === 0 && c[3] > 0 && c[0] > 0) { fenceR = c[0]; fenceTop = c[3]; }
    nCap = caps.length; nGrp = groups.length;
    worldObj = { cap: null, nCap, nGrp, grpBox: null, grpStart: null, grpKind: null };
    cap = new Float32Array(nCap * 6); grpBox = new Float32Array(nGrp * 4); grpStart = new Int16Array(nGrp + 1);
    grpKind = Uint8Array.from(kinds); grpRef = Int16Array.from(refs); capGrp = new Int16Array(nCap);
    for (let g = 0; g < nGrp; g++) grpStart[g] = groups[g];
    grpStart[nGrp] = nCap;
    for (let g = 0; g < nGrp; g++) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let c = grpStart[g]; c < grpStart[g + 1]; c++) {
        const [ax, ay, bx, by, cr] = caps[c];
        const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
        capGrp[c] = g;
        cap[c * 6] = ax; cap[c * 6 + 1] = ay; cap[c * 6 + 2] = ex; cap[c * 6 + 3] = ey; cap[c * 6 + 4] = l2 > 0 ? 1 / l2 : 0; cap[c * 6 + 5] = cr;
        x0 = Math.min(x0, ax - cr, bx - cr); x1 = Math.max(x1, ax + cr, bx + cr); y0 = Math.min(y0, ay - cr, by - cr); y1 = Math.max(y1, ay + cr, by + cr);
      }
      grpBox[g * 4] = x0; grpBox[g * 4 + 1] = x1; grpBox[g * 4 + 2] = y0; grpBox[g * 4 + 3] = y1;
    }
    worldObj.cap = cap; worldObj.grpBox = grpBox; worldObj.grpStart = grpStart; worldObj.grpKind = grpKind;
  }
  // the container rides on something (a robo-vac): slide it (and its extras) to a new x; anything riding in it is carried with `carry`
  function moveContainer(nx) {
    if (!def) return 0;
    const dx = nx - ox; if (dx === 0) return 0;
    for (let c = grpStart[0]; c < grpStart[1]; c++) cap[c * 6] += dx;
    grpBox[0] += dx; grpBox[1] += dx; ox = nx;
    return dx;
  }
  function carry(dx) { for (let i = 0; i < N; i++) { x[i] += dx; px[i] += dx; if (FZ.on) FZ.x0[i] += dx; } AN.hx += dx; AN.ax += dx; for (let l = 0; l < NL; l++) AN.pinX[l] += dx; }

  function clearContainer() { setContainer(null, 0, 0, []); }

  // ---- state ----
  const cat = {
    N, K, x, y, px, py, r, r0, invMass, part, inside,
    top: 15, moving: false,
    head: { x: 0, y: 0, angle: 0, vx: 0, vy: 0 },
    stretch: 1, squash: 1, annoyance: 0, ke: 0, impact: 0,
    spill: { left: { n: 0, x: 0, y: 0 }, right: { n: 0, x: 0, y: 0 } },
    spillNames: [], fit: 0, time: 0, relaxed: false, restArea: 0,
    grabs: [], side: 1, legAX: new Float32Array(NL), legAY: new Float32Array(NL),
  };
  let sideT = 1;
  let lastDt = 1 / 60, wT = -1, wNext = 4, wPhase = 0, shake = 0, tailPhase = 2.1;

  // ---- muscle tone: poses, shape matching, modes, idle life ----
  const POSES = buildPoses({ ...GEOM, legOffset: T.legOffset });
  const gx = new Float32Array(N), gy = new Float32Array(N);       // this step's world goals
  const poseCur = new Float32Array(2 * N), poseFrom = new Float32Array(2 * N);
  const nodeW = new Float32Array(N), pullW = new Float32Array(N); // weight in the best-fit / share of the pull
  for (let i = 0; i < N; i++) { nodeW[i] = i < K ? 1 : 0.45; pullW[i] = i < K ? 1 : i >= LEG0 ? 1 : 0.7; }
  const supp = new Uint8Array(N), suppLast = new Uint8Array(N), suppF = new Int16Array(N), suppFLast = new Int16Array(N); // suppF: the flat surface (shelf, cushion: group + 1; floor: 30000) a node stands on
  const legLen = new Float32Array(NL).fill(LEG_SEG), legFrom = new Float32Array(NL).fill(LEG_SEG);
  const M = {
    pose: 'sit', rest: 'sit', forced: null, from: 'sit', blendS: 1, blendDur: T.poseBlend, wasCrouch: false,
    facing: 1, phi: 0, steer: false, scale: 1, resid: 0, groundT: 0, airT: 1, comVy: 0, comVy1: 0, comVy2: 0, count: 0,
    fitT: -1, crouchT: 0, crouch: 0, stretchT: 0, yawnT: 0, lookT: 0, flickT: 0, blinks: 0, idleT: 5, intro: 0, introT: 0,
    lastTouch: { x: 0, y: 0, t: -99, ok: false }, att: { x: 0, y: 0, t: 0 }, tone: 0, inn: 0,
    // pounce
    aim: { on: false, dx: 0, dy: 0 }, aimS: 0, aimT: 0, leaping: false, leapT: 0, leapEnter: 0, pourT: 0, pourCool: 0, tuck: 0, tuckDone: 0,
    lickT: 0, lickQueue: 0, quietT: 0, leapAge: 9, lean: 0, splat: 0, splatT: 0, dropped: false, dropT: 0, startled: false, bounceCool: 0, bounceN: 0, rescueT: 0,
    calm: false, pours: 0, stillT: 0, phiGoal: 0, aimTarget: 0, flipCx: 0, flip: 0, flipU: 0, flipNew: 1, pending: null, stuckT: 0, vxc: 0, vyc: 0, dive: false, squirm: false, bumT: 0,
  };
  const sx0 = new Float32Array(N), sy0 = new Float32Array(N); // where every node started the step (the wall bounce rewrites px, so the swept tests use these)
  const wasIn = new Uint8Array(N), flipX = new Float32Array(N), tgx = new Float32Array(N), tgy = new Float32Array(N);
  poseCur.set(POSES.sit); poseFrom.set(POSES.sit);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const smooth01 = (a, b, v) => { const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a); return t * t * (3 - 2 * t); };
  cat.mode = 'air'; cat.mood = ''; cat.gaze = { x: 0, y: 0, on: false }; cat.poses = POSES;
  cat.impacts = []; cat.repairs = 0;
  cat.facing = 1; cat.tone = 0; cat.poseName = 'sit'; cat.resid = 0; cat.landed = 0; cat.events = []; cat.evData = {}; cat.aimS = 0;
  const seg = new Float32Array(K - 1);
  // seeded: the same level plays the same way in node (the solver) and in the browser (the replays)
  let rs = 20250;
  const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ev = (name) => { if (cat.events.length < 64) cat.events.push(name); };

  // Push every node out of every wall, shelf and the floor (positions only, no velocity): used when he is placed by hand.
  function depenetrate(passes = 6) {
    let side = 1;
    { let c = 0; for (let i = 0; i < K; i++) c += x[i]; side = c / K < ox ? -1 : 1; }
    for (let p = 0; p < passes; p++) {
      let any = false;
      for (let i = 0; i < N; i++) {
        let xi = x[i], yi = y[i];
        const ri = r[i];
        // a part placed under the container's flare (the wedge behind its invisible fence) goes out to the side he is on
        if (fenceR > 0 && yi > oy - 0.3 && yi < oy + fenceTop + ri && Math.abs(xi - ox) < fenceR + 0.2 + ri) { xi = ox + side * (fenceR + 0.2 + ri + 0.01); any = true; }
        for (let c = 0; c < nCap; c++) {
          const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3], R = ri + cap[o + 5] + T.wallSlop;
          let u = ((xi - ax) * ex + (yi - ay) * ey) * cap[o + 4];
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          let dx = xi - ax - u * ex, dy = yi - ay - u * ey;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R * R) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-5) { const l = Math.sqrt(ex * ex + ey * ey) || 1; dx = -ey / l; dy = ex / l; d = 0; } else { dx /= d; dy /= d; }
          xi += dx * (R - d); yi += dy * (R - d); any = true;
        }
        if (yi < ri) { yi = ri; any = true; }
        if (xi < -T.roomHalfW + ri) xi = -T.roomHalfW + ri; else if (xi > T.roomHalfW - ri) xi = T.roomHalfW - ri;
        px[i] += xi - x[i]; py[i] += yi - y[i]; x[i] = xi; y[i] = yi;
      }
      if (!any) break;
    }
  }

  // Placed by hand on top of a container (a forced pose, a turn): push the whole cat sideways, away from the container, until no node
  // is deep in a wall (a tail under a teacup cannot be pushed out node by node).
  function clearPlacement(maxShift = 5) {
    if (!nCap) return;
    let com = 0; for (let i = 0; i < K; i++) com += x[i]; com /= K;
    const dir = com < ox ? -1 : 1;
    for (let s = 0; s < maxShift / 0.1; s++) {
      let deepest = 0;
      for (let i = 0; i < N && !deepest; i++) {
        for (let c = 0; c < nCap; c++) {
          const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3];
          let u = ((x[i] - ax) * ex + (y[i] - ay) * ey) * cap[o + 4];
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = x[i] - ax - u * ex, dy = y[i] - ay - u * ey;
          if (dx * dx + dy * dy < (cap[o + 5] * 0.6) * (cap[o + 5] * 0.6)) { deepest = 1; break; }
        }
      }
      if (!deepest) return;
      for (let i = 0; i < N; i++) { x[i] += dir * 0.1; px[i] += dir * 0.1; }
      depenetrate(2);
    }
  }

  // ---------------------------------------------------------------- spawn
  function spawn(cx = 0, cy = rimY + 3, opts = {}) {
    if (opts.seed !== undefined) rs = opts.seed;
    const dir = opts.dir ?? (rnd() < 0.5 ? -1 : 1), tilt = opts.tilt ?? (rnd() - 0.5) * 0.25;
    const side = dir; // head on the +dir side
    if (opts.pose) { // he starts in a pose: cy is the height of the lowest part of him above the table, cx the hips
      const P = POSES[opts.pose];
      let lo = 1e9; for (let i = 0; i < N; i++) lo = Math.min(lo, P[2 * i + 1] - r0[i]);
      for (let i = 0; i < N; i++) { x[i] = cx + dir * P[2 * i]; y[i] = cy + P[2 * i + 1] - lo; }
      M.rest = M.pose = M.from = opts.pose; M.blendS = 1; poseCur.set(P); poseFrom.set(P); for (let l = 0; l < NL; l++) legLen[l] = LEG_SEG * P.legScale[l];
    } else {
      for (let i = 0; i < K; i++) {
        const s = (6 - i) * L0;
        x[i] = cx + side * s * Math.cos(tilt); y[i] = cy + s * Math.sin(tilt) * side;
      }
      for (let j = 0; j < NT; j++) {
        const i = TAIL0 + j, s = TAIL_ATT + j * TAIL_SP;
        x[i] = x[HIPS] - side * (0.1 + j * 0.12); y[i] = y[HIPS] - s * 0.95; // the tail hangs from his bum
      }
      for (let l = 0; l < NL; l++) {
        const a = LEG_ATTACH[l], k = knee(l), p = paw(l), o = (l & 1) ? 0.12 : -0.12;
        x[k] = x[a] + o; y[k] = y[a] - LEG_SEG; x[p] = x[a] + o * 2; y[p] = y[a] - 2 * LEG_SEG;
      }
      M.rest = M.pose = M.from = 'sit'; M.blendS = 1; poseCur.set(POSES.sit); poseFrom.set(POSES.sit); for (let l = 0; l < NL; l++) legLen[l] = LEG_SEG * POSES.sit.legScale[l];
    }
    for (let i = 0; i < N; i++) { r[i] = r0[i]; px[i] = x[i] + (opts.vx || 0) * (1 / 60); py[i] = y[i]; }
    if (opts.clear !== false) { depenetrate(); clearPlacement(); }
    cat.side = sideT = dir > 0 ? -1 : 1; // belly down: head to the right means the belly is on the -1 flank
    M.facing = cat.facing = dir; M.phi = 0; M.steer = false; M.tone = cat.tone = T.toneAir * 0.8; M.forced = null; M.groundT = 0; M.airT = 1;
    M.comVy = M.comVy1 = M.comVy2 = 0; M.crouchT = M.crouch = M.stretchT = M.yawnT = M.lookT = M.flickT = 0; M.count = 0; M.wasCrouch = false;
    M.idleT = 4 + rnd() * 3; M.intro = opts.intro ? 1 : 0; M.introT = 0; M.lastTouch.ok = false; supp.fill(0); suppLast.fill(0);
    M.aim.on = false; M.aimS = M.aimT = 0; M.leaping = false; M.leapT = M.pourT = M.pourCool = M.tuck = M.tuckDone = 0; M.phiGoal = 0; M.flip = 0; M.pending = null;
    M.stuckT = 0; M.pours = 0; M.stillT = 0; M.dive = false; M.squirm = false; M.vxc = M.vyc = 0; cat.events.length = 0; cat.aimS = 0;
    M.lean = M.splat = M.splatT = M.dropT = M.bounceCool = M.bounceN = 0; M.dropped = M.startled = false; AN.on = false; AN.tip = 0; AN.tipT = 0; AN.planted = false; AN.flipping = false; FZ.on = false; FZ.calm = 0; KK.on = false;
    cat.mode = 'air'; cat.mood = ''; cat.gaze.on = false; cat.poseName = M.pose; cat.landed = 0; cat.blinks = 0;
    cat.grabs.length = 0;
    cat.annoyance = 0; shake = 0; wT = -1; wNext = 3 + rnd() * 3; cat.relaxed = false; cat.impact = 0; cat.time = 0;
    lastDt = 1 / 60;
    updateStats(1 / 60);
    cat.computeFit();
    let a = 0;
    for (let i = 0; i < K - 1; i++) a += L0 * (r0[i] + r0[i + 1]);
    cat.restArea = a + Math.PI * r0[0] * r0[0];
  }

  // ---------------------------------------------------------------- grabbing
  function beginGrab(wx, wy) {
    let best = -1, bs = 1e9;
    for (let i = 0; i < N; i++) {
      const d = hyp(x[i] - wx, y[i] - wy);
      if (d > T.grabRadius) continue;
      const s = d - (HANDLES.has(i) ? T.handleBonus : 0);
      if (s < bs) { bs = s; best = i; }
    }
    if (best < 0) return null;
    for (const g of cat.grabs) if (g.node === best) return null;
    if (cat.grabs.length >= 2) return null;
    let ox = x[best] - wx, oy = y[best] - wy;
    const ol = hyp(ox, oy); if (ol > T.grabRadius) { ox *= T.grabRadius / ol; oy *= T.grabRadius / ol; }
    const g = { node: best, k: 1, fx: wx, fy: wy, tx: wx, ty: wy, ox, oy, pvx: 0, pvy: 0 };
    cat.grabs.push(g);
    wT = -1;
    return g;
  }
  function moveGrab(g, wx, wy) { if (g) { g.tx = wx; g.ty = wy; } }
  function endGrab(g) { if (!g) return; const i = cat.grabs.indexOf(g); if (i >= 0) cat.grabs.splice(i, 1); }

  function startWriggle(scale = 1) { wT = 0; wPhase = rnd() * 6.28; wScale = scale; }
  let wScale = 1;
  M.stuck = false;
  function poke(wx, wy) {
    const R = T.pokeRadius;
    for (let i = 0; i < N; i++) {
      let dx = x[i] - wx, dy = y[i] - wy;
      const d = hyp(dx, dy);
      if (d > R + r[i]) continue;
      const f = 1 - Math.min(1, d / (R + r[i]));
      const l = d || 1; dx /= l; dy /= l;
      const v = T.pokeImpulse * f / 60;
      px[i] -= dx * v; py[i] -= (dy * 0.8 + 0.5) * v;
    }
    if (!cat.relaxed) startWriggle(1);
  }
  function setRelaxed(on) { cat.relaxed = !!on; if (on) { wT = -1; } }

  // Leg roots sit on the belly side of the spine node, so legs hang beside the body, not inside it.
  function updateAnchors() {
    for (let l = 0; l < NL; l++) {
      const i = LEG_ATTACH[l], a = i - 1, b = i + 1;
      let tx = x[a] - x[b], ty = y[a] - y[b];
      const len = hyp(tx, ty) || 1; tx /= len; ty /= len;
      const o = r[i] * T.legOffset * cat.side;
      cat.legAX[l] = x[i] - ty * o; cat.legAY[l] = y[i] + tx * o;
    }
  }

  // ---------------------------------------------------------------- step
  function updateRadii(dt) {
    const rate = 1 - Math.exp(-T.areaRate * dt);
    for (let i = 0; i < K - 1; i++) seg[i] = hyp(x[i + 1] - x[i], y[i + 1] - y[i]);
    const br = 1 + T.breath * Math.sin(cat.time * 6.2832 * T.breathHz);
    for (let i = 1; i < K; i++) {
      const m = i === K - 1 ? seg[i - 1] : 0.5 * (seg[i - 1] + seg[i]);
      let k = Math.sqrt(L0 / Math.max(m, 0.05));
      k = k < T.areaMin ? T.areaMin : k > T.areaMax ? T.areaMax : k;
      if (i >= 3 && i <= 10) k *= br;
      r[i] += (r0[i] * k - r[i]) * rate;
    }
    r[0] = r0[0];
    // tail and legs keep their radii
  }

  function behaviour(dt) {
    const dd = dt * dt, held = cat.grabs.length > 0;
    // wriggle scheduling
    const contained = cat.mode === 'contained';
    if (!held && !cat.relaxed && (contained || M.stuck)) {
      if (!M.calm) wNext -= dt; // (no new wriggle while he is settling for the win)
      if (wNext <= 0) { startWriggle(M.stuck ? 1.3 : 1); const E = M.stuck ? T.stuckWriggle : T.wriggleEvery; wNext = E[0] + rnd() * (E[1] - E[0]); }
    }
    if (wT >= 0) {
      wT += dt;
      if (wT > T.wriggleTime || held || cat.relaxed || !(contained || M.stuck || M.squirm)) { wT = -1; M.squirm = false; }
      else {
        const env = Math.sin((wT / T.wriggleTime) * Math.PI);
        for (let i = 0; i < K; i++) {
          const a = i > 0 ? i - 1 : 0, b = i < K - 1 ? i + 1 : K - 1;
          let tx = x[a] - x[b], ty = y[a] - y[b];
          const l = hyp(tx, ty) || 1; tx /= l; ty /= l;
          const f = T.wriggle * wScale * env * Math.sin(6.2832 * T.wriggleHz * wT - i * 0.6 + wPhase) * dd;
          x[i] += -ty * f; y[i] += tx * f;
        }
      }
    }
    // wind-up: his bum wiggles, harder the further he is pulled back
    if (M.aim.on && M.aimS > 0.02 && !held) {
      const A = T.aimWiggle * M.aimS * dd * Math.min(1, M.aimT / 0.15), ph = 6.2832 * T.aimWiggleHz * cat.time;
      for (let k = 0; k < 4; k++) {
        const i = HIPS - k, w = 1 - k * 0.28;
        x[i] += A * w * Math.sin(ph - k * 0.5); y[i] += 0.3 * A * w * Math.sin(ph * 2 - k);
      }
      x[TAIL0] += A * 0.6 * Math.sin(ph - 2); x[TAIL0 + 1] += A * 0.7 * Math.sin(ph - 2.6);
    }
    // diving at an opening: a little help steering his head and shoulders onto it (a cat aims)
    if (M.leaping && cat.mode === 'air' && interior && T.diveAssist > 0 && y[HEAD] > rimY && y[HEAD] < rimY + 3.5 && M.vyc < 0) {
      const d = ox - x[HEAD];
      if (d > -rimHalf - T.diveReach && d < rimHalf + T.diveReach) {
        const a = (d < -1.2 ? -1.2 : d > 1.2 ? 1.2 : d) * T.diveAssist * dd;
        x[0] += a; x[1] += a * 0.8; x[2] += a * 0.5; x[3] += a * 0.25;
      }
    }
    // pouring in: the parts still above the rim are funnelled toward the opening, like a rope drawn through a hole
    if (M.pourT > 0 && interior) {
      const F = T.pourFunnel * dd, S = T.pourSuck * dd;
      for (let i = 0; i < N; i++) {
        if (inside[i] || y[i] < rimY - 0.3) continue;
        const d = ox - x[i];
        if (d > rimHalf + T.pourReach || d < -rimHalf - T.pourReach) continue; // only the parts that are nearly there are funnelled in
        x[i] += (d < -1.2 ? -1.2 : d > 1.2 ? 1.2 : d) * F; y[i] -= S;
      }
    }
    // tail swish
    const ann = cat.relaxed ? 0 : cat.annoyance;
    {
      const amp = T.tailSwish * (1 + 3 * ann) * (cat.relaxed ? 0.3 : 1) * (1 - 0.8 * Math.min(1, M.tone * 1.2));
      for (let j = 2; j < NT; j++) {
        const i = TAIL0 + j, a = i - 1;
        let tx = x[i] - x[a], ty = y[i] - y[a];
        const l = hyp(tx, ty) || 1; tx /= l; ty /= l;
        const f = amp * (j / NT) * Math.sin(6.2832 * T.tailSwishHz * (1 + ann) * cat.time + tailPhase + j * 0.7) * dd;
        x[i] += -ty * f; y[i] += tx * f;
      }
    }
    if (M.flickT > 0) { // idle: the tip of the tail twitches
      const env = Math.sin((1 - M.flickT / T.flickTime) * Math.PI);
      for (let j = 3; j < NT; j++) {
        const i = TAIL0 + j, a = i - 1;
        let tx = x[i] - x[a], ty = y[i] - y[a];
        const l = hyp(tx, ty) || 1; tx /= l; ty /= l;
        const f = T.tailFlick * env * ((j - 2) / (NT - 2)) * Math.sin(6.2832 * 3.2 * (T.flickTime - M.flickT)) * dd;
        x[i] += -ty * f; y[i] += tx * f;
      }
    }
    if (cat.relaxed) { // tail curls in toward his side
      for (let j = 1; j < NT; j++) {
        const i = TAIL0 + j, tgt = 10 - (j > 2 ? 1 : 0), w = T.curlPull * j / NT;
        x[i] += (x[tgt] - x[i]) * w; y[i] += (y[tgt] - y[i]) * w;
      }
    }
  }

  // ---------------------------------------------------------------- muscle tone
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const inRange = (r) => r[0] + rnd() * (r[1] - r[0]);

  function chooseFacing() {
    let dx = x[HEAD] - x[HIPS];
    if (Math.abs(dx) < 0.5) dx = x[HEAD] - x[1];
    if (dx > 0.2) M.facing = 1; else if (dx < -0.2) M.facing = -1;
  }
  function blendTo(name, dur) {
    if (name === M.pose) return;
    poseFrom.set(poseCur); legFrom.set(legLen); M.from = M.pose; M.pose = name; M.blendS = 0; M.blendDur = Math.max(0.02, dur);
    cat.poseName = name;
  }
  function look(x0, y0, time) { cat.gaze.x = x0; cat.gaze.y = y0; cat.gaze.on = true; M.lookT = time; }

  function updateMode(dt, held) {
    // support from last step's contacts
    let sup = 0;
    for (let i = 0; i < K; i++) sup += supp[i];
    for (let l = 0; l < NL; l++) sup += supp[paw(l)];
    if (sup > 0) { M.airT = 0; M.groundT += dt; } else { M.airT += dt; M.groundT = 0; }
    if (interior && cat.time - M.fitT > 0.1) computeFit(); // (the game calls computeFit every frame; this is for everything else)
    const fit = interior ? cat.fit : 0, was = cat.mode;
    M.inn = smooth01(T.innessFrom, T.innessTo, fit); // how much he is in a container, for the blend between ground and contained
    const aiming = M.aim.on && !held;
    M.leapT = Math.max(0, M.leapT - dt); M.pourCool = Math.max(0, M.pourCool - dt);
    if (M.pourT > 0) { M.pourT -= dt; if (M.pourT <= 0) { M.pourT = 0; M.pourCool = T.pourCool; } }
    // pouring in: his head or chest goes down through the opening
    if (!held && !aiming && interior && M.pourT <= 0 && M.pourCool <= 0 && M.leapT <= 0 && !cat.relaxed && was !== 'contained' && M.pours < T.pourMax) {
      for (let k = 0; k < 2; k++) {
        const i = k === 0 ? HEAD : 4;
        if (Math.abs(x[i] - ox) < rimHalf && y[i] > rimY - 1.4 && y[i] < rimY + 0.9 && (y[i] - py[i]) / dt < -T.pourSpeed) { M.pourT = T.pourTime; M.pours++; ev('pour'); M.leaping = false; break; }
      }
    }
    // half in and still: he wriggles
    M.stuck = !held && !aiming && was === 'ground' && !!interior && fit > 0.2 && fit < T.tuckFit && cat.ke < 0.4 && M.groundT > T.stuckAfter;
    let mode;
    if (held) mode = 'held';
    else if (M.leapT > 0) mode = 'air';
    else if (M.pourT > 0) mode = 'pour';
    else if (cat.relaxed || fit >= (was === 'contained' ? T.containedFit - 0.1 : T.containedFit)) mode = 'contained';
    else {
      mode = (M.airT > (was === 'ground' ? T.airDelayGround : T.airDelay) || (was === 'air' && M.groundT < 0.03)) ? 'air' : 'ground';
      // resting on something that does not count as a floor (the tip of a shelf, a tail end): he is not flying
      if (mode === 'air' && M.vxc * M.vxc + M.vyc * M.vyc < 4 && M.leapT <= 0) { M.stillT += dt; if (M.stillT > 0.3) mode = 'ground'; } else M.stillT = 0;
    }
    if (mode !== was) {
      if ((was === 'held' || was === 'contained') && !M.leaping && !aiming) { chooseFacing(); M.stretchT = M.yawnT = M.lookT = 0; }
      if (was === 'air' && mode === 'ground') {
        const v = Math.min(M.comVy, M.comVy1, M.comVy2); // the fall speed just before the touchdown
        cat.landed = -v;
        if (-v > T.crouchSpeed) M.crouchT = T.crouchTime;
        if (M.dropped) { M.splat = 1; M.splatT = T.splatHold; ev('splat'); M.lickQueue = 1.2; }
        M.dropped = false; M.startled = false;
        ev('land');
      }
      if (mode !== 'air' && mode !== 'held') M.leaping = false;
      if (mode === 'contained' && was !== 'contained') { M.tuck = 0; ev('settle'); }
      cat.mode = mode;
    }
    // tone
    let tgt, tau;
    if (mode === 'held') { tgt = T.toneHeld; tau = T.toneRampHeld / 3; }
    else if (mode === 'pour') { tgt = T.pourTone; tau = 0.08; }
    else if (mode === 'contained') { tgt = aiming ? Math.max(T.toneContained, 0.4) : T.toneContained; tau = 0.15; }
    else if (mode === 'air') { tgt = M.leaping ? T.leapTone : T.toneAir; tau = 0.05; }
    else { tgt = T.toneGround + (T.toneContained - T.toneGround) * M.inn; tau = T.toneRampGround / 3; }
    M.tone += (tgt - M.tone) * (1 - Math.exp(-dt / tau));
    cat.tone = M.tone; cat.facing = M.facing;
    // which flank the belly is on follows the way he faces while he holds himself
    if (mode !== 'held' && M.tone > 0.2) sideT = -M.facing;
  }

  function choosePose(dt) {
    const mode = cat.mode;
    M.crouchT = Math.max(0, M.crouchT - dt);
    if (M.splatT > 0) M.splatT -= dt; else if (M.splat > 0) M.splat += (0 - M.splat) * (1 - Math.exp(-dt / (T.splatRecover / 3)));
    let want = M.forced || (mode === 'contained' || mode === 'pour' || M.inn > 0.5 ? 'loaf' : mode === 'held' ? 'hang' : M.rest);
    if (!M.forced && mode === 'ground' && M.stretchT > 0) want = 'stretch';
    const aiming = M.aim.on && mode !== 'held';
    let dur = mode === 'ground' && !M.forced && M.inn < 0.5 ? T.poseBlendIdle : T.poseBlend; // idle changes are slow and calm
    if (M.lickT > 0 && mode === 'ground' && !aiming && !M.forced) { want = 'lick'; dur = 0.25; }
    if (aiming && !M.forced) { want = 'crouch'; dur = T.aimBlend; }
    else if (M.dropped && M.leaping && mode === 'air' && !M.forced) { want = 'drop'; dur = 0.06; }
    else if (M.leaping && mode === 'air' && !M.forced) { want = M.dive || M.vyc > -3 ? 'leap' : 'stand'; dur = want === 'leap' ? 0.1 : 0.3; }
    else if (mode === 'pour' && !M.forced) dur = 0.25;
    // a hard landing squashes the pose a little (a crouch-and-recover); the 'crouch' pose itself is for wind-ups
    const cTgt = M.crouchT > 0 && mode === 'ground' ? 1 : 0;
    M.crouch += (cTgt - M.crouch) * (1 - Math.exp(-dt / ((cTgt ? T.crouchIn : T.crouchOut) / 3)));
    if (want !== M.pose) blendTo(want, dur);
    if (M.blendS < 1) {
      M.blendS = Math.min(1, M.blendS + dt / M.blendDur);
      const e = M.blendS * M.blendS * (3 - 2 * M.blendS), P = POSES[M.pose];
      for (let i = 0; i < 2 * N; i++) poseCur[i] = poseFrom[i] + (P[i] - poseFrom[i]) * e;
      for (let l = 0; l < NL; l++) legLen[l] = legFrom[l] + (LEG_SEG * P.legScale[l] - legFrom[l]) * e;
    }
  }

  // may he change into this pose where he stands? (it must not reach out over the end of a shelf further than the pose he is in)
  function fitsPose(name) {
    if (!AN.on) return true;
    const f = M.facing, cur = overhang(M.rest, f, AN.hx, AN.lo, AN.hi);
    return overhang(name, f, AN.hx, AN.lo, AN.hi) <= Math.max(0.5, cur + 0.05) && !overlapsContainer(name, f, AN.hx, AN.ay);
  }
  // Idle life while he sits on the table: every few seconds he does something small. All calm.
  function idle(dt) {
    const mode = cat.mode;
    M.stretchT = Math.max(0, M.stretchT - dt); M.yawnT = Math.max(0, M.yawnT - dt);
    M.flickT = Math.max(0, M.flickT - dt);
    if (M.lookT > 0) { M.lookT -= dt; if (M.lookT <= 0) cat.gaze.on = false; }
    else if (cat.gaze.on && M.att.t <= 0 && M.intro !== 2) cat.gaze.on = false;
    if (M.lickT > 0) { cat.mood = 'lick'; look(x[HEAD] + M.facing * 3, y[HEAD] - 2, 0.3); return; }
    if (M.aim.on && mode !== 'held') { // winding up: ears forward, pupils wide, eyes on where he is going
      cat.mood = 'curious'; look(x[HEAD] + M.aim.dx * 3, y[HEAD] + M.aim.dy * 3, 0.3); M.intro = 0; M.att.t = 0;
      return;
    }
    if (mode === 'pour' || (mode === 'contained' && M.tuck > 0)) { cat.mood = 'content'; return; }
    const calm = mode === 'ground' && M.tone > 0.6 && !M.forced && !cat.relaxed;
    if (!calm) { if (mode !== 'air') { cat.gaze.on = false; M.lookT = 0; } cat.mood = ''; return; }
    if (M.intro) { // first seconds of an attempt: look at the container, then at the player
      if (M.groundT < 0.2) { cat.mood = ''; return; }
      M.introT += dt;
      if (M.intro === 1) { look(0, Math.max(rimY * 0.7, 1), 99); M.intro = 2; M.introT = 0; }
      if (M.intro === 2 && M.introT > T.introLook) { cat.gaze.on = false; M.lookT = 0; M.blinks++; M.intro = 3; M.introT = 0; }
      if (M.intro === 3 && M.introT > T.introPlayer) { M.intro = 0; M.idleT = 1.5 + rnd() * 2; }
      cat.mood = M.intro === 2 ? 'curious' : '';
      return;
    }
    if (M.att.t > 0) { // a finger is down on the table: he watches it
      M.att.t -= dt; cat.gaze.x = M.att.x; cat.gaze.y = M.att.y; cat.gaze.on = true; M.lookT = 0; cat.mood = 'curious';
      M.idleT = Math.max(M.idleT, 1.5);
      return;
    }
    M.idleT -= dt;
    if (M.idleT <= 0 && M.stretchT <= 0 && M.yawnT <= 0 && M.lookT <= 0) {
      M.idleT = inRange(T.idleEvery);
      const e = pick(['pose', 'pose', 'look', 'look', 'blink', 'tail', 'tail', 'stretch', 'yawn']);
      if (e === 'pose') { const ps = ['sit', 'loaf', 'stand'].filter((n) => n !== M.rest && fitsPose(n)); if (ps.length) M.rest = pick(ps); }
      else if (e === 'look') {
        const lt = M.lastTouch;
        if (lt.ok) {
          look(lt.x, lt.y, T.lookTime);
        } else look(0, Math.max(rimY * 0.7, 1), T.lookTime);
      }
      else if (e === 'blink') M.blinks++;
      else if (e === 'tail') M.flickT = T.flickTime;
      else if (e === 'stretch') { if (fitsPose('stretch') && fitsPose('stand')) { M.rest = 'stand'; M.stretchT = T.stretchTime; } }
      else if (e === 'yawn') M.yawnT = T.yawnTime;
    }
    cat.mood = M.yawnT > 0 ? 'yawn' : M.lookT > 0 ? 'curious' : M.rest === 'loaf' && M.groundT > 1 ? 'content' : '';
  }

  // best-fit rigid transform of the pose onto the nodes (2D closed form), steered upright; fills the world goals gx, gy
  function matchShape(dt, similarity) {
    const P = poseCur, f = M.facing;
    const qx = 1 + T.crouchWiden * M.crouch + 0.3 * M.splat, qy = 1 - Math.max(T.crouchDepth * M.crouch, T.splatDepth * M.splat);
    let cpx = 0, cpy = 0, cxx = 0, cxy = 0, W = 0;
    for (let i = 0; i < N; i++) { const w = nodeW[i]; cpx += w * f * P[2 * i] * qx; cpy += w * P[2 * i + 1] * qy; cxx += w * x[i]; cxy += w * y[i]; W += w; }
    cpx /= W; cpy /= W; cxx /= W; cxy /= W;
    let sn = 0, cs = 0, pp = 0, qq = 0;
    for (let i = 0; i < N; i++) {
      const w = nodeW[i], ax = f * P[2 * i] * qx - cpx, ay = P[2 * i + 1] * qy - cpy, bx = x[i] - cxx, by = y[i] - cxy;
      sn += w * (ax * by - ay * bx); cs += w * (ax * bx + ay * by); pp += w * (ax * ax + ay * ay); qq += w * (bx * bx + by * by);
    }
    const theta = Math.atan2(sn, cs), best = Math.sqrt(sn * sn + cs * cs);
    M.resid = Math.sqrt(Math.max(0, (pp + qq - 2 * best) / W)); cat.resid = M.resid;
    // steering: while he is free, the goal angle runs ahead of his body toward upright
    const steer = cat.mode === 'air' || cat.mode === 'ground';
    if (!steer) M.phi = theta;
    else {
      // everything below is measured from the goal angle tg (0 = upright; the wind-up tilts and the leap points him along his flight)
      const lv = cat.mode === 'air' && M.leaping, lead = M.dropped && lv ? 3 : lv ? T.leapLead : T.rightingLead;
      const rate = (M.dropped && lv ? T.dropSteer : lv ? T.leapSteer : cat.mode === 'air' ? T.rightingRate : T.rightingGround * (1 - M.inn)) * dt, tg = M.phiGoal, th = wrap(theta - tg);
      let ph = wrap(M.phi - tg);
      if (!M.steer) ph = th;
      ph = Math.abs(ph) <= rate ? 0 : ph - Math.sign(ph) * rate;
      const thu = ph + wrap(th - ph); // body angle on the goal's branch
      if (ph > 0) { if (thu < ph) ph = thu; else if (thu - ph > lead) ph = thu - lead; }
      else if (ph < 0) { if (thu > ph) ph = thu; else if (ph - thu > lead) ph = thu + lead; }
      else if (Math.abs(thu) > lead) ph = thu - Math.sign(thu) * lead; // (upright but the body is far away: stay at 0)
      M.phi = wrap(ph + tg);
    }
    M.steer = steer;
    let sc = 1;
    if (similarity) { const R = cat.mode === 'held' ? T.heldScale : T.containedScale; sc = pp > 1e-6 ? (Math.cos(theta) * cs + Math.sin(theta) * sn) / pp : 1; sc = sc < R[0] ? R[0] : sc > R[1] ? R[1] : sc; }
    M.scale = sc;
    const c = Math.cos(M.phi) * sc, s = Math.sin(M.phi) * sc;
    for (let i = 0; i < N; i++) {
      const ax = f * P[2 * i] * qx - cpx, ay = P[2 * i + 1] * qy - cpy;
      gx[i] = cxx + c * ax - s * ay; gy[i] = cxy + s * ax + c * ay;
    }
    if (M.aimS > 0.01 && M.aim.on) { // the wind-up: he stretches away from where he is going (the head stays, the bum goes back)
      let c = 0; for (let i = 0; i < N; i++) c += gx[i]; c /= N; // (about the middle of the goals: anchoring the head would walk him backward, frame after frame)
      const q = 1 + T.aimStretch * M.aimS;
      for (let i = 0; i < N; i++) gx[i] = c + (gx[i] - c) * q;
    }
    if (cat.mode === 'air' || cat.mode === 'pour') { // free: the pull is an internal force, it must not move his centre of mass (or a leap would bleed away)
      let mx = 0, my = 0, ws = 0;
      for (let i = 0; i < N; i++) { const w = pullW[i] * massW[i]; mx += w * (gx[i] - x[i]); my += w * (gy[i] - y[i]); ws += w; } // (weighted by mass too: the pull conserves momentum)
      mx /= ws; my /= ws;
      for (let i = 0; i < N; i++) { gx[i] -= mx; gy[i] -= my; }
    }
    if (cat.mode === 'ground') { // resting on something: the goals agree with where the parts that are touching it are, so the pose never lifts him off it or pushes him into it
      let dy = 0, n = 0;
      for (let i = 0; i < N; i++) if (suppLast[i]) { dy += y[i] - gy[i]; n++; }
      if (n) { dy /= n; for (let i = 0; i < N; i++) gy[i] += dy; }
    }
  }

  // The goal angle of the shape match: upright, tilted a little while he winds up, or nose-first along his flight.
  const smoothStep = (a, b, v) => smooth01(a, b, v);
  function steerGoal(dt) {
    const f = M.facing;
    M.dive = false;
    if (M.aim.on && (cat.mode === 'ground' || cat.mode === 'contained')) {
      const el = Math.atan2(M.aim.dy, Math.abs(M.aim.dx)), t = T.aimTilt * el;
      M.phiGoal = f * (t < -0.25 ? -0.25 : t > 0.6 ? 0.6 : t) * M.aimS;
    } else if (M.leaping && cat.mode === 'air' && M.dropped) {
      M.phiGoal = 0; M.dive = true; // vertical, head down
    } else if (M.leaping && cat.mode === 'air') {
      let hd = wrap(Math.atan2(M.vyc, M.vxc) - (f > 0 ? 0 : Math.PI));
      let aimed = false;
      if (interior) { // is his head on course for the opening? then he stays nose-first and dives
        const hvx = (x[HEAD] - px[HEAD]) / dt, hvy = (y[HEAD] - py[HEAD]) / dt, disc = hvy * hvy - 4 * 15 * (rimY - y[HEAD]);
        if (disc >= 0) { const t = (hvy + Math.sqrt(disc)) / 30; if (t > 0 && t < 1.6) aimed = Math.abs(x[HEAD] + hvx * t - ox) < rimHalf * T.diveAim; }
      }
      M.dive = aimed;
      const w = aimed ? 1 : 1 - smoothStep(T.leapAlignDown[0], T.leapAlignDown[1], -M.vyc);
      const g = hd * w;
      M.phiGoal = g < -1.35 ? -1.35 : g > 1.35 ? 1.35 : g;
    } else M.phiGoal = 0;
  }

  // reel a loose part in over the rim (goals in tgx, tgy): out and up around the flare, over the rim, then down into the opening
  function prepTuck(dt) {
    if (!(cat.mode === 'contained' && interior && cat.fit >= T.tuckFit && cat.outN > 0) || M.aim.on) { M.tuck = 0; return false; }
    M.tuck += dt;
    for (let i = 0; i < N; i++) {
      if (inside[i]) continue;
      const dxo = x[i] - ox, ad = dxo < 0 ? -dxo : dxo;
      let bj = -1, bd = 1e9; // the nearest part of him that is inside
      for (let j = 0; j < K; j++) { if (!inside[j] || j === i) continue; const d = (x[j] - x[i]) * (x[j] - x[i]) + (y[j] - y[i]) * (y[j] - y[i]); if (d < bd) { bd = d; bj = j; } }
      const jx = bj < 0 ? ox : x[bj], jy = bj < 0 ? rimY - 1 : y[bj];
      if (ad >= rimHalf - 0.15) {
        if (y[i] < rimY + 0.45) { // up and a little out (clear of the lip), then over the rim toward the nearest part that is in
          tgx[i] = ad < outerRimR + 0.9 ? x[i] + (dxo < 0 ? -1 : 1) * 0.9 : jx; tgy[i] = rimY + 1.3;
        }
        else { tgx[i] = jx; tgy[i] = jy; }                                                  // above the rim: down to him
      } else if (y[i] > rimY + T.fitHeadroom * 0.5) { tgx[i] = x[i]; tgy[i] = rimY - 0.3; } // in the column but too high: down
      else { tgx[i] = jx; tgy[i] = jy; }
    }
    return true;
  }

  // The turn: a card-flip of his whole body about his own centre (a 2D cat cannot turn any other way). Kinematic: no constraints, no velocity.
  function startFlip(f) {
    M.flip = 1; M.flipU = 0; M.flipNew = f; flipX.set(x);
    let lo = 1e9, hi = -1e9; for (let i = 0; i < N; i++) { lo = Math.min(lo, x[i] - r[i]); hi = Math.max(hi, x[i] + r[i]); } M.flipCx = (lo + hi) / 2; // (about the middle of his extent: the turned cat fills the same space)
    M.facing = cat.facing = f; sideT = -f;
  }
  function turn(dt) {
    M.flipU += dt / T.turnTime;
    const u = Math.min(1, M.flipU), sc = Math.cos(Math.PI * u);
    for (let i = 0; i < N; i++) { x[i] = M.flipCx + (flipX[i] - M.flipCx) * sc; px[i] = x[i]; py[i] = y[i]; }
    cat.side += (sideT - cat.side) * (1 - Math.exp(-9 * dt));
    if (u >= 1) {
      M.flip = 0; depenetrate(4); clearPlacement(1.5);
      if (M.pending) { const p = M.pending; M.pending = null; doLeap(p[0], p[1]); }
    }
    updateStats(dt);
  }

  // ---------------------------------------------------------------- anchored ground life
  // On a floor, shelf or cushion he is POSED, not simulated: every node is placed from the pose around an anchor (the ground point under
  // his hips), so nothing he does there (idle life, the wind-up, the turn, a landing crouch or splat) can move him. While the player holds
  // an aim his paws are planted (pinned in the world, the knees follow by two-bone IK) and the turn mirrors about the contact centre.
  // Landing, leaping, being grabbed, pouring and sitting in a container are still the soft-body rig.
  const AN = {
    on: false, hx: 0, ay: 0, lo: -9, hi: 9, blend: 1, ax: 0, planted: false, flipping: false, flipU: 0, fNew: 1, mirrored: false,
    pin: [0, 0, 0, 0], pinX: [0, 0, 0, 0], pinY: [0, 0, 0, 0], pinW: [0, 0, 0, 0], from: new Array(2 * N).fill(0), tip: 0, tipT: 0,
  };
  const kx = new Float32Array(N), ky = new Float32Array(N), IKO = { kx: 0, ky: 0, px: 0, py: 0 };

  function surfaceOf(code) { // a flat surface a node stood on -> { y, lo, hi } (the span his support must stay inside)
    const W = T.roomHalfW;
    if (code === 30000) return { y: 0, lo: -W, hi: W, floor: true };
    const g = code - 1, k = grpKind[g], ref = grpRef[g];
    if (k === 1) { const p = platforms[ref]; return { y: p.y, lo: p.x - p.w / 2 + 0.1, hi: p.x + p.w / 2 - 0.1, floor: false }; }
    const c = cushions[ref]; return { y: c.y + T.cushionH, lo: c.x - c.w / 2 + 0.2, hi: c.x + c.w / 2 - 0.2, floor: false };
  }
  const SPAN = { y: 0, lo: 0, hi: 0, floor: false };

  // overhang (how far a pose reaches past the ends of what he stands on, body only), for the pose and facing given, hips at hx
  function overhang(name, f, hx, lo, hi) {
    const e = poseExtent(name, f, false), W = T.roomHalfW;
    return Math.max(0, lo - (hx + e.lo), hx + e.hi - hi, -W - (hx + e.lo), hx + e.hi - W);
  }

  // would the pose (hips at hx, standing on ay) poke into the container, a cushion or a shelf?
  function overlapsContainer(name, f, hx, ay) {
    if (nCap === 0) return false;
    const P = POSES[name];
    for (let i = 0; i < N; i++) {
      const X = hx + f * P[2 * i] * 1.1, Y = ay + P[2 * i + 1];
      for (let c = 0; c < nCap; c++) {
        const o = c * 6, ax = cap[o], ay_ = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3];
        let u = ((X - ax) * ex + (Y - ay_) * ey) * cap[o + 4]; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = X - ax - u * ex, dy = Y - ay_ - u * ey, R = r0[i] + cap[o + 5] - 0.05;
        if (dx * dx + dy * dy < R * R) return true;
      }
    }
    return false;
  }

  // Is he in a state to be posed on his spot? Returns false and sets him tipping if his support is badly beyond an edge.
  function tryEngage() {
    if (cat.mode !== 'ground' || cat.grabs.length || M.flip || M.leapT > 0 || M.pourT > 0 || cat.relaxed || M.inn > 0.3 || AN.tipT > 0 || M.forced) return false;
    if (M.groundT < T.anchorGround || M.vxc * M.vxc + M.vyc * M.vyc > T.anchorSpeed * T.anchorSpeed) return false;
    let code = 0, best = 0;
    for (let i = 0; i < N; i++) { const c = suppFLast[i]; if (!c) continue; let n = 0; for (let j = 0; j < N; j++) if (suppFLast[j] === c) n++; if (n > best) { best = n; code = c; } }
    if (best < 2) return false;
    const S = surfaceOf(code), W = T.roomHalfW, f = M.facing, Pr = POSES[M.rest];
    let hx = x[HIPS];
    // his support: hips and the paws of the pose he is going to hold
    let mn = hx, mx = hx, cs = hx;
    for (let l = 0; l < NL; l++) { const px_ = hx + f * Pr[2 * paw(l)]; cs += px_; if (px_ < mn) mn = px_; if (px_ > mx) mx = px_; }
    cs /= 5;
    let s = 0;
    if (cs < S.lo + T.edgeMargin) s = S.lo + T.edgeMargin - cs; else if (cs > S.hi - T.edgeMargin) s = S.hi - T.edgeMargin - cs;
    if (mn + s < S.lo - 0.25) s += S.lo - 0.25 - (mn + s); else if (mx + s > S.hi + 0.25) s -= mx + s - (S.hi + 0.25);
    if (Math.abs(s) > (S.floor ? 4.6 : T.scootMax)) { AN.tip = s > 0 ? -1 : 1; AN.tipT = 0.8; ev('tip'); return false; } // not on his feet: off the edge at once
    const e = poseExtent(M.rest, f, true); // and the walls of the room: the whole of him, tail too
    if (hx + s + e.lo < -W + 0.05) s += -W + 0.05 - (hx + s + e.lo); else if (hx + s + e.hi > W - 0.05) s -= hx + s + e.hi - (W - 0.05);
    { // not through the container's wall (or a cushion's): if the pose would poke into one, he sits a little way off, whichever way is nearer
      let n = 0, t = 0;
      const s0 = s;
      for (; n < 31; n++) {
        const k = (n >> 1) + (n & 1), sg = (n & 1) ? 1 : -1; // 0, +1, -1, +2, -2 ...
        t = s0 + (n === 0 ? 0 : sg * Math.ceil(n / 2) * 0.15);
        if (!overlapsContainer(M.rest, f, hx + t, S.y) && mn + t >= S.lo - 0.6 && mx + t <= S.hi + 0.6 && hx + t + e.lo >= -W && hx + t + e.hi <= W) break;
      }
      if (n >= 31) return false; // (no room: he stays a rig)
      s = t;
    }
    engage(hx + s, S, false);
    return true;
  }
  function engage(hx, S, instant) {
    const A = AN;
    A.on = true; A.hx = hx; A.ay = S.y; A.lo = S.lo; A.hi = S.hi; A.planted = false; A.flipping = false; A.flipU = 0; A.mirrored = false; A.tip = 0; A.tipT = 0;
    for (let l = 0; l < NL; l++) { A.pin[l] = 0; A.pinW[l] = 0; }
    for (let i = 0; i < N; i++) { A.from[2 * i] = x[i]; A.from[2 * i + 1] = y[i]; }
    A.blend = instant ? 1 : 0;
    cat.mode = 'ground'; M.leaping = false; M.dive = false; M.startled = false; M.pourT = 0; M.steer = false; M.phi = 0; M.lean = 0;
    for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; }
  }
  // ---------------------------------------------------------------- frozen perches
  // Anywhere else he comes to rest (a rim, on top of a container, half over a shelf edge, the box on its vac, a cushion's end) he is FROZEN as
  // soon as he has settled, or the moment a finger goes down: the settled rig is held as a kinematic rest pose. Nodes touching a support never
  // move (a support that is the container rides with it); aiming only leans the head and wiggles the bum, about zero net movement.
  const FZ = { on: false, x0: new Array(N).fill(0), y0: new Array(N).fill(0), touch: new Array(N).fill(0), onCont: false, calm: 0 };
  let contSupp = false, contSuppLast = false;
  function freezeNow() {
    if (FZ.on || AN.on) return false;
    FZ.on = true; FZ.onCont = contSuppLast; FZ.calm = 0;
    for (let i = 0; i < N; i++) { FZ.x0[i] = x[i]; FZ.y0[i] = y[i]; FZ.touch[i] = suppLast[i] || supp[i] ? 1 : 0; px[i] = x[i]; py[i] = y[i]; }
    // nodes resting within a hair of a surface also count as touching
    for (let i = 0; i < N; i++) if (y[i] - r[i] < 0.06) FZ.touch[i] = 1;
    cat.mode = 'ground'; M.leaping = false; M.dive = false; M.pourT = 0; M.vxc = M.vyc = 0;
    return true;
  }
  function unfreeze() { if (!FZ.on) return; FZ.on = false; for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; } M.groundT = 0; M.airT = 0; }
  function fzStep(dt) {
    cat.mode = 'ground'; M.groundT += dt; M.airT = 0; M.leapT = Math.max(0, M.leapT - dt);
    M.tone = T.toneGround; cat.tone = M.tone; cat.facing = M.facing;
    idle(dt);
    cat.side += (sideT - cat.side) * (1 - Math.exp(-9 * dt));
    const a = M.aimS, ph = 6.2832 * T.aimWiggleHz * cat.time, dirx = M.aim.dx >= 0 ? 1 : -1;
    for (let i = 0; i < N; i++) {
      let ox = 0, oy = 0;
      if (!FZ.touch[i]) {
        if (i <= 2) { const w = 1 - i * 0.3; ox = 0.18 * a * w * dirx; oy = 0.12 * a * w * Math.max(-0.5, Math.min(1, M.aim.dy / Math.max(0.5, Math.abs(M.aim.dx) + 0.5))); }
        else if (i >= HIPS - 3 && i <= HIPS) { const k = HIPS - i; ox = 0.07 * a * Math.sin(ph - k * 0.5); oy = 0.02 * a * Math.sin(2 * ph - k); }
        else if (i >= TAIL0 && i < LEG0) { const j = i - TAIL0; ox = 0.1 * (j / NT) * Math.sin(6.2832 * T.tailSwishHz * cat.time + tailPhase + j * 0.7); }
      }
      px[i] = x[i]; py[i] = y[i]; x[i] = FZ.x0[i] + ox; y[i] = FZ.y0[i] + oy;
    }
    M.vxc = M.vyc = 0; M.comVy = M.comVy1 = M.comVy2 = 0;
    updateStats(dt);
  }
  function maybeFreeze(dt) {
    if (FZ.on || AN.on || cat.mode !== 'ground' || M.forced || M.stuck || M.inn > 0.2 || AN.tipT > 0 || cat.grabs.length || M.leapT > 0 || M.pourT > 0 || M.flip) { FZ.calm = 0; return; }
    if (cat.moving ? (M.vxc * M.vxc + M.vyc * M.vyc < 2.25 && cat.ke < 0.5 && M.groundT > 0.15) : (M.vxc * M.vxc + M.vyc * M.vyc < 6 && cat.ke < 1.6 && M.groundT > 0.1)) FZ.calm += dt; // (on a driving box he waits for full calm) else FZ.calm = 0;
    if (FZ.calm > T.freezeAfter) freezeNow();
  }

  // ---------------------------------------------------------------- kickies
  // He grabbed a toy in flight: he hangs where he is, curled round it (the loaf pose placed on his centre), and kicks it with both hind legs.
  // The player may aim again from here (no leap is counted); let go of the aim and he launches. Ignore it and he lets go and falls.
  const KK = { on: false, t: 0, cx: 0, cy: 0, toyX: 0, toyY: 0, x0: new Array(N).fill(0), y0: new Array(N).fill(0), from: new Array(2 * N).fill(0), tx: 0, ty: 0 };
  // BACK LEG KICKIES: he is rolled onto his side in a tight C, belly toward the camera, the toy clutched to his chest in both front paws, head tucked down at it.
  // The hind legs are drawn up in front of the body and pump alternately, each foot raking the toy (about 1.3 units, T.kickHz); the body judders with every kick.
  // Local coordinates (facing +x), mirrored by the facing; the circle of the spine is centred on (0.5, 0).
  function kkLayout(t) {
    const f = M.facing, kp = 6.2832 * T.kickHz * t, jx = 0.09 * Math.sin(kp * 2), jy = 0.08 * Math.cos(kp * 2 + 1);
    const cx = KK.cx + f * jx, cy = KK.cy + jy, SPAN = 2.4, RR = ((K - 1) * L0) / SPAN, A0 = 1.6;
    const W = (lx, ly, i) => { KK.x0[i] = cx + f * lx; KK.y0[i] = cy + ly; };
    for (let i = 0; i < K; i++) { const th = A0 + (i / (K - 1)) * SPAN; W(0.5 + RR * Math.cos(th), RR * Math.sin(th), i); }
    for (let k = 0; k < NT; k++) { const th = A0 + SPAN + (k + 1) * 0.3; W(0.5 + (RR + 0.1 + k * 0.05) * Math.cos(th), (RR + 0.1 + k * 0.05) * Math.sin(th), TAIL0 + k); }
    const tx = 0.5 + 0.12 * Math.sin(kp * 2), ty = 0.05 + 0.1 * Math.cos(kp * 2);
    KK.toyX = cx + f * tx; KK.toyY = cy + ty;
    W(-0.45, 1.0, knee(0)); W(0.1, 0.4, paw(0)); W(1.25, 0.95, knee(1)); W(0.95, 0.35, paw(1));
    const hx = 0.5 + RR * Math.cos(A0 + SPAN), hy = RR * Math.sin(A0 + SPAN);
    for (let l = 2; l < 4; l++) {
      const s = 0.5 + 0.5 * Math.sin(kp + (l - 2) * Math.PI), fx = hx + 0.9 + (0.7 - hx - 0.9) * s, fy = hy + 0.2 + (-0.1 - hy - 0.2) * s;
      W(fx, fy, paw(l)); W((hx + fx) / 2 + 0.25, (hy + fy) / 2 - 0.7, knee(l));
    }
  }
  function kickStart(tx, ty) {
    if (KK.on) return false;
    unfreeze(); disengage();
    KK.on = true; KK.t = 0; KK.tx = tx; KK.ty = ty;
    const lp = launchPoint({});
    KK.cx = lp.x; KK.cy = lp.y; KK.toyX = lp.x; KK.toyY = lp.y;
    for (let i = 0; i < N; i++) { KK.from[2 * i] = x[i]; KK.from[2 * i + 1] = y[i]; px[i] = x[i]; py[i] = y[i]; }
    kkLayout(0);
    const ix = KK.x0[0], iy = KK.y0[0];
    // keep the held pose out of shelves, walls and the floor: place it, push it out, remember where it ended up, then go back to where he was
    for (let i = 0; i < N; i++) { x[i] = KK.x0[i]; y[i] = KK.y0[i]; }
    depenetrate(10);
    let sx = 0, sy = 0; for (let i = 0; i < N; i++) { sx += x[i] - KK.x0[i]; sy += y[i] - KK.y0[i]; } sx /= N; sy /= N; // (the whole pose moves together, so its shape holds)
    for (let i = 0; i < N; i++) { KK.x0[i] += sx; KK.y0[i] += sy; x[i] = KK.from[2 * i]; y[i] = KK.from[2 * i + 1]; px[i] = x[i]; py[i] = y[i]; }
    for (let pass = 0; pass < 40; pass++) { // (then the whole pose is pushed out of anything it still overlaps, as one rigid move: the deepest overlap first)
      let mx = 0, my = 0, best = 0;
      for (let i = 0; i < N; i++) {
        const X = KK.x0[i], Y = KK.y0[i];
        for (let c = 0; c < nCap; c++) {
          const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3], R = r[i] + cap[o + 5] + T.wallSlop;
          let u = ((X - ax) * ex + (Y - ay) * ey) * cap[o + 4]; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = X - ax - u * ex, dy = Y - ay - u * ey, d = Math.hypot(dx, dy);
          if (d < R && R - d > best) { best = R - d; if (d < 1e-5) { mx = 0; my = R; } else { mx = dx / d * (R - d); my = dy / d * (R - d); } }
        }
        const lo = -T.roomHalfW + r[i], hi = T.roomHalfW - r[i];
        if (lo - X > best) { best = lo - X; mx = best; my = 0; } else if (X - hi > best) { best = X - hi; mx = -best; my = 0; }
        if (r[i] - Y > best) { best = r[i] - Y; mx = 0; my = best; }
      }
      if (best < 1e-3) break;
      for (let i = 0; i < N; i++) { KK.x0[i] += mx; KK.y0[i] += my; }
    }
    { // still overlapping something after all that (a toy right beside a shelf, a cushion, a wall)? then he does not grab it this time
      let worst = 0;
      for (let i = 0; i < N; i++) for (let c = 0; c < nCap; c++) {
        const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3], R = r[i] + cap[o + 5];
        let u = ((KK.x0[i] - ax) * ex + (KK.y0[i] - ay) * ey) * cap[o + 4]; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(KK.x0[i] - ax - u * ex, KK.y0[i] - ay - u * ey); if (R - d > worst) worst = R - d;
      }
      if (worst > 0.1) { KK.on = false; for (let i = 0; i < N; i++) { x[i] = KK.from[2 * i]; y[i] = KK.from[2 * i + 1]; px[i] = x[i]; py[i] = y[i]; } return false; }
    }
    KK.cx += KK.x0[0] - ix; KK.cy += KK.y0[0] - iy; kkLayout(0);
    M.leaping = false; M.dive = false; M.dropped = false; M.startled = false; M.dropT = 0; cat.mode = 'air'; M.vxc = M.vyc = 0; M.airT = 0; M.leapAge = 99;
    ev('kickies');
    return true;
  }
  function kickEnd(fall) { if (!KK.on) return; KK.on = false; M.aim.on = false; M.aimS = 0; cat.aimS = 0; for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; } if (fall) ev('kickfall'); }
  function kkStep(dt) {
    KK.t += dt; cat.mode = 'air'; M.tone = T.toneAir; cat.tone = M.tone; cat.facing = M.facing; M.vxc = M.vyc = 0;
    cat.side += (sideT - cat.side) * (1 - Math.exp(-9 * dt));
    const e = Math.min(1, KK.t / 0.15), ee = e * e * (3 - 2 * e), a = M.aimS, ph = 6.2832 * T.aimWiggleHz * cat.time, dirx = M.aim.dx >= 0 ? 1 : -1;
    kkLayout(KK.t);
    for (let i = 0; i < N; i++) {
      let ox = 0, oy = 0;
      if (i <= 2) { const w = 1 - i * 0.3; ox += 0.18 * a * w * dirx; oy += 0.12 * a * w; }
      else if (i >= HIPS - 3 && i <= HIPS) ox += 0.07 * a * Math.sin(ph - (HIPS - i) * 0.5);
      px[i] = x[i]; py[i] = y[i];
      x[i] = KK.from[2 * i] + (KK.x0[i] - KK.from[2 * i]) * ee + ox; y[i] = KK.from[2 * i + 1] + (KK.y0[i] - KK.from[2 * i + 1]) * ee + oy;
    }
    depenetrate(2); // (the pumping hind legs never go into a shelf or the floor)
    updateStats(dt);
    if (KK.t > T.kickWindow && !M.aim.on) kickEnd(true);
    else if (KK.t > T.kickWindow + 2.5) kickEnd(true);
  }

  function disengage() {
    const A = AN; if (!A.on) return;
    A.on = false; A.planted = false; A.flipping = false; A.flipU = 0; A.mirrored = false;
    for (let l = 0; l < NL; l++) { A.pin[l] = 0; A.pinW[l] = 0; }
    for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; }
    M.steer = false; M.phi = 0; M.airT = 0; M.groundT = 0;
  }

  // pointer down: lock the feet. Whatever the pose does from here, the paws on the ground stay where they are.
  function plant() {
    const A = AN;
    if (!A.on) { if (!FZ.on && (cat.mode === 'ground' || cat.mode === 'contained') && cat.grabs.length === 0) freezeNow(); return FZ.on; }
    if (A.planted) return true;
    A.planted = true;
    for (let l = 0; l < NL; l++) {
      const i = paw(l);
      if (y[i] - r0[i] - A.ay < 0.2) { A.pin[l] = 1; A.pinX[l] = x[i]; A.pinY[l] = y[i]; A.pinW[l] = 1; } else A.pin[l] = 0;
    }
    return true;
  }
  function startAnFlip(f) {
    const A = AN;
    let s = 0, n = 0; for (let l = 0; l < NL; l++) if (A.pin[l]) { s += A.pinX[l]; n++; }
    A.ax = n ? s / n : A.hx; // the planted paws' centre: the turn keeps the feet where they are
    A.flipping = true; A.flipU = 0; A.mirrored = false; A.fNew = f;
  }

  // where every node goes, from the pose around the anchor
  function anLayout() {
    const A = AN, P = poseCur, f = M.facing, hx = A.hx, ay = A.ay, ann = cat.relaxed ? 0 : cat.annoyance;
    const depth = Math.max(T.crouchDepth * M.crouch, T.splatDepth * M.splat);
    const qx = 1 + T.crouchWiden * M.crouch + 0.3 * M.splat, qy = 1 - depth, q = 1 + T.aimStretch * M.aimS;
    const cl = Math.cos(M.lean), sl = Math.sin(M.lean), phx = f * P[2 * HIPS] * qx * q, phy = P[2 * HIPS + 1] * qy;
    for (let i = 0; i < LEG0; i++) {
      const dx = f * P[2 * i] * qx * q - phx, dy = P[2 * i + 1] * qy - phy;
      kx[i] = hx + phx + dx * cl - dy * sl; ky[i] = ay + phy + dx * sl + dy * cl;
    }
    if (M.lickT > 0) { const b = Math.sin(6.2832 * 2.6 * (T.lickTime - M.lickT)) * 0.26; for (let i = 0; i < 3; i++) ky[i] += b * (1 - i * 0.3); }
    if (M.aimS > 0.02) { // the bum wiggle: about the hips, so no net movement
      const a = T.aimWiggleAmp * M.aimS * Math.min(1, M.aimT / 0.15), ph = 6.2832 * T.aimWiggleHz * cat.time;
      for (let k = 0; k < 4; k++) { const i = HIPS - k, w = 1 - k * 0.28; kx[i] += a * w * Math.sin(ph - k * 0.5); ky[i] += 0.3 * a * w * Math.sin(ph * 2 - k); }
      kx[TAIL0] += a * 0.6 * Math.sin(ph - 2); kx[TAIL0 + 1] += a * 0.7 * Math.sin(ph - 2.6);
    }
    { // tail swish (and the idle flick of the tip)
      const amp = T.tailSwishAmp * (1 + 2 * M.aimS + 2 * ann) * (cat.relaxed ? 0.3 : 1), hz = T.tailSwishHz * (1 + ann);
      const env = M.flickT > 0 ? Math.sin((1 - M.flickT / T.flickTime) * Math.PI) : 0, fs = Math.sin(6.2832 * 3.2 * (T.flickTime - M.flickT));
      for (let j = 1; j < NT; j++) {
        const i = TAIL0 + j, a = i - 1;
        let tx = kx[i] - kx[a], ty = ky[i] - ky[a]; const l = hyp(tx, ty) || 1; tx /= l; ty /= l;
        let o = amp * (j / NT) * Math.sin(6.2832 * hz * cat.time + tailPhase + j * 0.7);
        if (env > 0 && j >= 3) o += 0.35 * env * ((j - 2) / (NT - 2)) * fs;
        kx[i] += -ty * o; ky[i] += tx * o;
      }
    }
    for (let l = 0; l < NL; l++) { // legs: the pose's knee and paw, or (planted) the paw where it is pinned and the knee by IK
      const att = LEG_ATTACH[l], a = att - 1, b = att + 1, kn = knee(l), pw = paw(l);
      let tx = kx[a] - kx[b], ty = ky[a] - ky[b]; const len = hyp(tx, ty) || 1; tx /= len; ty /= len;
      const o = r[att] * T.legOffset * cat.side, axp = kx[att] - ty * o, ayp = ky[att] + tx * o;
      let kkx = hx + f * P[2 * kn] * qx * q, kky = ay + P[2 * kn + 1] * qy, ppx = hx + f * P[2 * pw] * qx * q, ppy = ay + P[2 * pw + 1] * qy;
      const w = A.pinW[l];
      if (w > 0.001) {
        const bend = (POSES[M.pose].bend ? POSES[M.pose].bend[l] : 1) * f;
        ik2(axp, ayp, ppx + (A.pinX[l] - ppx) * w, ppy + (A.pinY[l] - ppy) * w, legLen[l], legLen[l], bend, IKO);
        kkx += (IKO.kx - kkx) * w; kky += (IKO.ky - kky) * w; ppx = IKO.px; ppy = IKO.py;
      }
      kx[kn] = kkx; ky[kn] = kky; kx[pw] = ppx; ky[pw] = ppy;
    }
    if (A.flipping) { const m = Math.abs(Math.cos(Math.PI * A.flipU)); for (let i = 0; i < N; i++) kx[i] = A.ax + m * (kx[i] - A.ax); }
  }

  const IMP = { at: -9, v: 0, k: 0, part: '' }, IMP_KINDS = ['', 'floor', 'shelf', 'rim', 'cushion', 'wall', 'ceiling', 'containerFloor'];
  function startLick() { if (M.lickT > 0 || cat.relaxed || M.forced) return; M.lickT = T.lickTime; M.quietT = -T.lickQuiet * 2; M.lickQueue = 0; ev('lickies'); }
  function cancelLick() { M.lickT = 0; M.quietT = 0; M.lickQueue = 0; }
  function anStep(dt) {
    const A = AN, W = T.roomHalfW;
    if (A.flipping) {
      A.flipU += dt / T.turnTime;
      if (!A.mirrored && A.flipU >= 0.5) { // the card is edge-on: swap sides about the contact centre
        A.mirrored = true; A.hx = 2 * A.ax - A.hx; for (let l = 0; l < NL; l++) A.pinX[l] = 2 * A.ax - A.pinX[l];
        M.facing = cat.facing = A.fNew; sideT = -A.fNew;
      }
      if (A.flipU >= 1) {
        A.flipping = false; A.flipU = 0; A.mirrored = false;
        if (M.pending) { const p = M.pending; M.pending = null; doLeap(p[0], p[1]); return; }
      }
    }
    // Lickies: after a splat or a hard bonk, or after a few quiet seconds, he licks a mitten (any touch cancels it at once)
    if (M.aim.on || A.planted) { M.lickT = 0; M.quietT = 0; M.lickQueue = 0; }
    else if (M.lickT > 0) M.lickT -= dt;
    else {
      M.quietT += dt;
      if (M.lickQueue > 0) { M.lickQueue -= dt; if (M.lickQueue <= 0) startLick(); }
      else if (M.quietT > T.lickQuiet) startLick();
    }
    cat.mode = 'ground'; M.groundT += dt; M.airT = 0; M.inn = 0; M.leapT = Math.max(0, M.leapT - dt); M.pourCool = Math.max(0, M.pourCool - dt);
    M.tone += (T.toneGround - M.tone) * (1 - Math.exp(-dt / 0.1)); cat.tone = M.tone; cat.facing = M.facing;
    choosePose(dt);
    idle(dt);
    cat.side += (sideT - cat.side) * (1 - Math.exp(-9 * dt));
    for (let l = 0; l < NL; l++) { const tg = A.planted && A.pin[l] ? 1 : 0; A.pinW[l] += (tg - A.pinW[l]) * (1 - Math.exp(-dt / ((tg ? T.plantBlend : 0.25) / 3))); }
    { // lean back / forward: the head lifts with the elevation of the shot
      let tg = 0;
      if (M.aim.on) { const el = Math.atan2(M.aim.dy, Math.abs(M.aim.dx)), t = T.aimLean * el; tg = M.facing * (t < -0.12 ? -0.12 : t > T.aimLeanMax ? T.aimLeanMax : t) * M.aimS; }
      M.lean += (tg - M.lean) * (1 - Math.exp(-12 * dt));
    }
    anLayout();
    let e = 1;
    if (A.blend < 1) { A.blend = Math.min(1, A.blend + dt / T.anchorBlend); e = A.blend * A.blend * (3 - 2 * A.blend); }
    let sx = 0, sy = 0;
    for (let i = 0; i < N; i++) {
      let tx = e < 1 ? A.from[2 * i] + (kx[i] - A.from[2 * i]) * e : kx[i], ty = e < 1 ? A.from[2 * i + 1] + (ky[i] - A.from[2 * i + 1]) * e : ky[i];
      const ri = r[i]; // (the walls and the floor he stands on have the last word)
      if (tx < -W + ri) tx = -W + ri; else if (tx > W - ri) tx = W - ri;
      if (ty < A.ay + r0[i] * 0.98) ty = A.ay + r0[i] * 0.98;
      px[i] = x[i]; py[i] = y[i]; x[i] = tx; y[i] = ty; sx += tx - px[i]; sy += ty - py[i];
    }
    M.vxc = sx / N / dt; M.vyc = sy / N / dt; M.comVy = M.comVy1 = M.comVy2 = 0;
    updateRadii(dt);
    updateStats(dt);
  }

  // a box (or anything) rolling into him pushes him along with it: the anchor goes with whatever the container's walls shove
  function pushFromContainer() {
    if (!def || !AN.on) return;
    let best = 0;
    for (let c = grpStart[0]; c < grpStart[1]; c++) {
      const o = c * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3];
      for (let i = 0; i < N; i++) {
        let u = ((x[i] - ax) * ex + (y[i] - ay) * ey) * cap[o + 4]; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = x[i] - ax - u * ex, dy = y[i] - ay - u * ey, R = r[i] + cap[o + 5], d2 = dx * dx + dy * dy;
        if (d2 >= R * R || d2 < 1e-10) continue;
        const d = Math.sqrt(d2), push = (R - d) * dx / d;
        if (Math.abs(push) > Math.abs(best)) best = push;
      }
    }
    if (best !== 0) carry(best);
  }

  let tearTimer = 0;
  function step(dt) {
    if (dt > 1 / 60) dt = 1 / 60;
    if (dt < 1e-4) return;
    const ratio = dt / lastDt; lastDt = dt;
    cat.time += dt;
    M.bounceCool = Math.max(0, M.bounceCool - dt);
    { // is something torn (a spine segment, the tail root or a leg stretched far past its length) while he is at rest? Only a torn state that PERSISTS is repaired.
      let torn = false;
      for (let i = 1; i < K && !torn; i++) { const dx = x[i] - x[i - 1], dy = y[i] - y[i - 1]; if (dx * dx + dy * dy > 1.0) torn = true; }
      { const tdx = x[TAIL0] - x[HIPS], tdy = y[TAIL0] - y[HIPS]; if (tdx * tdx + tdy * tdy > 1.6 * 1.6) torn = true; }
      for (let l = 0; l < NL && !torn; l++) { const a2 = LEG_ATTACH[l], kn2 = knee(l), pw2 = paw(l), kx = x[kn2] - x[a2], ky = y[kn2] - y[a2], qx = x[pw2] - x[kn2], qy = y[pw2] - y[kn2]; if (kx * kx + ky * ky > 1.7 * 1.7 || qx * qx + qy * qy > 1.7 * 1.7) torn = true; }
      if (torn && cat.mode === 'ground' && M.vxc * M.vxc + M.vyc * M.vyc < 9 && !cat.grabs.length) tearTimer += dt; else tearTimer = 0;
    }
    if (tearTimer > 0.5 && !M.forced && !cat.noRepair) { // a part of him snagged on the far side of a container's flare or fence can tear the spine apart and tether him to the spot (every leap is dragged back): when a spine segment is
      // stretched far past its length, the rest of him (hips, tail, hind legs) is laid out behind the last good node again
      let bad = -1; for (let i = 1; i < K; i++) { const dx = x[i] - x[i - 1], dy = y[i] - y[i - 1]; if (dx * dx + dy * dy > 1.0) { bad = i; break; } }
      if (bad === 1 && !cat.grabs.length) { // the head snagged on its own: put it back in front of the neck
        let bx = x[1] - x[2], by = y[1] - y[2]; const bl = Math.sqrt(bx * bx + by * by) || 1; x[0] = x[1] + bx / bl * L0; y[0] = Math.max(r[0], y[1] + by / bl * L0); px[0] = x[0]; py[0] = y[0]; depenetrate(3);
      } else if (bad > 1 && !cat.grabs.length) {
        let bx = x[bad - 1] - x[bad - 2], by = y[bad - 1] - y[bad - 2]; const bl = Math.sqrt(bx * bx + by * by) || 1; bx /= bl; by /= bl;
        for (let i = bad; i < K; i++) { const d = (i - bad + 1) * L0; x[i] = x[bad - 1] + bx * d; y[i] = Math.max(r[i], y[bad - 1] + by * d); px[i] = x[i]; py[i] = y[i]; }
        for (let k = 0; k < NT; k++) { const d = TAIL_ATT + k * TAIL_SP; x[TAIL0 + k] = x[HIPS] + bx * d; y[TAIL0 + k] = Math.max(r[TAIL0 + k], y[HIPS] + by * d); px[TAIL0 + k] = x[TAIL0 + k]; py[TAIL0 + k] = y[TAIL0 + k]; }
        for (let l = 2; l < 4; l++) for (const i of [knee(l), paw(l)]) { x[i] = x[HIPS - 1] + (i === paw(l) ? 0.1 : 0); y[i] = Math.max(r[i], y[HIPS - 1] - (i === paw(l) ? 0.8 : 0.4)); px[i] = x[i]; py[i] = y[i]; }
        depenetrate(4);
      }
    }
    { // half in a container, not contained and not moving (draped over a rim, wedged in the neck): he cannot be left there. After a moment he hops out on the side his head is on.
      if (!cat.relaxed && cat.mode === 'ground' && M.inn > 0.12 && M.inn < 0.97 && (M.vxc * M.vxc + M.vyc * M.vyc < 6 || M.stuck) && !M.aim.on && !cat.grabs.length && !KK.on && !AN.planted) {
        M.rescueT += dt;
        if (M.rescueT > T.rescueAfter) {
          M.rescueT = 0; unfreeze(); disengage(); let mx = 0; for (let i = 0; i < K; i++) mx += x[i]; mx /= K; const dir = Math.abs(mx - ox) < rimHalf ? (ox >= mx ? 1 : -1) : (mx >= ox ? 1 : -1); // (mostly over the opening: tip in; mostly outside: hop out)
          const wallBound = Math.abs(mx + dir * 2.2) > T.roomHalfW - 0.4, d2 = wallBound ? (ox >= mx ? 1 : -1) : dir, up = wallBound ? 21 : 14, vxk = wallBound ? 7 : 5; // (wedged against the wall: out is over the container)
          for (let i = 0; i < N; i++) { px[i] = x[i] - d2 * vxk / 60; py[i] = y[i] - up / 60; }
          M.leaping = false; M.stuck = false; ev('rescue');
        }
      } else M.rescueT = Math.max(0, M.rescueT - dt * 0.25);
    }
    if (tearTimer > 0.5 && !M.forced && !cat.noRepair) { // the same for a tail root or a leg left behind on the far side of something: put it back under him
      if (!cat.grabs.length) {
        const tdx = x[TAIL0] - x[HIPS], tdy = y[TAIL0] - y[HIPS];
        if (tdx * tdx + tdy * tdy > 1.6 * 1.6) { for (let k = 0; k < NT; k++) { const d = TAIL_ATT + k * TAIL_SP, sgn = x[HIPS] >= x[HIPS - 4] ? 1 : -1; x[TAIL0 + k] = x[HIPS] + sgn * d; y[TAIL0 + k] = Math.max(r[TAIL0 + k], y[HIPS]); px[TAIL0 + k] = x[TAIL0 + k]; py[TAIL0 + k] = y[TAIL0 + k]; } depenetrate(3); cat.repairs++; }
        for (let l = 0; l < NL; l++) {
          const a = LEG_ATTACH[l], kn = knee(l), pw = paw(l), kx = x[kn] - x[a], ky = y[kn] - y[a], qx = x[pw] - x[kn], qy = y[pw] - y[kn];
          if (kx * kx + ky * ky > 1.7 * 1.7 || qx * qx + qy * qy > 1.7 * 1.7) { x[kn] = x[a]; y[kn] = Math.max(r[kn], y[a] - 0.6); x[pw] = x[a]; y[pw] = Math.max(r[pw], y[a] - 1.2); px[kn] = x[kn]; py[kn] = y[kn]; px[pw] = x[pw]; py[pw] = y[pw]; depenetrate(3); cat.repairs++; }
        }
      }
    }
    if (AN.on && cat.grabs.length) disengage(); // picked up (the old verb, tests)
    if (KK.on) { M.aimS += ((M.aim.on ? M.aimTarget : 0) - M.aimS) * (1 - Math.exp(-14 * dt)); cat.aimS = M.aimS; if (M.aim.on) M.aimT += dt; kkStep(dt); return; }
    if (!AN.on && !M.flip && !FZ.on) tryEngage();
    if (FZ.on && cat.grabs.length) unfreeze();
    if (!AN.on && !FZ.on) maybeFreeze(dt);
    if (FZ.on) {
      M.aimS += ((M.aim.on ? M.aimTarget : 0) - M.aimS) * (1 - Math.exp(-14 * dt)); cat.aimS = M.aimS;
      if (M.aim.on) M.aimT += dt;
      fzStep(dt);
      return;
    }
    if (AN.on) {
      M.aimS += ((M.aim.on ? M.aimTarget : 0) - M.aimS) * (1 - Math.exp(-14 * dt)); cat.aimS = M.aimS;
      if (M.aim.on) M.aimT += dt;
      anStep(dt);
      if (cat.moving) pushFromContainer();
      return;
    }
    if (M.flip) { turn(dt); return; }
    M.aimS += ((M.aim.on ? M.aimTarget : 0) - M.aimS) * (1 - Math.exp(-14 * dt)); cat.aimS = M.aimS;
    if (M.aim.on) M.aimT += dt;
    M.leapAge += dt;
    if (AN.tipT > 0) { AN.tipT -= dt; for (let i = 0; i < N; i++) px[i] -= AN.tip * 0.012; } // no footing: slides off the edge
    if (M.dropT > 0) { // DROP: the sideways speed is killed in a moment
      const k = Math.pow(T.dropDamp, dt / T.dropDampTime); M.dropT -= dt;
      for (let i = 0; i < N; i++) px[i] = x[i] - (x[i] - px[i]) * k;
    }
    { // which flank is the belly: it faces down, so it flips when he turns round
      const hx = x[0] - x[1];
      if (hx < -0.12) sideT = 1; else if (hx > 0.12) sideT = -1;
    }
    updateMode(dt, cat.grabs.length > 0);
    choosePose(dt);
    idle(dt);
    cat.side += (sideT - cat.side) * (1 - Math.exp(-9 * dt));
    suppLast.set(supp); supp.fill(0); suppFLast.set(suppF); suppF.fill(0); contSuppLast = contSupp; contSupp = false;
    steerGoal(dt);
    const iters = T.iterations | 0;
    const g = T.gravity * dt * dt, damp = Math.pow(cat.mode === 'air' && M.leaping ? T.airDamp : T.damp, dt * 60) * ratio; // (a leap flies almost drag-free: the arc is a parabola)
    const maxStep2 = T.maxStep * T.maxStep, maxMove2 = (margin0 - 0.1) * (margin0 - 0.1);
    refreshConstraints();
    updateRadii(dt);
    behaviour(dt);

    invMass.set(baseInv); heldMask.fill(0);
    for (const gr of cat.grabs) heldMask[gr.node] = 1;
    for (const gr of cat.grabs) invMass[gr.node] = T.heldInvMass + (1 - gr.k) * (1 - T.heldInvMass);
    // finger smoothing
    const fk = 1 - Math.exp(-T.fingerSmooth * dt), od = Math.exp(-T.grabOffsetDecay * dt);
    for (const gr of cat.grabs) { gr.fx += (gr.tx - gr.fx) * fk; gr.fy += (gr.ty - gr.fy) * fk; gr.ox *= od; gr.oy *= od; }

    // verlet. Muscle tone also damps the motion relative to his own centre of mass (not the fall itself): he does not jiggle.
    let cvx = 0, cvy = 0;
    for (let i = 0; i < N; i++) { cvx += massW[i] * (x[i] - px[i]); cvy += massW[i] * (y[i] - py[i]); }
    cvx *= invTotalMass; cvy *= invTotalMass; // (the mass-weighted mean: the damping of his own wobble never touches his momentum)
    M.vxc = cvx / dt; M.vyc = cvy / dt;
    const rel = Math.max(0.2, 1 - T.toneDamp * M.tone * (dt * 60));
    // on the ground a change of pose never launches him: upward motion of his whole body is damped hard
    const cvy2 = cat.mode === 'ground' && cvy > 0 ? cvy * (1 - T.groundLiftDamp) : cvy;
    const cx0 = cvx * (1 - rel), cy0 = cvy2 - rel * cvy;
    for (let i = 0; i < N; i++) {
      let vx = ((x[i] - px[i]) * rel + cx0) * damp, vy = ((y[i] - py[i]) * rel + cy0) * damp;
      const s2 = vx * vx + vy * vy;
      if (s2 > maxStep2) { const s = T.maxStep / Math.sqrt(s2); vx *= s; vy *= s; }
      px[i] = x[i]; py[i] = y[i]; sx0[i] = x[i]; sy0[i] = y[i];
      x[i] += vx; y[i] += vy + g;
    }

    // broad phase: capsules (container and platforms) that can reach each node this step
    const margin = margin0;
    for (let i = 0; i < N; i++) {
      let n = 0;
      const xi = x[i], yi = y[i], rr = r[i] + margin;
      for (let g = 0; g < nGrp; g++) {
        const gb = g * 4;
        if (xi < grpBox[gb] - rr || xi > grpBox[gb + 1] + rr || yi < grpBox[gb + 2] - rr || yi > grpBox[gb + 3] + rr) continue;
        for (let c = grpStart[g], ce = grpStart[g + 1]; c < ce; c++) {
          const o = c * 6, cr = cap[o + 5];
          const ax = cap[o], ay = cap[o + 1], bx = ax + cap[o + 2], by = ay + cap[o + 3];
          if (xi < (ax < bx ? ax : bx) - cr - rr || xi > (ax > bx ? ax : bx) + cr + rr || yi < (ay < by ? ay : by) - cr - rr || yi > (ay > by ? ay : by) + cr + rr) continue;
          let u = ((xi - ax) * cap[o + 2] + (yi - ay) * cap[o + 3]) * cap[o + 4];
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = xi - ax - u * cap[o + 2], dy = yi - ay - u * cap[o + 3], R = rr + cr;
          if (dx * dx + dy * dy < R * R && n < MAXC) near[i * MAXC + n++] = c;
        }
      }
      nearN[i] = n;
    }

    const poseOn = M.tone > 0.01, freeFall = (cat.mode === 'air' || cat.mode === 'pour') && cat.grabs.length === 0;
    if (poseOn) matchShape(dt, cat.mode === 'contained' || cat.mode === 'held' || M.inn > 0.3);
    const pk = M.tone * T.poseK;
    // the pull saturates: it holds his shape but never shoves him hard at a wall (in a container much less so)
    const pcap = cat.mode === 'contained' || M.inn > 0.3 ? T.poseCapContained : (M.leaping && M.leapAge < 0.2 ? T.poseCapLaunch : T.poseCapAll); // (just after the take-off the pose pull is gentle: it must not throw his light legs about and steal his speed)
    const tuck = prepTuck(dt), tuckK = T.tuckK * Math.min(1, M.tuck / T.tuckRamp);
    const fric = 1 - Math.pow(1 - T.wallFriction, 1 / iters);
    const selfR = T.selfRadius, self3 = T.selfRadius3, slop = T.wallSlop, top = cat.top;
    const invDt = 1 / dt;
    let impact = 0, cushV = 0, cushNx = 0, cushNy = 1, cushG = -1, contHit = false, bonkV = 0, bonkY = 0, bonkX = 0;
    let ctV = 0, ctK = 0, ctNx = 0, ctNy = 1, ctX = 0, ctY = 0, ctI = 0, ctTan = 0; // the strongest contact of this step, for the impact event (presentation only)
    const WALL = T.roomHalfW;

    let moved = false;
    const limitPass = (c) => {
      const a = Ca[c], b = Cb[c];
      const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.sqrt(dx * dx + dy * dy);
      const lo = Clo[c], hi = Chi[c];
      if (d >= lo && d <= hi) return;
      const tgt = d < lo ? lo : hi, e = d - tgt, wa = baseInv[a], wb = baseInv[b], sc = e / (Math.max(d, 1e-6) * (wa + wb));
      x[a] += dx * sc * wa; y[a] += dy * sc * wa; x[b] -= dx * sc * wb; y[b] -= dy * sc * wb;
      moved = true;
    };
    const collide = (it) => {
    for (let i = 0; i < N; i++) {
      let xi = x[i], yi = y[i];
      const ri = r[i];
      let hit = false;
      { // nothing travels further than the broad phase can see in one step (constraint fix-ups can be large)
        const mx = xi - px[i], my = yi - py[i], m2 = mx * mx + my * my;
        if (m2 > maxMove2) { const k = Math.sqrt(maxMove2 / m2); xi = px[i] + mx * k; yi = py[i] + my * k; }
      }
      // container capsules
      const nn = nearN[i], base = i * MAXC;
      for (let q = 0; q < nn; q++) {
        const o = near[base + q] * 6;
        const ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3], R = ri + cap[o + 5] + slop;
        // swept test against the wall's axis (tunnelling protection)
        const s1 = ex * (sy0[i] - ay) - ey * (sx0[i] - ax), s2 = ex * (yi - ay) - ey * (xi - ax);
        if (s1 * s2 < 0) {
          const t = s1 / (s1 - s2), mx = sx0[i] + (xi - sx0[i]) * t, my = sy0[i] + (yi - sy0[i]) * t;
          const u = ((mx - ax) * ex + (my - ay) * ey) * cap[o + 4];
          if (u >= 0 && u <= 1) {
            const l = Math.sqrt(ex * ex + ey * ey) || 1, sg = s1 > 0 ? 1 : -1; // side the node came from
            xi = mx - sg * (ey / l) * R; yi = my + sg * (ex / l) * R;
          }
        }
        let u = ((xi - ax) * ex + (yi - ay) * ey) * cap[o + 4];
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        let dx = xi - ax - u * ex, dy = yi - ay - u * ey;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) { const l = Math.sqrt(ex * ex + ey * ey) || 1; dx = -ey / l; dy = ex / l; d = 1; } else { dx /= d; dy /= d; }
        if (it === 1) {
          const v = -((xi - px[i]) * dx + (yi - py[i]) * dy) * invDt; if (v > T.impactMin && !heldMask[i]) impact += v < 40 ? v : 40;
          if (v > ctV && !heldMask[i]) { const kd = grpKind[capGrp[near[base + q]]]; ctV = v; ctK = kd === 2 ? 4 : kd === 1 ? 2 : (yi > cat.rimY - 0.4 ? 3 : 7); ctNx = dx; ctNy = dy; ctX = xi; ctY = yi; ctI = i; ctTan = Math.abs((xi - px[i]) * -dy + (yi - py[i]) * dx) * invDt; }
          if (v > 3 && grpKind[capGrp[near[base + q]]] === 0) contHit = true;
          if (v > T.cushionMin && v > cushV && grpKind[capGrp[near[base + q]]] === 2) { cushV = v; cushNx = dx; cushNy = dy; cushG = capGrp[near[base + q]]; }
        }
        const pen = R - (d2 < 1e-10 ? 0 : d);
        xi += dx * pen; yi += dy * pen; hit = true;
        if (dy > 0.15) { supp[i] = 1; if (grpKind[capGrp[near[base + q]]] === 0) contSupp = true; }
        if (dy > 0.85) { const kd = grpKind[capGrp[near[base + q]]]; if (kd) suppF[i] = capGrp[near[base + q]] + 1; }
        if (yi < ri && dy < -0.05) { // wedge between wall and floor: slide out along the floor instead of sinking
          const e = (ri - yi) * -dy, sx = dx > 0 ? 1 : -1;
          yi = ri; xi += sx * Math.min(0.6, e / Math.max(0.2, Math.abs(dx)));
        }
        // friction: remove some sliding along the wall
        const vx = xi - px[i], vy = yi - py[i], vn = vx * dx + vy * dy;
        xi -= (vx - vn * dx) * fric; yi -= (vy - vn * dy) * fric;
      }
      // floor, side walls, ceiling
      if (yi < ri) { supp[i] = 1; suppF[i] = 30000; if (it === 1) { const v = (py[i] - yi) * invDt; if (v > T.impactMin && !heldMask[i]) impact += v < 40 ? v : 40; if (v > ctV && !heldMask[i]) { ctV = v; ctK = 1; ctNx = 0; ctNy = 1; ctX = xi; ctY = 0; ctI = i; ctTan = Math.abs(xi - px[i]) * invDt; } } yi = ri; hit = true; }
      else if (yi > top - ri) { if (it === 1) { const v = (yi - py[i]) * invDt; if (v > ctV && !heldMask[i]) { ctV = v; ctK = 6; ctNx = 0; ctNy = -1; ctX = xi; ctY = top; ctI = i; ctTan = Math.abs(xi - px[i]) * invDt; } } yi = top - ri; }
      if (xi < -WALL + ri) {
        const vn = (px[i] - xi) * invDt;
        if (it === 1) { if (vn > T.impactMin && !heldMask[i]) impact += vn < 40 ? vn : 40; if (vn > T.wallBounceMin * 2 && bonkV < vn) { bonkV = vn; bonkY = yi; bonkX = -WALL; } if (vn > ctV && !heldMask[i]) { ctV = vn; ctK = 5; ctNx = 1; ctNy = 0; ctX = -WALL; ctY = yi; ctI = i; ctTan = Math.abs(yi - py[i]) * invDt; } }
        xi = -WALL + ri; hit = true;
        if (vn > T.wallBounceMin) px[i] = xi - T.leapBounce * vn / invDt; // the side walls bounce him
      } else if (xi > WALL - ri) {
        const vn = (xi - px[i]) * invDt;
        if (it === 1) { if (vn > T.impactMin && !heldMask[i]) impact += vn < 40 ? vn : 40; if (vn > T.wallBounceMin * 2 && bonkV < vn) { bonkV = vn; bonkY = yi; bonkX = WALL; } if (vn > ctV && !heldMask[i]) { ctV = vn; ctK = 5; ctNx = -1; ctNy = 0; ctX = WALL; ctY = yi; ctI = i; ctTan = Math.abs(yi - py[i]) * invDt; } }
        xi = WALL - ri; hit = true;
        if (vn > T.wallBounceMin) px[i] = xi + T.leapBounce * vn / invDt;
      }
      if (hit && yi <= ri + 1e-3) { xi -= (xi - px[i]) * fric; }
      x[i] = xi; y[i] = yi;
    }
    };

    for (let it = 0; it < iters; it++) {
      // held nodes are pulled to the finger first; the constraints then make the rest of him follow
      for (let k = 0; k < cat.grabs.length; k++) {
        const gr = cat.grabs[k], i = gr.node;
        const gk = T.grabK * gr.k;
        x[i] += (gr.fx + gr.ox - x[i]) * gk; y[i] += (gr.fy + gr.oy - y[i]) * gk;
        const dx = x[i] - px[i], dy = y[i] - py[i], s2 = dx * dx + dy * dy, m = T.grabMaxStep * gr.k;
        if (s2 > m * m) { const s = m / Math.sqrt(s2); x[i] = px[i] + dx * s; y[i] = py[i] + dy * s; }
      }
      // distance constraints (spine compliant, bend, tail, legs)
      for (let c = 0; c < nC; c++) {
        const a = Ca[c], b = Cb[c];
        let dx = x[b] - x[a], dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        let tgt = d + (Crest[c] - d) * Ck[c];
        const lo = Clo[c], hi = Chi[c];
        if (tgt < lo) tgt = lo; else if (tgt > hi) tgt = hi;
        const e = d - tgt;
        if (e === 0) continue;
        const wa = invMass[a], wb = invMass[b], s = e / (d * (wa + wb));
        x[a] += dx * s * wa; y[a] += dy * s * wa; x[b] -= dx * s * wb; y[b] -= dy * s * wb;
      }
      for (let c = nC - 2; c >= spineC0; c--) { // spine again, backwards: limits propagate from either end
        const a = Ca[c], b = Cb[c];
        const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        let tgt = d + (Crest[c] - d) * Ck[c];
        if (tgt < Clo[c]) tgt = Clo[c]; else if (tgt > Chi[c]) tgt = Chi[c];
        const e = d - tgt;
        if (e === 0) continue;
        const wa = invMass[a], wb = invMass[b], s = e / (d * (wa + wb));
        x[a] += dx * s * wa; y[a] += dy * s * wa; x[b] -= dx * s * wb; y[b] -= dy * s * wb;
      }
      // legs: shoulder/hip anchor -> knee
      for (let l = 0; l < NL; l++) {
        const att = LEG_ATTACH[l], kn = knee(l), a = att - 1, b = att + 1;
        let tx = x[a] - x[b], ty = y[a] - y[b];
        const len = hyp(tx, ty) || 1; tx /= len; ty /= len;
        const o = r[att] * T.legOffset * cat.side, axp = x[att] - ty * o, ayp = y[att] + tx * o;
        const dx = x[kn] - axp, dy = y[kn] - ayp, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const e = d - legLen[l], wk = invMass[kn], ws = invMass[att], sc = e / (d * (wk + ws));
        x[kn] -= dx * sc * wk; y[kn] -= dy * sc * wk; x[att] += dx * sc * ws; y[att] += dy * sc * ws;
      }
      // self collision (every other iteration is plenty, and the interpreter on a phone pays for every pair)
      if ((it & 1) === 0 || it === iters - 1) for (let p = 0; p < nS; p++) {
        const a = Sa[p], b = Sb[p];
        const dx = x[b] - x[a], dy = y[b] - y[a], m = (b - a === 3 ? self3 : selfR) * (r[a] + r[b]);
        const d2 = dx * dx + dy * dy;
        if (d2 >= m * m) continue;
        const d = Math.sqrt(d2) || 1e-6, s = 0.5 * (m - d) / d;
        x[a] -= dx * s; y[a] -= dy * s; x[b] += dx * s; y[b] += dy * s;
      }
      if (poseOn && (it & 1)) { // muscle tone: pull toward the pose, then the contacts (walls and floor still win)
        let mx = 0, my = 0;
        for (let i = 0; i < N; i++) {
          if (heldMask[i]) continue;
          const k = pk * pullW[i];
          let dx = gx[i] - x[i], dy = gy[i] - y[i];
          if (pcap > 0) { const d2 = dx * dx + dy * dy; if (d2 > pcap * pcap) { const q = pcap / Math.sqrt(d2); dx *= q; dy *= q; } }
          x[i] += dx * k; y[i] += dy * k; mx += massW[i] * dx * k; my += massW[i] * dy * k;
        }
        if (freeFall) { mx *= invTotalMass; my *= invTotalMass; for (let i = 0; i < N; i++) { x[i] -= mx; y[i] -= my; } } // in the air the pull is internal: it never moves his centre of mass
      }
      if (tuck && (it & 1)) { // a part still outside: reel it in over the rim (and nudge the rest of him toward the middle so nothing is taut)
        for (let i = 4; i < K; i++) x[i] += (ox - x[i]) * T.tuckCentre;
        for (let i = 0; i < N; i++) {
          if (inside[i] || heldMask[i]) continue;
          const k = i < K ? tuckK * 0.6 : tuckK;
          x[i] += (tgx[i] - x[i]) * k; y[i] += (tgy[i] - y[i]) * k;
        }
      }
      if (it & 1) collide(it); // contacts every other iteration; the constraints in between settle the chain
    }
    // hard limits: alternate limit-only sweeps with a contact pass, so a limit fix never leaves a node inside a wall
    for (let pass = 0; pass < 8; pass++) {
      moved = false;
      for (let c = spineC0; c < nC; c++) limitPass(c);
      for (let c = nC - 1; c >= spineC0; c--) limitPass(c);
      if (!moved && pass) break;
      collide(iters);
    }
    // last line of defence: nothing may end the step on the far side of a wall from where it started
    for (let i = 0; i < N; i++) {
      const nn = nearN[i], base = i * MAXC;
      for (let q = 0; q < nn; q++) {
        const o = near[base + q] * 6, ax = cap[o], ay = cap[o + 1], ex = cap[o + 2], ey = cap[o + 3];
        const s1 = ex * (sy0[i] - ay) - ey * (sx0[i] - ax), s2 = ex * (y[i] - ay) - ey * (x[i] - ax);
        if (s1 * s2 >= 0) continue;
        const t = s1 / (s1 - s2), mx = sx0[i] + (x[i] - sx0[i]) * t, my = sy0[i] + (y[i] - sy0[i]) * t;
        const u = ((mx - ax) * ex + (my - ay) * ey) * cap[o + 4];
        if (u < -0.02 || u > 1.02) continue;
        const l = Math.sqrt(ex * ex + ey * ey) || 1, sg = s1 > 0 ? 1 : -1, R = r[i] + cap[o + 5] + slop;
        x[i] = mx - sg * (ey / l) * R; y[i] = my + sg * (ex / l) * R;
      }
    }
    cat.impact += impact;
    if (ctV > T.impactEventMin) { // one primary impact per landing; a later, different body part arriving within a moment is a secondary one
      const part = ctI <= 1 ? 'head' : ctI <= 5 ? 'chest' : ctI <= HIPS ? 'hips' : ctI < LEG0 ? 'tail' : 'paws', since = cat.time - IMP.at;
      if (since > T.impactGap || (ctK !== IMP.k && since > 0.03) || ctV > IMP.v * 1.5) {
        const sec = since <= T.impactGap && part !== IMP.part;
        IMP.at = cat.time; IMP.v = ctV; IMP.k = ctK; IMP.part = part;
        if (cat.impacts.length < 16) cat.impacts.push({ kind: IMP_KINDS[ctK], x: ctX, y: ctY, nx: ctNx, ny: ctNy, speed: ctV, tan: ctTan, tanSign: M.vxc >= 0 ? 1 : -1, part, secondary: sec, t: cat.time });
      }
    }
    if (bonkV > 14) M.lickQueue = Math.max(M.lickQueue, 1.5); // "I meant to do that"
    if (bonkV > 0) { cat.evData.bonkX = bonkX; cat.evData.bonkY = bonkY; cat.evData.bonkV = bonkV; ev('bonk'); }
    if (cushV > 0) cushionBounce(cushV, cushNx, cushNy, cushG, dt);
    if (contHit && M.leaping) ev('rim');
    { let sv = 0; for (let i = 0; i < K; i++) sv += y[i] - py[i]; M.comVy2 = M.comVy1; M.comVy1 = M.comVy; M.comVy = sv / K / dt; }
    updateStats(dt);
  }

  function updateStats(dt) {
    updateAnchors();
    let mx = 0, mn = 1e9;
    for (let i = 0; i < K - 1; i++) { const d = hyp(x[i + 1] - x[i], y[i + 1] - y[i]) / L0; if (d > mx) mx = d; if (d < mn) mn = d; }
    cat.stretch = mx; cat.squash = mn;
    // the finger loses its grip while he is stretched or squashed past the hard limits (he is stuck on something)
    const over = mx > T.spineMax * 1.15 || mn < T.spineMin * 0.85;
    for (const gr of cat.grabs) gr.k = over ? Math.max(0.3, gr.k * 0.92) : Math.min(1, gr.k + 0.05);
    let ke = 0;
    for (let i = 0; i < K; i++) { const vx = (x[i] - px[i]) / dt, vy = (y[i] - py[i]) / dt; ke += vx * vx + vy * vy; }
    cat.ke = 0.5 * ke / K;
    const h = cat.head;
    h.x = x[0]; h.y = y[0]; h.vx = (x[0] - px[0]) / dt; h.vy = (y[0] - py[0]) / dt;
    const a = Math.atan2(y[0] - y[1], x[0] - x[1]);
    let da = a - h.angle; da = Math.atan2(Math.sin(da), Math.cos(da));
    h.angle += da * (1 - Math.exp(-14 * dt));
    // annoyance
    let sh = 0;
    for (const gr of cat.grabs) {
      const i = gr.node, vx = (x[i] - px[i]) / dt, vy = (y[i] - py[i]) / dt;
      const a2 = hyp(vx - gr.pvx, vy - gr.pvy) / dt; gr.pvx = vx; gr.pvy = vy;
      if (a2 > sh) sh = a2;
    }
    shake += (sh - shake) * Math.min(1, 8 * dt);
    if (cat.relaxed) cat.annoyance = Math.max(0, cat.annoyance - dt * 2);
    else {
      const inc = Math.max(Math.min(1, Math.max(0, cat.stretch - T.annoyStretch) / 0.7), Math.min(1, Math.max(0, T.annoySquash - cat.squash) / 0.25), Math.min(1, Math.max(0, shake - T.annoyShake) / T.annoyShake));
      cat.annoyance = Math.min(1, Math.max(0, cat.annoyance + (inc * T.annoyUp - T.annoyDecay) * dt));
    }
  }

  // ---------------------------------------------------------------- fit
  function computeFit() {
    if (!interior) return 0;
    let inA = 0, outN = 0;
    const L = cat.spill.left, R = cat.spill.right;
    L.n = R.n = 0; L.x = L.y = R.x = R.y = 0;
    for (let i = 0; i < N; i++) wasIn[i] = inside[i];
    for (let i = 0; i < N; i++) {
      const xi = x[i], yi = y[i];
      const ins = pointInPolygon(interior, xi - ox, yi - oy) || (yi >= rimY && Math.abs(xi - ox) < rimHalf && yi <= rimY + T.fitHeadroom);
      inside[i] = ins ? 1 : 0;
      if (ins) inA += area[i];
      else { outN++; const S = xi < ox ? L : R; S.n++; S.x += xi; S.y += yi; }
    }
    if (M.tuck > 0) for (let i = K; i < N; i++) if (inside[i] && !wasIn[i]) ev('tuck'); // a loose part went in
    if (L.n) { L.x /= L.n; L.y /= L.n; }
    if (R.n) { R.x /= R.n; R.y /= R.n; }
    // names
    const out = [];
    let paws = 0, pawA = 0;
    for (const g of GROUPS) {
      let oa = 0;
      for (const i of g.nodes) if (!inside[i]) oa += area[i];
      if (oa <= 0) continue;
      if (g.name === 'paw') { paws++; pawA += oa; } else out.push({ name: g.name, a: oa });
    }
    if (paws) out.push({ name: PAW_WORDS[paws], a: pawA });
    out.sort((a, b) => b.a - a.a);
    cat.spillNames = out.map((o) => o.name);
    cat.outN = outN;
    cat.fit = outN === 0 ? 1 : inA / totalArea;
    M.fitT = cat.time;
    return cat.fit;
  }
  const fitPct = (frac) => (frac >= 1 ? 100 : Math.min(99, Math.floor(frac * 100)));
  const isSettled = () => cat.ke < T.settleKE;

  // snap him straight into a pose on the table (debug and the pose contact sheet)
  function snap(name, cx = 0, facing = 1) { spawn(cx, 0, { pose: name, dir: facing }); M.forced = name; M.tone = T.toneGround; cat.tone = M.tone; cat.mode = 'ground'; M.groundT = 1; for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; } }
  function setPose(name) { M.forced = name || null; if (name) { M.rest = name; } }
  function attend(wx, wy) { M.att.x = wx; M.att.y = wy; M.att.t = 0.25; }
  function noteTouch(wx, wy) { const t = M.lastTouch; t.x = wx; t.y = wy; t.ok = true; t.t = cat.time; }
  function poseExtent(name, facing = 1, withTail = false) { // x extent of a pose (body and legs, and the tail if asked) relative to the hips, for the facing given
    const P = POSES[name]; let lo = 1e9, hi = -1e9;
    for (let i = 0; i < N; i++) { if (!withTail && i >= TAIL0 && i < LEG0) continue; const a = facing * P[2 * i]; if (a - r0[i] < lo) lo = a - r0[i]; if (a + r0[i] > hi) hi = a + r0[i]; }
    return { lo, hi };
  }
  // Start of an attempt: he drops a little way, onto the table beside the container if there is room for him to sit there
  // (the play area is x in [-5, 5]; the side with more room), otherwise onto the top of the container, facing it. He lands, sits,
  // looks at the container, then at the player.
  function spawnStart(opts = {}) {
    const R = (def ? outerRimR : 1) + 0.25, W = T.roomHalfW - 0.05, best = { slack: -1e9, x0: 0, f: 1 };
    for (const side of [-1, 1]) {
      const f = -side, e = poseExtent('sit', f);
      let x0, slack;
      if (side > 0) { const lo = R - e.lo, hi = W - e.hi; slack = hi - lo; x0 = lo + Math.min(0.3, Math.max(0, slack) / 2); }
      else { const hi = -R - e.hi, lo = -W - e.lo; slack = hi - lo; x0 = hi - Math.min(0.3, Math.max(0, slack) / 2); }
      if (slack > best.slack + 1e-6 || (Math.abs(slack - best.slack) <= 1e-6 && rnd() < 0.5)) { best.slack = slack; best.x0 = x0; best.f = f; }
    }
    if (best.slack >= 0 || !def) spawn(best.x0, T.dropHeight, { pose: 'sit', dir: best.f, intro: true });
    else {
      const side = opts.side ?? (rnd() < 0.5 ? -1 : 1);
      spawn(side * (outerRimR + T.rimSitOffset) + (rnd() - 0.5) * 0.3, rimY + T.rimSitHeight, { pose: 'sit', dir: -side, intro: true });
    }
    return best.slack >= 0 || !def ? 'table' : 'rim';
  }
  // Whole-state snapshot (solver, tests): everything that step() reads and writes.
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function snapshot() {
    return {
      x: x.slice(), y: y.slice(), px: px.slice(), py: py.slice(), r: r.slice(), inside: inside.slice(), supp: supp.slice(), suppLast: suppLast.slice(), suppF: suppF.slice(), suppFLast: suppFLast.slice(), an: clone(AN), fz: clone(FZ), kk: clone(KK), rs,
      poseCur: poseCur.slice(), poseFrom: poseFrom.slice(), legLen: legLen.slice(), legFrom: legFrom.slice(),
      M: clone(M), sc: [lastDt, wT, wNext, wPhase, wScale, shake, sideT, tailPhase],
      c: clone({ mode: cat.mode, mood: cat.mood, gaze: cat.gaze, annoyance: cat.annoyance, ke: cat.ke, impact: cat.impact, stretch: cat.stretch, squash: cat.squash,
        relaxed: cat.relaxed, time: cat.time, side: cat.side, facing: cat.facing, tone: cat.tone, poseName: cat.poseName, resid: cat.resid, landed: cat.landed,
        fit: cat.fit, outN: cat.outN, aimS: cat.aimS, head: cat.head, spill: cat.spill, spillNames: cat.spillNames, blinks: cat.blinks || 0 }),
    };
  }
  function restore(S) {
    x.set(S.x); y.set(S.y); px.set(S.px); py.set(S.py); r.set(S.r); inside.set(S.inside); wasIn.set(S.inside); supp.set(S.supp); suppLast.set(S.suppLast); suppF.set(S.suppF); suppFLast.set(S.suppFLast); Object.assign(AN, clone(S.an)); Object.assign(FZ, clone(S.fz)); Object.assign(KK, clone(S.kk)); rs = S.rs;
    poseCur.set(S.poseCur); poseFrom.set(S.poseFrom); legLen.set(S.legLen); legFrom.set(S.legFrom);
    const m = clone(S.M); for (const k in m) M[k] = m[k];
    [lastDt, wT, wNext, wPhase, wScale, shake, sideT, tailPhase] = S.sc;
    const c = clone(S.c);
    for (const k in c) { if (k === 'gaze' || k === 'head' || k === 'spill') Object.assign(cat[k], c[k]); else cat[k] = c[k]; }
    cat.events.length = 0; cat.grabs.length = 0; updateAnchors();
  }

  // ---------------------------------------------------------------- pounce
  function aim(dx, dy) { // the pull vector (start of the touch minus the finger) = the direction he will leap
    M.aim.dx = dx; M.aim.dy = dy;
    M.aimTarget = Math.min(1, hyp(dx, dy) / T.pullMax);
    if (!M.aim.on) { M.aim.on = true; M.aimT = 0; M.pending = null; M.intro = 0; }
    const want = dx > 0 ? 1 : -1;
    if (AN.on) { // planted: the feet are locked; the turn mirrors about the contact centre
      plant();
      if (!AN.flipping && want !== M.facing && Math.abs(dx) > T.turnHyst) startAnFlip(want);
    } else if (!FZ.on && !M.flip && want !== M.facing && Math.abs(dx) > T.turnHyst) startFlip(want);
  }
  function endAim() { M.aim.on = false; M.aimT = 0; M.pending = null; AN.planted = false; }
  function doLeap(vx, vy) {
    M.bounceN = 0;
    unfreeze(); if (KK.on) { KK.on = false; M.aimS = 0; }
    if (AN.on) for (let i = 0; i < N; i++) y[i] += T.launchHop; // (a hop's worth clear of the floor, so a flat shot does not scrape it; the preview starts that much higher)
    disengage();
    depenetrate(6); // (the stretched wind-up pose may reach into a container's fence or a wall: he leaves from a clear position, not through it)
    M.aim.on = false; M.aimT = 0; M.aimS = 0; cat.aimS = 0; AN.planted = false;
    const d = 1 / 60;
    for (let i = 0; i < N; i++) {
      const front = i <= 5 || (i >= LEG0 && i < LEG0 + 4), k = (front ? T.leapFront : T.leapHind) / launchNorm(); // (normalised: his mass leaves at exactly the speed asked for)
      px[i] = x[i] - vx * k * d; py[i] = y[i] - vy * k * d;
    }
    M.pours = 0; M.leaping = true; M.leapT = T.leapAirTime; M.airT = 1; M.groundT = 0; M.pourT = 0; M.tuck = 0; M.stuck = false;
    M.comVy = M.comVy1 = M.comVy2 = vy; M.vxc = vx; M.vyc = vy; M.crouchT = 0; M.crouch = 0; M.splat = 0; M.splatT = 0;
    M.dropped = false; M.dropT = 0; M.startled = false; M.leapAge = 0;
    wT = -1; M.squirm = false; cat.gaze.on = false; M.lookT = 0; cat.mode = 'air';
    ev('leap');
  }
  function leap(vx, vy) {
    if (KK.on) { M.flip = 0; M.pending = null; doLeap(vx, vy); return true; } // (hanging on a toy: no turning round first)
    if (M.flip || AN.flipping) { M.pending = [vx, vy]; return true; }
    doLeap(vx, vy);
    return true;
  }
  // DROP: in the air after a leap: the sideways speed dies, he snaps into a vertical long-cat dive and is kicked downward
  function drop() {
    if (!(M.leaping && cat.mode === 'air') || M.dropped || M.flip) return false;
    M.dropped = true; M.dropT = T.dropDampTime; M.dive = true;
    for (let i = 0; i < N; i++) py[i] += T.dropKick / 60;
    M.vyc -= T.dropKick; M.comVy -= T.dropKick; M.comVy1 -= T.dropKick; M.comVy2 -= T.dropKick;
    ev('drop');
    return true;
  }
  // STARTLED (a cucumber): straight up, about 1.15 x the highest leap, a little sideways away from the cucumber; only DROP can steer him
  function startle(away = 0) {
    M.bounceN = 0;
    unfreeze();
    if (AN.on) for (let i = 0; i < N; i++) y[i] += 0.1;
    disengage();
    M.aim.on = false; M.aimT = 0; M.aimS = 0; cat.aimS = 0; M.pending = null; M.flip = 0;
    const vy = T.leapSpeedMax * Math.sqrt(T.startleHeight), vx = away * T.startleDrift, d = 1 / 60;
    for (let i = 0; i < N; i++) { px[i] = x[i] - vx * d; py[i] = y[i] - vy * d; }
    M.pours = 0; M.leaping = true; M.leapT = T.leapAirTime; M.airT = 1; M.groundT = 0; M.pourT = 0; M.tuck = 0; M.stuck = false;
    M.comVy = M.comVy1 = M.comVy2 = vy; M.vxc = vx; M.vyc = vy; M.crouchT = 0; M.crouch = 0; M.splat = 0; M.splatT = 0;
    M.dropped = false; M.dropT = 0; M.startled = true; M.leapAge = 0;
    wT = -1; M.squirm = false; cat.gaze.on = false; M.lookT = 0; cat.mode = 'air';
    ev('startle');
  }
  // landed on a cushion fast enough: he is thrown back along the surface normal with 0.85 of the incoming speed (same leap)
  function cushionBounce(v, nx, ny, g, dt) {
    if (M.bounceCool > 0 || M.bounceN >= T.cushionBounces) return; // (after a couple of boings he just sits on it)
    M.bounceN++;
    const vinCom = -(M.vxc * nx + M.vyc * ny); // (the whole of him, as he arrived: the contact only saw the first part of him land)
    const vin = Math.min(Math.max(v, vinCom), T.cushionCap), vout = T.cushionRest * vin * (1 - 0.15 * (M.bounceN - 1));
    let un = 0; for (let i = 0; i < N; i++) un += ((x[i] - px[i]) * nx + (y[i] - py[i]) * ny) / dt; un /= N;
    const dv = vout - un;
    for (let i = 0; i < N; i++) { px[i] -= nx * dv * dt; py[i] -= ny * dv * dt; }
    M.leaping = true; M.leapT = 0.15; M.bounceCool = 0.15; M.dropped = false; M.dropT = 0; M.crouchT = 0; M.splat = 0; M.splatT = 0;
    M.vxc += nx * dv; M.vyc += ny * dv; cat.mode = 'air'; M.groundT = 0; M.airT = 1;
    cat.evData.cushion = grpRef[g]; cat.evData.boing = vin; ev('boing');
  }
  // the launch point: where his mass is (the point that flies the ballistic arc the aim preview draws)
  const massW = new Float32Array(N); let totalMass = 0; for (let i = 0; i < N; i++) { massW[i] = 1 / baseInv[i]; totalMass += massW[i]; } const invTotalMass = 1 / totalMass;
  function launchNorm() { // the mass-weighted mean of the front/hind launch factors
    let a = 0, w = 0;
    for (let i = 0; i < N; i++) { const front = i <= 5 || (i >= LEG0 && i < LEG0 + 4); a += massW[i] * (front ? T.leapFront : T.leapHind); w += massW[i]; }
    return a / w;
  }
  function launchPoint(out = {}) {
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < N; i++) { sx += massW[i] * x[i]; sy += massW[i] * y[i]; sw += massW[i]; }
    out.x = sx / sw; out.y = sy / sw; return out;
  }
  function squirm() { startWriggle(T.squirm); M.squirm = true; ev('squirm'); }
  // place him sitting on a surface: x is the middle of him, y the height of the surface
  function spawnAt(cx, surfaceY, facing = 1, opts = {}) {
    const e = poseExtent('sit', facing, true), W = T.roomHalfW - 0.05; // (the tail too: it trails behind him, and a tail through a wall would shove him sideways)
    let x0 = cx - (e.lo + e.hi) / 2;
    if (x0 + e.lo < -W) x0 = -W - e.lo; else if (x0 + e.hi > W) x0 = W - e.hi;
    spawn(x0, surfaceY + 0.02, { pose: 'sit', dir: facing, intro: true, clear: false, seed: opts.seed });
    // posed on his spot from the first step: no settling, no shuffle
    let code = 30000;
    if (surfaceY > 0.01) { // which shelf or cushion is he on?
      code = 0;
      plats: for (let g = 0; g < nGrp; g++) {
        if (grpKind[g] === 1) { const p = platforms[grpRef[g]]; if (Math.abs(p.y - surfaceY) < 0.06 && x0 > p.x - p.w / 2 - 0.5 && x0 < p.x + p.w / 2 + 0.5) { code = g + 1; break plats; } }
        else if (grpKind[g] === 2) { const c = cushions[grpRef[g]]; if (Math.abs(c.y + T.cushionH - surfaceY) < 0.06 && x0 > c.x - c.w / 2 && x0 < c.x + c.w / 2) { code = g + 1; break plats; } }
      }
    }
    if (code) { const S = surfaceOf(code); engage(x0, { y: surfaceY, lo: S.lo, hi: S.hi }, true); }
    else engage(x0, { y: surfaceY, lo: -1e3, hi: 1e3 }, true); // (hovering: no support to check)
  }
  Object.assign(cat, {
    aim, endAim, leap, squirm, spawnAt, depenetrate, snapshot, restore, plant, drop, startle, launchPoint, moveContainer, carry, tryEngage, freezeNow, unfreeze, kickStart, kickEnd, cancelLick, startLick,
    snap, setPose, noteTouch, attend, poseExtent, spawnStart, takeBlinks() { const b = M.blinks; M.blinks = 0; return b; }, M,
    setContainer, clearContainer, spawn, step, beginGrab, moveGrab, endGrab, poke, setRelaxed, computeFit, fitPct, isSettled, startWriggle,
  });
  // live values (Object.assign would copy them once)
  Object.defineProperties(cat, {
    canAim: { get() { return KK.on || (cat.mode === 'ground' || cat.mode === 'contained' || (cat.mode === 'air' && !M.leaping && M.vxc * M.vxc + M.vyc * M.vyc < 36)) && M.leapT <= 0 && M.pourT <= 0 && !M.flip; } }, // (perched on a rim, flickering between ground and air, he can still be aimed)
    rimY: { get() { return rimY; } }, ox: { get() { return ox; } }, oy: { get() { return oy; } }, platforms: { get() { return platforms; } },
    world: { get() { return worldObj; } }, anchor: { get() { return AN; } }, platformsList: { get() { return platforms; } }, cushionsList: { get() { return cushions; } },
    startled: { get() { return M.startled; } }, frozen: { get() { return FZ.on; } }, kicking: { get() { return KK.on; } }, licking: { get() { return M.lickT > 0; } }, kickT: { get() { return KK.t; } }, kickToy: { get() { return KK; } }, frozenOnContainer: { get() { return FZ.on && FZ.onCont; } }, fz: { get() { return FZ; } }, dropped: { get() { return M.dropped; } }, splat: { get() { return M.splat; } }, rimHalf: { get() { return rimHalf; } }, outerRimR: { get() { return outerRimR; } }, totalArea: { get() { return totalArea; } },
  });
  return cat;
}
