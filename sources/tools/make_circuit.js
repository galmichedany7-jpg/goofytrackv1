// Builds a circuit of tools/circuits.js from its real line:
//
//   tracks/<circuit>/<circuit>.glb    the drivable circuit as custom track parts (road ribbon with kerbs and
//                                     barriers, start line, checkpoint and finish gates)
//   tracks/<circuit>/<circuit>.json   where everything goes (tiles, gates, the centreline with its heights)
//                                     and the surroundings in the circuit's frame (building footprints,
//                                     streets, water, railway, parks, woods, landmarks, the relief),
//                                     from which apex-town.js draws them
//
// The line is either a lap on real streets (tools/<circuit>_osm.json, made from OpenStreetMap by
// tools/town_osm.js) or a surveyed racing line (cfg.line, longitudes and latitudes, or metres for a circuit drawn by hand). It is rounded, then
// relaxed just enough for a 15 m road with a barrier on each side. Heights come from
// tools/<circuit>_heights.json when the circuit has one (tools/heights.js), else the road is level.
//
// The road builder is the one of tools/make_monaco.js (this file started as a copy of it).
//
//   node tools/make_circuit.js <circuit>
//
// Then, in the game: the track file, its id and thumbnail (tracks/index.js), and the parts' checksums
// (tracks/<circuit>/checksums.json) must be made again, see tools/circuit_track.js.
const fs = require('fs');
const path = require('path');

const KEY = process.argv[2], cfg = require('./circuits')[KEY];
if (!cfg) { console.error('Usage: node tools/make_circuit.js <circuit>   (' + Object.keys(require('./circuits')).join(', ') + ')'); process.exit(1); }
const NAME = cfg.mesh;       // prefix of the model's meshes: <NAME>Road, <NAME>Start...
const OUT = path.join(__dirname, '..', 'tracks', KEY);
fs.mkdirSync(OUT, { recursive: true });

const ROAD_HALF = cfg.roadHalf || 7.5;   // half width of the asphalt
const KERB = 0.8;             // kerb width
const WALL = 0.6, WALL_H = 1.3;
const SPACING = 3;            // metres between two cross-sections of the ribbon
const WIDEN = 4;              // in the tight corners the road is up to this much wider, on the outside (the hairpin is 19 m wide)
const GAP = 3.2;              // room between the outer faces of the barriers of two stretches that run side by side
const MIN_RADIUS = cfg.minRadius || 18;   // tightest corner allowed at the centreline
const MAX_GRADE = cfg.maxGrade || 0.09;   // steepest slope of the road
const HEIGHT_SCALE = cfg.heightScale || 1;
const START_GPS = 0;          // the start line: the first point of the lap
const IDS = cfg.ids;
// The asphalt between two cross-sections is cut into LANES across and STEPS along (see the road ribbon below).
// Every triangle costs loading time in the game: a level road needs none of them, a hilly one fewer than Monaco's 8 x 3.
const [LANES, STEPS] = cfg.facets || [8, 3];
const GRID = 5;               // track parts sit on a 5 m grid, heights too
const LEVEL = 1;              // grid height of the start line: 5 m above the game's plain

const osmFile = path.join(__dirname, KEY + '_osm.json');
const town = fs.existsSync(osmFile) ? JSON.parse(fs.readFileSync(osmFile, 'utf8')) : { buildings: [], streets: [], water: [], rails: [], parks: [], woods: [], landmarks: {}, lap: [] };
const ORIGIN = cfg.origin;
// the lap as longitudes and latitudes, starting at the start line: a surveyed line (turned so that it starts
// nearest to cfg.startLonLat, and reversed if cfg.reverse) or the lap found on the streets
const rawLap = (() => {
  if (!cfg.line) return town.lap;
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, cfg.line), 'utf8'));
  // a line drawn in metres (x east, z south of the origin) is turned into longitudes and latitudes round the origin
  const M_DEG = Math.PI / 180 * 6371000;
  let pts = file.metres ? file.metres.map(([x, z]) => [ORIGIN[0] + x / (M_DEG * Math.cos(ORIGIN[1] * Math.PI / 180)), ORIGIN[1] - z / M_DEG]) : file.lonLat.slice();
  const d = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos(b[1] * Math.PI / 180), a[1] - b[1]);
  if (d(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  if (cfg.reverse) pts.reverse();
  let first = 0; pts.forEach((p, i) => { if (d(p, cfg.startLonLat) < d(pts[first], cfg.startLonLat)) first = i; });
  return pts.slice(first).concat(pts.slice(0, first));
})();
// The streets' line has a point at every crossing and bend, at any distance: one every 15 m first, so that
// positions along the lap (below, as indices of that line) mean distances
const lonLat = (() => {
  const out = [];
  rawLap.forEach((a, i) => { const b = rawLap[(i + 1) % rawLap.length]; const d = Math.hypot((b[0] - a[0]) * (cfg.lonMetres || 111200 * Math.cos(ORIGIN[1] * Math.PI / 180)), (b[1] - a[1]) * 111200), n = Math.max(1, Math.round(d / 15)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); });
  return out;
})();
// Height of the road at each of these points, above the lowest one (tools/heights.js); level without the file
const heightsFile = path.join(__dirname, KEY + '_heights.json');
const surveyed = fs.existsSync(heightsFile) ? JSON.parse(fs.readFileSync(heightsFile, 'utf8')) : null;
if (surveyed && surveyed.lap.length !== lonLat.length) throw new Error(KEY + '_heights.json was made for another line: run tools/heights.js again');
// Gravel traps of a line drawn by hand: [from, to, side (-1 left, 1 right), width], as indices of its points
const lineFile = cfg.line ? JSON.parse(fs.readFileSync(path.join(__dirname, cfg.line), 'utf8')) : {};
const RUNOFFS = lineFile.runoffs || [];
// A line drawn by hand may come with everything else (Forest Speedway, tools/forest_design.js): its heights, grass
// between the kerbs and the barriers (`verge`, metres, and `verges`: ranges where it differs), a bridge where the
// lap crosses itself, a pit lane, and the land all round, which is part of the circuit's road part and so solid.
const DESIGN = lineFile.verge != null;
if (lineFile.heights && lineFile.heights.length !== lonLat.length) throw new Error(cfg.line + ': one height per point of the line is needed');
const PROFILE = lineFile.heights ? [...lineFile.heights.map((h, i) => [i, h]), [lonLat.length, lineFile.heights[0]]]
  : surveyed ? [...surveyed.lap.map((h, i) => [i, h]), [lonLat.length, surveyed.lap[0]]] : [[0, 0], [lonLat.length, 0]];
if (process.argv[3] === '--points') { fs.writeFileSync(path.join(__dirname, KEY + '_points.json'), JSON.stringify({ origin: ORIGIN, lap: lonLat })); console.log(lonLat.length + ' points written for tools/heights.js'); process.exit(0); }
// Where the checkpoints may go (ranges of that line), in lap order: one on each side of the ring
const GATE_RANGES = (cfg.gates || [[0.14, 0.30], [0.36, 0.52], [0.56, 0.72], [0.78, 0.92]]).map(r => r.map(f => f * lonLat.length));

// ------------------------------------------------------------------ the GPS line, in metres
const gps = lonLat;
const N_GPS = gps.length;
const toMetres = ([lon, lat]) => [(lon - ORIGIN[0]) * Math.PI / 180 * 6371000 * Math.cos(ORIGIN[1] * Math.PI / 180), -(lat - ORIGIN[1]) * Math.PI / 180 * 6371000];
// [x, z, u]: u is the position along the GPS line, counted from the start line (so it only wraps there)
let line = gps.map((p, i) => [...toMetres(p), ((i - START_GPS) % N_GPS + N_GPS) % N_GPS]);
line = line.slice(START_GPS).concat(line.slice(0, START_GPS));
const gpsIndex = u => (u + START_GPS) % N_GPS;

const lengthOf = pts => pts.reduce((s, q, i) => s + Math.hypot(q[0] - pts[(i + 1) % pts.length][0], q[1] - pts[(i + 1) % pts.length][1]), 0);
function resample(pts, spacing) {
  const total = lengthOf(pts), count = Math.round(total / spacing), step = total / count, out = [];
  let i = 0, acc = 0, a = pts[0], b = pts[1 % pts.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k < count; k++) {
    const want = k * step;
    while (acc + seg < want) { acc += seg; i++; a = pts[i % pts.length]; b = pts[(i + 1) % pts.length]; seg = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const t = seg > 0 ? (want - acc) / seg : 0;
    out.push(a.map((v, c) => v + (b[c] - v) * t));
  }
  return out;
}
// the last point's u is near N_GPS, the first one's is 0: neighbours across the start line are averaged with care
const near = (u, ref) => (u - ref > N_GPS / 2 ? u - N_GPS : ref - u > N_GPS / 2 ? u + N_GPS : u);
const average = (pts, weights) => {
  const ref = pts[weights.length >> 1][2];
  let x = 0, z = 0, u = 0, w = 0;
  pts.forEach((p, k) => { x += p[0] * weights[k]; z += p[1] * weights[k]; u += near(p[2], ref) * weights[k]; w += weights[k]; });
  return [x / w, z / w, ((u / w) % N_GPS + N_GPS) % N_GPS];
};
const smooth = (pts, passes) => { for (let n = 0; n < passes; n++) pts = pts.map((q, i) => average([pts[(i - 1 + pts.length) % pts.length], q, pts[(i + 1) % pts.length]], [1, 2, 1])); return pts; };
function chaikin(pts) {
  const out = [];
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; out.push(average([a, b], [3, 1]), average([a, b], [1, 3])); });
  return out;
}
// The points are 15 m apart: their corners are rounded first, then the line is resampled finely
for (let k = 0; k < 3; k++) line = chaikin(line);
line = smooth(resample(line, SPACING), cfg.smoothing == null ? 80 : cfg.smoothing);   // street corners are right angles: opened up into bends that can be raced

