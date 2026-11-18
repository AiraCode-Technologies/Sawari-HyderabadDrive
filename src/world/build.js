import * as THREE from 'three';
import { buildLandmarks } from './landmarks.js';
import { buildFamous } from './famous.js';
import { rasterize } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { buildProps } from './props.js';
import { buildTransit } from './transit.js';
import { buildStreetLife } from './streetlife.js';

import { buildRoads, uniqueDirs } from './roads.js';
import { groundTexture, waterTexture, TEX_GAIN } from './textures.js';
import { addTiled, mergeByMaterial } from '../util.js';

// ground colour by land use
const GROUND = {
  base: '#a69d78', residential: '#a59c7e', commercial: '#a09b8d', industrial: '#9c988f', construction: '#a8987b',
  park: '#7f9b57', grass: '#91a25f', wood: '#5f7b3f', scrub: '#95965f', rock: '#9b968b', sand: '#c9ba90',
  cemetery: '#8d9566', farm: '#9ba761', bed: '#5d6a5f',
};
const GROUND_KEYS = Object.keys(GROUND);

export function buildWorld(world, quality, terrain, index) {
  const group = new THREE.Group();
  const T = terrain;
  const gAt = (x, y) => T.at(x, y);

  // ---------- ground mesh following the real terrain ----------
  {
    const { x0, y0, d, nx, ny } = T;
    const cls = new Uint8Array(nx * ny); // index into GROUND_KEYS
    const order = ['residential', 'commercial', 'industrial', 'construction', 'farm', 'cemetery', 'grass', 'scrub', 'sand', 'wood', 'rock'];
    for (const k of order)
      for (const l of world.landuse || []) if (l.k === k) rasterize(l.p, x0, y0, d, nx, ny, (i, j) => (cls[j * nx + i] = GROUND_KEYS.indexOf(k)));
    for (const p of world.parks) rasterize(p, x0, y0, d, nx, ny, (i, j) => (cls[j * nx + i] = GROUND_KEYS.indexOf('park')));
    const height = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) height[j * nx + i] = T.h[j * nx + i];
    // lake beds below the water surface
    for (const w of world.water)
      rasterize(w.o, x0, y0, d, nx, ny, (i, j) => {
        height[j * nx + i] = Math.min(height[j * nx + i], w.l - 2.2);
        cls[j * nx + i] = GROUND_KEYS.indexOf('bed');
      });
    // A clean shoreline: the bed shelves gently down from the edge, and the ground just outside
    // sits a little above the water, so the waterline follows the shore instead of zigzagging
    // along the 10 m mesh (the water surface itself reaches 3 m past the mapped edge).
    for (const w of world.water) {
      const ring = w.o;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const q of ring) { bx0 = Math.min(bx0, q[0]); by0 = Math.min(by0, q[1]); bx1 = Math.max(bx1, q[0]); by1 = Math.max(by1, q[1]); }
      const inside = (x, y) => {
        let ins = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const [xa, ya] = ring[a], [xb, yb] = ring[b];
          if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) ins = !ins;
        }
        return ins;
      };
      const edgeDist = (x, y) => {
        let best = Infinity;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const ex = ring[a][0] - ring[b][0], ey = ring[a][1] - ring[b][1], l2 = ex * ex + ey * ey || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ring[b][0]) * ex + (y - ring[b][1]) * ey) / l2));
          best = Math.min(best, Math.hypot(x - ring[b][0] - ex * t, y - ring[b][1] - ey * t));
        }
        return best;
      };
      const i0 = Math.max(0, Math.floor((bx0 - 16 - x0) / d)), i1 = Math.min(nx - 1, Math.ceil((bx1 + 16 - x0) / d));
      const j0 = Math.max(0, Math.floor((by0 - 16 - y0) / d)), j1 = Math.min(ny - 1, Math.ceil((by1 + 16 - y0) / d));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * d, y = y0 + j * d, k = j * nx + i;
          const e = edgeDist(x, y);
          if (e > 16) continue;
          if (inside(x, y)) height[k] = Math.min(height[k], w.l - 0.5 - e * 0.12);
          else if (e < 12) height[k] = Math.max(height[k], w.l + 0.3 + e * 0.03);
        }
    }
    // Tuck the ground just under every ground-level road and its footpaths. Every road in
    // reach counts (not just the one nearest in height: beside a flyover that was the deck,
    // and the street below got no tuck), and the ground stays flat a little way out before
    // rising, so a 10 m mesh triangle reaching across a road never pokes through it.
    // first the ground beside every road on the ground comes up to it, just below the footpath,
    // falling away beyond (where grading lifted a road, its dark side skirt showed like a wall)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * d, y = y0 + j * d;
        if (cls[k] === GROUND_KEYS.indexOf('bed')) continue; // not in a lake
        for (const s of index.grid.query(x, y, 10)) {
          if (s.st) continue;
          const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2));
          const dd = Math.hypot(x - s.ax - ex * t, y - s.ay - ey * t);
          const flat = s.w / 2 + 3.5;
          if (dd > flat + 6) continue;
          const up = s.ah + (s.bh - s.ah) * t - 0.15 - Math.max(0, dd - flat) * 0.6;
          if (height[k] >= up) continue;
          // never raised over a lower road close by (the mesh would lean across it)
          let cap = up;
          for (const o of index.grid.query(x, y, 14)) {
            if (o === s || o.st) continue;
            const fx2 = o.bx - o.ax, fy2 = o.by - o.ay, m2 = fx2 * fx2 + fy2 * fy2 || 1e-9;
            const u = Math.max(0, Math.min(1, ((x - o.ax) * fx2 + (y - o.ay) * fy2) / m2));
            const od = Math.hypot(x - o.ax - fx2 * u, y - o.ay - fy2 * u);
            if (od > o.w / 2 + 12) continue;
            const oh = o.ah + (o.bh - o.ah) * u;
            cap = Math.min(cap, oh - 0.15 + Math.max(0, od - o.w / 2 - 2) * 0.2);
          }
          if (height[k] < cap) height[k] = cap;
        }
      }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * d, y = y0 + j * d;
        const g0 = T.at(x, y);
        for (const s of index.grid.query(x, y, 18)) {
          const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2));
          const dist = Math.hypot(x - s.ax - ex * t, y - s.ay - ey * t);
          const reach = s.w / 2 + 16;
          if (dist > reach) continue;
          const sh = s.ah + (s.bh - s.ah) * t;
          if (s.st) continue; // a deck overhead: the ground carries on beneath it
          const target = sh - 0.15 + Math.max(0, dist - (s.w / 2 + 7)) * 0.2;
          if (height[k] > target) height[k] = target;
        }
      }
    // the outermost ring of the mesh slopes down to meet the horizon apron
    let lowest = Infinity;
    for (let i = 0; i < height.length; i++) if (height[i] < lowest) lowest = height[i];
    for (let i = 0; i < nx; i++) height[i] = height[(ny - 1) * nx + i] = lowest - 4;
    for (let j = 0; j < ny; j++) height[j * nx] = height[j * nx + nx - 1] = lowest - 4;
    const colors = GROUND_KEYS.map((k) => new THREE.Color(GROUND[k]));
    const tmp = new THREE.Color();
    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTexture(quality.aniso || 4) });
    groundMat.color.setScalar(TEX_GAIN);
    const H = (i, j) => height[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
    // square tiles so the camera and the sun's shadow camera can skip what they cannot see
    const TILE = 48;
    for (let tj = 0; tj < ny - 1; tj += TILE)
      for (let ti = 0; ti < nx - 1; ti += TILE) {
        const w = Math.min(TILE, nx - 1 - ti) + 1, hgt = Math.min(TILE, ny - 1 - tj) + 1;
        const pos = new Float32Array(w * hgt * 3), col = new Float32Array(w * hgt * 3), nor = new Float32Array(w * hgt * 3), uv = new Float32Array(w * hgt * 2);
        for (let b = 0; b < hgt; b++)
          for (let a = 0; a < w; a++) {
            const i = ti + a, j = tj + b, k = j * nx + i, o = b * w + a;
            const x = x0 + i * d, y = y0 + j * d;
            pos[o * 3] = x; pos[o * 3 + 1] = height[k]; pos[o * 3 + 2] = -y;
            // normal from the height differences (continuous across tiles)
            const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * d), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * d);
            const l = Math.hypot(gx, 1, gy);
            nor[o * 3] = -gx / l; nor[o * 3 + 1] = 1 / l; nor[o * 3 + 2] = gy / l;
            const n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
            tmp.copy(colors[cls[k]]).multiplyScalar(0.94 + (n - Math.floor(n)) * 0.1);
            col[o * 3] = tmp.r; col[o * 3 + 1] = tmp.g; col[o * 3 + 2] = tmp.b;
            uv[o * 2] = x / 16; uv[o * 2 + 1] = y / 16;
          }
        const idx = [];
        for (let b = 0; b < hgt - 1; b++)
          for (let a = 0; a < w - 1; a++) {
            const p = b * w + a, q = p + 1, r = p + w, e = r + 1;
            idx.push(p, q, r, q, e, r);
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const ground = new THREE.Mesh(g, groundMat);
        ground.receiveShadow = true;
        ground.matrixAutoUpdate = false;
        ground.userData.tiled = true;
        ground.userData.ground = true; // (for checks: where the ground shows through a road)
        group.add(ground);
      }
    // a wide apron to the horizon beyond the mapped area
    // (lowest was found above: the apron sits below every street)
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({ color: GROUND.base }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(x0 + (nx * d) / 2, lowest - 4, -(y0 + (ny * d) / 2));
    group.add(apron);
  }

  // ---------- water at its real level, with slowly drifting ripples ----------
  const waterMap = waterTexture(quality.aniso || 4);
  waterMap.repeat.set(1 / 24, 1 / 24);
  const waterMat = new THREE.MeshPhongMaterial({ color: '#3f7d9f', map: waterMap, shininess: 60, specular: '#5f7f93', transparent: true, opacity: 0.93 });
  group.userData.waterMap = waterMap;
  for (const w of world.water) {
    // grow the outline 3 m outwards (each corner moved along its bisector)
    const o = w.o, n = o.length;
    let area = 0;
    for (let a = 0; a < n; a++) area += o[a][0] * o[(a + 1) % n][1] - o[(a + 1) % n][0] * o[a][1];
    const sgn = area > 0 ? -1 : 1; // outward side for this winding
    const grown = o.map((q, a) => {
      const p0 = o[(a + n - 1) % n], p1 = o[(a + 1) % n];
      const t0 = [q[0] - p0[0], q[1] - p0[1]], t1 = [p1[0] - q[0], p1[1] - q[1]];
      const l0 = Math.hypot(...t0) || 1, l1 = Math.hypot(...t1) || 1;
      let nx2 = (t0[1] / l0 + t1[1] / l1) * sgn, ny2 = (-t0[0] / l0 - t1[0] / l1) * sgn;
      const nl = Math.hypot(nx2, ny2) || 1;
      const k = Math.min(3 / Math.max(0.35, nl / 2), 6);
      return new THREE.Vector2(q[0] + (nx2 / nl) * k, q[1] + (ny2 / nl) * k);
    });
    const s = new THREE.Shape(grown);
    for (const hole of w.h || []) s.holes.push(new THREE.Path(hole.map((q) => new THREE.Vector2(q[0], q[1]))));
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, waterMat);
    m.position.y = w.l;
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------- roads ----------
  // junction points: any point shared by two or more roads, plus road ends
  const jcount = new Map();
  const jk = (q) => `${q[0]},${q[1]}`;
  for (const r of world.roads)
    r.p.forEach((q, i) => jcount.set(jk(q), (jcount.get(jk(q)) || 0) + (i === 0 || i === r.p.length - 1 ? 1 : 2)));
  const jGrid = new Map();
  for (const [k, n] of jcount) {
    if (n <= 2) continue;
    const j = k.split(',').map(Number);
    const key = `${Math.floor(j[0] / 30)},${Math.floor(j[1] / 30)}`;
    if (!jGrid.has(key)) jGrid.set(key, []);
    jGrid.get(key).push(j);
  }
  const nearJunction = (x, y, r) => {
    for (let gx = Math.floor((x - r) / 30); gx <= Math.floor((x + r) / 30); gx++)
      for (let gy = Math.floor((y - r) / 30); gy <= Math.floor((y + r) / 30); gy++)
        for (const j of jGrid.get(`${gx},${gy}`) || []) if (Math.hypot(j[0] - x, j[1] - y) < r) return true;
    return false;
  };
  buildRoads(world, group, quality, T, index, nearJunction);

  // ---------- buildings, props, transit, signals, landmarks ----------
  buildBuildings(world, group, quality, T, index);
  buildProps(world, group, quality, T, index);
  buildTransit(world, group, quality, T, index);
  buildStreetLife(world, group, quality, T, index);
  const signalHeads = buildSignals(world.signals, group);
  buildLandmarks(world.landmarks, group, quality, T, world.water);
  buildFamous(world.landmarks, group, quality, T, index); // malls, monuments, temples: real names and architecture

  // fewer draw calls: the many small static pieces (hoardings, sign boards, posts,
  // landmarks, signal poles) that share a material are merged, tile by tile
  mergeByMaterial(group, { tile: 300 });

  return { group, signalHeads };
}

