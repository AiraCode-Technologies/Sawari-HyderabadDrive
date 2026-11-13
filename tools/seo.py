"""Search-engine set-up for the website pages (not the game):
static pages per language, titles and descriptions, canonical and hreflang links,
Open Graph / Twitter cards, JSON-LD structured data, sitemap.xml and robots.txt.

SITE_URL must be the address the site is published at (no trailing slash). Set it
with the SITE_URL environment variable when building, e.g.
    SITE_URL=https://staging.example.org python tools/build-site.py  (defaults to https://sawari.airacode.online)
"""
import html
import json
import os
import re
from datetime import date

SITE_URL = os.environ.get('SITE_URL', 'https://sawari.airacode.online').rstrip('/')
LANGS = ['en', 'hi', 'ur', 'te']
DIR = {'en': 'ltr', 'hi': 'ltr', 'ur': 'rtl', 'te': 'ltr'}
LOCALE = {'en': 'en_IN', 'hi': 'hi_IN', 'ur': 'ur_IN', 'te': 'te_IN'}
NATIVE = {'en': ('English', 'English'), 'hi': ('हिन्दी', 'Hindi'), 'ur': ('اردو', 'Urdu'), 'te': ('తెలుగు', 'Telugu')}
SLUGS = ['index', 'routes', 'features', 'about']

# Page titles (under 60 characters, the main search phrase first) per language.
TITLE = {
    'index': {
        'en': 'Sawari: Hyderabad Driving Simulator on Real Roads',
        'hi': 'Sawari: हैदराबाद की असली सड़कों पर ड्राइविंग सिम्युलेटर',
        'ur': 'Sawari: حیدرآباد کی اصل سڑکوں پر ڈرائیونگ سمیولیٹر',
        'te': 'Sawari: అసలు హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సిమ్యులేటర్',
    },
    'routes': {
        'en': 'Hyderabad Driving Routes: Tank Bund to Charminar | Sawari',
        'hi': 'हैदराबाद ड्राइविंग रूट: टैंक बंड से चारमीनार | Sawari',
        'ur': 'حیدرآباد ڈرائیونگ روٹس: ٹینک بنڈ سے چارمینار | Sawari',
        'te': 'హైదరాబాద్ డ్రైవింగ్ రూట్లు: ట్యాంక్ బండ్, చార్మినార్ | Sawari',
    },
    'features': {
        'en': 'Driving Simulator Features: Traffic, Physics, Night | Sawari',
        'hi': 'सिम्युलेटर की विशेषताएँ: ट्रैफ़िक, फ़िज़िक्स, रात | Sawari',
        'ur': 'ڈرائیونگ سمیولیٹر کی خصوصیات: ٹریفک، فزکس، رات | Sawari',
        'te': 'సిమ్యులేటర్ ఫీచర్లు: ట్రాఫిక్, ఫిజిక్స్, రాత్రి | Sawari',
    },
    'about': {
        'en': 'About Sawari and FAQ: Hyderabad Driving Practice',
        'hi': 'Sawari के बारे में और सवाल: हैदराबाद ड्राइविंग अभ्यास',
        'ur': 'Sawari کا تعارف اور سوالات: حیدرآباد ڈرائیونگ کی مشق',
        'te': 'Sawari పరిచయం, ప్రశ్నలు: హైదరాబాద్ డ్రైవింగ్ సాధన',
    },
}

