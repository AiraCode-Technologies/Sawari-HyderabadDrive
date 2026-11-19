"""The blog: posts in content/blog/<slug>.html (format in content/blog/README.md) ->
/blog/ (index), /blog/<slug>.html (posts) and /blog/feed.xml (RSS).

Each post gets its own title, description, canonical link, article Open Graph tags and
JSON-LD (BlogPosting, BreadcrumbList and FAQPage), a table of contents built from its
h2 headings, related posts and a call to action. The blog is English only.
Called from tools/build-site.py, which passes in the shared page parts."""
import html
import json
import math
import re
from datetime import date
from email.utils import format_datetime
from datetime import datetime, timezone
from pathlib import Path

import seo
from seo import img_tag


def esc(s, quote=True):
    return html.escape(s, quote=quote)

CATEGORIES = {
    'Route guides': ('route-guides', 'Street-by-street guides to the five Hyderabad routes in Sawari, and to driving them for real.'),
    'Learning to drive': ('learning-to-drive', 'Licences, the RTA test, road signs and how to build up from your first drive.'),
    'Road skills': ('road-skills', 'The habits that keep you safe in Hyderabad traffic, one skill at a time.'),
    'Hyderabad roads': ('hyderabad-roads', 'The city\'s ring roads, flyovers, metro and new expansions, and what they mean for the way Hyderabad drives.'),
    'Behind the build': ('behind-the-build', 'How Sawari turns open map data into a city you can drive.'),
    'Release notes': ('release-notes', 'What changed in each version of Sawari: new places, fixes and improvements, newest first.'),
}
IMAGES = {'hero', 'night', 'cockpit', 'junction', 'tank-bund', 'necklace-road', 'charminar', 'hitec-city', 'banjara-hills'}
META_RE = re.compile(r'^\s*<!--meta\s*(\{.*?\})\s*-->', re.S)
H2_RE = re.compile(r'<h2([^>]*)>(.*?)</h2>', re.S)
BLOG = '/blog/'


def strip_tags(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s))


def slugify(text):
    return re.sub(r'[^a-z0-9]+', '-', strip_tags(text).lower()).strip('-')[:60]


def nice_date(iso):
    d = date.fromisoformat(iso)
    return f'{d.day} {d.strftime("%B %Y")}'


def post_url(slug):
    return f'{seo.SITE_URL}{BLOG}{slug}.html'


def load(root, route_ids):
    """Reads and checks every post; stops the build on anything a search engine would mind."""
    posts = []
    for f in sorted((root / 'content/blog').glob('*.html')):
        src = f.read_text(encoding='utf-8')
        m = META_RE.match(src)
        assert m, f'{f.name}: missing the <!--meta {{...}} --> header'
        meta = json.loads(m.group(1))
        body = src[m.end():].strip()
        p = {**meta, 'body': body, 'file': f.name}
        p.setdefault('updated', p['date'])
        p.setdefault('faq', [])
        p.setdefault('keywords', [])
        p.setdefault('related', [])
        assert p['slug'] == f.stem, f'{f.name}: slug "{p["slug"]}" must match the file name'
        assert len(p['seoTitle']) <= 60, f'{f.name}: seoTitle is {len(p["seoTitle"])} characters (60 at most)'
        assert 110 <= len(p['description']) <= 170, f'{f.name}: description is {len(p["description"])} characters (aim for 140-160)'
        assert p['category'] in CATEGORIES, f'{f.name}: unknown category {p["category"]}'
        assert p['image'] in IMAGES, f'{f.name}: unknown image {p["image"]}'
        assert not p.get('route') or p['route'] in route_ids, f'{f.name}: unknown route {p.get("route")}'
        assert '<h1' not in body, f'{f.name}: the title is the H1; use h2 and h3 in the body'
        # give every h2 an id for the table of contents
        toc, seen = [], set()

        def add_id(mm):
            attrs, inner = mm.group(1), mm.group(2)
            idm = re.search(r'id="([^"]+)"', attrs)
            hid = idm.group(1) if idm else slugify(inner)
            while hid in seen:
                hid += '-2'
            seen.add(hid)
            toc.append((hid, strip_tags(inner)))
            return mm.group(0) if idm else f'<h2 id="{hid}"{attrs}>{inner}</h2>'
        p['body'] = H2_RE.sub(add_id, body)
        p['toc'] = toc
        words = len(strip_tags(body).split()) + sum(len((q + ' ' + a).split()) for q, a in p['faq'])
        p['words'] = words
        p['minutes'] = max(1, math.ceil(words / 220))
        posts.append(p)
    by_slug = {p['slug']: p for p in posts}
    for p in posts:
        for r in p['related']:
            assert r in by_slug and r != p['slug'], f'{p["file"]}: related post "{r}" does not exist'
        for target in re.findall(r'href="/blog/([\w-]+)\.html', p['body']):
            assert target in by_slug, f'{p["file"]}: links to a missing post /blog/{target}.html'
        for rid in re.findall(r'href="/play\.html\?route=([\w-]+)', p['body']):
            assert rid in route_ids, f'{p["file"]}: links to a missing route {rid}'
    # newest first, then by category order and title so the order is stable
    order = list(CATEGORIES)
    posts.sort(key=lambda p: (order.index(p['category']), p['title']))
    posts.sort(key=lambda p: p['date'], reverse=True)  # stable: newest first, ties by category
    return posts, by_slug