// ------------------------------------------------------------------ room for the road
// The line is relaxed until the barriers of any two stretches are GAP apart and every corner is at least
// MIN_RADIUS wide; both rules are applied together.
const alongRoad = (i, j, n) => Math.min(Math.abs(j - i), n - Math.abs(j - i)) * SPACING;
const radiusAt = (pts, i, k = 3) => {                                    // circle through a point and its neighbours 9 m away
  const a = pts[(i - k + pts.length) % pts.length], b = pts[i], c = pts[(i + k) % pts.length];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  return area < 1e-9 ? Infinity : ab * bc * ca / (4 * area);
};
// A corner tighter than MIN_RADIUS is inflated around its centre: every point of it closer to the centre than
// the wanted radius is pushed out to it, with a smooth blend into the road on either side. (Pulling the
// apex towards the chord instead, as a smoothing would, shrinks a hairpin until it disappears.)
function circleAt(pts, i, k) {
  const n = pts.length, a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const s = p => p[0] * p[0] + p[1] * p[1];
  return [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
}
function widen(pts, pinned) {
  const n = pts.length, radius = pts.map((_, i) => radiusAt(pts, i));
  let worst = -1;
  for (let i = 0; i < n; i++) if (radius[i] < MIN_RADIUS + 0.3 && (worst < 0 || radius[i] < radius[worst])) worst = i;
  if (worst < 0) return 0;
  let from = worst, to = worst;                                          // the whole corner
  while (to - from < 40 && radius[(from - 1 + n) % n] < MIN_RADIUS + 4) from--;
  while (to - from < 80 && radius[(to + 1) % n] < MIN_RADIUS + 4) to++;
  const mid = Math.round((from + to) / 2), reach = Math.max(3, Math.round((to - from) / 2));
  const centre = circleAt(pts, (mid + n) % n, reach);
  if (centre == null) return 0;
  const R = MIN_RADIUS + 1.5, blend = 10;
  for (let j = from - blend; j <= to + blend; j++) {
    const k = (j + n) % n, p = pts[k], dx = p[0] - centre[0], dz = p[1] - centre[1], d = Math.hypot(dx, dz) || 1;
    if (d >= R) continue;
    const w = (j < from ? 0.5 - 0.5 * Math.cos((j - from + blend) / blend * Math.PI) : j > to ? 0.5 - 0.5 * Math.cos((to + blend - j) / blend * Math.PI) : 1) * pinned(k);
    pts[k] = [p[0] + dx / d * (R - d) * w * 0.5, p[1] + dz / d * (R - d) * w * 0.5, p[2]];
  }
  for (let pass = 0; pass < 2; pass++) for (let j = from - blend; j <= to + blend; j++) {   // iron out the seams
    const k = (j + n) % n, a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n], w = 0.25 * pinned(k);
    pts[k] = [pts[k][0] * (1 - w) + (a[0] + b[0]) * w / 2, pts[k][1] * (1 - w) + (a[1] + b[1]) * w / 2, pts[k][2]];
  }
  return 1;
}
// Width of the asphalt on each side of the centreline at every cross-section, [left, right]: in the tight
// corners the outside edge moves out, so the hairpin and the slow corners leave room to turn. The inside of a
// corner never moves (its barrier would fold over itself).
const ease = t => t * t * (3 - 2 * t);
function halfWidths(pts) {
  const n = pts.length, r = pts.map((_, i) => radiusAt(pts, i, 4));
  const tangent = i => { const a = pts[(i - 2 + n) % n], b = pts[(i + 2) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  let w = pts.map((_, i) => {
    let m = Infinity; for (let o = -6; o <= 6; o++) m = Math.min(m, r[(i + o + n) % n]);
    const extra = WIDEN * (1 - ease(Math.min(1, Math.max(0, (m - 18) / 30))));
    const a = tangent((i - 5 + n) % n), b = tangent((i + 5) % n), right = a[0] * b[1] - a[1] * b[0] > 0;   // turning right: the outside is on the left
    return right ? [ROAD_HALF + extra, ROAD_HALF] : [ROAD_HALF, ROAD_HALF + extra];
  });
  for (let pass = 0; pass < 3; pass++) w = w.map((v, i) => [0, 1].map(k => (w[(i - 2 + n) % n][k] + w[(i - 1 + n) % n][k] + v[k] + w[(i + 1) % n][k] + w[(i + 2) % n][k]) / 5));
  return w;
}
const OUTSIDE = KERB + WALL;                                             // from the edge of the asphalt to the back of the barrier
// ranges of the line's points (u), which may run over the start line
const inU = (u, from, to) => (from <= to ? u >= from && u <= to : u >= from || u <= to);
const sinceU = (u, from) => ((u - from) % N_GPS + N_GPS) % N_GPS;
const fadeU = (u, from, to) => ease(Math.min(1, sinceU(u, from) / 6)) * ease(Math.min(1, sinceU(to, u) / 6));   // in and out over 6 points
// width of the gravel trap beyond the kerb at a point of the line, [left, right]
const sandAt = u => {
  const out = [0, 0];
  for (const [from, to, side, width] of RUNOFFS) if (inU(u, from, to)) out[side < 0 ? 0 : 1] = Math.max(out[side < 0 ? 0 : 1], width * fadeU(u, from, to));
  return out;
};
// Room between the kerb and the barrier, [left, right]: the grass verge, wider where there is a gravel trap (the
// gravel, then 3 m of grass), narrower on the inside of the tight corners, where the barrier would fold over itself
const VERGE = lineFile.verge || 0;
const MOST_RUNOFF = Math.max(VERGE, ...RUNOFFS.map(r => r[3] + 3), ...(lineFile.verges || []).map(v => v[3]));
function runoffs(pts, widths) {
  if (!DESIGN) return pts.map(q => sandAt(gpsIndex(q[2])));
  const n = pts.length, r = pts.map((_, i) => radiusAt(pts, i, 4));
  const tangent = i => { const a = pts[(i - 2 + n) % n], b = pts[(i + 2) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  let out = pts.map((q, i) => {
    const u = gpsIndex(q[2]), v = [VERGE, VERGE], sand = sandAt(u);
    for (const [from, to, side, width] of lineFile.verges || []) if (inU(u, from, to)) { const f = fadeU(u, from, to); for (const s of side ? [side < 0 ? 0 : 1] : [0, 1]) v[s] += (width - v[s]) * f; }
    for (const s of [0, 1]) if (sand[s] > 0) v[s] = Math.max(v[s], sand[s] + 3 * Math.min(1, sand[s] / 3));
    let m = Infinity; for (let o = -6; o <= 6; o++) m = Math.min(m, r[(i + o + n) % n]);
    const a = tangent((i - 5 + n) % n), b = tangent((i + 5) % n), inside = a[0] * b[1] - a[1] * b[0] > 0 ? 1 : 0;   // turning right: the inside is on the right
    v[inside] = Math.min(v[inside], Math.max(0.5, 0.7 * m - widths[i][inside] - OUTSIDE));
    return v;
  });
  for (let pass = 0; pass < 3; pass++) out = out.map((v, i) => [0, 1].map(k => Math.min(v[k], (out[(i - 2 + n) % n][k] + out[(i - 1 + n) % n][k] + v[k] + out[(i + 1) % n][k] + out[(i + 2) % n][k]) / 5)));
  return out;
}
// The two roads at the crossing of a figure of eight pass over each other: they never need room from each other
const BRIDGE = lineFile.bridge;
const crossing = (u, v) => BRIDGE != null && ((inU(u, ...BRIDGE.zone.high) && inU(v, ...BRIDGE.zone.low)) || (inU(v, ...BRIDGE.zone.high) && inU(u, ...BRIDGE.zone.low)));
const REACH = DESIGN ? 2 * (ROAD_HALF + WIDEN + OUTSIDE + MOST_RUNOFF) + GAP : 40;   // stretches further apart than this are not looked at
function relax(pts, pinned = () => 1) {
  for (let pass = 0; pass < 3000; pass++) {
    const n = pts.length, move = pts.map(() => [0, 0]), widths = halfWidths(pts), room = runoffs(pts, widths);
    const wall = (i, j) => {                                             // back of the barrier of i, on the side that faces j
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], c = pts[j];
      const side = (b[0] - a[0]) * (c[1] - pts[i][1]) - (b[1] - a[1]) * (c[0] - pts[i][0]);   // > 0: j is on the right
      return widths[i][side > 0 ? 1 : 0] + OUTSIDE + (DESIGN ? room[i][side > 0 ? 1 : 0] : 0);
    };
    let busy = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (alongRoad(i, j, n) < 80) continue;
      const dx = pts[j][0] - pts[i][0], dz = pts[j][1] - pts[i][1];
      if (Math.abs(dx) > REACH || Math.abs(dz) > REACH || crossing(pts[i][2], pts[j][2])) continue;
      const need = wall(i, j) + wall(j, i) + GAP;
      const dist = Math.hypot(dx, dz);
      if (dist >= need + 0.5 || dist === 0) continue;
      const push = (need + 0.5 - dist) * 0.2;
      move[i][0] -= dx / dist * push; move[i][1] -= dz / dist * push; move[j][0] += dx / dist * push; move[j][1] += dz / dist * push;
      busy++;
    }
    if (busy > 0) {
      // spread the displacement to the neighbours so the line stays smooth
      let spread = move;
      for (let k = 0; k < 6; k++) spread = spread.map((m, i) => { const p = spread[(i - 1 + n) % n], q = spread[(i + 1) % n]; return [(p[0] + 2 * m[0] + q[0]) / 4, (p[1] + 2 * m[1] + q[1]) / 4]; });
      spread = spread.map((m, i) => [m[0] * 3, m[1] * 3]);
      pts = pts.map((q, i) => { const l = Math.hypot(spread[i][0], spread[i][1]), k = (l > 1 ? 1 / l : 1) * pinned(i); return [q[0] + spread[i][0] * k, q[1] + spread[i][1] * k, q[2]]; }); // at most 1 m per pass
    }
    busy += widen(pts, pinned);
    if (busy === 0) return { pts, passes: pass };
    if (pass % 25 === 24) pts = resample(pts, SPACING);
  }
  throw new Error('The road could not be given enough room');
}
let relaxed = relax(line);
line = resample(relaxed.pts, SPACING);
console.log(`Relaxed in ${relaxed.passes} passes`);

// ------------------------------------------------------------------ into the game's frame: the start line at the origin, the road leaving it towards -z
const tangentAt = (pts, i, reach = 4) => { const a = pts[(i - reach + pts.length) % pts.length], b = pts[(i + reach) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
let startIndex = 0;
line.forEach((q, i) => { if (Math.abs(near(q[2], 0)) < Math.abs(near(line[startIndex][2], 0))) startIndex = i; });
line = line.slice(startIndex).concat(line.slice(0, startIndex));
const t0 = tangentAt(line, 0, 8);
const angle = Math.atan2(-1, 0) - Math.atan2(t0[1], t0[0]);              // turns t0 into (0, -1)
const cosA = Math.cos(angle), sinA = Math.sin(angle), origin = line[0].slice(0, 2);
const toGame = (x, z) => { const dx = x - origin[0], dz = z - origin[1]; return [dx * cosA - dz * sinA, dx * sinA + dz * cosA]; };
line = line.map(q => [...toGame(q[0], q[1]), q[2]]);
console.log(`Real north is ${(angle * 180 / Math.PI).toFixed(1)} degrees from the game's -z`);

// ------------------------------------------------------------------ gates
// Gates are separate parts, placed on the 5 m grid and turned by quarter turns only: they go where the road
// runs close to a grid axis, away from any other stretch of road. The road is then moved by a few metres so
// that it runs exactly through them.
const uAt = i => line[i][2];
const gpsDistance = (u, g) => Math.abs(near(gpsIndex(u), g) - g);
const indexOfGps = g => { let best = 0; line.forEach((q, i) => { if (gpsDistance(q[2], g) < gpsDistance(line[best][2], g)) best = i; }); return best; };
const inRange = (u, [a, b]) => { const g = gpsIndex(u); return a <= b ? g >= a && g <= b : g >= a || g <= b; };
function gateSpot(index) {
  const q = line[index], t = tangentAt(line, index, 4);
  let clear = Infinity;
  for (let j = 0; j < line.length; j++) if (alongRoad(j, index, line.length) > 60 && !crossing(line[j][2], q[2])) clear = Math.min(clear, Math.hypot(line[j][0] - q[0], line[j][1] - q[1]));
  // straight for 15 m either side?
  const t1 = tangentAt(line, (index + 5) % line.length, 2), t2 = tangentAt(line, (index - 5 + line.length) % line.length, 2);
  const axis = Math.abs(t[1]) > Math.abs(t[0]) ? 0 : 1;
  const straightness = Math.min(...[t, t1, t2].map(v => Math.abs(v[axis === 0 ? 1 : 0])));
  return { index, gx: Math.round(q[0] / GRID), gz: Math.round(q[1] / GRID), rotation: axis, straightness, clear };
}
const ranges = GATE_RANGES.map(r => [r[0] % N_GPS, r[1] % N_GPS]);
const checkpoints = ranges.map(range => {
  let best = null;
  for (let i = 0; i < line.length; i++) {
    if (!inRange(uAt(i), range)) continue;
    const spot = gateSpot(i);
    if (spot.clear < (DESIGN ? 42 : 36)) continue;
    if (DESIGN) { let sand = false; for (let o = -8; o <= 8 && !sand; o++) { const v = sandAt(gpsIndex(uAt((i + o + line.length) % line.length))); sand = v[0] > 0 || v[1] > 0; } if (sand) continue; }   // the gate's posts stand behind the barriers
    spot.slope = Math.abs(profileAt(gpsIndex(uAt((i + 3) % line.length))) - profileAt(gpsIndex(uAt((i - 3 + line.length) % line.length)))) * HEIGHT_SCALE / (6 * SPACING);
    spot.score = Math.min(spot.straightness, 0.95) - spot.slope * 2;      // square enough to the grid, then as level as possible
    if (best == null || spot.score > best.score) best = spot;
  }
  if (best == null) throw new Error('No room for a checkpoint between GPS points ' + range);
  return best;
});
// 20 m behind the start line (its own cell on the mini-map); on a circuit drawn by hand, 20 m past it, its grid being
// painted behind the start line (the first time the cars cross it, they have not been round yet)
const finishIndex = DESIGN ? Math.round(20 / SPACING) : line.length - Math.round(20 / SPACING);
const finish = { index: finishIndex, gx: 0, gz: DESIGN ? -4 : 4, rotation: 0 };
// move the road onto the gates: a smooth bump of the line around each one
for (const g of [...checkpoints, finish]) {
  const q = line[g.index], dx = g.gx * GRID - q[0], dz = g.gz * GRID - q[1];
  line = line.map((p, i) => { const s = alongRoad(i, g.index, line.length), w = s > 60 ? 0 : 0.5 + 0.5 * Math.cos(s / 60 * Math.PI); return [p[0] + dx * w, p[1] + dz * w, p[2]]; });
}
// and keep the room it needs, without moving the road at the gates and the start
const gateIndices = [0, ...checkpoints.map(c => c.index), finish.index];
relaxed = relax(line, i => { const s = Math.min(...gateIndices.map(g => alongRoad(i, g, line.length))); return s < 25 ? 0 : Math.min(1, (s - 25) / 30); });
line = relaxed.pts;
for (const g of [...checkpoints, finish]) {                               // indices may have moved with a resample
  let best = 0;
  line.forEach((q, i) => { if (Math.hypot(q[0] - g.gx * GRID, q[1] - g.gz * GRID) < Math.hypot(line[best][0] - g.gx * GRID, line[best][1] - g.gz * GRID)) best = i; });
  g.index = best;
}
const lapLength = lengthOf(line);
console.log(`Lap length ${lapLength.toFixed(0)} m, ${line.length} cross-sections`);

// ------------------------------------------------------------------ heights
function profileAt(g) {                                                  // PROFILE covers one lap from its first key
  const gg = g < PROFILE[0][0] ? g + N_GPS : g;
  for (let k = 0; k + 1 < PROFILE.length; k++) {
    const [a, ha] = PROFILE[k], [b, hb] = PROFILE[k + 1];
    if (gg >= a && gg <= b) return ha + (hb - ha) * (gg - a) / (b - a);
  }
  return 0;
}
let height = line.map(q => profileAt(gpsIndex(q[2])) * HEIGHT_SCALE);
for (let pass = 0; pass < (cfg.heightPasses ?? 5); pass++) {           // long vertical curves: a moving average over 54 m
  const R = 9;
  height = height.map((_, i) => { let s = 0; for (let o = -R; o <= R; o++) s += height[(i + o + height.length) % height.length]; return s / (2 * R + 1); });
}
// every gate stands at a height of the 5 m grid, on a level stretch: the road is raised or lowered by a few
// metres around it, then levelled out over 20 m (gates go where the road hardly climbs)
for (const g of [...checkpoints, finish, { index: 0 }]) {
  const target = Math.round(height[g.index] / GRID) * GRID, shift = target - height[g.index];
  g.y = LEVEL + target / GRID;
  height = height.map((h, i) => { const s = alongRoad(i, g.index, line.length); return s >= 120 ? h : h + shift * (0.5 + 0.5 * Math.cos(s / 120 * Math.PI)); });
  const before = height.slice();
  height = height.map((h, i) => { const s = alongRoad(i, g.index, line.length); return s <= 10 ? target : s >= 60 ? h : target + (before[i] - target) * ease((s - 10) / 50); });
}
// The tight corners run almost level and the climb or the descent is taken on the stretches around them:
// on a slope, the inside of a hairpin is several times steeper than its outside, and the twisted road
// surface shakes the car and robs it of grip. This comes after the gates: their level stretches stay as they are.
{
  const n = line.length, r = line.map((_, i) => radiusAt(line, i, 4));
  const level = r.map((_, i) => { let m = Infinity; for (let o = -6; o <= 6; o++) m = Math.min(m, r[(i + o + n) % n]); return 0.04 + 0.96 * ease(Math.min(1, Math.max(0, (m - 16) / 55))); });
  const smoothArray = (a, R, passes) => { for (let p = 0; p < passes; p++) a = a.map((_, i) => { let t = 0; for (let o = -R; o <= R; o++) t += a[(i + o + n) % n]; return t / (2 * R + 1); }); return a; };
  const weight = smoothArray(level, 3, 2);
  // every run of climb (or of descent) keeps its exact height difference: only how it is spread changes
  const grade = height.map((h, i) => height[(i + 1) % n] - h), sign = g => (Math.abs(g) < 1e-4 ? 0 : Math.sign(g));
  const moved = grade.slice();
  let first = grade.findIndex(g => sign(g) === 0);
  if (first < 0) first = 0;
  for (let k = 0; k < n;) {
    const i0 = (first + k) % n, sg = sign(grade[i0]);
    let len = 1;
    while (k + len < n && sign(grade[(i0 + len) % n]) === sg) len++;
    if (sg !== 0) {
      let all = 0, weighted = 0;
      for (let j = 0; j < len; j++) { const i = (i0 + j) % n; all += grade[i]; weighted += grade[i] * weight[i]; }
      for (let j = 0; j < len; j++) { const i = (i0 + j) % n; moved[i] = grade[i] * weight[i] * all / weighted; }
      // no stretch steeper than MAX_GRADE: what is over goes to the gentler parts of the same run
      const cap = MAX_GRADE * SPACING;
      for (let pass = 0; pass < 30; pass++) {
        let excess = 0, room = 0;
        for (let j = 0; j < len; j++) { const i = (i0 + j) % n, g = Math.abs(moved[i]); if (g > cap) { excess += g - cap; moved[i] = sg * cap; } else room += (cap - g) * weight[i]; }
        if (excess < 1e-6 || room < 1e-9) break;
        for (let j = 0; j < len; j++) { const i = (i0 + j) % n, g = Math.abs(moved[i]); if (g < cap) moved[i] += sg * excess * (cap - g) * weight[i] / room; }
      }
    }
    k += len;
  }
  const start = height[0];
  height = [start];
  for (let i = 0; i + 1 < n; i++) height.push(height[i] + moved[i]);
}
let steepest = 0;
for (let i = 0; i < line.length; i++) steepest = Math.max(steepest, Math.abs(height[(i + 1) % line.length] - height[i]) / SPACING);
console.log(`Heights ${Math.min(...height).toFixed(1)} to ${Math.max(...height).toFixed(1)} m, steepest ${(steepest * 100).toFixed(1)} %`);

// The parts are placed at the start line's own height: the road's heights are counted from there, and the
// start line stands that many grid steps above the game's plain (a circuit's lowest point is 5 m above it).
const startHeight = height[0], START_LEVEL = LEVEL + Math.round(startHeight / GRID);
height = height.map(h => h - startHeight);

// ------------------------------------------------------------------ mesh helpers
const parts = {};                         // mesh name -> material name -> [positions]
const tri = (mesh, material, a, b, c) => { ((parts[mesh] ??= {})[material] ??= []).push(...a, ...b, ...c); };
// quad whose visible side faces `towards`
function quad(mesh, material, a, b, c, d, towards) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  if (n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] >= 0) { tri(mesh, material, a, b, c); tri(mesh, material, a, c, d); }
  else { tri(mesh, material, a, c, b); tri(mesh, material, a, d, c); }
}
function box(mesh, material, x0, y0, z0, x1, y1, z1) {
  const P = (x, y, z) => [x, y, z];
  quad(mesh, material, P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), [0, 1, 0]);
  quad(mesh, material, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0]);
  quad(mesh, material, P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1), [-1, 0, 0]);
  quad(mesh, material, P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), [1, 0, 0]);
  quad(mesh, material, P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), [0, 0, -1]);
  quad(mesh, material, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1]);
}

