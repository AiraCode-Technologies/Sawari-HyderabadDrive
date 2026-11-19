import * as THREE from 'three';
import { Geo, UP, c3, P, sampleAlong, polyLen } from './geo.js';
import { KERB, ROAD_TOP, rankOf, footpathWidth } from './roadIndex.js';
import { asphaltTexture, paverTexture, TEX_GAIN } from './textures.js';
import { hash01, mulberry, addTiled } from '../util.js';

// Left edge normals of a polyline ribbon with mitred joins.
function offsets(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    let scale = 1, sharp = false;
    if (i > 0 && i < n - 1) {
      const sx = pts[i][0] - pts[i - 1][0], sy = pts[i][1] - pts[i - 1][1];
      const sl = Math.hypot(sx, sy) || 1;
      const dot = (-ty * -sy) / sl + (tx * sx) / sl;
      // a sharp corner (over ~50 degrees): a mitred edge would fold over itself, so the
      // edge keeps its width and the corner gets a round fill (see buildRoads)
      if (dot < 0.64) sharp = true;
      else scale = 1 / dot;
    }
    out.push({ nx: -ty * scale, ny: tx * scale, sharp });
  }
  return out;
}

const mix = (a, b, t) => new THREE.Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
const shade = (c, k) => new THREE.Color(c.r * k, c.g * k, c.b * k);

// Asphalt drawn slightly higher for bigger roads, so where two roads overlap at
// a junction the more important one is drawn on top without flicker.
// Where roads overlap at a junction, the bigger road's surface is drawn a little higher, and
// roads of the same class that meet get different layers (like colouring a map), so no two
// overlapping surfaces ever share a height (they flickered against each other).
let LAYERS = null;
export function roadLayers(roads) {
  const byNode = new Map();
  roads.forEach((r, ri) => r.p.forEach((q) => {
    const k = `${q[0]},${q[1]}`;
    if (!byNode.has(k)) byNode.set(k, []);
    byNode.get(k).push(ri);
  }));
  const adj = roads.map(() => new Set());
  for (const rs of byNode.values()) for (const a of rs) for (const b of rs) if (a !== b && rankOf(roads[a]) === rankOf(roads[b])) adj[a].add(b);
  const col = new Array(roads.length).fill(-1);
  const order = roads.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size || a - b);
  for (const ri of order) {
    const used = new Set([...adj[ri]].map((o) => col[o]));
    let c = 0;
    while (used.has(c) && c < 4) c++;
    col[ri] = c;
  }
  LAYERS = col;
  return col;
}
// (12 mm between road classes, up to 7.5 mm of layers within one; the verge strip lies at 1 cm)
export const roadTop = (r, ri) => ROAD_TOP + (rankOf(r) - 4) * 0.012 + (LAYERS ? LAYERS[ri] : ri % 3) * 0.0025;

