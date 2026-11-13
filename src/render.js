// three.js scene: background, table, container (back/front lathe halves), Phoebus's body (one
// signed-distance shader on a quad over the cat) and his face.
import * as THREE from 'three';
import { build, CONTAINERS } from './containers.js';
import { PROP_TYPES } from './props.js';
import { THEMES, themeOfLevel, drawBackdrop } from './themes.js';
import { Phoebus, PALETTE, LOOK, CAP_MAX } from './phoebus.js';
import { SHELF_R } from './cat.js';

THREE.ColorManagement.enabled = false; // hex colours are used as-is (display space)

const col = (hex) => new THREE.Color(hex);
const CLEAR = col('#DDEBEA');

const FULL_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BODY_VERT = /* glsl */`
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The cat is a union of round-cone capsules. Black parts blend with a smooth min (one clean silhouette);
// white parts (socks, bib, stripe) are their own smooth shapes on top. A far layer (legs behind the body)
// is drawn first, darker. Flat tuxedo colours, a soft toon band of light from the top left, and an outline
// of constant screen width antialiased with fwidth.
const BODY_FRAG = /* glsl */`
precision highp float;
#define CAPS ${CAP_MAX}
uniform vec4 uA[CAPS];
uniform vec4 uB[CAPS];
uniform int uN;
uniform float uK, uKw, uOutline, uFarDim, uFlash;
uniform vec3 uCoat, uCoatShade, uCoatGloss, uOutlineCol, uWhite, uWhiteShade;
varying vec2 vW;

float sdCap(vec2 p, vec3 a, vec3 b) {
  vec2 pa = p - a.xy, ba = b.xy - a.xy;
  float h = dot(ba, ba), d = a.z - b.z;
  if (h - d * d < 1e-4) { // one circle swallows the other
    return a.z > b.z ? length(pa) - a.z : length(p - b.xy) - b.z;
  }
  vec2 q = vec2(dot(pa, vec2(ba.y, -ba.x)), dot(pa, ba)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - d * d), d);
  float k = c.x * q.y - c.y * q.x;
  float m = dot(c, q), n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - a.z;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - b.z;
  return m - a.z;
}
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

// one drawn layer: black shape dB, free white dW, white clipped to the black body dC; dim darkens it
vec4 layer(float dB, float dW, float dC, float dim, float dL, float dBod) {
  float dS = smin(dB, dW, uKw);
  float aa = max(fwidth(dS), 1e-4);
  vec2 g = vec2(dFdx(dS), dFdy(dS));
  float gl = length(g);
  float lit = gl > 1e-5 ? dot(g / gl, normalize(vec2(-0.55, 0.78))) : 0.0; // +1 facing the light
  float inner = clamp(0.5 - dS / aa, 0.0, 1.0);
  float outer = clamp(0.5 - (dS - uOutline) / aa, 0.0, 1.0);
  float depth = -dS;

  vec3 black = uCoat;
  black = mix(black, uCoatShade, smoothstep(0.1, -0.7, lit) * (1.0 - smoothstep(0.0, 0.55, depth)) * 0.9);
  float band = smoothstep(0.3, 0.75, lit) * smoothstep(0.05, 0.13, depth) * (1.0 - smoothstep(0.13, 0.3, depth));
  black += uCoatGloss * band * 0.30;

  // the near limbs read against the body: a lit edge on the side facing the light, and a dark line where they cross the torso
  { vec2 gl2 = vec2(dFdx(dL), dFdy(dL)); float g2 = length(gl2), litL = g2 > 1e-5 ? dot(gl2 / g2, normalize(vec2(-0.55, 0.78))) : 0.0;
    float onBody = clamp(0.5 - dBod / aa, 0.0, 1.0) * clamp(0.5 - dL / aa + 0.5, 0.0, 1.0);
    float bandL = smoothstep(0.1, 0.7, litL) * smoothstep(0.02, 0.07, -dL) * (1.0 - smoothstep(0.07, 0.17, -dL));
    float lineL = (1.0 - smoothstep(0.0, 0.045, abs(dL))) * clamp(0.5 - dBod / aa, 0.0, 1.0) * (1.0 - smoothstep(0.14, 0.32, -dBod)); // (only near the torso's outline: a limb's deep end inside the body draws no ring)
    black += uCoatGloss * bandL * 0.5 * clamp(0.5 - dBod / aa, 0.0, 1.0) * step(dL, 0.0);
    black = mix(black, uOutlineCol, lineL * 0.85); }
  float wFree = clamp(0.5 - dW / aa, 0.0, 1.0);
  float wClip = clamp(0.5 - dC / aa, 0.0, 1.0) * clamp(0.5 - dB / aa, 0.0, 1.0);
  float wm = max(wFree, wClip);
  vec3 cream = mix(uWhiteShade, uWhite, smoothstep(-0.8, 0.5, lit) * 0.7 + 0.3 * smoothstep(0.0, 0.5, depth));
  vec3 c = mix(black, cream, wm);
  c = mix(uOutlineCol, c, inner) * dim;
  c = mix(c, vec3(1.0), uFlash * (1.0 - inner * 0.55)); // the 1-frame white flash on a heavy hit
  return vec4(c, outer);
}

