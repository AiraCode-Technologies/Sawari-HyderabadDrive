import * as THREE from 'three';
import { mulberry, clamp, angleDiff } from './util.js';
import { signalAhead, signalState } from './signals.js';
import { buildCatalogue, TRAFFIC_MIX } from './vehicles.js';

let CATALOGUE = null; // built once, shared by every drive

const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
export const TRAFFIC_LEVELS = { off: 0, low: 14, medium: 28, high: 48, dense: 80 };

// ---- how the drivers behave
const STEP = 3; // spacing of the points on each vehicle's predicted path (m)
const BRAKE = 4.5; // comfortable braking used to plan stops (m/s²)
const HEADWAY = 0.9; // seconds of following distance on top of the standstill gap
// A moment's inattention (phone, mirror, a shout from the footpath) is the only way two
// drivers end up in a crash; everything else about them is careful. Chance per vehicle per second.
const DISTRACT_RATE = 1 / 1100;
// lanes that actually fit the carriageway (OSM sometimes tags two lanes on a 3.3 m road)
const laneCount = (r) => clamp(r.l || 1, 1, Math.max(1, Math.floor(r.w / 2.9)));
const stopSpeed = (d) => Math.sqrt(2 * BRAKE * Math.max(0, d)); // fastest speed that still stops within d

// Nearest point of a predicted path to (x, y): distance along it, signed offset (left +) and direction there.
function onPath(path, x, y) {
  let best = null, bd = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const sx = b.x - a.x, sy = b.y - a.y, L = Math.hypot(sx, sy) || 1e-6;
    let u = ((x - a.x) * sx + (y - a.y) * sy) / L;
    if (i > 1 && u < 0) u = 0;
    if (i < path.length - 1 && u > L) u = L;
    const ux = sx / L, uy = sy / L;
    const cx = a.x + ux * u, cy = a.y + uy * u;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bd) {
      bd = d;
      // left of travel is (-uy, ux) in this x-east / y-north plane
      best = { along: a.d + u, lat: (x - cx) * -uy + (y - cy) * ux, dir: Math.atan2(sx, sy), end: i === path.length - 1 && u > L };
    }
  }
  return best;
}

// Closest approach of segments a0+u*(ax,ay) and b0+w*(bx,by), u and w in 0..1.
function segClosest(a0, ax, ay, b0, bx, by) {
  const rx = a0.x - b0.x, ry = a0.y - b0.y;
  const aa = ax * ax + ay * ay || 1e-9, bb = bx * bx + by * by || 1e-9, ab = ax * bx + ay * by;
  const ar = ax * rx + ay * ry, br = bx * rx + by * ry;
  const den = aa * bb - ab * ab;
  let u = den > 1e-9 ? clamp((ab * br - bb * ar) / den, 0, 1) : 0;
  let w = (ab * u + br) / bb;
  if (w < 0) { w = 0; u = clamp(-ar / aa, 0, 1); } else if (w > 1) { w = 1; u = clamp((ab - ar) / aa, 0, 1); }
  const dx = rx + ax * u - bx * w, dy = ry + ay * u - by * w;
  return { d: Math.hypot(dx, dy), u, w };
}

// bounding box of a predicted path, for quick "nowhere near" checks
function boxPath(path) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of path) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  path.box = { x0, x1, y0, y1 };
}

// Do two vehicles' footprints overlap? (rectangles, separating-axis test)
function overlaps(a, b) {
  const ha = a.visHeading + (a.yawOff || 0), hb = b.visHeading + (b.yawOff || 0);
  const A = [Math.sin(ha), Math.cos(ha)], Ar = [Math.cos(ha), -Math.sin(ha)];
  const B = [Math.sin(hb), Math.cos(hb)], Br = [Math.cos(hb), -Math.sin(hb)];
  const al = a.length / 2 - 0.08, aw = a.width / 2 - 0.05, bl = b.length / 2 - 0.08, bw = b.width / 2 - 0.05;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [nx, ny] of [A, Ar, B, Br]) {
    const ra = al * Math.abs(A[0] * nx + A[1] * ny) + aw * Math.abs(Ar[0] * nx + Ar[1] * ny);
    const rb = bl * Math.abs(B[0] * nx + B[1] * ny) + bw * Math.abs(Br[0] * nx + Br[1] * ny);
    if (Math.abs(dx * nx + dy * ny) > ra + rb) return false;
  }
  return true;
}

// (x, y) in a vehicle's own frame: metres ahead of its centre and metres to its left
function local(v, x, y) {
  const h = v.visHeading + (v.yawOff || 0), fx = Math.sin(h), fy = Math.cos(h);
  const dx = x - v.x, dy = y - v.y;
  return { along: dx * fx + dy * fy, lat: -dx * fy + dy * fx };
}

