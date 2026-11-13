// Everything about how Phoebus LOOKS lives here: coat colours (also fed to the body shader), the markings
// (bib, socks, belly stripe, outline width), the capsule list the body shader draws, and the face / ear drawing
// and expressions. Swap PALETTE / LOOK / drawFace() when his real colouring is known.
import * as THREE from 'three';
import { LEG_ATTACH, K } from './cat.js';
import { PROP } from './skeleton.js';

export const PALETTE = {
  // coat (body shader)
  coat: '#26242E',          // black fur
  coatShade: '#16151C',     // underside
  coatGloss: '#8E9BCB',     // highlight band on black
  coatOutline: '#121118',
  white: '#FBF7EF',         // bib / socks / blaze (cream)
  whiteShade: '#CBC4B9',
  // face
  earInner: '#B28C98',      // grey-pink
  earGloss: '#6B7392',
  nose: '#4A2E36',
  noseHi: '#8A6670',
  iris: '#C9D36A',
  irisEdge: '#8E9A3E',
  pupil: '#14131A',
  eyeLine: '#15141A',
  lidStroke: '#C9D36A',     // closed / squinted eyes read on black fur
  whisker: '#FFFFFF',
  whiskerShadow: 'rgba(31,58,61,0.28)',
  mouth: '#3A2229',
  mouthIn: '#8A2C3C',
  tongue: '#F08A94',
  blazeEdge: '#E9E2D6',
};

// Markings and proportions of the body drawing. Radii are fractions of the spine node's current radius.
export const LOOK = {
  outlinePx: 2.5,           // silhouette outline, CSS pixels
  smoothK: 0.25,            // smooth-union radius of the black parts (world units)
  whiteK: 0.12,
  farDim: 0.7,              // legs behind the body draw this much darker
  farShift: 0.2,            // far legs are drawn offset along the spine so both of a pair are visible
  legTop: 0.3,              // leg radius at the spine
  sock: { from: 0.38, r0: 0.27, r1: 0.31 },   // white sock: starts this far down the lower leg
  bib: { nodes: [1, 2, 3], off: 0.5, rad: 0.58 },
  stripe: null,             // optional white belly stripe { from, to, off, rad } (reads oddly when he is coiled)
};
export const CAP_MAX = 48;
const PROP_R = PROP.rad;

// Face geometry in head-local world units (head radius 0.8).
const G = { eyeX: 0.34, eyeY: 0.1, eyeR: 0.17 };

const EXPR_RAW = {
  neutral:   { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0 },
  yowl:      { eyeScale: 1.22, eyeOpen: 1.0,  pupilW: 0.035, pupilH: 0.17, squint: 0, happy: 0, mouthO: 0, yowl: 1, smile: 0, flat: 0.55 },
  // flattened ears, half-lidded glare
  grumpy:    { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.04, pupilH: 0.15, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0, flat: 1, glare: 1, frown: 1 },
  squished:  { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 1, happy: 0, mouthO: 0, yowl: 0, smile: 0 },
  smug:      { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 0, happy: 1, mouthO: 0, yowl: 0, smile: 1 },
  sleepy:    { eyeScale: 1.0,  eyeOpen: 0.3,  pupilW: 0.06, pupilH: 0.13, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0.4 },
  // held up by the scruff: wide eyes, small round mouth
  dangle:    { eyeScale: 1.3,  eyeOpen: 1.0,  pupilW: 0.09, pupilH: 0.1,  squint: 0, happy: 0, mouthO: 1, yowl: 0, smile: 0 },
  // looking at something interesting: ears pricked forward, big round pupils
  curious:   { eyeScale: 1.12, eyeOpen: 1.0,  pupilW: 0.1,  pupilH: 0.17, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0, flat: -0.3 },
  // the DROP dive: narrowed, determined
  determined: { eyeScale: 0.95, eyeOpen: 1.0, pupilW: 0.035, pupilH: 0.15, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0, flat: 0.55, glare: 0.85, frown: 0.5 },
  // the nonchalant paw lick: eyes half closed, tongue out (licking is driven by phoebus.lickPhase)
  lick:      { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0.3, calm: 1, tongue: 1 },
  // back leg kickies: ears flat, eyes wild, mouth open on the toy
  wild:      { eyeScale: 1.3,  eyeOpen: 1.0,  pupilW: 0.03, pupilH: 0.2,  squint: 0, happy: 0, mouthO: 0.5, yowl: 0.3, smile: 0, flat: 1.0, glare: 0.35 },
  // Destroyies: huge, furious and delighted, eyes glowing
  laser:     { eyeScale: 1.15, eyeOpen: 1.0,  pupilW: 0.04, pupilH: 0.17, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0.9, flat: 0.4, glare: 0.55, glow: 1 },
  // loafing: eyes shut in soft downward curves, a little smile
  content:   { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 0, happy: 0, mouthO: 0, yowl: 0, smile: 0.55, calm: 1 },
  // a big yawn: eyes screwed shut, mouth wide
  yawn:      { eyeScale: 1.0,  eyeOpen: 1.0,  pupilW: 0.05, pupilH: 0.15, squint: 1, happy: 0, mouthO: 0, yowl: 0.9, smile: 0, flat: 0.15 },
};
export const EXPRESSIONS = {};
for (const k in EXPR_RAW) EXPRESSIONS[k] = { flat: 0, glare: 0, frown: 0, calm: 0, tongue: 0, glow: 0, ...EXPR_RAW[k] };

