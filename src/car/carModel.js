import * as THREE from 'three';
import { mergeByMaterial } from '../util.js';

// Car local frame: forward = -Z, right = +X, up = +Y, origin on the ground
// midway between the axles. Right-hand drive (Indian layout).
export const CAR = { length: 4.3, width: 1.78, wheelbase: 2.6, track: 1.52, wheelR: 0.32, eye: new THREE.Vector3(0.37, 1.14, 0.32) };

// Extrude a side profile (shape x = forward, y = up) across the car's width.
function profileMesh(shape, width, mat, bevel = 0.05, segs = 3) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel, // keep the outline where the profile is drawn
    bevelSegments: segs,
    curveSegments: 14,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape +x (forward) -> -z
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// Nose and bonnet, from the bumper to the base of the windscreen.
function noseCurve(s) {
  s.quadraticCurveTo(2.29, 0.52, 2.21, 0.67);
  s.quadraticCurveTo(2.14, 0.77, 1.88, 0.8);
  s.quadraticCurveTo(1.32, 0.87, 0.96, 0.92);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Telangana registration plate.
function plateTexture(text) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#f7f7f2';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 4;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#1d4fa0';
    g.fillRect(6, 6, 22, h - 12);
    g.fillStyle = '#fff';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.fillText('IND', 17, h - 12);
    g.fillStyle = '#111';
    g.font = 'bold 36px "Arial Narrow", Arial, sans-serif';
    g.fillText(text, 142, 45);
  });
}

function grilleTexture() {
  const t = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#0b0c0e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3d42';
    g.lineWidth = 2;
    const r = 7;
    for (let y = 0, row = 0; y < h + r; y += r * 1.5, row++)
      for (let x = row % 2 ? r * 0.87 : 0; x < w + r; x += r * 1.74) {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
        }
        g.closePath();
        g.stroke();
      }
  });
  return t;
}

// Tyre with a rounded sidewall, five twin-spoke alloy, brake disc and calliper.
// `side` is -1 for left wheels, +1 for right, so the spoke face points outwards.
function wheel(mats, side, front) {
  const spin = new THREE.Group();
  const R = CAR.wheelR;
  const profile = [
    [0.212, -0.108], [0.285, -0.114], [0.31, -0.104], [R, -0.07], [R + 0.003, 0], [R, 0.07], [0.31, 0.104], [0.285, 0.114], [0.212, 0.108],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), mats.tyre);
  tyre.rotation.z = Math.PI / 2;
  spin.add(tyre);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.214, 0.214, 0.2, 24, 1, true), mats.rimInner);
  barrel.rotation.z = Math.PI / 2;
  spin.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.208, 0.012, 6, 28), mats.rim);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = side * 0.1;
  spin.add(lip);
  for (let k = 0; k < 5; k++) {
    for (const off of [-0.11, 0.11]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.026), mats.rim);
      const a = (k * Math.PI * 2) / 5 + off;
      spoke.position.set(side * 0.095, Math.cos(a) * 0.125, Math.sin(a) * 0.125);
      spoke.rotation.x = a; // long axis radial
      spin.add(spoke);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.03, 16), mats.rim);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = side * 0.1;
  spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16), mats.gloss);
  cap.rotation.z = Math.PI / 2;
  cap.position.x = side * 0.117;
  spin.add(cap);
  const steer = new THREE.Group();
  steer.add(spin);
  // brake disc and calliper do not spin
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.025, 24), mats.disc);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = side * 0.03;
  steer.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.09), mats.caliper);
  caliper.position.set(side * 0.05, 0.1, front ? 0.08 : -0.08);
  steer.add(caliper);
  return { steer, spin };
}