// ------------------------------------------------------------------ the road ribbon
// cross-section, from the left wall to the right wall: [offset from the centreline, height]
const E = ROAD_HALF, K = ROAD_HALF + KERB, W = K + WALL;                // on the straights (the gates are sized for these)
const half = halfWidths(line);
// room beyond the kerb, [left, right], at each cross-section: the gravel trap (it fades in and out over 30 m)
// and, on a circuit drawn by hand, the grass after it
const room = runoffs(line, half);
const sand = line.map((q, i) => { const s = sandAt(gpsIndex(q[2])); return [Math.min(s[0], room[i][0]), Math.min(s[1], room[i][1])]; });
// the stretch of the upper road that is a bridge (its barriers stop at the deck), and the pit lane: where it runs
// beside the road, from 0 at the ends of its tapers to 1 along the pits (null: no pit lane there)
const DECK = 1.2;                                                        // thickness of the bridge's deck
const onBridge = line.map(q => BRIDGE != null && inU(gpsIndex(q[2]), ...BRIDGE.high));
// the stretch that runs through the mountain: walls up to a roof ROOF metres over the road, a portal at each end
const ROOF = 7.5, onTunnel = line.map(q => lineFile.tunnel != null && inU(gpsIndex(q[2]), ...lineFile.tunnel));
const PIT = lineFile.pit;
const pitAt = line.map(q => {
  if (!PIT) return null;
  const u = gpsIndex(q[2]), from = (PIT.from - PIT.taper + N_GPS) % N_GPS, to = (PIT.to + PIT.taper) % N_GPS;
  return inU(u, from, to) ? Math.min(1, sinceU(u, from) / PIT.taper, sinceU(to, u) / PIT.taper) : null;
});
const section = line.map((q, i) => {
  const t = tangentAt(line, i, 1), nx = -t[1], nz = t[0];                // unit vector across the road
  const at = (u, y) => [q[0] + nx * u, y + height[i], q[1] + nz * u];
  const side = s => half[i][s < 0 ? 0 : 1];                                // asphalt width on the left (s < 0) or right side
  const gravel = s => sand[i][s < 0 ? 0 : 1], runoff = s => room[i][s < 0 ? 0 : 1];
  // e: edge of the asphalt, k: of the kerb, sd: of the gravel, g: of the run-off (the face of the barrier), w: back of the barrier
  return { t, n: [nx, 0, nz], at, e: s => side(s), k: s => side(s) + KERB, sd: s => side(s) + KERB + gravel(s), g: s => side(s) + KERB + runoff(s), w: s => side(s) + OUTSIDE + runoff(s) };
});
// The pit lane at a cross-section, [inner edge, outer edge] from the centreline: it opens from the back of the
// road's barrier over the first half of its taper, then its inner edge moves away from the road
if (PIT && line.some((_, i) => pitAt[i] != null && sand[i][PIT.side < 0 ? 0 : 1] > 0)) throw new Error('A gravel trap runs into the pit lane');
const pitLane = (c, p) => {
  const w = c.w(PIT.side);
  return [p < 0.5 ? w : w + (PIT.offset - PIT.half - w) * ease((p - 0.5) * 2), w + (PIT.offset + PIT.half - w) * ease(Math.min(1, p * 2))];
};
// both edges must always move forward along the road, or a barrier would cut across it
let folds = 0, closest = Infinity, tightest = Infinity;
for (let i = 0; i < line.length; i++) {
  const a = section[i], b = section[(i + 1) % line.length];
  for (const s of [-1, 1]) { const p0 = a.at(s * a.w(s), 0), p1 = b.at(s * b.w(s), 0); if ((p1[0] - p0[0]) * a.t[0] + (p1[2] - p0[2]) * a.t[1] <= 0) folds++; }
  for (let j = i + 1; j < line.length; j++) if (alongRoad(i, j, line.length) > 80 && !crossing(line[i][2], line[j][2])) {
    const dx = line[j][0] - line[i][0], dz = line[j][1] - line[i][1], d = Math.hypot(dx, dz);
    if (d > Math.max(60, REACH)) continue;
    const si = Math.sign(dx * a.n[0] + dz * a.n[2]) || 1, sj = -Math.sign(dx * section[j].n[0] + dz * section[j].n[2]) || 1;
    closest = Math.min(closest, d - a.w(si) - section[j].w(sj));
  }
  tightest = Math.min(tightest, radiusAt(line, i));
}
console.log(`Ribbon check: ${folds} folded edge segments, ${closest.toFixed(1)} m between the barriers of the two closest stretches, tightest corner ${tightest.toFixed(1)} m, road ${Math.min(...half.map(h => h[0] + h[1])).toFixed(1)} to ${Math.max(...half.map(h => h[0] + h[1])).toFixed(1)} m wide`);
if (folds > 0 || closest < 1) throw new Error('The road ribbon overlaps itself; raise MIN_RADIUS or GAP');
if (BRIDGE) {                                                            // room under the bridge
  let low = Infinity;
  line.forEach((p, i) => { if (!onBridge[i]) return; line.forEach((q, j) => { if (!onBridge[j] && alongRoad(i, j, line.length) > 80 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 12) low = Math.min(low, height[i] - height[j]); }); });
  console.log(`Bridge: ${(low - DECK).toFixed(1)} m of headroom over the road below`);
  if (!(low - DECK > 5)) throw new Error('The bridge is too low over the road below');
}
// kerbs are painted red and white in the corners only; elsewhere the edge is a white line on grey
const corner = line.map((_, i) => { let r = Infinity; for (let o = -4; o <= 4; o++) r = Math.min(r, radiusAt(line, (i + o + line.length) % line.length, 4)); return r < 110; });
const MESH = NAME + 'Road', HIDDEN = NAME + 'RoadInvisible';           // the road part; what it has that is solid but not drawn (patch_bundle.js)
for (let i = 0; i < line.length; i++) {
  const j = (i + 1) % line.length, a = section[i], b = section[j];
  // a strip between two offsets, each end at its own section's offset (the road is wider in the corners)
  const strip = (material, u0, y0, u1, y1, towards, mesh = MESH) => quad(mesh, material, a.at(u0(a), y0), a.at(u1(a), y1), b.at(u1(b), y1), b.at(u0(b), y0), towards);
  const kerb = corner[i] ? (Math.floor(i / 2) % 2 === 0 ? 'RoadEdgeRed' : 'RoadEdgeWhite') : 'RoadEdgeWhite';
  // the asphalt in 8 lanes and 3 steps along: where the road turns and climbs at once its surface twists,
  // and small facets spread the twist instead of folding it on a few long creases
  for (let k = 0; k < STEPS; k++) for (let m = 0; m < LANES; m++) {
    const P = (c, f) => c.at(-c.e(-1) + f * (c.e(-1) + c.e(1)), 0);
    const along = (f, t) => { const p = P(a, f), q = P(b, f); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };
    quad(MESH, 'Road', along(m / LANES, k / STEPS), along((m + 1) / LANES, k / STEPS), along((m + 1) / LANES, (k + 1) / STEPS), along(m / LANES, (k + 1) / STEPS), [0, 1, 0]);
  }
  const bridge = onBridge[i] && onBridge[j];
  for (const s of [-1, 1]) {
    const out = [a.n[0] * s, 0, a.n[2] * s], inward = [-out[0], 0, -out[2]], k = s < 0 ? 0 : 1;
    const kerbY = corner[i] ? 0.05 : 0.01, gravel = sand[i][k] > 0 || sand[j][k] > 0;
    const grass = DESIGN && (a.g(s) - a.sd(s) > 0.05 || b.g(s) - b.sd(s) > 0.05);
    strip(kerb, c => s * c.e(s), 0, c => s * c.k(s), kerbY, [0, 1, 0]);
    if (gravel) strip('Sand', c => s * c.k(s), kerbY, c => s * c.sd(s), 0, [0, 1, 0]);   // the gravel trap, level with the road
    if (grass) strip('Grass', c => s * c.sd(s), gravel ? 0 : kerbY, c => s * c.g(s), 0, [0, 1, 0]);   // then grass up to the barrier
    if (PIT && s === PIT.side && pitAt[i] != null && pitAt[j] != null && pitAt[i] < 0.5 && pitAt[j] < 0.5) {
      // the mouth of the pit lane: open to the eye, closed by a wall nobody sees (the races and time trials do not use the pits)
      strip('Road', c => s * c.g(s), 0, c => s * c.w(s), 0, [0, 1, 0]);
      strip('Invisible', c => s * c.g(s), -0.5, c => s * c.g(s), WALL_H + 3, inward, HIDDEN);
      continue;
    }
    if (onTunnel[i] && onTunnel[j]) {                                    // the tunnel's wall, its shell outside
      strip('TunnelWall', c => s * c.g(s), gravel || grass ? 0 : kerbY, c => s * c.g(s), ROOF, inward);
      strip('TunnelWall', c => s * c.w(s), ROOF + 1, c => s * c.w(s), -8, out);
      continue;
    }
    const barrier = DESIGN && corner[i] ? 'BarrierYellow' : 'RoadBarrier';
    strip(barrier, c => s * c.g(s), gravel || grass ? 0 : kerbY, c => s * c.g(s), WALL_H, inward);   // the face the cars hit
    strip(barrier, c => s * c.g(s), WALL_H, c => s * c.w(s), WALL_H, [0, 1, 0]);
    strip('RoadBarrier', c => s * c.w(s), WALL_H, c => s * c.w(s), bridge ? -DECK : -8, out);   // down to the ground, wherever the town is lower
  }
  if (bridge) strip('Concrete', c => -c.w(-1), -DECK, c => c.w(1), -DECK, [0, -1, 0]);   // under the deck
  if (onTunnel[i] && onTunnel[j]) {                                      // its roof, a row of lights along it, the shell over it
    strip('TunnelRoof', c => -c.g(-1), ROOF, c => c.g(1), ROOF, [0, -1, 0]);
    if (i % 4 < 2) strip('TunnelLight', () => -0.5, ROOF - 0.05, () => 0.5, ROOF - 0.05, [0, -1, 0]);
    strip('TunnelWall', c => -c.w(-1), ROOF + 1, c => c.w(1), ROOF + 1, [0, 1, 0]);
  }
}
// the portals: a wall of stone across the hillside at each end of the tunnel, with the road's opening in it
for (let i = 0; i < line.length; i++) {
  const j = (i + 1) % line.length;
  if (onTunnel[i] === onTunnel[j]) continue;
  const k = onTunnel[i] ? i : j, c = section[k], f = onTunnel[i] ? 1 : -1, towards = [c.t[0] * f, 0, c.t[1] * f], WIDE = 16, HIGH = ROOF + 9;
  const face = (u0, y0, u1, y1) => quad(MESH, 'Portal', c.at(u0, y0), c.at(u1, y0), c.at(u1, y1), c.at(u0, y1), towards);
  face(-c.g(-1) - WIDE, -3, -c.g(-1), HIGH); face(c.g(1), -3, c.g(1) + WIDE, HIGH); face(-c.g(-1), ROOF, c.g(1), HIGH);
  face(-c.g(-1) - 0.6, ROOF - 0.6, c.g(1) + 0.6, ROOF);                  // the lintel
}
// A box standing on the road's frame: centre (x, z), along t and across n, half sizes, from y0 to y1
function pillar(material, x, z, t, n, along, across, y0, y1) {
  const P = (u, v, y) => [x + t[0] * u + n[0] * v, y, z + t[1] * u + n[2] * v];
  for (const [u0, v0, u1, v1, o] of [[-along, -across, along, -across, [-n[0], 0, -n[2]]], [-along, across, along, across, [n[0], 0, n[2]]], [-along, -across, -along, across, [-t[0], 0, -t[1]]], [along, -across, along, across, [t[0], 0, t[1]]]])
    quad(MESH, material, P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), o);
}
// the bridge's piers: a pair on either side of the road below, just behind its barriers
if (BRIDGE) {
  const low = line.map((q, i) => i).filter(i => inU(gpsIndex(line[i][2]), ...BRIDGE.zone.low) && !onBridge[i]);
  const lowReach = Math.max(...low.map(i => Math.max(section[i].w(-1), section[i].w(1)))), bottom = Math.min(...low.map(i => height[i])) - 3;
  const fromLow = i => Math.min(...low.map(k => Math.hypot(line[k][0] - line[i][0], line[k][1] - line[i][1])));
  let before = null;
  for (let i = 0; i < line.length; i++) {
    if (!onBridge[i]) { before = null; continue; }
    const d = fromLow(i) - lowReach - 3;
    if (before != null && before * d <= 0) for (const s of [-1, 1]) {
      const c = section[i], p = c.at(s * (c.e(s) - 2.5), 0);
      pillar('Concrete', p[0], p[2], c.t, c.n, 1.1, 1.1, bottom, height[i] - DECK);
    }
    before = d;
  }
}
// the pit lane, beside the main straight: its asphalt, white lines along it, a wall on its outer side and,
// once it leaves the road, on its inner side
if (PIT) for (let i = 0; i < line.length; i++) {
  const j = (i + 1) % line.length, pa = pitAt[i], pb = pitAt[j];
  if (pa == null || pb == null) continue;
  const a = section[i], b = section[j], s = PIT.side, out = [a.n[0] * s, 0, a.n[2] * s], inward = [-out[0], 0, -out[2]];
  const [ia, oa] = pitLane(a, pa), [ib, ob] = pitLane(b, pb);
  const lane = (material, u0a, u1a, y0, u0b, u1b, y1, towards) => quad(MESH, material, a.at(s * u0a, y0), a.at(s * u1a, y1), b.at(s * u1b, y1), b.at(s * u0b, y0), towards);
  lane('Road', ia, oa, 0, ib, ob, 0, [0, 1, 0]);
  if (oa - ia > 1 && ob - ib > 1) lane('RoadEdgeWhite', oa - 0.4, oa, 0.01, ob - 0.4, ob, 0.01, [0, 1, 0]);
  lane('RoadBarrier', oa, oa, 0, ob, ob, WALL_H, inward);
  lane('RoadBarrier', oa, oa + WALL, WALL_H, ob, ob + WALL, WALL_H, [0, 1, 0]);
  lane('RoadBarrier', oa + WALL, oa + WALL, WALL_H, ob + WALL, ob + WALL, -8, out);
  if (pa > 0.5 || pb > 0.5) {
    lane('RoadEdgeWhite', ia, ia + 0.4, 0.01, ib, ib + 0.4, 0.01, [0, 1, 0]);
    lane('RoadBarrier', ia, ia, 0, ib, ib, WALL_H, out);
    lane('RoadBarrier', ia - WALL, ia, WALL_H, ib - WALL, ib, WALL_H, [0, 1, 0]);
    lane('RoadBarrier', ia - WALL, ia - WALL, WALL_H, ib - WALL, ib - WALL, -8, inward);
  }
}

