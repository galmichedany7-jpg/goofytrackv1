// Turns a 3D model of Monaco (OBJ + PNG atlas) into game data:
//
//   tracks/monaco/monaco.glb         the drivable circuit as custom track parts (road ribbon with
//                                    kerbs and barriers, start line, checkpoint and finish gates)
//   tracks/monaco/monaco_decor.bin   the town around it, simplified, with its texture coordinates
//   tracks/monaco/monaco_decor.jpg   its texture, reduced to 2048 px (made from the model's PNG, see README)
//   tracks/monaco/monaco.json        where everything goes (tiles, gates, waypoints)
//
// The circuit is the asphalt-coloured ribbon of the model: its centreline is traced, smoothed and
// rebuilt as a clean road. The model itself is only scenery (it is not collided with).
//
//   node tools/make_monaco.js "C:\path\to\model folder"      (folder with output.obj and the texture)
//
// The model is not part of this repository; the three generated files are.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const DIR = process.argv[2];
if (!DIR || !fs.existsSync(path.join(DIR, 'output.obj'))) { console.error('Usage: node tools/make_monaco.js "<folder with output.obj and texture_pbr_*.png>"'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'tracks', 'monaco');
fs.mkdirSync(OUT, { recursive: true });

const SCALE = 700;            // metres per model unit: a 1.9 km lap, the town is about 650 m across
const ROAD_HALF = 7.5;        // half width of the asphalt
const KERB = 0.8;             // kerb width
const WALL = 0.6, WALL_H = 1.3;
const SPACING = 3;            // metres between two cross-sections of the ribbon
const MIN_GAP = 21;           // two stretches of road are never closer than this (centre to centre)
const BRIDGE_HEIGHT = 7;      // where the road crosses itself, the second passage is a bridge this high above the first
const BRIDGE_DESCENT = 120;   // metres of ramp back down after the bridge
const MIN_RADIUS = 13;        // tightest corner, at the centreline: the inner barrier must not fold over itself
const START_PX = [1187, 640]; // start line, in the 1400 px top view of the model (on the long straight)
const IDS = { road: 240, start: 241, checkpoint: 242, finish: 243 };

// ------------------------------------------------------------------ reading the model
function readPng(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, depth = 0, type = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), kind = b.toString('latin1', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12] !== 0) throw new Error('interlaced PNG not supported'); }
    else if (kind === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type], bpp = ch * depth / 8, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, up = y > 0 ? out[dst - stride + x] : 0, c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[dst + x] = v & 255;
    }
  }
  const step = depth / 8;
  return (u, v) => { const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))), y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h))), i = y * stride + x * bpp; return [out[i], out[i + step * Math.min(1, ch - 1)], out[i + step * Math.min(2, ch - 1)]]; };
}
function readObj(file) {
  const text = fs.readFileSync(file, 'latin1'), V = [], T = [], F = [];
  let i = 0;
  while (i < text.length) {
    let j = text.indexOf('\n', i); if (j < 0) j = text.length;
    const c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1);
    if (c0 === 118 && c1 === 32) { const p = text.slice(i + 2, j).trim().split(/\s+/); V.push(+p[0], +p[1], +p[2]); }
    else if (c0 === 118 && c1 === 116) { const p = text.slice(i + 3, j).trim().split(/\s+/); T.push(+p[0], +p[1]); }
    else if (c0 === 102 && c1 === 32) { const p = text.slice(i + 2, j).trim().split(/\s+/); for (let k = 0; k < 3; k++) { const q = p[k].split('/'); F.push(+q[0] - 1, +q[1] - 1); } }
    i = j + 1;
  }
  return { V: new Float32Array(V), T: new Float32Array(T), F: new Int32Array(F) };
}

console.log('Reading the model...');
const texture = readPng(path.join(DIR, fs.readdirSync(DIR).find(f => /^texture.*\d\.png$/i.test(f)) || 'texture_pbr_20250901.png'));
const { V, T, F } = readObj(path.join(DIR, 'output.obj'));
const faces = F.length / 6;
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], V[i + k]); max[k] = Math.max(max[k], V[i + k]); }
const span = Math.max(max[0] - min[0], max[2] - min[2]);
const fromPx = (px, py) => [min[0] + px / 1399 * span, min[2] + py / 1399 * span];