function shadowBlob() {
  const tex = canvasTexture(128, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 5.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.08;
  m.renderOrder = 1;
  return m;
}

export function createCarModel(color = '#c8202a') {
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts with pitch/roll; wheels stay level-ish
  root.add(body);

  // ---- materials (PBR, so the paint and glass pick up the sky reflection)
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
  const gloss = new THREE.MeshPhysicalMaterial({ color: '#0c0d0f', metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const plastic = new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.75 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#eceef0', metalness: 1, roughness: 0.12 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0f1820', metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.8, envMapIntensity: 1.5 });
  const mats = {
    tyre: new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: '#cfd3d8', metalness: 0.9, roughness: 0.22 }),
    rimInner: new THREE.MeshStandardMaterial({ color: '#5b6066', metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: '#8c8f93', metalness: 0.9, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: '#c41e1e', roughness: 0.4 }),
    gloss,
  };
  const W = CAR.width;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    body.add(m);
    return m;
  };

  // ---- body shell: curved nose, rising beltline, rounded tail, wheel arches
  const lower = new THREE.Shape();
  lower.moveTo(2.12, 0.27);
  lower.lineTo(2.2, 0.38);
  noseCurve(lower);
  lower.lineTo(-1.52, 0.98);
  lower.quadraticCurveTo(-2.02, 1.0, -2.16, 0.9);
  lower.quadraticCurveTo(-2.25, 0.7, -2.2, 0.45);
  lower.lineTo(-2.12, 0.27);
  lower.lineTo(-1.75, 0.27);
  lower.absarc(-1.3, 0.3, 0.45, Math.PI + 0.07, -0.07, true);
  lower.lineTo(0.85, 0.27);
  lower.absarc(1.3, 0.3, 0.45, Math.PI + 0.07, -0.07, true);
  lower.lineTo(2.12, 0.27);
  const lowerMesh = profileMesh(lower, W, paint, 0.12, 4);
  body.add(lowerMesh);

  // From the driver's seat the solid body would fill the cabin, so the cockpit
  // view swaps it for just the bonnet ahead of the windscreen.
  const bonnet = new THREE.Shape();
  bonnet.moveTo(0.9, 0.55);
  bonnet.lineTo(2.2, 0.38);
  noseCurve(bonnet);
  bonnet.lineTo(0.9, 0.92);
  const bonnetMesh = profileMesh(bonnet, W, paint, 0.12, 4);
  bonnetMesh.visible = false;
  body.add(bonnetMesh);

  // ---- glasshouse: tinted glass with a body-coloured roof and black pillars
  const cabin = new THREE.Shape();
  cabin.moveTo(0.98, 0.9);
  cabin.lineTo(0.22, 1.37);
  cabin.quadraticCurveTo(-0.35, 1.47, -0.98, 1.39);
  cabin.quadraticCurveTo(-1.35, 1.2, -1.6, 0.97);
  cabin.lineTo(0.98, 0.9);
  const cabinMesh = profileMesh(cabin, W - 0.24, glass, 0.06, 3);
  body.add(cabinMesh);
  const roofShape = new THREE.Shape();
  roofShape.moveTo(0.26, 1.385);
  roofShape.quadraticCurveTo(-0.35, 1.495, -0.95, 1.415);
  roofShape.lineTo(-0.93, 1.37);
  roofShape.quadraticCurveTo(-0.35, 1.445, 0.24, 1.34);
  roofShape.lineTo(0.26, 1.385);
  body.add(profileMesh(roofShape, W - 0.2, paint, 0.03, 2));
  const pillar = (ax, ay, bx, by, z0) => {
    // a black pillar strip along the glass between two profile points
    const a = new THREE.Vector3(z0, ay, -ax), b = new THREE.Vector3(z0, by, -bx);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, len, 0.08), gloss);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    body.add(m);
  };
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.1);
    pillar(0.96, 0.92, 0.24, 1.36, x); // A
    pillar(-0.16, 0.95, -0.2, 1.42, x); // B
    pillar(-1.56, 0.99, -0.96, 1.39, x); // C
    // chrome window line
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 2.5), chrome);
    belt.position.set(s * (W / 2 - 0.085), 0.955, 0.3);
    belt.rotation.x = -0.024;
    body.add(belt);
  }

  // ---- sides: door shut lines, handles, skirts, arch trims and liners
  const seamMat = new THREE.MeshBasicMaterial({ color: '#141414' });
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.003);
    for (const z of [-0.88, 0.18, 1.32]) add(new THREE.BoxGeometry(0.01, 0.56, 0.008), seamMat, x, 0.66, z, 0.06);
    for (const z of [-0.33, 0.78]) add(new THREE.BoxGeometry(0.03, 0.03, 0.17), chrome, s * (W / 2 + 0.012), 0.84, z);
    add(new THREE.BoxGeometry(0.06, 0.08, 1.7), plastic, s * (W / 2 - 0.01), 0.31, -0.02);
    for (const z of [-1.3, 1.3]) {
      const trim = add(new THREE.TorusGeometry(0.47, 0.03, 5, 18, Math.PI), plastic, s * (W / 2 - 0.02), 0.3, z, 0, Math.PI / 2);
      trim.scale.set(1, 1, 1.4);
      const liner = add(new THREE.CylinderGeometry(0.44, 0.44, W - 0.08, 16, 1, true, 0, Math.PI), plastic, 0, 0.3, z, 0, 0, Math.PI / 2);
      liner.material = new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 1, side: THREE.BackSide });
    }
  }

  // ---- front: grille, headlight clusters with LED strips, fog lamps, plate
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.6 });
  add(new THREE.PlaneGeometry(0.86, 0.16), grilleMat, 0, 0.6, -2.272, 0, Math.PI);
  add(new THREE.BoxGeometry(0.9, 0.022, 0.03), chrome, 0, 0.69, -2.255);
  add(new THREE.BoxGeometry(0.9, 0.022, 0.03), chrome, 0, 0.51, -2.27);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), chrome, 0, 0.6, -2.282, Math.PI / 2);
  add(new THREE.BoxGeometry(1.15, 0.1, 0.06), plastic, 0, 0.37, -2.24);
  add(new THREE.BoxGeometry(1.5, 0.03, 0.12), plastic, 0, 0.29, -2.2);
  const plateF = new THREE.MeshStandardMaterial({ map: plateTexture('TS 09 EH 4521'), roughness: 0.5 });
  add(new THREE.PlaneGeometry(0.52, 0.13), plateF, 0, 0.45, -2.282, 0, Math.PI);

  const headMat = new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#c9d4de', emissiveIntensity: 0.6, roughness: 0.1 });
  const drlMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#7a0b0b', emissive: '#5a0303', emissiveIntensity: 1, roughness: 0.25 });
  const revMat = new THREE.MeshStandardMaterial({ color: '#d8d8d8', emissive: '#000000', roughness: 0.2 });
  const indMat = {
    left: new THREE.MeshStandardMaterial({ color: '#b86b00', emissive: '#000000', roughness: 0.3 }),
    right: new THREE.MeshStandardMaterial({ color: '#b86b00', emissive: '#000000', roughness: 0.3 }),
  };
  for (const s of [-1, 1]) {
    const ind = s < 0 ? indMat.left : indMat.right;
    // headlight cluster wrapping round the corner
    const housing = add(new THREE.BoxGeometry(0.42, 0.11, 0.05), gloss, s * 0.56, 0.715, -2.175, -0.3, s * 0.16);
    housing.scale.set(1, 1, 1);
    for (const k of [0, 1]) add(new THREE.SphereGeometry(0.036, 14, 10), headMat, s * (0.46 + k * 0.13), 0.72, -2.2 + k * 0.02);
    add(new THREE.BoxGeometry(0.38, 0.016, 0.02), drlMat, s * 0.56, 0.665, -2.205, 0, s * 0.16);
    add(new THREE.BoxGeometry(0.08, 0.035, 0.03), ind, s * 0.76, 0.71, -2.12, 0, s * 0.35);
    // fog lamp
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), headMat, s * 0.62, 0.38, -2.235, Math.PI / 2);
    // side repeater on the front wing
    add(new THREE.BoxGeometry(0.012, 0.03, 0.08), ind, s * (W / 2 + 0.008), 0.78, -1.5);
    // rear cluster wrapping round, reversing lamp, indicator
    add(new THREE.BoxGeometry(0.42, 0.13, 0.08), tailMat, s * 0.6, 0.83, 2.155, 0, -s * 0.25);
    add(new THREE.BoxGeometry(0.12, 0.05, 0.03), revMat, s * 0.62, 0.74, 2.2);
    add(new THREE.BoxGeometry(0.1, 0.04, 0.03), ind, s * 0.78, 0.88, 2.13, 0, -s * 0.4);
  }
  add(new THREE.BoxGeometry(0.75, 0.025, 0.02), tailMat, 0, 0.86, 2.215); // light bar
  add(new THREE.BoxGeometry(0.3, 0.025, 0.03), tailMat, 0, 1.36, 0.97); // high-level brake light

  // ---- rear: plate, diffuser, exhaust, badge
  const plateR = new THREE.MeshStandardMaterial({ map: plateTexture('TS 09 EH 4521'), roughness: 0.5 });
  add(new THREE.PlaneGeometry(0.52, 0.13), plateR, 0, 0.62, 2.245);
  add(new THREE.BoxGeometry(1.3, 0.09, 0.08), plastic, 0, 0.33, 2.17);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 14), chrome, -0.52, 0.3, 2.2, Math.PI / 2);
  add(new THREE.BoxGeometry(0.16, 0.03, 0.01), chrome, 0, 0.78, 2.215);

  // ---- wheels
  const wheels = [];
  for (const [x, z, front] of [[-1, -1, true], [1, -1, true], [-1, 1, false], [1, 1, false]]) {
    const w = wheel(mats, x, front);
    w.steer.position.set((x * CAR.track) / 2, CAR.wheelR, (z * CAR.wheelbase) / 2);
    root.add(w.steer);
    wheels.push({ ...w, front });
  }

  const interior = createInterior();
  body.add(interior.group);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  cabinMesh.castShadow = false;
  // the inside of the cabin should not darken the driver's own view
  // ...but the roof and pillars do shade the cabin
  interior.group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = true;
    }
  });
  // fewer draw calls: static parts sharing a material become one mesh per part group
  // (the animated wheels, steering wheel and the cockpit-only pieces stay separate)
  for (const w of wheels) {
    mergeByMaterial(w.spin);
    mergeByMaterial(w.steer, { dynamic: [w.spin] });
  }
  mergeByMaterial(interior.wheelSpin);
  mergeByMaterial(body, { keep: [lowerMesh, bonnetMesh, cabinMesh], dynamic: [interior.wheelSpin, interior.floor] });
  const blob = shadowBlob();
  blob.castShadow = false;
  root.add(blob);

  return {
    root, body, wheels, interior, paint,
    lights: { headMat, tailMat, indMat, revMat },
    setColor(c) { paint.color.set(c); },
    setCockpit(on) {
      lowerMesh.visible = !on;
      bonnetMesh.visible = on;
      interior.floor.visible = on;
    },
  };
}