// ------------------------------------------------------------------ start line, checkpoint and finish gates (road along z)
// The lines painted across the road are drawn by apex-town.js, which follows the road exactly. The parts keep
// their own copy under the asphalt, out of reach of the wheels: a line standing even 3 cm proud of a sloping
// road made the cars bounce on it.
const LINE_Y = -0.4;
const lineAcross = (mesh, material, depth) => quad(mesh, material, [-E, LINE_Y, -depth / 2], [E, LINE_Y, -depth / 2], [E, LINE_Y, depth / 2], [-E, LINE_Y, depth / 2], [0, 1, 0]);
function gate(mesh, banner) {
  const post = W + VERGE + 1.2;                                          // behind the barriers
  for (const s of [-1, 1]) box(mesh, 'RoadBarrier', s * post - 0.3, 0, -0.3, s * post + 0.3, 6.4, 0.3);
  box(mesh, banner, -post, 5.4, -0.2, post, 6.4, 0.2);
}
lineAcross(NAME + 'Start', 'StartLine', 0.6);
lineAcross(NAME + 'Checkpoint', 'Checkpoint', 1.0); gate(NAME + 'Checkpoint', 'Checkpoint');
for (let k = 0; k < 10; k++) for (let r = 0; r < 2; r++)                 // chequered line
  quad(NAME + 'Finish', (k + r) % 2 ? 'FinishWhite' : 'FinishBlack', [-E + k * 1.5, LINE_Y, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, LINE_Y, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, LINE_Y, r * 0.9], [-E + k * 1.5, LINE_Y, r * 0.9], [0, 1, 0]);
