// Builds "Goofy Coaster", a stunt circuit drawn in space rather than on a map:
//
//   tracks/coaster/coaster.glb    the track as custom track parts (a ribbon with walls that climbs, rolls and
//                                 loops, start line, checkpoint and finish gates)
//   tracks/coaster/coaster.json   where the gates go, and the line the track follows
//
// The lap is described below as a list of moves (LAYOUT), followed by a pen that keeps a position and a
// frame: straight on, turn, pitch up or down, bank, loop, jump (a gap in the road). The lap closes itself:
// the last move joins the start line. Unlike the circuits of tools/make_circuit.js the road here is a slab
// with nothing under it, so it can pass over itself, bank to the vertical and go upside down.
//
//   node tools/make_stunt.js            builds the files
//   node tools/make_stunt.js --check    only says where the lap goes and what it comes close to
//
// Then, in the game: the track file, its id and thumbnail (tracks/index.js), and the parts' checksums
// (tracks/coaster/checksums.json) must be made again, see tools/circuit_track.js.
const fs = require('fs');
const path = require('path');

const KEY = 'coaster', cfg = require('./circuits')[KEY], NAME = cfg.mesh, IDS = cfg.ids;
const OUT = path.join(__dirname, '..', 'tracks', KEY);
const STEP = 2;               // metres between two cross-sections
const HALF = 6.5;             // half width of the road
const WALL = 0.5, WALL_H = 1.1, SLAB = 0.5;
const GRID = 5;               // track parts sit on a 5 m grid, heights too
const START_HEIGHT = 60;      // height of the start line in the design below (only differences matter: the game's plain is set under the lowest point)
const D = Math.PI / 180;

// ------------------------------------------------------------------ the lap, move by move
// straight(length, { pitch })   pitch: the slope reached at the end of the move, in degrees (it eases in)
// turn(angle, radius, { bank, pitch, lead, out })   angle > 0 turns right; bank: lean into the turn, in degrees;
//                               lead, out: length over which the road leans in and levels out again
// loop(radius, shift)           a full vertical loop, sliding `shift` metres sideways so it clears itself
// jump(gap, drop)               the road stops for `gap` metres and resumes `drop` metres lower
// gate()                        a level stretch on the game's grid with a checkpoint on it
// widen(half)                   road half width from here on
const LAYOUT = [
  ['straight', 24],                                   // the start, up on its tower
  ['straight', 60, { pitch: -28 }],                   // over the edge
  ['straight', 42, { pitch: -28 }],                   // the big drop
  ['straight', 56, { pitch: 0 }],
  ['gate'],                                           // 1: at the foot of the drop
  ['straight', 16],
  ['loop', 24, 18],                                   // the loop
  ['straight', 30],
  ['straight', 60, { pitch: 9 }],                     // up a hill...
  ['straight', 50, { pitch: 0 }],
  ['widen', 9],
  ['jump', 16, 3],                                    // ...and off its edge, onto a wide landing
  ['straight', 110, { pitch: -1.5 }],
  ['widen', 6.5],
  ['straight', 30, { pitch: 0 }],
  ['turn', 180, 65, { bank: 72, lead: 60, out: 170 }],                    // the wall ride: half a circle on a wall of 70 degrees
  ['straight', 30],
  ['gate'],                                           // 2: out of the wall ride
  ['turn', -450, 68, { bank: 68, pitch: 4.6, lead: 70, out: 170 }],         // the corkscrew: a turn and a quarter, climbing
  ['straight', 40, { pitch: 0 }],
  ['gate'],                                           // 3: at the top of the corkscrew
  ['straight', 26, { pitch: -6 }],                    // three waves
  ['straight', 26, { pitch: 6 }],
  ['straight', 26, { pitch: -6 }],
  ['straight', 26, { pitch: 6 }],
  ['straight', 26, { pitch: -6 }],
  ['straight', 26, { pitch: 0 }],
  ['straight', 30],
  ['widen', 11],
  ['jump', 26, 5],                                    // the canyon jump
  ['straight', 120, { pitch: -2 }],
  ['widen', 6.5],
  ['straight', 24, { pitch: 0 }],
  ['turn', 90, 70, { bank: 45, lead: 50, out: 110 }],
  ['straight', 30],
  ['gate'],                                           // 4
  ['turn', 90, 75, { bank: 40, lead: 50, out: 100 }],
  ['straight', 50, { pitch: -15 }],                   // the camel's back: down 20 m...
  ['straight', 40, { pitch: -15 }],
  ['straight', 70, { pitch: 13 }],                    // ...up again...
  ['straight', 40, { pitch: 13 }],
  ['straight', 60, { pitch: -10 }],                   // ...over the hump (the wheels leave the road)
  ['straight', 50, { pitch: 0 }],
  ['turn', -55, 90, { bank: 30, lead: 40, out: 60 }], // a banked S
  ['turn', 55, 90, { bank: 30, lead: 40, out: 60 }],
  ['close'],                                          // round to the start
];

