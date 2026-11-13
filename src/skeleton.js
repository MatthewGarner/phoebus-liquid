// The PRESENTATION skeleton and animator. The gameplay sim (spine nodes, collisions, anchors, modes, events) is never written; this module reads it and decides what is DRAWN.
// No three/DOM imports (runs in node for simtest and the bench).
//
// Three sources for the drawn body, cross-faded (0.08-0.15 s, never popped) when the sim state changes category:
//   ground  a solid cat on a surface (anchored, or settling after a landing): the animator OWNS the whole pose (spine, pelvis, ribcage, head, tail, legs). Each key pose is five body
//           key points (designer frame: x forward, y up, the sim's ground anchor at x = 0) plus a set of JOINT ANGLES per limb; poses blend (stand / sit / loaf / crouch by pull
//           power). The angles give each foot's home (forward kinematics); feet are PLANTED in the world and move only by steps. A planted foot is held by a minimal correction of
//           the two proximal joints (shoulder + elbow, hip + knee) that keeps the authored distal angles (paw, metatarsus, toes) and never flips the bend side; a foot out of reach
//           lowers the body instead of overstretching the leg.
//   flight  in the air: the body follows the sim's centroid and orientation; the SHAPE and the limbs come from the flight clips (extended ascent, tucked apex, reaching descent),
//           pure joint angles in the body frame, blended toward the sim's real spine in proportion to how deformed the sim is by contacts (cat.resid).
//   sim     everything else (frozen perches, containers, liquid states): today's drawing from the sim, with the anatomical legs solved from its paws.
//
// Angles (designer frame, degrees in the tables): the proximal segment's direction is measured from straight DOWN, + = swung forward; each further joint is the rotation from the
// segment above it, + = counter-clockwise when he faces right. Front: shoulder, elbow (+: the elbow points back), wrist. Hind: hip, knee (-: the knee points forward), hock (+), toes.
import { K, HIPS, TAIL0, LEG0, N, paw } from './cat.js';

export const PROP = {
  BL: 5.9,                                  // world units, nose to rump as drawn
  front: { hum: 0.18, fore: 0.20, paw: 0.075 },
  hind: { fem: 0.175, tib: 0.195, meta: 0.125, toe: 0.05 },
  tail: 0.62,
  standShoulder: 0.52, standHips: 0.57,     // heights (top of the back), in BL: the hips a little above the shoulders
  // tapered round-cone radii (world units): the thigh is part of the body mass, the shin slimmer, the foot long and narrow; the forearm a column with the white sock
  rad: { hum: 0.40, humEnd: 0.27, fore: 0.25, foreEnd: 0.19, paw: 0.20, pawEnd: 0.21, fem: 0.60, femEnd: 0.27, tib: 0.22, tibEnd: 0.145, meta: 0.15, metaEnd: 0.15, toe: 0.17, toeEnd: 0.14, sock: 0.025 },
};
// joint limits, in radians. Elbow, wrist, knee, hock: the INTERIOR angle between the two bones (pi = straight). Shoulder: the humerus's angle from the body's down direction (+ = swung
// back). Hip: the femur's angle from the body's down direction (+ = swung forward).
export const LIM = { elbow: [0.35, 3.05], knee: [0.45, 3.0], hock: [0.22, 3.0], wrist: [1.5, 3.1], shoulder: [-2.8, 2.8], hip: [-2.2, 2.8] };
const LIMS = { elbow: [0.38, 3.0], knee: [0.48, 2.95], hock: [0.25, 2.97], wrist: [1.53, 3.07] }; // (what the solver holds to: a hair inside the limits)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180, PI = Math.PI, HPI = Math.PI / 2;
const BL = PROP.BL;
export const LEN = {
  hum: PROP.front.hum * BL, fore: PROP.front.fore * BL, paw: PROP.front.paw * BL,
  fem: PROP.hind.fem * BL, tib: PROP.hind.tib * BL, meta: PROP.hind.meta * BL, toe: PROP.hind.toe * BL, tail: PROP.tail * BL,
};
const LL = Float32Array.from([LEN.hum, LEN.fore, LEN.paw, 0, LEN.hum, LEN.fore, LEN.paw, 0, LEN.fem, LEN.tib, LEN.meta, LEN.toe, LEN.fem, LEN.tib, LEN.meta, LEN.toe]);
const dAt = (l1, l2, th) => Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(th));
const DMIN = Float32Array.from([0, 1, 2, 3].map((l) => (l < 2 ? dAt(LEN.hum, LEN.fore, LIMS.elbow[0] + 0.01) : dAt(LEN.fem, LEN.tib, LIMS.knee[0] + 0.01))));
const DMAX = Float32Array.from([0, 1, 2, 3].map((l) => (l < 2 ? dAt(LEN.hum, LEN.fore, LIMS.elbow[1] - 0.01) : dAt(LEN.fem, LEN.tib, LIMS.knee[1] - 0.01))));
export const RB = [0.80, 0.66, 0.70, 0.72, 0.72, 0.72, 0.64, 0.54, 0.48, 0.54, 0.62, 0.62, 0.56]; // drawn spine radii: head, neck, shoulders, deep chest, tucked waist, muscular haunch
export const RT = [0.40, 0.34, 0.28, 0.23, 0.19, 0.17];                                             // tail
const PAW_R = 0.22;                                                                                // the foot's centre sits this high above the surface
const NODE_T = [4, 3.5, 3, 2.5, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25, 0];                       // node i (0 head .. 12 hips) -> spline parameter through the 5 key points (hips, waist, shoulders, neck, head)
const SH_UP = 0.30, HIP_DN = 0.12, HIP_BK = 0.10, FAR_SH = 0.30;                                   // where the shoulder and hip joints sit relative to spine nodes 4 and 11; far legs' offset along the spine

// a Catmull-Rom spine through the five key points (hips, waist, shoulders, neck, head) -> nodes 0..12
const splineK = (KX, KY, ox, oy) => {
  for (let n = 0; n < 13; n++) {
    const t = NODE_T[n], i = Math.min(3, Math.floor(t)), u = t - i, u2 = u * u, u3 = u2 * u, i0 = i - 1, i3 = i + 2;
    for (let c = 0; c < 2; c++) {
      const P = c ? KY : KX, p1 = P[i], p2 = P[i + 1], p0 = i0 >= 0 ? P[i0] : 2 * P[0] - P[1], p3 = i3 <= 4 ? P[i3] : 2 * P[4] - P[3];
      const v = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
      if (c) oy[n] = v; else ox[n] = v;
    }
  }
};

// ---- the ground poses (designer frame; x forward, y up from the surface)
// 0-9 key points: hips(node 12) waist(8) shoulders(4) neck base(2) head(0); 10-12 front shoulder, elbow, wrist; 13-16 hind hip, knee, hock, toes (degrees);
// 17 far front extra shoulder swing, 18 far hind extra hip swing; 19-22 tail heading keys (deg above horizontal, 0 = straight back, 90 = up); 23 tail curl
const NPV = 24;
const IH = 0, IM = 2, IS = 4, IN = 6, IHD = 8, IQF = 10, IQH = 13, IFF = 17, IFH = 18, ITAIL = 19, ICURL = 23;
const mkPose = (k, F, H, farF, farH, tail, curl) => Float32Array.from([...k, ...F, ...H, farF, farH, ...tail, curl]);
//   stand: the front leg a column under the shoulder (upper arm down and back, elbow 140 close under the chest, forearm near vertical); the hind leg the cat's Z: thigh forward-down
//          to the knee at the belly line, shin back-down to the hock (held 0.15 BL off the floor, behind the toes), the long foot down and forward, toes flat
const P_STAND = mkPose([0, 2.75, 1.45, 2.55, 2.95, 2.42, 3.75, 2.70, 4.55, 3.05], [-30, 40, 14], [48, -76, 58, 58], 7, -9, [22, 40, 55, 62], 0.5);
//   sit:   rump down, back ~60 degrees up, front legs straight columns, hind legs folded flat (knee ~33, hock ~42, the foot flat on the floor), head above the front paws
const P_SIT = mkPose([-0.45, 0.85, 0.15, 1.80, 0.80, 2.80, 0.95, 3.45, 1.15, 4.05], [-6, 14, 6], [97, -147, 138, 2], 3, -3, [-25, -70, -160, -178], 0);
//   loaf:  lying on folded legs, front paws tucked under the chest
const P_LOAF = mkPose([-0.80, 1.0, 0.55, 1.10, 1.80, 1.05, 2.55, 1.45, 3.28, 1.85], [-62, 142, -62], [97, -147, 138, 2], 0, 0, [4, 8, 12, 16], 0.1);
//   crouch (full power): the pre-pounce. Rear UP and loaded (the rump the highest point, ~0.5 BL), hind legs tightly folded with the hocks low and the feet planted just ahead
//          of the hips, the thigh bulging; the spine a gentle S down to low shoulders (~0.3 BL); chest near the floor, elbows tucked back beside the ribs, forearms angled
//          forward to paws a little ahead of the shoulders; neck stretched forward and low, the head level with the chin just above the paws
const P_CROUCH = mkPose([-0.55, 2.4, 0.95, 2.0, 2.40, 1.1, 3.20, 1.15, 3.95, 1.2], [-80, 122, 37], [33, -91, 123, 25], 5, -6, [4, 6, 10, 16], 0.25);
const GRP_HIND = new Uint8Array(NPV); for (const i of [0, 1, 2, 3, 13, 14, 15, 16, 18]) GRP_HIND[i] = 1; // the hindquarters (they lower first when he sits, rise last)

// the joint positions a pose puts each foot at, from its key points: lift / lower the shoulders and the hips so the feet of every authored pose stand exactly on the floor
const fkDrop = (P, i0, n, lens) => { let a = -HPI, y = 0; for (let k = 0; k < n; k++) { a += P[i0 + k] * D2R; y += Math.sin(a) * lens[k]; } return y; };
const fitPose = (P) => {
  const kx = new Float64Array(5), ky = new Float64Array(5), dx = new Float64Array(13), dy = new Float64Array(13);
  for (let it = 0; it < 6; it++) {
    for (let k = 0; k < 5; k++) { kx[k] = P[k * 2]; ky[k] = P[k * 2 + 1]; }
    splineK(kx, ky, dx, dy);
    let tx = dx[3] - dx[5], ty = dy[3] - dy[5], tl = Math.hypot(tx, ty) || 1;
    const jF = dy[4] + (tx / tl) * SH_UP, dF = PAW_R - (jF + fkDrop(P, IQF, 3, [LEN.hum, LEN.fore, LEN.paw]));
    tx = dx[10] - dx[12]; ty = dy[10] - dy[12]; tl = Math.hypot(tx, ty) || 1;
    const jH = dy[11] - (tx / tl) * HIP_DN - (ty / tl) * HIP_BK, dH = PAW_R - (jH + fkDrop(P, IQH, 3, [LEN.fem, LEN.tib, LEN.meta]));
    P[IS + 1] += dF; P[IN + 1] += dF; P[IHD + 1] += dF; P[IH + 1] += dH; P[IM + 1] += 0.5 * (dF + dH);
  }
};
fitPose(P_STAND); fitPose(P_SIT); fitPose(P_LOAF); fitPose(P_CROUCH);