# Meta descriptions (about 140-160 characters) per language.
DESC = {
    'index': {
        'en': 'Practise driving on real Hyderabad roads in your browser. A free 3D driving simulator with Tank Bund, Charminar and HITEC City routes, local traffic and road rules.',
        'hi': 'अपने ब्राउज़र में हैदराबाद की असली सड़कों पर ड्राइविंग का अभ्यास करें। टैंक बंड, चारमीनार और हाईटेक सिटी रूट वाला मुफ़्त 3D ड्राइविंग सिम्युलेटर।',
        'ur': 'اپنے براؤزر میں حیدرآباد کی اصل سڑکوں پر ڈرائیونگ کی مشق کریں۔ ٹینک بنڈ، چارمینار اور ہائی ٹیک سٹی روٹس، مقامی ٹریفک اور سڑک کے اصولوں والا مفت 3D ڈرائیونگ سمیولیٹر۔',
        'te': 'మీ బ్రౌజర్‌లోనే అసలు హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సాధన చేయండి. ట్యాంక్ బండ్, చార్మినార్, హైటెక్ సిటీ రూట్లతో ఉచిత 3D డ్రైవింగ్ సిమ్యులేటర్.',
    },
    'routes': {
        'en': 'Five Hyderabad driving routes to practise: Tank Bund Road, Necklace Road, Charminar and Pathergatti, HITEC City flyovers and Banjara Hills Road No. 1.',
        'hi': 'अभ्यास के लिए हैदराबाद के पाँच ड्राइविंग रूट: टैंक बंड रोड, नेकलेस रोड, चारमीनार और पत्थरगट्टी, हाईटेक सिटी के फ़्लाईओवर और बंजारा हिल्स रोड नं. 1।',
        'ur': 'مشق کے لیے حیدرآباد کے پانچ ڈرائیونگ روٹس: ٹینک بنڈ روڈ، نیکلس روڈ، چارمینار اور پتھر گٹی، ہائی ٹیک سٹی کے فلائی اوور اور بنجارہ ہلز روڈ نمبر 1۔',
        'te': 'సాధన కోసం ఐదు హైదరాబాద్ డ్రైవింగ్ రూట్లు: ట్యాంక్ బండ్ రోడ్, నెక్లెస్ రోడ్, చార్మినార్ మరియు పత్తర్‌గట్టి, హైటెక్ సిటీ ఫ్లైఓవర్లు, బంజారా హిల్స్ రోడ్ నం. 1.',
    },
    'features': {
        'en': 'Realistic car physics, Hyderabad traffic with autos and bikes, Telugu signboards, a full dashboard and morning-to-night lighting. Free in your browser.',
        'hi': 'असली जैसी कार फ़िज़िक्स, ऑटो और बाइकों वाला हैदराबादी ट्रैफ़िक, तेलुगु बोर्ड, पूरा डैशबोर्ड और सुबह से रात तक की रोशनी। आपके ब्राउज़र में मुफ़्त।',
        'ur': 'اصل جیسی کار فزکس، آٹو اور بائیکوں والا حیدرآبادی ٹریفک، تیلگو بورڈ، پورا ڈیش بورڈ اور صبح سے رات تک کی روشنی۔ آپ کے براؤزر میں مفت۔',
        'te': 'నిజమైన కారు ఫిజిక్స్, ఆటోలు, బైకులతో హైదరాబాద్ ట్రాఫిక్, తెలుగు బోర్డులు, పూర్తి డాష్‌బోర్డ్, ఉదయం నుండి రాత్రి వరకు వెలుతురు. మీ బ్రౌజర్‌లో ఉచితం.',
    },
    'about': {
        'en': 'How Sawari builds Hyderabad from OpenStreetMap data, who it is for, and answers to common questions about this free driving practice simulator.',
        'hi': 'Sawari OpenStreetMap डेटा से हैदराबाद कैसे बनाता है, यह किसके लिए है, और इस मुफ़्त ड्राइविंग अभ्यास सिम्युलेटर के बारे में आम सवालों के जवाब।',
        'ur': 'Sawari OpenStreetMap ڈیٹا سے حیدرآباد کیسے بناتا ہے، یہ کس کے لیے ہے، اور اس مفت ڈرائیونگ مشق سمیولیٹر کے بارے میں عام سوالات کے جواب۔',
        'te': 'Sawari OpenStreetMap డేటాతో హైదరాబాద్‌ను ఎలా నిర్మిస్తుంది, ఇది ఎవరి కోసం, ఈ ఉచిత డ్రైవింగ్ సాధన సిమ్యులేటర్ గురించి సాధారణ ప్రశ్నలకు సమాధానాలు.',
    },
}
OG_ALT = {
    'en': 'Sawari driving simulator: a car on an Old City street in Hyderabad at dusk',
    'hi': 'Sawari ड्राइविंग सिम्युलेटर: शाम को हैदराबाद के पुराने शहर की सड़क पर एक कार',
    'ur': 'Sawari ڈرائیونگ سمیولیٹر: شام کو حیدرآباد کے پرانے شہر کی سڑک پر ایک کار',
    'te': 'Sawari డ్రైవింగ్ సిమ్యులేటర్: సాయంత్రం హైదరాబాద్ పాతబస్తీ వీధిలో ఒక కారు',
}


def path(lang, slug):
    """Site-relative path of a page, e.g. '/', '/routes.html', '/hi/', '/te/about.html'."""
    return '/' + ('' if lang == 'en' else f'{lang}/') + ('' if slug == 'index' else f'{slug}.html')


def url(lang, slug):
    return SITE_URL + path(lang, slug)


def esc(s):
    return html.escape(s, quote=True)


