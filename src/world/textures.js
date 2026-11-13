import * as THREE from 'three';
import { mulberry } from '../util.js';

// Procedural, seamlessly tiling surface textures, drawn once into canvases.
// They are mostly light grey so the vertex colours keep the hue and the
// texture only adds grain, wear and joints. TEX_GAIN on a material colour
// cancels the texture's average darkening.
export const TEX_GAIN = 1.2;

// Tileable fractal value noise in [0, 1] on a size x size grid.
function fbm(size, octaves, seed, base = 4) {
  const rnd = mulberry(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o; // lattice cells across the tile (periodic)
    const lat = new Float32Array(f * f).map(() => rnd());
    const cell = size / f;
    for (let y = 0; y < size; y++) {
      const gy = y / cell, y0 = Math.floor(gy), ty = gy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % f) * f, r1 = ((y0 + 1) % f) * f;
      for (let x = 0; x < size; x++) {
        const gx = x / cell, x0 = Math.floor(gx), tx = gx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % f, c1 = (x0 + 1) % f;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(size, fill, aniso = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  fill(img.data, g);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // values are used as linear multipliers of the vertex colours (no sRGB decode)
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const put = (d, i, r, g, b) => {
  d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
};
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Asphalt: blotchy binder, light and dark aggregate, a few fine hairline cracks.
// One tile covers 5 m x 5 m.
export function asphaltTexture(aniso) {
  const N = 512;
  return toTexture(N, (d) => {
    const low = fbm(N, 4, 11, 3), fine = fbm(N, 3, 23, 32);
    const rnd = mulberry(77);
    for (let i = 0; i < N * N; i++) {
      let v = 214 + (low[i] - 0.5) * 46 + (fine[i] - 0.5) * 30;
      const r = rnd();
      if (r < 0.05) v += 34; // pale stone chips
      else if (r < 0.11) v -= 40; // dark voids
      put(d, i, cl(v), cl(v), cl(v * 1.01));
    }
    // hairline cracks wandering across the tile (wrapped)
    for (let c = 0; c < 5; c++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2;
      for (let s = 0; s < 220; s++) {
        a += (rnd() - 0.5) * 0.7;
        x = (x + Math.cos(a) * 1.3 + N) % N;
        y = (y + Math.sin(a) * 1.3 + N) % N;
        const i = Math.floor(y) * N + Math.floor(x);
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 120;
      }
    }
  }, aniso);
}

// Footpath: square concrete tiles with grout lines and wear. One tile covers 2 m.
export function paverTexture(aniso) {
  const N = 256, cells = 4; // 0.5 m tiles
  return toTexture(N, (d) => {
    const n = fbm(N, 3, 5, 4), fine = fbm(N, 2, 9, 32);
    const rnd = mulberry(31);
    const tone = Array.from({ length: cells * cells }, () => 0.9 + rnd() * 0.16);
    const cell = N / cells;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const ex = x % cell, ey = y % cell;
        const grout = ex < 2 || ey < 2;
        let v = grout ? 150 : 228 * tone[cy * cells + cx];
        v += (n[i] - 0.5) * 40 + (fine[i] - 0.5) * 20;
        if (!grout && rnd() < 0.04) v -= 25;
        put(d, i, cl(v), cl(v * 0.99), cl(v * 0.96));
      }
  }, aniso);
}

// Open ground: patchy dry grass and dust. One tile covers 16 m.
export function groundTexture(aniso) {
  const N = 512;
  return toTexture(N, (d) => {
    const low = fbm(N, 4, 3, 4), mid = fbm(N, 3, 13, 16);
    const rnd = mulberry(5);
    for (let i = 0; i < N * N; i++) {
      const v = 205 + (low[i] - 0.5) * 70 + (mid[i] - 0.5) * 40 + (rnd() - 0.5) * 26;
      const g = (mid[i] - 0.5) * 30; // greener and browner patches
      put(d, i, cl(v - g * 0.6), cl(v + g * 0.4), cl(v - g * 0.9 - 6));
    }
  }, aniso);
}

// Water: soft wind ripples. One tile covers 24 m; scrolled slowly in the game loop.
export function waterTexture(aniso) {
  const N = 256;
  return toTexture(N, (d) => {
    const a = fbm(N, 4, 41, 4), b = fbm(N, 2, 43, 16);
    for (let i = 0; i < N * N; i++) {
      const v = 200 + (a[i] - 0.5) * 60 + Math.max(0, b[i] - 0.62) * 260;
      put(d, i, cl(v * 0.92), cl(v * 0.98), cl(v));
    }
  }, aniso);
}