// the flight clips: joint angles in the BODY frame (down = the belly side), degrees. [front shoulder, elbow, wrist, -, hind hip, knee, hock, toes]
const FQ = {
  asc:  [88, 16, 4, 0, -96, -16, 18, 6],      // ascent: front legs reaching ahead of the nose along the line of flight (elbow ~165); hind legs trailing straight back (knee, hock ~165)
  apx:  [32, 42, -52, 0, 58, -118, 112, 30],  // apex: hind legs tucked under the belly (knee, hock ~60); front legs relaxed forward and down below the chest, paws curled
  desc: [66, 14, 12, 0, 34, -80, 74, 38],     // descent: front legs reaching ahead and down for the landing; hind legs swinging forward under him
};
for (const k in FQ) FQ[k] = Float32Array.from(FQ[k].map((v) => v * D2R));
const FAR_FL = [-9 * D2R, 0, 9 * D2R]; // flight: the far front / hind legs swing this much more (asc, apx, desc) so the pair reads as two legs

// the gait: lateral sequence LH, LF, RH, RF. Legs: 0 near front (LF), 1 far front (RF), 2 near hind (LH), 3 far hind (RH)
const GAIT_OFF = [0.75, 0.25, 0.0, 0.5]; // phase offsets: touch-down at phase 0 (LH), 0.25 (LF), 0.5 (RH), 0.75 (RF)
const STEP_ORDER = [2, 0, 3, 1], LAND_ORDER = [0, 1, 2, 3];

