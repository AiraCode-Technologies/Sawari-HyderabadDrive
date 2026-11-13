import * as THREE from 'three';
import { Geo, UP, c3, P } from './geo.js';
import { mergeColored, m4, hash01, pointInPolygon, addTiled, instancedTiled } from '../util.js';
import { adMat, adTexture, TELUGU_FONT } from './ads.js';

// Building classes from the data builder.
const K = { house: 0, apartments: 1, shops: 2, office: 3, temple: 4, mosque: 5, industrial: 6, institution: 7, construction: 8, church: 9 };

// Colours by class, with area variants: the Old City's lime-washed pastels,
// Banjara Hills' white villas, HITEC City's glass.
const PALETTE = {
  [K.house]: ['#f1e3c6', '#e8c9a8', '#d9e4d3', '#f2d4d0', '#e7e0f0', '#f4ecd2', '#cfe0e8', '#f3dfb5'],
  [K.apartments]: ['#efe8dc', '#e4d7c2', '#f0e1cc', '#d7d9d6', '#efe4d6', '#e9dccb'],
  [K.shops]: ['#e9dcc4', '#e4cfa9', '#d6d0c4', '#efe1c9', '#e6d6c8'],
  [K.office]: ['#7fa3bd', '#6f93a8', '#8fb0c0', '#9aa7b2', '#86a0ad'],
  [K.temple]: ['#f6f1e6'],
  [K.mosque]: ['#f1ede4', '#ece4d2'],
  [K.industrial]: ['#b5b2aa', '#a9aba7', '#bdb6a6'],
  [K.institution]: ['#efe3cf', '#ece6d8'],
  [K.construction]: ['#9d9a94', '#a39e95'],
  [K.church]: ['#f2efe8', '#ece6da'],
};
const OLD_CITY = ['#e9d9b8', '#d9c9a3', '#cfe0d0', '#e8d0c0', '#d6d9e8', '#f0e2c4', '#c9d6c0'];
const VILLAS = ['#f4f2ec', '#ecebe6', '#e9e4da', '#dfe2e3', '#f2ece0'];
const SIGN_BG = ['#c0392b', '#f1c40f', '#2e86c1', '#27ae60', '#8e44ad', '#e67e22', '#f4f4f0', '#16a085', '#d35400', '#1f3a93', '#b71c5c', '#2d3436'];
const SHUTTER = [c3('#5b5f63'), c3('#6d5a44'), c3('#4a5560'), c3('#7a6248')];
// Generic boards for shops with no mapped name: the usual Hyderabad high street.
const GENERIC = [
  'Irani Chai & Osmania Biscuits|ఇరానీ చాయ్', 'Tiffin Centre|టిఫిన్ సెంటర్', 'Kirana General Store|కిరాణా జనరల్ స్టోర్',
  'Medical & General|మెడికల్ & జనరల్', 'Mobiles & Accessories|మొబైల్స్', 'Biryani House|బిర్యానీ హౌస్',
  'Sweets & Bakery|స్వీట్స్ & బేకరీ', 'Xerox & Stationery|జిరాక్స్ & స్టేషనరీ', 'Hardware & Paints|హార్డ్‌వేర్ & పెయింట్స్',
  'Ladies Tailors|లేడీస్ టైలర్స్', 'Fancy Store|ఫ్యాన్సీ స్టోర్', 'Optical Centre|ఆప్టికల్స్',
  'Fruits & Vegetables|పండ్లు & కూరగాయలు', 'Hair Salon|హెయిర్ సెలూన్', 'Electricals|ఎలక్ట్రికల్స్',
  'Pan Shop|పాన్ షాప్', 'Juice Centre|జ్యూస్ సెంటర్', 'Bangles & Pearls|గాజులు & ముత్యాలు',
];


