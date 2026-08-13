// Fully synthesised audio — no files. Every sound effect is a short envelope
// over an oscillator or a noise burst, and the score is a layered generative
// loop whose intensity tracks the chaos meter.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.enabled = true;
    this.volume = 0.8;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.85;
    this.started = false;
    this._musicTimer = null;
    this._intensity = 0;
    this._targetIntensity = 0;
    this._step = 0;
    this._theme = 'warm';
    this._voices = 0;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    // A gentle bus compressor keeps a tornado from clipping the mix.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;

    // Shared reverb — a library is a big stone room and should sound like one.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = makeImpulse(this.ctx, 2.6, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.28;

    this.sfxGain.connect(this.comp);
    this.musicGain.connect(this.comp);
    this.sfxGain.connect(this.reverbGain);
    this.musicGain.connect(this.reverbGain);
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = makeNoise(this.ctx, 2);
  }

  async resume() {
    this.init();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    this.started = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.enabled ? v : 0;
  }
  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicGain && this._musicTimer && this.ctx) {
      this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
    }
  }
  setSfxVolume(v) { this.sfxVolume = v; if (this.sfxGain) this.sfxGain.gain.value = v; }

  mute(on) {
    this.enabled = !on;
    if (this.master) this.master.gain.value = on ? 0 : this.volume;
  }

  /** Briefly make space for an important gameplay cue. */
  duckMusic(amount = 0.38, duration = 0.75) {
    if (!this.ctx || !this.musicGain || !this._musicTimer) return;
    const now = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(Math.max(0.0001, this.musicVolume * amount), now, 0.025);
    g.setTargetAtTime(Math.max(0.0001, this.musicVolume), now + duration, 0.16);
  }

  _env(node, { attack = 0.005, decay = 0.2, sustain = 0, release = 0.05, peak = 1, t0 }) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * (sustain || 0.001)), t0 + attack + decay);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release);
  }

  _tone({ freq = 440, type = 'sine', dur = 0.25, gain = 0.3, slide = 0, delay = 0, pan = 0, filter = null, detune = 0 }) {
    if (!this.ctx || !this.enabled) return;
    freq = num(freq, 440, 20, 18000); dur = num(dur, 0.25, 0.01, 8);
    gain = num(gain, 0.3, 0, 1); slide = num(slide, 0, 0.01, 100);
    delay = num(delay, 0, 0, 8); pan = num(pan, 0, -1, 1); detune = num(detune, 0, -2400, 2400);
    if (this._voices > 42) return;   // hard voice cap; disasters get loud
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    osc.detune.value = detune;

    const g = this.ctx.createGain();
    this._env(g, { attack: Math.min(0.02, dur * 0.15), decay: dur * 0.5, sustain: 0.3, release: dur * 0.4, peak: gain, t0 });

    let node = osc;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.freq ?? 1200, t0);
      if (filter.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, filter.freq * filter.sweep), t0 + dur);
      f.Q.value = filter.q ?? 1;
      node.connect(f); node = f;
    }
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(g); g.connect(p); p.connect(this.sfxGain);

    this._voices++;
    osc.onended = () => { this._voices--; };
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
  }

  _noise({ dur = 0.25, gain = 0.3, filterFreq = 1400, sweep = 0.4, q = 1, type = 'bandpass', delay = 0, pan = 0 }) {
    if (!this.ctx || !this.enabled) return;
    dur = num(dur, 0.25, 0.01, 8); gain = num(gain, 0.3, 0, 1);
    filterFreq = num(filterFreq, 1400, 30, 18000); sweep = num(sweep, 0.4, 0.01, 20);
    q = num(q, 1, 0.05, 30); delay = num(delay, 0, 0, 8); pan = num(pan, 0, -1, 1);
    if (this._voices > 42) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, filterFreq * sweep), t0 + dur);
    f.Q.value = q;

    const g = this.ctx.createGain();
    this._env(g, { attack: 0.004, decay: dur * 0.4, sustain: 0.25, release: dur * 0.5, peak: gain, t0 });

    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));

    src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxGain);
    this._voices++;
    src.onended = () => { this._voices--; };
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  /** Fire a named effect. `opts.pan` is -1..1, usually derived from screen X. */
  play(name, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const pan = opts.pan ?? 0;
    const v = (opts.volume ?? 1);
    const rate = opts.rate ?? 1;

    if (['bossHorn', 'quake', 'alarm', 'levelup', 'win', 'lose'].includes(name)) {
      this.duckMusic(name === 'alarm' ? 0.5 : 0.32, name === 'quake' ? 1.4 : 0.8);
    } else if (name === 'boom' && (opts.volume ?? 1) >= 0.7) {
      this.duckMusic(0.44, 0.55);
    }

    switch (name) {
      case 'step':
        this._noise({ dur: 0.09, gain: 0.1 * v, filterFreq: 900 * rate, sweep: 0.3, q: 1.2, pan });
        break;
      case 'pickup':
        this._tone({ freq: 620 * rate, type: 'triangle', dur: 0.11, gain: 0.16 * v, slide: 1.7, pan });
        this._tone({ freq: 1240 * rate, type: 'sine', dur: 0.09, gain: 0.07 * v, slide: 1.6, delay: 0.02, pan });
        break;
      case 'shelve':
        this._tone({ freq: 330 * rate, type: 'sine', dur: 0.2, gain: 0.14 * v, slide: 1.5, pan });
        this._tone({ freq: 495 * rate, type: 'sine', dur: 0.26, gain: 0.11 * v, delay: 0.05, pan });
        this._noise({ dur: 0.13, gain: 0.07 * v, filterFreq: 2600, sweep: 0.25, pan });
        break;
      case 'combo':
        this._tone({ freq: NOTE(72 + Math.min(12, opts.step || 0)), type: 'triangle', dur: 0.16, gain: 0.16 * v, pan });
        break;
      case 'dash':
        this._noise({ dur: 0.26, gain: 0.16 * v, filterFreq: 2600, sweep: 0.12, q: 0.8, pan });
        this._tone({ freq: 180, type: 'sine', dur: 0.2, gain: 0.1 * v, slide: 2.4, pan });
        break;
      case 'thud':
        this._tone({ freq: 110 * rate, type: 'sine', dur: 0.22, gain: 0.2 * v, slide: 0.45, pan });
        this._noise({ dur: 0.1, gain: 0.1 * v, filterFreq: 500, sweep: 0.3, pan });
        break;
      case 'stake':
        this._noise({ dur: 0.12, gain: 0.13 * v, filterFreq: 1750 * rate, sweep: 0.3, q: 1.1, pan });
        this._tone({ freq: 145 * rate, type: 'triangle', dur: 0.18, gain: 0.16 * v, slide: 0.52, pan });
        break;
      case 'kick':
        this._tone({ freq: 82 * rate, type: 'sine', dur: 0.28, gain: 0.28 * v, slide: 0.4, pan });
        this._noise({ dur: 0.16, gain: 0.15 * v, filterFreq: 620, sweep: 0.2, type: 'lowpass', pan });
        break;
      case 'vampireDust':
        this._noise({ dur: 0.72, gain: 0.22 * v, filterFreq: 3100, sweep: 0.08, q: 1.6, pan });
        this._tone({ freq: 310 * rate, type: 'sine', dur: 0.52, gain: 0.12 * v, slide: 2.1, pan });
        break;
      case 'vampireRise':
        this._tone({ freq: 62, type: 'sawtooth', dur: 1.25, gain: 0.2 * v, slide: 0.55, filter: { type: 'lowpass', freq: 520, sweep: 1.3, q: 3 } });
        this._noise({ dur: 0.9, gain: 0.12 * v, filterFreq: 420, sweep: 0.45, type: 'lowpass' });
        break;
      case 'bookfall':
        this._noise({ dur: 0.16, gain: 0.11 * v, filterFreq: 1500 * rate, sweep: 0.3, q: 0.9, pan });
        this._tone({ freq: 150 * rate, type: 'sine', dur: 0.14, gain: 0.09 * v, slide: 0.6, pan });
        break;
      case 'laugh': {
        const base = 380 + Math.random() * 220;
        for (let i = 0; i < 5; i++) {
          this._tone({
            freq: base * (1 + (i % 2) * 0.22) * rate, type: 'triangle',
            dur: 0.09, gain: 0.1 * v, delay: i * 0.085, slide: 1.15, pan,
          });
        }
        break;
      }
      case 'zap':
        this._tone({ freq: 1800, type: 'sawtooth', dur: 0.3, gain: 0.12 * v, slide: 0.25, pan, filter: { type: 'bandpass', freq: 2400, sweep: 0.2, q: 6 } });
        break;
      case 'beam':
        this._tone({ freq: 90, type: 'sawtooth', dur: 0.5, gain: 0.06 * v, pan, filter: { type: 'lowpass', freq: 900, sweep: 1.8, q: 4 } });
        break;
      case 'whoosh':
        this._noise({ dur: 0.4, gain: 0.14 * v, filterFreq: 1800, sweep: 0.18, q: 1.4, pan });
        break;
      case 'boom':
        this._tone({ freq: 90, type: 'sine', dur: 0.9, gain: 0.34 * v, slide: 0.25, pan });
        this._noise({ dur: 0.8, gain: 0.26 * v, filterFreq: 700, sweep: 0.12, q: 0.6, type: 'lowpass', pan });
        break;
      case 'quake':
        this._tone({ freq: 42, type: 'sine', dur: 2.4, gain: 0.3 * v, pan });
        this._noise({ dur: 2.4, gain: 0.14 * v, filterFreq: 240, sweep: 0.7, type: 'lowpass', pan });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this._tone({ freq: 740, type: 'square', dur: 0.14, gain: 0.1 * v, delay: i * 0.24, pan });
          this._tone({ freq: 560, type: 'square', dur: 0.14, gain: 0.1 * v, delay: i * 0.24 + 0.12, pan });
        }
        break;
      case 'splat':
        this._noise({ dur: 0.34, gain: 0.2 * v, filterFreq: 620, sweep: 0.22, q: 0.7, type: 'lowpass', pan });
        this._tone({ freq: 160, type: 'triangle', dur: 0.3, gain: 0.1 * v, slide: 0.4, pan });
        break;
      case 'mop':
        this._noise({ dur: 0.3, gain: 0.09 * v, filterFreq: 3200, sweep: 0.35, q: 2, pan });
        break;
      case 'powerup':
        [0, 4, 7, 12].forEach((n, i) => this._tone({ freq: NOTE(64 + n), type: 'triangle', dur: 0.2, gain: 0.14 * v, delay: i * 0.07, pan }));
        break;
      case 'levelup':
        [0, 4, 7, 12, 16, 19].forEach((n, i) => this._tone({ freq: NOTE(60 + n), type: 'triangle', dur: 0.42, gain: 0.14 * v, delay: i * 0.075, pan }));
        break;
      case 'ui':
        this._tone({ freq: 880 * rate, type: 'sine', dur: 0.06, gain: 0.09 * v });
        break;
      case 'uiBig':
        this._tone({ freq: 300, type: 'triangle', dur: 0.28, gain: 0.14 * v, slide: 1.6 });
        break;
      case 'error':
        this._tone({ freq: 180, type: 'square', dur: 0.16, gain: 0.1 * v, slide: 0.7 });
        break;
      case 'bossHorn':
        this._tone({ freq: 116, type: 'sawtooth', dur: 1.4, gain: 0.2 * v, filter: { type: 'lowpass', freq: 700, sweep: 1.4, q: 3 } });
        this._tone({ freq: 174, type: 'sawtooth', dur: 1.3, gain: 0.14 * v, delay: 0.1, filter: { type: 'lowpass', freq: 800, sweep: 1.2, q: 3 } });
        break;
      case 'karen':
        for (let i = 0; i < 7; i++) {
          this._tone({ freq: 520 + Math.random() * 400, type: 'square', dur: 0.07, gain: 0.07 * v, delay: i * 0.1, pan, filter: { type: 'bandpass', freq: 1400, q: 5 } });
        }
        break;
      case 'alien':
        this._tone({ freq: 900, type: 'sine', dur: 0.7, gain: 0.1 * v, slide: 0.35, pan, filter: { type: 'bandpass', freq: 1500, sweep: 0.4, q: 8 } });
        this._tone({ freq: 1350, type: 'sine', dur: 0.6, gain: 0.06 * v, slide: 2.4, delay: 0.08, pan });
        break;
      case 'win':
        [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((n, i) => this._tone({ freq: NOTE(60 + n), type: 'triangle', dur: 0.5, gain: 0.15 * v, delay: i * 0.13 }));
        break;
      case 'lose':
        [0, -3, -5, -8].forEach((n, i) => this._tone({ freq: NOTE(55 + n), type: 'sawtooth', dur: 0.9, gain: 0.13 * v, delay: i * 0.28, filter: { type: 'lowpass', freq: 700, sweep: 0.5, q: 2 } }));
        break;
    }
  }

  // --- Generative score -----------------------------------------------------

  startMusic(theme = 'warm') {
    this.init();
    if (!this.ctx) return;
    this._theme = theme;
    this._step = 0;
    if (this._musicTimer) clearInterval(this._musicTimer);
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 1.4);
    this._musicTimer = setInterval(() => this._tick(), 250);
  }

  stopMusic(fade = 1.2) {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade / 3);
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }

  setIntensity(v) { this._targetIntensity = Math.max(0, Math.min(1, v)); }

  _tick() {
    if (!this.ctx || !this.enabled) return;
    this._intensity += (this._targetIntensity - this._intensity) * 0.06;
    const I = this._intensity;
    const t0 = this.ctx.currentTime + 0.02;
    const s = this._step++;

    const SCALES = {
      cemetery: [0, 2, 3, 5, 7, 8, 11],  // tense harmonic minor under the patrol
      warm: [0, 2, 3, 5, 7, 8, 10],       // aeolian, cosy and a bit wistful
      synth: [0, 2, 3, 5, 7, 9, 10],
      funk: [0, 3, 5, 6, 7, 10],
      muzak: [0, 2, 4, 5, 7, 9, 11],
    };
    const ROOTS = { cemetery: 38, warm: 45, synth: 43, funk: 41, muzak: 48 };
    const scale = SCALES[this._theme] || SCALES.warm;
    const root = ROOTS[this._theme] || 45;

    const bar = Math.floor(s / 16) % 4;
    const chordRoots = [0, 5, 3, 7];
    const chord = chordRoots[bar];

    const mk = (midi, { type = 'sine', dur = 1.2, gain = 0.1, delay = 0, detune = 0, filterFreq = 1200 }) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = NOTE(midi);
      osc.detune.value = detune;
      const g = this.ctx.createGain();
      const st = t0 + delay;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(gain, st + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      osc.connect(f); f.connect(g); g.connect(this.musicGain);
      osc.start(st); osc.stop(st + dur + 0.05);
    };

    // Pad — always present, opens up as chaos rises.
    if (s % 16 === 0) {
      for (const iv of [0, 4, 7, 11]) {
        mk(root + chord + iv, { type: 'sine', dur: 4.4, gain: 0.045 + I * 0.02, filterFreq: 700 + I * 1800, detune: (Math.random() - 0.5) * 8 });
      }
    }

    // Bass pulse
    if (s % 4 === 0) {
      mk(root - 12 + chord, { type: 'triangle', dur: 0.9, gain: 0.07 + I * 0.05, filterFreq: 400 });
    }

    // Arpeggio wakes up with the chaos meter.
    if (I > 0.18 && s % 2 === 0) {
      const n = scale[(s / 2) % scale.length];
      mk(root + 12 + chord + n, { type: 'triangle', dur: 0.35, gain: 0.03 + I * 0.05, filterFreq: 1400 + I * 3000 });
    }
    if (I > 0.5 && s % 1 === 0 && Math.random() < 0.4) {
      const n = scale[Math.floor(Math.random() * scale.length)];
      mk(root + 24 + chord + n, { type: 'sine', dur: 0.22, gain: 0.02 + I * 0.03, filterFreq: 4000 });
    }
    // Heartbeat at high chaos.
    if (I > 0.72 && s % 8 === 0) {
      mk(root - 24, { type: 'sine', dur: 0.4, gain: 0.12 * I, filterFreq: 200 });
      mk(root - 24, { type: 'sine', dur: 0.35, gain: 0.09 * I, delay: 0.18, filterFreq: 200 });
    }
  }
}

/** Clamp a gameplay-derived number into something WebAudio will accept. */
function num(v, fallback, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function makeNoise(ctx, seconds) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}
