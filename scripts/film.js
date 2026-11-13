// Dev-only contact-sheet helper for judging motion when the tab's rAF is throttled.
// Paste into the console (or fetch + eval) on a ?debug page. Not part of the game.
(() => {
  const D = () => GAME.debug;
  function sheet() {
    let ov = document.getElementById('filmov');
    if (!ov) {
      ov = document.createElement('canvas'); ov.id = 'filmov';
      ov.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;background:#fff';
      document.body.appendChild(ov);
    }
    ov.style.display = 'block';
    ov.width = innerWidth * 2; ov.height = innerHeight * 2;
    const c = ov.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, ov.width, ov.height);
    return { ov, c };
  }
  // n frames, each: before(i) then advance dtPer seconds, then capture. cols x rows grid.
  window.film = (n, dtPer, before, cols = 3) => {
    const cv = GAME.rend.canvas, { ov, c } = sheet();
    const rows = Math.ceil(n / cols), tw = ov.width / cols, th = ov.height / rows;
    const sc = cv.width / innerWidth;
    for (let i = 0; i < n; i++) {
      if (before) before(i);
      if (dtPer > 0) D().advance(dtPer);
      const sh = Math.min(cv.height - 60 * sc, (th / tw) * cv.width);
      c.drawImage(cv, 0, 60 * sc, cv.width, sh, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
      c.fillStyle = '#c00'; c.font = '20px monospace';
      c.fillText(i + ' fit' + GAME.state.fit, (i % cols) * tw + 6, Math.floor(i / cols) * th + 22);
    }
  };
  window.unfilm = () => { const o = document.getElementById('filmov'); if (o) o.style.display = 'none'; };
  // Drag from a to b over `dragFrames` frames (each dtPer s), hold `hold` frames, release, then `after` frames.
  window.dragFilm = (a, b, { dragFrames = 3, hold = 2, after = 4, dtPer = 0.12, cols = 3 } = {}) => {
    let id = null;
    film(dragFrames + hold + after, 0, (i) => {
      if (i === 0) id = D().down(a[0], a[1]);
      const sub = Math.round(dtPer * 60);
      for (let s = 1; s <= sub; s++) {
        if (i < dragFrames) {
          const k = (i + s / sub) / dragFrames;
          D().move(id, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
        }
        if (i === dragFrames + hold && s === 1) D().release(id);
        D().advance(1 / 60, s === sub);
      }
    }, cols);
  };
})();
