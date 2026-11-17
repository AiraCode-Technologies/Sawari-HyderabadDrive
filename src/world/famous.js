import * as THREE from 'three';
import { mergeColored, m4 } from '../util.js';

// Hyderabad's famous places, each modelled on the real building's architecture and
// signed with its real name (English and Telugu). Built in a local frame: x across the
// front, y up, z back from the road; the front (z = -d/2) faces the route.
// l: { style, n, te, x, y, w, d, a, h, pal }.

const TAU = Math.PI * 2;

function parts() {
  const list = [];
  const P = {
    list,
    box: (w, h, d, x, y, z, color, ry = 0) => list.push({ geo: new THREE.BoxGeometry(w, h, d), color, matrix: m4(x, y, z, 0, ry, 0) }),
    cyl: (rt, rb, h, x, y, z, color, seg = 16) => list.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color, matrix: m4(x, y, z) }),
    dome: (r, x, y, z, color, sy = 1, seg = 16) => list.push({ geo: new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2), 0, TAU, 0, Math.PI / 2), color, matrix: m4(x, y, z, 0, 0, 0, 1, sy, 1) }),
    lathe: (profile, x, y, z, color, seg = 24) => list.push({ geo: new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), color, matrix: m4(x, y, z) }),
    geo: (geo, color, matrix) => list.push({ geo, color, matrix }),
  };
  return P;
}

// a plain sign board: the English name, the Telugu name beneath
function board(en, te, w, h, bg = '#1d2b3a', fg = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.max(128, Math.round((1024 * h) / w));
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const two = te && cv.height >= 150;
  let size = Math.round(cv.height * (two ? 0.42 : 0.6));
  g.font = `bold ${size}px sans-serif`;
  while (g.measureText(en).width > cv.width * 0.92 && size > 12) g.font = `bold ${(size -= 2)}px sans-serif`;
  g.fillText(en, cv.width / 2, two ? cv.height * 0.36 : cv.height / 2);
  if (two) {
    let ts = Math.round(cv.height * 0.3);
    g.font = `${ts}px "Noto Sans Telugu", "Nirmala UI", "Gautami", sans-serif`;
    while (g.measureText(te).width > cv.width * 0.92 && ts > 10) g.font = `${(ts -= 2)}px "Noto Sans Telugu", "Nirmala UI", "Gautami", sans-serif`;
    g.fillText(te, cv.width / 2, cv.height * 0.76);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
  m.rotation.y = Math.PI; // plane faces -z: the road
  return m;
}

// ---------- the styles ----------
const S = {};

// Shopping mall: a wide podium with glass bands, a tall glass atrium over the entrance,
// a canopy and the mall's name across the atrium (Inorbit, GVK One, City Center).
S.mall = (l, P, signs) => {
  const [wall, glass, accent] = l.pal || ['#e9e4da', '#2b6cb0', '#f2a33a'];
  const { w, d, h } = l, hp = h * 0.8;
  P.box(w, hp, d, 0, hp / 2, 0, wall);
  for (let k = 0; k < 4; k++) P.box(w * 0.97, 1.8, 0.4, 0, 3.2 + (k * (hp - 4)) / 4, -d / 2 - 0.15, glass);
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) P.box(0.4, 1.8, d * 0.9, s * (w / 2 + 0.15), 3.2 + (k * (hp - 4)) / 4, 0, glass);
  const aw = Math.min(w * 0.34, 40);
  P.box(aw, h, 8, 0, h / 2, -d / 2 + 3, glass);
  P.box(aw + 1, 1.4, 8.6, 0, h + 0.7, -d / 2 + 3, accent);
  P.box(aw * 1.15, 0.6, 7, 0, 5.2, -d / 2 - 3.2, accent); // entrance canopy
  for (const s of [-1, 1]) P.cyl(0.35, 0.35, 5, s * aw * 0.5, 2.5, -d / 2 - 6, '#d9d9d9', 10);
  P.box(w * 0.98, 2.4, 0.5, 0, hp - 1.6, -d / 2 - 0.3, accent); // signage band
  const sg = board(l.n, l.te, aw * 0.9, aw * 0.9 * 0.28, accent === '#f2a33a' ? '#1f3b70' : '#ffffff', accent === '#f2a33a' ? '#ffffff' : '#1d2b3a');
  sg.position.set(0, h - 4, -d / 2 - 1.1);
  signs.push(sg);
};

