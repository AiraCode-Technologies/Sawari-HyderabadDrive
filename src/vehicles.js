import * as THREE from 'three';
import { mergeColored, m4 } from './util.js';

// Low-poly versions of the vehicle types seen on Hyderabad roads. Each model is
// one merged, vertex-coloured geometry. Local frame: forward = -Z, up = +Y.
// The shapes are generic (no brand styling): proportions follow common classes.

const GLASS = '#25313b';
const TRIM = '#1d1e21';
const LIGHT = '#f4f2e6';
const TAIL = '#a51515';

// A side profile (x = forward, y = up) extruded across the width.
function profile(draw, width, color, bevel = 0.04) {
  const s = new THREE.Shape();
  draw(s);
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return { geo: g, color };
}
const box = (w, h, l, color, x, y, z, rx = 0, ry = 0, rz = 0) => ({ geo: new THREE.BoxGeometry(w, h, l), color, matrix: m4(x, y, z, rx, ry, rz) });
const cyl = (r, l, color, x, y, z, seg = 12) => ({ geo: new THREE.CylinderGeometry(r, r, l, seg), color, matrix: m4(x, y, z, 0, 0, Math.PI / 2) });

function wheelSet(parts, track, wb, r, w = 0.2, hub = '#b9bec3') {
  for (const x of [-track / 2, track / 2])
    for (const z of [-wb / 2, wb / 2]) {
      parts.push(cyl(r, w, '#141414', x, r, z, 14));
      parts.push(cyl(r * 0.58, w + 0.02, hub, x + Math.sign(x) * 0.01, r, z, 10));
    }
}

// ---------- cars ----------
// p: L length, W width, belt, H roof, cf/rf/rb/cb: windscreen base, roof front,
// roof back, rear glass base (x positions), nose / tail heights, r wheel, wb.
function carModel(p, color) {
  const parts = [];
  const { L, W, belt, H, cf, rf, rb, cb, nose, tail, r, wb } = p;
  const half = L / 2;
  parts.push(profile((s) => {
    s.moveTo(half - 0.12, 0.24);
    s.lineTo(half, 0.42);
    s.lineTo(half, nose);
    s.quadraticCurveTo(half - 0.02, belt, half - 0.35, belt);
    s.lineTo(cf, belt + 0.02);
    s.lineTo(cb, belt + 0.04);
    s.quadraticCurveTo(-half, belt + 0.04, -half, tail);
    s.lineTo(-half, 0.42);
    s.lineTo(-half + 0.12, 0.24);
    s.lineTo(-wb / 2 - r - 0.08, 0.24);
    s.absarc(-wb / 2, r, r + 0.07, Math.PI + 0.25, -0.25, true);
    s.lineTo(wb / 2 - r - 0.08, 0.24);
    s.absarc(wb / 2, r, r + 0.07, Math.PI + 0.25, -0.25, true);
    s.lineTo(half - 0.12, 0.24);
  }, W, color, 0.07));
  parts.push(profile((s) => {
    s.moveTo(cf, belt);
    s.lineTo(rf, H);
    s.lineTo(rb, H);
    s.lineTo(cb, belt);
    s.lineTo(cf, belt);
  }, W - 0.14, GLASS, 0.04));
  parts.push(profile((s) => {
    s.moveTo(rf + 0.04, H + 0.03);
    s.lineTo(rb - 0.02, H + 0.03);
    s.lineTo(rb - 0.02, H - 0.06);
    s.lineTo(rf + 0.08, H - 0.06);
  }, W - 0.1, color, 0));
  // B-pillar in body colour, bumpers, lights, plates
  const bx = (rf + rb) / 2 + 0.1;
  parts.push(box(W - 0.11, H - belt, 0.09, color, 0, (belt + H) / 2, -bx));
  parts.push(box(W + 0.02, 0.14, 0.12, TRIM, 0, 0.36, -half));
  parts.push(box(W + 0.02, 0.14, 0.12, TRIM, 0, 0.38, half));
  for (const s of [-1, 1]) {
    parts.push(box(0.36, 0.1, 0.05, LIGHT, s * (W / 2 - 0.3), nose - 0.06, -half - 0.01));
    parts.push(box(0.3, 0.12, 0.05, TAIL, s * (W / 2 - 0.25), Math.min(tail, belt) - 0.06, half + 0.01));
  }
  parts.push(box(0.5, 0.11, 0.02, p.yellowPlate ? '#f1c40f' : '#f2f2ec', 0, 0.5, -half - 0.03));
  parts.push(box(0.5, 0.11, 0.02, p.yellowPlate ? '#f1c40f' : '#f2f2ec', 0, 0.55, half + 0.03));
  if (p.cladding) for (const s of [-1, 1]) parts.push(box(0.04, 0.12, L - 0.4, TRIM, s * (W / 2 + 0.01), 0.32, 0));
  if (p.rails) for (const s of [-1, 1]) parts.push(box(0.05, 0.05, rf - rb - 0.2, '#2b2d30', s * (W / 2 - 0.2), H + 0.07, -(rf + rb) / 2));
  if (p.spare) parts.push({ geo: new THREE.CylinderGeometry(r, r, 0.22, 12), color: '#141414', matrix: m4(0, belt - 0.1, half + 0.12, Math.PI / 2) });
  wheelSet(parts, W - 0.25, wb, r);
  return mergeColored(parts);
}

