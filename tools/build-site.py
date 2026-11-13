"""Writes the website pages (index, routes, features, about) with a shared header
and footer. Run from the project root:  python tools/build-site.py
The game itself lives in play.html and is not generated here."""
import html as htmllib
import json
import re
import runpy
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import seo  # noqa: E402
from seo import img_tag  # noqa: E402
T = runpy.run_path(str(ROOT / 'tools/site-translations.py'))['T']
routes = json.loads((ROOT / 'public/data/routes.json').read_text(encoding='utf-8'))['routes']
total_km = sum(r['length'] for r in routes) / 1000

ICON = {
    'road': '<path d="M8 3 4 21M16 3l4 18M12 5v2M12 11v2M12 17v2"/>',
    'people': '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a6 6 0 0 1 12 0v1M16 4a3 3 0 0 1 0 6M21 21v-1a6 6 0 0 0-4-5.6"/>',
    'gauge': '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.2"/>',
    'moon': '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
    'pin': '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    'wheel': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M4.2 15.5l5.6-2.2M19.8 15.5l-5.6-2.2"/>',
    'building': '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>',
    'bolt': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    'chat': '<path d="M4 5h16v11H9l-5 4z"/>',
    'shield': '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    'alert': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    'data': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
}
def icon(name):
    return f'<div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[name]}</svg></div>'

LOGO = '<img src="/logo.svg" alt="" width="36" height="36" />'
PAGES = [('./', 'Home'), ('routes.html', 'Routes'), ('features.html', 'Features'), ('about.html', 'About &amp; FAQ')]
DIFF_NOTE = {'Easy': 'No turns to make: settle into a lane and get a feel for the car and the traffic.', 'Medium': 'A handful of turns, flyovers and busy junctions.', 'Hard': 'Tight Old City streets, a roundabout and nine turns in two kilometres.'}
WATCH = {
    'tank-bund': ['Two-wheelers filtering past on both sides', 'Speed breakers near the statues', 'Strollers crossing to the lake promenade in the evening'],
    'necklace-road': ['Long sweeping bends along the lake shore', 'Buses pulling in and out of stops', 'U-turn openings in the median'],
    'charminar': ['The roundabout around the Charminar itself', 'Stalls, autos and shoppers close to the kerb', 'Narrow lanes with parked two-wheelers'],
    'hitec-city': ['Flyover ramps and lane choice before the bridge', 'Merging traffic at Inorbit Mall', 'Signals on Road No. 36'],
    'banjara-hills': ['A steady 37 m climb from Masab Tank', 'Heavy traffic at every junction', 'Buses and autos stopping without warning'],
}

