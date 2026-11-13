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
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const sx = pts[i][0] - pts[i - 1][0], sy = pts[i][1] - pts[i - 1][1];
      const sl = Math.hypot(sx, sy) || 1;
      const dot = (-ty * -sy) / sl + (tx * sx) / sl;
      scale = 1 / Math.max(0.5, dot);
    }
    out.push({ nx: -ty * scale, ny: tx * scale });
  }
  return out;
}

const mix = (a, b, t) => new THREE.Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
const shade = (c, k) => new THREE.Color(c.r * k, c.g * k, c.b * k);

// Asphalt drawn slightly higher for bigger roads, so where two roads overlap at
// a junction the more important one is drawn on top without flicker.
export const roadTop = (r, ri) => ROAD_TOP + (rankOf(r) - 4) * 0.008 + (ri % 3) * 0.002;

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
  const cPatchDark = c3('#3c3f44'), cPatchLight = c3('#5f5e5a'), cIron = c3('#3a3733'), cIronRim = c3('#55524c');

  const pillars = [];
  world.roads.forEach((r, ri) => {
    const pts = r.p;
    if (pts.length < 2) return;
    const off = offsets(pts);
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

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], oa = off[i - 1], oc = off[i];
      const va = cum[i - 1] / 5, vc = cum[i] / 5;
      for (let k = 1; k < lanes.length; k++) {
        const l0 = lanes[k - 1][0], l1 = lanes[k][0];
        const A = P(a[0] + oa.nx * l0, a[1] + oa.ny * l0, a[2] + top), B = P(a[0] + oa.nx * l1, a[1] + oa.ny * l1, a[2] + top);
        const C = P(c[0] + oc.nx * l1, c[1] + oc.ny * l1, c[2] + top), D = P(c[0] + oc.nx * l0, c[1] + oc.ny * l0, c[2] + top);
        const uv = [[l0 / 5, va], [l1 / 5, va], [l1 / 5, vc], [l0 / 5, vc]];
        asphalt.tri2(A, B, C, D, secCol[k - 1], secCol[k], uv);
      }
      const liftA = a[2] - gAt(a[0], a[1]), liftC = c[2] - gAt(c[0], c[1]);
      const elevated = Math.max(liftA, liftC) > 0.8;
      if (!elevated) {
        // a flush paved strip under everything (shows at junctions and on minor roads)
        const w2 = rank >= 2 ? hw + sw : hw + 0.4;
        const uvS = [[0, cum[i - 1] / 2], [w2 / 2, cum[i - 1] / 2], [w2 / 2, cum[i] / 2], [0, cum[i] / 2]];
        side.quad(
          P(a[0] + oa.nx * w2, a[1] + oa.ny * w2, a[2] + 0.03), P(a[0] - oa.nx * w2, a[1] - oa.ny * w2, a[2] + 0.03),
          P(c[0] - oc.nx * w2, c[1] - oc.ny * w2, c[2] + 0.03), P(c[0] + oc.nx * w2, c[1] + oc.ny * w2, c[2] + 0.03), rank >= 3 ? cSide : cShoulder, uvS, UP);
        for (const s of [1, -1]) {
          const ax = a[0] + oa.nx * w2 * s, ay = a[1] + oa.ny * w2 * s, bx = c[0] + oc.nx * w2 * s, by = c[1] + oc.ny * w2 * s;
          side.quad(P(ax, ay, a[2] + 0.03), P(bx, by, c[2] + 0.03), P(bx, by, c[2] - 1.8), P(ax, ay, a[2] - 1.8), cSkirt, null, [oa.nx * s, 0, -oa.ny * s]);
        }
        // raised footpath with a kerb, in short pieces that stop wherever another
        // carriageway crosses (side roads, junction mouths) or a median runs
        if (r.kerb) {
          for (const s of [1, -1]) {
            if (s === -1 && r.m && (r.m[i - 1] > 0 || r.m[i] > 0)) continue;
            const segLen = cum[i] - cum[i - 1];
            const n = Math.max(1, Math.ceil(segLen / 2.5));
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
                for (const l of [hw + 0.05, hw + sw * 0.5, hw + sw]) {
                  const q = at(t, l);
                  if (index.onOtherCarriageway(q[0], q[1], q[2], ri)) ok = false;
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

    // pillars under bridges, standing on the real ground
    if (r.b) {
      for (let s = 12; s < len - 6; s += 30) {
        const q = sampleAlong(pts, s);
        const gh = gAt(q.x, q.y);
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
        const elevatedHere = q0.h - gAt(q0.x, q0.y) > 0.8;
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

  // zebra crossings and stop lines before signals
  for (const s of world.signals) {
    for (const dir of uniqueDirs(s.dirs)) {
      const fx = Math.sin(dir), fy = Math.cos(dir), rx = Math.cos(dir), ry = -Math.sin(dir);
      const h = s.h + ROAD_TOP + 0.05;
      for (let k = -s.w / 2 + 0.5; k < s.w / 2 - 0.4; k += 1.1) {
        const x0 = s.x - fx * 7 + rx * k, y0 = s.y - fy * 7 + ry * k;
        marks.quad(
          P(x0, y0, h), P(x0 + rx * 0.55, y0 + ry * 0.55, h),
          P(x0 + rx * 0.55 + fx * 3, y0 + ry * 0.55 + fy * 3, h), P(x0 + fx * 3, y0 + fy * 3, h), cWhite, null, UP);
      }
      // stop line across the approaching (left-hand) lanes
      const sx = s.x - fx * 8.6, sy = s.y - fy * 8.6;
      const l0 = -s.w / 2 + 0.3, l1 = -0.15;
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
