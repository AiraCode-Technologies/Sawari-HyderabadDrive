// Synthesised engine note, indicator ticks and spoken directions. Everything is
// generated in the browser; there are no audio files.
export class Audio {
  constructor() {
    this.muted = false;
    this.voiceOn = true;
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;
    this.filter.connect(this.engineGain).connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.osc1.start();
    this.osc2.start();
    // tyre / road rumble: filtered noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 380;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(nf).connect(this.noiseGain).connect(this.master);
    // tyre squeal: the same noise through a narrow high band
    const sq = ctx.createBiquadFilter();
    sq.type = 'bandpass';
    sq.frequency.value = 1700;
    sq.Q.value = 7;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.noise.connect(sq).connect(this.squealGain).connect(this.master);
    this.noise.start();
  }

  update(rpm, throttle, speed, slip = 0) {
    if (this.squealGain) this.squealGain.gain.setTargetAtTime(slip * 0.5, this.ctx.currentTime, 0.06);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 28 + (rpm / 7000) * 150;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(380 + throttle * 900 + rpm * 0.08, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.035 + throttle * 0.05, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.006), t, 0.2);
  }

  // The car's twin-tone horn while the key is held.
  horn(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.hornNodes) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.8;
      const oscs = [415, 498].map((hz) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = hz;
        o.connect(f);
        o.start();
        return o;
      });
      f.connect(g).connect(this.master);
      g.gain.setTargetAtTime(0.16, t, 0.01);
      this.hornNodes = { g, oscs };
    } else if (!on && this.hornNodes) {
      const { g, oscs } = this.hornNodes;
      g.gain.setTargetAtTime(0, t, 0.02);
      for (const o of oscs) o.stop(t + 0.15);
      this.hornNodes = null;
    }
  }

  // A short honk somewhere in the traffic around (distance 0..1 sets loudness).
  distantHonk(distance) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400 - distance * 700;
    const base = 330 + Math.random() * 260;
    const beeps = Math.random() < 0.4 ? 2 : 1;
    for (let b = 0; b < beeps; b++) {
      const o = ctx.createOscillator();
      o.type = Math.random() < 0.5 ? 'square' : 'sawtooth';
      o.frequency.value = base;
      o.connect(f);
      o.start(t + b * 0.28);
      o.stop(t + b * 0.28 + 0.18 + Math.random() * 0.2);
    }
    g.gain.value = 0.05 * (1 - distance * 0.7);
    f.connect(g).connect(this.master);
  }

  tick(high) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = high ? 1900 : 1500;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.04);
  }

  bump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(0.5, 0.1 + strength * 0.04), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.32);
  }

  say(text) {
    if (!this.voiceOn || this.muted || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === 'en-IN') || voices.find((v) => v.lang.startsWith('en')) || null;
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    if (m && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
