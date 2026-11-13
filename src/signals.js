import { hash01 } from './util.js';

const CYCLE = 40;

// Two phases per junction: traffic running roughly north-south, then east-west.
// Each junction gets its own offset so the city does not change in lockstep.
export function signalState(sig, bearing, t) {
  // every signal of a junction shares its cycle (sig.g: the junction centre)
  const gx = sig.g ? sig.g[0] : sig.x, gy = sig.g ? sig.g[1] : sig.y;
  const offset = hash01(Math.round(gx / 70) * 7919 + Math.round(gy / 70)) * CYCLE;
  const phase = (t + offset) % CYCLE;
  const b = ((bearing % Math.PI) + Math.PI) % Math.PI; // fold opposite directions together
  const group = Math.round(b / (Math.PI / 2)) % 2; // 0 = N-S, 1 = E-W
  if (group === 0) return phase < 17 ? 'green' : phase < 20 ? 'amber' : 'red';
  return phase < 20 ? 'red' : phase < 37 ? 'green' : 'amber';
}

// Signals ahead of a vehicle at (x, y) travelling along `bearing`: returns the
// nearest one within `range` metres that sits across its path.
export function signalAhead(signals, x, y, h, bearing, range = 40) {
  const fx = Math.sin(bearing), fy = Math.cos(bearing);
  let best = null;
  for (const s of signals) {
    const dx = s.x - x, dy = s.y - y;
    if (Math.abs(dx) > range || Math.abs(dy) > range || Math.abs(s.h - h) > 2) continue;
    const along = dx * fx + dy * fy;
    const lat = Math.abs(-dx * fy + dy * fx);
    if (along <= 0 || along > range || lat > s.w / 2 + 3) continue;
    if (!best || along < best.along) best = { sig: s, along, lat };
  }
  return best;
}
