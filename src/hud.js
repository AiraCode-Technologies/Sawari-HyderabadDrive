import { fmtTime } from './util.js';
import { TURN_TEXT } from './nav.js';

const ARROWS = {
  straight: 'M18 30V8M10 15l8-8 8 8',
  left: 'M24 30V18a6 6 0 0 0-6-6H8M14 6l-6 6 6 6',
  right: 'M12 30V18a6 6 0 0 1 6-6h10M22 6l6 6-6 6',
  'slight-left': 'M22 30V20L12 10M11 18V9h9',
  'slight-right': 'M14 30V20l10-10M25 18V9h-9',
  'sharp-left': 'M24 8v12a4 4 0 0 1-4 4H9M14 19l-5 5 5 5',
  'sharp-right': 'M12 8v12a4 4 0 0 0 4 4h11M22 19l5 5-5 5',
  uturn: 'M12 30V14a7 7 0 0 1 14 0v6M21 16l5 5 5-5',
  arrive: 'M18 31s-9-8-9-15a9 9 0 0 1 18 0c0 7-9 15-9 15zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
};
const icon = (type) =>
  `<svg viewBox="0 0 36 36" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${ARROWS[type] || ARROWS.straight}"/></svg>`;
// SVG arc from angle a0 to a1 (degrees, 0 = up, clockwise)
function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
const LAMP = {
  beam: '<svg viewBox="0 0 24 24"><path d="M10 6c-4 0-6 3-6 6s2 6 6 6c2 0 3-2 3-6s-1-6-3-6z" fill="currentColor"/><path d="M15 8h6M15 12h6M15 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  hazard: '<svg viewBox="0 0 24 24"><path d="M12 3l10 17H2z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 9.5l4.2 7.3H7.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3.5 6.5a11 11 0 0 0 0 11M20.5 6.5a11 11 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">P</text></svg>',
};
const indIcon = (dir) =>
  `<svg viewBox="0 0 20 20" width="18" height="18"><path d="${dir < 0 ? 'M3 10l7-7v4h7v6h-7v4z' : 'M17 10l-7-7v4H3v6h7v4z'}" fill="#fff"/></svg>`;