export class Traffic {
  constructor(world, scene, density, signals, index) {
    this.index = index;
    this.world = world;
    this.scene = scene;
    this.signals = signals;
    this.target = TRAFFIC_LEVELS[density] ?? TRAFFIC_LEVELS.medium;
    this.dense = density === 'dense' || density === 'high';
    this.rand = mulberry(0xbada55 + world.id.length);
    this.vehicles = [];
    this.nextId = 1;
    this.rights = new Map(); // who goes first where two paths cross: "idA:idB" -> { w, t, made }
    this.pruneAt = 0;
    this.me = { id: 0, player: true, length: 4.3, width: 1.8, rank: 9, mode: 'drive', path: [], yawOff: 0 };
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    CATALOGUE ||= buildCatalogue();
    this.protos = CATALOGUE;
    this.mix = TRAFFIC_MIX;

    // directed graph over road points
    this.out = new Map();
    const key = (q) => `${q[0]},${q[1]}`;
    this.spawnEdges = [];
    world.roads.forEach((r, ri) => {
      const rank = RANK[r.k] || 2;
      if (rank < 2) return;
      for (let i = 1; i < r.p.length; i++) {
        const a = r.p[i - 1], b = r.p[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.2) continue;
        const mk = (from, to) => ({
          r, ri, from, to, fk: key(from), tk: key(to), len, rank,
          dir: Math.atan2(to[0] - from[0], to[1] - from[1]),
          mx: (from[0] + to[0]) / 2, my: (from[1] + to[1]) / 2,
        });
        const es = [mk(a, b)];
        if (!r.o) es.push(mk(b, a));
        for (const e of es) {
          if (!this.out.has(e.fk)) this.out.set(e.fk, []);
          this.out.get(e.fk).push(e);
          if (rank >= 3 || this.rand() < 0.3) this.spawnEdges.push(e);
        }
      }
    });
    // "Hot" edges: on or beside the player's route, or on a main road. Most new
    // vehicles go here so traffic is where the player actually drives.
    const routeCells = new Set();
    const cell = (x, y) => `${Math.floor(x / 30)},${Math.floor(y / 30)}`;
    const drive = world.route.drive;
    for (let i = 1; i < drive.length; i++) {
      const a = drive[i - 1], b = drive[i];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10);
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
        for (const dx of [-30, 0, 30]) for (const dy of [-30, 0, 30]) routeCells.add(cell(x + dx, y + dy));
      }
    }
    for (const e of this.spawnEdges) e.hot = e.rank >= 4 || routeCells.has(cell(e.mx, e.my));
    this.nearEdges = [];
    this.hotEdges = [];
    this.nearAt = -1e9;
    this.maxR = this.dense ? 300 : 400;
  }

  laneOffset(e, v) {
    const r = e.r;
    if (v.bike) {
      // two-wheelers keep near the left kerb, each at its own line
      // (minus the overtaking swing to the right, never closer than 0.7 m to the centre line of a two-way road)
      return Math.max(r.o ? -r.w / 2 + 0.8 : 0.7, r.w / 2 - 0.7 - v.jitter - (v.overtake || 0));
    }
    if (!r.o) return Math.min(r.w / 4, 2.6);
    const lanes = laneCount(r);
    return r.w / 2 - (r.w / lanes) * (Math.min(v.lane, lanes - 1) + 0.5);
  }

  // furthest a vehicle may sit to the right of its lane when going round something
  maxBypass(v) {
    const r = v.e.r;
    return Math.max(0, this.laneOffset(v.e, v) - (-r.w / 2 + v.width / 2 + 0.3));
  }

  pickKind(rank) {
    let x = this.rand();
    for (const [k, p] of this.mix) {
      if ((x -= p) <= 0) return (k === 'bus' || k === 'goods') && rank < 3 ? 'hatch' : k;
    }
    return 'hatch';
  }

  // Candidate spawn edges within reach of the player, refreshed every couple of seconds.
  refreshNear(px, py, t) {
    if (t - this.nearAt < 2 && this.nearEdges.length) return;
    this.nearAt = t;
    const R = this.maxR;
    this.nearEdges = this.spawnEdges.filter((e) => Math.abs(e.mx - px) < R && Math.abs(e.my - py) < R);
    this.hotEdges = this.nearEdges.filter((e) => e.hot);
  }

  spawn(px, py, pHeading, initial) {
    for (let tries = 0; tries < 40; tries++) {
      const pool = this.hotEdges.length && this.rand() < 0.85 ? this.hotEdges : this.nearEdges;
      const e = pool[Math.floor(this.rand() * pool.length)];
      if (!e) return false;
      const s = this.rand() * e.len;
      const x = e.from[0] + (e.to[0] - e.from[0]) * (s / e.len), y = e.from[1] + (e.to[1] - e.from[1]) * (s / e.len);
      const d = Math.hypot(x - px, y - py);
      // new vehicles appear out of sight; at the start they can fill in closer
      const minD = initial ? 22 : this.dense ? 110 : 140;
      if (d < minD || d > this.maxR) continue;
      if (initial && d < 45) {
        // never drop one right in front of the player's bonnet
        const ahead = (x - px) * Math.sin(pHeading) + (y - py) * Math.cos(pHeading);
        if (ahead > 0 && ahead < 45) continue;
      }
      if (this.vehicles.some((v) => Math.abs(v.x - x) < 12 && Math.abs(v.y - y) < 12)) continue;
      const kind = this.pickKind(e.rank);
      const list = this.protos[kind];
      const proto = list[Math.floor(this.rand() * list.length)];
      const mesh = new THREE.Mesh(proto.geo, this.material);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const v = {
        id: this.nextId++, e, s, mesh, kind, length: proto.length, width: proto.width, radius: proto.radius, bike: !!proto.bike,
        lane: Math.floor(this.rand() * laneCount(e.r)), jitter: this.rand() * 1.2,
        maxSpeed: proto.maxSpeed * (0.82 + this.rand() * 0.32),
        v: initial ? 3 + this.rand() * 5 : 6, x, y, h: e.from[2], heading: e.dir, visHeading: e.dir,
        plan: [], path: [], mode: 'drive', modeT: 0, stillT: 0, yawOff: 0, bypass: 0, overtake: 0, distract: 0,
      };
      v.offset = this.laneOffset(e, v);
      this.pose(v);
      this.vehicles.push(v);
      return true;
    }
    return false;
  }

  // ---------- route planning ----------
  chooseAfter(e) {
    const list = (this.out.get(e.tk) || []).filter((n) => !(n.tk === e.fk && n.r === e.r));
    if (!list.length) return null;
    // mostly carry straight on; sometimes turn
    const same = list.filter((n) => n.r === e.r || Math.abs(angleDiff(e.dir, n.dir)) < 0.35);
    const pool = same.length && this.rand() < 0.75 ? same : list;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  // keep the next few edges decided in advance, so the path ahead can be predicted
  extendPlan(v, metres) {
    if (v.plan.length && v.plan[0].fk !== v.e.tk) v.plan.length = 0;
    let len = v.e.len - v.s, last = v.e;
    for (const n of v.plan) { len += n.len; last = n; }
    while (len < metres && v.plan.length < 14) {
      const n = this.chooseAfter(last);
      if (!n) break;
      v.plan.push(n);
      len += n.len;
      last = n;
    }
  }

  // Where the vehicle will be over the next few seconds: points every STEP metres
  // along its lane, through the junctions it has planned. d = metres from its centre.
  buildPath(v) {
    const pts = v.path;
    pts.length = 0;
    pts.push({ x: v.x, y: v.y, d: 0 });
    // the nose first: whatever the lane does next, the car is pointing this way now
    const nh = v.visHeading + v.yawOff;
    if (v.v >= 0) pts.push({ x: v.x + Math.sin(nh) * v.length / 2, y: v.y + Math.cos(nh) * v.length / 2, d: v.length / 2 });
    const reach = clamp(12 + Math.max(0, v.v) * 2.6, 16, 40);
    let E = v.e, s = v.s, k = 0, off = v.offset, d = 0;
    while (d < reach) {
      s += STEP;
      d += STEP;
      if (d <= v.length / 2 + 0.5) continue;
      while (s > E.len) {
        const n = v.plan[k++];
        if (!n) return;
        s -= E.len;
        E = n;
        off = this.laneOffset(E, v) - v.bypass;
      }
      const t = s / E.len, lx = -Math.cos(E.dir), ly = Math.sin(E.dir);
      pts.push({ x: E.from[0] + (E.to[0] - E.from[0]) * t + lx * off, y: E.from[1] + (E.to[1] - E.from[1]) * t + ly * off, d });
    }
  }

  playerAgent(p) {
    const me = this.me;
    Object.assign(me, { x: p.x, y: p.y, h: p.h, visHeading: p.heading, heading: p.heading, v: p.v });
    // the player's path: straight ahead along the car (reversing: behind it)
    const dir = p.v < -0.3 ? -1 : 1, fx = Math.sin(p.heading) * dir, fy = Math.cos(p.heading) * dir;
    const reach = Math.max(9, Math.abs(p.v) * 3);
    me.path.length = 0;
    for (let d = 0; d <= reach; d += STEP) me.path.push({ x: p.x + fx * d, y: p.y + fy * d, d });
    boxPath(me.path);
    return me;
  }

  // ---------- one frame ----------
  update(dt, player, t, people = []) {
    if (!this.target) return [];
    const events = [];
    this.dt = dt;
    this.frameNo = (this.frameNo || 0) + 1;
    const px = player.x, py = player.y;
    this.refreshNear(px, py, t);
    // keep the population topped up around the player
    const initial = t < 1.5;
    for (let k = 0; k < (initial ? 6 : 2) && this.vehicles.length < this.target; k++) this.spawn(px, py, player.heading, initial);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const far = Math.hypot(v.x - px, v.y - py);
      const behind = (v.x - px) * Math.sin(player.heading) + (v.y - py) * Math.cos(player.heading) < -25;
      if (v.stillT > 20 && !this.atRed(v) && (far > 70 || behind)) v.dead = true; // a hopeless jam out of sight
      if (far > this.maxR + 90 || v.dead) {
        v.gone = true;
        this.scene.remove(v.mesh);
        this.vehicles.splice(i, 1);
      }
    }

    for (const v of this.vehicles) {
      this.extendPlan(v, 50);
      this.buildPath(v);
      boxPath(v.path);
    }
    const me = this.playerAgent(player);
    const cars = this.vehicles.concat(me);
    for (const v of this.vehicles) this.drive(v, dt, t, cars, people, events, me);
    this.contacts(t, player, me, people, events);

    if (t > this.pruneAt) {
      this.pruneAt = t + 3;
      for (const [k, r] of this.rights) if (t - r.t > 2) this.rights.delete(k);
    }
    return events;
  }

  drive(v, dt, t, cars, people, events, me) {
    v.modeT += dt;
    v.distract = Math.max(0, v.distract - dt);
    let target = 0;
    // traffic far from the player re-plans every third frame (still ~20 times a second)
    const far = Math.abs(v.x - me.x) > 80 || Math.abs(v.y - me.y) > 80;
    const think = !far || (this.frameNo + v.id) % 3 === 0 || v.mode !== 'drive';
    if (think) {
      v.atSignal = false;
      v.blocker = null;
      v.yieldingTo = null;
    }

    if (v.mode === 'crash') {
      // shaken: stand still, then one of the two backs off and the other goes first
      if (v.modeT > v.shock) this.setMode(v, v.reverseFirst ? 'reverse' : 'wait');
    } else if (v.mode === 'reverse') {
      if (this.reverseDone(v, cars, people)) this.setMode(v, 'wait');
    } else if (v.mode === 'wait') {
      // let the other one go, then carry on
      const o = v.partner;
      let clear;
      if (!o || o.gone) clear = true;
      else if (o.player) clear = !this.hitInPath(v, o) && Math.hypot(o.x - v.x, o.y - v.y) > (v.length + o.length) / 2 + 2;
      // the one that backed off waits until the other is on its way
      else if (v.reverseFirst) clear = o.mode === 'drive' && (Math.abs(o.v) > 1 || !this.hitInPath(v, o));
      // the one going first waits only until the other has made room
      else clear = o.mode !== 'crash' && o.mode !== 'reverse' && !this.hitInPath(v, o);
      if ((clear && v.modeT > 0.8) || v.modeT > v.maxWait) this.setMode(v, 'drive');
    }

    if (v.mode === 'drive') {
      if (!v.distract && this.rand() < DISTRACT_RATE * dt) v.distract = 0.8 + this.rand() * 1.6;
      if (think) {
        v.target = this.cruise(v, t, cars, people);
        this.standoff(v, t, me, events);
      }
      target = v.target ?? 0;
    }

    // speed: reversing creeps back, everything else eases towards the target
    if (v.mode === 'reverse') v.v = Math.max(-1.6, v.v - 2 * dt);
    else {
      // brake firmly as soon as the planned stop needs it; pull away gently
      const acc = clamp((target - v.v) * (target < v.v ? 4 : 1.6), -7.5, v.bike ? 3 : 2.4);
      v.v = Math.max(0, v.v + acc * dt);
    }
    v.stillT = Math.abs(v.v) < 0.2 ? v.stillT + dt : 0;
    if (v.mode === 'reverse') v.revLeft += v.v * dt;
    this.advance(v, v.v * dt);
    this.place(v, dt, cars);
  }

  // waiting in a queue for a red light (directly or behind others who are)?
  atRed(v) {
    let q = v;
    for (let k = 0; k < 14 && q; k++) {
      if (q.atSignal) return true;
      q = q.blocker || q.yieldingTo;
    }
    return false;
  }

  setMode(v, mode) {
    v.mode = mode;
    v.modeT = 0;
    if (mode === 'reverse') v.revLeft = v.revTotal = v.partner?.player ? 2.5 + this.rand() * 1.5 : 8; // stops early once there is room
    if (mode === 'wait') v.maxWait = 9 + this.rand() * 3;
    if (mode === 'drive') {
      v.partner = null;
      v.distract = 0;
      if (v.involved) for (const o of v.involved) if (o.gone || (o.mode === 'drive' && !overlaps(v, o))) { v.involved.delete(o); o.involved?.delete(v); }
    }
  }

  // Target speed while driving normally.
  cruise(v, t, cars, people) {
    const E = v.e, path = v.path;
    let target = Math.min(v.maxSpeed, ((E.r.s || 40) / 3.6) * 0.9);
    const distracted = v.distract > 0;
    // slow for sharp turns at the end of the edge
    const next = v.plan[0];
    const turn = next ? angleDiff(E.dir, next.dir) : 0;
    if (E.len - v.s < 15) target = Math.min(target, 4 + 8 * (1 - Math.min(1, Math.abs(turn) / 1.2)));

    const minGap = this.dense ? 1.6 : 2.2;
    const reach = path[path.length - 1].d + 8;
    let nearest = Infinity, wantPass = false, passShift = 0, sideBusy = false;
    for (const o of cars) {
      if (o === v || o.gone) continue;
      const dx = o.x - v.x, dy = o.y - v.y;
      if (dx > reach || dx < -reach || dy > reach || dy < -reach || Math.abs(o.h - v.h) > 2.5) continue;
      const hit = this.hitInPath(v, o);
      if (hit) {
        // part of it is in my lane ahead
        const gap = hit.along - v.length / 2;
        const dh = Math.abs(angleDiff(o.visHeading + (o.yawOff || 0), hit.dir));
        let vt;
        if (dh < 0.7) {
          // going my way: follow at a distance that grows with speed
          const ov = o.v * Math.cos(dh);
          const want = minGap + Math.max(0, v.v) * HEADWAY;
          vt = Math.max(0, ov) + (gap - want) * 0.8;
          vt = Math.min(vt, stopSpeed(gap - minGap) + Math.max(0, ov));
          // two-wheelers filter past slower vehicles on their right
          if (v.bike && !o.bike && gap < 14 && o.v < v.maxSpeed * 0.85) {
            wantPass = true;
            passShift = Math.max(passShift, (v.width + o.width) / 2 + 0.35 - hit.lat);
          }
        } else {
          // across my lane, or coming at me: stop short of it
          vt = stopSpeed(gap - minGap);
        }
        if (distracted && gap > 4) vt = target; // not looking
        target = Math.min(target, Math.max(0, vt));
        if (gap < nearest) { nearest = gap; v.blocker = o; }
        continue;
      }
      // beside me on my right? (for two-wheelers deciding when to move back left / over)
      if (v.bike) {
        const q = local(v, o.x, o.y);
        if (Math.abs(q.along) < (v.length + o.length) / 2 + 1 && q.lat > 0 && q.lat < (v.width + o.width) / 2 + 0.8) sideBusy = true;
      }
      // will our paths cross in the next few seconds?
      if (o.mode !== 'drive' || !o.path || o.path.length < 2) continue;
      if (Math.abs(angleDiff(o.visHeading, v.visHeading)) < 0.5) {
        // same way: following handles one lane; check merges from another lane or road,
        // but never give way to someone behind
        const q = local(v, o.x, o.y);
        if (Math.abs(q.lat) < 1 || q.along < -(v.length + o.length) / 2) continue;
      }
      const c = this.crossing(v, o);
      if (!c) continue;
      if (this.rightOfWay(v, o, c, t) !== v && !distracted) {
        target = Math.min(target, stopSpeed(c.dv - v.length / 2 - o.width / 2 - 1.2));
        v.yieldingTo = o;
      }
    }
    if (v.bike) {
      const want = wantPass ? clamp(v.overtake + passShift, 0, 3) : sideBusy ? v.overtake : 0;
      v.overtake += clamp(want - v.overtake, -0.7 * this.dt, 1.4 * this.dt);
    }

    // people stepping across a side-road mouth or standing in the way
    const pb = path.box, pr = v.width / 2 + 2.6;
    for (const m of people) {
      if (pb && (m.x < pb.x0 - pr || m.x > pb.x1 + pr || m.y < pb.y0 - pr || m.y > pb.y1 + pr)) continue;
      if (Math.abs(m.h - v.h) > 2) continue;
      const pts = [[m.x, m.y]];
      if (!(m.wait > 0) && !(m.hold > 0) && m.heading !== undefined) pts.push([m.x + Math.sin(m.heading) * m.speed * 1.2, m.y + Math.cos(m.heading) * m.speed * 1.2]);
      for (const [x, y] of pts) {
        const hit = onPath(path, x, y);
        if (!hit || hit.end || hit.along <= 0 || Math.abs(hit.lat) > v.width / 2 + 0.45) continue;
        const gap = hit.along - v.length / 2 - 0.3;
        if (distracted && gap > 4) continue;
        target = Math.min(target, stopSpeed(gap - 1.2));
        if (gap < nearest) { nearest = gap; v.blocker = m; }
      }
    }

    // red lights
    const sa = signalAhead(this.signals, v.x, v.y, v.h, v.heading, 34);
    if (sa) {
      const st = signalState(sa.sig, v.heading, t);
      const stopAt = sa.along - 7 - v.length / 2;
      if (st === 'red' || (st === 'amber' && stopAt > 6)) {
        const vt = stopSpeed(stopAt);
        if (vt < target) { target = vt; v.atSignal = true; }
      }
    }
    // ease over speed breakers
    if (this.index) {
      const ba = this.index.bumpAhead(v.x, v.y, v.h, v.heading, 18);
      if (ba) target = Math.min(target, 3.5 + Math.max(0, ba.along - 2) * 0.5);
    }
    return target;
  }

  // The first part of o (a vehicle or the player) that lies in v's lane ahead, if any.
  hitInPath(v, o) {
    const path = v.path;
    if (path.length < 2) return null;
    const b = path.box, r = o.length / 2 + (v.width + o.width) / 2 + 0.5;
    if (b && (o.x < b.x0 - r || o.x > b.x1 + r || o.y < b.y0 - r || o.y > b.y1 + r)) return null;
    const hd = o.visHeading + (o.yawOff || 0), fx = Math.sin(hd), fy = Math.cos(hd);
    const n = Math.max(2, Math.ceil(o.length / 1.4));
    const margin = v.bike || o.bike ? 0.15 : 0.3;
    const halfW = (v.width + o.width) / 2 + margin;
    let best = null;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) - 0.5) * o.length;
      const hit = onPath(path, o.x + fx * u, o.y + fy * u);
      if (!hit || hit.end || hit.along <= -v.length * 0.25 || Math.abs(hit.lat) > halfW) continue;
      if (!best || hit.along < best.along) best = hit;
    }
    return best;
  }

  // Earliest place where the two predicted paths come within a vehicle's width of each other.
  crossing(v, o) {
    const P = v.path, Q = o.path;
    if (P.length < 2 || Q.length < 2) return null;
    const A = P.box, B = Q.box, r = 4 + o.length / 2;
    if (A && B && (A.x0 - r > B.x1 || A.x1 + r < B.x0 || A.y0 - r > B.y1 || A.y1 + r < B.y0)) return null;
    // the other one's path starts at its tail: its whole body is in the way, not just its centre
    const h = o.visHeading + (o.yawOff || 0);
    const tail = { x: o.x - Math.sin(h) * o.length / 2, y: o.y - Math.cos(h) * o.length / 2, d: -o.length / 2 };
    for (let i = 1; i < P.length; i++) {
      const a0 = P[i - 1], a1 = P[i];
      const ax = a1.x - a0.x, ay = a1.y - a0.y;
      const da = Math.atan2(ax, ay);
      for (let j = 0; j < Q.length; j++) {
        const b0 = j === 0 ? tail : Q[j - 1], b1 = Q[j];
        if (Math.min(a0.x, a1.x) - 4 > Math.max(b0.x, b1.x) || Math.max(a0.x, a1.x) + 4 < Math.min(b0.x, b1.x)) continue;
        if (Math.min(a0.y, a1.y) - 4 > Math.max(b0.y, b1.y) || Math.max(a0.y, a1.y) + 4 < Math.min(b0.y, b1.y)) continue;
        const bx = b1.x - b0.x, by = b1.y - b0.y;
        const dh = Math.abs(angleDiff(da, Math.atan2(bx, by)));
        // side by side the same way or head-on: just enough to pass; converging: proper room
        const W = (v.width + o.width) / 2;
        const R = dh < 0.5 ? W + 0.3 : dh > 2.6 ? W + 0.2 : Math.max(2.3, W + 0.8);
        const c = segClosest(a0, ax, ay, b0, bx, by);
        if (c.d < R) return { dv: a0.d + c.u * (a1.d - a0.d), do: b0.d + c.w * (b1.d - b0.d) };
      }
    }
    return null;
  }

  // Who goes first where two paths cross. Both drivers read the same decision, so they never
  // both go (or both wait). The one that can no longer stop goes; otherwise the one that gets
  // there clearly first; otherwise the bigger road; the player wins ties.
  rightOfWay(v, o, c, t) {
    const key = v.id < o.id ? `${v.id}:${o.id}` : `${o.id}:${v.id}`;
    const prev = this.rights.get(key);
    if (prev && t - prev.t < 1 && !prev.w.gone) {
      // a decision holds until the paths stop crossing, so nobody changes their mind halfway.
      // Only if the one with right of way is itself stuck does the other get to go.
      prev.t = t;
      const other = prev.w === v ? o : v;
      if (prev.w.stillT > 4 && t - prev.made > 4 && other.mode === 'drive') { prev.w = other; prev.made = t; }
      return prev.w;
    }
    const da = c.dv, db = c.do;
    const eta = (a, d) => d / Math.max(Math.abs(a.v), 1.5) + (a.atSignal ? 60 : 0) + (a.stillT > 3 && (a.blocker || a.yieldingTo) ? 6 : 0);
    const committed = (a, d) => Math.max(0, a.v) ** 2 / (2 * 6) > d - a.length / 2 - 1;
    const ta = eta(v, da), tb = eta(o, db), ca = committed(v, da), cb = committed(o, db);
    let w;
    if (ca !== cb) w = ca ? v : o;
    else if (Math.abs(ta - tb) > 1) w = ta < tb ? v : o;
    else if ((v.rank ?? v.e.rank) !== (o.rank ?? o.e.rank)) w = (v.rank ?? v.e.rank) > (o.rank ?? o.e.rank) ? v : o;
    else w = v.id < o.id ? v : o;
    this.rights.set(key, { w, t, made: t });
    return w;
  }

  // Two vehicles nose to nose, each waiting for the other: one reverses to make room.
  // A vehicle stuck behind something that is not going anywhere drives round it.
  standoff(v, t, me, events) {
    const o = v.blocker;
    if (o && o.player && v.stillT > 3 && t > (v.honkAt || 0)) {
      v.honkAt = t + 4 + this.rand() * 5;
      events.push({ type: 'honk', d: Math.hypot(v.x - me.x, v.y - me.y) });
    }
    // a loop of three or more, each waiting for the next (a jammed junction): the one with
    // the lowest number in the loop sorts it out, by going first or by backing off
    if (v.stillT > 4) {
      let q = v, loop = [];
      for (let k = 0; k < 8; k++) {
        q = q.blocker || q.yieldingTo;
        if (!q || q.player || !q.mode || q.stillT < 2) { loop = null; break; }
        if (q === v) break;
        loop.push(q);
      }
      if (loop && q === v && loop.length >= 2 && loop.every((x) => x.id > v.id)) {
        if (!v.blocker && v.yieldingTo) {
          const o2 = v.yieldingTo;
          this.rights.set(v.id < o2.id ? `${v.id}:${o2.id}` : `${o2.id}:${v.id}`, { w: v, t, made: t });
        } else if (v.blocker) {
          v.partner = v.blocker;
          v.reverseFirst = true;
          this.setMode(v, 'reverse');
          return;
        }
      }
    }
    if (o && o.mode && v.stillT > 2.5 && o.blocker === v && o.stillT > 2.5 && o.mode === 'drive') {
      const loser = v.e.rank !== o.e.rank ? (v.e.rank < o.e.rank ? v : o) : this.rand() < 0.5 ? v : o;
      const winner = loser === v ? o : v;
      loser.partner = winner;
      loser.reverseFirst = true;
      this.setMode(loser, 'reverse');
      return;
    }
    // go round a parked or crashed vehicle, or the player stopped in the lane
    const parked = o && o.length > 1 && (o.player ? Math.abs(o.v) < 0.3 : o.mode === 'wait' || o.mode === 'crash' || (o.stillT > 6 && !o.atSignal && !o.blocker && !o.yieldingTo));
    if (parked && v.stillT > (o.player ? 4 : 5) && !v.bypassFor && !this.oncoming(v)) { v.bypassFor = o; v.bypassT = 0; }
    if (v.bypassFor) {
      const b = v.bypassFor;
      const q = b.gone ? null : local(v, b.x, b.y);
      v.bypassT += this.dt;
      if (!q || q.along < -(v.length + b.length) / 2 - 1 || Math.abs(b.v) > 1.5 || v.bypassT > 30) v.bypassFor = null;
      else {
        const need = (v.width + b.width) / 2 + 0.5 + q.lat; // shift right until it is clear on my left
        v.bypassTarget = clamp(need, 0, this.maxBypass(v));
      }
    }
    if (!v.bypassFor) v.bypassTarget = 0;
  }

  // anything coming the other way close ahead (don't pull out to go round then)
  oncoming(v) {
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (Math.abs(angleDiff(o.visHeading, v.visHeading)) < 2) continue;
      const q = local(v, o.x, o.y);
      if (q.along > 0 && q.along < 45 && q.lat < 1 && q.lat > -7) return true;
    }
    return false;
  }

  // Reversing after a crash or a stand-off: stop once there is room, or when something is behind.
  reverseDone(v, cars, people) {
    if (v.revLeft <= 0) return true;
    const o = v.partner;
    const backed = v.revTotal - v.revLeft; // metres reversed so far
    if (o && !o.gone && !o.player && backed > 1.5 && !this.hitInPath(o, v)) return true;
    // anything just behind: test the whole body moved back a metre
    const h = v.visHeading + v.yawOff;
    const probe = { x: v.x - Math.sin(h) * 1, y: v.y - Math.cos(h) * 1, visHeading: v.visHeading, yawOff: v.yawOff, length: v.length + 0.3, width: v.width + 0.3 };
    for (const c of cars) {
      if (c === v || c.gone || Math.abs(c.h - v.h) > 2.5) continue;
      if (Math.abs(c.x - v.x) > 16 || Math.abs(c.y - v.y) > 16) continue;
      if (local(v, c.x, c.y).along < 0 && overlaps(probe, c)) return true;
    }
    for (const m of people) {
      const q = local(v, m.x, m.y);
      if (q.along < 0 && q.along > -v.length / 2 - 1.2 && Math.abs(q.lat) < v.width / 2 + 0.5) return true;
    }
    return false;
  }

  // move along (or back along) the planned edges
  advance(v, ds) {
    v.s += ds;
    let guard = 0;
    while (v.s > v.e.len && guard++ < 6) {
      v.s -= v.e.len;
      const next = v.plan[0] && v.plan[0].fk === v.e.tk ? v.plan.shift() : this.chooseAfter(v.e);
      if (!next) { v.dead = true; return; }
      if (next.r !== v.e.r) v.lane = Math.floor(this.rand() * laneCount(next.r));
      v.prevE = v.e;
      v.e = next;
    }
    while (v.s < 0 && guard++ < 6) {
      if (v.prevE && v.prevE.tk === v.e.fk) {
        v.plan.unshift(v.e);
        v.e = v.prevE;
        v.prevE = null;
        v.s += v.e.len;
      } else {
        v.s = 0;
        v.v = 0;
        v.revLeft = 0;
      }
    }
    v.heading = v.e.dir;
  }

  // position on the lane, easing sideways only when the space beside is free
  place(v, dt, cars) {
    const E = v.e;
    if (v.bypassTarget !== undefined) v.bypass += clamp(v.bypassTarget - v.bypass, -0.8 * dt, 1.2 * dt);
    const want = this.laneOffset(E, v) - v.bypass;
    const delta = want - v.offset;
    // a vehicle only drifts sideways while it rolls (no sliding about at a standstill)
    const roll = Math.min(1, Math.abs(v.v) * 0.5);
    if (Math.abs(delta) > 0.05 && this.sideFree(v, delta, cars)) v.offset += delta * Math.min(1, dt * 1.5 * roll);
    // the heading eases round bends, and the lane offset follows that smoothed
    // heading, so vehicles sweep through corners instead of hopping sideways
    const turn = angleDiff(v.visHeading, E.dir);
    // and turns only as it moves: a stopped car does not swivel on the spot
    v.visHeading += turn * Math.min(1, dt * Math.abs(v.v) * 0.75);
    if (v.mode === 'drive') v.yawOff *= Math.exp(-dt * 0.8);
    this.pose(v);
    v.h += (E.from[2] + (E.to[2] - E.from[2]) * (v.s / E.len) - v.h) * Math.min(1, dt * 10);
    v.mesh.position.set(v.x, v.h + 0.02, -v.y);
    v.mesh.rotation.set(0, -(v.visHeading + v.yawOff), 0);
    if (v.bike) v.mesh.rotation.z = clamp(-turn * 0.6, -0.3, 0.3); // lean into turns
  }

  pose(v) {
    const E = v.e, k = v.s / E.len;
    const lx = -Math.cos(v.visHeading), ly = Math.sin(v.visHeading);
    v.x = E.from[0] + (E.to[0] - E.from[0]) * k + lx * v.offset;
    v.y = E.from[1] + (E.to[1] - E.from[1]) * k + ly * v.offset;
  }

  // is there room to move delta metres sideways (left +)?
  sideFree(v, delta, cars) {
    const dir = Math.sign(delta);
    for (const o of cars) {
      if (o === v || o.gone) continue;
      const dx = o.x - v.x, dy = o.y - v.y;
      if (dx > 16 || dx < -16 || dy > 16 || dy < -16 || Math.abs(o.h - v.h) > 2.5) continue;
      const q = local(v, o.x, o.y);
      if (Math.abs(q.along) > (v.length + o.length) / 2 + 1) continue;
      const side = q.lat * dir; // > 0: it is on the side I am moving towards
      const room = (v.width + o.width) / 2 + 0.25;
      if (side > 0 && side < room + Math.abs(delta)) return false;
    }
    return true;
  }

  // ---------- contact ----------
  contacts(t, player, me, people, events) {
    const V = this.vehicles;
    const px = player.x, py = player.y;
    for (let i = 0; i < V.length; i++) {
      const a = V[i];
      for (let j = i + 1; j < V.length; j++) {
        const b = V[j];
        if (Math.abs(a.x - b.x) > 14 || Math.abs(a.y - b.y) > 14 || Math.abs(a.h - b.h) > 2) continue;
        if (a.involved?.has(b)) continue; // already sorting it out
        if (overlaps(a, b)) this.crash(a, b, me, events);
      }
      // a vehicle running into someone on foot
      for (const m of people) {
        if (Math.abs(m.x - a.x) > 8 || Math.abs(m.y - a.y) > 8 || Math.abs(m.h - a.h) > 1.5) continue;
        const q = local(a, m.x, m.y);
        if (Math.abs(q.along) < a.length / 2 + 0.15 && Math.abs(q.lat) < a.width / 2 + 0.15) {
          if (!(m.knocked > 0) && Math.abs(a.v) > 0.5) {
            m.knocked = 2.5;
            m.wait = Math.max(m.wait || 0, 2.5);
            events.push({ type: 'npc-crash', speed: Math.abs(a.v) * 0.5, d: Math.hypot(a.x - px, a.y - py) });
          }
          m.shove = (m.shove || 0) + 0.06; // step back out of the way
          if (a.mode === 'drive' && Math.abs(a.v) > 0.5) { a.v = 0; a.partner = null; this.setMode(a, 'wait'); a.maxWait = 2.5; }
        }
      }
    }

    // contact with the player (circles along each body)
    const pf = player.fwd;
    for (const v of V) {
      const dxp = v.x - px, dyp = v.y - py;
      if (Math.abs(dxp) > 9 || Math.abs(dyp) > 9 || Math.abs(v.h - player.h) > 2) continue;
      const fx = Math.sin(v.visHeading), fy = Math.cos(v.visHeading);
      let touched = false;
      for (const po of [-1.2, 0, 1.2]) {
        const cx = px + pf.x * po, cy = py + pf.y * po;
        const n = Math.max(1, Math.round(v.length / 2.2));
        for (let j = 0; j < n; j++) {
          const o = (j / Math.max(1, n - 1) - 0.5) * Math.max(0, v.length - 1.6);
          const ox = v.x + fx * o, oy = v.y + fy * o;
          const d = Math.hypot(cx - ox, cy - oy);
          const R = 0.9 + v.radius;
          if (d < R && d > 1e-3) {
            const push = (R - d) * 0.9;
            player.x += ((cx - ox) / d) * push;
            player.y += ((cy - oy) / d) * push;
            const rel = Math.abs(player.v - v.v * Math.cos(angleDiff(v.visHeading, player.heading)));
            if (rel > 0.6 || Math.abs(player.v) > 1) events.push({ type: 'collision', what: 'vehicle', speed: rel });
            player.v *= 0.4;
            v.v *= 0.3;
            touched = true;
          }
        }
      }
      if (touched && v.mode === 'drive') {
        // the player hit it, or it hit the player: it stops; if it was its fault it backs off
        const q = local(v, px, py);
        const struck = q.along > v.length / 2 - 0.5 && v.v > 0.3;
        v.partner = me;
        v.reverseFirst = this.rand() < (struck ? 0.8 : 0.15);
        v.shock = 1 + this.rand();
        this.setMode(v, 'crash');
        v.yawOff += (this.rand() - 0.5) * 0.12;
      }
    }
  }

  // Two AI vehicles have touched: a real accident. Both stop and stand a moment; then
  // (usually the one that ran into the other) reverses to make room, and the other goes first.
  crash(a, b, me, events) {
    (a.involved ||= new Set()).add(b);
    (b.involved ||= new Set()).add(a);
    const busy = (v) => v.mode !== 'drive';
    // running into a vehicle that is already standing after another crash: just stop behind it
    if (busy(a) !== busy(b)) {
      const mover = busy(a) ? b : a, still = mover === a ? b : a;
      this.separate(mover, still);
      mover.v = 0;
      mover.partner = still;
      mover.reverseFirst = false;
      mover.shock = 0.8 + this.rand();
      this.setMode(mover, 'crash');
      events.push({ type: 'npc-crash', speed: 2, d: Math.hypot(a.x - me.x, a.y - me.y) });
      return;
    }
    const fa = local(a, b.x, b.y).along, fb = local(b, a.x, a.y).along;
    const rel = Math.hypot(a.v * Math.sin(a.visHeading) - b.v * Math.sin(b.visHeading), a.v * Math.cos(a.visHeading) - b.v * Math.cos(b.visHeading));
    // the one whose front did the hitting is pushed back out; it is usually also the one that reverses
    const rearEnd = (fa > 0) !== (fb > 0);
    const striker = rearEnd ? (fa > 0 ? a : b) : fa < fb ? a : b;
    let back = striker;
    if (!rearEnd && this.rand() < 0.3) back = back === a ? b : a; // a side-on knock is messy: either may back off
    const hit = Math.min(1, rel / 5);
    for (const v of [a, b]) {
      v.partner = v === a ? b : a;
      v.reverseFirst = v === back;
      v.shock = 1.2 + this.rand() * 1.8 + hit;
      v.v = 0;
      v.yawOff = clamp(v.yawOff + (this.rand() - 0.5) * 0.32 * hit, -0.25, 0.25); // knocked askew
      this.setMode(v, 'crash');
    }
    this.separate(striker, striker === a ? b : a);
    events.push({ type: 'npc-crash', speed: rel, d: Math.hypot(a.x - me.x, a.y - me.y) });
  }

  // ease the striker back along its lane until the two only touch
  separate(v, o) {
    for (let k = 0; k < 30 && overlaps(v, o); k++) {
      v.s -= 0.12;
      if (v.s < 0) this.advance(v, 0);
      this.pose(v);
    }
    v.mesh.position.set(v.x, v.h + 0.02, -v.y);
  }

  clear() {
    for (const v of this.vehicles) this.scene.remove(v.mesh);
    this.vehicles = [];
  }
}
