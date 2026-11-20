// Sharing a drive: a score card image for WhatsApp status and Instagram Stories, and a
// "challenge a friend" link that opens the same route, time of day and traffic with the
// score to beat. The score travels in the link itself: no accounts, no server.

const W = 1080, H = 1920;
const ACCENT = '#f2a93b', INK = '#f4f1ea', MUTED = '#a9b4bf', PANEL = '#141e28', BG = '#0b1117';
const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

export const fmt = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs) % 60).padStart(2, '0')}`;

// The challenge a link carries, or null: ?route=&time=&traffic=&vs=87&vt=252&by=Kiran
export function readChallenge(params) {
  const s = parseInt(params.get('vs'), 10), t = parseInt(params.get('vt'), 10);
  if (!(s >= 0 && s <= 100) || !(t > 0)) return null;
  const name = (params.get('by') || '').replace(/[<>&"]/g, '').trim().slice(0, 24);
  return { route: params.get('route'), score: s, secs: t, name };
}

export function challengeLink({ route, time, traffic, score, secs, name }) {
  const q = new URLSearchParams({ route, time, traffic, vs: String(score), vt: String(Math.round(secs)) });
  if (name) q.set('by', name.slice(0, 24));
  // On the live site the link goes through /c (api/challenge.js), which gives chat apps a
  // preview with this challenge's own card and sends people on to the game. Locally there
  // are no server functions, so it points straight at the game.
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  return `${location.origin}/${local ? 'play.html' : 'c'}?${q}`;
}

// how this drive went against the challenge it was started from (or null)
export function verdict(ch, score, secs) {
  if (!ch) return null;
  const who = ch.name || 'your friend', Who = who.charAt(0).toUpperCase() + who.slice(1);
  // text: on your debrief; card: on the picture your friends see; who/theirs: for the message
  if (score > ch.score || (score === ch.score && secs < ch.secs))
    return { won: true, who, theirs: ch.score, text: `You beat ${who}! ${score} against ${ch.score}.`, card: `Beat ${who}: ${score} against ${ch.score}` };
  if (score === ch.score && Math.round(secs) === ch.secs)
    return { won: false, who, theirs: ch.score, text: `A dead heat with ${who}: ${score} in ${fmt(secs)}.`, card: `A dead heat with ${who}` };
  return { won: false, who, theirs: ch.score, text: `${Who} wins this one: ${ch.score} against your ${score}. Try again?`, card: `${Who} still leads with ${ch.score}` };
}

const loadImage = (src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxW) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// The card: the moment of arrival on top, the result below. Resolves to a PNG Blob.
export async function scoreCard({ shot, route, area, score, stars, secs, km, faults, name, result }) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);

  // the screenshot, cropped to fill the top, fading into the card
  const top = 1060;
  if (shot && shot.width) {
    const s = Math.max(W / shot.width, top / shot.height);
    const sw = W / s, sh = top / s;
    g.drawImage(shot, (shot.width - sw) / 2, (shot.height - sh) / 2, sw, sh, 0, 0, W, top);
  }
  let gr = g.createLinearGradient(0, 0, 0, 260);
  gr.addColorStop(0, 'rgba(11,17,23,0.75)'); gr.addColorStop(1, 'rgba(11,17,23,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 260);
  gr = g.createLinearGradient(0, top - 380, 0, top);
  gr.addColorStop(0, 'rgba(11,17,23,0)'); gr.addColorStop(1, BG);
  g.fillStyle = gr; g.fillRect(0, top - 380, W, 380);

  // brand
  const logo = await loadImage('/logo.svg');
  if (logo) g.drawImage(logo, 64, 64, 96, 96);
  g.fillStyle = INK;
  g.font = `700 54px ${FONT}`;
  g.textBaseline = 'alphabetic';
  if (g.letterSpacing !== undefined) g.letterSpacing = '10px';
  g.fillText('SAWARI', 184, 118);
  g.font = `600 26px ${FONT}`;
  if (g.letterSpacing !== undefined) g.letterSpacing = '5px';
  g.fillStyle = MUTED;
  g.fillText('DRIVE HYDERABAD', 186, 158);
  if (g.letterSpacing !== undefined) g.letterSpacing = '0px';

  // route
  let y = top - 120;
  g.fillStyle = ACCENT;
  g.font = `700 30px ${FONT}`;
  g.fillText((area || '').toUpperCase(), 64, y);
  g.fillStyle = INK;
  g.font = `800 72px ${FONT}`;
  for (const line of wrap(g, route, W - 128).slice(0, 2)) { y += 84; g.fillText(line, 64, y); }

  // score and stars
  y += 215;
  g.font = `800 200px ${FONT}`;
  g.fillStyle = INK;
  g.fillText(String(score), 56, y);
  const sw = g.measureText(String(score)).width;
  g.font = `600 52px ${FONT}`;
  g.fillStyle = MUTED;
  g.fillText('/100', 56 + sw + 14, y);
  g.font = `400 64px ${FONT}`;
  g.fillStyle = ACCENT;
  g.fillText('★'.repeat(stars) + '☆'.repeat(5 - stars), W - 64 - g.measureText('★★★★★').width, y - 20);

  // stats
  y += 60;
  const boxW = (W - 128 - 2 * 24) / 3;
  [['TIME', fmt(secs)], ['DISTANCE', `${km.toFixed(1)} km`], ['FAULTS', String(faults)]].forEach(([k, v], i) => {
    const x = 64 + i * (boxW + 24);
    g.fillStyle = PANEL;
    roundRect(g, x, y, boxW, 150, 24);
    g.fill();
    g.fillStyle = MUTED;
    g.font = `600 26px ${FONT}`;
    g.fillText(k, x + 30, y + 52);
    g.fillStyle = INK;
    g.font = `700 54px ${FONT}`;
    g.fillText(v, x + 30, y + 120);
  });
  y += 150;

  // the challenge, if this drive was one
  if (result) {
    y += 70;
    g.fillStyle = result.won ? '#7fe0b0' : ACCENT;
    g.font = `700 40px ${FONT}`;
    for (const line of wrap(g, result.card, W - 128).slice(0, 2)) { g.fillText(line, 64, y); y += 50; }
  }

  // call to action
  const foot = H - 250;
  g.fillStyle = ACCENT;
  roundRect(g, 64, foot, W - 128, 170, 32);
  g.fill();
  g.fillStyle = '#1b1306';
  g.font = `800 50px ${FONT}`;
  g.fillText(name ? `${name} drove it. Can you beat it?` : 'Can you beat it?', 104, foot + 72, W - 208);
  g.font = `600 34px ${FONT}`;
  g.fillText(`${location.host} · free, real Hyderabad roads`, 104, foot + 128, W - 208);

  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// Share the card (the phone's share sheet: WhatsApp, Instagram, ...), or download it and
// copy the message where the browser cannot share files. Returns what happened.
export async function shareCard(blob, text) {
  const file = new File([blob], 'sawari-score.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'Sawari · Drive Hyderabad' });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sawari-score.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  try {
    await navigator.clipboard.writeText(text);
    return 'downloaded-copied';
  } catch {
    return 'downloaded';
  }
}

// Share just the challenge link (share sheet, or copy it).
export async function shareLink(text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url, title: 'Sawari · Drive Hyderabad' });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// ---------- the share row under "Challenge a friend" (like the website footer) ----------
const ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.2 20.8l4.5-1.2A8.8 8.8 0 1 0 12 3.2z"/><path fill="currentColor" d="M9 8.4c.3-.6.6-.6.9-.6h.5c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.2-.1.4 0 .5.5.9 1.3 1.7 2.3 2.2.2.1.4.1.5 0l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5v.4c-.1.6-.9 1.3-1.6 1.4-.7.1-1.6.1-3.6-.9-2.4-1.3-3.7-3.6-3.9-4.1-.3-.6-.4-1.6.1-2.2z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.6 19.9c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18 6.4c.4-.4-.1-.6-.6-.2L6 13.3 1.1 11.8c-1.1-.3-1.1-1 .2-1.5L20.5 2.9c.9-.3 1.7.2 1.4 1.4z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7.5 7.5 12 3l4.5 4.5"/></svg>',
};
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// HTML for the row: real links for the apps that take one, buttons for the rest.
export function socialRow(text, url) {
  const e = encodeURIComponent, both = `${text} ${url}`;
  const a = (cls, href, label) => `<a class="sb ${cls}" href="${attr(href)}" target="_blank" rel="noopener nofollow" aria-label="${label}" title="${label}">${ICONS[cls]}</a>`;
  const b = (cls, act, label) => `<button type="button" class="sb ${cls}" data-share="${act}" aria-label="${label}" title="${label}">${ICONS[cls]}</button>`;
  return `<div class="social-row">
    ${a('whatsapp', `https://wa.me/?text=${e(both)}`, 'Send on WhatsApp')}
    ${a('facebook', `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`, 'Share on Facebook')}
    ${a('x', `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`, 'Post on X')}
    ${a('linkedin', `https://www.linkedin.com/feed/?shareActive=true&text=${e(both)}`, 'Share on LinkedIn')}
    ${a('telegram', `https://t.me/share/url?url=${e(url)}&text=${e(text)}`, 'Send on Telegram')}
    ${b('instagram', 'instagram', 'Copy a caption for Instagram')}
    <button type="button" class="sb-copy" data-share="copy">${ICONS.copy}<span>Copy link</span></button>
    ${navigator.share ? b('more', 'more', 'More ways to share') : ''}
  </div>`;
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: t });
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
