// Downloads raw OpenStreetMap data for each route's area from the Overpass API.
// Results are cached in tools/raw/<id>.json; pass --force to download again.
// Data © OpenStreetMap contributors, ODbL.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, MARGIN_M } from './routes.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, 'raw');
mkdirSync(rawDir, { recursive: true });
const force = process.argv.includes('--force');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

function bbox(waypoints) {
  const lats = waypoints.map((w) => w[0]);
  const lons = waypoints.map((w) => w[1]);
  const dLat = MARGIN_M / 111320;
  const dLon = MARGIN_M / (111320 * Math.cos((lats[0] * Math.PI) / 180));
  return [Math.min(...lats) - dLat, Math.min(...lons) - dLon, Math.max(...lats) + dLat, Math.max(...lons) + dLon]
    .map((v) => v.toFixed(5))
    .join(',');
}

function query(b) {
  return `[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});
  way["building"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["leisure"~"^(park|garden)$"](${b});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${b});
  node["highway"="traffic_signals"](${b});
  node["natural"="tree"](${b});
);
out geom tags;`;
}

// Multipolygon lakes need their member ways, which the main query's output mode omits.
function waterQuery(b) {
  return `[out:json][timeout:120];
relation["natural"="water"](${b});
out geom;`;
}

// Street furniture and context: walls, metro, stations, speed breakers, bus stops,
// petrol pumps, land use and rocks.
function extraQuery(b) {
  return `[out:json][timeout:180];
(
  way["barrier"~"^(wall|fence|retaining_wall)$"](${b});
  way["railway"~"^(subway|light_rail|rail|monorail)$"](${b});
  node["railway"="station"](${b});
  node["public_transport"="station"](${b});
  node["traffic_calming"](${b});
  node["highway"="bus_stop"](${b});
  node["amenity"="fuel"](${b});
  way["amenity"="fuel"](${b});
  way["landuse"~"^(forest|meadow|farmland|cemetery|commercial|retail|industrial|residential|construction|brownfield|military)$"](${b});
  way["natural"~"^(wood|scrub|bare_rock|grassland|heath|sand)$"](${b});
  node["natural"="stone"](${b});
);
out geom tags;`;
}

// Named shops, restaurants, banks and the like, for real signboards.
function poiQuery(b) {
  return `[out:json][timeout:120];
(
  node["shop"]["name"](${b});
  node["amenity"~"^(restaurant|cafe|fast_food|bank|pharmacy|clinic|hospital|atm|ice_cream|bar|cinema|hotel|school|college|bakery)$"]["name"](${b});
  node["tourism"~"^(hotel|guest_house)$"]["name"](${b});
  node["office"]["name"](${b});
  way["shop"]["name"](${b});
  way["amenity"~"^(restaurant|cafe|bank|hospital|cinema|school|college)$"]["name"](${b});
);
out center tags;`;
}

// Temples, mosques and churches (often mapped only as points).
function worshipQuery(b) {
  return `[out:json][timeout:120];
nwr["amenity"="place_of_worship"](${b});
out center tags;`;
}

const jobs = ROUTES.flatMap((route) => [
  { route, file: join(rawDir, `${route.id}.worship.json`), q: worshipQuery },
  { route, file: join(rawDir, `${route.id}.pois.json`), q: poiQuery },
  { route, file: join(rawDir, `${route.id}.json`), q: query },
  { route, file: join(rawDir, `${route.id}.water.json`), q: waterQuery },
  { route, file: join(rawDir, `${route.id}.extra.json`), q: extraQuery },
]);

for (const { route, file, q } of jobs) {
  if (existsSync(file) && !force) {
    console.log(`${file}: cached`);
    continue;
  }
  const b = bbox(route.waypoints);
  console.log(`${route.id}: downloading ${b}`);
  let text = null;
  for (let attempt = 0, wait = 10; attempt < 6; attempt++, wait *= 2) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'driving-sim-data-builder/0.1' },
      body: 'data=' + encodeURIComponent(q(b)),
    });
    if (res.ok) {
      text = await res.text();
      break;
    }
    if (![429, 502, 503, 504].includes(res.status)) throw new Error(`${route.id}: HTTP ${res.status} ${await res.text()}`);
    console.log(`${route.id}: server busy (HTTP ${res.status}), retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!text) throw new Error(`${route.id}: gave up after retries`);
  writeFileSync(file, text);
  console.log(`${route.id}: ${(text.length / 1e6).toFixed(1)} MB`);
  await new Promise((r) => setTimeout(r, 3000)); // be polite to the shared server
}

// ---------- elevation: Terrarium-encoded terrain tiles (Mapzen / AWS Open Data) ----------
export const DEM_ZOOM = 15;
const demDir = join(rawDir, 'dem');
mkdirSync(demDir, { recursive: true });
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** DEM_ZOOM);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** DEM_ZOOM);
};
const tiles = new Set();
for (const route of ROUTES) {
  const lats = route.waypoints.map((w) => w[0]), lons = route.waypoints.map((w) => w[1]);
  const m = (MARGIN_M + 1200) / 111320;
  const mLon = m / Math.cos((lats[0] * Math.PI) / 180);
  for (let x = tileX(Math.min(...lons) - mLon); x <= tileX(Math.max(...lons) + mLon); x++)
    for (let y = tileY(Math.max(...lats) + m); y <= tileY(Math.min(...lats) - m); y++) tiles.add(`${x}_${y}`);
}
let fetched = 0;
for (const t of tiles) {
  const file = join(demDir, `${DEM_ZOOM}_${t}.png`);
  if (existsSync(file) && !force) continue;
  const [x, y] = t.split('_');
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`terrain tile ${t}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
}
console.log(`terrain: ${tiles.size} tiles (${fetched} downloaded)`);
