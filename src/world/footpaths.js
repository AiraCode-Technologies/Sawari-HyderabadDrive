// The raised footpaths beside the roads, as roads.js draws them, and the zebra crossings
// before each signal. Shared by the road builder (which paints the crossings and stop lines),
// the traffic (which stops before the crossing) and the pedestrians (who walk only on the
// footpaths and cross only on the zebras).
import { offsets, uniqueDirs } from './roads.js';
import { footpathWidth, rankOf } from './roadIndex.js';

// A road with a footpath on both sides (tertiary and up, on the ground), with its edges.
export function footpathRoad(r, ri) {
  const cum = [0];
  for (let i = 1; i < r.p.length; i++) cum.push(cum[i - 1] + Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]));
  const xs = r.p.map((q) => q[0]), ys = r.p.map((q) => q[1]);
  const sw = footpathWidth(r);
  // the footpath's edges, as roads.js draws them (tapers included)
  const off = offsets(r.p);
  if (r.wv) off.forEach((o, i) => { const k = r.wv[i] / r.w; o.nx *= k; o.ny *= k; });
  const hw = r.w / 2;
  // people walk down the middle of the paving (kerbstone to outer edge), at most `half` either way
  return { r, ri, cum, len: cum[cum.length - 1], off, hw, sw, mid: hw + 0.2 + (sw - 0.2) / 2, half: Math.max(0.1, (sw - 0.2) / 2 - 0.28), minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), busy: rankOf(r) >= 4 ? 2 : 1, cross: [] };
}

// every road that has footpaths: kerbed, on the ground for its whole length
export function footpathRoads(world, terrain) {
  return world.roads
    .map((r, ri) => ({ r, ri }))
    .filter(({ r }) => rankOf(r) >= 3 && r.p.length >= 2 && (world.sf ? !(r.u && r.u.some((v) => v)) : r.p.every((q) => q[2] - terrain.at(q[0], q[1]) < 0.8)))
    .map(({ r, ri }) => footpathRoad(r, ri))
    .filter((p) => p.len > 15);
}

// A point l metres out from the centre line of segment i (t along it) on one side.
export function edge(p, i, t, l, side) {
  const a = p.r.p[i - 1], c = p.r.p[i], oa = p.off[i - 1], oc = p.off[i];
  const nx = oa.nx + (oc.nx - oa.nx) * t, ny = oa.ny + (oc.ny - oa.ny) * t;
  return { x: a[0] + (c[0] - a[0]) * t + nx * l * side, y: a[1] + (c[1] - a[1]) * t + ny * l * side, h: a[2] + (c[2] - a[2]) * t };
}