gate(NAME + 'Finish', 'Finish');

// ------------------------------------------------------------------ the land of a circuit drawn by hand
// The land round the circuit is part of the road part: it is drawn with it and, above all, solid, so that a car
// thrown over a barrier lands on the grass it sees instead of falling through the scenery. A grid of 40 m cells
// over the circuit and far round it, cut into 10 m cells near the road (the coarse cells next to fine ones are
// fanned from their middle, through every point of their edges: no cracks). Its height: the road's own beside
// the road (just under it, where the verges and barriers stand), rising or dropping to the hills further away
// (rock where they are steep), level round the paddock, a lake in the loop. Wherever the land would still come up
// through the road, its run-off, the pit lane or under the bridge's deck, it is dug down. The heights are written
// in the json (`terrain`), for apex-town.js to plant the trees on, and the lake's level with its outline.
let terrain = null, lakeLevel = null;
if (DESIGN) {
  const T = cfg.terrain || {};
  const BIG = 40, FINE = 10, SUB = BIG / FINE, MARGIN = T.margin || 440, NEAR = T.near || 120;
  const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); };
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.30 + noise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
  const smooth = (a, b, v) => ease(Math.min(1, Math.max(0, (v - a) / (b - a))));
  // the road's cross-sections in 30 m boxes, and how far each one reaches on the side of a place: the back of
  // its barrier, or of the pit lane's outer wall
  const BOX = 30, boxes = new Map();
  line.forEach((q, i) => { const k = Math.floor(q[0] / BOX) + ',' + Math.floor(q[1] / BOX); if (!boxes.has(k)) boxes.set(k, []); boxes.get(k).push(i); });
  const around = (x, z, r, f) => { const n = Math.ceil(r / BOX), bi = Math.floor(x / BOX), bj = Math.floor(z / BOX); for (let a = bi - n; a <= bi + n; a++) for (let b = bj - n; b <= bj + n; b++) for (const i of boxes.get(a + ',' + b) || []) f(i); };
  const reachOf = (i, x, z) => {
    const c = section[i], s = (x - line[i][0]) * c.n[0] + (z - line[i][1]) * c.n[2] > 0 ? 1 : -1;
    return PIT && s === PIT.side && pitAt[i] != null ? pitLane(c, pitAt[i])[1] + WALL : c.w(s);
  };
  const MOST = ROAD_HALF + WIDEN + OUTSIDE + Math.max(MOST_RUNOFF, PIT ? PIT.offset + PIT.half : 0) + 2;
  const polygon = list => list.map(p => toGame(p[0], p[1]));
  const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const toEdge = (x, z, P) => { let d = Infinity; P.forEach((a, i) => { const b = P[(i + 1) % P.length], lx = b[0] - a[0], lz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * lx + (z - a[1]) * lz) / (lx * lx + lz * lz || 1))); d = Math.min(d, Math.hypot(a[0] + lx * t - x, a[1] + lz * t - z)); }); return d; };
  const paddock = lineFile.paddock ? polygon([[lineFile.paddock[0], lineFile.paddock[1]], [lineFile.paddock[2], lineFile.paddock[1]], [lineFile.paddock[2], lineFile.paddock[3]], [lineFile.paddock[0], lineFile.paddock[3]]]) : null;
  const lake = town.water.length && town.water[0].area ? polygon(town.water[0].area) : null;

  // the grid: the road's bounds and a wide margin, on 160 m steps (apex-town.js draws the land beyond in 160 m cells)
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const q of line) { bx0 = Math.min(bx0, q[0]); bz0 = Math.min(bz0, q[1]); bx1 = Math.max(bx1, q[0]); bz1 = Math.max(bz1, q[1]); }
  const x0 = Math.floor((bx0 - MARGIN) / 160) * 160, z0 = Math.floor((bz0 - MARGIN) / 160) * 160, x1 = Math.ceil((bx1 + MARGIN) / 160) * 160, z1 = Math.ceil((bz1 + MARGIN) / 160) * 160;
  const cols = (x1 - x0) / BIG, rows = (z1 - z0) / BIG, VC = cols * SUB + 1, VR = rows * SUB + 1;
  const plain = -START_LEVEL * GRID, lowest = Math.min(...height), border = lowest + 2;
  // hills: smooth noise, flattened out towards the edge of the grid
  const hills = (x, z) => {
    const inside = Math.min(x - x0, x1 - x, z - z0, z1 - z), h = (T.hills ?? 52) * (fbm(x * 0.0042 + 1.7, z * 0.0042 + 4.2) - 0.40) + 12 * (noise(x * 0.012 + 3.3, z * 0.012 + 9.1) - 0.5);
    let peak = 0;
    for (const m of lineFile.mountains || []) { const [mx, mz] = toGame(...m.at), d = Math.hypot(x - mx, z - mz); peak = Math.max(peak, (m.height - lineFile.heights[0] - border) * Math.exp(-1.6 * (d / m.radius) ** 2) * (0.85 + 0.3 * noise(x * 0.02 + 5, z * 0.02 + 2))); }
    return border + h * smooth(0, 300, inside) + peak;
  };
  // the land without the lake: the hills, brought down (or up) to the road beside it, flat round the paddock
  const land = (x, z) => {
    let h = hills(x, z), best = -1, d = Infinity;
    around(x, z, 150, i => { if (onBridge[i] || onTunnel[i]) return; const q = (line[i][0] - x) ** 2 + (line[i][1] - z) ** 2; if (q < d) { d = q; best = i; } });
    if (best >= 0) { const road = height[best] - 0.3, r = reachOf(best, x, z); h = road + (h - road) * smooth(r + 2, r + (T.blend ?? 42), Math.sqrt(d)); }
    if (paddock) { const k = inPoly(x, z, paddock) ? 0 : toEdge(x, z, paddock); h = -0.3 + (h + 0.3) * smooth(0, 45, k); }
    return h;
  };
  if (lake) lakeLevel = Math.max(plain + 3, Math.min(...lake.map(p => land(p[0], p[1]))) - 0.6);
  const heightAt = (x, z) => {
    let h = land(x, z);
    if (lake) h = Math.min(h, lakeLevel - 2.2 + (inPoly(x, z, lake) ? 0 : toEdge(x, z, lake) * 0.3));   // its bed, then a gentle bank
    return Math.max(h, plain + 1.5);
  };
  // which 40 m cells are cut finer: those near the road, the pit lane or the paddock
  const fineCell = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x = x0 + (c + 0.5) * BIG, z = z0 + (r + 0.5) * BIG;
    let near = paddock != null && (inPoly(x, z, paddock) || toEdge(x, z, paddock) < BIG);
    around(x, z, NEAR + BIG, i => { if (!near && Math.hypot(line[i][0] - x, line[i][1] - z) < NEAR + 30) near = true; });
    fineCell[c * rows + r] = near ? 1 : 0;
  }
  const isFine = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && fineCell[c * rows + r] === 1;
  // heights of the points of the 10 m lattice that are used, worked out once
  const H = new Float32Array(VC * VR).fill(NaN);
  const vh = (a, b) => { const k = a * VR + b; if (Number.isNaN(H[k])) H[k] = heightAt(x0 + a * FINE, z0 + b * FINE); return H[k]; };
  const fineTris = [];                                                   // [[a, b], [a, b], [a, b]] lattice points
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (isFine(c, r)) for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
    const a = c * SUB + i, b = r * SUB + j;
    fineTris.push([[a, b], [a + 1, b], [a + 1, b + 1]], [[a, b], [a + 1, b + 1], [a, b + 1]]);
  }
  // dig the land down wherever it comes up through the road, its run-off, the pit lane or under the deck
  const bound = (x, z) => {
    let m = Infinity;
    around(x, z, MOST, i => { if (!onTunnel[i] && Math.hypot(line[i][0] - x, line[i][1] - z) <= reachOf(i, x, z) + 0.6) m = Math.min(m, height[i] - (onBridge[i] ? DECK + 0.5 : 0.25)); });
    return m;
  };
  const boundCache = new Map(), bounded = (x, z) => { const k = x + ',' + z; if (!boundCache.has(k)) boundCache.set(k, bound(x, z)); return boundCache.get(k); };
  let dug = 0;
  for (let pass = 0; pass < 25; pass++) {
    let moved = 0;
    for (const t of fineTris) {
      const P = t.map(([a, b]) => [x0 + a * FINE, vh(a, b), z0 + b * FINE]);
      // a point of the triangle above what it may reach: the corners that make it are brought down to that
      for (const w of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]]) {
        const x = P[0][0] * w[0] + P[1][0] * w[1] + P[2][0] * w[2], z = P[0][2] * w[0] + P[1][2] * w[1] + P[2][2] * w[2], y = P[0][1] * w[0] + P[1][1] * w[1] + P[2][1] * w[2];
        const top = bounded(+x.toFixed(2), +z.toFixed(2));
        if (y <= top) continue;
        t.forEach(([a, b], k) => { if (w[k] > 0 && H[a * VR + b] > top - 0.05) H[a * VR + b] = top - 0.05; });
        moved++;
      }
    }
    dug += moved;
    if (moved === 0) break;
  }
  // over the tunnel the land stays above its shell, and what of it would still reach into the tunnel (by its
  // portals, where the land comes down to the road) is left out: the portals' walls stand there
  const inBore = (x, z) => { let y = null; around(x, z, MOST, i => { if (onTunnel[i] && Math.hypot(line[i][0] - x, line[i][1] - z) <= section[i].w(1) + 0.5 && (y == null || height[i] > y)) y = height[i]; }); return y; };
  const clearOf = (x, z) => { let m = Infinity; around(x, z, MOST, i => { if (!onTunnel[i] && Math.hypot(line[i][0] - x, line[i][1] - z) <= reachOf(i, x, z) + 0.6) m = Math.min(m, height[i]); }); return m === Infinity; };
  if (lineFile.tunnel) for (let a = 0; a < VC; a++) for (let b = 0; b < VR; b++) {
    const k = a * VR + b; if (Number.isNaN(H[k])) continue;
    const x = x0 + a * FINE, z = z0 + b * FINE;
    let y = null; around(x, z, MOST + 10, i => { if (onTunnel[i] && Math.hypot(line[i][0] - x, line[i][1] - z) <= section[i].w(1) + 9 && (y == null || height[i] > y)) y = height[i]; });
    if (y != null && clearOf(x, z)) H[k] = Math.max(H[k], y + ROOF + 2.5);
  }
  const holes = new Set();
  if (lineFile.tunnel) fineTris.forEach((t, n) => {
    const P = t.map(([a, b]) => [x0 + a * FINE, vh(a, b), z0 + b * FINE]);
    for (const w of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]]) {
      const x = P[0][0] * w[0] + P[1][0] * w[1] + P[2][0] * w[2], z = P[0][2] * w[0] + P[1][2] * w[1] + P[2][2] * w[2], y = P[0][1] * w[0] + P[1][1] * w[1] + P[2][1] * w[2];
      const road = inBore(x, z);
      if (road != null && y > road - 0.5 && y < road + ROOF + 2) { holes.add(n); return; }
    }
  });
  // what covers each triangle: rock where it is steep, the lake's bed, the paddock, grass near the road, the forest's floor further away
  const nearRoad = (x, z) => { let d = Infinity; around(x, z, 60, i => { d = Math.min(d, Math.hypot(line[i][0] - x, line[i][1] - z) - reachOf(i, x, z)); }); return d; };
  const ground = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3, z = (a[2] + b[2] + c[2]) / 3;
    let material;
    if (Math.abs(ny) / l < 0.8) material = hash2(Math.round(x / 7), Math.round(z / 7)) < 0.5 ? 'Rock' : 'RockDark';
    else if (lake && y < lakeLevel - 0.2) material = 'LakeBed';
    else if (paddock && inPoly(x, z, paddock)) material = 'Paddock';
    else if (nearRoad(x, z) < 28) material = noise(x * 0.05, z * 0.05) < 0.5 ? 'Grass' : 'GrassLight';
    else material = noise(x * 0.03 + 7, z * 0.03 + 1) < 0.45 ? 'ForestFloor' : 'Grass';
    if (ny >= 0) tri(MESH, material, a, b, c); else tri(MESH, material, a, c, b);
  };
  const L = (a, b) => [x0 + a * FINE, vh(a, b), z0 + b * FINE];
  fineTris.forEach((t, n) => { if (!holes.has(n)) ground(...t.map(([a, b]) => L(a, b))); });
  const centres = new Map();
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (isFine(c, r)) continue;
    // the coarse cell's outline, anticlockwise seen from above, with every lattice point its fine neighbours use
    const a0 = c * SUB, b0 = r * SUB, ring = [];
    const edge = (neighbour, from, step, n) => { for (let k = 0; k < SUB; k++) if (k === 0 || neighbour) ring.push([from[0] + step[0] * k, from[1] + step[1] * k]); };
    edge(isFine(c, r - 1), [a0, b0], [1, 0]); edge(isFine(c + 1, r), [a0 + SUB, b0], [0, 1]); edge(isFine(c, r + 1), [a0 + SUB, b0 + SUB], [-1, 0]); edge(isFine(c - 1, r), [a0, b0 + SUB], [0, -1]);
    const mx = x0 + (c + 0.5) * BIG, mz = z0 + (r + 0.5) * BIG, m = [mx, heightAt(mx, mz), mz];
    centres.set(c * rows + r, { m, ring });
    ring.forEach((p, k) => ground(m, L(...p), L(...ring[(k + 1) % ring.length])));
  }
  // the heights of the lattice as drawn, for apex-town.js: the coarse cells' points from their fans
  const out = new Array(VC * VR);
  for (let a = 0; a < VC; a++) for (let b = 0; b < VR; b++) {
    const c = Math.min(cols - 1, Math.floor(a / SUB)), r = Math.min(rows - 1, Math.floor(b / SUB)), k = a * VR + b;
    let h;
    if (!Number.isNaN(H[k]) && (isFine(c, r) || a % SUB === 0 || b % SUB === 0)) h = H[k];
    else {
      const { m, ring } = centres.get(c * rows + r) || {};
      const x = x0 + a * FINE, z = z0 + b * FINE;
      h = m ? m[1] : heightAt(x, z);
      if (m) ring.forEach((p, i) => {                                    // the fan triangle the point is in
        const P = L(...p), Q = L(...ring[(i + 1) % ring.length]);
        const cross = (u, v, w) => (v[0] - u[0]) * (w[2] - u[2]) - (v[2] - u[2]) * (w[0] - u[0]), X = [x, 0, z], all = cross(m, P, Q);
        const wm = cross(X, P, Q) / all, wp = cross(m, X, Q) / all, wq = 1 - wm - wp;
        if (wm >= -1e-6 && wp >= -1e-6 && wq >= -1e-6) h = wm * m[1] + wp * P[1] + wq * Q[1];
      });
    }
    out[k] = +h.toFixed(2);
  }
  terrain = { x0, z0, step: FINE, cols: VC, rows: VR, border: +border.toFixed(2), h: out };
  console.log(`Land: ${cols} x ${rows} cells of 40 m, ${fineTris.length} fine triangles (${dug} dug under the road), heights ${Math.min(...out).toFixed(0)} to ${Math.max(...out).toFixed(0)} m${lake ? `, lake at ${lakeLevel.toFixed(1)} m` : ''}`);
}

