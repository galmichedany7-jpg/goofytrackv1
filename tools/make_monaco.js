// Builds the Monaco GP circuit from the real track's centreline (tools/monaco_gps.json):
//
//   tracks/monaco/monaco.glb         the drivable circuit as custom track parts (road ribbon with kerbs
//                                    and barriers, start line, checkpoint and finish gates)
//   tracks/monaco/monaco.json        where everything goes (tiles, gates, the centreline with its heights,
//                                    named corners, sea and harbour outlines); apex-monaco.js builds the
//                                    principality around the circuit from it
//
// The lap is the real one, at full scale (3.3 km): Sainte-Devote, the climb of Beau Rivage to the Casino
// (about 40 m higher), Mirabeau, the hairpin, Portier, the tunnel along the sea, the chicane, Tabac, the
// swimming pool, la Rascasse and Anthony Noghes. The GPS line is rounded, then relaxed just enough for a
// 15 m road with a barrier on each side (the two legs of the hairpin are closer than that in reality).
//
//   node tools/make_monaco.js
//
// Then, in the game: the track file, its id and thumbnail (tracks/index.js), and the parts' checksums
// (tracks/monaco/checksums.json) must be made again, see tools/monaco_track.js.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tracks', 'monaco');
fs.mkdirSync(OUT, { recursive: true });

const ROAD_HALF = 7.5;        // half width of the asphalt
const KERB = 0.8;             // kerb width
const WALL = 0.6, WALL_H = 1.3;
const SPACING = 3;            // metres between two cross-sections of the ribbon
const WIDEN = 4;              // in the tight corners the road is up to this much wider, on the outside (the hairpin is 19 m wide)
const GAP = 3.2;              // room between the outer faces of the barriers of two stretches that run side by side
const MIN_RADIUS = 13;        // tightest corner, at the centreline: the inner barrier must not fold over itself
const MAX_GRADE = 0.09;       // steepest slope of the road
const HEIGHT_SCALE = 0.835;   // the real climb, a little flattened: the Casino square is 35 m above the harbour
const START_GPS = 121;        // the start line, as an index of the GPS line (on Boulevard Albert Ier)
const IDS = { road: 240, start: 241, checkpoint: 242, finish: 243 };
const GRID = 5;               // track parts sit on a 5 m grid, heights too
const LEVEL = 1;              // grid height of the start line: 5 m above the game's plain

// Height of the road above the harbour quays, in metres, at indices of the GPS line (real profile, rounded).
// Everything between 56 and 126 (the tunnel exit, Tabac, the swimming pool, la Rascasse, the pit straight)
// is at the harbour's level.
const PROFILE = [
  [56, 0], [126, 0], [128, 0.5], [131, 3], [134, 9], [137, 16], [140, 22], [143, 28], [146, 33], [149, 37], [152, 40],
  [155, 41], [158, 42], [161, 42], [163, 41], [165, 39], [167, 36], [170, 33], [173, 31], [177, 29], [180, 27], [183, 26],
  [186, 25], [189, 22], [192, 18], [195, 13], [198, 10], [201, 9], [205, 7], [209, 4], [212, 2], [214, 0.5], [216, 0],
];
// Named places, at indices of the GPS line; apex-monaco.js dresses them
const PLACES = {
  sainteDevote: 129, beauRivage: 138, massenet: 153, casino: 1, mirabeau: 8, hairpin: 22, mirabeauBas: 28, portier: 37,
  tunnelIn: 40, tunnelOut: 50, chicane: 56, tabac: 66, piscine: 72, piscineOut: 85, rascasse: 101, noghes: 109,
};
// Where the checkpoints may go (GPS index ranges), in lap order
const GATE_RANGES = [[156, 161], [37.5, 39.3], [60, 67], [86, 96]];

// Coasts, in metres east (x) and south (z) of the GPS origin below. Water: the open sea and Port Hercule
// (the harbour inside the circuit), with the north jetty and the dike as land.
const ORIGIN = [7.4258, 43.7367];
const WATER = [[12000, -12000], [12000, -5200], [6000, -3600], [2600, -2300], [900, -1300], [560, -760], [425, -545], [402, -470], [400, -380], [388, -300],
  [345, -215], [275, -142], [185, -88], [95, -48], [60, -8], [-80, 6], [-255, 30], [-268, 60], [-282, 92], [-282, 135], [-252, 172], [-236, 270], [-238, 305],
  [-244, 332], [-222, 366], [-192, 398], [-160, 428], [120, 424], [215, 392], [330, 422], [366, 520], [290, 700], [60, 806], [-250, 800], [-420, 712],
  [-700, 772], [-1300, 900], [-2500, 1300], [-6000, 2600], [-12000, 3600], [-12000, 12000], [12000, 12000]];