const CARS = {
  // hatchbacks
  hatchSmall: { L: 3.45, W: 1.5, belt: 0.8, H: 1.47, cf: 0.72, rf: 0.18, rb: -1.3, cb: -1.66, nose: 0.62, tail: 0.92, r: 0.27, wb: 2.36 },
  hatchTall: { L: 3.6, W: 1.6, belt: 0.84, H: 1.67, cf: 0.86, rf: 0.38, rb: -1.58, cb: -1.76, nose: 0.68, tail: 0.98, r: 0.28, wb: 2.43 },
  hatchPremium: { L: 3.99, W: 1.73, belt: 0.88, H: 1.5, cf: 0.95, rf: 0.02, rb: -1.45, cb: -1.9, nose: 0.66, tail: 0.94, r: 0.31, wb: 2.52 },
  // sedans
  sedanCompact: { L: 3.99, W: 1.73, belt: 0.86, H: 1.5, cf: 0.85, rf: 0.12, rb: -0.95, cb: -1.42, nose: 0.66, tail: 0.92, r: 0.3, wb: 2.45 },
  sedanMid: { L: 4.5, W: 1.75, belt: 0.88, H: 1.48, cf: 1.05, rf: 0.22, rb: -1.05, cb: -1.65, nose: 0.68, tail: 0.94, r: 0.32, wb: 2.6 },
  cab: { L: 3.99, W: 1.73, belt: 0.86, H: 1.5, cf: 0.85, rf: 0.12, rb: -0.95, cb: -1.42, nose: 0.66, tail: 0.92, r: 0.3, wb: 2.45, yellowPlate: true },
  // SUVs and MUVs
  suvCompact: { L: 3.99, W: 1.79, belt: 1.0, H: 1.64, cf: 0.95, rf: 0.4, rb: -1.72, cb: -1.9, nose: 0.9, tail: 1.02, r: 0.34, wb: 2.5, cladding: true, rails: true },
  suvMid: { L: 4.3, W: 1.79, belt: 1.02, H: 1.66, cf: 1.05, rf: 0.28, rb: -1.85, cb: -2.05, nose: 0.92, tail: 1.04, r: 0.34, wb: 2.61, cladding: true },
  muv: { L: 4.6, W: 1.83, belt: 0.98, H: 1.8, cf: 1.25, rf: 0.55, rb: -2.1, cb: -2.25, nose: 0.86, tail: 1.0, r: 0.33, wb: 2.75 },
  suvBoxy: { L: 4.4, W: 1.8, belt: 1.1, H: 1.95, cf: 0.98, rf: 0.78, rb: -2.08, cb: -2.15, nose: 1.06, tail: 1.1, r: 0.37, wb: 2.68, spare: true, cladding: true },
};

