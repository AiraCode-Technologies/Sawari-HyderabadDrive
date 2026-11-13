import * as THREE from 'three';
import { mulberry } from './util.js';

// People walking along the footpaths. Each body part is one InstancedMesh, so a
// whole crowd costs a handful of draw calls. Outfits follow what is common on
// Hyderabad streets; the mix shifts with the area (more burqas, kurtas and lungis
// in the Old City, more office wear in HITEC City).
const OUTFITS = {
  shirt: { w: 1 }, // shirt and trousers
  kurta: { w: 1 },
  lungi: { w: 1 },
  saree: { w: 1 },
  salwar: { w: 1 },
  burqa: { w: 1 },
  school: { w: 1 },
};
const MIX = {
  old: { shirt: 0.22, kurta: 0.16, lungi: 0.08, saree: 0.14, salwar: 0.12, burqa: 0.2, school: 0.08 },
  tech: { shirt: 0.45, kurta: 0.05, lungi: 0.02, saree: 0.12, salwar: 0.25, burqa: 0.04, school: 0.07 },
  upscale: { shirt: 0.38, kurta: 0.08, lungi: 0.04, saree: 0.18, salwar: 0.22, burqa: 0.04, school: 0.06 },
  central: { shirt: 0.33, kurta: 0.1, lungi: 0.07, saree: 0.18, salwar: 0.18, burqa: 0.07, school: 0.07 },
};
const SAREE = ['#c0392b', '#e67e22', '#8e44ad', '#16a085', '#d81b60', '#f1c40f', '#2e86c1', '#6d214f', '#1e8449'];
const SHIRT = ['#f4f4f0', '#9fc3e6', '#2c3e50', '#c0392b', '#7f8c8d', '#e8d8b0', '#5d6d7e', '#a9cce3'];
const TROUSER = ['#2c3e50', '#3b3b3b', '#5d4e3a', '#1f3a5f', '#7f6a4d'];
const SKIN = ['#8d5b3c', '#a0694a', '#7a4b31', '#b07a55', '#6b4129'];
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
export const PEDESTRIAN_LEVELS = { off: 0, low: 25, medium: 45, high: 65, dense: 85 };

