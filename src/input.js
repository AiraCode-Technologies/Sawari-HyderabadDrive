import { clamp } from './util.js';

// Keyboard + gamepad. Steering from keys ramps in and self-centres so the car
// does not twitch; gamepad axes are used directly.
export class Input {
  constructor(target) {
    this.keys = new Set();
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.pressed = new Set(); // one-shot actions this frame
    this.look = { yaw: 0, pitch: 0, dragging: false };
    this.onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
      this.keys.add(k);
      this.pressed.add(k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);

    // drag to look around; double-click to recentre
    let lx = 0, ly = 0;
    this.onDown = (e) => { this.look.dragging = true; lx = e.clientX; ly = e.clientY; target.setPointerCapture?.(e.pointerId); };
    this.onMove = (e) => {
      if (!this.look.dragging) return;
      this.look.yaw = clamp(this.look.yaw - (e.clientX - lx) * 0.005, -2.2, 2.2);
      this.look.pitch = clamp(this.look.pitch - (e.clientY - ly) * 0.004, -0.6, 0.5);
      lx = e.clientX; ly = e.clientY;
    };
    this.onUp = () => { this.look.dragging = false; };
    this.onDbl = () => { this.look.yaw = 0; this.look.pitch = 0; };
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('dblclick', this.onDbl);
    this.target = target;
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  took(code) { return this.pressed.has(code); }

  update(dt, speed) {
    const left = this.down('ArrowLeft', 'KeyA'), right = this.down('ArrowRight', 'KeyD');
    const want = (right ? 1 : 0) - (left ? 1 : 0);
    // slower ramp at speed so lane changes stay smooth
    const rate = want ? 2.6 / (1 + speed / 25) : 4.0;
    this.steer += clamp(want - this.steer, -rate * dt, rate * dt);
    this.throttle = this.down('ArrowUp', 'KeyW') ? 1 : 0;
    this.brake = this.down('ArrowDown', 'KeyS') ? 1 : 0;
    this.handbrake = this.down('Space');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.08) this.steer = Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (rt > 0.05) this.throttle = rt;
      if (lt > 0.05) this.brake = lt;
      if (p.buttons[0]?.pressed) this.handbrake = true;
      // edge-triggered pad buttons
      const map = { 4: 'KeyQ', 5: 'KeyE', 3: 'KeyC', 9: 'Escape', 2: 'KeyR' };
      this.padPrev ||= {};
      for (const [b, code] of Object.entries(map)) {
        const on = !!p.buttons[b]?.pressed;
        if (on && !this.padPrev[b]) this.pressed.add(code);
        this.padPrev[b] = on;
      }
      break;
    }
    // recentre the view slowly when not dragging
    if (!this.look.dragging) {
      this.look.yaw *= Math.exp(-dt * 0.8);
      this.look.pitch *= Math.exp(-dt * 0.8);
    }
  }

  endFrame() { this.pressed.clear(); }

  dispose() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('dblclick', this.onDbl);
  }
}