def head_block(slug, lang, extra_ld, preload=''):
    title, desc = TITLE[slug][lang], DESC[slug][lang]
    alts = '\n'.join(f'    <link rel="alternate" hreflang="{l}" href="{url(l, slug)}" />' for l in LANGS)
    og_alt = '\n'.join(f'    <meta property="og:locale:alternate" content="{LOCALE[l]}" />' for l in LANGS if l != lang)
    graph = [
        {'@type': 'Organization', '@id': SITE_URL + '/#org', 'name': 'Sawari', 'url': SITE_URL + '/', 'logo': SITE_URL + '/icons/icon-512.png'},
        {'@type': 'WebSite', '@id': SITE_URL + '/#website', 'name': 'Sawari', 'alternateName': 'Sawari · Drive Hyderabad', 'url': SITE_URL + '/',
         'publisher': {'@id': SITE_URL + '/#org'}, 'inLanguage': LANGS},
        {'@type': 'WebPage', '@id': url(lang, slug) + '#page', 'url': url(lang, slug), 'name': title, 'description': desc, 'inLanguage': lang,
         'isPartOf': {'@id': SITE_URL + '/#website'}, 'primaryImageOfPage': SITE_URL + '/og-image.jpg'},
    ] + extra_ld
    ld = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, indent=1).replace('</', '<\\/')
    return f"""    <title>{esc(title)}</title>
    <meta name="description" content="{esc(desc)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="canonical" href="{url(lang, slug)}" />
{alts}
    <link rel="alternate" hreflang="x-default" href="{url('en', slug)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Sawari" />
    <meta property="og:title" content="{esc(title)}" />
    <meta property="og:description" content="{esc(desc)}" />
    <meta property="og:url" content="{url(lang, slug)}" />
    <meta property="og:image" content="{SITE_URL}/og-image.jpg" />
    <meta property="og:image:secure_url" content="{SITE_URL}/og-image.jpg" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="{esc(OG_ALT[lang])}" />
    <meta property="og:locale" content="{LOCALE[lang]}" />
{og_alt}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{esc(title)}" />
    <meta name="twitter:description" content="{esc(desc)}" />
    <meta name="twitter:image" content="{SITE_URL}/og-image.jpg" />
    <meta name="twitter:image:alt" content="{esc(OG_ALT[lang])}" />
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
{preload}    <script type="application/ld+json">
{ld}
    </script>
"""


def lang_menu(slug, lang):
    """The language dropdown: real links to each language version (crawlable)."""
    tick = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
    items = ''.join(
        f'<li><a href="{path(l, slug)}" hreflang="{l}" lang="{l}" data-lang="{l}"{" aria-current=\"true\"" if l == lang else ""}>'
        f'<span class="native" dir="{DIR[l]}">{NATIVE[l][0]}</span><span class="en-name">{NATIVE[l][1]}</span>{tick}</a></li>'
        for l in LANGS)
    globe = '<svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>'
    chev = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    return (f'<div class="lang"><button class="lang-btn" type="button" aria-expanded="false" aria-controls="lang-menu" aria-label="Language / भाषा / زبان / భాష">'
            f'{globe}<span class="lang-current">{NATIVE[lang][0]}</span>{chev}</button>'
            f'<ul class="lang-menu" id="lang-menu" hidden>{items}</ul></div>')


def localize(page_html, slug, lang, T, idx):
    """English page -> the same page in `lang`, using the phrase dictionary T."""
    out = page_html
    if lang != 'en':
        out = out.replace('<span data-year>2026</span>', '<span data-year=""></span>')
        for key in sorted(T, key=len, reverse=True):
            val = T[key]
            if not val:
                continue
            tr = val[idx]
            out = out.replace(f'>{key}<', f'>{tr}<')
            for attr in ('alt', 'aria-label', 'title', 'data-label-dark', 'data-label-light', 'data-copied', 'data-ig'):
                out = out.replace(f'{attr}="{esc(key)}"', f'{attr}="{esc(tr)}"')
        out = out.replace('<span data-year=""></span>', '<span data-year>2026</span>')
    out = out.replace('<html lang="en">', f'<html lang="{lang}" dir="{DIR[lang]}">')
    out = out.replace('<!--LANG-MENU-->', lang_menu(slug, lang))
    return out


def untranslated(page_html, T):
    """English phrases still present in a translated page (for the build check)."""
    return [k for k, v in T.items() if v and len(k) > 2 and f'>{k}<' in page_html]


