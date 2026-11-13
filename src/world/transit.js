import * as THREE from 'three';
import { Geo, UP, c3, P, sampleAlong, polyLen } from './geo.js';
import { mergeColored, m4, addTiled } from '../util.js';

// Hyderabad Metro viaducts on single piers, at-grade railway, and metro stations.
export function buildTransit(world, group, quality, T, index) {
  const deck = new Geo(), track = new Geo();
  const piers = [];
  const cConc = c3('#cdc8be'), cConcDark = c3('#a39e95'), cRail = c3('#3b3d40'), cBallast = c3('#7c7264');

  for (const line of world.rails || []) {
    const pts = line.p;
    if (pts.length < 2) continue;
    const metro = line.k === 'metro';
    if (line.e) {
      const hw = metro ? 4.3 : 3.2; // twin-track U-girder
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        const L = (q, o, h) => P(q[0] + nx * o, q[1] + ny * o, h);
        deck.quad(L(a, hw, a[2]), L(a, -hw, a[2]), L(b, -hw, b[2]), L(b, hw, b[2]), cConc, null, UP);
        deck.quad(L(a, hw, a[2] - 1.8), L(b, hw, b[2] - 1.8), L(b, -hw, b[2] - 1.8), L(a, -hw, a[2] - 1.8), cConcDark, null, [0, -1, 0]);
        for (const s of [1, -1]) {
          const out = [nx * s, 0, -ny * s];
          deck.quad(L(a, hw * s, a[2] - 1.8), L(b, hw * s, b[2] - 1.8), L(b, hw * s, b[2] + 1.0), L(a, hw * s, a[2] + 1.0), cConc, null, out);
          deck.quad(L(a, (hw - 0.25) * s, a[2]), L(b, (hw - 0.25) * s, b[2]), L(b, (hw - 0.25) * s, b[2] + 1.0), L(a, (hw - 0.25) * s, a[2] + 1.0), cConcDark, null, [-out[0], 0, -out[2]]);
          deck.quad(L(a, (hw - 0.25) * s, a[2] + 1.0), L(b, (hw - 0.25) * s, b[2] + 1.0), L(b, hw * s, b[2] + 1.0), L(a, hw * s, a[2] + 1.0), cConc, null, UP);
        }
        for (const o of metro ? [-2.55, -0.95, 0.95, 2.55] : [-0.75, 0.75])
          track.quad(L(a, o - 0.04, a[2] + 0.22), L(a, o + 0.04, a[2] + 0.22), L(b, o + 0.04, b[2] + 0.22), L(b, o - 0.04, b[2] + 0.22), cRail, null, UP);
      }
      const len = polyLen(pts);
      for (let s = 14; s < len - 6; s += 28) {
        const q = sampleAlong(pts, s);
        const g = T.at(q.x, q.y);
        if (q.h - g > 4) {
          piers.push({ ...q, g, metro });
          index.ring(q.x, q.y, 1.1, q.h - 2, 'post');
        }
      }
    } else {
      // at-grade railway: ballast bed and rails on the ground
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        const ga = T.at(a[0], a[1]) + 0.18, gb = T.at(b[0], b[1]) + 0.18;
        const L = (q, o, h) => P(q[0] + nx * o, q[1] + ny * o, h);
        track.quad(L(a, 1.7, ga), L(a, -1.7, ga), L(b, -1.7, gb), L(b, 1.7, gb), cBallast, null, UP);
        for (const o of [-0.75, 0.75]) track.quad(L(a, o - 0.04, ga + 0.12), L(a, o + 0.04, ga + 0.12), L(b, o + 0.04, gb + 0.12), L(b, o - 0.04, gb + 0.12), cRail, null, UP);
      }
    }
  }
  const add = (geo, mat) => {
    if (geo.empty) return;
    addTiled(group, geo.build(), mat, { tile: 200, cast: quality.shadows });
  };
  add(deck, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  add(track, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 }));

  // piers with a crosshead under the deck
  const parts = [];
  for (const q of piers) {
    const hgt = q.h - 1.8 - q.g + 0.5;
    parts.push({ geo: new THREE.CylinderGeometry(1.0, 1.1, hgt, 12), color: '#c9c4ba', matrix: m4(q.x, q.g - 0.5 + hgt / 2, -q.y) });
    parts.push({ geo: new THREE.BoxGeometry(q.metro ? 7 : 5, 1.4, 2.4), color: '#bdb8ae', matrix: m4(q.x, q.h - 2.5, -q.y, 0, -q.dir, 0) }); // across the track
  }

  // railway (MMTS) stations: long low platforms beside the tracks, a shelter, name boards
  for (const s of world.stations || []) {
    if (s.k !== 'rail') continue;
    const fx = Math.sin(s.dir), fy = Math.cos(s.dir), rx = Math.cos(s.dir), ry = -Math.sin(s.dir);
    const at = (along, lat, h, geo, color) => parts.push({ geo, color, matrix: m4(s.x + fx * along + rx * lat, h, -(s.y + fy * along + ry * lat), 0, -s.dir, 0) });
    s.pl.forEach((off, n) => {
      const L = s.pll ? s.pll[n] : 90;
      const out = Math.sign(off); // the side away from the tracks
      at(0, off, s.h + 0.45, new THREE.BoxGeometry(4, 0.9, L), '#c9c2b4');
      at(0, off - out * 1.85, s.h + 0.91, new THREE.BoxGeometry(0.3, 0.03, L), '#e8c21a'); // yellow edge line
      at(0, off + out * 0.4, s.h + 3.7, new THREE.BoxGeometry(4.6, 0.25, Math.min(36, L - 4)), '#7b8a93'); // shelter roof
      for (let along = -16; along <= 16; along += 8) {
        at(along, off + out * 1.6, s.h + 2.3, new THREE.BoxGeometry(0.22, 2.8, 0.22), '#55606a');
        index.ring(s.x + fx * along + rx * (off + out * 1.6), s.y + fy * along + ry * (off + out * 1.6), 0.3, s.h + 3.7, 'post');
      }
      for (const along of [-L / 3, L / 3]) for (const w of [-0.9, 0.9]) at(along + w, off, s.h + 1.9, new THREE.BoxGeometry(0.12, 2, 0.12), '#3a3f44'); // name board legs
    });
  }

  // metro stations: a concourse over the road with a curved roof and name boards
  for (const s of world.stations || []) {
    if (s.k === 'rail') continue;
    const fx = Math.sin(s.dir), fy = Math.cos(s.dir), rx = Math.cos(s.dir), ry = -Math.sin(s.dir);
    const g = T.at(s.x, s.y);
    const rot = -s.dir;
    const at = (along, lat, h, geo, color, extra = 0) =>
      parts.push({ geo, color, matrix: m4(s.x + fx * along + rx * lat, h, -(s.y + fy * along + ry * lat), 0, rot + extra, 0) });
    at(0, 0, s.h - 6.5, new THREE.BoxGeometry(24, 5, 120), '#ece9e2');
    at(0, 0, s.h - 4.2, new THREE.BoxGeometry(24.2, 0.6, 120.2), '#1d6fb8');
    at(0, 0, s.h + 0.2, new THREE.BoxGeometry(22, 0.4, 116), '#d9d5cc');
    for (const lat of [-10.5, 10.5]) at(0, lat, s.h + 2.6, new THREE.BoxGeometry(0.4, 4.6, 116), '#bfc6cc');
    const roof = new THREE.CylinderGeometry(12.5, 12.5, 118, 20, 1, true, -Math.PI / 2, Math.PI);
    roof.rotateX(-Math.PI / 2); // upper half, axis along the platform
    roof.scale(1, 0.32, 1);
    at(0, 0, s.h + 4.8, roof, '#f2f2ef');
    for (const along of [-45, -15, 15, 45])
      for (const lat of [-7, 7]) {
        const hgt = s.h - 9 - g + 0.5;
        if (hgt > 1) {
          at(along, lat, g - 0.5 + hgt / 2, new THREE.BoxGeometry(1.4, hgt, 1.4), '#cfcac0');
          index.ring(s.x + fx * along + rx * lat, s.y + fy * along + ry * lat, 0.9, s.h - 9, 'post');
        }
      }
  }
  if (parts.length) {
    const m = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = quality.shadows;
    m.receiveShadow = true;
    group.add(m);
  }
  // railway station name boards: yellow with black lettering, at both ends of each platform
  for (const s of world.stations || []) {
    if (s.k !== 'rail' || !s.n) continue;
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 128;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#f2c414';
    g2.fillRect(0, 0, 512, 128);
    g2.strokeStyle = '#111';
    g2.lineWidth = 6;
    g2.strokeRect(4, 4, 504, 120);
    g2.fillStyle = '#111';
    g2.font = 'bold 50px sans-serif';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.fillText(s.n.toUpperCase(), 256, 66);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
    const fx = Math.sin(s.dir), fy = Math.cos(s.dir), rx = Math.cos(s.dir), ry = -Math.sin(s.dir);
    s.pl.forEach((off, n) => {
      const L = s.pll ? s.pll[n] : 90;
      for (const along of [-L / 3, L / 3]) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), mat);
        plane.position.set(s.x + fx * along + rx * off, s.h + 3.2, -(s.y + fy * along + ry * off));
        plane.rotation.y = -s.dir + Math.PI / 2; // faces across the tracks, readable from the train and the road
        group.add(plane);
      }
    });
  }
  // metro station name boards on both long sides
  for (const s of world.stations || []) {
    if (s.k === 'rail' || !s.n) continue;
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 64;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#1d6fb8';
    g2.fillRect(0, 0, 512, 64);
    g2.fillStyle = '#fff';
    g2.font = 'bold 34px sans-serif';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.fillText(`Ⓜ ${s.n}`, 256, 34);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: t });
    for (const side of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), mat);
      const rx = Math.cos(s.dir), ry = -Math.sin(s.dir);
      plane.position.set(s.x + rx * 12.25 * side, s.h - 6.2, -(s.y + ry * 12.25 * side));
      plane.rotation.y = -s.dir + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      group.add(plane);
    }
  }
}
