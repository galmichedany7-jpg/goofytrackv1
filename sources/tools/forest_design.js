// Forest Speedway: a Grand Prix circuit drawn by hand in a wooded valley under the mountains, in the spirit of
// Trial Mountain (Gran Turismo): a figure of eight whose second half crosses the first on a bridge, the road
// climbing and dropping through the hills, cuttings in the rock. From Monza and Paul Ricard: the main straight
// with its painted grid and the pit lane beside it, gravel traps on the outside of the big stops. Not a real
// place: this file writes what the map tools would have made for one, and tools/make_circuit.js builds it.
//
//   node tools/forest_design.js      writes tools/forest_line.json (the centreline, its heights, run-off areas,
//                                    the bridge, the pit lane, the grid) and tools/forest_osm.json (the forest,
//                                    the pits, the paddock, a lake)
//   node tools/forest_design.js --svg plan.svg    the same, and the plan seen from above (heights every 100 m)
//   node tools/make_circuit.js forest
//
// Everything is in metres, x to the east and z to the south; the lap starts at the origin, heading north.
// The lap is a turtle walk: straights and arcs. Two of its straights (heading west and north) are left open and
// solved so that the lap closes on itself; the turns of a figure of eight add up to nothing.
const fs = require('fs');
const path = require('path');

const STEP = 5;                   // metres between two points of the line
// [kind, ...]: S straight (length), R / L arc to the right / left (degrees, radius), B and F the two straights
// solved to close the lap. Options: `sand` a gravel trap on the outside of that piece (width in metres; it starts
// `before` metres earlier, in the braking zone, and fades out `after` metres later); `h` the height of the road
// at the end of the piece (between two of them it climbs or drops evenly); `verge` a narrower verge on that piece
// (the mountain road, between rock and barrier); `tunnel` the piece runs through the mountain
const MOUNTAIN = { verge: 3 };
// A spin (tools/make_circuit.js): the road rolls the car right round, up a wall, upside down and back, along a
// helix that comes out 50 m to one side. On the map it is a step to the left made of two tight bends, which only
// says where the road before it stops and the road after it starts: `spin` pieces are not built as road.
// The longer the step between the two bends, the more the spin rolls the car round rather than along (55 degrees
// to its axis rolls it best: the car hardly has to steer), and the wider it is.
const SPIN = (step, o = {}) => [['L', 90, 18.5, { spin: true }], ['S', step, { spin: true }], ['R', 90, 18.5, { spin: true, ...o }]];
const SEG = [
  ['S', 280],                                                                                   // main straight: the grid, the pits
  ['R', 90, 32, { sand: 30, before: 70, after: 8, h: 5 }],                                      // T1
  ['S', 60],
  ['R', 90, 40, { sand: 24, before: 40, after: 10, h: 8 }],                                     // T2, at the top of a rise
  ['S', 40],
  ['L', 50, 40], ['R', 95, 34, { sand: 18, before: 20, after: 10 }], ['L', 95, 34, { sand: 18, before: 20, after: 10 }], ['R', 50, 40, { h: 4 }],   // the esses, downhill
  ['S', 150],
  ...SPIN(30, { h: 2 }),                                                                        // the first spin, off to the left
  ['S', 330],                                                                                   // into the valley, under the bridge
  ['L', 90, 35, { sand: 26, before: 80, after: 8, h: 0 }],                                      // the hairpin at the bottom
  ['S', 60, { h: 1 }],
  // up the mountain: three legs joined by two hairpins, then through it in a tunnel
  ['S', 160, { ...MOUNTAIN, h: 12 }],
  ['R', 180, 24, { ...MOUNTAIN, h: 12 }],
  ['S', 130, { ...MOUNTAIN, h: 22 }],
  ['L', 180, 24, { ...MOUNTAIN, h: 22 }],
  ['S', 200, { ...MOUNTAIN, h: 32 }],
  ['L', 90, 30, { ...MOUNTAIN, sand: 16, before: 50, after: 6, h: 33 }],
  ['S', 150, { ...MOUNTAIN, tunnel: true, h: 32 }],                                             // the tunnel under the summit
  ['R', 45, 32, { sand: 18, before: 40, after: 8 }], ['L', 45, 32, { sand: 18, before: 20, after: 8, h: 27 }],   // out of it, a flick right and left
  ['S', 30],
  ['L', 90, 40, { sand: 24, before: 60, after: 10, h: 24 }],
  ['S', 70],
  ['R', 30, 45, { sand: 16, before: 5, after: 6 }], ['L', 30, 45, { sand: 16, before: 20, after: 6, h: 18 }],   // a last flick before the descent
  ['S', 60],
  ...SPIN(30, { h: 14 }),                                                                        // the second spin, at the top of the descent
  ['B'],                                                                                       // down to the bridge, over the valley road
  ['R', 90, 45, { sand: 22, before: 60, after: 10, h: 5 }],                                     // the last corner
  ['F'],
];
const GRID = { first: 8, gap: 8, side: 4.5, slots: 16 };    // painted grid boxes behind the start line: the pole's 8 m back, then one every 8 m, staggered
const START_H = 5;                                           // height of the main straight
const VERGE = 7;                                             // grass between the kerb and the barrier, metres
const BRIDGE = { low: 0, high: 9.5, flat: 75, blend: 70 };   // the two roads at the crossing: level for 75 m either side
// the pit lane, on the left of the main straight: [metres before the start line, after it] where it runs beside
// the road at full offset, its taper at each end, its offset from the centreline and half width
const PIT = { from: -130, to: 120, taper: 50, offset: 28, half: 6 };

