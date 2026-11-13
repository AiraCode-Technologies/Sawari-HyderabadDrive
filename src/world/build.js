import * as THREE from 'three';
import { buildLandmarks } from './landmarks.js';
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
    // tuck the ground just under every ground-level road and its footpaths
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * d, y = y0 + j * d;
        const s = index.surface(x, y, height[k], 9, 12);
        if (!s) continue;
        const lift = s.h - T.at(x, y);
        if (lift > 0.8) continue;
        const edge = s.seg.w / 2 + 3.5;
        const target = s.h - 0.25 + Math.max(0, s.d - edge) * 0.5;
        if (height[k] > target) height[k] = target;
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
  const waterMat = new THREE.MeshPhongMaterial({ color: '#3f7d9f', map: waterMap, shininess: 90, specular: '#a9cde3', transparent: true, opacity: 0.93 });
  group.userData.waterMap = waterMap;
  for (const w of world.water) {
    const s = new THREE.Shape(w.o.map((q) => new THREE.Vector2(q[0], q[1])));
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
