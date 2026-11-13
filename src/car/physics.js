import { CAR } from './carModel.js';
import { clamp, segDist, angleDiff } from '../util.js';

const G = 9.81;
// A typical Indian compact sedan (about 1.25 t, 1.2 L petrol, front-wheel drive).
const M = 1250; // kg
const IZ = 1900; // yaw inertia, kg m^2
const A = 1.12; // centre of mass to front axle, m
const B = CAR.wheelbase - A; // to rear axle
const HCG = 0.55; // centre of mass height
const CF = 72000, CR = 82000; // cornering stiffness per axle, N/rad
const RW = CAR.wheelR;
const GEARS = [3.55, 1.95, 1.32, 1.02, 0.84, 0.71];
const REVERSE = 3.3, FINAL = 4.07, EFF = 0.88;
const IDLE = 850, REDLINE = 6200;
const DRAG = 0.5 * 1.2 * 0.32 * 2.1; // 1/2 rho Cd A
// grip and rolling resistance by surface
const SURF = {
  asphalt: { mu: 1.0, crr: 0.013 },
  pavers: { mu: 0.9, crr: 0.018 },
  unpaved: { mu: 0.72, crr: 0.035 },
  verge: { mu: 0.62, crr: 0.06 }, // dirt and grass off the road
};

// Engine torque (N m) against rpm: about 115 N m at 4000 rpm.
function torque(rpm) {
  const x = (rpm - 4000) / 3600;
  return Math.max(55, 115 * (1 - x * x * 0.8));
}

// Dynamic bicycle model with tyre slip and load transfer, blended into a
// kinematic model at walking pace, plus an automatic gearbox, ABS braking,
// per-wheel ground contact with a sprung body, kerbs, speed breakers, flyover
// parapets and impulse-based collisions.
export class CarPhysics {
  constructor(index) {
    this.index = index;
    this.x = 0; this.y = 0; this.h = 0; this.vh = 0;
    this.heading = 0; // bearing, 0 = north, clockwise positive
    this.vx = 0; // forward speed, m/s
    this.vy = 0; // sideways speed, + to the right
    this.r = 0; // yaw rate, + turning right
    this.steer = 0; // road-wheel angle, + right
    this.ax = 0; this.ay = 0;
    this.pitch = 0; this.roll = 0; this.squat = 0; this.heave = 0;
    this.body = { pitch: 0, roll: 0, heave: 0, vp: 0, vr: 0, vh: 0 };
    this.wheelZ = [0, 0, 0, 0]; // contact height under each wheel (FL, FR, RL, RR) relative to the car
    this.gear = 'D';
    this.autoGear = 1;
    this.shiftTimer = 0;
    this.rpm = IDLE;
    this.wheelSpin = 0;
    this.reverseTimer = 0;
    this.surface = null;
    this.surfaceKind = 'asphalt';
    this.braking = false;
    this.slip = 0; // tyre squeal amount 0..1
    this.yawRate = 0;
    this.latAcc = 0;
    this.lastBump = 0;
  }

  place(x, y, h, heading) {
    Object.assign(this, { x, y, h, heading, vx: 0, vy: 0, r: 0, vh: 0, steer: 0, gear: 'D', autoGear: 1, rpm: IDLE });
    this.surface = this.index.surface(x, y, h);
    this.body = { pitch: 0, roll: 0, heave: 0, vp: 0, vr: 0, vh: 0 };
  }

  // speed along the car's heading (kept for the rest of the game)
  get v() { return this.vx; }
  set v(val) {
    this.vy *= val === 0 ? 0 : 0.5;
    this.vx = val;
  }
  get fwd() { return { x: Math.sin(this.heading), y: Math.cos(this.heading) }; }

  // height of whatever the car would rest on at (x, y)
  supportAt(x, y) {
    let s = this.index.surface(x, y, this.h);
    // a deck well above the car, just beyond its edge, is the side of a ramp: not a surface
    if (s && s.h - this.h > 0.4 && s.d > s.seg.w / 2) s = null;
    let h;
    if (s) {
      h = s.h + 0.06;
      // the raised kerb and footpath beyond the carriageway
      const over = s.d - s.seg.w / 2;
      if (over > 0 && s.road.kerb && s.h - this.index.ground(x, y) < 0.8) h += Math.min(0.15, over * 0.9);
    } else h = this.index.ground(x, y);
    return h + this.index.bumpAt(x, y, this.h);
  }

