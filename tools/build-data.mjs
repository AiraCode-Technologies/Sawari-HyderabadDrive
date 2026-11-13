// Turns raw OSM downloads (tools/raw) into compact per-route world files
// (public/data/<id>.json) plus an index (public/data/routes.json).
// Coordinates are local metres from the route's first waypoint: x east, y north.
// Map data © OpenStreetMap contributors, ODbL.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from './routes.config.mjs';
import { loadDem, terrainGrid } from './terrain.mjs';
import { buildExtras, BUILDING_CLASS } from './extras.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, 'raw');
const ELEV = loadDem(join(rawDir, 'dem'));
const outDir = join(here, '..', 'public', 'data');
mkdirSync(outDir, { recursive: true });

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- small geometry helpers ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
function rng(seed) {
  let s = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}
function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}
function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function bearing(a, b) {
  return Math.atan2(b[0] - a[0], b[1] - a[1]); // 0 = north, clockwise positive
}
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
// Point at distance s along a polyline, plus local direction.
function pointAlong(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (s <= l || i === pts.length - 1) {
      const t = l ? Math.min(1, s / l) : 0;
      return {
        p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t],
        dir: bearing(pts[i - 1], pts[i]),
        i,
      };
    }
    s -= l;
  }
  return { p: pts[pts.length - 1], dir: 0, i: pts.length - 1 };
}

// Uniform grid for nearest-thing queries.
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  addBox(minX, minY, maxX, maxY, item) {
    const c = this.cell;
    for (let gx = Math.floor(minX / c); gx <= Math.floor(maxX / c); gx++)
      for (let gy = Math.floor(minY / c); gy <= Math.floor(maxY / c); gy++) {
        const k = `${gx},${gy}`;
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(item);
      }
  }
  near(x, y, r) {
    const c = this.cell, out = new Set();
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
        const arr = this.map.get(`${gx},${gy}`);
        if (arr) for (const it of arr) out.add(it);
      }
    return out;
  }
}

// ---------- road classification ----------
const CLASS = {
  motorway: { lanes: 6, speed: 80, rank: 7, cost: 0.8 },
  trunk: { lanes: 6, speed: 60, rank: 6, cost: 0.85 },
  primary: { lanes: 4, speed: 50, rank: 5, cost: 0.9 },
  secondary: { lanes: 4, speed: 50, rank: 4, cost: 1.0 },
  tertiary: { lanes: 2, speed: 40, rank: 3, cost: 1.15 },
  unclassified: { lanes: 2, speed: 30, rank: 2, cost: 1.4 },
  residential: { lanes: 2, speed: 30, rank: 2, cost: 1.5 },
  living_street: { lanes: 1, speed: 20, rank: 1, cost: 2.5 },
  service: { lanes: 1, speed: 20, rank: 1, cost: 3.0 },
};
function roadInfo(tags) {
  const base = tags.highway.replace('_link', '');
  const cls = CLASS[base] || CLASS.residential;
  const link = tags.highway.endsWith('_link');
  const oneway =
    tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout' ||
    (tags.highway === 'motorway' && tags.oneway !== 'no');
  let lanes = parseInt(tags.lanes, 10);
  if (!(lanes > 0)) lanes = link ? 1 : oneway ? Math.max(1, Math.ceil(cls.lanes / 2)) : cls.lanes;
  const laneW = cls.rank >= 4 ? 3.4 : cls.rank >= 2 ? 3.0 : 2.8;
  let width = parseFloat(tags.width);
  if (!(width > 2 && width < 40)) width = Math.max(link ? 4.5 : 3.5, lanes * laneW);
  let speed = parseInt(tags.maxspeed, 10);
  if (!(speed > 0)) speed = cls.speed;
  return { cls: base, rank: cls.rank, cost: cls.cost * (link ? 1.1 : 1), oneway, reverse: tags.oneway === '-1', lanes, width, speed, link };
}