// Face jiggle: a damped spring on scale (squash/stretch) and rotation, kicked by pokes, hard
// impacts, grabs and releases. Ears have their own, slightly slower spring so they lag.
export const JIGGLE = {
  hz: 6,             // face spring frequency
  zeta: 0.5,         // damping ratio (a cat, not jelly: one small overshoot, gone in ~0.3 s)
  squash: 0.12,      // scale amount at jiggle = 1 (sy = 1 + j*squash, sx = 1 - 0.8*j*squash)
  rotDeg: 3,         // rotation overshoot (degrees) at jiggle = 1
  peak: 0.9,         // jiggle amplitude reached by a kick of strength 1
  earHz: 4.5,
  earZeta: 0.4,      // ears may still flick
  earGain: 0.3,      // ear spring speed added per unit of head velocity change
  earMax: 0.35,      // rad
};

const SIZE = 384, PX = 120; // canvas px, canvas px per world unit  -> plane is SIZE/PX = 3.2 units
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Phoebus {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE / PX, SIZE / PX), mat);
    this.mesh.renderOrder = 30;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.renderOrder = 30;

    this.expr = 'neutral';
    this.cur = { ...EXPRESSIONS.neutral };
    this.look = { x: 0, y: 0 };
    this.lookT = { x: 0, y: 0 };
    this.blink = 0;           // 0..1 how closed from blinking
    this.blinkT = -1;         // time into current blink
    this.nextBlink = 1.5 + Math.random() * 3;
    this.blinkLen = 0.16;
    this.angle = 0;           // face rotation (radians, 0 = ears up)
    this.up = { x: 0, y: 1 };
    this.sx = 1; this.sy = 1;
    this.jig = { x: 0, v: 0 }; this.jrot = { x: 0, v: 0 }; this.ear = { x: 0, v: 0 };
    this.pvy = 0;
    this.t = 0;
    this.annoy = 0;
    this.earBias = 0;         // from the animator: ears back (+) or pricked forward (-)
    this.whiskBack = 0;       // 0..1 whiskers swept back on a hit
    this._wb = 0;
    this.lickPhase = 0;
    this.outlineW = 0.07;     // world units, set from the pixel scale
    this.side = 1;            // which flank the bib is on (+1 / -1)
    this._key = '';
    this.draw();
  }

  setExpression(name) { if (EXPRESSIONS[name]) this.expr = name; }
  setAnnoyance(a) { this.annoy = a; }
  // CSS pixels per world unit: keeps the ear outline the same width as the body outline
  setScale(ppw) { const w = LOOK.outlinePx / Math.max(1, ppw); if (Math.abs(w - this.outlineW) > 1e-4) { this.outlineW = w; this._key = ''; } }
  doBlink(slow = false) { if (this.blinkT < 0) { this.blinkT = 0; this.blinkLen = slow ? 0.7 : 0.16; } }
  // jiggle kick. strength 0..1; dir -1 squashes first (a poke), +1 stretches first (a release)
  kick(strength = 1, dir = -1) {
    const w = 2 * Math.PI * JIGGLE.hz, k = Math.max(0, Math.min(1.5, strength));
    this.jig.v += dir * k * JIGGLE.peak * w;
    this.jrot.v += (Math.random() < 0.5 ? -1 : 1) * k * JIGGLE.peak * w;
    this.ear.v += -dir * k * 0.5 * 2 * Math.PI * JIGGLE.earHz;
  }

  // head: cat.head {x,y,angle,vx,vy}; touch: {x,y} world point of a held finger or null
  update(dt, head, touch) {
    // Face rotation. head.angle points from the neck to the head. The ears sit on the perpendicular that is
    // closest to world-up (sticky, so he does not flip), and the face turns to follow the head direction when
    // it points up (hanging by the head). So he is never upside-down for long.
    const dx = Math.cos(head.angle), dy = Math.sin(head.angle);
    let ux = -dy, uy = dx;
    if (uy + 0.6 * (ux * this.up.x + uy * this.up.y) < -uy + 0.6 * (-ux * this.up.x - uy * this.up.y)) { ux = -ux; uy = -uy; }
    const s = smoothstep(0.3, 0.85, dy);
    let vx = ux * (1 - s) + dx * s, vy = uy * (1 - s) + dy * s;
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
    this.up.x = vx; this.up.y = vy;
    const target = Math.atan2(-vx, vy);
    let da = target - this.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.angle += da * (1 - Math.exp(-16 * dt));
    this.group.position.set(head.x, head.y, 0.2);
    // jiggle springs (sub-stepped so a long frame stays stable)
    const J = JIGGLE, n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    const w = 2 * Math.PI * J.hz, we = 2 * Math.PI * J.earHz;
    const dvy = Math.max(-20, Math.min(20, head.vy - this.pvy)); this.pvy = head.vy;
    this.ear.v += -dvy * J.earGain;
    for (let i = 0; i < n; i++) {
      this.jig.v += (-w * w * this.jig.x - 2 * J.zeta * w * this.jig.v) * h; this.jig.x += this.jig.v * h;
      this.jrot.v += (-w * w * this.jrot.x - 2 * J.zeta * w * this.jrot.v) * h; this.jrot.x += this.jrot.v * h;
      this.ear.v += (-we * we * this.ear.x - 2 * J.earZeta * we * this.ear.v) * h; this.ear.x += this.ear.v * h;
    }
    for (const sp of [this.jig, this.jrot, this.ear]) if (Math.abs(sp.x) < 1e-4 && Math.abs(sp.v) < 2e-3) { sp.x = 0; sp.v = 0; }
    this.ear.x = Math.max(-J.earMax, Math.min(J.earMax, this.ear.x));
    const jr = Math.max(-1.5, Math.min(1.5, this.jrot.x)) * (J.rotDeg * Math.PI) / 180;
    this.group.rotation.z = this.angle + jr;
    const a = Math.max(-0.2, Math.min(0.2, (Math.abs(head.vy) - Math.abs(head.vx)) * 0.012));
    const jg = Math.max(-1.5, Math.min(1.5, this.jig.x)) * J.squash;
    this.sy += ((1 + a) - this.sy) * (1 - Math.exp(-14 * dt));
    this.sx += ((1 - a * 0.8) - this.sx) * (1 - Math.exp(-14 * dt));
    this.group.scale.set(this.sx * (1 - 0.8 * jg), this.sy * (1 + jg), 1);

    this.t += dt; this.lickPhase += dt * 16;
    // expression tween (ears also flatten with annoyance)
    const tgt = EXPRESSIONS[this.expr], k = 1 - Math.exp(-16 * dt);
    for (const key in tgt) {
      const goal = key === 'flat' ? (tgt.flat >= 0 ? Math.max(tgt.flat, this.annoy * 1.1, this.earBias) : Math.min(tgt.flat, this.earBias)) : tgt[key];
      this.cur[key] += (goal - this.cur[key]) * k;
    }

    // blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) { this.blinkT = 0; this.blinkLen = 0.16; this.nextBlink = 2 + Math.random() * 3.5; }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT / this.blinkLen;
      const tri = t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2);
      this.blink = this.blinkLen > 0.3 ? Math.min(1, tri * 2.2) : tri; // a slow blink holds its eyes shut a while
      if (t >= 1) { this.blinkT = -1; this.blink = 0; }
    }

    this._wb += (this.whiskBack - this._wb) * (1 - Math.exp(-18 * dt));
    // look toward finger (in head-local space) while touching, else forward
    if (touch) {
      const ddx = touch.x - head.x, ddy = touch.y - head.y;
      const c = Math.cos(-this.angle), s2 = Math.sin(-this.angle);
      const lx = ddx * c - ddy * s2, ly = ddx * s2 + ddy * c;
      const d = Math.hypot(lx, ly) || 1, m = Math.min(1, d / 1.5);
      this.lookT.x = (lx / d) * m; this.lookT.y = (ly / d) * m;
    } else { this.lookT.x = 0; this.lookT.y = 0; }
    const lk = 1 - Math.exp(-12 * dt);
    this.look.x += (this.lookT.x - this.look.x) * lk;
    this.look.y += (this.lookT.y - this.look.y) * lk;

    const c = this.cur;
    const key = [c.eyeScale, c.eyeOpen, c.pupilW, c.pupilH, c.squint, c.happy, c.mouthO, c.yowl, c.smile, c.flat, c.glare, c.frown, c.calm, c.tongue, c.glow, this.blink, Math.round(Math.sin(this.lickPhase) * 3), this.look.x, this.look.y, this.ear.x * 0.5, this.outlineW * 20, this._wb]
      .map((v) => Math.round(v * 200)).join(',');
    if (key !== this._key) { this._key = key; this.draw(); }
  }

  draw() {
    const ctx = this.ctx, c = this.cur, P = PALETTE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    // world units, y up, origin at canvas centre
    ctx.setTransform(PX, 0, 0, -PX, SIZE / 2, SIZE / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const px = 1 / PX;

    drawEars(ctx, P, this.ear.x, c.flat, this.outlineW);
    drawBlaze(ctx, P);
    drawGoatee(ctx, P);

    // eyes
    const open = c.eyeOpen * (1 - this.blink);
    const bothClosed = Math.max(c.squint, c.happy, c.calm);
    for (const sgn of [-1, 1]) {
      const ex = sgn * G.eyeX, ey = G.eyeY;
      const rr = G.eyeR * c.eyeScale;
      if (bothClosed < 0.98) {
        ctx.save();
        ctx.globalAlpha = 1 - bothClosed;
        ctx.beginPath(); ctx.ellipse(ex, ey, rr * 1.02, rr * 1.12, 0, 0, Math.PI * 2); ctx.clip();
        const ix = ex + this.look.x * 0.045, iy = ey + this.look.y * 0.045;
        const grd = ctx.createRadialGradient(ix, iy, rr * 0.2, ix, iy, rr * 1.1);
        grd.addColorStop(0, P.iris); grd.addColorStop(0.75, P.iris); grd.addColorStop(1, P.irisEdge);
        ctx.fillStyle = grd; ctx.fillRect(ex - 0.4, ey - 0.4, 0.8, 0.8);
        ctx.fillStyle = P.pupil;
        ctx.beginPath(); ctx.ellipse(ix + this.look.x * 0.03, iy + this.look.y * 0.03, c.pupilW, c.pupilH * c.eyeScale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(ix - rr * 0.38, iy + rr * 0.42, rr * 0.2, 0, Math.PI * 2); ctx.fill();
        // lid (fur colour) from the top
        const lid = (1 - open) * rr * 2.4;
        if (lid > 0.001) { ctx.fillStyle = P.coat; ctx.fillRect(ex - 0.4, ey + rr * 1.2 - lid, 0.8, lid + 0.3); }
        // glare: a slanted lid, low at the nose end, over a half-closed eye
        if (c.glare > 0.02) {
          const g = c.glare, inner = -sgn, yo = ey + rr * (1.15 - 1.05 * g), yi = ey + rr * (1.15 - 1.75 * g);
          ctx.fillStyle = P.coat;
          ctx.beginPath();
          ctx.moveTo(ex - inner * rr * 1.4, yo + 0.3); ctx.lineTo(ex - inner * rr * 1.4, yo);
          ctx.lineTo(ex + inner * rr * 1.4, yi); ctx.lineTo(ex + inner * rr * 1.4, yi + 0.3);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        ctx.save(); ctx.globalAlpha = 1 - bothClosed;
        ctx.strokeStyle = P.eyeLine; ctx.lineWidth = 3 * px;
        ctx.beginPath(); ctx.ellipse(ex, ey, rr * 1.02, rr * 1.12, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = P.lidStroke; ctx.lineWidth = 6 * px;
      if (c.squint > 0.02) { // > <
        ctx.globalAlpha = Math.min(1, c.squint);
        ctx.beginPath();
        const d = sgn; // left eye ">" opens toward the face centre
        ctx.moveTo(ex - d * 0.14, ey + 0.13); ctx.lineTo(ex + d * 0.12, ey); ctx.lineTo(ex - d * 0.14, ey - 0.13);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (c.calm > 0.02) { // u u closed, peaceful curves
        ctx.globalAlpha = Math.min(1, c.calm);
        ctx.beginPath(); ctx.moveTo(ex - 0.15, ey + 0.04); ctx.quadraticCurveTo(ex, ey - 0.17, ex + 0.15, ey + 0.04); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (c.happy > 0.02) { // ^ ^ closed happy curves
        ctx.globalAlpha = Math.min(1, c.happy);
        ctx.beginPath(); ctx.moveTo(ex - 0.15, ey - 0.04); ctx.quadraticCurveTo(ex, ey + 0.2, ex + 0.15, ey - 0.04); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (c.glow > 0.02) { // glowing eyes (Destroyies)
      for (const sgn of [-1, 1]) { const gr = ctx.createRadialGradient(sgn * G.eyeX, G.eyeY, 0.02, sgn * G.eyeX, G.eyeY, 0.5); gr.addColorStop(0, `rgba(255,255,255,${0.95 * c.glow})`); gr.addColorStop(0.35, `rgba(255,70,70,${0.75 * c.glow})`); gr.addColorStop(1, 'rgba(255,40,40,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sgn * G.eyeX, G.eyeY, 0.5, 0, 7); ctx.fill(); }
    }
    drawNose(ctx, P);
    drawMouth(ctx, P, c);
    if (c.tongue > 0.02) { // a small pink tongue, lapping
      const l = c.tongue * (0.55 + 0.45 * Math.sin(this.lickPhase)), ln = Math.max(0, l);
      ctx.fillStyle = P.tongue; ctx.strokeStyle = P.mouth; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.ellipse(0.06 + 0.12 * ln, -0.36 - 0.12 * ln, 0.13, 0.08 + 0.2 * ln, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawWhiskers(ctx, P, this._wb);
    this.tex.needsUpdate = true;
  }

  // The body drawing: capsules (ax, ay, ar | bx, by, br | layer id) for the body shader.
  // ids: 0 black, 1 black far leg, 2 white (free), 3 white far, 4 white clipped to the body (bib, stripe).
  // Returns the number written. `cat` is the rig; A and B are Float32Array(4 * CAP_MAX).
  // SWIRLIES: a cinnamon roll. The spine coils into a spiral, head at the centre, tail wrapping the outside; drawn with the same capsules, so it keeps
  // the coat, outline and shading. cat.swirlT (0..1) is how far into the swirl he is: the whole spiral turns a quarter turn as he settles.
  writeSwirl(cat, A, B) {
    const cx = cat.swirlX, cy = cat.swirlY, R0 = cat.swirlR, t = cat.swirlT;
    let n = 0;
    const put = (ax, ay, ar, bx, by, br, id) => { if (n >= CAP_MAX) return; const o = n * 4; A[o] = ax; A[o + 1] = ay; A[o + 2] = ar; A[o + 3] = id; B[o] = bx; B[o + 1] = by; B[o + 2] = br; B[o + 3] = 0; n++; };
    const TH = 2.3 * Math.PI, th0 = -1.3 + 0.5 * Math.PI * Math.min(1, (t - 0.45) / 0.55), RIN = 0.95, SEG = 14;
    const pt = (u) => { const rr = R0 + (RIN - R0) * u, a = th0 + u * TH; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, rr]; };
    let prev = pt(0);
    for (let i = 1; i <= SEG; i++) { const q = pt(i / SEG); put(prev[0], prev[1], 0.4, q[0], q[1], 0.4, 0); prev = q; }
    { // the tail wraps round the outside, its tip white
      let tp = pt(0);
      for (let i = 1; i <= 4; i++) { const u = i / 4, a = th0 - u * 0.7 * Math.PI, rr = R0 + 0.3 + 0.08 * u, q = [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]; put(tp[0], tp[1], 0.2, q[0], q[1], 0.19, i === 4 ? 2 : 0); tp = q; }
    }
    // the white belly shows as a thin line along the coil (so it reads as a swirl from the front)
    { let a = pt(0.12); for (let i = 1; i <= 7; i++) { const b = pt(0.12 + 0.8 * (i / 7)); put(a[0], a[1], 0.1, b[0], b[1], 0.1, 2); a = b; } }
    return n;
  }
  // the skeleton's legs as tapered round-cones. front = upper arm (part of the chest mass), forearm column, paw (+ the white sock from mid-forearm);
  // hind = thigh (a big cone that is part of the haunch), a slimmer shin, the long narrow foot (metatarsus) and the toes (white)
  writeSkelLegs(SK, put) {
    const J = SK.J, P = PROP_R;
    for (let l = 0; l < 4; l++) {
      const far = l & 1, j = l * 8, id = far ? 1 : 5, wid = far ? 3 : 2, e = P.sock; // (near limbs are their own layer id so the shader can edge them against the torso)
      const ax = J[j], ay = J[j + 1], bx = J[j + 2], by = J[j + 3], cx = J[j + 4], cy = J[j + 5], dx = J[j + 6], dy = J[j + 7];
      if (l < 2) {
        put(ax, ay, P.hum, bx, by, P.humEnd, id);                      // upper arm (its deep end in the chest draws no edge): shoulder -> elbow
        put(bx, by, P.fore, cx, cy, P.foreEnd, id);                     // forearm: elbow -> wrist
        put(cx, cy, P.foreEnd, dx, dy, P.pawEnd, id);                   // paw: wrist -> toes
        const mx = bx + (cx - bx) * 0.45, my = by + (cy - by) * 0.45, rm = P.fore + (P.foreEnd - P.fore) * 0.45;
        put(mx, my, rm + e, cx, cy, P.foreEnd + e, wid);                // the sock: mid-forearm to the wrist ...
        put(cx, cy, P.foreEnd + e, dx, dy, P.pawEnd + e, wid);          // ... and the paw
      } else {
        const tx = SK.tip[l * 2], ty = SK.tip[l * 2 + 1];
        put(ax, ay, P.fem, bx, by, P.femEnd, id);                      // thigh: the haunch (the whole near leg is one smooth limb shape: no ring at the knee)
        put(bx, by, P.tib, cx, cy, P.tibEnd, id);                       // shin: knee -> hock
        put(cx, cy, P.tibEnd, dx, dy, P.metaEnd, id);                   // the long foot: hock -> ball
        put(dx, dy, P.toe, tx, ty, P.toeEnd, id);                       // toes
        put(dx, dy, P.toe + e, tx, ty, P.toeEnd + e, wid);              // the white toes
      }
    }
  }
  writeCapsules(cat, dt, A, B) {
    const F = this.feel, SK = this.skel, ctx = this.skelCtx;
    let x = cat.x, y = cat.y, r = cat.r, sk = false;
    this.drawHead = null;
    let n = 0;
    const put = (ax, ay, ar, bx, by, br, id) => {
      if (n >= CAP_MAX) return;
      const o = n * 4;
      A[o] = ax; A[o + 1] = ay; A[o + 2] = ar; A[o + 3] = id; B[o] = bx; B[o + 1] = by; B[o + 2] = br; B[o + 3] = 0; n++;
    };
    if (cat.swirlT > 0.45) { if (F && F.active) F.apply(cat); return this.writeSwirl(cat, A, B); }
    // the animator (presentation only): it owns the pose on the ground, shapes the flight, and falls back to the sim's body otherwise. The feel layer's squash and ripple go on top of whatever body that gives.
    if (SK && ctx && ctx.solid) {
      if (!SK.fresh) { const d = ctx.dt; ctx.dt = 0; SK.advance(cat, ctx); ctx.dt = d; }
      SK.fresh = false;
      x = SK.X; y = SK.Y; r = SK.R;
      if (F && F.active) { F.apply(cat, x, y, r, SK.src !== 0); x = F.ox; y = F.oy; r = F.or; }
      SK.limbs(x, y, r, cat, ctx); sk = SK.active;
    } else {
      if (SK) SK.active = false;
      if (F && F.active) { F.apply(cat); x = F.ox; y = F.oy; r = F.or; } // (the feel layer's secondary motion, on top of whatever the rig gives)
    }
    for (let i = 0; i < K - 1; i++) put(x[i], y[i], r[i], x[i + 1], y[i + 1], r[i + 1], 0);
    const TAIL0 = K;
    put(x[K - 1], y[K - 1], 0.38, x[TAIL0], y[TAIL0], r[TAIL0], 0);
    for (let j = 0; j < 5; j++) put(x[TAIL0 + j], y[TAIL0 + j], r[TAIL0 + j], x[TAIL0 + j + 1], y[TAIL0 + j + 1], r[TAIL0 + j + 1], 0);
    this.earBias = sk ? SK.earFlat - SK.earFwd * 0.3 : 0; this.whiskBack = sk ? SK.whiskBack : 0;
    if (sk) { const h = SK.head; h.x = x[0]; h.y = y[0]; h.angle = Math.atan2(y[0] - y[1], x[0] - x[1]); h.vx = cat.head.vx; h.vy = cat.head.vy; this.drawHead = h; }

    // which flank the bib is on: the belly faces down, so it flips (smoothly, through the spine) when he turns round
    this.side = cat.side;
    const bellyOf = (i) => { // unit belly direction at spine node i
      const a = i > 0 ? i - 1 : 0, b = i < K - 1 ? i + 1 : K - 1;
      let tx = x[a] - x[b], ty = y[a] - y[b]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      return [-ty * this.side, tx * this.side, tx, ty];
    };

    // legs: far ones first (drawn darker, behind), offset along the spine
    const LEG0 = TAIL0 + 6;
    if (sk) this.writeSkelLegs(SK, put); else for (let l = 0; l < 4; l++) {
      const far = l & 1, att = LEG_ATTACH[l], kn = LEG0 + l * 2, pw = kn + 1;
      const [, , tx, ty] = bellyOf(att);
      const sh = far ? (l < 2 ? 1 : -1) * LOOK.farShift : 0;
      const ox = tx * sh, oy = ty * sh;
      const id = far ? 1 : 0, wid = far ? 3 : 2;
      put(cat.legAX[l] + ox, cat.legAY[l] + oy, LOOK.legTop, x[kn] + ox, y[kn] + oy, r[kn], id);
      put(x[kn] + ox, y[kn] + oy, r[kn], x[pw] + ox, y[pw] + oy, r[pw], id);
      const f = LOOK.sock.from;
      put(x[kn] + ox + (x[pw] - x[kn]) * f, y[kn] + oy + (y[pw] - y[kn]) * f, LOOK.sock.r0, x[pw] + ox, y[pw] + oy, LOOK.sock.r1, wid);
    }
    // bib and belly stripe (clipped to the body)
    let pv = null;
    for (const i of LOOK.bib.nodes) {
      const [nx, ny] = bellyOf(i), o = r[i] * LOOK.bib.off, rad = r[i] * LOOK.bib.rad;
      const q = [x[i] + nx * o, y[i] + ny * o, rad];
      if (pv) put(pv[0], pv[1], pv[2], q[0], q[1], q[2], 4);
      pv = q;
    }
    const S = LOOK.stripe;
    if (S) {
      const [n0x, n0y] = bellyOf(S.from), [n1x, n1y] = bellyOf(S.to);
      put(x[S.from] + n0x * r[S.from] * S.off, y[S.from] + n0y * r[S.from] * S.off, S.rad, x[S.to] + n1x * r[S.to] * S.off, y[S.to] + n1y * r[S.to] * S.off, S.rad, 4);
    }
    return n;
  }
}

function drawEars(ctx, P, lag = 0, flat = 0, outlineW = 0.07) {
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(s, 1);
    ctx.translate(0.3, 0.5); ctx.rotate(-lag - flat * 0.95); ctx.translate(-0.3, -0.5); // lag: droop about the ear base; flat: ears back
    // outer ear (black fur): fill, then outline the outer edge only so no line crosses the head
    ctx.beginPath();
    ctx.moveTo(0.1, 0.6);
    ctx.lineTo(0.14, 0.62);
    ctx.quadraticCurveTo(0.34, 1.0, 0.72, 1.06);
    ctx.quadraticCurveTo(0.9, 0.7, 0.8, 0.28);
    ctx.lineTo(0.5, 0.2);
    ctx.lineTo(0.1, 0.3);
    ctx.closePath();
    ctx.fillStyle = P.coat; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.14, 0.62);
    ctx.quadraticCurveTo(0.34, 1.0, 0.72, 1.06);
    ctx.quadraticCurveTo(0.9, 0.7, 0.8, 0.28);
    ctx.strokeStyle = P.coatOutline; ctx.lineWidth = outlineW; ctx.stroke();
    // inner ear
    ctx.beginPath();
    ctx.moveTo(0.26, 0.68);
    ctx.quadraticCurveTo(0.4, 0.9, 0.66, 0.94);
    ctx.quadraticCurveTo(0.76, 0.7, 0.7, 0.42);
    ctx.quadraticCurveTo(0.5, 0.42, 0.26, 0.68);
    ctx.closePath();
    ctx.fillStyle = P.earInner; ctx.fill();
    ctx.restore();
  }
}

function smoothPoly(ctx, pts) {
  // closed smooth path through midpoints
  const n = pts.length;
  ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
}

function drawBlaze(ctx, P) {
  // inverted V: starts between the eyes, widens over muzzle and cheeks
  const half = [[0, 0.5], [0.07, 0.3], [0.13, 0.1], [0.3, -0.12], [0.52, -0.26], [0.5, -0.5], [0.3, -0.68]];
  // right side top->bottom, chin, left side bottom->top
  const right = half.slice(1), left = half.slice(1).reverse().map(([x, y]) => [-x, y]);
  const poly = [[0, 0.5]].concat(right, [[0, -0.74]], left);
  ctx.beginPath(); smoothPoly(ctx, poly); ctx.closePath();
  const g = ctx.createRadialGradient(0, -0.1, 0.1, 0, -0.1, 0.8);
  g.addColorStop(0, P.white); g.addColorStop(0.8, P.white); g.addColorStop(1, P.blazeEdge);
  ctx.fillStyle = g; ctx.fill();
}

function drawGoatee(ctx, P) {
  ctx.beginPath();
  ctx.moveTo(0, -0.42);
  ctx.bezierCurveTo(0.1, -0.42, 0.15, -0.55, 0.1, -0.64);
  ctx.bezierCurveTo(0.06, -0.72, -0.06, -0.72, -0.1, -0.64);
  ctx.bezierCurveTo(-0.15, -0.55, -0.1, -0.42, 0, -0.42);
  ctx.fillStyle = P.coat; ctx.fill();
}

function drawNose(ctx, P) {
  ctx.beginPath();
  ctx.moveTo(-0.095, -0.1);
  ctx.quadraticCurveTo(0, -0.07, 0.095, -0.1);
  ctx.quadraticCurveTo(0.08, -0.17, 0, -0.21);
  ctx.quadraticCurveTo(-0.08, -0.17, -0.095, -0.1);
  ctx.fillStyle = P.nose; ctx.fill();
  ctx.fillStyle = P.noseHi;
  ctx.beginPath(); ctx.ellipse(-0.03, -0.1, 0.03, 0.015, 0, 0, Math.PI * 2); ctx.fill();
}

function drawMouth(ctx, P, c) {
  const px = 1 / PX;
  const open = Math.max(c.mouthO, c.yowl, c.smile, c.frown);
  const wNeutral = Math.max(0, 1 - open * 1.5);
  ctx.strokeStyle = P.mouth; ctx.lineWidth = 4 * px;
  if (wNeutral > 0.02) { // small "w"
    ctx.globalAlpha = wNeutral;
    ctx.beginPath(); ctx.moveTo(0, -0.21); ctx.lineTo(0, -0.28);
    ctx.moveTo(0, -0.28); ctx.quadraticCurveTo(-0.05, -0.36, -0.13, -0.3);
    ctx.moveTo(0, -0.28); ctx.quadraticCurveTo(0.05, -0.36, 0.13, -0.3);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (c.smile > 0.02) { // small smile
    ctx.globalAlpha = Math.min(1, c.smile);
    ctx.beginPath(); ctx.moveTo(0, -0.21); ctx.lineTo(0, -0.27);
    ctx.moveTo(-0.15, -0.27); ctx.quadraticCurveTo(0, -0.44, 0.15, -0.27);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (c.frown > 0.02) { // flat, downturned mouth
    ctx.globalAlpha = Math.min(1, c.frown);
    ctx.beginPath(); ctx.moveTo(0, -0.21); ctx.lineTo(0, -0.28);
    ctx.moveTo(-0.15, -0.38); ctx.quadraticCurveTo(0, -0.27, 0.15, -0.38);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (c.mouthO > 0.02) { // tiny o
    ctx.globalAlpha = Math.min(1, c.mouthO);
    ctx.fillStyle = P.mouth;
    ctx.beginPath(); ctx.ellipse(0, -0.35, 0.06, 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (c.yowl > 0.02) { // wide open, pink, tongue
    ctx.globalAlpha = Math.min(1, c.yowl);
    ctx.beginPath(); ctx.ellipse(0, -0.42, 0.24, 0.27, 0, 0, Math.PI * 2);
    ctx.fillStyle = P.mouthIn; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = P.tongue; ctx.beginPath(); ctx.ellipse(0, -0.6, 0.15, 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = P.mouth; ctx.lineWidth = 4 * px;
    ctx.beginPath(); ctx.ellipse(0, -0.42, 0.24, 0.27, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawWhiskers(ctx, P, back = 0) {
  const px = 1 / PX;
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? P.whisker : P.whiskerShadow;
    ctx.lineWidth = (pass ? 2.6 : 4.4) * px;
    for (const s of [-1, 1]) {
      for (const [dy, ey] of [[0.0, 0.06], [-0.08, -0.12], [-0.16, -0.3]]) {
        ctx.beginPath();
        ctx.moveTo(s * 0.34, -0.2 + dy);
        ctx.quadraticCurveTo(s * (0.7 - 0.18 * back), -0.16 + dy + 0.05 - 0.1 * back, s * (1.12 - 0.42 * back), ey - 0.2 + dy * 0.2 - 0.28 * back);
        ctx.stroke();
      }
    }
  }
}
