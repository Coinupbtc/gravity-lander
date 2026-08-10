/* =============================================================================
 * APOLLO DESCENT — procedural sound design  (window.Apollo.Audio)
 * -----------------------------------------------------------------------------
 * All sound is synthesized live with the WebAudio API — no assets, zero `Audio`
 * elements, tiny. Adds the full AAA-feel sound layer the visuals lacked:
 *
 *   ambient  - low pad-beacon ping + slow space hum
 *   ignition - engine start whoosh (thrust launch)
 *   engine   - continuous throttle-following burn (pitch+gain ride throttle)
 *   dust     - landing regolith kick
 *   thud     - soft touchdown (soft land = gentle, hard land = boom)
 *   crash    - big impact boom + debris
 *   beep     - UI/menu blips
 *   refuel   - rising blip cascade for the refuel-while-you-wait beat
 *   cash     - coin/credit blip when mission pay/upgrade lands (economy tie-in)
 *
 * iOS SAFETY: AudioContext starts suspended until a user gesture. Every pointer/
 * key handler calls Audio.unlock() (resume + tiny silent buffer) so the first
 * tap on the iPhone 'unlocks' audio — after that the engine/beeps play fine.
 * Everything is try/caught; if WebAudio is missing, every call is a no-op.
 * ==========================================================================*/