// ---------- interior: dashboard, gauges, steering wheel (right-hand drive) ----------
function createInterior() {
  const group = new THREE.Group();
  // two-tone cabin, as in most Indian hatchbacks and sedans: dark upper dash,
  // beige lower dash, door cards, pillars and headliner
  const dashMat = new THREE.MeshLambertMaterial({ color: '#34373c' });
  const softMat = new THREE.MeshLambertMaterial({ color: '#3d4046' });
  const trimMat = new THREE.MeshLambertMaterial({ color: '#6a6e74' });
  const beigeMat = new THREE.MeshLambertMaterial({ color: '#b9ad97' });
  const seatMat = new THREE.MeshLambertMaterial({ color: '#6b6258' });

  // dashboard
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.2, 0.55), dashMat);
  dash.position.set(0, 0.84, -0.66);
  group.add(dash);
  // beige lower facia
  const facia = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 0.04), beigeMat);
  facia.position.set(0, 0.68, -0.4);
  group.add(facia);
  const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.42), softMat);
  dashTop.position.set(0, 0.955, -0.72);
  dashTop.rotation.x = -0.12;
  group.add(dashTop);
  // instrument binnacle in front of the driver (right), high enough to read over the wheel
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), dashMat);
  hood.position.set(0.37, 1.03, -0.48);
  hood.rotation.x = -0.08;
  group.add(hood);
  const hoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.04), dashMat);
  hoodBack.position.set(0.37, 0.93, -0.6);
  group.add(hoodBack);

  // gauge face (canvas texture)
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 200;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.164), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  cluster.position.set(0.37, 0.955, -0.372);
  cluster.rotation.x = -0.12;
  group.add(cluster);

  // centre console and switched-off screen
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.12), dashMat);
  stack.position.set(0, 0.8, -0.44);
  group.add(stack);
  // touch screen: clock, radio and trip details (deliberately no map)
  const scv = document.createElement('canvas');
  scv.width = 384;
  scv.height = 224;
  const stex = new THREE.CanvasTexture(scv);
  stex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.152), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false }));
  screen.position.set(0, 0.85, -0.365);
  group.add(screen);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.18, 0.012), new THREE.MeshLambertMaterial({ color: '#111214' }));
  bezel.position.set(0, 0.85, -0.373);
  group.add(bezel);
  for (const x of [-0.08, 0, 0.08]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), trimMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.72, -0.378);
    group.add(knob);
  }
  for (const x of [-0.55, 0.62]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.02), new THREE.MeshLambertMaterial({ color: '#111315' }));
    vent.position.set(x, 0.9, -0.405);
    group.add(vent);
  }
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.9), dashMat);
  tunnel.position.set(0, 0.5, 0.0);
  group.add(tunnel);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), trimMat);
  lever.position.set(0, 0.68, 0.05);
  group.add(lever);
  const leverKnob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshLambertMaterial({ color: '#141414' }));
  leverKnob.position.set(0, 0.77, 0.05);
  group.add(leverKnob);

  // steering wheel
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0.37, 0.74, -0.22);
  wheelPivot.rotation.x = -0.38; // column rake: face tilts up towards the driver
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.32, 8), dashMat);
  column.rotation.x = Math.PI / 2;
  column.position.z = -0.16;
  wheelPivot.add(column);
  const wheelSpin = new THREE.Group();
  wheelPivot.add(wheelSpin);
  const rimMat = new THREE.MeshLambertMaterial({ color: '#17181a' });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.017, 8, 28), rimMat);
  wheelSpin.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 12), trimMat);
  hub.rotation.x = Math.PI / 2;
  wheelSpin.add(hub);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), trimMat);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
    spoke.rotation.z = a;
    wheelSpin.add(spoke);
  }
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.025), new THREE.MeshLambertMaterial({ color: '#c9a227' }));
  marker.position.set(0, 0.175, 0.01);
  wheelSpin.add(marker);
  group.add(wheelPivot);

  // A-pillars, header, roof lining and door cards
  const pillarMat = new THREE.MeshLambertMaterial({ color: '#a89c87' });
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 0.8, 0.93, -0.95), b = new THREE.Vector3(s * 0.7, 1.33, -0.12);
    const len = a.distanceTo(b);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.07), pillarMat);
    p.position.copy(a).add(b).multiplyScalar(0.5);
    p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    group.add(p);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 1.6), beigeMat);
    door.position.set(s * 0.83, 0.72, 0.15);
    group.add(door);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 1.6), trimMat);
    sill.position.set(s * 0.82, 0.93, 0.15);
    group.add(sill);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.04, 0.1), pillarMat);
  header.position.set(0, 1.345, -0.12);
  group.add(header);
  const lining = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.02, 1.0), new THREE.MeshLambertMaterial({ color: '#cfc8bb', emissive: '#3a362f' }));
  lining.position.set(0, 1.355, 0.38);
  group.add(lining);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.18), new THREE.MeshLambertMaterial({ color: '#bdb6a9', emissive: '#2e2a24' }));
  visor.position.set(0.37, 1.31, -0.06);
  visor.rotation.x = 0.15;
  group.add(visor);

  // seats
  for (const x of [-0.37, 0.37]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMat);
    base.position.set(x, 0.45, 0.55);
    group.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.1), seatMat);
    back.position.set(x, 0.84, 0.88);
    back.rotation.x = -0.15;
    group.add(back);
  }
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.12), seatMat);
  rear.position.set(0, 0.78, 1.25);
  group.add(rear);
  // floor pan, only needed when the solid body is hidden for the cockpit view
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.04, 3.0), new THREE.MeshLambertMaterial({ color: '#1c1d20' }));
  floor.position.set(0, 0.3, 0.1);
  // firewall under the dashboard closes the footwell
  const firewall = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 0.04), new THREE.MeshLambertMaterial({ color: "#1f2125" }));
  firewall.position.set(0, 0.55, -0.76);
  floor.add(firewall);
  firewall.position.sub(floor.position);
  floor.visible = false;
  group.add(floor);

  const gauges = createGauges(canvas, tex);
  const display = createScreen(scv, stex);
  return { group, wheelSpin, gauges, display, floor };
}