const dir = t => [Math.sin(t * Math.PI / 180), -Math.cos(t * Math.PI / 180)];
const opt = s => (typeof s[s.length - 1] === 'object' ? s[s.length - 1] : {});
function walk(B, F) {
  let x = 0, z = 0, th = 0;
  const pts = [[0, 0]], pieces = [];
  for (const s of SEG) {
    const from = pts.length - 1;
    if (s[0] === 'S' || s[0] === 'B' || s[0] === 'F') {
      const L = s[0] === 'B' ? B : s[0] === 'F' ? F : s[1], n = Math.max(1, Math.round(L / STEP)), d = dir(th);
      for (let k = 1; k <= n; k++) pts.push([x + d[0] * L * k / n, z + d[1] * L * k / n]);
      x += d[0] * L; z += d[1] * L;
    } else {
      const sg = s[0] === 'R' ? 1 : -1, [, a, r] = s, n = Math.max(2, Math.round(a * Math.PI / 180 * r / STEP));
      const c = dir(th + sg * 90), cx = x + c[0] * r, cz = z + c[1] * r;
      for (let k = 1; k <= n; k++) { const d = dir(th + sg * a * k / n - sg * 90); pts.push([cx + d[0] * r, cz + d[1] * r]); }
      [x, z] = pts[pts.length - 1]; th += sg * a;
    }
    pieces.push({ seg: s, from, to: pts.length - 1 });
  }
  return { pts, pieces, x, z, th };
}
// the end of the lap moves linearly with the two open straights: solve for the end at the origin
const w0 = walk(0, 0), wb = walk(1, 0), wf = walk(0, 1);
const dB = [wb.x - w0.x, wb.z - w0.z], dF = [wf.x - w0.x, wf.z - w0.z], det = dB[0] * dF[1] - dB[1] * dF[0];
const Bl = (-w0.x * dF[1] + w0.z * dF[0]) / det, Fl = (-dB[0] * w0.z + dB[1] * w0.x) / det;
if (Math.abs(w0.th) > 1e-9) throw new Error('The turns add up to ' + w0.th + ' degrees, not 0');
if (Bl < 150 || Fl < 60) throw new Error(`The lap does not close with straights long enough (${Bl.toFixed(0)} m, ${Fl.toFixed(0)} m)`);
const { pts, pieces } = walk(Bl, Fl);
pts.pop();                                                                 // the last point is the first one again
const N = pts.length;
const along = [0];
for (let i = 1; i <= N; i++) along.push(along[i - 1] + Math.hypot(pts[i % N][0] - pts[i - 1][0], pts[i % N][1] - pts[i - 1][1]));
const length = along[N];