// ---------- two-wheelers with riders ----------
function rider(parts, jacket, helmet, seatY, z = 0.15) {
  parts.push(box(0.42, 0.6, 0.3, jacket, 0, seatY + 0.34, z, -0.2));
  parts.push({ geo: new THREE.SphereGeometry(0.15, 10, 8), color: helmet, matrix: m4(0, seatY + 0.78, z - 0.08) });
  for (const s of [-1, 1]) {
    parts.push(box(0.11, 0.38, 0.11, '#2c3440', s * 0.19, seatY - 0.12, z - 0.12, 0.9));
    parts.push(box(0.08, 0.08, 0.42, jacket, s * 0.2, seatY + 0.42, z - 0.32, 0.35));
  }
}
function twoWheeler(type, color, jacket, helmet, withRider = true) {
  const parts = [];
  const scoot = type === 'scooter' || type === 'delivery';
  const r = scoot ? 0.24 : type === 'cruiser' ? 0.34 : 0.31;
  const wb = scoot ? 1.26 : type === 'cruiser' ? 1.4 : 1.28;
  for (const z of [-wb / 2, wb / 2]) {
    parts.push(cyl(r, 0.1, '#141414', 0, r, z, 14));
    parts.push(cyl(r * 0.55, 0.11, scoot ? '#9aa0a6' : '#c8ccd0', 0, r, z, 8));
  }
  if (scoot) {
    parts.push(profile((s) => {
      s.moveTo(-0.75, 0.35);
      s.lineTo(-0.1, 0.33);
      s.lineTo(0.15, 0.42);
      s.lineTo(0.35, 0.95);
      s.lineTo(0.5, 0.95);
      s.lineTo(0.45, 0.35);
      s.lineTo(0.25, 0.25);
      s.lineTo(-0.2, 0.25);
      s.lineTo(-0.75, 0.25);
    }, 0.36, color, 0.03));
    parts.push(profile((s) => {
      s.moveTo(-0.85, 0.45);
      s.quadraticCurveTo(-0.85, 0.85, -0.45, 0.82);
      s.lineTo(0.0, 0.75);
      s.lineTo(0.0, 0.45);
    }, 0.38, color, 0.04));
    parts.push(box(0.3, 0.1, 0.6, '#1b1b1b', 0, 0.86, 0.25));
    parts.push(box(0.6, 0.05, 0.05, '#9aa0a6', 0, 1.05, -0.45));
    parts.push(box(0.18, 0.12, 0.05, LIGHT, 0, 0.98, -0.52));
  } else {
    parts.push(box(0.32, 0.26, 0.55, color, 0, 0.92, -0.15)); // fuel tank
    parts.push(box(0.3, 0.1, 0.6, '#1b1b1b', 0, 0.9, 0.35));
    parts.push(box(0.26, 0.3, 0.4, '#3a3d42', 0, 0.55, 0)); // engine
    parts.push(box(0.06, 0.06, 0.9, '#b9bec3', 0.14, 0.42, 0.25)); // exhaust
    parts.push(box(0.06, 0.6, 0.06, '#9aa0a6', 0, 0.8, -wb / 2 + 0.05, -0.35));
    parts.push(box(0.7, 0.05, 0.05, '#9aa0a6', 0, 1.1, -0.55));
    if (type === 'cruiser') parts.push(cyl(0.11, 0.08, '#d9dde0', 0, 1.0, -0.72, 12));
    else parts.push(box(0.16, 0.12, 0.06, LIGHT, 0, 1.0, -0.7));
  }
  parts.push(box(0.14, 0.06, 0.04, TAIL, 0, 0.82, scoot ? 0.86 : 0.7));
  if (type === 'delivery') parts.push(box(0.46, 0.42, 0.42, color, 0, 1.15, 0.62));
  if (withRider) rider(parts, jacket, helmet, 0.92);
  return mergeColored(parts);
}

// ---------- auto-rickshaw ----------
function autoModel() {
  const parts = [];
  parts.push(profile((s) => {
    s.moveTo(-1.3, 0.3);
    s.lineTo(1.25, 0.3);
    s.lineTo(1.35, 0.7);
    s.quadraticCurveTo(1.3, 1.05, 1.0, 1.1);
    s.lineTo(0.7, 1.1);
    s.lineTo(0.6, 0.7);
    s.lineTo(-1.3, 0.75);
  }, 1.3, '#1f6b37', 0.05));
  parts.push(profile((s) => {
    s.moveTo(1.0, 1.1);
    s.lineTo(1.05, 1.55);
    s.quadraticCurveTo(0.9, 1.92, 0.3, 1.95);
    s.lineTo(-1.25, 1.95);
    s.lineTo(-1.32, 1.1);
    s.lineTo(-1.2, 1.1);
    s.lineTo(-1.2, 1.85);
    s.lineTo(0.75, 1.85);
    s.lineTo(0.9, 1.1);
  }, 1.36, '#e3bb1f', 0.04));
  parts.push(box(1.1, 0.5, 0.04, GLASS, 0, 1.38, -1.02, -0.15));
  parts.push(box(1.28, 0.55, 0.9, '#2a2a2a', 0, 1.05, 0.65)); // rear seat
  parts.push(box(0.4, 0.5, 0.3, '#2c3440', 0, 1.3, -0.25)); // driver
  parts.push({ geo: new THREE.SphereGeometry(0.13, 8, 6), color: '#3b2b20', matrix: m4(0, 1.68, -0.25) });
  parts.push(box(0.3, 0.1, 0.05, LIGHT, 0, 0.95, -1.36));
  parts.push(box(1.2, 0.08, 0.05, '#a01515', 0, 0.62, 1.32));
  parts.push(cyl(0.24, 0.14, '#141414', 0, 0.24, -1.05, 12));
  for (const x of [-0.58, 0.58]) parts.push(cyl(0.24, 0.14, '#141414', x, 0.24, 0.85, 12));
  return mergeColored(parts);
}

