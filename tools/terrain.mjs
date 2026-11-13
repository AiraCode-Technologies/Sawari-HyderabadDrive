// Elevation from Terrarium-encoded terrain tiles (Mapzen / AWS Open Data, built
// from SRTM and other sources). height = R * 256 + G + B / 256 - 32768 metres.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

export const DEM_ZOOM = 15;
const SIZE = 256;

export function loadDem(demDir) {
  const cache = new Map();
  const n = 2 ** DEM_ZOOM;
  function tile(x, y) {
    const k = `${x}_${y}`;
    if (!cache.has(k)) {
      const f = join(demDir, `${DEM_ZOOM}_${k}.png`);
      if (!existsSync(f)) {
        cache.set(k, null);
      } else {
        const png = PNG.sync.read(readFileSync(f));
        const h = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < SIZE * SIZE; i++) {
          const o = i * 4;
          h[i] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
        }
        cache.set(k, h);
      }
    }
    return cache.get(k);
  }
  function pixel(px, py) {
    const tx = Math.floor(px / SIZE), ty = Math.floor(py / SIZE);
    const t = tile(tx, ty);
    if (!t) return NaN;
    return t[(py - ty * SIZE) * SIZE + (px - tx * SIZE)];
  }
  // bilinear elevation at lat/lon (metres above sea level)
  return function elevation(lat, lon) {
    const r = (lat * Math.PI) / 180;
    const fx = ((lon + 180) / 360) * n * SIZE - 0.5;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * SIZE - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = pixel(x0, y0), b = pixel(x0 + 1, y0), c = pixel(x0, y0 + 1), d = pixel(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// Regular grid over local metres, smoothed with repeated box blurs (the source is
// ~30 m data with building and noise artefacts in dense city blocks).
export function terrainGrid(elev, toLatLon, bounds, spacing, passes = 3, radius = 2) {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / spacing) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / spacing) + 1;
  let g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lat, lon] = toLatLon(bounds.minX + i * spacing, bounds.minY + j * spacing);
      g[j * nx + i] = elev(lat, lon);
    }
  // fill any holes from missing tiles with the mean
  let sum = 0, cnt = 0;
  for (const v of g) if (Number.isFinite(v)) { sum += v; cnt++; }
  const mean = cnt ? sum / cnt : 0;
  for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i])) g[i] = mean;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(g.length);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let s = 0, c = 0;
        for (let dj = -radius; dj <= radius; dj++)
          for (let di = -radius; di <= radius; di++) {
            const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(ny - 1, Math.max(0, j + dj));
            s += g[jj * nx + ii];
            c++;
          }
        out[j * nx + i] = s / c;
      }
    g = out;
  }
  const sample = (x, y) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - bounds.minX) / spacing));
    const fy = Math.min(ny - 1.001, Math.max(0, (y - bounds.minY) / spacing));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i], d = g[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  return { nx, ny, spacing, x0: bounds.minX, y0: bounds.minY, data: g, sample };
}
