// The title screen, the Moments page and the settings sheet: plain DOM over the game canvas.
export const MOMENTS = [
  { id: 'lickies', name: 'Lickies', how: 'Leave him be after a bad landing, or just sit still for a bit.', icon: '<path d="M14 40c0-12 8-22 18-22s18 10 18 22" fill="none"/><circle cx="26" cy="32" r="2.4"/><circle cx="38" cy="32" r="2.4"/><path d="M29 40q3 7 6 0" fill="#F07C93"/><path d="M12 48q4-12 10-8" fill="none"/>' },
  { id: 'kickies', name: 'Back leg kickies', how: 'Grab a catnip mouse (or yarn) in mid-air.', icon: '<ellipse cx="30" cy="34" rx="14" ry="10"/><circle cx="21" cy="25" r="5"/><circle cx="31" cy="23" r="5"/><path d="M44 36q10 2 12 12" fill="none"/><path d="M10 44l-6 6M14 48l-4 8" fill="none"/>' },
  { id: 'swirlies', name: 'Swirlies', how: 'Finish with all 3 treats in a round container.', icon: '<path d="M32 32m-3 0a3 3 0 1 1 6 0a8 8 0 1 1-16 0a14 14 0 1 1 28 0a20 20 0 1 1-40 0" fill="none"/>' },
  { id: 'destroyies', name: 'Destroyies', how: 'Fill the menace meter, then press the button.', icon: '<circle cx="32" cy="32" r="14"/><ellipse cx="32" cy="32" rx="26" ry="7" fill="none" transform="rotate(-20 32 32)"/><path d="M6 8l12 12M58 8L46 20" fill="none"/>' },
];

export function createScreens(parent, cb) {
  const root = document.createElement('div');
  root.className = 'screens';
  root.innerHTML = `
    <section class="scr title" id="scr-title">
      <div class="title-top"><button class="icon-btn" id="t-settings" type="button" aria-label="Settings">${GEAR()}</button></div>
      <div class="title-mid"><h1 class="logo">Liquid</h1><p class="tag">Phoebus is a liquid. Probably.</p></div>
      <div class="title-bot">
        <button class="btn big" id="t-play" type="button">Play</button>
        <div class="title-row"><button class="btn ghost" id="t-moments" type="button">Moments</button><button class="btn ghost" id="t-levels" type="button">Levels</button></div>
      </div>
    </section>
    <section class="scr page" id="scr-moments">
      <div class="page-head"><button class="icon-btn" id="m-back" type="button" aria-label="Back">${BACK()}</button><h2>Moments</h2><span class="page-count" id="m-count"></span></div>
      <div class="moment-grid" id="m-grid"></div>
    </section>
    <section class="scr page end" id="scr-end">
      <h2>The end. For now.</h2>
      <div class="end-stats" id="end-stats"></div>
      <div class="title-row"><button class="btn big" id="e-levels" type="button">Levels</button><button class="btn ghost" id="e-title" type="button">Title</button></div>
    </section>
    <section class="scr sheet" id="scr-settings">
      <div class="sheet-card">
        <h2>Settings</h2>
        <label class="toggle"><span>Sound</span><input type="checkbox" id="s-sound"><i></i></label>
        <label class="toggle"><span>Music</span><input type="checkbox" id="s-music"><i></i></label>
        <label class="toggle"><span>Haptics</span><input type="checkbox" id="s-haptics"><i></i></label>
        <label class="toggle"><span>Reduce motion</span><input type="checkbox" id="s-reduce"><i></i></label>
        <button class="btn ghost danger" id="s-reset" type="button">Reset progress</button>
        <p class="sheet-note" id="s-confirm" hidden>This erases stars, moments and your best Destroyies. <button class="link" id="s-yes" type="button">Yes, erase</button> <button class="link" id="s-no" type="button">Keep</button></p>
        <button class="btn" id="s-close" type="button">Done</button>
      </div>
    </section>`;
  parent.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const scr = { title: $('scr-title'), moments: $('scr-moments'), settings: $('scr-settings'), end: $('scr-end') };
  const hideAll = () => { scr.title.classList.remove('show'); scr.moments.classList.remove('show'); };

  $('t-play').onclick = () => cb.onPlay();
  $('t-levels').onclick = () => cb.onLevels();
  $('t-moments').onclick = () => cb.onMoments();
  $('t-settings').onclick = () => cb.onSettings();
  $('m-back').onclick = () => cb.onBack();
  $('e-levels').onclick = () => { scr.end.classList.remove('show'); cb.onLevels(); };
  $('e-title').onclick = () => { scr.end.classList.remove('show'); cb.onTitleFromEnd(); };
  $('s-close').onclick = () => { $('s-confirm').hidden = true; scr.settings.classList.remove('show'); };
  $('s-sound').onchange = (e) => cb.onSound(e.target.checked);
  $('s-haptics').onchange = (e) => cb.onHaptics(e.target.checked);
  $('s-music').onchange = (e) => cb.onMusic(e.target.checked);
  $('s-reduce').onchange = (e) => cb.onReduce(e.target.checked);
  $('s-reset').onclick = () => { $('s-confirm').hidden = false; };
  $('s-no').onclick = () => { $('s-confirm').hidden = true; };
  $('s-yes').onclick = () => { $('s-confirm').hidden = true; scr.settings.classList.remove('show'); cb.onReset(); };

  return {
    showTitle() { hideAll(); scr.title.classList.add('show'); },
    hideTitle() { scr.title.classList.remove('show'); },
    titleShown: () => scr.title.classList.contains('show'),
    // seen: { id: count }
    showMoments(seen) {
      hideAll();
      let n = 0, h = '';
      for (const m of MOMENTS) {
        const c = seen[m.id] | 0; if (c) n++;
        h += `<div class="moment ${c ? 'seen' : 'locked'}"><svg viewBox="0 0 64 64" class="m-ic" aria-hidden="true" fill="${c ? '#24222B' : '#8EA8A6'}" stroke="${c ? '#E06A47' : '#6F8987'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg>` +
          `<b>${c ? m.name : '???'}</b><span>${c ? `Seen ${c} time${c > 1 ? 's' : ''}` : m.how}</span></div>`;
      }
      $('m-count').textContent = `${n} / ${MOMENTS.length}`; $('m-grid').innerHTML = h; scr.moments.classList.add('show');
    },
    hideMoments() { scr.moments.classList.remove('show'); },
    momentsShown: () => scr.moments.classList.contains('show'),
    // stats: { stars, maxStars, moments, momentsMax, planets, favourite }
    showEnd(st) {
      hideAll(); $('end-stats').innerHTML = `<div><b>${st.stars}</b> / ${st.maxStars}<span>stars</span></div><div><b>${st.moments}</b> / ${st.momentsMax}<span>moments seen</span></div><div><b>${st.planets}</b><span>best planets burned</span></div><div><b>${st.favourite}</b><span>favourite container</span></div>`; scr.end.classList.add('show');
    },
    showSettings(p) { $('s-sound').checked = !!p.sound; $('s-haptics').checked = !!p.haptics; $('s-reduce').checked = !!p.reduceMotion; $('s-music').checked = p.music !== false; $('s-confirm').hidden = true; scr.settings.classList.add('show'); },
    settingsShown: () => scr.settings.classList.contains('show'),
  };
}

function BACK() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>'; }
function GEAR() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></svg>'; }