// the quays of Port Hercule, from the root of the north jetty round to the root of the dike: WATER[13..28]
const QUAYS = [13, 28];
const JETTIES = [{ from: [95, -48], to: [238, 98], half: 9 }, { from: [210, 392], to: [328, 236], half: 7 }];
// The Rock (Monaco-Ville): a plateau 55 m above the sea, south of the harbour
const ROCK = { height: 55, outline: [[-340, 565], [-150, 545], [100, 525], [300, 505], [340, 560], [262, 690], [60, 778], [-240, 768], [-385, 680]] };

// ------------------------------------------------------------------ the GPS line, in metres
const gps = JSON.parse(fs.readFileSync(path.join(__dirname, 'monaco_gps.json'), 'utf8')).lonLat;
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
// The GPS points are 20 m apart: their corners are rounded first, then the line is resampled finely
for (let k = 0; k < 3; k++) line = chaikin(line);
line = smooth(resample(line, SPACING), 6);

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
function relax(pts, pinned = () => 1) {
  for (let pass = 0; pass < 3000; pass++) {
    const n = pts.length, move = pts.map(() => [0, 0]), widths = halfWidths(pts);
    const wall = (i, j) => {                                             // back of the barrier of i, on the side that faces j
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], c = pts[j];
      const side = (b[0] - a[0]) * (c[1] - pts[i][1]) - (b[1] - a[1]) * (c[0] - pts[i][0]);   // > 0: j is on the right
      return widths[i][side > 0 ? 1 : 0] + OUTSIDE;
    };
    let busy = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (alongRoad(i, j, n) < 80) continue;
      const dx = pts[j][0] - pts[i][0], dz = pts[j][1] - pts[i][1];
      if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
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
  for (let j = 0; j < line.length; j++) if (alongRoad(j, index, line.length) > 60) clear = Math.min(clear, Math.hypot(line[j][0] - q[0], line[j][1] - q[1]));
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
    if (spot.clear < 36) continue;
    spot.slope = Math.abs(profileAt(gpsIndex(uAt((i + 3) % line.length))) - profileAt(gpsIndex(uAt((i - 3 + line.length) % line.length)))) * HEIGHT_SCALE / (6 * SPACING);
    spot.score = Math.min(spot.straightness, 0.95) - spot.slope * 2;      // square enough to the grid, then as level as possible
    if (best == null || spot.score > best.score) best = spot;
  }
  if (best == null) throw new Error('No room for a checkpoint between GPS points ' + range);
  return best;
});
const finishIndex = line.length - Math.round(20 / SPACING);
const finish = { index: finishIndex, gx: 0, gz: 4, rotation: 0 };                  // 20 m behind the start line: its own cell on the mini-map
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
for (let pass = 0; pass < 5; pass++) {                                   // long vertical curves: a moving average over 54 m
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
const section = line.map((q, i) => {
  const t = tangentAt(line, i, 1), nx = -t[1], nz = t[0];                // unit vector across the road
  const at = (u, y) => [q[0] + nx * u, y + height[i], q[1] + nz * u];
  const side = s => half[i][s < 0 ? 0 : 1];                                // asphalt width on the left (s < 0) or right side
  return { t, n: [nx, 0, nz], at, e: s => side(s), k: s => side(s) + KERB, w: s => side(s) + OUTSIDE };
});
// both edges must always move forward along the road, or a barrier would cut across it
let folds = 0, closest = Infinity, tightest = Infinity;
for (let i = 0; i < line.length; i++) {
  const a = section[i], b = section[(i + 1) % line.length];
  for (const s of [-1, 1]) { const p0 = a.at(s * a.w(s), 0), p1 = b.at(s * b.w(s), 0); if ((p1[0] - p0[0]) * a.t[0] + (p1[2] - p0[2]) * a.t[1] <= 0) folds++; }
  for (let j = i + 1; j < line.length; j++) if (alongRoad(i, j, line.length) > 80) {
    const dx = line[j][0] - line[i][0], dz = line[j][1] - line[i][1], d = Math.hypot(dx, dz);
    if (d > 60) continue;
    const si = Math.sign(dx * a.n[0] + dz * a.n[2]) || 1, sj = -Math.sign(dx * section[j].n[0] + dz * section[j].n[2]) || 1;
    closest = Math.min(closest, d - a.w(si) - section[j].w(sj));
  }
  tightest = Math.min(tightest, radiusAt(line, i));
}
console.log(`Ribbon check: ${folds} folded edge segments, ${closest.toFixed(1)} m between the barriers of the two closest stretches, tightest corner ${tightest.toFixed(1)} m, road ${Math.min(...half.map(h => h[0] + h[1])).toFixed(1)} to ${Math.max(...half.map(h => h[0] + h[1])).toFixed(1)} m wide`);
if (folds > 0 || closest < 1) throw new Error('The road ribbon overlaps itself; raise MIN_RADIUS or GAP');
// kerbs are painted red and white in the corners only; elsewhere the edge is a white line on grey
const corner = line.map((_, i) => { let r = Infinity; for (let o = -4; o <= 4; o++) r = Math.min(r, radiusAt(line, (i + o + line.length) % line.length, 4)); return r < 110; });
for (let i = 0; i < line.length; i++) {
  const a = section[i], b = section[(i + 1) % line.length];
  // a strip between two offsets, each end at its own section's offset (the road is wider in the corners)
  const strip = (material, u0, y0, u1, y1, towards) => quad('MonacoRoad', material, a.at(u0(a), y0), a.at(u1(a), y1), b.at(u1(b), y1), b.at(u0(b), y0), towards);
  const kerb = corner[i] ? (Math.floor(i / 2) % 2 === 0 ? 'RoadEdgeRed' : 'RoadEdgeWhite') : 'RoadEdgeWhite';
  // the asphalt in 8 lanes and 3 steps along: where the road turns and climbs at once its surface twists,
  // and small facets spread the twist instead of folding it on a few long creases
  for (let k = 0; k < 3; k++) for (let m = 0; m < 8; m++) {
    const P = (c, f) => c.at(-c.e(-1) + f * (c.e(-1) + c.e(1)), 0);
    const along = (f, t) => { const p = P(a, f), q = P(b, f); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };
    quad('MonacoRoad', 'Road', along(m / 8, k / 3), along((m + 1) / 8, k / 3), along((m + 1) / 8, (k + 1) / 3), along(m / 8, (k + 1) / 3), [0, 1, 0]);
  }
  for (const s of [-1, 1]) {
    const out = [a.n[0] * s, 0, a.n[2] * s], inward = [-out[0], 0, -out[2]];
    strip(kerb, c => s * c.e(s), 0, c => s * c.k(s), corner[i] ? 0.05 : 0.01, [0, 1, 0]);
    strip('RoadBarrier', c => s * c.k(s), corner[i] ? 0.05 : 0.01, c => s * c.k(s), WALL_H, inward);   // the face the cars hit
    strip('RoadBarrier', c => s * c.k(s), WALL_H, c => s * c.w(s), WALL_H, [0, 1, 0]);
    strip('RoadBarrier', c => s * c.w(s), WALL_H, c => s * c.w(s), -8, out);   // down to the ground, wherever the town is lower
  }
}

// ------------------------------------------------------------------ start line, checkpoint and finish gates (road along z)
// The lines painted across the road are drawn by apex-monaco.js, which follows the road exactly. The parts keep
// their own copy under the asphalt, out of reach of the wheels: a line standing even 3 cm proud of a sloping
// road made the cars bounce on it.
const LINE_Y = -0.4;
const lineAcross = (mesh, material, depth) => quad(mesh, material, [-E, LINE_Y, -depth / 2], [E, LINE_Y, -depth / 2], [E, LINE_Y, depth / 2], [-E, LINE_Y, depth / 2], [0, 1, 0]);
function gate(mesh, banner) {
  const post = W + 1.2;
  for (const s of [-1, 1]) box(mesh, 'RoadBarrier', s * post - 0.3, 0, -0.3, s * post + 0.3, 6.4, 0.3);
  box(mesh, banner, -post, 5.4, -0.2, post, 6.4, 0.2);
}
lineAcross('MonacoStart', 'StartLine', 0.6);
lineAcross('MonacoCheckpoint', 'Checkpoint', 1.0); gate('MonacoCheckpoint', 'Checkpoint');
for (let k = 0; k < 10; k++) for (let r = 0; r < 2; r++)                 // chequered line
  quad('MonacoFinish', (k + r) % 2 ? 'FinishWhite' : 'FinishBlack', [-E + k * 1.5, LINE_Y, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, LINE_Y, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, LINE_Y, r * 0.9], [-E + k * 1.5, LINE_Y, r * 0.9], [0, 1, 0]);
gate('MonacoFinish', 'Finish');

// ------------------------------------------------------------------ tiles (20 m cells the road covers): mini-map, thumbnail, bounds
const cells = new Set();
for (const s of section) for (const u of [-s.e(-1), 0, s.e(1)]) { const [x, , z] = s.at(u, 0); cells.add(Math.round(x / 20) + ',' + Math.round(z / 20)); }
const gateCells = new Set([[0, 0], [finish.gx, finish.gz], ...checkpoints.map(c => [c.gx, c.gz])].map(([gx, gz]) => Math.round(gx * GRID / 20) + ',' + Math.round(gz * GRID / 20)));

// ------------------------------------------------------------------ monaco.glb
// linear RGB; road, kerb and line colours are the ones of the game's own road parts, the barrier is a lighter steel
const MATERIALS = { Road: [0.2957, 0.2957, 0.2957], RoadEdgeRed: [0.8, 0.0323, 0.0127], RoadEdgeWhite: [0.8, 0.8, 0.8], RoadBarrier: [0.33, 0.35, 0.38], StartLine: [0.8, 0.8, 0.8], Checkpoint: [0.76, 0.52, 0.02], FinishWhite: [0.8, 0.8, 0.8], FinishBlack: [0.01, 0.01, 0.012], Finish: [0.64, 0.02, 0.02] };
const gltf = { asset: { version: '2.0', generator: 'GoofyTrack make_monaco.js' }, scene: 0, scenes: [{ name: 'Monaco', nodes: [] }], nodes: [], meshes: [], materials: Object.entries(MATERIALS).map(([name, rgb]) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 } })), accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
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
fs.writeFileSync(path.join(OUT, 'monaco.glb'), Buffer.concat([head, jh, json, bh, bin]));
const roadTriangles = Object.values(parts.MonacoRoad).reduce((s, a) => s + a.length / 9, 0);