// IT office tower: a glass block with white floor bands, slim fins and a crown, the
// company's name on top (Cyber Gateway, TCS Deccan Park).
S['it-office'] = (l, P, signs) => {
  const { w, d, h } = l;
  P.box(w, h, d, 0, h / 2, 0, '#3f6f8f');
  for (let y = 3.6; y < h; y += 3.6) P.box(w + 0.25, 0.45, d + 0.25, 0, y, 0, '#dfe6ea');
  for (let x = -w / 2 + 2; x <= w / 2 - 2; x += 4) P.box(0.25, h, 0.6, x, h / 2, -d / 2 - 0.2, '#c9d3da');
  P.box(w * 0.94, 2.4, d * 0.94, 0, h + 1.2, 0, '#c4ccd2');
  P.box(w * 1.02, 4, d * 1.02, 0, 2, 0, '#9fb3c2'); // lobby
  const sg = board(l.n, null, Math.min(w * 0.8, 36), Math.min(w * 0.8, 36) * 0.14, '#1d2b3a', '#ffffff');
  sg.position.set(0, h + 1.2, -d * 0.47 - 0.05);
  signs.push(sg);
};

// Cyber Towers: the ring of curved glass that started HITEC City, open at the front,
// banded floor by floor, with a round entrance block.
S['cyber-towers'] = (l, P, signs) => {
  const { h } = l;
  const R = Math.max(22, Math.min(l.w, l.d) * 0.5), T = Math.min(16, R * 0.45);
  const open = 0.9; // gap at the front (radians)
  const a0 = -Math.PI / 2 + open / 2, a1 = -Math.PI / 2 - open / 2 + TAU;
  const ring = (r0, r1, hh, y, color) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, r1, a0, a1, false);
    sh.absarc(0, 0, r0, a1, a0, true);
    const g = new THREE.ExtrudeGeometry(sh, { depth: hh, bevelEnabled: false, curveSegments: 40 });
    g.rotateX(-Math.PI / 2); // shape plane -> ground, extrude upwards; shape +y becomes -z (the front)
    P.geo(g, color, m4(0, y, 0));
  };
  ring(R - T, R, h, 0, '#4a7fa6');
  for (let y = 3.8; y < h; y += 3.8) ring(R - T - 0.15, R + 0.15, 0.45, y, '#e6ecf0');
  ring(R - T - 0.2, R + 0.2, 1.6, h, '#d3dbe1');
  P.cyl(9, 9, 12, 0, 6, -R + T / 2, '#7fa8c7', 24);
  P.dome(9, 0, 12, -R + T / 2, '#e6ecf0', 0.5, 24);
  const sg = board(l.n, l.te, 16, 4, '#13324f', '#ffffff');
  sg.position.set(0, 15, -R - 1);
  signs.push(sg);
};

// Prasads IMAX: a great drum of dark glass beside Hussain Sagar, a glass lobby in front.
S.drum = (l, P, signs) => {
  const { h } = l;
  const r = Math.max(16, Math.min(l.w, l.d) * 0.46);
  P.cyl(r, r, h, 0, h / 2, 0, '#2f3a44', 40);
  for (let y = 5; y < h - 2; y += 6) P.cyl(r + 0.2, r + 0.2, 1.4, 0, y, 0, '#5b86a8', 40);
  P.cyl(r + 0.4, r + 0.4, 1.2, 0, h + 0.6, 0, '#c9d2d8', 40);
  P.box(r * 1.2, 11, 9, 0, 5.5, -r + 2, '#6fa0c4');
  const sg = board('IMAX', 'Prasads · ప్రసాద్స్', 18, 6, '#0b4f9c', '#ffffff');
  sg.position.set(0, h - 6, -r - 0.6);
  signs.push(sg);
};