(function () {
  'use strict';
  window.Apollo = window.Apollo || {};
  if (window.Apollo.Audio) return;

  var AC = null;          // AudioContext (lazy)
  var master = null;      // master gain -> soft limiter -> destination
  var engineGain = null;  // engine node gain (rides throttle)
  var engineSrc = null;   // engine looping source(s)
  var unlocked = false;
  var humSrc = null;

  function ac() {
    if (AC) return AC;
    try {
      var Ctor = (window.AudioContext || window.webkitAudioContext);
      if (!Ctor) return null;
      AC = new Ctor();
      // master with a gentle compressor so loud layers never clip.  
      var comp = AC.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.22;
      comp.connect(AC.destination);
      master = AC.createGain();
      master.gain.value = 0.85;
      master.connect(comp);
      buildEngine();
      startAmbient();
    } catch (e) { AC = null; master = null; }
    return AC;
  }

  /* Resume / unlock. Call on ANY user gesture (pointerdown/touchstart/keydown). */
  function unlock() {
    if (unlocked) return;
    var a = ac();
    if (!a) return;
    try {
      if (a.state === 'suspended') a.resume();
      // Play a short silent buffer to fully 'unstop' the context on iOS.  
      var buf = a.createBuffer(1, 1, 44100);
      var src = a.createBufferSource();
      src.buffer = buf;
      src.connect(a.destination);
      src.start(0);
      unlocked = true;
    } catch (e) {}
  }

  /* ---------------- engine burn (continuous, throttle-riding) ------------ */
  function buildEngine() {
    try {
      var noiseBuf = makeNoiseBuffer(2);
      // Burn noise
      var ns = AC.createBufferSource();
      ns.buffer = noiseBuf; ns.loop = true;
      var nFilter = AC.createBiquadFilter();
      nFilter.type = 'lowpass'; nFilter.frequency.value = 260;
      var nGain = AC.createGain(); nGain.gain.value = 0;
      ns.connect(nFilter); nFilter.connect(nGain); nGain.connect(master);
      ns.start();
      // Low rumble oscillator
      var osc = AC.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 48;
      var oGain = AC.createGain(); oGain.gain.value = 0;
      var oFilter = AC.createBiquadFilter(); oFilter.type = 'lowpass'; oFilter.frequency.value = 120;
      osc.connect(oFilter); oFilter.connect(oGain); oGain.connect(master);
      osc.start();
      engineSrc = { noise: ns, osc: osc };
      engineGain = { n: nGain, o: oGain };
    } catch (e) { engineSrc = null; engineGain = null; }
  }

  // Shared white-noise buffer (reused by one-shots).
  function makeNoiseBuffer(sec) {
    var len = Math.floor(AC.sampleRate * sec);
    var buf = AC.createBuffer(1, len, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* Throttle 0..1 → engine burn loudness + pitch. */
  function setThrust(t) {
    var a = ac(); if (!a || !engineGain) return;
    try {
      var now = a.currentTime;
      var g = Math.min(1, Math.max(0, t || 0));
      engineGain.n.gain.setTargetAtTime(g * 0.32, now, 0.05);
      engineGain.o.gain.setTargetAtTime(g * 0.30, now, 0.05);
      if (engineSrc && engineSrc.osc) {
        engineSrc.osc.frequency.setTargetAtTime(40 + g * 55, now, 0.06);
      }
    } catch (e) {}
  }

  /* ---------------- one-shots ------------------------------------------- */
  function noiseShot(dur, freq, q, gain, type) {
    var a = ac(); if (!a) return;
    try {
      var src = a.createBufferSource();
      src.buffer = makeNoiseBuffer(dur);
      var f = a.createBiquadFilter();
      f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      var g = a.createGain();
      var now = a.currentTime;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(now); src.stop(now + dur + 0.05);
    } catch (e) {}
  }
  function tone(freq, dur, type, gain, slide, delay) {
    var a = ac(); if (!a) return;
    try {
      var now = a.currentTime + (delay || 0);
      var o = a.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, now);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now + dur);
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.2, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(master);
      o.start(now); o.stop(now + dur + 0.05);
    } catch (e) {}
  }

  function ignition() {
    noiseShot(0.7, 500, 1.2, 0.20, 'bandpass');
    tone(70, 0.7, 'sawtooth', 0.18, 26);
    tone(140, 0.55, 'sine', 0.12, 46, 0.05);
  }
  function dust() {
    noiseShot(0.5, 800, 0.8, 0.14, 'lowpass');
  }
  function thud(soft) {
    if (soft) { tone(120, 0.22, 'sine', 0.28, 45); noiseShot(0.2, 300, 0.6, 0.08, 'lowpass'); }
    else { tone(95, 0.4, 'sine', 0.5, 38); noiseShot(0.35, 350, 0.8, 0.18, 'lowpass'); }
  }
  function crash() {
    tone(70, 0.9, 'sawtooth', 0.55, 24);
    noiseShot(0.9, 200, 0.5, 0.30, 'lowpass');
    tone(180, 0.5, 'square', 0.12, 40, 0.02);
  }
  function beep(freq) {
    tone(freq || 520, 0.09, 'square', 0.10);
  }
  function cash() {
    tone(880, 0.07, 'square', 0.12);
    tone(1320, 0.14, 'square', 0.12, 0, 0.07);
  }
  function refuel() {
    // rising blip cascade channels the fill-while-you-wait beat
    for (var i = 0; i < 8; i++) tone(300 + i * 90, 0.06, 'sine', 0.08, 0, 0.05 * i);
    tone(900, 0.2, 'sine', 0.10, 0, 0.45);
  }
  function beacon() {
    tone(220, 0.18, 'sine', 0.035);
  }

  /* Low-altitude proximity ping — a rising double-blip the closer to impact.
     Called by game.js each frame below ~25m; rate + pitch escalate with how
     close/dangerous the descent is (freegle loop-1 idea #4 / recommended #2). */
  var lastPing = 0;
  function proximity(alt, danger) {
    var a = ac(); if (!a) return;
    var now = a.currentTime;
    var urgency = Math.max(0, Math.min(1, 1 - alt / 25));     // 0 high up -> 1 at ground
    var interval = 0.9 - urgency * 0.55 - (danger ? 0.18 : 0); // ~0.9s -> ~0.17s
    if (now - lastPing < interval) return;
    lastPing = now;
    var base = 560 + urgency * 520;
    tone(base, 0.06, 'square', 0.055 + urgency * 0.06);
    tone(base * 1.5, 0.08, 'square', 0.05, 0, 0.07);
  }

  /* Terrain-graze thrill whoosh + chime (near-miss bonus). */
  function graze() {
    noiseShot(0.5, 900, 1.4, 0.16, 'bandpass');
    tone(660, 0.1, 'sine', 0.12);
    tone(990, 0.16, 'sine', 0.12, 0, 0.09);
  }

  /* Gold confetti tinkle for a PERFECT (S-grade) landing. */
  function celebrate() {
    for (var i = 0; i < 6; i++) tone(900 + i * 130, 0.09, 'triangle', 0.09, 0, i * 0.05);
  }

  /* Slow space hum + periodic pad-beacon ping while at menu. */
  var beaconTimer = null;
  function startAmbient() {
    var a = ac(); if (!a || humSrc) return;
    try {
      var o = a.createOscillator(); o.type = 'sine'; o.frequency.value = 52;
      var g = a.createGain(); g.gain.value = 0.012;
      o.connect(g); g.connect(master); o.start();
      humSrc = o;
      beaconTimer = setInterval(function(){ beacon(); }, 4200);
    } catch (e) {}
  }
  function stopAmbient() {
    if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
    if (humSrc) { try { humSrc.stop(); } catch (e) {} humSrc = null; }
  }

  /* ---------------- public API ------------------------------------------ */
  window.Apollo.Audio = {
    unlock: unlock,
    setThrust: setThrust,
    ignition: ignition,
    dust: dust,
    thud: thud,
    crash: crash,
    beep: beep,
    cash: cash,
    refuel: refuel,
    beacon: beacon,
    proximity: proximity,
    graze: graze,
    celebrate: celebrate,
    stopAmbient: stopAmbient,
    get ready() { return !!AC; }
  };

  // Never let a missing AudioContext throw: pre-warm on document interactivity.
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
})();
