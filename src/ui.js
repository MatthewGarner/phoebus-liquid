// DOM HUD over the canvas: play HUD, the first-play coach, result card, level list.
import { build } from './containers.js';

const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
const FINGER = '<svg viewBox="0 0 48 64" width="44" height="58" aria-hidden="true"><path d="M16 30V10a6 6 0 0 1 12 0v18l9 2c4 1 6 4 6 8v8c0 8-6 14-14 14h-6c-6 0-10-3-12-8l-6-12c-2-3 2-7 5-4l4 5z" fill="#fff" stroke="#1f3a3d" stroke-width="3" stroke-linejoin="round"/></svg>';

const FISH = '<svg viewBox="0 0 32 20" width="22" height="14" aria-hidden="true"><path d="M2 10 L8 3 L10 10 L8 17 Z" fill="#F29A55" stroke="#B85F22" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="17" cy="10" rx="10.5" ry="6.6" fill="#FFC470" stroke="#B85F22" stroke-width="1.6"/><path d="M14 4 Q18 0 22 4" fill="#F29A55" stroke="#B85F22" stroke-width="1.4"/><circle cx="23" cy="8.5" r="1.5" fill="#2A1C14"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
const TAPHAND = '<svg viewBox="0 0 48 56" width="40" height="46" aria-hidden="true"><path d="M17 26V10a5.5 5.5 0 0 1 11 0v14l8 2c4 1 6 4 6 8v7c0 7-6 12-13 12h-5c-6 0-9-3-11-7l-5-11c-2-3 2-6 4-4l3 4z" fill="#fff" stroke="#1f3a3d" stroke-width="3" stroke-linejoin="round"/><path d="M9 6a12 12 0 0 1 8-4M39 6a12 12 0 0 0-8-4" fill="none" stroke="#1f3a3d" stroke-width="3" stroke-linecap="round"/></svg>';

const COAT = '#24222B';

