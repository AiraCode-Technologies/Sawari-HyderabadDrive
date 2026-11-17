// Downloads the famous places along each route (malls, monuments, temples, IT towers...)
// by name from the Overpass API, with their real footprints, into
// tools/raw/<id>.landmarks.json. The names come from tools/landmarks.config.mjs.
// Cached; pass --force to download again. Data © OpenStreetMap contributors, ODbL.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, MARGIN_M } from './routes.config.mjs';
import { FAMOUS } from './landmarks.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, 'raw');
mkdirSync(rawDir, { recursive: true });
const force = process.argv.includes('--force');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function bbox(waypoints, extra = 600) {
  const lats = waypoints.map((w) => w[0]);
  const lons = waypoints.map((w) => w[1]);
  const m = MARGIN_M + extra;
  const dLat = m / 111320;
  const dLon = m / (111320 * Math.cos((lats[0] * Math.PI) / 180));
  return [Math.min(...lats) - dLat, Math.min(...lons) - dLon, Math.max(...lats) + dLat, Math.max(...lons) + dLon].map((v) => v.toFixed(5)).join(',');
}

const pattern = FAMOUS.map((f) => f.osm).join('|');

for (const route of ROUTES) {
  const out = join(rawDir, `${route.id}.landmarks.json`);
  if (existsSync(out) && !force) {
    console.log(`${route.id}: cached`);
    continue;
  }
  const b = bbox(route.waypoints);
  const q = `[out:json][timeout:120];
(
  nwr["name"~"${pattern}",i](${b});
  nwr["name:en"~"${pattern}",i](${b});
);
out geom tags;`;
  // the public servers are busy at times: retry, and fall back to a mirror
  let json = null;
  for (let attempt = 0; attempt < 6 && !json; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'hyderabad-drive-builder' } });
      if (res.ok) json = await res.json();
      else console.log(`${route.id}: ${url} said ${res.status}, retrying`);
    } catch (e) {
      console.log(`${route.id}: ${e.message}, retrying`);
    }
    if (!json) await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
  }
  if (!json) throw new Error(`${route.id}: Overpass unavailable`);
  writeFileSync(out, JSON.stringify(json));
  console.log(`${route.id}: ${json.elements.length} named places`);
  await new Promise((r) => setTimeout(r, 4000));
}
