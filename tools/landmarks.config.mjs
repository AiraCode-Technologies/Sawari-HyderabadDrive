// Famous places along the routes, drawn with their real names and an architecture
// modelled on the real building instead of a generic box.
//   osm    Overpass name pattern (case-insensitive) used by tools/fetch-landmarks.mjs
//   match  the stricter test a found place's name must pass
//   style  the 3D model (see src/world/famous.js)
//   name / te  the name on its signs, in English and Telugu
//   routes which routes it belongs to (it must also be near that route)
//   h      overall height in metres; size [w, d] when the map has only a point
// Map data © OpenStreetMap contributors, ODbL.
export const FAMOUS = [
  // ---- Hussain Sagar: Necklace Road and Tank Bund ----
  { id: 'secretariat', osm: 'Secretariat', match: /secretariat/i, style: 'secretariat', name: 'Dr. B.R. Ambedkar Telangana State Secretariat', te: 'డా. బి.ఆర్. అంబేద్కర్ తెలంగాణ రాష్ట్ర సచివాలయం', routes: ['necklace-road', 'tank-bund'], h: 80, size: [160, 110] },
  { id: 'ambedkar', osm: 'Ambedkar Statue|Ambedkar.*125|125.*Ambedkar|Statue of Dr', match: /ambedkar.*statue|statue.*ambedkar|125/i, style: 'tall-statue', name: 'Dr. B.R. Ambedkar Statue', te: 'డా. బి.ఆర్. అంబేద్కర్ విగ్రహం', routes: ['necklace-road', 'tank-bund'], h: 53, size: [44, 44] },
  { id: 'martyrs', osm: 'Martyr|Amaraveer|Amarajyothi|Amara Jyothi', match: /martyr|amaraveer|amara ?jyothi/i, style: 'flame', name: 'Telangana Martyrs’ Memorial', te: 'తెలంగాణ అమరవీరుల స్మారకం', routes: ['necklace-road', 'tank-bund'], h: 54, size: [70, 50] },
  { id: 'buddha', osm: 'Buddha', match: /buddha/i, style: 'buddha', name: 'Buddha Statue', te: 'బుద్ధ విగ్రహం', routes: ['necklace-road', 'tank-bund'], size: [20, 20] },
  { id: 'birla', osm: 'Birla Mandir|Birla Temple', match: /birla (mandir|temple)/i, style: 'shikhara', name: 'Birla Mandir', te: 'బిర్లా మందిర్', routes: ['necklace-road', 'tank-bund'], h: 36, size: [40, 30] },
  { id: 'imax', osm: 'IMAX', match: /imax/i, style: 'drum', name: 'Prasads IMAX', te: 'ప్రసాద్స్ ఐమాక్స్', routes: ['necklace-road'], h: 32, size: [70, 70] },
  { id: 'jalvihar', park: true, osm: 'Jal ?Vihar|Jalavihar', match: /jal ?a?vihar/i, style: 'gateway', name: 'Jalavihar', te: 'జలవిహార్', routes: ['necklace-road'] },
  { id: 'lumbini', park: true, osm: 'Lumbini', match: /lumbini park/i, style: 'gateway', name: 'Lumbini Park', te: 'లుంబిని పార్క్', routes: ['necklace-road', 'tank-bund'] },
  { id: 'ntr', park: true, osm: 'NTR Gardens|NTR Garden', match: /ntr garden/i, style: 'gateway', name: 'NTR Gardens', te: 'ఎన్టీఆర్ గార్డెన్స్', routes: ['necklace-road', 'tank-bund'] },
  { id: 'sanjeevaiah', osm: 'Sanjeevaiah Park', match: /^sanjeevaiah park$/i, park: true, style: 'gateway', name: 'Sanjeevaiah Park', te: 'సంజీవయ్య పార్క్', routes: ['necklace-road'] },
  { id: 'flag', osm: 'National Flag|Flag ?pole|Flag Mast', match: /flag/i, style: 'flag', name: 'National Flag', te: 'జాతీయ జెండా', routes: ['necklace-road', 'tank-bund'], h: 88, size: [10, 10] },
  // ---- Old City ----
  { id: 'mecca', osm: 'Mecca Masjid|Makkah Masjid', match: /^(mecca|makkah) masjid$/i, style: 'grand-mosque', name: 'Mecca Masjid', te: 'మక్కా మసీదు', routes: ['charminar'], h: 23, size: [70, 60] },
  { id: 'chowmahalla', osm: 'Chowmahalla', match: /chowmahalla palace$/i, style: 'palace', name: 'Chowmahalla Palace', te: 'చౌమహల్లా ప్యాలెస్', routes: ['charminar'], h: 16, size: [60, 40] },
  { id: 'salarjung', osm: 'Salar Jung', match: /salar jung museum/i, style: 'museum', name: 'Salar Jung Museum', te: 'సాలార్ జంగ్ మ్యూజియం', routes: ['charminar'], h: 22, size: [90, 60] },
  { id: 'highcourt', osm: 'High Court', match: /high court/i, style: 'indo-saracenic', name: 'Telangana High Court', te: 'తెలంగాణ హైకోర్టు', routes: ['charminar'], h: 26, size: [120, 60] },
  { id: 'osmania', osm: 'Osmania General Hospital', match: /osmania general hospital/i, style: 'indo-saracenic', name: 'Osmania General Hospital', te: 'ఉస్మానియా జనరల్ ఆసుపత్రి', routes: ['charminar'], h: 24, size: [110, 50] },
  // ---- HITEC City, Madhapur and Jubilee Hills ----
  // mapped without its name: the office block addressed "Q3, Cyber Towers" (the quadrants)
  { id: 'cybertowers', osm: 'Cyber Towers', osmId: 68883448, match: /cyber towers?$/i, style: 'cyber-towers', name: 'Cyber Towers', te: 'సైబర్ టవర్స్', routes: ['hitec-city'], h: 42, size: [90, 60] },
  { id: 'inorbit', osm: 'Inorbit', match: /inorbit mall/i, style: 'mall', name: 'Inorbit Mall', te: 'ఇనార్బిట్ మాల్', routes: ['hitec-city'], h: 24, palette: ['#e9e4da', '#2b6cb0', '#f2a33a'] },
  { id: 'cybergateway', osm: 'Cyber Gateway', match: /^cyber gateway$/i, style: 'it-office', name: 'Cyber Gateway', te: 'సైబర్ గేట్‌వే', routes: ['hitec-city'], h: 40 },
  { id: 'deccanpark', osm: 'Deccan Park', match: /^tcs deccan park$/i, style: 'it-office', name: 'TCS Deccan Park', te: 'టీసీఎస్ దక్కన్ పార్క్', routes: ['hitec-city'], h: 32 },
  { id: 'kohenur', osm: 'Kohenur', match: /itc kohenur/i, style: 'hotel-tower', name: 'ITC Kohenur', te: 'ఐటీసీ కోహినూర్', routes: ['hitec-city'], h: 45, size: [70, 40] },
  { id: 'trident', osm: 'Trident', match: /^trident$/i, style: 'hotel-tower', name: 'Trident Hyderabad', te: 'ట్రైడెంట్', routes: ['hitec-city'], h: 38 },
  { id: 'peddamma', osm: 'Peddamma', match: /peddamma temple/i, style: 'gopuram', name: 'Peddamma Temple', te: 'పెద్దమ్మ గుడి', routes: ['hitec-city'], h: 22, size: [30, 40] },
  // ---- Banjara Hills ----
  { id: 'gvkone', osm: 'GVK One', match: /^gvk one$/i, style: 'mall', name: 'GVK One', te: 'జీవీకే వన్', routes: ['banjara-hills'], h: 26, palette: ['#d8dde2', '#1f3b57', '#b8c4cf'] },
  { id: 'citycenter', osm: 'City Cent', match: /^city cent(er|re)/i, style: 'mall', name: 'City Center Mall', te: 'సిటీ సెంటర్ మాల్', routes: ['banjara-hills'], h: 22, palette: ['#e6d3b8', '#7a2e1f', '#d9a441'] },
  { id: 'tajkrishna', osm: 'Taj Krishna', match: /taj krishna/i, style: 'heritage-hotel', name: 'Taj Krishna', te: 'తాజ్ కృష్ణ', routes: ['banjara-hills'], h: 30 },
  { id: 'tajdeccan', osm: 'Taj Deccan', match: /taj deccan/i, style: 'hotel-tower', name: 'Taj Deccan', te: 'తాజ్ దక్కన్', routes: ['banjara-hills'], h: 36 },
];
