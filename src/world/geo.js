import * as THREE from 'three';

// Geometry accumulator: flat-shaded, vertex-coloured triangles.
export class Geo {
  constructor(withUV = false) {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = withUV ? [] : null;
  }
  // Triangle with flat normal; flips winding if the normal points away from `face`.
  tri(a, b, c, color, uvs, face) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (face && nx * face[0] + ny * face[1] + nz * face[2] < 0) {
      [b, c] = [c, b];
      if (uvs) uvs = [uvs[0], uvs[2], uvs[1]];
      nx = -nx; ny = -ny; nz = -nz;
    }
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.nor.push(nx, ny, nz);
      this.col.push(color.r, color.g, color.b);
    }
    if (this.uv) this.uv.push(...(uvs ? uvs.flat() : [0, 0, 0, 0, 0, 0]));
  }
  quad(a, b, c, d, color, uvs, face) {
    this.tri(a, b, c, color, uvs && [uvs[0], uvs[1], uvs[2]], face);
    this.tri(a, c, d, color, uvs && [uvs[0], uvs[2], uvs[3]], face);
  }
  // Quad facing up whose colour blends across it: A and D take c0, B and C take c1.
  tri2(A, B, C, D, c0, c1, uvs) {
    const n = (p, q, r) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      return ny < 0 ? [-nx / l, -ny / l, -nz / l, true] : [nx / l, ny / l, nz / l, false];
    };
    for (const [p, q, r, cp, cq, cr, up, uq, ur] of [[A, B, C, c0, c1, c1, 0, 1, 2], [A, C, D, c0, c1, c0, 0, 2, 3]]) {
      const [nx, ny, nz, flip] = n(p, q, r);
      const verts = flip ? [[p, cp, up], [r, cr, ur], [q, cq, uq]] : [[p, cp, up], [q, cq, uq], [r, cr, ur]];
      for (const [v, c, u] of verts) {
        this.pos.push(v[0], v[1], v[2]);
        this.nor.push(nx, ny, nz);
        this.col.push(c.r, c.g, c.b);
        if (this.uv) this.uv.push(...(uvs ? uvs[u] : [0, 0]));
      }
    }
  }
  get empty() { return this.pos.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

export const UP = [0, 1, 0];
export const c3 = (hex) => new THREE.Color(hex);
// world (x east, y north, h up) -> three [x, y, z]
export const P = (x, y, h) => [x, h, -y];

export function sampleAlong(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === pts.length - 1) {
      const t = l ? Math.min(1, s / l) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t, dir: Math.atan2(b[0] - a[0], b[1] - a[1]), i, t };
    }
    s -= l;
  }
  const z = pts[pts.length - 1];
  return { x: z[0], y: z[1], h: z[2] ?? 0, dir: 0, i: pts.length - 1, t: 1 };
}
export const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// A wall ribbon along a polyline between per-point base and top heights, both faces.
export function wallRibbon(geo, pts, baseAt, topAt, color, topColor, thick = 0) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const t = thick / 2;
    for (const s of [1, -1]) {
      const ax = a[0] + nx * t * s, ay = a[1] + ny * t * s, bx = b[0] + nx * t * s, by = b[1] + ny * t * s;
      geo.quad(P(ax, ay, baseAt(a)), P(bx, by, baseAt(b)), P(bx, by, topAt(b)), P(ax, ay, topAt(a)), color, null, [nx * s, 0, -ny * s]);
    }
    if (thick > 0)
      geo.quad(P(a[0] + nx * t, a[1] + ny * t, topAt(a)), P(b[0] + nx * t, b[1] + ny * t, topAt(b)), P(b[0] - nx * t, b[1] - ny * t, topAt(b)), P(a[0] - nx * t, a[1] - ny * t, topAt(a)), topColor || color, null, UP);
  }
}