// ------------------------------------------------------------------ tiles (20 m cells the road covers): mini-map, thumbnail, bounds
const cells = new Set();
for (const s of section) for (const u of [-s.e(-1), 0, s.e(1)]) { const [x, , z] = s.at(u, 0); cells.add(Math.round(x / 20) + ',' + Math.round(z / 20)); }
const gateCells = new Set([[0, 0], [finish.gx, finish.gz], ...checkpoints.map(c => [c.gx, c.gz])].map(([gx, gz]) => Math.round(gx * GRID / 20) + ',' + Math.round(gz * GRID / 20)));

// ------------------------------------------------------------------ <circuit>.glb
// linear RGB; road, kerb and line colours are the ones of the game's own road parts, the barrier is a lighter steel
const MATERIALS = { Road: [0.2957, 0.2957, 0.2957], RoadEdgeRed: [0.8, 0.0323, 0.0127], RoadEdgeWhite: [0.8, 0.8, 0.8], RoadBarrier: [0.33, 0.35, 0.38], StartLine: [0.8, 0.8, 0.8], Checkpoint: [0.76, 0.52, 0.02], FinishWhite: [0.8, 0.8, 0.8], FinishBlack: [0.01, 0.01, 0.012], Finish: [0.64, 0.02, 0.02], Sand: [0.62, 0.47, 0.25] };
// a circuit drawn by hand: its grass, its land, its yellow barriers in the corners, its bridge (display sRGB, made linear)
if (DESIGN) for (const [name, rgb] of Object.entries({ Grass: [0.38, 0.55, 0.26], GrassLight: [0.45, 0.60, 0.30], ForestFloor: [0.27, 0.40, 0.22], Rock: [0.56, 0.54, 0.50], RockDark: [0.45, 0.43, 0.40],
  LakeBed: [0.26, 0.34, 0.30], Paddock: [0.56, 0.56, 0.55], TunnelWall: [0.66, 0.64, 0.60], TunnelRoof: [0.30, 0.29, 0.28], TunnelLight: [1, 0.92, 0.70], Portal: [0.50, 0.46, 0.40], Concrete: [0.70, 0.69, 0.66], BarrierYellow: [0.93, 0.74, 0.12], Invisible: [1, 0, 1] })) MATERIALS[name] = rgb.map(v => +(v ** 2.2).toFixed(4));
