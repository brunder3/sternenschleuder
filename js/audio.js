/* Sternenschleuder sound: everything is synthesised with the Web Audio API, no audio files. */
const Sfx = (() => {
  'use strict';
  let ac = null, master = null, noiseBuf = null, thrGain = null, thrFilter = null, on = true;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = on ? 0.5 : 0; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      thrFilter = ac.createBiquadFilter(); thrFilter.type = 'lowpass'; thrFilter.frequency.value = 500;
      thrGain = ac.createGain(); thrGain.gain.value = 0;
      src.connect(thrFilter); thrFilter.connect(thrGain); thrGain.connect(master); src.start();
    } catch (e) { ac = null; }
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ac || !on) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, freq, q, type, slideTo, delay) {
    if (!ac || !on) return;
    const t0 = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t0); f.Q.value = q || 1;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }
  return {
    init,
    setOn(v) { on = v; if (master) master.gain.value = v ? 0.5 : 0; },
    thrust(level, space) {
      if (!ac || !thrGain) return;
      const t = ac.currentTime;
      thrGain.gain.setTargetAtTime(on ? level * 0.2 : 0, t, 0.06);
      thrFilter.frequency.setTargetAtTime(space ? 260 + level * 120 : 420 + level * 520, t, 0.1);
    },
    coin(combo) { const f = 880 * Math.pow(2, Math.min(combo, 14) / 12); tone(f, 0.11, 'triangle', 0.1); tone(f * 1.5, 0.09, 'sine', 0.05, null, 0.035); },
    gem() { [0, 4, 7, 12, 16].forEach((s, i) => tone(1046 * Math.pow(2, s / 12), 0.2, 'triangle', 0.09, null, i * 0.045)); },
    fuel() { tone(300, 0.18, 'sine', 0.14, 760); tone(520, 0.14, 'sine', 0.07, 980, 0.06); },
    ring() { noise(0.4, 0.22, 700, 1.2, 'bandpass', 4200); tone(330, 0.32, 'sawtooth', 0.04, 1320); },
    hit() { noise(0.35, 0.5, 500, 0.8, 'lowpass', 70); tone(150, 0.26, 'square', 0.1, 50); },
    shield() { tone(1300, 0.28, 'sine', 0.14, 620); tone(1900, 0.22, 'triangle', 0.05, 900); },
    twang() { tone(190, 0.5, 'triangle', 0.22, 95); tone(380, 0.22, 'sine', 0.07, 170); noise(0.25, 0.18, 1600, 1, 'bandpass', 380); },
    boom() { noise(0.9, 0.6, 320, 0.7, 'lowpass', 40); tone(70, 0.7, 'sine', 0.2, 35); },
    pop() { noise(0.09, 0.35, 2400, 1, 'highpass'); tone(700, 0.12, 'sine', 0.08, 220); },
    land() { noise(0.45, 0.45, 260, 0.7, 'lowpass', 60); },
    crash() { noise(1.1, 0.7, 700, 0.6, 'lowpass', 45); tone(95, 0.7, 'sawtooth', 0.1, 30); },
    bounce() { tone(160, 0.25, 'sine', 0.2, 420); noise(0.2, 0.2, 400, 1, 'lowpass', 100); },
    turbo() { noise(0.7, 0.32, 450, 1, 'bandpass', 3400); tone(220, 0.55, 'sawtooth', 0.05, 880); },
    buy() { tone(660, 0.1, 'triangle', 0.13); tone(990, 0.18, 'triangle', 0.11, null, 0.08); },
    deny() { tone(210, 0.16, 'square', 0.06, 150); },
    mission() { [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.28, 'triangle', 0.12, null, i * 0.09)); },
    zone() { [0, 7, 12, 19].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 1.1, 'sine', 0.06, null, i * 0.07)); },
    win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.5, 'triangle', 0.1, null, i * 0.11)); },
    catapult() { tone(150, 0.6, 'triangle', 0.24, 70); noise(0.35, 0.3, 900, 1, 'bandpass', 200); tone(60, 0.5, 'sine', 0.25, 40); },
    tick(p) { tone(300 + p * 500, 0.03, 'square', 0.02); },
    perfect() { [0, 7, 12].forEach((s, i) => tone(784 * Math.pow(2, s / 12), 0.18, 'triangle', 0.1, null, i * 0.05)); },
    click() { tone(900, 0.05, 'square', 0.035); },
  };
})();