// ------------------------------------------------------------------ the pen
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ease = t => t * t * (3 - 2 * t);
// forward, up and right of the road from heading (0 = towards -z, growing to the right), pitch and bank
function frame(yaw, pitch, bank) {
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const n = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];   // up, before banking
  const r0 = cross(f, n);
  const u = unit(add([n[0] * Math.cos(bank), n[1] * Math.cos(bank), n[2] * Math.cos(bank)], r0, Math.sin(bank)));
  return { f, u, r: cross(f, u) };
}
const pen = { p: [0, START_HEIGHT, 0], yaw: 0, pitch: 0, bank: 0, half: HALF };
const samples = [];           // { p, f, u, r, half, gap, move, gate }
const gates = [];             // sample indices of the checkpoints
let moveIndex = 0;
const put = (extra = {}) => samples.push({ p: pen.p.slice(), ...frame(pen.yaw, pen.pitch, pen.bank), half: pen.half, move: moveIndex, ...extra });
// advance along the frame, the angles changing smoothly from their values at the start of the move
function run(length, { yaw = 0, ramp = null, pitch = null, bank = null, shift = 0, pitchTurn = null, extra = {} } = {}) {
  // ramp: the turn tightens ('in') or opens ('out') along the move, so that the road leans as much as it turns
  const turned = t => yaw * (ramp === 'in' ? t * t : ramp === 'out' ? 2 * t - t * t : t);
  const n = Math.max(1, Math.round(length / STEP)), ds = length / n, y0 = pen.yaw, p0 = pen.pitch, b0 = pen.bank;
  for (let i = 1; i <= n; i++) {
    const t = i / n, mid = (i - 0.5) / n;
    const at = frame(y0 + turned(mid), pitchTurn != null ? p0 + pitchTurn * mid : pitch == null ? p0 : p0 + (pitch - p0) * ease(mid), bank == null ? b0 : b0 + (bank - b0) * ease(mid));
    pen.p = add(pen.p, at.f, ds);
    if (shift) pen.p = add(pen.p, cross(at.f, [-Math.sin(pen.yaw) * Math.sin(p0 + (pitchTurn || 0) * mid), Math.cos(p0 + (pitchTurn || 0) * mid), Math.cos(pen.yaw) * Math.sin(p0 + (pitchTurn || 0) * mid)]), shift / n);
    pen.yaw = y0 + turned(t);
    pen.pitch = pitchTurn != null ? p0 + pitchTurn * t : pitch == null ? p0 : p0 + (pitch - p0) * ease(t);
    pen.bank = bank == null ? b0 : b0 + (bank - b0) * ease(t);
    put(extra);
  }
}
// a smooth join from the pen to a given place and heading, level at both ends (cubic Hermite)
function join(target, yaw, extra = {}, tension = 1) {
  const from = pen.p.slice(), a = frame(pen.yaw, pen.pitch, 0).f, b = frame(yaw, 0, 0).f, l = Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]) * tension;
  const at = t => { const h1 = 2 * t ** 3 - 3 * t * t + 1, h2 = t ** 3 - 2 * t * t + t, h3 = -2 * t ** 3 + 3 * t * t, h4 = t ** 3 - t * t; return [0, 1, 2].map(k => h1 * from[k] + h2 * a[k] * l + h3 * target[k] + h4 * b[k] * l); };
  let length = 0, prev = from; for (let i = 1; i <= 200; i++) { const q = at(i / 200); length += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = q; }
  const n = Math.max(2, Math.round(length / STEP));
  for (let i = 1; i <= n; i++) {
    const q = at(i / n), d = unit([0, 1, 2].map(k => at(Math.min(1, i / n + 1e-3))[k] - at(Math.max(0, i / n - 1e-3))[k]));
    pen.p = q; pen.yaw = Math.atan2(d[0], -d[2]); pen.pitch = Math.asin(Math.max(-1, Math.min(1, d[1]))); pen.bank = 0;
    put(extra);
  }
  pen.p = target.slice(); pen.yaw = yaw; pen.pitch = 0;
}
const snap = v => Math.round(v / GRID) * GRID;
const quarter = () => Math.round(pen.yaw / (Math.PI / 2)) * (Math.PI / 2);