export { uniqueDirs };

const LAMP_ON = { red: new THREE.Color('#ff3b2f'), amber: new THREE.Color('#ffb020'), green: new THREE.Color('#2fe07a') };
const LAMP_OFF = new THREE.Color('#2a2a2a');

function buildSignals(signals, group) {
  const heads = [];
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).translate(0, 1.6, 0);
  const headGeo = new THREE.BoxGeometry(0.38, 1.05, 0.28);
  const lampGeo = new THREE.CircleGeometry(0.13, 12);
  const dark = new THREE.MeshLambertMaterial({ color: '#2b2f33' });
  for (const s of signals) {
    // pole on the left kerb of traffic travelling along `dir`, just before the junction
    const poles = s.poles || uniqueDirs(s.dirs).map((dir) => [s.x - Math.sin(dir) * 4 - Math.cos(dir) * (s.w / 2 + 0.9), s.y - Math.cos(dir) * 4 + Math.sin(dir) * (s.w / 2 + 0.9), dir]);
    for (const [x, y, dir] of poles) {
      const g = new THREE.Group();
      g.position.set(x, s.h, -y);
      g.rotation.y = -dir + Math.PI; // head faces oncoming drivers
      g.add(new THREE.Mesh(poleGeo, dark));
      const head = new THREE.Mesh(headGeo, dark);
      head.position.y = 3.6;
      g.add(head);
      const lamps = {};
      ['red', 'amber', 'green'].forEach((k, i) => {
        const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: LAMP_OFF }));
        m.position.set(0, 3.93 - i * 0.33, -0.145);
        m.rotation.y = Math.PI;
        g.add(m);
        lamps[k] = m.material;
      });
      group.add(g);
      heads.push({ signal: s, dir, lamps, state: null });
    }
  }
  return heads;
}

export function paintSignalHead(head, state) {
  if (head.state === state) return;
  head.state = state;
  for (const k of ['red', 'amber', 'green']) head.lamps[k].color.copy(k === state ? LAMP_ON[k] : LAMP_OFF);
}