// ------------------------------------------------------------------ the crossing
// where the two halves of the eight cross: the valley road (first) under the bridge (second)
let cross = null;
for (let i = 0; i < N; i++) for (let j = i + 20; j < N; j++) {
  const a = pts[i], b = pts[(i + 1) % N], c = pts[j], d = pts[(j + 1) % N];
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(den) < 1e-9) continue;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  if (t >= 0 && t < 1 && u >= 0 && u < 1) { if (cross) throw new Error('The lap crosses itself more than once'); cross = { low: i, high: j, at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }; }
}
if (!cross) throw new Error('The lap does not cross itself: no bridge');
const turnNear = i => { for (let o = -BRIDGE.flat / STEP; o <= BRIDGE.flat / STEP; o++) { const p = pieces.find(q => q.from <= (i + o + N) % N && (i + o + N) % N < q.to); if (p && (p.seg[0] === 'L' || p.seg[0] === 'R')) return true; } return false; };
if (turnNear(cross.low) || turnNear(cross.high)) { if (process.argv[2] === '--svg') console.warn('The crossing is too close to a corner'); else throw new Error('The crossing is too close to a corner'); }

// ------------------------------------------------------------------ heights
// the heights given at the ends of pieces and the two roads level at the crossing, joined evenly by distance,
// then rounded off (the level stretches stay level)
const lapDistance = (i, j) => { const d = Math.abs(along[i] - along[j]); return Math.min(d, length - d); };
const level = [[cross.low, BRIDGE.low], [cross.high, BRIDGE.high]].map(([i, h]) => ({ from: along[i] - BRIDGE.flat, to: along[i] + BRIDGE.flat, h }));
const keys = [[0, START_H]];
for (const p of pieces) if (opt(p.seg).h != null && !level.some(l => along[p.to] > l.from - 40 && along[p.to] < l.to + 40)) keys.push([along[p.to], opt(p.seg).h]);
for (const l of level) keys.push([l.from, l.h], [l.to, l.h]);
keys.push([length, START_H]);
keys.sort((a, b) => a[0] - b[0]);
const keyed = s => { for (let k = 0; k + 1 < keys.length; k++) if (s >= keys[k][0] && s <= keys[k + 1][0]) { const [a, ha] = keys[k], [b, hb] = keys[k + 1]; return b > a ? ha + (hb - ha) * (s - a) / (b - a) : hb; } return START_H; };
let heights = pts.map((_, i) => keyed(along[i]));
for (let pass = 0; pass < 4; pass++) heights = heights.map((v, i) => { let t = 0; for (let o = -6; o <= 6; o++) t += heights[(i + o + N) % N]; return t / 13; });
const ease = t => t * t * (3 - 2 * t);
for (const l of [...level, { from: -250, to: 250, h: START_H }, { from: length - 250, to: length + 250, h: START_H }]) heights = heights.map((v, i) => {
  const d = Math.max(l.from - along[i], along[i] - l.to);                // < 0 inside the level stretch
  return d <= -30 ? l.h : d >= 0 ? v : l.h + (v - l.h) * ease((d + 30) / 30);
});
let steepest = 0;
for (let i = 0; i < N; i++) steepest = Math.max(steepest, Math.abs(heights[(i + 1) % N] - heights[i]) / (along[i + 1] - along[i]));