put();
for (const [move, a, b, c] of LAYOUT) {
  moveIndex++;
  if (move === 'straight') run(a, { pitch: b && b.pitch != null ? b.pitch * D : null, bank: 0 });
  else if (move === 'turn') {
    const o = c || {}, arc = Math.abs(a) * D * b, lead = o.lead || Math.min(70, arc * 0.3), out = o.out || lead, bank = (o.bank || 0) * D * Math.sign(a), pitch = o.pitch != null ? o.pitch * D : null;
    // lean in while the turn tightens over the first stretch, out while it opens over the last one
    // (the way out is long: a road that levels out faster than the car can roll with it drops away from under its wheels)
    const kappa = Math.sign(a) / b, mid = Math.max(STEP, arc - (lead + out) / 2);
    run(lead, { yaw: kappa * lead / 2, ramp: 'in', bank, pitch });
    run(mid, { yaw: a * D - kappa * (lead + out) / 2 });
    run(out, { yaw: kappa * out / 2, ramp: 'out', bank: 0 });
  } else if (move === 'loop') {
    // The loop slides sideways as it goes round: a car that comes in pointing that much to the side follows it
    // without steering. So the road bends by that angle just before the loop, and back just after it.
    const skew = Math.atan(b / (2 * Math.PI * a)), bend = 150 * skew;
    run(bend, { yaw: skew });
    pen.yaw -= skew;
    run(2 * Math.PI * a, { pitchTurn: 2 * Math.PI, shift: b, extra: { loop: true } }); pen.pitch = 0;
    pen.yaw += skew;
    run(bend, { yaw: -skew });
  } else if (move === 'jump') { run(a, { extra: { gap: true } }); pen.p = add(pen.p, [0, -b, 0]); pen.pitch = 0; samples[samples.length - 1].gap = true; put(); }
  else if (move === 'widen') pen.half = a;
  else if (move === 'gate') {
    // onto the grid: 44 m to drift to the nearest grid line and height, heading along an axis, then level through the gate
    const yaw = quarter(), f = frame(yaw, 0, 0).f, target = add(pen.p, f, 44).map(snap);
    join(target, yaw);
    run(12, { pitch: 0 }); gates.push(samples.length - 1 - Math.round(12 / STEP)); run(12, { pitch: 0 });
    samples[gates[gates.length - 1]].gate = true;
  } else if (move === 'close') {
    // through a point beside the lap, then onto the start straight from behind
    const start = [0, START_HEIGHT, 70];
    if (a && a.points) for (const [p, yawDeg] of a.points) join(p, yawDeg * D, {}, a.tension || 1);
    join(start, 0, {}, (a && a.tension) || 1);
    run(70 - STEP, { pitch: 0 });
  }
}