// Hotel tower: a podium and a slab with balcony bands and a glass spine (ITC Kohenur,
// Trident, Taj Deccan).
S['hotel-tower'] = (l, P, signs) => {
  const { w, d, h } = l;
  P.box(w, 8, d, 0, 4, 0, '#d8cfc0');
  const tw = w * 0.72, td = Math.max(12, d * 0.55);
  P.box(tw, h, td, 0, h / 2, d * 0.05, '#efe8dc');
  for (let y = 10; y < h; y += 3.3) P.box(tw + 0.3, 0.35, td + 0.3, 0, y, d * 0.05, '#c9bfae');
  P.box(tw * 0.18, h + 2, 0.5, 0, (h + 2) / 2, d * 0.05 - td / 2 - 0.2, '#5a7f99');
  P.box(tw * 0.9, 3, td * 0.9, 0, h + 1.5, d * 0.05, '#bfa77a');
  P.box(w * 0.45, 0.5, 6, 0, 5, -d / 2 - 2.8, '#bfa77a'); // porte-cochère
  const sg = board(l.n, null, Math.min(tw * 0.8, 26), Math.min(tw * 0.8, 26) * 0.16, '#3a2f22', '#f3d9a4');
  sg.position.set(0, h + 1.5, d * 0.05 - td * 0.45 - 0.1);
  signs.push(sg);
};

// Heritage hotel (Taj Krishna): long cream wings under red-tiled roofs, an arched porch.
S['heritage-hotel'] = (l, P, signs) => {
  const { w, d } = l, h = Math.min(l.h, 22);
  P.box(w, h, d, 0, h / 2, 0, '#eadcc2');
  const roof = new THREE.Shape();
  roof.moveTo(-d / 2 - 0.8, 0);
  roof.lineTo(0, 4.5);
  roof.lineTo(d / 2 + 0.8, 0);
  roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: w + 1.6, bevelEnabled: false });
  rg.rotateY(Math.PI / 2);
  P.geo(rg, '#9a4b2f', m4(-w / 2 - 0.8, h, 0));
  for (let y = 3.4; y < h - 1; y += 3.4) for (let x = -w / 2 + 3; x < w / 2 - 2; x += 4) P.box(1.6, 1.9, 0.3, x, y, -d / 2 - 0.1, '#6b5a44');
  P.box(14, 7, 6, 0, 3.5, -d / 2 - 3, '#f2e7d2');
  for (const x of [-5, 0, 5]) P.box(3, 4.5, 6.2, x, 2.3, -d / 2 - 3, '#4b3d2c');
  const sg = board(l.n, l.te, 12, 2.6, '#3a2f22', '#f3d9a4');
  sg.position.set(0, 8.5, -d / 2 - 6.1);
  signs.push(sg);
};

// Telangana Secretariat: white tiers in Deccan style, a tall central block crowned by two
// great domes with gold finials, domed pavilions on every corner, an arcade along the front.
S.secretariat = (l, P, signs) => {
  const { w, d } = l, white = '#f2efe6', trim = '#d8c9a0', gold = '#c9a227';
  const w0 = Math.min(w, 170), d0 = Math.min(d, 120);
  P.box(w0, 18, d0, 0, 9, 0, white);
  P.box(w0 + 1, 1.2, d0 + 1, 0, 18.6, 0, trim);
  for (let k = 0; k < 11; k++) P.box(w0 / 14, 9, 0.6, -w0 / 2 + (w0 / 11) * (k + 0.5), 5, -d0 / 2 - 0.2, '#b9b3a4'); // arcade
  P.box(w0 * 0.62, 12, d0 * 0.62, 0, 25, 0, white);
  P.box(w0 * 0.62 + 1, 1, d0 * 0.62 + 1, 0, 31.5, 0, trim);
  P.box(w0 * 0.24, 26, d0 * 0.3, 0, 45, 0, white);
  for (const s of [-1, 1]) {
    P.cyl(w0 * 0.055, w0 * 0.055, 6, s * w0 * 0.065, 61, 0, white, 24);
    P.dome(w0 * 0.06, s * w0 * 0.065, 64, 0, '#ece6d6', 1.2, 24);
    P.cyl(0.2, 1.2, 4, s * w0 * 0.065, 64 + w0 * 0.072 + 1.5, 0, gold, 8);
  }
  for (const [cx, cz, y, r] of [[w0 / 2 - 6, d0 / 2 - 6, 18.6, 5], [-w0 / 2 + 6, d0 / 2 - 6, 18.6, 5], [w0 / 2 - 6, -d0 / 2 + 6, 18.6, 5], [-w0 / 2 + 6, -d0 / 2 + 6, 18.6, 5], [w0 * 0.31 - 4, -d0 * 0.31 + 4, 32, 3.5], [-w0 * 0.31 + 4, -d0 * 0.31 + 4, 32, 3.5], [w0 * 0.31 - 4, d0 * 0.31 - 4, 32, 3.5], [-w0 * 0.31 + 4, d0 * 0.31 - 4, 32, 3.5]]) {
    P.cyl(r, r, 3, cx, y + 1.5, cz, white, 16);
    P.dome(r, cx, y + 3, cz, '#ece6d6', 1.1, 16);
    P.cyl(0.1, 0.6, 2, cx, y + 3 + r * 1.1 + 1, cz, gold, 8);
  }
  const sg = board(l.n, l.te, 34, 5, '#f5f1e6', '#5a3d12');
  sg.position.set(0, 4, -d0 / 2 - 12);
  signs.push(sg);
  P.box(36, 6, 1, 0, 3, -d0 / 2 - 11.4, trim); // gate wall behind the name
};

