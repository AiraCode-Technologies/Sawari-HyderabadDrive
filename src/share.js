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
  return `${location.origin}/play.html?${q}`;
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
