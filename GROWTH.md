# Growth checklist

Work through these in order. Tick an item (`[x]`) when it is done and shipped.

## 1. Playable on phones
Most visitors in India are on a phone, and phones currently get a "use a desktop or laptop" screen.
- [x] Touch controls: steering slider, GO and BRAKE pedals, indicators, horn, view, lights, back to route, pause (`src/touch.js`)
- [x] Phones and tablets can start a drive (no more desktop-only block screen)
- [x] Lighter graphics on phones: 1x resolution, fast mode and normal traffic on the first visit
- [x] Landscape only: full screen and landscape lock on Android, "turn your phone sideways" prompt, drive pauses when held upright
- [x] Layout checked at 640x360, 667x375, 844x390, 932x430 (phones), 1024x768 and 1180x820 (tablets), and the start page upright
- [x] Tested on a real Android phone: works well
- [ ] Test on an iPhone and an iPad (speed, feel of the steering, sound)
- [x] Update the website FAQ (all four languages) and the blog posts that say "laptop or desktop only"; "Play anywhere" section on the home page

## 2. Make every drive shareable
- [x] Score card image after the debrief, ready for WhatsApp and Instagram Stories (`src/share.js`)
- [x] "Challenge a friend" link: same route, time and traffic, with the score to beat
- [ ] Weekly leaderboard per route (needs a small backend)
- [ ] Three 15–30 s clips (cable bridge at night, Charminar, Tank Bund) as Reels and Shorts
- [ ] Full route videos on YouTube, linked from each route guide

## 3. Go where the audience already is
- [ ] Reddit: r/hyderabad, r/india (local angle); r/threejs, r/webgl (technical angle)
- [ ] Hacker News "Show HN": building a city from OpenStreetMap data
- [ ] Browser game portals: CrazyGames, Poki, itch.io
- [ ] OpenStreetMap: community forum, wiki showcase, Hyderabad mappers
- [ ] Local press pitch: Telangana Today, The Hindu (Hyderabad), Deccan Chronicle
- [ ] Product Hunt launch (after phones work)

## 4. Partner with people who teach driving
- [ ] Two or three Hyderabad driving schools: free "practise at home" link or branded version
- [ ] Road safety pitch to Hyderabad Traffic Police / Transport Department for January
- [ ] Demos at college tech fests (JNTU, IIIT Hyderabad and others)

## 5. Build on the SEO groundwork
- [ ] Search Console: improve posts sitting at positions 8–20 each month
- [ ] Telugu and Hindi versions of the most-searched posts
- [ ] A page per route with an embedded drive video

## 6. Reasons to come back
- [ ] Vote on the next route (ORR, airport expressway, Tank Bund at Ganesh, Ameerpet)
- [ ] Daily challenge and route badges
- [ ] Rain / monsoon mode
- [ ] Night challenge

## 7. Measure it
- [ ] Analytics events: drive started, route finished, share clicked, phone screen shown
- [ ] One monthly target (for example 1,000 finished drives)