# ---------------------------------------------------------------- head
ORG = {'@type': 'Organization', '@id': seo.SITE_URL + '/#org', 'name': 'Sawari', 'url': seo.SITE_URL + '/', 'logo': {'@type': 'ImageObject', 'url': seo.SITE_URL + '/icons/icon-512.png', 'width': 512, 'height': 512}}


def head_block(title, desc, canonical, image, image_alt, ld, article=None):
    img = f'{seo.SITE_URL}/img/{image}.jpg'
    graph = [ORG, {'@type': 'WebSite', '@id': seo.SITE_URL + '/#website', 'name': 'Sawari', 'url': seo.SITE_URL + '/', 'publisher': {'@id': seo.SITE_URL + '/#org'}}] + ld
    ld_json = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, indent=1).replace('</', '<\\/')
    art = ''
    if article:
        art = (f'    <meta property="article:published_time" content="{article["date"]}T09:00:00+05:30" />\n'
               f'    <meta property="article:modified_time" content="{article["updated"]}T09:00:00+05:30" />\n'
               f'    <meta property="article:section" content="{esc(article["category"])}" />\n'
               + ''.join(f'    <meta property="article:tag" content="{esc(k)}" />\n' for k in article['keywords']))
    return f"""    <title>{esc(title)}</title>
    <meta name="description" content="{esc(desc)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="{canonical}" />
    <link rel="alternate" hreflang="en" href="{canonical}" />
    <link rel="alternate" hreflang="x-default" href="{canonical}" />
    <link rel="alternate" type="application/rss+xml" title="Sawari blog" href="{seo.SITE_URL}{BLOG}feed.xml" />
    <meta property="og:type" content="{'article' if article else 'website'}" />
    <meta property="og:site_name" content="Sawari" />
    <meta property="og:title" content="{esc(title)}" />
    <meta property="og:description" content="{esc(desc)}" />
    <meta property="og:url" content="{canonical}" />
    <meta property="og:image" content="{img}" />
    <meta property="og:image:secure_url" content="{img}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1600" />
    <meta property="og:image:height" content="900" />
    <meta property="og:image:alt" content="{esc(image_alt)}" />
    <meta property="og:locale" content="en_IN" />
{art}    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{esc(title)}" />
    <meta name="twitter:description" content="{esc(desc)}" />
    <meta name="twitter:image" content="{img}" />
    <meta name="twitter:image:alt" content="{esc(image_alt)}" />
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="preload" as="image" href="/img/{image}.webp" imagesrcset="/img/{image}-800.webp 800w, /img/{image}.webp 1600w" imagesizes="(max-width: 820px) 100vw, 760px" fetchpriority="high" />
    <script type="application/ld+json">
{ld_json}
    </script>
"""


