import { angleDiff } from './util.js';
import { signalState } from './signals.js';
import { turnSide } from './nav.js';

const FAULTS = {
  speeding: { what: 'Speeding', advice: 'Watch the limit sign at the bottom right and ease off early.', penalty: 6 },
  keepLeft: { what: 'Drove on the wrong side', advice: 'India drives on the left: stay left of the centre line unless you are overtaking or turning.', penalty: 10 },
  wrongWay: { what: 'Wrong way on a one-way road', advice: 'Follow the route band: it always shows the legal direction.', penalty: 15 },
  offRoad: { what: 'Left the road', advice: 'Slow down before bends and keep the car between the kerbs.', penalty: 6 },
  redLight: { what: 'Ran a red light', advice: 'Stop at the line on red, and on amber unless you are too close to stop safely.', penalty: 20 },
  collision: { what: 'Collision', advice: 'Leave a bigger gap and check your steering guide before tight spots.', penalty: 15 },
  speedBreaker: { what: 'Speed breaker taken too fast', advice: 'Slow to about 15 km/h for speed breakers: watch for the yellow and black stripes.', penalty: 5 },
  indicator: { what: 'No indicator before a turn', advice: 'Signal at least 30 m before you turn: Q for left, E for right.', penalty: 4 },
};

export class Rules {
  constructor(nav, signals) {
    this.nav = nav;
    this.signals = signals;
    this.faults = [];
    this.timers = { speeding: 0, keepLeft: 0, wrongWay: 0, offRoad: 0 };
    this.cooldown = {};
    this.signalSide = new Map();
    this.indicatorSeen = { left: -1e9, right: -1e9 }; // route progress when last on
    this.checkedTurns = new Set();
    this.distance = 0;
    this.maxKmh = 0;
  }

  add(key, t, extra = '', onFault) {
    if ((this.cooldown[key] || -1e9) > t) return;
    this.cooldown[key] = t + (key === 'collision' ? 2.5 : 8);
    const f = { key, t, what: FAULTS[key].what + extra, advice: FAULTS[key].advice, penalty: FAULTS[key].penalty };
    this.faults.push(f);
    onFault?.(f);
  }

  update(dt, t, car, indicators, events, onFault, onWarn) {
    const kmh = Math.abs(car.v) * 3.6;
    this.distance += Math.abs(car.v) * dt;
    this.maxKmh = Math.max(this.maxKmh, kmh);
    const s = car.surface;
    const road = s && s.d < s.seg.w / 2 + 0.3 ? s.road : null;

    // collisions reported by physics and traffic
    for (const e of events) {
      if (e.type === 'collision' && e.speed > 1) {
        const label = { pedestrian: ' with a pedestrian', vehicle: ' with a vehicle', water: ' with the lake edge', median: ' with the median', post: ' with a pillar', wall: ' with a wall', building: ' with a building' }[e.what] || '';
        this.add('collision', t, label, onFault);
      }
      if (e.type === 'bump' && e.speed * 3.6 > 22) this.add('speedBreaker', t, ` (${Math.round(e.speed * 3.6)} km/h)`, onFault);
    }

    // speeding
    const limit = road ? road.s : 30;
    this.limit = limit;
    this.timers.speeding = kmh > limit + 5 ? this.timers.speeding + dt : 0;
    if (this.timers.speeding > 2) this.add('speeding', t, ` (${Math.round(kmh)} km/h in a ${limit} zone)`, onFault);

    // lane discipline
    const nearTurn = this.nearTurn();
    if (road && kmh > 8 && !nearTurn) {
      const rel = angleDiff(s.seg.dir, car.heading);
      const along = Math.abs(rel) < Math.PI / 2;
      if (road.o) {
        this.timers.wrongWay = !along ? this.timers.wrongWay + dt : 0;
        this.timers.keepLeft = 0;
      } else {
        this.timers.wrongWay = 0;
        const right = along ? s.lateral : -s.lateral; // metres right of the centre line
        this.timers.keepLeft = road.w >= 5 && right > 0.7 ? this.timers.keepLeft + dt : 0;
      }
    } else {
      this.timers.keepLeft = 0;
      this.timers.wrongWay = 0;
    }
    if (this.timers.keepLeft > 1.6) this.add('keepLeft', t, '', onFault);
    if (this.timers.wrongWay > 1.5) this.add('wrongWay', t, '', onFault);

    this.timers.offRoad = !road && kmh > 5 ? this.timers.offRoad + dt : 0;
    if (this.timers.offRoad > 1.2) this.add('offRoad', t, '', onFault);

    // red lights: detect crossing the stop line of a signal in front of the car
    const fx = Math.sin(car.heading), fy = Math.cos(car.heading);
    for (const sig of this.signals) {
      const dx = sig.x - car.x, dy = sig.y - car.y;
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30 || Math.abs(sig.h - car.h) > 2) {
        this.signalSide.delete(sig);
        continue;
      }
      const along = dx * fx + dy * fy;
      const lat = Math.abs(-dx * fy + dy * fx);
      const prev = this.signalSide.get(sig);
      this.signalSide.set(sig, along);
      if (prev !== undefined && prev > 4 && along <= 4 && lat < sig.w / 2 + 3 && car.v > 1) {
        const st = signalState(sig, car.heading, t);
        if (st === 'red') this.add('redLight', t, '', onFault);
        else if (st === 'amber') onWarn?.('Amber light: be ready to stop next time');
      }
    }

    // indicators before turns on the route
    const p = this.nav.progress;
    if (indicators.left) this.indicatorSeen.left = p;
    if (indicators.right) this.indicatorSeen.right = p;
    for (const ins of this.nav.instructions) {
      if (this.checkedTurns.has(ins) || ins.at > p) continue;
      this.checkedTurns.add(ins);
      const side = turnSide(ins.type);
      if (!side || ins.type.startsWith('slight') || p - ins.at > 40) continue;
      if (this.indicatorSeen[side] < ins.at - 70) this.add('indicator', t, ` (${side})`, onFault);
    }
  }

  nearTurn() {
    const p = this.nav.progress;
    return this.nav.instructions.some((s) => s.type !== 'continue' && s.type !== 'arrive' && Math.abs(s.at - p) < 22);
  }

  score() {
    return Math.max(0, 100 - this.faults.reduce((a, f) => a + f.penalty, 0));
  }
}