// ---------- multipolygon ring assembly ----------
function assembleRings(ways) {
  const rings = [];
  const pool = ways.map((w) => w.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (dist(ring[0], ring[ring.length - 1]) > 0.01 && guard++ < 1000) {
      const end = ring[ring.length - 1];
      const idx = pool.findIndex((w) => dist(w[0], end) < 0.01 || dist(w[w.length - 1], end) < 0.01);
      if (idx < 0) break;
      const w = pool.splice(idx, 1)[0];
      ring = ring.concat(dist(w[0], end) < 0.01 ? w.slice(1) : w.slice().reverse().slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// ---------- per-route build ----------
function buildRoute(def) {
  const raw = JSON.parse(readFileSync(join(rawDir, `${def.id}.json`), 'utf8')).elements;
  const waterFile = join(rawDir, `${def.id}.water.json`);
  const waterRel = existsSync(waterFile) ? JSON.parse(readFileSync(waterFile, 'utf8')).elements : [];

  const [lat0, lon0] = def.waypoints[0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const proj = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const geo = (g) => g.map((p) => proj(p.lat, p.lon));
  const nodeKey = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

  // ---- roads + graph ----
  const roads = [];
  for (const e of raw) {
    if (e.type !== 'way' || !e.tags?.highway || !e.geometry) continue;
    const t = e.tags;
    if (t.highway === 'service' && /parking_aisle|driveway|drive-through/.test(t.service || '')) continue;
    if (t.area === 'yes' || t.access === 'private' || t.access === 'no') continue;
    const info = roadInfo(t);
    // add a point at least every 10 m so the road can follow the terrain; the
    // added points get private keys so they never become junctions
    const keys = [], pts = [];
    const orig = geo(e.geometry), rawKeys = e.geometry.map(nodeKey);
    for (let i = 0; i < orig.length; i++) {
      if (i > 0) {
        const a = orig[i - 1], b = orig[i];
        const n = Math.floor(dist(a, b) / 10);
        for (let k = 1; k <= n; k++) {
          const f = k / (n + 1);
          pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
          keys.push(`${rawKeys[i - 1]}>${e.id}:${k}`);
        }
      }
      pts.push(orig[i]);
      keys.push(rawKeys[i]);
    }
    roads.push({
      osm: e.id, name: t.name || t.ref || '', ...info, keys, pts,
      bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no', round: t.junction === 'roundabout',
      // 0 asphalt/concrete, 1 paving stones or setts, 2 unpaved
      surf: /unpaved|gravel|dirt|ground|sand|earth|mud|compacted|fine_gravel/.test(t.surface || '') ? 2 : /paving_stones|sett|cobblestone|bricks/.test(t.surface || '') ? 1 : 0,
      layer: parseInt(t.layer, 10) || 0,
    });
  }

  // node -> incident roads
  const nodeRoads = new Map();
  roads.forEach((r, ri) => r.keys.forEach((k, i) => {
    let arr = nodeRoads.get(k);
    if (!arr) nodeRoads.set(k, (arr = []));
    arr.push([ri, i]);
  }));
  const degree = (k) => {
    let d = 0;
    for (const [ri, i] of nodeRoads.get(k) || []) d += i === 0 || i === roads[ri].keys.length - 1 ? 1 : 2;
    return d;
  };

  // ---- heights: bridges/flyovers lifted, ramps interpolated ----
  // Bridge chains (connected bridge ways) shorter than 80 m are culverts: keep them low.
  const bridgeIdx = roads.map((r, i) => (r.bridge ? i : -1)).filter((i) => i >= 0);
  const parent = new Map(bridgeIdx.map((i) => [i, i]));
  const find = (i) => (parent.get(i) === i ? i : (parent.set(i, find(parent.get(i))), parent.get(i)));
  for (const i of bridgeIdx)
    for (const k of [roads[i].keys[0], roads[i].keys.at(-1)])
      for (const [rj] of nodeRoads.get(k)) if (roads[rj].bridge && rj !== i) parent.set(find(rj), find(i));
  const chainLen = new Map();
  for (const i of bridgeIdx) chainLen.set(find(i), (chainLen.get(find(i)) || 0) + polylineLength(roads[i].pts));
  const nodeH = new Map();
  for (const i of bridgeIdx) {
    const r = roads[i];
    const H = chainLen.get(find(i)) < 80 ? 0.5 : 6.5 * Math.max(1, r.layer);
    r.lift = H;
    for (const k of r.keys) nodeH.set(k, Math.max(nodeH.get(k) || 0, H));
  }
  for (const r of roads) {
    const n = r.pts.length;
    const s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + dist(r.pts[i - 1], r.pts[i]));
    if (r.bridge) {
      r.h = r.pts.map(() => r.lift);
      continue;
    }
    // anchors: elevated nodes (bridge contact) and zero nodes (junctions / ends not on a bridge)
    const anchors = [];
    for (let i = 0; i < n; i++) {
      const k = r.keys[i];
      if (nodeH.has(k)) anchors.push({ i, h: nodeH.get(k) });
      else if (i === 0 || i === n - 1 || degree(k) > 2) anchors.push({ i, h: 0 });
    }
    r.h = r.pts.map((_, i) => {
      let best = 0;
      for (let a = 0; a < anchors.length; a++) {
        const A = anchors[a];
        if (A.h <= 0) continue;
        // distance to the nearest zero anchor on the side of point i
        const dirSign = i >= A.i ? 1 : -1;
        let R = 160;
        for (let b = a + dirSign; b >= 0 && b < anchors.length; b += dirSign)
          if (anchors[b].h === 0) { R = Math.min(R, Math.abs(s[anchors[b].i] - s[A.i])); break; }
        const d = Math.abs(s[i] - s[A.i]);
        best = Math.max(best, A.h * Math.max(0, 1 - d / Math.max(R, 1)));
      }
      return best;
    });
  }

  // ---- real terrain: every height becomes ground elevation + bridge lift ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of roads) for (const p of r.pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const toLatLon = (x, y) => [lat0 + y / ky, lon0 + x / kx];
  const terr = terrainGrid(ELEV, toLatLon, { minX: minX - 300, minY: minY - 300, maxX: maxX + 300, maxY: maxY + 300 }, 10, 4, 3); // ~70 m smoothing: removes building and monument spikes, keeps real hills
  const e0 = terr.sample(0, 0);
  const ground = (x, y) => terr.sample(x, y) - e0;
  for (const r of roads) {
    r.lh = r.h; // lift above the ground
    let base;
    if (r.bridge) {
      // decks span straight between their ends instead of following the valley or lake below
      const a = ground(r.pts[0][0], r.pts[0][1]), b = ground(r.pts.at(-1)[0], r.pts.at(-1)[1]);
      const total = polylineLength(r.pts) || 1;
      let s = 0;
      base = r.pts.map((p, i) => {
        if (i) s += dist(r.pts[i - 1], p);
        return a + ((b - a) * s) / total;
      });
    } else base = r.pts.map((p) => ground(p[0], p[1]));
    r.h = base.map((v, i) => v + r.lh[i]);
  }

  // ---- routing graph (directed) ----
  const adj = new Map();
  const addEdge = (a, b, ri, ia, ib, len) => {
    let arr = adj.get(a);
    if (!arr) adj.set(a, (arr = []));
    arr.push({ from: a, to: b, ri, ia, ib, len });
  };
  roads.forEach((r, ri) => {
    if (r.tunnel) return;
    for (let i = 1; i < r.keys.length; i++) {
      const len = dist(r.pts[i - 1], r.pts[i]);
      if (!r.oneway || !r.reverse) addEdge(r.keys[i - 1], r.keys[i], ri, i - 1, i, len);
      if (!r.oneway || r.reverse) addEdge(r.keys[i], r.keys[i - 1], ri, i, i - 1, len);
    }
  });
  const nodePos = new Map();
  roads.forEach((r) => r.keys.forEach((k, i) => nodePos.set(k, r.pts[i])));

  // Route-able nodes near a waypoint (optionally only on roads named `on`), best first.
  // `hdg` (degrees, 0 = north, clockwise) keeps only nodes with an outgoing edge
  // heading that way, which picks the right carriageway of a divided road.
  function nearestNodes(p, on, hdg, n = 8) {
    const c = [];
    for (const [k, arr] of adj) {
      const named = arr.filter((e) => {
        const r = roads[e.ri];
        if (r.rank < 2 || (on && !on.test(r.name))) return false;
        if (hdg === undefined) return true;
        return Math.abs(angleDiff(bearing(nodePos.get(k), nodePos.get(e.to)), (hdg * Math.PI) / 180)) < Math.PI / 3;
      });
      if (!named.length) continue;
      c.push({ k, d: dist(nodePos.get(k), p) });
    }
    if (!c.length) throw new Error(`${def.id}: no road near waypoint ${p} matching ${on}`);
    return c.sort((a, b) => a.d - b.d).slice(0, n);
  }
  // Multi-target search: `dst` maps candidate node -> extra cost (its distance from
  // the waypoint), so the cheapest path + snap distance wins.
  function dijkstra(src, dstCost) {
    const dst = new Set(dstCost.keys());
    const D = new Map([[src, 0]]), prev = new Map(), reached = new Set();
    const heap = [[0, src]];
    const goal = nodePos.get(dst.values().next().value);
    while (heap.length) {
      // binary heap pop
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1, rr = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      const [f, u] = top;
      if (dst.has(u)) {
        reached.add(u);
        if (reached.size === dst.size) break; // every candidate settled
      }
      const du = D.get(u);
      if (f - dist(nodePos.get(u), goal) * 0.5 > du + 1e-6) continue;
      for (const e of adj.get(u) || []) {
        const r = roads[e.ri];
        const nd = du + e.len * r.cost * (def.prefer.test(r.name) ? 0.35 : 1);
        if (nd < (D.get(e.to) ?? Infinity)) {
          D.set(e.to, nd);
          prev.set(e.to, { from: u, e });
          const pr = nd + dist(nodePos.get(e.to), goal) * 0.5;
          heap.push([pr, e.to]);
          for (let i = heap.length - 1; i > 0; ) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
          }
        }
      }
    }
    let best = null, bc = Infinity;
    for (const [k, extra] of dstCost) if (D.has(k) && D.get(k) + extra < bc) { bc = D.get(k) + extra; best = k; }
    if (!best) return null;
    const edges = [];
    for (let k = best; k !== src; k = prev.get(k).from) edges.push(prev.get(k).e);
    return { edges: edges.reverse(), end: best, cost: bc };
  }
  // Chain the legs: try each start candidate, keep the cheapest complete chain.
  const cands = def.waypoints.map((w) => nearestNodes(proj(w[0], w[1]), w[2], w[3]));
  let edges = null, bestCost = Infinity;
  for (const first of cands[0]) {
    let cur = first.k, acc = [], cost = first.d * 3;
    for (let i = 1; i < cands.length && acc; i++) {
      const leg = dijkstra(cur, new Map(cands[i].map((c) => [c.k, c.d * 3])));
      if (!leg || !leg.edges.length) { acc = null; break; }
      acc = acc.concat(leg.edges);
      cost += leg.cost;
      cur = leg.end;
    }
    if (acc && cost < bestCost) { bestCost = cost; edges = acc; }
  }
  if (!edges) throw new Error(`${def.id}: no path between waypoints`);
  const startNode = edges[0].from;

  // ---- route polyline, drive line (keep left), instructions ----
  const routePts = [nodePos.get(startNode)];
  const routeH = [roads[edges[0].ri].h[edges[0].ia]];
  const routeL = [roads[edges[0].ri].lh[edges[0].ia]]; // lift above the ground
  const segRoad = []; // road index per segment
  for (const e of edges) {
    routePts.push(nodePos.get(e.to));
    routeH.push(roads[e.ri].h[e.ib]);
    routeL.push(roads[e.ri].lh[e.ib]);
    segRoad.push(e.ri);
  }
  // lateral offset to the left of travel (India drives on the left)
  // Keep-left drive line. Recomputed after the carriageway widths are final
  // (divided roads can be narrowed where their halves overlap).
  const computeDrive = () => {
    const segOffset = segRoad.map((ri) => {
      const r = roads[ri];
      if (!r.oneway) return Math.min(r.width / 4, 2.6);
      return r.lanes >= 2 ? r.width / 2 - r.width / r.lanes / 2 : 0;
    });
    return routePts.map((p, i) => {
      const a = routePts[Math.max(0, i - 1)], b = routePts[Math.min(routePts.length - 1, i + 1)];
      const len = dist(a, b) || 1;
      const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
      const o = Math.min(segOffset[Math.max(0, i - 1)], segOffset[Math.min(segOffset.length - 1, i)]);
      // left normal of direction (dx, dy) is (-dy, dx)
      return [r1(p[0] - dy * o), r1(p[1] + dx * o), r1(routeH[i])];
    });
  };
  let drive = computeDrive();
  const along = [0];
  for (let i = 1; i < routePts.length; i++) along.push(along[i - 1] + dist(routePts[i - 1], routePts[i]));

  const instructions = [];
  const nameAt = (seg) => roads[segRoad[seg]].name;
  for (let i = 1; i < routePts.length - 1; i++) {
    const k = edges[i - 1].to;
    const inDir = pointAlong([routePts[i], ...routePts.slice(Math.max(0, i - 6), i).reverse()], 15);
    const outDir = pointAlong(routePts.slice(i), 15);
    const din = bearing(inDir.p, routePts[i]);
    const dout = bearing(routePts[i], outDir.p);
    const turn = angleDiff(din, dout);
    const deg = Math.abs(turn) * 180 / Math.PI;
    const junction = degree(k) > 2;
    const prevName = nameAt(i - 1), nextName = nameAt(i);
    let type = null;
    if (junction && deg > 140) type = 'uturn';
    else if (junction && deg > 100) type = turn > 0 ? 'sharp-right' : 'sharp-left';
    else if (junction && deg > 45) type = turn > 0 ? 'right' : 'left';
    else if (junction && deg > 22) type = turn > 0 ? 'slight-right' : 'slight-left';
    else if (junction && nextName && nextName !== prevName) type = 'continue';
    if (!type) continue;
    // following the same road around a bend or roundabout needs no prompt
    if (type.startsWith('slight') && prevName && prevName === nextName) continue;
    const prev = instructions.at(-1);
    if (prev && along[i] - prev.at < 20) {
      if (type !== 'continue') { prev.type = type; prev.street = nextName || prev.street; }
      continue;
    }
    instructions.push({ at: r1(along[i]), type, street: nextName, x: r1(routePts[i][0]), y: r1(routePts[i][1]) });
  }
  const total = along.at(-1);
  instructions.push({ at: r1(total), type: 'arrive', street: def.name, x: r1(routePts.at(-1)[0]), y: r1(routePts.at(-1)[1]) });
  const startDir = bearing(routePts[0], pointAlong(routePts, 12).p);

  // ---- area of interest: everything within 650 m of the route ----
  const routeGrid = new Grid(100);
  for (let i = 1; i < routePts.length; i++) {
    const a = routePts[i - 1], b = routePts[i];
    routeGrid.addBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), i);
  }
  function routeDist(p, cap = 700) {
    let best = Infinity;
    for (const i of routeGrid.near(p[0], p[1], cap)) best = Math.min(best, segDist(p, routePts[i - 1], routePts[i]));
    return best;
  }
  const KEEP = 650;

  // ---- water, parks ----
  const water = [];
  for (const rel of waterRel) {
    const outer = assembleRings(rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geo(m.geometry)));
    const inner = assembleRings(rel.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => geo(m.geometry)));
    for (const o of outer) water.push({ outer: o, holes: inner.filter((h) => pointInPolygon(h[0], o)) });
  }
  const parks = [];
  for (const e of raw) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
    const t = e.tags || {};
    const ring = geo(e.geometry);
    if (dist(ring[0], ring.at(-1)) > 0.5) continue;
    if (t.natural === 'water') water.push({ outer: ring, holes: [] });
    else if (t.leisure || t.landuse) parks.push(ring);
  }
  const waterNear = water.filter((w) => w.outer.some((p) => routeDist(p, 2500) < 2500));
  const parksNear = parks.filter((p) => routeDist(centroid(p)) < KEEP);
  const inWater = (p) => waterNear.some((w) => pointInPolygon(p, w.outer) && !w.holes.some((h) => pointInPolygon(p, h)));

  // ---- road spatial index (for placement checks) ----
  const roadsNear = roads.filter((r) => r.pts.some((p) => routeDist(p) < KEEP + 100));
  const roadGrid = new Grid(40);
  roadsNear.forEach((r) => {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      roadGrid.addBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), [r, i]);
    }
  });
  const clearOfRoads = (p, margin) => {
    for (const [r, i] of roadGrid.near(p[0], p[1], 30)) if (segDist(p, r.pts[i - 1], r.pts[i]) < r.width / 2 + margin) return false;
    return true;
  };

  // ---- keep buildings off carriageways and footpaths ----
  // OSM footprints and our estimated road widths do not always agree, so any
  // footprint corner inside a road corridor is pushed back to its edge.
  const corridor = (r) => r.width / 2 + (r.rank >= 3 ? 2.4 : r.rank >= 2 ? 1.4 : 0.3) + 0.3;
  function clearRing(ring) {
    // densify long edges so a road crossing an edge is caught too
    let pts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(dist(a, b) / 3));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, k === 0]);
    }
    let moved = false;
    for (let pass = 0; pass < 2; pass++)
      for (const p of pts)
        for (const [r, i] of roadGrid.near(p[0], p[1], 20)) {
          if (Math.min(r.lh[i - 1], r.lh[i]) > 1) continue; // flyovers pass over buildings
          const a = r.pts[i - 1], b = r.pts[i];
          const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
          const cx = a[0] + dx * t, cy = a[1] + dy * t;
          const d = Math.hypot(p[0] - cx, p[1] - cy), lim = corridor(r);
          if (d >= lim) continue;
          const nx = d > 1e-3 ? (p[0] - cx) / d : -dy / Math.sqrt(l2), ny = d > 1e-3 ? (p[1] - cy) / d : dx / Math.sqrt(l2);
          p[0] = cx + nx * lim;
          p[1] = cy + ny * lim;
          moved = true;
        }
    // drop the densified points that are not needed (original corners or a real bend)
    if (moved) {
      const keep = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        const cross = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]));
        return p[2] || cross > 0.6;
      });
      pts = keep;
    } else pts = ring.map((p) => [p[0], p[1]]);
    pts = pts.map((p) => [p[0], p[1]]);
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < 15) return null;
    // a road running through the footprint (not just clipping a corner) means the
    // footprint and the road disagree: drop the building rather than block the road
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const reach = Math.max(bx1 - bx0, by1 - by0);
    for (const [r, i] of roadGrid.near((bx0 + bx1) / 2, (by0 + by1) / 2, reach)) {
      if (Math.min(r.lh[i - 1], r.lh[i]) > 1) continue;
      const a = r.pts[i - 1], b = r.pts[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / 2));
      for (let k = 0; k <= n; k++) {
        const q = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (q[0] < bx0 || q[0] > bx1 || q[1] < by0 || q[1] > by1) continue;
        if (pointInPolygon(q, pts)) return null;
      }
    }
    return { ring: pts, moved };
  }

  // ---- context from the wider map: land use, rocks, walls, metro, stops, medians ----
  const extraFile = join(rawDir, `${def.id}.extra.json`);
  const extra = existsSync(extraFile) ? JSON.parse(readFileSync(extraFile, 'utf8')).elements : [];
  const X = buildExtras({
    def, extra, geo, proj, ground, roads: roadsNear, roadGrid, routeDist, KEEP, inWater, clearOfRoads, degree,
    H: { hash, rng, dist, polylineLength, polygonArea, centroid, pointInPolygon, segDist, bearing, angleDiff, pointAlong, Grid, r1 },
  });
  drive = computeDrive(); // widths may have changed

  // ---- buildings ----
  const landmarks = [];
  const buildings = [];
  const bGrid = new Grid(30);
  const oldCity = def.id === 'charminar';
  let droppedBuildings = 0, trimmedBuildings = 0;
  for (const e of raw) {
    if (e.type !== 'way' || !e.tags?.building || !e.geometry || e.geometry.length < 4) continue;
    let ring = geo(e.geometry);
    if (dist(ring[0], ring.at(-1)) < 0.01) ring = ring.slice(0, -1);
    if (ring.length < 3) continue;
    const c = centroid(ring);
    if (routeDist(c) > KEEP) continue;
    const name = e.tags.name || '';
    if (/^Charminar$/i.test(name)) { landmarks.push({ type: 'charminar', x: r1(c[0]), y: r1(c[1]) }); continue; }
    if (/^Buddha Statue/i.test(name)) { landmarks.push({ type: 'buddha', x: r1(c[0]), y: r1(c[1]) }); continue; }
    const cleared = clearRing(ring);
    if (!cleared) { droppedBuildings++; continue; }
    if (cleared.moved) trimmedBuildings++;
    ring = cleared.ring;
    const area = Math.abs(polygonArea(ring));
    if (area < 12) continue;
    const cls = X.classify(e.tags, ring, area, c, oldCity);
    let h = parseFloat(e.tags.height);
    const lv = parseFloat(e.tags['building:levels']);
    if (!(h > 2 && h < 300)) {
      const levels = lv > 0 ? lv : X.levelsFor(cls, area, hash(String(e.id)), oldCity);
      h = cls === 'temple' ? 6 : cls === 'industrial' ? 7 : levels * 3.3 + 0.6;
    }
    if (polygonArea(ring) < 0) ring.reverse(); // counter-clockwise
    buildings.push({ p: ring.map((q) => [r1(q[0]), r1(q[1])]), h: r1(h), c: Math.floor(hash('c' + e.id) * 6), k: BUILDING_CLASS[cls] });
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    bGrid.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), ring);
  }

  // ---- buildings must never overlap each other ----
  // Overlaps are tested on footprints pulled in by 0.25 m, so terraced neighbours
  // that share a wall are fine but real overlaps are caught.
  const shrink = (R, d) => {
    const c = centroid(R);
    return R.map((q) => {
      const dx = q[0] - c[0], dy = q[1] - c[1], l = Math.hypot(dx, dy) || 1;
      return [q[0] - (dx / l) * Math.min(d, l * 0.5), q[1] - (dy / l) * Math.min(d, l * 0.5)];
    });
  };
  const segCross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const ringsOverlap = (A0, B0) => {
    const A = shrink(A0, 0.25), B = shrink(B0, 0.25);
    if (A.some((q) => pointInPolygon(q, B)) || B.some((q) => pointInPolygon(q, A))) return true;
    for (let i = 0; i < A.length; i++)
      for (let j = 0; j < B.length; j++) if (segCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    return false;
  };
  const kept = new Grid(30);
  const keep = (b) => {
    const xs = b.p.map((q) => q[0]), ys = b.p.map((q) => q[1]);
    kept.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), b);
  };
  const overlapsKept = (ring) => {
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 2;
    for (const b of kept.near(cx, cy, reach)) if (ringsOverlap(ring, b.p)) return true;
    return false;
  };
  const overlapsKeptAlive = (ring) => {
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 2;
    for (const b of kept.near(cx, cy, reach)) if (!b.dead && ringsOverlap(ring, b.p)) return true;
    return false;
  };
  let overlapDropped = 0;
  {
    const byArea = buildings.slice().sort((x, y) => Math.abs(polygonArea(y.p)) - Math.abs(polygonArea(x.p)));
    const ok = new Set();
    for (const b of byArea) {
      if (overlapsKept(b.p)) { overlapDropped++; continue; }
      keep(b);
      ok.add(b);
    }
    for (let i = buildings.length - 1; i >= 0; i--) if (!ok.has(buildings[i])) buildings.splice(i, 1);
  }

  // ---- continuous street frontage where OSM has no buildings mapped ----
  // Hyderabad streets are lined wall to wall with buildings; OSM coverage has
  // gaps, so narrow plots are filled in along both sides of every road near the
  // route (estimated), set back to the footpath line and never over a road,
  // a junction mouth, water, a park or an existing building.
  const rand = rng(hash(def.id));
  let filler = 0;
  const junctionPts = new Grid(40);
  for (const r of roadsNear) r.keys.forEach((k, i) => { if (degree(k) > 2) junctionPts.addBox(r.pts[i][0], r.pts[i][1], r.pts[i][0], r.pts[i][1], r.pts[i]); });
  const nearJunction = (q, d) => {
    for (const j of junctionPts.near(q[0], q[1], d)) if (dist(j, q) < d) return true;
    return false;
  };
  // any road centre line (flyovers included) passing through an estimated plot
  const ringHitsRoad = (ring) => {
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (const [r, i] of roadGrid.near((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2 + 2)) {
      const a = r.pts[i - 1], b = r.pts[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / 1.5));
      for (let k = 0; k <= n; k++) {
        const q = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1 && pointInPolygon(q, ring)) return true;
      }
    }
    return false;
  };
  const clearOfCorridors = (q) => {
    for (const [r, i] of roadGrid.near(q[0], q[1], 25)) {
      if (Math.min(r.lh[i - 1], r.lh[i]) > 1) continue;
      if (segDist(q, r.pts[i - 1], r.pts[i]) < corridor(r)) return false;
    }
    return true;
  };
  for (const r of roadsNear) {
    if (r.rank < 2 || r.link || r.cls === 'service' || r.lh.some((v) => v > 0.6)) continue;
    const len = polylineLength(r.pts);
    const main = r.rank >= 3;
    for (const side of [-1, 1]) {
      for (let s = 4; s < len - 4; ) {
        const widthAlong = oldCity ? 4 + rand() * 4 : main ? 6 + rand() * 6 : 7 + rand() * 6;
        const here = s + widthAlong / 2;
        s += widthAlong + (rand() < 0.12 ? 2 + rand() * 4 : 0); // the odd gap or lane between plots
        if (here > len - 3) break;
        const { p, dir } = pointAlong(r.pts, here);
        if (routeDist(p) > 320) continue;
        if (nearJunction(p, r.width / 2 + 9)) continue;
        const depth = oldCity ? 8 + rand() * 5 : 9 + rand() * 7;
        const off = corridor(r) + 0.3 + depth / 2;
        const nx = Math.cos(dir) * side, ny = -Math.sin(dir) * side;
        const cx = p[0] + nx * off, cy = p[1] + ny * off;
        const fx = Math.sin(dir), fy = Math.cos(dir);
        const corners = [
          [cx - fx * widthAlong / 2 - nx * depth / 2, cy - fy * widthAlong / 2 - ny * depth / 2],
          [cx + fx * widthAlong / 2 - nx * depth / 2, cy + fy * widthAlong / 2 - ny * depth / 2],
          [cx + fx * widthAlong / 2 + nx * depth / 2, cy + fy * widthAlong / 2 + ny * depth / 2],
          [cx - fx * widthAlong / 2 + nx * depth / 2, cy - fy * widthAlong / 2 + ny * depth / 2],
        ];
        if (inWater([cx, cy]) || corners.some(inWater)) continue;
        if (!corners.every(clearOfCorridors) || !clearOfCorridors([cx, cy])) continue;
        if (parksNear.some((pk) => pointInPolygon([cx, cy], pk))) continue;
        const ring = polygonArea(corners) < 0 ? corners.slice().reverse() : corners;
        if (overlapsKept(ring) || ringHitsRoad(ring)) continue;
        const shopsHere = main || hash(`${r.osm}${Math.round(here)}`) < 0.25;
        const levels = oldCity ? 1 + Math.floor(rand() * 3) : def.id === 'hitec-city' && main ? 3 + Math.floor(rand() * 5) : shopsHere ? 2 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 3);
        const b = { p: ring.map((q) => [r1(q[0]), r1(q[1])]), h: r1(levels * 3.3 + 0.6), c: Math.floor(rand() * 6), f: 1, k: shopsHere ? BUILDING_CLASS.shops : BUILDING_CLASS.house };
        buildings.push(b);
        keep(b);
        bGrid.addBox(Math.min(...ring.map((q) => q[0])), Math.min(...ring.map((q) => q[1])), Math.max(...ring.map((q) => q[0])), Math.max(...ring.map((q) => q[1])), ring);
        filler++;
      }
    }
  }

  // ---- temples, mosques and churches from OSM places of worship ----
  // A mapped point inside (or right beside) a building gives that building its
  // architecture; a point with no building gets a modest one of its own where
  // there is room. Each place also draws parked two-wheelers, an auto and a
  // flower stall outside, and people gathering (see the pedestrians module).
  const worshipFile = join(rawDir, `${def.id}.worship.json`);
  const worshipRaw = existsSync(worshipFile) ? JSON.parse(readFileSync(worshipFile, 'utf8')).elements : [];
  const worship = [];
  const worshipStalls = [], worshipParked = [];
  for (const e of worshipRaw) {
    const t = e.tags || {};
    const ll = e.center || e;
    if (ll.lat === undefined) continue;
    const pt = proj(ll.lat, ll.lon);
    if (routeDist(pt) > 450) continue;
    const name = (t.name || '').trim();
    const kind = t.religion === 'muslim' || /masjid|mosque|dargah/i.test(name) ? 'mosque' : t.religion === 'christian' || /church|chapel/i.test(name) ? 'church' : 'temple';
    let target = null, bd = 25;
    for (const b of kept.near(pt[0], pt[1], 25)) {
      if (b.dead) continue;
      if (pointInPolygon(pt, b.p)) { target = b; break; }
      const d = dist(centroid(b.p), pt);
      if (d < bd && Math.abs(polygonArea(b.p)) < 2500) { bd = d; target = b; }
    }
    let nr = null;
    for (const [r, i] of roadGrid.near(pt[0], pt[1], 60)) {
      if (r.rank < 2 || r.lh[i] > 0.6) continue;
      const d = segDist(pt, r.pts[i - 1], r.pts[i]);
      if (!nr || d < nr.d) nr = { r, i, d, dir: bearing(r.pts[i - 1], r.pts[i]) };
    }
    if (!target && nr) {
      // a modest building of its own, set back from the road and facing it
      const [wAlong, depth] = kind === 'church' ? [11, 18] : kind === 'mosque' ? [14, 14] : [9, 11];
      const a = nr.r.pts[nr.i - 1], b = nr.r.pts[nr.i];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2));
      const sideSign = Math.sign(dx * (pt[1] - a[1]) - dy * (pt[0] - a[0])) < 0 ? 1 : -1;
      const nx = Math.cos(nr.dir) * sideSign, ny = -Math.sin(nr.dir) * sideSign;
      const fx = Math.sin(nr.dir), fy = Math.cos(nr.dir);
      for (const extra of [0, 4, 8]) {
        const off = corridor(nr.r) + 0.5 + depth / 2 + extra;
        const cx = a[0] + dx * tt + nx * off, cy = a[1] + dy * tt + ny * off;
        const ring = [
          [cx - fx * wAlong / 2 - nx * depth / 2, cy - fy * wAlong / 2 - ny * depth / 2],
          [cx + fx * wAlong / 2 - nx * depth / 2, cy + fy * wAlong / 2 - ny * depth / 2],
          [cx + fx * wAlong / 2 + nx * depth / 2, cy + fy * wAlong / 2 + ny * depth / 2],
          [cx - fx * wAlong / 2 + nx * depth / 2, cy - fy * wAlong / 2 + ny * depth / 2],
        ];
        if (!ring.every(clearOfCorridors) || ring.some(inWater) || ringHitsRoad(ring)) continue;
        // a mapped place of worship takes precedence over estimated filler plots
        for (const fb of kept.near(cx, cy, 20)) if (fb.f && ringsOverlap(ring, fb.p)) fb.dead = true;
        if (overlapsKeptAlive(ring)) continue;
        const ccw = polygonArea(ring) < 0 ? ring.slice().reverse() : ring;
        target = { p: ccw.map((q) => [r1(q[0]), r1(q[1])]), h: 6, c: 0, k: BUILDING_CLASS[kind] };
        buildings.push(target);
        keep(target);
        break;
      }
    }
    if (!target) continue;
    target.k = BUILDING_CLASS[kind];
    if (!(target.h > 4)) target.h = 6;
    if (kind === 'temple' && target.h > 14 && Math.abs(polygonArea(target.p)) < 600) target.h = 7;
    if (name && name.length <= 28) {
      target.s ||= [];
      if (!target.s.includes(name)) target.s.unshift(name);
      target.s = target.s.slice(0, 2);
    }
    const c = centroid(target.p);
    worship.push({ x: r1(c[0]), y: r1(c[1]), k: kind, n: name });
    // life outside: parked two-wheelers, an auto waiting for a fare, a flower stall
    if (nr) {
      const r = nr.r, a = r.pts[nr.i - 1], b = r.pts[nr.i];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2));
      const sideSign = Math.sign(dx * (c[1] - a[1]) - dy * (c[0] - a[0])) < 0 ? 1 : -1;
      const nx = Math.cos(nr.dir) * sideSign, ny = -Math.sin(nr.dir) * sideSign, fx = Math.sin(nr.dir), fy = Math.cos(nr.dir);
      const bx = a[0] + dx * tt, by = a[1] + dy * tt;
      const hh = r.h[nr.i];
      for (let k = -4; k <= 4; k++) {
        const along = k * 1.1 + 6;
        const q = [bx + fx * along + nx * (r.width / 2 + 0.9), by + fy * along + ny * (r.width / 2 + 0.9)];
        if (!clearOfRoads(q, 0.3)) continue;
        worshipParked.push({ x: r1(q[0]), y: r1(q[1]), h: r1(hh), dir: r1(nr.dir), t: ((k + 9) * 5) % 55, side: sideSign });
      }
      const qa = [bx - fx * 7 + nx * (r.width / 2 + 0.4), by - fy * 7 + ny * (r.width / 2 + 0.4)];
      worshipParked.push({ x: r1(qa[0]), y: r1(qa[1]), h: r1(hh), dir: r1(nr.dir), t: 61, side: sideSign });
      const qs = [bx + nx * (corridor(r) - 0.4), by + ny * (corridor(r) - 0.4)];
      if (clearOfRoads(qs, 0.8)) worshipStalls.push({ x: r1(qs[0]), y: r1(qs[1]), h: r1(hh), dir: r1(nr.dir), t: 4 });
    }
  }
  for (let i = buildings.length - 1; i >= 0; i--) if (buildings[i].dead) buildings.splice(i, 1);

  // ---- real shop, restaurant and bank names onto their buildings ----
  const poiFile = join(rawDir, `${def.id}.pois.json`);
  const pois = existsSync(poiFile) ? JSON.parse(readFileSync(poiFile, 'utf8')).elements : [];
  const bIndex = new Grid(30);
  for (const b of buildings) {
    const xs = b.p.map((q) => q[0]), ys = b.p.map((q) => q[1]);
    bIndex.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), b);
  }
  let named = 0;
  const signNames = [];
  for (const e of pois) {
    const name = (e.tags?.name || '').trim();
    if (!name || name.length > 28) continue;
    const ll = e.center || e;
    if (ll.lat === undefined) continue;
    const p = proj(ll.lat, ll.lon);
    if (routeDist(p) > 400) continue;
    let target = null, bd = 25;
    for (const b of bIndex.near(p[0], p[1], 25)) {
      if (pointInPolygon(p, b.p)) { target = b; break; }
      const d = dist(centroid(b.p), p);
      if (d < bd) { bd = d; target = b; }
    }
    if (!target) continue;
    target.s ||= [];
    // keep the Telugu name alongside when OSM has one: "English|తెలుగు"
    const te = (e.tags['name:te'] || '').trim();
    const label = te && te !== name ? `${name}|${te}` : name;
    if (target.s.length < 2 && !target.s.includes(label)) {
      target.s.push(label);
      named++;
      if (!signNames.includes(name)) signNames.push(name);
    }
  }

  // ---- street stalls and parked vehicles (estimated: OSM does not map these) ----
  const routeRoadSet = new Set(segRoad.map((ri) => roads[ri]));
  const stalls = [], parked = [];
  stalls.push(...worshipStalls);
  parked.push(...worshipParked);
  const sidePoint = (r, s, side, off) => {
    const { p, dir, i } = pointAlong(r.pts, s);
    const rx = Math.cos(dir) * side, ry = -Math.sin(dir) * side;
    return { x: p[0] + rx * off, y: p[1] + ry * off, dir, h: r.h[Math.min(i, r.h.length - 1)], i };
  };
  const nearShops = (q, d = 22) => {
    for (const b of bIndex.near(q[0], q[1], d)) if (b.k === BUILDING_CLASS.shops || b.s) return true;
    return false;
  };
  for (const r of roadsNear) {
    if (r.lift > 1 || r.lh.some((v) => v > 0.6)) continue;
    const len = polylineLength(r.pts);
    // handcarts and tea stalls on the footpaths of busy shopping streets
    if (r.rank >= 3) {
      for (let s = 15; s < len - 10; s += 22) {
        const q = sidePoint(r, s, hash(`${r.osm}st${s}`) < 0.5 ? 1 : -1, r.width / 2 + 1.3);
        if (routeDist([q.x, q.y]) > 350 || hash(`${r.osm}sp${s}`) > 0.28 || !nearShops([q.x, q.y])) continue;
        // stalls stand on the footpath, never on any carriageway or inside a building
        if (!clearOfRoads([q.x, q.y], 0.8)) continue;
        let inside = false;
        for (const b of bIndex.near(q.x, q.y, 3)) if (pointInPolygon([q.x, q.y], b.p)) inside = true;
        if (inside) continue;
        stalls.push({ x: r1(q.x), y: r1(q.y), h: r1(q.h), dir: r1(q.dir), t: Math.floor(hash(`${r.osm}t${s}`) * 4) });
      }
    }
    // cars and bikes parked along the kerb of side streets (never on the route itself)
    if (r.rank >= 2 && r.rank <= 4 && !routeRoadSet.has(r) && !r.bridge) {
      for (let s = 10; s < len - 8; s += 7) {
        // one-way streets park on the left kerb of travel; two-way on either side
        const side = r.oneway ? (r.reverse ? -1 : 1) : hash(`${r.osm}ps${s}`) < 0.5 ? 1 : -1;
        const t = Math.floor(hash(`${r.osm}pt${s}`) * 100);
        const bike = t < 55;
        // bikes stand on the footpath, cars half up on it, as on Hyderabad side streets
        const q = sidePoint(r, s, -side, r.width / 2 + (bike ? 0.9 : 0.4));
        if (routeDist([q.x, q.y]) > 300 || hash(`${r.osm}pp${s}`) > 0.32 || !nearShops([q.x, q.y], 18)) continue;
        parked.push({ x: r1(q.x), y: r1(q.y), h: r1(q.h), dir: r1(q.dir + (hash(`${r.osm}pd${s}`) < 0.5 ? 0 : Math.PI)), t, side: -side });
      }
    }
  }
  // stalls cluster at bus stops and metro stations too
  for (const b of [...X.busStops, ...X.stations.map((s) => ({ ...s, h: ground(s.x, s.y) }))]) {
    for (let k = 0; k < 2; k++) {
      const a = hash(`${b.x}${b.y}${k}`) * Math.PI * 2;
      const q = [b.x + Math.cos(a) * (6 + k * 3), b.y + Math.sin(a) * (6 + k * 3)];
      if (!clearOfRoads(q, 0.8) || inWater(q)) continue;
      let inside = false;
      for (const bb of bIndex.near(q[0], q[1], 3)) if (pointInPolygon(q, bb.p)) inside = true;
      if (inside) continue;
      stalls.push({ x: r1(q[0]), y: r1(q[1]), h: r1(ground(q[0], q[1])), dir: r1(a), t: Math.floor(hash(`${b.x}t${k}`) * 4) });
    }
  }

  // ---- advertising hoardings on poles beside main roads (estimated) ----
  const hoardings = [];
  for (const r of roadsNear) {
    if (r.rank < 4 || r.lh.some((v) => v > 0.6)) continue;
    const len = polylineLength(r.pts);
    for (let s = 60; s < len - 30; s += 170) {
      const { p, dir } = pointAlong(r.pts, s);
      if (routeDist(p) > 260 || hash(`${r.osm}ad${s}`) > 0.55) continue;
      const side = r.oneway ? (r.reverse ? 1 : -1) : hash(`${r.osm}as${s}`) < 0.5 ? 1 : -1;
      const off = corridor(r) + 1.2;
      const q = [p[0] + Math.cos(dir) * side * off, p[1] - Math.sin(dir) * side * off];
      if (!clearOfCorridors(q) || inWater(q)) continue;
      let blocked = false;
      for (const b of kept.near(q[0], q[1], 6)) if (pointInPolygon(q, b.p)) blocked = true;
      if (blocked) continue;
      // `dir` is where the board faces: back towards traffic on its side (India keeps left)
      hoardings.push({ x: r1(q[0]), y: r1(q[1]), h: r1(ground(q[0], q[1])), dir: r1(dir + (side > 0 ? 0 : Math.PI)), t: Math.floor(hash(`${r.osm}at${s}`) * 8) });
    }
  }

  // ---- trees: OSM trees, park fill, roadside rows ----
  const trees = [];
  for (const e of raw) if (e.type === 'node' && e.tags?.natural === 'tree') {
    const p = proj(e.lat, e.lon);
    if (routeDist(p) < KEEP && clearOfRoads(p, 0.3)) trees.push([r1(p[0]), r1(p[1]), r1(0.8 + rand() * 0.6), 0]); // mapped trees, kept off the carriageway
  }
  for (const pk of parksNear) {
    const xs = pk.map((q) => q[0]), ys = pk.map((q) => q[1]);
    const area = Math.abs(polygonArea(pk));
    const n = Math.min(120, Math.floor(area / 260));
    for (let k = 0; k < n * 3 && k < 400; k++) {
      const q = [Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys))];
      if (pointInPolygon(q, pk) && clearOfRoads(q, 2) && !inWater(q)) trees.push([r1(q[0]), r1(q[1]), r1(0.7 + rand() * 0.8), [0, 0, 1, 3][Math.floor(rand() * 4)]]);
    }
  }
  // Street lights and roadside trees, laid out the way Hyderabad roads are:
  //  - divided roads: double-arm lamps on the central median every ~32 m,
  //    and trees in the median where it is wide enough to be planted
  //  - other main roads: single-arm lamps on the footpath edge, alternating sides
  //  - trees along the back of the footpath, never on a carriageway
  // OSM maps almost no lamps or roadside trees here, so these positions are estimated.
  const lights = [];
  const lightSeen = new Set();
  const addLight = (q, ang, type) => {
    const key = `${Math.round(q[0] / 6)},${Math.round(q[1] / 6)}`;
    if (lightSeen.has(key)) return;
    lightSeen.add(key);
    lights.push([r1(q[0]), r1(q[1]), r1(ang), type]);
  };
  const inBuildingAt = (q) => {
    for (const ring of bGrid.near(q[0], q[1], 4)) if (pointInPolygon(q, ring)) return true;
    return false;
  };
  for (const r of roadsNear) {
    if (r.rank < 2 || r.lh.some((v) => v > 1)) continue;
    const len = polylineLength(r.pts);
    const travel = r.reverse ? -1 : 1; // +1 when drawing order is the travel direction
    const sw = r.rank >= 3 ? 2.4 : 1.4;
    for (let s = 6; s < len - 3; s += 8) {
      const { p, dir, i } = pointAlong(r.pts, s);
      if (routeDist(p) > 300) continue;
      const m = r.median ? Math.min(r.median[i - 1] ?? 0, r.median[i] ?? 0) : 0;
      const rx = Math.cos(dir) * travel, ry = -Math.sin(dir) * travel; // right of travel
      const k = Math.floor(s / 8);
      if (m > 0.3) {
        // median: centre line between the two carriageways
        const off = r.width / 2 + m;
        const q = [p[0] + rx * off, p[1] + ry * off];
        if (k % 4 === 0 && clearOfRoads(q, 0.25)) addLight(q, dir, 1);
        else if (m > 1.1 && k % 2 === 1 && clearOfRoads(q, 0.4)) trees.push([r1(q[0]), r1(q[1]), r1(0.6 + rand() * 0.3), rand() < 0.6 ? 2 : 3]);
      } else if (r.rank >= 3 && !r.oneway && k % 4 === 0) {
        const side = Math.floor(k / 4) % 2 ? 1 : -1;
        const off = r.width / 2 + 0.55;
        const q = [p[0] + Math.cos(dir) * side * off, p[1] - Math.sin(dir) * side * off];
        if (clearOfRoads(q, 0.35) && !inWater(q) && !inBuildingAt(q)) addLight(q, dir + (Math.PI / 2) * -side, 0);
      } else if (r.rank >= 3 && r.oneway && k % 4 === 0) {
        // one-way carriageway without a median: lamps on its left kerb
        const off = r.width / 2 + 0.55;
        const q = [p[0] - rx * off, p[1] - ry * off];
        if (clearOfRoads(q, 0.35) && !inWater(q) && !inBuildingAt(q)) addLight(q, Math.atan2(rx, ry), 0);
      }
      // trees at the back of the footpath
      if (k % 2 === 0 && rand() < (r.rank >= 3 ? 0.5 : 0.3)) {
        for (const side of r.oneway ? [-travel] : [-1, 1]) {
          const off = r.width / 2 + sw - 0.4;
          const q = [p[0] + Math.cos(dir) * side * off, p[1] - Math.sin(dir) * side * off];
          if (!clearOfRoads(q, sw - 0.6) || inWater(q) || inBuildingAt(q)) continue;
          const roll = rand();
          trees.push([r1(q[0]), r1(q[1]), r1(0.7 + rand() * 0.5), roll < 0.45 ? 0 : roll < 0.75 ? 1 : roll < 0.9 ? 2 : 3]);
        }
      }
    }
  }

  // ---- traffic signals ----
  const signals = [];
  for (const e of raw) {
    if (e.type !== 'node' || e.tags?.highway !== 'traffic_signals') continue;
    const p = proj(e.lat, e.lon);
    if (routeDist(p) > KEEP) continue;
    const k = nodeKey(e);
    const dirs = [];
    for (const [ri, i] of nodeRoads.get(k) || []) {
      const r = roads[ri];
      if (i > 0) dirs.push(r1(bearing(r.pts[i - 1], r.pts[i])));
      if (i < r.pts.length - 1) dirs.push(r1(bearing(r.pts[i], r.pts[i + 1])));
    }
    if (!dirs.length) continue;
    signals.push(signalAt(k, p));
  }

  // A signal at junction node k: the direction of every arm, each arm's width, and pole
  // positions on the left kerb of each approach, checked to be clear of every carriageway.
  function signalAt(k, p) {
    const dirs = [], ws = [];
    for (const [ri, i] of nodeRoads.get(k) || []) {
      const r = roads[ri];
      if (i > 0) { dirs.push(r1(bearing(r.pts[i - 1], r.pts[i]))); ws.push(r1(r.width)); }
      if (i < r.pts.length - 1) { dirs.push(r1(bearing(r.pts[i], r.pts[i + 1]))); ws.push(r1(r.width)); }
    }
    const [ri0, i0] = nodeRoads.get(k)[0];
    const h = roads[ri0].h[i0];
    const poles = [];
    const seen = [];
    dirs.forEach((dir, n) => {
      if (seen.some((o) => Math.abs(Math.atan2(Math.sin(o - dir), Math.cos(o - dir))) < 0.35)) return;
      seen.push(dir);
      const fx = Math.sin(dir), fy = Math.cos(dir), lx = -Math.cos(dir), ly = Math.sin(dir);
      // as close to the junction as the kerb allows (the crossing road may take the first spots)
      search: for (const back of [4, 7, 10, 13]) {
        for (const out of [0.9, 1.5, 2.2, 3]) {
          const q = [p[0] - fx * back + lx * (ws[n] / 2 + out), p[1] - fy * back + ly * (ws[n] / 2 + out)];
          if (clearOfRoads(q, 0.3) && !inBuildingAt(q) && !inWater(q)) { poles.push([r1(q[0]), r1(q[1]), dir]); break search; }
        }
      }
    });
    return { x: r1(p[0]), y: r1(p[1]), h: r1(h), w: Math.max(...ws), dirs, ws, poles };
  }

  // ---- more signals at busy junctions on the route ----
  // OSM maps only some of the city's signals. Where main roads cross on or right beside the
  // route with nothing mapped nearby, add them: every carriageway node of the junction gets
  // one, the biggest junctions first, and never within 150 m of another signalled junction.
  const osmSignals = signals.length;
  {
    const cands = [];
    for (const [k, inc] of nodeRoads) {
      const rs = inc.map(([ri]) => roads[ri]);
      if (rs.some((r) => r.bridge || r.tunnel || r.round)) continue;
      if (inc.some(([ri, i]) => roads[ri].lh[i] > 1)) continue; // not up on a flyover
      let arms = 0, armsMain = 0;
      for (const [ri, i] of inc) {
        const r = roads[ri], n = i === 0 || i === r.keys.length - 1 ? 1 : 2;
        arms += n;
        if (r.rank >= 3 && !r.link) armsMain += n;
      }
      if (arms < 3 || armsMain < 3) continue; // a real crossing of main roads, not a side street
      if (Math.max(...rs.map((r) => r.rank)) < 4) continue; // at least one secondary road or bigger
      if (new Set(rs.map((r) => r.name || r.osm)).size < 2) continue; // two different roads meet
      const [ri, i] = inc[0];
      const p = roads[ri].pts[i];
      if (routeDist(p) > 40) continue;
      cands.push({ k, p, score: rs.reduce((a, r) => a + r.rank, 0) });
    }
    // group the nodes of each junction (dual carriageways cross at up to four nodes)
    const groups = [];
    for (const c of cands.sort((a, b) => b.score - a.score)) {
      const g = groups.find((g) => g.nodes.some((n) => Math.hypot(n.p[0] - c.p[0], n.p[1] - c.p[1]) < 35));
      if (g) { g.nodes.push(c); g.score = Math.max(g.score, c.score); } else groups.push({ nodes: [c], score: c.score });
    }
    const taken = signals.map((s) => [s.x, s.y]);
    for (const g of groups.sort((a, b) => b.score - a.score)) {
      const cx = g.nodes.reduce((a, n) => a + n.p[0], 0) / g.nodes.length, cy = g.nodes.reduce((a, n) => a + n.p[1], 0) / g.nodes.length;
      if (taken.some(([x, y]) => Math.hypot(x - cx, y - cy) < 150)) continue;
      taken.push([cx, cy]);
      for (const n of g.nodes) signals.push(signalAt(n.k, n.p));
    }
  }
  // the signals of one junction run on one cycle (keyed to the junction's centre)
  for (const s of signals) {
    const near = signals.filter((o) => Math.hypot(o.x - s.x, o.y - s.y) < 40);
    s.g = [r1(near.reduce((a, o) => a + o.x, 0) / near.length), r1(near.reduce((a, o) => a + o.y, 0) / near.length)];
  }

  // ---- landmark: Durgam Cheruvu cable bridge pylons, Tank Bund statues ----
  const cable = roadsNear.filter((r) => /Durgam Cheruvu Bridge/i.test(r.name) && r.bridge);
  if (cable.length) {
    // The cable-stayed span is the stretch over the lake: find the longest run of
    // bridge deck above water and stand the two pylons on it.
    let best = null;
    for (const r of cable) {
      const len = polylineLength(r.pts);
      let run = null;
      for (let s = 0; s <= len; s += 5) {
        if (inWater(pointAlong(r.pts, s).p)) {
          if (!run) run = { r, a: s, b: s };
          run.b = s;
        } else if (run) {
          if (!best || run.b - run.a > best.b - best.a) best = run;
          run = null;
        }
      }
      if (run && (!best || run.b - run.a > best.b - best.a)) best = run;
    }
    if (best) {
      const span = best.b - best.a;
      for (const f of span > 120 ? [0.3, 0.7] : [0.5]) {
        const { p, dir, i: pi } = pointAlong(best.r.pts, best.a + span * f);
        landmarks.push({ type: 'pylon', x: r1(p[0]), y: r1(p[1]), dir: r1(dir), w: r1(best.r.width), h: r1(best.r.h[Math.min(pi, best.r.h.length - 1)]) });
      }
    }
  }
  const tankBund = roadsNear.filter((r) => /^Tank Bund Road$/i.test(r.name));
  for (const r of tankBund) {
    const len = polylineLength(r.pts);
    for (let s = 20; s < len - 10; s += 45) {
      const { p, dir } = pointAlong(r.pts, s);
      for (const side of [-1, 1]) {
        const off = r.width / 2 + 3.2;
        const q = [p[0] + Math.cos(dir) * side * off, p[1] - Math.sin(dir) * side * off];
        const probe = [p[0] + Math.cos(dir) * side * (off + 25), p[1] - Math.sin(dir) * side * (off + 25)];
        if (inWater(probe) && clearOfRoads(q, 1)) landmarks.push({ type: 'statue', x: r1(q[0]), y: r1(q[1]), dir: r1(dir + (side > 0 ? -Math.PI / 2 : Math.PI / 2)) });
      }
    }
  }

  // ---- output ----
  const rev = (r, arr) => (r.reverse ? arr.slice().reverse() : arr);
  const outRoads = roadsNear.map((r) => {
    const o = {
      n: r.name, k: r.cls, w: r1(r.width), l: r.lanes, o: r.oneway ? 1 : 0, s: r.speed,
      p: rev(r, r.pts).map((q, i) => [r1(q[0]), r1(q[1]), r1(rev(r, r.h)[i])]),
      b: r.bridge && r.lift > 1 ? 1 : 0,
    };
    if (r.surf) o.f = r.surf;
    if (r.median && r.median.some((m) => m > 0)) o.m = rev(r, r.median);
    return o;
  });
  const xs = drive.map((d) => d[0]), ys = drive.map((d) => d[1]);
  const bounds = { minX: Math.min(...xs) - KEEP, minY: Math.min(...ys) - KEEP, maxX: Math.max(...xs) + KEEP, maxY: Math.max(...ys) + KEEP };

  // water surfaces sit at the shoreline elevation
  const waterOut = waterNear.map((w) => {
    const shore = w.outer.filter((_, i) => i % 3 === 0).map((q) => ground(q[0], q[1])).sort((a, b) => a - b);
    const level = shore[Math.floor(shore.length * 0.3)] - 0.4;
    return { o: w.outer.map((q) => [r1(q[0]), r1(q[1])]), h: w.holes.map((h) => h.map((q) => [r1(q[0]), r1(q[1])])), l: r1(level) };
  });

  // terrain grid over the playable area (decimetres above the start, base64 int16)
  const TD = 10, pad = 200;
  const tx0 = Math.floor((bounds.minX - pad) / TD) * TD, ty0 = Math.floor((bounds.minY - pad) / TD) * TD;
  const tnx = Math.ceil((bounds.maxX + pad - tx0) / TD) + 1, tny = Math.ceil((bounds.maxY + pad - ty0) / TD) + 1;
  const zi = new Int16Array(tnx * tny);
  let zmin = Infinity, zmax = -Infinity;
  for (let j = 0; j < tny; j++)
    for (let i = 0; i < tnx; i++) {
      const v = ground(tx0 + i * TD, ty0 + j * TD);
      zmin = Math.min(zmin, v);
      zmax = Math.max(zmax, v);
      zi[j * tnx + i] = Math.round(v * 10);
    }
  const terrain = { x0: tx0, y0: ty0, d: TD, nx: tnx, ny: tny, z: Buffer.from(zi.buffer).toString('base64') };

  const world = {
    id: def.id, name: def.name, area: def.area, blurb: def.blurb, difficulty: def.difficulty,
    origin: { lat: lat0, lon: lon0, elevation: Math.round(e0) }, attribution: ATTRIBUTION + '; terrain: Mapzen/AWS Terrain Tiles (SRTM)', generated: new Date().toISOString(),
    bounds, terrain,
    landuse: X.landuse.map((l) => ({ k: l.k, p: l.p.map((q) => [r1(q[0]), r1(q[1])]) })),
    rocks: X.rocks, shrubs: X.shrubs, walls: X.walls, rails: X.rails, stations: X.stations,
    busStops: X.busStops, fuel: X.fuel, bumps: X.bumps, uturns: X.uturns, stalls, parked, hoardings, worship,
    style: { charminar: 'old', 'hitec-city': 'tech', 'banjara-hills': 'upscale' }[def.id] || 'central',
    route: {
      length: r1(total), drive, along: along.map(r1), instructions,
      start: { x: drive[0][0], y: drive[0][1], h: drive[0][2], heading: r1(startDir) },
      speed: segRoad.map((ri) => roads[ri].speed),
    },
    roads: outRoads,
    buildings,
    water: waterOut,
    parks: parksNear.map((pk) => pk.map((q) => [r1(q[0]), r1(q[1])])),
    trees, lights, signals, landmarks,
  };
  const json = JSON.stringify(world);
  writeFileSync(join(outDir, `${def.id}.json`), json);
  console.log(
    `${def.id}: route ${(total / 1000).toFixed(2)} km, ${instructions.length} instructions, ${outRoads.length} roads, ` +
      `${buildings.length} buildings (${filler} filler), ${trees.length} trees, ${lights.length} lights, ${signals.length} signals (${signals.length - osmSignals} added), ` +
      `${landmarks.length} landmarks, ${(json.length / 1e6).toFixed(2)} MB`,
  );
  const routeRise = drive.map((d) => d[2]);
  console.log(
    `   terrain ${zmin.toFixed(0)}..${zmax.toFixed(0)} m (start ${Math.round(e0)} m asl, route ${Math.min(...routeRise).toFixed(1)}..${Math.max(...routeRise).toFixed(1)} m), ` +
      `${X.landuse.length} land-use areas, ${X.rocks.length} rocks, ${X.shrubs.length} shrubs, ${X.walls.length} walls, ${X.rails.length} rail/metro lines, ` +
      `${X.stations.length} stations, ${X.busStops.length} bus stops, ${X.fuel.length} petrol pumps, ${X.bumps.length} speed breakers, ` +
      `${outRoads.filter((r) => r.m).length} roads with medians, ${X.uturns.length} U-turns, ${lights.length} lights, ${named} shop names, ${stalls.length} stalls, ${parked.length} parked, ` +
      `${trimmedBuildings} buildings trimmed off roads, ${droppedBuildings} dropped, ${overlapDropped} overlapping removed`,
  );
  console.log('   ' + instructions.map((s) => `${Math.round(s.at)}m ${s.type} ${s.street}`).join(' | '));
  const seq = [];
  segRoad.forEach((ri, i) => {
    const n = roads[ri].name || `(${roads[ri].cls})`;
    const l = dist(routePts[i], routePts[i + 1]);
    if (seq.length && seq.at(-1)[0] === n) seq.at(-1)[1] += l; else seq.push([n, l]);
  });
  console.log('   roads: ' + seq.map(([n, l]) => `${n} ${Math.round(l)}m`).join(' > '));
  return { id: def.id, name: def.name, area: def.area, blurb: def.blurb, difficulty: def.difficulty, length: r1(total), turns: instructions.length - 1 };
}

const index = ROUTES.map(buildRoute);
writeFileSync(join(outDir, 'routes.json'), JSON.stringify({ attribution: ATTRIBUTION, routes: index }, null, 2));
console.log('wrote routes.json');
