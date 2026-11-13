import * as THREE from 'three';

// Hoarding artwork. Every brand here is invented for the game; the public-service
// messages are generic. Telugu lines sit above the English, as on many boards.
export const TELUGU_FONT = '"Nirmala UI", "Noto Sans Telugu", "Gautami", "Vani", sans-serif';
const ADS = [
  { bg: ['#7a0f2b', '#b3123c'], te: 'శ్రీ వెంకటేశ్వర సిల్క్స్', en: 'Wedding Silk Collection', sub: 'Abids · Kukatpally · Dilsukhnagar', fg: '#ffd56a' },
  { bg: ['#0f4c75', '#3282b8'], te: 'డెక్కన్ హోమ్స్', en: '2 & 3 BHK Apartments', sub: 'Ready to move · Near ORR', fg: '#ffffff' },
  { bg: ['#3d2c00', '#a87b00'], te: 'చార్మినార్ జ్యువెలర్స్', en: 'Gold · Diamonds · Pearls', sub: 'Since 1965', fg: '#fff3c4' },
  { bg: ['#1b5e20', '#43a047'], te: 'స్వచ్ఛ హైదరాబాద్', en: 'Keep our city clean', sub: 'Use the dustbin', fg: '#ffffff' },
  { bg: ['#b71c1c', '#e53935'], te: 'బిర్యానీ మహల్', en: 'Hyderabadi Dum Biryani', sub: 'Family restaurant · Open till midnight', fg: '#fff8e1' },
  { bg: ['#212121', '#4a148c'], te: 'ప్రేమ కథలు', en: 'In cinemas this Friday', sub: 'A new Telugu film', fg: '#ffd54f' },
  { bg: ['#e65100', '#fb8c00'], te: 'హెల్మెట్ ధరించండి', en: 'Wear a helmet. Arrive safe.', sub: 'Road safety message', fg: '#ffffff' },
  { bg: ['#004d40', '#00897b'], te: 'మెట్రో పాస్', en: 'One card for metro and bus', sub: 'Recharge at any station', fg: '#ffffff' },
];

const cache = new Map();
export function adTexture(i) {
  i = ((i % ADS.length) + ADS.length) % ADS.length;
  if (cache.has(i)) return cache.get(i);
  const a = ADS[i];
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 256);
  grd.addColorStop(0, a.bg[0]);
  grd.addColorStop(1, a.bg[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.arc(470, 40, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = a.fg;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = `bold 52px ${TELUGU_FONT}`;
  fit(g, a.te, 470, 52, TELUGU_FONT);
  g.fillText(a.te, 26, 92);
  g.fillStyle = '#ffffff';
  g.font = 'bold 40px Arial, sans-serif';
  fit(g, a.en, 470, 40, 'Arial, sans-serif');
  g.fillText(a.en, 26, 158);
  g.globalAlpha = 0.85;
  g.font = '24px Arial, sans-serif';
  g.fillText(a.sub, 26, 212);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(i, t);
  return t;
}

function fit(g, text, max, size, family) {
  while (g.measureText(text).width > max && size > 18) g.font = `bold ${(size -= 2)}px ${family}`;
}

export const AD_COUNT = ADS.length;

// One shared material per advert, so identical hoardings can be drawn together.
const adMats = new Map();
export function adMat(i) {
  const k = ((i % ADS.length) + ADS.length) % ADS.length;
  if (!adMats.has(k)) adMats.set(k, new THREE.MeshLambertMaterial({ map: adTexture(k), emissive: '#151515' }));
  return adMats.get(k);
}
