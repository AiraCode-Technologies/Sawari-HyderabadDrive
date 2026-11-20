// GET /c?route=&time=&traffic=&vs=&vt=&by=  (rewritten here by vercel.json)
// The challenge link people share. Chat apps and social sites read this page's Open Graph
// tags (they run no JavaScript) and show the challenge card from /api/og; a person who taps
// the link goes straight to the game with the challenge loaded (by script, not a meta
// refresh, which some crawlers follow to the plain game page and its generic preview).
import { readChallenge, fmt, TIMES, TRAFFIC } from './_card.js';

export const config = { runtime: 'edge' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default async function handler(req) {
  const url = new URL(req.url);
  const origin = url.origin;
  const ch = readChallenge(url.searchParams);
  if (!ch) return Response.redirect(`${origin}/play.html`, 302);
  let route = null;
  try {
    route = (await (await fetch(`${origin}/data/routes.json`)).json()).routes.find((r) => r.id === ch.route) || null;
  } catch {
    route = null;
  }
  const q = new URLSearchParams({ route: ch.route, time: ch.time, traffic: ch.traffic, vs: String(ch.score), vt: String(ch.secs) });
  if (ch.name) q.set('by', ch.name);
  const game = `${origin}/play.html?${q}`;
  const image = `${origin}/api/og?${q}`;
  const page = `${origin}/c?${q}`;
  const routeName = route ? route.name : 'a Hyderabad route';
  const who = ch.name || 'A friend';
  const title = `${who} scored ${ch.score} on ${routeName}. Can you beat it?`;
  const desc = `Same route, ${TIMES[ch.time]} with ${TRAFFIC[ch.traffic]}: ${who} did it in ${fmt(ch.secs)}. Sawari is a free driving simulator on real Hyderabad roads; it runs in your browser.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} | Sawari</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${origin}/play.html" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Sawari" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(page)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:secure_url" content="${esc(image)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="800" />
<meta property="og:image:height" content="419" />
<meta property="og:image:alt" content="${esc(`${who}'s score card: ${ch.score}/100 on ${routeName}`)}" />
<meta property="og:locale" content="en_IN" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(image)}" />
<link rel="icon" href="/logo.svg" type="image/svg+xml" />
<script>location.replace(${JSON.stringify(game)});</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1117;color:#f4f1ea;font-family:'Segoe UI',system-ui,sans-serif}a{color:#f2a93b}</style>
</head>
<body><p>Opening the challenge… <a href="${esc(game)}">Tap here if nothing happens</a>.</p></body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