const N = samples.length;
// the road widens and narrows over 30 m, never in a step (a step is a wall across the road)
{ const half = samples.map(s => s.half); samples.forEach((s, i) => { let t = 0; for (let o = -7; o <= 7; o++) t += half[(i + o + N) % N]; s.half = t / 15; }); }
const lapLength = samples.reduce((s, q, i) => s + Math.hypot(...[0, 1, 2].map(k => samples[(i + 1) % N].p[k] - q.p[k])), 0);

// ------------------------------------------------------------------ what the lap looks like
const lowest = Math.min(...samples.map(s => s.p[1])), highest = Math.max(...samples.map(s => s.p[1]));
let closest = Infinity, closestAt = null;
for (let i = 0; i < N; i += 2) for (let j = i + 2; j < N; j += 2) {
  if (Math.min(j - i, N - (j - i)) * STEP < 70) continue;
  const d = Math.hypot(...[0, 1, 2].map(k => samples[i].p[k] - samples[j].p[k]));
  if (d < closest) { closest = d; closestAt = [i, j]; }
}
const gapToStart = Math.hypot(...[0, 1, 2].map(k => samples[N - 1].p[k] - samples[0].p[k]));
console.log(`Lap ${Math.round(lapLength)} m, ${N} cross-sections, from ${lowest.toFixed(1)} m to ${highest.toFixed(1)} m; last section ${gapToStart.toFixed(2)} m from the first`);
console.log(`Closest two stretches: ${closest.toFixed(1)} m apart (moves ${samples[closestAt[0]].move} and ${samples[closestAt[1]].move}, at ${samples[closestAt[0]].p.map(v => v.toFixed(0))} and ${samples[closestAt[1]].p.map(v => v.toFixed(0))})`);
console.log('Gates at', gates.map(i => samples[i].p.map(v => +v.toFixed(2)).join(' ') + ' heading ' + Math.round(Math.atan2(samples[i].f[0], -samples[i].f[2]) / D)).join(' | '));
const moveEnds = {}; samples.forEach((s, i) => { moveEnds[s.move] = i; });
console.log('Moves end at', Object.entries(moveEnds).map(([m, i]) => `${m}:${LAYOUT[m - 1] ? LAYOUT[m - 1][0] : 'start'}(${samples[i].p.map(v => v.toFixed(0)).join(',')})`).join(' '));
module.exports = { samples, gates, lapLength, STEP, HALF, START_HEIGHT };
if (process.argv.includes('--check') || require.main !== module) return;

