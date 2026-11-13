import * as THREE from 'three';
import { Geo, c3, wallRibbon } from './geo.js';
import { mulberry, mergeColored, m4, addTiled, instancedTiled } from '../util.js';
import { adMat, adTexture } from './ads.js';

export function buildProps(world, group, quality, T, index) {
  const rnd = mulberry(world.id.length * 7919 + 17);
  const dummy = new THREE.Object3D();
  // instanced copies in ground tiles (culled off-screen and outside the shadow box)
  const instanced = (geo, mat, list, place, shadow = true) =>
    instancedTiled(group, geo, mat, list, place, { tile: 200, cast: shadow && quality.shadows });

  // Nothing roadside may stand on a carriageway (flyovers overhead are fine).
  const onCarriageway = (x, y) => {
    const g = T.at(x, y);
    const s = index.surface(x, y, g, 0.15, 6);
    return !!s && s.d < s.seg.w / 2 + 0.15 && s.h - g < 0.8;
  };

  // Props on or beside a footpath stand on the footpath (road level + kerb),
  // not on the raw terrain, so they line up with the street on slopes too.
  const standAt = (x, y) => index.standAt(x, y);

  // ---------- trees: neem, flowering gulmohar, columnar ashoka, palms ----------
  const species = [[], [], [], []];
  for (const t of world.trees) {
    if (onCarriageway(t[0], t[1])) continue;
    const kind = t[3] ?? (rnd() < 0.15 ? 3 : 0);
    species[kind].push({ x: t[0], y: t[1], s: t[2], r: rnd(), g: standAt(t[0], t[1]) });
  }
  const placeTree = (t, d) => {
    d.position.set(t.x, t.g - 0.1, -t.y);
    d.rotation.set(0, t.r * 6.28, 0);
    d.scale.setScalar(t.s * 1.15);
  };
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b5440' });
  const leafMat = () => new THREE.MeshLambertMaterial({ flatShading: true });
  const tint = (mesh, list, colors) => mesh && list.forEach((t, i) => mesh.setColorAt(i, c3(colors[Math.floor(t.r * 997) % colors.length])));
  // neem: a rounded crown of two clumps
  instanced(new THREE.CylinderGeometry(0.14, 0.24, 2.6, 6).translate(0, 1.3, 0), trunkMat, species[0], placeTree);
  const neemA = instanced(new THREE.IcosahedronGeometry(1.8, 0).translate(0.4, 3.7, 0), leafMat(), species[0], placeTree);
  const neemB = instanced(new THREE.IcosahedronGeometry(1.4, 0).translate(-0.7, 3.3, 0.5), leafMat(), species[0], placeTree);
  tint(neemA, species[0], ['#4f7136', '#5f7f3a', '#58763a']);
  tint(neemB, species[0], ['#5f7f3a', '#6b8b3f', '#4f7136']);
  // gulmohar: a wide umbrella canopy, often in bloom
  instanced(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6).translate(0, 1.6, 0), trunkMat, species[1], placeTree);
  const gul = instanced(new THREE.IcosahedronGeometry(1, 0).scale(2.7, 0.9, 2.7).translate(0, 3.9, 0), leafMat(), species[1], placeTree);
  tint(gul, species[1], ['#d9531e', '#c94a1d', '#6b8b3f', '#e0662a', '#5f7f3a']);
  // ashoka: tall and narrow, common on medians and avenues
  instanced(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 5).translate(0, 0.7, 0), trunkMat, species[2], placeTree);
  const ash = instanced(new THREE.ConeGeometry(0.95, 6.5, 7).translate(0, 4.4, 0), leafMat(), species[2], placeTree);
  tint(ash, species[2], ['#2f5a2a', '#355f2d', '#2a5126']);
  // palms
  const placePalm = (t, d) => {
    d.position.set(t.x, t.g - 0.1, -t.y);
    d.rotation.set((t.r - 0.5) * 0.12, t.r * 6.28, (t.r - 0.5) * 0.1);
    d.scale.setScalar(t.s * 1.1);
  };
  instanced(new THREE.CylinderGeometry(0.16, 0.24, 6.5, 6).translate(0, 3.25, 0), new THREE.MeshLambertMaterial({ color: '#8a7559' }), species[3], placePalm);
  instanced(new THREE.ConeGeometry(2.6, 1.3, 8).translate(0, 6.5, 0), new THREE.MeshLambertMaterial({ color: '#5c8a3a', flatShading: true }), species[3], placePalm);

  // ---------- street lights: single-arm on footpaths, double-arm on medians ----------
  const lights = world.lights.filter((l) => !onCarriageway(l[0], l[1])).map((l) => ({ x: l[0], y: l[1], a: l[2], t: l[3] ?? 0, g: standAt(l[0], l[1]) }));
  const single = lights.filter((l) => l.t === 0), double = lights.filter((l) => l.t === 1);
  const pole = new THREE.MeshLambertMaterial({ color: '#8b9197' });
  const lamp = new THREE.MeshLambertMaterial({ color: '#e8e8e2', emissive: '#55524a' });
  // lamp heads in world space, for the night-time glow (see lighting.js)
  group.userData.lampMat = lamp;
  group.userData.lamps = [];
  for (const l of lights) {
    const sa = Math.sin(l.a), ca = Math.cos(l.a);
    if (l.t === 0) group.userData.lamps.push([l.x + 2.05 * sa, l.y + 2.05 * ca, l.g + 8.75]);
    else for (const s2 of [1, -1]) group.userData.lamps.push([l.x + s2 * 1.9 * ca, l.y - s2 * 1.9 * sa, l.g + 9.72]);
  }
  const placeLight = (l, d) => {
    d.position.set(l.x, l.g, -l.y);
    d.rotation.set(0, -l.a, 0);
    d.scale.setScalar(1);
  };
  // single: tapered pole, upswept arm reaching over the road (local -Z)
  instanced(new THREE.CylinderGeometry(0.07, 0.13, 8.5, 8).translate(0, 4.25, 0), pole, single, placeLight);
  instanced(new THREE.BoxGeometry(0.08, 0.08, 1.9).rotateX(-0.25).translate(0, 8.65, -0.9), pole, single, placeLight);
  instanced(new THREE.BoxGeometry(0.32, 0.1, 0.75).translate(0, 8.85, -2.05), lamp, single, placeLight, false);
  // double: taller pole with an arm to each carriageway (local +X and -X)
  instanced(new THREE.CylinderGeometry(0.09, 0.16, 10, 8).translate(0, 5, 0), pole, double, placeLight);
  instanced(new THREE.BoxGeometry(3.6, 0.09, 0.09).translate(0, 9.9, 0), pole, double, placeLight);
  instanced(new THREE.BoxGeometry(0.75, 0.1, 0.32).translate(1.9, 9.82, 0), lamp, double, placeLight, false);
  instanced(new THREE.BoxGeometry(0.75, 0.1, 0.32).translate(-1.9, 9.82, 0), lamp, double, placeLight, false);
  for (const l of lights) index.ring(l.x, l.y, 0.2, l.g + 8, 'post');

  // ---------- advertising hoardings on steel posts ----------
  {
    const board = new THREE.PlaneGeometry(10, 5);
    const back = new THREE.MeshLambertMaterial({ color: '#4f5357' });
    const steel = new THREE.MeshLambertMaterial({ color: '#6d7277' });
    for (const h of world.hoardings || []) {
      if (onCarriageway(h.x, h.y)) continue;
      const g = standAt(h.x, h.y);
      const face = new THREE.Mesh(board, adMat(h.t));
      face.position.set(h.x, g + 9.5, -h.y);
      face.rotation.y = -h.dir + Math.PI; // the printed side faces bearing h.dir
      face.castShadow = quality.shadows;
      const rear = new THREE.Mesh(board, back);
      rear.position.copy(face.position);
      rear.rotation.y = face.rotation.y + Math.PI;
      group.add(face, rear);
      for (const s2 of [-1, 1]) {
        const lx = Math.cos(h.dir) * s2 * 3.5, ly = -Math.sin(h.dir) * s2 * 3.5;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9.5, 8), steel);
        post.position.set(h.x + lx, g + 4.75, -(h.y + ly));
        post.castShadow = quality.shadows;
        group.add(post);
        index.ring(h.x + lx, h.y + ly, 0.3, g + 9, 'post');
      }
    }
  }

  // ---------- U-turn signs at each median opening ----------
  if ((world.uturns || []).length) {
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = '#1f5fa8';
      g.beginPath();
      g.arc(64, 64, 60, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 12;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(44, 100);
      g.lineTo(44, 58);
      g.arc(64, 58, 20, Math.PI, 0);
      g.lineTo(84, 82);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(70, 78);
      g.lineTo(98, 78);
      g.lineTo(84, 100);
      g.fill();
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const signMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const postMat = new THREE.MeshLambertMaterial({ color: '#7d8187' });
    for (const u of world.uturns) {
      for (const sgn of [-1, 1]) {
        // a sign on the median ahead of the gap for each direction of traffic
        const fx = Math.sin(u.dir) * sgn, fy = Math.cos(u.dir) * sgn;
        const x = u.x - fx * 12, y = u.y - fy * 12;
        const g = Math.max(u.h, T.at(x, y)) + 0.24;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), postMat);
        post.position.set(x, g + 1.1, -y);
        const sign = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), signMat);
        sign.position.set(x, g + 2.3, -y);
        sign.rotation.y = -Math.atan2(fx, fy); // faces the drivers approaching it
        group.add(post, sign);
      }
    }
  }

  // ---------- granite boulders (Deccan tors) and scrub ----------
  const rockCols = ['#8d867a', '#9a9285', '#7e786f', '#a39b8d'].map(c3);
  const rocks = (world.rocks || []).filter((r) => !onCarriageway(r[0], r[1])).map((r) => ({ x: r[0], y: r[1], s: r[2], r: rnd(), q: rnd(), g: T.at(r[0], r[1]) }));
  const rockMesh = instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rocks, (r, d) => {
    d.position.set(r.x, r.g + r.s * 0.35, -r.y);
    d.rotation.set(r.q * 3, r.r * 6.28, r.q * 1.7);
    d.scale.set(r.s * (0.9 + r.q * 0.4), r.s * (0.65 + r.r * 0.3), r.s);
  });
  if (rockMesh) rocks.forEach((r, i) => rockMesh.setColorAt(i, rockCols[Math.floor(r.r * 4) % 4]));
  const shrubs = (world.shrubs || []).filter((r) => !onCarriageway(r[0], r[1])).map((s) => ({ x: s[0], y: s[1], s: s[2], r: rnd(), g: T.at(s[0], s[1]) }));
  const shrubMesh = instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), shrubs, (s, d) => {
    d.position.set(s.x, s.g + s.s * 0.35, -s.y);
    d.rotation.set(0, s.r * 6.28, 0);
    d.scale.set(s.s * 1.2, s.s * 0.8, s.s);
  });
  if (shrubMesh) shrubs.forEach((s, i) => shrubMesh.setColorAt(i, c3(['#6f7a3e', '#7d8547', '#5f6d36'][Math.floor(s.r * 3)])));

  // ---------- compound walls and fences ----------
  const wallGeo = new Geo();
  for (const w of world.walls || []) {
    const pts = w.p.map((q) => [q[0], q[1]]);
    const base = (q) => T.at(q[0], q[1]) - 0.4;
    const top = (q) => T.at(q[0], q[1]) + w.ht;
    if (w.k === 1) wallRibbon(wallGeo, pts, base, top, c3('#4f5b55'), null, 0.04);
    else wallRibbon(wallGeo, pts, base, top, c3('#d9cdb3'), c3('#b9ac93'), 0.23);
  }
  if (!wallGeo.empty) addTiled(group, wallGeo.build(), new THREE.MeshLambertMaterial({ vertexColors: true }), { tile: 250, cast: quality.shadows, cull: 600 });

  // ---------- bus shelters and petrol pumps ----------
  const parts = [];
  for (const b of world.busStops || []) {
    if (onCarriageway(b.x, b.y)) continue;
    const g = standAt(b.x, b.y);
    const o = (lx, ly, lz) => {
      // local (x along the kerb, y up, z away from the road) -> world
      const fx = Math.sin(b.dir), fy = Math.cos(b.dir), rx = Math.cos(b.dir), ry = -Math.sin(b.dir);
      return [b.x + rx * lx + fx * lz, b.y + ry * lx + fy * lz, g + ly];
    };
    const at = (lx, ly, lz, geo, color) => {
      const q = o(lx, ly, lz);
      parts.push({ geo, color, matrix: m4(q[0], q[2], -q[1], 0, -b.dir, 0) });
    };
    for (const lx of [-1.9, 1.9]) for (const lz of [-0.7, 0.7]) at(lx, 1.3, lz, new THREE.BoxGeometry(0.08, 2.6, 0.08), '#9aa0a6');
    at(0, 2.65, 0, new THREE.BoxGeometry(4.3, 0.12, 1.9), '#b8352a');
    at(0, 1.5, 0.72, new THREE.BoxGeometry(3.9, 1.6, 0.04), '#d9dde0');
    at(0, 0.48, 0.4, new THREE.BoxGeometry(3.4, 0.08, 0.45), '#6d6f73');
    at(2.6, 1.3, -0.9, new THREE.BoxGeometry(0.06, 2.6, 0.06), '#9aa0a6');
    at(2.6, 2.5, -0.9, new THREE.BoxGeometry(0.5, 0.35, 0.04), '#1f5fa8');
  }
  const brands = [['#f37021', '#1b3f8b'], ['#1d4f9c', '#d71920'], ['#0b8a3b', '#f5d300']];
  (world.fuel || []).forEach((f, n) => {
    if (onCarriageway(f.x, f.y)) return;
    const g = T.at(f.x, f.y);
    const [main, trim] = brands[n % brands.length];
    const at = (lx, ly, lz, geo, color) => {
      const rx = Math.cos(f.dir), ry = -Math.sin(f.dir), fx = Math.sin(f.dir), fy = Math.cos(f.dir);
      const x = f.x + rx * lx + fx * lz, y = f.y + ry * lx + fy * lz;
      parts.push({ geo, color, matrix: m4(x, g + ly, -y, 0, -f.dir, 0) });
      return [x, y];
    };
    for (const lx of [-4.5, 4.5]) for (const lz of [-2.5, 2.5]) {
      const q = at(lx, 2.6, lz, new THREE.BoxGeometry(0.45, 5.2, 0.45), '#e8e8e4');
      index.ring(q[0], q[1], 0.35, g + 5, 'post');
    }
    at(0, 5.35, 0, new THREE.BoxGeometry(14, 0.5, 8), '#f4f4f0');
    at(0, 5.1, 0, new THREE.BoxGeometry(14.2, 0.6, 8.2), main);
    for (const lx of [-3, 3]) {
      at(lx, 0.15, 0, new THREE.BoxGeometry(1.2, 0.3, 4), '#bfbab0');
      at(lx, 0.95, 0, new THREE.BoxGeometry(0.6, 1.3, 0.5), trim);
    }
    const q = at(0, 3.5, -10, new THREE.BoxGeometry(0.4, 7, 0.4), '#d9d9d9');
    index.ring(q[0], q[1], 0.3, g + 7, 'post');
    at(0, 6.4, -10, new THREE.BoxGeometry(1.8, 1.8, 0.3), main);
    at(0, 4.9, -10, new THREE.BoxGeometry(1.6, 1.2, 0.32), '#141414');
  });
  if (parts.length) addTiled(group, mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }), { tile: 250, cast: quality.shadows, cull: 600 });
}