const gltf = { asset: { version: '2.0', generator: 'GoofyTrack make_circuit.js' }, scene: 0, scenes: [{ name: NAME, nodes: [] }], nodes: [], meshes: [], materials: Object.entries(MATERIALS).map(([name, rgb]) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 } })), accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
const chunks = []; let offset = 0;
for (const [name, byMaterial] of Object.entries(parts)) {
  const primitives = [];
  for (const [material, positions] of Object.entries(byMaterial)) {
    const data = Buffer.from(new Float32Array(positions).buffer);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], positions[i]); hi[i % 3] = Math.max(hi[i % 3], positions[i]); }
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target: 34962 });
    gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: lo, max: hi });
    primitives.push({ attributes: { POSITION: gltf.accessors.length - 1 }, material: Object.keys(MATERIALS).indexOf(material), mode: 4 });
    chunks.push(data); offset += data.length;
  }
  gltf.meshes.push({ name, primitives });
  gltf.nodes.push({ name, mesh: gltf.meshes.length - 1 });
  gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
}
gltf.buffers[0].byteLength = offset;
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(chunks), head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + bin.length, 8);
jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(path.join(OUT, KEY + '.glb'), Buffer.concat([head, jh, json, bh, bin]));
const roadTriangles = Object.values(parts[NAME + 'Road']).reduce((s, a) => s + a.length / 9, 0);

