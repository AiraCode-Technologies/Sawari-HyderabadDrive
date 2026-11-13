import { Game } from './game.js';

const app = document.getElementById('app');
const COLORS = ['#c8202a', '#f1f1ee', '#1f4f9a', '#a9aeb4', '#202326', '#d9822b'];
const SETTINGS_VERSION = 2;
const DEFAULTS = { v: SETTINGS_VERSION, route: 'tank-bund', color: COLORS[0], traffic: 'dense', guides: 'on', voice: 'on', quality: 'high', camera: 'chase', time: 'noon' };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('hyd-drive-settings') || '{}');
    // settings saved before dense traffic existed move to the new default once
    if ((saved.v || 1) < 2) {
      delete saved.traffic;
      saved.v = SETTINGS_VERSION;
    }
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem('hyd-drive-settings', JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

let settings = loadSettings();
// a link from the website can pick the route: play.html?route=charminar
const wanted = new URLSearchParams(location.search).get('route');
if (wanted) settings.route = wanted;
let index = null;
let game = null;
const cache = new Map();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function seg(name, options) {
  return `<div class="seg" data-set="${name}">${options.map(([v, label]) => `<button data-v="${v}" class="${settings[name] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function menu() {
  let bests = {};
  try {
    bests = JSON.parse(localStorage.getItem('hyd-drive-best') || '{}');
  } catch {
    /* no stored bests */
  }
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <div class="menu-inner">
      <div class="brand">
        <div class="brand-mark"><img src="logo.svg" alt="" width="48" height="48" /></div>
        <div><h1 class="brand-name">Sawari</h1><div class="brand-tag">Drive Hyderabad</div></div>
        <a class="home-link" href="index.html">← Back to the website</a>
      </div>
      <p class="tagline">Practise famous Hyderabad roads in your browser: real streets, left-hand traffic, signals and turn-by-turn guidance.</p>
      <div class="section-title">Choose a route</div>
      <div class="routes">
        ${index.routes.map((r) => `
          <button class="route-card ${settings.route === r.id ? 'selected' : ''}" data-route="${r.id}">
            <div class="area">${esc(r.area)}</div>
            <h3>${esc(r.name)}</h3>
            <p>${esc(r.blurb)}</p>
            <div class="route-meta">
              <span class="chip ${r.difficulty.toLowerCase()}">${esc(r.difficulty)}</span>
              <span class="chip">${(r.length / 1000).toFixed(1)} km</span>
              <span class="chip">${r.turns ? `${r.turns} turn${r.turns > 1 ? 's' : ''}` : 'No turns'}</span>
            </div>
            ${bests[r.id] ? `<div class="pb">Your best: ${bests[r.id].score} · ${Math.floor(bests[r.id].time / 60)}:${String(bests[r.id].time % 60).padStart(2, '0')}</div>` : ''}
          </button>`).join('')}
      </div>
      <div class="section-title">Options</div>
      <div class="options">
        <div class="option"><label>Car colour</label><div class="seg" data-set="color">${COLORS.map((c) => `<button class="swatch ${settings.color === c ? 'on' : ''}" data-v="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
        <div class="option"><label>Time of day</label>${seg('time', [['morning', 'Morning'], ['noon', 'Midday'], ['evening', 'Evening'], ['night', 'Night']])}</div>
        <div class="option"><label>Traffic</label>${seg('traffic', [['off', 'None'], ['low', 'Light'], ['medium', 'Normal'], ['high', 'Busy'], ['dense', 'Dense']])}</div>
        <div class="option"><label>Route band and steering guide</label>${seg('guides', [['on', 'Show'], ['off', 'Hide']])}</div>
        <div class="option"><label>Spoken directions</label>${seg('voice', [['on', 'On'], ['off', 'Off']])}</div>
        <div class="option"><label>Graphics</label>${seg('quality', [['high', 'High (shadows)'], ['low', 'Fast']])}</div>
        <div class="option"><label>Start in</label>${seg('camera', [['chase', 'Chase view'], ['cockpit', 'Driver’s seat']])}</div>
      </div>
      <div class="start-row">
        <button class="primary" data-start>Start driving</button>
        <div class="keys"><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> drive · <kbd>Q</kbd> <kbd>E</kbd> indicators · <kbd>C</kbd> camera · <kbd>Tab</kbd> all controls</div>
      </div>
      <p class="credit">Road, building and lake data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, available under the ODbL. For practice only: this simulator does not replace driving lessons, and routes are not official test routes.</p>
    </div>`;
  el.addEventListener('click', (e) => {
    const card = e.target.closest('[data-route]');
    if (card) {
      settings.route = card.dataset.route;
      el.querySelectorAll('.route-card').forEach((c) => c.classList.toggle('selected', c === card));
    }
    const opt = e.target.closest('.seg button');
    if (opt) {
      const name = opt.parentElement.dataset.set;
      settings[name] = opt.dataset.v;
      opt.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === opt));
    }
    if (e.target.closest('[data-start]')) {
      saveSettings(settings);
      el.remove();
      play(settings.route);
    }
    saveSettings(settings);
  });
  app.appendChild(el);
}

function loading(text) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="box"><div class="spinner"></div><div>${esc(text)}</div></div>`;
  app.appendChild(el);
  return el;
}

async function loadWorld(id) {
  if (!cache.has(id)) {
    const res = await fetch(`data/${id}.json`);
    if (!res.ok) throw new Error(`Could not load route data (HTTP ${res.status})`);
    cache.set(id, await res.json());
  }
  return cache.get(id);
}

async function play(id) {
  const meta = index.routes.find((r) => r.id === id);
  const l = loading(`Building ${meta ? meta.name : 'route'}…`);
  try {
    const world = await loadWorld(id);
    await new Promise((r) => setTimeout(r, 30)); // let the loading screen paint
    game = new Game(app, world, settings, (action) => {
      game.dispose();
      game = null;
      if (action === 'restart') play(id);
      else menu();
    });
    game.start();
    if (import.meta.env.DEV) window.__game = game; // handle for automated browser tests
  } catch (err) {
    console.error(err);
    alert(`Sorry, the route could not be loaded: ${err.message}`);
    menu();
  } finally {
    l.remove();
  }
}

async function boot() {
  const l = loading('Loading routes…');
  try {
    const res = await fetch('data/routes.json');
    index = await res.json();
    if (!index.routes.some((r) => r.id === settings.route)) settings.route = index.routes[0].id;
    menu();
  } catch (err) {
    l.innerHTML = `<div class="box">Could not load the route list. Run <kbd>npm run build-data</kbd> first.</div>`;
    return;
  }
  l.remove();
}

boot();