// Atlas icon drawn from the container's own profile and colours (viewBox 120 x 70).
export function containerIcon(def, withCat = true) {
  const B = build(def), c = def.colors;
  const maxR = Math.max(...B.outer.map((p) => p[0])) + (def.handle ? 0.3 : 0);
  const s = Math.min(50 / (B.rimY + 0.4), 46 / maxR);
  const cx = 60, base = 62;
  const X = (r, sgn) => (cx + sgn * r * s).toFixed(1), Y = (y) => (base - y * s).toFixed(1);
  let d = '';
  const n = B.outer.length;
  for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + X(B.outer[i][0], 1) + ' ' + Y(B.outer[i][1]);
  for (let i = n - 1; i >= 0; i--) d += 'L' + X(B.outer[i][0], -1) + ' ' + Y(B.outer[i][1]);
  d += 'Z';
  const id = 'ic-' + def.id;
  const rimR = B.outerRimR * s, rimCy = base - B.rimY * s, ry = Math.max(3, rimR * 0.2);
  const fillOp = def.glass ? 0.75 : 1;
  let g = '';
  if (def.saucer) g += `<ellipse cx="${cx}" cy="${base + 1}" rx="${Math.min(56, (def.saucer.rx / maxR) * 40 + 8)}" ry="5" fill="${c.saucerShade}" stroke="${c.line}" stroke-width="1.5"/>`;
  if (def.handle) {
    const hy = base - def.handle.y * B.height * s, r0 = B.outer[Math.round(n * 0.55)][0] * s;
    g += `<path d="M${(cx + r0).toFixed(1)} ${(hy - 7).toFixed(1)} C ${(cx + r0 + 17).toFixed(1)} ${(hy - 9).toFixed(1)}, ${(cx + r0 + 17).toFixed(1)} ${(hy + 10).toFixed(1)}, ${(cx + r0 - 1).toFixed(1)} ${(hy + 8).toFixed(1)}" fill="none" stroke="${c.line}" stroke-width="6.5" stroke-linecap="round"/>` +
      `<path d="M${(cx + r0).toFixed(1)} ${(hy - 7).toFixed(1)} C ${(cx + r0 + 17).toFixed(1)} ${(hy - 9).toFixed(1)}, ${(cx + r0 + 17).toFixed(1)} ${(hy + 10).toFixed(1)}, ${(cx + r0 - 1).toFixed(1)} ${(hy + 8).toFixed(1)}" fill="none" stroke="${c.body}" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  g += `<clipPath id="${id}"><path d="${d}"/></clipPath>`;
  g += `<path d="${d}" fill="${c.body}" fill-opacity="${fillOp}"/>`;
  g += `<g clip-path="url(#${id})">`;
  for (const b of def.bands || []) {
    const y0 = b.y * B.height - b.height / 2, y1 = y0 + b.height;
    g += `<rect x="0" y="${Y(y1)}" width="120" height="${((y1 - y0) * s).toFixed(1)}" fill="${c[b.color] || c.stripe}" opacity="${b.extra ? 1 : 0.95}"/>`;
  }
  g += '</g>';
  g += `<path d="${d}" fill="none" stroke="${c.line}" stroke-width="2" stroke-linejoin="round"/>`;
  g += `<ellipse cx="${cx}" cy="${rimCy.toFixed(1)}" rx="${rimR.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${c.shade}" stroke="${c.line}" stroke-width="2"/>`;
  if (withCat) {
    const w = rimR * 0.78;
    g += `<path d="M${(cx - w).toFixed(1)} ${rimCy.toFixed(1)} C ${(cx - w).toFixed(1)} ${(rimCy - 26).toFixed(1)}, ${(cx + w).toFixed(1)} ${(rimCy - 26).toFixed(1)}, ${(cx + w).toFixed(1)} ${rimCy.toFixed(1)} Z" fill="${COAT}"/>`;
    g += `<path d="M${(cx - w * 0.75).toFixed(1)} ${(rimCy - 14).toFixed(1)} l-2 -11 l10 6 Z M${(cx + w * 0.75).toFixed(1)} ${(rimCy - 14).toFixed(1)} l2 -11 l-10 6 Z" fill="${COAT}"/>`;
    g += `<path d="M${(cx - rimR).toFixed(1)} ${rimCy.toFixed(1)} A ${rimR.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${(cx + rimR).toFixed(1)} ${rimCy.toFixed(1)}" fill="none" stroke="${c.line}" stroke-width="2"/>`;
  }
  return `<svg width="100%" height="70" viewBox="0 0 120 70" aria-hidden="true">${g}</svg>`;
}

const starsText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

export function createUI(parent, cb, opts = {}) {
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = `
    <div class="top">
      <button class="icon-btn" id="back" aria-label="Back to the levels" type="button">${BACK}</button>
      <div class="titles"><span class="title" id="title"></span><span class="subtitle" id="subtitle"></span></div>
      <button class="icon-btn" id="mute" aria-label="Mute" type="button">${SPEAKER}</button>
    </div>
    <div class="coach" id="coach">
      <svg class="coach-svg" id="coach-svg" width="100%" height="100%"><g id="coach-dots"></g></svg>
      <div class="finger" id="finger">${FINGER}</div>
      <div class="coach-text">Pull back and let go. He pounces.</div>
    </div>
    <svg class="aim" id="aim" width="100%" height="100%"><line id="aim-line" x1="0" y1="0" x2="0" y2="0"/><circle id="aim-ring-bg" r="30"/><circle id="aim-ring" r="30" transform="rotate(-90)"/><circle id="aim-tip" r="8"/><g id="aim-dots"></g></svg>
    <div class="dropcoach" id="dropcoach"><span class="tapg">${TAPHAND}</span><span id="dropcoach-t">Tap in the air to drop.</span></div>
    <div class="toast" id="toast"></div>
    <div class="win" id="win">
      <div class="win-stars" id="win-stars"></div>
      <div class="win-fit" id="win-fit"></div>
      <div class="meter win-meter" id="win-meter"><span class="meter-l">Menace</span><span class="meter-bar"><i id="win-meter-i"></i></span></div>
      <div class="win-btns">
        <button class="btn win-next" id="win-next" type="button">Next</button>
        <div class="win-row"><button class="btn win-again" id="win-again" type="button">Again</button><button class="icon-btn win-share" id="win-share" type="button" aria-label="Share a picture">${SHARE}</button></div>
      </div>
    </div>
    <div class="wipe" id="wipe"></div>
    <div class="bottom">
      <div class="strip">
        <span class="chip" id="leaps">Leaps 0/1</span>
        <span class="chip treatchip" id="treats"><span class="fishg">${FISH}</span><b id="treatn">0/3</b></span>
        <span class="chip" id="knocked">Knocked 0/0</span>
        <button class="btn again" id="again" type="button">Again</button>
      </div>
    </div>
    <div class="result" id="result">
      <div class="rstars" id="rstars"></div>
      <div class="polaroid">
        <img id="snap" alt="Phoebus in a container">
        <div class="stamp" id="stamp"></div>
        <div class="newbest" id="newbest">New best!</div>
        <div class="menace" id="menace">Menace</div>
        <div class="caption" id="caption"></div>
        <div class="stats" id="stats"></div>
      </div>
      <div class="rbuttons">
        <button class="btn ghost" id="r-again" type="button">Again</button>
        <button class="btn amber" id="r-next" type="button">Next</button>
        <button class="btn dark" id="r-share" type="button">Share</button>
      </div>
      <button class="link" id="r-atlas" type="button">Levels</button>
    </div>
    <div class="atlas" id="atlas">
      <div class="atlas-head">
        <p class="atlas-kicker" id="atlas-kicker"></p>
        <h1 class="atlas-title" id="atlas-title"></h1>
        <div class="meter" id="atlas-meter" title="Menace"><span class="meter-l">Menace</span><span class="meter-bar"><i id="atlas-meter-i"></i></span></div>
      </div>
      <div class="atlas-grid" id="atlas-grid"></div>
      <div class="atlas-foot"><button class="pill" id="atlas-play" type="button"></button>
        <div class="atlas-links"><button class="link" id="atlas-title-btn" type="button">Title</button><button class="link" id="atlas-moments" type="button">Moments</button><button class="link" id="atlas-settings" type="button">Settings</button></div></div>
    </div>`;
  parent.appendChild(hud);
  const $ = (id) => hud.querySelector('#' + id);
  const el = {
    again: $('again'), mute: $('mute'), leaps: $('leaps'), knocked: $('knocked'),
    toast: $('toast'), result: $('result'), snap: $('snap'), stamp: $('stamp'), title: $('title'), subtitle: $('subtitle'),
    coach: $('coach'), coachDots: $('coach-dots'), finger: $('finger'), atlas: $('atlas'), grid: $('atlas-grid'),
    rNext: $('r-next'), caption: $('caption'), stats: $('stats'), newbest: $('newbest'), menace: $('menace'), rstars: $('rstars'),
    treats: $('treats'), treatn: $('treatn'), aim: $('aim'), aimLine: $('aim-line'), aimRing: $('aim-ring'), aimRingBg: $('aim-ring-bg'), aimTip: $('aim-tip'), aimDots: $('aim-dots'),
    dropcoach: $('dropcoach'), win: $('win'), winStars: $('win-stars'), winFit: $('win-fit'), winNext: $('win-next'), wipe: $('wipe'), winMeter: $('win-meter'),
  };

  el.again.onclick = () => cb.onAgain();
  $('win-next').onclick = () => cb.onNext();
  $('win-again').onclick = () => cb.onAgain();
  $('win-share').onclick = () => cb.onCard();
  $('back').onclick = () => cb.onAtlas();
  $('r-again').onclick = () => cb.onAgain();
  $('r-next').onclick = () => cb.onNext();
  $('r-share').onclick = () => cb.onShare();
  $('r-atlas').onclick = () => cb.onClose();
  $('atlas-play').onclick = () => cb.onPlay(+el.atlas.dataset.next);
  $('atlas-title-btn').onclick = () => cb.onTitle();
  $('atlas-moments').onclick = () => cb.onMoments();
  $('atlas-settings').onclick = () => cb.onSettings();
  el.mute.onclick = () => { const m = cb.onMute(); el.mute.innerHTML = m ? MUTED : SPEAKER; };
  const setMuted = (m) => { el.mute.innerHTML = m ? MUTED : SPEAKER; };

  let toastT = 0;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  function setHeader(name, hint) { el.title.textContent = name; el.subtitle.textContent = hint; }

  let lastTreats = '';
  function setTreats(n, total) {
    const t = `${n}/${total}`;
    if (t !== lastTreats) { const up = lastTreats && n > +lastTreats[0]; lastTreats = t; el.treatn.textContent = t; if (up) { el.treats.classList.remove('pop'); void el.treats.offsetWidth; el.treats.classList.add('pop'); } }
  }
  let lastLeaps = '', lastKnocked = '';
  function setLeaps(n, par) { const t = `Leaps ${n}/${par}`; if (t !== lastLeaps) { lastLeaps = t; el.leaps.textContent = t; el.leaps.classList.toggle('over', n > par); } }
  function setKnocked(n, total) {
    const t = `Knocked ${n}/${total}`;
    if (t !== lastKnocked) { lastKnocked = t; el.knocked.textContent = t; el.knocked.style.display = total ? '' : 'none'; }
  }

  // the coach: a finger pulls back from the cat and the dotted arc shows where he will go.
  // g: { fx, fy: where the finger starts (client px), dx, dy: how far it pulls back, dots: [{x, y}] client px }
  let lastCoach = null;
  function setCoach(show, g) {
    show = !!show;
    if (show && g) {
      el.coach.style.setProperty('--fx', g.fx.toFixed(0) + 'px'); el.coach.style.setProperty('--fy', g.fy.toFixed(0) + 'px');
      el.coach.style.setProperty('--dx', g.dx.toFixed(0) + 'px'); el.coach.style.setProperty('--dy', g.dy.toFixed(0) + 'px');
      let h = '';
      g.dots.forEach((d, i) => { const r = 5.5 * (1 - 0.55 * i / g.dots.length); h += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${r.toFixed(1)}" fill="#E06A47" stroke="#fff" stroke-width="2"/>`; });
      el.coachDots.innerHTML = h;
    }
    if (show !== lastCoach) { lastCoach = show; el.coach.classList.toggle('show', show); }
  }

  const stampFor = (fit, stars) => {
    if (fit >= 100) return { text: 'IF I FITS I SITS', teal: true };
    if (fit >= 95) return { text: 'SNUG AS A BUG' };
    if (fit >= 85) return { text: 'MOSTLY FITS' };
    return { text: stars ? 'GOOD ENOUGH' : 'LIQUID SPILL' };
  };
  // r: { url, fit, stars, leaps, par, knocked, total, menace, name, newBest, hasNext }
  function showResult(r) {
    el.snap.src = r.url;
    const st = stampFor(r.fit, r.stars);
    el.stamp.textContent = `${st.text} · ${r.fit}%`;
    el.stamp.classList.toggle('teal', !!st.teal);
    el.caption.textContent = `Phoebus × ${r.name}`;
    el.rstars.innerHTML = [0, 1, 2].map((i) => `<span class="rstar ${i < r.stars ? 'on' : ''}" style="animation-delay:${0.35 + i * 0.22}s">★</span>`).join('');
    el.stats.innerHTML = `<span>Fit <b>${r.fit}%</b></span><span>Treats <b>${r.stars}/3</b></span><span>Leaps <b>${r.leaps}</b> · par ${r.par}</span>${r.total ? `<span>Knocked <b>${r.knocked}/${r.total}</b></span>` : ''}`;
    el.newbest.style.display = r.newBest ? 'block' : 'none';
    el.menace.style.display = r.menace ? 'block' : 'none';
    el.rNext.style.display = r.hasNext ? '' : 'none';
    el.result.classList.add('show');
  }
  function hideResult() { el.result.classList.remove('show'); }
  const resultShown = () => el.result.classList.contains('show');

  // model: { levels: [{index, id, name, def, stars, bestFit, unlocked, lockHint}], count, total, meanPct, next, nextName, allDone }
  function showAtlas(m) {
    $('atlas-meter-i').style.width = Math.round(100 * (m.menace || 0)) + '%'; $('atlas-meter').classList.toggle('full', (m.menace || 0) >= 1);
    $('atlas-kicker').textContent = `The levels · ${m.count} / ${m.total}`;
    $('atlas-title').innerHTML = `Phoebus is <span>${m.pct}% liquid</span>`;
    el.grid.innerHTML = '';
    let lastTheme = -1;
    for (const c of m.levels) {
      if (m.themes && c.theme !== lastTheme) { lastTheme = c.theme; const th = m.themes[c.theme], h = document.createElement('div'); h.className = 'chapter'; const got = m.levels.filter((q) => q.theme === c.theme).reduce((a, q) => a + q.stars, 0), tot = m.levels.filter((q) => q.theme === c.theme).length * 3; h.innerHTML = `<span>${th}</span><span>${got} / ${tot} \u2605</span>`; el.grid.appendChild(h); }
      const card = document.createElement(c.unlocked ? 'button' : 'div');
      card.className = 'card' + (c.unlocked ? '' : ' locked') + (c.purrfect ? ' perfect' : '');
      if (c.unlocked) {
        card.type = 'button';
        card.onclick = () => cb.onPlay(c.index);
        const badges = (c.purrfect ? '<span class="badge purr">Purrfect</span>' : '') + (c.menace ? '<span class="badge badge-m">Menace</span>' : '');
        const sub = c.done ? `<span class="card-sub stars-t">${starsText(c.stars)}${badges}</span>` : '<span class="card-sub muted">Not tried yet</span>';
        card.innerHTML = `${containerIcon(c.def, c.done)}<span class="card-name"><span class="card-num">${c.id}</span> ${c.name}</span>${sub}`;
      } else {
        card.innerHTML = `<svg width="100%" height="70" viewBox="0 0 120 70" aria-hidden="true"><circle cx="60" cy="38" r="28" fill="none" stroke="#9DB7B5" stroke-width="5"/><text x="60" y="48" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="28" font-weight="700" fill="#3E5A5C">?</text></svg>` +
          `<span class="card-name"><span class="card-num">${c.id}</span> ${c.name}</span><span class="card-sub locked-t">${c.lockHint}</span>`;
      }
      el.grid.appendChild(card);
    }
    el.atlas.dataset.next = m.next;
    $('atlas-play').textContent = m.allDone ? `All done · Play level ${m.next + 1}` : `Play · Level ${m.next + 1}: ${m.nextName}`;
    el.atlas.classList.add('show');
    el.atlas.scrollTop = 0;
  }
  function hideAtlas() { el.atlas.classList.remove('show'); }
  const atlasShown = () => el.atlas.classList.contains('show');

  // sparkle / heart burst at a client position
  function burst(cx, cy) {
    const glyphs = ['♥', '✦', '♥', '✧', '♥'];
    const colors = ['#E8708A', '#F2B63C', '#E06A47', '#2E9C8F', '#F2A7A0'];
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('span');
      s.className = 'burst';
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.color = colors[i % colors.length];
      s.style.fontSize = 14 + Math.random() * 18 + 'px';
      hud.appendChild(s);
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 60;
      s.animate([
        { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(${(Math.random() - 0.5) * 80}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 40}px)) scale(0.8)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  }

  // ---- the aim: an elastic line from where the touch began, a power ring that fills (teal -> amber -> coral), the dotted arc ----
  const mixHex = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const powerColor = (p) => (p < 0.5 ? mixHex('#2E9C8F', '#F2B63C', p / 0.5) : mixHex('#F2B63C', '#E06A47', (p - 0.5) / 0.5));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const dotEls = [];
  for (let i = 0; i < 16; i++) { const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('cx', '0'); c.setAttribute('cy', '0'); el.aimDots.appendChild(c); dotEls.push(c); }
  const RING = 2 * Math.PI * 30;
  let aimShown = false;
  // m: { sx, sy, fx, fy (client px), power 0..1, dots: [{x, y, r, a}] } or null
  function setAim(m) {
    if (!m) { if (aimShown) { aimShown = false; el.aim.classList.remove('on'); } return; }
    if (!aimShown) { aimShown = true; el.aim.classList.add('on'); }
    const col = powerColor(m.power);
    el.aimLine.setAttribute('x1', m.sx.toFixed(1)); el.aimLine.setAttribute('y1', m.sy.toFixed(1)); el.aimLine.setAttribute('x2', m.fx.toFixed(1)); el.aimLine.setAttribute('y2', m.fy.toFixed(1));
    el.aimLine.setAttribute('stroke', col); el.aimLine.setAttribute('stroke-width', (4 + 5 * m.power).toFixed(1));
    el.aimRingBg.setAttribute('cx', m.sx.toFixed(1)); el.aimRingBg.setAttribute('cy', m.sy.toFixed(1));
    el.aimRing.setAttribute('transform', `translate(${m.sx.toFixed(1)} ${m.sy.toFixed(1)}) rotate(-90)`);
    el.aimRing.setAttribute('stroke', col); el.aimRing.setAttribute('stroke-dasharray', `${(RING * m.power).toFixed(1)} ${RING.toFixed(1)}`);
    el.aimTip.setAttribute('cx', m.fx.toFixed(1)); el.aimTip.setAttribute('cy', m.fy.toFixed(1)); el.aimTip.setAttribute('fill', col);
    for (let i = 0; i < dotEls.length; i++) {
      const d = m.dots && m.dots[i], c = dotEls[i];
      if (!d) { c.style.display = 'none'; continue; }
      c.style.display = ''; c.setAttribute('cx', d.x.toFixed(1)); c.setAttribute('cy', d.y.toFixed(1)); c.setAttribute('r', d.r.toFixed(1)); c.setAttribute('fill', col); c.setAttribute('fill-opacity', d.a.toFixed(2));
    }
  }

  // a short call-out popping near a point (client px)
  let calloutSlots = 0;
  function callout(text, cx, cy, delay = 0, dur = 900) {
    const e = document.createElement('div');
    e.className = 'callout'; e.textContent = text;
    const W = hudW(), slot = calloutSlots; calloutSlots++; // (call-outs that are up at the same time stack instead of overlapping)
    e.style.left = Math.max(70, Math.min(W - 70, cx)) + 'px'; e.style.top = Math.max(110, cy) + slot * 40 + 'px';
    hud.appendChild(e);
    e.animate([
      { transform: 'translate(-50%, 0) scale(0.4)', opacity: 0 },
      { transform: 'translate(-50%, -14px) scale(1.12)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -26px) scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -52px) scale(0.96)', opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }).onfinish = () => { e.remove(); calloutSlots = Math.max(0, calloutSlots - 1); };
  }
  let dcText = '';
  // soft help, never a fail screen: the Again chip pulses (stuck?), the level's hint pulses (many leaps)
  let pulseT = 0;
  function pulse(which) { const e = which === 'hint' ? el.subtitle : el.again; e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); clearTimeout(pulseT); pulseT = setTimeout(() => e.classList.remove('pulse'), 3600); }
  function setDropCoach(show, text = 'Tap in the air to drop.') { if (show && text !== dcText) { dcText = text; $('dropcoach-t').textContent = text; } el.dropcoach.classList.toggle('show', !!show); }

  // ---- the win, inline: stars pop above him, then Next and Again slide up ----
  // w: { treats (0..3), fit (pct), purrfect, menace, anchor: {x, y} client px of the stars, hasNext }
  function showWin(w) {
    el.winStars.innerHTML = [0, 1, 2].map((i) => `<span class="wstar ${i < w.treats ? 'on' : ''}" data-i="${i}">&#9733;</span>`).join('');
    el.winStars.style.left = hudW() / 2 + 'px';
    el.winStars.style.top = Math.max(130, w.anchor.y) + 'px';
    el.winFit.innerHTML = `${w.fit}% liquid<span class="wbs">${w.purrfect ? '<i class="wbadge">Purrfect</i>' : ''}${w.menace ? '<i class="wbadge m">Menace</i>' : ''}${w.swirl ? '<i class="wbadge s">Swirlies</i>' : ''}</span>`;
    el.winFit.style.left = el.winStars.style.left; el.winFit.style.top = (parseFloat(el.winStars.style.top) + 64) + 'px';
    el.winNext.textContent = w.destroyies ? 'Destroyies' : w.hasNext ? 'Next' : 'Levels'; el.winNext.classList.toggle('dzgo', !!w.destroyies);
    $('win-meter-i').style.width = Math.round(100 * (w.menaceFill || 0)) + '%'; $('win-meter').classList.toggle('full', !!w.destroyies);
    lastWinFit = w.fit; lastMoveX = lastMoveY = -1; el.win.classList.add('show'); hud.classList.add('winning');
  }
  let lastWinFit = -1, lastMoveX = -1, lastMoveY = -1;
  let hudWv = 0; window.addEventListener('resize', () => { hudWv = 0; });
  const hudW = () => hudWv || (hudWv = hud.clientWidth || 360); // (read once, not every frame)
  function moveWin(x, y, fitPct) {
    const X = hudW() / 2, Y = Math.max(130, y);
    if (X === lastMoveX && Y === lastMoveY && fitPct === lastWinFit) return; // (nothing changed: touch nothing, so a settled banner costs no style or layout work)
    lastMoveX = X; lastMoveY = Y;
    el.winStars.style.left = X + 'px'; el.winStars.style.top = Y + 'px'; el.winFit.style.left = X + 'px'; el.winFit.style.top = (Y + 64) + 'px'; el.winMeter.style.top = (Y - 40) + 'px';
    if (fitPct !== lastWinFit && fitPct !== undefined) { lastWinFit = fitPct; const bs = el.winFit.querySelector('.wbs'); el.winFit.innerHTML = `${fitPct}% liquid<span class="wbs">${bs ? bs.innerHTML : ''}</span>`; }
  }
  function popStar(i) { const s = el.winStars.querySelector(`[data-i="${i}"]`); if (s) s.classList.add('pop'); }
  function hideWin() { el.win.classList.remove('show'); hud.classList.remove('winning'); }
  const winShown = () => el.win.classList.contains('show');
  // a quick wipe across the screen: `mid` runs while it covers the game
  let wipeMid = null, wipeT1 = 0, wipeT2 = 0;
  function flushWipe() { // never leave the wipe covering the game (a throttled timer, a tab that was in the background)
    clearTimeout(wipeT1); clearTimeout(wipeT2);
    if (wipeMid) { const m = wipeMid; wipeMid = null; try { m(); } catch (_) { /* ignore */ } }
    el.wipe.classList.remove('in', 'out');
  }
  function wipe(mid) {
    flushWipe(); wipeMid = mid;
    el.wipe.classList.remove('out'); el.wipe.classList.add('in');
    wipeT1 = setTimeout(() => { const m = wipeMid; wipeMid = null; try { if (m) m(); } finally { el.wipe.classList.remove('in'); el.wipe.classList.add('out'); wipeT2 = setTimeout(() => el.wipe.classList.remove('out'), 150); } }, 140);
  }

  // debug readout
  let dbg = null, dbgTxt = null;
  if (opts.debug) {
    dbg = document.createElement('div');
    dbg.className = 'debug';
    dbg.innerHTML = '<span id="dbgtxt"></span>';
    hud.appendChild(dbg);
    dbgTxt = dbg.querySelector('#dbgtxt');
  }
  let lastDbg = '';
  const setDebug = (txt) => { if (dbg && txt !== lastDbg) { lastDbg = txt; dbgTxt.textContent = txt; } };

  return { pulse, flushWipe, setMuted, setHeader, setTreats, setLeaps, setKnocked, setCoach, setAim, callout, setDropCoach, showWin, hideWin, winShown, moveWin, popStar, wipe, showResult, hideResult, resultShown, showAtlas, hideAtlas, atlasShown, toast, burst, setDebug, el };
}