// colour and centre of every face; asphalt = near black
const faceColor = new Uint8Array(faces * 3), faceCentre = new Float32Array(faces * 3), isRoad = new Uint8Array(faces);
const road = [];
for (let f = 0; f < faces; f++) {
  let cx = 0, cy = 0, cz = 0, u = 0, v = 0;
  for (let k = 0; k < 3; k++) { const vi = F[f * 6 + k * 2] * 3, ti = F[f * 6 + k * 2 + 1] * 2; cx += V[vi]; cy += V[vi + 1]; cz += V[vi + 2]; u += T[ti]; v += T[ti + 1]; }
  const c = texture(u / 3, v / 3);
  faceColor.set(c, f * 3); faceCentre.set([cx / 3, cy / 3, cz / 3], f * 3);
  if (c[0] < 55 && c[1] < 55 && c[2] < 60) { isRoad[f] = 1; road.push([cx / 3, cz / 3, cy / 3]); }
}

// ------------------------------------------------------------------ tracing the centreline (model units)
const around = (list, x, z, r) => { const out = [], r2 = r * r; for (const p of list) { const dx = p[0] - x, dz = p[1] - z; if (dx * dx + dz * dz <= r2) out.push(p); } return out; };
const dense = road.filter(p => around(road, p[0], p[1], 0.008).length >= 12);   // drops stray dark roofs
const centroid = list => { let x = 0, z = 0; for (const p of list) { x += p[0]; z += p[1]; } return [x / list.length, z / list.length]; };
const STEP = 0.010, R = 0.017;
let [sx, sz] = fromPx(470, 992);
[sx, sz] = centroid(around(dense, sx, sz, 0.03));
let p = [sx, sz], d = [1, 0];
const trace = [[p[0], p[1]]];
for (let step = 0, closed = false; step < 900 && !closed; step++) {
  const target = [p[0] + d[0] * STEP, p[1] + d[1] * STEP];
  const list = around(dense, target[0], target[1], R).filter(q => (q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1] > 0);
  let next, gap = false;
  if (list.length >= 6) next = centroid(list);
  else {                                            // hidden stretch (tunnel, bridge): pick up the ribbon further ahead
    let best = null;
    for (const q of dense) {
      const dx = q[0] - p[0], dz = q[1] - p[1], dist = Math.hypot(dx, dz);
      if (dist < STEP || dist > 0.16) continue;
      const cos = (dx * d[0] + dz * d[1]) / dist;
      if (cos < 0.55 || trace.some(t => (t[0] - q[0]) ** 2 + (t[1] - q[1]) ** 2 < 0.022 ** 2)) continue;
      const score = dist / (cos * cos);
      if (best == null || score < best.score) best = { q, score };
    }
    if (best == null) throw new Error('Lost the road while tracing it');
    next = centroid(around(dense, best.q[0], best.q[1], R));
    gap = true;
  }
  const nd = [next[0] - p[0], next[1] - p[1]], l = Math.hypot(nd[0], nd[1]);
  const mx = gap ? nd[0] / l : d[0] * 0.35 + nd[0] / l * 0.65, mz = gap ? nd[1] / l : d[1] * 0.35 + nd[1] / l * 0.65, ml = Math.hypot(mx, mz);
  d = [mx / ml, mz / ml]; p = next; trace.push([p[0], p[1]]);
  if (step > 60 && Math.hypot(p[0] - sx, p[1] - sz) < STEP * 1.2) closed = true;
}
const roadHeights = dense.map(q => q[2]).sort((a, b) => a - b);
const ROAD_Y = roadHeights[roadHeights.length >> 1];
console.log(`Traced ${trace.length} points, road level ${ROAD_Y.toFixed(4)} (model units)`);

