// Reduces an OpenStreetMap extract of Montbéliard's centre to what the circuit and its town are built from:
// tools/montbeliard_osm.json (the lap on real streets, building footprints, streets, water, railway, parks).
//
//   node tools/montbeliard_osm.js <map.json>
//
// <map.json> is the extract itself, not kept in the repository (7 MB):
//   https://api.openstreetmap.org/api/0.6/map.json?bbox=6.7890,47.5040,6.8090,47.5160
// Map data © OpenStreetMap contributors, Open Database Licence (openstreetmap.org/copyright).
//
// Everything is in metres, x to the east and z to the south of ORIGIN.
const fs = require('fs');
const path = require('path');

const ORIGIN = [6.7990, 47.5100];
// The lap: the boulevards round the old town. It goes through these points in turn (the shortest way on the
// main streets from each to the next, never twice through the same crossing) and starts nearest to START.
const VIA = [[58, -210], [-316, -34], [-320, 184], [239, 83]];
const START = [150, -40];              // Avenue des Alliés, in front of the station
const DRIVE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link']);
const STREET_WIDTH = { primary: 9, secondary: 8, tertiary: 7, residential: 5.5, unclassified: 5.5, living_street: 5, pedestrian: 5, primary_link: 6, secondary_link: 6, tertiary_link: 6, busway: 6 };
const WATER_WIDTH = { 'L\'Allan': 30, 'Canal du Rhône au Rhin - Branche Sud': 18, 'La Lizaine': 7 };
const LANDMARKS = { 'Château des Ducs de Wurtemberg': 'chateau', 'Temple Saint-Martin': 'temple', 'Halles de Montbéliard': 'halles', 'Hôtel de Ville de Montbéliard': 'mairie', 'Église Saint-Maimbœuf': 'eglise', 'Temple Saint-Georges': 'templeGeorges', 'Montbéliard': 'gare' };

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/montbeliard_osm.js <map.json>'); process.exit(1); }
const osm = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(), ways = [], relations = [];
for (const e of osm.elements) { if (e.type === 'node') nodes.set(e.id, e); else if (e.type === 'way') ways.push(e); else if (e.type === 'relation') relations.push(e); }
const wayById = new Map(ways.map(w => [w.id, w]));
const xy = n => [(n.lon - ORIGIN[0]) * Math.PI / 180 * 6371000 * Math.cos(ORIGIN[1] * Math.PI / 180), -(n.lat - ORIGIN[1]) * Math.PI / 180 * 6371000];
for (const n of nodes.values()) n.p = xy(n);
const points = w => w.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => n.p);
const round = p => p.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]);
const ring = p => { const r = round(p); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r; };
const area = p => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2);

// ------------------------------------------------------------------ the lap
const edges = new Map();
const link = (a, b, w) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push({ to: b, w }); };
for (const w of ways) {
  if (!DRIVE.has((w.tags || {}).highway)) continue;
  for (let i = 1; i < w.nodes.length; i++) { const a = nodes.get(w.nodes[i - 1]), b = nodes.get(w.nodes[i]); if (!a || !b) continue; link(a.id, b.id, w); link(b.id, a.id, w); }
}
const nearest = ([x, z]) => { let best = null, d = Infinity; for (const id of edges.keys()) { const p = nodes.get(id).p, q = Math.hypot(p[0] - x, p[1] - z); if (q < d) { d = q; best = id; } } return best; };
function shortest(from, to, banned) {
  const dist = new Map([[from, 0]]), prev = new Map(), queue = [from], done = new Set();
  while (queue.length) {
    queue.sort((a, b) => dist.get(a) - dist.get(b));
    const u = queue.shift(); if (done.has(u)) continue; done.add(u); if (u === to) break;
    for (const { to: v, w } of edges.get(u) || []) {
      if (banned.has(v) && v !== to) continue;
      const a = nodes.get(u).p, b = nodes.get(v).p;
      const cost = Math.hypot(a[0] - b[0], a[1] - b[1]) * (/primary|secondary|tertiary/.test(w.tags.highway) ? 1 : 1.6);   // boulevards rather than alleys
      if (!dist.has(v) || dist.get(u) + cost < dist.get(v)) { dist.set(v, dist.get(u) + cost); prev.set(v, { u, w }); queue.push(v); }
    }
  }
  if (!prev.has(to)) return null;
  const steps = []; for (let v = to; v !== from; v = prev.get(v).u) steps.unshift({ id: v, w: prev.get(v).w });
  return steps;
}
const via = VIA.map(nearest), lapSteps = [], used = new Set();
for (let i = 0; i < via.length; i++) {
  // the way back to the first point may have to run along crossings the lap left by: checked below
  const steps = shortest(via[i], via[(i + 1) % via.length], used) || shortest(via[i], via[(i + 1) % via.length], new Set());
  if (steps == null) throw new Error('No way from point ' + i + ' of VIA to the next');
  for (const s of steps) { lapSteps.push(s); used.add(s.id); }
  used.delete(via[0]);
}
let lap = lapSteps.map(s => nodes.get(s.id));
// Where the way back meets the way out before the first point, the lap is closed there: the stretch run
// twice (out to the first point and back) is dropped.
for (;;) {
  let cut = null;
  for (let i = 0; i < lap.length; i++) for (let j = lap.length - 1; j > i; j--) if (lap[i].id === lap[j].id && (cut == null || j - i > cut[1] - cut[0])) cut = [i, j];
  if (cut == null) break;
  lap = lap.slice(cut[0], cut[1]);
}
if (lap.length < 20) throw new Error('The lap runs twice through the same streets: move the points of VIA');
let first = 0; lap.forEach((n, i) => { if (Math.hypot(n.p[0] - START[0], n.p[1] - START[1]) < Math.hypot(lap[first].p[0] - START[0], lap[first].p[1] - START[1])) first = i; });
lap = lap.slice(first).concat(lap.slice(0, first));
const onLap = new Set(lap.map(n => n.id));
const names = []; for (const s of lapSteps) { const n = s.w.tags.name; if (onLap.has(s.id) && n && !names.includes(n)) names.push(n); }
const lapLength = lap.reduce((s, n, i) => { const m = lap[(i + 1) % lap.length]; return s + Math.hypot(m.p[0] - n.p[0], m.p[1] - n.p[1]); }, 0);