// Carriageways, footpaths with kerbs, medians, bridge decks and parapets,
// lane markings, zebra crossings and stop lines, speed breakers and pillars.
export function buildRoads(world, group, quality, T, index, junctions) {
  const gAt = (x, y) => T.at(x, y);
  const aniso = quality.aniso || 4;
  const asphalt = new Geo(true), patches = new Geo(true), path = new Geo(true), side = new Geo(true);
  const kerb = new Geo(), marks = new Geo(), concrete = new Geo(), median = new Geo();
  const rnd = mulberry(world.id.length * 131 + 7);

  // colours: fresh dark asphalt on arterials, greyer and dustier on lanes
  const cAsph = [c3('#4a4d52'), c3('#6b6560'), c3('#7a6a55')]; // asphalt, pavers, unpaved
  const cDust = c3('#8e8572');
  const cSide = c3('#b4ab99'), cSkirt = c3('#8f866a'), cShoulder = c3('#9b917a');
  const cWhite = c3('#e9e8e0'), cYellow = c3('#e8c547');
  const cConc = c3('#b9b4ab'), cConcDark = c3('#8f8a82'), cKerbY = c3('#e3b931'), cKerbB = c3('#2a2a2a'), cMedGreen = c3('#6f8f45');
  const cKerbStone = c3('#c4beb2'), cKerbFace = c3('#a9a397');
  const cPatchDark = c3('#3c3f44'), cPatchLight = c3('#43454a') /* never paler than the road: it read as dirt */, cIron = c3('#3a3733'), cIronRim = c3('#55524c');

  const pillars = [];
  // a cable-stayed main span: between a pair of pylons, within 25 m of the line joining them
  const pyl = (world.landmarks || []).filter((l) => l.type === 'pylon' && l.span);
  const inMainSpan = (x, y) => {
    if (pyl.length !== 2) return false;
    const [a, b] = pyl, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    return t > 0.02 && t < 0.98 && Math.abs((x - a.x) * dy - (y - a.y) * dx) / Math.sqrt(l2) < 25;
  };
  roadLayers(world.roads);
  world.roads.forEach((r, ri) => {
    const pts = r.p;
    if (pts.length < 2) return;
    const off = offsets(pts);
    // where the road tapers into a wider deck (r.wv), every edge at that point moves out
    // with it: the asphalt, kerbs, footpaths and parapets all follow the taper
    if (r.wv) off.forEach((o, i) => { const k = r.wv[i] / r.w; o.nx *= k; o.ny *= k; });
    const hw = r.w / 2;
    const rank = rankOf(r);
    const sw = footpathWidth(r);
    const top = roadTop(r, ri);
    const tone = 0.9 + hash01(ri * 7 + 3) * 0.2; // older, faded or freshly laid
    const base = shade(cAsph[r.f || 0], tone);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));

    // cross-section of the carriageway, left edge (+hw) to right edge (-hw):
    // dusty edges, darker polished wheel paths and an oil line down each lane
    const sec = [[hw, 1, 1], [hw - 0.55, 0, 1]];
    if (rank >= 3 && r.l >= 1 && r.w / r.l >= 2.8 && r.f !== 2) {
      const lw = r.w / r.l;
      for (let k = 0; k < r.l; k++) {
        const c = hw - lw * (k + 0.5);
        for (const [o, sh] of [[1.25, 1], [0.85, 0.86], [0.45, 1], [0, 0.93], [-0.45, 1], [-0.85, 0.86], [-1.25, 1]]) sec.push([c + o, 0, sh]);
      }
    }
    sec.push([-hw + 0.55, 0, 1], [-hw, 1, 1]);
    const lanes = sec.filter((q, i) => i < 2 || i >= sec.length - 2 || (q[0] < hw - 0.6 && q[0] > -hw + 0.6)).sort((a, b) => b[0] - a[0]);
    const secCol = lanes.map(([, dust, sh]) => shade(mix(base, r.f === 2 ? base : cDust, dust * 0.75), sh));

    // where this road overlaps a bigger road's carriageway (a junction), its surface dips a
    // few centimetres under, so graded heights never let it show through the bigger road
    const myLayer = LAYERS ? LAYERS[ri] : 0;
    const dip = pts.map((q) => {
      for (const sg of index.grid.query(q[0], q[1], 0)) {
        if (sg.ri === ri) continue;
        const o = world.roads[sg.ri], ro = rankOf(o);
        if (ro < rank || (ro === rank && (LAYERS ? LAYERS[sg.ri] : 0) <= myLayer)) continue;
        const ex = sg.bx - sg.ax, ey = sg.by - sg.ay, l2 = ex * ex + ey * ey || 1e-9;
        const t = Math.max(0, Math.min(1, ((q[0] - sg.ax) * ex + (q[1] - sg.ay) * ey) / l2));
        if (Math.hypot(q[0] - sg.ax - ex * t, q[1] - sg.ay - ey * t) < sg.w / 2 + 0.3 && Math.abs(sg.ah + (sg.bh - sg.ah) * t - q[2]) < 1) return 0.06;
      }
      return 0;
    });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], oa = off[i - 1], oc = off[i];
      const va = cum[i - 1] / 5, vc = cum[i] / 5;
      const ta = top - dip[i - 1], tc = top - dip[i];
      for (let k = 1; k < lanes.length; k++) {
        const l0 = lanes[k - 1][0], l1 = lanes[k][0];
        const A = P(a[0] + oa.nx * l0, a[1] + oa.ny * l0, a[2] + ta), B = P(a[0] + oa.nx * l1, a[1] + oa.ny * l1, a[2] + ta);
        const C = P(c[0] + oc.nx * l1, c[1] + oc.ny * l1, c[2] + tc), D = P(c[0] + oc.nx * l0, c[1] + oc.ny * l0, c[2] + tc);
        const uv = [[l0 / 5, va], [l1 / 5, va], [l1 / 5, vc], [l0 / 5, vc]];
        asphalt.tri2(A, B, C, D, secCol[k - 1], secCol[k], uv);
      }
      if (off[i - 1].sharp) {
        // round fill at a sharp corner, so the two straight pieces join without a gap
        const segs = 14;
        for (let k = 0; k < segs; k++) {
          const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
          const C = P(a[0], a[1], a[2] + top), Q0 = P(a[0] + Math.cos(a0) * hw, a[1] + Math.sin(a0) * hw, a[2] + top), Q1 = P(a[0] + Math.cos(a1) * hw, a[1] + Math.sin(a1) * hw, a[2] + top);
          asphalt.quad(C, C, Q0, Q1, base, [[0, 0], [0, 0], [Math.cos(a0) * hw / 5, Math.sin(a0) * hw / 5], [Math.cos(a1) * hw / 5, Math.sin(a1) * hw / 5]], UP);
        }
      }
      const liftA = a[2] - gAt(a[0], a[1]), liftC = c[2] - gAt(c[0], c[1]);
      // a structure (deck or ramp) per the data; older data: guess from the height above ground
      const elevated = world.sf ? !!(r.u && (r.u[i - 1] || r.u[i])) : Math.max(liftA, liftC) > 0.8;
      if (!elevated) {
        // a flush paved strip under everything (shows at junctions and on minor roads)
        // under the carriageway itself, then the verges in short pieces that stop wherever
        // another road's carriageway lies (side roads and junction mouths keep their asphalt)
        const w2 = rank >= 2 ? hw + sw : hw + 0.4;
        const sideCol = rank >= 3 ? cSide : cShoulder;
        side.quad(
          P(a[0] + oa.nx * hw, a[1] + oa.ny * hw, a[2] + 0.01), P(a[0] - oa.nx * hw, a[1] - oa.ny * hw, a[2] + 0.01),
          P(c[0] - oc.nx * hw, c[1] - oc.ny * hw, c[2] + 0.01), P(c[0] + oc.nx * hw, c[1] + oc.ny * hw, c[2] + 0.01), sideCol,
          [[0, cum[i - 1] / 2], [hw / 2, cum[i - 1] / 2], [hw / 2, cum[i] / 2], [0, cum[i] / 2]], UP);
        {
          const segLen = cum[i] - cum[i - 1];
          const n = Math.max(1, Math.ceil(segLen / 1.5));
          for (const s of [1, -1]) {
            const at = (t, l) => {
              const nx = oa.nx + (oc.nx - oa.nx) * t, ny = oa.ny + (oc.ny - oa.ny) * t;
              return [a[0] + (c[0] - a[0]) * t + nx * l * s, a[1] + (c[1] - a[1]) * t + ny * l * s, a[2] + (c[2] - a[2]) * t];
            };
            for (let k = 1; k <= n; k++) {
              const t0 = (k - 1) / n, t1 = k / n;
              let clear = true;
              for (const t of [t0, (t0 + t1) / 2, t1])
                for (const l of [hw + 0.3, hw + (w2 - hw) * 0.33, hw + (w2 - hw) * 0.66, w2]) {
                  const q = at(t, l);
                  if (index.onOtherCarriageway(q[0], q[1], q[2], ri, 0.4)) clear = false;
                }
              if (!clear) continue;
              const i0 = at(t0, hw), i1 = at(t1, hw), o0 = at(t0, w2), o1 = at(t1, w2);
              const v0 = (cum[i - 1] + segLen * t0) / 2, v1 = (cum[i - 1] + segLen * t1) / 2;
              side.quad(P(i0[0], i0[1], i0[2] + 0.01), P(i1[0], i1[1], i1[2] + 0.01), P(o1[0], o1[1], o1[2] + 0.01), P(o0[0], o0[1], o0[2] + 0.01), sideCol,
                [[hw / 2, v0], [hw / 2, v1], [w2 / 2, v1], [w2 / 2, v0]], UP);
              // the edge slopes down and out like an earth bank (a vertical face read as a dark wall)
              const ex0 = oa.nx * s * 1.8, ey0 = oa.ny * s * 1.8, ex1 = oc.nx * s * 1.8, ey1 = oc.ny * s * 1.8;
              side.quad(P(o0[0], o0[1], o0[2] + 0.01), P(o1[0], o1[1], o1[2] + 0.01), P(o1[0] + ex1, o1[1] + ey1, o1[2] - 1.8), P(o0[0] + ex0, o0[1] + ey0, o0[2] - 1.8), cSkirt, null, [oa.nx * s * 0.7, 0.7, -oa.ny * s * 0.7]);
            }
          }
        }
        // raised footpath with a kerb, in short pieces that stop wherever another
        // carriageway crosses (side roads, junction mouths) or a median runs
        if (r.kerb) {
          for (const s of [1, -1]) {
            if (s === -1 && r.m && (r.m[i - 1] > 0 || r.m[i] > 0)) continue;
            const segLen = cum[i] - cum[i - 1];
            const n = Math.max(1, Math.ceil(segLen / 1.5));
            const at = (t, l) => {
              const nx = oa.nx + (oc.nx - oa.nx) * t, ny = oa.ny + (oc.ny - oa.ny) * t;
              return [a[0] + (c[0] - a[0]) * t + nx * l * s, a[1] + (c[1] - a[1]) * t + ny * l * s, a[2] + (c[2] - a[2]) * t];
            };
            const keep = [];
            for (let k = 0; k <= n + 1; k++) {
              const t0 = (k - 1) / n, t1 = k / n; // k = 0 and n + 1 are the neighbours outside this segment
              if (k === 0 || k === n + 1) { keep.push(true); continue; }
              let ok = true;
              for (const t of [t0, (t0 + t1) / 2, t1])
                for (const l of [hw + 0.05, hw + sw * 0.25, hw + sw * 0.5, hw + sw * 0.75, hw + sw]) {
                  const q = at(t, l);
                  if (index.onOtherCarriageway(q[0], q[1], q[2], ri, 0.5)) ok = false;
                }
              keep.push(ok);
            }
            for (let k = 1; k <= n; k++) {
              if (!keep[k]) continue;
              const t0 = (k - 1) / n, t1 = k / n;
              const v0 = (cum[i - 1] + segLen * t0) / 2, v1 = (cum[i - 1] + segLen * t1) / 2;
              const i0 = at(t0, hw), i1 = at(t1, hw), s0 = at(t0, hw + 0.2), s1 = at(t1, hw + 0.2), o0 = at(t0, hw + sw), o1 = at(t1, hw + sw);
              const lo = top - 0.02, hi = top + KERB;
              const out = [oa.nx * s, 0, -oa.ny * s], inward = [-out[0], 0, -out[2]];
              // kerb face (painted black and yellow on the big roads) and kerbstone top
              const paint = rank >= 5 ? ((Math.floor((cum[i - 1] + segLen * t0) / 2.5) % 2) ? cKerbB : cKerbY) : cKerbFace;
              kerb.quad(P(i0[0], i0[1], i0[2] + lo), P(i1[0], i1[1], i1[2] + lo), P(i1[0], i1[1], i1[2] + hi), P(i0[0], i0[1], i0[2] + hi), paint, null, inward);
              kerb.quad(P(i0[0], i0[1], i0[2] + hi), P(i1[0], i1[1], i1[2] + hi), P(s1[0], s1[1], s1[2] + hi), P(s0[0], s0[1], s0[2] + hi), rank >= 5 ? paint : cKerbStone, null, UP);
              // paving
              path.quad(P(s0[0], s0[1], s0[2] + hi), P(s1[0], s1[1], s1[2] + hi), P(o1[0], o1[1], o1[2] + hi), P(o0[0], o0[1], o0[2] + hi), cSide,
                [[0.1, v0], [0.1, v1], [sw / 2, v1], [sw / 2, v0]], UP);
              // outer edge down to the ground
              kerb.quad(P(o0[0], o0[1], o0[2] + hi), P(o1[0], o1[1], o1[2] + hi), P(o1[0], o1[1], o1[2] - 0.6), P(o0[0], o0[1], o0[2] - 0.6), cKerbFace, null, out);
              // ends where the footpath stops
              const fwd = [c[0] - a[0], 0, -(c[1] - a[1])];
              if (!keep[k - 1]) kerb.quad(P(i0[0], i0[1], i0[2] + lo), P(o0[0], o0[1], o0[2] + lo), P(o0[0], o0[1], o0[2] + hi), P(i0[0], i0[1], i0[2] + hi), cKerbFace, null, [-fwd[0], 0, -fwd[2]]);
              if (!keep[k + 1]) kerb.quad(P(i1[0], i1[1], i1[2] + lo), P(o1[0], o1[1], o1[2] + lo), P(o1[0], o1[1], o1[2] + hi), P(i1[0], i1[1], i1[2] + hi), cKerbFace, null, fwd);
            }
          }
        }
      } else {
        // parapets on both edges and the deck/embankment sides beneath them; where
        // the opposite carriageway runs alongside (r.m), the inner edge gets the
        // shared central barrier instead, so the two decks' railings never clash
        const paired = r.m && r.m[i - 1] > 0 && r.m[i] > 0;
        for (const s of [1, -1]) {
          if (s === -1 && paired) continue;
          const ax = a[0] + oa.nx * hw * s, ay = a[1] + oa.ny * hw * s, bx = c[0] + oc.nx * hw * s, by = c[1] + oc.ny * hw * s;
          // where another carriageway runs on (a ramp splitting off or joining), no parapet
          if (index.onOtherCarriageway((ax + bx) / 2, (ay + by) / 2, (a[2] + c[2]) / 2, ri, -0.3)) continue;
          const out = [oa.nx * s, 0, -oa.ny * s];
          const base0 = r.b ? a[2] - 1.1 : gAt(ax, ay) - 0.5, base1 = r.b ? c[2] - 1.1 : gAt(bx, by) - 0.5;
          concrete.quad(P(ax, ay, base0), P(bx, by, base1), P(bx, by, c[2] + 0.95), P(ax, ay, a[2] + 0.95), cConcDark, null, out);
          const ix = a[0] + oa.nx * (hw - 0.3) * s, iy = a[1] + oa.ny * (hw - 0.3) * s, jx = c[0] + oc.nx * (hw - 0.3) * s, jy = c[1] + oc.ny * (hw - 0.3) * s;
          concrete.quad(P(ix, iy, a[2] + top), P(jx, jy, c[2] + top), P(jx, jy, c[2] + 0.95), P(ix, iy, a[2] + 0.95), cConc, null, [-out[0], 0, -out[2]]);
          concrete.quad(P(ix, iy, a[2] + 0.95), P(jx, jy, c[2] + 0.95), P(bx, by, c[2] + 0.95), P(ax, ay, a[2] + 0.95), cConc, null, UP);
          // a solid embankment (not an open bridge) is a wall to traffic down beside it
          if (!r.b) index.addWall(ax, ay, bx, by, Math.min(a[2], c[2]) - 0.1, 'post');
        }
        if (r.b)
          concrete.quad(
            P(a[0] + oa.nx * hw, a[1] + oa.ny * hw, a[2] - 1.1), P(c[0] + oc.nx * hw, c[1] + oc.ny * hw, c[2] - 1.1),
            P(c[0] - oc.nx * hw, c[1] - oc.ny * hw, c[2] - 1.1), P(a[0] - oa.nx * hw, a[1] - oa.ny * hw, a[2] - 1.1), cConcDark, null, [0, -1, 0]);
      }
    }

    // repair patches and manhole covers, away from junctions
    const len = cum[cum.length - 1];
    if (rank >= 2 && r.f !== 2) {
      for (let s = 15 + rnd() * 30; s < len - 10; s += 25 + rnd() * 50) {
        const q = sampleAlong(pts, s);
        if (junctions(q.x, q.y, hw + 4)) continue;
        const fx = Math.sin(q.dir), fy = Math.cos(q.dir), rx = Math.cos(q.dir), ry = -Math.sin(q.dir);
        const h = q.h + top + 0.012;
        if (rnd() < 0.35) {
          // round manhole cover in a lane
          const lat = (rnd() - 0.5) * (r.w - 2.5);
          const cx = q.x + rx * lat, cy = q.y + ry * lat;
          for (let k = 0; k < 10; k++) {
            const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
            const p0 = [cx + Math.cos(a0) * 0.42, cy + Math.sin(a0) * 0.42], p1 = [cx + Math.cos(a1) * 0.42, cy + Math.sin(a1) * 0.42];
            const i0 = [cx + Math.cos(a0) * 0.33, cy + Math.sin(a0) * 0.33], i1 = [cx + Math.cos(a1) * 0.33, cy + Math.sin(a1) * 0.33];
            patches.quad(P(i0[0], i0[1], h), P(p0[0], p0[1], h), P(p1[0], p1[1], h), P(i1[0], i1[1], h), cIronRim, null, UP);
            patches.tri(P(cx, cy, h), P(i0[0], i0[1], h), P(i1[0], i1[1], h), cIron, null, UP);
          }
        } else {
          // a rectangular patch of newer or older asphalt
          const L = 1.2 + rnd() * 3.5, W = Math.min(r.w - 0.6, 0.9 + rnd() * 2.4);
          const lat = (rnd() - 0.5) * Math.max(0, r.w - W - 0.6);
          const col = rnd() < 0.6 ? cPatchDark : cPatchLight;
          const cx = q.x + rx * lat, cy = q.y + ry * lat;
          const cor = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([f, l]) => [cx + fx * f + rx * l, cy + fy * f + ry * l]);
          patches.quad(...cor.map((p) => P(p[0], p[1], h)), shade(col, tone), cor.map((p) => [p[0] / 5, p[1] / 5]), UP);
        }
      }
    }

    // pillars under bridges, standing on the real ground (none in a cable-stayed main
    // span: the Durgam Cheruvu bridge crosses the lake between its pylons unsupported)
    if (r.b) {
      for (let s = 12; s < len - 6; s += 30) {
        const q = sampleAlong(pts, s);
        const gh = gAt(q.x, q.y);
        if (inMainSpan(q.x, q.y)) continue;
        if (q.h - gh > 2.5) {
          pillars.push({ ...q, gh });
          index.ring(q.x, q.y, 1.0, q.h - 1.2, 'post');
        }
      }
    }

    // raised median on the right edge of a divided carriageway
    if (r.m) {
      const mAt = (s) => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        return Math.min(r.m[i - 1], r.m[i]) > 0 ? r.m[i - 1] + (r.m[i] - r.m[i - 1]) * t : 0;
      };
      const step = 2;
      for (let s = 0; s < len - step; s += step) {
        const m0 = mAt(s), m1 = mAt(s + step);
        if (m0 <= 0 || m1 <= 0) continue;
        const q0 = sampleAlong(pts, s), q1 = sampleAlong(pts, s + step);
        const r0x = Math.cos(q0.dir), r0y = -Math.sin(q0.dir), r1x = Math.cos(q1.dir), r1y = -Math.sin(q1.dir);
        const mt = 0.24;
        const inA = [q0.x + r0x * hw, q0.y + r0y * hw], inB = [q1.x + r1x * hw, q1.y + r1y * hw];
        const outA = [q0.x + r0x * (hw + m0), q0.y + r0y * (hw + m0)], outB = [q1.x + r1x * (hw + m1), q1.y + r1y * (hw + m1)];
        const stripe = Math.floor(s / 2) % 2 === 0 ? cKerbY : cKerbB;
        const elevatedHere = world.sf ? !!(r.u && r.u[Math.min(q0.i, r.u.length - 1)]) : q0.h - gAt(q0.x, q0.y) > 0.8;
        if (m0 > 0.3) {
          median.quad(P(inA[0], inA[1], q0.h + top - 0.02), P(inB[0], inB[1], q1.h + top - 0.02), P(inB[0], inB[1], q1.h + mt), P(inA[0], inA[1], q0.h + mt), stripe, null, [-r0x, 0, r0y]);
          // kerb cap, then a planted strip (or concrete on flyovers and narrow medians)
          const capA = [q0.x + r0x * (hw + 0.2), q0.y + r0y * (hw + 0.2)], capB = [q1.x + r1x * (hw + 0.2), q1.y + r1y * (hw + 0.2)];
          median.quad(P(inA[0], inA[1], q0.h + mt), P(inB[0], inB[1], q1.h + mt), P(capB[0], capB[1], q1.h + mt), P(capA[0], capA[1], q0.h + mt), cKerbStone, null, UP);
          const green = m0 > 1.1 && !elevatedHere;
          median.quad(P(capA[0], capA[1], q0.h + mt - (green ? 0.03 : 0)), P(capB[0], capB[1], q1.h + mt - (green ? 0.03 : 0)), P(outB[0], outB[1], q1.h + mt - (green ? 0.03 : 0)), P(outA[0], outA[1], q0.h + mt - (green ? 0.03 : 0)),
            green ? shade(cMedGreen, 0.9 + hash01(ri * 31 + Math.floor(s)) * 0.2) : cConc, null, UP);
        }
        if (m0 <= 0.3 || elevatedHere) {
          // shared concrete crash barrier on the centre line between the carriageways
          const c0 = hw + m0, c1 = hw + m1;
          const bar = (o0, o1) => [P(q0.x + r0x * o0, q0.y + r0y * o0, q0.h + top), P(q1.x + r1x * o1, q1.y + r1y * o1, q1.h + top)];
          const [i0, i1] = bar(c0 - 0.24, c1 - 0.24), [e0, e1] = bar(c0 + 0.24, c1 + 0.24);
          const up = (p, d) => [p[0], p[1] + d, p[2]];
          median.quad(i0, i1, up(i1, 0.82), up(i0, 0.82), Math.floor(s / 2) % 2 === 0 ? cKerbY : cConc, null, [-r0x, 0, r0y]);
          median.quad(e0, e1, up(e1, 0.82), up(e0, 0.82), cConc, null, [r0x, 0, -r0y]);
          median.quad(up(i0, 0.82), up(i1, 0.82), up(e1, 0.82), up(e0, 0.82), cConcDark, null, UP);
        }
      }
      // the kerb line as a solid barrier, in 4 m pieces
      for (let s = 0; s < len - 4; s += 4) {
        if (mAt(s) <= 0 || mAt(s + 4) <= 0) continue;
        const q0 = sampleAlong(pts, s), q1 = sampleAlong(pts, s + 4);
        index.addWall(q0.x + Math.cos(q0.dir) * hw, q0.y - Math.sin(q0.dir) * hw, q1.x + Math.cos(q1.dir) * hw, q1.y - Math.sin(q1.dir) * hw, q0.h + 0.35, 'median');
      }
    }

    // lane markings (skipped near junctions), slightly worn
    if (rank >= 3 && r.w >= 5.5) {
      const clear = hw + 5;
      const dashes = [];
      if (!r.o) dashes.push({ o: 0, color: rank >= 5 ? cYellow : cWhite, dash: rank >= 5 ? 1e9 : 3, gap: 5, lw: 0.075 });
      else for (let k = 1; k < r.l; k++) dashes.push({ o: hw - (r.w / r.l) * k, color: cWhite, dash: 3, gap: 6, lw: 0.075 });
      // edge lines
      for (const s of [1, -1]) {
        if (s === -1 && r.m) continue; // the median kerb is the edge there
        dashes.push({ o: (hw - 0.3) * s, color: cWhite, dash: 1e9, gap: 0, lw: 0.07 });
      }
      for (const d of dashes) {
        const solid = d.dash > 1e8;
        const step = solid ? 4 : d.dash;
        for (let s = 0; s < len; s += solid ? 4 : d.dash + d.gap) {
          const q0 = sampleAlong(pts, s), q1 = sampleAlong(pts, Math.min(len, s + step));
          if (junctions(q0.x, q0.y, clear) || junctions(q1.x, q1.y, clear)) continue;
          const nx0 = Math.cos(q0.dir), ny0 = -Math.sin(q0.dir), nx1 = Math.cos(q1.dir), ny1 = -Math.sin(q1.dir);
          const lw = d.lw, o = -d.o;
          const col = shade(d.color, 0.82 + hash01(ri * 977 + Math.floor(s)) * 0.18);
          marks.quad(
            P(q0.x + nx0 * (o - lw), q0.y + ny0 * (o - lw), q0.h + top + 0.015), P(q0.x + nx0 * (o + lw), q0.y + ny0 * (o + lw), q0.h + top + 0.015),
            P(q1.x + nx1 * (o + lw), q1.y + ny1 * (o + lw), q1.h + top + 0.015), P(q1.x + nx1 * (o - lw), q1.y + ny1 * (o - lw), q1.h + top + 0.015), col, null, UP);
        }
      }
    }
  });

  // how many carriageways cover a point (2 or more: inside a junction box)
  const roadsAt = (x, y, h) => {
    const seen = new Set();
    for (const sg of index.grid.query(x, y, 0.5)) {
      const ex = sg.bx - sg.ax, ey = sg.by - sg.ay, l2 = ex * ex + ey * ey || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - sg.ax) * ex + (y - sg.ay) * ey) / l2));
      if (Math.hypot(x - sg.ax - ex * t, y - sg.ay - ey * t) < sg.w / 2 && Math.abs(sg.ah + (sg.bh - sg.ah) * t - h) < 1.5) seen.add(sg.ri);
    }
    return seen.size;
  };
  // zebra crossings and stop lines before signals
  for (const s of world.signals) {
    for (const dir of uniqueDirs(s.dirs)) {
      const fx = Math.sin(dir), fy = Math.cos(dir), rx = Math.cos(dir), ry = -Math.sin(dir);
      const h = s.h + ROAD_TOP + 0.05;
      const i = s.ws ? s.dirs.indexOf(dir) : -1;
      const w = i >= 0 ? s.ws[i] : s.w;
      for (let k = -w / 2 + 0.5; k < w / 2 - 0.4; k += 1.1) {
        const x0 = s.x - fx * 7 + rx * k, y0 = s.y - fy * 7 + ry * k;
        if (roadsAt(x0 + fx * 1.5 + rx * 0.27, y0 + fy * 1.5 + ry * 0.27, s.h) >= 2) continue; // inside the junction box
        marks.quad(
          P(x0, y0, h), P(x0 + rx * 0.55, y0 + ry * 0.55, h),
          P(x0 + rx * 0.55 + fx * 3, y0 + ry * 0.55 + fy * 3, h), P(x0 + fx * 3, y0 + fy * 3, h), cWhite, null, UP);
      }
      // stop line across the approaching (left-hand) lanes
      const sx = s.x - fx * 8.6, sy = s.y - fy * 8.6;
      const l0 = -w / 2 + 0.3, l1 = -0.15;
      if (roadsAt(sx + rx * (l0 + l1) / 2, sy + ry * (l0 + l1) / 2, s.h) < 2)
      marks.quad(
        P(sx + rx * l0, sy + ry * l0, h), P(sx + rx * l1, sy + ry * l1, h),
        P(sx + rx * l1 - fx * 0.4, sy + ry * l1 - fy * 0.4, h), P(sx + rx * l0 - fx * 0.4, sy + ry * l0 - fy * 0.4, h), cWhite, null, UP);
    }
  }

  // speed breakers: painted humps across the road
  const bumpGeo = new Geo();
  for (const b of world.bumps || []) {
    const fx = Math.sin(b.dir), fy = Math.cos(b.dir), rx = Math.cos(b.dir), ry = -Math.sin(b.dir);
    const N = 6;
    for (let lane = -b.w / 2, k = 0; lane < b.w / 2 - 0.01; lane += 0.5, k++) {
      const l1 = Math.min(b.w / 2, lane + 0.5);
      const col = k % 2 ? cKerbB : cKerbY;
      for (let n = 0; n < N; n++) {
        const s0 = -0.8 + (1.6 * n) / N, s1 = -0.8 + (1.6 * (n + 1)) / N;
        const h0 = b.h + 0.07 + 0.09 * Math.cos((Math.PI * s0) / 1.6) ** 2, h1 = b.h + 0.07 + 0.09 * Math.cos((Math.PI * s1) / 1.6) ** 2;
        bumpGeo.quad(
          P(b.x + fx * s0 + rx * lane, b.y + fy * s0 + ry * lane, h0), P(b.x + fx * s0 + rx * l1, b.y + fy * s0 + ry * l1, h0),
          P(b.x + fx * s1 + rx * l1, b.y + fy * s1 + ry * l1, h1), P(b.x + fx * s1 + rx * lane, b.y + fy * s1 + ry * lane, h1), col, null, UP);
      }
    }
  }

  // ---------- roundabouts: a raised, planted island inside the circulating carriageway ----------
  {
    const ring = world.roads.filter((r) => r.rb && r.p.length >= 2);
    const groups = [];
    for (const r of ring) {
      const g = groups.find((gr) => gr.pts.some((q) => r.p.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3)));
      if (g) { g.pts.push(...r.p); g.w = Math.max(g.w, r.w); } else groups.push({ pts: r.p.slice(), w: r.w });
    }
    // merge groups that touch (a roundabout split into several ways)
    for (let i = 0; i < groups.length; i++)
      for (let j = groups.length - 1; j > i; j--)
        if (groups[j].pts.some((p) => groups[i].pts.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3))) {
          groups[i].pts.push(...groups[j].pts);
          groups[i].w = Math.max(groups[i].w, groups[j].w);
          groups.splice(j, 1);
        }
    const cGrass = c3('#6f8f45'), cIslandKerb = c3('#d9d3c6');
    for (const g of groups) {
      const n = g.pts.length;
      if (n < 6) continue;
      // circle through the ring's points (least-squares fit), not just their average
      let mx = 0, my = 0;
      for (const p of g.pts) { mx += p[0]; my += p[1]; }
      mx /= n; my /= n;
      let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
      for (const p of g.pts) {
        const u = p[0] - mx, v = p[1] - my;
        suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
      }
      const det = suu * svv - suv * suv;
      if (Math.abs(det) < 1e-6) continue;
      const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
      const cx = mx + (b1 * svv - b2 * suv) / det, cy = my + (b2 * suu - b1 * suv) / det;
      // a closed ring all the way round its centre
      const angles = g.pts.map((p) => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b);
      let gapMax = 0;
      for (let k = 0; k < angles.length; k++) gapMax = Math.max(gapMax, (angles[(k + 1) % angles.length] - angles[k] + 2 * Math.PI) % (2 * Math.PI));
      if (gapMax > 1.3) continue;
      // the island stops short of the nearest point of the circulating carriageway
      const ri = Math.min(...g.pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) - g.w / 2 - 0.6;
      if (ri < 1.5) continue;
      const h = g.pts.reduce((a, p) => a + p[2], 0) / n + ROAD_TOP;
      // a road running through the middle at the same level: not an island at all
      const through = index.carriagewayAt(cx, cy, h, 0.5, -1.5, 1.5);
      if (through && !world.roads[through.ri].rb) continue;
      const seg = 24;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * ri, y0 = cy + Math.sin(a0) * ri, x1 = cx + Math.cos(a1) * ri, y1 = cy + Math.sin(a1) * ri;
        median.quad(P(cx, cy, h + KERB + 0.05), P(cx, cy, h + KERB + 0.05), P(x1, y1, h + KERB), P(x0, y0, h + KERB), cGrass, null, UP);
        kerb.quad(P(x0, y0, h - 0.02), P(x1, y1, h - 0.02), P(x1, y1, h + KERB), P(x0, y0, h + KERB), cIslandKerb, null, [Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)]);
      }
      index.ring(cx, cy, ri, h + KERB, 'post', 16);
    }
  }

  const tex = { asph: asphaltTexture(aniso), pave: paverTexture(aniso) };
  const lam = (o, map) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: map || null, polygonOffset: !!o, polygonOffsetFactor: o, polygonOffsetUnits: o });
    if (map) m.color.setScalar(TEX_GAIN);
    return m;
  };
  const add = (geo, mat, opts = {}) => {
    if (geo.empty) return;
    addTiled(group, geo.build(), mat, { tile: 250, cast: !!opts.cast && quality.shadows, cull: opts.cull || 0 });
  };
  add(side, lam(-3, tex.pave));
  add(asphalt, lam(-4, tex.asph));
  add(patches, lam(-5, tex.asph), { cull: 260 });
  add(marks, lam(-6));
  add(bumpGeo, lam(-7));
  add(path, lam(-2, tex.pave));
  add(kerb, lam(0), { cast: false });
  add(median, new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true });
  add(concrete, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { cast: true });

  if (pillars.length) {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1, 1.6), new THREE.MeshLambertMaterial({ color: '#a7a198' }), pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach((q, i) => {
      const hgt = q.h - 1.1 - q.gh + 0.5;
      m.compose(new THREE.Vector3(q.x, q.gh - 0.5 + hgt / 2, -q.y), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -q.dir, 0)), new THREE.Vector3(1, hgt, 1));
      pm.setMatrixAt(i, m);
    });
    pm.castShadow = quality.shadows;
    pm.receiveShadow = true;
    group.add(pm);
  }
}

export function uniqueDirs(dirs) {
  const out = [];
  for (const d of dirs) if (!out.some((o) => Math.abs(Math.atan2(Math.sin(o - d), Math.cos(o - d))) < 0.35)) out.push(d);
  return out;
}
