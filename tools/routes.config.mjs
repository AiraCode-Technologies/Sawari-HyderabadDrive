// Famous Hyderabad drives. Each route is the cheapest legal path through its
// waypoints [lat, lon, onRoad?, heading?]. `onRoad` pins a waypoint to roads with
// that name; `heading` (degrees from north) picks the carriageway of a divided road;
// roads matching `prefer` are made cheaper so the route sticks to its namesake.
// Waypoint order follows the legal one-way direction of each road in OSM.
export const ROUTES = [
  {
    id: 'tank-bund',
    name: 'Tank Bund Road',
    area: 'Hussain Sagar',
    blurb: 'The classic drive along the east bank of Hussain Sagar, past the lake and its row of statues.',
    difficulty: 'Easy',
    waypoints: [[17.4214, 78.4845, /^Tank Bund Road$/], [17.4090, 78.4756, /^Tank Bund Road$/]],
    prefer: /^Tank Bund Road$/i,
  },
  {
    id: 'necklace-road',
    name: 'Necklace Road',
    area: 'Hussain Sagar',
    blurb: 'A sweeping lakeside loop around the west and north shores of Hussain Sagar.',
    difficulty: 'Easy',
    waypoints: [
      [17.4153, 78.4659, /^Necklace Road$/],
      [17.4300, 78.4629, /^Necklace Road$/],
      [17.4374, 78.4695, /^Necklace Road$/],
      [17.4310, 78.4865, /^Necklace Road$/],
    ],
    prefer: /^Necklace Road$/i,
  },
  {
    id: 'charminar',
    name: 'Charminar and Pathergatti',
    area: 'Old City',
    blurb: 'Up Charminar Road, round the Charminar itself, then north along the bustling Pathergatti Road.',
    difficulty: 'Hard',
    waypoints: [[17.3549, 78.4732, /^Charminar Road$/], [17.3616, 78.4747, /^Charminar Circle$/], [17.3686, 78.4760, /^Pathergatti Road$/]],
    prefer: /Pathergatti|Charminar/i,
  },
  {
    id: 'hitec-city',
    name: 'Cyber Towers to Jubilee Hills',
    area: 'HITEC City',
    blurb: 'From Cyber Towers past Inorbit Mall, across the Durgam Cheruvu cable bridge and along Road No. 36 to Jubilee Hills Checkpost.',
    difficulty: 'Medium',
    waypoints: [
      [17.4507, 78.3812],
      [17.4291, 78.3975, /^Durgam Cheruvu Bridge$/, 110],
      [17.4267, 78.4155, /Road No\.? ?36/, 135],
    ],
    prefer: /Cyber Towers|Inorbit|Durgam Cheruvu Bridge|Road No\.? ?36|Road Number 45/i,
  },
  {
    id: 'banjara-hills',
    name: 'Banjara Hills Road No. 1',
    area: 'Banjara Hills',
    blurb: 'Uphill from Masab Tank along Road No. 1, one of the city’s busiest arterials.',
    difficulty: 'Medium',
    waypoints: [[17.4040, 78.4522, /^Road Number 1$/], [17.4250, 78.4482, /^Road Number 1$/]],
    prefer: /^Road Number 1$/i,
  },
];

// Extra margin (metres) around the waypoints when downloading map data.
export const MARGIN_M = 450;
