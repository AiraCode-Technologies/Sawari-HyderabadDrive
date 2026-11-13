import * as THREE from 'three';
import { mulberry, clamp, angleDiff } from './util.js';
import { signalAhead, signalState } from './signals.js';
import { buildCatalogue, TRAFFIC_MIX } from './vehicles.js';

let CATALOGUE = null; // built once, shared by every drive

const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
export const TRAFFIC_LEVELS = { off: 0, low: 14, medium: 28, high: 48, dense: 80 };

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
      return Math.max(r.o ? -r.w / 2 + 0.8 : 0.3, r.w / 2 - 0.7 - v.jitter - (v.overtake || 0)); // minus the overtaking swing to the right
    }
    if (!r.o) return Math.min(r.w / 4, 2.6);
    const lanes = Math.max(1, r.l);
    return r.w / 2 - (r.w / lanes) * (Math.min(v.lane, lanes - 1) + 0.5);
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
      if (this.vehicles.some((v) => Math.abs(v.x - x) < 9 && Math.abs(v.y - y) < 9)) continue;
      const kind = this.pickKind(e.rank);
      const list = this.protos[kind];
      const proto = list[Math.floor(this.rand() * list.length)];
      const mesh = new THREE.Mesh(proto.geo, this.material);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const v = {
        e, s, mesh, kind, length: proto.length, width: proto.width, radius: proto.radius, bike: !!proto.bike,
        lane: Math.floor(this.rand() * Math.max(1, e.r.l)), jitter: this.rand() * 1.2,
        maxSpeed: proto.maxSpeed * (0.82 + this.rand() * 0.32),
        v: initial ? 3 + this.rand() * 5 : 6, x, y, h: e.from[2], heading: e.dir, visHeading: e.dir, wait: 0,
      };
      v.offset = this.laneOffset(e, v);
      this.vehicles.push(v);
      return true;
    }
    return false;
  }

  update(dt, player, t) {
    if (!this.target) return [];
    const events = [];
    const px = player.x, py = player.y;
    this.refreshNear(px, py, t);
    // keep the population topped up around the player
    const initial = t < 1.5;
    for (let k = 0; k < (initial ? 6 : 2) && this.vehicles.length < this.target; k++) this.spawn(px, py, player.heading, initial);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (Math.hypot(v.x - px, v.y - py) > this.maxR + 90 || v.dead) {
        this.scene.remove(v.mesh);
        this.vehicles.splice(i, 1);
      }
    }

    const others = [...this.vehicles, { x: px, y: py, length: 4.3, width: 1.8, heading: player.heading, player: true, v: Math.abs(player.v) }];
    for (const v of this.vehicles) {
      const e = v.e;
      const limit = (e.r.s || 40) / 3.6;
      let target = Math.min(v.maxSpeed, limit * 0.9);
      const fx = Math.sin(v.heading), fy = Math.cos(v.heading);
      // slow for sharp turns at the end of the edge
      const rem = e.len - v.s;
      if (rem < 15 && v.nextTurn !== undefined) target = Math.min(target, 4 + 8 * (1 - Math.min(1, Math.abs(v.nextTurn) / 1.2)));
      // vehicles and the player ahead
      let blockedCross = false, wantPass = false;
      for (const o of others) {
        if (o === v) continue;
        const dx = o.x - v.x, dy = o.y - v.y;
        if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue;
        const along = dx * fx + dy * fy;
        if (along <= 0 || along > 38) continue;
        const lat = -dx * fy + dy * fx;
        const halfW = ((v.width || 1.8) + (o.width || 1.8)) / 2 + 0.25;
        if (Math.abs(lat) > halfW) continue;
        const sameWay = Math.abs(angleDiff(o.heading, v.heading)) < 1.2;
        const gap = along - (v.length + o.length) / 2;
        if (sameWay || o.player) {
          target = Math.min(target, Math.max(0, (gap - (this.dense ? 1.8 : 2.5)) * 0.75));
          // two-wheelers filter past slower vehicles on their right
          if (v.bike && !o.bike && gap < 12 && (o.v ?? 0) < v.maxSpeed * 0.85) wantPass = true;
        } else if (gap < 5) {
          // something crossing right in front: hold back rather than drive through it
          blockedCross = true;
        }
      }
      if (v.bike) v.overtake = clamp((v.overtake || 0) + (wantPass ? 1.4 : -0.7) * dt, 0, 2.2);
      if (blockedCross) {
        v.wait += dt;
        // after a short stand-off, creep on so junctions never lock up for good
        if (v.wait < 3 + (v.length % 1)) target = 0;
      } else v.wait = 0;
      // red lights
      const sa = signalAhead(this.signals, v.x, v.y, v.h, v.heading, 34);
      if (sa) {
        const st = signalState(sa.sig, v.heading, t);
        const stopAt = sa.along - 7 - v.length / 2;
        if (st === 'red' || (st === 'amber' && stopAt > 6)) target = Math.min(target, Math.max(0, stopAt * 0.55));
      }
      // ease over speed breakers
      if (this.index) {
        const ba = this.index.bumpAhead(v.x, v.y, v.h, v.heading, 18);
        if (ba) target = Math.min(target, 3.5 + Math.max(0, ba.along - 2) * 0.5);
      }
      const acc = clamp((target - v.v) * 1.6, -7.5, v.bike ? 3 : 2.4);
      v.v = Math.max(0, v.v + acc * dt);
      v.s += v.v * dt;

      // advance along the graph
      let guard = 0;
      while (v.s > v.e.len && guard++ < 4) {
        v.s -= v.e.len;
        const next = this.pickNext(v);
        if (!next) { v.dead = true; break; }
        v.e = next;
        v.nextTurn = undefined;
      }
      if (v.dead) continue;
      if (v.nextTurn === undefined) {
        const peek = this.peekNext(v);
        v.nextTurn = peek ? angleDiff(v.e.dir, peek.dir) : 0;
        v.peek = peek;
      }
      const E = v.e, k = v.s / E.len;
      v.offset += (this.laneOffset(E, v) - v.offset) * Math.min(1, dt * 1.5);
      // the heading eases round bends, and the lane offset follows that smoothed
      // heading, so vehicles sweep through corners instead of hopping sideways
      const turn = angleDiff(v.visHeading, E.dir);
      v.visHeading += turn * Math.min(1, dt * (2 + v.v * 0.6));
      const lx = -Math.cos(v.visHeading), ly = Math.sin(v.visHeading);
      v.x = E.from[0] + (E.to[0] - E.from[0]) * k + lx * v.offset;
      v.y = E.from[1] + (E.to[1] - E.from[1]) * k + ly * v.offset;
      v.h += (E.from[2] + (E.to[2] - E.from[2]) * k - v.h) * Math.min(1, dt * 10);
      v.heading = E.dir;
      v.mesh.position.set(v.x, v.h + 0.02, -v.y);
      v.mesh.rotation.set(0, -v.visHeading, 0);
      if (v.bike) v.mesh.rotation.z = clamp(-turn * 0.6, -0.3, 0.3); // lean into turns

      // contact with the player (circles along each body)
      const dxp = v.x - px, dyp = v.y - py;
      if (Math.abs(dxp) < 9 && Math.abs(dyp) < 9 && Math.abs(v.h - player.h) < 2) {
        const pf = player.fwd;
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
              const rel = Math.abs(player.v - v.v * Math.cos(angleDiff(v.heading, player.heading)));
              if (rel > 0.6 || Math.abs(player.v) > 1) events.push({ type: 'collision', what: 'vehicle', speed: rel });
              player.v *= 0.4;
              v.v *= 0.3;
            }
          }
        }
      }
    }
    return events;
  }

  candidates(v) {
    const e = v.e;
    return (this.out.get(e.tk) || []).filter((n) => !(n.tk === e.fk && n.r === e.r));
  }

  peekNext(v) {
    if (v.peek && v.peek.fk === v.e.tk) return v.peek;
    const list = this.candidates(v);
    if (!list.length) return null;
    // mostly carry straight on; sometimes turn
    const same = list.filter((n) => n.r === v.e.r || Math.abs(angleDiff(v.e.dir, n.dir)) < 0.35);
    const pool = same.length && this.rand() < 0.75 ? same : list;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  pickNext(v) {
    const n = v.peek && v.peek.fk === v.e.tk ? v.peek : this.peekNext(v);
    v.peek = null;
    if (n && n.r !== v.e.r) v.lane = Math.floor(this.rand() * Math.max(1, n.r.l));
    return n;
  }

  clear() {
    for (const v of this.vehicles) this.scene.remove(v.mesh);
    this.vehicles = [];
  }
}