// ------------------------------------------------------------------ monaco.json
const STEP = 4;                                                           // one waypoint every 12 m
const round1 = v => +v.toFixed(1);
const gameOutline = list => list.map(p => toGame(p[0], p[1]).map(round1));
const places = {};
for (const [name, g] of Object.entries(PLACES)) places[name] = Math.round(indexOfGps(g) / STEP);
fs.writeFileSync(path.join(OUT, 'monaco.json'), JSON.stringify({
  ids: IDS, lapLength: Math.round(lapLength), roadHalfWidth: ROAD_HALF, gateWidth: 2 * W + 6,
  level: LEVEL,                                                           // grid height of the start line: 5 m above the plain
  finish: { gx: finish.gx, gy: finish.y, gz: finish.gz, rotation: finish.rotation },
  checkpoints: checkpoints.map(({ gx, y, gz, rotation }) => ({ gx, gy: y, gz, rotation })),
  roadCells: [...cells].filter(c => !gateCells.has(c)).map(c => c.split(',').map(Number)),
  // centreline [x, z, height of the road, width of the asphalt on the left, on the right] and the waypoint index of each named place
  waypoints: line.filter((_, i) => i % STEP === 0).map((q, k) => [round1(q[0]), round1(q[1]), +height[k * STEP].toFixed(2), round1(half[k * STEP][0]), round1(half[k * STEP][1])]),
  places,
  // the same centreline at full resolution (one point every 3 m, as the road is built), for whatever has to
  // follow the road's edges exactly (barrier tops, fences); the waypoints are every STEP of these
  fine: line.map((q, i) => [+q[0].toFixed(2), +q[1].toFixed(2), +height[i].toFixed(2), +half[i][0].toFixed(2), +half[i][1].toFixed(2)]),
  fineStep: STEP,
  north: (() => { const a = toGame(origin[0], origin[1]), b = toGame(origin[0], origin[1] - 1000); return [(b[0] - a[0]) / 1000, (b[1] - a[1]) / 1000].map(v => +v.toFixed(4)); })(),
  water: gameOutline(WATER),
  quays: gameOutline(WATER.slice(QUAYS[0], QUAYS[1] + 1)),
  jetties: JETTIES.map(j => ({ from: toGame(...j.from).map(round1), to: toGame(...j.to).map(round1), half: j.half })),
  rock: { height: ROCK.height, outline: gameOutline(ROCK.outline) },
}));
console.log(`Road: ${roadTriangles} triangles.`);
console.log('Gates:', [...checkpoints, finish].map(c => `(${c.gx * GRID}, ${c.gz * GRID}) y ${c.y} ${c.rotation ? 'x' : 'z'}` + (c.straightness != null ? ` straight ${c.straightness.toFixed(3)} clear ${c.clear.toFixed(0)} m` : '')).join('  '));
console.log('Written to ' + OUT);