// ---------- buses ----------
function busModel(lower, upper, band, opts = {}) {
  const parts = [];
  const L = opts.L || 11.5, W = 2.55, H = 3.05;
  parts.push(profile((s) => {
    s.moveTo(L / 2, 0.45);
    s.lineTo(L / 2, 1.3);
    s.lineTo(L / 2 - 0.12, H - 0.15);
    s.quadraticCurveTo(L / 2 - 0.15, H, L / 2 - 0.4, H);
    s.lineTo(-L / 2 + 0.2, H);
    s.lineTo(-L / 2, H - 0.2);
    s.lineTo(-L / 2, 0.45);
  }, W, upper, 0.08));
  parts.push(box(W + 0.02, 1.0, L - 0.1, lower, 0, 0.95, 0));
  parts.push(box(W + 0.03, 0.95, L - 1.4, GLASS, 0, 2.05, -0.3));
  parts.push(box(W - 0.3, 1.25, 0.06, GLASS, 0, 2.0, -L / 2 - 0.02, -0.06));
  parts.push(box(W + 0.04, 0.16, L - 0.2, band, 0, 1.5, 0));
  parts.push(box(1.8, 0.24, 0.05, '#ffd23f', 0, 2.82, -L / 2 - 0.04));
  for (const s of [-1, 1]) {
    parts.push(box(0.3, 0.14, 0.05, LIGHT, s * 0.95, 0.8, -L / 2 - 0.03));
    parts.push(box(0.25, 0.3, 0.05, TAIL, s * 1.05, 1.0, L / 2 + 0.03));
  }
  parts.push(box(0.05, 2.1, 1.0, '#3a3d42', -W / 2 - 0.01, 1.5, -L / 2 + 1.5)); // front door on the kerb (left) side
  if (opts.ac) parts.push(box(1.6, 0.3, 3.2, '#d9dde0', 0, H + 0.15, 0.5));
  if (opts.stripes) for (const y of [1.25, 1.75]) parts.push(box(W + 0.04, 0.08, L - 0.2, '#1b1b1b', 0, y, 0));
  wheelSet(parts, W - 0.3, L - 5.2, 0.5, 0.32, '#8f949a');
  return mergeColored(parts);
}

