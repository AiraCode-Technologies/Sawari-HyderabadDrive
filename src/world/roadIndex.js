import { Grid, segDist, pointInPolygon } from '../util.js';

// Raised footpaths: tertiary roads and above get a kerb this high above the
// asphalt (the asphalt itself is drawn 6 cm above the road line).
export const KERB = 0.15;
export const ROAD_TOP = 0.06;
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
export const rankOf = (r) => RANK[r.k] || 2;
export const footpathWidth = (r) => (rankOf(r) >= 3 ? 2.4 : 1.4);

// Spatial index over road segments, the terrain, obstacles and speed breakers.
export class RoadIndex {
  constructor(world, terrain) {
    this.terrain = terrain;
    this.roads = world.roads;
    this.grid = new Grid(25);
    this.segs = [];
    world.roads.forEach((r, ri) => {
      r.kerb = rankOf(r) >= 3;
      for (let i = 1; i < r.p.length; i++) {
        const a = r.p[i - 1], b = r.p[i];
        const seg = { ri, i, ax: a[0], ay: a[1], ah: a[2], bx: b[0], by: b[1], bh: b[2], w: r.w, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
        if (seg.len < 0.05) continue;
        seg.dir = Math.atan2(b[0] - a[0], b[1] - a[1]);
        this.segs.push(seg);
        const pad = r.w / 2 + 1;
        this.grid.add(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, seg);
      }
    });

    // Obstacles as wall segments with an absolute top height.
    //   building / wall: only off the carriageway
    //   median: raised kerb between carriageways, always solid
    //   post: pillars and boulders, always solid
    //   water: lake shores, only off the carriageway and near the ground
    this.walls = new Grid(20);
    const addWall = (ax, ay, bx, by, top, kind) => {
      const w = { ax, ay, bx, by, top, kind };
      this.walls.add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), w);
    };
    this.addWall = addWall;
    const ring = (cx, cy, r, top, kind, n = 6) => {
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        addWall(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, top, kind);
      }
    };
    this.ring = ring;

    this.buildingPolys = new Grid(30);
    for (const b of world.buildings) {
      const p = b.p;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, gmax = -Infinity;
      for (const q of p) {
        minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]);
        gmax = Math.max(gmax, terrain.at(q[0], q[1]));
      }
      b.top = gmax + b.h;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], c = p[(i + 1) % p.length];
        addWall(a[0], a[1], c[0], c[1], b.top, 'building');
      }
      this.buildingPolys.add(minX, minY, maxX, maxY, b);
    }
    this.water = world.water;
    for (const w of world.water) {
      for (const rg of [w.o, ...w.h]) for (let i = 0; i < rg.length; i++) {
        const a = rg[i], c = rg[(i + 1) % rg.length];
        addWall(a[0], a[1], c[0], c[1], w.l + 1.2, 'water');
      }
    }
    for (const wl of world.walls || []) {
      for (let i = 1; i < wl.p.length; i++) {
        const a = wl.p[i - 1], c = wl.p[i];
        addWall(a[0], a[1], c[0], c[1], terrain.at(a[0], a[1]) + wl.ht, 'wall');
      }
    }
    for (const r of world.rocks || []) if (r[2] > 1.1) ring(r[0], r[1], r[2] * 0.75, terrain.at(r[0], r[1]) + r[2], 'post');

    // speed breakers
    this.bumps = new Grid(20);
    for (const b of world.bumps || []) this.bumps.add(b.x - 6, b.y - 6, b.x + 6, b.y + 6, b);
  }

  ground(x, y) {
    return this.terrain.at(x, y);
  }

  // Road surface under (x, y) for a car currently at height `h`. Prefers the
  // surface nearest in height so flyovers and the roads under them stay separate.
  surface(x, y, h, extra = 0.4, maxDh = 2.6) {
    let best = null, bestScore = Infinity;
    for (const s of this.grid.query(x, y, 0)) {
      const q = segDist(x, y, s.ax, s.ay, s.bx, s.by);
      if (q.d > s.w / 2 + extra) continue;
      const sh = s.ah + (s.bh - s.ah) * q.t;
      const dh = Math.abs(sh - h);
      if (dh > maxDh) continue;
      const score = dh * 4 + q.d / s.w;
      if (score < bestScore) {
        bestScore = score;
        // signed lateral offset: positive = right of segment direction
        const cross = (s.bx - s.ax) * (y - s.ay) - (s.by - s.ay) * (x - s.ax);
        best = { seg: s, road: this.roads[s.ri], h: sh, d: q.d, lateral: -Math.sign(cross) * q.d, t: q.t };
      }
    }
    return best;
  }

  // True when (x, y) lies on the carriageway of a road other than `ri` at a
  // similar height: footpaths and kerbs stop there (junctions, side roads).
  onOtherCarriageway(x, y, h, ri, pad = 0.3) {
    for (const s of this.grid.query(x, y, 0)) {
      if (s.ri === ri) continue;
      const q = segDist(x, y, s.ax, s.ay, s.bx, s.by);
      if (q.d > s.w / 2 + pad) continue;
      if (Math.abs(s.ah + (s.bh - s.ah) * q.t - h) < 1.5) return true;
    }
    return false;
  }

  // Height at which something standing at (x, y) rests: the asphalt on a
  // carriageway, the raised footpath beside a kerbed road, else the ground.
  standAt(x, y) {
    const g = this.terrain.at(x, y);
    const s = this.surface(x, y, g, 3, 6);
    if (!s || s.h - g > 0.8) return g;
    const over = s.d - s.seg.w / 2;
    if (over <= 0) return s.h + ROAD_TOP;
    return s.h + ROAD_TOP + (s.road.kerb && over < footpathWidth(s.road) + 0.1 ? KERB : -0.03);
  }

  // Elevated surfaces are walled by parapets: returns the nearest elevated segment
  // if (x, y) is off its deck while the car is up on it.
  nearestElevated(x, y, h) {
    let best = null, bd = Infinity;
    for (const s of this.grid.query(x, y, 12)) {
      const q = segDist(x, y, s.ax, s.ay, s.bx, s.by);
      const sh = s.ah + (s.bh - s.ah) * q.t;
      const gh = this.terrain.at(q.cx, q.cy);
      if (Math.abs(sh - h) > 1.5 || sh - gh < 1.2) continue;
      if (q.d < bd) { bd = q.d; best = { seg: s, q, h: sh }; }
    }
    return best;
  }

  // Height of a speed breaker under (x, y): a 1.6 m long, 9 cm high hump.
  bumpAt(x, y, h) {
    for (const b of this.bumps.query(x, y, 0)) {
      if (Math.abs(b.h - h) > 1.5) continue;
      const fx = Math.sin(b.dir), fy = Math.cos(b.dir);
      const along = (x - b.x) * fx + (y - b.y) * fy;
      const lat = Math.abs(-(x - b.x) * fy + (y - b.y) * fx);
      if (Math.abs(along) < 0.8 && lat < b.w / 2) return 0.09 * Math.cos((Math.PI * along) / 1.6) ** 2;
    }
    return 0;
  }

  bumpAhead(x, y, h, bearing, range = 16) {
    const fx = Math.sin(bearing), fy = Math.cos(bearing);
    let best = null;
    for (const b of this.bumps.query(x + fx * range * 0.5, y + fy * range * 0.5, range)) {
      if (Math.abs(b.h - h) > 1.5) continue;
      const dx = b.x - x, dy = b.y - y;
      const along = dx * fx + dy * fy;
      const lat = Math.abs(-dx * fy + dy * fx);
      if (along > -1 && along < range && lat < b.w / 2 + 1 && (!best || along < best.along)) best = { b, along };
    }
    return best;
  }

  wallsNear(x, y, r) {
    return this.walls.query(x, y, r);
  }

  inBuilding(x, y) {
    for (const b of this.buildingPolys.query(x, y, 0)) if (pointInPolygon(x, y, b.p)) return b;
    return null;
  }

  inWater(x, y) {
    for (const w of this.water) if (pointInPolygon(x, y, w.o) && !w.h.some((ring) => pointInPolygon(x, y, ring))) return w;
    return null;
  }
}