// ------------------------------------------------------------------ run-off areas
// gravel traps, as ranges of point indices: [from, to, side (-1 left, 1 right), width]
const runoffs = pieces.filter(p => opt(p.seg).sand).map(p => {
  const o = opt(p.seg), side = p.seg[0] === 'R' ? -1 : 1;                  // the outside of the corner
  return [(p.from - Math.round(o.before / STEP) + N) % N, (p.to + Math.round(o.after / STEP)) % N, side, o.sand];
});
// the spins, as ranges of points [from, to]: the last point of the road before one, the first of the road after it
const spins = [];
for (const p of pieces) if (opt(p.seg).spin) { const last = spins[spins.length - 1]; if (last && last[1] === p.from) last[1] = p.to; else spins.push([p.from, p.to]); }
// ranges of points [from, to, side (0 both), width] where the grass verge differs from VERGE: none on the bridge,
// a narrow one along the pit wall
const span = (i, metres) => [(i - Math.round(metres / STEP) + N) % N, (i + Math.round(metres / STEP)) % N];
// (the narrow verge of the mountain road as one range, the tunnel's narrower one in it: each range fades in and out)
const narrow = pieces.filter(p => opt(p.seg).verge != null);
const verges = [
  ...(narrow.length ? [[narrow[0].from, narrow[narrow.length - 1].to + 3, 0, MOUNTAIN.verge]] : []),
  ...pieces.filter(p => opt(p.seg).tunnel).map(p => [p.from - 3, p.to + 3, 0, 1]),
  [...span(cross.high, BRIDGE.flat - 15), 0, 0],
  [(N + Math.round(PIT.from / STEP) - Math.round(PIT.taper / STEP)) % N, Math.round((PIT.to + PIT.taper) / STEP), -1, 2],
];
// the tunnel, as a range of points, and the mountain it goes through: a peak over its middle, its slopes down to
// the switchbacks (heights as the road's, above the valley's floor)
const bore = pieces.find(p => opt(p.seg).tunnel), tunnel = bore && [bore.from, bore.to];
const summit = bore && pts[Math.round((bore.from + bore.to) / 2)];
const mountains = bore ? [{ at: summit.map(v => +v.toFixed(1)), height: 95, radius: 230 }] : [];
const pit = { from: (N + Math.round(PIT.from / STEP)) % N, to: Math.round(PIT.to / STEP), taper: PIT.taper / STEP, side: -1, offset: PIT.offset, half: PIT.half };
// the bridge: the stretch of the upper road that stands on it, and round the crossing, where the two roads need no room from each other
const bridge = { high: span(cross.high, BRIDGE.flat - 30), low: span(cross.low, BRIDGE.flat - 30), zone: { high: span(cross.high, 140), low: span(cross.low, 140) }, at: cross.at.map(v => +v.toFixed(2)) };

// ------------------------------------------------------------------ the surroundings
const bounds = pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const distanceToLap = (x, z) => { let d = Infinity; for (const p of pts) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z)); return d; };
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// the paddock, west of the pit lane: the pit garages along it, the control tower, the teams' motorhomes behind
const pitOut = -(PIT.offset + PIT.half + 1.5);
const buildings = [
  { p: rect(pitOut - 16, PIT.from + 10, pitOut, PIT.to - 10).map(([x, z]) => [x, -z]), levels: 2, name: 'Pits' },
  { p: rect(pitOut - 16, -PIT.to - 40, pitOut - 2, -PIT.to - 22), levels: 9, name: 'Tower' },
];
for (let k = 0; k < 10; k++) buildings.push({ p: rect(pitOut - 46, -PIT.to + 20 + k * 30, pitOut - 28, -PIT.to + 36 + k * 30), levels: 2 });   // motorhomes
// the forest all round, with a clearing for the paddock
const M = 700, [bx0, bz0, bx1, bz1] = [bounds[0] - M, bounds[1] - M, bounds[2] + M, bounds[3] + M];
const cl = [pitOut - 70, -PIT.to - 100, 70, -PIT.from + 90];      // the paddock and, across the straight, the main grandstands
const woods = [[[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1], [bx0, cl[3]], [cl[0], cl[3]], [cl[0], cl[1]], [cl[2], cl[1]], [cl[2], cl[3]], [bx0, cl[3]]]];
// a lake in the loop of the eight, wherever it fits best
let lake = null;
for (let x = bounds[0]; x <= bounds[2]; x += 10) for (let z = bounds[1]; z <= bounds[3]; z += 10) {
  const d = distanceToLap(x, z);
  // inside the second loop: a ray to the east meets its road an odd number of times
  let c = 0; for (let i = cross.low; i < cross.high; i++) { const a = pts[i], b = pts[i + 1]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c++; }
  if (c % 2 === 1 && (lake == null || d > lake.d)) lake = { x, z, d };
}
const R = Math.min(90, lake.d - 55), lakeRing = [];
for (let k = 0; k < 24; k++) { const a = k / 24 * 2 * Math.PI, r = R * (0.85 + 0.15 * Math.sin(3 * a)); lakeRing.push([+(lake.x + Math.cos(a) * r * 1.3).toFixed(1), +(lake.z + Math.sin(a) * r).toFixed(1)]); }
const lakeFits = R > 25 && lakeRing.every(p => distanceToLap(p[0], p[1]) > 40);