function createGauges(canvas, tex) {
  const g = canvas.getContext('2d');
  let last = 0;
  function dial(cx, cy, r, value, max, labelStep, unit, redFrom) {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = '#0c0e11';
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a4048';
    g.lineWidth = 3;
    g.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    for (let v = 0; v <= max + 1e-6; v += labelStep / 2) {
      const a = a0 + ((a1 - a0) * v) / max;
      const major = Math.abs(v / labelStep - Math.round(v / labelStep)) < 1e-6;
      g.strokeStyle = redFrom !== undefined && v >= redFrom ? '#e0443a' : '#d6dbe0';
      g.lineWidth = major ? 3 : 1.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
      g.lineTo(Math.cos(a) * (r - (major ? 18 : 12)), Math.sin(a) * (r - (major ? 18 : 12)));
      g.stroke();
      if (major) {
        g.fillStyle = '#c8ced4';
        g.font = '15px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(Math.round(v)), Math.cos(a) * (r - 32), Math.sin(a) * (r - 32));
      }
    }
    g.fillStyle = '#8b95a0';
    g.font = '13px sans-serif';
    g.fillText(unit, 0, r * 0.45);
    const a = a0 + ((a1 - a0) * Math.min(value, max)) / max;
    g.strokeStyle = '#ff6a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14));
    g.stroke();
    g.fillStyle = '#2a2f36';
    g.beginPath();
    g.arc(0, 0, 9, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function arrow(x, y, dir, on) {
    g.fillStyle = on ? '#2fe07a' : '#1f3a2a';
    g.beginPath();
    g.moveTo(x + dir * 14, y);
    g.lineTo(x - dir * 4, y - 12);
    g.lineTo(x - dir * 4, y - 5);
    g.lineTo(x - dir * 16, y - 5);
    g.lineTo(x - dir * 16, y + 5);
    g.lineTo(x - dir * 4, y + 5);
    g.lineTo(x - dir * 4, y + 12);
    g.closePath();
    g.fill();
  }
  return {
    draw(state, now) {
      if (now - last < 66) return; // ~15 fps is plenty for gauges
      last = now;
      g.fillStyle = '#05070a';
      g.fillRect(0, 0, 512, 200);
      dial(105, 104, 92, state.kmh, 180, 20, 'km/h');
      dial(407, 104, 92, state.rpm / 1000, 7, 1, 'x1000 rpm', 5.5);
      g.fillStyle = '#e7ebef';
      g.font = 'bold 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(state.gear, 256, 92);
      g.font = '18px sans-serif';
      g.fillStyle = '#9aa4ae';
      g.fillText(`${String(Math.round(state.kmh)).padStart(3, ' ')} km/h`, 256, 140);
      arrow(222, 36, -1, state.blinkLeft);
      arrow(290, 36, 1, state.blinkRight);
      tex.needsUpdate = true;
    },
  };
}

// Centre screen: time, temperature, FM station and trip details.
function createScreen(canvas, tex) {
  const g = canvas.getContext('2d');
  let last = 0;
  return {
    draw(st, now) {
      if (now - last < 500) return;
      last = now;
      const grd = g.createLinearGradient(0, 0, 0, 224);
      grd.addColorStop(0, '#0f1a26');
      grd.addColorStop(1, '#070b10');
      g.fillStyle = grd;
      g.fillRect(0, 0, 384, 224);
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillStyle = '#e8eef4';
      g.font = 'bold 40px sans-serif';
      g.fillText(st.clock, 20, 56);
      g.font = '18px sans-serif';
      g.fillStyle = '#9fb0c0';
      g.fillText(`${st.temp}°C · Hyderabad`, 20, 84);
      g.textAlign = 'right';
      g.fillStyle = st.lights ? '#7fd1ff' : '#4a5562';
      g.font = 'bold 16px sans-serif';
      g.fillText(st.lights ? 'LIGHTS ON' : 'LIGHTS OFF', 364, 36);
      // radio card
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(16, 104, 352, 50);
      g.textAlign = 'left';
      g.fillStyle = '#ffb547';
      g.font = 'bold 18px sans-serif';
      g.fillText('FM ' + st.station, 30, 126);
      g.fillStyle = '#c9d4de';
      g.font = '15px sans-serif';
      g.fillText(st.track, 30, 146);
      // trip row
      g.fillStyle = '#9fb0c0';
      g.font = '14px sans-serif';
      const cells = [['TRIP', st.trip], ['AVG', st.avg], ['TIME', st.time]];
      cells.forEach(([k, v], i) => {
        const x = 20 + i * 122;
        g.fillStyle = '#6f8090';
        g.fillText(k, x, 180);
        g.fillStyle = '#e8eef4';
        g.font = 'bold 18px sans-serif';
        g.fillText(v, x, 204);
        g.font = '14px sans-serif';
      });
      tex.needsUpdate = true;
    },
  };
}
