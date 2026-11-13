import { segDist } from './util.js';

// Tracks how far along the route the car is and which instruction comes next.
export class Navigator {
  constructor(route) {
    this.pts = route.drive; // [x, y, h] keep-left drive line
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.length = this.cum[this.cum.length - 1];
    const scale = this.length / route.length;
    this.instructions = route.instructions.map((s) => ({ ...s, at: s.at * scale }));
    this.idx = 1;
    this.progress = 0;
    this.offset = 0; // distance from the drive line
    this.offTime = 0;
    this.lastGood = { x: this.pts[0][0], y: this.pts[0][1], h: this.pts[0][2], i: 1 };
  }

  project(x, y, i0, i1) {
    let best = null;
    for (let i = Math.max(1, i0); i <= Math.min(this.pts.length - 1, i1); i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const q = segDist(x, y, a[0], a[1], b[0], b[1]);
      if (!best || q.d < best.d) best = { d: q.d, i, s: this.cum[i - 1] + q.t * (this.cum[i] - this.cum[i - 1]), t: q.t };
    }
    return best;
  }

  update(x, y, h, dt) {
    let q = this.project(x, y, this.idx - 4, this.idx + 40);
    if (q.d > 25) {
      // rejoined somewhere else? search everything, but never jump far backwards
      const g = this.project(x, y, 1, this.pts.length - 1);
      if (g.d < q.d && g.s > this.progress - 60) q = g;
    }
    this.offset = q.d;
    if (q.d < 25) {
      this.idx = q.i;
      this.progress = Math.max(this.progress - 30, q.s);
      const a = this.pts[q.i - 1];
      this.lastGood = { x: a[0], y: a[1], h: a[2], i: q.i };
      this.offTime = 0;
    } else this.offTime += dt;
  }

  get remaining() { return Math.max(0, this.length - this.progress); }
  get offRoute() { return this.offTime > 3; }
  get arrived() { return this.progress > this.length - 12; }

  next() {
    return this.instructions.find((s) => s.at > this.progress - 2) || this.instructions[this.instructions.length - 1];
  }

  // Pose on the route at the last good position (for resets).
  resetPose() {
    const i = Math.max(1, this.lastGood.i);
    const a = this.pts[i - 1], b = this.pts[Math.min(this.pts.length - 1, i)];
    return { x: a[0], y: a[1], h: a[2], heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  pointAt(s) {
    s = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const t = (s - this.cum[i - 1]) / ((this.cum[i] - this.cum[i - 1]) || 1);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: a[2] + (b[2] - a[2]) * t };
  }
}

export const TURN_TEXT = {
  left: 'Turn left',
  right: 'Turn right',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  'sharp-left': 'Sharp left',
  'sharp-right': 'Sharp right',
  uturn: 'Make a U-turn',
  continue: 'Continue',
  arrive: 'Arrive',
};

export function turnSide(type) {
  if (/left/.test(type)) return 'left';
  if (/right|uturn/.test(type)) return 'right'; // U-turns in India are made to the right
  return null;
}
