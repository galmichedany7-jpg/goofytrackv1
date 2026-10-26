// Apex Monaco: the principality around the Monaco GP circuit, in low poly. Looks only.
//
// Everything is generated here from tracks/monaco.json (written by tools/make_monaco.js): the circuit's
// centreline with its heights and named corners, the coast, Port Hercule and the Rock. No 3D model or
// texture is shipped. The same seed always gives the same town.
//
//   terrain     the town on the slopes, at the road's own heights; terraced hills with cliffs behind it,
//               mountains on the horizon; the Rock of Monaco-Ville; quays; the sea and the harbour
//   town        white, pink and yellow blocks with blue windows, towers with dark crowns, roof pools,
//               old houses with tiled roofs on the Rock
//   circuit     pits and garages along the start straight, blue grandstands, the footbridge, catch fences,
//               the Casino square with its gardens, the Fairmont hotel over the tunnel and its gallery
//               along the sea, the swimming pool
//   harbour     yachts moored along every quay and pontoon, the jetties and their lights, boulders,
//               palm trees, round trees on the hills
//
// Coordinates are the circuit's own: metres, the start line at the origin, the road at its own height
// (the harbour's level is 0), the plain of the game 5 m below. Nothing here is collided with: the road
// keeps its own barriers.
//
// window.ApexMonaco.build(circuit) returns { terrain, objects }, each { positions, colors } (linear RGB,
// one colour per vertex, flat triangles). apex-scenery.js turns them into meshes.
(() => {
  'use strict';

  const ROAD_CLEAR = 15.5;          // nothing stands closer than this to the centreline (barriers end at 8.9 m)
  const OUTSIDE = 1.4, BARRIER_H = 1.3;  // kerb and barrier: from the edge of the asphalt to the back of the barrier
  const WATER_Y = -2.5;             // sea level (the game's plain is at -5)
  const QUAY_FOOT = -9;             // quay walls go down to here
  const FLOOR = 3.1;                // storey height
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
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ------------------------------------------------------------------ colours (display sRGB)
  const C = {
    sea: [0.33, 0.56, 0.71], pavement: [0.66, 0.66, 0.66], sidewalk: [0.76, 0.75, 0.72], plaza: [0.80, 0.77, 0.71], town: [0.72, 0.70, 0.66],
    quay: [0.80, 0.76, 0.68], quayWall: [0.62, 0.59, 0.55], retaining: [0.70, 0.66, 0.59], lawn: [0.45, 0.58, 0.33], grass: [0.49, 0.60, 0.35], meadow: [0.42, 0.54, 0.31],
    cliff: [0.72, 0.60, 0.48], cliffDark: [0.63, 0.52, 0.42], rock: [0.58, 0.56, 0.53], rockDark: [0.50, 0.48, 0.46], summit: [0.63, 0.62, 0.58], asphalt: [0.33, 0.33, 0.34],
    walls: { white: [0.95, 0.95, 0.94], cream: [0.97, 0.93, 0.84], pink: [0.96, 0.80, 0.73], salmon: [0.93, 0.70, 0.60], yellow: [0.97, 0.84, 0.42],
      lemon: [0.96, 0.91, 0.62], ice: [0.82, 0.87, 0.93], sand: [0.91, 0.82, 0.67], ochre: [0.92, 0.72, 0.45] },
    window: [0.27, 0.45, 0.72], windowDark: [0.19, 0.29, 0.50], frame: [0.97, 0.97, 0.97], shutter: [0.30, 0.50, 0.40],
    roof: [0.74, 0.74, 0.73], crown: [0.29, 0.21, 0.17], crownRoof: [0.55, 0.41, 0.31], pool: [0.38, 0.72, 0.92], tiles: [0.78, 0.40, 0.26], ac: [0.62, 0.66, 0.70],
    casino: [0.93, 0.83, 0.58], casinoTrim: [0.98, 0.95, 0.85], casinoRoof: [0.50, 0.66, 0.80], gold: [0.85, 0.68, 0.30],
    standFrame: [0.60, 0.62, 0.65], seats: [[0.17, 0.33, 0.76], [0.22, 0.40, 0.86]], pitRed: [0.84, 0.22, 0.18], bridgeGreen: [0.20, 0.62, 0.25],
    hull: [0.97, 0.97, 0.97], deck: [0.82, 0.68, 0.50], stripe: [0.16, 0.26, 0.50], glassDark: [0.30, 0.33, 0.38], pontoon: [0.80, 0.70, 0.55],
    trunk: [0.50, 0.38, 0.27], frond: [[0.32, 0.52, 0.25], [0.38, 0.57, 0.28]], leaves: [[0.30, 0.50, 0.25], [0.35, 0.56, 0.28], [0.42, 0.59, 0.30], [0.26, 0.44, 0.23]],
    boulder: [[0.87, 0.71, 0.60], [0.80, 0.64, 0.53], [0.91, 0.77, 0.66]], lamp: [1.0, 0.93, 0.72], tunnel: [0.46, 0.46, 0.48], fence: [0.56, 0.58, 0.61],
    palace: [0.94, 0.84, 0.66], cathedral: [0.93, 0.90, 0.82], light: [0.95, 0.30, 0.25],
  };
  const lin = c => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

  // ------------------------------------------------------------------ mesh builder
  function Builder() {
    let P = new Float32Array(1 << 20), K = new Float32Array(1 << 20), n = 0;
    const grow = () => { const p = new Float32Array(P.length * 2), k = new Float32Array(K.length * 2); p.set(P); k.set(K); P = p; K = k; };
    const tri = (a, b, c, col) => {
      if (n + 9 > P.length) grow();
      const l = lin(col);
      P[n] = a[0]; P[n + 1] = a[1]; P[n + 2] = a[2]; P[n + 3] = b[0]; P[n + 4] = b[1]; P[n + 5] = b[2]; P[n + 6] = c[0]; P[n + 7] = c[1]; P[n + 8] = c[2];
      for (let i = 0; i < 9; i += 3) { K[n + i] = l[0]; K[n + i + 1] = l[1]; K[n + i + 2] = l[2]; }
      n += 9;
    };
    // the visible side of a triangle / quad faces `towards`
    const facing = (a, b, c, towards) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return (uy * vz - uz * vy) * towards[0] + (uz * vx - ux * vz) * towards[1] + (ux * vy - uy * vx) * towards[2] >= 0;
    };
    const tri3 = (a, b, c, col, towards) => (facing(a, b, c, towards) ? tri(a, b, c, col) : tri(a, c, b, col));
    const quad = (a, b, c, d, col, towards) => { tri3(a, b, c, col, towards); tri3(a, c, d, col, towards); };
    const both = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); tri(a, c, b, col); tri(a, d, c, col); };
    // flat normals, one per triangle, so the page does not have to compute them
    const done = () => {
      const positions = P.slice(0, n), normals = new Float32Array(n);
      for (let i = 0; i < n; i += 9) {
        const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
        const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (let k = 0; k < 9; k += 3) { normals[i + k] = nx; normals[i + k + 1] = ny; normals[i + k + 2] = nz; }
      }
      return { positions, normals, colors: K.slice(0, n), triangles: n / 9 };
    };
    return { tri, tri3, quad, both, done, count: () => n / 9 };
  }
  const UP = [0, 1, 0], DOWN = [0, -1, 0];

  // ------------------------------------------------------------------ polygons
  const inPoly = (x, z, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], b = P[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const segDist2 = (x, z, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = a[0] + dx * t - x, ez = a[1] + dz * t - z;
    return ex * ex + ez * ez;
  };
  const segDist = (x, z, a, b) => Math.sqrt(segDist2(x, z, a, b));
  const polyDist = (x, z, P) => { let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, segDist2(x, z, P[i], P[(i + 1) % P.length])); return Math.sqrt(d); };
  const sdPoly = (x, z, P) => (inPoly(x, z, P) ? 1 : -1) * polyDist(x, z, P);   // > 0 inside

  // A raster of a function over a box, read back with bilinear interpolation; `outside` beyond the box
  function raster(x0, z0, x1, z1, step, f, outside) {
    const cols = Math.ceil((x1 - x0) / step) + 1, rows = Math.ceil((z1 - z0) / step) + 1, data = new Float32Array(cols * rows);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) data[i * rows + j] = f(x0 + i * step, z0 + j * step);
    return (x, z) => {
      const u = (x - x0) / step, v = (z - z0) / step;
      if (u < 0 || v < 0 || u >= cols - 1 || v >= rows - 1) return outside(x, z);
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const a = data[i * rows + j], b = data[(i + 1) * rows + j], c = data[i * rows + j + 1], d = data[(i + 1) * rows + j + 1];
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    };
  }

  // ------------------------------------------------------------------ the circuit
  function circuit(data) {
    const pts = data.waypoints.map(p => [p[0], p[1]]), H = data.waypoints.map(p => p[2] || 0);
    const half = data.waypoints.map(p => [p[3] || data.roadHalfWidth || 7.5, p[4] || data.roadHalfWidth || 7.5]);   // asphalt on the left, on the right
    const n = pts.length;
    // the centreline at full resolution (3 m), when the circuit has it: distances and heights near the road, the
    // barriers and whatever stands along them follow the road exactly (a 12 m chord cuts 1.4 m into a tight corner)
    const F = data.fine || data.waypoints, R = data.fine ? data.fineStep || 4 : 1, fn = F.length;
    const fpts = F.map(p => [p[0], p[1]]), fH = F.map(p => p[2] || 0), fhalf = F.map(p => [p[3] || 7.5, p[4] || 7.5]);
    const fineTangent = i => { const a = fpts[(i - 1 + fn) % fn], b = fpts[(i + 1) % fn], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const CELL = 40, grid = new Map();
    for (let i = 0; i < fn; i++) {
      const a = fpts[i], b = fpts[(i + 1) % fn];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const z0 = Math.floor(Math.min(a[1], b[1]) / CELL), z1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x + ',' + z; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    }
    const seg = (i, x, z) => {                                         // a segment of the fine line
      const a = fpts[i], b = fpts[(i + 1) % fn], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return { d: Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z), t };
    };
    // the closest segment: the grid cells around the point first, then every segment (without allocating)
    const nearest = (x, z) => {
      let bd = Infinity, bi = 0, bt = 0;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get((cx + i) + ',' + (cz + j)) || []) {
        const q = seg(s, x, z);
        if (q.d < bd) { bd = q.d; bi = s; bt = q.t; }
      }
      if (bd <= CELL) {                                                 // waypoint index and position between waypoints
        const fi = bi + bt, ci = Math.floor(fi / R) % n;
        return { d: bd, i: ci, t: Math.min(1, (fi - Math.floor(fi / R) * R) / R), h: fH[bi] + (fH[(bi + 1) % fn] - fH[bi]) * bt };
      }
      for (let s = 0; s < n; s++) {                                     // far away: the waypoints are precise enough
        const a = pts[s], b = pts[(s + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = a[0] + dx * t - x, ez = a[1] + dz * t - z, d = ex * ex + ez * ez;
        if (d < bd * bd) { bd = Math.sqrt(d); bi = s; bt = t; }
      }
      return { d: bd, i: bi, t: bt, h: H[bi] + (H[(bi + 1) % n] - H[bi]) * bt };
    };
    const heightOn = (i, t) => H[i] + (H[(i + 1) % n] - H[i]) * t;
    const tangent = i => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    const REACH = 420, box = [minX - REACH, minZ - REACH, maxX + REACH, maxZ + REACH];
    let last = null;                                                    // both rasters are filled in the same order: one search per point
    const near = (x, z) => (last && last.x === x && last.z === z ? last.r : (last = { x, z, r: nearest(x, z) }).r);
    const dist = raster(...box, 4, (x, z) => near(x, z).d, (x, z) => REACH + Math.hypot(Math.max(box[0] - x, x - box[2], 0), Math.max(box[1] - z, z - box[3], 0)));
    const roadHeight = raster(...box, 4, (x, z) => near(x, z).h, () => 0);
    // the town's own level: the road's heights spread around it (inverse distance), so blocks between two
    // stretches of road sit on a slope from one to the other
    // the lowest stretch of road whose barriers are within a terrain cell (13 m) of a point: the ground there
    // must stay under it, or a triangle of the ground would show through the asphalt
    const roadFloor = raster(...box, 4, (x, z) => {
      let lo = Infinity;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get((cx + i) + ',' + (cz + j)) || []) {
        const q = seg(s, x, z);
        if (q.d < Math.max(fhalf[s][0], fhalf[s][1]) + OUTSIDE + 13) lo = Math.min(lo, fH[s] + (fH[(s + 1) % fn] - fH[s]) * q.t);
      }
      return lo === Infinity ? 1e4 : lo;
    }, () => 1e4);
    const townLevel = raster(...box, 10, (x, z) => {
      let sw = 0, sh = 0;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (const s of grid.get((cx + i) + ',' + (cz + j)) || []) {
        if (s % R) continue;                                            // one point in R is plenty here
        const d = Math.hypot(fpts[s][0] - x, fpts[s][1] - z), w = 1 / (d * d + 400);
        sw += w; sh += w * fH[s];
      }
      return sw > 0 ? sh / sw : 0;
    }, () => 0);
    const lap = [0];
    for (let i = 0; i < n; i++) lap.push(lap[i] + Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]));
    // a point at a distance along the lap (metres from the start line), with the direction and height there
    const along = s => {
      s = ((s % lap[n]) + lap[n]) % lap[n];
      let i = Math.min(n - 1, Math.floor(s / lap[n] * n));
      while (lap[i] > s) i--; while (lap[i + 1] < s) i++;
      const t = (s - lap[i]) / (lap[i + 1] - lap[i]), a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return { p: [a[0] + dx * t, a[1] + dz * t], t: [dx / l, dz / l], h: heightOn(i, t), i };
    };
    // turning direction at a waypoint: > 0 right, < 0 left (seen from the car)
    const turn = (i, reach = 3) => { const a = tangent((i - reach + n) % n), b = tangent((i + reach) % n); return a[0] * b[1] - a[1] * b[0]; };
    // back of the barrier at waypoint i, on the left (s < 0) or right side
    const fineIndex = i => (((Math.round(i * R)) % fn) + fn) % fn;
    const barrier = (i, s) => fhalf[fineIndex(i)][s < 0 ? 0 : 1] + OUTSIDE;
    // a point beside the road: waypoint i (fractional), u metres to the right of the centreline, y above the road
    const beside = (i, u, y = 0) => {
      const fi = (((i * R) % fn) + fn) % fn, k = Math.floor(fi), f = fi - k, a = fpts[k], b = fpts[(k + 1) % fn];
      const ta = fineTangent(k), tb = fineTangent((k + 1) % fn), tx = ta[0] + (tb[0] - ta[0]) * f, tz = ta[1] + (tb[1] - ta[1]) * f, tl = Math.hypot(tx, tz) || 1;
      const h = fH[k] + (fH[(k + 1) % fn] - fH[k]) * f;
      return [a[0] + (b[0] - a[0]) * f - tz / tl * u, h + y, a[1] + (b[1] - a[1]) * f + tx / tl * u];
    };
    return { pts, H, half, n, beside, nearest, heightOn, tangent, dist, roadHeight, roadFloor, townLevel, along, lap, turn, barrier, length: lap[n], bounds: { minX, maxX, minZ, maxZ } };
  }

  // ------------------------------------------------------------------ land and sea
  function geography(road, data) {
    const water = data.water, rockLine = data.rock.outline;
    const jetties = data.jetties;
    const jettyDist = (x, z) => { let d = Infinity; for (const j of jetties) d = Math.min(d, segDist(x, z, j.from, j.to) - j.half); return d; };
    const exact = (x, z) => Math.max(-sdPoly(x, z, water), -jettyDist(x, z));
    const b = road.bounds, box = [b.minX - 700, b.minZ - 700, b.maxX + 700, b.maxZ + 900];
    const land = raster(...box, 6, exact, exact);                         // > 0 on land, metres from the shore
    const rockSd = raster(...box, 8, (x, z) => sdPoly(x, z, rockLine), (x, z) => sdPoly(x, z, rockLine));
    let hx = 0, hz = 0;
    for (const q of data.quays) { hx += q[0]; hz += q[1]; }
    const harbourCentre = [hx / data.quays.length, hz / data.quays.length];
    return { land, rockSd, jetties, quays: data.quays, harbourCentre, rockHeight: data.rock.height, north: data.north || [0, -1] };
  }

  // ------------------------------------------------------------------ heights
  const terraces = (v, step = 11) => { const f = v / step, i = Math.floor(f); return step * (i + smooth(0.5, 1, f - i)); };
  function relief(road, geo) {
    return (x, z) => {
      const d = road.dist(x, z), shore = geo.land(x, z);
      const base = road.townLevel(x, z);
      // the hills start behind the town, away from both the road and the sea
      const up = Math.max(0, Math.min(d - 150, shore - 160));
      const hill = terraces(up * 0.32 + 26 * (fbm(x / 160, z / 160) - 0.5) * smooth(0, 120, up)) * smooth(0, 60, up);
      const mountains = smooth(900, 3200, up) * (260 + 480 * ridged(x / 1100 + 3, z / 1100)) * (0.75 + 0.5 * fbm(x / 500, z / 500));
      let h = base + hill + mountains;
      const rock = geo.rockSd(x, z);                                     // the Rock: a plateau with cliffs all round
      if (rock > -40) h = Math.max(h, geo.rockHeight * smooth(-34, 6, rock) + (rock > 6 ? 3 * fbm(x / 40, z / 40) : 0));
      if (d < 30) h = h + (road.roadHeight(x, z) - 0.25 - h) * (1 - smooth(11, 30, d));
      return Math.min(h, road.roadFloor(x, z) - 0.5);
    };
  }

  // ------------------------------------------------------------------ terrain
  function terrain(road, geo, height, B) {
    const colourAt = (a, b, c) => {
      const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3, z = (a[2] + b[2] + c[2]) / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const flat = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      const k = 0.95 + 0.1 * hash2(x * 0.31, z * 0.31);
      const d = road.dist(x, z), shore = geo.land(x, z), rock = geo.rockSd(x, z);
      if (flat < 0.72) {                                              // cliffs and terrace walls; bare rock higher up
        const alt = hash2(Math.round(y / 11), Math.round(x / 40)) > 0.5;
        if (road.dist(x, z) < 190 && geo.rockSd(x, z) < -20) return shade(alt ? C.quayWall : C.retaining, k);   // retaining walls in town
        return shade(y > 160 ? (alt ? C.rock : C.rockDark) : (alt ? C.cliff : C.cliffDark), k);
      }
      if (y > 700) return shade(C.summit, k);
      if (y > 420) return shade(flat > 0.9 ? C.meadow : C.rock, k);
      if (rock > 4) return shade(fbm(x / 30, z / 30) > 0.55 ? C.lawn : C.plaza, k);
      const inTown = d < 170 && y - road.townLevel(x, z) < 6;
      if (inTown || d < 40) {
        if (shore < 14) return shade(C.quay, k);
        if (d < 12) return shade(C.pavement, k);
        if (d < 21) return shade(C.sidewalk, k);
        return shade(fbm(x / 60, z / 60) > 0.66 ? C.lawn : C.town, k);
      }
      return shade(fbm(x / 70, z / 70) > 0.5 ? C.grass : C.meadow, k);
    };
    // A grid of squares split in two triangles; each triangle is clipped against the shoreline, and the
    // cut gets a quay wall down into the water.
    const sample = (x, z) => { const s = geo.land(x, z); return { p: [x, s > 0 ? height(x, z) : 0, z], s }; };
    const emit = corners => {
      const inside = corners.filter(c => c.s > 0);
      if (inside.length === 0) return;
      if (inside.length === 3) { B.tri3(corners[0].p, corners[1].p, corners[2].p, colourAt(corners[0].p, corners[1].p, corners[2].p), UP); return; }
      const poly = [], cut = [];
      for (let i = 0; i < 3; i++) {
        const a = corners[i], b = corners[(i + 1) % 3];
        if (a.s > 0) poly.push(a.p);
        if ((a.s > 0) !== (b.s > 0)) {
          const t = a.s / (a.s - b.s), x = a.p[0] + (b.p[0] - a.p[0]) * t, z = a.p[2] + (b.p[2] - a.p[2]) * t;
          const p = [x, Math.max(height(x, z), 0), z];
          poly.push(p); cut.push(p);
        }
      }
      for (let i = 1; i + 1 < poly.length; i++) B.tri3(poly[0], poly[i], poly[i + 1], colourAt(poly[0], poly[i], poly[i + 1]), UP);
      if (cut.length === 2) {                                         // quay wall, facing the sea
        const [p, q] = cut, mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2;
        const ex = q[0] - p[0], ez = q[2] - p[2], l = Math.hypot(ex, ez) || 1;
        let nx = -ez / l, nz = ex / l;
        if (geo.land(mx + nx * 2, mz + nz * 2) > 0) { nx = -nx; nz = -nz; }
        B.quad([p[0], p[1], p[2]], [q[0], q[1], q[2]], [q[0], QUAY_FOOT, q[2]], [p[0], QUAY_FOOT, p[2]], shade(C.quayWall, 0.95 + 0.1 * hash2(mx, mz)), [nx, 0, nz]);
      }
    };
    const grid = (x0, x1, z0, z1, step, skip) => {
      const cols = Math.round((x1 - x0) / step), rows = Math.round((z1 - z0) / step), S = [];
      for (let i = 0; i <= cols; i++) { const col = []; for (let j = 0; j <= rows; j++) col.push(sample(x0 + i * step, z0 + j * step)); S.push(col); }
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (skip && skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
        const a = S[i][j], b = S[i + 1][j], c = S[i + 1][j + 1], d = S[i][j + 1];
        if ((i + j) % 2 === 0) { emit([a, b, c]); emit([a, c, d]); } else { emit([a, b, d]); emit([b, c, d]); }
      }
      return S;
    };
    const { minX, maxX, minZ, maxZ } = road.bounds;
    const fine = { x0: Math.floor((minX - 600) / 100) * 100, x1: Math.ceil((maxX + 500) / 100) * 100, z0: Math.floor((minZ - 600) / 100) * 100, z1: Math.ceil((maxZ + 700) / 100) * 100 };
    const S = grid(fine.x0, fine.x1, fine.z0, fine.z1, 9);
    // skirts under the edges of the fine grid hide the seams with the coarse one
    const edge = (a, b, out) => { if (a.s > 0 && b.s > 0) B.quad(a.p, b.p, [b.p[0], b.p[1] - 60, b.p[2]], [a.p[0], a.p[1] - 60, a.p[2]], C.meadow, out); };
    for (let i = 0; i + 1 < S.length; i++) { edge(S[i][0], S[i + 1][0], [0, 0, -1]); edge(S[i][S[i].length - 1], S[i + 1][S[i].length - 1], [0, 0, 1]); }
    for (let j = 0; j + 1 < S[0].length; j++) { edge(S[0][j], S[0][j + 1], [-1, 0, 0]); edge(S[S.length - 1][j], S[S.length - 1][j + 1], [1, 0, 0]); }
    const R = 9000, step = 150, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    grid(Math.floor((cx - R) / step) * step, Math.ceil((cx + R) / step) * step, Math.floor((cz - R) / step) * step, Math.ceil((cz + R) / step) * step, step,
      (x, z) => x - step / 2 >= fine.x0 && x + step / 2 <= fine.x1 && z - step / 2 >= fine.z0 && z + step / 2 <= fine.z1);
    const W = 14000;                                                    // the sea, out to the horizon
    B.quad([cx - W, WATER_Y, cz - W], [cx + W, WATER_Y, cz - W], [cx + W, WATER_Y, cz + W], [cx - W, WATER_Y, cz + W], C.sea, UP);
    return fine;
  }

  // ------------------------------------------------------------------ props: prisms, trees, palms, boulders
  function Props(B, rnd) {
    // a vertical prism over a convex footprint [[x, z], ...], walls coloured `col`, top coloured `top`
    const prism = (corners, y0, y1, col, top = col, bottom = false) => {
      const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length, cz = corners.reduce((s, c) => s + c[1], 0) / corners.length;
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], shade(col, i % 2 ? 0.96 : 1), [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz]);
      }
      if (top) for (let i = 1; i + 1 < corners.length; i++) B.tri3([corners[0][0], y1, corners[0][1]], [corners[i][0], y1, corners[i][1]], [corners[i + 1][0], y1, corners[i + 1][1]], top, UP);
      if (bottom) for (let i = 1; i + 1 < corners.length; i++) B.tri3([corners[0][0], y0, corners[0][1]], [corners[i][0], y0, corners[i][1]], [corners[i + 1][0], y0, corners[i + 1][1]], bottom, DOWN);
    };
    const rect = (cx, cz, ux, uz, hw, hd) => {                        // rectangle centred on (cx, cz), half sizes along u and across
      const vx = -uz, vz = ux;
      return [[cx - ux * hw - vx * hd, cz - uz * hw - vz * hd], [cx + ux * hw - vx * hd, cz + uz * hw - vz * hd], [cx + ux * hw + vx * hd, cz + uz * hw + vz * hd], [cx - ux * hw + vx * hd, cz - uz * hw + vz * hd]];
    };
    const ring = (cx, cz, r, sides, phase = 0) => Array.from({ length: sides }, (_, i) => [cx + Math.cos(phase + i / sides * 2 * Math.PI) * r, cz + Math.sin(phase + i / sides * 2 * Math.PI) * r]);
    // a faceted ball (icosahedron), for tree crowns and boulders
    const ICO = (() => {
      const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(p => { const l = Math.hypot(...p); return p.map(c => c / l); });
      const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      return { v, f };
    })();
    const ball = (x, y, z, rx, ry, rz, cols, jitter = 0.18) => {
      const v = ICO.v.map(p => { const k = 1 + (rnd() - 0.5) * jitter; return [x + p[0] * rx * k, y + p[1] * ry * k, z + p[2] * rz * k]; });
      ICO.f.forEach((f, i) => {
        const a = v[f[0]], b = v[f[1]], c = v[f[2]];
        const m = [(a[0] + b[0] + c[0]) / 3 - x, (a[1] + b[1] + c[1]) / 3 - y, (a[2] + b[2] + c[2]) / 3 - z];
        B.tri3(a, b, c, shade(cols[i % cols.length], 0.9 + 0.2 * (m[1] > 0 ? 1 : 0)), m);
      });
    };
    // a round tree; `far` ones (on the hills) get a five-sided crown, half the triangles
    const tree = (x, z, base, size = 1, far = false) => {
      const h = (2.2 + rnd() * 1.4) * size, r = (2.4 + rnd() * 1.6) * size;
      const s = ring(x, z, 0.35 * size, far ? 3 : 4, rnd());
      prism(s, base - 0.5, base + h + 0.5, C.trunk, null);
      const col = C.leaves[Math.floor(rnd() * C.leaves.length)];
      if (!far) { ball(x, base + h + r * 0.8, z, r, r * 0.9, r, [col, shade(col, 0.92), shade(col, 1.06)]); return; }
      const y = base + h + r * 0.8, rim = ring(x, z, r, 5, rnd() * 6), top = [x, y + r * 0.9, z], bottom = [x, y - r * 0.8, z];
      for (let k = 0; k < 5; k++) {
        const a = [rim[k][0], y, rim[k][1]], b = [rim[(k + 1) % 5][0], y, rim[(k + 1) % 5][1]], out = [(a[0] + b[0]) / 2 - x, 0, (a[2] + b[2]) / 2 - z];
        B.tri3(a, b, top, shade(col, 1.04), [out[0], 1, out[2]]);
        B.tri3(a, b, bottom, shade(col, 0.88), [out[0], -1, out[2]]);
      }
    };
    const palm = (x, z, base) => {
      const tall = 7 + rnd() * 4, lean = (rnd() - 0.5) * 0.14, la = rnd() * Math.PI * 2;
      const topX = x + Math.cos(la) * tall * lean, topZ = z + Math.sin(la) * tall * lean, topY = base + tall;
      const lo = ring(x, z, 0.32, 5), hi = ring(topX, topZ, 0.22, 5);
      for (let i = 0; i < 5; i++) B.quad([lo[i][0], base - 0.5, lo[i][1]], [lo[(i + 1) % 5][0], base - 0.5, lo[(i + 1) % 5][1]], [hi[(i + 1) % 5][0], topY, hi[(i + 1) % 5][1]], [hi[i][0], topY, hi[i][1]], C.trunk, [lo[i][0] - x, 0, lo[i][1] - z]);
      const fronds = 7, spin = rnd() * Math.PI;
      for (let f = 0; f < fronds; f++) {
        const a = spin + f / fronds * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), reach = 3.4 + rnd() * 1.0;
        const mid = [topX + ca * reach * 0.55, topY + 0.7, topZ + sa * reach * 0.55], tip = [topX + ca * reach, topY - 1.5, topZ + sa * reach];
        const wx = -sa * 0.75, wz = ca * 0.75, col = C.frond[f % 2], top = [topX, topY + 0.2, topZ];
        const m1 = [mid[0] + wx, mid[1], mid[2] + wz], m2 = [mid[0] - wx, mid[1], mid[2] - wz];
        B.tri3(top, m1, m2, col, UP); B.tri3(m1, tip, m2, col, UP);
        B.tri3(top, m2, m1, shade(col, 0.7), DOWN); B.tri3(m2, tip, m1, shade(col, 0.7), DOWN);
      }
    };
    const boulder = (x, z, y, size) => ball(x, y, z, size * (0.9 + rnd() * 0.4), size * (0.6 + rnd() * 0.3), size * (0.9 + rnd() * 0.4), C.boulder, 0.4);
    return { prism, rect, ring, ball, tree, palm, boulder };
  }

  // ------------------------------------------------------------------ buildings
  function Buildings(B, rnd, X) {
    const pick = list => list[Math.floor(rnd() * list.length)];
    const W = C.walls;
    // the styles of the reference town: white towers with a grid of blue windows and dark crowns, pink and
    // cream blocks with window bands and roof pools, yellow towers, old houses with shutters and tiles
    const STYLES = {
      tower: () => ({ wall: pick([W.white, W.white, W.ice, W.cream]), windows: 'grid', crown: true, roof: C.crownRoof, ac: true }),
      yellowTower: () => ({ wall: pick([W.yellow, W.lemon]), windows: 'grid', frame: true, roof: W.lemon, ac: rnd() < 0.5 }),
      pinkBlock: () => ({ wall: pick([W.pink, W.salmon, W.sand, W.cream]), windows: 'bands', dark: rnd() < 0.5, roof: C.roof, pool: rnd() < 0.5, ac: true }),
      whiteBlock: () => ({ wall: pick([W.white, W.cream, W.ice]), windows: 'grid', roof: C.roof, pool: rnd() < 0.4, ac: true }),
      old: () => ({ wall: pick([W.cream, W.ochre, W.pink, W.sand, W.lemon, W.salmon]), windows: 'classic', shutters: rnd() < 0.7, tiled: rnd() < 0.75, roof: C.roof }),
    };
    const outward = (corners, i) => {
      const a = corners[i], b = corners[(i + 1) % 4], cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][1] + corners[2][1]) / 2;
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz, l = Math.hypot(mx, mz) || 1;
      return [mx / l, 0, mz / l];
    };
    // A block: walls, windows, then a flat roof (crown, penthouse, pool, air conditioning) or a hipped tiled roof.
    function building(corners, base, floors, style, shopFront = -1) {
      const y0 = base.lo - 3, ground = base.hi, top = ground + floors * FLOOR + 0.8;
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], out = outward(corners, i), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const wallCol = shade(style.wall, i % 2 ? 0.95 : 1);
        B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], wallCol, out);
        const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len;
        const at = (t, y, off) => [a[0] + ex * t + out[0] * off, y, a[1] + ez * t + out[2] * off];
        const face = (t0, t1, ya, yb, col, off) => B.quad(at(t0, ya, off), at(t1, ya, off), at(t1, yb, off), at(t0, yb, off), col, out);
        let first = 0;
        if (shopFront === i) {                                         // shop windows and an awning on the street side
          face(0.6, len - 0.6, ground + 0.2, ground + 2.6, C.windowDark, 0.1);
          const o = 1.7, p0 = at(0.3, ground + 3.0, 0), p1 = at(len - 0.3, ground + 3.0, 0);
          B.quad(p0, p1, [p1[0] + out[0] * o, ground + 2.5, p1[2] + out[2] * o], [p0[0] + out[0] * o, ground + 2.5, p0[2] + out[2] * o], pick([C.pitRed, C.window, C.bridgeGreen, W.white]), [out[0], 1, out[2]]);
          first = 1;
        }
        if (len < 3.5) continue;
        const win = style.dark ? C.windowDark : C.window;
        if (style.windows === 'grid') {
          // window columns over the whole height, then wall-coloured floor slabs across them
          const count = Math.max(1, Math.floor((len - 1) / 2.7)), w = 1.55, gap = (len - count * w) / (count + 1);
          const yLow = ground + first * FLOOR + 0.8, yHigh = top - 1.4;
          if (yHigh - yLow < 1) continue;
          for (let k = 0; k < count; k++) { const t = gap + k * (w + gap); face(t, t + w, yLow, yHigh, win, 0.12); }
          const slab = style.frame ? C.frame : wallCol;
          for (let f = first; f < floors - 1; f++) face(0, len, ground + f * FLOOR + 2.6, ground + (f + 1) * FLOOR + 0.8, slab, 0.24);
        } else if (style.windows === 'bands') {
          for (let f = first; f < floors; f++) face(0.7, len - 0.7, ground + f * FLOOR + 0.9, ground + f * FLOOR + 2.5, win, 0.12);
        } else if (style.windows === 'classic') {
          const count = Math.max(1, Math.floor((len - 1.5) / 3.3)), w = 1.2, gap = (len - count * w) / (count + 1);
          for (let f = first; f < floors; f++) {
            const fy = ground + f * FLOOR + 0.9;
            for (let k = 0; k < count; k++) {
              const t = gap + k * (w + gap);
              face(t, t + w, fy, fy + 1.7, C.windowDark, 0.08);
              if (style.shutters) { face(t - 0.55, t - 0.05, fy, fy + 1.7, C.shutter, 0.1); face(t + w + 0.05, t + w + 0.55, fy, fy + 1.7, C.shutter, 0.1); }
            }
          }
        }
      }
      const R = y => corners.map(c => [c[0], y, c[1]]);
      const cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][1] + corners[2][1]) / 2;
      const inset = k => corners.map(c => [cx + (c[0] - cx) * k, cz + (c[1] - cz) * k]);
      if (style.tiled) {                                              // hipped roof
        const r = R(top);
        const l01 = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]), l12 = Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]);
        const rise = Math.min(l01, l12) * 0.3, ridgeHalf = Math.max(0, (Math.max(l01, l12) - Math.min(l01, l12)) / 2);
        const ax = l01 >= l12 ? (corners[1][0] - corners[0][0]) / l01 : (corners[2][0] - corners[1][0]) / l12, az = l01 >= l12 ? (corners[1][1] - corners[0][1]) / l01 : (corners[2][1] - corners[1][1]) / l12;
        const ra = [cx - ax * ridgeHalf, top + rise, cz - az * ridgeHalf], rb = [cx + ax * ridgeHalf, top + rise, cz + az * ridgeHalf];
        const closer = (p, u, v) => (Math.hypot(p[0] - u[0], p[2] - u[2]) < Math.hypot(p[0] - v[0], p[2] - v[2]) ? u : v);
        for (let i = 0; i < 4; i++) {
          const a = r[i], b = r[(i + 1) % 4], out = outward(corners, i);
          const alongRidge = Math.abs((b[0] - a[0]) * ax + (b[2] - a[2]) * az) > 0.5;
          if (alongRidge && ridgeHalf > 0.01) B.quad(a, b, closer(b, ra, rb), closer(a, ra, rb), shade(C.tiles, 0.92 + 0.08 * (i % 2)), [out[0], 1, out[2]]);
          else B.tri3(a, b, closer([(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2], ra, rb), shade(C.tiles, 0.86 + 0.08 * (i % 2)), [out[0], 1, out[2]]);
        }
        return top + rise;
      }
      let roofY = top;
      if (style.crown) {                                              // a dark band round the top, a brown roof, a stair house
        X.prism(inset(1.02), top - 1.6, top + 0.6, C.crown, C.crown);
        X.prism(inset(0.78), top + 0.6, top + 1.6, C.crownRoof, C.crownRoof);
        X.prism(inset(0.38), top + 1.6, top + 4.0, C.crown, C.crownRoof);
        return top + 4;
      }
      B.quad(...R(top), style.roof, UP);
      X.prism(inset(1.0), top, top + 0.7, shade(style.wall, 0.9), null);     // parapet
      if (style.pool) {
        const p = inset(0.45);
        B.quad(...p.map(c => [c[0], top + 0.08, c[1]]), C.pool, UP);
      }
      if (style.ac) for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
        const px = cx + (corners[0][0] - cx) * (rnd() - 0.5) * 1.2 + (corners[1][0] - cx) * (rnd() - 0.5) * 0.5, pz = cz + (corners[0][1] - cz) * (rnd() - 0.5) * 1.2 + (corners[1][1] - cz) * (rnd() - 0.5) * 0.5;
        X.prism(X.rect(px, pz, 1, 0, 0.9, 0.7), top, top + 1.2, C.ac);
      }
      if (floors > 6 && rnd() < 0.6) { X.prism(inset(0.3), top, top + 3, shade(style.wall, 0.92), style.roof); roofY = top + 3; }
      return roofY;
    }
    return { building, STYLES, outward, pick };
  }

  // ------------------------------------------------------------------ the town
  function town(road, geo, height, B, rnd, data) {
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
          let ok = true;
          for (const e of edges) if ((px - e[0]) * e[2] + (pz - e[1]) * e[3] > pad) { ok = false; break; }
          if (ok) out.push((x + 32768) * 65536 + z + 32768);
        }
      return out;
    };
    const claim = (corners, pad = 0) => { for (const k of cellsOf(corners, pad)) occupied.add(k); };
    const free = (corners, pad = 1.5) => cellsOf(corners, pad).every(k => !occupied.has(k));
    // can a footprint stand here? returns its base heights, or null
    const site = (corners, clearRoad = ROAD_CLEAR, shore = 6, slope = 6) => {
      const probes = corners.concat([[(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]],
        corners.map((c, i) => [(c[0] + corners[(i + 1) % corners.length][0]) / 2, (c[1] + corners[(i + 1) % corners.length][1]) / 2]));
      let lo = Infinity, hi = -Infinity;
      for (const [x, z] of probes) {
        if (road.dist(x, z) < clearRoad || geo.land(x, z) < shore) return null;
        const h = height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return hi - lo > slope ? null : { lo, hi };
    };
    const X = Props(B, rnd), Bd = Buildings(B, rnd, X), T = { claim, free, site, X, Bd };
    const stats = { buildings: 0, trees: 0, yachts: 0 };

    // ---- landmarks first, so the town fills in around them
    landmarks(road, geo, height, B, rnd, T, data, stats);

    const S = Bd.STYLES;
    // style and size by district: the Rock keeps its old houses; towers grow with the distance from the sea
    const choose = (x, z, nearRoad) => {
      const shore = geo.land(x, z);
      if (geo.rockSd(x, z) > -8) return { style: S.old(), floors: 3 + Math.floor(rnd() * 2) };
      const high = smooth(90, 420, shore), r = rnd();
      if (r < 0.10 + 0.40 * high && !nearRoad) return { style: rnd() < 0.3 ? S.yellowTower() : S.tower(), floors: 12 + Math.floor(rnd() * (8 + 14 * high)), tower: true };
      if (r < 0.15 + 0.4 * high) return { style: rnd() < 0.5 ? S.whiteBlock() : S.yellowTower(), floors: 7 + Math.floor(rnd() * 7) };
      if (r < 0.65) return { style: S.pinkBlock(), floors: 4 + Math.floor(rnd() * 5) };
      if (r < 0.85) return { style: S.whiteBlock(), floors: 4 + Math.floor(rnd() * 6) };
      return { style: S.old(), floors: 3 + Math.floor(rnd() * 4) };
    };

    // ---- 1. the street front: blocks lining the road on both sides
    for (const s of [-1, 1]) {
      for (let at = 0; at < road.length;) {
        const w = 12 + rnd() * 12, here = road.along(at + w / 2), t = here.t, p = here.p, nx = -t[1] * s, nz = t[0] * s;
        const dpt = 13 + rnd() * 10, front = ROAD_CLEAR + 3 + rnd() * 2;
        const cx = p[0] + nx * (front + dpt / 2), cz = p[1] + nz * (front + dpt / 2);
        const corners = X.rect(cx, cz, t[0], t[1], w / 2, dpt / 2);
        const base = site(corners, ROAD_CLEAR, 10, 16);                // down a slope, the block gets a tall basement
        if (base && free(corners, 0.4)) {
          let shopFront = 0, best = -Infinity;
          for (let k = 0; k < 4; k++) { const o = Bd.outward(corners, k), dot = -(o[0] * nx + o[2] * nz); if (dot > best) { best = dot; shopFront = k; } }
          const c = choose(cx, cz, true);
          Bd.building(corners, base, c.floors, c.style, c.style.windows === 'grid' && c.floors > 9 ? -1 : shopFront);
          claim(corners, 0.4); stats.buildings++;
        }
        at += w + 0.6 + rnd() * 1.5;
      }
    }

    // ---- 2. the rest of the town, up the slopes
    const { minX, maxX, minZ, maxZ } = road.bounds;
    for (let x = minX - 420; x < maxX + 380; x += 21) for (let z = minZ - 420; z < maxZ + 520; z += 21) {
      const jx = x + (rnd() - 0.5) * 7, jz = z + (rnd() - 0.5) * 7, d = road.dist(jx, jz);
      if (d < 26 || d > 360 || geo.land(jx, jz) < 12) continue;
      if (rnd() > (d < 220 ? 0.92 : 0.92 - (d - 220) / 200)) continue;
      const nr = road.nearest(jx, jz), t = road.tangent(nr.i);
      const angle = Math.atan2(t[1], t[0]) + (d < 140 ? 0 : (rnd() - 0.5) * 0.4);
      const c = choose(jx, jz, false);
      const w = c.tower ? 16 + rnd() * 8 : 13 + rnd() * 9, dpt = c.tower ? 16 + rnd() * 8 : 12 + rnd() * 10;
      const corners = X.rect(jx, jz, Math.cos(angle), Math.sin(angle), w / 2, dpt / 2);
      const base = site(corners, 22, 12);
      if (!base || !free(corners, 1.2)) continue;
      Bd.building(corners, base, c.floors, c.style);
      claim(corners, 1.2); stats.buildings++;
    }

    // ---- 3. villas and trees on the hills, palms by the sea
    for (let x = minX - 1300; x < maxX + 900; x += 30) for (let z = minZ - 1300; z < maxZ + 700; z += 30) {
      const jx = x + (rnd() - 0.5) * 22, jz = z + (rnd() - 0.5) * 22, d = road.dist(jx, jz);
      if (d < 200 || geo.land(jx, jz) < 30) continue;
      const h = height(jx, jz);
      if (h > 520) continue;
      if (rnd() < 0.16 && d < 900) {
        const a = rnd() * Math.PI, corners = X.rect(jx, jz, Math.cos(a), Math.sin(a), 4 + rnd() * 4, 4 + rnd() * 3);
        const base = site(corners, 30, 30, 3);
        if (base && free(corners)) { Bd.building(corners, base, 2 + Math.floor(rnd() * 2), rnd() < 0.6 ? S.old() : S.pinkBlock()); claim(corners, 1); stats.buildings++; continue; }
      }
      for (let k = 0; k < 3; k++) {                                     // a clump of trees
        const tx = jx + (rnd() - 0.5) * 18, tz = jz + (rnd() - 0.5) * 18, cell = [[tx - 2, tz - 2], [tx + 2, tz - 2], [tx + 2, tz + 2], [tx - 2, tz + 2]];
        if (rnd() < 0.35 || !free(cell, 0) || !site(cell, 30, 20, 2.5)) continue;
        X.tree(tx, tz, height(tx, tz), 0.9 + rnd() * 0.6, true); claim(cell); stats.trees++;
      }
    }
    // trees in the town's gaps and on the Rock's edges
    for (let x = minX - 400; x < maxX + 380; x += 13) for (let z = minZ - 400; z < maxZ + 560; z += 13) {
      const tx = x + (rnd() - 0.5) * 9, tz = z + (rnd() - 0.5) * 9;
      if (rnd() < 0.55) continue;
      const cell = [[tx - 2.5, tz - 2.5], [tx + 2.5, tz - 2.5], [tx + 2.5, tz + 2.5], [tx - 2.5, tz + 2.5]];
      if (road.dist(tx, tz) < 17 || road.dist(tx, tz) > 380 || !free(cell, 0.5) || !site(cell, 17, 8, 2.5)) continue;
      X.tree(tx, tz, height(tx, tz), 0.8 + rnd() * 0.5); claim(cell); stats.trees++;
    }
    return stats;
  }

  // ------------------------------------------------------------------ landmarks
  function landmarks(road, geo, height, B, rnd, T, data, stats) {
    const { X, Bd } = T, P = data.places || {}, n = road.n;
    const wp = i => ((i % n) + n) % n;
    // a point beside the road: waypoint i (fractional), u metres to the right, y above the road
    const beside = road.beside;
    const right = i => { const t = road.tangent(wp(i)); return [-t[1], 0, t[0]]; };
    // which side of the road, at waypoint i, has more of something (+1 right, -1 left)
    const sideOf = (i, score) => (score(beside(i, 40)) >= score(beside(i, -40)) ? 1 : -1);
    const otherRoad = (p, i) => { const r = road.nearest(p[0], p[2]); return Math.min(Math.abs(r.i - i), n - Math.abs(r.i - i)) > 8 ? r.d : Infinity; };

    // A long block that follows the road between two waypoints, from u0 to u1 metres off its centreline
    // (the right side is positive), from y0 to y1 above the road. Used for the pit garages, the Fairmont, the gallery.
    const ribbon = (i0, i1, u0, u1, y0, y1, col, top = col, ends = true) => {
      for (let i = i0; i < i1; i++) {
        const a = j => beside(j, u0), b = j => beside(j, u1), r = right(i);
        const A0 = a(i), A1 = a(i + 1), B0 = b(i), B1 = b(i + 1);
        const yA0 = A0[1], yA1 = A1[1];
        B.quad([A0[0], yA0 + y0, A0[2]], [A1[0], yA1 + y0, A1[2]], [A1[0], yA1 + y1, A1[2]], [A0[0], yA0 + y1, A0[2]], col, [-r[0] * Math.sign(u1 - u0), 0, -r[2] * Math.sign(u1 - u0)]);
        B.quad([B0[0], yA0 + y0, B0[2]], [B1[0], yA1 + y0, B1[2]], [B1[0], yA1 + y1, B1[2]], [B0[0], yA0 + y1, B0[2]], col, [r[0] * Math.sign(u1 - u0), 0, r[2] * Math.sign(u1 - u0)]);
        if (top) B.quad([A0[0], yA0 + y1, A0[2]], [A1[0], yA1 + y1, A1[2]], [B1[0], yA1 + y1, B1[2]], [B0[0], yA0 + y1, B0[2]], top, UP);
      }
      if (ends) for (const [i, dir] of [[i0, -1], [i1, 1]]) {
        const t = road.tangent(wp(i)), A = beside(i, u0), Bp = beside(i, u1);
        B.quad([A[0], A[1] + y0, A[2]], [Bp[0], A[1] + y0, Bp[2]], [Bp[0], A[1] + y1, Bp[2]], [A[0], A[1] + y1, A[2]], col, [t[0] * dir, 0, t[1] * dir]);
      }
    };
    const claimRibbon = (i0, i1, u0, u1, pad = 1) => {
      for (let i = i0; i < i1; i++) { const a = beside(i, u0), b = beside(i, u1), c = beside(i + 1, u1), d = beside(i + 1, u0); T.claim([[a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [d[0], d[2]]], pad); }
    };

    // ---- lines painted across the road: start, checkpoints, finish. They follow the road exactly; the track
    // parts keep theirs under the asphalt, where the wheels cannot touch them.
    {
      const LINE = { start: [0.96, 0.96, 0.96], checkpoint: [0.89, 0.75, 0.13] };
      const across = (gx, gz, gy, draw) => {
        const x = gx * 5, z = gz * 5, r = road.nearest(x, z), i = r.i + r.t, y = (gy - (data.level || 1)) * 5 + 0.03;
        draw((along, u) => { const p = beside(i + along / 12, u, 0); return [p[0], y, p[2]]; }, -road.half[wp(r.i)][0], road.half[wp(r.i)][1]);
      };
      const band = (P, u0, u1, a0, a1, col) => B.quad(P(a0, u0), P(a0, u1), P(a1, u1), P(a1, u0), col, UP);
      across(0, 0, data.level || 1, (P, l, rr) => band(P, l, rr, -0.3, 0.3, LINE.start));
      for (const c of data.checkpoints || []) across(c.gx, c.gz, c.gy, (P, l, rr) => band(P, l, rr, -0.5, 0.5, LINE.checkpoint));
      if (data.finish) across(data.finish.gx, data.finish.gz, data.finish.gy, (P, l, rr) => {
        const squares = 10, w = (rr - l) / squares;
        for (let k = 0; k < squares; k++) for (let row = 0; row < 2; row++) band(P, l + k * w, l + (k + 1) * w, row * 0.9 - 0.9, row * 0.9, (k + row) % 2 ? [0.96, 0.96, 0.96] : [0.08, 0.08, 0.09]);
      });
    }

    // ---- catch fences on the barriers, all round the lap (not in the tunnel)
    const tunnelFrom = P.tunnelIn != null ? P.tunnelIn + 1 : -1, tunnelTo = P.tunnelIn != null ? Math.min(P.tunnelIn + 28, P.tunnelOut ?? n) : -1;
    const inTunnel = i => i >= tunnelFrom && i < tunnelTo;
    for (let i = 0; i < n; i++) {
      if (inTunnel(i) || inTunnel(i + 1)) continue;
      for (const s of [-1, 1]) {
        // on the back edge of the barrier, in four pieces per waypoint so that it follows the curve (a straight
        // rail from post to post would cut across the outside of a tight corner, over the road)
        const edge = j => beside(j, s * (road.barrier(j, s) - 0.3));
        const r = right(i), out = [r[0] * s, 0, r[2] * s], first = edge(i);
        X.prism(X.rect(first[0], first[2], 1, 0, 0.12, 0.12), first[1] + BARRIER_H, first[1] + 5, C.fence, null);
        for (let q = 0; q < 4; q++) {
          const a = edge(i + q / 4), b = edge(i + (q + 1) / 4);
          for (const y of [BARRIER_H + 1.2, 3.2, 4.9]) B.both([a[0], a[1] + y, a[2]], [b[0], b[1] + y, b[2]], [b[0], b[1] + y + 0.12, b[2]], [a[0], a[1] + y + 0.12, a[2]], C.fence);
          // the mesh itself: a thin diagonal wire per piece, enough to read as a fence
          B.both([a[0], a[1] + BARRIER_H, a[2]], [a[0] + out[0] * 0.01, a[1] + BARRIER_H, a[2] + out[2] * 0.01], [b[0], b[1] + 5, b[2]], [b[0] - out[0] * 0.01, b[1] + 5, b[2]], shade(C.fence, 0.9));
        }
      }
    }

    // ---- the tunnel along the sea, under the Fairmont: walls, ceiling, lights; a gallery of pillars on the sea side
    if (tunnelFrom >= 0) {
      const sea = sideOf(tunnelFrom + 10, p => -geo.land(p[0], p[2]));
      let IN = 0;
      for (let i = tunnelFrom; i <= tunnelTo; i++) IN = Math.max(IN, road.barrier(i, -1) + 0.7, road.barrier(i, 1) + 0.7);
      const CEIL = 7.4, hotelTo = tunnelFrom + 12;
      for (let i = tunnelFrom; i < tunnelTo; i++) {
        const r = right(i);
        for (const s of [-1, 1]) {
          const a = beside(i, s * IN), b = beside(i + 1, s * IN), inward = [-r[0] * s, 0, -r[2] * s];
          if (s === sea && i >= hotelTo) {                               // gallery: a pillar every other waypoint, open between
            if (i % 2 === 0) X.prism(X.rect(a[0], a[2], r[2], -r[0], 0.6, 0.6), a[1] - 1, a[1] + CEIL, C.casinoTrim, null);
            B.quad([a[0], a[1] + CEIL - 1.2, a[2]], [b[0], b[1] + CEIL - 1.2, b[2]], [b[0], b[1] + CEIL, b[2]], [a[0], a[1] + CEIL, a[2]], C.casinoTrim, inward);
            B.quad([a[0], a[1] + CEIL - 1.2, a[2]], [b[0], b[1] + CEIL - 1.2, b[2]], [b[0], b[1] + CEIL + 1.2, b[2]], [a[0], a[1] + CEIL + 1.2, a[2]], C.casinoTrim, [-inward[0], 0, -inward[2]]);
          } else B.quad([a[0], a[1] - 1, a[2]], [b[0], b[1] - 1, b[2]], [b[0], b[1] + CEIL, b[2]], [a[0], a[1] + CEIL, a[2]], C.tunnel, inward);
        }
        const a0 = beside(i, -IN, CEIL), a1 = beside(i, IN, CEIL), b0 = beside(i + 1, -IN, CEIL), b1 = beside(i + 1, IN, CEIL);
        B.quad(a0, a1, b1, b0, C.tunnel, DOWN);
        const l0 = beside(i, -0.7, CEIL - 0.05), l1 = beside(i, 0.7, CEIL - 0.05), m0 = beside(i + 0.6, -0.7, CEIL - 0.05), m1 = beside(i + 0.6, 0.7, CEIL - 0.05);
        B.quad(l0, l1, m1, m0, C.lamp, DOWN);
      }
      // the gallery's roof: a promenade with a parapet; the hotel stands over the first part
      ribbon(hotelTo, tunnelTo, sea > 0 ? -IN - 2 : IN + 2, sea > 0 ? IN + 1 : -IN - 1, CEIL, CEIL + 1.2, C.casinoTrim, C.plaza, false);
      // the Fairmont: a wide curved block over the road, its sea front stepped with balconies
      const back = -sea * (IN + 4), front = sea * 46;
      const floors = 8, base = CEIL + 1.2;
      // its base, on either side of the tunnel and over it; kept clear of the tunnel's own walls and ceiling,
      // which would otherwise flicker through them
      ribbon(tunnelFrom, hotelTo, back, -sea * (IN + 0.6), -2, base, C.walls.sand, null);
      ribbon(tunnelFrom, hotelTo, sea * (IN + 0.6), front, -2, base, C.walls.sand, null);
      ribbon(tunnelFrom, hotelTo, -sea * (IN + 0.6), sea * (IN + 0.6), CEIL + 0.4, base, C.walls.sand, null, true);
      for (let f = 0; f < floors; f++) {
        const y0 = base + f * FLOOR, edge = front - f * 1.6 * sea;     // each floor steps back from the sea
        ribbon(tunnelFrom, hotelTo, back, edge, y0, y0 + FLOOR - 0.5, C.walls.sand, C.walls.sand, true);
        ribbon(tunnelFrom, hotelTo, back - sea * 0.3, edge + sea * 1.4, y0 + FLOOR - 0.5, y0 + FLOOR, C.frame, C.frame, true);   // balcony slab
        for (let i = tunnelFrom; i < hotelTo; i++) {                    // window band on the sea front, and on the back
          const r = right(i);
          for (const [u, dir] of [[edge + sea * 0.08, sea], [back - sea * 0.08, -sea]]) {
            const a = beside(i, u), b = beside(i + 1, u);
            B.quad([a[0], a[1] + y0 + 0.5, a[2]], [b[0], b[1] + y0 + 0.5, b[2]], [b[0], b[1] + y0 + 2.1, b[2]], [a[0], a[1] + y0 + 2.1, a[2]], C.windowDark, [r[0] * dir, 0, r[2] * dir]);
          }
        }
      }
      const roofY = base + floors * FLOOR;
      ribbon(tunnelFrom + 3, hotelTo - 3, back + sea * 4, back + sea * 22, roofY, roofY + 4, C.walls.cream, C.roof);
      // its roof: gardens and pools
      for (let i = tunnelFrom + 1; i < hotelTo - 1; i += 2) {
        const p = beside(i + 0.5, sea * 31, roofY + 0.06), t = road.tangent(wp(i));
        B.quad(...X.rect(p[0], p[2], t[0], t[1], 5, 3).map(c => [c[0], p[1], c[1]]), i % 4 ? C.lawn : C.pool, UP);
      }
      claimRibbon(tunnelFrom - 1, tunnelTo + 1, -sea * (IN + 6), sea * 60, 2);
      // portals
      for (const [i, dir] of [[tunnelFrom, -1], [tunnelTo, 1]]) {
        const t = road.tangent(wp(i)), face = [t[0] * dir, 0, t[1] * dir];
        const a = beside(i, -IN - 1.5, -1), b = beside(i, IN + 1.5, -1);
        B.quad([a[0], a[1] + CEIL, a[2]], [b[0], b[1] + CEIL, b[2]], [b[0], b[1] + CEIL + 1.6, b[2]], [a[0], a[1] + CEIL + 1.6, a[2]], C.casinoTrim, face);
      }
      // boulders along the sea front of the hotel and the gallery
      for (let i = tunnelFrom - 6; i < tunnelTo + 14; i++) for (let k = 0; k < 3; k++) {
        for (let u = 25; u < 90; u += 3) {
          const p = beside(i + k / 3, sea * u);
          if (geo.land(p[0], p[2]) < 4) { X.boulder(p[0] + (rnd() - 0.5) * 3, p[2] + (rnd() - 0.5) * 3, WATER_Y + 0.5 + rnd(), 2 + rnd() * 1.8); break; }
        }
      }
    }

    // ---- pits along the start straight, on the harbour side: pit lane, garages with red roof panels, a row of trees
    const pitSide = sideOf(4, p => -otherRoad(p, 0));
    {
      const from = -20, to = 8;                                        // waypoints (12 m each) around the start line
      // pit lane asphalt and the pit wall
      for (let i = from; i < to; i++) {
        const a = beside(i, pitSide * 10.5, 0.02), b = beside(i, pitSide * 23, 0.02), c = beside(i + 1, pitSide * 23, 0.02), d = beside(i + 1, pitSide * 10.5, 0.02);
        B.quad(a, b, c, d, C.asphalt, UP);
        const e = beside(i, pitSide * 16.6, 0.03), f = beside(i, pitSide * 16.9, 0.03), g = beside(i + 1, pitSide * 16.9, 0.03), h = beside(i + 1, pitSide * 16.6, 0.03);
        B.quad(e, f, g, h, C.frame, UP);
      }
      ribbon(from, to, pitSide * 23.5, pitSide * 36, -1, 5.5, C.walls.white, C.walls.white);
      for (let i = from; i < to; i++) {
        const r = right(i), face = [-r[0] * pitSide, 0, -r[2] * pitSide];
        const a = beside(i + 0.12, pitSide * 23.4, 0), b = beside(i + 0.88, pitSide * 23.4, 0);
        B.quad([a[0], a[1] + 0.1, a[2]], [b[0], b[1] + 0.1, b[2]], [b[0], b[1] + 3.6, b[2]], [a[0], a[1] + 3.6, a[2]], C.windowDark, face);   // garage doors
        const p = beside(i + 0.15, pitSide * 26, 5.56), q = beside(i + 0.85, pitSide * 26, 5.56), s = beside(i + 0.85, pitSide * 33, 5.56), t = beside(i + 0.15, pitSide * 33, 5.56);
        B.quad(p, q, s, t, C.pitRed, UP);                              // red panels on the roof
      }
      claimRibbon(from - 1, to + 1, pitSide * 9, pitSide * 38, 1);
      // the row of round trees behind the garages
      for (let i = from; i < to; i += 0.5) { const p = beside(i, pitSide * 41); if (T.site([[p[0] - 2, p[2] - 2], [p[0] + 2, p[2] - 2], [p[0] + 2, p[2] + 2], [p[0] - 2, p[2] + 2]], 12, 6, 3)) { X.tree(p[0], p[2], height(p[0], p[2]), 1.1); stats.trees++; } }
      claimRibbon(from - 1, to + 1, pitSide * 38, pitSide * 45, 0.5);
      // the green footbridge over the straight, just after the start line
      const i = 3, t = road.tangent(i);
      for (const s of [-1, 1]) { const p = beside(i, s * 14); X.prism(X.rect(p[0], p[2], t[0], t[1], 1.2, 1.2), p[1] - 1, p[1] + 9.5, C.standFrame); }
      const deck = (u0, u1, y0, y1, col) => { const a = beside(i - 0.15, u0, y0), b = beside(i - 0.15, u1, y0), c = beside(i + 0.15, u1, y0), d = beside(i + 0.15, u0, y0); X.prism([[a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [d[0], d[2]]], a[1], a[1] + (y1 - y0), col, col, col); };
      deck(-16, 16, 7.2, 9.6, C.bridgeGreen);
      deck(-16, 16, 9.6, 10.4, C.frame);
    }

    // ---- the swimming pool, between the pits and the Piscine section
    {
      let best = null;
      for (let i = -14; i < 0; i++) for (let u = 50; u < 110; u += 4) {
        const p = beside(i, pitSide * u), t = road.tangent(wp(i)), corners = X.rect(p[0], p[2], t[0], t[1], 30, 14);
        if (!T.free(corners, 2) || !T.site(corners, 22, 10, 1.5)) continue;
        if (best == null || u < best.u) best = { p, t, corners, u };
      }
      if (best) {
        const { p, t, corners } = best, y = height(p[0], p[2]);
        X.prism(corners, y - 1, y + 0.4, C.sidewalk, C.frame);
        B.quad(...X.rect(p[0], p[2], t[0], t[1], 25, 10).map(c => [c[0], y + 0.45, c[1]]), C.pool, UP);
        T.claim(corners, 2);
        for (const s of [-1, 1]) { const q = [p[0] - t[1] * s * 18, p[2] + t[0] * s * 18]; for (let k = -3; k <= 3; k++) { const x = q[0] + t[0] * k * 8, z = q[1] + t[1] * k * 8; if (T.free([[x - 1, z - 1], [x + 1, z + 1]], 0)) { X.palm(x, z, height(x, z)); T.claim([[x - 1, z - 1], [x + 1, z + 1]]); } } }
      }
    }

    // ---- grandstands: blue seats in steps rising away from the road
    const stand = (i0, i1, side, depth = 18) => {
      let built = 0;
      for (let i = i0; i < i1; i++) {
        const a0 = beside(i, side * (road.barrier(i, side) + 3)), a1 = beside(i + 1, side * (road.barrier(i, side) + 3)), b0 = beside(i, side * (road.barrier(i, side) + 3 + depth)), b1 = beside(i + 1, side * (road.barrier(i, side) + 3 + depth));
        const corners = [[a0[0], a0[2]], [a1[0], a1[2]], [b1[0], b1[2]], [b0[0], b0[2]]];
        if (!T.free(corners, 0) || geo.land(b0[0], b0[2]) < 3 || geo.land(b1[0], b1[2]) < 3 || otherRoad(b0, i) < ROAD_CLEAR || otherRoad(b1, i) < ROAD_CLEAR) continue;
        const r = right(i), away = [r[0] * side, 0, r[2] * side], toward = [-away[0], 0, -away[2]];
        const rows = Math.floor(depth / 2);
        for (let k = 0; k < rows; k++) {
          const u0 = side * (road.barrier(i, side) + 3 + k * 2), u1 = side * (road.barrier(i, side) + 3 + (k + 1) * 2), y = 0.8 + k * 0.9;
          const p0 = beside(i, u0, y), p1 = beside(i + 1, u0, y), q1 = beside(i + 1, u1, y), q0 = beside(i, u1, y);
          const col = C.seats[((k + i) % 2 + 2) % 2];
          B.quad(p0, p1, q1, q0, col, UP);
          B.quad([p0[0], p0[1] - 0.9, p0[2]], [p1[0], p1[1] - 0.9, p1[2]], p1, p0, shade(col, 0.75), toward);
        }
        const top = 0.8 + rows * 0.9, e0 = beside(i, side * (road.barrier(i, side) + 3 + depth)), e1 = beside(i + 1, side * (road.barrier(i, side) + 3 + depth));
        B.quad([e0[0], e0[1] - 1.5, e0[2]], [e1[0], e1[1] - 1.5, e1[2]], [e1[0], e1[1] + top + 1, e1[2]], [e0[0], e0[1] + top + 1, e0[2]], C.standFrame, away);
        const s0 = beside(i, side * (road.barrier(i, side) + 3)), s1 = beside(i + 1, side * (road.barrier(i, side) + 3));
        B.quad([s0[0], s0[1] - 0.2, s0[2]], [s1[0], s1[1] - 0.2, s1[2]], [s1[0], s1[1] + 0.8, s1[2]], [s0[0], s0[1] + 0.8, s0[2]], C.standFrame, toward);
        // side walls at the ends of a run
        T.claim(corners, 0.6); built++;
      }
      return built;
    };
    const sp = (name, offset) => (P[name] != null ? P[name] + offset : null);
    stand(-26, -21, -pitSide); stand(-17, 6, -pitSide, 20);                                      // start straight, facing the pits
    if (P.sainteDevote != null) { const s = road.turn(P.sainteDevote) > 0 ? -1 : 1; stand(sp('sainteDevote', -3), sp('sainteDevote', 4), s, 22); }
    if (P.casino != null) stand(sp('casino', 3), sp('casino', 8), road.turn(P.casino) > 0 ? -1 : 1, 12);
    if (P.tabac != null) stand(sp('tabac', -9), sp('tabac', 1), sideOf(P.tabac - 4, p => -geo.land(p[0], p[2])), 14);
    if (P.piscine != null) stand(sp('piscine', 1), sp('piscineOut', -2), sideOf(P.piscine + 6, p => -geo.land(p[0], p[2])), 12);
    if (P.rascasse != null) { const s = road.turn(P.rascasse) > 0 ? -1 : 1; stand(sp('rascasse', -4), sp('rascasse', 3), s, 16); }
    if (P.chicane != null) stand(sp('chicane', 3), sp('chicane', 9), sideOf(P.chicane + 6, p => -geo.land(p[0], p[2])), 12);

    // ---- Casino square: the Casino on the inside of the corner, the Hotel de Paris, the gardens and their fountain
    if (P.casino != null) {
      const inside = road.turn(P.casino) > 0 ? 1 : -1, K = 1.4;
      // as close to the corner as it can stand without touching a road: the circuit runs round it on two sides
      const clear = (c, t) => {
        const at = (along, across) => [c[0] + t[0] * along - t[1] * across * inside, c[2] + t[1] * along + t[0] * across * inside];
        for (const [a, b] of [[-26 * K, -14 * K - 7], [26 * K, -14 * K - 7], [26 * K, 14 * K], [-26 * K, 14 * K], [0, -14 * K - 7], [0, 14 * K], [-26 * K, 0], [26 * K, 0], [-13 * K, -14 * K - 7], [13 * K, -14 * K - 7]])
          if (road.dist(...at(a, b)) < ROAD_CLEAR + 2) return false;
        return true;
      };
      let i = P.casino, c = null, t = road.tangent(i);
      search: for (let d = 58; d <= 150; d += 4) for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
        const tt = road.tangent(wp(P.casino + shift)), cc = beside(P.casino + shift, inside * d);
        if (clear(cc, tt)) { i = P.casino + shift; c = cc; t = tt; break search; }
      }
      if (c == null) c = beside(i, inside * 150);
      const ux = t[0], uz = t[1], y = Math.max(c[1], height(c[0], c[2]));
      const off = (along, across) => [c[0] + ux * along - uz * across * inside, c[2] + uz * along + ux * across * inside];   // across > 0: away from the road
      // the square in front of it: paved, open, nothing tall
      const square = X.rect(...off(0, -14), ux, uz, 46, 26);
      if (T.site(square, 14, 8, 6)) X.prism(square, y - 4, y + 0.1, C.plaza, C.plaza);
      T.claim(X.rect(...off(0, -6), ux, uz, 60, 44), 1);
      // the main hall: yellow walls, white cornices, light blue mansard roof
      const hall = X.rect(c[0], c[2], ux, uz, 26 * K, 14 * K), H = 13 * K;
      X.prism(hall, y - 3, y + H, C.casino, null);
      X.prism(X.rect(c[0], c[2], ux, uz, 26 * K + 0.4, 14 * K + 0.4), y + H - 0.6, y + H + 0.6, C.casinoTrim, C.casinoTrim);
      const mansard = X.rect(c[0], c[2], ux, uz, 22 * K, 10 * K), mansardTop = y + H + 6;
      for (let k = 0; k < 4; k++) {
        const a = hall[k], b = hall[(k + 1) % 4], a2 = mansard[k], b2 = mansard[(k + 1) % 4], o = Bd.outward(hall, k);
        B.quad([a[0], y + H + 0.6, a[1]], [b[0], y + H + 0.6, b[1]], [b2[0], mansardTop, b2[1]], [a2[0], mansardTop, a2[1]], C.casinoRoof, [o[0], 1, o[2]]);
      }
      B.quad(...mansard.map(m => [m[0], mansardTop, m[1]]), C.casinoRoof, UP);
      // tall arched windows, white pilasters between them
      for (let k = 0; k < 4; k++) {
        const a = hall[k], b = hall[(k + 1) % 4], o = Bd.outward(hall, k), len = Math.hypot(b[0] - a[0], b[1] - a[1]), ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len;
        const p = (t2, e) => [a[0] + ex * t2 + o[0] * e, a[1] + ez * t2 + o[2] * e];
        for (let w = 3; w < len - 3; w += 5) {
          for (const [y0, y1] of [[1.2, 7.5], [9.5, 15.5]]) B.quad([p(w, 0.08)[0], y + y0, p(w, 0.08)[1]], [p(w + 2.2, 0.08)[0], y + y0, p(w + 2.2, 0.08)[1]], [p(w + 2.2, 0.08)[0], y + y1, p(w + 2.2, 0.08)[1]], [p(w, 0.08)[0], y + y1, p(w, 0.08)[1]], C.windowDark, o);
          B.quad([p(w + 3.2, 0.2)[0], y, p(w + 3.2, 0.2)[1]], [p(w + 4, 0.2)[0], y, p(w + 4, 0.2)[1]], [p(w + 4, 0.2)[0], y + H - 0.6, p(w + 4, 0.2)[1]], [p(w + 3.2, 0.2)[0], y + H - 0.6, p(w + 3.2, 0.2)[1]], C.casinoTrim, o);
        }
      }
      // the two towers with their domes and clocks, and the central dome
      const dome = (x, z, r, base, rise, sides = 8) => {
        const rim = X.ring(x, z, r, sides), drum = rim.map(p => [p[0], base + rise * 0.4, p[1]]);
        for (let k = 0; k < sides; k++) {
          const q = (k + 1) % sides, out = [rim[k][0] - x, 0, rim[k][1] - z];
          B.quad([rim[k][0], base, rim[k][1]], [rim[q][0], base, rim[q][1]], drum[q], drum[k], C.casino, out);
          B.tri3(drum[k], drum[q], [x, base + rise, z], shade(C.casinoRoof, 0.9 + 0.1 * (k % 2)), [out[0], 1, out[2]]);
        }
        X.prism(X.rect(x, z, 1, 0, 0.3, 0.3), base + rise, base + rise + 3, C.gold, C.gold);
      };
      dome(c[0], c[2], 9, mansardTop, 11);
      for (const s2 of [-1, 1]) {
        const [tx, tz] = off(s2 * 22 * K, -11 * K);
        X.prism(X.rect(tx, tz, ux, uz, 6, 6), y - 3, y + 30, C.casino, null);
        X.prism(X.rect(tx, tz, ux, uz, 6.4, 6.4), y + 29.2, y + 30.6, C.casinoTrim, C.casinoTrim);
        const face = [uz * inside, 0, -ux * inside];
        const k0 = off(s2 * 22 * K - 2.2, -11 * K - 6.1), k1 = off(s2 * 22 * K + 2.2, -11 * K - 6.1);   // the clock, facing the square
        B.quad([k0[0], y + 21, k0[1]], [k1[0], y + 21, k1[1]], [k1[0], y + 25.4, k1[1]], [k0[0], y + 25.4, k0[1]], C.frame, face);
        dome(tx, tz, 6, y + 30.6, 8, 4);
      }
      T.claim(X.rect(c[0], c[2], ux, uz, 26 * K + 6, 14 * K + 6), 2);
      // the Hotel de Paris, on the outside of the corner, before it
      const h = beside(i - 4, -inside * 44), hc = X.rect(h[0], h[2], t[0], t[1], 24, 15), hb = T.site(hc, 18, 8, 12);
      if (hb && T.free(hc, 0)) { Bd.building(hc, hb, 6, { wall: C.walls.cream, windows: 'classic', shutters: false, tiled: false, roof: C.casinoRoof, ac: false }); T.claim(hc, 2); }
      // the gardens with the round fountain, on the outside of the corner
      const g = beside(i + 3, -inside * 46), gy = height(g[0], g[2]);
      const lawn = X.rect(g[0], g[2], ux, uz, 24, 24);
      if (T.free(lawn, 0) && T.site(lawn, 16, 8, 8)) {
        const ring = X.ring(g[0], g[2], 21, 16);
        X.prism(ring, gy - 2, gy + 0.3, C.lawn, C.lawn);
        const basin = X.ring(g[0], g[2], 6, 12);
        X.prism(basin, gy, gy + 0.9, C.frame, C.frame);
        B.quad(...X.rect(g[0], g[2], 1, 0, 4.2, 4.2).map(q => [q[0], gy + 0.95, q[1]]), C.pool, UP);
        X.prism(X.ring(g[0], g[2], 0.8, 6), gy, gy + 3, C.frame, C.frame);
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, x = g[0] + Math.cos(a) * 12, z = g[2] + Math.sin(a) * 12; X.palm(x, z, gy); }
        T.claim(lawn, 1);
      }
    }

    // ---- the Rock: the Prince's palace, the cathedral, gardens on the cliff tops
    {
      const rh = geo.rockHeight;
      // the palace faces the harbour from the west end of the plateau
      let best = null;
      for (const p of data.rock.outline) if (best == null || p[0] < best[0]) best = p;
      const cx = data.rock.outline.reduce((s, p) => s + p[0], 0) / data.rock.outline.length, cz = data.rock.outline.reduce((s, p) => s + p[1], 0) / data.rock.outline.length;
      const px = best[0] + (cx - best[0]) * 0.28, pz = best[1] + (cz - best[1]) * 0.28;
      const palace = X.rect(px, pz, 1, 0, 34, 20), base = { lo: rh, hi: rh + 1 };
      if (T.free(palace, 0)) {
        Bd.building(palace, base, 4, { wall: C.palace, windows: 'classic', shutters: false, tiled: true, roof: C.roof });
        // crenellated tower at one corner
        const tw = X.rect(px - 30, pz - 16, 1, 0, 4, 4);
        X.prism(tw, rh - 2, rh + 22, C.palace, C.palace);
        for (let k = 0; k < 4; k++) X.prism(X.rect(px - 30 + (k % 2 ? 3 : -3), pz - 16 + (k < 2 ? 3 : -3), 1, 0, 0.8, 0.8), rh + 22, rh + 23.5, C.palace, C.palace);
        T.claim(palace, 4); T.claim(tw, 1);
        // the square in front of it
        const sq = X.rect(px + 50, pz, 1, 0, 14, 22);
        X.prism(sq, rh - 1, rh + 1.1, C.plaza, C.plaza); T.claim(sq, 1);
      }
      // the cathedral, further east
      const kx = px + (cx - px) * 1.4, kz = pz + (cz - pz) * 1.4, nave = X.rect(kx, kz, 1, 0, 18, 8);
      if (T.free(nave, 1)) {
        X.prism(nave, rh - 2, rh + 13, C.cathedral, null);
        const ridge = [[kx - 18, rh + 19, kz], [kx + 18, rh + 19, kz]];
        B.quad([nave[0][0], rh + 13, nave[0][1]], [nave[1][0], rh + 13, nave[1][1]], ridge[1], ridge[0], C.tiles, [0, 1, -1]);
        B.quad([nave[3][0], rh + 13, nave[3][1]], [nave[2][0], rh + 13, nave[2][1]], ridge[1], ridge[0], C.tiles, [0, 1, 1]);
        B.tri3([nave[0][0], rh + 13, nave[0][1]], [nave[3][0], rh + 13, nave[3][1]], ridge[0], C.cathedral, [-1, 0, 0]);
        B.tri3([nave[1][0], rh + 13, nave[1][1]], [nave[2][0], rh + 13, nave[2][1]], ridge[1], C.cathedral, [1, 0, 0]);
        X.prism(X.ring(kx + 18, kz, 6, 8), rh + 2, rh + 15, C.cathedral, null);
        const domeRim = X.ring(kx + 18, kz, 6, 8);
        for (let k = 0; k < 8; k++) B.tri3([domeRim[k][0], rh + 15, domeRim[k][1]], [domeRim[(k + 1) % 8][0], rh + 15, domeRim[(k + 1) % 8][1]], [kx + 18, rh + 21, kz], shade(C.casinoRoof, 0.95), [domeRim[k][0] - kx - 18, 1, domeRim[k][1] - kz]);
        T.claim(nave, 3); T.claim(X.rect(kx + 18, kz, 1, 0, 7, 7), 1);
      }
    }

    harbourLife(road, geo, height, B, rnd, T, data, stats);

    // ---- palms along the road wherever the sea is close
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const p = beside(i + 0.5, s * (Math.max(road.barrier(i, s), road.barrier(i + 1, s)) + 4.2));
      if (geo.land(p[0], p[2]) > 70 || geo.land(p[0], p[2]) < 3 || road.dist(p[0], p[2]) < 12.5 || road.dist(p[0], p[2]) < Math.max(road.barrier(road.nearest(p[0], p[2]).i, -1), road.barrier(road.nearest(p[0], p[2]).i, 1)) + 3.5) continue;
      const cell = [[p[0] - 1, p[2] - 1], [p[0] + 1, p[2] - 1], [p[0] + 1, p[2] + 1], [p[0] - 1, p[2] + 1]];
      if (!T.free(cell, 0)) continue;
      X.palm(p[0], p[2], height(p[0], p[2])); T.claim(cell);
    }
  }

  // ------------------------------------------------------------------ the harbour: yachts on every quay and pontoon, jetties and their lights
  function yacht(B, x, z, ux, uz, length, rnd) {
    const beam = length * (0.24 + rnd() * 0.03), vx = -uz, vz = ux, deck = 1.3 + length * 0.035, keel = -0.6;
    const at = (along, across, y) => [x + ux * along + vx * across, y, z + uz * along + vz * across];
    const outline = [[-0.5, -0.44], [0.12, -0.5], [0.32, -0.40], [0.5, 0], [0.32, 0.40], [0.12, 0.5], [-0.5, 0.44]];
    const top = outline.map(([a, c]) => at(a * length, c * beam, WATER_Y + deck)), bot = outline.map(([a, c]) => at(a * length * 0.94, c * beam * 0.72, WATER_Y + keel));
    for (let i = 0; i < outline.length; i++) {
      const k = (i + 1) % outline.length, mx = (top[i][0] + top[k][0]) / 2 - x, mz = (top[i][2] + top[k][2]) / 2 - z;
      B.quad(bot[i], bot[k], top[k], top[i], C.hull, [mx, 0, mz]);
      if (i < outline.length - 1) {
        const s1 = lerp3(bot[i], top[i], 0.62), s2 = lerp3(bot[k], top[k], 0.62), e = 0.05 / Math.hypot(mx, mz);
        B.quad([s1[0] + mx * e, s1[1], s1[2] + mz * e], [s2[0] + mx * e, s2[1], s2[2] + mz * e], [s2[0] + mx * e, s2[1] + 0.3, s2[2] + mz * e], [s1[0] + mx * e, s1[1] + 0.3, s1[2] + mz * e], C.stripe, [mx, 0, mz]);
      }
    }
    for (let i = 1; i + 1 < outline.length; i++) B.tri3(top[0], top[i], top[i + 1], C.deck, UP);
    // superstructure: tiers of white cabins with dark glass, getting smaller
    const levels = length > 34 ? 3 : length > 18 ? 2 : 1;
    for (let l = 0; l < levels; l++) {
      const a0 = -0.40 + l * 0.06, a1 = 0.16 - l * 0.12, c = 0.36 - l * 0.05, y0 = WATER_Y + deck + l * 2.0, y1 = y0 + 2.0;
      const box = [at(a0 * length, -c * beam, 0), at(a1 * length, -c * beam, 0), at(a1 * length, c * beam, 0), at(a0 * length, c * beam, 0)];
      for (let i = 0; i < 4; i++) {
        const p = box[i], q = box[(i + 1) % 4], mx = (p[0] + q[0]) / 2 - x, mz = (p[2] + q[2]) / 2 - z, e = 0.05 / (Math.hypot(mx, mz) || 1);
        B.quad([p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]], C.hull, [mx, 0, mz]);
        const L = (t, y) => [p[0] + (q[0] - p[0]) * t + mx * e, y, p[2] + (q[2] - p[2]) * t + mz * e];
        B.quad(L(0.08, y0 + 0.7), L(0.92, y0 + 0.7), L(0.92, y0 + 1.6), L(0.08, y0 + 1.6), C.glassDark, [mx, 0, mz]);
      }
      B.quad(...box.map(p => [p[0], y1, p[2]]), l === levels - 1 ? shade(C.glassDark, 1.3) : C.hull, UP);
    }
  }

  function harbourLife(road, geo, height, B, rnd, T, data, stats) {
    const { X } = T;
    // a boat's hull, kept clear of the quays, the jetties and the other boats
    const water = (x, z, margin) => geo.land(x, z) < -margin;
    const berth = (x, z, ux, uz, length) => {
      const beam = length * 0.27, hull = X.rect(x, z, ux, uz, length / 2, beam / 2);
      if (!hull.every(c => water(c[0], c[1], 0.3)) || !water(x, z, 2)) return false;
      if (!T.free(hull, 0.6)) return false;
      yacht(B, x, z, ux, uz, length, rnd); T.claim(hull, 0.6); stats.yachts++;
      return true;
    };
    const quays = data.quays;
    // the side of a quay edge that is water
    const intoWater = (a, b) => {
      const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      let nx = -ez / l, nz = ex / l;
      if (geo.land(mx + nx * 6, mz + nz * 6) > 0) { nx = -nx; nz = -nz; }
      return { ex: ex / l, ez: ez / l, nx, nz, l };
    };
    // pontoons from the north quay (the longest edges near the circuit's chicane and Tabac), and boats moored on them
    const pontoon = (x, z, ux, uz, len) => {
      const strip = X.rect(x + ux * len / 2, z + uz * len / 2, ux, uz, len / 2, 1.8);
      X.prism(strip, WATER_Y - 0.5, WATER_Y + 0.9, shade(C.pontoon, 0.85), C.pontoon);
      T.claim(strip, 0.5);
      for (let s = 7; s < len - 4; s += 7.5) for (const side of [-1, 1]) {
        if (rnd() < 0.12) continue;
        const L = 13 + rnd() * 11, vx = -uz * side, vz = ux * side;
        berth(x + ux * s + vx * (2.6 + L / 2), z + uz * s + vz * (2.6 + L / 2), vx, vz, L);
      }
    };
    // pontoons out from every long quay, square to it, 46 m apart: rows of boats as in the real port
    for (let k = 0; k + 1 < quays.length; k++) {
      const a = quays[k], e = intoWater(a, quays[k + 1]);
      if (e.l < 110) continue;
      for (let s = 40; s < e.l - 30; s += 46) {
        const x = a[0] + e.ex * s, z = a[1] + e.ez * s;
        let len = 0; while (len < 150 && water(x + e.nx * (len + 22), z + e.nz * (len + 22), 14)) len += 4;
        len = Math.min(len, 130);
        if (len > 45) pontoon(x + e.nx * 0.5, z + e.nz * 0.5, e.nx, e.nz, len);
      }
    }
    // every quay: boats moored stern-to, side by side
    for (let k = 0; k + 1 < quays.length; k++) {
      const a = quays[k], e = intoWater(a, quays[k + 1]);
      for (let s = 6; s < e.l - 6;) {
        const L = 16 + rnd() * 14 + (k > quays.length - 4 ? 16 : 0), beam = L * 0.27;
        const x = a[0] + e.ex * s + e.nx * (L / 2 + 3), z = a[1] + e.ez * s + e.nz * (L / 2 + 3);
        berth(x, z, e.nx, e.nz, L) || berth(x + e.nx * 3, z + e.nz * 3, e.nx, e.nz, L * 0.8);
        s += beam + 1.0 + rnd() * 1.2;
      }
    }
    // the jetties: concrete, a light at the tip, boats moored along the inner side
    for (const j of geo.jetties) {
      const ux = j.to[0] - j.from[0], uz = j.to[1] - j.from[1], l = Math.hypot(ux, uz), ex = ux / l, ez = uz / l;
      const body = X.rect((j.from[0] + j.to[0]) / 2, (j.from[1] + j.to[1]) / 2, ex, ez, l / 2, j.half);
      X.prism(body, QUAY_FOOT, 1.5, C.quayWall, C.quay);
      T.claim(body, 1);
      const lx = j.to[0] - ex * 4, lz = j.to[1] - ez * 4, rings = [[1.5, 4, C.hull], [4, 7, C.light], [7, 10, C.hull], [10, 11.5, C.lamp]];
      for (const [y0, y1, col] of rings) X.prism(X.ring(lx, lz, 1.6 - y0 * 0.04, 8), y0, y1, col, col);
      // boulders on the sea side
      for (let s = 4; s < l; s += 3.2) for (const side of [-1, 1]) {
        const vx = -ez * side, vz = ex * side, bx = j.from[0] + ex * s + vx * (j.half + 2), bz = j.from[1] + ez * s + vz * (j.half + 2);
        if (geo.land(bx, bz) < -1 && Math.hypot(bx - geo.harbourCentre[0], bz - geo.harbourCentre[1]) > Math.hypot(j.from[0] + ex * s - geo.harbourCentre[0], j.from[1] + ez * s - geo.harbourCentre[1])) X.boulder(bx, bz, WATER_Y + 0.3, 1.8 + rnd() * 1.4);
      }
      for (let s = 12; s < l - 10; s += 7.5) for (const side of [-1, 1]) {
        const vx = -ez * side, vz = ex * side, L = 18 + rnd() * 16;
        const x = j.from[0] + ex * s + vx * (j.half + 1.5 + L / 2), z = j.from[1] + ez * s + vz * (j.half + 1.5 + L / 2);
        if (Math.hypot(x - geo.harbourCentre[0], z - geo.harbourCentre[1]) < Math.hypot(j.from[0] + ex * s - geo.harbourCentre[0], j.from[1] + ez * s - geo.harbourCentre[1])) berth(x, z, vx, vz, L);
      }
    }
    // big yachts at anchor offshore
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, r = 500 + rnd() * 900, x = geo.harbourCentre[0] + Math.cos(a) * r, z = geo.harbourCentre[1] + Math.sin(a) * r, h = rnd() * Math.PI * 2;
      if (geo.land(x, z) < -40) berth(x, z, Math.cos(h), Math.sin(h), 25 + rnd() * 45);
    }
    // palms along the quays
    for (let k = 0; k + 1 < quays.length; k++) {
      const a = quays[k], e = intoWater(a, quays[k + 1]);
      for (let s = 5; s < e.l - 5; s += 12) {
        const x = a[0] + e.ex * s - e.nx * 5, z = a[1] + e.ez * s - e.nz * 5, cell = [[x - 1, z - 1], [x + 1, z - 1], [x + 1, z + 1], [x - 1, z + 1]];
        if (road.dist(x, z) < 16 || geo.land(x, z) < 2 || !T.free(cell, 0)) continue;
        X.palm(x, z, Math.max(0, height(x, z))); T.claim(cell);
      }
    }
  }

  // ------------------------------------------------------------------ entry point
  function build(data) {
    const road = circuit(data), geo = geography(road, data), height = relief(road, geo), rnd = random(SEED);
    const ground = Builder(), objects = Builder();
    terrain(road, geo, height, ground);
    const stats = town(road, geo, height, objects, rnd, data);
    return { terrain: ground.done(), objects: objects.done(), stats };
  }

  const api = { build };
  if (typeof window !== 'undefined') window.ApexMonaco = api;
  if (typeof module !== 'undefined') module.exports = api;
  // Loaded as a worker (apex-scenery.js does it): build off the page's thread and hand the arrays over
  else if (typeof window === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = e => {
      try {
        const town = build(e.data), buffers = [];
        for (const part of [town.terrain, town.objects]) for (const key of ['positions', 'normals', 'colors']) buffers.push(part[key].buffer);
        self.postMessage({ town }, buffers);
      } catch (err) { self.postMessage({ error: String(err && err.stack || err) }); }
    };
  }
})();
