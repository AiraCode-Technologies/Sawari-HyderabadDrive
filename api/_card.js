// The challenge card for link previews (Open Graph / Twitter), 1200 x 630: the same design
// as the score card players share as a picture (src/share.js), laid out landscape. The
// server cannot see the player's screen, so the photo is the route's own screenshot.
// Files starting with "_" in api/ are helpers, not endpoints.

export const W = 1200, H = 630; // the layout grid
export const OUT_W = 800, OUT_H = 419; // the picture: same 1.91:1 shape, small enough for WhatsApp previews
const ACCENT = '#f2a93b', INK = '#f4f1ea', MUTED = '#a9b4bf', PANEL = '#141e28', BG = '#0b1117';
const FONT_URL = (w) => `https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@5.1.1/latin-${w}-normal.woff`;

export const TIMES = { morning: 'in the morning', noon: 'at midday', evening: 'in the evening', night: 'at night' };
const WHEN = { morning: 'morning', noon: 'midday', evening: 'evening', night: 'night' };
export const TRAFFIC = { off: 'no traffic', low: 'light traffic', medium: 'normal traffic', high: 'busy traffic', dense: 'dense traffic' };
export const fmt = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs) % 60).padStart(2, '0')}`;

// The challenge in a link's query, cleaned up; null if it is not a challenge.
export function readChallenge(q) {
  const route = (q.get('route') || '').replace(/[^a-z0-9-]/g, '');
  const score = parseInt(q.get('vs'), 10), secs = parseInt(q.get('vt'), 10);
  if (!route || !(score >= 0 && score <= 100) || !(secs > 0 && secs < 36000)) return null;
  const time = TIMES[q.get('time')] ? q.get('time') : 'noon';
  const traffic = TRAFFIC[q.get('traffic')] ? q.get('traffic') : 'medium';
  const name = (q.get('by') || '').replace(/[<>&"]/g, '').trim().slice(0, 24);
  return { route, score, secs, time, traffic, name };
}

export const starsFor = (score) => (score >= 95 ? 5 : score >= 85 ? 4 : score >= 70 ? 3 : score >= 50 ? 2 : 1);

export async function fonts() {
  const get = async (w) => ({ name: 'Noto Sans', weight: w, style: 'normal', data: await (await fetch(FONT_URL(w))).arrayBuffer() });
  return Promise.all([get(400), get(700), get(800)]);
}

// a tiny element builder (the image renderer takes React-like objects; no JSX needed)
const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const text = (s, style) => h('div', { display: 'flex', ...style }, s);
const star = (on, size) =>
  h('svg', { width: size, height: size }, h('path', null, null, {
    d: 'M20 3l5.2 10.6 11.7 1.7-8.5 8.2 2 11.6L20 29.6 9.6 35.1l2-11.6-8.5-8.2 11.7-1.7z',
    fill: on ? ACCENT : 'none', stroke: ACCENT, strokeWidth: 2.4,
  }), { viewBox: '0 0 40 40' });

export function card({ origin, ch, route }) {
  const name = route ? route.name : 'Sawari';
  const area = route ? route.area : 'Drive Hyderabad';
  const photo = `${origin}/img/${route ? ch.route : 'hero'}.jpg`;
  const who = ch.name || 'A friend';
  const stars = starsFor(ch.score);
  // laid out on a 1200 x 630 grid, drawn at OUT_W x OUT_H: every size goes through z()
  const k = OUT_W / W, z = (n) => Math.round(n * k * 10) / 10;
  const photoW = z(640), panelW = OUT_W - photoW;
  return h('div', { width: OUT_W, height: OUT_H, display: 'flex', background: BG, fontFamily: 'Noto Sans', color: INK }, [
    // the photo, fading into the panel
    h('div', { width: photoW, height: OUT_H, display: 'flex', position: 'relative' }, [
      h('img', { width: photoW, height: OUT_H, objectFit: 'cover' }, null, { src: photo, width: photoW, height: OUT_H }),
      h('div', { position: 'absolute', left: 0, top: 0, width: photoW, height: OUT_H, display: 'flex', backgroundImage: `linear-gradient(90deg, rgba(11,17,23,0) 55%, ${BG} 100%)` }),
      h('div', { position: 'absolute', left: 0, top: 0, width: photoW, height: z(170), display: 'flex', backgroundImage: 'linear-gradient(180deg, rgba(11,17,23,0.8) 0%, rgba(11,17,23,0) 100%)' }),
      h('div', { position: 'absolute', left: z(36), top: z(34), display: 'flex', alignItems: 'center' }, [
        h('img', { width: z(64), height: z(64), borderRadius: z(14) }, null, { src: `${origin}/icons/icon-192.png`, width: z(64), height: z(64) }),
        h('div', { display: 'flex', flexDirection: 'column', marginLeft: z(16) }, [
          text('SAWARI', { fontSize: z(36), fontWeight: 800, letterSpacing: z(6) }),
          text('DRIVE HYDERABAD', { fontSize: z(16), fontWeight: 700, letterSpacing: z(4), color: MUTED }),
        ]),
      ]),
    ]),
    // the challenge
    h('div', { width: panelW, height: OUT_H, display: 'flex', flexDirection: 'column', padding: `${z(44)}px ${z(44)}px ${z(40)}px ${z(20)}px` }, [
      text(area.toUpperCase(), { fontSize: z(20), fontWeight: 700, color: ACCENT, letterSpacing: z(2) }),
      text(name, { fontSize: z(name.length > 22 ? 40 : 48), fontWeight: 800, lineHeight: 1.1, marginTop: z(6) }),
      h('div', { display: 'flex', alignItems: 'flex-end', marginTop: z(18) }, [
        text(String(ch.score), { fontSize: z(128), fontWeight: 800, lineHeight: 1 }),
        text('/100', { fontSize: z(34), fontWeight: 700, color: MUTED, marginLeft: z(8), marginBottom: z(14) }),
        h('div', { display: 'flex', marginLeft: 'auto', marginBottom: z(20) }, [1, 2, 3, 4, 5].map((i) => star(i <= stars, z(40)))),
      ]),
      h('div', { display: 'flex', marginTop: z(16), background: PANEL, borderRadius: z(18), padding: `${z(14)}px ${z(20)}px`, fontSize: z(24), color: INK }, [
        text(`${who} · ${fmt(ch.secs)} · ${WHEN[ch.time]}, ${TRAFFIC[ch.traffic]}`, {}),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', marginTop: 'auto', background: ACCENT, borderRadius: z(22), padding: `${z(18)}px ${z(26)}px`, color: '#1b1306' }, [
        text('Can you beat it?', { fontSize: z(40), fontWeight: 800 }),
        text(`${new URL(origin).host} · free in your browser`, { fontSize: z(20), fontWeight: 700 }),
      ]),
    ]),
  ]);
}
