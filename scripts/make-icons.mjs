// Procedural app icons (no image tools needed): Phoebus's face on a teal tile, rasterised here and written as PNGs.
// node scripts/make-icons.mjs  ->  public/icons/{favicon,apple-touch-icon,icon-192,icon-512}.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// signed distance shapes in a 0..1 square; returns coverage with 1 px of antialiasing
const shapes = [
  { c: '#CFE6E3', d: (x, y) => Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) - 0.5 },                   // the tile (the OS rounds the corners)
  { c: '#24222B', d: (x, y) => Math.hypot((x - 0.5) / 1.0, (y - 0.58) / 0.92) - 0.33 },                      // head
  { c: '#24222B', d: (x, y) => triD(x, y, [0.2, 0.46], [0.24, 0.16], [0.42, 0.3]) },                         // ears
  { c: '#24222B', d: (x, y) => triD(x, y, [0.8, 0.46], [0.76, 0.16], [0.58, 0.3]) },
  { c: '#FFFFFF', d: (x, y) => Math.hypot((x - 0.5) / 0.55, (y - 0.7) / 1.5) - 0.1 },                        // blaze
  { c: '#9BD66B', d: (x, y) => Math.hypot((x - 0.385) / 0.9, (y - 0.54) / 1.1) - 0.065 },                    // eyes
  { c: '#9BD66B', d: (x, y) => Math.hypot((x - 0.615) / 0.9, (y - 0.54) / 1.1) - 0.065 },
  { c: '#24222B', d: (x, y) => Math.hypot((x - 0.385) / 0.35, (y - 0.54) / 1.0) - 0.04 },
  { c: '#24222B', d: (x, y) => Math.hypot((x - 0.615) / 0.35, (y - 0.54) / 1.0) - 0.04 },
  { c: '#F07C93', d: (x, y) => Math.hypot((x - 0.5), (y - 0.655) / 0.8) - 0.028 },                           // nose
];
function triD(px, py, a, b, c) { // approximate: negative inside
  const e = (p, q) => (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]);
  const s = Math.sign(e(a, b) * 1 + 0) || 1, inside = [e(a, b), e(b, c), e(c, a)].every((v) => v * s >= 0) || [e(a, b), e(b, c), e(c, a)].every((v) => v * s <= 0);
  return inside ? -0.01 : 0.05;
}
function render(S) {
  const buf = Buffer.alloc(S * S * 4), AA = 1 / S;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i + 0.5) / S, y = (j + 0.5) / S; let r = 0, g = 0, b = 0;
    for (const s of shapes) { const a = Math.max(0, Math.min(1, 0.5 - s.d(x, y) / AA)); if (a > 0) { const c = hex(s.c); r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a; } }
    const o = (j * S + i) * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
  return png(S, S, buf);
}
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size] of [['favicon', 64], ['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]]) writeFileSync(new URL(`../public/icons/${name}.png`, import.meta.url), render(size));
writeFileSync(new URL('../public/manifest.webmanifest', import.meta.url), JSON.stringify({
  name: 'Liquid', short_name: 'Liquid', description: 'Pounce a very squishy tuxedo cat into containers.', start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#DDEBEA', theme_color: '#DDEBEA', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
}, null, 2));
console.log('icons and manifest written');