def crumbs_ld(items):
    return {'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(items)]}


# ---------------------------------------------------------------- pieces
def card(p, heading='h3'):
    return f"""          <a class="route-card post-card" href="{BLOG}{p['slug']}.html">
            {img_tag(p['image'], esc(p['imageAlt']), '(max-width: 640px) 100vw, (max-width: 960px) 50vw, 380px')}
            <div class="body">
              <div class="area">{esc(p['category'])}</div>
              <{heading}>{esc(p['title'], quote=False)}</{heading}>
              <p>{esc(p['description'], quote=False)}</p>
              <div class="chips"><span class="chip">{p['minutes']} min read</span></div>
            </div>
          </a>"""


def home_section(posts, by_slug):
    """'From the blog' block for the English home page."""
    pick = [by_slug[s] for s in ('driving-in-hyderabad-for-beginners', 'how-to-get-driving-licence-hyderabad', 'hyderabad-traffic-rules-guide') if s in by_slug]
    pick = (pick + [p for p in posts if p not in pick])[:3]
    return f"""      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">From the blog</span>
            <h2>Hyderabad driving guides and tips</h2>
            <p>Route guides, help with your licence and the road skills Hyderabad traffic asks of you.</p>
          </div>
          <div class="grid g3">
{chr(10).join(card(p) for p in pick)}
          </div>
          <p style="margin-top:22px"><a class="more" href="{BLOG}" style="color:var(--accent);font-weight:600;text-decoration:none">All {len(posts)} articles →</a></p>
        </div>
      </section>
"""


def route_guides(posts):
    """route id -> its route guide post."""
    return {p['route']: p for p in posts if p.get('route') and p['category'] == 'Route guides'}


# ---------------------------------------------------------------- pages
def post_page(p, by_slug, posts, head, header, footer, cta):
    url = post_url(p['slug'])
    toc = '\n'.join(f'              <li><a href="#{hid}">{esc(t, quote=False)}</a></li>' for hid, t in p['toc'])
    faq = ''
    if p['faq']:
        items = '\n'.join(f'              <details><summary>{esc(q, quote=False)}</summary><p>{esc(a, quote=False)}</p></details>' for q, a in p['faq'])
        faq = f"""
            <h2 id="faq">Frequently asked questions</h2>
            <div class="faq">
{items}
            </div>"""
        toc += '\n              <li><a href="#faq">Frequently asked questions</a></li>'
    drive = ''
    if p.get('route'):
        drive = f"""
            <div class="drive-box">
              <div><strong>Practise this route in Sawari</strong><p>Free in your browser on a phone, tablet, laptop or desktop. No download, no sign-up.</p></div>
              <div class="btn-row"><a class="btn primary small" href="/play.html?route={p['route']}">Drive it now</a><a class="btn ghost small" href="/routes.html#{p['route']}">Route details</a></div>
            </div>"""
    related = [by_slug[s] for s in p['related']]
    more = [q for q in posts if q['category'] == p['category'] and q is not p and q not in related]
    related = (related + more)[:3]
    cat_slug = CATEGORIES[p['category']][0]
    ld = [
        {'@type': 'WebPage', '@id': url + '#page', 'url': url, 'name': p['seoTitle'], 'description': p['description'], 'inLanguage': 'en-IN',
         'isPartOf': {'@id': seo.SITE_URL + '/#website'}, 'primaryImageOfPage': f'{seo.SITE_URL}/img/{p["image"]}.jpg',
         'breadcrumb': {'@id': url + '#crumbs'}},
        {'@type': 'BlogPosting', '@id': url + '#article', 'mainEntityOfPage': {'@id': url + '#page'}, 'headline': p['title'][:110],
         'description': p['description'], 'image': {'@type': 'ImageObject', 'url': f'{seo.SITE_URL}/img/{p["image"]}.jpg', 'width': 1600, 'height': 900, 'caption': p['imageAlt']},
         'datePublished': p['date'] + 'T09:00:00+05:30', 'dateModified': p['updated'] + 'T09:00:00+05:30',
         'author': {'@type': 'Organization', 'name': 'The Sawari team', 'url': seo.SITE_URL + '/about.html'}, 'publisher': {'@id': seo.SITE_URL + '/#org'},
         'articleSection': p['category'], 'keywords': ', '.join(p['keywords']), 'wordCount': p['words'], 'timeRequired': f'PT{p["minutes"]}M',
         'inLanguage': 'en-IN', 'isPartOf': {'@type': 'Blog', '@id': seo.SITE_URL + BLOG + '#blog', 'name': 'Sawari blog'},
         'about': [{'@type': 'Thing', 'name': k} for k in p['keywords'][:5]],
         'contentLocation': {'@type': 'City', 'name': 'Hyderabad', 'containedInPlace': {'@type': 'State', 'name': 'Telangana'}}},
        {**crumbs_ld([('Home', seo.SITE_URL + '/'), ('Blog', seo.SITE_URL + BLOG), (p['title'], url)]), '@id': url + '#crumbs'},
    ]
    if p['faq']:
        ld.append({'@type': 'FAQPage', '@id': url + '#faq', 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in p['faq']]})
    body = head('blog') + header('/blog/', '/') + f"""      <article class="post">
        <header class="page-hero post-hero">
          <div class="wrap">
            <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="{BLOG}">Blog</a><span aria-hidden="true">/</span><a href="{BLOG}#{cat_slug}">{esc(p['category'])}</a></nav>
            <h1>{esc(p['title'], quote=False)}</h1>
            <p>{esc(p['description'], quote=False)}</p>
            <div class="post-meta"><span>By the Sawari team</span><span aria-hidden="true">·</span><time datetime="{p['date']}">{nice_date(p['date'])}</time><span aria-hidden="true">·</span><span>{p['minutes']} min read</span></div>
          </div>
        </header>
        <div class="wrap post-layout">
          <aside class="toc" aria-label="On this page">
            <details open>
              <summary>On this page</summary>
              <ol>
{toc}
              </ol>
            </details>
          </aside>
          <div class="prose">
            <figure class="post-cover">{img_tag(p['image'], esc(p['imageAlt']), '(max-width: 820px) 100vw, 760px', eager=True)}<figcaption>{esc(p['imageAlt'], quote=False)}</figcaption></figure>
{p['body']}
{faq}{drive}
            <p class="post-note">Sawari is a practice simulator. It does not replace lessons with a licensed instructor or the official RTA test. Always follow the signs, signals and traffic police on the real road.</p>
          </div>
        </div>
      </article>

      <section class="section alt">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Keep reading</span>
            <h2>Related articles</h2>
          </div>
          <div class="grid g3">
{chr(10).join(card(q) for q in related)}
          </div>
        </div>
      </section>

{cta('Try it on real Hyderabad roads', 'Five routes, real traffic and a debrief after every drive. Free in your browser.')}""" + footer('/')
    head_html = head_block(p['seoTitle'], p['description'], url, p['image'], p['imageAlt'], ld, article=p)
    return body.replace('<!--SEO-->', head_html)


