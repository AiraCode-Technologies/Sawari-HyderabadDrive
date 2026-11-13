import * as THREE from 'three';

// World data uses x = east, y = north (metres) and bearings with 0 = north,
// clockwise positive. Three.js uses y up, so north maps to -z.
export const toV3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
export const fwdFromBearing = (b) => ({ x: Math.sin(b), y: Math.cos(b) });

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.hypot(px - cx, py - cy), t, cx, cy };
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Uniform grid of items registered by bounding box.
export class Grid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  add(minX, minY, maxX, maxY, item) {
    const c = this.cell;
    for (let gx = Math.floor(minX / c); gx <= Math.floor(maxX / c); gx++)
      for (let gy = Math.floor(minY / c); gy <= Math.floor(maxY / c); gy++) {
        const k = gx * 100003 + gy;
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(item);
      }
  }
  query(x, y, r, out = new Set()) {
    const c = this.cell;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
        const arr = this.map.get(gx * 100003 + gy);
        if (arr) for (const it of arr) out.add(it);
      }
    return out;
  }
}

// Merge simple geometries, each painted one colour, into a single vertex-coloured
// BufferGeometry (one draw call per vehicle or prop).
export function mergeColored(parts) {
  let count = 0;
  const prepared = parts.map(({ geo, color, matrix }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    count += g.attributes.position.count;
    return { g, color: new THREE.Color(color) };
  });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, color } of prepared) {
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    pos.set(p, o * 3);
    nor.set(n, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export function m4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

// ---------- spatial tiling of big merged meshes ----------
// One huge merged mesh is always drawn whole (and drawn again into the shadow
// map). Splitting it into ground tiles lets the camera and shadow frustums skip
// everything off-screen, and lets small clutter be hidden beyond a distance.
export function splitByTiles(geo, tile = 160) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position.array;
  const names = Object.keys(src.attributes);
  const buckets = new Map();
  const triCount = pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    const k = `${Math.floor(cx / tile)},${Math.floor(cz / tile)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(t);
  }
  const out = [];
  for (const tris of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const a = src.attributes[n], size = a.itemSize, arr = a.array;
      const dst = new Float32Array(tris.length * 3 * size);
      let w = 0;
      for (const t of tris) {
        const base = t * 3 * size;
        for (let i = 0; i < 3 * size; i++) dst[w++] = arr[base + i];
      }
      g.setAttribute(n, new THREE.BufferAttribute(dst, size));
    }
    g.computeBoundingSphere();
    out.push(g);
  }
  if (src !== geo) src.dispose();
  geo.dispose();
  return out;
}

// Adds a merged geometry to `group` as tiled meshes. `cull` (metres) hides a
// tile when the camera is farther than that from it (see cullTiles).
export function addTiled(group, geo, mat, { tile = 160, cast = false, receive = true, cull = 0, order } = {}) {
  const meshes = [];
  for (const g of splitByTiles(geo, tile)) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (order !== undefined) m.renderOrder = order;
    m.matrixAutoUpdate = false;
    m.userData.tiled = true;
    if (cull) {
      m.userData.cull = cull + g.boundingSphere.radius;
      (group.userData.cullables ||= []).push(m);
    }
    group.add(m);
    meshes.push(m);
  }
  return meshes;
}

// Show or hide tiles around the camera: small clutter beyond its own distance,
// and anything lying wholly beyond `far` (where the fog has fully hidden it).
export function cullTiles(group, camPos, far = Infinity) {
  if (!group.userData.allTiles) {
    const all = [];
    group.traverse((o) => o.userData.tiled && all.push(o));
    group.userData.allTiles = all;
  }
  for (const m of group.userData.allTiles) {
    const sp = m.isInstancedMesh ? m.boundingSphere : m.geometry.boundingSphere;
    if (!sp) continue;
    const c = sp.center;
    const lim = Math.min(m.userData.cull || Infinity, far + sp.radius);
    const dx = c.x - camPos.x, dy = c.y - camPos.y, dz = c.z - camPos.z;
    m.visible = dx * dx + dy * dy + dz * dz < lim * lim;
  }
}

// Merge static meshes under `root` that share a material (and shadow flags) into
// one mesh each, baking their transforms relative to root. Meshes in `keep`,
// meshes under a node in `dynamic`, meshes with children, instanced meshes,
// tiles and multi-material meshes are left alone. With `tile`, the merged
// geometry is split into ground tiles (see addTiled).
export function mergeByMaterial(root, { keep = [], dynamic = [], tile = 0, cull = 0 } = {}) {
  const skip = new Set(keep), dyn = new Set(dynamic);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const visit = (o) => {
    if (dyn.has(o)) return;
    if (o !== root && o.isMesh) {
      const ok = !skip.has(o) && !o.isInstancedMesh && !o.isSkinnedMesh && !o.userData.tiled && !Array.isArray(o.material) && o.children.length === 0 && o.visible && o.geometry.attributes.position;
      if (ok) {
        const g = o.geometry;
        const attrs = Object.keys(g.attributes).filter((n) => n === 'position' || n === 'normal' || n === 'uv' || n === 'color').sort();
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${o.frustumCulled}|${attrs.join(',')}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, attrs, items: [] }));
        b.items.push(o);
        return;
      }
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(root);
  let removed = 0;
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3();
  for (const b of buckets.values()) {
    if (b.items.length < 2) continue;
    let count = 0;
    const geos = b.items.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      count += g.attributes.position.count;
      return { o, g };
    });
    const out = new THREE.BufferGeometry();
    const arrays = {};
    for (const n of b.attrs) arrays[n] = new Float32Array(count * geos[0].g.attributes[n].itemSize);
    let off = 0;
    const v = new THREE.Vector3();
    for (const { o, g } of geos) {
      m.multiplyMatrices(inv, o.matrixWorld);
      nm.getNormalMatrix(m);
      const flip = m.determinant() < 0;
      const n = g.attributes.position.count;
      for (const name of b.attrs) {
        const src = g.attributes[name], size = src.itemSize, dst = arrays[name];
        for (let i = 0; i < n; i++) {
          // mirrored transforms reverse the winding: swap two corners of each triangle
          const j = flip ? i - (i % 3) + [0, 2, 1][i % 3] : i;
          if (name === 'position') {
            v.fromBufferAttribute(src, j).applyMatrix4(m);
            dst.set([v.x, v.y, v.z], (off + i) * 3);
          } else if (name === 'normal') {
            v.fromBufferAttribute(src, j).applyMatrix3(nm).normalize();
            dst.set([v.x, v.y, v.z], (off + i) * 3);
          } else for (let k = 0; k < size; k++) dst[(off + i) * size + k] = src.array[j * size + k];
        }
      }
      off += n;
      if (g !== o.geometry) g.dispose();
    }
    for (const n of b.attrs) out.setAttribute(n, new THREE.BufferAttribute(arrays[n], geos[0].g.attributes[n].itemSize));
    out.computeBoundingSphere();
    for (const { o } of geos) {
      o.parent.remove(o);
      removed++;
    }
    if (tile) addTiled(root, out, b.mat, { tile, cast: b.cast, receive: b.receive, cull, order: b.order });
    else {
      const mesh = new THREE.Mesh(out, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.renderOrder = b.order;
      root.add(mesh);
    }
  }
  return removed;
}

// Instanced copies split into ground tiles, so each tile can be skipped when it is
// off-screen or out of the sun's shadow box. `place(item, dummy, i)` poses each copy.
// Returns { meshes, setColorAt(i, color) } addressing copies by their list index.
export function instancedTiled(group, geo, mat, list, place, { tile = 200, cast = false, receive = true, cull = 0 } = {}) {
  if (!list.length) return null;
  const dummy = new THREE.Object3D();
  const buckets = new Map();
  const where = new Array(list.length);
  list.forEach((it, i) => {
    place(it, dummy, i);
    dummy.updateMatrix();
    const k = `${Math.floor(dummy.position.x / tile)},${Math.floor(dummy.position.z / tile)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    where[i] = [b, b.length];
    b.push(dummy.matrix.clone());
  });
  const meshOf = new Map();
  const meshes = [];
  for (const b of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, b.length);
    b.forEach((m, j) => im.setMatrixAt(j, m));
    im.computeBoundingSphere();
    im.castShadow = cast;
    im.receiveShadow = receive;
    im.matrixAutoUpdate = false;
    im.userData.tiled = true;
    if (cull) {
      im.userData.cull = cull + im.boundingSphere.radius;
      (group.userData.cullables ||= []).push(im);
    }
    group.add(im);
    meshOf.set(b, im);
    meshes.push(im);
  }
  return {
    meshes,
    setColorAt(i, c) {
      const [b, j] = where[i];
      meshOf.get(b).setColorAt(j, c);
    },
  };
}
