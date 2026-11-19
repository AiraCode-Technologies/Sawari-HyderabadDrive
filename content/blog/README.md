# Blog posts

Each post is one file here, `<slug>.html`, built into `/blog/<slug>.html` by
`python tools/build-site.py` (the blog index is `/blog/`). English only.

## File format

A JSON header in an HTML comment, then the article body as plain HTML:

```html
<!--meta
{
  "slug": "tank-bund-road-driving-guide",
  "title": "Tank Bund Road driving guide: Hyderabad's lakeside drive",
  "seoTitle": "Tank Bund Road Driving Guide, Hyderabad | Sawari",
  "description": "What to expect when you drive Tank Bund Road in Hyderabad: lanes, statues, speed breakers, two-wheelers and the best time to go, plus how to practise it first.",
  "category": "Route guides",
  "keywords": ["Tank Bund Road", "driving in Hyderabad", "Hussain Sagar"],
  "image": "tank-bund",
  "imageAlt": "Tank Bund Road beside Hussain Sagar in the Sawari driving simulator",
  "route": "tank-bund",
  "date": "2026-11-17",
  "related": ["necklace-road-driving-guide", "hyderabad-traffic-rules-guide", "speed-breakers-speed-limits-hyderabad"],
  "faq": [
    ["Question?", "Answer in one to three plain sentences."]
  ]
}
-->
<p class="lead">One or two sentences that answer the search intent straight away.</p>

<h2>First section heading</h2>
<p>...</p>
```

Field rules:

- `slug`: lower-case, hyphens, the main search phrase; must match the file name.
- `title`: the on-page H1, natural wording, may be longer than 60 characters.
- `seoTitle`: the `<title>`, **at most 60 characters** including ` | Sawari`, main phrase first.
- `description`: meta description, **140 to 160 characters**, includes the main phrase.
- `category`: one of `Route guides`, `Learning to drive`, `Road skills`, `Hyderabad roads`,
  `Behind the build`, `Release notes`.
- `image`: one of `hero`, `night`, `cockpit`, `junction`, `tank-bund`, `necklace-road`,
  `charminar`, `hitec-city`, `banjara-hills` (screenshots from the simulator in `public/img/`).
- `route` (optional): a route id; the post then ends with a "drive this route" button.
- `related`: 3 slugs of other posts (see the list below).
- `faq`: 3 or 4 question/answer pairs that people really search for. Plain text, no HTML.
  They are shown at the end of the post and marked up as FAQPage structured data.

## Body rules

- Allowed tags: `p`, `h2`, `h3`, `ul`, `ol`, `li`, `strong`, `em`, `a`, `kbd`, `table`,
  `thead`, `tbody`, `tr`, `th`, `td`, `blockquote`. Optional boxes:
  `<div class="callout">...</div>` (a tip) and `<div class="callout warn">...</div>` (safety).
- Start with `<p class="lead">`. Use `h2` for the main sections (4 to 7 of them; they form the
  table of contents) and `h3` under them. No `h1` (the title is the H1).
- Do not include the FAQ in the body; it is generated from `faq`.
- Internal links are root-relative: `/blog/<slug>.html`, `/routes.html#tank-bund`,
  `/features.html`, `/about.html`, `/play.html?route=charminar`. Link to 2 to 5 other posts
  where it helps the reader.
- External links only to official or primary sources (Telangana Transport Department,
  Parivahan Sarathi, Hyderabad Traffic Police, OpenStreetMap), written as
  `<a href="https://..." rel="noopener" target="_blank">`.

## All post slugs

Route guides: `tank-bund-road-driving-guide`, `necklace-road-driving-guide`,
`charminar-old-city-driving-guide`, `hitec-city-to-jubilee-hills-drive`,
`banjara-hills-road-no-1-driving-guide`

Learning to drive: `how-to-get-driving-licence-hyderabad`, `telangana-rta-driving-test-tips`,
`road-signs-india-learner-licence-test`, `free-online-driving-simulator-india`,
`driving-in-hyderabad-for-beginners`

Road skills: `hyderabad-traffic-rules-guide`, `indicators-and-lane-discipline`,
`u-turns-in-hyderabad`, `driving-on-flyovers-hyderabad`, `roundabouts-how-to-drive-india`,
`speed-breakers-speed-limits-hyderabad`, `sharing-the-road-autos-buses-two-wheelers`,
`night-driving-hyderabad-tips`, `monsoon-driving-hyderabad`

Hyderabad roads: `hyderabad-outer-ring-road-guide`, `hyderabad-regional-ring-road-rrr`,
`hyderabad-metro-guide-for-drivers`, `hyderabad-flyovers-and-underpasses`,
`driving-to-hyderabad-airport`, `weekend-road-trips-from-hyderabad`,
`hyderabad-traffic-hotspots-peak-hours`, `electric-cars-in-hyderabad`,
`history-of-hyderabad-roads`, `telangana-tg-number-plates-explained`

Behind the build: `how-we-built-hyderabad-in-3d`