// ------------------------------------------------------------------ <circuit>.json
const STEP = 4;                                                           // one waypoint every 12 m
const round1 = v => +v.toFixed(1);
const game = list => list.map(p => toGame(p[0], p[1]).map(round1));
// what stands in the road's way is left out: the lap is wider than the streets it follows
const keepClear = ROAD_HALF + OUTSIDE + 2.5;
const distanceToRoad = (x, z) => { let d = Infinity; for (let i = 0; i < line.length; i += 2) d = Math.min(d, Math.hypot(line[i][0] - x, line[i][1] - z)); return d; };
const edgePoints = p => { const out = []; p.forEach((a, i) => { const b = p[(i + 1) % p.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }); return out; };
let removed = 0;
const buildings = [];
for (const b of town.buildings) {
  const p = game(b.p);
  if (edgePoints(p).some(q => distanceToRoad(q[0], q[1]) < keepClear)) { removed++; continue; }
  buildings.push({ ...b, p });
}
const landmarks = {};
for (const [name, v] of Object.entries(town.landmarks)) landmarks[name] = Array.isArray(v) ? game(v) : { at: toGame(...v.at).map(round1) };
const relief = fs.existsSync(heightsFile) && surveyed.grid ? surveyed.grid : null;
fs.writeFileSync(path.join(OUT, KEY + '.json'), JSON.stringify({
  town: KEY,
  ids: IDS, lapLength: Math.round(lapLength), roadHalfWidth: ROAD_HALF, gateWidth: 2 * (W + VERGE) + 6,
  level: START_LEVEL,                                                     // grid height of the start line (the lowest point of the lap is 5 m above the plain)
  finish: { gx: finish.gx, gy: finish.y, gz: finish.gz, rotation: finish.rotation },
  checkpoints: checkpoints.map(({ gx, y, gz, rotation }) => ({ gx, gy: y, gz, rotation })),
  roadCells: [...cells].filter(c => !gateCells.has(c)).map(c => c.split(',').map(Number)),
  // centreline [x, z, height of the road, width of the asphalt on the left, on the right]
  waypoints: line.filter((_, i) => i % STEP === 0).map((q, k) => [round1(q[0]), round1(q[1]), +height[k * STEP].toFixed(2), round1(half[k * STEP][0]), round1(half[k * STEP][1])]),
  // the same centreline at full resolution (one point every 3 m, as the road is built), for whatever has to
  // follow the road's edges exactly; the waypoints are every STEP of these
  // (and on a circuit drawn by hand, where the faces of its barriers are, on the left and on the right)
  fine: line.map((q, i) => [+q[0].toFixed(2), +q[1].toFixed(2), +height[i].toFixed(2), +half[i][0].toFixed(2), +half[i][1].toFixed(2), ...(DESIGN ? [+section[i].g(-1).toFixed(2), +section[i].g(1).toFixed(2)] : [])]),
  fineStep: STEP,
  // gravel traps: [index in `fine`, width on the left, on the right] wherever there is one (apex-town.js draws
  // them, apex-sand.js slows the cars down on them); the painted grid of a circuit drawn by hand
  // a road part with walls nobody sees (the mouth of the pit lane): patch_bundle.js keeps them out of the drawing
  hidden: parts[HIDDEN] != null || undefined,
  // the land round a circuit drawn by hand, as drawn (heights of a 10 m lattice, x0 + step * column, z0 + step * row,
  // h[column * rows + row]); beyond it apex-town.js carries on from `border`
  terrain,
  // the pit lane (apex-town.js dresses it): its side, its edges' offsets from the centreline along the pits, the
  // fronts of the garages, and the cross-sections along which it runs at full width, in lap order
  pit: PIT ? { side: PIT.side, inner: PIT.offset - PIT.half, outer: PIT.offset + PIT.half, front: PIT.offset + PIT.half + 1.5,
    full: (() => { const n = line.length, i0 = pitAt.findIndex((p, i) => p === 1 && pitAt[(i - 1 + n) % n] !== 1), out = []; for (let k = 0; k < n && pitAt[(i0 + k) % n] === 1; k++) out.push((i0 + k) % n); return out; })() } : undefined,
  sand: sand.map((w, i) => [i, +w[0].toFixed(2), +w[1].toFixed(2)]).filter(r => r[1] > 0 || r[2] > 0),
  grid: lineFile.grid,
  north: (() => { const a = toGame(origin[0], origin[1]), b = toGame(origin[0], origin[1] - 1000); return [(b[0] - a[0]) / 1000, (b[1] - a[1]) / 1000].map(v => +v.toFixed(4)); })(),
  source: town.source,
  // the town, in the circuit's frame (metres, the start line at the origin, the road leaving it towards -z)
  buildings,
  streets: town.streets.map(s => (s.area ? { area: game(s.area) } : { line: game(s.line), width: s.width })),
  water: town.water.map(w => (w.area ? { area: game(w.area), ...(lakeLevel != null ? { y: +lakeLevel.toFixed(2) } : {}) } : { line: game(w.line), width: w.width })),
  rails: town.rails.map(game),
  parks: town.parks.map(game),
  woods: (town.woods || []).map(game),
  landmarks,
  // the relief around the circuit (tools/heights.js): heights above the road's lowest point on a square grid,
  // given in the map's frame (x east, z south of the origin); `frame` turns a point of the circuit's frame into it
  relief: relief && { ...relief, frame: { origin: origin.map(round1), cos: +cosA.toFixed(6), sin: +sinA.toFixed(6) }, scale: HEIGHT_SCALE, startHeight: +startHeight.toFixed(2) },
}));
console.log(`Town: ${buildings.length} buildings (${removed} in the road's way left out), ${town.streets.length} streets.`);
console.log(`Road: ${roadTriangles} triangles.`);
console.log('Gates:', [...checkpoints, finish].map(c => `(${c.gx * GRID}, ${c.gz * GRID}) y ${c.y} ${c.rotation ? 'x' : 'z'}` + (c.straightness != null ? ` straight ${c.straightness.toFixed(3)} clear ${c.clear.toFixed(0)} m` : '')).join('  '));
console.log('Written to ' + OUT);