// Dr. B.R. Ambedkar's statue (125 ft) on its round, pillared base.
S['tall-statue'] = (l, P, signs) => {
  const r = Math.max(14, Math.min(l.w, l.d) * 0.42), cream = '#efe7d6', bronze = '#5d4a33';
  P.cyl(r, r + 1, 14, 0, 7, 0, cream, 40);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    P.cyl(0.6, 0.6, 12, Math.cos(a) * (r + 1.6), 7, Math.sin(a) * (r + 1.6), '#f6f1e5', 10);
  }
  P.cyl(r + 2.4, r + 2.4, 1.2, 0, 14.4, 0, '#d8ccb2', 40);
  P.cyl(r * 0.55, r * 0.6, 6, 0, 18, 0, cream, 32);
  const y0 = 21, S2 = 1.25;
  for (const s of [-1, 1]) P.box(2.4 * S2, 15 * S2, 2.8 * S2, s * 1.5 * S2, y0 + 7.5 * S2, 0, bronze);
  P.cyl(3.4 * S2, 4.2 * S2, 13 * S2, 0, y0 + (15 + 6.5) * S2, 0, '#3e4a5c', 16); // blue suit
  P.box(9 * S2, 2.2 * S2, 4.2 * S2, 0, y0 + 28 * S2, 0, '#3e4a5c');
  P.cyl(1.2 * S2, 1.4 * S2, 2 * S2, 0, y0 + 30 * S2, 0, bronze, 12);
  list(P, new THREE.SphereGeometry(2.4 * S2, 14, 10), bronze, m4(0, y0 + 32.6 * S2, 0));
  // right arm raised, pointing ahead; the left holds the Constitution
  P.geo(new THREE.BoxGeometry(1.5 * S2, 1.5 * S2, 9 * S2), '#3e4a5c', m4(-4.6 * S2, y0 + 28.5 * S2, -3.5 * S2, -0.55, 0, 0));
  P.box(1.6 * S2, 8 * S2, 1.6 * S2, 4.6 * S2, y0 + 24 * S2, 0, '#3e4a5c');
  P.box(2.6 * S2, 3.2 * S2, 0.9 * S2, 4.6 * S2, y0 + 20 * S2, -1.2 * S2, '#2a2520');
  const sg = board(l.n, l.te, 16, 3.2, '#3b2f20', '#f3e2b8');
  sg.position.set(0, 4, -r - 1.3);
  signs.push(sg);
};
const list = (P, geo, color, matrix) => P.geo(geo, color, matrix);

// Telangana Martyrs' Memorial: an eternal flame in stainless steel rising from a lamp.
S.flame = (l, P, signs) => {
  const h = l.h || 54, steel = '#c8ced3';
  P.cyl(26, 27, 3, 0, 1.5, 0, '#9a948a', 48);
  P.lathe([[0, 0], [16, 0], [21, 3], [23, 7], [19, 9], [0, 9]], 0, 3, 0, '#b8bfc5', 48); // the diya
  const fh = h - 12, prof = [[0, 0], [10, fh * 0.06], [13.5, fh * 0.2], [13, fh * 0.38], [10.5, fh * 0.56], [7, fh * 0.72], [3.5, fh * 0.86], [0, fh]];
  P.lathe(prof, 0, 12, 0, steel, 48);
  const sg = board(l.n, l.te, 22, 4, '#2c2f33', '#ffffff');
  sg.position.set(0, 2.5, -28.5);
  signs.push(sg);
};

