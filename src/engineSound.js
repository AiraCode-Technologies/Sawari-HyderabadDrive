// The engine of a 1.2 L four-cylinder petrol car, made the way a real one makes its
// sound: as a train of combustion pulses, not as steady tones.
//
// A four-stroke four-cylinder fires twice per crank turn, so pulses arrive at rpm / 30
// per second (28 a second at idle, about 200 at the redline). Each pulse is a short
// pressure burst: a fast rise, a decay of a few milliseconds, some combustion noise that
// grows with throttle, and a weaker, inverted echo from the exhaust pipe. The four
// cylinders are never quite equal and never fire at exactly even intervals, which gives
// the lumpy idle and the low rumble real engines have. The pulse train then goes through
// the exhaust: a resonance and a muffler that opens up with throttle and revs.
//
// The pulses are generated sample by sample in an AudioWorklet, from a source string
// (no extra file to serve). Browsers without AudioWorklet keep the older tone engine.

const PROCESSOR = `
class SawariEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 850, minValue: 0, maxValue: 9000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.phase = 0;
    this.next = 1;
    this.cyl = 0;
    this.imb = [1.0, 0.84, 1.09, 0.91]; // the four cylinders, each a little different
    this.rpm = 850;
    this.load = 0;
    this.seed = 12345;
    this.P = []; // active pulses: [age in samples, amplitude, decay, noise weight]
    for (let i = 0; i < 24; i++) this.P.push([1e9, 0, 1, 0]);
    this.k = 0;
  }
  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
  fire(sr) {
    const r = Math.min(1, Math.max(0, (this.rpm - 850) / 5350));
    const L = this.load;
    // stronger with throttle; a closed throttle at speed still pops softly (overrun)
    const spread = 0.16 * (1 - r) + 0.05;
    const a = this.imb[this.cyl] * (1 - spread + 2 * spread * this.rnd()) * (0.32 + 0.68 * L);
    const f = this.rpm / 30;
    const decay = Math.min(0.0036, Math.max(0.0007, 0.3 / f)) * sr; // samples
    const noise = 0.22 + 0.55 * L;
    const slot = this.P[this.k];
    slot[0] = 0; slot[1] = a; slot[2] = decay; slot[3] = noise;
    this.k = (this.k + 1) % this.P.length;
    this.cyl = (this.cyl + 1) % 4;
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const sr = sampleRate;
    const rpmT = params.rpm[0], loadT = params.load[0];
    const rise = 0.00025 * sr, echo = Math.round(0.0042 * sr);
    for (let i = 0; i < out.length; i++) {
      this.rpm += (rpmT - this.rpm) * 0.0012;
      this.load += (loadT - this.load) * 0.0025;
      const f = this.rpm / 30;
      this.phase += f / sr;
      if (this.phase >= this.next) {
        this.phase -= this.next;
        // firing intervals wander a little, most at idle
        const r = Math.min(1, Math.max(0, (this.rpm - 850) / 5350));
        const j = 0.035 * (1 - r) + 0.006;
        this.next = 1 + (this.rnd() * 2 - 1) * j;
        this.fire(sr);
      }
      let s = 0;
      for (const p of this.P) {
        const t = p[0];
        if (t > p[2] * 7 + echo) continue;
        // the pulse: a quick rise and an exponential decay, with combustion roughness
        if (t < p[2] * 7) {
          const env = Math.exp(-t / p[2]) - Math.exp(-t / rise);
          s += p[1] * env * (1 + p[3] * (this.rnd() * 2 - 1));
        }
        // the reflection from the end of the exhaust pipe: later, weaker, inverted
        const te = t - echo;
        if (te > 0) s -= 0.38 * p[1] * (Math.exp(-te / (p[2] * 1.4)) - Math.exp(-te / rise));
        p[0] = t + 1;
      }
      out[i] = s * 0.5;
    }
    return true;
  }
}
registerProcessor('sawari-engine', SawariEngine);
`;

// Builds the engine and its exhaust, connected to `dest`. Resolves to an object with
// set({ rpm, load, r, overrun, t }) or to null when the browser cannot run worklets.
export async function createPulseEngine(ctx, dest) {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, 'sawari-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  // the pulses all push one way: take out the offset and the sub-audible thump
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.7;
  // the exhaust's own resonance: the deep, round note of a small car's pipe
  const pipe = ctx.createBiquadFilter();
  pipe.type = 'peaking'; pipe.frequency.value = 110; pipe.Q.value = 1.2; pipe.gain.value = 5;
  // a little grit when worked hard
  const grit = ctx.createWaveShaper();
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
  grit.curve = c; grit.oversample = '2x';
  // the muffler: closed and soft at idle, opening up with throttle and revs
  const muffler = ctx.createBiquadFilter();
  muffler.type = 'lowpass'; muffler.frequency.value = 400; muffler.Q.value = 0.8;
  const level = ctx.createGain();
  level.gain.value = 0;
  node.connect(hp).connect(pipe).connect(grit).connect(muffler).connect(level).connect(dest);
  const P = node.parameters;
  return {
    node,
    set({ rpm, load, r, overrun, shifting, inside, t }) {
      P.get('rpm').setTargetAtTime(rpm, t, 0.02);
      P.get('load').setTargetAtTime(load, t, 0.03);
      pipe.frequency.setTargetAtTime(95 + r * 110, t, 0.1);
      muffler.frequency.setTargetAtTime((overrun ? 330 : 420) + load * 1400 + r * 1600, t, 0.06);
      const g = (0.7 + load * 0.3 + r * 0.4) * (overrun ? 0.75 : 1) * (shifting ? 0.6 : 1) * (inside ? 0.85 : 1);
      level.gain.setTargetAtTime(g * GAIN, t, shifting ? 0.03 : 0.08);
    },
  };
}

// overall loudness: measured to match the older tone engine over a drive (idle, a
// full-throttle pull, a gear change, cruising and coasting)
const GAIN = 0.22;