// ------------------------------------------------------------------ centreline in metres, start at the origin heading -z
const lengthOf = pts => pts.reduce((s, q, i) => s + Math.hypot(q[0] - pts[(i + 1) % pts.length][0], q[1] - pts[(i + 1) % pts.length][1]), 0);
function resample(pts, spacing) {
  const total = lengthOf(pts), count = Math.round(total / spacing), step = total / count, out = [];
  let i = 0, acc = 0, a = pts[0], b = pts[1 % pts.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k < count; k++) {
    const want = k * step;
    while (acc + seg < want) { acc += seg; i++; a = pts[i % pts.length]; b = pts[(i + 1) % pts.length]; seg = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const t = seg > 0 ? (want - acc) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
const smooth = (pts, passes) => { for (let n = 0; n < passes; n++) pts = pts.map((q, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4]; }); return pts; };
let line = smooth(resample(trace.map(q => [q[0] * SCALE, q[1] * SCALE]), SPACING), 3);

// The model's road is too tight for a wall on each side: the two legs of the hairpin are 11 m apart and
// some corners are sharper than the barrier offset. The line is relaxed until every stretch is at least
// MIN_GAP from any other and every corner is at least MIN_RADIUS wide; both rules are applied together.
const alongRoad = (i, j) => Math.min(Math.abs(j - i), line.length - Math.abs(j - i)) * SPACING;
const radiusAt = (pts, i, k = 3) => {                                    // circle through a point and its neighbours 9 m away
  const a = pts[(i - k + pts.length) % pts.length], b = pts[i], c = pts[(i + k) % pts.length];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  return area < 1e-9 ? Infinity : ab * bc * ca / (4 * area);
};
function crossings(pts) {                                                // where the closed line crosses itself: [[i, j], ...]
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const found = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    if (i === 0 && j === pts.length - 1) continue;
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[j], d = pts[(j + 1) % pts.length];
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) found.push([i, j]);
  }
  return found;
}
// The model's road crosses itself once (a loop). The loop becomes a climbing turn: the road rises from its
// first passage to a bridge over it at the second one, then ramps back down.
const ease = t => t * t * (3 - 2 * t);
function heights(pts) {
  const cross = crossings(pts);
  if (cross.length !== 1) throw new Error('Expected the road to cross itself exactly once, found ' + cross.length + ' crossings');
  const [first, second] = cross[0], climbFrom = first + Math.round(12 / SPACING), descent = Math.round(BRIDGE_DESCENT / SPACING);
  return pts.map((_, i) => {
    if (i > climbFrom && i <= second) return BRIDGE_HEIGHT * ease((i - climbFrom) / (second - climbFrom));
    if (i > second && i < second + descent) return BRIDGE_HEIGHT * (1 - ease((i - second) / descent));
    return 0;
  });
}
let height = heights(line);
for (let pass = 0; pass < 1500; pass++) {
  const move = line.map(() => [0, 0]);
  let busy = 0;
  for (let i = 0; i < line.length; i++) for (let j = i + 1; j < line.length; j++) {
    if (alongRoad(i, j) < 80 || Math.abs(height[i] - height[j]) >= 5) continue;   // the bridge may pass over the road below
    const dx = line[j][0] - line[i][0], dz = line[j][1] - line[i][1], dist = Math.hypot(dx, dz);
    if (dist >= MIN_GAP + 0.5 || dist === 0) continue;
    const push = (MIN_GAP + 0.5 - dist) * 0.2;
    move[i][0] -= dx / dist * push; move[i][1] -= dz / dist * push; move[j][0] += dx / dist * push; move[j][1] += dz / dist * push;
    busy++;
  }
  for (let i = 0; i < line.length; i++) {
    if (radiusAt(line, i) >= MIN_RADIUS + 0.3) continue;
    busy++;
    for (let o = -3; o <= 3; o++) {                                      // relax the corner as a whole
      const j = (i + o + line.length) % line.length, a = line[(j - 1 + line.length) % line.length], b = line[(j + 1) % line.length];
      move[j][0] += ((a[0] + b[0]) / 2 - line[j][0]) * 0.12; move[j][1] += ((a[1] + b[1]) / 2 - line[j][1]) * 0.12;
    }
  }
  if (busy === 0) break;
  line = line.map((q, i) => { const l = Math.hypot(move[i][0], move[i][1]), k = l > 1 ? 1 / l : 1; return [q[0] + move[i][0] * k, q[1] + move[i][1] * k]; }); // at most 1 m per pass
  // spread the displacement to the neighbours so the line stays smooth
  line = line.map((q, i) => { const a = line[(i - 1 + line.length) % line.length], b = line[(i + 1) % line.length]; return [q[0] * 0.8 + (a[0] + b[0]) * 0.1, q[1] * 0.8 + (a[1] + b[1]) * 0.1]; });
  if (pass % 25 === 24) line = resample(line, SPACING);
  height = heights(line);
}
line = resample(line, SPACING);