// Birla Mandir: white marble on Naubath Pahad; a pillared hall and a curving shikhara
// crowned with an amalaka and a gold kalash.
S.shikhara = (l, P, signs) => {
  const { w, d } = l, marble = '#f5f3ee';
  const w0 = Math.min(w, 46), d0 = Math.min(d, 46);
  P.box(w0, 4, d0, 0, 2, 0, '#e4dfd4');
  P.box(w0 * 0.55, 8, d0 * 0.4, 0, 8, -d0 * 0.18, marble);
  P.dome(w0 * 0.14, 0, 12, -d0 * 0.18, marble, 0.8);
  const H = Math.max(22, (l.h || 36) - 8), R0 = Math.min(w0, d0) * 0.2;
  const prof = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    prof.push([R0 * (1 - 0.82 * t * t) * (1 + 0.04 * Math.sin(t * 40)), t * H]);
  }
  prof.push([0, H]);
  P.lathe(prof, 0, 4, d0 * 0.12, marble, 16);
  list(P, new THREE.TorusGeometry(R0 * 0.22, R0 * 0.08, 8, 16), marble, m4(0, 4 + H + 0.3, d0 * 0.12, Math.PI / 2, 0, 0));
  P.cyl(0.15, 0.7, 2.2, 0, 4 + H + 1.6, d0 * 0.12, '#c9a227', 8);
  const sg = board(l.n, l.te, 12, 2.6, '#f5f3ee', '#7a2c12');
  sg.position.set(0, 2.2, -d0 / 2 - 0.2);
  signs.push(sg);
};

// Peddamma Temple: a painted Dravidian gopuram over the gate, tier on tier, a barrel
// roof with gold kalashas, and the hall behind.
S.gopuram = (l, P, signs) => {
  const { w, d } = l, tiers = ['#e8c27a', '#d9826b', '#7fb3a8', '#e6d4a8', '#c96f6f', '#8fb0d6', '#e8c27a'];
  P.box(w, 2.2, 0.6, 0, 1.1, -d / 2, '#e6dccb');
  P.box(w * 0.6, 7, d * 0.5, 0, 3.5, d * 0.1, '#efe6d4');
  let y = 0, gw = Math.min(14, w * 0.5), gd = 7;
  P.box(gw, 6, gd, 0, 3, -d / 2 + gd / 2, '#efe6d4');
  y = 6;
  for (let k = 0; k < 7; k++) {
    const tw = gw * (1 - k * 0.1), td = gd * (1 - k * 0.07);
    P.box(tw, 2.4, td, 0, y + 1.2, -d / 2 + gd / 2, tiers[k]);
    P.box(tw + 0.3, 0.3, td + 0.3, 0, y + 2.45, -d / 2 + gd / 2, '#f3eadb');
    y += 2.6;
  }
  list(P, new THREE.CylinderGeometry(gd * 0.35, gd * 0.35, gw * 0.4, 12, 1, false, 0, Math.PI), '#d9a441', m4(0, y, -d / 2 + gd / 2, 0, 0, Math.PI / 2));
  for (let k = -2; k <= 2; k++) P.cyl(0.12, 0.45, 1.6, k * gw * 0.08, y + gd * 0.35 + 0.6, -d / 2 + gd / 2, '#c9a227', 8);
  const sg = board(l.n, l.te, 9, 2.2, '#7a1f12', '#ffe9b0');
  sg.position.set(0, 6.6, -d / 2 - 0.4);
  signs.push(sg);
};

