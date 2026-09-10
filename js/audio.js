// Everything you hear is synthesised at runtime with the Web Audio API.
// No sample files ship with the game.

let ctx = null;
let master = null, sfxBus = null, musicBus = null, verbBus = null;
let noiseBuf = null;
let started = false;
let muted = false;
let musicOn = true;

const state = {
  sfxVol: 0.85,
  musicVol: 0.42,
};

export function isReady() { return started; }

export function init() {
  if (started) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  // Gentle bus compression so explosions do not clip the mix.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  comp.connect(master);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = state.sfxVol;
  sfxBus.connect(comp);

  musicBus = ctx.createGain();
  musicBus.gain.value = state.musicVol;
  musicBus.connect(comp);

  // Cheap convolution reverb from decaying noise gives the battlefield space.
  verbBus = ctx.createGain();
  verbBus.gain.value = 0.5;
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(2.6, 2.4);
  verbBus.connect(conv);
  conv.connect(comp);

  noiseBuf = makeNoise(3.0);
  started = true;
  return ctx;
}

export function resume() {
  if (!ctx) init();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function makeNoise(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = w * 0.7 + last * 3.0;
  }
  return b;
}

function makeImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return b;
}

function now() { return ctx.currentTime; }

function noiseSource(playbackRate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = playbackRate;
  return s;
}

function env(node, t0, a, d, peak, dest) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g);
  g.connect(dest || sfxBus);
  return g;
}

function osc(type, freq, t0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  return o;
}

