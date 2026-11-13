// WebAudio synth (no samples) + haptics. Context is created/unlocked on the first pointerdown.
export function createAudio(T) {
  let ctx = null, master = null, muted = false;
  // Test runs on the dev machine (the page opened at localhost, e.g. by automated play-testing) stay silent; the phone uses the LAN address and plays sound. Add ?sound to hear it on localhost.
  const devSilent = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sound\b/.test(location.search);
  let stretchOsc = null, stretchGain = null;
  // iOS has no navigator.vibrate: a hidden <input switch> clicked via its label gives a tick (iOS 17.4+), inside a gesture only
  let hapLabel = null;
  try {
    const lab = document.createElement('label'); lab.className = 'hapt'; lab.setAttribute('aria-hidden', 'true');
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
    lab.appendChild(inp); document.body.appendChild(lab); hapLabel = lab;
  } catch (_) { hapLabel = null; }
  let unlocked = false;
  let lastSquish = 0, lastHaptic = 0, lastTick = 0, lastMeow = -10;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted || devSilent ? 0 : T.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2; // (a limiter: stacked sounds never clip)
      master.connect(comp); comp.connect(ctx.destination);
      // continuous stretch voice (silent until used)
      stretchOsc = ctx.createOscillator(); stretchOsc.type = 'triangle'; stretchOsc.frequency.value = 180;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      stretchGain = ctx.createGain(); stretchGain.gain.value = 0;
      stretchOsc.connect(lp).connect(stretchGain).connect(master);
      stretchOsc.start();
    }
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true; if (musicOn) musicStart();
  }

  const now = () => ctx.currentTime;
  const ok = () => ctx && ctx.state === 'running' && !muted && !devSilent;

  let boostK = 1; // per-sound loudness trim (the offline levels check showed the small sounds sitting 30 dB under full scale)
  function env(g, t, a, peak, d) {
    peak *= boostK;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function squish(intensity = 0.5) {
    if (!ok()) return;
    const t0 = performance.now();
    if (t0 - lastSquish < 125) return; // <= 8 / s
    lastSquish = t0;
    const k = Math.max(0.1, Math.min(1, intensity)), t = now();
    const dur = 0.09 + 0.12 * k;
    // sine blorp, fast downward glide
    const o = ctx.createOscillator(); o.type = 'sine';
    const p0 = (300 + Math.random() * 160) * (1.15 - k * 0.45);
    o.frequency.setValueAtTime(p0, t); o.frequency.exponentialRampToValueAtTime(p0 * 0.38, t + dur);
    const og = ctx.createGain(); env(og, t, 0.006, 0.3 * k + 0.08, dur * 1.1);
    o.connect(og).connect(master); o.start(t); o.stop(t + dur * 1.2 + 0.05);
  }

  function setStretch(amount, active) {
    if (!stretchGain || !ctx) return;
    const t = now();
    const a = active && !muted && !devSilent ? Math.max(0, Math.min(1, amount)) : 0;
    stretchGain.gain.setTargetAtTime(a * 0.07, t, 0.06);
    stretchOsc.frequency.setTargetAtTime(150 + a * 420, t, 0.05);
  }




  function purr() {
    if (!ok()) return;
    const t = now(), dur = 2.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 24;
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 52;
    const og = ctx.createGain(); og.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    g.gain.setValueAtTime(0.5, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(lp).connect(am);
    am.connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }

  // ---- pounce sounds ----
  // "mrrp!": a short rising trill with a rolled r
  function mrrp(power = 0.6) {
    if (!ok()) return;
    const t = now(), dur = 0.2, f0 = 300 + 90 * power;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.7, t + dur * 0.55); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + dur);
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 30; const lg = ctx.createGain(); lg.gain.value = 0.45; lfo.connect(lg).connect(am.gain);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
    const g = ctx.createGain(); env(g, t, 0.02, 0.32, dur);
    o.connect(bp).connect(am).connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }
  function whoosh(speed = 0.6) { // a leap: a soft pitched swoop (no noise)
    if (!ok()) return;
    const t = now(), dur = 0.22 + 0.16 * speed, k = Math.max(0.15, Math.min(1, speed));
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(240 + 120 * k, t); o.frequency.exponentialRampToValueAtTime(520 + 380 * k, t + dur * 0.6); o.frequency.exponentialRampToValueAtTime(380, t + dur);
    const g = ctx.createGain(); env(g, t, dur * 0.3, 0.03 + 0.06 * k, dur * 0.7);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.1);
  }
  function clink(v = 8) {
    if (!ok()) return;
    const t = now(), k = Math.max(0.2, Math.min(1, v / 18));
    for (const [f, d, a] of [[1760, 0.22, 0.2], [2640, 0.15, 0.12], [3320, 0.1, 0.07]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain(); env(g, t, 0.002, a * k, d); o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.05);
    }
  }
  function crash(v = 10) { // something falls off a shelf and lands
    if (!ok()) return;
    const t = now(), k = Math.max(0.3, Math.min(1, v / 20));
    clink(v);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = ctx.createGain(); env(og, t, 0.004, 0.35 * k, 0.14); o.connect(og).connect(master); o.start(t); o.stop(t + 0.2);
  }
  function pop(i = 0) { // a part is tucked in
    if (!ok()) return;
    const t = now() + i * 0.02, o = ctx.createOscillator(); o.type = 'sine';
    const f = 480 * Math.pow(2, (i % 5) / 6);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.07);
    const g = ctx.createGain(); env(g, t, 0.004, 0.16, 0.09); o.connect(g).connect(master); o.start(t); o.stop(t + 0.15);
  }
  function chirp() { // a tap: a little squirm
    if (!ok()) return;
    const t = now();
    for (const [dt, f] of [[0, 520], [0.09, 700]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t + dt); o.frequency.exponentialRampToValueAtTime(f * 1.4, t + dt + 0.07);
      const g = ctx.createGain(); env(g, t + dt, 0.01, 0.22, 0.08); o.connect(g).connect(master); o.start(t + dt); o.stop(t + dt + 0.15);
    }
  }
  function aimTick(level = 0) { // pull crosses a third
    if (!ok()) return;
    const t = now(), o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 520 + level * 160;
    const g = ctx.createGain(); env(g, t, 0.003, 0.1, 0.04); o.connect(g).connect(master); o.start(t); o.stop(t + 0.08);
  }

  // ---- the new moves ----
  function blorp() { // DROP: a fat downward bloop with a pop of air
    if (!ok()) return;
    const t = now(), o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.2);
    const g = ctx.createGain(); env(g, t, 0.006, 0.4, 0.22); o.connect(g).connect(master); o.start(t); o.stop(t + 0.3);
  }
  // ---- impacts by strength and material: pat (light) < thud + squish (medium) < big thump + squelch + low boom (heavy); every hit varies a little
  function noiseHit(t, f0, f1, dur, a) { // (was filtered noise; now a short pitched knock, so the mix has no hiss)
    const f = Math.max(70, Math.min(240, f1)); tone('triangle', f * 1.6, f * 0.6, t, dur, a * 0.55);
  }
  function impact(kind, s, material = '') {
    if (!ok()) return;
    const t = now(), v = 0.9 + Math.random() * 0.2, p = 0.94 + Math.random() * 0.12;
    if (kind === 'wall' || kind === 'ceiling') { tone('triangle', 260 * p, 90, t, 0.18, 0.2 + 0.25 * s); noiseHit(t, 1500, 300, 0.12, 0.25 * s * v); return; }
    if (kind === 'rim' || kind === 'containerFloor') {
      if (material === 'teacup' || material === 'fishbowl') { for (const [f, d, a] of [[1900, 0.25, 0.16], [2900, 0.16, 0.09]]) tone('sine', f * p * (material === 'fishbowl' ? 0.8 : 1), f * p * 0.99, t, d, a * (0.4 + s)); }
      else if (material === 'box') noiseHit(t, 900, 200, 0.14, 0.4 * (0.4 + s) * v);
      else tone('sine', (material === 'vase' ? 520 : 190) * p, 80, t, 0.16, 0.3 * (0.4 + s)); // pot / vase: a terracotta thud
      return;
    }
    if (kind === 'shelf') { tone('sine', 150 * p, 60, t, 0.15, 0.4 * (0.3 + s)); if (s > 0.3) tone('sawtooth', 95 * p, 80, t + 0.04, 0.1, 0.04 * s); } // a creak under the thud
    if (s < 0.25) { noiseHit(t, 2200, 500, 0.06, 0.18 * v, 'bandpass'); tone('sine', 220 * p, 120, t, 0.07, 0.14); return; }        // a soft pat
    thump(0.4 + 0.5 * s); squish(0.4 + 0.5 * s);
    if (s > 0.6) { tone('sine', 62 * p, 36, t, 0.35, 0.5); noiseHit(t + 0.02, 1200, 240, 0.22, 0.3 * v); }                          // a low boom and a squelch
  }
  // ---- the cat's small vocabulary: a formant-ish "ack" on a bonk, and a squeaky yowl variant
  function ack() { // a tiny "ack": a short sawtooth through two vowel bands, pitch dropping
    if (!ok()) return; const t = now(), o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(520 * (0.95 + Math.random() * 0.1), t); o.frequency.exponentialRampToValueAtTime(260, t + 0.09);
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(); f1.type = f2.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 4; f2.frequency.value = 1700; f2.Q.value = 5;
    const g = ctx.createGain(); env(g, t, 0.004, 0.9, 0.1); o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
  }
  // ---- the music bed: a short loop (C - Am - F - G, 96 bpm) in a major key; three layers that follow play (pad always; a pluck arpeggio in flight and on a win; a bass with it).
  // Scheduled WebAudio notes from a 4 Hz timer 0.4 s ahead: nothing runs per frame.
  const CH = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], midi = (n) => 261.63 * Math.pow(2, n / 12), EIGHTH = 60 / 96 / 2;
  let musicOn = true, mTimer = 0, mNext = 0, mStep = 0, mMood = 0, mGain = null;
  function mNote(type, f, t, dur, a, dest) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05); }
  function mSchedule(step, t) {
    const bar = ((step / 8) | 0) % 4, ch = CH[bar], k = step % 8;
    if (k === 0) for (const n of ch) mNote('sine', midi(n), t, 3.4 * EIGHTH * 2, 0.07, mGain); // the pad
    if (mMood >= 1) {
      const arp = [0, 1, 2, 1, 2, 1, 0, 1][k]; mNote('triangle', midi(ch[arp] + 12), t, 0.35, 0.05, mGain);                // the pluck arpeggio
      if (k === 0 || k === 4) mNote('sine', midi(ch[0] - 12), t, 0.5, 0.09, mGain);                                      // the bass
    } else if (k === 0 || k === 4) mNote('sine', midi(ch[0] - 12), t, 0.7, 0.045, mGain);                                // sparse: a soft bass only
    if (mMood >= 2 && (k === 3 || k === 7)) mNote('triangle', midi(ch[2] + 24 - (k === 3 ? 0 : 5)), t, 0.25, 0.045, mGain);   // a little fill on a win
  }
  function mTick() { if (!ok() || !musicOn) return; const t = now(); if (mNext < t) mNext = t + 0.05; while (mNext < t + 0.4) { mSchedule(mStep, mNext); mNext += EIGHTH; mStep++; } }
  function musicStart() { if (!ctx || mTimer) return; if (!mGain) { mGain = ctx.createGain(); mGain.gain.value = 0.5; mGain.connect(master); } mNext = now() + 0.1; mTimer = setInterval(mTick, 250); }
  function musicStop() { clearInterval(mTimer); mTimer = 0; }
  function setMusic(on) { musicOn = !!on; if (!musicOn) musicStop(); else musicStart(); }
  function setMood(m) { mMood = m; }
  function boing() { // the cushion: a spring
    if (!ok()) return;
    const t = now(), o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.09); o.frequency.exponentialRampToValueAtTime(230, t + 0.38);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = 40; lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain(); env(g, t, 0.006, 0.38, 0.4); o.connect(g).connect(master); o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
  }
  function bonk() { // a side wall
    if (!ok()) return;
    const t = now(), o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.13);
    const g = ctx.createGain(); env(g, t, 0.003, 0.4, 0.15); o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
    clink(6);
  }
  function thump(k = 0.5) { // a landing
    if (!ok()) return;
    const t = now(), kk = Math.max(0.15, Math.min(1, k)), o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const g = ctx.createGain(); env(g, t, 0.003, 0.5 * kk, 0.16); o.connect(g).connect(master); o.start(t); o.stop(t + 0.22);
  }
  function splat() { // a DROP onto something hard
    if (!ok()) return;
    const t = now(); tone('triangle', 320, 70, t, 0.16, 0.3);
    thump(0.9);
  }
  function screech() { // startled by a cucumber: a rising chirp-yowl
    if (!ok()) return;
    const t = now(), o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.12); o.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    const g = ctx.createGain(); env(g, t, 0.01, 0.34, 0.3); o.connect(bp).connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  }
  function blip(n = 1) { // a treat: a rising blip, higher with each one
    if (!ok()) return;
    const t = now(), f = 620 * Math.pow(2, (Math.max(1, n) - 1) / 4.5), o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(f, t); o.frequency.setValueAtTime(f * 1.5, t + 0.05);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    const g = ctx.createGain(); env(g, t, 0.004, 0.13, 0.13); o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + 0.2);
  }
  function chime(i = 0) { // the stars: a rising three-note chime (C, E, G)
    if (!ok()) return;
    const t = now(), f = [523.25, 659.25, 783.99][Math.min(2, i)];
    for (const [m, a] of [[1, 0.26], [2, 0.1], [3.01, 0.05]]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m; const g = ctx.createGain(); env(g, t, 0.004, a, 0.55); o.connect(g).connect(master); o.start(t); o.stop(t + 0.7); }
  }
  // ---- the four moments
  function tone(type, f0, f1, t0, dur, a, dest) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur); const g = ctx.createGain(); env(g, t0, 0.005, a, dur); o.connect(g).connect(dest || master); o.start(t0); o.stop(t0 + dur + 0.05); }
  function lickies() { if (!ok()) return; const t = now(); for (let i = 0; i < 4; i++) tone('sine', 900 + 90 * (i & 1), 520, t + i * 0.28, 0.12, 0.07); }
  function kickies() { if (!ok()) return; const t = now(); tone('triangle', 330, 110, t, 0.2, 0.22); for (let i = 0; i < 7; i++) tone('square', 150 + (i & 1) * 40, 70, t + 0.12 + i * 0.075, 0.06, 0.1); }
  function swirl() { if (!ok()) return; const t = now(); [392, 494, 587, 784].forEach((f, i) => tone('sine', f, f * 1.01, t + i * 0.07, 0.5, 0.12)); }
  let laserO = null, laserG = null;
  function laser(on) { // a held beam: a thin descending-warble hum
    if (!ok()) return;
    if (on && !laserO) { laserO = ctx.createOscillator(); laserO.type = 'sawtooth'; laserO.frequency.value = 220; laserG = ctx.createGain(); laserG.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; laserO.connect(lp).connect(laserG).connect(master); laserO.start(); }
    if (laserG) laserG.gain.setTargetAtTime(on ? 0.05 : 0, now(), 0.04);
    if (!on && laserO) { const o = laserO; laserO = null; try { o.stop(now() + 0.3); } catch (_) { /* stopped */ } }
  }
  function laserPitch(k) { if (laserO) laserO.frequency.setTargetAtTime(200 + 260 * k, now(), 0.05); }
  function boom(n = 0) { // a planet pops: a chunky noise burst plus a pitch that rises with the combo
    if (!ok()) return; const t = now();
    tone('triangle', 150, 40, t, 0.3, 0.3);
    tone('sine', 260 * Math.pow(2, Math.min(n, 8) / 6), 60, t, 0.35, 0.3);
  }
  function crack() { if (!ok()) return; tone('square', 1500, 700, now(), 0.05, 0.06); }
  function sting() { if (!ok()) return; const t = now(); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, t + i * 0.09, 0.45, 0.14)); }

  // iOS best effort; call only from inside a pointer handler (grab start)
  function tick() {
    try { if (!navigator.vibrate && hapLabel) hapLabel.click(); } catch (_) { /* unsupported */ }
  }
  let hapticsOn = true;
  function setHaptics(on) { hapticsOn = !!on; }
  function haptic(p) {
    if (!unlocked || !hapticsOn) return; // browsers block vibrate before the first tap
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ }
  }
  function hapticImpact(intensity) {
    const t = performance.now();
    if (t - lastHaptic < 90) return;
    lastHaptic = t;
    haptic(Math.round(10 + 15 * Math.max(0, Math.min(1, intensity))));
  }

  function suspend() { clearInterval(mTimer); mTimer = 0; try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (_) { /* ignore */ } }
  function resume() { try { if (ctx && unlocked && ctx.state !== 'running') ctx.resume(); if (musicOn) musicStart(); } catch (_) { /* ignore */ } }
  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m || devSilent ? 0 : T.volume;
    if (m) setStretch(0, false);
  }

  const boost = (fn, k) => (...a) => { boostK = k; try { return fn(...a); } finally { boostK = 1; } };
  return { blorp: boost(blorp, 1.6), boing: boost(boing, 1.5), bonk: boost(bonk, 1.5), thump: boost(thump, 1.4), splat: boost(splat, 1.2), screech: boost(screech, 2.6), blip: boost(blip, 2.6), chime: boost(chime, 1.4), unlock, squish: boost(squish, 1.8), tick, setStretch, purr, mrrp: boost(mrrp, 3.5), whoosh: boost(whoosh, 1.8), clink: boost(clink, 2.4), crash: boost(crash, 1.6), pop: boost(pop, 3), chirp: boost(chirp, 1.2), aimTick, impact: boost(impact, 1.7), lickies: boost(lickies, 1.6), kickies: boost(kickies, 1.5), swirl: boost(swirl, 1.2), laser, laserPitch, ack: boost(ack, 1.2), setMusic, setMood, musicStart, musicStop, boom: boost(boom, 1.4), crack: boost(crack, 6), sting: boost(sting, 1.2), haptic, hapticImpact, setHaptics, suspend, resume, setMuted, get muted() { return muted; } };
}