// ---------- goods vehicles ----------
function miniTruck(bed) {
  const parts = [];
  parts.push(profile((s) => {
    s.moveTo(-1.95, 0.45);
    s.lineTo(-1.95, 1.0);
    s.lineTo(-1.82, 1.7);
    s.lineTo(-0.7, 1.75);
    s.lineTo(-0.7, 0.45);
  }, 1.5, '#ecebe6', 0.04));
  parts.push(box(1.4, 0.5, 0.05, GLASS, 0, 1.45, 1.86));
  parts.push(box(1.6, 0.12, 2.6, '#3a3c40', 0, 0.62, -0.6));
  for (const s of [-1, 1]) parts.push(box(0.06, 0.5, 2.6, bed, s * 0.78, 0.93, -0.6));
  parts.push(box(1.6, 0.5, 0.06, bed, 0, 0.93, -1.88));
  parts.push(box(1.2, 0.4, 1.4, '#a9845a', 0, 0.88, -0.6));
  for (const s of [-1, 1]) parts.push(box(0.26, 0.1, 0.04, LIGHT, s * 0.5, 0.9, 1.97));
  wheelSet(parts, 1.4, 2.35, 0.3);
  // drawn facing +z above: turn it round so the cab leads
  const g = mergeColored(parts);
  g.rotateY(Math.PI);
  return g;
}
function pickup(color) {
  const parts = [];
  parts.push(profile((s) => {
    s.moveTo(2.4, 0.5);
    s.lineTo(2.45, 1.05);
    s.lineTo(1.4, 1.15);
    s.lineTo(1.0, 1.9);
    s.lineTo(-0.3, 1.9);
    s.lineTo(-0.3, 1.15);
    s.lineTo(-2.45, 1.15);
    s.lineTo(-2.45, 0.5);
  }, 1.75, color, 0.05));
  parts.push(box(1.6, 0.6, 0.6, GLASS, 0, 1.5, -1.15, 0.5));
  parts.push(box(1.62, 0.3, 2.0, '#2f3134', 0, 1.32, 1.35));
  for (const s of [-1, 1]) {
    parts.push(box(0.3, 0.12, 0.05, LIGHT, s * 0.6, 0.95, -2.47));
    parts.push(box(0.2, 0.2, 0.05, TAIL, s * 0.75, 1.0, 2.47));
  }
  wheelSet(parts, 1.5, 3.0, 0.36);
  return mergeColored(parts);
}
function lorry(cab, cover) {
  const parts = [];
  parts.push(box(2.3, 2.0, 1.9, cab, 0, 1.6, -2.75));
  parts.push(box(2.1, 0.7, 0.05, GLASS, 0, 2.05, -3.71));
  parts.push(box(2.4, 0.3, 6.2, '#3a3c40', 0, 0.85, 0.6));
  parts.push(box(2.45, 2.2, 5.2, cover, 0, 2.1, 1.1));
  parts.push(box(2.47, 0.12, 5.22, '#1d1e21', 0, 2.9, 1.1));
  for (const s of [-1, 1]) {
    parts.push(box(0.3, 0.15, 0.05, LIGHT, s * 0.85, 1.0, -3.72));
    parts.push(box(0.25, 0.2, 0.05, TAIL, s * 1.0, 1.0, 3.72));
  }
  wheelSet(parts, 2.0, 4.6, 0.48, 0.32);
  return mergeColored(parts);
}
function tanker() {
  const parts = [];
  parts.push(box(2.3, 2.0, 1.8, '#f2f2ec', 0, 1.6, -2.7));
  parts.push(box(2.1, 0.7, 0.05, GLASS, 0, 2.05, -3.61));
  parts.push(box(2.3, 0.3, 5.6, '#3a3c40', 0, 0.85, 0.7));
  const tank = new THREE.CylinderGeometry(1.0, 1.0, 4.8, 16);
  tank.rotateX(Math.PI / 2);
  parts.push({ geo: tank, color: '#1f5fa8', matrix: m4(0, 2.0, 1.0) });
  parts.push(box(2.05, 0.08, 4.82, '#f2f2ec', 0, 2.0, 1.0));
  for (const s of [-1, 1]) parts.push(box(0.3, 0.15, 0.05, LIGHT, s * 0.85, 1.0, -3.62));
  wheelSet(parts, 2.0, 4.4, 0.48, 0.32);
  return mergeColored(parts);
}

const CAR_COLORS = ['#f2f2ef', '#f2f2ef', '#c9ccd1', '#c9ccd1', '#2b2f36', '#b3262c', '#2c5aa0', '#7a8088', '#e8e2d0', '#5b2333', '#3f5a3a', '#8a5a2b'];
const JACKETS = ['#3b5f8f', '#7a2e2e', '#2f2f2f', '#e8e2d0', '#5d6b3a', '#6a4c93'];
const HELMETS = ['#d8d8d8', '#1b1b1b', '#b3262c', '#2c5aa0', '#e6c229'];