function distortionCurve(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// ---------------------------------------------------------------- SFX

export function uiClick(pitch = 1) {
  if (!started) return;
  const t = now();
  const o = osc('square', 620 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(300 * pitch, t + 0.05);
  env(o, t, 0.002, 0.06, 0.16);
  o.start(t); o.stop(t + 0.1);
}

export function uiHover() {
  if (!started) return;
  const t = now();
  const o = osc('triangle', 900, t);
  env(o, t, 0.002, 0.035, 0.05);
  o.start(t); o.stop(t + 0.06);
}

export function uiBack() {
  if (!started) return;
  const t = now();
  const o = osc('square', 300, t);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  env(o, t, 0.003, 0.09, 0.14);
  o.start(t); o.stop(t + 0.14);
}

export function tick(strength = 1) {
  if (!started) return;
  const t = now();
  const n = noiseSource(2.2);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 6;
  n.connect(f);
  env(f, t, 0.001, 0.035, 0.09 * strength);
  n.start(t); n.stop(t + 0.06);
}

// Rapid metallic clank for the ramming minigame.
export function ram(intensity = 1) {
  if (!started) return;
  const t = now();
  const n = noiseSource(1.6 + Math.random() * 0.5);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1500 + Math.random() * 900;
  f.Q.value = 3.5;
  n.connect(f);
  env(f, t, 0.001, 0.09, 0.2 * intensity);
  n.start(t); n.stop(t + 0.13);
  const o = osc('triangle', 190 + Math.random() * 60, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  env(o, t, 0.002, 0.1, 0.13 * intensity);
  o.start(t); o.stop(t + 0.14);
}

export function perfect() {
  if (!started) return;
  const t = now();
  [880, 1320, 1760].forEach((f, i) => {
    const o = osc('triangle', f, t + i * 0.055);
    env(o, t + i * 0.055, 0.004, 0.3, 0.13, verbBus);
    env(o, t + i * 0.055, 0.004, 0.22, 0.1);
    o.start(t + i * 0.055); o.stop(t + i * 0.055 + 0.35);
  });
}

export function good() {
  if (!started) return;
  const t = now();
  const o = osc('triangle', 660, t);
  o.frequency.setValueAtTime(880, t + 0.07);
  env(o, t, 0.004, 0.2, 0.11);
  o.start(t); o.stop(t + 0.26);
}

export function fail() {
  if (!started) return;
  const t = now();
  const o = osc('sawtooth', 220, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.28);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 900;
  o.connect(f);
  env(f, t, 0.006, 0.32, 0.13);
  o.start(t); o.stop(t + 0.4);
}

// The mortar going off. Heavier shells thump lower and longer.
export function fire(mass = 1) {
  if (!started) return;
  const t = now();
  const m = Math.max(0.4, Math.min(2.6, mass));
  const baseF = 150 / Math.pow(m, 0.45);

  // Body: pitched-down sine thump.
  const o = osc('sine', baseF * 2.4, t);
  o.frequency.exponentialRampToValueAtTime(baseF * 0.42, t + 0.28 * m);
  const sh = ctx.createWaveShaper();
  sh.curve = distortionCurve(14);
  o.connect(sh);
  env(sh, t, 0.004, 0.42 * m, 0.62);
  env(sh, t, 0.004, 0.7 * m, 0.3, verbBus);
  o.start(t); o.stop(t + 0.8 * m + 0.2);

  // Crack: fast filtered noise burst.
  const n = noiseSource(1.4);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 700;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.setValueAtTime(6000, t);
  f2.frequency.exponentialRampToValueAtTime(600, t + 0.22);
  n.connect(f); f.connect(f2);
  env(f2, t, 0.002, 0.24, 0.4);
  env(f2, t, 0.002, 0.55, 0.22, verbBus);
  n.start(t); n.stop(t + 0.6);
}

// Descending whistle while the shell falls. Returns a handle you must stop().
export function whistle() {
  if (!started) return { stop() {}, update() {} };
  const t = now();
  const o = osc('sine', 1400, t);
  const o2 = osc('sine', 1408, t);
  const vib = osc('sine', 5.5, t);
  const vibG = ctx.createGain();
  vibG.gain.value = 14;
  vib.connect(vibG);
  vibG.connect(o.frequency);
  vibG.connect(o2.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.13, t + 0.12);
  o.connect(g); o2.connect(g);
  g.connect(sfxBus);
  const vg = ctx.createGain();
  vg.gain.value = 0.5;
  g.connect(vg); vg.connect(verbBus);
  o.start(t); o2.start(t); vib.start(t);
  let stopped = false;
  return {
    // p in 0..1 -> how far into the descent we are.
    update(p, vy) {
      if (stopped || !ctx) return;
      const tt = now();
      const target = 1500 - 950 * Math.min(1, Math.max(0, p));
      o.frequency.setTargetAtTime(target, tt, 0.08);
      o2.frequency.setTargetAtTime(target * 1.006, tt, 0.08);
      const loud = 0.05 + 0.11 * Math.min(1, Math.abs(vy || 0) / 700);
      g.gain.setTargetAtTime(loud, tt, 0.1);
    },
    stop() {
      if (stopped || !ctx) return;
      stopped = true;
      const tt = now();
      g.gain.cancelScheduledValues(tt);
      g.gain.setTargetAtTime(0.0001, tt, 0.03);
      try { o.stop(tt + 0.2); o2.stop(tt + 0.2); vib.stop(tt + 0.2); } catch (e) { /* already stopped */ }
    },
  };
}

// The big one. `power` scales with shell mass, `dist` 0..1 attenuates for range.
export function explosion(power = 1, dist = 0) {
  if (!started) return;
  const t = now();
  const p = Math.max(0.3, Math.min(3, power));
  const att = 1 / (1 + dist * 2.2);

  // Sub-bass punch you feel more than hear.
  const sub = osc('sine', 120 * Math.pow(p, -0.3), t);
  sub.frequency.exponentialRampToValueAtTime(26, t + 0.55 * p);
  const subSh = ctx.createWaveShaper();
  subSh.curve = distortionCurve(6);
  sub.connect(subSh);
  env(subSh, t, 0.006, 0.75 * p, 0.9 * att);
  sub.start(t); sub.stop(t + 1.4 * p);

  // Crack transient.
  const crack = noiseSource(2.6);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1800;
  crack.connect(hp);
  env(hp, t, 0.001, 0.1, 0.55 * att);
  crack.start(t); crack.stop(t + 0.2);

  // Main body: broadband noise swept down through a lowpass.
  const n = noiseSource(0.85);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(4200, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.9 * p);
  lp.Q.value = 1.2;
  const sh = ctx.createWaveShaper();
  sh.curve = distortionCurve(9);
  n.connect(lp); lp.connect(sh);
  env(sh, t, 0.004, 1.0 * p, 0.75 * att);
  env(sh, t, 0.004, 1.9 * p, 0.5 * att, verbBus);
  n.start(t); n.stop(t + 2.2 * p);

  // Debris rattle tail.
  const deb = noiseSource(1.9);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.4;
  deb.connect(bp);
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(0.0001, t + 0.09);
  dg.gain.exponentialRampToValueAtTime(0.14 * att, t + 0.2);
  dg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  bp.connect(dg); dg.connect(sfxBus);
  deb.start(t + 0.09); deb.stop(t + 1.7);
}

export function dud() {
  if (!started) return;
  const t = now();
  const n = noiseSource(0.55);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  n.connect(lp);
  env(lp, t, 0.006, 0.3, 0.3);
  n.start(t); n.stop(t + 0.45);
  const o = osc('sine', 90, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  env(o, t, 0.004, 0.3, 0.28);
  o.start(t); o.stop(t + 0.4);
}

export function splash() {
  if (!started) return;
  const t = now();
  // Bright noise burst swept downward through a bandpass reads as water.
  const n = noiseSource(1.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(420, t + 0.5);
  bp.Q.value = 0.8;
  n.connect(bp);
  env(bp, t, 0.004, 0.6, 0.34);
  env(bp, t, 0.004, 1.0, 0.16, verbBus);
  n.start(t); n.stop(t + 1.2);

  // Low gulp underneath.
  const o = osc('sine', 300, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
  env(o, t, 0.006, 0.34, 0.2);
  o.start(t); o.stop(t + 0.45);

  // Trailing droplets.
  for (let i = 0; i < 5; i++) {
    const tt = t + 0.14 + Math.random() * 0.5;
    const d = osc('sine', 900 + Math.random() * 900, tt);
    d.frequency.exponentialRampToValueAtTime(300, tt + 0.08);
    env(d, tt, 0.002, 0.09, 0.05);
    d.start(tt); d.stop(tt + 0.14);
  }
}

export function crumble() {
  if (!started) return;
  const t = now();
  const n = noiseSource(1.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
  n.connect(bp);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  bp.connect(g); g.connect(sfxBus);
  n.start(t); n.stop(t + 0.8);
}

export function hurt(mine) {
  if (!started) return;
  const t = now();
  const o = osc('sawtooth', mine ? 180 : 240, t);
  o.frequency.exponentialRampToValueAtTime(mine ? 70 : 110, t + 0.3);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1400;
  o.connect(f);
  env(f, t, 0.008, 0.34, 0.2);
  o.start(t); o.stop(t + 0.45);
}

export function ricochet() {
  if (!started) return;
  const t = now();
  const o = osc('sawtooth', 1700 + Math.random() * 600, t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.16);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 7;
  o.connect(f);
  env(f, t, 0.002, 0.18, 0.14);
  o.start(t); o.stop(t + 0.24);
}

export function countdown(last) {
  if (!started) return;
  const t = now();
  const o = osc('square', last ? 880 : 520, t);
  env(o, t, 0.003, last ? 0.4 : 0.12, 0.13);
  o.start(t); o.stop(t + 0.5);
}

export function victory() {
  if (!started) return;
  const t = now();
  const seq = [0, 4, 7, 12, 16, 19];
  seq.forEach((s, i) => {
    const f = 220 * Math.pow(2, s / 12);
    const tt = t + i * 0.14;
    const o = osc('sawtooth', f, tt);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 2200;
    o.connect(flt);
    env(flt, tt, 0.01, 0.55, 0.16, verbBus);
    env(flt, tt, 0.01, 0.4, 0.12);
    o.start(tt); o.stop(tt + 0.7);
  });
}

export function defeat() {
  if (!started) return;
  const t = now();
  const seq = [12, 8, 5, 0];
  seq.forEach((s, i) => {
    const f = 220 * Math.pow(2, s / 12);
    const tt = t + i * 0.22;
    const o = osc('sawtooth', f, tt);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 1100;
    o.connect(flt);
    env(flt, tt, 0.02, 0.8, 0.15, verbBus);
    env(flt, tt, 0.02, 0.6, 0.12);
    o.start(tt); o.stop(tt + 1.0);
  });
}

// ------------------------------------------------------- ambient wind

let windNode = null, windGain = null, windFilter = null, windPan = null;

export function startWind() {
  if (!started || windNode) return;
  const n = noiseSource(0.35);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 480; f.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0.0;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  n.connect(f); f.connect(g);
  if (p) { g.connect(p); p.connect(sfxBus); } else { g.connect(sfxBus); }
  n.start();
  windNode = n; windGain = g; windFilter = f; windPan = p;
}

// wind is the signed game value; maxWind is its magnitude ceiling.
export function setWind(wind, maxWind) {
  if (!windGain) return;
  const mag = Math.min(1, Math.abs(wind) / (maxWind || 1));
  const t = now();
  windGain.gain.setTargetAtTime(0.012 + 0.075 * mag, t, 0.5);
  windFilter.frequency.setTargetAtTime(320 + 700 * mag, t, 0.6);
  if (windPan) windPan.pan.setTargetAtTime(Math.sign(wind) * mag * 0.7, t, 0.6);
}

export function stopWind() {
  if (!windNode) return;
  try { windNode.stop(); } catch (e) { /* already stopped */ }
  windNode = null; windGain = null; windFilter = null; windPan = null;
}

// ------------------------------------------------------------- music

const NOTE = (semi) => 55 * Math.pow(2, semi / 12);

let musicTimer = null;
let musicStep = 0;
let currentTrack = null;
let nextNoteTime = 0;

const TRACKS = {
  // Slow, ominous. Minor drone, distant timpani, sparse bugle motif.
  menu: {
    bpm: 76,
    stepsPerBeat: 2,
    root: 3,
    play(t, step, root) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      if (s === 0) {
        const chords = [[0, 7, 12], [0, 7, 12], [-2, 5, 10], [-4, 3, 8]];
        chords[bar].forEach((iv) => padVoice(t, NOTE(root + 12 + iv), 3.4, 0.055));
      }
      if (s === 0 || s === 6 || s === 10) drumLow(t, s === 0 ? 0.34 : 0.2);
      if (bar === 3) {
        const mel = { 0: 12, 4: 15, 6: 19, 10: 15, 12: 12 };
        if (mel[s] !== undefined) bugle(t, NOTE(root + 24 + mel[s]), 0.55, 0.07);
      }
      if (s === 8 && bar % 2 === 1) windGust(t);
    },
  },
  // Marching, tense. Snare ostinato, low brass stabs, minor melody.
  battle: {
    bpm: 104,
    stepsPerBeat: 4,
    root: 3,
    play(t, step, root) {
      const bar = Math.floor(step / 16) % 8;
      const s = step % 16;
      const snarePat = [0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];
      if (snarePat[s]) snare(t, s % 4 === 0 ? 0.16 : 0.085);
      if (s === 0 || s === 8) drumLow(t, 0.3);
      if (s === 6) drumLow(t, 0.16);
      const bassProg = [0, 0, -4, -4, -5, -5, -2, 5];
      if (s % 4 === 0) brass(t, NOTE(root + 12 + bassProg[bar]), 0.5, 0.1);
      if (s === 0) {
        const iv = bar % 2 === 0 ? [0, 3, 7] : [0, 3, 8];
        iv.forEach((v) => padVoice(t, NOTE(root + 24 + bassProg[bar] + v), 1.7, 0.028));
      }
      if (bar >= 4) {
        const mel = { 0: 12, 3: 10, 6: 8, 8: 7, 11: 10, 14: 12 };
        if (mel[s] !== undefined) bugle(t, NOTE(root + 24 + mel[s]), 0.32, 0.045);
      }
    },
  },
};

function padVoice(t, f, dur, amp) {
  const o1 = osc('sawtooth', f, t);
  const o2 = osc('sawtooth', f * 1.005, t);
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(340, t);
  flt.frequency.linearRampToValueAtTime(760, t + dur * 0.4);
  flt.frequency.linearRampToValueAtTime(300, t + dur);
  flt.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + dur * 0.28);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o1.connect(flt); o2.connect(flt); flt.connect(g);
  g.connect(musicBus);
  const vg = ctx.createGain(); vg.gain.value = 0.4;
  g.connect(vg); vg.connect(verbBus);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function brass(t, f, dur, amp) {
  const o = osc('sawtooth', f, t);
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(180, t);
  flt.frequency.linearRampToValueAtTime(1500, t + 0.05);
  flt.frequency.linearRampToValueAtTime(500, t + dur);
  flt.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.03);
  g.gain.setValueAtTime(amp, t + dur * 0.6);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(flt); flt.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + dur + 0.05);
}

function bugle(t, f, dur, amp) {
  const o = osc('square', f, t);
  const o2 = osc('triangle', f * 2, t);
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass'; flt.frequency.value = 2600; flt.Q.value = 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(flt); o2.connect(flt); flt.connect(g);
  g.connect(musicBus);
  const vg = ctx.createGain(); vg.gain.value = 0.55;
  g.connect(vg); vg.connect(verbBus);
  o.start(t); o2.start(t);
  o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function drumLow(t, amp) {
  const o = osc('sine', 110, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(amp, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g); g.connect(musicBus);
  const vg = ctx.createGain(); vg.gain.value = 0.35;
  g.connect(vg); vg.connect(verbBus);
  o.start(t); o.stop(t + 0.6);
}

function snare(t, amp) {
  const n = noiseSource(1.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'highpass'; bp.frequency.value = 1300;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(amp, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  n.connect(bp); bp.connect(g); g.connect(musicBus);
  const vg = ctx.createGain(); vg.gain.value = 0.3;
  g.connect(vg); vg.connect(verbBus);
  n.start(t); n.stop(t + 0.16);
}

function windGust(t) {
  const n = noiseSource(0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
  n.connect(bp); bp.connect(g); g.connect(musicBus);
  n.start(t); n.stop(t + 2.5);
}

function scheduler() {
  if (!currentTrack || !ctx) return;
  const track = TRACKS[currentTrack];
  const stepDur = 60 / track.bpm / track.stepsPerBeat;
  while (nextNoteTime < ctx.currentTime + 0.2) {
    try { track.play(nextNoteTime, musicStep, track.root); } catch (e) { /* keep the beat */ }
    musicStep++;
    nextNoteTime += stepDur;
  }
}

export function playMusic(name) {
  if (!started) return;
  if (currentTrack === name) return;
  stopMusic();
  if (!musicOn || !TRACKS[name]) return;
  currentTrack = name;
  musicStep = 0;
  nextNoteTime = ctx.currentTime + 0.12;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(state.musicVol, ctx.currentTime + 1.6);
  musicTimer = setInterval(scheduler, 45);
  scheduler();
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  currentTrack = null;
  if (musicBus && ctx) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
  }
}

// Momentarily duck the music so an explosion cuts through.
export function duck(amount = 0.35, seconds = 0.9) {
  if (!musicBus || !ctx || !currentTrack) return;
  const t = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(state.musicVol * amount, t + 0.05);
  musicBus.gain.linearRampToValueAtTime(state.musicVol, t + seconds);
}

// ------------------------------------------------------------ mixer

export function setMuted(m) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}
export function isMuted() { return muted; }

export function setMusicEnabled(on) {
  musicOn = on;
  if (!on) stopMusic();
}
export function isMusicEnabled() { return musicOn; }

export function setSfxVolume(v) {
  state.sfxVol = v;
  if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}
export function setMusicVolume(v) {
  state.musicVol = v;
  if (musicBus && ctx && currentTrack) musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}
export function getVolumes() { return { sfx: state.sfxVol, music: state.musicVol }; }
