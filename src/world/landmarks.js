import * as THREE from 'three';

const stone = () => new THREE.MeshLambertMaterial({ color: '#d9c7a2', flatShading: true });

function shadowed(obj, on) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = on;
      o.receiveShadow = true;
    }
  });
  return obj;
}

// One facade of the Charminar: a wall with a tall pointed arch cut through it.
function archFace(width, height, archW, archH, depth, mat) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height);
  s.lineTo(-width / 2, height);
  s.lineTo(-width / 2, 0);
  const hole = new THREE.Path();
  const springH = archH * 0.62;
  hole.moveTo(-archW / 2, 0);
  hole.lineTo(-archW / 2, springH);
  hole.quadraticCurveTo(-archW / 2, archH * 0.9, 0, archH);
  hole.quadraticCurveTo(archW / 2, archH * 0.9, archW / 2, springH);
  hole.lineTo(archW / 2, 0);
  hole.lineTo(-archW / 2, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, mat);
}

function minaret(h, r, mat, trim) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 8), mat);
  shaft.position.y = h / 2;
  g.add(shaft);
  for (const y of [h * 0.42, h * 0.62, h * 0.8]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.2, 0.9, 10), trim);
    ring.position.y = y;
    g.add(ring);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.position.y = h;
  dome.scale.y = 1.4;
  g.add(dome);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 2.2, 6), trim);
  tip.position.y = h + r * 1.4 + 1;
  g.add(tip);
  return g;
}

function charminar(x, y, quality) {
  const g = new THREE.Group();
  const mat = stone();
  const trim = new THREE.MeshLambertMaterial({ color: '#c9b48a', flatShading: true });
  const side = 20, baseH = 21;
  for (let i = 0; i < 4; i++) {
    const face = archFace(side, baseH, 11, 17, 2.2, mat);
    const a = (i * Math.PI) / 2;
    face.position.set(Math.sin(a) * (side / 2 - 1.1), 0, Math.cos(a) * (side / 2 - 1.1));
    face.rotation.y = a;
    g.add(face);
  }
  // upper storeys with a band of small arches
  const floor = new THREE.Mesh(new THREE.BoxGeometry(side, 1.2, side), trim);
  floor.position.y = baseH + 0.6;
  g.add(floor);
  for (let i = 0; i < 4; i++) {
    const face = archFace(side - 3, 6, 3, 4.2, 1.2, mat);
    const a = (i * Math.PI) / 2;
    face.position.set(Math.sin(a) * (side / 2 - 2), baseH + 1.2, Math.cos(a) * (side / 2 - 2));
    face.rotation.y = a;
    g.add(face);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(side - 2, 0.8, side - 2), trim);
  roof.position.y = baseH + 7.6;
  g.add(roof);
  const top = new THREE.Mesh(new THREE.BoxGeometry(side - 7, 3, side - 7), mat);
  top.position.y = baseH + 9.5;
  g.add(top);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const m = minaret(50, 1.9, mat, trim);
    m.position.set((sx * side) / 2, 0, (sz * side) / 2);
    g.add(m);
  }
  g.position.set(x, 0, -y);
  g.rotation.y = 0.05;
  return shadowed(g, quality.shadows);
}

function buddha(x, y, quality) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(7, 0), new THREE.MeshLambertMaterial({ color: '#7d7a73', flatShading: true }));
  rock.scale.set(1.4, 0.55, 1.2);
  rock.position.y = 1;
  g.add(rock);
  const white = new THREE.MeshLambertMaterial({ color: '#f3efe6', flatShading: true });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 3, 8), white);
  plinth.position.y = 5;
  g.add(plinth);
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 11, 8), white);
  robe.position.y = 12;
  g.add(robe);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), white);
  shoulders.scale.set(1.15, 0.7, 0.85);
  shoulders.position.y = 17.3;
  g.add(shoulders);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), white);
  head.position.y = 19.4;
  head.scale.y = 1.15;
  g.add(head);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), white);
  bun.position.y = 20.8;
  g.add(bun);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.4), white);
  hand.position.set(1.2, 15.5, -1.4);
  g.add(hand);
  g.position.set(x, 0, -y);
  return shadowed(g, quality.shadows);
}

// One cable-stayed pylon straddling the deck, with cables fanned along the bridge.
function pylon(l, quality) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: '#eceae4', flatShading: true });
  const H = 48, off = l.w / 2 + 1.2;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, H, 2), white);
    leg.position.set(s * off, H / 2, 0);
    g.add(leg);
  }
  for (const y of [l.h - 1.4, H - 6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(off * 2 + 1.6, 1.4, 1.8), white);
    beam.position.y = y;
    g.add(beam);
  }
  const pts = [];
  for (const s of [-1, 1])
    for (let k = 1; k <= 9; k++) {
      const z = k * 7.5;
      for (const along of [-z, z]) pts.push(new THREE.Vector3(s * off, H - 4 - k * 1.2, 0), new THREE.Vector3(s * (l.w / 2 - 0.2), l.h + 0.9, along));
    }
  const cables = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#f5f5f0' }));
  g.add(cables);
  g.position.set(l.x, 0, -l.y);
  g.rotation.y = -l.dir;
  return shadowed(g, quality.shadows);
}

function statue(l) {
  const g = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.5), new THREE.MeshLambertMaterial({ color: '#cfc7b8' }));
  ped.position.y = 1.1;
  g.add(ped);
  const bronze = new THREE.MeshLambertMaterial({ color: '#7a5a34', flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 2, 7), bronze);
  body.position.y = 3.2;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), bronze);
  head.position.y = 4.45;
  g.add(head);
  g.position.set(l.x, 0, -l.y);
  g.rotation.y = -l.dir;
  return g;
}

// Landmarks stand on the real terrain; the Buddha statue's rock rises from the
// lake's water level; pylon heights are measured from their own base.
export function buildLandmarks(list, group, quality, T, water = []) {
  const inPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const l of list) {
    const ground = T ? T.at(l.x, l.y) : 0;
    let obj = null;
    if (l.type === 'charminar') obj = charminar(l.x, l.y, quality);
    else if (l.type === 'buddha') {
      obj = buddha(l.x, l.y, quality);
      const lake = water.find((w) => inPoly(l.x, l.y, w.o));
      obj.position.y = lake ? lake.l - 1 : ground;
      group.add(obj);
      continue;
    } else if (l.type === 'pylon') obj = pylon({ ...l, h: l.h - ground }, quality);
    else if (l.type === 'statue') obj = statue(l);
    if (!obj) continue;
    obj.position.y = ground;
    group.add(obj);
  }
}