// Catalogue: category -> list of {geo, length, width, maxSpeed, radius, bike}
export function buildCatalogue() {
  const pick = (arr, i) => arr[i % arr.length];
  const cars = (keys, n, extra = {}) =>
    keys.flatMap((k, ki) => Array.from({ length: n }, (_, i) => {
      const p = CARS[k];
      return { type: k, geo: carModel(p, k === 'cab' ? '#f4f4f0' : pick(CAR_COLORS, i * 3 + ki)), length: p.L, width: p.W, maxSpeed: 15, radius: p.W / 2, ...extra };
    }));
  return {
    hatch: cars(['hatchSmall', 'hatchTall', 'hatchPremium'], 4),
    sedan: cars(['sedanCompact', 'sedanMid', 'cab'], 3),
    suv: cars(['suvCompact', 'suvMid', 'muv', 'suvBoxy'], 3, { maxSpeed: 15.5 }),
    bike: [
      ...Array.from({ length: 4 }, (_, i) => ({ type: 'scooter', geo: twoWheeler('scooter', pick(['#f2f2ef', '#b3262c', '#2c5aa0', '#3a3d42', '#c9a227'], i), pick(JACKETS, i), pick(HELMETS, i)) })),
      ...Array.from({ length: 3 }, (_, i) => ({ type: 'commuter', geo: twoWheeler('commuter', pick(['#1b1b1b', '#b3262c', '#2c5aa0'], i), pick(JACKETS, i + 2), pick(HELMETS, i + 1)) })),
      ...Array.from({ length: 2 }, (_, i) => ({ type: 'cruiser', geo: twoWheeler('cruiser', pick(['#141414', '#4a5a3a'], i), pick(JACKETS, i + 4), '#1b1b1b') })),
      ...Array.from({ length: 2 }, (_, i) => ({ type: 'delivery', geo: twoWheeler('delivery', pick(['#f26b1d', '#d62828'], i), pick(['#f26b1d', '#d62828'], i), '#1b1b1b') })),
    ].map((b) => ({ ...b, length: 1.9, width: 0.72, maxSpeed: 13.5, radius: 0.42, bike: true })),
    auto: [{ type: 'auto', geo: autoModel(), length: 2.7, width: 1.36, maxSpeed: 11, radius: 0.68 }],
    bus: [
      { type: 'cityBus', geo: busModel('#b8352a', '#efe9da', '#f2b134') },
      { type: 'electricBus', geo: busModel('#2f8f55', '#f4f4f0', '#1f6fb8', { ac: true }) },
      { type: 'schoolBus', geo: busModel('#e7b416', '#e7b416', '#1b1b1b', { L: 9, stripes: true }) },
      { type: 'shuttle', geo: busModel('#f4f4f0', '#f4f4f0', '#2c5aa0', { L: 10, ac: true }) },
    ].map((b) => ({ ...b, length: b.type === 'schoolBus' ? 9 : b.type === 'shuttle' ? 10 : 11.5, width: 2.55, maxSpeed: 12, radius: 1.28 })),
    goods: [
      ...['#2c5aa0', '#2f7a46', '#c9ccd1'].map((c) => ({ type: 'miniTruck', geo: miniTruck(c), length: 3.9, width: 1.6, maxSpeed: 11, radius: 0.85 })),
      ...['#e8e2d0', '#f2f2ef'].map((c) => ({ type: 'pickup', geo: pickup(c), length: 4.9, width: 1.75, maxSpeed: 12, radius: 0.92 })),
      ...[['#e46b1f', '#2c5aa0'], ['#2f7a46', '#c9a227']].map(([c, cv]) => ({ type: 'lorry', geo: lorry(c, cv), length: 7.4, width: 2.45, maxSpeed: 10, radius: 1.25 })),
      { type: 'tanker', geo: tanker(), length: 7.2, width: 2.3, maxSpeed: 10, radius: 1.2 },
    ],
  };
}

// Shares of each category in moving traffic (two-wheelers and autos dominate).
export const TRAFFIC_MIX = [['bike', 0.31], ['auto', 0.15], ['hatch', 0.19], ['sedan', 0.12], ['suv', 0.11], ['goods', 0.07], ['bus', 0.05]];

// Parked vehicles: riderless two-wheelers plus everyday cars and an auto.
export function buildParkedCatalogue() {
  const bikes = [
    twoWheeler('scooter', '#f2f2ef', '', '', false), twoWheeler('scooter', '#b3262c', '', '', false), twoWheeler('scooter', '#2c5aa0', '', '', false),
    twoWheeler('commuter', '#1b1b1b', '', '', false), twoWheeler('commuter', '#b3262c', '', '', false), twoWheeler('cruiser', '#141414', '', '', false),
  ];
  const cars = ['hatchSmall', 'hatchTall', 'hatchPremium', 'sedanCompact', 'suvCompact', 'muv'].map((k, i) => ({ geo: carModel(CARS[k], CAR_COLORS[(i * 5) % CAR_COLORS.length]), length: CARS[k].L, width: CARS[k].W }));
  cars.push({ geo: autoModel(), length: 2.7, width: 1.36 });
  return { bikes, cars };
}
