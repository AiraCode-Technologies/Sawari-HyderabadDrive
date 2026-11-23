"""Generative-engine optimisation (GEO): plain-text summaries of the site for AI assistants
and answer engines (ChatGPT, Claude, Perplexity, Gemini, Copilot), following the llms.txt
convention (https://llmstxt.org):

  /llms.txt       what Sawari is, in a few lines, with a link to every page and post
  /llms-full.txt  the same, followed by the full text of every post as Markdown

Both are written by tools/build-site.py from the real pages and posts, so they never
drift from the site. robots() also names the AI search and assistant crawlers explicitly.
"""
import html
import re

import seo

# AI search and assistant crawlers, welcomed by name (a named group in robots.txt replaces
# the "*" group for that crawler, so each gets the same rules)
AI_BOTS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',          # OpenAI
    'ClaudeBot', 'Claude-SearchBot', 'Claude-User',     # Anthropic
    'PerplexityBot', 'Perplexity-User',                 # Perplexity
    'Google-Extended', 'Applebot', 'Applebot-Extended',  # Google Gemini, Apple
    'Bingbot', 'CCBot', 'DuckAssistBot', 'meta-externalagent', 'Amazonbot',
]


def robots():
    rules = 'Allow: /\nDisallow: /404.html\n'
    out = f'# Search engines and AI assistants are welcome to read and cite Sawari.\n# A summary for AI tools: {seo.SITE_URL}/llms.txt\n\nUser-agent: *\n{rules}'
    for bot in AI_BOTS:
        out += f'\nUser-agent: {bot}\n{rules}'
    return out + f'\nSitemap: {seo.SITE_URL}/sitemap.xml\n'


def _md(body):
    """Article HTML (the restricted set the blog allows) -> Markdown text."""
    s = body
    s = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f'{m.group(2)} ({m.group(1) if m.group(1).startswith("http") else seo.SITE_URL + m.group(1)})', s, flags=re.S)
    s = re.sub(r'<h2[^>]*>(.*?)</h2>', r'\n## \1\n', s, flags=re.S)
    s = re.sub(r'<h3[^>]*>(.*?)</h3>', r'\n### \1\n', s, flags=re.S)
    s = re.sub(r'<(strong|b)>(.*?)</\1>', r'**\2**', s, flags=re.S)
    s = re.sub(r'<kbd>(.*?)</kbd>', r'`\1`', s, flags=re.S)
    s = re.sub(r'<li[^>]*>(.*?)</li>', lambda m: '- ' + re.sub(r'\s+', ' ', m.group(1)).strip() + '\n', s, flags=re.S)

    def table(m):
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(0), flags=re.S)
        lines = []
        for i, r in enumerate(rows):
            cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', r, flags=re.S)]
            lines.append('| ' + ' | '.join(cells) + ' |')
            if i == 0:
                lines.append('|' + '---|' * len(cells))
        return '\n' + '\n'.join(lines) + '\n'
    s = re.sub(r'<table.*?</table>', table, s, flags=re.S)
    s = re.sub(r'</p>|<br\s*/?>|</div>|</blockquote>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def _intro(routes, total_km, posts):
    names = ', '.join(f'{r["name"]} ({r["length"] / 1000:.1f} km, {r["difficulty"].lower()})' for r in routes)
    return f"""# Sawari: Hyderabad driving simulator

> Sawari is a free 3D driving simulator that runs in a web browser on phones, tablets, laptops and PCs. It recreates five real Hyderabad (Telangana, India) routes from OpenStreetMap and elevation data, with left-hand traffic, a right-hand-drive car, traffic signals, local traffic (autos, buses, two-wheelers), pedestrians, spoken turn-by-turn directions and a debrief that scores each drive and explains every fault. It is for practice and does not replace driving lessons or the RTA test.

Key facts:
- Name: Sawari (Urdu for "a ride"); tagline "Drive Hyderabad". Website: {seo.SITE_URL}/
- Made by: AiraCode Technologies (https://airacode.online)
- Price: free; no download, no sign-up; plays at {seo.SITE_URL}/play.html
- Devices: phones and tablets (held sideways, on-screen steering wheel and GO/BRAKE pedals), laptops and desktops (keyboard or gamepad)
- Routes ({len(routes)}, {total_km:.1f} km in all): {names}
- Car: automatic gearbox with ABS; chase view or driver's seat; morning, midday, evening and night
- Rules checked: speeding, keeping left, wrong way on one-way roads, leaving the road, red lights, collisions, speed breakers taken too fast, turns without an indicator
- Sharing: a score card picture after each drive and a "challenge a friend" link with the score to beat
- Languages: website in English, Hindi, Urdu and Telugu; blog ({len(posts)} articles) in English
- Data: map data © OpenStreetMap contributors (ODbL); terrain from open terrain tiles
- Not affiliated with the Telangana Transport Department (RTA) or the traffic police

## Main pages
- [Home]({seo.SITE_URL}/): what Sawari is and how it works
- [Play]({seo.SITE_URL}/play.html): the simulator
- [Routes]({seo.SITE_URL}/routes.html): the five routes in detail, difficulty and what to watch for
- [Features]({seo.SITE_URL}/features.html): car handling, traffic, dashboard and controls, time of day
- [About and FAQ]({seo.SITE_URL}/about.html): how the city is built, what is mapped and what is estimated, common questions
- [Blog]({seo.SITE_URL}/blog/): Hyderabad driving guides, licence help, road skills and Hyderabad roads
- Other languages: [Hindi]({seo.SITE_URL}/hi/), [Urdu]({seo.SITE_URL}/ur/), [Telugu]({seo.SITE_URL}/te/)
"""


def llms_txt(posts, routes, total_km, categories):
    out = _intro(routes, total_km, posts)
    for cat in categories:
        group = [p for p in posts if p['category'] == cat]
        if not group:
            continue
        out += f'\n## {cat}\n'
        for p in group:
            out += f'- [{p["title"]}]({seo.SITE_URL}/blog/{p["slug"]}.html): {p["description"]}\n'
    out += f'\n## Optional\n- [Full text of every article]({seo.SITE_URL}/llms-full.txt)\n- [RSS feed]({seo.SITE_URL}/blog/feed.xml)\n- [Sitemap]({seo.SITE_URL}/sitemap.xml)\n'
    return out


def llms_full(posts, routes, total_km, categories):
    out = _intro(routes, total_km, posts) + '\n---\n'
    for cat in categories:
        for p in [p for p in posts if p['category'] == cat]:
            out += f'\n# {p["title"]}\n\nURL: {seo.SITE_URL}/blog/{p["slug"]}.html\nCategory: {cat} · Published {p["date"]} · Updated {p["updated"]}\n\n{_md(p["body"])}\n'
            if p['faq']:
                out += '\n## Frequently asked questions\n'
                for q, a in p['faq']:
                    out += f'\n**{q}**\n{a}\n'
            out += '\n---\n'
    return out