// ------------------------------------------------------------------ mesh
const parts = {};
const tri = (mesh, material, a, b, c) => { ((parts[mesh] ??= {})[material] ??= []).push(...a, ...b, ...c); };
function quad(mesh, material, a, b, c, d, towards) {
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]);
  if (dot(n, towards) >= 0) { tri(mesh, material, a, b, c); tri(mesh, material, a, c, d); } else { tri(mesh, material, a, c, b); tri(mesh, material, a, d, c); }
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
// The parts are placed at the start line: heights are counted from there
const local = s => ({ ...s, p: [s.p[0], s.p[1] - START_HEIGHT, s.p[2]] });
const S = samples.map(local), ROAD = NAME + 'Road';
const at = (s, across, up) => add(add(s.p, s.r, across), s.u, up);
const wallOf = s => WALL_H + 3 * Math.min(1, Math.abs(s.r[1]) * 1.3);
for (let i = 0; i < N; i++) {
  const a = S[i], b = S[(i + 1) % N];
  if (a.gap) continue;
  const down = [-a.u[0], -a.u[1], -a.u[2]];
  // the asphalt in two lanes, an edge line, then the walls; stunts are painted red and white
  const paint = a.loop || Math.abs(a.u[1]) < 0.9 ? (Math.floor(i / 3) % 2 ? 'RoadEdgeRed' : 'RoadEdgeWhite') : 'RoadEdgeWhite';
  for (const [u0, u1, m] of [[-1, -0.94, paint], [-0.94, 0, 'Road'], [0, 0.94, 'Road'], [0.94, 1, paint]])
    quad(ROAD, m, at(a, u0 * a.half, 0), at(a, u1 * a.half, 0), at(b, u1 * b.half, 0), at(b, u0 * b.half, 0), a.u);
  for (const s of [-1, 1]) {
    const out = [a.r[0] * s, a.r[1] * s, a.r[2] * s], inward = [-out[0], -out[1], -out[2]];
    const e = q => s * q.half, w = q => s * (q.half + WALL);
    const ha = wallOf(a), hb = wallOf(b);                             // the walls grow with the banking
    quad(ROAD, 'RoadBarrier', at(a, e(a), 0), at(a, e(a), ha), at(b, e(b), hb), at(b, e(b), 0), inward);
    quad(ROAD, 'RoadBarrier', at(a, e(a), ha), at(a, w(a), ha), at(b, w(b), hb), at(b, e(b), hb), a.u);
    quad(ROAD, 'RoadBarrier', at(a, w(a), ha), at(a, w(a), -SLAB), at(b, w(b), -SLAB), at(b, w(b), hb), out);
  }
  quad(ROAD, 'RoadBarrier', at(a, -a.half - WALL, -SLAB), at(a, a.half + WALL, -SLAB), at(b, b.half + WALL, -SLAB), at(b, -b.half - WALL, -SLAB), down);
  // the open ends of a jump are closed
  const before = S[(i - 1 + N) % N];
  if (before.gap) quad(ROAD, 'RoadEdgeRed', at(a, -a.half - WALL, -SLAB), at(a, a.half + WALL, -SLAB), at(a, a.half + WALL, 0), at(a, -a.half - WALL, 0), [-a.f[0], -a.f[1], -a.f[2]]);
  if (b.gap) quad(ROAD, 'RoadEdgeRed', at(b, -b.half - WALL, -SLAB), at(b, b.half + WALL, -SLAB), at(b, b.half + WALL, 0), at(b, -b.half - WALL, 0), b.f);
}
// pillars under the level stretches, where nothing passes below
const PLAIN = -START_HEIGHT - 12;
for (let i = 0; i < N; i += 14) {
  const s = S[i];
  if (s.gap || s.loop || s.u[1] < 0.93) continue;
  let clear = true;
  for (let j = 0; j < N && clear; j += 2) if (Math.min(Math.abs(j - i), N - Math.abs(j - i)) > 12 && S[j].p[1] < s.p[1] - 1 && Math.hypot(S[j].p[0] - s.p[0], S[j].p[2] - s.p[2]) < S[j].half + 4) clear = false;
  if (clear) box(ROAD, 'RoadBarrier', s.p[0] - 0.7, PLAIN, s.p[2] - 0.7, s.p[0] + 0.7, s.p[1] - SLAB, s.p[2] + 0.7);
}
// lines painted across the road at the start, the gates and the finish, a hair above the asphalt (level stretches)
const paintAcross = (i, depth, along, material, lanes = 1) => {
  const s = S[i];
  for (let k = 0; k < lanes; k++) { const u0 = -s.half + k * 2 * s.half / lanes, u1 = u0 + 2 * s.half / lanes, m = typeof material === 'function' ? material(k) : material;
    quad(ROAD, m, add(at(s, u0, 0.012), s.f, along), add(at(s, u1, 0.012), s.f, along), add(at(s, u1, 0.012), s.f, along + depth), add(at(s, u0, 0.012), s.f, along + depth), s.u); }
};
const finishIndex = N - Math.round(20 / STEP);
paintAcross(0, 0.6, -0.3, 'StartLine');
for (const g of gates) paintAcross(g, 1.0, -0.5, 'Checkpoint');
for (let r = 0; r < 2; r++) paintAcross(finishIndex, 0.9, r * 0.9 - 0.9, k => ((k + r) % 2 ? 'FinishWhite' : 'FinishBlack'), 10);

