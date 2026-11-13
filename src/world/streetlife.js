import * as THREE from 'three';
import { mergeColored, m4, addTiled } from '../util.js';
import { buildParkedCatalogue } from '../vehicles.js';
import { TELUGU_FONT } from './ads.js';
import { KERB, ROAD_TOP } from './roadIndex.js';

// Copies of vertex-coloured geometries, each with its own transform, in one mesh.
function mergePlaced(items) {
  let count = 0;
  for (const it of items) count += it.geo.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  let o = 0;
  for (const { geo, matrix } of items) {
    nm.getNormalMatrix(matrix);
    const p = geo.attributes.position, q = geo.attributes.normal, c = geo.attributes.color;
    for (let i = 0; i < p.count; i++, o++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      n.fromBufferAttribute(q, i).applyMatrix3(nm).normalize();
      pos.set([v.x, v.y, v.z], o * 3);
      nor.set([n.x, n.y, n.z], o * 3);
      col.set([c.getX(i), c.getY(i), c.getZ(i)], o * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// Handcarts and stalls, built in local space (front = -Z).
function stallGeo(type) {
  const parts = [];
  const wood = '#8a5a35';
  const wheel = (x, z, r = 0.32) => parts.push({ geo: new THREE.CylinderGeometry(r, r, 0.05, 12), color: '#2a2a2a', matrix: m4(x, r, z, 0, 0, Math.PI / 2) });
  if (type === 0 || type === 2) {
    // fruit cart / coconut cart with an umbrella
    parts.push({ geo: new THREE.BoxGeometry(1.0, 0.12, 1.8), color: wood, matrix: m4(0, 0.85, 0) });
    for (const x of [-0.45, 0.45]) for (const z of [-0.6, 0.6]) wheel(x * 1.1, z);
    if (type === 0) {
      const fruit = ['#e74c3c', '#f1c40f', '#27ae60', '#e67e22'];
      for (let i = 0; i < 4; i++) parts.push({ geo: new THREE.SphereGeometry(0.45, 7, 5), color: fruit[i], matrix: m4(0, 0.95, -0.65 + i * 0.43, 0, 0, 0, 1, 0.5, 0.9) });
    } else {
      for (let i = 0; i < 9; i++) parts.push({ geo: new THREE.SphereGeometry(0.17, 7, 5), color: '#4f8a2f', matrix: m4(-0.3 + (i % 3) * 0.3, 1.05 + Math.floor(i / 6) * 0.2, -0.5 + Math.floor(i / 3) * 0.4) });
    }
    parts.push({ geo: new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), color: '#555', matrix: m4(0.4, 1.7, 0.6) });
    parts.push({ geo: new THREE.ConeGeometry(1.2, 0.45, 8), color: ['#c0392b', '#2e86c1', '#f1c40f'][type % 3], matrix: m4(0.4, 2.55, 0.6) });
  } else if (type === 1) {
    // tea stall: a small kiosk with a blue tarpaulin roof
    parts.push({ geo: new THREE.BoxGeometry(1.6, 1.1, 1.2), color: '#c9b48a', matrix: m4(0, 0.55, 0) });
    parts.push({ geo: new THREE.BoxGeometry(1.7, 0.08, 1.3), color: '#7a5a3a', matrix: m4(0, 1.12, 0) });
    for (const x of [-0.75, 0.75]) parts.push({ geo: new THREE.BoxGeometry(0.06, 1.2, 0.06), color: '#666', matrix: m4(x, 1.7, -0.6) });
    parts.push({ geo: new THREE.BoxGeometry(2.0, 0.06, 1.8), color: '#2e6da4', matrix: m4(0, 2.3, -0.3, 0.12) });
    parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.14, 0.25, 10), color: '#b9bec3', matrix: m4(-0.4, 1.28, 0) });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 0.35, 0.05), color: '#f1c40f', matrix: m4(0, 2.05, -0.62) });
  } else if (type === 4) {
    // flower and pooja-items stall outside a temple: marigold garlands, a low counter
    parts.push({ geo: new THREE.BoxGeometry(1.8, 0.8, 1.0), color: '#8a5a35', matrix: m4(0, 0.4, 0) });
    for (let i = 0; i < 6; i++) parts.push({ geo: new THREE.TorusGeometry(0.16, 0.06, 6, 10), color: i % 2 ? '#f39c12' : '#f1c40f', matrix: m4(-0.65 + i * 0.26, 0.86, 0, Math.PI / 2) });
    parts.push({ geo: new THREE.BoxGeometry(2.0, 0.06, 1.4), color: '#c0392b', matrix: m4(0, 2.1, -0.2, 0.1) });
    for (const x of [-0.85, 0.85]) parts.push({ geo: new THREE.BoxGeometry(0.06, 1.3, 0.06), color: '#666', matrix: m4(x, 1.45, -0.55) });
    for (let i = 0; i < 4; i++) parts.push({ geo: new THREE.TorusGeometry(0.22, 0.05, 6, 12), color: '#f39c12', matrix: m4(-0.6 + i * 0.4, 1.75, -0.6) });
  } else {
    // street food cart with a glass case
    parts.push({ geo: new THREE.BoxGeometry(1.0, 0.9, 1.7), color: '#c0392b', matrix: m4(0, 0.75, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.95, 0.45, 1.2), color: '#bcd6e3', matrix: m4(0, 1.42, 0.15) });
    parts.push({ geo: new THREE.BoxGeometry(1.05, 0.06, 1.75), color: '#e6e6e6', matrix: m4(0, 1.67, 0) });
    for (const z of [-0.55, 0.55]) wheel(0.55, z, 0.28);
    for (const z of [-0.55, 0.55]) wheel(-0.55, z, 0.28);
  }
  return mergeColored(parts);
}

