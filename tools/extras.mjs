// Context from the real map around each route: land use, rocks, walls, metro and
// rail, stations, bus stops, petrol pumps, speed breakers, dual-carriageway
// medians and building classes. Map data © OpenStreetMap contributors, ODbL.

const LANDUSE = {
  forest: 'wood', wood: 'wood', scrub: 'scrub', heath: 'scrub', bare_rock: 'rock', sand: 'sand',
  grassland: 'grass', meadow: 'grass', cemetery: 'cemetery', farmland: 'farm',
  commercial: 'commercial', retail: 'commercial', industrial: 'industrial', military: 'industrial',
  residential: 'residential', construction: 'construction', brownfield: 'construction',
};

// Building classes (k): 0 house, 1 apartments, 2 shops below flats, 3 office/glass,
// 4 temple, 5 mosque, 6 industrial/shed, 7 institution, 8 under construction.
export const BUILDING_CLASS = { house: 0, apartments: 1, shops: 2, office: 3, temple: 4, mosque: 5, industrial: 6, institution: 7, construction: 8, church: 9 };
const TAGGED = {
  house: 'house', detached: 'house', bungalow: 'house', terrace: 'house', semidetached_house: 'house', hut: 'house',
  residential: 'apartments', apartments: 'apartments', dormitory: 'apartments',
  commercial: 'office', office: 'office', hotel: 'office', retail: 'shops', supermarket: 'shops', kiosk: 'shops',
  industrial: 'industrial', warehouse: 'industrial', shed: 'industrial', roof: 'industrial', garage: 'industrial', garages: 'industrial', cowshed: 'industrial',
  hospital: 'institution', school: 'institution', university: 'institution', college: 'institution', public: 'institution', train_station: 'institution', civic: 'institution', government: 'institution',
  temple: 'temple', mosque: 'mosque', church: 'church', cathedral: 'church', chapel: 'church', construction: 'construction',
};