// Mecca Masjid: a long prayer hall of grey granite, its front a row of great arches,
// octagonal minarets with arcaded galleries and small domes at the corners.
S['grand-mosque'] = (l, P, signs) => {
  const { w, d, h } = l, granite = '#8e8a83', dark = '#3b3a37';
  const w0 = Math.min(w, 70), d0 = Math.min(d, 60), hh = Math.min(h, 22);
  P.box(w0, hh, d0, 0, hh / 2, 0, granite);
  const n = 5, aw = w0 / (n + 2);
  for (let k = 0; k < n; k++) {
    const x = -w0 / 2 + aw * (k + 1.5);
    P.box(aw * 0.62, hh * 0.58, 0.5, x, hh * 0.29 + 0.5, -d0 / 2 - 0.1, dark);
    P.geo(new THREE.CylinderGeometry(aw * 0.31, aw * 0.31, 0.5, 16, 1, false, -Math.PI / 2, Math.PI), dark, m4(x, hh * 0.58 + 0.5, -d0 / 2 - 0.1, Math.PI / 2, 0, 0));
  }
  for (let x = -w0 / 2 + 1; x <= w0 / 2 - 1; x += 2) P.box(1, 1.2, 1, x, hh + 0.6, -d0 / 2 + 0.5, granite); // crenellation
  for (const s of [-1, 1]) {
    const mx = s * (w0 / 2 - 2.5), mz = -d0 / 2 + 2.5, mh = hh + 10;
    P.cyl(2.6, 2.9, mh, mx, mh / 2, mz, granite, 8);
    for (const y of [hh + 0.5, mh - 3]) P.cyl(3.4, 3.4, 0.8, mx, y, mz, '#a29c93', 8);
    P.cyl(2.2, 2.2, 2.4, mx, mh + 1.2, mz, '#a29c93', 8);
    P.dome(2.4, mx, mh + 2.4, mz, granite, 1.1, 12);
  }
  const sg = board(l.n, l.te, 14, 2.8, '#2b2a27', '#e8e2d6');
  sg.position.set(0, 2.2, -d0 / 2 - 4);
  signs.push(sg);
};

// Palace (Chowmahalla) and museum (Salar Jung): cream walls, two storeys of arcades,
// a pedimented portico, balustrades and domed corner pavilions (the museum a central dome).
const palace = (l, P, signs, museum) => {
  const { w, d } = l, cream = '#efe6d2', trim = '#c9b48a', dark = '#6d5a3e';
  const w0 = Math.min(w, 110), d0 = Math.min(d, 70), hh = Math.min(l.h, 18);
  P.box(w0, hh, d0, 0, hh / 2, 0, cream);
  for (const [y, ah] of [[2.8, 4.6], [hh / 2 + 2.2, 3.8]])
    for (let x = -w0 / 2 + 2.5; x <= w0 / 2 - 2.5; x += 3.6) P.box(1.9, ah, 0.4, x, y + ah / 2 - 2, -d0 / 2 - 0.1, dark);
  P.box(w0 + 0.6, 0.8, d0 + 0.6, 0, hh / 2 - 0.4, 0, trim);
  for (let x = -w0 / 2; x <= w0 / 2; x += 1.2) P.box(0.3, 1, 0.3, x, hh + 0.5, -d0 / 2, trim);
  P.box(w0 * 0.22, hh + 2, 6, 0, (hh + 2) / 2, -d0 / 2 - 2.5, cream);
  const ped = new THREE.Shape();
  ped.moveTo(-w0 * 0.12, 0);
  ped.lineTo(0, 3.5);
  ped.lineTo(w0 * 0.12, 0);
  ped.closePath();
  P.geo(new THREE.ExtrudeGeometry(ped, { depth: 1, bevelEnabled: false }), trim, m4(0, hh + 2, -d0 / 2 - 5.6));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w0 / 2 - 2.5), z = sz * (d0 / 2 - 2.5);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.box(0.3, 3, 0.3, x + ox * 1.6, hh + 1.5, z + oz * 1.6, cream);
    P.dome(2.3, x, hh + 3, z, '#f3ead8', 1, 12);
  }
  if (museum) {
    P.cyl(8, 8, 4, 0, hh + 2, 0, cream, 24);
    P.dome(8, 0, hh + 4, 0, '#f3ead8', 1.1, 24);
  }
  const sg = board(l.n, l.te, 16, 3, '#f3ead8', '#5a3d12');
  sg.position.set(0, hh + 0.6, -d0 / 2 - 5.2);
  signs.push(sg);
};
S.palace = (l, P, signs) => palace(l, P, signs, false);
S.museum = (l, P, signs) => palace(l, P, signs, true);