void main() {
  float dBN = 1e3, dLN = 1e3, dBF = 1e3, dWN = 1e3, dWF = 1e3, dWC = 1e3;
  for (int i = 0; i < CAPS; i++) {
    if (i >= uN) break;
    vec4 a = uA[i], b = uB[i];
    float d = sdCap(vW, a.xyz, b.xyz);
    int id = int(a.w + 0.5);
    if (id == 0) dBN = smin(dBN, d, uK);
    else if (id == 5) dLN = smin(dLN, d, uK);
    else if (id == 1) dBF = smin(dBF, d, uK);
    else if (id == 2) dWN = smin(dWN, d, uKw);
    else if (id == 3) dWF = smin(dWF, d, uKw);
    else dWC = smin(dWC, d, uKw);
  }
  vec4 far = layer(dBF, dWF, 1e3, uFarDim, 1e3, 1e3);
  vec4 near = layer(smin(dBN, dLN, uK), dWN, dWC, 1.0, dLN, dBN);
  float a = near.a + far.a * (1.0 - near.a);
  if (a < 0.002) discard;
  vec3 rgb = (near.rgb * near.a + far.rgb * far.a * (1.0 - near.a)) / a;
  gl_FragColor = vec4(rgb, a);
}`;

const BG_FRAG = /* glsl */`
precision highp float;
uniform vec3 uTop, uBottom;
varying vec2 vUv;
void main() { gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y)), 1.0); }`;

function fullTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

export function createRenderer({ cat, T, container, parent, debug }) {
  const rend = {};
  const perf = { fps: 60, frameMs: 16.7, worstMs: 16.7, simMs: 0, renderMs: 0, pixelRatio: 1, canvas: '', steps: 0 };
  let prCap = 2; // the resolution governor lowers this when the device cannot keep up
  const pickPR = () => Math.min(window.devicePixelRatio || 1, 2, prCap);
  function setPR(v) { if (v === prCap) return; prCap = v; resize(true); }
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(col('#DDEBEA'), 1);
  parent.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  const probe = document.createElement('div'); // reads the safe-area inset (the floor line sits above the home indicator)
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 10, -10, 0.1, 200);
  const view = { ver: 0, w: 18, h: 33, yc: 0, ppw: 22, cssW: 390, cssH: 844, zoom: 1 };

  // ---------- background ----------
  const bg = new THREE.Mesh(fullTriangle(), new THREE.ShaderMaterial({
    vertexShader: FULL_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false,
    uniforms: { uTop: { value: col('#E6F2F1') }, uBottom: { value: col('#D3E5E3') } },
  }));
  bg.frustumCulled = false; bg.renderOrder = -100;
  scene.add(bg);

  // ---------- lights ----------
  scene.add(new THREE.AmbientLight(0xffffff, 2.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-4, 8, 8);
  scene.add(sun);

  // ---------- container (table discs, lathe halves, bands, handle); rebuilt by setContainer ----------
  const cupGroup = new THREE.Group();
  scene.add(cupGroup);
  let B = null, frontMat = null, backMat = null;

  function flatDisc(radius, color, y, order, opacity = 1) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshBasicMaterial({ color: col(color), transparent: opacity < 1, opacity, depthWrite: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = order;
    cupGroup.add(m); return m;
  }

  function disposeGroup() {
    for (const o of [...cupGroup.children]) {
      cupGroup.remove(o);
      o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
    }
  }

  function setContainer(def, ox = 0, oy = 0) {
    disposeGroup();
    for (const o of [...boxGroup.children]) { boxGroup.remove(o); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); }
    cupGroup.position.set(ox, oy, 0); boxGroup.position.set(ox, oy, 0);
    B = build(def);
    if (def.square) { buildBox(def, B); rend.B = B; return; } // (a square box is drawn flat, not as a lathe)
    const colors = def.colors;
    const C = { body: col(colors.body), shade: col(colors.shade) };
    const bandCol = (b) => col(colors[b.color] || colors.stripe || colors.body);
    const H = B.height;
    const bands = (def.bands || []).map((b) => ({ y0: b.y * H - b.height / 2, y1: b.y * H + b.height / 2, extra: b.extra || 0, c: bandCol(b) }));

    // table: saucer, or a soft contact shadow
    if (def.saucer) {
      flatDisc(def.saucer.rx + 0.5, colors.saucer, -0.03, 1);
      flatDisc(def.saucer.rx - 0.8, colors.saucerShade, -0.02, 2);
      flatDisc(def.saucer.rx - 1.1, '#000000', -0.01, 3, 0.06);
    } else {
      flatDisc(B.outerRimR * 0.95, '#000000', -0.01, 3, 0.07);
    }

    // outline: inner rim->base, outer base->rim (with band edges as duplicated vertices), closed at the rim
    const n = B.inner.length;
    const pts = [], cols = [];
    for (let i = 0; i < n; i++) { pts.push(new THREE.Vector2(B.inner[i][0], B.inner[i][1])); cols.push(C.shade); }
    const bandAt = (y) => { for (const b of bands) if (y > b.y0 && y < b.y1) return b; return null; };
    const rAt = (cur, b) => cur[0] + (b ? b.extra : 0);
    const outerPts = [];
    for (let i = n - 1; i >= 0; i--) {
      const cur = B.outer[i];
      if (i < n - 1) {
        const prev = B.outer[i + 1];
        const cross = [];
        for (const b of bands) for (const yb of [b.y0, b.y1]) if ((prev[1] - yb) * (cur[1] - yb) < 0) cross.push({ yb, b, t: (yb - prev[1]) / (cur[1] - prev[1]), up: yb === b.y0 });
        cross.sort((p, q) => p.t - q.t);
        for (const c of cross) {
          const r = prev[0] + (cur[0] - prev[0]) * c.t;
          // travelling up the wall: enter the band at y0, leave it at y1
          const before = c.up ? [r, C.body, 0] : [r + c.b.extra, c.b.c, c.b.extra], after = c.up ? [r + c.b.extra, c.b.c, c.b.extra] : [r, C.body, 0];
          pts.push(new THREE.Vector2(before[0], c.yb)); cols.push(before[1]);
          pts.push(new THREE.Vector2(after[0], c.yb)); cols.push(after[1]);
        }
      }
      const b = bandAt(cur[1]);
      pts.push(new THREE.Vector2(rAt(cur, b), cur[1])); cols.push(b ? b.c : C.body);
      outerPts.push([rAt(cur, b), cur[1]]);
    }
    pts.push(new THREE.Vector2(B.inner[0][0], B.inner[0][1])); cols.push(C.body);

    function latheMesh(phiStart, phiLength, material, order) {
      const g = new THREE.LatheGeometry(pts, 48, phiStart, phiLength);
      const colors = new Float32Array(g.attributes.position.count * 3);
      const m = pts.length;
      for (let i = 0; i < g.attributes.position.count; i++) {
        const c = cols[i % m];
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(g, material);
      mesh.renderOrder = order;
      cupGroup.add(mesh);
      return mesh;
    }
    const glass = !!def.glass;
    backMat = glass
      ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false })
      : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    latheMesh(Math.PI / 2, Math.PI, backMat, 10);
    frontMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, transparent: true, opacity: def.frontOpacity ?? T.cupFrontOpacity, depthWrite: false });
    latheMesh(-Math.PI / 2, Math.PI, frontMat, 40);
    if (glass) { const hull = latheMesh(-Math.PI / 2, Math.PI, new THREE.MeshBasicMaterial({ color: col(colors.line), side: THREE.BackSide, transparent: true, opacity: 0.85, depthWrite: false }), 9); hull.scale.set(1.035, 1.0, 1.035); } // an inverted-hull outline: the glass has a readable edge

    // stronger bands on the front so they still read through the translucent wall
    for (const b of bands) {
      const sp = outerPts.filter((p) => p[1] > b.y0 && p[1] < b.y1).map((p) => new THREE.Vector2(p[0] + 0.02, p[1]));
      const edge = (yb) => {
        for (let i = outerPts.length - 1; i > 0; i--) {
          const a = outerPts[i], c = outerPts[i - 1];
          if ((a[1] - yb) * (c[1] - yb) <= 0 && a[1] !== c[1]) { const t = (yb - a[1]) / (c[1] - a[1]); return new THREE.Vector2(a[0] + (c[0] - a[0]) * t + 0.02, yb); }
        }
        return null;
      };
      const e0 = edge(b.y0), e1 = edge(b.y1);
      const bp = [e0, ...sp.reverse(), e1].filter(Boolean).sort((p, q) => p.y - q.y);
      if (bp.length > 1) {
        const m = new THREE.Mesh(new THREE.LatheGeometry(bp, 48, -Math.PI / 2, Math.PI),
          new THREE.MeshLambertMaterial({ color: b.c, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.FrontSide }));
        m.renderOrder = 41; cupGroup.add(m);
      }
    }

    // highlight streak on the front-left
    {
      const hp = [];
      const lo = 0.28 * H, hi = 0.9 * H;
      for (let i = 0; i < B.outer.length; i++) { const p = B.outer[i]; if (p[1] >= lo && p[1] <= hi) hp.push(new THREE.Vector2(p[0] + 0.03, p[1])); }
      hp.reverse();
      if (hp.length > 1) {
        const m = new THREE.Mesh(new THREE.LatheGeometry(hp, 4, -1.12, 0.13),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: glass ? 0.7 : 0.55, depthWrite: false, side: THREE.DoubleSide }));
        m.renderOrder = 42; cupGroup.add(m);
      }
    }

    // handle (visual only)
    if (def.handle) {
      const hd = def.handle;
      const y = hd.y * H;
      let r = B.outer[0][0];
      for (let i = 0; i < B.outer.length - 1; i++) {
        const a = B.outer[i], b = B.outer[i + 1];
        if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) { r = a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1])); break; }
      }
      const m = new THREE.Mesh(new THREE.TorusGeometry(hd.radius, hd.tube, 14, 28, Math.PI),
        new THREE.MeshLambertMaterial({ color: C.body }));
      m.rotation.z = -Math.PI / 2;
      m.scale.set(1.0, 1.15, 1.0);
      m.position.set(hd.side * (r + 0.02), y, 0);
      m.renderOrder = 43;
      cupGroup.add(m);
    }
    rend.B = B;
  }

  // ---------- the room: floor, side walls, shelves, props, the aim arc ----------
  const flat = (w, h, color, x, y, order, opacity = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col(color), transparent: opacity < 1, opacity, depthTest: false, depthWrite: false }));
    m.position.set(x, y, -0.5); m.renderOrder = order; return m;
  };
  // The room is flat coloured rectangles: collected, drawn in their original order (renderOrder, then insertion) and merged into ONE vertex-coloured mesh,
  // so it is a single draw call instead of ~40.
  const roomQuads = [];
  const rq = (w, h, color, x, y, order, role) => roomQuads.push({ w, h, c: col(color), x, y, order, i: roomQuads.length, role });
  const WH = T.roomHalfW;
  rq(120, 60, '#C4DAD6', 0, -30, -60, 'floor');                // the floor
  rq(120, 0.16, '#A3C2BD', 0, 0.02, -59, 'joint');              // where the floor meets the wall (and where his feet are)
  rq(120, 0.7, '#D2E6E2', 0, 0.37, -61, 'skirt');               // skirting board
  rq(120, 0.07, '#B4CEC9', 0, 0.74, -60, 'board');
  for (let i = -12; i <= 12; i++) rq(0.05, 60, '#B3CDC8', i * 2.2 + 0.4, -30, -58, 'board');       // floor boards
  for (const sgn of [-1, 1]) {
    rq(60, 160, '#B7CFCB', sgn * (WH + 30), 20, -57, 'outside');   // outside the room (wide screens)
    rq(0.5, 160, '#C7DCD8', sgn * (WH - 0.25), 20, -61, 'wallA');    // the side wall: a lighter strip with a darker edge, so a bank off it reads
    rq(0.12, 160, '#9DBDB7', sgn * (WH - 0.5), 20, -60, 'wallB');
    rq(0.3, 160, '#A9C6C1', sgn * (WH - 0.15), 20, -59.5, 'wallC');
  }
  roomQuads.sort((a, b) => a.order - b.order || a.i - b.i);
  const room = (() => {
    const n = roomQuads.length, pos = new Float32Array(n * 12), clr = new Float32Array(n * 12), idx = new Uint16Array(n * 6);
    roomQuads.forEach((q, k) => {
      const x0 = q.x - q.w / 2, x1 = q.x + q.w / 2, y0 = q.y - q.h / 2, y1 = q.y + q.h / 2;
      pos.set([x0, y0, -0.5, x1, y0, -0.5, x1, y1, -0.5, x0, y1, -0.5], k * 12);
      for (let v = 0; v < 4; v++) { clr[k * 12 + v * 3] = q.c.r; clr[k * 12 + v * 3 + 1] = q.c.g; clr[k * 12 + v * 3 + 2] = q.c.b; }
      idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(clr, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
    m.renderOrder = -61; m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrix(); return m;
  })();
  scene.add(room);
  // the theme: the room's palette, the shelf colours and ONE backdrop quad (a canvas texture drawn once per theme)
  const backdropTex = []; let themeIdx = -1;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(18, 40), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false })); // (opaque: transparent objects always draw after opaque ones, which would paint it over the shelves)
  backdrop.position.set(0, 20, -0.5); backdrop.renderOrder = -62; backdrop.matrixAutoUpdate = false; backdrop.updateMatrix(); backdrop.frustumCulled = false; scene.add(backdrop);
  function setTheme(i) {
    if (i === themeIdx) return; themeIdx = i; const th = THEMES[i], clr = room.geometry.getAttribute('color');
    roomQuads.forEach((q, k) => { const c = col(th[q.role] || th.floor); for (let v = 0; v < 4; v++) clr.setXYZ(k * 4 + v, c.r, c.g, c.b); });
    clr.needsUpdate = true;
    if (!backdropTex[i]) { const t = new THREE.CanvasTexture(drawBackdrop(i)); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; backdropTex[i] = t; }
    backdrop.material.map = backdropTex[i]; backdrop.material.needsUpdate = true;
    Object.assign(SHELF, th.shelf);
  }

  const shelfUnits = [];
  const shelfGroup = new THREE.Group();
  scene.add(shelfGroup);
  const SHELF = { top: '#D9B88A', edge: '#B8935F', end: '#A98550', bracket: '#B8935F' };
  function buildShelves(plats) {
    for (const o of [...shelfGroup.children]) { shelfGroup.remove(o); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) { (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose()); } }); }
    const mk = (c) => new THREE.MeshBasicMaterial({ color: col(c), depthTest: false, depthWrite: false });
    shelfUnits.length = 0;
    for (const p of plats) {
      const unit = new THREE.Group(); shelfGroup.add(unit); shelfUnits.push(unit);
      const board = new THREE.Mesh(new THREE.BoxGeometry(p.w, SHELF_R * 2, 2.0), [mk(SHELF.end), mk(SHELF.end), mk(SHELF.top), mk(SHELF.edge), mk(SHELF.edge), mk(SHELF.edge)]);
      board.position.set(p.x, p.y - SHELF_R, -0.3); board.renderOrder = 0;
      unit.add(board);
      for (const sgn of [-1, 1]) { // two little brackets
        const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(1.0, 0); sh.lineTo(0, -1.2); sh.closePath();
        const g = new THREE.ShapeGeometry(sh);
        const br = new THREE.Mesh(g, mk(SHELF.bracket));
        br.position.set(p.x + sgn * (p.w / 2 - 1.2) + (sgn < 0 ? 0 : 1.0), p.y - SHELF_R * 2, 0.72); br.scale.x = sgn < 0 ? 1 : -1; br.renderOrder = 0;
        unit.add(br);
      }
      const shadow = flat(p.w, 0.5, '#000000', p.x, p.y - 0.9, -1, 0.07); shadow.position.z = 0.7;
      unit.add(shadow);
    }
  }

  // props: little code-drawn sprites that rotate as they roll
  const propGroup = new THREE.Group();
  scene.add(propGroup);
  const propTex = {}, PROP_R = { mouse: 0.55, yarn: 0.64 };
  function propTexture(type) {
    if (propTex[type]) return propTex[type];
    const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.translate(S / 2, S / 2); g.lineJoin = 'round'; g.lineCap = 'round';
    const R = S * 0.42; // the physical radius
    const outline = (c, w = 5) => { g.strokeStyle = c; g.lineWidth = w; g.stroke(); };
    if (type === 'orange') {
      g.beginPath(); g.arc(0, 0, R, 0, 7); g.fillStyle = '#F5A03C'; g.fill(); outline('#B8661A');
      g.beginPath(); g.arc(-R * 0.3, -R * 0.35, R * 0.28, 0, 7); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fill();
      g.beginPath(); g.arc(R * 0.2, R * 0.3, R * 0.5, 0.2, 2.2); g.strokeStyle = 'rgba(184,102,26,0.35)'; g.lineWidth = 4; g.stroke();
      g.beginPath(); g.ellipse(0, -R * 0.82, R * 0.3, R * 0.14, -0.3, 0, 7); g.fillStyle = '#5A9A4F'; g.fill(); outline('#3E7038', 3);
    } else if (type === 'yarn') {
      g.beginPath(); g.arc(0, 0, R, 0, 7); g.fillStyle = '#EE7C94'; g.fill(); outline('#B04862');
      g.strokeStyle = '#C45A74'; g.lineWidth = 4;
      for (const [a, b] of [[-0.9, 0.6], [-0.4, 0.9], [0.1, 1.2], [0.6, 1.5]]) { g.beginPath(); g.ellipse(0, 0, R * 0.95, R * 0.45, a, b - 1.2, b + 0.8); g.stroke(); }
      g.beginPath(); g.arc(-R * 0.3, -R * 0.35, R * 0.25, 0, 7); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
      g.beginPath(); g.moveTo(R * 0.9, R * 0.3); g.quadraticCurveTo(R * 1.15, R * 0.55, R * 0.95, R * 0.75); g.strokeStyle = '#B04862'; g.lineWidth = 5; g.stroke();
    } else if (type === 'plant') {
      g.beginPath(); g.moveTo(-R * 0.8, -R * 0.35); g.lineTo(R * 0.8, -R * 0.35); g.lineTo(R * 0.55, R * 0.95); g.lineTo(-R * 0.55, R * 0.95); g.closePath();
      g.fillStyle = '#C9764A'; g.fill(); outline('#8A4526');
      g.beginPath(); g.rect(-R * 0.92, -R * 0.62, R * 1.84, R * 0.34); g.fillStyle = '#D98A5C'; g.fill(); outline('#8A4526');
      g.fillStyle = '#6FA86A'; g.strokeStyle = '#3F7A3B'; g.lineWidth = 4;
      for (const [x, a] of [[-0.45, -0.5], [0, 0], [0.45, 0.5]]) { g.beginPath(); g.ellipse(x * R, -R * 1.0, R * 0.2, R * 0.5, a, 0, 7); g.fill(); g.stroke(); }
    } else if (type === 'mouse') { // the catnip mouse: a grey felt body, pink ears, a long tail
      g.beginPath(); g.moveTo(-R * 0.6, R * 0.3); g.quadraticCurveTo(-R * 1.1, R * 0.7, -R * 1.25, R * 0.45); g.strokeStyle = '#B07A86'; g.lineWidth = 5; g.stroke();
      g.beginPath(); g.ellipse(0, R * 0.05, R * 0.85, R * 0.62, 0, 0, 7); g.fillStyle = '#B9BEC8'; g.fill(); outline('#6E7380');
      for (const sx of [-1, 1]) { g.beginPath(); g.arc(R * 0.42 * sx, -R * 0.5, R * 0.26, 0, 7); g.fillStyle = '#F2A9B8'; g.fill(); outline('#6E7380', 4); }
      g.fillStyle = '#2B2B33'; for (const sx of [0.3, 0.62]) { g.beginPath(); g.arc(R * sx, -R * 0.05, R * 0.07, 0, 7); g.fill(); }
      g.beginPath(); g.arc(R * 0.85, R * 0.08, R * 0.09, 0, 7); g.fillStyle = '#E26D86'; g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(-R * 0.2, -R * 0.25, R * 0.3, R * 0.12, -0.3, 0, 7); g.fill();
    } else { // mug
      g.beginPath(); g.roundRect(-R * 0.72, -R * 0.78, R * 1.44, R * 1.56, R * 0.22); g.fillStyle = '#4C9BA8'; g.fill(); outline('#2C6672');
      g.beginPath(); g.arc(R * 0.78, 0, R * 0.42, -1.4, 1.4); g.strokeStyle = '#2C6672'; g.lineWidth = 12; g.stroke(); g.strokeStyle = '#4C9BA8'; g.lineWidth = 5; g.stroke();
      g.beginPath(); g.ellipse(0, -R * 0.78, R * 0.72, R * 0.18, 0, 0, 7); g.fillStyle = '#6B3E26'; g.fill(); outline('#2C6672', 4);
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.roundRect(-R * 0.5, -R * 0.45, R * 0.16, R * 0.9, 6); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return (propTex[type] = t);
  }
  let propMeshes = [];
  function buildProps(list) {
    for (const m of propMeshes) { propGroup.remove(m); m.material.dispose(); m.geometry.dispose(); }
    propMeshes = list.map((p) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: propTexture(p.type), transparent: true, depthTest: false, depthWrite: false }));
      m.scale.set(p.r * 2 / 0.84, p.r * 2 / 0.84, 1); m.position.set(p.x, p.y, 0.3); m.renderOrder = 15;
      propGroup.add(m); return m;
    });
  }
  function updateProps(list) {
    for (let i = 0; i < propMeshes.length; i++) {
      const p = list[i], m = propMeshes[i];
      if (!p || p.state === 'gone') { m.visible = false; continue; }
      m.visible = true; m.position.set(p.x, p.y, 0.3); m.rotation.z = p.ang + p.wob; m.material.opacity = p.alpha;
      const k = 1 + (p.state === 'knocked' ? Math.abs(p.wob) * 0.25 : 0);
      m.scale.set(p.r * 2 / 0.84 * k, p.r * 2 / 0.84 * k, 1);
    }
  }

  // ---------- level pieces: treats, cushions, cucumbers, the box on its robo-vac, the container's glow ----------
  const sprite = (cv, w, h, order, opacity = 1) => {
    const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, depthTest: false, depthWrite: false }));
    m.renderOrder = order; return m;
  };
  const canvas2d = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, cv.getContext('2d')]; };

  // fish treat: a small glowing fish, drawn facing right
  let treatTex = null;
  function treatTexture() {
    if (treatTex) return treatTex;
    const [cv, g] = canvas2d(128, 128); g.translate(64, 64);
    const gl = g.createRadialGradient(0, 0, 4, 0, 0, 62); gl.addColorStop(0, 'rgba(255,236,160,0.95)'); gl.addColorStop(0.45, 'rgba(255,214,120,0.38)'); gl.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 62, 0, 7); g.fill();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-52, -17); g.lineTo(-48, 0); g.lineTo(-52, 17); g.closePath(); g.fillStyle = '#F29A55'; g.fill(); g.strokeStyle = '#B85F22'; g.lineWidth = 4; g.stroke();
    g.beginPath(); g.ellipse(-2, 0, 36, 21, 0, 0, 7); g.fillStyle = '#FFC470'; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(-4, 7, 26, 9, 0, 0.2, Math.PI - 0.2); g.fillStyle = 'rgba(255,248,224,0.75)'; g.fill();
    g.beginPath(); g.moveTo(-8, -20); g.quadraticCurveTo(4, -32, 14, -19); g.fillStyle = '#F29A55'; g.fill(); g.stroke();
    g.beginPath(); g.arc(18, -5, 4.6, 0, 7); g.fillStyle = '#2A1C14'; g.fill();
    g.beginPath(); g.arc(19.5, -6.5, 1.5, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = 'rgba(184,95,34,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(8, 4, 10, 0.4, 1.7); g.stroke();
    treatTex = new THREE.CanvasTexture(cv); treatTex.minFilter = THREE.LinearFilter; treatTex.generateMipmaps = false;
    return treatTex;
  }
  const treatGroup = new THREE.Group(); scene.add(treatGroup);
  let treatMeshes = [];
  function buildTreats(list) {
    for (const m of treatMeshes) { treatGroup.remove(m); m.material.dispose(); m.geometry.dispose(); }
    treatMeshes = list.map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), new THREE.MeshBasicMaterial({ map: treatTexture(), transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 17; treatGroup.add(m); return m;
    });
  }
  function updateTreats(list, time) {
    for (let i = 0; i < treatMeshes.length; i++) {
      const t = list[i], m = treatMeshes[i];
      if (!t || t.got) { m.visible = false; continue; }
      m.visible = true;
      const bob = Math.sin(time * 2.6 + i * 2.1) * 0.22, tw = 1 + 0.07 * Math.sin(time * 7 + i * 1.7);
      m.position.set(t.x, t.y + bob, 0.4); m.rotation.z = Math.sin(time * 1.9 + i) * 0.18; m.scale.set(tw, tw, 1);
    }
  }

  // cushion: a rounded cushion with a stitched seam and a button, squashed by a bounce
  const cushionGroup = new THREE.Group(); scene.add(cushionGroup);
  let cushionMeshes = [];
  function buildCushions(list) {
    for (const m of cushionMeshes) { cushionGroup.remove(m); m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); }
    cushionMeshes = list.map((c) => {
      const h = T.cushionH, PPU = 60, W = Math.round(c.w * PPU) + 16, H = Math.round(h * PPU) + 16, [cv, g] = canvas2d(W, H);
      g.lineJoin = 'round';
      const rr = (x, y, w, hh, r) => { g.beginPath(); g.roundRect(x, y, w, hh, r); };
      rr(8, 8, W - 16, H - 16, (H - 16) * 0.46); g.fillStyle = '#E9788F'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#B04862'; g.stroke();
      rr(14, 12, W - 28, (H - 16) * 0.38, (H - 16) * 0.2); g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
      g.setLineDash([7, 6]); g.strokeStyle = 'rgba(176,72,98,0.75)'; g.lineWidth = 2.5; rr(20, 18, W - 40, H - 36, (H - 36) * 0.4); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(W / 2, H / 2, 7, 0, 7); g.fillStyle = '#B04862'; g.fill();
      for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx > 0 ? W - 10 : 10, H - 10, 5, 0, 7); g.fillStyle = '#F3C1CB'; g.fill(); g.strokeStyle = '#B04862'; g.lineWidth = 2; g.stroke(); }
      const m = sprite(cv, W / PPU, H / PPU, 14); m.userData = { base: c.y, w: c.w, h: H / PPU, squash: 0 };
      m.position.set(c.x, c.y + h / 2, 0.2); cushionGroup.add(m); return m;
    });
  }
  function squashCushion(i, amount = 1) { if (cushionMeshes[i]) cushionMeshes[i].userData.squash = amount; }
  function updateCushions(dt) {
    for (const m of cushionMeshes) {
      const u = m.userData; u.squash *= Math.exp(-dt * 9);
      const k = 1 - 0.34 * u.squash * Math.cos(u.squash * 9), sy = Math.max(0.55, k);
      m.scale.set(1 + (1 - sy) * 0.5, sy, 1); m.position.y = u.base + (u.h * sy) / 2 - 0.08;
    }
  }

  // cucumber: lies on its surface; when it is triggered it rolls away and fades
  let cukeTex = null;
  const cukeTexture = () => {
    if (cukeTex) return cukeTex;
    const [cv, g] = canvas2d(220, 80); g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.roundRect(8, 12, 204, 56, 28); g.fillStyle = '#5FA94A'; g.fill(); g.lineWidth = 4.5; g.strokeStyle = '#2F6B2A'; g.stroke();
    g.beginPath(); g.roundRect(20, 18, 180, 14, 7); g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
    g.fillStyle = '#3F8A36'; for (const [x, y] of [[40, 48], [78, 42], [116, 50], [150, 43], [184, 48], [62, 56], [132, 58]]) { g.beginPath(); g.arc(x, y, 3.6, 0, 7); g.fill(); }
    g.beginPath(); g.arc(205, 40, 7, 0, 7); g.fillStyle = '#C9D98F'; g.fill(); g.stroke();
    cukeTex = new THREE.CanvasTexture(cv); cukeTex.minFilter = THREE.LinearFilter; cukeTex.generateMipmaps = false;
    return cukeTex;
  };
  const cukeGroup = new THREE.Group(); scene.add(cukeGroup);
  let cukeMeshes = [];
  function buildCucumbers(list) {
    for (const m of cukeMeshes) { cukeGroup.remove(m); m.material.dispose(); m.geometry.dispose(); }
    cukeMeshes = list.map((c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ map: cukeTexture(), transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 16; m.position.set(c.x, c.y + 0.42, 0.25); cukeGroup.add(m); return m;
    });
  }
  function updateCucumbers(list) {
    for (let i = 0; i < cukeMeshes.length; i++) {
      const c = list[i], m = cukeMeshes[i];
      if (!c || c.state === 'gone') { m.visible = false; continue; }
      m.visible = true;
      if (c.state === 'live') { m.position.set(c.x, c.y + 0.42, 0.25); m.rotation.z = 0; m.material.opacity = 1; }
      else { const t = c.t; m.position.set(c.x + c.dir * t * 4.5, c.y + 0.42 + Math.abs(Math.sin(t * 7)) * 0.25 * Math.max(0, 1 - t), 0.25); m.rotation.z = -c.dir * t * 9; m.material.opacity = Math.max(0, 1 - Math.max(0, t - 0.3) / 0.9); }
    }
  }

  // toys: the catnip mouse or a yarn ball hanging on a string (d.hang > 0) or sitting where it is (shelves). Hidden once kicked (it is a real prop then).
  const toyGroup = new THREE.Group(); scene.add(toyGroup);
  let toyMeshes = [];
  const TOYK = 2.3; // toys are drawn big (about head-sized) so they read as targets at phone size; the physics radius stays small
  function buildToys(list) {
    for (const o of toyMeshes) { toyGroup.remove(o.m); toyGroup.remove(o.s); o.s.children.forEach((c) => { c.material.dispose(); c.geometry.dispose(); }); o.m.material.dispose(); o.m.geometry.dispose(); o.s.material.dispose(); o.s.geometry.dispose(); }
    toyMeshes = list.map((d) => {
      const type = d.type === 'yarn' ? 'yarn' : 'mouse', r = PROP_R[type] * TOYK, hang = d.hang || 0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: propTexture(type), transparent: true, depthTest: false, depthWrite: false }));
      m.scale.set(r * 2 / 0.84, r * 2 / 0.84, 1); m.renderOrder = 15; toyGroup.add(m);
      const st = flat(0.09, Math.max(0.01, hang), '#6E5A4A', d.x, d.y + r + hang / 2, 14); st.visible = hang > 0; toyGroup.add(st);
      const hook = flat(0.4, 0.4, '#6E5A4A', 0, 0, 14); hook.rotation.z = Math.PI / 4; hook.position.set(0, hang / 2, 0); st.add(hook);
      return { m, s: st, d, hang, r };
    });
  }
  function updateToys(toys, t) {
    for (let i = 0; i < toyMeshes.length; i++) {
      const o = toyMeshes[i], ty = toys[i], live = ty && ty.state === 'live', held = ty && ty.state === 'held', show = live || held;
      o.m.visible = show; o.s.visible = live && o.hang > 0; if (!show) continue;
      const pulse = 1 + (live ? 0.07 * Math.sin(t * 4.2 + i) : 0.0), sw = live && o.hang > 0 ? Math.sin(t * 1.9 + i * 1.7) : 0; // a soft pulse, and a gentle swing on the string
      const ang = sw * 0.06 + (live ? toySway : 0), sn = Math.sin(ang), cs = Math.cos(ang), topX = ty.x, topY = ty.y + o.r + o.hang, L = o.hang + o.r;
      if (live && o.hang > 0) { o.m.position.set(topX + L * sn, topY - L * cs, 0.3); o.m.rotation.z = ang; } else { o.m.position.set(ty.x, ty.y, 0.3); o.m.rotation.z = held ? Math.sin(t * 40) * 0.12 : 0; }
      o.m.renderOrder = held ? 31 : 15; o.m.scale.set(o.r * 2 / 0.84 * pulse, o.r * 2 / 0.84 * pulse, 1);
      if (o.hang > 0) { o.s.position.set(topX + (o.hang / 2) * sn, topY - (o.hang / 2) * cs, 0.3); o.s.rotation.z = ang; }
    }
  }

  // the delivery box (open flaps) and its robo-vac, drawn flat: back (flaps, inside) behind the cat, front (translucent) over him
  const boxGroup = new THREE.Group(); scene.add(boxGroup);
  function buildBox(def, Bd) {
    const col_ = def.colors, PPU = 56, hw = Bd.outerRimR, H = Bd.height + 0.2, flap = 2.0, VH = def.vacH || 0.7;
    // back: flaps, rear panel, the dark inside
    {
      const W = (hw + flap + 0.4) * 2, Hh = H + flap + 0.4, [cv, g] = canvas2d(Math.round(W * PPU), Math.round(Hh * PPU)); g.lineJoin = 'round';
      const X = (x) => (x + W / 2) * PPU, Y = (y) => (Hh - 0.2 - y) * PPU;
      const quad = (pts, fill, st = col_.line) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = 4; g.strokeStyle = st; g.stroke(); };
      quad([[-hw * 0.9, H], [-hw * 0.7, H + flap * 0.95], [hw * 0.7, H + flap * 0.95], [hw * 0.9, H]], col_.shade);                 // rear flap
      quad([[-hw, H], [-hw - flap * 0.8, H + flap * 0.55], [-hw - flap * 0.55, H + flap * 0.45], [-hw * 0.7, H]], col_.body);
      quad([[hw, H], [hw + flap * 0.8, H + flap * 0.55], [hw + flap * 0.55, H + flap * 0.45], [hw * 0.7, H]], col_.body);
      quad([[-hw, 0], [hw, 0], [hw, H], [-hw, H]], col_.shade);                                                                        // the inside of the back
      g.fillStyle = 'rgba(60,35,10,0.28)'; g.fillRect(X(-hw), Y(H), (hw * 2) * PPU, 0.5 * PPU);
      const m = sprite(cv, W, Hh, 10); m.position.set(0, Hh / 2 - 0.2, 0.1); boxGroup.add(m);
    }
    // front panel: translucent cardboard with the tape and a little arrow, in front of the cat
    {
      const W = hw * 2 + 0.3, [cv, g] = canvas2d(Math.round(W * PPU), Math.round(H * PPU)); g.lineJoin = 'round';
      g.fillStyle = 'rgba(207,166,107,0.34)'; g.fillRect(6, 6, cv.width - 12, cv.height - 12);
      g.lineWidth = 6; g.strokeStyle = col_.line; g.strokeRect(6, 6, cv.width - 12, cv.height - 12);
      g.fillStyle = 'rgba(233,213,168,0.55)'; g.fillRect(cv.width / 2 - 20, 6, 40, cv.height - 12);
      g.fillStyle = 'rgba(143,106,51,0.75)'; g.beginPath(); g.moveTo(cv.width * 0.2, cv.height * 0.72); g.lineTo(cv.width * 0.2 + 18, cv.height * 0.52); g.lineTo(cv.width * 0.2 + 36, cv.height * 0.72); g.fill();
      g.fillRect(cv.width * 0.2 + 12, cv.height * 0.72, 12, 18);
      const m = sprite(cv, W, H, 40); m.position.set(0, H / 2, 0.5); boxGroup.add(m);
    }
    // the robo-vac: a flat dark disc under the box
    {
      const W = 6.9, [cv, g] = canvas2d(Math.round(W * PPU), Math.round((VH + 0.3) * PPU)); g.lineJoin = 'round';
      const y0 = 0.15 * PPU, hh = VH * PPU;
      g.beginPath(); g.roundRect(0.1 * PPU, y0, (W - 0.2) * PPU, hh, hh * 0.5); g.fillStyle = col_.vac; g.fill(); g.lineWidth = 4; g.strokeStyle = '#1F2937'; g.stroke();
      g.beginPath(); g.roundRect(0.35 * PPU, y0 + 3, (W - 0.7) * PPU, hh * 0.32, hh * 0.16); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill();
      g.fillStyle = col_.vacRing; g.fillRect(0.9 * PPU, y0 + hh * 0.55, (W - 1.8) * PPU, 4);
      g.beginPath(); g.arc((W - 0.9) * PPU, y0 + hh * 0.42, 7, 0, 7); g.fillStyle = col_.vacLight; g.fill();
      for (const wx of [0.9, W - 0.9]) { g.beginPath(); g.arc(wx * PPU, y0 + hh, 0.16 * PPU, 0, 7); g.fillStyle = '#111827'; g.fill(); }
      const m = sprite(cv, W, VH + 0.3, 11); m.position.set(0, -VH / 2, 0.3); boxGroup.add(m);
    }
  }
  const glow = (() => { // a soft pulse behind the target
    const [cv, g] = canvas2d(256, 256); const gr = g.createRadialGradient(128, 128, 10, 128, 128, 126);
    gr.addColorStop(0, 'rgba(255,248,200,0.95)'); gr.addColorStop(0.5, 'rgba(255,236,150,0.4)'); gr.addColorStop(1, 'rgba(255,236,150,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const m = sprite(cv, 10, 10, 8, 0); m.visible = false; scene.add(m); return m;
  })();
  const glowSt = { t: 99, x: 0, y: 0, r: 5 };
  function pulseGlow() { glowSt.t = 0; }

  function setLevel(level) {
    setTheme(themeOfLevel(level.id));
    document.body.dataset.theme = THEMES[themeOfLevel(level.id)].id; // (the HUD text picks a readable colour per theme)
    const def = CONTAINERS[level.container.id];
    setContainer(def, level.container.x, level.container.y);
    buildShelves(level.platforms || []);
    for (const g of [shelfGroup, cupGroup, boxGroup]) for (const c of g.children) freezeTree(c); // (the groups themselves still move with the container)
    for (const u of shelfUnits) u.matrixAutoUpdate = true; // (a shelf dips when he lands on it)
    cBaseY = level.container.y;
    buildTreats(level.treats || []); buildCushions(level.cushions || []); buildCucumbers(level.cucumbers || []); buildToys(level.toys || []);
    glowSt.x = level.container.x; glowSt.y = level.container.y + B.height * 0.5; glowSt.r = Math.max(B.outerRimR, B.height) * 1.5 + 1.2; glowSt.t = 99;
  }
  function setContainerX(x) { if (x === lastCX) return; lastCX = x; cupGroup.position.x = x; boxGroup.position.x = x; glowSt.x = x; }
  let lastCX = NaN, cBaseY = 0, cRock = 0, cSq = 0, toySway = 0;
  function applyContainerFx() { // the container rocks and squashes about its base when something hits it (a visual only)
    const a = cRock, sy = 1 - cSq, b = cBaseY, x = lastCX || 0;
    for (const g of [cupGroup, boxGroup]) { g.rotation.z = a; g.scale.y = sy; g.position.x = x; g.position.y = b; } // (the group's origin is the container's base, at the level's container y: rocking and squashing about it needs no offset)
  }
  function setContainerFx(rock, sq) { if (rock === cRock && sq === cSq) return; cRock = rock; cSq = sq; applyContainerFx(); }
  function setShelfDip(i, dy) { const u = shelfUnits[i]; if (u) u.position.y = -dy; }
  function setToySway(v) { toySway = v; }
  // what is actually drawn, for the sim/view consistency self-test (positions of every drawn object)
  function drawnProbe() {
    const g = boxGroup.children.length ? boxGroup : cupGroup, out = { cont: { x: g.position.x, y: g.position.y, rot: g.rotation.z, sy: g.scale.y }, shelves: shelfUnits.map((u) => u.position.y), props: [], treats: [], toys: [], cushions: [] };
    for (const m of propMeshes) out.props.push({ x: m.position.x, y: m.position.y, v: m.visible });
    for (const m of treatMeshes) out.treats.push({ x: m.position.x, y: m.position.y, v: m.visible });
    for (const o of toyMeshes) out.toys.push({ x: o.m.position.x, y: o.m.position.y, v: o.m.visible });
    for (const m of cushionMeshes) out.cushions.push({ x: m.position.x, y: m.position.y });
    out.body = { x: bodyMesh.position.x, y: bodyMesh.position.y, w: bodyMesh.scale.x, h: bodyMesh.scale.y };
    return out;
  }
  // static pieces never need their local matrix recomposed: compose it once and stop the per-frame update (a real saving without a JIT: dozens of objects)
  function freezeTree(o) { o.traverse((n) => { n.updateMatrix(); n.matrixAutoUpdate = false; }); }

  // ---------- Phoebus: body shader on a quad over the cat, then his face ----------
  const QM = 0.4; // the bounding quad's margin round every node: the outline (about 0.15) plus the smooth blend
  const capA = new Float32Array(4 * CAP_MAX), capB = new Float32Array(4 * CAP_MAX);
  const bodyMat = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      uA: { value: capA }, uB: { value: capB }, uN: { value: 0 },
      uFlash: { value: 0 }, uK: { value: LOOK.smoothK }, uKw: { value: LOOK.whiteK }, uOutline: { value: 0.07 }, uFarDim: { value: LOOK.farDim },
      uCoat: { value: col(PALETTE.coat) }, uCoatShade: { value: col(PALETTE.coatShade) }, uCoatGloss: { value: col(PALETTE.coatGloss) },
      uOutlineCol: { value: col(PALETTE.coatOutline) }, uWhite: { value: col(PALETTE.white) }, uWhiteShade: { value: col(PALETTE.whiteShade) },
    },
  });
  const bodyMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bodyMat);
  bodyMesh.frustumCulled = false; bodyMesh.renderOrder = 20;
  scene.add(bodyMesh);

  const phoebus = new Phoebus();
  scene.add(phoebus.group);

  // ---------- sizing ----------
  // Only does work when the CSS size or pixel ratio really changed; callers are debounced to one per frame.
  let curW = 0, curH = 0, curPR = 0, resizeQueued = false;
  function resize(force) {
    const cssW = Math.max(1, Math.round(parent.clientWidth || window.innerWidth)), cssH = Math.max(1, Math.round(parent.clientHeight || window.innerHeight));
    const pr = pickPR();
    if (!force && cssW === curW && cssH === curH && pr === curPR) return;
    curW = cssW; curH = cssH; curPR = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(cssW, cssH, false);
    const aspect = cssW / cssH;
    const viewW = T.roomHalfW * 2, viewH = viewW / aspect; // exactly the room's width across the screen; as much height as the aspect gives
    const tableFrac = Math.min(T.tableScreenPx + (parseFloat(getComputedStyle(probe).paddingBottom) || 0), 0.32 * cssH) / cssH;
    const yc = viewH * (0.5 - tableFrac);
    const t = (T.tiltDeg * Math.PI) / 180, D = 60;
    camera.left = -viewW / 2; camera.right = viewW / 2;
    camera.top = (viewH / 2) * Math.cos(t); camera.bottom = -camera.top;
    camera.position.set(0, yc + D * Math.sin(t), D * Math.cos(t));
    camera.lookAt(0, yc, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    camSt.z = -1; view.ver++;
    view.rect = canvas.getBoundingClientRect();
    view.w = viewW; view.h = viewH; view.yc = yc; view.cssW = cssW; view.cssH = cssH; view.ppw = cssH / viewH;
    bodyMat.uniforms.uOutline.value = LOOK.outlinePx / view.ppw;
    phoebus.setScale(view.ppw);
    view.topY = worldFromClient(cssW / 2, 0).y;
    perf.pixelRatio = pr; perf.canvas = `${renderer.domElement.width}x${renderer.domElement.height}`;
  }
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(false); });
  }

  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const tmp = new THREE.Vector3(), ndc = new THREE.Vector2();
  function worldFromClient(cx, cy, out) {
    const r = view.rect || (view.rect = canvas.getBoundingClientRect());
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    out = out || { x: 0, y: 0 };
    if (ray.ray.intersectPlane(plane, tmp)) { out.x = tmp.x; out.y = tmp.y; } else { out.x = 0; out.y = 0; }
    return out;
  }
  function clientFromWorld(x, y, z = 0, out) {
    tmp.set(x, y, z).project(camera);
    const r = view.rect || (view.rect = canvas.getBoundingClientRect());
    if (!out) out = {};
    out.x = r.left + ((tmp.x + 1) / 2) * r.width; out.y = r.top + ((1 - tmp.y) / 2) * r.height; return out;
  }

  const cam0 = { zoom: 1, fx: 0, fy: 0, sx: 0, sy: 0 }, camSt = { z: -1, x: 0, y: 0 };
  function render(dt, head, touch, annoyance = 0, cam = cam0) {
    const t0 = performance.now();
    { // camera: zoom toward a point (the container) and shake
      const z = cam.zoom || 1, t = (T.tiltDeg * Math.PI) / 180, D = 60, yc = view.yc;
      const cx = cam.fx * (cam.cxk !== undefined ? cam.cxk : 1 - 1 / z), cy = yc + (cam.fy - yc) * (cam.cyk !== undefined ? cam.cyk : 1 - 1 / z) - (cam.lift || 0);
      const px = cx + cam.sx, py = cy + cam.sy;
      if (z !== camSt.z || px !== camSt.x || py !== camSt.y) { // (only touch the camera when it actually moved: no matrix work on a still frame)
        if (z !== camSt.z) { camera.zoom = z; camera.updateProjectionMatrix(); }
        camera.position.set(px, py + D * Math.sin(t), D * Math.cos(t)); camera.lookAt(px, py, 0); camera.updateMatrixWorld(true);
        camSt.z = z; camSt.x = px; camSt.y = py; view.ver++;
      }
      view.zoom = z; view.sx = cam.sx; view.sy = cam.sy;
    }
    if (glowSt.t < 1.8) { // the target pulses once so you see where to go
      glowSt.t += dt; const u = Math.min(1, glowSt.t / 1.4), a = Math.sin(Math.PI * u), r = glowSt.r * (0.85 + 0.3 * u);
      glow.visible = glowSt.t < 1.4; glow.material.opacity = 0.9 * a * a; glow.position.set(glowSt.x, glowSt.y, -0.2); glow.scale.set(r / 5, r / 5, 1);
    } else glow.visible = false;
    const n = phoebus.writeCapsules(cat, Math.max(dt, 1 / 120), capA, capB);
    bodyMat.uniforms.uN.value = n; bodyMat.uniforms.uFlash.value = phoebus.feel && phoebus.feel.flash > 0 ? 0.55 : 0;
    // world bounding box of the cat (+ margin for the radius, outline and smooth blend)
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { // (from the capsules actually drawn)
      const o = i * 4, m = QM;
      const ax = capA[o], ay = capA[o + 1], ar = capA[o + 2] + m, bx = capB[o], by = capB[o + 1], br = capB[o + 2] + m;
      if (ax - ar < x0) x0 = ax - ar; if (ax + ar > x1) x1 = ax + ar; if (ay - ar < y0) y0 = ay - ar; if (ay + ar > y1) y1 = ay + ar;
      if (bx - br < x0) x0 = bx - br; if (bx + br > x1) x1 = bx + br; if (by - br < y0) y0 = by - br; if (by + br > y1) y1 = by + br;
    }
    if (cat.swirlT > 0.45) { x0 = cat.swirlX - cat.swirlR - 0.85; x1 = cat.swirlX + cat.swirlR + 0.85; y0 = cat.swirlY - cat.swirlR * 0.92 - 0.85; y1 = cat.swirlY + cat.swirlR * 0.92 + 0.85; }
    bodyMesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    bodyMesh.scale.set(x1 - x0, y1 - y0, 1);
    phoebus.setAnnoyance(annoyance);
    phoebus.update(dt, phoebus.drawHead || head, touch);
    renderer.render(scene, camera);
    perf.renderMs += ((performance.now() - t0) - perf.renderMs) * 0.1;
  }

  // Frame-time tracking. Call once per rendered frame with the real frame time (ms).
  const ftHist = new Float32Array(120); let ftI = 0, ftN = 0;
  function trackFrame(ms) {
    perf.frameMs += (ms - perf.frameMs) * 0.05;
    perf.fps = 1000 / perf.frameMs;
    ftHist[ftI] = ms; ftI = (ftI + 1) % ftHist.length; if (ftN < ftHist.length) ftN++;
    let w = 0; for (let i = 0; i < ftN; i++) if (ftHist[i] > w) w = ftHist[i];
    perf.worstMs = w;
  }

  if (container) setContainer(container);
  resize(true);
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', queueResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueResize);

  Object.assign(rend, { drawnProbe, setContainerFx, setShelfDip, setToySway, setPR, renderer, canvas, camera, scene, phoebus, view, resize, perf, trackFrame, render, worldFromClient, clientFromWorld, setContainer, setLevel, buildProps, updateProps, updateTreats, updateCucumbers, updateToys, updateCushions, squashCushion, setContainerX, pulseGlow });
  return rend;
}