export function buildStreetLife(world, group, quality, T, index) {
  const items = [];
  // stalls and parked two-wheelers never stand on a carriageway (flyovers overhead excepted)
  const onCarriageway = (x, y, margin) => {
    const g = T.at(x, y);
    const s = index.surface(x, y, g, margin, 6);
    return !!s && s.d < s.seg.w / 2 + margin && s.h - g < 0.8;
  };
  const parked = world.parked || [];
  if (parked.length) {
    const cat = buildParkedCatalogue();
    for (const p of parked) {
      const bike = p.t < 55;
      const ground = index.standAt(p.x, p.y);
      if (bike) {
        if (onCarriageway(p.x, p.y, 0.3)) continue;
        // two-wheelers stand at an angle to the kerb
        const geo = cat.bikes[p.t % cat.bikes.length];
        const ang = p.dir + (p.side > 0 ? 1 : -1) * 1.1;
        items.push({ geo, matrix: m4(p.x, ground + 0.06, -p.y, 0, -ang, 0) });
        index.ring(p.x, p.y, 0.45, ground + 1.2, 'post');
      } else {
        const v = cat.cars[p.t % cat.cars.length];
        // half up on the footpath: tilted slightly towards the road
        // half up on a kerbed footpath: the car sits between the two levels, tilted towards the road
        const s = index.surface(p.x, p.y, T.at(p.x, p.y), 3, 6);
        const kerbed = s && s.road.kerb && s.d > s.seg.w / 2 - 1;
        const hCar = kerbed ? s.h + ROAD_TOP + KERB * 0.5 : ground;
        items.push({ geo: v.geo, matrix: m4(p.x, hCar, -p.y, 0, -p.dir, (p.side > 0 ? -1 : 1) * (kerbed ? 0.09 : 0.03)) });
        const fx = Math.sin(p.dir), fy = Math.cos(p.dir);
        for (const o of [-v.length / 3, 0, v.length / 3]) index.ring(p.x + fx * o, p.y + fy * o, v.width / 2, ground + 1.4, 'post');
      }
    }
  }
  const stallGeos = [0, 1, 2, 3, 4].map(stallGeo);
  // a small painted board on each stall, Telugu above English
  const BOARDS = [['పండ్లు', 'Fresh Fruits', '#1e8449'], ['టీ స్టాల్', 'Tea & Snacks', '#2e6da4'], ['కొబ్బరి బొండాలు', 'Coconut Water', '#7d6608'], ['టిఫిన్స్', 'Tiffins & Chaat', '#b03a2e'], ['పూలు', 'Flowers & Pooja', '#c0392b']];
  const boardMats = BOARDS.map(([te, en, bg]) => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 34px ${TELUGU_FONT}`;
    g.fillText(te, 128, 34);
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText(en, 128, 74);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: t });
  });
  const boardGeo = new THREE.PlaneGeometry(1.3, 0.5);
  for (const s of world.stalls || []) {
    if (onCarriageway(s.x, s.y, 0.8)) continue;
    const g = index.standAt(s.x, s.y);
    // readable from both directions along the street
    for (const flip of [0, Math.PI]) {
      const b = new THREE.Mesh(boardGeo, boardMats[s.t % 5]);
      b.position.set(s.x, g + 2.05, -s.y);
      b.rotation.y = -s.dir + flip;
      group.add(b);
    }
    items.push({ geo: stallGeos[s.t % 5], matrix: m4(s.x, g, -s.y, 0, -s.dir, 0) });
    index.ring(s.x, s.y, 0.8, g + 2, 'post');
  }
  if (!items.length) return;
  // parked vehicles and stalls: tiled and hidden beyond a few hundred metres
  addTiled(group, mergePlaced(items), new THREE.MeshLambertMaterial({ vertexColors: true }), { tile: 200, cast: quality.shadows, cull: 320 });
}