// The stretches [s0, s1] of one side's footpath that exist: exactly the 1.5 m pieces roads.js
// draws (none where another carriageway comes within half a metre: side roads, junction
// mouths, slip roads; none on a median side), less any under a deck too low to walk under.
// Worked out once per footpath side.
export function walkable(index, p, side) {
  p.ok ||= {};
  if (p.ok[side]) return p.ok[side];
  const r = p.r, hw = p.hw, sw = p.sw, out = [];
  if (r.fpk && index) {
    // the pieces roads.js drew (it records them as it builds), joined up, less any under a
    // deck too low overhead
    let open = null;
    for (const [s0, s1] of r.fpk[side]) {
      const q = along(p, (s0 + s1) / 2), e = edge(p, q.i, q.t, p.mid, side);
      if (index.carriagewayAt(e.x, e.y, e.h, 0.6, 1.2, 4.5, -1)) { open = null; continue; }
      if (open && s0 - open[1] < 0.01) open[1] = s1;
      else out.push((open = [s0, s1]));
    }
    return (p.ok[side] = out.filter(([a, b]) => b - a >= 2.5));
  }
  let open = null;
  for (let i = 1; i < r.p.length; i++) {
    const segLen = p.cum[i] - p.cum[i - 1];
    const n = Math.max(1, Math.ceil(segLen / 1.5));
    const median = side === -1 && r.m && (r.m[i - 1] > 0 || r.m[i] > 0);
    for (let k = 1; k <= n; k++) {
      const t0 = (k - 1) / n, t1 = k / n;
      let ok = !median && !!index;
      for (const t of ok ? [t0, (t0 + t1) / 2, t1] : []) {
        for (const l of [hw + 0.05, hw + sw * 0.25, hw + sw * 0.5, hw + sw * 0.75, hw + sw]) {
          const q = edge(p, i, t, l, side);
          if (index.onOtherCarriageway(q.x, q.y, q.h, p.ri, 0.5) || (l > hw + 0.1 && index.carriagewayAt(q.x, q.y, q.h, 0.3, -8, -1.5, p.ri))) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) {
        const q = edge(p, i, (t0 + t1) / 2, p.mid, side);
        if (index.carriagewayAt(q.x, q.y, q.h, 0.6, 1.2, 4.5, -1)) ok = false;
      }
      const s0 = p.cum[i - 1] + segLen * t0, s1 = p.cum[i - 1] + segLen * t1;
      if (!ok) { open = null; continue; }
      if (open) open[1] = s1;
      else out.push((open = [s0, s1]));
    }
  }
  return (p.ok[side] = out.filter(([a, b]) => b - a >= 2.5));
}

// the point s metres along a footpath road's centre line, and its direction
function along(p, s) {
  const cum = p.cum;
  s = Math.max(0, Math.min(p.len, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = p.r.p[i - 1], b = p.r.p[i], t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: a[2] + (b[2] - a[2]) * t, dir: Math.atan2(b[0] - a[0], b[1] - a[1]), i, t };
}

// Where each signal's zebra crossings go: sig.zebras, one per approach. A crossing sits
// 4 to 7 m back from the signal, as it was always painted, unless a side road's mouth or a
// junction corner takes the footpath away there: then it moves back (up to 16 m, as real
// crossings are set back) to where the footpath runs on both sides, so people step off a
// kerb and onto a kerb. Each zebra: centre (x, y), direction of the approach (dir),
// width across (w), `back` (signal to the far edge of the stripes, where traffic stops),
// and, where people can use it, the footpath road (p, s) and the footpath points at either
// end (a, b: road, distance along it, side). sig.paintOnly: the stripes over the other half
// of a divided road, for a crossing that goes on over the median.
export function placeZebras(world, index, paths) {
  for (const sig of world.signals || []) {
    sig.zebras = [];
    sig.paintOnly = [];
    for (const dir of uniqueDirs(sig.dirs)) {
      const fx = Math.sin(dir), fy = Math.cos(dir);
      const di = sig.ws ? sig.dirs.indexOf(dir) : -1;
      const w = di >= 0 ? sig.ws[di] : sig.w;
      const z = { dir, w, x: sig.x - fx * 5.5, y: sig.y - fy * 5.5, h: sig.h, back: 7, sig };
      sig.zebras.push(z);
      // the footpath road under the default crossing, running along the approach
      let best = null;
      for (const p of paths) {
        if (z.x < p.minX - 10 || z.x > p.maxX + 10 || z.y < p.minY - 10 || z.y > p.maxY + 10) continue;
        const pts = p.r.p;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1e-9;
          const cos = (ex * fx + ey * fy) / l;
          if (Math.abs(cos) < 0.9) continue;
          const t = Math.max(0, Math.min(1, ((z.x - a[0]) * ex + (z.y - a[1]) * ey) / (l * l)));
          const d = Math.hypot(z.x - a[0] - ex * t, z.y - a[1] - ey * t);
          if (d < 1.5 && (!best || d < best.d)) best = { d, p, s: p.cum[i - 1] + l * t, sense: Math.sign(cos) };
        }
      }
      if (!best || Math.abs(best.p.r.w - w) > 2.5) continue;
      const { p, s: s0, sense } = best;
      const on = (pp, side, s) => walkable(index, pp, side).some(([a, b]) => s >= a + 1 && s <= b - 1);
      // step back from the signal (against the approach) until both footpaths run past the
      // crossing; the road must also run on far enough to fit the stop line behind it
      for (let back = 0; back <= 9; back += 0.5) {
        const s = s0 - sense * back;
        if (s < 5 || s > p.len - 5) break;
        if (!on(p, 1, s) || !on(p, -1, s)) continue;
        const q = along(p, s);
        Object.assign(z, { x: q.x, y: q.y, h: q.h, dir: sense > 0 ? q.dir : q.dir + Math.PI, w: p.r.w, back: 7 + back, p, s, a: { p, s, side: 1 }, b: { p, s, side: -1 } });
        break;
      }
      if (z.p) continue;
      // a divided road: the far side is the median. The crossing then carries on over the
      // other carriageway to its outer footpath, the median a refuge in between, and that
      // carriageway gets the zebra painted too.
      for (let back = 0; back <= 9; back += 0.5) {
        const s = s0 - sense * back;
        if (s < 5 || s > p.len - 5) break;
        if (!on(p, 1, s)) continue;
        const q = along(p, s), seg = q.i;
        if (!(p.r.m && (p.r.m[seg - 1] > 0 || p.r.m[seg] > 0))) break; // no median here
        const e = edge(p, seg, q.t, 1, -1); // a metre out on the median side
        const nx = e.x - q.x, ny = e.y - q.y, nl = Math.hypot(nx, ny) || 1;
        // the twin: running the other way, its centre line a few metres across the median
        let twin = null;
        for (const p2 of paths) {
          if (p2 === p || q.x < p2.minX - 25 || q.x > p2.maxX + 25 || q.y < p2.minY - 25 || q.y > p2.maxY + 25) continue;
          const pts = p2.r.p;
          for (let i = 1; i < pts.length; i++) {
            const A = pts[i - 1], B = pts[i], ex = B[0] - A[0], ey = B[1] - A[1], l = Math.hypot(ex, ey) || 1e-9;
            if ((ex * Math.sin(q.dir) + ey * Math.cos(q.dir)) / l > -0.9) continue;
            const t = Math.max(0, Math.min(1, ((q.x - A[0]) * ex + (q.y - A[1]) * ey) / (l * l)));
            const cx = A[0] + ex * t, cy = A[1] + ey * t;
            const across = ((cx - q.x) * nx + (cy - q.y) * ny) / nl, sideways = Math.abs((cx - q.x) * ny - (cy - q.y) * nx) / nl;
            if (sideways > 1 || across < p.hw + p2.hw + 0.3 || across > p.hw + p2.hw + 8) continue;
            if (!twin || across < twin.across) twin = { p2, s2: p2.cum[i - 1] + l * t, across };
          }
        }
        if (!twin) break;
        const { p2, s2 } = twin;
        if (!on(p2, 1, s2)) continue;
        // nothing else to cross on the way (a slip road or a third carriageway)
        const q2 = along(p2, s2);
        let clear = true;
        for (let u = 0; u <= 1.0001 && clear; u += 0.05) {
          const x = q.x + (q2.x - q.x) * u, y = q.y + (q2.y - q.y) * u, h = q.h + (q2.h - q.h) * u;
          for (const sg of index.grid.query(x, y, 0)) {
            if (sg.ri === p.ri || sg.ri === p2.ri) continue;
            const ex = sg.bx - sg.ax, ey = sg.by - sg.ay, l2 = ex * ex + ey * ey || 1e-9;
            const tt = Math.max(0, Math.min(1, ((x - sg.ax) * ex + (y - sg.ay) * ey) / l2));
            if (Math.hypot(x - sg.ax - ex * tt, y - sg.ay - ey * tt) < sg.w / 2 + 0.3 && Math.abs(sg.ah + (sg.bh - sg.ah) * tt - h) < 1.5) { clear = false; break; }
          }
        }
        if (!clear) break;
        Object.assign(z, { x: q.x, y: q.y, h: q.h, dir: sense > 0 ? q.dir : q.dir + Math.PI, w: p.r.w, back: 7 + back, p, s, a: { p, s, side: 1 }, b: { p: p2, s: s2, side: 1 }, median: true });
        // paint only (traffic on the twin leaves the junction: no stop line for it)
        (sig.paintOnly ||= []).push({ x: q2.x, y: q2.y, h: q2.h, dir: q2.dir, w: p2.r.w });
        break;
      }
    }
  }
}

// the zebra of a signal for traffic heading along `bearing` (null if none)
export function zebraFor(sig, bearing) {
  let best = null, bd = 0.7;
  for (const z of sig.zebras || []) {
    const d = Math.abs(Math.atan2(Math.sin(z.dir - bearing), Math.cos(z.dir - bearing)));
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