// Local-style shop names for boards with no mapped name: a common Hyderabad
// prefix (a deity, a blessing, a place) and a trade, written in Telugu and English.
const PREFIX = {
  common: [['Sri Lakshmi', 'శ్రీ లక్ష్మి'], ['Sri Venkateswara', 'శ్రీ వెంకటేశ్వర'], ['Sai Krishna', 'సాయి కృష్ణ'], ['Balaji', 'బాలాజీ'],
    ['Durga', 'దుర్గా'], ['Ganesh', 'గణేష్'], ['Hanuman', 'హనుమాన్'], ['Sri Rama', 'శ్రీ రామ'], ['Annapurna', 'అన్నపూర్ణ'],
    ['Raghavendra', 'రాఘవేంద్ర'], ['Vijaya', 'విజయ'], ['Padmavathi', 'పద్మావతి'], ['Mahalakshmi', 'మహాలక్ష్మి'],
    ['Deccan', 'డెక్కన్'], ['Golconda', 'గోల్కొండ'], ['New Hyderabad', 'న్యూ హైదరాబాద్']],
  old: [['Bismillah', 'బిస్మిల్లా'], ['Al-Madina', 'అల్ మదీనా'], ['Noor', 'నూర్'], ['Ameer', 'అమీర్'], ['Golconda', 'గోల్కొండ'],
    ['New Hyderabad', 'న్యూ హైదరాబాద్'], ['Sri Lakshmi', 'శ్రీ లక్ష్మి'], ['Balaji', 'బాలాజీ'], ['Deccan', 'డెక్కన్']],
};
const TRADE = [['General Stores', 'జనరల్ స్టోర్స్'], ['Tiffins', 'టిఫిన్స్'], ['Kirana', 'కిరాణా'], ['Medicals', 'మెడికల్స్'],
  ['Mobiles', 'మొబైల్స్'], ['Sweets', 'స్వీట్స్'], ['Bakery', 'బేకరీ'], ['Hotel', 'హోటల్'], ['Tailors', 'టైలర్స్'],
  ['Electricals', 'ఎలక్ట్రికల్స్'], ['Hardware', 'హార్డ్‌వేర్'], ['Fancy Store', 'ఫ్యాన్సీ స్టోర్'], ['Jewellers', 'జ్యువెలర్స్'],
  ['Textiles', 'టెక్స్‌టైల్స్'], ['Opticals', 'ఆప్టికల్స్'], ['Xerox', 'జిరాక్స్'], ['Hair Saloon', 'హెయిర్ సెలూన్'],
  ['Biryani Point', 'బిర్యానీ పాయింట్'], ['Irani Cafe', 'ఇరానీ కేఫ్'], ['Fruit Juice', 'ఫ్రూట్ జ్యూస్']];