// rotate and move so the start point is the origin and the road leaves it towards -z
const startModel = fromPx(...START_PX).map(v => v * SCALE);
let startIndex = 0;
line.forEach((q, i) => { if (Math.hypot(q[0] - startModel[0], q[1] - startModel[1]) < Math.hypot(line[startIndex][0] - startModel[0], line[startIndex][1] - startModel[1])) startIndex = i; });
line = line.slice(startIndex).concat(line.slice(0, startIndex));
const tangentAt = (pts, i, reach = 4) => { const a = pts[(i - reach + pts.length) % pts.length], b = pts[(i + reach) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
const t0 = tangentAt(line, 0, 8);
const angle = Math.atan2(-1, 0) - Math.atan2(t0[1], t0[0]);            // turns t0 into (0, -1)
const cosA = Math.cos(angle), sinA = Math.sin(angle), origin = line[0].slice();
const toLocal = (x, z) => { const dx = x - origin[0], dz = z - origin[1]; return [dx * cosA - dz * sinA, dx * sinA + dz * cosA]; };
line = line.map(q => toLocal(q[0], q[1]));
height = heights(line);
const lapLength = lengthOf(line);
console.log(`Lap length ${lapLength.toFixed(0)} m, ${line.length} cross-sections`);

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
const E = ROAD_HALF, K = ROAD_HALF + KERB, W = K + WALL;
const section = line.map((q, i) => {
  const t = tangentAt(line, i, 1), nx = -t[1], nz = t[0];                // unit vector across the road
  const at = (u, y) => [q[0] + nx * u, y + height[i], q[1] + nz * u];
  return { t, n: [nx, 0, nz], at };
});
// both edges must always move forward along the road, or a barrier would cut across it
let folds = 0, closest = Infinity;
for (let i = 0; i < line.length; i++) {
  const a = section[i], b = section[(i + 1) % line.length];
  for (const u of [-W, W]) { const p0 = a.at(u, 0), p1 = b.at(u, 0); if ((p1[0] - p0[0]) * a.t[0] + (p1[2] - p0[2]) * a.t[1] <= 0) folds++; }
  for (let j = i + 1; j < line.length; j++) if (Math.min(j - i, line.length - (j - i)) * SPACING > 80 && Math.abs(height[i] - height[j]) < 5) closest = Math.min(closest, Math.hypot(line[j][0] - line[i][0], line[j][1] - line[i][1]));
}
console.log(`Ribbon check: ${folds} folded edge segments, closest approach between two stretches at the same level ${closest.toFixed(1)} m (walls are ${(2 * W).toFixed(1)} m apart across the road)`);
if (folds > 0 || closest < 2 * W + 1) throw new Error('The road ribbon overlaps itself; raise MIN_RADIUS or MIN_GAP');
for (let i = 0; i < line.length; i++) {
  const a = section[i], b = section[(i + 1) % line.length];
  const strip = (material, u0, y0, u1, y1, towards) => quad('MonacoRoad', material, a.at(u0, y0), a.at(u1, y1), b.at(u1, y1), b.at(u0, y0), towards);
  const kerb = Math.floor(i / 2) % 2 === 0 ? 'RoadEdgeRed' : 'RoadEdgeWhite';
  strip('Road', -E, 0, E, 0, [0, 1, 0]);
  for (const s of [-1, 1]) {
    const out = [a.n[0] * s, 0, a.n[2] * s], inward = [-out[0], 0, -out[2]];
    strip(kerb, s * E, 0, s * K, 0.05, [0, 1, 0]);
    strip('RoadBarrier', s * K, 0.05, s * K, WALL_H, inward);          // the face the cars hit
    strip('RoadBarrier', s * K, WALL_H, s * W, WALL_H, [0, 1, 0]);
    strip('RoadBarrier', s * W, WALL_H, s * W, -1.5, out);
  }
  if (height[i] > 0.4 || height[(i + 1) % line.length] > 0.4) strip('RoadBarrier', -W, -1.5, W, -1.5, [0, -1, 0]);   // underside of the bridge and its ramps
}

// ------------------------------------------------------------------ start line, checkpoint and finish gates (road along z)
const lineAcross = (mesh, material, depth) => quad(mesh, material, [-E, 0.03, -depth / 2], [E, 0.03, -depth / 2], [E, 0.03, depth / 2], [-E, 0.03, depth / 2], [0, 1, 0]);
function gate(mesh, banner) {
  const post = W + 1.2;
  for (const s of [-1, 1]) box(mesh, 'RoadBarrier', s * post - 0.3, 0, -0.3, s * post + 0.3, 6.4, 0.3);
  box(mesh, banner, -post, 5.4, -0.2, post, 6.4, 0.2);
}
lineAcross('MonacoStart', 'StartLine', 0.6);
lineAcross('MonacoCheckpoint', 'Checkpoint', 1.0); gate('MonacoCheckpoint', 'Checkpoint');
for (let k = 0; k < 10; k++) for (let r = 0; r < 2; r++)               // chequered line
  quad('MonacoFinish', (k + r) % 2 ? 'FinishWhite' : 'FinishBlack', [-E + k * 1.5, 0.03, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, 0.03, r * 0.9 - 0.9], [-E + (k + 1) * 1.5, 0.03, r * 0.9], [-E + k * 1.5, 0.03, r * 0.9], [0, 1, 0]);
gate('MonacoFinish', 'Finish');

// Gates are separate parts, placed on the 5 m grid and turned by quarter turns only: they go where the
// road runs close to a grid axis, away from any other stretch of road.
const GRID = 5;
function gateSpot(index) {
  const q = line[index], t = tangentAt(line, index, 3);
  const alongZ = Math.abs(t[1]) > Math.abs(t[0]);
  const straightness = Math.max(Math.abs(t[0]), Math.abs(t[1]));
  let clear = Infinity;
  for (let j = 0; j < line.length; j++) {
    const alongRoad = Math.min(Math.abs(j - index), line.length - Math.abs(j - index)) * SPACING;
    if (alongRoad > 60) clear = Math.min(clear, Math.hypot(line[j][0] - q[0], line[j][1] - q[1]));
  }
  return { index, gx: Math.round(q[0] / GRID), gz: Math.round(q[1] / GRID), rotation: alongZ ? 0 : 1, straightness, clear };
}
const checkpoints = [0.22, 0.42, 0.62, 0.82].map(fraction => {
  const wanted = Math.round(fraction * line.length);
  let best = null;
  for (let o = -110; o <= 110; o++) {                                     // up to 330 m either way: the bridge and its ramps take no gate
    const spot = gateSpot((wanted + o + line.length) % line.length);
    if (spot.clear < 34 || height[spot.index] > 0.05) continue;
    const score = spot.straightness - Math.abs(o) * 0.0006;
    if (best == null || score > best.score) best = { ...spot, score };
  }
  if (best == null) throw new Error('No room for a checkpoint near ' + fraction);
  return best;
});
const finish = { gx: 0, gz: 4, rotation: 0 };                            // 20 m behind the start line: its own cell on the mini-map

// ------------------------------------------------------------------ tiles (20 m cells the road covers): mini-map, thumbnail, bounds
const cells = new Set();
for (const s of section) for (const u of [-ROAD_HALF, 0, ROAD_HALF]) { const [x, , z] = s.at(u, 0); cells.add(Math.round(x / 20) + ',' + Math.round(z / 20)); }
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

// ------------------------------------------------------------------ the town: simplified scenery, still textured
// Vertices are merged when they are close in space AND close in the texture, so each merged vertex
// keeps a meaningful texture coordinate and the facades stay readable.
// nearest distance from a point to the centreline, through a coarse grid of its points
const bucket = new Map();
line.forEach((q, i) => { const k = Math.floor(q[0] / 12) + ',' + Math.floor(q[1] / 12); (bucket.get(k) || bucket.set(k, []).get(k)).push(i); });
// is this point inside the space the road needs (corridor, from below the deck up to tunnel height)?
const inRoadSpace = (x, y, z) => {
  const bx = Math.floor(x / 12), bz = Math.floor(z / 12);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of bucket.get((bx + i) + ',' + (bz + j)) || [])
    if (Math.hypot(line[k][0] - x, line[k][1] - z) < W + 1.5 && y > height[k] - 4 && y < height[k] + 7.5) return true;
  return false;
};
const world = (x, y, z) => { const [lx, lz] = toLocal(x * SCALE, z * SCALE); return [lx, (y - ROAD_Y) * SCALE, lz]; };
const CELL = 3.4, UV_CELLS = 160;                                        // metres / texture grid: closer vertices are merged
const clusters = new Map(), cPos = [], cUv = [], cCount = [];
// OBJ corners pair a position with a texture coordinate; the cluster is chosen per corner
const cornerCluster = (vi, ti) => {
  const w = world(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]);
  const key = Math.floor(w[0] / CELL) + ',' + Math.floor(w[1] / CELL) + ',' + Math.floor(w[2] / CELL) + '|' + Math.floor(T[ti * 2] * UV_CELLS) + ',' + Math.floor(T[ti * 2 + 1] * UV_CELLS);
  let c = clusters.get(key);
  if (c == null) { c = cCount.length; clusters.set(key, c); cPos.push(0, 0, 0); cUv.push(0, 0); cCount.push(0); }
  cPos[c * 3] += w[0]; cPos[c * 3 + 1] += w[1]; cPos[c * 3 + 2] += w[2]; cUv[c * 2] += T[ti * 2]; cUv[c * 2 + 1] += T[ti * 2 + 1]; cCount[c]++;
  return c;
};
const indices = [], seen = new Set();
for (let f = 0; f < faces; f++) {
  const w = world(faceCentre[f * 3], faceCentre[f * 3 + 1], faceCentre[f * 3 + 2]);
  // clear the road corridor up to tunnel height: the model's own road, and whatever stands where ours passes
  if (inRoadSpace(w[0], w[1], w[2])) continue;
  const a = cornerCluster(F[f * 6], F[f * 6 + 1]), b = cornerCluster(F[f * 6 + 2], F[f * 6 + 3]), c = cornerCluster(F[f * 6 + 4], F[f * 6 + 5]);
  if (a === b || b === c || a === c) continue;
  const key = [a, b, c].sort((x, y) => x - y).join(',');
  if (seen.has(key)) continue;
  seen.add(key);
  indices.push(a, b, c);
}
// keep only the vertices that are still used
const remap = new Int32Array(cCount.length).fill(-1); let used = 0;
for (const v of indices) if (remap[v] < 0) remap[v] = used++;
const positions = new Float32Array(used * 3), uvs = new Float32Array(used * 2);
for (let c = 0; c < remap.length; c++) {
  const n = remap[c]; if (n < 0) continue;
  for (let k = 0; k < 3; k++) positions[n * 3 + k] = cPos[c * 3 + k] / cCount[c];
  uvs[n * 2] = cUv[c * 2] / cCount[c]; uvs[n * 2 + 1] = cUv[c * 2 + 1] / cCount[c];
}
const index = new Uint32Array(indices.map(v => remap[v]));
const header = Buffer.from(JSON.stringify({ vertices: used, triangles: index.length / 3 }));
const headerLength = Buffer.alloc(4); headerLength.writeUInt32LE(header.length, 0);
const pad = Buffer.alloc((4 - (4 + header.length) % 4) % 4, 0x20);
fs.writeFileSync(path.join(OUT, 'monaco_decor.bin'), Buffer.concat([headerLength, header, pad, Buffer.from(positions.buffer), Buffer.from(index.buffer), Buffer.from(uvs.buffer)]));

// ------------------------------------------------------------------ monaco.json
fs.writeFileSync(path.join(OUT, 'monaco.json'), JSON.stringify({
  ids: IDS, scale: SCALE, lapLength: Math.round(lapLength), bridgeHeight: BRIDGE_HEIGHT, roadHalfWidth: ROAD_HALF, gateWidth: 2 * W + 6,
  level: 1,                                                               // grid height of the circuit: 5 m above the plain
  finish, checkpoints: checkpoints.map(({ gx, gz, rotation }) => ({ gx, gz, rotation })),
  roadCells: [...cells].filter(c => !gateCells.has(c)).map(c => c.split(',').map(Number)),
  waypoints: line.filter((_, i) => i % 4 === 0).map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]),
}));
console.log(`Road: ${roadTriangles} triangles. Town: ${index.length / 3} triangles, ${used} vertices (from ${faces}).`);
console.log('Checkpoints:', checkpoints.map(c => `(${c.gx * GRID}, ${c.gz * GRID}) ${c.rotation ? 'x' : 'z'} straight ${c.straightness.toFixed(3)} clear ${c.clear.toFixed(0)} m`).join('  '));
console.log('Written to ' + OUT);