export class Pedestrians {
  constructor(world, scene, density, terrain, index) {
    this.index = index;
    this.target = PEDESTRIAN_LEVELS[density] ?? 45;
    this.rand = mulberry(0x51ed + world.id.length);
    this.T = terrain;
    this.mix = MIX[world.style] || MIX.central;
    this.people = [];
    // footpath-bearing roads at ground level
    this.paths = world.roads
      .filter((r) => (RANK[r.k] || 0) >= 2 && r.p.every((q) => q[2] - terrain.at(q[0], q[1]) < 0.8))
      .map((r) => {
        const cum = [0];
        for (let i = 1; i < r.p.length; i++) cum.push(cum[i - 1] + Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]));
        const xs = r.p.map((q) => q[0]), ys = r.p.map((q) => q[1]);
        const sw = (RANK[r.k] || 2) >= 3 ? 2.4 : 1.4;
        return { r, cum, len: cum[cum.length - 1], off: r.w / 2 + sw * 0.55, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), busy: (RANK[r.k] || 2) >= 3 ? 2 : 1 };
      })
      .filter((p) => p.len > 15);
    this.near = [];
    this.nearAt = -1e9;
    // temples, mosques and churches draw people who linger outside
    this.sites = world.worship || [];

    // instanced body parts (unit-sized, scaled per person)
    const N = Math.max(1, this.target);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const mk = (geo) => {
      const m = new THREE.InstancedMesh(geo, mat, N);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.parts = {
      torso: mk(new THREE.BoxGeometry(0.36, 0.55, 0.22)),
      head: mk(new THREE.SphereGeometry(0.11, 8, 6)),
      hair: mk(new THREE.SphereGeometry(0.115, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
      legL: mk(new THREE.BoxGeometry(0.13, 0.85, 0.14).translate(0, -0.425, 0)),
      legR: mk(new THREE.BoxGeometry(0.13, 0.85, 0.14).translate(0, -0.425, 0)),
      armL: mk(new THREE.BoxGeometry(0.09, 0.58, 0.1).translate(0, -0.29, 0)),
      armR: mk(new THREE.BoxGeometry(0.09, 0.58, 0.1).translate(0, -0.29, 0)),
      skirt: mk(new THREE.CylinderGeometry(0.17, 0.3, 1, 8).translate(0, -0.5, 0)),
      extra: mk(new THREE.BoxGeometry(0.3, 0.32, 0.14)), // dupatta, school bag
    };
    this.scene = scene;
    this.m = new THREE.Matrix4();
    this.base = new THREE.Matrix4();
    this.local = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
  }

  pickOutfit() {
    let x = this.rand();
    for (const [k, p] of Object.entries(this.mix)) if ((x -= p) <= 0) return k;
    return 'shirt';
  }

  look(outfit) {
    const R = this.rand, pick = (a) => a[Math.floor(R() * a.length)];
    const skin = pick(SKIN);
    const L = { outfit, skin, hair: '#1b1612', scale: 0.95 + R() * 0.12 };
    switch (outfit) {
      case 'shirt': Object.assign(L, { top: pick(SHIRT), legs: pick(TROUSER) }); break;
      case 'kurta': Object.assign(L, { top: pick(['#f4f1e6', '#e8e2d0', '#cfe0e8', '#f4f4f0']), legs: '#f4f1e6', skirt: 'kurta', skirtCol: '#f4f1e6', cap: R() < 0.4 ? '#f4f4f0' : null }); L.skirtCol = L.top; break;
      case 'lungi': Object.assign(L, { top: '#f4f4f0', legs: L.skin, skirt: 'lungi', skirtCol: pick(['#2e6da4', '#5b3f8c', '#1e8449', '#7f8c8d']) }); break;
      case 'saree': Object.assign(L, { top: pick(SAREE), legs: L.skin, skirt: 'long', skirtCol: pick(SAREE), scale: 0.9 + R() * 0.08 }); L.top = L.skirtCol; break;
      case 'salwar': Object.assign(L, { top: pick(SAREE), legs: pick(['#f4f1e6', '#1b1b1b', '#c0392b', '#f1c40f']), skirt: 'kameez', extra: 'dupatta', extraCol: pick(SAREE), scale: 0.9 + R() * 0.08 }); L.skirtCol = L.top; break;
      case 'burqa': Object.assign(L, { top: '#151515', legs: '#151515', skirt: 'long', skirtCol: '#151515', hair: '#151515', scale: 0.9 + R() * 0.08 }); break;
      case 'school': Object.assign(L, { top: '#f4f4f0', legs: '#1f3a5f', extra: 'bag', extraCol: pick(['#c0392b', '#2e86c1', '#f39c12']), scale: 0.7 + R() * 0.1 }); break;
    }
    return L;
  }

  refreshNear(px, py, t) {
    if (t - this.nearAt < 2 && this.near.length) return;
    this.nearAt = t;
    const R = 170;
    this.near = this.paths.filter((p) => p.maxX > px - R && p.minX < px + R && p.maxY > py - R && p.minY < py + R);
  }

  // a footpath spot right outside a place of worship near the player
  gatheringSpot(px, py) {
    const sites = this.sites.filter((w) => Math.hypot(w.x - px, w.y - py) < 160);
    if (!sites.length) return null;
    const w = sites[Math.floor(this.rand() * sites.length)];
    let best = null;
    for (const p of this.near) {
      const r = p.r;
      for (let i = 1; i < r.p.length; i++) {
        const a = r.p[i - 1], b = r.p[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((w.x - a[0]) * dx + (w.y - a[1]) * dy) / l2));
        const d = Math.hypot(w.x - (a[0] + dx * t), w.y - (a[1] + dy * t));
        if (d < 40 && (!best || d < best.d)) {
          const side = Math.sign(dx * (w.y - a[1]) - dy * (w.x - a[0])) < 0 ? 1 : -1;
          best = { d, p, s: p.cum[i - 1] + t * (p.cum[i] - p.cum[i - 1]), side };
        }
      }
    }
    return best;
  }

  spawn(px, py, initial) {
    if (this.rand() < 0.35) {
      const g = this.gatheringSpot(px, py);
      if (g) {
        const outfit = this.pickOutfit();
        const s0 = g.s + (this.rand() - 0.5) * 14;
        const pos = this.at(g.p, s0, g.side);
        if (Math.hypot(pos.x - px, pos.y - py) > (initial ? 10 : 50)) {
          this.people.push({ p: g.p, s: s0, side: g.side, dir: this.rand() < 0.5 ? 1 : -1, speed: 0.45 + this.rand() * 0.3, phase: this.rand() * 6.28, look: this.look(outfit), x: pos.x, y: pos.y, h: pos.h, wait: this.rand() * 4, lateral: (this.rand() - 0.5) * 1.2, anchor: g.s });
          return;
        }
      }
    }
    for (let tries = 0; tries < 25; tries++) {
      const p = this.near[Math.floor(this.rand() * this.near.length)];
      if (!p) return;
      if (p.busy < 2 && this.rand() < 0.5) continue; // busier footpaths on main roads
      const s = this.rand() * p.len;
      const side = this.rand() < 0.5 ? -1 : 1;
      const pos = this.at(p, s, side);
      const d = Math.hypot(pos.x - px, pos.y - py);
      if (d < (initial ? 12 : 70) || d > 160) continue;
      const outfit = this.pickOutfit();
      this.people.push({ p, s, side, dir: this.rand() < 0.5 ? 1 : -1, speed: (outfit === 'school' ? 1.25 : 1.05) + this.rand() * 0.4, phase: this.rand() * 6.28, look: this.look(outfit), x: pos.x, y: pos.y, h: pos.h, heading: 0, wait: 0, lateral: (this.rand() - 0.5) * 0.6 });
      return;
    }
  }

  // position on a footpath: s metres along the road, on one side
  at(p, s, side, lateral = 0) {
    const r = p.r, cum = p.cum;
    s = Math.max(0, Math.min(p.len, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = r.p[i - 1], b = r.p[i];
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const dir = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const off = (p.off + lateral) * side;
    const x = a[0] + (b[0] - a[0]) * t + Math.cos(dir) * off, y = a[1] + (b[1] - a[1]) * t - Math.sin(dir) * off;
    return { x, y, h: a[2] + (b[2] - a[2]) * t + 0.04, dir };
  }

  update(dt, player, t) {
    if (!this.target) return [];
    const events = [];
    this.refreshNear(player.x, player.y, t);
    const initial = t < 1.5;
    for (let k = 0; k < (initial ? 8 : 2) && this.people.length < this.target; k++) this.spawn(player.x, player.y, initial);
    this.people = this.people.filter((m) => Math.hypot(m.x - player.x, m.y - player.y) < 220);

    const pf = player.fwd;
    for (const m of this.people) {
      if (m.wait > 0) m.wait -= dt;
      else {
        m.s += m.dir * m.speed * dt;
        if (m.anchor !== undefined) {
          // people at a place of worship mill about the entrance and stop to talk
          if (Math.abs(m.s - m.anchor) > 9) m.dir = Math.sign(m.anchor - m.s);
          if (this.rand() < dt * 0.25) m.wait = 2 + this.rand() * 5;
        }
        if (m.s < 0 || m.s > m.p.len) {
          m.dir = -m.dir; // reached the end of this footpath: turn back
          m.s = Math.max(0, Math.min(m.p.len, m.s));
        }
        m.phase += dt * m.speed * 5.2;
      }
      const pos = this.at(m.p, m.s, m.side, m.lateral);
      // ease the walking direction round corners instead of snapping
      const want = pos.dir + (m.dir < 0 ? Math.PI : 0);
      m.heading = m.heading === undefined || m.fresh === undefined ? want : m.heading + Math.atan2(Math.sin(want - m.heading), Math.cos(want - m.heading)) * Math.min(1, dt * 6);
      m.fresh = true;
      const k = Math.min(1, dt * 8);
      m.x = m.x === undefined ? pos.x : m.x + (pos.x - m.x) * k;
      m.y = m.y === undefined ? pos.y : m.y + (pos.y - m.y) * k;
      // stand on the raised footpath, stepping down where it stops at side roads
      const hh = this.index ? this.index.standAt(m.x, m.y) : pos.h;
      m.h = m.hs === undefined ? hh : m.h + (hh - m.h) * Math.min(1, dt * 10);
      m.hs = true;
      // the player's car reaching a pedestrian (on a footpath or a crossing)
      for (const o of [1.3, 0, -1.3]) {
        const cx = player.x + pf.x * o, cy = player.y + pf.y * o;
        if (Math.hypot(m.x - cx, m.y - cy) < 1.15 && Math.abs(m.h - player.h) < 1.5 && Math.abs(player.v) > 0.8) {
          events.push({ type: 'collision', what: 'pedestrian', speed: Math.abs(player.v) * 3 });
          m.wait = 4;
          m.lateral += 1.2; // step away towards the buildings
        }
      }
    }
    this.draw();
    return events;
  }

  draw() {
    const P = this.parts, m = this.m, base = this.base, local = this.local, q = this.q, e = this.e, v = this.v;
    const col = new THREE.Color();
    let n = 0;
    const set = (mesh, i, mat, color) => {
      mesh.setMatrixAt(i, mat);
      mesh.setColorAt(i, col.set(color));
    };
    const hide = (mesh, i) => {
      m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, m);
    };
    for (const p of this.people) {
      const L = p.look, s = L.scale;
      base.compose(v.set(p.x, p.h, -p.y), q.setFromEuler(e.set(0, -p.heading, 0)), new THREE.Vector3(s, s, s));
      const swing = p.wait > 0 ? 0 : Math.sin(p.phase) * 0.5;
      const part = (mesh, x, y, z, rx, color, sx = 1, sy = 1, sz = 1) => {
        local.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));
        set(mesh, n, m.multiplyMatrices(base, local), color);
      };
      part(P.torso, 0, 1.2, 0, 0, L.top);
      part(P.head, 0, 1.6, 0, 0, L.skin);
      part(P.hair, 0, 1.63, 0.01, 0, L.cap || L.hair, 1, L.outfit === 'burqa' ? 1.6 : 1, 1);
      part(P.legL, -0.09, 0.9, 0, swing, L.legs);
      part(P.legR, 0.09, 0.9, 0, -swing, L.legs);
      part(P.armL, -0.23, 1.45, 0, -swing * 0.8, L.outfit === 'burqa' ? '#151515' : L.outfit === 'shirt' || L.outfit === 'school' ? L.top : L.skin);
      part(P.armR, 0.23, 1.45, 0, swing * 0.8, L.outfit === 'burqa' ? '#151515' : L.outfit === 'shirt' || L.outfit === 'school' ? L.top : L.skin);
      // lower garment: saree and burqa to the ground, kameez and kurta to the knee, lungi to the shin
      if (L.skirt) {
        const len = L.skirt === 'long' ? 0.95 : L.skirt === 'lungi' ? 0.7 : 0.55;
        part(P.skirt, 0, 0.98, 0, 0, L.skirtCol, 1, len, 1);
      } else hide(P.skirt, n);
      if (L.extra === 'dupatta') part(P.extra, 0, 1.38, -0.05, 0, L.extraCol, 1.2, 0.35, 1.1);
      else if (L.extra === 'bag') part(P.extra, 0, 1.2, 0.18, 0, L.extraCol);
      else hide(P.extra, n);
      n++;
    }
    for (const mesh of Object.values(P)) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.people = [];
    for (const mesh of Object.values(this.parts)) this.scene.remove(mesh);
  }
}
