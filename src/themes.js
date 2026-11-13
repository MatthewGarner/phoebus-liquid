// The four places the game happens: 6 levels each. A backdrop is drawn ONCE to a canvas (wallpaper or tiles, a window with light shafts, a few silhouetted furnishings, a soft vignette)
// and shown as a single textured quad; the room's floor and walls just take the theme's palette. Gameplay objects stay high-contrast against every theme.
export const THEMES = [
  { id: 'kitchen', name: 'The kitchen', wallTop: '#F6EEDC', wallBot: '#EAD9BA', floor: '#D8CDB6', joint: '#B9AB8E', skirt: '#F1E7D2', board: '#C6B99F', outside: '#D9CDB4', wallA: '#E7D9BF', wallB: '#B8A888', wallC: '#CBBB9E', shelf: { top: '#D9B88A', edge: '#B8935F', end: '#A98550', bracket: '#B8935F' }, ink: '#A8946C' },
  { id: 'living', name: 'The living room', wallTop: '#F1E6DA', wallBot: '#E3CDB8', floor: '#D3B592', joint: '#B2916B', skirt: '#F4EBDF', board: '#C2A27C', outside: '#D8C3AE', wallA: '#E8D6C3', wallB: '#BFA283', wallC: '#CDB59B', shelf: { top: '#8C6A4B', edge: '#6B4E36', end: '#5C4130', bracket: '#6B4E36' }, ink: '#A98466' },
  { id: 'garden', name: 'The greenhouse', wallTop: '#E4F2EA', wallBot: '#BFE0CB', floor: '#C7B59A', joint: '#A99677', skirt: '#DCEBE0', board: '#B7A589', outside: '#B5D8C2', wallA: '#C9E4D3', wallB: '#8DBBA0', wallC: '#A3CDB4', shelf: { top: '#E8E4D8', edge: '#B8B4A6', end: '#A9A597', bracket: '#9FA99F' }, ink: '#5E9A78' },
  { id: 'attic', name: 'The attic at night', wallTop: '#3B3F6B', wallBot: '#2A2D52', floor: '#4A3F4F', joint: '#372E3C', skirt: '#44385A', board: '#3B3243', outside: '#262847', wallA: '#343765', wallB: '#202244', wallC: '#2C2E58', shelf: { top: '#B98F63', edge: '#8F6B47', end: '#7C5C3D', bracket: '#8F6B47' }, ink: '#8A8FD0' },
];
export const themeOfLevel = (id) => Math.min(THEMES.length - 1, Math.floor((id - 1) / 6));