export function buildExtras(X) {
  const { def, extra, geo, ground, roads, roadGrid, routeDist, KEEP, inWater, clearOfRoads, degree, H } = X;
  const { hash, rng, dist, polylineLength, polygonArea, centroid, pointInPolygon, segDist, bearing, angleDiff, pointAlong, Grid, r1 } = H;
  const rand = rng(hash(def.id + 'extras'));
  const P2 = (q) => [r1(q[0]), r1(q[1])];
  const nearRoute = (p, d = KEEP) => routeDist(p, d + 50) < d;

  // nearest road (rank >= minRank) to a point
  function nearestRoad(p, maxD, minRank = 2) {
    let best = null;
    for (const [r, i] of roadGrid.near(p[0], p[1], maxD)) {
      if (r.rank < minRank) continue;
      const a = r.pts[i - 1], b = r.pts[i];
      const d = segDist(p, a, b);
      if (d < maxD && (!best || d < best.d)) {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        best = { r, i, d, t, q: [a[0] + dx * t, a[1] + dy * t], h: r.h[i - 1] + (r.h[i] - r.h[i - 1]) * t, dir: bearing(a, b) };
      }
    }
    return best;
  }

  // ---------- land use ----------
  const landuse = [];
  for (const e of extra) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
    const t = e.tags || {};
    const k = LANDUSE[t.landuse] || LANDUSE[t.natural];
    if (!k) continue;
    const ring = geo(e.geometry);
    if (dist(ring[0], ring.at(-1)) > 0.5) continue;
    if (!ring.some((p, i) => i % 4 === 0 && nearRoute(p, KEEP + 300))) continue;
    landuse.push({ k, p: ring.slice(0, -1) });
  }
  const PRIORITY = { commercial: 3, industrial: 3, construction: 2, residential: 1 };
  const landuseAt = (p) => {
    let best = null;
    for (const l of landuse) {
      const pr = PRIORITY[l.k] || 0;
      if (pr && (!best || pr > PRIORITY[best]) && pointInPolygon(p, l.p)) best = l.k;
    }
    return best;
  };

  // ---------- boulders and shrubs ----------
  const rocks = [], shrubs = [];
  for (const e of extra) if (e.type === 'node' && e.tags?.natural === 'stone') {
    const p = X.proj(e.lat, e.lon);
    if (nearRoute(p)) rocks.push([r1(p[0]), r1(p[1]), r1(1.4 + rand() * 1.4)]);
  }
  for (const l of landuse) {
    if (!['rock', 'scrub', 'grass', 'wood'].includes(l.k)) continue;
    const xs = l.p.map((q) => q[0]), ys = l.p.map((q) => q[1]);
    const area = Math.abs(polygonArea(l.p));
    const rockN = l.k === 'rock' ? Math.min(160, area / 90) : l.k === 'scrub' ? Math.min(40, area / 900) : 0;
    const shrubN = l.k === 'scrub' ? Math.min(260, area / 70) : l.k === 'grass' ? Math.min(40, area / 600) : l.k === 'wood' ? Math.min(120, area / 250) : 0;
    const fill = (n, out, size) => {
      for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
        const q = [Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys))];
        if (!pointInPolygon(q, l.p) || !nearRoute(q) || !clearOfRoads(q, 2) || inWater(q)) continue;
        out.push([r1(q[0]), r1(q[1]), r1(size())]);
        k++;
      }
    };
    // granite tors: clusters of rounded boulders, a Deccan plateau signature
    fill(rockN, rocks, () => 0.8 + rand() ** 2 * 3.2);
    fill(shrubN, shrubs, () => 0.6 + rand() * 0.8);
  }

  // ---------- compound walls and fences ----------
  const walls = [];
  for (const e of extra) {
    if (e.type !== 'way' || !e.geometry || !/^(wall|fence|retaining_wall)$/.test(e.tags?.barrier || '')) continue;
    const pts = geo(e.geometry);
    if (!pts.some((p) => nearRoute(p))) continue;
    const hgt = parseFloat(e.tags.height) || (e.tags.barrier === 'fence' ? 1.6 : 2.1);
    walls.push({ k: e.tags.barrier === 'fence' ? 1 : 0, ht: r1(hgt), p: pts.map(P2) });
  }

  // ---------- metro viaducts and railway ----------
  const rails = [];
  for (const e of extra) {
    const kind = e.tags?.railway;
    if (e.type !== 'way' || !e.geometry || !/^(subway|light_rail|monorail|rail)$/.test(kind || '')) continue;
    if (kind === 'rail' && /yard|siding|spur/.test(e.tags.service || '')) continue;
    const pts = geo(e.geometry);
    if (!pts.some((p) => nearRoute(p, KEEP + 200))) continue;
    const metro = kind !== 'rail';
    const layer = parseInt(e.tags.layer, 10) || 0;
    const elevated = !!e.tags.bridge && e.tags.bridge !== 'no';
    const lift = metro ? (elevated ? (layer >= 3 ? 15 : 12.5) : 0) : elevated ? 6.5 : 0;
    // decks run on a smoothed line rather than following every bump below
    const base = pts.map((p) => ground(p[0], p[1]));
    const sm = base.map((_, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(base.length - 1, i + 3); j++) { s += base[j]; c++; }
      return s / c;
    });
    rails.push({ k: metro ? 'metro' : 'rail', e: lift > 0 ? 1 : 0, n: e.tags.name || '', p: pts.map((p, i) => [r1(p[0]), r1(p[1]), r1(sm[i] + lift)]) });
  }
  const metroLines = rails.filter((r) => r.k === 'metro');

  // ---------- stations ----------
  const stations = [];
  const seenStation = [];
  for (const e of extra) {
    if (e.type !== 'node' || (e.tags?.railway !== 'station' && e.tags?.public_transport !== 'station')) continue;
    const p = X.proj(e.lat, e.lon);
    if (!nearRoute(p, KEEP + 150)) continue;
    if (seenStation.some((s) => dist(s, p) < 120)) continue;
    // snap metro stations onto the nearest viaduct
    let best = null;
    for (const l of metroLines)
      for (let i = 1; i < l.p.length; i++) {
        const d = segDist(p, l.p[i - 1], l.p[i]);
        if (d < 150 && (!best || d < best.d)) best = { d, a: l.p[i - 1], b: l.p[i] };
      }
    if (best) {
      const a = best.a, b = best.b;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const q = [a[0] + dx * t, a[1] + dy * t];
      stations.push({ k: 'metro', n: e.tags.name || '', x: r1(q[0]), y: r1(q[1]), h: r1(a[2] + (b[2] - a[2]) * t), dir: r1(bearing(a, b)) });
      seenStation.push(q);
    }
  }

  // ---------- bus stops and petrol pumps ----------
  const busStops = [], fuel = [];
  for (const e of extra) {
    const t = e.tags || {};
    const isBus = e.type === 'node' && t.highway === 'bus_stop';
    const isFuel = t.amenity === 'fuel';
    if (!isBus && !isFuel) continue;
    const p = e.type === 'node' ? X.proj(e.lat, e.lon) : e.geometry ? centroid(geo(e.geometry)) : null;
    if (!p || !nearRoute(p)) continue;
    const nr = nearestRoad(p, isBus ? 30 : 70, isBus ? 3 : 2);
    if (!nr || nr.r.lh[nr.i] > 1) continue;
    // which side of the road the stop is on: +1 = right of the way's direction
    const a = nr.r.pts[nr.i - 1], b = nr.r.pts[nr.i];
    const side = Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0 ? 1 : -1;
    const off = nr.r.width / 2 + (isBus ? 2.2 : 14);
    const q = [nr.q[0] + Math.cos(nr.dir) * side * off, nr.q[1] - Math.sin(nr.dir) * side * off];
    if (!isBus && !clearOfRoads(q, 6)) continue;
    const item = { x: r1(q[0]), y: r1(q[1]), h: r1(ground(q[0], q[1])), dir: r1(nr.dir + (side > 0 ? Math.PI / 2 : -Math.PI / 2)), n: t.name || '' };
    (isBus ? busStops : fuel).push(item);
  }

  // ---------- speed breakers (estimated: none are mapped in OSM here) ----------
  // Hyderabad colony roads usually have a breaker just after each junction.
  const bumps = [];
  for (const r of roads) {
    if (r.rank < 2 || r.rank > 3 || r.oneway || r.bridge || r.link) continue;
    const len = polylineLength(r.pts);
    if (len < 50 || r.lh.some((v) => v > 0.3)) continue;
    const add = (s) => {
      const { p, dir, i } = pointAlong(r.pts, s);
      if (!nearRoute(p, 450)) return;
      const t = Math.min(1, Math.max(0, i));
      bumps.push({ x: r1(p[0]), y: r1(p[1]), h: r1(r.h[Math.min(r.h.length - 1, t)]), dir: r1(dir), w: r1(r.width) });
    };
    if (degree(r.keys[0]) > 2 && hash(`${r.osm}a`) < 0.45) add(16);
    if (degree(r.keys.at(-1)) > 2 && hash(`${r.osm}b`) < 0.45) add(len - 16);
    for (let s = 120; s < len - 60; s += 140) if (hash(`${r.osm}m${s}`) < 0.3) add(s);
  }
  // keep breakers apart
  for (let i = bumps.length - 1; i >= 0; i--) if (bumps.slice(0, i).some((b) => dist([b.x, b.y], [bumps[i].x, bumps[i].y]) < 25)) bumps.splice(i, 1);

  // ---------- medians between the two carriageways of a divided road ----------
  // For each one-way main road, look across to its right for the opposite
  // carriageway; half the gap becomes this side's raised median.
  // Medians as values: > 0.3 a raised median strip of that half-width; 0.12 means
  // the carriageways touch and share a crash barrier (common on flyovers).
  // Two passes: the first measures each pairing and narrows carriageways that
  // overlap; the second recomputes the medians from the final widths so the two
  // halves of every divider meet exactly on the centre line.
  const measure = (narrow) => {
    for (const r of roads) {
      r.median = r.pts.map(() => 0);
      r.minGap = Infinity;
      if (!r.oneway || (r.rank < 4 && !r.bridge) || r.link) continue;
      for (let i = 0; i < r.pts.length; i++) {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
        // direction of travel (oneway=-1 roads run against their drawing order)
        const dir = bearing(a, b) + (r.reverse ? Math.PI : 0);
        const p = r.pts[i];
        if (degree(r.keys[i]) > 2) continue;
        const rx = Math.cos(dir), ry = -Math.sin(dir);
        let best = null;
        for (const [o, j] of roadGrid.near(p[0], p[1], 30)) {
          if (o === r || !o.oneway || o.rank < 3 || Math.abs(o.h[j] - r.h[i]) > 1.5) continue;
          const oa = o.pts[j - 1], ob = o.pts[j];
          const odir = bearing(oa, ob) + (o.reverse ? Math.PI : 0);
          if (Math.abs(angleDiff(dir, odir)) < 2.5) continue;
          // perpendicular distance from p across to that segment, measured to the right
          const mx = (oa[0] + ob[0]) / 2, my = (oa[1] + ob[1]) / 2;
          const lat = (mx - p[0]) * rx + (my - p[1]) * ry;
          const d = segDist(p, oa, ob);
          if (lat <= 0 || d > 30) continue;
          if (!best || d < best.d) best = { d, w: o.width };
        }
        if (!best) continue;
        const gap = best.d - r.width / 2 - best.w / 2;
        if (gap < 16 && gap > -6) {
          r.median[i] = gap > 0.6 ? r1(gap / 2) : 0.12;
          r.minGap = Math.min(r.minGap, gap);
        }
      }
    }
    if (narrow) for (const r of roads) if (r.minGap < 0) r.width = Math.max(3.3, r.width + r.minGap - 0.2);
  };
  measure(true);
  measure(false);
  // medians break at junctions: clear points within 14 m of one
  for (const r of roads) {
    if (!r.median.some((m) => m > 0)) continue;
    const s = [0];
    for (let i = 1; i < r.pts.length; i++) s.push(s[i - 1] + dist(r.pts[i - 1], r.pts[i]));
    const jun = r.keys.map((k, i) => (degree(k) > 2 ? s[i] : null)).filter((v) => v !== null);
    r.median = r.median.map((m, i) => (jun.some((js) => Math.abs(js - s[i]) < 14) ? 0 : m));
  }

  // ---------- U-turn openings in long medians ----------
  // Hyderabad's divided roads close most cross-junctions and instead open the
  // median for U-turns every few hundred metres. OSM does not map these gaps,
  // so they are placed along each long, unbroken median (estimated).
  const uturns = [];
  for (const r of roads) {
    if (!r.median || !r.median.some((m) => m > 0.3)) continue;
    const s = [0];
    for (let i = 1; i < r.pts.length; i++) s.push(s[i - 1] + dist(r.pts[i - 1], r.pts[i]));
    let start = null;
    const runs = [];
    for (let i = 0; i <= r.pts.length; i++) {
      const on = i < r.pts.length && r.median[i] > 0.3;
      if (on && start === null) start = i;
      if (!on && start !== null) { runs.push([start, i - 1]); start = null; }
    }
    for (const [a, b] of runs) {
      if (s[b] - s[a] < 260) continue;
      for (let pos = s[a] + 200; pos < s[b] - 60; pos += 420) {
        if (hash(`${r.osm}u${Math.round(pos)}`) > 0.85) continue;
        const q = pointAlong(r.pts, pos);
        const travel = q.dir + (r.reverse ? Math.PI : 0);
        const m = r.median[Math.min(q.i, r.median.length - 1)] || 1;
        const off = r.width / 2 + m;
        const c = [q.p[0] + Math.cos(travel) * off, q.p[1] - Math.sin(travel) * off]; // centre of the median
        if (uturns.some((u) => dist([u.x, u.y], c) < 150)) continue;
        uturns.push({ x: r1(c[0]), y: r1(c[1]), dir: r1(travel), h: r1(r.h[Math.min(q.i, r.h.length - 1)]) });
      }
    }
  }
  // open the median of every carriageway that passes the gap
  for (const r of roads) {
    if (!r.median) continue;
    r.pts.forEach((p, i) => {
      if (!(r.median[i] > 0)) return;
      for (const u of uturns) {
        const dx = p[0] - u.x, dy = p[1] - u.y;
        const along = Math.abs(dx * Math.sin(u.dir) + dy * Math.cos(u.dir));
        const lat = Math.abs(-dx * Math.cos(u.dir) + dy * Math.sin(u.dir));
        if (along < 9 && lat < r.width / 2 + 9) r.median[i] = 0;
      }
    });
  }

  // ---------- building classes from tags and context ----------
  function classify(tags, ring, area, c, oldCity) {
    if (tags.religion === 'muslim' || tags.building === 'mosque' || /masjid|mosque/i.test(tags.name || '')) return 'mosque';
    if (tags.religion === 'christian' || /church|chapel/i.test(tags.name || '')) return 'church';
    if (tags.religion || tags.building === 'temple' || tags.amenity === 'place_of_worship' || /temple|mandir|gudi/i.test(tags.name || '')) return 'temple';
    if (TAGGED[tags.building]) return TAGGED[tags.building];
    if (tags.shop || /restaurant|cafe|bank|fast_food/.test(tags.amenity || '')) return 'shops';
    if (/hospital|school|college|university/.test(tags.amenity || '')) return 'institution';
    const lu = landuseAt(c);
    if (lu === 'construction') return 'construction';
    if (lu === 'industrial') return 'industrial';
    const front = nearestRoad(c, 26, 3);
    if (lu === 'commercial') return area > 1200 ? 'office' : 'shops';
    if (oldCity) return front ? 'shops' : 'house';
    if (front && area < 1500) return 'shops';
    if (area > 2500 && def.id === 'hitec-city') return 'office';
    if (area > 900) return 'apartments';
    return 'house';
  }
  function levelsFor(cls, area, rnd, oldCity) {
    switch (cls) {
      case 'house': return 1 + Math.floor(rnd * (oldCity ? 3 : 3));
      case 'apartments': return 4 + Math.floor(rnd * (area > 2500 ? 9 : 5));
      case 'shops': return 2 + Math.floor(rnd * (oldCity ? 2 : 3));
      case 'office': return (def.id === 'hitec-city' ? 7 : 4) + Math.floor(rnd * (area > 4000 ? 14 : 7));
      case 'industrial': return 1;
      case 'institution': return 2 + Math.floor(rnd * 4);
      case 'construction': return 2 + Math.floor(rnd * 6);
      case 'temple': return 1;
      case 'mosque': return 2;
      case 'church': return 2;
      default: return 2;
    }
  }

  return { landuse, rocks, shrubs, walls, rails, stations, busStops, fuel, bumps, uturns, classify, levelsFor };
}