def head(slug):
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
<!--SEO-->
    <meta name="theme-color" content="#0b1117" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#f6f3ee" media="(prefers-color-scheme: light)" />
    <script>
      // apply the saved or system theme before the page paints
      try {{ document.documentElement.dataset.theme = localStorage.getItem('hyd-site-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }} catch (e) {{}}
    </script>
    <link rel="stylesheet" href="/src/site.css" />
    <script>
      // Vercel Web Analytics: cookie-free page-view counts, live site only
      window.va = window.va || function () {{ (window.vaq = window.vaq || []).push(arguments); }};
      if (!/^(localhost|127\\.|0\\.0\\.0\\.0|\\[::1\\])/.test(location.hostname)) {{
        const s = document.createElement('script');
        s.defer = true;
        s.src = '/_vercel/insights/script.js';
        document.head.appendChild(s);
      }}
    </script>
  </head>
  <body>
"""

def header(current):
    links = '\n'.join(f'          <a href="{href}"{" aria-current=\"page\"" if href == current else ""}>{label}</a>' for href, label in PAGES)
    return f"""    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap">
        <a class="logo" href="./" aria-label="Sawari home"><span class="logo-mark">{LOGO}</span><span class="logo-text"><span class="logo-name">Sawari</span><span class="logo-tag">Drive Hyderabad</span></span></a>
        <nav class="nav" id="site-nav" aria-label="Main">
{links}
        </nav>
        <button class="menu-btn" aria-controls="site-nav" aria-expanded="false" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
        <!--LANG-MENU-->
        <button class="theme-btn" aria-label="Switch to dark mode" data-label-dark="Switch to dark mode" data-label-light="Switch to light mode"><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/></svg></button>
        <a class="btn primary small header-cta" href="/play.html">Play now</a>
      </div>
    </header>
    <main id="main">
"""

def footer():
    route_links = '\n'.join(f'              <li><a href="/play.html?route={r["id"]}">{r["name"]}</a></li>' for r in routes)
    return f"""    </main>
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div class="about">
            <a class="logo" href="./" aria-label="Sawari home"><span class="logo-mark">{LOGO}</span><span class="logo-text"><span class="logo-name">Sawari</span><span class="logo-tag">Drive Hyderabad</span></span></a>
            <p>A browser driving simulator on real Hyderabad roads: left-hand traffic, signals, turn-by-turn guidance and a debrief at the end of every drive.</p>
            <div class="share" data-copied="Link copied" data-ig="Caption copied: paste it into your Instagram post or story">
              <h4>Share Sawari</h4>
              <p>Tell your friends who are learning to drive.</p>
              <div class="share-row"><a class="share-btn whatsapp" href="__SHARE_WHATSAPP__" target="_blank" rel="noopener nofollow" aria-label="Share on WhatsApp" title="Share on WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.2 20.8l4.5-1.2A8.8 8.8 0 1 0 12 3.2z"/><path fill="currentColor" d="M9 8.4c.3-.6.6-.6.9-.6h.5c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.2-.1.4 0 .5.5.9 1.3 1.7 2.3 2.2.2.1.4.1.5 0l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5v.4c-.1.6-.9 1.3-1.6 1.4-.7.1-1.6.1-3.6-.9-2.4-1.3-3.7-3.6-3.9-4.1-.3-.6-.4-1.6.1-2.2z"/></svg></a><a class="share-btn linkedin" href="__SHARE_LINKEDIN__" target="_blank" rel="noopener nofollow" aria-label="Share on LinkedIn" title="Share on LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg></a><a class="share-btn x" href="__SHARE_X__" target="_blank" rel="noopener nofollow" aria-label="Share on X" title="Share on X"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z"/></svg></a><a class="share-btn facebook" href="__SHARE_FACEBOOK__" target="_blank" rel="noopener nofollow" aria-label="Share on Facebook" title="Share on Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z"/></svg></a><button class="share-btn instagram" type="button" data-share="instagram" aria-label="Copy an Instagram caption" title="Copy an Instagram caption"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg></button><button class="share-copy" type="button" data-share="copy"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg><span>Copy link</span></button></div>
              <div class="share-toast" role="status" aria-live="polite"></div>
              <!--SHARE-DATA-->
            </div>
          </div>
          <div>
            <h4>Site</h4>
            <ul>
              <li><a href="./">Home</a></li>
              <li><a href="routes.html">Routes</a></li>
              <li><a href="features.html">Features</a></li>
              <li><a href="about.html">About &amp; FAQ</a></li>
            </ul>
          </div>
          <div>
            <h4>Drive a route</h4>
            <ul>
{route_links}
            </ul>
          </div>
          <div>
            <h4>Data</h4>
            <ul>
              <li><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap (ODbL)</a></li>
              <li><a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain tiles (AWS)</a></li>
              <li><a href="about.html#data">How the city is built</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-base">
          <span>© <span data-year>2026</span> Sawari · For practice only; it does not replace driving lessons.</span>
          <span>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></span>
          <span class="version"><span>Version</span> <bdi translate="no">%SAWARI_VERSION%</bdi></span>
        </div>
      </div>
    </footer>
    <script type="module" src="/src/site.js"></script>
  </body>
</html>
"""

def chips(r):
    turns = f'{r["turns"]} turn{"s" if r["turns"] != 1 else ""}' if r['turns'] else 'No turns'
    return f'<div class="chips"><span class="chip {r["difficulty"].lower()}">{r["difficulty"]}</span><span class="chip">{r["length"] / 1000:.1f} km</span><span class="chip">{turns}</span></div>'

def route_card(r):
    return f"""          <a class="route-card" href="/play.html?route={r['id']}">
            {img_tag(r['id'], f"{r['name']} in the simulator", '(max-width: 640px) 100vw, (max-width: 960px) 50vw, 380px')}
            <div class="body">
              <div class="area">{r['area']}</div>
              <h3>{r['name']}</h3>
              <p>{r['blurb']}</p>
              {chips(r)}
            </div>
          </a>"""

def cta(title, text):
    return f"""      <section class="section">
        <div class="wrap">
          <div class="cta">
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
            <div class="btn-row">
              <a class="btn primary" href="/play.html">Start driving</a>
              <a class="btn ghost" href="routes.html">See the routes</a>
            </div>
          </div>
        </div>
      </section>
"""

def page_hero(crumb, title, text):
    return f"""      <section class="page-hero">
        <div class="wrap">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">{crumb}</span></nav>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
      </section>
"""

OUT = {}
IMG_RE = re.compile(r'<img src="img/([\w-]+)\.jpg" alt="([^"]*)" loading="lazy" width="1600" height="900" />')
def write(name, html):
    html = IMG_RE.sub(lambda m: img_tag(m.group(1), m.group(2)), html)
    OUT[name.removesuffix('.html')] = html

# ======================= HOME =======================
home = head('index') + header('./') + f"""      <section class="hero">
        <div class="hero-bg">{img_tag('hero', 'A car on an Old City street in Hyderabad at dusk, in the Sawari driving simulator', '100vw', eager=True)}</div>
        <div class="wrap">
          <div class="te">హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సాధన</div>
          <h1>Practise driving on <em>real Hyderabad</em> roads.</h1>
          <p class="lede">Five famous routes, from Tank Bund to the Charminar, rebuilt from open map data. Left-hand traffic, signals, autos and two-wheelers, with turn-by-turn guidance. It runs in your browser.</p>
          <div class="btn-row">
            <a class="btn primary" href="/play.html">Start driving</a>
            <a class="btn ghost" href="routes.html">Explore the routes</a>
          </div>
        </div>
      </section>

      <section class="section" aria-label="At a glance">
        <div class="wrap">
          <div class="stats">
            <div class="stat"><div class="num">{len(routes)}</div><div class="label">famous Hyderabad routes</div></div>
            <div class="stat"><div class="num">{total_km:.1f} km</div><div class="label">of real streets to drive</div></div>
            <div class="stat"><div class="num">23</div><div class="label">kinds of vehicle in traffic</div></div>
            <div class="stat"><div class="num">4</div><div class="label">times of day, morning to night</div></div>
          </div>
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Why it feels like Hyderabad</span>
            <h2>Not a generic city: the streets you know</h2>
            <p>Every route is built from OpenStreetMap and real elevation data, then filled with the life you see on these roads every day.</p>
          </div>
          <div class="grid g3">
            <div class="card">{icon('road')}<h3>Real roads and terrain</h3><p>Real lane counts, medians, flyovers and gradients. Banjara Hills Road No. 1 really does climb 37 metres.</p></div>
            <div class="card">{icon('people')}<h3>Traffic that behaves locally</h3><p>Autos, buses, scooters that filter past, people on the footpath and crowds outside temples and mosques.</p></div>
            <div class="card">{icon('wheel')}<h3>A car that drives properly</h3><p>Tyre grip, weight transfer, an automatic gearbox and ABS, from a chase view or the driver's seat.</p></div>
          </div>
          <p style="margin-top:22px"><a class="more" href="features.html" style="color:var(--accent);font-weight:600;text-decoration:none">All features →</a></p>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">The routes</span>
            <h2>Five drives, easy to hard</h2>
            <p>Start on the open lakeside roads, then take on HITEC City flyovers and Old City lanes.</p>
          </div>
          <div class="grid g3">
{chr(10).join(route_card(r) for r in routes)}
            <a class="route-card" href="routes.html" style="justify-content:center;align-items:center;padding:28px;text-align:center">
              <div class="body" style="justify-content:center;align-items:center">{icon('pin')}<h3>Compare all routes</h3><p>Length, turns and what to watch for on each drive.</p></div>
            </a>
          </div>
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head center">
            <span class="eyebrow">How it works</span>
            <h2>From the menu to your score in minutes</h2>
          </div>
          <div class="steps">
            <div class="step"><h3>Pick a route and a time</h3><p>Choose a drive, the traffic level and morning, midday, evening or night.</p></div>
            <div class="step"><h3>Follow the blue band</h3><p>Keep left, signal your turns and listen for the spoken directions. Signals, speed limits and speed breakers all count.</p></div>
            <div class="step"><h3>Read your debrief</h3><p>Get a score, every fault with advice on avoiding it, and a personal best for each route.</p></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap split">
          <div class="shot"><img src="img/night.jpg" alt="Old City street at night, lit by street lamps" loading="lazy" width="1600" height="900" /></div>
          <div>
            <span class="eyebrow">Day and night</span>
            <h2>The city after dark</h2>
            <p>At night, street lamps light the road, windows light up across the city and every vehicle shows its head and tail lamps. Switch on your headlights with <kbd>L</kbd> and take a slower lap.</p>
            <ul class="ticks">
              <li>Morning, midday, evening and night lighting</li>
              <li>Telugu and English shop signs and hoardings</li>
              <li>Temples, mosques and churches along the way</li>
            </ul>
          </div>
        </div>
      </section>

{cta('Ready for your first lap of Tank Bund?', 'No download and no sign-up. Pick a route and start driving in your browser.')}""" + footer()
write('index.html', home)

# ======================= ROUTES =======================
details = []
for r in routes:
    turns = r['turns'] if r['turns'] else 'None'
    watch = ''.join(f'<li>{w}</li>' for w in WATCH.get(r['id'], []))
    details.append(f"""          <article class="route-detail" id="{r['id']}">
            <div class="shot"><img src="img/{r['id']}.jpg" alt="{r['name']} in the simulator" loading="lazy" width="1600" height="900" /></div>
            <div>
              <span class="eyebrow">{r['area']}</span>
              <h3>{r['name']}</h3>
              <p>{r['blurb']}</p>
              <div class="facts">
                <div class="fact"><div class="k">Length</div><div class="v">{r['length'] / 1000:.1f} km</div></div>
                <div class="fact"><div class="k">Turns</div><div class="v">{turns}</div></div>
                <div class="fact"><div class="k">Level</div><div class="v">{r['difficulty']}</div></div>
              </div>
              <ul class="watch">{watch}</ul>
              <a class="btn primary small" href="/play.html?route={r['id']}">Drive this route</a>
            </div>
          </article>""")
levels = ''.join(f'<div class="card"><span class="chip {k.lower()}">{k}</span><h3>{ {"Easy": "Getting comfortable", "Medium": "Junctions and flyovers", "Hard": "Old City streets"}[k] }</h3><p>{v}</p><p style="margin-top:10px">Routes: {", ".join(x["name"] for x in routes if x["difficulty"] == k)}.</p></div>' for k, v in DIFF_NOTE.items())
routes_page = head('routes') + header('routes.html') + page_hero('Routes', 'Five Hyderabad drives, from lakeside to Old City', f'{total_km:.1f} km of real streets in all. Each route has its own traffic, its own landmarks and its own way of catching you out.') + f"""
      <section class="section">
        <div class="wrap">
{chr(10).join(details)}
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Difficulty</span>
            <h2>Which route should you start with?</h2>
            <p>The level reflects the number of turns, how busy the junctions are and how tight the streets get.</p>
          </div>
          <div class="grid g3">{levels}</div>
        </div>
      </section>

      <section class="section">
        <div class="wrap split flip">
          <div class="shot"><img src="img/junction.jpg" alt="A signalled junction with zebra crossings under the HITEC City flyover" loading="lazy" width="1600" height="900" /></div>
          <div>
            <span class="eyebrow">Practice tips</span>
            <h2>Drive it the way the debrief marks it</h2>
            <ul class="ticks">
              <li>Keep left: the blue band shows your lane on the route.</li>
              <li>Indicate before every turn with <kbd>Q</kbd> or <kbd>E</kbd>. The indicator cancels itself after the turn.</li>
              <li>Stop at the line on red; amber is not a reason to speed up.</li>
              <li>Slow down for speed breakers. You will feel them if you don't.</li>
              <li>Missed a turn? Look for the blue U-turn sign at the next median opening.</li>
            </ul>
          </div>
        </div>
      </section>

{cta('Pick a route and go', 'Start with Tank Bund Road if this is your first drive.')}""" + footer()
write('routes.html', routes_page)

# ======================= FEATURES =======================
keys = [('↑ W', 'Accelerate'), ('↓ S', 'Brake (hold at a stop for reverse)'), ('← → A D', 'Steer'), ('Space', 'Handbrake'), ('Q E', 'Left / right indicator'), ('H', 'Horn (hold)'), ('L', 'Headlights'), ('X', 'Hazard lights'), ('C', "Chase view or driver's seat"), ('R', 'Return to the route'), ('M', 'Sound on / off'), ('Esc', 'Pause')]
key_rows = '\n'.join(f'            <div class="key-row"><span class="k">{"".join(f"<kbd>{x}</kbd>" for x in k.split())}</span><span>{v}</span></div>' for k, v in keys)
features_page = head('features') + header('features.html') + page_hero('Features', 'Built to feel like a drive across Hyderabad', 'Realistic car handling, local traffic, a proper dashboard and the city from morning to night. All of it runs in a browser tab.') + f"""
      <section class="section">
        <div class="wrap split">
          <div class="shot"><img src="img/cockpit.jpg" alt="Driver's seat view with instruments and centre screen" loading="lazy" width="1600" height="900" /></div>
          <div>
            <span class="eyebrow">Driving</span>
            <h2>A car that handles like a car</h2>
            <p>The physics model has tyre grip and slip, weight transfer under braking and cornering, a six-speed automatic and ABS. Off the road the grip changes, and the suspension bounces over kerbs and speed breakers.</p>
            <ul class="ticks">
              <li>Right-hand drive cockpit with working instruments</li>
              <li>Centre screen with clock, radio and trip details (no map)</li>
              <li>Chase view or driver's seat, with drag-to-look</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Streets and city life</span>
            <h2>Busy, crowded, unmistakably local</h2>
          </div>
          <div class="grid g3">
            <div class="card">{icon('people')}<h3>Traffic</h3><p>23 kinds of vehicle: hatchbacks, sedans, SUVs, scooters, autos, buses and lorries. Bikes filter through gaps, buses stop and traffic obeys the signals.</p></div>
            <div class="card">{icon('building')}<h3>Buildings by area</h3><p>Arched Old City facades, HITEC City glass towers and Banjara Hills villas, plus temples, mosques and churches from the map.</p></div>
            <div class="card">{icon('chat')}<h3>Telugu and English</h3><p>Real shop names where the map has them, local-style names elsewhere, and roadside stalls, hoardings and parked two-wheelers.</p></div>
            <div class="card">{icon('road')}<h3>Proper roads</h3><p>Textured asphalt with worn lane lines, raised kerbs, tiled footpaths, medians with U-turn openings, flyovers and metro viaducts.</p></div>
            <div class="card">{icon('pin')}<h3>Guidance</h3><p>A blue band for your lane, turn-by-turn directions with an optional voice, and a steering guide that warns you before you leave the road.</p></div>
            <div class="card">{icon('shield')}<h3>Road rules</h3><p>Red lights, speeding, missed indicators, collisions and speed breakers are logged and explained in your debrief.</p></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Dashboard and controls</span>
            <h2>Everything at your fingertips</h2>
            <p>The on-screen cluster shows speed and revs, your gear, the speed limit, indicators and warning lamps. It also works with a gamepad.</p>
          </div>
          <div class="keys">
{key_rows}
          </div>
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Time of day and graphics</span>
            <h2>Morning traffic or a night drive</h2>
            <p>Sun, sky and shadows change with the time you choose. After dark, street lamps, windows and every vehicle's lights come on.</p>
          </div>
          <div class="tod">
            <div class="m"><b>Morning</b><span>Low, warm sun and long shadows</span></div>
            <div class="n"><b>Midday</b><span>Bright, clear and high sun</span></div>
            <div class="e"><b>Evening</b><span>Orange sky and lamps coming on</span></div>
            <div class="ni"><b>Night</b><span>Street lamps and lit windows</span></div>
          </div>
          <div class="grid g2" style="margin-top:20px">
            <div class="card">{icon('bolt')}<h3>Runs on ordinary laptops</h3><p>The city is drawn in tiles, so only what you can see is rendered. If a computer can't keep up, the resolution adjusts itself.</p></div>
            <div class="card">{icon('gauge')}<h3>Two graphics settings</h3><p>High adds sharp sun shadows; Fast is for older machines. Both keep the full city and traffic.</p></div>
          </div>
        </div>
      </section>

{cta('See it for yourself', 'Try the evening light on Tank Bund, or a night drive through the Old City.')}""" + footer()
write('features.html', features_page)

# ======================= ABOUT =======================
faqs = [
    ('Is it free? Do I need to install anything?', 'Yes, it is free, and there is nothing to install. It runs in a modern browser (Chrome, Edge or Firefox) on a laptop or desktop. A keyboard or a gamepad works best.'),
    ('Are these the official driving test routes?', 'No. They are famous, busy Hyderabad roads chosen for practice. They are not RTA test routes.'),
    ('Are the buildings exact copies of the real ones?', 'No. Building outlines, heights where mapped, shop names and places of worship come from OpenStreetMap. Facades, stalls, hoardings, most street lamps and some filler buildings are generated to look typical of each area, so treat them as realistic rather than exact.'),
    ('Why left-hand traffic and a right-hand-drive car?', 'Because that is how India drives. You sit on the right and keep to the left of the road.'),
    ('It runs slowly on my computer. What can I do?', 'Choose Graphics → Fast in the menu and lower the traffic level. The game also lowers its resolution automatically when it detects slow frames.'),
    ('Does it save my progress?', 'Your settings and your best score on each route are saved in this browser only. Nothing is sent anywhere.'),
]
faq_html = '\n'.join(f'            <details><summary>{q}</summary><p>{a}</p></details>' for q, a in faqs)
about_page = head('about') + header('about.html') + page_hero('About &amp; FAQ', 'A practice simulator for Hyderabad roads', 'Sawari lets you practise the roads you will actually drive: real layouts, local traffic and the rules that matter. Then it tells you how you did.') + f"""
      <section class="section">
        <div class="wrap split">
          <div>
            <span class="eyebrow">Why it exists</span>
            <h2>Learn the road before you're on it</h2>
            <p>Most driving games are set in imaginary cities. Sawari, the Urdu word for a ride and for a royal procession through the old city, puts you on Tank Bund, the Old City and the HITEC City flyovers, where the traffic, the junctions and the speed breakers are what you will really meet.</p>
            <p>It is a place to practise lane discipline, signalling and signals without risk. The debrief points out exactly what to work on next.</p>
          </div>
          <div class="shot"><img src="img/banjara-hills.jpg" alt="Banjara Hills Road No. 1 in the morning" loading="lazy" width="1600" height="900" /></div>
        </div>
      </section>

      <section class="section alt" id="data">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">How the city is built</span>
            <h2>Open data, carefully assembled</h2>
            <p>Every route starts from public map and elevation data. The gaps are filled with care, and whatever is estimated is labelled as estimated.</p>
          </div>
          <div class="grid g3">
            <div class="card">{icon('data')}<h3>From the map</h3><p>Roads, lanes, one-way streets, flyovers, buildings, lakes, parks, signals, bus stops, metro lines and places of worship come from OpenStreetMap.</p></div>
            <div class="card">{icon('road')}<h3>From elevation data</h3><p>Ground height comes from open terrain tiles, smoothed, so roads, lakes and buildings sit at their real levels.</p></div>
            <div class="card">{icon('building')}<h3>Estimated</h3><p>Speed breakers, U-turn openings, stalls, parked vehicles, hoardings, most street lamps and filler buildings are placed by rule where the map has no detail.</p></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">FAQ</span>
            <h2>Common questions</h2>
          </div>
          <div class="faq">
{faq_html}
          </div>
        </div>
      </section>

      <section class="section alt">
        <div class="wrap">
          <div class="notice">
            {icon('alert')}
            <div>
              <h3>For practice only</h3>
              <p>Sawari is a simulator. It does not replace lessons with a licensed instructor, and its scores do not reflect any official test. Always follow the actual road signs, signals and traffic police on the road.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Credits</span>
            <h2>Built on open data</h2>
          </div>
          <div class="grid g2">
            <div class="card"><h3>OpenStreetMap</h3><p>Road, building, lake and place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, available under the Open Database Licence.</p></div>
            <div class="card"><h3>Terrain</h3><p>Elevation from the <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> open dataset (Mapzen, hosted on AWS), derived from SRTM and other public sources.</p></div>
          </div>
        </div>
      </section>
""" + footer()
write('about.html', about_page)

# ======================= 404 =======================
write('404.html', head('404') + header('') + """      <section class="page-hero">
        <div class="wrap">
          <h1>This road doesn't go anywhere</h1>
          <p>The page you were looking for has moved or never existed. Try one of these instead.</p>
          <div class="btn-row" style="margin-top:26px">
            <a class="btn primary" href="/">Go to the home page</a>
            <a class="btn ghost" href="/routes.html">See the routes</a>
            <a class="btn ghost" href="/play.html">Start driving</a>
          </div>
        </div>
      </section>
""" + footer())

# ======================= LANGUAGES, SEO, SITEMAP =======================
# Each page is written in English at the site root and in Hindi, Urdu and Telugu
# under /hi/, /ur/ and /te/, each with its own title, description, canonical and
# hreflang links, social cards and structured data.
def tr(text, lang):
    v = T.get(text)
    out = text if lang == 'en' or not v else v[seo.LANGS.index(lang) - 1]
    return htmllib.unescape(re.sub(r'<[^>]+>', '', out))

def extra_ld(slug, lang):
    page = seo.url(lang, slug)
    home = seo.url(lang, 'index')
    if slug == 'index':
        return [{
            '@type': ['VideoGame', 'SoftwareApplication'], '@id': seo.SITE_URL + '/#game', 'name': 'Sawari',
            'url': seo.SITE_URL + '/play.html', 'description': seo.DESC['index'][lang],
            'applicationCategory': 'GameApplication', 'applicationSubCategory': 'Driving simulator',
            'operatingSystem': 'Any (runs in a web browser)', 'gamePlatform': 'Web browser', 'genre': ['Driving simulator', 'Simulation'],
            'inLanguage': 'en', 'isAccessibleForFree': True, 'publisher': {'@id': seo.SITE_URL + '/#org'},
            'image': seo.SITE_URL + '/og-image.jpg',
            'screenshot': [f'{seo.SITE_URL}/img/{n}.webp' for n in ['hero', 'night', 'cockpit', 'charminar', 'hitec-city']],
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'INR', 'availability': 'https://schema.org/InStock'},
            'contentLocation': {'@type': 'City', 'name': 'Hyderabad', 'containedInPlace': {'@type': 'State', 'name': 'Telangana'}},
        }]
    crumb = {'routes': 'Routes', 'features': 'Features', 'about': 'About &amp; FAQ'}[slug]
    ld = [{'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': tr('Home', lang), 'item': home},
        {'@type': 'ListItem', 'position': 2, 'name': tr(crumb, lang), 'item': page}]}]
    if slug == 'routes':
        ld.append({'@type': 'ItemList', 'name': tr('Five Hyderabad drives, from lakeside to Old City', lang), 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': tr(r['name'], lang), 'url': f'{page}#{r["id"]}', 'description': tr(r['blurb'], lang)}
            for i, r in enumerate(routes)]})
    if slug == 'about':
        ld.append({'@type': 'FAQPage', 'mainEntity': [
            {'@type': 'Question', 'name': tr(q, lang), 'acceptedAnswer': {'@type': 'Answer', 'text': tr(a, lang)}} for q, a in faqs]})
    return ld

PRELOAD = '    <link rel="preload" as="image" href="/img/hero.webp" imagesrcset="/img/hero-800.webp 800w, /img/hero.webp 1600w" imagesizes="100vw" fetchpriority="high" />' + chr(10)
for slug, page in OUT.items():
    if slug == '404':
        out = page.replace('<!--SEO-->', '    <title>Page not found | Sawari</title>' + chr(10) + '    <meta name="robots" content="noindex, follow" />' + chr(10) + '    <link rel="icon" href="/logo.svg" type="image/svg+xml" />').replace('<!--LANG-MENU-->', seo.lang_menu('index', 'en'))
        out = seo.share_fill(out, 'en', 'index')
        (ROOT / '404.html').write_text(out, encoding='utf-8')
        print('wrote 404.html (noindex)')
        continue
    if slug in ('routes', 'features', 'about'):
        # the first screenshot is the largest thing on screen: load it straight away
        page = page.replace('loading="lazy"', 'fetchpriority="high"', 1)
    for i, lang in enumerate(seo.LANGS):
        out = seo.share_fill(seo.localize(page, slug, lang, T, i - 1), lang, slug)
        out = out.replace('<!--SEO-->', seo.head_block(slug, lang, extra_ld(slug, lang), PRELOAD if slug == 'index' else ''))
        if lang != 'en':
            left = seo.untranslated(out, T)
            assert not left, f'{lang}/{slug}: untranslated {left[:5]}'
        dest = ROOT / (f'{slug}.html' if lang == 'en' else f'{lang}/{slug}.html')
        dest.parent.mkdir(exist_ok=True)
        dest.write_text(out, encoding='utf-8')
    print(f'wrote {slug}: {page.count("<section")} sections + header + footer, in', ', '.join(seo.LANGS))

(ROOT / 'public/sitemap.xml').write_text(seo.sitemap(), encoding='utf-8')
(ROOT / 'public/robots.txt').write_text(seo.robots(), encoding='utf-8')
(ROOT / 'public/site.webmanifest').write_text(seo.manifest(), encoding='utf-8')
# the old client-side dictionaries are no longer needed: every language is a real page now
shutil.rmtree(ROOT / 'public/i18n', ignore_errors=True)
print('wrote sitemap.xml, robots.txt, site.webmanifest for', seo.SITE_URL)
if 'example.com' in seo.SITE_URL:
    print('NOTE: set SITE_URL to the real address before publishing, e.g. SITE_URL=https://www.your-domain.in python tools/build-site.py')
