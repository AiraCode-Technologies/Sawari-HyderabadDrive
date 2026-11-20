// GET /api/og?route=&time=&traffic=&vs=&vt=&by=  ->  the challenge card as an 800 x 419 PNG (1.91:1, under 300 KB for WhatsApp),
// the picture chat apps and social sites show in a challenge link's preview.
import { ImageResponse } from '@vercel/og';
import { card, fonts, readChallenge, OUT_W, OUT_H } from './_card.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const origin = url.origin;
  const ch = readChallenge(url.searchParams) || { route: '', score: 0, secs: 1, time: 'noon', traffic: 'medium', name: '' };
  let route = null;
  try {
    const list = (await (await fetch(`${origin}/data/routes.json`)).json()).routes;
    route = list.find((r) => r.id === ch.route) || null;
  } catch {
    route = null;
  }
  return new ImageResponse(card({ origin, ch, route }), {
    width: OUT_W,
    height: OUT_H,
    fonts: await fonts(),
    // the same link always makes the same card: let browsers and the CDN keep it
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