def index_page(posts, head, header, footer, cta, page_hero):
    url = seo.SITE_URL + BLOG
    title = 'Hyderabad Driving Blog: Guides, Tips and Rules | Sawari'
    desc = 'Hyderabad driving guides: Tank Bund, Charminar and HITEC City routes, getting a licence in Telangana, the RTA test, traffic rules and road skills.'
    chips = ''.join(f'<a class="chip" href="#{s}">{esc(c)}</a>' for c, (s, _) in CATEGORIES.items() if any(p['category'] == c for p in posts))
    sections = []
    for i, (c, (s, blurb)) in enumerate(CATEGORIES.items()):
        group = [p for p in posts if p['category'] == c]
        if not group:
            continue
        sections.append(f"""      <section class="section{' alt' if i % 2 else ''}" id="{s}">
        <div class="wrap">
          <div class="section-head">
            <h2>{esc(c)}</h2>
            <p>{blurb}</p>
          </div>
          <div class="grid g3">
{chr(10).join(card(p) for p in group)}
          </div>
        </div>
      </section>
""")
    ld = [
        {'@type': 'CollectionPage', '@id': url + '#page', 'url': url, 'name': title, 'description': desc, 'inLanguage': 'en-IN',
         'isPartOf': {'@id': seo.SITE_URL + '/#website'}, 'mainEntity': {'@id': url + '#blog'}},
        {'@type': 'Blog', '@id': url + '#blog', 'name': 'Sawari blog', 'url': url, 'description': desc, 'inLanguage': 'en-IN', 'publisher': {'@id': seo.SITE_URL + '/#org'},
         'blogPost': [{'@type': 'BlogPosting', 'headline': p['title'][:110], 'url': post_url(p['slug']), 'datePublished': p['date'] + 'T09:00:00+05:30',
                       'image': f'{seo.SITE_URL}/img/{p["image"]}.jpg', 'author': {'@type': 'Organization', 'name': 'The Sawari team'}} for p in posts]},
        crumbs_ld([('Home', seo.SITE_URL + '/'), ('Blog', url)]),
    ]
    hero = page_hero('Blog', 'Hyderabad driving guides and tips', f'{len(posts)} articles on driving in Hyderabad: route guides, getting your licence in Telangana, the RTA test and the road skills that keep you safe.')
    hero = hero.replace('<a href="./">Home</a>', '<a href="/">Home</a>')
    hero = hero.replace('        </div>\n      </section>', f'          <div class="chips cat-nav">{chips}</div>\n        </div>\n      </section>', 1)
    body = head('blog') + header('/blog/', '/') + hero + '\n'.join(sections) + '\n' + cta('Read it, then drive it', 'Every route guide has a matching drive in Sawari. Free in your browser, no sign-up.') + footer('/')
    return body.replace('<!--SEO-->', head_block(title, desc, url, 'hero', 'A car on an Old City street in Hyderabad at dusk, in the Sawari driving simulator', ld))


