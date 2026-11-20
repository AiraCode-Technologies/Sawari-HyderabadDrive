// Synthesised engine, brakes, tyres, indicator ticks and spoken directions. Everything is
// generated in the browser; there are no audio files. The engine is a train of
// combustion pulses (engineSound.js); browsers without AudioWorklet get a tone engine.
import { createPulseEngine } from './engineSound.js';

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
    // a gentle limiter so a hard stop in a tight corner never clips
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // ---- engine: combustion pulses through the exhaust; the tone engine if the browser
    // cannot run them
    this.pulse = null;
    createPulseEngine(ctx, this.master)
      .then((e) => {
        if (this.ctx !== ctx) return; // stopped meanwhile
        if (e) this.pulse = e;
        else this.toneEngine();
      })
      .catch(() => { if (this.ctx === ctx) this.toneEngine(); });

    // ---- shared noise (one 2 s buffer, slightly pink so it is not hissy)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let p0 = 0, p1 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      p0 = 0.97 * p0 + w * 0.15; p1 = 0.6 * p1 + w * 0.4;
      d[i] = (p0 + p1 + w * 0.25) * 0.7;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noise.start();
    const band = (type, f, q, to = this.master) => {
      const fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
      this.noise.connect(fl).connect(g).connect(to);
      return { f: fl, g };
    };
    this.intake = band('bandpass', 900, 0.8); // induction roar under throttle
    this.rumble = band('lowpass', 320, 0.7); // tyres on the road
    this.wind = band('bandpass', 520, 0.5); // wind at speed
    this.brakeHiss = band('bandpass', 480, 1.4); // pads on the discs
    // ABS chatter: a fast pulse on the hard-braking tyre howl
    this.absGain = ctx.createGain();
    this.absGain.gain.value = 1;
    this.absGain.connect(this.master);
    this.brakeHowl = band('bandpass', 950, 4, this.absGain); // tyres at the limit under hard braking
    this.absLfo = ctx.createOscillator();
    this.absLfo.type = 'square';
    this.absLfo.frequency.value = 14;
    this.absDepth = ctx.createGain();
    this.absDepth.gain.value = 0;
    this.absLfo.connect(this.absDepth).connect(this.absGain.gain);
    this.absLfo.start();
    this.scrub = band('bandpass', 700, 1.6); // tyres scrubbing through a tight bend
    this.squealA = band('bandpass', 1650, 9); // the squeal itself: two bands that
    this.squealB = band('bandpass', 2350, 11); // wander, so it never sounds like a tone

    this.prev = { speed: 0, brakeFrom: 0, shifting: false, gear: 'D' };
  }

  // The older engine, made of steady tones: only for browsers without AudioWorklet.
  toneEngine() {
    // ---- engine: a 1.2 L four-cylinder. It fires twice per crank turn, so the
    // note is rpm/30 Hz (28 Hz at idle, about 200 Hz at the redline), built from
    // a few harmonics, roughened by a soft clipper that bites harder under load.
    const ctx = this.ctx;
    const osc = (type, gain, to) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; g.gain.value = gain;
      o.connect(g).connect(to); o.start();
      return o;
    };
    this.engPre = ctx.createGain();
    this.engPre.gain.value = 1;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this.clipCurve(2.2);
    this.shaper.oversample = '2x';
    this.engBody = ctx.createBiquadFilter(); // the chesty exhaust resonance
    this.engBody.type = 'peaking'; this.engBody.frequency.value = 110; this.engBody.Q.value = 1.1; this.engBody.gain.value = 6;
    this.engTone = ctx.createBiquadFilter();
    this.engTone.type = 'lowpass'; this.engTone.frequency.value = 500; this.engTone.Q.value = 0.9;
    // idle lope: the firing pulses are uneven at low revs (amplitude wobble)
    this.lope = ctx.createGain();
    this.lope.gain.value = 0.8;
    this.lopeLfo = ctx.createOscillator();
    this.lopeLfo.type = 'sine';
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0.2;
    this.lopeLfo.connect(this.lopeDepth).connect(this.lope.gain);
    this.lopeLfo.start();
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;
    this.engPre.connect(this.shaper).connect(this.engBody).connect(this.engTone).connect(this.lope).connect(this.engineGain).connect(this.master);
    this.oFire = osc('sawtooth', 0.55, this.engPre); // firing note
    this.oSub = osc('sine', 0.7, this.engPre); // crank half-order rumble
    this.oH2 = osc('triangle', 0.25, this.engPre); // second order
    this.oH3 = osc('square', 0.08, this.engPre); // valvetrain edge
    this.oFire2 = osc('sawtooth', 0.3, this.engPre); // a slightly detuned twin: beating, never a pure buzz
  }

  clipCurve(k) {
    const n = 1024, c = new Float32Array(n), th = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / th; }
    return c;
  }

  // Called every frame with the car's state:
  // { rpm, throttle, speed (m/s), slip 0..1, brake 0..1, latAcc (m/s²), shifting, handbrake, inside, reverse }
  update(st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, P = this.prev;
    const set = (param, v, tc) => param.setTargetAtTime(v, t, tc);
    const { rpm, throttle = 0, speed = 0, slip = 0, brake = 0, latAcc = 0, shifting = false, handbrake = false, inside = false, reverse = false } = st;
    const r = Math.max(0, Math.min(1, (rpm - 850) / 5350)); // 0 idle .. 1 redline
    const load = shifting ? 0.15 : throttle;
    const overrun = throttle < 0.05 && rpm > 1500; // coasting down on the engine

    // ---- engine
    if (this.pulse) this.pulse.set({ rpm, load, r, overrun, shifting, inside, t });
    else if (this.oFire) this.updateTone(t, set, rpm, r, load, overrun, shifting, inside);
    set(this.intake.f.frequency, 600 + r * 1400, 0.08);
    set(this.intake.g.gain, load * (0.012 + r * 0.04) * (inside ? 0.7 : 1), 0.08);
    if (reverse !== (P.gear === 'R')) this.clunk(0.5); // the gearbox engaging
    P.gear = reverse ? 'R' : 'D';
    if (shifting && !P.shifting && throttle > 0.3) this.clunk(0.15); // a soft shift thump
    P.shifting = shifting;
    this.updateRest(t, set, P, speed, brake, latAcc, slip, handbrake, inside);
  }

  updateTone(t, set, rpm, r, load, overrun, shifting, inside) {
    const jitter = 1 + (Math.random() - 0.5) * 0.012 * (1 - r); // a living idle
    const fire = (rpm / 30) * jitter;
    set(this.oFire.frequency, fire, 0.03);
    set(this.oFire2.frequency, fire * 1.012, 0.03);
    set(this.oSub.frequency, fire * 0.5, 0.03);
    set(this.oH2.frequency, fire * 2, 0.03);
    set(this.oH3.frequency, fire * 3, 0.03);
    set(this.lopeLfo.frequency, fire * 0.25, 0.05);
    set(this.lopeDepth.gain, 0.22 * (1 - r) * (1 - load * 0.7), 0.1);
    set(this.engPre.gain, 0.7 + load * 1.6 + r * 0.5, 0.06); // harder into the clipper under load
    set(this.engTone.frequency, (overrun ? 260 : 340) + load * 1500 + r * 900, 0.07);
    set(this.engBody.frequency, 90 + r * 90, 0.1);
    const eng = (0.03 + load * 0.045 + r * 0.03) * (overrun ? 0.7 : 1) * (shifting ? 0.55 : 1) * (inside ? 0.85 : 1);
    set(this.engineGain.gain, eng, shifting ? 0.03 : 0.08);
  }

  updateRest(t, set, P, speed, brake, latAcc, slip, handbrake, inside) {
    // ---- road and wind
    set(this.rumble.g.gain, Math.min(0.11, speed * 0.0055) * (inside ? 0.7 : 1), 0.2);
    set(this.rumble.f.frequency, 220 + Math.min(400, speed * 12), 0.3);
    set(this.wind.g.gain, Math.min(0.05, Math.max(0, speed - 10) * 0.002) * (inside ? 0.6 : 1), 0.3);

    // ---- brakes
    const sf = Math.min(1, speed / 12);
    set(this.brakeHiss.g.gain, brake * sf * 0.11, 0.06);
    set(this.brakeHiss.f.frequency, 380 + speed * 9, 0.1);
    const hard = Math.max(0, brake - 0.6) / 0.4; // 0..1 over the last part of the pedal
    const absOn = hard > 0.4 && speed > 4;
    set(this.brakeHowl.g.gain, hard * Math.min(1, speed / 8) * 0.2, 0.05);
    set(this.brakeHowl.f.frequency, 820 + speed * 6, 0.1);
    set(this.absDepth.gain, absOn ? 0.45 : 0, 0.02);
    if (brake > 0.05 && speed > P.brakeFrom) P.brakeFrom = speed;
    if (brake < 0.05 && speed > 1) P.brakeFrom = 0;
    // coming to rest under the brakes: a pad creak and the body settling back
    if (P.speed > 0.5 && speed <= 0.5 && brake > 0.05 && P.brakeFrom > 2) {
      this.creak(Math.min(1, P.brakeFrom / 15));
      this.clunk(Math.min(0.6, 0.15 + P.brakeFrom / 30));
      P.brakeFrom = 0;
    }

    // ---- tyres in a bend: scrub first, then a squeal that wanders in pitch
    const lat = Math.abs(latAcc);
    const scrub = Math.max(0, Math.min(1, (lat - 3.5) / 4)) * Math.min(1, speed / 5);
    const hb = handbrake && speed > 2 ? Math.min(1, speed / 10) : 0;
    set(this.scrub.g.gain, scrub * 0.06 + hb * 0.05, 0.08);
    set(this.scrub.f.frequency, 600 + lat * 25, 0.1);
    const sq = Math.min(1, slip + Math.max(0, lat - 6.5) * 0.12 + hb * 0.6);
    const wob = Math.sin(t * 7.3) * 60 + Math.sin(t * 2.1) * 90 + (Math.random() - 0.5) * 80;
    set(this.squealA.f.frequency, 1500 + sq * 350 + wob, 0.04);
    set(this.squealB.f.frequency, 2200 + sq * 300 - wob * 0.7, 0.04);
    set(this.squealA.g.gain, sq * 0.4, 0.05);
    set(this.squealB.g.gain, sq * sq * 0.22, 0.05);

    P.speed = speed;
  }

  // a short mechanical thump (shift, gearbox, the body settling)
  clunk(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + strength * 0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.18);
  }

  // brake pads creaking as the car comes to rest
  creak(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 18;
    f.frequency.setValueAtTime(1300 + Math.random() * 400, t);
    f.frequency.linearRampToValueAtTime(900 + Math.random() * 200, t + 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 + strength * 0.12, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    const src = ctx.createBufferSource();
    src.buffer = this.noise.buffer;
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.32);
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

  // The most natural English voice this device has, like a navigation app's: Indian
  // English first, then British, Australian and American; the neural / natural / online
  // / enhanced voices (Edge's Microsoft Natural voices, Chrome's and Android's Google
  // voices, Apple's enhanced ones) ahead of the basic built-in ones; novelty voices never.
  pickVoice() {
    if (this.guideVoice !== undefined) return this.guideVoice;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null; // not loaded yet: ask again next time
    const score = (v) => {
      const n = v.name.toLowerCase(), lang = v.lang.toLowerCase().replace('_', '-');
      if (!lang.startsWith('en')) return -1;
      if (/compact|eloquence|espeak|novelty|bad news|bells|whisper|zarvox|trinoids|albert|bubbles|cellos|jester|organ|superstar|wobble|boing|bahh|good news|pipe|junior|ralph|kathy|fred/.test(n)) return -1;
      let s = lang === 'en-in' ? 30 : /en-(gb|au|ie|nz)/.test(lang) ? 16 : lang === 'en-us' ? 14 : 8;
      if (/natural|neural|wavenet|studio|premium|enhanced|online/.test(n)) s += 26;
      if (/google/.test(n)) s += 18;
      if (/neerja|prabhat|veena|rishi|isha|heera|ravi|samantha|serena|karen|moira|sonia|libby|aria|jenny/.test(n)) s += 6;
      if (!v.localService) s += 2; // cloud voices are usually the natural-sounding ones
      return s;
    };
    const best = voices.map((v) => [score(v), v]).filter((x) => x[0] >= 0).sort((a, b) => b[0] - a[0])[0];
    this.guideVoice = best ? best[1] : null;
    return this.guideVoice;
  }

  say(text) {
    if (!this.voiceOn || this.muted || !('speechSynthesis' in window)) return;
    if (!this.voicesHooked) {
      // voices load in the background: choose again once the full list arrives
      this.voicesHooked = true;
      speechSynthesis.addEventListener?.('voiceschanged', () => { this.guideVoice = undefined; });
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
    u.rate = 1.0;
    u.pitch = 1.0;
    // the engine and road dip while the voice speaks, as a navigation app ducks music
    const duck = (on) => {
      if (!this.ctx || !this.master || this.muted) return;
      this.master.gain.setTargetAtTime(on ? 0.22 : 0.5, this.ctx.currentTime, on ? 0.08 : 0.35);
    };
    u.onstart = () => duck(true);
    u.onend = u.onerror = () => duck(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    if (m && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  // Silence everything at once (pause, the end of a drive, a hidden tab) and wake it
  // again later; speech is separate and is cancelled by the caller when it should stop.
  quiet(on) {
    this.quieted = on;
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