def sitemap():
    today = date.today().isoformat()
    rows = []
    for slug in SLUGS:
        alts = ''.join(f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{url(l, slug)}" />' for l in LANGS)
        alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{url("en", slug)}" />'
        for lang in LANGS:
            rows.append(f'  <url>\n    <loc>{url(lang, slug)}</loc>\n    <lastmod>{today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>{"1.0" if slug == "index" else "0.8"}</priority>{alts}\n  </url>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
            + '\n'.join(rows) + '\n</urlset>\n')


def robots():
    return f'User-agent: *\nAllow: /\nDisallow: /404.html\n\nSitemap: {SITE_URL}/sitemap.xml\n'


def manifest():
    return json.dumps({
        'name': 'Sawari · Drive Hyderabad', 'short_name': 'Sawari',
        'description': DESC['index']['en'], 'lang': 'en', 'start_url': '/', 'display': 'standalone',
        'background_color': '#0b1117', 'theme_color': '#0b1117',
        'icons': [
            {'src': '/icons/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
            {'src': '/icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
            {'src': '/icons/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
        ],
    }, ensure_ascii=False, indent=2)


def img_tag(name, alt, sizes='(max-width: 880px) 100vw, 50vw', eager=False, cls=''):
    """Responsive WebP screenshot (800 and 1600 px wide)."""
    load = 'fetchpriority="high"' if eager else 'loading="lazy"'
    c = f' class="{cls}"' if cls else ''
    return (f'<img{c} src="/img/{name}.webp" srcset="/img/{name}-800.webp 800w, /img/{name}.webp 1600w" sizes="{sizes}" '
            f'alt="{alt}" width="1600" height="900" {load} decoding="async" />')


# ---------- share templates (footer "Share Sawari" block) ----------
# {url} is replaced with the page address. X counts Indic and Urdu letters double,
# so those posts stay short. Facebook takes no text: it shows the page's Open Graph card.
SHARE = {
    'en': {
        'linkedin': "I've been trying Sawari, a free 3D driving simulator built on real Hyderabad roads: Tank Bund, the Charminar and the HITEC City flyovers, with left-hand traffic, signals and a debrief after every drive. A handy way for new drivers to practise before getting on the road.\n\n{url}\n\n#Hyderabad #DrivingPractice #RoadSafety #Telangana",
        'whatsapp': 'Try Sawari: practise driving on real Hyderabad roads, free in your browser. Tank Bund, Charminar, HITEC City flyovers and proper Hyderabad traffic!\n{url}',
        'x': 'Practise driving on real Hyderabad roads, free in your browser 🚗 Tank Bund, Charminar, HITEC City flyovers. #Hyderabad #DrivingPractice',
        'instagram': 'Practising on real Hyderabad roads 🚗✨ Tank Bund at sunset, the Charminar roundabout and the HITEC City flyovers, all in a free browser driving simulator.\n\nTry Sawari: {url}\n\n#Sawari #Hyderabad #Telangana #DrivingPractice #RoadSafety #HyderabadDiaries',
    },
    'hi': {
        'linkedin': 'Sawari देखिए: हैदराबाद की असली सड़कों पर बना मुफ़्त 3D ड्राइविंग सिम्युलेटर। टैंक बंड, चारमीनार और हाईटेक सिटी के फ़्लाईओवर, बाईं ओर चलने वाला ट्रैफ़िक, सिग्नल और हर ड्राइव के बाद समीक्षा। नए ड्राइवरों के लिए सड़क पर उतरने से पहले अभ्यास का आसान तरीका।\n\n{url}\n\n#Hyderabad #DrivingPractice #RoadSafety #हैदराबाद',
        'whatsapp': 'Sawari आज़माइए: हैदराबाद की असली सड़कों पर ड्राइविंग का अभ्यास, ब्राउज़र में मुफ़्त। टैंक बंड, चारमीनार, हाईटेक सिटी फ़्लाईओवर और असली हैदराबादी ट्रैफ़िक!\n{url}',
        'x': 'हैदराबाद की असली सड़कों पर ड्राइविंग का अभ्यास, ब्राउज़र में मुफ़्त 🚗 #Hyderabad',
        'instagram': 'हैदराबाद की असली सड़कों पर ड्राइविंग का अभ्यास 🚗✨ शाम को टैंक बंड, चारमीनार का गोल चक्कर और हाईटेक सिटी के फ़्लाईओवर, सब एक मुफ़्त ब्राउज़र ड्राइविंग सिम्युलेटर में।\n\nSawari आज़माइए: {url}\n\n#Sawari #Hyderabad #हैदराबाद #DrivingPractice #RoadSafety',
    },
    'ur': {
        'linkedin': 'Sawari دیکھیے: حیدرآباد کی اصل سڑکوں پر بنا مفت 3D ڈرائیونگ سمیولیٹر۔ ٹینک بنڈ، چارمینار اور ہائی ٹیک سٹی کے فلائی اوور، بائیں طرف چلنے والا ٹریفک، سگنل اور ہر ڈرائیو کے بعد جائزہ۔ نئے ڈرائیوروں کے لیے سڑک پر اترنے سے پہلے مشق کا آسان طریقہ۔\n\n{url}\n\n#Hyderabad #DrivingPractice #RoadSafety #حیدرآباد',
        'whatsapp': 'Sawari آزمائیے: حیدرآباد کی اصل سڑکوں پر ڈرائیونگ کی مشق، براؤزر میں مفت۔ ٹینک بنڈ، چارمینار، ہائی ٹیک سٹی فلائی اوور اور اصل حیدرآبادی ٹریفک!\n{url}',
        'x': 'حیدرآباد کی اصل سڑکوں پر ڈرائیونگ کی مشق، براؤزر میں مفت 🚗 #Hyderabad',
        'instagram': 'حیدرآباد کی اصل سڑکوں پر ڈرائیونگ کی مشق 🚗✨ شام کو ٹینک بنڈ، چارمینار کا گول چکر اور ہائی ٹیک سٹی کے فلائی اوور، سب ایک مفت براؤزر ڈرائیونگ سمیولیٹر میں۔\n\nSawari آزمائیے: {url}\n\n#Sawari #Hyderabad #حیدرآباد #DrivingPractice #RoadSafety',
    },
    'te': {
        'linkedin': 'Sawari చూడండి: అసలు హైదరాబాద్ రోడ్లపై నిర్మించిన ఉచిత 3D డ్రైవింగ్ సిమ్యులేటర్. ట్యాంక్ బండ్, చార్మినార్, హైటెక్ సిటీ ఫ్లైఓవర్లు, ఎడమవైపు ట్రాఫిక్, సిగ్నళ్లు, ప్రతి డ్రైవ్ తర్వాత సమీక్ష. రోడ్డు మీదకి వెళ్లే ముందు కొత్త డ్రైవర్లు సాధన చేయడానికి సులువైన మార్గం.\n\n{url}\n\n#Hyderabad #DrivingPractice #RoadSafety #హైదరాబాద్',
        'whatsapp': 'Sawari ప్రయత్నించండి: అసలు హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సాధన, బ్రౌజర్‌లో ఉచితం. ట్యాంక్ బండ్, చార్మినార్, హైటెక్ సిటీ ఫ్లైఓవర్లు, అచ్చం హైదరాబాద్ ట్రాఫిక్!\n{url}',
        'x': 'అసలు హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సాధన, బ్రౌజర్‌లో ఉచితం 🚗 #Hyderabad',
        'instagram': 'అసలు హైదరాబాద్ రోడ్లపై డ్రైవింగ్ సాధన 🚗✨ సాయంత్రం ట్యాంక్ బండ్, చార్మినార్ రౌండ్‌అబౌట్, హైటెక్ సిటీ ఫ్లైఓవర్లు, అన్నీ ఉచిత బ్రౌజర్ డ్రైవింగ్ సిమ్యులేటర్‌లో.\n\nSawari ప్రయత్నించండి: {url}\n\n#Sawari #Hyderabad #హైదరాబాద్ #DrivingPractice #RoadSafety',
    },
}


def share_fill(page_html, lang, slug):
    """Fills the footer share links and caption data for one page and language."""
    from urllib.parse import quote
    u = url(lang, slug)
    t = {k: v.replace('{url}', u) for k, v in SHARE[lang].items()}
    hrefs = {
        '__SHARE_LINKEDIN__': 'https://www.linkedin.com/feed/?shareActive=true&text=' + quote(t['linkedin']),
        '__SHARE_WHATSAPP__': 'https://wa.me/?text=' + quote(t['whatsapp']),
        '__SHARE_X__': 'https://x.com/intent/post?text=' + quote(t['x']) + '&url=' + quote(u),
        '__SHARE_FACEBOOK__': 'https://www.facebook.com/sharer/sharer.php?u=' + quote(u),
    }
    for k, v in hrefs.items():
        page_html = page_html.replace(k, esc(v))
    data = json.dumps(SHARE[lang], ensure_ascii=False).replace('</', '<\\/')
    return page_html.replace('<!--SHARE-DATA-->', f'<script type="application/json" id="share-data">{data}</script>')