export class Hud {
  constructor(root, world) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="panel trip">
        <div class="name"></div>
        <div class="sub"></div>
        <div class="bar"><div></div></div>
        <div class="stats"><span class="time">0:00</span><span class="left"></span><span class="faults-count">0 faults</span></div>
      </div>
      <div class="panel nav-card"><div class="arrow"></div><div><div class="dist"></div><div class="street"></div></div></div>
      <div class="toasts"></div>
      <div class="panel cluster">
        <div class="ind l">${indIcon(-1)}</div>
        <div class="dial">
          <svg viewBox="0 0 200 200" class="gauge">
            <path class="track" d="${arc(100, 100, 84, -130, 130)}"/>
            <path class="rpm-track" d="${arc(100, 100, 95, -130, 130)}"/>
            <path class="speed-fill" d="${arc(100, 100, 84, -130, 130)}" pathLength="100"/>
            <path class="rpm-fill" d="${arc(100, 100, 95, -130, 130)}" pathLength="100"/>
            <path class="limit-tick" d="M100 6 L100 24"/>
          </svg>
          <div class="read"><div class="kmh">0</div><div class="unit">km/h</div><div class="gear-now">N</div></div>
        </div>
        <div class="ind r">${indIcon(1)}</div>
        <div class="side">
          <div class="limit">50</div>
          <div class="lamps">
            <span class="lamp beam" title="Headlights (L)">${LAMP.beam}</span>
            <span class="lamp hazard" title="Hazard lights (X)">${LAMP.hazard}</span>
            <span class="lamp brake" title="Handbrake (Space)">${LAMP.brake}</span>
          </div>
          <div class="gear"><span data-g="R">R</span><span data-g="N">N</span><span data-g="D">D</span></div>
        </div>
      </div>
      <div class="panel hint">Arrows / WASD drive · Q / E indicators · H horn · L lights · C camera · Tab controls · Esc pause</div>
      <div class="banner panel hidden"></div>
      <div class="osm">${world.attribution}</div>`;
    root.appendChild(this.el);
    const $ = (s) => this.el.querySelector(s);
    this.$ = { name: $('.trip .name'), sub: $('.trip .sub'), bar: $('.bar > div'), time: $('.time'), left: $('.left'), faults: $('.faults-count'),
      arrow: $('.nav-card .arrow'), dist: $('.nav-card .dist'), street: $('.nav-card .street'), toasts: $('.toasts'),
      indL: $('.ind.l'), indR: $('.ind.r'), limit: $('.limit'), kmh: $('.kmh'), gears: [...this.el.querySelectorAll('.gear span')], banner: $('.banner'),
      gearNow: $('.gear-now'), speedFill: $('.speed-fill'), rpmFill: $('.rpm-fill'), limitTick: $('.limit-tick'), cluster: $('.cluster'),
      beam: $('.lamp.beam'), hazard: $('.lamp.hazard'), brake: $('.lamp.brake'), hint: $('.hint') };
    // the key hint fades once the drive is under way
    this.hintTimer = setTimeout(() => this.$.hint.classList.add('faded'), 14000);
    this.$.name.textContent = world.name;
    this.$.sub.textContent = world.area;
    this.lastArrow = null;
  }

  update(s) {
    const $ = this.$;
    const kmh = Math.round(s.kmh);
    if (kmh !== this.lastKmh) { $.kmh.textContent = kmh; this.lastKmh = kmh; }
    if (s.limit !== this.lastLimit) {
      $.limit.textContent = s.limit;
      this.lastLimit = s.limit;
      // mark the limit on the 0-140 km/h dial
      $.limitTick.setAttribute('transform', `rotate(${-130 + (Math.min(140, s.limit) / 140) * 260} 100 100)`);
    }
    $.cluster.classList.toggle('over', s.kmh > s.limit + 3);
    $.speedFill.style.strokeDasharray = `${Math.min(100, (s.kmh / 140) * 100)} 100`;
    $.rpmFill.style.strokeDasharray = `${Math.min(100, (s.rpm / 7000) * 100)} 100`;
    $.rpmFill.classList.toggle('red', s.rpm > 5500);
    const gearText = s.gear === 'R' ? 'R' : s.kmh < 0.5 && !s.throttle ? 'N' : `D${s.gearNum}`;
    if (gearText !== this.lastGear) { $.gearNow.textContent = gearText; this.lastGear = gearText; }
    for (const g of $.gears) g.classList.toggle('on', g.dataset.g === gearText[0]);
    $.beam.classList.toggle('on', !!s.lights);
    $.hazard.classList.toggle('on', !!s.hazard && (s.blinkLeft || s.blinkRight));
    $.brake.classList.toggle('on', !!s.handbrake);
    $.time.textContent = fmtTime(s.time);
    $.left.textContent = `${(s.remaining / 1000).toFixed(1)} km left`;
    $.faults.textContent = `${s.faults} fault${s.faults === 1 ? '' : 's'}`;
    $.bar.style.width = `${Math.min(100, s.progressPct)}%`;
    $.indL.classList.toggle('on', s.blinkLeft);
    $.indR.classList.toggle('on', s.blinkRight);
    const n = s.next;
    if (n) {
      const type = n.type === 'continue' ? 'straight' : n.type;
      if (this.lastArrow !== type) {
        $.arrow.innerHTML = icon(type);
        this.lastArrow = type;
      }
      const d = Math.max(0, n.at - s.progress);
      $.dist.textContent = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(d / 10) * 10)} m`;
      $.street.textContent = n.type === 'arrive' ? `Destination: ${n.street}` : `${TURN_TEXT[n.type]}${n.street ? ` onto ${n.street}` : ''}`;
    }
  }

  toast(text, kind = 'bad', ms = 2600) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.$.toasts.appendChild(t);
    while (this.$.toasts.children.length > 3) this.$.toasts.firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  banner(text) {
    this.$.banner.classList.toggle('hidden', !text);
    if (text) this.$.banner.textContent = text;
  }

  dispose() {
    clearTimeout(this.hintTimer);
    this.el.remove();
  }
}