// ------------------------------------------------------------------ the town
const buildings = [], streets = [], water = [], rails = [], parks = [], landmarks = {};
const multipolygonOuters = new Set();
for (const r of relations) if ((r.tags || {}).type === 'multipolygon' && (r.tags.building || r.tags.natural === 'water' || r.tags.leisure === 'park')) {
  for (const m of r.members) if (m.type === 'way' && m.role === 'outer' && wayById.has(m.ref)) {
    const w = wayById.get(m.ref), p = ring(points(w)); if (p.length < 3) continue;
    multipolygonOuters.add(w.id);
    if (r.tags.building) { buildings.push({ p, levels: +r.tags['building:levels'] || undefined, name: r.tags.name }); if (LANDMARKS[r.tags.name]) landmarks[LANDMARKS[r.tags.name]] = p; }
    else if (r.tags.natural === 'water') water.push({ area: p });
    else parks.push(p);
  }
}
for (const w of ways) {
  const t = w.tags || {}, p = points(w);
  if (p.length < 2 || multipolygonOuters.has(w.id)) continue;
  if (t.building) {
    const r = ring(p); if (r.length < 3 || area(r) < 12) continue;
    const b = { p: r }; if (t['building:levels']) b.levels = +t['building:levels']; if (t.height) b.height = parseFloat(t.height);
    if (t.amenity === 'place_of_worship') b.kind = 'worship'; else if (t.building === 'train_station' || t.railway === 'station') b.kind = 'station';
    buildings.push(b);
    if (LANDMARKS[t.name]) landmarks[LANDMARKS[t.name]] = r;
  } else if (t.natural === 'water') water.push({ area: ring(p) });
  else if (t.waterway === 'river' || t.waterway === 'canal' || t.waterway === 'stream') { if (t.tunnel !== 'yes' && t.tunnel !== 'culvert') water.push({ line: round(p), width: WATER_WIDTH[t.name] || 6 }); }
  else if (t.railway === 'rail') rails.push(round(p));
  else if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'forest' || t.natural === 'wood') parks.push(ring(p));
  else if (STREET_WIDTH[t.highway] && t.tunnel !== 'yes') {
    if (t.highway === 'pedestrian' && t.area === 'yes') streets.push({ area: ring(p) });
    else streets.push({ line: round(p), width: STREET_WIDTH[t.highway] + (+t.lanes > 2 ? 3 : 0) });
  }
}
// landmarks mapped as points only (the station): the nearest building
for (const e of osm.elements) if (e.type === 'node' && e.tags && LANDMARKS[e.tags.name] && !landmarks[LANDMARKS[e.tags.name]]) landmarks[LANDMARKS[e.tags.name]] = { at: e.p.map(v => +v.toFixed(1)) };

const out = {
  source: 'Map data © OpenStreetMap contributors, Open Database Licence (openstreetmap.org/copyright). Reduced by tools/montbeliard_osm.js.',
  origin: ORIGIN,
  lap: lap.map(n => [+n.lon.toFixed(6), +n.lat.toFixed(6)]),
  lapStreets: names,
  buildings, streets, water, rails, parks, landmarks,
};
const target = path.join(__dirname, 'montbeliard_osm.json');
fs.writeFileSync(target, JSON.stringify(out));
console.log(`Lap ${Math.round(lapLength)} m through ${names.join(', ')}`);
console.log(`${buildings.length} buildings, ${streets.length} streets, ${water.length} waters, ${rails.length} rails, ${parks.length} parks; landmarks: ${Object.keys(landmarks).join(', ')}`);
console.log(`Written ${target} (${Math.round(fs.statSync(target).size / 1024)} KB)`);