// Indo-Saracenic (Telangana High Court, Osmania General Hospital): stone with white
// bands, rows of arched windows, a great central dome on a drum and corner turrets.
S['indo-saracenic'] = (l, P, signs) => {
  const { w, d } = l, stone = /high court/i.test(l.n) ? '#b9614a' : '#d6c39a', white = '#f1ece2', dark = '#4b3a2c';
  const w0 = Math.min(w, 130), d0 = Math.min(d, 60), hh = Math.min(l.h, 22);
  P.box(w0, hh, d0, 0, hh / 2, 0, stone);
  for (let y = 4; y < hh; y += 5.5) P.box(w0 + 0.3, 0.6, d0 + 0.3, 0, y, 0, white);
  for (let y = 1.5; y < hh - 3; y += 5.5) for (let x = -w0 / 2 + 3; x <= w0 / 2 - 3; x += 4.5) P.box(1.8, 3, 0.4, x, y + 1.6, -d0 / 2 - 0.1, dark);
  P.cyl(9, 9, 8, 0, hh + 4, 0, stone, 24);
  P.dome(9.5, 0, hh + 8, 0, white, 1.15, 24);
  P.cyl(0.15, 0.8, 3, 0, hh + 8 + 11 + 1.5, 0, '#c9a227', 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w0 / 2 - 3), z = sz * (d0 / 2 - 3);
    P.cyl(2.8, 2.8, hh + 6, x, (hh + 6) / 2, z, stone, 8);
    P.dome(3, x, hh + 6, z, white, 1.2, 12);
  }
  const sg = board(l.n, l.te, 18, 3.2, '#f1ece2', '#5a2a18');
  sg.position.set(0, 3.2, -d0 / 2 - 2);
  signs.push(sg);
};

// A park's entrance arch: two pillars with domed caps and the name across the top.
S.gateway = (l, P, signs) => {
  const w = l.w || 11, h = l.h || 7, sand = '#d6b98c';
  for (const s of [-1, 1]) {
    P.box(1.4, h, 1.4, s * w / 2, h / 2, 0, sand);
    P.dome(0.9, s * w / 2, h, 0, '#c9a227', 1.2, 10);
  }
  P.box(w + 1.6, 1.6, 1.6, 0, h - 1.2, 0, sand);
  for (const flip of [false, true]) {
    const sg = board(l.n, l.te, w * 0.92, 1.4, '#2f5d3a', '#ffffff');
    sg.position.set(0, h - 1.2, flip ? 0.85 : -0.85);
    if (flip) sg.rotation.y = 0;
    signs.push(sg);
  }
};

// ---------- placing them ----------
export function buildFamous(list0, group, quality, T, index) {
  for (const l of list0) {
    if (l.type !== 'famous' || !S[l.style]) continue;
    const P = parts();
    const signs = [];
    S[l.style](l, P, signs);
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(mergeColored(P.list), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = quality.shadows;
    mesh.receiveShadow = true;
    g.add(mesh);
    for (const s of signs) g.add(s);
    // stand level on sloping ground: rest on the highest corner, a stone plinth below
    const fx = Math.sin(l.a), fy = Math.cos(l.a), rx = Math.cos(l.a), ry = -Math.sin(l.a);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [l.x + rx * a * l.w / 2 + fx * b * l.d / 2, l.y + ry * a * l.w / 2 + fy * b * l.d / 2]);
    const gs = corners.map(([x, y]) => T.at(x, y)).concat(T.at(l.x, l.y));
    // on a slope it is set into the hill: floor at the average ground, a plinth down to the lowest
    const low = Math.min(...gs), base = gs.reduce((a, v) => a + v, 0) / gs.length, top = base;
    if (base - low > 0.3 && l.style !== 'gateway') {
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(l.w + 1, base - low + 1, l.d + 1), new THREE.MeshLambertMaterial({ color: '#b9b2a6' }));
      plinth.position.y = -(base - low + 1) / 2 + 0.2;
      g.add(plinth);
    }
    g.position.set(l.x, l.style === 'gateway' ? T.at(l.x, l.y) : base, -l.y);
    g.rotation.y = -l.a; // local -z (the front) turns to bearing l.a: towards the route
    group.add(g);
    // solid to drive into: the footprint's edges (a gateway's two pillars)
    if (index) {
      if (l.style === 'gateway') {
        for (const s of [-1, 1]) index.ring(l.x + rx * s * l.w / 2, l.y + ry * s * l.w / 2, 0.8, top + 7, 'post');
      } else {
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          index.addWall(a[0], a[1], b[0], b[1], top + l.h, 'building');
        }
      }
    }
  }
}