def rss(posts):
    def rfc(iso):
        return format_datetime(datetime.fromisoformat(iso + 'T09:00:00+05:30').astimezone(timezone.utc))
    items = '\n'.join(f"""    <item>
      <title>{esc(p['title'], quote=False)}</title>
      <link>{post_url(p['slug'])}</link>
      <guid isPermaLink="true">{post_url(p['slug'])}</guid>
      <pubDate>{rfc(p['date'])}</pubDate>
      <category>{esc(p['category'], quote=False)}</category>
      <description>{esc(p['description'], quote=False)}</description>
    </item>""" for p in posts)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Sawari blog: Hyderabad driving guides and tips</title>
    <link>{seo.SITE_URL}{BLOG}</link>
    <atom:link href="{seo.SITE_URL}{BLOG}feed.xml" rel="self" type="application/rss+xml" />
    <description>Route guides, licence help and road skills for driving in Hyderabad.</description>
    <language>en-in</language>
    <lastBuildDate>{rfc(max(p['updated'] for p in posts))}</lastBuildDate>
{items}
  </channel>
</rss>
"""


def sitemap_rows(posts):
    newest = max(p['updated'] for p in posts)
    return [(seo.SITE_URL + BLOG, newest, 'weekly', '0.8')] + [(post_url(p['slug']), p['updated'], 'monthly', '0.7') for p in posts]