fs.writeFileSync(path.join(__dirname, 'forest_line.json'), JSON.stringify({
  source: 'Forest Speedway: drawn by tools/forest_design.js',
  metres: pts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]),
  heights: heights.map(h => +h.toFixed(2)),
  runoffs, verge: VERGE, verges, bridge, pit, tunnel, mountains, spins, grid: GRID, paddock: cl,
  lake: lakeFits ? { at: [lake.x, lake.z], radius: R } : null,
}));
fs.writeFileSync(path.join(__dirname, 'forest_osm.json'), JSON.stringify({
  source: 'Forest Speedway: an imaginary place, drawn by tools/forest_design.js',
  origin: [0, 0], lap: [], lapStreets: [],
  buildings, streets: [], water: lakeFits ? [{ area: lakeRing }] : [], rails: [], parks: [], woods,
  landmarks: { pits: buildings[0].p, tower: buildings[1].p },
}));
console.log(`Lap ${length.toFixed(0)} m (${N} points), open straights ${Bl.toFixed(0)} m and ${Fl.toFixed(0)} m, main straight ${(Fl + SEG[0][1]).toFixed(0)} m; `
  + `${runoffs.length} gravel traps; crossing at ${cross.at.map(v => v.toFixed(0))} (${(along[cross.low]).toFixed(0)} m and ${(along[cross.high]).toFixed(0)} m into the lap); `
  + `heights ${Math.min(...heights).toFixed(1)} to ${Math.max(...heights).toFixed(1)} m, steepest ${(steepest * 100).toFixed(1)} %; lake ${lakeFits ? `at ${lake.x.toFixed(0)}, ${lake.z.toFixed(0)}, ${R.toFixed(0)} m` : 'left out'}`);
if (process.argv[2] === '--svg') {
  const [x0, z0, x1, z1] = bounds, pad = 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}" height="440" style="background:#cfe0c0">`
    + `<polyline fill="none" stroke="#444" stroke-width="18" points="${pts.concat([pts[0]]).map(p => p.join(',')).join(' ')}"/>`
    + runoffs.map(([a, b, side]) => { const list = []; for (let i = a; i !== b; i = (i + 1) % N) list.push(pts[i]); return `<polyline fill="none" stroke="#c9a060" stroke-width="6" points="${list.map(p => p.join(',')).join(' ')}"/>`; }).join('')
    + pts.filter((_, i) => i % 20 === 0).map((p, k) => `<text x="${p[0] + 12}" y="${p[1]}" font-size="14">${heights[k * 20].toFixed(0)}</text>`).join('')
    + `<circle cx="${cross.at[0]}" cy="${cross.at[1]}" r="14" fill="red"/><circle cx="0" cy="0" r="10" fill="white"/>`
    + (lakeFits ? `<polygon fill="#58a" points="${lakeRing.map(p => p.join(',')).join(' ')}"/>` : '') + buildings.map(b => `<polygon fill="#888" points="${b.p.map(p => p.join(',')).join(' ')}"/>`).join('') + '</svg>';
  fs.writeFileSync(process.argv[3], svg);
}
if (process.argv[2] === '--pieces') for (const p of pieces) console.log(p.seg[0], p.seg[1] != null && typeof p.seg[1] !== 'object' ? p.seg[1] : '', (along[p.from] / length).toFixed(3), (along[Math.min(p.to, N)] / length).toFixed(3), opt(p.seg).sand ? 'sand' : '', opt(p.seg).tunnel ? 'tunnel' : '', opt(p.seg).spin ? 'spin' : '');
