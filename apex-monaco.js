// Apex Monaco: the town, harbour, sea and mountains around the Monaco circuit. Looks only.
//
// Everything is generated here, from the circuit's centreline (tracks/monaco.json, written by
// tools/make_monaco.js): no 3D model or texture is shipped. The same seed always gives the same town.
//
//   terrain     a flat town plateau around the road, rising to terraces in the north and to limestone
//               mountains behind; the sea in the south, with a harbour basin and clean quay walls
//   town        pastel buildings lining the road, high-rises further up, villas on the hills,
//               a casino square, grandstands along the start straight and the harbour
//   coast       a tunnel with a hotel on top along the sea front, pontoons, moored yachts,
//               a breakwater with its light, palm trees along the quays
//
// Coordinates are the circuit's own: metres, the road surface at y = 0, the start line at the origin,
// the plain of the game 5 m below. Nothing here is collided with: the road keeps its own barriers.
//
// window.ApexMonaco.build(circuit) returns { terrain, objects }, each { positions, colors } (linear RGB,
// one colour per vertex, flat triangles). apex-scenery.js turns them into meshes.
(() => {
  'use strict';

  const ROAD_CLEAR = 15.5;          // nothing stands closer than this to the centreline (barriers end at 8.9 m)
  const WATER_Y = -2.5;             // sea level (the game's plain is at -5)
  const QUAY_FOOT = -8;             // quay walls go down to here
  const SEED = 1929;                // first Monaco Grand Prix

  // ------------------------------------------------------------------ small maths
  function random(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); };
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.30 + noise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
  const ridged = (x, y) => { const n = 1 - Math.abs(2 * fbm(x, y) - 1); return n * n; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  // ------------------------------------------------------------------ colours (display sRGB)
  const C = {
    water: [0.10, 0.37, 0.56], pavement: [0.70, 0.68, 0.64], sidewalk: [0.80, 0.77, 0.71], plaza: [0.86, 0.80, 0.68],
    quay: [0.78, 0.73, 0.64], quayWall: [0.58, 0.55, 0.50], garden: [0.36, 0.52, 0.26], lawn: [0.45, 0.60, 0.30],
    maquis: [0.35, 0.42, 0.24], scrub: [0.50, 0.52, 0.36], rock: [0.60, 0.58, 0.53], rockDark: [0.49, 0.47, 0.43], summit: [0.69, 0.67, 0.63],
    walls: [[0.94, 0.85, 0.67], [0.96, 0.77, 0.60], [0.91, 0.67, 0.56], [0.97, 0.91, 0.75], [0.87, 0.57, 0.44], [0.98, 0.96, 0.91], [0.82, 0.74, 0.63], [0.93, 0.81, 0.81]],
    modern: [[0.88, 0.89, 0.90], [0.80, 0.83, 0.86], [0.93, 0.92, 0.88]],
    window: [0.22, 0.27, 0.34], glass: [0.32, 0.45, 0.56], shutter: [0.36, 0.52, 0.40],
    roof: [0.60, 0.58, 0.56], tiles: [0.73, 0.37, 0.24], awnings: [[0.75, 0.16, 0.14], [0.14, 0.32, 0.55], [0.17, 0.45, 0.30], [0.90, 0.88, 0.84]],
    casino: [0.95, 0.89, 0.74], dome: [0.42, 0.56, 0.50], gold: [0.82, 0.66, 0.30],
    standFrame: [0.55, 0.57, 0.60], seats: [[0.80, 0.16, 0.16], [0.95, 0.95, 0.95]], canopy: [0.94, 0.94, 0.94],
    hull: [0.97, 0.97, 0.97], deck: [0.70, 0.55, 0.38], stripe: [0.12, 0.20, 0.38], pontoon: [0.62, 0.52, 0.40],
    trunk: [0.52, 0.42, 0.30], frond: [[0.24, 0.46, 0.20], [0.30, 0.52, 0.22]], lamp: [1.0, 0.92, 0.70], tunnel: [0.40, 0.40, 0.42],
  };
  const lin = c => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

  // ------------------------------------------------------------------ mesh builder
  function Builder() {
    const P = [], K = [];
    const tri = (a, b, c, col) => {
      const l = lin(col);
      P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      K.push(l[0], l[1], l[2], l[0], l[1], l[2], l[0], l[1], l[2]);
    };
    // the visible side of a triangle / quad faces `towards`
    const facing = (a, b, c, towards) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return (uy * vz - uz * vy) * towards[0] + (uz * vx - ux * vz) * towards[1] + (ux * vy - uy * vx) * towards[2] >= 0;
    };
    const tri3 = (a, b, c, col, towards) => (facing(a, b, c, towards) ? tri(a, b, c, col) : tri(a, c, b, col));
    const quad = (a, b, c, d, col, towards) => { tri3(a, b, c, col, towards); tri3(a, c, d, col, towards); };
    const done = () => ({ positions: new Float32Array(P), colors: new Float32Array(K), triangles: P.length / 9 });
    return { tri, tri3, quad, done, count: () => P.length / 9 };
  }
  const UP = [0, 1, 0], DOWN = [0, -1, 0];

  // ------------------------------------------------------------------ the circuit
  function circuit(data) {
    const pts = data.waypoints;
    const n = pts.length;
    const spacing = data.lapLength / n;
    // the road crosses itself once: the second passage climbs onto a bridge (same profile as make_monaco.js)
    const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let cross = null;
    for (let i = 0; i < n && cross == null; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) { cross = [i, j]; break; }
    }
    const ease = t => t * t * (3 - 2 * t);
    const height = pts.map((_, i) => {
      if (cross == null) return 0;
      const [first, second] = cross, from = first + Math.round(12 / spacing), descent = Math.round(120 / spacing);
      if (i > from && i <= second) return data.bridgeHeight * ease((i - from) / (second - from));
      if (i > second && i < second + descent) return data.bridgeHeight * (1 - ease((i - second) / descent));
      return 0;
    });
    // segments in a coarse grid, for distance queries
    const CELL = 40, grid = new Map();
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const z0 = Math.floor(Math.min(a[1], b[1]) / CELL), z1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x + ',' + z; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    }
    const segDist = (i, x, z) => {
      const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return { d: Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z), t };
    };
    // distance to the centreline, and the closest segment
    const nearest = (x, z) => {
      let best = { d: Infinity, i: 0, t: 0 };
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get((cx + i) + ',' + (cz + j)) || []) {
        const r = segDist(s, x, z);
        if (r.d < best.d) best = { d: r.d, i: s, t: r.t };
      }
      if (best.d <= CELL) return best;
      for (let s = 0; s < n; s++) { const r = segDist(s, x, z); if (r.d < best.d) best = { d: r.d, i: s, t: r.t }; }
      return best;
    };
    const tangent = i => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    // distances are asked for everywhere (terrain, colours, every building): read them from a raster
    // computed once, out to RASTER_REACH from the circuit; further away only "far" matters
    const RASTER_REACH = 170, STEP = 4;
    const rx0 = minX - RASTER_REACH, rz0 = minZ - RASTER_REACH;
    const cols = Math.ceil((maxX - minX + 2 * RASTER_REACH) / STEP) + 1, rows = Math.ceil((maxZ - minZ + 2 * RASTER_REACH) / STEP) + 1;
    const raster = new Float32Array(cols * rows);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) raster[i * rows + j] = nearest(rx0 + i * STEP, rz0 + j * STEP).d;
    const dist = (x, z) => {
      const u = (x - rx0) / STEP, v = (z - rz0) / STEP;
      if (u < 0 || v < 0 || u >= cols - 1 || v >= rows - 1) {
        const ox = Math.max(rx0 - x, x - (rx0 + (cols - 1) * STEP), 0), oz = Math.max(rz0 - z, z - (rz0 + (rows - 1) * STEP), 0);
        return RASTER_REACH + Math.hypot(ox, oz);
      }
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const a = raster[i * rows + j], b = raster[(i + 1) * rows + j], c = raster[i * rows + j + 1], d = raster[(i + 1) * rows + j + 1];
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    };
    // a point at a distance along the lap (metres from the start line), and the direction there
    const lap = [0];
    for (let i = 0; i < n; i++) lap.push(lap[i] + Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]));
    const along = s => {
      s = ((s % lap[n]) + lap[n]) % lap[n];
      let i = Math.min(n - 1, Math.floor(s / lap[n] * n));
      while (lap[i] > s) i--; while (lap[i + 1] < s) i++;
      const t = (s - lap[i]) / (lap[i + 1] - lap[i]), a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return { p: [a[0] + dx * t, a[1] + dz * t], t: [dx / l, dz / l], i };
    };
    return { pts, n, height, nearest, tangent, dist, along, length: lap[n], bounds: { minX, maxX, minZ, maxZ } };
  }

  // ------------------------------------------------------------------ land and sea
  // The sea lies south of the circuit (+z). A harbour basin opens into it where the circuit leaves room.
  function geography(road) {
    const { minX, maxX, maxZ } = road.bounds;
    const midX = (minX + maxX) / 2;
    const coastZ = x => maxZ + 50 + 40 * Math.sin((x - midX) / 520) + 10 * (noise(x / 110, 3.7) - 0.5);
    // the basin: the largest box south of the circuit that keeps clear of the road
    let basin = null;
    for (let x0 = minX; x0 < maxX - 120; x0 += 10) for (let x1 = x0 + 120; x1 <= maxX + 40; x1 += 10) {
      let top = -Infinity;
      for (let x = x0; x <= x1; x += 5) for (const p of road.pts) if (Math.abs(p[0] - x) < 30) top = Math.max(top, p[1]);
      const z0 = top + 38, z1 = coastZ((x0 + x1) / 2);
      if (z1 - z0 < 70) continue;
      const area = (x1 - x0) * (z1 - z0);
      if (basin == null || area > basin.area) basin = { x0, x1, z0, area };
    }
    const sdBox = (x, z, b) => {                                  // signed distance to a rounded box (negative inside)
      const r = 22, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hx = (b.x1 - b.x0) / 2 - r, hz = (b.z1 - b.z0) / 2 - r;
      const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    };
    const harbour = basin && { x0: basin.x0, x1: basin.x1, z0: basin.z0, z1: coastZ((basin.x0 + basin.x1) / 2) + 60 };
    // a breakwater half closes the harbour mouth, from its east side
    const mouth = harbour && coastZ((harbour.x0 + harbour.x1) / 2);
    const breakwater = harbour && { x0: harbour.x0 + (harbour.x1 - harbour.x0) * 0.42, x1: harbour.x1 + 30, z: mouth + 18, half: 6 };
    const sdBreakwater = (x, z) => {
      if (breakwater == null) return Infinity;
      const qx = Math.max(breakwater.x0 - x, x - breakwater.x1, 0), qz = Math.abs(z - breakwater.z) - breakwater.half;
      return Math.max(qx > 0 ? Math.hypot(qx, Math.max(qz, 0)) : qz, -Infinity);
    };
    // > 0 on land, < 0 at sea, in metres (roughly)
    const land = (x, z) => {
      let s = coastZ(x) - z;
      if (harbour) s = Math.min(s, sdBox(x, z, harbour));
      s = Math.max(s, -sdBreakwater(x, z));
      return Math.max(s, 26 - road.dist(x, z));                   // the road always runs on land
    };
    return { coastZ, land, harbour, breakwater, midX };
  }

  // ------------------------------------------------------------------ heights
  // how far a point is up the hillside behind the town (0 in town), with a ragged edge
  const hillside = (road, x, z) => Math.max(0, road.bounds.minZ - 60 - z + 90 * (fbm(x / 210, z / 210) - 0.5));
  function relief(road, geo) {
    return (x, z, d = road.dist(x, z)) => {
      const inland = geo.coastZ(x) - z;                          // metres from the shore
      const beyond = hillside(road, x, z);
      const terraces = Math.min(beyond, 500) * 0.09 + Math.max(0, beyond - 500) * 0.2;
      const foothills = smooth(250, 900, beyond) * 70 * fbm(x / 260, z / 260);
      const peaks = smooth(700, 2300, inland) * (330 + 470 * ridged(x / 950 + 3, z / 950)) * (0.7 + 0.6 * fbm(x / 420, z / 420));
      const flank = smooth(150, 700, Math.abs(x - geo.midX) - 900) * smooth(0, 400, inland) * 160 * fbm(x / 300 + 9, z / 300);
      return (terraces + foothills + peaks + flank) * smooth(28, 120, d);
    };
  }

  // ------------------------------------------------------------------ terrain: town plateau, hills, mountains, quays
  function terrain(road, geo, height, B) {
    const colourAt = (a, b, c) => {
      const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3, z = (a[2] + b[2] + c[2]) / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const flat = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      const k = 0.94 + 0.12 * hash2(x * 0.31, z * 0.31);
      const d = road.dist(x, z), up = hillside(road, x, z);
      if (y < 1.5 || (up < 60 && flat > 0.8)) {                   // the town floor
        if (geo.land(x, z) < 14) return shade(C.quay, k);
        if (d < 13) return shade(C.pavement, k);
        if (d < 24) return shade(C.sidewalk, k);
        return shade(fbm(x / 70, z / 70) > 0.6 ? C.garden : C.plaza, k);
      }
      if (y > 600 && flat > 0.55) return shade(C.summit, k);
      if (flat < 0.6 || y > 520) return shade(fbm(x / 60, z / 60) > 0.5 ? C.rock : C.rockDark, k);
      if (y < 60) return shade(fbm(x / 50, z / 50) > 0.55 ? C.lawn : C.scrub, k);
      return shade(fbm(x / 90, z / 90) > 0.45 ? C.maquis : C.scrub, k);
    };
    // A grid of squares split in two triangles; each triangle is clipped against the shoreline, and the
    // cut gets a quay wall down into the water.
    const sample = (x, z) => { const s = geo.land(x, z); return { p: [x, s > 0 ? height(x, z) : 0, z], s }; };
    const emit = (corners) => {
      const inside = corners.filter(c => c.s > 0);
      if (inside.length === 0) return;
      if (inside.length === 3) { const col = colourAt(corners[0].p, corners[1].p, corners[2].p); B.tri3(corners[0].p, corners[1].p, corners[2].p, col, UP); return; }
      // clip to the land side; points on the cut are found along the edges
      const poly = [], cut = [];
      for (let i = 0; i < 3; i++) {
        const a = corners[i], b = corners[(i + 1) % 3];
        if (a.s > 0) poly.push(a.p);
        if ((a.s > 0) !== (b.s > 0)) {
          const t = a.s / (a.s - b.s), x = a.p[0] + (b.p[0] - a.p[0]) * t, z = a.p[2] + (b.p[2] - a.p[2]) * t;
          const p = [x, Math.max(0, height(x, z)) * 0, z];       // the quay edge is at road level
          poly.push(p); cut.push(p);
        }
      }
      for (let i = 1; i + 1 < poly.length; i++) B.tri3(poly[0], poly[i], poly[i + 1], colourAt(poly[0], poly[i], poly[i + 1]), UP);
      if (cut.length === 2) {                                     // quay wall, facing the sea
        const [p, q] = cut, mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2;
        const ex = q[0] - p[0], ez = q[2] - p[2], l = Math.hypot(ex, ez) || 1;
        let nx = -ez / l, nz = ex / l;
        if (geo.land(mx + nx * 2, mz + nz * 2) > 0) { nx = -nx; nz = -nz; }
        B.quad([p[0], p[1], p[2]], [q[0], q[1], q[2]], [q[0], QUAY_FOOT, q[2]], [p[0], QUAY_FOOT, p[2]], shade(C.quayWall, 0.95 + 0.1 * hash2(mx, mz)), [nx, 0, nz]);
      }
    };
    const grid = (x0, x1, z0, z1, step, skip) => {
      const cols = Math.round((x1 - x0) / step), rows = Math.round((z1 - z0) / step);
      const S = [];
      for (let i = 0; i <= cols; i++) { const col = []; for (let j = 0; j <= rows; j++) col.push(sample(x0 + i * step, z0 + j * step)); S.push(col); }
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (skip && skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
        const a = S[i][j], b = S[i + 1][j], c = S[i + 1][j + 1], d = S[i][j + 1];
        if ((i + j) % 2 === 0) { emit([a, b, c]); emit([a, c, d]); } else { emit([a, b, d]); emit([b, c, d]); }
      }
      return S;
    };
    const { minX, maxX, minZ, maxZ } = road.bounds;
    const fine = { x0: Math.floor((minX - 320) / 100) * 100, x1: Math.ceil((maxX + 320) / 100) * 100, z0: Math.floor((minZ - 400) / 100) * 100, z1: Math.ceil((maxZ + 160) / 100) * 100 };
    const S = grid(fine.x0, fine.x1, fine.z0, fine.z1, 10);
    // skirts under the edges of the fine grid hide the seams with the coarse one
    const edge = (a, b, out) => { if (a.s > 0 && b.s > 0) B.quad(a.p, b.p, [b.p[0], b.p[1] - 40, b.p[2]], [a.p[0], a.p[1] - 40, a.p[2]], shade(C.rockDark, 0.9), out); };
    for (let i = 0; i + 1 < S.length; i++) { edge(S[i][0], S[i + 1][0], [0, 0, -1]); edge(S[i][S[i].length - 1], S[i + 1][S[i].length - 1], [0, 0, 1]); }
    for (let j = 0; j + 1 < S[0].length; j++) { edge(S[0][j], S[0][j + 1], [-1, 0, 0]); edge(S[S.length - 1][j], S[S.length - 1][j + 1], [1, 0, 0]); }
    const R = 9000, step = 150;
    grid(Math.floor((geo.midX - R) / step) * step, Math.ceil((geo.midX + R) / step) * step, -R, Math.ceil((maxZ + 900) / step) * step, step,
      (x, z) => x > fine.x0 && x < fine.x1 && z > fine.z0 && z < fine.z1);
    // the sea, out to the horizon
    const W = 12000;
    B.quad([geo.midX - W, WATER_Y, -W], [geo.midX + W, WATER_Y, -W], [geo.midX + W, WATER_Y, W], [geo.midX - W, WATER_Y, W], C.water, UP);
    return fine;
  }

  // ------------------------------------------------------------------ town
  function town(road, geo, height, B, rnd) {
    // occupancy on a 2 m grid: a cell belongs to a footprint (a convex polygon, grown by `pad`) if its centre is inside
    const occupied = new Set(), CELL = 2;
    const cellsOf = (corners, pad) => {
      const xs = corners.map(c => c[0]), zs = corners.map(c => c[1]), out = [];
      const cx = xs.reduce((a, b) => a + b) / xs.length, cz = zs.reduce((a, b) => a + b) / zs.length;
      const edges = corners.map((a, i) => {
        const b = corners[(i + 1) % corners.length], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
        let nx = ez / l, nz = -ex / l;
        if ((cx - a[0]) * nx + (cz - a[1]) * nz > 0) { nx = -nx; nz = -nz; }
        return [a[0], a[1], nx, nz];
      });
      for (let x = Math.floor((Math.min(...xs) - pad) / CELL); x <= Math.floor((Math.max(...xs) + pad) / CELL); x++)
        for (let z = Math.floor((Math.min(...zs) - pad) / CELL); z <= Math.floor((Math.max(...zs) + pad) / CELL); z++) {
          const px = (x + 0.5) * CELL, pz = (z + 0.5) * CELL;
          if (edges.every(([ax, az, nx, nz]) => (px - ax) * nx + (pz - az) * nz <= pad)) out.push(x + ',' + z);
        }
      return out;
    };
    const claim = (corners, pad = 0) => { for (const k of cellsOf(corners, pad)) occupied.add(k); };
    const free = (corners, pad = 1.5) => cellsOf(corners, pad).every(k => !occupied.has(k));
    const footprint = (cx, cz, ux, uz, hw, hd) => {
      const vx = -uz, vz = ux;
      return [[cx - ux * hw - vx * hd, cz - uz * hw - vz * hd], [cx + ux * hw - vx * hd, cz + uz * hw - vz * hd], [cx + ux * hw + vx * hd, cz + uz * hw + vz * hd], [cx - ux * hw + vx * hd, cz - uz * hw + vz * hd]];
    };
    // can a footprint stand here? returns its base height, or null
    const site = (corners, clearRoad = ROAD_CLEAR, quay = 40) => {             // keeps the sea front open: the harbour stays in view
      const probes = corners.concat([[(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]],
        corners.map((c, i) => [(c[0] + corners[(i + 1) % 4][0]) / 2, (c[1] + corners[(i + 1) % 4][1]) / 2]));
      let lo = Infinity, hi = -Infinity;
      for (const [x, z] of probes) {
        if (road.dist(x, z) < clearRoad || geo.land(x, z) < quay) return null;
        const h = height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return hi - lo > 6 ? null : { lo, hi };
    };
    const vertical = (a, b, y0, y1, col, out) => B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col, out);
    const outward = (corners, i) => {
      const a = corners[i], b = corners[(i + 1) % 4], cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][1] + corners[2][1]) / 2;
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz, l = Math.hypot(mx, mz) || 1;
      return [mx / l, 0, mz / l];
    };

    // A block: walls, windows (one by one near the road, ribbons further away), a flat or tiled roof.
    function building(corners, base, floors, style) {
      const y0 = base.lo - 2, top = base.hi + floors * 3.1 + 0.6;
      const wall = style.wall, detailed = style.detailed;
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], out = outward(corners, i), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        vertical(a, b, y0, top, shade(wall, i % 2 ? 0.97 : 1), out);
        const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len, off = 0.08;
        const at = (t, y) => [a[0] + ex * t + out[0] * off, y, a[1] + ez * t + out[2] * off];
        const firstFloor = style.shopFront === i ? 1 : 0;
        if (style.shopFront === i) {                             // shop windows and an awning on the street side
          B.quad(at(0.6, base.hi + 0.2), at(len - 0.6, base.hi + 0.2), at(len - 0.6, base.hi + 2.5), at(0.6, base.hi + 2.5), C.window, out);
          const o = 1.6, p0 = at(0.3, base.hi + 3.0), p1 = at(len - 0.3, base.hi + 3.0);
          B.quad(p0, p1, [p1[0] + out[0] * o, base.hi + 2.5, p1[2] + out[2] * o], [p0[0] + out[0] * o, base.hi + 2.5, p0[2] + out[2] * o], style.awning, [out[0], 1, out[2]]);
        }
        if (len < 4) continue;
        for (let f = firstFloor; f < floors; f++) {
          const fy = base.hi + f * 3.1 + 1.0;
          if (style.ribbon || !detailed) { B.quad(at(0.8, fy), at(len - 0.8, fy), at(len - 0.8, fy + (style.ribbon ? 1.9 : 1.4)), at(0.8, fy + (style.ribbon ? 1.9 : 1.4)), style.ribbon ? C.glass : C.window, out); continue; }
          const count = Math.max(1, Math.floor((len - 1.5) / 3.4)), gap = (len - count * 1.3) / (count + 1);
          for (let w = 0; w < count; w++) {
            const t = gap + w * (1.3 + gap);
            B.quad(at(t, fy), at(t + 1.3, fy), at(t + 1.3, fy + 1.7), at(t, fy + 1.7), C.window, out);
            if (style.shutters) {
              B.quad(at(t - 0.55, fy), at(t - 0.05, fy), at(t - 0.05, fy + 1.7), at(t - 0.55, fy + 1.7), C.shutter, out);
              B.quad(at(t + 1.35, fy), at(t + 1.85, fy), at(t + 1.85, fy + 1.7), at(t + 1.35, fy + 1.7), C.shutter, out);
            }
          }
        }
      }
      const P = y => corners.map(c => [c[0], y, c[1]]);
      if (style.tiled) {                                          // hipped roof
        const r = P(top), cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][1] + corners[2][1]) / 2;
        const l01 = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]), l12 = Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]);
        const rise = Math.min(l01, l12) * 0.28, ridgeHalf = Math.max(0, (Math.max(l01, l12) - Math.min(l01, l12)) / 2);
        const ax = l01 >= l12 ? (corners[1][0] - corners[0][0]) / l01 : (corners[2][0] - corners[1][0]) / l12, az = l01 >= l12 ? (corners[1][1] - corners[0][1]) / l01 : (corners[2][1] - corners[1][1]) / l12;
        const ra = [cx - ax * ridgeHalf, top + rise, cz - az * ridgeHalf], rb = [cx + ax * ridgeHalf, top + rise, cz + az * ridgeHalf];
        for (let i = 0; i < 4; i++) {
          const a = r[i], b = r[(i + 1) % 4], out = outward(corners, i), mid = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
          const ka = Math.hypot(ra[0] - mid[0], ra[2] - mid[1]) < Math.hypot(rb[0] - mid[0], rb[2] - mid[1]) ? ra : rb;
          const kb = ka === ra ? rb : ra;
          const along = Math.abs((b[0] - a[0]) * ax + (b[2] - a[2]) * az) > 0.5;
          if (along && ridgeHalf > 0.01) B.quad(a, b, Math.hypot(b[0] - rb[0], b[2] - rb[2]) < Math.hypot(b[0] - ra[0], b[2] - ra[2]) ? rb : ra, Math.hypot(a[0] - ra[0], a[2] - ra[2]) < Math.hypot(a[0] - rb[0], a[2] - rb[2]) ? ra : rb, shade(C.tiles, 0.92 + 0.08 * (i % 2)), [out[0], 1, out[2]]);
          else B.tri3(a, b, ka, shade(C.tiles, 0.88 + 0.08 * (i % 2)), [out[0], 1, out[2]]);
          void kb;
        }
      } else {
        const r = P(top);
        B.quad(r[0], r[1], r[2], r[3], style.roof, UP);
        if (style.penthouse) {                                    // stair house / penthouse on the roof
          const cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][1] + corners[2][1]) / 2;
          const small = corners.map(c => [cx + (c[0] - cx) * 0.35, cz + (c[1] - cz) * 0.35]);
          for (let i = 0; i < 4; i++) vertical(small[i], small[(i + 1) % 4], top, top + 3, shade(wall, 0.92), outward(small, i));
          const s = small.map(c => [c[0], top + 3, c[1]]);
          B.quad(s[0], s[1], s[2], s[3], style.roof, UP);
        }
      }
      return top;
    }
    const pick = list => list[Math.floor(rnd() * list.length)];
    const oldStyle = (detailed, shopFront = -1) => ({
      wall: pick(C.walls), detailed, shutters: rnd() < 0.55, tiled: rnd() < 0.4, roof: shade(C.roof, 0.9 + rnd() * 0.15), penthouse: rnd() < 0.3, shopFront, awning: pick(C.awnings),
    });
    const placed = { buildings: 0 };

    // ---- landmarks first, so the town fills in around them
    landmarks(road, geo, height, B, rnd, { claim, free, footprint, site, vertical, building, outward });

    // ---- 1. the street front: blocks lining the road on both sides
    for (const s of [-1, 1]) {
      for (let at = 0; at < road.length;) {
        const w = 10 + rnd() * 12, here = road.along(at + w / 2), t = here.t, p = here.p, nx = -t[1] * s, nz = t[0] * s;
        const dpt = 12 + rnd() * 10, front = ROAD_CLEAR + 2.5 + rnd() * 1.5;
        const cx = p[0] + nx * (front + dpt / 2), cz = p[1] + nz * (front + dpt / 2);
        const corners = footprint(cx, cz, t[0], t[1], w / 2, dpt / 2);
        const base = site(corners);
        if (base && free(corners, 0.3)) {
          // the face looking at the road gets the shops: it is the one whose outward normal points back to the road
          let shopFront = 0, best = -Infinity;
          for (let k = 0; k < 4; k++) { const o = outward(corners, k), dot = -(o[0] * nx + o[2] * nz); if (dot > best) { best = dot; shopFront = k; } }
          building(corners, base, 3 + Math.floor(rnd() * 5), oldStyle(true, shopFront));
          claim(corners, 0.3); placed.buildings++;
        }
        at += w + 0.4 + rnd() * 1.2;
      }
    }

    // ---- 2. the rest of the town, denser and taller up the slope (Monaco's high-rises)
    const { minX, maxX, minZ, maxZ } = road.bounds;
    for (let x = minX - 320; x < maxX + 320; x += 19) for (let z = minZ - 420; z < maxZ + 120; z += 19) {
      const jx = x + (rnd() - 0.5) * 6, jz = z + (rnd() - 0.5) * 6, d = road.dist(jx, jz);
      if (d < 24 || hillside(road, jx, jz) > 120) continue;
      const near = d < 140, chance = d < 220 ? 0.95 : 0.95 - (d - 220) / 380;
      if (rnd() > chance) continue;
      const nr = road.nearest(jx, jz), t = road.tangent(nr.i);
      const angle = d < 120 ? Math.atan2(t[1], t[0]) : Math.atan2(t[1], t[0]) + (rnd() - 0.5) * 0.5;
      const tower = jz < minZ - 40 && rnd() < 0.4;
      const w = tower ? 15 + rnd() * 8 : 12 + rnd() * 10, dpt = tower ? 15 + rnd() * 8 : 12 + rnd() * 10;
      const corners = footprint(jx, jz, Math.cos(angle), Math.sin(angle), w / 2, dpt / 2);
      const base = site(corners, 21);
      if (!base || base.hi > 70 || !free(corners, 1)) continue;
      if (tower) building(corners, base, 10 + Math.floor(rnd() * 15), { wall: pick(C.modern), ribbon: true, roof: C.roof, penthouse: rnd() < 0.5 });
      else building(corners, base, 3 + Math.floor(rnd() * 6), oldStyle(near));
      claim(corners, 1); placed.buildings++;
    }

    // ---- 3. villas on the hills
    for (let x = minX - 1600; x < maxX + 1600; x += 46) for (let z = minZ - 1700; z < minZ - 300; z += 46) {
      if (rnd() > 0.32) continue;
      const jx = x + (rnd() - 0.5) * 20, jz = z + (rnd() - 0.5) * 20, a = rnd() * Math.PI;
      const corners = footprint(jx, jz, Math.cos(a), Math.sin(a), 4 + rnd() * 3, 4 + rnd() * 3);
      const base = site(corners, 30);
      if (!base || base.hi > 330 || base.hi - base.lo > 4 || !free(corners)) continue;
      building(corners, base, 2 + Math.floor(rnd() * 2), { wall: pick([C.walls[0], C.walls[1], C.walls[3], C.walls[5]]), detailed: false, tiled: true, roof: C.roof });
      claim(corners); placed.buildings++;
    }
    palms(road, geo, height, B, rnd, { claim, free });
    return placed;
  }

  // ------------------------------------------------------------------ landmarks
  function landmarks(road, geo, height, B, rnd, T) {
    const { minX, maxX, minZ } = road.bounds;

    // ---- the tunnel: a hotel built over the road, along the stretch that runs closest to the sea
    let tunnel = null;
    for (let i = 0; i < road.n; i++) {
      const span = 11;
      let ok = true, sea = 0;
      for (let k = 0; k < span && ok; k++) {
        const j = (i + k) % road.n;
        if (road.height[j] > 0.05 || j === 0) ok = false;
        const p = road.pts[j];
        for (let m = 0; m < road.n && ok; m++) {
          const along = Math.min(Math.abs(m - j), road.n - Math.abs(m - j));
          if (along > 6 && Math.hypot(road.pts[m][0] - p[0], road.pts[m][1] - p[1]) < 40) ok = false;
        }
        sea += Math.max(0, 200 - (geo.coastZ(p[0]) - p[1]));
      }
      if (ok && (tunnel == null || sea > tunnel.sea)) tunnel = { from: i, span, sea };
    }
    if (tunnel) {
      const IN = 9.6, OUT = 13, CEIL = 7.2, TOP = 25;
      const sections = [];
      for (let k = 0; k <= tunnel.span; k++) {
        const j = (tunnel.from + k) % road.n, p = road.pts[j], t = road.tangent(j), nx = -t[1], nz = t[0];
        sections.push({ p, t, at: (u, y) => [p[0] + nx * u, y, p[1] + nz * u], n: [nx, 0, nz] });
      }
      for (let k = 0; k < tunnel.span; k++) {
        const a = sections[k], b = sections[k + 1];
        for (const s of [-1, 1]) {
          const out = [a.n[0] * s, 0, a.n[2] * s], inn = [-out[0], 0, -out[2]];
          B.quad(a.at(s * IN, -1), b.at(s * IN, -1), b.at(s * IN, CEIL), a.at(s * IN, CEIL), C.tunnel, inn);
          B.quad(a.at(s * OUT, -2), b.at(s * OUT, -2), b.at(s * OUT, TOP), a.at(s * OUT, TOP), C.walls[5], out);
          for (let f = 0; f < 5; f++) {                          // hotel windows above the tunnel
            const y = 9.5 + f * 3.1;
            const pa = a.at(s * (OUT + 0.08), y), pb = b.at(s * (OUT + 0.08), y);
            const lerp = (u, v, t) => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t];
            B.quad(lerp(pa, pb, 0.12), lerp(pa, pb, 0.88), [lerp(pa, pb, 0.88)[0], y + 1.7, lerp(pa, pb, 0.88)[2]], [lerp(pa, pb, 0.12)[0], y + 1.7, lerp(pa, pb, 0.12)[2]], C.window, out);
          }
        }
        B.quad(a.at(-IN, CEIL), a.at(IN, CEIL), b.at(IN, CEIL), b.at(-IN, CEIL), C.tunnel, DOWN);
        B.quad(a.at(-0.6, CEIL - 0.05), a.at(0.6, CEIL - 0.05), b.at(0.6, CEIL - 0.05), b.at(-0.6, CEIL - 0.05), C.lamp, DOWN);
        B.quad(a.at(-OUT, TOP), a.at(OUT, TOP), b.at(OUT, TOP), b.at(-OUT, TOP), C.roof, UP);
      }
      for (const [sec, dir] of [[sections[0], -1], [sections[tunnel.span], 1]]) {   // the two portals
        const face = [sec.t[0] * dir, 0, sec.t[1] * dir];
        B.quad(sec.at(-OUT, CEIL), sec.at(OUT, CEIL), sec.at(OUT, TOP), sec.at(-OUT, TOP), C.walls[5], face);
        B.quad(sec.at(-OUT, -2), sec.at(-IN, -2), sec.at(-IN, CEIL), sec.at(-OUT, CEIL), C.walls[5], face);
        B.quad(sec.at(IN, -2), sec.at(OUT, -2), sec.at(OUT, CEIL), sec.at(IN, CEIL), C.walls[5], face);
        B.quad(sec.at(-IN, CEIL - 1.2), sec.at(IN, CEIL - 1.2), sec.at(IN, CEIL), sec.at(-IN, CEIL), C.gold, face);
      }
      for (const sec of sections) T.claim([[sec.at(-OUT - 2, 0)[0], sec.at(-OUT - 2, 0)[2]], [sec.at(OUT + 2, 0)[0], sec.at(OUT + 2, 0)[2]]], 3);
    }

    // ---- casino square: gardens, a fountain and a Belle Epoque casino, north of the circuit
    let square = null;
    for (let x = minX + 40; x < maxX - 40; x += 10) {
      const z = minZ - 70, d = road.dist(x, z);
      if (d < 40 || d > 80) continue;
      if (square == null || Math.abs(d - 55) < Math.abs(square.d - 55)) square = { x, z, d };
    }
    if (square) {
      const { x, z } = square, base = Math.max(height(x, z), 0);
      const garden = T.footprint(x, z + 6, 1, 0, 34, 16);
      // lawns and paths
      B.quad([garden[0][0], base + 0.15, garden[0][1]], [garden[1][0], base + 0.15, garden[1][1]], [garden[2][0], base + 0.15, garden[2][1]], [garden[3][0], base + 0.15, garden[3][1]], C.lawn, UP);
      B.quad([x - 34, base + 0.2, z + 4], [x + 34, base + 0.2, z + 4], [x + 34, base + 0.2, z + 8], [x - 34, base + 0.2, z + 8], C.plaza, UP);
      B.quad([x - 2, base + 0.2, z - 10], [x + 2, base + 0.2, z - 10], [x + 2, base + 0.2, z + 22], [x - 2, base + 0.2, z + 22], C.plaza, UP);
      // fountain
      const ring = (r, y, sides = 10) => Array.from({ length: sides }, (_, i) => [x + Math.cos(i / sides * 2 * Math.PI) * r, y, z + 6 + Math.sin(i / sides * 2 * Math.PI) * r]);
      const outer = ring(5, base + 0.9), outerLow = ring(5, base), inner = ring(4.4, base + 0.6);
      for (let i = 0; i < 10; i++) {
        const k = (i + 1) % 10, out = [outer[i][0] - x, 0, outer[i][2] - z - 6];
        B.quad(outerLow[i], outerLow[k], outer[k], outer[i], C.casino, out);
        B.tri3([x, base + 0.6, z + 6], inner[i], inner[k], C.water, UP);
        B.quad(outer[i], outer[k], inner[k], inner[i], C.casino, UP);
      }
      const col = ring(0.5, base, 6), colTop = ring(0.35, base + 3.2, 6);
      for (let i = 0; i < 6; i++) B.quad(col[i], col[(i + 1) % 6], colTop[(i + 1) % 6], colTop[i], C.casino, [col[i][0] - x, 0, col[i][2] - z - 6]);
      T.claim(garden, 2);
      // the casino, behind the gardens
      const cz = z - 26, cb = T.footprint(x, cz, 1, 0, 32, 11), cbase = { lo: base, hi: base };
      const top = T.building(cb, cbase, 4, { wall: C.casino, detailed: true, shutters: false, roof: C.roof, shopFront: 2, awning: C.gold });
      const dome = (cx, cz2, r, y, rise, sides = 8) => {
        const rim = Array.from({ length: sides }, (_, i) => [cx + Math.cos(i / sides * 2 * Math.PI) * r, y, cz2 + Math.sin(i / sides * 2 * Math.PI) * r]);
        const drum = rim.map(p => [p[0], y + rise * 0.35, p[2]]);
        for (let i = 0; i < sides; i++) {
          const k = (i + 1) % sides, out = [rim[i][0] - cx, 0, rim[i][2] - cz2];
          B.quad(rim[i], rim[k], drum[k], drum[i], C.casino, out);
          B.tri3(drum[i], drum[k], [cx, y + rise, cz2], shade(C.dome, 0.9 + 0.1 * (i % 2)), [out[0], 1, out[2]]);
        }
        B.quad([cx - 0.3, y + rise, cz2], [cx + 0.3, y + rise, cz2], [cx + 0.3, y + rise + 2.5, cz2], [cx - 0.3, y + rise + 2.5, cz2], C.gold, [0, 0, 1]);
      };
      dome(x, cz, 7, top, 9);
      for (const s of [-1, 1]) {                                  // the two towers
        const tw = T.footprint(x + s * 27, cz + 6, 1, 0, 4, 4), ttop = T.building(tw, { lo: base, hi: base }, 7, { wall: C.casino, detailed: true, roof: C.roof });
        dome(x + s * 27, cz + 6, 4, ttop, 6, 6);
      }
      T.claim(cb, 3);
    }

    // ---- grandstands facing the start straight and the harbour front
    const stand = (i0, i1, side) => {
      for (let i = i0; i < i1; i += 2) {
        const p = road.pts[i % road.n], t = road.tangent(i % road.n), q = road.pts[(i + 2) % road.n];
        const nx = -t[1] * side, nz = t[0] * side, len = Math.hypot(q[0] - p[0], q[1] - p[1]) + 0.4;
        const front = ROAD_CLEAR - 2;
        const corners = [[p[0] + nx * front, p[1] + nz * front], [p[0] + nx * front + t[0] * len, p[1] + nz * front + t[1] * len], [p[0] + nx * (front + 22) + t[0] * len, p[1] + nz * (front + 22) + t[1] * len], [p[0] + nx * (front + 22), p[1] + nz * (front + 22)]];
        if (!T.free(corners, 0) || geo.land(corners[2][0], corners[2][1]) < 4) continue;
        const at = (u, along, y) => [p[0] + nx * u + t[0] * along, y, p[1] + nz * u + t[1] * along];
        const away = [nx, 0, nz], toward = [-nx, 0, -nz];
        for (let r = 0; r < 9; r++) {                             // stepped tiers rising away from the road
          const u0 = front + 1 + r * 2.2, y = 0.5 + r * 0.95;
          B.quad(at(u0, 0, y), at(u0, len, y), at(u0 + 2.2, len, y), at(u0 + 2.2, 0, y), C.seats[(r + Math.floor(i / 2)) % 2], UP);
          B.quad(at(u0, 0, y - 0.95), at(u0, len, y - 0.95), at(u0, len, y), at(u0, 0, y), shade(C.seats[(r + Math.floor(i / 2)) % 2], 0.82), toward);
        }
        const back = front + 1 + 9 * 2.2;
        B.quad(at(back, 0, -1), at(back, len, -1), at(back, len, 13), at(back, 0, 13), C.standFrame, away);
        B.quad(at(front, 0, 12), at(front, len, 12), at(back, len, 13), at(back, 0, 13), C.canopy, UP);
        B.quad(at(front, 0, 11.6), at(front, len, 11.6), at(back, len, 12.6), at(back, 0, 12.6), C.canopy, DOWN);
        for (const along of [0.2, len - 0.4]) B.quad(at(front + 0.5, along, 0), at(front + 0.5, along + 0.25, 0), at(front + 0.5, along + 0.25, 12), at(front + 0.5, along, 12), C.standFrame, toward);
        T.claim(corners, 1);
      }
    };
    // start straight: the stretch leaving the line, on the outside of the lap
    const outside = (() => { const t = road.tangent(2), p = road.pts[2], c = [(road.bounds.minX + road.bounds.maxX) / 2, (road.bounds.minZ + road.bounds.maxZ) / 2]; return Math.sign((-t[1]) * (p[0] - c[0]) + t[0] * (p[1] - c[1])) || 1; })();
    stand(1, 9, outside);
    if (geo.harbour) {
      // the stretch that runs along the top of the harbour basin
      let best = null;
      for (let i = 0; i < road.n; i++) {
        const p = road.pts[i];
        if (p[0] < geo.harbour.x0 + 20 || p[0] > geo.harbour.x1 - 20) continue;
        const gap = geo.harbour.z0 - p[1];
        if (gap > 0 && gap < 60 && (best == null || gap < best.gap)) best = { i, gap };
      }
      if (best) stand(best.i - 3, best.i + 3, Math.sign(-road.tangent(best.i)[1] * 0 + road.tangent(best.i)[0]) || 1);
    }

    harbourLife(road, geo, height, B, rnd, T);
  }

  // ------------------------------------------------------------------ harbour: pontoons, yachts, breakwater
  function yacht(B, x, z, ux, uz, length, rnd) {
    const beam = length * (0.22 + rnd() * 0.04), vx = -uz, vz = ux, deck = 1.4 + length * 0.03, keel = -0.6;
    const at = (along, across, y) => [x + ux * along + vx * across, y, z + uz * along + vz * across];
    const outline = [[-0.5, -0.42], [0.18, -0.5], [0.36, -0.38], [0.5, 0], [0.36, 0.38], [0.18, 0.5], [-0.5, 0.42]];
    const top = outline.map(([a, c]) => at(a * length, c * beam, WATER_Y + deck)), bot = outline.map(([a, c]) => at(a * length * 0.94, c * beam * 0.7, WATER_Y + keel));
    for (let i = 0; i < outline.length; i++) {
      const k = (i + 1) % outline.length, mx = (top[i][0] + top[k][0]) / 2 - x, mz = (top[i][2] + top[k][2]) / 2 - z;
      B.quad(bot[i], bot[k], top[k], top[i], C.hull, [mx, 0, mz]);
      const s1 = [top[i][0], WATER_Y + deck - 0.45, top[i][2]], s2 = [top[k][0], WATER_Y + deck - 0.45, top[k][2]];
      B.quad([s1[0] + mx * 0.004, s1[1], s1[2] + mz * 0.004], [s2[0] + mx * 0.004, s2[1], s2[2] + mz * 0.004], [s2[0] + mx * 0.004, s2[1] + 0.22, s2[2] + mz * 0.004], [s1[0] + mx * 0.004, s1[1] + 0.22, s1[2] + mz * 0.004], C.stripe, [mx, 0, mz]);
    }
    for (let i = 1; i + 1 < outline.length; i++) B.tri3(top[0], top[i], top[i + 1], C.deck, UP);
    // superstructure: one deck for small boats, two for the big ones
    const levels = length > 30 ? 2 : 1;
    for (let l = 0; l < levels; l++) {
      const a0 = -0.38 + l * 0.08, a1 = 0.12 - l * 0.1, c = 0.36 - l * 0.06, y0 = WATER_Y + deck + l * 2.2, y1 = y0 + 2.2;
      const box = [at(a0 * length, -c * beam, 0), at(a1 * length, -c * beam, 0), at(a1 * length, c * beam, 0), at(a0 * length, c * beam, 0)];
      for (let i = 0; i < 4; i++) {
        const p = box[i], q = box[(i + 1) % 4], mx = (p[0] + q[0]) / 2 - x, mz = (p[2] + q[2]) / 2 - z;
        B.quad([p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]], C.hull, [mx, 0, mz]);
        const lerp = (t, y) => [p[0] + (q[0] - p[0]) * t + mx * 0.01, y, p[2] + (q[2] - p[2]) * t + mz * 0.01];
        B.quad(lerp(0.1, y0 + 0.9), lerp(0.9, y0 + 0.9), lerp(0.9, y0 + 1.7), lerp(0.1, y0 + 1.7), C.window, [mx, 0, mz]);
      }
      B.quad(...box.map(p => [p[0], y1, p[2]]), C.hull, UP);
    }
  }

  function harbourLife(road, geo, height, B, rnd, T) {
    const h = geo.harbour;
    if (h) {
      // pontoons from the north quay, boats on both sides
      const top = h.z0 + 4, len = Math.min(70, (geo.coastZ((h.x0 + h.x1) / 2) - h.z0) * 0.55);
      for (let x = h.x0 + 30; x < h.x1 - 25; x += 30) {
        B.quad([x - 1.2, WATER_Y + 0.6, top], [x + 1.2, WATER_Y + 0.6, top], [x + 1.2, WATER_Y + 0.6, top + len], [x - 1.2, WATER_Y + 0.6, top + len], C.pontoon, UP);
        for (const s of [-1, 1]) B.quad([x + s * 1.2, WATER_Y - 0.4, top], [x + s * 1.2, WATER_Y - 0.4, top + len], [x + s * 1.2, WATER_Y + 0.6, top + len], [x + s * 1.2, WATER_Y + 0.6, top], shade(C.pontoon, 0.8), [s, 0, 0]);
        for (let z = top + 7; z < top + len - 4; z += 8 + rnd() * 3) for (const s of [-1, 1]) {
          if (rnd() < 0.2) continue;
          const L = 12 + rnd() * 10;
          yacht(B, x + s * (2.6 + L * 0.13), z, 0, 1, L, rnd);   // moored bow out, along the pontoon
        }
      }
      // big yachts along the east and west quays
      for (const [qx, dir] of [[h.x0 + 9, 1], [h.x1 - 9, -1]]) for (let z = h.z0 + 30; z < geo.coastZ(qx) - 30; z += 46) {
        if (rnd() < 0.25) continue;
        yacht(B, qx + dir * 2, z, 0, 1, 34 + rnd() * 14, rnd);
      }
    }
    // the breakwater and its light
    const bw = geo.breakwater;
    if (bw) {
      const y = 2.5, P = (x, z, yy) => [x, yy, z];
      B.quad(P(bw.x0, bw.z - bw.half, y), P(bw.x1, bw.z - bw.half, y), P(bw.x1, bw.z + bw.half, y), P(bw.x0, bw.z + bw.half, y), C.quay, UP);
      for (const s of [-1, 1]) B.quad(P(bw.x0, bw.z + s * bw.half, QUAY_FOOT), P(bw.x1, bw.z + s * bw.half, QUAY_FOOT), P(bw.x1, bw.z + s * bw.half, y), P(bw.x0, bw.z + s * bw.half, y), C.quayWall, [0, 0, s]);
      B.quad(P(bw.x0, bw.z - bw.half, QUAY_FOOT), P(bw.x0, bw.z + bw.half, QUAY_FOOT), P(bw.x0, bw.z + bw.half, y), P(bw.x0, bw.z - bw.half, y), C.quayWall, [-1, 0, 0]);
      const lx = bw.x0 + 4, lz = bw.z, ring = (r, yy) => Array.from({ length: 6 }, (_, i) => [lx + Math.cos(i / 3 * Math.PI) * r, yy, lz + Math.sin(i / 3 * Math.PI) * r]);
      const bands = [[y, y + 3, C.hull], [y + 3, y + 6, C.awnings[0]], [y + 6, y + 9, C.hull], [y + 9, y + 10.5, C.lamp]];
      for (const [y0, y1, col] of bands) { const a = ring(1.6 - (y0 - y) * 0.05, y0), b = ring(1.6 - (y1 - y) * 0.05, y1); for (let i = 0; i < 6; i++) B.quad(a[i], a[(i + 1) % 6], b[(i + 1) % 6], b[i], col, [a[i][0] - lx, 0, a[i][2] - lz]); }
      const cap = ring(1.1, y + 10.5);
      for (let i = 0; i < 6; i++) B.tri3(cap[i], cap[(i + 1) % 6], [lx, y + 12, lz], C.awnings[0], [cap[i][0] - lx, 1, cap[i][2] - lz]);
    }
    // a few yachts at anchor offshore
    for (let k = 0; k < 9; k++) {
      const x = geo.midX - 700 + rnd() * 1400, z = geo.coastZ(x) + 90 + rnd() * 380, a = rnd() * Math.PI * 2;
      yacht(B, x, z, Math.cos(a), Math.sin(a), 30 + rnd() * 35, rnd);
    }
  }

  // ------------------------------------------------------------------ palm trees along the quays and the sea front
  function palms(road, geo, height, B, rnd, T) {
    const palm = (x, z, base) => {
      const tall = 7 + rnd() * 4, lean = (rnd() - 0.5) * 0.12, la = rnd() * Math.PI * 2;
      const topX = x + Math.cos(la) * tall * lean, topZ = z + Math.sin(la) * tall * lean, topY = base + tall;
      const ring = (cx, cy, cz, r) => Array.from({ length: 5 }, (_, i) => [cx + Math.cos(i / 5 * 2 * Math.PI) * r, cy, cz + Math.sin(i / 5 * 2 * Math.PI) * r]);
      const lo = ring(x, base - 0.5, z, 0.32), hi = ring(topX, topY, topZ, 0.22);
      for (let i = 0; i < 5; i++) B.quad(lo[i], lo[(i + 1) % 5], hi[(i + 1) % 5], hi[i], C.trunk, [lo[i][0] - x, 0, lo[i][2] - z]);
      const fronds = 7, spin = rnd() * Math.PI;
      for (let f = 0; f < fronds; f++) {
        const a = spin + f / fronds * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), reach = 3.2 + rnd() * 0.9;
        const mid = [topX + ca * reach * 0.55, topY + 0.7, topZ + sa * reach * 0.55], tip = [topX + ca * reach, topY - 1.4, topZ + sa * reach];
        const wx = -sa * 0.7, wz = ca * 0.7, col = C.frond[f % 2];
        const top = [topX, topY + 0.2, topZ];
        B.tri3(top, [mid[0] + wx, mid[1], mid[2] + wz], [mid[0] - wx, mid[1], mid[2] - wz], col, UP);
        B.tri3([mid[0] + wx, mid[1], mid[2] + wz], tip, [mid[0] - wx, mid[1], mid[2] - wz], col, UP);
        B.tri3(top, [mid[0] - wx, mid[1], mid[2] - wz], [mid[0] + wx, mid[1], mid[2] + wz], shade(col, 0.7), DOWN);
        B.tri3([mid[0] - wx, mid[1], mid[2] - wz], tip, [mid[0] + wx, mid[1], mid[2] + wz], shade(col, 0.7), DOWN);
      }
    };
    // along the road wherever the sea is close: the sea front and the harbour
    for (let i = 0; i < road.n; i++) {
      const p = road.pts[i], t = road.tangent(i);
      for (const s of [-1, 1]) {
        const x = p[0] - t[1] * s * 14.6, z = p[1] + t[0] * s * 14.6;
        const seaFront = geo.land(x, z) < 90, boulevard = (Math.floor(i / 9) % 3 === 0);
        if (road.dist(x, z) < 13.8 || geo.land(x, z) < 3 || i % 2 || !(seaFront || boulevard)) continue;
        const cell = [[x - 1, z - 1], [x + 1, z + 1]];
        if (!T.free(cell, 0)) continue;
        palm(x, z, 0); T.claim(cell);
      }
    }
    // along the quays
    const h = geo.harbour;
    if (h) for (let x = h.x0 + 10; x < h.x1 - 10; x += 14) {
      const z = h.z0 - 6, cell = [[x - 1, z - 1], [x + 1, z + 1]];
      if (road.dist(x, z) < 13 || geo.land(x, z) < 2 || !T.free(cell, 0)) continue;
      palm(x, z, 0); T.claim(cell);
    }
  }

  // ------------------------------------------------------------------ entry point
  function build(data) {
    const road = circuit(data), geo = geography(road), height = relief(road, geo), rnd = random(SEED);
    const ground = Builder(), objects = Builder();
    terrain(road, geo, height, ground);
    const placed = town(road, geo, height, objects, rnd);
    return { terrain: ground.done(), objects: objects.done(), stats: { buildings: placed.buildings, harbour: !!geo.harbour } };
  }

  const api = { build };
  if (typeof window !== 'undefined') window.ApexMonaco = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