export function createSkeleton(T) {
  const AN_ = (T && T.anim) || {};
  const stepTime = AN_.stepTime || 0.22, reachT = AN_.reachTime || 0.2, cycleT = AN_.stepCycle || 1.25, duty = AN_.stepDuty || 0.65, sitTime = AN_.sitTime || 0.5, turnTime = AN_.turnTime || 0.26, takeoffTime = AN_.takeoffTime || 0.15;
  const STRIDE = 0.42 * BL;                                          // distance covered in one gait cycle
  const S = {
    active: false, len: LEN,
    J: new Float32Array(32), tip: new Float32Array(8),                // joints per leg: front [shoulder, elbow, wrist, toes]; hind [hip, knee, hock, ball]; tip: the toes of the hind feet
    SD: new Float32Array(32),                                         // the solved segment directions per leg (4 x 2): what the cross-fades blend
    X: new Float32Array(N), Y: new Float32Array(N), R: new Float32Array(N),   // the drawn body (nodes 0..18 and, for the sim source, 19..26) before the feel layer
    FT: new Float32Array(8), FD: new Float32Array(8), FA: new Float32Array(4), // foot targets (as solved), foot directions and how airborne each foot is (the sim source)
    tail: { on: false, w: 0 }, TX: new Float32Array(6), TY: new Float32Array(6),
    head: { x: 0, y: 0, angle: 0, vx: 0, vy: 0 },
    own: 0, src: -1, phase: 'ground', clip: 'stand', swinging: null,
    earFlat: 0, earFwd: 0, whiskBack: 0, hit: 0, startle: 0,          // read by the face layer (hit: an impact reaction 0..1: ears flat, whiskers back)
    sit: 0, f: 1, slide: 0, grounded: false, surfGuess: 0,
    cmd: { walk: 0, walkTo: null, turnTo: 0, freeze: -1 },             // the lab: walk (+1 / -1 / 0), walk to an x, turn to a facing; freeze: hold the walk at this phase
    stepCount: 0,
  };
  const g = {
    init: false, f: 1, rootX: 0, surf: 0, hx: 0, raw: 0, rawLoaf: 0,
    PV: new Float32Array(NPV), PT: new Float32Array(NPV), PH: new Float32Array(NPV),
    px: new Float32Array(4), py: new Float32Array(4),                 // planted feet (world)
    sw: new Float32Array(4), swDur: new Float32Array(4), sfx: new Float32Array(4), sfy: new Float32Array(4), stx: new Float32Array(4), sty: new Float32Array(4), slift: new Float32Array(4), wait: new Float32Array(4),
    cx: new Float32Array(4), cy: new Float32Array(4), lastCx: new Float32Array(4), swing: new Uint8Array(4), swS: new Float32Array(4),
    dA3: new Float32Array(4), dA4: new Float32Array(4), C3: new Float32Array(4), S3: new Float32Array(4), C4: new Float32Array(4), S4: new Float32Array(4),               // the distal segments' directions (designer angles, radians): front paw; hind metatarsus and toes
    adapt: 0, landT: 9, landS: 0, turnOn: false, turnU: 0, turnF: 1, turnPx: 0, turnC: 1, turnW: 0, TA: new Float32Array(8),
    walkOn: false, ph: 0, ww: 0, load: new Float32Array(4),
    flick: 0, nextFlick: 3, ear: 0, earT: 2, earSide: 1, wig: 0, tread: 0, lickW: 0, aimLock: false, startle: 0, hold: 0, landDur: 0.35,
    wcS: 0, homeX: new Float32Array(4), homeR: new Float32Array(4), homeKey: -1, lagDir: 1, tm: 0, rawTargetKeep: 0, loafKeep: 0, turnMirrorX: 0,
  };
  S.swinging = g.swing;
  const fl = { startle: 0, FV: new Float32Array(10), asc: 0, apx: 1, desc: 0, init: false, wd: 0, tk: 0, ang: 0, w: 0, om: 0, lastAng: 0, hasAng: false, righting: 0, cx: 0, cy: 0, age: 9, landX: 0, landSurf: 0, landT: 1 };
  const sn = { X: new Float32Array(N), Y: new Float32Array(N), R: new Float32Array(N), FT: new Float32Array(8), SD: new Float32Array(32), axF: 0, has: false, xf: 1, dur: 0.1, legs: false };
  const NX = new Float32Array(N), NY = new Float32Array(N), NR = new Float32Array(N);
  const KX = new Float32Array(5), KY = new Float32Array(5), DX = new Float32Array(13), DY = new Float32Array(13), TLX = new Float32Array(6), TLY = new Float32Array(6);
  const AJ = new Float32Array(8), RX = new Float32Array(4), RY = new Float32Array(4), SG = new Int8Array(4), TMP = new Float32Array(8);
  const tFT = new Float32Array(8), tFD = new Float32Array(8), tFA = new Float32Array(4);
  const out = { x: 0, y: 0, ex: 0, ey: 0, reach: 0 };
  const tmp = { fx: 1, fy: 0, ux: 0, uy: 1 };

  // ---------------------------------------------------------------- helpers
  // the legacy 2-link IK (the sim source only): the middle joint of a limb from (ax, ay) to (tx, ty), bending toward (bx, by), with hysteresis so it never flips
  const side = [1, 1, 1, 1];
  const twoLink = (ax, ay, tx, ty, l1, l2, bx, by, lim, li) => {
    const dx = tx - ax, dy = ty - ay, d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
    const dd = clamp(d, Math.max(Math.abs(l1 - l2) + 0.02, lim ? dAt(l1, l2, lim[0]) : 0), lim ? dAt(l1, l2, lim[1]) : l1 + l2 - 0.005), ux = dx / d, uy = dy / d;
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    let nx = -uy, ny = ux; { const bl = Math.hypot(bx, by) || 1, dp = (nx * bx + ny * by) / bl;
      let sg = dp > 0.3 ? 1 : dp < -0.3 ? -1 : (li >= 0 ? side[li] : (dp >= 0 ? 1 : -1)); if (li >= 0) side[li] = sg; nx *= sg; ny *= sg; }
    out.x = ax + ux * a + nx * h; out.y = ay + uy * a + ny * h; out.reach = dd; out.ex = ax + ux * dd; out.ey = ay + uy * dd; return out;
  };
  S.angle = (ax, ay, jx, jy, bx, by) => { const v1x = ax - jx, v1y = ay - jy, v2x = bx - jx, v2y = by - jy; return Math.acos(clamp((v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1), -1, 1)); };
  // forward kinematics: segment directions of leg l from its joint angles in the frame (fx, fy) forward, (ux, uy) up -> A[o..o+7]
  const fk = (A, o, fx, fy, ux, uy, q0, q1, q2, q3) => {
    let a = -HPI + q0, c = Math.cos(a), s = Math.sin(a); A[o] = fx * c + ux * s; A[o + 1] = fy * c + uy * s;
    a += q1; c = Math.cos(a); s = Math.sin(a); A[o + 2] = fx * c + ux * s; A[o + 3] = fy * c + uy * s;
    a += q2; c = Math.cos(a); s = Math.sin(a); A[o + 4] = fx * c + ux * s; A[o + 5] = fy * c + uy * s;
    a += q3; c = Math.cos(a); s = Math.sin(a); A[o + 6] = fx * c + ux * s; A[o + 7] = fy * c + uy * s;
  };
  // the proximal correction: the two proximal segments of leg l from the joint (rx, ry) to (tx, ty), turning by sign sw (+1: counter-clockwise from the upper bone to the lower) -> A[o..o+3]
  const ik2 = (A, o, l, rx, ry, tx, ty, sw) => {
    const L1 = LL[l * 4], L2 = LL[l * 4 + 1];
    let dx = tx - rx, dy = ty - ry; const d0 = Math.sqrt(dx * dx + dy * dy) || 1e-4; dx /= d0; dy /= d0;
    const d = clamp(d0, DMIN[l], DMAX[l]), a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const mx = dx * a + sw * dy * h, my = dy * a - sw * dx * h; // the middle joint, relative to the root
    A[o] = mx / L1; A[o + 1] = my / L1; A[o + 2] = (dx * d - mx) / L2; A[o + 3] = (dy * d - my) / L2;
    return d0 - d;
  };
  // hold the joint between segments k and k+1 of the leg at o to an interior angle in [lo, hi], on the side sw (0: either side); rotates segment k+1
  const limJ = (o, k, lo, hi, sw) => {
    const i = o + k * 2, ax = SD[i], ay = SD[i + 1], bx = SD[i + 2], by = SD[i + 3], cr = ax * by - ay * bx, dt = ax * bx + ay * by;
    if ((sw === 0 || cr * sw >= 0) && dt <= -LCOS[k ? 3 : 1] && dt >= -LCOS[k ? 2 : 0]) return; // (inside: no trigonometry)
    const r = Math.atan2(cr, dt), s = sw || (r >= 0 ? 1 : -1), rmin = PI - hi, rmax = PI - lo;
    let m = r * s; if (m >= rmin && m <= rmax) return; m = m < rmin ? rmin : rmax;
    const c = Math.cos(m * s), sn_ = Math.sin(m * s); SD[i + 2] = ax * c - ay * sn_; SD[i + 3] = ax * sn_ + ay * c;
  };
  const SD = S.SD;
  const LCF = Float64Array.from([LIMS.elbow[0], LIMS.elbow[1], LIMS.wrist[0], LIMS.wrist[1]].map(Math.cos)), LCH = Float64Array.from([LIMS.knee[0], LIMS.knee[1], LIMS.hock[0], LIMS.hock[1]].map(Math.cos));
  let LCOS = LCF; // (the cosines of the limits of the leg being held: [mid lo, mid hi, end lo, end hi])
  // shortest-arc blend of two directions
  const blendDir = (A, i, bx, by, cx, cy, w) => { const a0 = Math.atan2(by, bx); let da = Math.atan2(cy, cx) - a0; if (da > PI) da -= 2 * PI; else if (da < -PI) da += 2 * PI; const a = a0 + da * w; A[i] = Math.cos(a); A[i + 1] = Math.sin(a); };

  // 6 tail nodes from (hx, hy), facing f; heading keys (0 = straight back, 90 = up); the tip curls forward and sways
  const tailChain = (hx, hy, f, a0, a1, a2, a3, curl, t, w, ox, oy) => {
    let px = hx, py = hy; const segL = LEN.tail / 6;
    for (let k = 0; k < 6; k++) {
      const u = k / 5 * 3, i = Math.min(2, Math.floor(u)), s = u - i, A_ = i === 0 ? a0 : i === 1 ? a1 : a2, B_ = i === 0 ? a1 : i === 1 ? a2 : a3;
      const a = (A_ + (B_ - A_) * s) * D2R + curl * (k >= 3 ? (k - 2) * 0.30 : 0) + (k >= 2 ? Math.sin(t * 1.9 + k * 0.8) * 0.05 * (k - 1) * w : 0);
      const L = k === 0 ? segL * 0.8 : segL;
      px += -f * Math.cos(a) * L; py += Math.sin(a) * L; ox[k] = px; oy[k] = py;
    }
  };
  const axisAt = (X, Y, i) => { // forward (tail -> head along the spine near node i) and up unit vectors, for the facing
    const a = Math.max(0, i - 1), b = Math.min(K - 1, i + 1); let fx = X[a] - X[b], fy = Y[a] - Y[b]; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l;
    tmp.fx = fx; tmp.fy = fy; tmp.ux = -fy * S.f; tmp.uy = fx * S.f; // (rotate forward by +90 degrees for a right-facing cat: up)
    if (S.src === 1 && tmp.uy < 0) { tmp.ux = -tmp.ux; tmp.uy = -tmp.uy; } // on the ground he is never belly-up, whatever the turn does to the spine
  };

  // ---------------------------------------------------------------- the ground source
  // the target pose vector for a state: (raw, rawLoaf) timelines, and the crouch weight; per-group lag so the hindquarters lead: they lower first when he sits down and push up
  // first when he stands up (lag +1 sitting down, -1 standing up, 0 none)
  const blendPose = (dst, raw, loaf, wc, lag) => {
    const a = lag > 0 ? 0 : 0.28, b = lag > 0 ? 0.72 : 1, c = lag > 0 ? 0.28 : 0, d = lag > 0 ? 1 : 0.72;
    const wH = lag ? sm(a, b, raw) : raw, wF = lag ? sm(c, d, raw) : raw, lH = lag ? sm(a, b, loaf) : loaf, lF = lag ? sm(c, d, loaf) : loaf;
    for (let i = 0; i < NPV; i++) {
      const hind = GRP_HIND[i], w = hind ? wH : wF, l = hind ? lH : lF;
      let v = P_STAND[i] + (P_SIT[i] - P_STAND[i]) * w;
      v += (P_LOAF[i] - v) * l;
      v += (P_CROUCH[i] - v) * wc;
      dst[i] = v;
    }
  };
  // a joint (designer frame, relative to the root) from the key points of P (approximate: the spline's nodes 4 and 11 from their neighbouring key points)
  const jt = { x: 0, y: 0 };
  const jointOf = (P, o, l) => {
    const far = l & 1;
    if (l < 2) { let tx = P[o + IN] - P[o + IM], ty = P[o + IN + 1] - P[o + IM + 1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; jt.x = P[o + IS] - ty * SH_UP + (far ? FAR_SH : 0); jt.y = P[o + IS + 1] + tx * SH_UP; }
    else { let tx = P[o + IM] - P[o + IH], ty = P[o + IM + 1] - P[o + IH + 1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; jt.x = P[o + IH] + 0.25 * (P[o + IM] - P[o + IH]) + ty * HIP_DN - tx * HIP_BK - (far ? FAR_SH : 0); jt.y = P[o + IH + 1] + 0.25 * (P[o + IM + 1] - P[o + IH + 1]) - tx * HIP_DN - ty * HIP_BK; }
    return jt;
  };
  // the foot's home (designer x relative to the root) from a pose's joint angles
  const homeRel = (P, l) => {
    const j = jointOf(P, 0, l), q = l < 2 ? IQF : IQH, far = l & 1;
    let a = -HPI + (P[q] + (far ? P[l < 2 ? IFF : IFH] : 0)) * D2R, x = j.x + Math.cos(a) * LL[l * 4];
    a += P[q + 1] * D2R; x += Math.cos(a) * LL[l * 4 + 1]; a += P[q + 2] * D2R; x += Math.cos(a) * LL[l * 4 + 2];
    return x;
  };
  const startSwing = (l, tx, dur, lift, delay) => {
    g.wait[l] = delay || 0; g.stx[l] = tx; g.sty[l] = g.surf + PAW_R; g.swDur[l] = dur; g.slift[l] = lift; g.sw[l] = 1e-4; g.swing[l] = 2; // 2 = waiting / swinging
  };
  const footEase = (u) => u * u * (3 - 2 * u);
  // a foot in the air: the paw folds back (trails) off the floor, then flicks forward to land; the hind foot hangs from the hock, toes down, then reaches flat
  const swingDistal = (l, s, a3, a4) => {
    if (l < 2) { let a = a3 + (-148 * D2R - a3) * sm(0, 0.32, s); a += (-38 * D2R - a) * sm(0.55, 0.86, s); a += (a3 - a) * sm(0.86, 1, s); g.dA3[l] = a; }
    else { // (the foot hangs only as far as the hips are high: sitting or lying, a hind foot that steps stays low under the haunch)
      const hang = clamp((g.PV[IH + 1] - 1.3) / 1.1, 0, 1);
      let a = a3 + (-102 * D2R - a3) * sm(0, 0.35, s) * hang; a += (a3 - a) * sm(0.6, 1, s); g.dA3[l] = a; let b = a4 + (-75 * D2R - a4) * sm(0, 0.3, s) * hang; b += (a4 - b) * sm(0.65, 1, s); g.dA4[l] = b; }
  };

  const groundEnter = (cat, ctx, fromAir) => {
    const A = cat.anchor;
    g.f = cat.facing || 1; S.f = g.f;
    g.hx = A.on ? A.hx : cat.x[HIPS]; g.surf = A.on ? A.ay : (S.surfGuess !== undefined ? S.surfGuess : 0);
    g.rootX = g.hx; g.turnOn = false; g.walkOn = false; g.ph = 0; g.ww = 0; g.adapt = fromAir ? 1 : 0; g.turnW = 0; g.turnC = 1;
    const wasSit = cat.poseName === 'sit' || cat.poseName === 'lick' ? 1 : 0;
    g.raw = wasSit; g.rawLoaf = cat.poseName === 'loaf' ? 1 : 0;
    if (!g.init || !sn.has) { g.PV.fill(0); }
    blendPose(g.PT, g.raw, g.rawLoaf, 0, 0);
    // the key points start from the body as it was drawn (no pop): converted to the designer frame
    if (sn.has && fromAir) {
      const ks = [12, 8, 4, 2, 0];
      for (let k = 0; k < 5; k++) { g.PV[k * 2] = (sn.X[ks[k]] - g.rootX) * g.f; g.PV[k * 2 + 1] = sn.Y[ks[k]] - g.surf; }
      for (let i = 10; i < NPV; i++) g.PV[i] = g.PT[i];
    } else g.PV.set(g.PT);
    // the feet: where they were drawn; they come down onto the surface (a short swing), then step out to their homes
    for (let l = 0; l < 4; l++) {
      const x = fromAir && sn.has ? sn.FT[l * 2] : g.rootX + g.f * homeRel(g.PT, l);
      g.px[l] = x; g.py[l] = g.surf + PAW_R; g.cx[l] = x; g.cy[l] = fromAir && sn.has ? Math.max(g.surf + PAW_R, sn.FT[l * 2 + 1]) : g.surf + PAW_R; g.sw[l] = 0; g.swing[l] = 0;
      if (fromAir && sn.has && g.cy[l] > g.surf + PAW_R + 0.02) { g.sfx[l] = x; g.sfy[l] = g.cy[l]; startSwing(l, x, 0.06 + 0.05 * (l >> 1), 0, 0); }
    }
    g.init = true; g.landT = fromAir ? 0 : 9; g.tm = ctx.t || 0; g.landS = fromAir ? clamp((cat.landed || 0) / 28, 0, 1) : 0;
    g.landDur = (AN_.landMin || 0.25) + ((AN_.landMax || 0.45) - (AN_.landMin || 0.25)) * clamp((cat.landed || 0) / 28, 0, 1);
  };

  // advance the ground source one step and write the drawn nodes NX/NY/NR (0..18), the foot targets and the distal angles
  const groundStep = (cat, ctx, dt) => {
    const M = cat.M, A = cat.anchor, t = ctx.t || 0;
    const aimS = cat.aimS || 0, aimOn = !!M.aim.on && aimS > 0.02;
    // ---- a turn begins when the sim turns him (an aimed turn, or a rig flip): seen end-on in the middle, the feet shuffling round under him
    if (!g.turnOn) {
      const fNew = A.on && A.flipping ? A.fNew : cat.facing;
      if (fNew && fNew !== g.f) {
        let pxm = 0; for (let l = 0; l < 4; l++) pxm += g.px[l]; pxm /= 4; if (A.on && A.flipping && A.ax) pxm = A.ax;
        g.turnOn = true; g.turnU = 0; g.turnF = g.f; g.turnPx = pxm; g.turnMirrorX = 2 * pxm - g.rootX; g.walkOn = false;
        for (let l = 0; l < 4; l++) { if (g.swing[l]) { g.px[l] = g.cx[l]; } g.swing[l] = 0; g.sw[l] = 0; }
        S.stepCount += 4;
      }
    }
    // ---- the root: where the hips are over the surface. The sim's anchor is where he ends up; steps are how the pose arrives there.
    let tgtX, tgtSurf;
    if (A.on) { tgtX = A.hx; tgtSurf = A.ay; } else { tgtX = cat.x[HIPS]; tgtSurf = S.surfGuess !== undefined ? S.surfGuess : g.surf; }
    if (Math.abs(tgtX - g.rootX) > 3.5 && S.cmd.walkTo === null && !(S.cmd.walk | 0) && !g.turnOn) { groundEnter(cat, ctx, false); } // (a teleport, not a walk: start over there)
    g.surf += (tgtSurf - g.surf) * (1 - Math.exp(-30 * dt));
    if (S.cmd.walkTo !== null) tgtX = S.cmd.walkTo;
    const walkCmd = S.cmd.walk | 0;
    const dist = (walkCmd ? walkCmd * 1e3 : tgtX - g.rootX);
    // walking in: a long way to go, and no aim held -> the lateral-sequence gait; a short way -> the body eases there and the feet step as they need to
    const wantWalk = !g.turnOn && !aimOn && Math.abs(dist) > (g.walkOn ? 0.06 : 0.9);
    if (wantWalk && !g.walkOn) { g.walkOn = true; g.ph = 0.6; S.stepCount++; for (let l = 0; l < 4; l++) if (g.swing[l]) { g.swing[l] = 0; g.px[l] = g.cx[l]; } }
    if (!wantWalk && g.walkOn) { g.walkOn = false; }
    g.ww += ((g.walkOn ? 1 : 0) - g.ww) * (1 - Math.exp(-8 * dt));
    let vroot = 0;
    if (g.walkOn) {
      const dirn = dist > 0 ? 1 : -1, vmax = STRIDE / cycleT, v = Math.min(vmax, 1.4 + 3.2 * Math.abs(dist));
      vroot = dirn * (walkCmd ? vmax : v);
      const frz = S.cmd.freeze >= 0;
      if (!frz) { g.rootX += vroot * dt; g.ph += Math.abs(vroot) * dt / STRIDE; } else g.ph = S.cmd.freeze;
      if (!walkCmd && (tgtX - g.rootX) * dirn <= 0) { g.rootX = tgtX; g.walkOn = false; }
    } else if (!g.turnOn) { g.rootX += (tgtX - g.rootX) * (1 - Math.exp(-14 * dt)); }

    // ---- timelines: sit (raw), loaf; the crouch weight from the pull
    const pn = cat.poseName;
    if (pn === 'sit' || pn === 'lick') { g.rawTargetKeep = 1; g.loafKeep = 0; } else if (pn === 'stand' || pn === 'stretch') { g.rawTargetKeep = 0; g.loafKeep = 0; } else if (pn === 'loaf') { g.loafKeep = 1; }
    const sitTarget = g.walkOn ? 0 : g.rawTargetKeep, loafTarget = g.walkOn ? 0 : (g.loafKeep ? 1 : 0), rate = dt / sitTime;
    // (he steps his feet into place before he sits or lies down)
    let hindOff = 0; for (let l = 0; l < 4; l++) hindOff = Math.max(hindOff, Math.abs(g.px[l] - g.homeX[l]) * (l < 2 ? 0.75 : 1)); // (all four: the front paws too, so a foreleg is never left stretched out in front)
    const settle = hindOff > 0.3 && !g.turnOn && g.landT > g.landDur ? 0 : 1;
    g.raw += clamp(sitTarget - g.raw, -rate, sitTarget > g.raw ? rate * settle : rate); g.rawLoaf += clamp(loafTarget - g.rawLoaf, -rate, loafTarget > g.rawLoaf ? rate * settle : rate);
    S.sit = g.raw;
    const wc = aimS > 0.003 && !g.turnOn ? Math.pow(aimS, 0.7) : 0; // (he turns round standing, then settles into the crouch)
    if (sitTarget > g.raw + 1e-3 || loafTarget > g.rawLoaf + 1e-3) g.lagDir = 1; else if (sitTarget < g.raw - 1e-3 || loafTarget < g.rawLoaf - 1e-3) g.lagDir = -1;
    blendPose(g.PT, g.raw, g.rawLoaf, wc, g.lagDir || 1);
    blendPose(g.PH, sitTarget, loafTarget, wc, 0); // the poses' own homes (end state, no lag): where the feet are going
    // the pose chases its target a little (the hand-over from flight is not a pop); fast otherwise
    const kpv = 1 - Math.exp(-(g.landT < g.landDur * 0.7 ? 16 : 40) * dt); for (let i = 0; i < NPV; i++) g.PV[i] += (g.PT[i] - g.PV[i]) * kpv;
    const PV = g.PV;

    // ---- feet. homes (designer x from the joint angles) -> world; the distal angles of the pose
    const f = g.f;
    const hk = sitTarget + 3 * loafTarget + 7 * wc; if (hk !== g.homeKey) { g.homeKey = hk; for (let l = 0; l < 4; l++) g.homeR[l] = homeRel(g.PH, l); } // (the poses' homes change only with the targets)
    for (let l = 0; l < 4; l++) {
      // (walking, each stance is centred nearer under its own joint than the standing feet are; standing, a step goes to where the body is going, not where it is on the way)
      g.homeX[l] = (g.walkOn || g.turnOn ? g.rootX : tgtX) + f * (g.homeR[l] + (l < 2 ? 0.12 : -0.55) * g.ww);
      if (A.on && A.hi > A.lo) g.homeX[l] = clamp(g.homeX[l], A.lo - 0.05, A.hi + 0.05); // (a foot that would be beyond the end of the shelf finds its edge)
      const q = l < 2 ? IQF : IQH, a3 = -HPI + (PV[q] + ((l & 1) ? PV[l < 2 ? IFF : IFH] : 0) + PV[q + 1] + PV[q + 2]) * D2R;
      g.dA3[l] = a3; g.dA4[l] = l < 2 ? 0 : a3 + PV[IQH + 3] * D2R;
    }
    g.aimLock = false;
    // walking: the gait drives the feet
    S.slide = 0;
    if (g.walkOn) {
      const a = duty * STRIDE * 0.5;
      for (let l = 0; l < 4; l++) {
        const p = (g.ph + GAIT_OFF[l]) % 1;
        if (p < duty) { // stance: planted
          if (g.swing[l]) { g.swing[l] = 0; g.px[l] = g.cx[l]; g.py[l] = g.surf + PAW_R; S.stepCount++; }
          g.cx[l] = g.px[l]; g.cy[l] = g.surf + PAW_R;
          g.load[l] = Math.sin(Math.PI * p / duty);
        } else { // swing: from where it was lifted to where the body will be, low; the paw trails then flicks forward
          const s = (p - duty) / (1 - duty);
          if (!g.swing[l] || g.swing[l] === 3) { g.swing[l] = 1; g.sfx[l] = g.cx[l]; g.sfy[l] = g.cy[l]; }
          const e = footEase(s), tgt = g.homeX[l] + f * a;
          g.cx[l] = g.sfx[l] + (tgt - g.sfx[l]) * e; g.cy[l] = g.surf + PAW_R + (g.sfy[l] - g.surf - PAW_R) * (1 - e) + Math.sin(Math.PI * Math.pow(s, 0.8)) * (l < 2 ? 0.45 : 0.36);
          g.px[l] = g.cx[l]; g.load[l] = 0;
          swingDistal(l, s, g.dA3[l], g.dA4[l]);
        }
      }
    } else if (g.turnOn) {
      for (let l = 0; l < 4; l++) { g.cx[l] = g.px[l]; g.cy[l] = g.surf + PAW_R; }
    } else {
      // standing: steps only when a foot is far from its home: a swing arc to the home, staggered
      let needStep = false;
      const thr = aimOn ? 0.45 : 0.12;
      for (let l = 0; l < 4; l++) {
        if (g.swing[l] === 1) { g.swing[l] = 0; g.px[l] = g.cx[l]; }
        if (g.swing[l]) {
          if (g.wait[l] > 0) { g.wait[l] -= dt; if (g.wait[l] <= 0) { g.sfx[l] = g.px[l]; g.sfy[l] = g.cy[l]; g.wait[l] = 0; } else { g.cx[l] = g.px[l]; continue; } }
          g.sw[l] += dt / g.swDur[l];
          if (g.sw[l] >= 1) { g.swing[l] = 0; g.sw[l] = 0; g.px[l] = g.stx[l]; g.py[l] = g.surf + PAW_R; g.cx[l] = g.px[l]; g.cy[l] = g.py[l]; S.stepCount++; continue; }
          const e = footEase(g.sw[l]);
          g.cx[l] = g.sfx[l] + (g.stx[l] - g.sfx[l]) * e; g.cy[l] = g.surf + PAW_R + (g.sfy[l] - g.surf - PAW_R) * (1 - e) + Math.sin(Math.PI * g.sw[l]) * g.slift[l];
          if (g.slift[l] > 0) { const a3 = g.dA3[l], a4 = g.dA4[l], k = clamp(Math.abs(g.stx[l] - g.sfx[l]) / 1.4, 0.2, 1); swingDistal(l, g.sw[l], a3, a4); g.dA3[l] = a3 + (g.dA3[l] - a3) * k; g.dA4[l] = a4 + (g.dA4[l] - a4) * k; } // (a short step barely lifts the paw)
        } else {
          g.cx[l] = g.px[l]; g.cy[l] = g.surf + PAW_R;
          if (Math.abs(g.px[l] - g.homeX[l]) > thr) needStep = true;
        }
      }
      if (needStep) { // order of the steps: hind near, front near, hind far, front far (the lateral sequence), 70 ms apart; a foot already near home stays
        let k = 0;
        // (just after a landing: the front paws first, one deliberate step each, then the hind feet; otherwise the lateral sequence)
        const landed = g.landT < g.landDur * 1.5, order = landed ? LAND_ORDER : STEP_ORDER;
        for (let i = 0; i < 4; i++) { const l = order[i]; if (!g.swing[l] && Math.abs(g.px[l] - g.homeX[l]) > thr) { startSwing(l, g.homeX[l], landed ? stepTime * 1.25 : stepTime, (l < 2 ? 0.40 : 0.32) * clamp(Math.abs(g.px[l] - g.homeX[l]) / 1.2, 0.35, 1), landed ? 0.03 + 0.1 * k : 0.04 + 0.07 * k); k++; } }
      }
    }
    for (let l = 0; l < 4; l++) { if (g.swing[l] === 0) { const d = Math.abs(g.cx[l] - g.lastCx[l]); if (g.hold > 0.2 && d > S.slide) S.slide = d; } g.lastCx[l] = g.cx[l]; }
    g.hold += dt;
    for (let l = 0; l < 4; l++) if (g.swing[l]) g.hold = 0;

    // ---- the key points
    for (let k = 0; k < 5; k++) { KX[k] = PV[k * 2]; KY[k] = PV[k * 2 + 1]; }
    // landing: the body is attached to the planted feet (so the pose adapts to where they are), and the chest sinks onto the forelegs (by the strength of the impact), the hindquarters a beat later
    const adaptT = g.landT < g.landDur ? 1 : 0; g.adapt += (adaptT - g.adapt) * (1 - Math.exp(-(adaptT ? 14 : 5) * dt));
    if (g.adapt > 0.01 && !g.walkOn && !g.turnOn) {
      let dF = 0, dH = 0;
      for (let l = 0; l < 2; l++) dF += g.px[l] - g.homeX[l]; dF = dF * 0.5 * f; // designer-frame x offsets
      for (let l = 2; l < 4; l++) dH += g.px[l] - g.homeX[l]; dH = dH * 0.5 * f;
      dF = clamp(dF, -2.0, 2.0) * g.adapt; dH = clamp(dH, -2.0, 2.0) * g.adapt;
      KX[0] += dH; KX[1] += (dF + dH) * 0.5; KX[2] += dF; KX[3] += dF; KX[4] += dF;
    }
    if (g.landT < g.landDur * 1.6 && g.landS > 0) {
      const u = g.landT / g.landDur, sF = g.landS * 0.75 * Math.sin(PI * clamp(u * 0.9, 0, 1)) * (1 - sm(0.8, 1.6, u)), sH = g.landS * 0.35 * Math.sin(PI * clamp(u * 0.9 - 0.12, 0, 1));
      KY[2] -= sF; KY[3] -= sF * 0.9; KY[4] -= sF * 0.7; KY[1] -= (sF + sH) * 0.5; KY[0] -= sH;
    }
    // aim: head and eyes locked along the pull; the bum wiggle and the hind feet treading alternately at high power
    let wig = 0;
    if (aimOn) {
      const el = Math.atan2(M.aim.dy, Math.abs(M.aim.dx) + 0.25), a = clamp(el, -0.15, 1.05);
      // a steep shot: the chest lifts and the neck rises along the aim while the hindquarters stay loaded (a cat about to jump up onto a counter)
      const up = clamp(el / 1.35, 0, 1) * wc;
      KY[1] += 0.35 * up; KY[2] += 1.05 * up; KX[2] -= 0.35 * up; KY[3] += 1.45 * up; KX[3] -= 0.6 * up; KY[4] += 1.5 * up; KX[4] -= 0.75 * up;
      const nx = KX[3], ny = KY[3], L = Math.hypot(KX[4] - nx, KY[4] - ny) || 0.9, w = aimS;
      KX[4] += (nx + Math.cos(a) * L - KX[4]) * w * 0.85; KY[4] += (ny + Math.sin(a) * L - KY[4]) * w * 0.85;
      // the bum wiggle from ~80%: the rump sways fore-aft and bobs at ~5 Hz, the hind feet treading alternately
      const ph = 6.2832 * 5 * t, pw = clamp((aimS - 0.72) / 0.25, 0, 1), amp = 0.32 * pw * Math.min(1, (M.aimT || 0) / 0.2);
      if (amp > 0) { const sp = Math.sin(ph), ab = (sp < 0 ? -sp : sp) * amp; wig = sp * amp; KX[0] += wig; KY[0] += ab * 0.5; KX[1] += wig * 0.45; KY[1] += ab * 0.15; }
      g.tread = pw;
    } else g.tread += (0 - g.tread) * (1 - Math.exp(-10 * dt));
    // looking at something (a treat, the container) before he aims: the head turns toward it on the neck
    if (!aimOn && cat.gaze && cat.gaze.on && g.ww < 0.3) {
      const nx = KX[3], ny = KY[3], L = Math.hypot(KX[4] - nx, KY[4] - ny) || 0.9;
      const gdx = (cat.gaze.x - (g.rootX + f * nx)) * f, gdy = cat.gaze.y - (g.surf + ny), a = clamp(Math.atan2(gdy, Math.max(0.2, gdx)), -0.25, 0.85), w = gdx > 0.2 ? 0.55 : 0;
      KX[4] += (nx + Math.cos(a) * L - KX[4]) * w; KY[4] += (ny + Math.sin(a) * L - KY[4]) * w;
    }
    g.lickW += ((cat.licking && !aimOn && !g.walkOn && !g.turnOn ? 1 : 0) - g.lickW) * (1 - Math.exp(-7 * dt));
    if (g.lickW > 0.01) { KY[4] -= 0.30 * g.lickW; KX[4] -= 0.12 * g.lickW; } // the head dips to the raised paw
    // breathing, a slow weight shift, and the walk: head level and steady at about the height of the back, the body dipping a little over the loaded foreleg
    const br = Math.sin(t * 2.6) * 0.5 + 0.5;
    const idle = 1 - Math.max(g.ww, aimS);
    KY[2] += (br - 0.5) * 0.045 * idle; KY[3] += (br - 0.5) * 0.03 * idle;
    const shift = Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1) * 0.045 * idle * (1 - g.raw * 0.5);
    for (let k = 0; k < 5; k++) KX[k] += shift * (k < 2 ? -0.4 : 0.4);
    const ww = g.ww;
    if (ww > 0.01) {
      const ph = g.ph * 6.2832;
      KY[4] -= 0.30 * ww; KY[3] -= 0.16 * ww; KX[4] += 0.05 * ww;
      KY[0] += (Math.sin(ph * 2) * 0.025) * ww; KX[0] += Math.sin(ph) * 0.03 * ww;
      KY[2] -= (g.load[0] + g.load[1]) * 0.035 * ww;
      const hb = Math.sin(ph * 2 + 0.8) * 0.02 * ww; KY[3] += hb; KY[4] += hb * 0.5; // (the head stays steady: only a trace of the bob)
    }
    // the distal directions (designer frame), once per frame
    for (let l = 0; l < 4; l++) { g.C3[l] = Math.cos(g.dA3[l]); g.S3[l] = Math.sin(g.dA3[l]); if (l >= 2) { g.C4[l] = Math.cos(g.dA4[l]); g.S4[l] = Math.sin(g.dA4[l]); } }
    // the body comes down to its feet: a planted foot beyond the reach of its leg (the elbow / knee near straight) lowers the shoulders / the hips instead of overstretching the leg
    // (feet at their homes are within reach by construction: only checked when one is not)
    let away = g.walkOn || g.landT < g.landDur; for (let l = 0; l < 4 && !away; l++) if (Math.abs(g.cx[l] - g.homeX[l]) > 0.25) away = true;
    if (away) KXY();
    for (let pair = 0; pair < 2 && away; pair++) {
      let need = 0;
      for (let l = pair * 2; l < pair * 2 + 2; l++) {
        if (g.swing[l]) continue;
        // (KX/KY laid out like a pose vector: the joint helper reads it the same way)
        const j = jointOf(KV, 0, l), L3 = LL[l * 4 + 2], fx_ = (g.cx[l] - g.rootX) * f - g.C3[l] * L3, fy_ = g.cy[l] - g.surf - g.S3[l] * L3;
        const dx = fx_ - j.x, dy = fy_ - j.y, dm = DMAX[l] * 0.985;
        if (dx * dx + dy * dy > dm * dm) { const ny = Math.abs(dx) < dm ? Math.sqrt(dm * dm - dx * dx) : 0, drop = -dy - ny; if (drop > need) need = drop; }
      }
      need = Math.min(need, 0.7);
      if (need > 0) { if (pair === 0) { KY[2] -= need; KY[3] -= need * 0.9; KY[4] -= need * 0.8; KY[1] -= need * 0.3; } else { KY[0] -= need; KY[1] -= need * 0.5; } }
    }
    splineK(KX, KY, DX, DY);
    // ---- the turn (a step-round), seen end-on in the middle: the spine foreshortens head end first through a front-on view (head up over the chest, narrow body, legs under him)
    let fo = g.f, cL = 1, tU = -1;
    if (g.turnOn) {
      g.turnU += dt / turnTime;
      const u = Math.min(1, g.turnU); tU = u;
      cL = Math.cos(PI * clamp((u - 0.06) / 0.88, 0, 1)); const w = 1 - Math.abs(cL); g.turnC = cL; g.turnW = w;
      // front view: the head lifts over the chest, the hindquarters sit behind it; the legs straighten under him (taller)
      DY[0] += 0.7 * w; DY[1] += 0.6 * w; DY[2] += 0.45 * w; DY[3] += 0.38 * w;
      for (let i = 4; i < 13; i++) DY[i] += (i < 9 ? 0.34 : 0.34 + 0.06 * (i - 8)) * w; // (front-on he stands tall on near-straight legs, so the bend can change sides unseen)
      // the joints (designer frame), before the end-on squeeze
      for (let l = 0; l < 4; l++) {
        const front = l < 2, n = front ? 4 : 11, far = l & 1;
        let tx = DX[n - 1] - DX[n + 1], ty = DY[n - 1] - DY[n + 1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const jx = front ? DX[4] - ty * SH_UP + (far ? FAR_SH : 0) : DX[11] + ty * HIP_DN - tx * HIP_BK - (far ? FAR_SH : 0);
        const jy = front ? DY[4] + tx * SH_UP : DY[11] - tx * HIP_DN - ty * HIP_BK;
        const lat = (far ? 1 : -1) * g.turnF * (front ? 0.36 : 0.52) * w; // (the far legs, already ahead, go out to the leading side: the pair passes while the far foot is lifted)
        g.TA[l * 2] = g.turnPx + cL * (g.rootX + g.turnF * jx - g.turnPx) + lat; g.TA[l * 2 + 1] = g.surf + jy;
        g.cx[l] = g.turnPx + cL * (g.px[l] - g.turnPx) + lat;
        const sp = (l === 0 || l === 3) ? sm(0.05, 0.55, u) : sm(0.45, 0.95, u); // (diagonal pairs shuffle in turn)
        g.cy[l] = g.surf + PAW_R + Math.sin(PI * sp) * 0.22; g.swing[l] = sp > 0.02 && sp < 0.98 ? 1 : 0;
      }
      for (let i = 0; i < 13; i++) {
        const d = (i / 12) * 0.14, e = clamp((u - d) / 0.86, 0, 1), c = Math.cos(Math.PI * e);
        const wx = g.rootX + g.turnF * DX[i], nx = g.turnPx + (wx - g.turnPx) * c; DX[i] = (nx - g.rootX) * g.turnF;
      }
      fo = g.turnF;
    }
    for (let i = 0; i < 13; i++) { NX[i] = g.rootX + fo * DX[i]; NY[i] = g.surf + DY[i]; NR[i] = RB[i]; }
    if (g.turnOn && g.turnU >= 1) { // the turn is done: the same drawing, now described from the mirrored root and facing
      g.turnOn = false; g.f = -g.turnF; S.f = g.f; g.rootX = g.turnMirrorX; g.turnW = 0; g.turnC = 1;
      for (let l = 0; l < 4; l++) { g.px[l] = 2 * g.turnPx - g.px[l]; g.cx[l] = g.px[l]; g.cy[l] = g.surf + PAW_R; g.swing[l] = 0; g.sw[l] = 0; }
      g.hold = 0;
    }
    if (g.turnW > 0.01) for (let i = 1; i < 13; i++) NR[i] *= 1 - 0.16 * g.turnW;
    g.wcS += (wc - g.wcS) * kpv; if (g.wcS > 0.01) for (let i = 9; i < 13; i++) NR[i] *= 1 + 0.16 * g.wcS * (i - 8) / 4; // (crouched, the haunch bunches: the loaded thigh mass)
    // ribcage breathing
    { const k = 1 + (br - 0.5) * 0.05 * idle; for (let i = 3; i <= 7; i++) NR[i] *= k; }
    // ---- the tail
    {
      const ann = cat.annoyance || 0;
      g.nextFlick -= dt; if (g.nextFlick <= 0) { g.flick = 1; g.nextFlick = 3 + (Math.sin(t * 7.3) * 0.5 + 0.5) * 4; }
      g.flick = Math.max(0, g.flick - dt * 2.2);
      const flick = Math.sin(g.flick * Math.PI) * Math.sin(g.flick * 22);
      const a0 = PV[ITAIL], a1 = PV[ITAIL + 1], a2 = PV[ITAIL + 2], a3 = PV[ITAIL + 3];
      const wk = ww; // walking: the tail straight up, only the tip curling and swaying
      const lowSwish = Math.sin(t * 3.1 * (1 + ann)) * 9 * (aimS * 2 + ann + 0.2) * (aimS > 0.05 ? 1 : 0.4); // degrees
      tailChain(NX[12], NY[12], fo, a0 + (84 - a0) * wk + lowSwish * 0.3, a1 + (90 - a1) * wk + lowSwish * 0.7, a2 + (93 - a2) * wk + lowSwish, a3 + (96 - a3) * wk + lowSwish * 1.2 + flick * 22 + (aimOn ? Math.sin(t * 11) * 14 * aimS : 0), PV[ICURL] + (0.55 - PV[ICURL]) * wk, t, 0.6 + wk, TLX, TLY);
      const tc = tU >= 0 ? Math.cos(PI * clamp((tU - 0.14) / 0.86, 0, 1)) : 1;
      for (let k = 0; k < 6; k++) { NX[TAIL0 + k] = NX[12] + (TLX[k] - NX[12]) * tc; NY[TAIL0 + k] = Math.max(TLY[k], g.surf + RT[k] * 0.85); NR[TAIL0 + k] = RT[k]; } // (a tail lying on the floor runs along it)
    }
    // ---- ears and expression layer
    g.earT -= dt; if (g.earT <= 0) { g.ear = 1; g.earSide = -g.earSide; g.earT = 2.5 + (Math.sin(t * 5.1) * 0.5 + 0.5) * 4; }
    g.ear = Math.max(0, g.ear - dt * 3);
    S.earFlat = 0; S.earFwd = aimOn ? 1 : 0;
    // the foot targets (world)
    { // the hind feet tread alternately in place (a lift and set down, no travel) at high pull
      const tp = Math.sin(6.2832 * 2.5 * t), tw = g.tread * 0.16;
      for (let l = 0; l < 4; l++) {
        let lift = 0; if (l >= 2 && g.tread > 0.02 && !g.swing[l]) lift = Math.max(0, (l & 1) ? -tp : tp) * tw;
        tFT[l * 2] = g.cx[l]; tFT[l * 2 + 1] = g.cy[l] + lift; tFA[l] = sm(0.35, 1.2, g.cy[l] - g.surf - PAW_R);
      }
    }
    if (g.lickW > 0.01) { // Lickies: the near mitten comes up to the mouth and washes (he sits on the other three): the wrist folds, the toes at the mouth
      const mx = NX[0] + fo * 0.15, my = NY[0] - 0.62 + Math.sin(t * 16) * 0.10 * g.lickW, w = g.lickW;
      tFT[0] += (mx - tFT[0]) * w; tFT[1] += (my - tFT[1]) * w; g.dA3[0] += (100 * D2R - g.dA3[0]) * w; g.C3[0] = Math.cos(g.dA3[0]); g.S3[0] = Math.sin(g.dA3[0]);
    }
    g.landT += dt;
    S.clip = g.turnOn ? 'turn' : g.walkOn ? 'walk' : aimOn ? 'crouch' : g.landT < g.landDur ? 'land' : g.rawLoaf > 0.5 ? 'loaf' : g.raw > 0.5 ? 'sit' : 'stand';
    S.rootX = g.rootX; S.walking = g.walkOn; S.lickW = g.lickW;
  };
  // the current key points as a pose vector (for the joint helper)
  const KV = new Float32Array(10);
  const KXY = () => { for (let k = 0; k < 5; k++) { KV[k * 2] = KX[k]; KV[k * 2 + 1] = KY[k]; } return KV; };

  // ---------------------------------------------------------------- the flight source
  // key points (hips at the origin, forward +x) for the flight shapes: hips, waist, shoulders, neck base, head
  const F_ASC = [0, 0, 1.6, 0.02, 3.3, 0.18, 4.1, 0.36, 4.95, 0.56];       // extended: spine nearly straight and 15% long
  const F_APX = [0, 0, 1.45, 0.40, 2.95, 0.30, 3.75, 0.42, 4.55, 0.52];     // gathered: the back starts to flex
  const F_DESC = [0, 0, 1.5, 0.58, 3.0, 0.42, 3.8, 0.12, 4.6, -0.30];       // arched back, the nose pitching toward the landing
  const flightStep = (cat, ctx, dt) => {
    const M = cat.M, x = cat.x, y = cat.y, f = cat.side < 0 ? 1 : -1; // (the belly side: the sim's flank, which is what 'down' means for the legs whichever way he is pointing)
    S.f = f;
    // the sim's centroid and orientation (hips -> head)
    let cx = 0, cy = 0; for (let i = 0; i < K; i++) { cx += x[i]; cy += y[i]; } cx /= K; cy /= K;
    const hx = (x[10] + x[11] + x[12]) / 3, hy = (y[10] + y[11] + y[12]) / 3, ex = (x[0] + x[1] + x[2]) / 3, ey = (y[0] + y[1] + y[2]) / 3;
    let ang = Math.atan2(ey - hy, ex - hx);
    const vx = ctx.vx || 0, vy = ctx.vy || 0, spd = Math.hypot(vx, vy);
    // the body axis: the sim's own, but the take-off frame is the launch line
    const age = M.leaping ? M.leapAge : 9, tk = clamp(age / takeoffTime, 0, 1);
    if (M.leaping && age < takeoffTime * 1.6 && spd > 6 && !M.dropped) { const la = Math.atan2(vy, vx), da = Math.atan2(Math.sin(la - ang), Math.cos(la - ang)); ang += da * (1 - sm(0.3, 1.6, age / takeoffTime)) * 0.9; }
    fl.tk = tk; fl.age = age;
    // phase weights, smoothed
    const asc = sm(1.5, 9, vy), desc = sm(0.5, 6, -vy), apx = 1 - Math.max(asc, desc);
    const k1 = 1 - Math.exp(-24 * dt);
    if (!fl.init) { fl.asc = asc; fl.apx = apx; fl.desc = desc; fl.init = true; }
    fl.asc += (asc - fl.asc) * k1; fl.apx += (apx - fl.apx) * k1; fl.desc += (desc - fl.desc) * k1;
    S.phase = fl.asc > 0.5 ? 'ascent' : fl.desc > 0.5 ? 'descent' : 'apex'; S.clip = age < takeoffTime ? 'takeoff' : S.phase;
    const wa = fl.asc, wp = fl.apx, wd = fl.desc;
    // the shape
    for (let k = 0; k < 10; k++) fl.FV[k] = F_ASC[k] * wa + F_APX[k] * wp + F_DESC[k] * wd;
    for (let k = 0; k < 5; k++) { KX[k] = fl.FV[k * 2]; KY[k] = fl.FV[k * 2 + 1]; }
    // startled (a cucumber): the back arches and the tail puffs straight up
    fl.startle += ((M.startled ? 1 : 0) - fl.startle) * (1 - Math.exp(-20 * dt)); S.startle = fl.startle;
    if (fl.startle > 0.01) { KY[1] += 0.7 * fl.startle; KY[2] += 0.25 * fl.startle; KY[3] -= 0.1 * fl.startle; }
    // the dive: long and straight
    if (M.dropped) for (let k = 0; k < 5; k++) { KX[k] = F_ASC[k * 2] * 1.1; KY[k] = 0; }
    // short hops skip the full extension: scale the stretch by speed
    const ext = M.dropped ? 1 : clamp(0.55 + spd / 30, 0.7, 1.0);
    for (let k = 0; k < 5; k++) { KX[k] *= ext; }
    // righting reflex: when the sim body is not upright, the front half comes round first (the shoulders and head rotate toward upright, the hindquarters follow a beat later)
    const upx = -Math.sin(ang) * f, upy = Math.cos(ang) * f; // body up vector (world)
    const tilt = Math.atan2(upx, upy); // angle of body-up from world-up (0 = upright); + = leaning toward +x
    fl.righting += (clamp(Math.abs(tilt) / 1.2, 0, 1) - fl.righting) * (1 - Math.exp(-10 * dt));
    if (fl.righting > 0.02 && !M.dropped && !M.leaping) {
      const r = clamp(tilt, -1.4, 1.4) * 0.5, c = Math.cos(r * f), s = Math.sin(r * f), px = KX[1], py = KY[1];
      for (let k = 2; k < 5; k++) { const dx = KX[k] - px, dy = KY[k] - py; KX[k] = px + dx * c + dy * s; KY[k] = py - dx * s + dy * c; }
    }
    splineK(KX, KY, DX, DY);
    // chord (hips -> head) along the body axis, then centred on the sim centroid
    const ca = Math.atan2(DY[0] - DY[12], DX[0] - DX[12]), c = Math.cos(-ca), s = Math.sin(-ca);
    let mx = 0, my = 0;
    for (let i = 0; i < 13; i++) { const px = DX[i] * c - DY[i] * s, py = DX[i] * s + DY[i] * c; DX[i] = px; DY[i] = py; mx += px; my += py; }
    mx /= 13; my /= 13;
    const fx = Math.cos(ang), fy = Math.sin(ang), ux = -fy * f, uy = fx * f;
    // blended toward the sim's spine by how deformed the sim is
    const wdf = sm(0.35, 1.1, cat.resid || 0) * (M.dropped ? 0.5 : 1);
    fl.wd += (wdf - fl.wd) * (1 - Math.exp(-18 * dt));
    for (let i = 0; i < 13; i++) {
      const px = cx + (DX[i] - mx) * fx + (DY[i] - my) * ux, py = cy + (DX[i] - mx) * fy + (DY[i] - my) * uy;
      NX[i] = px + (x[i] - px) * fl.wd; NY[i] = py + (y[i] - py) * fl.wd; NR[i] = RB[i] + (cat.r[i] - RB[i]) * fl.wd * 0.5;
    }
    // the tail streams behind; at the apex it lifts and counter-rotates against the body pitch
    const pitch = Math.atan2(Math.sin(ang), Math.cos(ang)) * f;
    const tilt2 = clamp(-pitch * 25, -22, 22);
    tailChain(NX[12], NY[12], f, 8 * wa + 28 * wp + 52 * wd + tilt2 * 0.5, 6 * wa + 34 * wp + 62 * wd + tilt2 * 0.8, 4 * wa + 40 * wp + 66 * wd + tilt2, 2 * wa + 48 * wp + 70 * wd + tilt2, 0.2 * wd, ctx.t || 0, 0.8, TLX, TLY);
    // (the tail was built in the world frame: pivot it with the body axis so it trails behind whatever way he points)
    {
      const rot = ang - (f > 0 ? 0 : Math.PI), cr = Math.cos(rot), sr = Math.sin(rot), bx = NX[12], by = NY[12];
      for (let k = 0; k < 6; k++) { const dx = TLX[k] - bx, dy = TLY[k] - by; NX[TAIL0 + k] = bx + dx * cr - dy * sr; NY[TAIL0 + k] = by + dx * sr + dy * cr; NR[TAIL0 + k] = RT[k]; }
    }
    S.earFlat = Math.min(1.1, 0.55 * wa + 0.2 * wp + 0.35 * wd + fl.startle * 0.8); S.earFwd = 0;
    if (fl.startle > 0.01) for (let k = 0; k < 6; k++) NR[TAIL0 + k] = RT[k] * (1 + 0.9 * fl.startle); // the tail puffs
    fl.fx = fx; fl.fy = fy; fl.ang = ang; fl.cx = cx; fl.cy = cy;
  };

  // landing prediction (read-only): where along his path will the feet meet the surface, and how soon
  const landing = (cat, ctx) => {
    const vx = ctx.vx || 0, vy = ctx.vy || 0; let low = 1e9, cx = 0; for (let i = 0; i < K; i++) { cx += cat.x[i]; const b = cat.y[i] - cat.r[i]; if (b < low) low = b; } cx /= K;
    const gr = T.gravity || -30; let tt = 0.0, sx = cx, surf = 0;
    for (let it = 0; it < 3; it++) {
      surf = ctx.surfY ? ctx.surfY(sx) : 0;
      const a = 0.5 * gr, b = vy, c = low - surf, D = b * b - 4 * a * c;
      tt = D >= 0 ? (-b - Math.sqrt(D)) / (2 * a) : 0.5; if (!(tt > 0)) tt = 0.01;
      sx = cx + vx * tt;
    }
    fl.landX = sx; fl.landSurf = surf; fl.landT = clamp(tt, 0, 2);
  };

  // ---------------------------------------------------------------- the sim source: copy
  const simStep = (cat) => { for (let i = 0; i < N; i++) { NX[i] = cat.x[i]; NY[i] = cat.y[i]; NR[i] = cat.r[i]; } S.f = cat.facing || 1; };

  // ---------------------------------------------------------------- advance: choose the source, run it, cross-fade between sources
  S.reset = () => { S.src = -1; sn.has = false; sn.xf = 1; fl.init = false; g.init = false; };
  let lastT = 0;
  S.advance = (cat, ctx) => {
    const dt = Math.min(0.05, ctx.dt || 1 / 60), M = cat.M, A = cat.anchor;
    if (ctx.t !== undefined) { if (ctx.t < lastT - 0.02) S.reset(); lastT = ctx.t; } // (a respawn restarts the sim's clock: start over, nothing to blend from)
    // which source draws him?
    let want = 0;
    if (ctx.solid !== false && !cat.kicking) {
      let lowY = 1e9; for (let i = 0; i < N; i++) { const b = cat.y[i] - cat.r[i]; if (b < lowY) lowY = b; } // (all nodes: the paws are what touch)
      // the surface he is on: the highest one under any of his feet, hips or shoulders (a tail or a hind leg hanging off a shelf must not pick the floor)
      let surf = ctx.surfY ? ctx.surfY(cat.x[HIPS]) : 0;
      if (ctx.surfY) for (let k = -1; k < 5; k++) { const i = k < 0 ? 4 : paw(k), v = ctx.surfY(cat.x[i]); if (v > surf && v <= lowY + 0.8) surf = v; }
      S.surfGuess = surf;
      const ownable = cat.mode === 'ground' && !cat.frozen && !cat.relaxed && M.inn < 0.3 && !cat.grabs.length && M.splat < 0.25 && (A.on || lowY - surf < 0.6);
      if (ownable) want = 1; else if (cat.mode === 'air' && !M.stuck) want = 2;
    }
    if (want !== S.src) {
      // snapshot what is drawn now, and cross-fade to the new source
      const first = S.src < 0;
      if (!first) { sn.X.set(S.X); sn.Y.set(S.Y); sn.R.set(S.R); sn.FT.set(S.FT); sn.SD.set(S.SD); sn.axF = S.axF || 0; sn.has = S.active; }
      sn.xf = first ? 1 : 0; sn.dur = want === 2 ? 0.09 : want === 1 ? 0.12 : 0.1;
      const was = S.src; S.src = want;
      if (want === 1) groundEnter(cat, ctx, was === 2 && sn.has);
      if (want === 2) { fl.init = false; fl.hasAng = false; }
    }
    S.active = ctx.solid !== false;
    S.hit = Math.max(0, S.hit - dt * 2.2);
    if (S.src === 1) groundStep(cat, ctx, dt); else if (S.src === 2) { landing(cat, ctx); flightStep(cat, ctx, dt); } else { simStep(cat); S.phase = 'sim'; S.clip = 'sim'; }
    S.earFlat = clamp(S.earFlat + S.hit * 0.95, 0, 1.2); S.whiskBack = S.hit;
    // cross-fade the body
    let e = 1; if (sn.xf < 1) { sn.xf = Math.min(1, sn.xf + dt / sn.dur); e = footEase(sn.xf); }
    if (e < 1 && sn.has) for (let i = 0; i < N; i++) { S.X[i] = sn.X[i] + (NX[i] - sn.X[i]) * e; S.Y[i] = sn.Y[i] + (NY[i] - sn.Y[i]) * e; S.R[i] = sn.R[i] + (NR[i] - sn.R[i]) * e; }
    else { S.X.set(NX); S.Y.set(NY); S.R.set(NR); }
    S.own = S.src === 1 ? 1 : 0;
    S.grounded = S.src === 1;
    S.blendE = e;
  };
  S.pose = S.advance;
  S.react = (strength) => { if (strength > S.hit) S.hit = strength; };

  // ---------------------------------------------------------------- the limbs, from the (possibly feel-deformed) body X, Y, R
  // The ground and flight sources pose the legs by joint angles (a foot on the ground is then held where it is planted by the proximal correction); the sim source solves them from
  // the sim's paws as before. Every source writes the segment directions SD; a source change blends them (shortest arc), and the joint limits hold on the result.
  S.limbs = (X, Y, R, cat, ctx) => {
    const f = S.f, J = S.J, M = cat.M, src = S.src;
    axisAt(X, Y, 4); const sfx = tmp.fx, sfy = tmp.fy, sux = tmp.ux, suy = tmp.uy;
    axisAt(X, Y, 11); const hfx = tmp.fx, hfy = tmp.fy, hux = tmp.ux, huy = tmp.uy;
    // joint anchors
    for (let l = 0; l < 4; l++) {
      const far = l & 1;
      // (the far legs sit a little along from the near ones so both of a pair read: horizontally on the ground, along the spine in the air)
      const sh = far ? (l < 2 ? FAR_SH : -FAR_SH) : 0, shx = src === 1 ? f * sh : (l < 2 ? sfx : hfx) * sh, shy = src === 1 ? 0 : (l < 2 ? sfy : hfy) * sh;
      if (l < 2) { AJ[l * 2] = X[4] + shx + sux * SH_UP; AJ[l * 2 + 1] = Y[4] + shy + suy * SH_UP; }
      else { AJ[l * 2] = X[11] + shx - hux * HIP_DN - hfx * HIP_BK; AJ[l * 2 + 1] = Y[11] + shy - huy * HIP_DN - hfy * HIP_BK; }
      RX[l] = AJ[l * 2]; RY[l] = AJ[l * 2 + 1];
    }
    let blendLegs = sn.xf < 1 && sn.has;
    if (src === 1) {
      // ---- the ground: every foot has a target (planted, or on its swing path) and its distal angles; the shoulder + elbow / hip + knee reach it, bending the authored way
      const turning = g.turnW > 0.001 || g.turnOn, cT = g.turnC, fd = turning ? g.turnF * cT : f, hand = turning ? (cT >= 0 ? g.turnF : -g.turnF) : f;
      for (let l = 0; l < 4; l++) {
        const front = l < 2, o = l * 8, L3 = LL[l * 4 + 2];
        if (turning) { RX[l] = g.TA[l * 2]; RY[l] = g.TA[l * 2 + 1]; }
        const rx = RX[l], ry = RY[l];
        let c3x = fd * g.C3[l], c3y = g.S3[l], c4x = 0, c4y = 0;
        if (!front) { c4x = fd * g.C4[l]; c4y = g.S4[l]; }
        if (turning) { // (foreshortened: back to unit length)
          let cl = Math.hypot(c3x, c3y); if (cl < 1e-3) { c3x = 0; c3y = -1; } else { c3x /= cl; c3y /= cl; }
          if (!front) { cl = Math.hypot(c4x, c4y); if (cl < 1e-3) { c4x = 0; c4y = -1; } else { c4x /= cl; c4y /= cl; } }
        }
        const tx = tFT[l * 2], ty = tFT[l * 2 + 1], sw = hand * (front ? 1 : -1);
        SG[l] = sw;
        for (let tries = 0; ; tries++) {
          ik2(SD, o, l, rx, ry, tx - c3x * L3, ty - c3y * L3, sw);
          if (front || turning || tries >= 4) break;
          // the cat's hind leg: the knee ahead of the hip, the hock behind the knee. If the target would put the knee behind the hip, the heel lifts (the foot steepens) instead.
          if (f * SD[o] >= 0.02 && f * SD[o + 2] <= 0.02) break;
          const rot = (f * SD[o] < 0.02 ? -1 : 1) * hand * 0.2, cr = Math.cos(rot), sr = Math.sin(rot), nx = c3x * cr - c3y * sr; c3y = c3x * sr + c3y * cr; c3x = nx;
        }
        SD[o + 4] = c3x; SD[o + 5] = c3y; SD[o + 6] = c4x; SD[o + 7] = c4y;
      }
      S.FT.set(tFT); S.FA.set(tFA);
    } else if (src === 2) {
      // ---- flight: joint angles in the body frame, blended by phase; the front paws reach for the landing; the take-off unrolls from the ground pose
      const wa = M.dropped ? 1 : fl.asc, wp = M.dropped ? 0 : fl.apx, wd = M.dropped ? 0 : fl.desc, tk = fl.tk;
      const reach = sm(reachT, 0.02, fl.landT) * wd, A_ = FQ.asc, P_ = FQ.apx, D_ = FQ.desc, farA = FAR_FL[0] * wa + FAR_FL[1] * wp + FAR_FL[2] * wd;
      const takeoff = M.leaping && tk < 1 && sn.has;
      if (takeoff) blendLegs = false;
      for (let l = 0; l < 4; l++) {
        const front = l < 2, far = l & 1, o = l * 8, b = front ? 0 : 4;
        const fx = front ? sfx : hfx, fy = front ? sfy : hfy, ux = front ? sux : hux, uy = front ? suy : huy;
        const q0 = A_[b] * wa + P_[b] * wp + D_[b] * wd + (far ? (front ? -farA : farA) : 0);
        fk(SD, o, fx, fy, ux, uy, q0, A_[b + 1] * wa + P_[b + 1] * wp + D_[b + 1] * wd, A_[b + 2] * wa + P_[b + 2] * wp + D_[b + 2] * wd, A_[b + 3] * wa + P_[b + 3] * wp + D_[b + 3] * wd);
        SG[l] = f * (front ? 1 : -1);
        if (front && reach > 0.002) { // aim the whole leg at the landing spot (a rotation about the shoulder)
          const rx = RX[l], ry = RY[l]; let ex = 0, ey = 0; for (let k = 0; k < 3; k++) { ex += SD[o + k * 2] * LL[l * 4 + k]; ey += SD[o + k * 2 + 1] * LL[l * 4 + k]; }
          const gx = fl.landX + f * (0.35 + far * 0.4) - rx, gy = fl.landSurf + PAW_R + 0.25 - ry;
          let da = Math.atan2(gy, gx) - Math.atan2(ey, ex); if (da > PI) da -= 2 * PI; else if (da < -PI) da += 2 * PI;
          da = clamp(da, -1.0, 1.0) * reach; const c = Math.cos(da), s = Math.sin(da);
          for (let k = 0; k < 3; k++) { const i = o + k * 2, x0 = SD[i]; SD[i] = x0 * c - SD[i + 1] * s; SD[i + 1] = x0 * s + SD[i + 1] * c; }
        }
        if (takeoff) {
          if (front) { // the front paws leave first: the joint angles go from the crouch's to the reach's, so the leg sweeps forward under the chest (shoulder through straight down)
            const w = sm(0.05, 0.85, tk), PV = g.PV, g0 = (PV[IQF] + (far ? PV[IFF] : 0)) * D2R;
            fk(SD, o, fx, fy, ux, uy, g0 + (q0 - g0) * w, PV[IQF + 1] * D2R + (A_[1] * wa + P_[1] * wp + D_[1] * wd - PV[IQF + 1] * D2R) * w, PV[IQF + 2] * D2R + (A_[2] * wa + P_[2] * wp + D_[2] * wd - PV[IQF + 2] * D2R) * w, 0);
          } else { // the hind feet push off the floor where they stood: the leg unrolls hip, then knee, then hock, then toes
            const gx = sn.FT[l * 2], gy = sn.FT[l * 2 + 1], L3 = LL[l * 4 + 2];
            ik2(TMP, 0, l, RX[l], RY[l], gx - sn.SD[o + 4] * L3, gy - sn.SD[o + 5] * L3, SG[l]);
            TMP[4] = sn.SD[o + 4]; TMP[5] = sn.SD[o + 5]; TMP[6] = sn.SD[o + 6]; TMP[7] = sn.SD[o + 7];
            for (let k = 0; k < 4; k++) { const i = o + k * 2; blendDir(SD, i, TMP[k * 2], TMP[k * 2 + 1], SD[i], SD[i + 1], sm(0.2 + 0.16 * k, 0.62 + 0.13 * k, tk)); }
          }
        }
      }
    } else {
      // ---- the sim source (unchanged): the sim's paw nodes, brought above the surface; IK toward them
      for (let l = 0; l < 4; l++) {
        const pi = paw(l), gx = X[pi]; let gy = Y[pi]; const sy = ctx.surfY ? ctx.surfY(gx) : 0; if (gy < sy + R[pi]) gy = sy + R[pi];
        tFT[l * 2] = gx; tFT[l * 2 + 1] = gy; tFA[l] = 0;
        if (l < 2) { const pa = 14 * D2R; tFD[l * 2] = f * Math.sin(pa); tFD[l * 2 + 1] = -Math.cos(pa); }
        else { const hipH = AJ[l * 2 + 1] - gy, frac = hipH / (LEN.fem + LEN.tib + LEN.meta * 0.6), pa = (6 + 70 * sm(0.38, 0.78, frac)) * D2R; tFD[l * 2] = -f * Math.cos(pa); tFD[l * 2 + 1] = Math.sin(pa); }
      }
      // joint limits on the shoulder and hip, by the direction the foot is reached to (in the body frame): a foot target outside the cone is swung round to its edge, at the same distance
      for (let l = 0; l < 4; l++) {
        const front = l < 2, fx = front ? sfx : hfx, fy = front ? sfy : hfy, ux = front ? sux : hux, uy = front ? suy : huy, ax = AJ[l * 2], ay = AJ[l * 2 + 1];
        const dx = tFT[l * 2] - ax, dy = tFT[l * 2 + 1] - ay, dl = Math.hypot(dx, dy) || 1e-3;
        const along = dx * fx + dy * fy, down = -(dx * ux + dy * uy), th = Math.atan2(front ? -along : along, down), lim = front ? 1.95 : 1.75;
        if (th > lim || th < -lim) {
          const cl = clamp(th, -lim, lim), s2 = front ? -1 : 1, nal = Math.sin(cl) * s2 * dl, ndn = Math.cos(cl) * dl;
          tFT[l * 2] = ax + fx * nal - ux * ndn; tFT[l * 2 + 1] = ay + fy * nal - uy * ndn;
        }
      }
      S.FT.set(tFT); S.FD.set(tFD); S.FA.set(tFA);
      for (let l = 0; l < 4; l++) {
        const front = l < 2, j = l * 8, o = j, tx = S.FT[l * 2], ty = S.FT[l * 2 + 1];
        const ax = AJ[l * 2], ay = AJ[l * 2 + 1];
        if (front) {
          let pdx = S.FD[l * 2], pdy = S.FD[l * 2 + 1]; const pl = Math.hypot(pdx, pdy) || 1; pdx /= pl; pdy /= pl;
          const wx = tx - pdx * LEN.paw, wy = ty - pdy * LEN.paw;
          const e = twoLink(ax, ay, wx, wy, LEN.hum, LEN.fore, -f, 0.12, LIM.elbow, l);
          J[j + 2] = e.x; J[j + 3] = e.y; J[j + 4] = e.ex; J[j + 5] = e.ey;
          SD[o] = (e.x - ax) / LEN.hum; SD[o + 1] = (e.y - ay) / LEN.hum; SD[o + 2] = (e.ex - e.x) / LEN.fore; SD[o + 3] = (e.ey - e.y) / LEN.fore; SD[o + 4] = pdx; SD[o + 5] = pdy; SD[o + 6] = 0; SD[o + 7] = -1;
        } else {
          let dx = S.FD[l * 2], dy = S.FD[l * 2 + 1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
          const kn = twoLink(ax, ay, tx + dx * LEN.meta, ty + dy * LEN.meta, LEN.fem, LEN.tib, f, -0.1, LIM.knee, l);
          SD[o] = (kn.x - ax) / LEN.fem; SD[o + 1] = (kn.y - ay) / LEN.fem; SD[o + 2] = (kn.ex - kn.x) / LEN.tib; SD[o + 3] = (kn.ey - kn.y) / LEN.tib; SD[o + 4] = -dx; SD[o + 5] = -dy;
          const gx = f * 0.97, gy = 0.14; SD[o + 6] = gx; SD[o + 7] = gy; { const ll = Math.hypot(gx, gy); SD[o + 6] /= ll; SD[o + 7] /= ll; }
        }
        SG[l] = (SD[o] * SD[o + 3] - SD[o + 1] * SD[o + 2]) >= 0 ? 1 : -1;
      }
    }
    // ---- cross-fade the legs (segment by segment, shortest arc) when the source just changed
    if (blendLegs) { const e = footEase(sn.xf); for (let i = 0; i < 32; i += 2) blendDir(SD, i, sn.SD[i], sn.SD[i + 1], SD[i], SD[i + 1], e); }
    // ---- the shoulder and hip cones (a planted foot somewhere odd after a landing, a take-off from an odd pose): the upper bone is turned back inside the joint's range about the joint
    if (src !== 0) for (let l = 0; l < 4; l++) {
      const front = l < 2, o = l * 8, fx = front ? sfx : hfx, fy = front ? sfy : hfy, ux = front ? sux : hux, uy = front ? suy : huy;
      const dx = SD[o], dy = SD[o + 1], al = dx * fx + dy * fy, dn = -(dx * ux + dy * uy);
      if (dn >= 0) continue; // (the upper bone points belly-ward: well inside both cones)
      const th = front ? Math.atan2(-al, dn) : Math.atan2(al, dn);
      const lo = front ? -2.7 : -2.1, hi = front ? 2.7 : 2.7;
      if (th < lo || th > hi) {
        const cl = th < lo ? lo : hi, sa = Math.sin(cl) * (front ? -1 : 1), cb = Math.cos(cl), ndx = fx * sa - ux * cb, ndy = fy * sa - uy * cb;
        const rot = Math.atan2(dx * ndy - dy * ndx, dx * ndx + dy * ndy), cr = Math.cos(rot), sr = Math.sin(rot), nk = src === 1 ? 2 : 4;
        for (let k = 0; k < nk; k++) { const i = o + k * 2, px = SD[i]; SD[i] = px * cr - SD[i + 1] * sr; SD[i + 1] = px * sr + SD[i + 1] * cr; }
      }
    }
    // ---- joint limits: elbow / knee on their own side, wrist / hock either way
    for (let l = 0; l < 4; l++) {
      const o = l * 8, front = l < 2; LCOS = front ? LCF : LCH;
      limJ(o, 0, front ? LIMS.elbow[0] : LIMS.knee[0], front ? LIMS.elbow[1] : LIMS.knee[1], SG[l]);
      limJ(o, 1, front ? LIMS.wrist[0] : LIMS.hock[0], front ? LIMS.wrist[1] : LIMS.hock[1], 0);
    }
    // ---- the shoulder and hip limits (the sim source's odd orientations): a limb swung past what the joint allows is rotated back about the joint
    if (src === 0) for (let l = 0; l < 4; l++) {
      const front = l < 2, o = l * 8, fx = front ? sfx : hfx, fy = front ? sfy : hfy, ux = front ? sux : hux, uy = front ? suy : huy, lim = front ? LIM.shoulder : LIM.hip;
      const dx = SD[o], dy = SD[o + 1], a = dx * fx + dy * fy, b = -(dx * ux + dy * uy), th = Math.atan2(front ? -a : a, b);
      if (th < lim[0] || th > lim[1]) {
        const cl = clamp(th, lim[0], lim[1]), na = Math.sin(cl) * (front ? -1 : 1), nb = Math.cos(cl);
        const ndx = fx * na - ux * nb, ndy = fy * na - uy * nb, rot = Math.atan2(dx * ndy - dy * ndx, dx * ndx + dy * ndy), cr = Math.cos(rot), sr = Math.sin(rot);
        for (let k = 0; k < 4; k++) { const i = o + k * 2, px = SD[i]; SD[i] = px * cr - SD[i + 1] * sr; SD[i + 1] = px * sr + SD[i + 1] * cr; }
      }
    }
    // ---- the joints, from the roots and the segment directions (bones never change length)
    for (let l = 0; l < 4; l++) {
      const o = l * 8; let x = RX[l], y = RY[l]; J[o] = x; J[o + 1] = y;
      for (let k = 0; k < 3; k++) { x += SD[o + k * 2] * LL[l * 4 + k]; y += SD[o + k * 2 + 1] * LL[l * 4 + k]; J[o + 2 + k * 2] = x; J[o + 3 + k * 2] = y; }
      if (l >= 2) { S.tip[l * 2] = x + SD[o + 6] * LEN.toe; S.tip[l * 2 + 1] = y + SD[o + 7] * LEN.toe; }
      if (src === 2) { S.FT[l * 2] = x; S.FT[l * 2 + 1] = y; }
    }
    S.axF = Math.atan2(sfy, sfx);
    // the tail carriage flag and the drawn head (for the face group)
    S.tail.on = true;
    const hd = S.head; hd.x = X[0]; hd.y = Y[0]; hd.angle = Math.atan2(Y[0] - Y[1], X[0] - X[1]); hd.vx = cat.head.vx; hd.vy = cat.head.vy;
  };
  // the legacy one-call form (used by the tests): advance the state, solve the legs on the unmodified drawn body
  S.update = (cat, X, Y, R, ctx) => { S.advance(cat, ctx); S.limbs(S.X, S.Y, S.R, cat, ctx); };
  // the lab: the pose tables, for inspection
  S.poses = { P_STAND, P_SIT, P_LOAF, P_CROUCH, FQ };
  return S;
}