function localNames(style, n) {
  const pre = style === 'old' ? PREFIX.old : PREFIX.common;
  const out = [];
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const a = pre[Math.floor(hash01(i * 7919 + 13) * pre.length)], b = TRADE[Math.floor(hash01(i * 104729 + 7) * TRADE.length)];
    const label = `${a[0]} ${b[0]}|${a[1]} ${b[1]}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function canvasTex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// one bay x one storey of an ordinary concrete-frame building
const windowTexture = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#5d6b78';
  g.fillRect(30, 30, 68, 58);
  g.fillStyle = '#7d8c99';
  g.fillRect(30, 30, 68, 14);
  g.fillStyle = '#e6e1d8';
  g.fillRect(24, 88, 80, 7);
  g.fillStyle = '#d9d3c8';
  g.fillRect(0, 122, 128, 6);
});
// grilled windows with a louvred top light (common on 1980s-2000s houses)
const grilleTexture = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#4e5a63';
  g.fillRect(28, 36, 72, 54);
  g.fillStyle = '#8b97a0';
  g.fillRect(28, 22, 72, 12);
  g.strokeStyle = '#2b2f33';
  g.lineWidth = 3;
  for (let x = 36; x < 100; x += 10) { g.beginPath(); g.moveTo(x, 36); g.lineTo(x, 90); g.stroke(); }
  for (let y = 48; y < 90; y += 14) { g.beginPath(); g.moveTo(28, y); g.lineTo(100, y); g.stroke(); }
  g.fillStyle = '#d8d1c4';
  g.fillRect(22, 90, 84, 6);
  g.fillStyle = '#cfc8bb';
  g.fillRect(0, 122, 128, 6);
});
// wide sliding windows with aluminium frames (newer apartments)
const slidingTexture = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6c7f8e';
  g.fillRect(14, 34, 100, 50);
  g.fillStyle = '#9fb3c2';
  g.fillRect(14, 34, 100, 12);
  g.fillStyle = '#c9ced2';
  g.fillRect(14, 34, 100, 3);
  g.fillRect(14, 81, 100, 3);
  g.fillRect(63, 34, 3, 50);
  g.fillStyle = '#ddd6ca';
  g.fillRect(0, 120, 128, 8);
});
// Old City: tall arched windows with green shutters
const archTexture = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#4c5a50';
  g.beginPath();
  g.moveTo(40, 100);
  g.lineTo(40, 48);
  g.quadraticCurveTo(40, 22, 64, 18);
  g.quadraticCurveTo(88, 22, 88, 48);
  g.lineTo(88, 100);
  g.closePath();
  g.fill();
  g.fillStyle = '#5f8a62';
  g.fillRect(30, 50, 9, 50);
  g.fillRect(89, 50, 9, 50);
  g.fillStyle = '#e7dfcf';
  g.fillRect(32, 100, 64, 6);
  g.fillRect(0, 120, 128, 8);
});
// curtain-wall glazing
const glassTexture = () => canvasTex(128, 128, (g) => {
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#dfe9f0');
  grd.addColorStop(1, '#9fb3c2');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6c7a86';
  g.fillRect(0, 108, 128, 20);
  g.fillStyle = '#56626c';
  for (const x of [0, 42, 85]) g.fillRect(x, 0, 4, 128);
});

// Night: which window panes are lit. An 8 x 8 block of bays, each pane lit or
// dark at random, laid over the day texture's repeat (one cell per bay/storey).
const PANES = { window: [30, 30, 68, 58], grille: [28, 22, 72, 68], sliding: [14, 34, 100, 50], arch: [40, 22, 48, 78], glass: [6, 4, 120, 100] };
function litTexture(kind, seed) {
  const C = 8, S = 32;
  const [px, py, pw, ph] = PANES[kind].map((v) => (v * S) / 128);
  const t = canvasTex(C * S, C * S, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, C * S, C * S);
    for (let j = 0; j < C; j++)
      for (let i = 0; i < C; i++) {
        const r = hash01(seed * 131 + j * C + i);
        if (r > (kind === 'glass' ? 0.55 : 0.38)) continue;
        g.fillStyle = r < 0.08 ? '#cfe0ff' : r < 0.2 ? '#ffe2a8' : '#ffc977';
        g.fillRect(i * S + px, j * S + py, pw, ph);
      }
  });
  t.repeat.set(1 / C, 1 / C);
  return t;
}
const nightMat = (mat, kind, seed, list) => {
  mat.emissiveMap = litTexture(kind, seed);
  mat.emissive.set('#ffffff');
  mat.emissiveIntensity = 0;
  list.push(mat);
  return mat;
};

// Shop-sign atlas: each cell is a painted board with its name.
function signAtlas(names) {
  const COLS = 4, CW = 512, CH = 80;
  const rows = Math.max(1, Math.ceil(names.length / COLS));
  const map = new Map();
  const tex = canvasTex(COLS * CW, rows * CH, (g) => {
    names.forEach((name, i) => {
      const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
      const bg = SIGN_BG[Math.floor(hash01(i * 977 + name.length * 31) * SIGN_BG.length)];
      g.fillStyle = bg;
      g.fillRect(x, y, CW, CH);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 6;
      g.strokeRect(x + 3, y + 3, CW - 6, CH - 6);
      const light = ['#f1c40f', '#f4f4f0', '#e67e22'].includes(bg);
      g.fillStyle = light ? '#1b1b1b' : '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const [en, te] = name.split('|');
      const fitFont = (text, size, family, max) => {
        g.font = `bold ${size}px ${family}`;
        while (g.measureText(text).width > max && size > 16) g.font = `bold ${(size -= 2)}px ${family}`;
      };
      if (te) {
        // Telugu above, English below, as on most Hyderabad shop boards
        fitFont(te, 34, TELUGU_FONT, CW - 40);
        g.fillText(te, x + CW / 2, y + 27);
        fitFont(en, 26, '"Arial Narrow", Arial, sans-serif', CW - 40);
        g.fillText(en, x + CW / 2, y + 62);
      } else {
        fitFont(en, 58, '"Arial Narrow", Arial, sans-serif', CW - 40);
        g.fillText(en, x + CW / 2, y + CH / 2 + 2);
      }
      map.set(name, [(i % COLS) / COLS, 1 - (Math.floor(i / COLS) + 1) / rows, ((i % COLS) + 1) / COLS, 1 - Math.floor(i / COLS) / rows]);
    });
  }, false);
  return { tex, map };
}

export function buildBuildings(world, group, quality, T, index) {
  const style = world.style || 'central';
  const winVariants = [new Geo(true), new Geo(true), new Geo(true)], glass = new Geo(true), plain = new Geo(), roofs = new Geo(), boards = new Geo(), named = new Geo(true);
  const tanks = [], heads = [], extras = [], rooftopAds = [];
  const parts = [];

  // distance to the drive line, for spending detail where the player looks
  const routeCells = new Set();
  for (const d of world.route.drive) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) routeCells.add(`${Math.floor(d[0] / 80) + dx},${Math.floor(d[1] / 80) + dy}`);
  const nearRoute = (x, y) => routeCells.has(`${Math.floor(x / 80)},${Math.floor(y / 80)}`);

  // every board name we will paint: real names first, then the generic ones
  const names = [];
  for (const b of world.buildings) for (const n of b.s || []) if (!names.includes(n) && names.length < 110) names.push(n);
  const LOCAL = localNames(style, 56);
  for (const n of [...GENERIC, ...LOCAL]) names.push(n);
  const BOARDS = [...LOCAL, ...LOCAL, ...GENERIC]; // local names twice as common as plain trade boards
  const atlas = signAtlas(names);
  const signUV = (name) => atlas.map.get(name);

  for (const bd of world.buildings) {
    const p = bd.p, k = bd.k ?? K.house;
    let gmin = Infinity, gmax = -Infinity, area2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], c = p[(i + 1) % p.length];
      const g = T.at(q[0], q[1]);
      if (g < gmin) gmin = g;
      if (g > gmax) gmax = g;
      area2 += q[0] * c[1] - c[0] * q[1];
      cx += q[0];
      cy += q[1];
    }
    cx /= p.length;
    cy /= p.length;
    const area = Math.abs(area2) / 2;
    const ccw = area2 > 0 ? 1 : -1;
    // A building beside a street takes its floor level from that street (the
    // footpath, 15 cm above the carriageway), so its shopfronts and doors line up
    // with the road instead of floating above or sinking below it on a slope.
    const terrainMin = gmin;
    let nearest = null;
    for (const q of [...p, [cx, cy]]) {
      const s = index.surface(q[0], q[1], T.at(q[0], q[1]), 18, 6);
      if (s && s.h - T.at(q[0], q[1]) < 0.8 && (!nearest || s.d - s.seg.w / 2 < nearest.d - nearest.seg.w / 2)) nearest = s;
    }
    if (nearest) {
      gmin = nearest.h + 0.15;
      gmax = Math.max(gmax, gmin);
    }
    const base = Math.min(terrainMin, gmin) - 0.6, top = gmax + bd.h;
    const seed = Math.abs(Math.round(p[0][0] * 13 + p[0][1] * 7));
    const detail = nearRoute(cx, cy);
    let palette = PALETTE[k] || PALETTE[K.house];
    if (style === 'old' && (k === K.house || k === K.shops || k === K.apartments)) palette = OLD_CITY;
    if (style === 'upscale' && k === K.house) palette = VILLAS;
    const col = c3(palette[bd.c % palette.length]).multiplyScalar(0.94 + hash01(seed) * 0.1);
    const dark = col.clone().multiplyScalar(0.78);
    const residential = k === K.house || k === K.apartments || k === K.shops || k === K.institution;
    const parapet = residential ? 0.9 : 0;
    const floors = Math.max(1, Math.round(bd.h / 3.3));
    const win = winVariants[style === 'old' ? 0 : k === K.apartments ? 1 + (seed % 2) : seed % 3];
    const winGeo = k === K.office ? glass : k === K.industrial || k === K.construction ? null : win;
    const hasNames = bd.s && bd.s.length;
    let hoardingDone = false;
    let namesUsed = 0;
    // walls, longest first for balconies
    const walls = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.05) continue;
      walls.push({ i, a, c, len, ox: ((c[1] - a[1]) / len) * ccw, oy: (-(c[0] - a[0]) / len) * ccw });
    }
    const longest = [...walls].sort((x, y) => y.len - x.len).slice(0, 2);

    for (const w of walls) {
      const { a, c, len, ox, oy } = w;
      const out = [ox, 0, -oy];
      const wallTop = top + parapet;
      // does this wall face a road?
      let facesRoad = false;
      if ((k === K.shops || hasNames || detail) && len > 3) {
        const mx = (a[0] + c[0]) / 2 + ox * 6, my = (a[1] + c[1]) / 2 + oy * 6;
        const s = index.surface(mx, my, T.at(mx, my), 6);
        facesRoad = !!s && s.road.k !== 'service';
        if (s && detail && ['trunk', 'primary', 'secondary'].includes(s.road.k) && !hoardingDone && bd.h < 22 && len > 6 && hash01(seed * 3 + 7) < 0.07) {
          hoardingDone = true;
          rooftopAds.push({ x: (a[0] + c[0]) / 2 - ox * 1.2, y: (a[1] + c[1]) / 2 - oy * 1.2, top, face: Math.atan2(ox, oy), t: seed });
        }
      }
      const shopFront = facesRoad && (k === K.shops || (hasNames && k !== K.office));
      let floor0 = shopFront ? gmin + 3.4 : base;
      if (k === K.office && style === 'tech') floor0 = gmin + 7; // stone podium below the glass
      if (shopFront || floor0 > base) {
        const lower = shopFront ? SHUTTER[(seed + w.i) % SHUTTER.length] : c3('#cfc6b6');
        plain.quad(P(a[0], a[1], base), P(c[0], c[1], base), P(c[0], c[1], floor0), P(a[0], a[1], floor0), lower, null, out);
      }
      // signboards: the real business name if mapped, otherwise a typical shop board
      if (shopFront || (facesRoad && hasNames)) {
        const bays = hasNames ? 1 : Math.max(1, Math.min(4, Math.round(len / 5)));
        for (let b = 0; b < bays; b++) {
          const name = hasNames ? bd.s[namesUsed++ % bd.s.length] : BOARDS[Math.floor(hash01(seed * 31 + w.i * 7 + b) * BOARDS.length)];
          const uv = signUV(name);
          const span = hasNames ? Math.min(0.85, 9 / len) : 0.92 / bays;
          const t0 = hasNames ? 0.5 - span / 2 : b / bays + 0.04, t1 = hasNames ? 0.5 + span / 2 : (b + 1) / bays - 0.04;
          const sx0 = a[0] + (c[0] - a[0]) * t0 + ox * 0.16, sy0 = a[1] + (c[1] - a[1]) * t0 + oy * 0.16;
          const sx1 = a[0] + (c[0] - a[0]) * t1 + ox * 0.16, sy1 = a[1] + (c[1] - a[1]) * t1 + oy * 0.16;
          const hb = k === K.office ? gmin + 6.2 : gmin + 2.7, ht = hb + (hasNames ? 1.0 : 0.85);
          // text reads left to right for someone facing the wall from outside
          if (!uv) continue;
          const [ul, ur] = ccw > 0 ? [uv[0], uv[2]] : [uv[2], uv[0]];
          named.quad(P(sx0, sy0, hb), P(sx1, sy1, hb), P(sx1, sy1, ht), P(sx0, sy0, ht), c3('#ffffff'), [[ul, uv[1]], [ur, uv[1]], [ur, uv[3]], [ul, uv[3]]], out);
        }
        if (shopFront && detail) {
          // a shallow awning over the shopfronts
          plain.quad(P(a[0] + ox * 0.05, a[1] + oy * 0.05, gmin + 2.55), P(c[0] + ox * 0.05, c[1] + oy * 0.05, gmin + 2.55), P(c[0] + ox * 1.1, c[1] + oy * 1.1, gmin + 2.3), P(a[0] + ox * 1.1, a[1] + oy * 1.1, gmin + 2.3), c3(['#2e6da4', '#b03a2e', '#1e8449', '#7d6608'][seed % 4]), null, UP);
        }
      }
      // main wall
      if (winGeo) {
        const u1 = Math.max(1, Math.round(len / (k === K.office ? 3 : 4)));
        // whole-bay offsets per wall so each facade gets its own pattern of lit rooms at night
        const uo = (seed * 3 + w.i * 5) % 8, vo = (seed * 7) % 8;
        const v0 = (floor0 - gmin) / 3.3 + vo, v1 = (wallTop - gmin) / 3.3 + vo;
        winGeo.quad(P(a[0], a[1], floor0), P(c[0], c[1], floor0), P(c[0], c[1], wallTop), P(a[0], a[1], wallTop), col, [[uo, v0], [uo + u1, v0], [uo + u1, v1], [uo, v1]], out);
      } else {
        plain.quad(P(a[0], a[1], floor0), P(c[0], c[1], floor0), P(c[0], c[1], wallTop), P(a[0], a[1], wallTop), col, null, out);
        if (k === K.construction)
          for (let f = gmin + 3.3; f < top; f += 3.3)
            plain.quad(P(a[0] + ox * 0.05, a[1] + oy * 0.05, f), P(c[0] + ox * 0.05, c[1] + oy * 0.05, f), P(c[0] + ox * 0.05, c[1] + oy * 0.05, f + 0.35), P(a[0] + ox * 0.05, a[1] + oy * 0.05, f + 0.35), c3('#7f7b74'), null, out);
      }
      if (!detail) continue;
      // floor slab edges showing on the facade
      if ((k === K.apartments || k === K.office || k === K.shops || k === K.institution) && len > 2) {
        for (let f = 1; f < floors; f++) {
          const y = gmin + f * 3.3 - 0.1;
          if (y < floor0 + 0.2) continue;
          plain.quad(P(a[0] + ox * 0.08, a[1] + oy * 0.08, y), P(c[0] + ox * 0.08, c[1] + oy * 0.08, y), P(c[0] + ox * 0.08, c[1] + oy * 0.08, y + 0.22), P(a[0] + ox * 0.08, a[1] + oy * 0.08, y + 0.22), k === K.office ? c3('#c9ced2') : dark, null, out);
        }
      }
      // corner columns
      if (residential && len > 2) parts.push({ geo: new THREE.BoxGeometry(0.42, top - base, 0.42), color: dark.getStyle(), matrix: m4(a[0] + ox * 0.12, (top + base) / 2, -(a[1] + oy * 0.12)) });
      // a front door with a small canopy on the road side of houses and flats
      if (facesRoad && !shopFront && (k === K.house || k === K.apartments || k === K.institution) && len > 4 && w === walls.find((x) => x.len > 4)) {
        const t = 0.5, dx = a[0] + (c[0] - a[0]) * t, dy = a[1] + (c[1] - a[1]) * t;
        const ang = -Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2;
        parts.push({ geo: new THREE.BoxGeometry(1.3, 2.3, 0.12), color: '#5a3a24', matrix: m4(dx + ox * 0.04, gmin + 1.15, -(dy + oy * 0.04), 0, ang, 0) });
        parts.push({ geo: new THREE.BoxGeometry(2.2, 0.12, 1.0), color: dark.getStyle(), matrix: m4(dx + ox * 0.5, gmin + 2.6, -(dy + oy * 0.5), 0, ang, 0) });
        parts.push({ geo: new THREE.BoxGeometry(2.0, 0.3, 1.2), color: '#bdb5a6', matrix: m4(dx + ox * 0.6, gmin + 0.15, -(dy + oy * 0.6), 0, ang, 0) });
      }
      // split AC outdoor units hung on the walls of flats and offices
      if ((k === K.apartments || k === K.office || k === K.shops) && len > 4) {
        for (let f = 1; f < Math.min(floors, 8); f++) {
          if (hash01(seed * 7 + w.i * 13 + f) > 0.45) continue;
          const t = 0.2 + hash01(seed + w.i + f * 3) * 0.6;
          const ux = a[0] + (c[0] - a[0]) * t + ox * 0.3, uy = a[1] + (c[1] - a[1]) * t + oy * 0.3;
          const ang = -Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2;
          parts.push({ geo: new THREE.BoxGeometry(0.85, 0.6, 0.32), color: '#e4e4df', matrix: m4(ux, gmin + f * 3.3 + 0.9, -uy, 0, ang, 0) });
        }
      }
      // concrete sunshades (chajjas) over each storey's windows
      if (residential && len > 2.5) {
        for (let f = shopFront ? 1 : 0; f < floors; f++) {
          const y = gmin + f * 3.3 + 2.55;
          if (y > top - 0.5) break;
          const d = style === 'old' ? 0.35 : 0.5;
          const A0 = P(a[0] + ox * 0.02, a[1] + oy * 0.02, y), C0 = P(c[0] + ox * 0.02, c[1] + oy * 0.02, y);
          const A1 = P(a[0] + ox * d, a[1] + oy * d, y), C1 = P(c[0] + ox * d, c[1] + oy * d, y);
          plain.quad(A0, C0, C1, A1, dark, null, UP);
          plain.quad(A1, C1, [C1[0], C1[1] - 0.1, C1[2]], [A1[0], A1[1] - 0.1, A1[2]], dark, null, out);
        }
      }
      // Old City cornice and Banjara/central parapet trims
      if (style === 'old' && residential) {
        const y = top - 0.15;
        plain.quad(P(a[0] + ox * 0.3, a[1] + oy * 0.3, y), P(c[0] + ox * 0.3, c[1] + oy * 0.3, y), P(c[0] + ox * 0.3, c[1] + oy * 0.3, y + 0.35), P(a[0] + ox * 0.3, a[1] + oy * 0.3, y + 0.35), dark, null, out);
      }
      // HITEC City glass: vertical fins
      if (k === K.office && style === 'tech' && len > 6) {
        for (let s = 1.5; s < len - 1; s += 3) {
          const fx = a[0] + ((c[0] - a[0]) * s) / len + ox * 0.25, fy = a[1] + ((c[1] - a[1]) * s) / len + oy * 0.25;
          parts.push({ geo: new THREE.BoxGeometry(0.15, top - floor0, 0.5), color: '#d9dde0', matrix: m4(fx, (top + floor0) / 2, -fy, 0, -Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2, 0) });
        }
      }
      // apartment balconies on the two longest walls
      if ((k === K.apartments || (k === K.house && style === 'upscale')) && longest.includes(w) && len > 6) {
        const rail = style === 'upscale' || style === 'tech' ? '#9fc3d6' : '#3b3f45';
        const ang = -Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2;
        for (let f = 1; f < floors; f++) {
          for (let s = 3; s < len - 2.5; s += 7) {
            const bx = a[0] + ((c[0] - a[0]) * s) / len + ox * 0.6, by = a[1] + ((c[1] - a[1]) * s) / len + oy * 0.6;
            const y = gmin + f * 3.3;
            parts.push({ geo: new THREE.BoxGeometry(2.8, 0.15, 1.2), color: '#d8d2c6', matrix: m4(bx, y, -by, 0, ang, 0) });
            const rx = bx + ox * 0.55, ry = by + oy * 0.55;
            parts.push({ geo: new THREE.BoxGeometry(2.8, 0.95, 0.05), color: rail, matrix: m4(rx, y + 0.55, -ry, 0, ang, 0) });
          }
        }
      }
    }

    // roof
    const contour = p.map((q) => new THREE.Vector2(q[0], q[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const roofCol = k === K.industrial ? c3('#8d99a3') : col.clone().multiplyScalar(0.8);
    for (const [i0, i1, i2] of tris) roofs.tri(P(p[i0][0], p[i0][1], top), P(p[i1][0], p[i1][1], top), P(p[i2][0], p[i2][1], top), roofCol, null, UP);

    // rooftop life: black water tanks, stair heads, Old City chhatris
    if ((k === K.house || k === K.apartments || k === K.shops) && area > 25) {
      const n = k === K.apartments ? 2 + Math.floor(hash01(seed + 3) * 3) : hash01(seed + 5) < 0.75 ? 1 : 0;
      for (let t = 0; t < n; t++) {
        const tx = cx + (hash01(seed + t * 17) - 0.5) * Math.sqrt(area) * 0.5, ty = cy + (hash01(seed + t * 29) - 0.5) * Math.sqrt(area) * 0.5;
        if (pointInPolygon(tx, ty, p)) tanks.push([tx, ty, top]);
      }
      if (k === K.apartments && pointInPolygon(cx, cy, p)) heads.push([cx, cy, top, hash01(seed) * 3]);
      if (detail && hash01(seed + 21) < 0.35) {
        // rooftop solar water heater: tilted panel and tank, facing south
        const sx = cx + (hash01(seed + 23) - 0.5) * 2, sy = cy - 1.5;
        if (pointInPolygon(sx, sy, p)) {
          parts.push({ geo: new THREE.BoxGeometry(2.0, 0.08, 1.4), color: '#2b3a4a', matrix: m4(sx, top + 0.7, -sy, -0.5, 0, 0) });
          parts.push({ geo: new THREE.CylinderGeometry(0.28, 0.28, 2.0, 10), color: '#d9d9d4', matrix: m4(sx, top + 1.25, -(sy + 0.6), 0, 0, Math.PI / 2) });
        }
      }
      if (detail && hash01(seed + 31) < 0.25) {
        const dx2 = cx + (hash01(seed + 33) - 0.5) * 3, dy2 = cy + (hash01(seed + 35) - 0.5) * 3;
        if (pointInPolygon(dx2, dy2, p)) parts.push({ geo: new THREE.CylinderGeometry(0.4, 0.05, 0.12, 12), color: '#efefea', matrix: m4(dx2, top + 0.9, -dy2, 0.9, hash01(seed) * 6, 0) });
      }
      if (style === 'old' && detail && hash01(seed + 11) < 0.14 && pointInPolygon(cx, cy, p)) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ geo: new THREE.BoxGeometry(0.18, 1.8, 0.18), color: '#efe7d6', matrix: m4(cx + sx * 0.9, top + 0.9, -(cy + sz * 0.9)) });
        parts.push({ geo: new THREE.BoxGeometry(2.3, 0.15, 2.3), color: '#e3d8c3', matrix: m4(cx, top + 1.85, -cy) });
        parts.push({ geo: new THREE.SphereGeometry(1.0, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: '#efe7d6', matrix: m4(cx, top + 1.92, -cy) });
      }
    }
    if (k === K.temple || k === K.mosque || k === K.church) extras.push({ k, cx, cy, top, size: Math.min(Math.sqrt(area) * 0.75, 12), base: gmin });
  }

  const add = (geo, mat, cast = true, cull = 0) => {
    if (geo.empty) return;
    addTiled(group, geo.build(), mat, { tile: 250, cast: cast && quality.shadows, cull });
  };
  // window materials glow at dusk and night (game.js sets emissiveIntensity)
  const night = (group.userData.nightWindows ||= []);
  add(winVariants[0], nightMat(new THREE.MeshLambertMaterial({ vertexColors: true, map: style === 'old' ? archTexture() : windowTexture() }), style === 'old' ? 'arch' : 'window', 1, night));
  add(winVariants[1], nightMat(new THREE.MeshLambertMaterial({ vertexColors: true, map: grilleTexture() }), 'grille', 2, night));
  add(winVariants[2], nightMat(new THREE.MeshLambertMaterial({ vertexColors: true, map: slidingTexture() }), 'sliding', 3, night));
  add(glass, nightMat(new THREE.MeshPhongMaterial({ vertexColors: true, map: glassTexture(), shininess: 90, specular: '#7f8f9c' }), 'glass', 4, night));
  add(plain, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  add(roofs, new THREE.MeshLambertMaterial({ vertexColors: true }));
  add(boards, new THREE.MeshLambertMaterial({ vertexColors: true }), false, 650);
  add(named, new THREE.MeshLambertMaterial({ map: atlas.tex, emissive: '#202020', polygonOffset: true, polygonOffsetFactor: -2 }), false, 650);

  // rooftop water tanks and stair heads, instanced in tiles; small, so hidden far away
  instancedTiled(group, new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10).translate(0, 0.55, 0), new THREE.MeshLambertMaterial({ color: '#1d1e20' }), tanks, (t, d, i) => {
    d.position.set(t[0], t[2], -t[1]);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(0.85 + (i % 3) * 0.12);
  }, { tile: 250, cast: quality.shadows, cull: 900 });
  instancedTiled(group, new THREE.BoxGeometry(2.6, 2.6, 2.6).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: '#d8d1c3' }), heads, (h, d) => {
    d.position.set(h[0], h[2], -h[1]);
    d.rotation.set(0, h[3], 0);
    d.scale.set(1, 1, 1);
  }, { tile: 250, cast: quality.shadows });

  // rooftop hoardings facing the main road
  const boardGeo = new THREE.PlaneGeometry(9, 4.5);
  const frameMat = new THREE.MeshLambertMaterial({ color: '#5d6166' });
  for (const h of rooftopAds) {
    const board = new THREE.Mesh(boardGeo, adMat(h.t));
    board.position.set(h.x, h.top + 4.0, -h.y);
    board.rotation.y = -h.face + Math.PI; // plane faces +Z; turn it to face the road
    board.castShadow = quality.shadows;
    group.add(board);
    for (const s2 of [-1, 1]) {
      const lx = Math.cos(h.face) * s2 * 3.6, ly = -Math.sin(h.face) * s2 * 3.6;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, 0.2), frameMat);
      post.position.set(h.x + lx - Math.sin(h.face) * 0.3, h.top + 2.25, -(h.y + ly - Math.cos(h.face) * 0.3));
      group.add(post);
    }
  }

  // temple towers (gopuram), mosque domes with minarets, church towers with spires
  for (const e of extras) {
    const sz = Math.max(3, e.size);
    if (e.k === K.temple) {
      // gopuram: tiers narrowing upward, banded in cream and saffron, with a kalasam
      const tiers = sz > 6 ? 7 : 5;
      for (let t = 0; t < tiers; t++) {
        const w = sz * 0.62 * 0.84 ** t;
        parts.push({ geo: new THREE.BoxGeometry(w, 1.4, w * 0.8), color: t % 2 ? '#e58a2b' : '#f2e6cf', matrix: m4(e.cx, e.top + 0.7 + t * 1.4, -e.cy) });
        parts.push({ geo: new THREE.BoxGeometry(w * 1.04, 0.16, w * 0.84), color: '#b9472a', matrix: m4(e.cx, e.top + 1.38 + t * 1.4, -e.cy) });
      }
      const ty = e.top + tiers * 1.4;
      parts.push({ geo: new THREE.CylinderGeometry(0.2, sz * 0.12, 0.9, 8), color: '#e2b23a', matrix: m4(e.cx, ty + 0.45, -e.cy) });
      parts.push({ geo: new THREE.ConeGeometry(0.28, 1.2, 8), color: '#d4a62a', matrix: m4(e.cx, ty + 1.5, -e.cy) });
      // a saffron flag on a pole
      parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, 4, 6), color: '#8a8a8a', matrix: m4(e.cx + sz * 0.4, e.top + 2, -e.cy) });
      parts.push({ geo: new THREE.BoxGeometry(0.02, 0.5, 0.8), color: '#f57c00', matrix: m4(e.cx + sz * 0.4, e.top + 3.7, -(e.cy - 0.4)) });
    } else if (e.k === K.mosque) {
      // a large central dome on a drum, smaller corner domes, two tall minarets
      const r = sz * 0.3;
      parts.push({ geo: new THREE.CylinderGeometry(r * 1.05, r * 1.05, 1.4, 16), color: '#ece4d2', matrix: m4(e.cx, e.top + 0.7, -e.cy) });
      parts.push({ geo: new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), color: '#2f8a55', matrix: m4(e.cx, e.top + 1.4, -e.cy, 0, 0, 0, 1, 1.3, 1) });
      parts.push({ geo: new THREE.ConeGeometry(0.12, 1.2, 6), color: '#d4a62a', matrix: m4(e.cx, e.top + 1.4 + r * 1.3 + 0.6, -e.cy) });
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const dx = e.cx + sx * sz * 0.32, dy = e.cy + sy * sz * 0.32;
        parts.push({ geo: new THREE.SphereGeometry(r * 0.32, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: '#f1ede4', matrix: m4(dx, e.top, -dy) });
      }
      for (const sx of [-1, 1]) {
        const mx = e.cx + sx * sz * 0.5;
        const mh = e.top - e.base + 11;
        parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.55, mh, 8), color: '#f1ede4', matrix: m4(mx, e.base + mh / 2, -e.cy) });
        for (const f of [0.55, 0.8]) parts.push({ geo: new THREE.CylinderGeometry(0.75, 0.6, 0.35, 10), color: '#d9cfbd', matrix: m4(mx, e.base + mh * f, -e.cy) });
        parts.push({ geo: new THREE.SphereGeometry(0.55, 8, 6), color: '#2f8a55', matrix: m4(mx, e.base + mh + 0.3, -e.cy) });
        parts.push({ geo: new THREE.ConeGeometry(0.08, 0.8, 6), color: '#d4a62a', matrix: m4(mx, e.base + mh + 1.1, -e.cy) });
      }
    } else if (e.k === K.church) {
      // a pitched roof over the nave and a square bell tower with a spire and cross
      const w = Math.max(6, sz * 0.7), l = Math.max(8, sz * 1.1);
      const roof = new THREE.CylinderGeometry(w * 0.62, w * 0.62, l, 3, 1);
      roof.rotateX(Math.PI / 2);
      roof.rotateZ(Math.PI / 2);
      parts.push({ geo: roof, color: '#8f3b2b', matrix: m4(e.cx, e.top + w * 0.3, -e.cy, 0, 0, 0, 1, 0.75, 1) });
      const tx = e.cx, ty = e.cy - l * 0.45, th = 7;
      parts.push({ geo: new THREE.BoxGeometry(3, th, 3), color: '#f2efe8', matrix: m4(tx, e.top + th / 2, -ty) });
      parts.push({ geo: new THREE.BoxGeometry(1.2, 1.6, 3.05), color: '#5b4a3a', matrix: m4(tx, e.top + th - 1.4, -ty) });
      parts.push({ geo: new THREE.ConeGeometry(2.1, 5.5, 4), color: '#7a2f22', matrix: m4(tx, e.top + th + 2.75, -ty, 0, Math.PI / 4, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.12, 1.6, 0.12), color: '#f4f4f0', matrix: m4(tx, e.top + th + 6.3, -ty) });
      parts.push({ geo: new THREE.BoxGeometry(0.8, 0.12, 0.12), color: '#f4f4f0', matrix: m4(tx, e.top + th + 6.6, -ty) });
    }
  }
  if (parts.length) addTiled(group, mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { tile: 250, cast: quality.shadows, cull: 900 });
}