  step(dt, input) {
    const events = [];

    // ---- gearbox: hold brake at a standstill to engage reverse; throttle to go back to D
    const stopped = Math.abs(this.vx) < 0.25;
    if (stopped && this.gear === 'D' && input.brake > 0.5 && input.throttle < 0.1) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.45) { this.gear = 'R'; this.reverseTimer = 0; }
    } else if (stopped && this.gear === 'R' && input.throttle > 0.5 && input.brake < 0.1) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.2) { this.gear = 'D'; this.reverseTimer = 0; }
    } else this.reverseTimer = 0;
    let throttle, brake;
    if (this.gear === 'D') { throttle = input.throttle; brake = input.brake; } else { throttle = input.brake; brake = input.throttle; }
    const handbrake = !!input.handbrake;

    // ---- surface under the car
    const s = this.surface;
    const onRoad = !!s && s.d < s.seg.w / 2 + 0.2;
    this.surfaceKind = onRoad ? (s.road.f === 2 ? 'unpaved' : s.road.f === 1 ? 'pavers' : 'asphalt') : 'verge';
    const surf = SURF[this.surfaceKind];
    const mu = surf.mu;

    // ---- steering: speed sensitive, rate limited
    const sp = Math.abs(this.vx);
    const maxSteer = 0.6 / (1 + sp / 12);
    this.steer += clamp(input.steer * maxSteer - this.steer, -2.0 * dt, 2.0 * dt);
    const d = this.steer;

    // ---- engine and gearbox
    const dir = this.gear === 'R' ? -1 : 1;
    const ratio = this.gear === 'R' ? REVERSE : GEARS[this.autoGear - 1];
    const wheelRpm = (Math.abs(this.vx) / RW) * (60 / (2 * Math.PI));
    let rpm = wheelRpm * ratio * FINAL;
    // torque converter: the engine can run above wheel speed when pulling away
    const slipRpm = IDLE + throttle * 2200;
    if (rpm < slipRpm) rpm = rpm + (slipRpm - rpm) * (1 - Math.min(1, sp / 6));
    rpm = clamp(rpm, IDLE, REDLINE + 200);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 10);
    if (this.gear === 'D') {
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      const up = 2400 + throttle * 3400, down = 1300 + throttle * 1300;
      if (this.shiftTimer === 0 && this.autoGear < GEARS.length && wheelRpm * GEARS[this.autoGear - 1] * FINAL > up) { this.autoGear++; this.shiftTimer = 0.3; }
      else if (this.shiftTimer === 0 && this.autoGear > 1 && wheelRpm * GEARS[this.autoGear - 1] * FINAL < down) { this.autoGear--; this.shiftTimer = 0.25; }
    }
    let Fdrive = 0;
    if (throttle > 0 && this.shiftTimer < 0.15 && this.rpm < REDLINE) Fdrive = (torque(this.rpm) * ratio * FINAL * EFF * throttle) / RW;
    if (this.gear === 'R' && this.vx < -6) Fdrive = 0;

    // ---- loads on each axle, with longitudinal weight transfer
    const Fzf = Math.max(0.2 * M * G, (M * G * B) / CAR.wheelbase - (M * this.ax * HCG) / CAR.wheelbase);
    const Fzr = Math.max(0.2 * M * G, (M * G * A) / CAR.wheelbase + (M * this.ax * HCG) / CAR.wheelbase);
    // front-wheel drive: traction limited by front-axle grip
    const tractionMax = mu * Fzf;
    const spinning = Fdrive > tractionMax;
    Fdrive = Math.min(Fdrive, tractionMax);

    // ---- braking with ABS (never more than the tyres can take)
    let Fbrake = brake * 1.05 * M * G;
    Fbrake = Math.min(Fbrake, mu * (Fzf + Fzr) * 0.98);
    let FbRear = handbrake ? mu * Fzr * 0.85 : 0;

    // ---- tyre lateral forces
    const vxs = Math.max(Math.abs(this.vx), 0.5);
    const af = Math.atan2(this.vy + A * this.r, vxs) - d * Math.sign(this.vx || 1);
    const ar = Math.atan2(this.vy - B * this.r, vxs);
    // friction circle: longitudinal use eats into lateral grip
    const frontLong = Math.min(1, (Fdrive + Fbrake * 0.65) / (mu * Fzf + 1));
    const rearLong = Math.min(1, (Fbrake * 0.35 + FbRear) / (mu * Fzr + 1));
    const fyfMax = mu * Fzf * Math.sqrt(Math.max(0.05, 1 - frontLong * frontLong));
    const fyrMax = mu * Fzr * Math.sqrt(Math.max(0.05, 1 - rearLong * rearLong)) * (handbrake ? 0.45 : 1);
    const Fyf = clamp(-CF * af, -fyfMax, fyfMax);
    const Fyr = clamp(-CR * ar, -fyrMax, fyrMax);
    this.slip = clamp((Math.abs(-CF * af) / (fyfMax + 1) - 0.85) * 2 + (Math.abs(-CR * ar) / (fyrMax + 1) - 0.85) * 2 + (spinning ? 0.6 : 0), 0, 1) * clamp(sp / 6, 0, 1);

    // ---- longitudinal forces along the car
    let Fx = Fdrive * dir;
    const resist = DRAG * this.vx * Math.abs(this.vx) + surf.crr * M * G * Math.sign(this.vx);
    Fx -= resist;
    Fx -= M * G * Math.sin(this.pitch); // hills
    const Fy_grav = M * G * Math.sin(this.roll) * 0.6; // cross-slope pulls downhill

    // ---- integrate (semi-implicit Euler)
    const before = this.vx;
    const axNoBrake = (Fx - Fyf * Math.sin(d)) / M + this.r * this.vy;
    this.vx += axNoBrake * dt;
    // brakes oppose motion but never reverse it
    const bDecel = ((Fbrake + FbRear) / M) * dt;
    if (bDecel > 0) this.vx = Math.abs(this.vx) <= bDecel ? 0 : this.vx - Math.sign(this.vx) * bDecel;
    if (throttle === 0 && Math.abs(this.vx) < 0.08 && Math.sign(before) !== Math.sign(this.vx)) this.vx = 0;
    const ay = (Fyf * Math.cos(d) + Fyr + Fy_grav) / M - this.r * this.vx;
    this.vy += ay * dt;
    this.r += ((A * Fyf * Math.cos(d) - B * Fyr) / IZ) * dt;

    // at walking pace tyres do not slip: blend into the kinematic model
    const k = clamp((sp - 1.5) / 3, 0, 1);
    const rKin = (this.vx * Math.tan(d)) / CAR.wheelbase;
    this.r = rKin + (this.r - rKin) * k;
    this.vy = rKin * B * (1 - k) + this.vy * k;
    if (sp < 0.05 && throttle === 0) { this.vy *= 0.8; this.r *= 0.8; }
    this.vx = clamp(this.vx, -7, 52);

    this.ax += ((this.vx - before) / dt - this.ax) * Math.min(1, dt * 8);
    this.ay = ay + this.r * this.vx;
    this.latAcc = this.r * this.vx;
    this.yawRate = this.r;
    this.braking = brake > 0.05 && sp > 0.3;

    this.heading += this.r * dt;
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    if (this.heading < -Math.PI) this.heading += 2 * Math.PI;
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading), rx = Math.cos(this.heading), ry = -Math.sin(this.heading);
    this.x += (fx * this.vx + rx * this.vy) * dt;
    this.y += (fy * this.vx + ry * this.vy) * dt;

    // ---- flyover parapets keep the car on the deck
    if (this.h - this.index.ground(this.x, this.y) > 1.2) {
      const el = this.index.nearestElevated(this.x, this.y, this.h);
      if (el && el.q.d > el.seg.w / 2 - 0.95) {
        const lim = el.seg.w / 2 - 0.95;
        const kk = lim / el.q.d;
        const nx = (el.q.cx - this.x) / el.q.d, ny = (el.q.cy - this.y) / el.q.d; // towards the deck centre
        this.x = el.q.cx + (this.x - el.q.cx) * kk;
        this.y = el.q.cy + (this.y - el.q.cy) * kk;
        this.impact(nx, ny, 0, events, 'scrape');
      }
    }

    // ---- ground contact under each wheel; the body rides on springs
    this.surface = this.index.surface(this.x, this.y, this.h);
    const hw = CAR.track / 2;
    const wp = [[A, -hw], [A, hw], [-B, -hw], [-B, hw]];
    const zs = wp.map(([f, l]) => this.supportAt(this.x + fx * f + rx * l, this.y + fy * f + ry * l));
    const centre = (zs[0] + zs[1] + zs[2] + zs[3]) / 4;
    if (centre >= this.h - 0.05 || this.h - centre < 0.35) {
      this.h += (centre - this.h) * Math.min(1, dt * 20);
      this.vh = 0;
    } else {
      // airborne off an edge
      this.vh -= G * dt;
      this.h = Math.max(centre, this.h + this.vh * dt);
    }
    this.wheelZ = zs.map((z) => z - this.h);
    const frontZ = (zs[0] + zs[1]) / 2, rearZ = (zs[2] + zs[3]) / 2, leftZ = (zs[0] + zs[2]) / 2, rightZ = (zs[1] + zs[3]) / 2;
    const slopePitch = Math.atan2(frontZ - rearZ, CAR.wheelbase);
    const slopeRoll = Math.atan2(leftZ - rightZ, CAR.track); // + = left side higher
    this.pitch += (slopePitch - this.pitch) * Math.min(1, dt * 12);
    this.roll += (slopeRoll - this.roll) * Math.min(1, dt * 12);
    // sprung body: pitch from braking/acceleration, roll from cornering, bounce
    const b = this.body;
    // + pitch = nose up: squat under acceleration, dive under braking
    const tp = clamp(this.ax * 0.0055, -0.035, 0.03), tr = clamp(this.latAcc * 0.009, -0.06, 0.06);
    b.vp += ((tp - b.pitch) * 160 - b.vp * 14) * dt;
    b.pitch += b.vp * dt;
    b.vr += ((tr - b.roll) * 140 - b.vr * 12) * dt;
    b.roll += b.vr * dt;
    b.vh += ((0 - b.heave) * 180 - b.vh * 13) * dt;
    b.heave += b.vh * dt;
    this.squat = b.pitch;

    // speed breakers: a jolt proportional to speed
    const bumpNow = this.index.bumpAt(this.x + fx * A, this.y + fy * A, this.h) > 0.04 || this.index.bumpAt(this.x - fx * B, this.y - fy * B, this.h) > 0.04;
    if (bumpNow && !this.onBump) {
      const kick = Math.min(0.9, sp * 0.06);
      b.vh += kick;
      b.vp += (this.vx > 0 ? 1 : -1) * kick * 0.5; // the leading axle rises first
      if (performance.now() - this.lastBump > 600) events.push({ type: 'bump', speed: sp });
      this.lastBump = performance.now();
      this.vx *= 1 - Math.min(0.25, sp * 0.008); // the hump scrubs some speed
    }
    this.onBump = bumpNow;

    // ---- collisions
    this.collide(events, onRoad);

    this.wheelSpin += (this.vx / RW) * dt * (spinning ? 1.6 : 1);
    return events;
  }

  // Bounce off a surface with outward normal (nx, ny) in world x/y; `off` is where
  // along the car the contact is (+ front), for the yaw kick.
  impact(nx, ny, off, events, what) {
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading), rx = Math.cos(this.heading), ry = -Math.sin(this.heading);
    let wx = fx * this.vx + rx * this.vy, wy = fy * this.vx + ry * this.vy;
    const vn = wx * nx + wy * ny;
    if (vn >= 0) return;
    const e = 0.18; // restitution
    wx -= (1 + e) * vn * nx;
    wy -= (1 + e) * vn * ny;
    // scrubbing friction along the surface
    const vt = wx * -ny + wy * nx;
    wx -= -ny * vt * 0.25;
    wy -= nx * vt * 0.25;
    this.vx = wx * fx + wy * fy;
    this.vy = wx * rx + wy * ry;
    // a hit ahead of or behind the centre twists the car
    const side = nx * rx + ny * ry;
    this.r += off * vn * side * 0.06;
    if (-vn > 0.6) events.push({ type: what === 'scrape' ? 'scrape' : 'collision', what, speed: -vn });
  }

  // Three circles along the car against nearby obstacles.
  collide(events, onRoad) {
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    const R = 0.92;
    for (const off of [1.35, 0, -1.35]) {
      let cx = this.x + fx * off, cy = this.y + fy * off;
      for (const w of this.index.wallsNear(cx, cy, R + 1)) {
        if (this.h > w.top - 0.15) continue; // drives over it, or it is below a deck
        if ((w.kind === 'water' || w.kind === 'building' || w.kind === 'wall') && onRoad) continue;
        const q = segDist(cx, cy, w.ax, w.ay, w.bx, w.by);
        if (q.d >= R || q.d < 1e-4) continue;
        const nx = (cx - q.cx) / q.d, ny = (cy - q.cy) / q.d;
        const push = R - q.d;
        this.x += nx * push;
        this.y += ny * push;
        cx += nx * push;
        cy += ny * push;
        this.impact(nx, ny, off, events, w.kind);
      }
    }
    // tunnelled fully into a building at speed: step back out
    if (!onRoad && this.index.inBuilding(this.x, this.y)) {
      this.x -= fx * Math.sign(this.vx || 1) * 1.5;
      this.y -= fy * Math.sign(this.vx || 1) * 1.5;
      this.vx = 0;
      this.vy = 0;
      events.push({ type: 'collision', what: 'building', speed: 5 });
    }
  }

  displayGear() {
    if (this.gear === 'R') return 'R';
    return Math.abs(this.vx) < 0.1 ? 'D' : `D${this.autoGear}`;
  }
}

export { angleDiff };
