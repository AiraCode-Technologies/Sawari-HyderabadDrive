import { clamp } from './util.js';

// On-screen controls for phones and tablets, laid out for landscape:
//   bottom left  - a steering wheel you turn with your thumb (it follows the finger round,
//                  full lock at 150 degrees either way, and spins back to centre when let
//                  go); press its centre to sound the horn, as in a real car; the left and
//                  right indicators sit on either side of it
//   bottom right - brake and accelerator pedals, set in from the edge (hold; holding the
//                  brake at a stop selects reverse, exactly as the keyboard does)
//   top right    - view, lights, back to the route, pause
// Everything feeds the same Input object as the keyboard and gamepad, so the rules,
// the debrief and the rest of the game work unchanged.
const ICON = {
  left: '<path d="M10 5 3 12l7 7M3 12h18"/>',
  right: '<path d="m14 5 7 7-7 7M21 12H3"/>',
  view: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  lights: '<path d="M9 6c-3.3 0-6 2.7-6 6s2.7 6 6 6h2V6zM15 8h6M15 12h6M15 16h6"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
const MAX = 150; // degrees of wheel turn for full lock
// a three-spoke steering wheel: rim, spokes, hub, and a marker at the top
const WHEEL = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <circle cx="60" cy="60" r="52" fill="none" stroke="#1d242c" stroke-width="15"/>
  <circle cx="60" cy="60" r="52" fill="none" stroke="#39434e" stroke-width="10"/>
  <circle cx="60" cy="60" r="58.5" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.2"/>
  <path d="M60 60 L14 70 M60 60 L106 70 M60 60 L60 108" stroke="#2b333c" stroke-width="11" stroke-linecap="round"/>
  <path d="M60 60 L14 70 M60 60 L106 70 M60 60 L60 108" stroke="#47525e" stroke-width="5" stroke-linecap="round"/>
  <g class="t-hub"><circle cx="60" cy="60" r="23" fill="#232a32" stroke="#56626f" stroke-width="2.5"/>
  <path d="M50 56.5v7h5l9 7.5v-22l-9 7.5z M68 55a7 7 0 0 1 0 10" fill="none" stroke="#f2a93b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>
  <rect x="56" y="3.5" width="8" height="13" rx="2" fill="#f2a93b"/>
</svg>`;
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// keep a finger's moves and release on the control it pressed (some browsers refuse
// capture for unusual pointers; the control still works without it)
const capture = (el, e) => {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* not capturable */
  }
};

export class TouchControls {
  constructor(root, input, opts = {}) {
    this.input = input;
    input.touch = { steer: 0, throttle: 0, brake: 0, active: true };
    const el = (this.el = document.createElement('div'));
    // the player's choice on the start page: the wheel on the right swaps it with the
    // pedals; the buttons at the top and everything else stay where they are
    el.className = `touch-ui${opts.wheel === 'right' ? ' wheel-right' : ''}`;
    el.innerHTML = `
      <div class="t-drive">
        <button data-tap="KeyQ" class="t-ind" aria-label="Left indicator">${svg('left')}</button>
        <div class="t-wheel" role="slider" aria-label="Steering wheel: turn it with your thumb; press the centre for the horn" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0">${WHEEL}</div>
        <button data-tap="KeyE" class="t-ind" aria-label="Right indicator">${svg('right')}</button>
      </div>
      <div class="t-buttons">
        <button data-tap="KeyC" aria-label="Change view">${svg('view')}</button>
        <button data-tap="KeyL" aria-label="Headlights">${svg('lights')}</button>
        <button data-tap="KeyR" aria-label="Back to the route">${svg('reset')}</button>
        <button data-tap="Escape" aria-label="Pause">${svg('pause')}</button>
      </div>
      <div class="t-pedals">
        <div class="t-pedal t-brake" data-pedal="brake" aria-label="Brake">BRAKE</div>
        <div class="t-pedal t-gas" data-pedal="throttle" aria-label="Accelerator">GO</div>
      </div>
      <div class="t-rotate" role="alert"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M3 9a9 9 0 0 1 3-5M21 15a9 9 0 0 1-3 5"/></svg>Turn your phone sideways to drive</div></div>`;
    root.appendChild(el);
    root.classList.add('touch');
    this.root = root;

    // one-shot and held buttons
    const held = new Map(); // pointerId -> key code
    el.querySelectorAll('[data-tap]').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.pressed.add(b.dataset.tap);
        b.classList.add('down');
        setTimeout(() => b.classList.remove('down'), 120);
      }));
    el.querySelectorAll('[data-hold]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e);
        held.set(e.pointerId, b.dataset.hold);
        input.keys.add(b.dataset.hold);
        b.classList.add('down');
      });
      const up = (e) => {
        if (!held.has(e.pointerId)) return;
        input.keys.delete(held.get(e.pointerId));
        held.delete(e.pointerId);
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });

    // pedals: held while touched (each pedal its own finger)
    el.querySelectorAll('[data-pedal]').forEach((p) => {
      const name = p.dataset.pedal;
      p.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(p, e);
        input.touch[name] = 1;
        p.classList.add('down');
      });
      const up = () => { input.touch[name] = 0; p.classList.remove('down'); };
      p.addEventListener('pointerup', up);
      p.addEventListener('pointercancel', up);
    });

    // steering wheel: it turns with the finger going round its centre, like a real wheel
    // under your hand; the angle sets the steering (full lock at MAX degrees)
    const wheel = (this.wheel = el.querySelector('.t-wheel'));
    let steerId = null, cx = 0, cy = 0, last = 0;
    this.held = false;
    this.angle = 0; // degrees, + clockwise (right)
    const at = (e) => (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    let hornId = null;
    wheel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(wheel, e);
      const r = wheel.getBoundingClientRect();
      // the hub in the middle is the horn (held while pressed), the rim steers
      if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < r.width * 0.2) {
        hornId = e.pointerId;
        input.keys.add('KeyH');
        wheel.classList.add('honk');
        return;
      }
      steerId = e.pointerId;
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      last = at(e);
      this.angle = input.steer * MAX; // pick the wheel up where it is
      this.held = true;
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== steerId) return;
      // too close to the hub the angle jumps about: wait for the finger to move out
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < 14) return;
      const a = at(e);
      let d = a - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = a;
      this.angle = clamp(this.angle + d, -MAX, MAX);
      input.touch.steer = this.angle / MAX;
    });
    const release = (e) => {
      if (e.pointerId === hornId) {
        hornId = null;
        input.keys.delete('KeyH');
        wheel.classList.remove('honk');
        return;
      }
      if (e.pointerId !== steerId) return;
      steerId = null;
      this.held = false;
      input.touch.steer = 0; // the wheel spins back as the steering self-centres (see update)
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
    // a long press must not open the browser's menu or select text
    this.noMenu = (e) => e.preventDefault();
    el.addEventListener('contextmenu', this.noMenu);
  }

  // indicator buttons light up with the car's indicators
  // (every frame) and the wheel shows the steering: under the finger while held, and
  // spinning back to centre with the steering once let go
  update(ind) {
    const [l, r] = this.el.querySelectorAll('.t-ind');
    l.classList.toggle('on', !!ind.left);
    r.classList.toggle('on', !!ind.right);
    const deg = this.held ? this.angle : this.input.steer * MAX;
    this.wheel.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    this.wheel.setAttribute('aria-valuenow', (deg / MAX).toFixed(2));
  }

  dispose() {
    this.el.remove();
    this.root.classList.remove('touch');
    this.input.touch = null;
  }
}