// ---- start line, checkpoint and finish parts (road along z): the gantries; their own lines stay under the road
const W = HALF + WALL, LINE_Y = -0.4;
const lineAcross = (mesh, material, depth) => quad(mesh, material, [-HALF, LINE_Y, -depth / 2], [HALF, LINE_Y, -depth / 2], [HALF, LINE_Y, depth / 2], [-HALF, LINE_Y, depth / 2], [0, 1, 0]);
function gantry(mesh, banner) {
  const post = W + 1.2;
  for (const s of [-1, 1]) box(mesh, 'RoadBarrier', s * post - 0.3, -SLAB, -0.3, s * post + 0.3, 6.4, 0.3);
  box(mesh, banner, -post, 5.4, -0.2, post, 6.4, 0.2);
}
lineAcross(NAME + 'Start', 'StartLine', 0.6);
lineAcross(NAME + 'Checkpoint', 'Checkpoint', 1.0); gantry(NAME + 'Checkpoint', 'Checkpoint');
lineAcross(NAME + 'Finish', 'FinishWhite', 0.9); gantry(NAME + 'Finish', 'Finish');

// ------------------------------------------------------------------ the glb
const MATERIALS = { Road: [0.2957, 0.2957, 0.2957], RoadEdgeRed: [0.8, 0.0323, 0.0127], RoadEdgeWhite: [0.8, 0.8, 0.8], RoadBarrier: [0.33, 0.35, 0.38], StartLine: [0.8, 0.8, 0.8], Checkpoint: [0.76, 0.52, 0.02], FinishWhite: [0.8, 0.8, 0.8], FinishBlack: [0.01, 0.01, 0.012], Finish: [0.64, 0.02, 0.02] };
const gltf = { asset: { version: '2.0', generator: 'GoofyTrack make_stunt.js' }, scene: 0, scenes: [{ name: NAME, nodes: [] }], nodes: [], meshes: [], materials: Object.entries(MATERIALS).map(([name, rgb]) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 } })), accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
const chunks = []; let offset = 0;
for (const [name, byMaterial] of Object.entries(parts)) {
  const primitives = [];
  for (const [material, positions] of Object.entries(byMaterial)) {
    const data = Buffer.from(new Float32Array(positions).buffer), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
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
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, KEY + '.glb'), Buffer.concat([head, jh, json, bh, bin]));

// ------------------------------------------------------------------ the json (same shape as the circuits': patch_bundle.js and tools/circuit_track.js read it)
const LEVEL = Math.round((START_HEIGHT - lowest) / GRID) + 3;            // the lowest point of the lap is 15 m above the plain
const cells = new Set();
for (const s of S) for (const u of [-s.half, 0, s.half]) { const q = at(s, u, 0); cells.add(Math.round(q[0] / 20) + ',' + Math.round(q[2] / 20)); }
const gateOf = i => { const s = S[i]; return { gx: Math.round(s.p[0] / GRID), gy: LEVEL + Math.round(s.p[1] / GRID), gz: Math.round(s.p[2] / GRID), rotation: Math.abs(s.f[0]) > 0.5 ? 1 : 0 }; };
const checkpoints = gates.map(gateOf), finish = gateOf(finishIndex);
const gateCells = new Set([[0, 0], ...[...checkpoints, finish].map(c => [c.gx, c.gz])].map(([gx, gz]) => Math.round(gx * GRID / 20) + ',' + Math.round(gz * GRID / 20)));
fs.writeFileSync(path.join(OUT, KEY + '.json'), JSON.stringify({
  ids: IDS, lapLength: Math.round(lapLength), roadHalfWidth: HALF, gateWidth: 2 * W + 6, level: LEVEL, finish, checkpoints,
  roadCells: [...cells].filter(c => !gateCells.has(c)).map(c => c.split(',').map(Number)),
  // the line of the road, one point every STEP: [x, y, z] from the start line, and the road's up vector
  fine: S.map(s => [...s.p.map(v => +v.toFixed(2)), ...s.u.map(v => +v.toFixed(3))]),
}));
const triangles = Object.values(parts[ROAD]).reduce((s, a) => s + a.length / 9, 0);
console.log(`Road: ${triangles} triangles; start line at level ${LEVEL}; gates ${JSON.stringify(checkpoints)}; finish ${JSON.stringify(finish)}`);
console.log('Written to ' + OUT);
