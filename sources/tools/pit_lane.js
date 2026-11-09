// The pit lane of a circuit, the same for every circuit builder (tools/make_circuit.js, tools/make_monaco.js): its
// shape along the road, its asphalt and walls, and what the game needs to know about it.
//
// A pit lane runs beside the road, on one side (side: -1 left, 1 right). Every cross-section of the road has a
// profile p: null where there is no pit lane, from 0 at the far end of a taper up to 1 along the pits. Over the
// first half of a taper (the mouth) the lane opens from the back of the road's barrier, which is not built there;
// over the second half its inner edge moves away from the road, to `inner` metres from the centreline, or stays
// against the road's barrier when `inner` is null (that barrier is then the pit wall). Its outer edge is `outer`
// metres from the centreline, with a wall behind it.
//
// The pits only open in the endurance races (apex-room.js): the builders make two roads, one closed at the mouths
// for every other mode, and one open, which the physics and the drawing get during those races.
const ease = t => t * t * (3 - 2 * t);

// p at each of `count` cross-sections, the pits running at full width from cross-section `from` to `to` (in lap
// order, either may be negative: counted back from the start line), with tapers of taperIn and taperOut
// cross-sections before and after
function profile(count, from, to, taperIn, taperOut = taperIn) {
  const out = new Array(count).fill(null);
  for (let k = from - taperIn; k <= to + taperOut; k++) out[((k % count) + count) % count] = Math.min(1, (k - from + taperIn) / taperIn, (to + taperOut - k) / taperOut);
  return out;
}

// [inner edge, outer edge] of the lane at a cross-section c (its back of the barrier: c.w(side)) with profile p
function edges(pit, c, p) {
  const w = c.w(pit.side), inner = pit.inner == null ? w : pit.inner;
  return [p < 0.5 ? w : w + (inner - w) * ease((p - 0.5) * 2), w + (pit.outer - w) * ease(Math.min(1, p * 2))];
}

// is the road from a cross-section of profile pa to the next one (pb) the mouth of the lane? The road's barrier
// on that side is left out of the open road there
const mouth = (pa, pb) => pa != null && pb != null && pa < 0.5 && pb < 0.5;

// the lane from cross-section a (profile pa) to the next one b (pb): its asphalt, a white line along its outer wall,
// that wall and, once the lane leaves the road, a wall on its inner side. quad(material, a0, a1, b1, b0, towards)
// as the builders have it, wall: { thick, high }
function lane(pit, quad, a, b, pa, pb, wall) {
  const s = pit.side, out = [a.n[0] * s, 0, a.n[2] * s], inward = [-out[0], 0, -out[2]];
  const [ia, oa] = edges(pit, a, pa), [ib, ob] = edges(pit, b, pb);
  const strip = (material, u0a, u1a, y0, u0b, u1b, y1, towards) => quad(material, a.at(s * u0a, y0), a.at(s * u1a, y1), b.at(s * u1b, y1), b.at(s * u0b, y0), towards);
  strip('Road', ia, oa, 0, ib, ob, 0, [0, 1, 0]);
  if (oa - ia > 1 && ob - ib > 1) strip('RoadEdgeWhite', oa - 0.4, oa, 0.01, ob - 0.4, ob, 0.01, [0, 1, 0]);
  strip('RoadBarrier', oa, oa, 0, ob, ob, wall.high, inward);
  strip('RoadBarrier', oa, oa + wall.thick, wall.high, ob, ob + wall.thick, wall.high, [0, 1, 0]);
  strip('RoadBarrier', oa + wall.thick, oa + wall.thick, wall.high, ob + wall.thick, ob + wall.thick, -8, out);
  if (pit.inner != null && (pa > 0.5 || pb > 0.5)) {
    strip('RoadEdgeWhite', ia, ia + 0.4, 0.01, ib, ib + 0.4, 0.01, [0, 1, 0]);
    strip('RoadBarrier', ia, ia, 0, ib, ib, wall.high, out);
    strip('RoadBarrier', ia - wall.thick, ia, wall.high, ib - wall.thick, ib, wall.high, [0, 1, 0]);
    strip('RoadBarrier', ia - wall.thick, ia - wall.thick, wall.high, ib - wall.thick, ib - wall.thick, -8, inward);
  }
}

// The teams of the garages: their colour (display RGB, 0 to 1) and its name. In an endurance race each driver gets a garage
// and only stops in its box (apex-room.js); the garages are dressed in these colours (apex-town.js, apex-monaco.js)
const TEAMS = [
  { rgb: [0.78, 0.08, 0.08], fr: 'rouge', en: 'red' }, { rgb: [0.10, 0.22, 0.62], fr: 'bleu', en: 'blue' },
  { rgb: [0.96, 0.50, 0.06], fr: 'orange', en: 'orange' }, { rgb: [0.04, 0.42, 0.30], fr: 'vert', en: 'green' },
  { rgb: [0.72, 0.74, 0.77], fr: 'argent', en: 'silver' }, { rgb: [0.95, 0.80, 0.08], fr: 'jaune', en: 'yellow' },
  { rgb: [0.38, 0.14, 0.55], fr: 'violet', en: 'purple' }, { rgb: [0.10, 0.55, 0.76], fr: 'cyan', en: 'cyan' },
  { rgb: [0.92, 0.92, 0.92], fr: 'blanc', en: 'white' }, { rgb: [0.16, 0.16, 0.18], fr: 'noir', en: 'black' },
];
const GARAGE = 13;                    // metres of pits per garage, its box painted in front of it 1 m in from either end

// The garages along the pits, in lap order: [from, to, team], metres along the pits from their first cross-section
// at full width (points: [x, z] of the cross-sections), perTeam garages in a row for each team
function garages(points, full, perTeam = 1) {
  let total = 0;
  for (let k = 1; k < full.length; k++) total += Math.hypot(points[full[k]][0] - points[full[k - 1]][0], points[full[k]][1] - points[full[k - 1]][1]);
  const n = Math.floor((total - 6) / GARAGE), out = [];
  for (let k = 0; k < n; k++) out.push([3 + k * GARAGE, 3 + k * GARAGE + GARAGE - 1.2, Math.floor(k / perTeam) % TEAMS.length]);
  return out;
}

// The pit lane in the circuit's json (apex-room.js finds the cars in it, apex-town.js and apex-monaco.js dress it):
// its side, the offsets of its edges along the pits (inner: the back of the road's barrier when the lane runs
// against it), the fronts of the garages, the cross-sections along which it runs at full width and those it
// covers with its tapers, in lap order, its garages (above) and the teams' colours
function record(pit, pitAt, points, perTeam = 1) {
  const n = pitAt.length, run = full => {
    const i0 = pitAt.findIndex((p, i) => full(p) && !full(pitAt[(i - 1 + n) % n])), out = [];
    for (let k = 0; k < n && full(pitAt[(i0 + k) % n]); k++) out.push((i0 + k) % n);
    return out;
  };
  const lane = run(p => p != null), full = run(p => p === 1);
  return { side: pit.side, inner: pit.inner, outer: pit.outer, front: pit.outer + 1.5, full, lane: [lane[0], lane[lane.length - 1]],
    garages: garages(points, full, perTeam).map(g => g.map(v => +v.toFixed(2))), teams: TEAMS };
}

module.exports = { ease, profile, edges, mouth, lane, record, TEAMS };
