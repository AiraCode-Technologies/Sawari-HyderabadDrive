// Ground elevation from the route's terrain grid (metres relative to the start).
export class Terrain {
  constructor(t) {
    this.x0 = t.x0;
    this.y0 = t.y0;
    this.d = t.d;
    this.nx = t.nx;
    this.ny = t.ny;
    const bin = atob(t.z);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dm = new Int16Array(bytes.buffer);
    this.h = new Float32Array(dm.length);
    for (let i = 0; i < dm.length; i++) this.h[i] = dm[i] / 10;
  }

  // bilinear height at local (x east, y north)
  at(x, y) {
    const fx = Math.min(this.nx - 1.0001, Math.max(0, (x - this.x0) / this.d));
    const fy = Math.min(this.ny - 1.0001, Math.max(0, (y - this.y0) / this.d));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, n = this.nx;
    const a = this.h[j * n + i], b = this.h[j * n + i + 1], c = this.h[(j + 1) * n + i], d = this.h[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
}

// Mark grid cells covered by a polygon (scanline fill at the cell centres' rows).
export function rasterize(poly, x0, y0, d, nx, ny, cb) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const j0 = Math.max(0, Math.ceil((minY - y0) / d)), j1 = Math.min(ny - 1, Math.floor((maxY - y0) / d));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const y = y0 + j * d;
    xs.length = 0;
    for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
      const a = poly[m], b = poly[k];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - x0) / d)), i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / d));
      for (let i = i0; i <= i1; i++) cb(i, j);
    }
  }
}