// the backdrop: wall x from -9 to 9 (18 wide), y from 0 to 40 (40 tall), drawn at 18 px per world unit horizontally... a 360 x 800 canvas
export function drawBackdrop(i) {
  const th = THEMES[i], W = 360, H = 800, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const Y = (wy) => H - wy * 20, X = (wx) => (wx + 9) * 20; // world -> canvas
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, th.wallTop); gr.addColorStop(1, th.wallBot); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (i === 0) { // kitchen: tiles on the lower wall, a window, shelves of jars
    g.strokeStyle = 'rgba(160,140,100,0.16)'; g.lineWidth = 1.2; for (let r = 0; r < 14; r++) for (let c = 0; c < 10; c++) g.strokeRect(c * 36 + (r % 2 ? 18 : 0) - 18, Y(r * 1.0 + 1.0), 36, 20);
    g.fillStyle = 'rgba(160,140,100,0.07)'; g.fillRect(0, Y(15), W, 300); // tile apron
  } else if (i === 1) { // living room: stripes, a picture, a lamp
    for (let c = 0; c < 18; c++) { g.fillStyle = c % 2 ? 'rgba(169,132,102,0.13)' : 'rgba(255,255,255,0.06)'; g.fillRect(c * 20, 0, 20, H); }
    g.fillStyle = 'rgba(120,88,64,0.45)'; g.fillRect(X(-6), Y(25), 80, 60); g.fillStyle = 'rgba(244,235,223,0.55)'; g.fillRect(X(-6) + 6, Y(25) + 6, 68, 48);
  } else if (i === 2) { // greenhouse: window panes, hanging leaves
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3; for (let c = 1; c < 6; c++) { g.beginPath(); g.moveTo(c * 60, 0); g.lineTo(c * 60, H * 0.7); g.stroke(); } for (let r = 1; r < 8; r++) { g.beginPath(); g.moveTo(0, r * 90); g.lineTo(W, r * 90); g.stroke(); }
    g.fillStyle = 'rgba(70,140,100,0.30)'; for (let k = 0; k < 14; k++) { const x = (k * 97) % W, y = (k * 53) % 300; g.beginPath(); g.ellipse(x, y, 10, 34, (k % 5) * 0.4 - 0.8, 0, 7); g.fill(); }
  } else { // attic at night: beams, a round window with the moon, stars
    g.strokeStyle = 'rgba(20,18,40,0.55)'; g.lineWidth = 10; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, 120 + k * 190); g.lineTo(W, 60 + k * 190); g.stroke(); }
    g.fillStyle = 'rgba(255,248,200,0.85)'; for (let k = 0; k < 40; k++) { g.globalAlpha = 0.25 + ((k * 37) % 10) / 14; g.beginPath(); g.arc((k * 71) % W, (k * 113) % 420, 1 + (k % 3) * 0.6, 0, 7); g.fill(); } g.globalAlpha = 1;
  }
  // a window with light shafts (every theme)
  const wx = i === 3 ? 230 : 60, wy = 150, ww = 90, wh = 120;
  g.fillStyle = i === 3 ? 'rgba(20,24,60,0.9)' : 'rgba(255,255,255,0.55)'; g.beginPath(); if (i === 3) g.ellipse(wx + ww / 2, wy + wh / 2, ww / 2, wh / 2.2, 0, 0, 7); else g.rect(wx, wy, ww, wh); g.fill();
  g.strokeStyle = th.ink; g.lineWidth = 5; g.stroke(); g.lineWidth = 3; g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.moveTo(wx, wy + wh / 2); g.lineTo(wx + ww, wy + wh / 2); g.stroke();
  if (i === 3) { g.fillStyle = 'rgba(255,250,215,0.95)'; g.beginPath(); g.arc(wx + ww * 0.62, wy + wh * 0.38, 15, 0, 7); g.fill(); }
  g.fillStyle = i === 3 ? 'rgba(190,200,255,0.07)' : 'rgba(255,248,215,0.11)'; for (const k of [0, 1]) { g.beginPath(); g.moveTo(wx + 10 + k * 40, wy + wh); g.lineTo(wx + 40 + k * 40, wy + wh); g.lineTo(wx + 200 + k * 90, H - 90); g.lineTo(wx + 100 + k * 90, H - 90); g.closePath(); g.fill(); }
  // silhouetted furnishings standing on the floor line (low contrast: they are set dressing)
  g.fillStyle = th.ink; g.globalAlpha = 0.28; const fy = H - 14;
  if (i === 0) { g.fillRect(0, fy - 70, 120, 70); g.fillRect(250, fy - 90, 110, 90); for (let k = 0; k < 3; k++) g.fillRect(6 + k * 38, fy - 70, 30, 6); }
  else if (i === 1) { g.fillRect(0, fy - 56, 150, 56); g.fillRect(8, fy - 90, 134, 38); g.fillRect(300, fy - 110, 8, 110); g.beginPath(); g.moveTo(286, fy - 110); g.lineTo(322, fy - 110); g.lineTo(314, fy - 140); g.lineTo(294, fy - 140); g.fill(); }
  else if (i === 2) { for (const [x, h] of [[20, 60], [90, 90], [270, 70], [330, 100]]) { g.fillRect(x, fy - 26, 30, 26); g.beginPath(); g.ellipse(x + 15, fy - 26 - h * 0.5, 22, h * 0.55, 0, 0, 7); g.fill(); } }
  else { g.fillRect(10, fy - 46, 90, 46); g.fillRect(40, fy - 74, 70, 28); g.fillRect(270, fy - 60, 80, 60); g.beginPath(); g.arc(300, fy - 66, 24, Math.PI, 0); g.fill(); }
  g.globalAlpha = 1;
  // a soft vignette
  gr = g.createRadialGradient(W / 2, H * 0.55, W * 0.35, W / 2, H * 0.55, H * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, i === 3 ? 'rgba(5,5,20,0.45)' : 'rgba(40,60,50,0.16)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return cv;
}
