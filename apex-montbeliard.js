// Apex Montbéliard: the town centre around the Montbéliard circuit, in low poly. Looks only.
//
// Unlike Monaco's, this town is not invented: tracks/montbeliard.json (written by tools/make_montbeliard.js)
// carries the real map of the centre, from OpenStreetMap, in the circuit's own frame. From it:
//
//   ground      the town's floor, its streets and squares, parks, the Allan, the canal and the Lizaine,
//               the railway, wooded hills on the horizon
//   town        every building on its real footprint, in the colours of the old town (ochre, pink, pale
//               green and blue fronts under tiled roofs), with windows on the ones near the road
//   landmarks   the castle of the dukes of Württemberg on its rock, with its two round towers; the temple
//               Saint-Martin, the town hall, the market hall, the church Saint-Maimbœuf, the station
//   circuit     the lines painted across the road, grandstands where there is room, trees
//
// OpenStreetMap gives footprints, not heights: storeys are guessed from the size of each building. No 3D
// model or texture is shipped, and the same seed always gives the same town.
//
// Coordinates are the circuit's own: metres, the start line at the origin, the road at height 0, the plain
// of the game 5 m below. Nothing here is collided with: the road keeps its own barriers.
//
// window.ApexMontbeliard.build(circuit) returns { terrain, objects }, each { positions, normals, colors }
// (linear RGB, one colour per vertex, flat triangles), like apex-monaco.js; apex-scenery.js turns them into meshes.
(() => {
  'use strict';

  const SEED = 1397;                // the county passes to the house of Württemberg
  const FLOOR = 3.1;                // storey height
  const GROUND = -0.5;              // the town's floor, just under the road; what lies on it, from the bottom up:
  const PARK_Y = -0.4, WATER_Y = -0.3, STREET_Y = -0.2, RAIL_Y = -0.1;
  const DETAIL = 95;                // metres from the road within which buildings get windows
  const ROCK_HEIGHT = 13;           // the castle's rock above the lower town
  const HILLS_FROM = 1250, EDGE = 3400;   // from the middle of the lap

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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ------------------------------------------------------------------ colours (display sRGB)
  const C = {
    floor: [0.60, 0.58, 0.54], street: [0.40, 0.40, 0.42], square: [0.78, 0.74, 0.67], park: [0.44, 0.59, 0.33], meadow: [0.47, 0.60, 0.35],
    water: [0.30, 0.47, 0.55], rail: [0.42, 0.38, 0.35], forest: [[0.20, 0.36, 0.20], [0.24, 0.41, 0.22], [0.17, 0.32, 0.19]],
    // fronts of the old town: lime-washed in warm and pale colours, as in the towns of the Rhine
    walls: [[0.80, 0.66, 0.42], [0.84, 0.75, 0.52], [0.80, 0.60, 0.52], [0.74, 0.52, 0.42], [0.66, 0.74, 0.62], [0.62, 0.72, 0.80], [0.85, 0.81, 0.72],
      [0.78, 0.71, 0.60], [0.82, 0.56, 0.36], [0.72, 0.65, 0.76], [0.86, 0.78, 0.58], [0.76, 0.76, 0.72]],
    plain: [[0.74, 0.73, 0.70], [0.68, 0.69, 0.70], [0.78, 0.76, 0.70]],      // sheds, shops and modern blocks
    tiles: [[0.52, 0.27, 0.19], [0.47, 0.24, 0.18], [0.57, 0.31, 0.21], [0.44, 0.25, 0.20]], flatRoof: [0.52, 0.52, 0.53], slate: [0.30, 0.32, 0.37],
    window: [0.22, 0.29, 0.40], shutter: [0.36, 0.44, 0.36],
    stone: [0.80, 0.70, 0.54], pinkStone: [0.76, 0.56, 0.49], castle: [0.86, 0.82, 0.72], castleRoof: [0.44, 0.26, 0.21],
    rock: [0.62, 0.59, 0.54], rockDark: [0.52, 0.50, 0.46],
    trunk: [0.42, 0.32, 0.24], leaves: [[0.27, 0.47, 0.24], [0.33, 0.54, 0.27], [0.39, 0.58, 0.29], [0.24, 0.42, 0.24]],
    startLine: [0.92, 0.92, 0.92], checkpoint: [0.95, 0.72, 0.10], black: [0.07, 0.07, 0.08],
    standFrame: [0.58, 0.60, 0.63], seats: [[0.70, 0.16, 0.16], [0.80, 0.22, 0.20]],
  };
  const lin = c => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

  // ------------------------------------------------------------------ mesh builder (as in apex-monaco.js)
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
    const facing = (a, b, c, towards) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return (uy * vz - uz * vy) * towards[0] + (uz * vx - ux * vz) * towards[1] + (ux * vy - uy * vx) * towards[2] >= 0;
    };
    const tri3 = (a, b, c, col, towards) => (facing(a, b, c, towards) ? tri(a, b, c, col) : tri(a, c, b, col));
    const quad = (a, b, c, d, col, towards) => { tri3(a, b, c, col, towards); tri3(a, c, d, col, towards); };
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
    return { tri, tri3, quad, done, count: () => n / 9 };
  }
  const UP = [0, 1, 0];

  // ------------------------------------------------------------------ polygons
  const signedArea = P => P.reduce((s, q, i) => { const r = P[(i + 1) % P.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;
  const centroid = P => { let x = 0, z = 0; for (const q of P) { x += q[0]; z += q[1]; } return [x / P.length, z / P.length]; };
  const inPoly = (x, z, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], b = P[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  // Triangles of a simple polygon (ear clipping), as index triples
  function triangulate(P) {
    const n = P.length, out = [];
    if (n < 3) return out;
    const idx = P.map((_, i) => i);
    if (signedArea(P) < 0) idx.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 4 * n) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = P[ia], b = P[ib], c = P[ic];
        if (cross(a, b, c) <= 1e-9) continue;                           // reflex or flat corner
        let ear = true;
        for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(P[j], a, b, c)) { ear = false; break; }
        if (!ear) continue;
        out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break;                                                   // not a simple polygon: a fan will do
    }
    for (let i = 1; i + 1 < idx.length; i++) out.push([idx[0], idx[i], idx[i + 1]]);
    return out;
  }
  const flat = (B, P, y, col) => { for (const [a, b, c] of triangulate(P)) B.tri3([P[a][0], y, P[a][1]], [P[b][0], y, P[b][1]], [P[c][0], y, P[c][1]], col, UP); };
  // A ribbon of a given width along a line, lying flat; corners are filled with a hexagon
  function ribbon(B, line, width, y, col) {
    const h = width / 2;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.05) continue;
      const nx = -(b[1] - a[1]) / l * h, nz = (b[0] - a[0]) / l * h;
      B.quad([a[0] + nx, y, a[1] + nz], [a[0] - nx, y, a[1] - nz], [b[0] - nx, y, b[1] - nz], [b[0] + nx, y, b[1] + nz], col, UP);
    }
    for (let i = 1; i + 1 < line.length; i++) {
      const p = line[i], ring = []; for (let k = 0; k < 6; k++) ring.push([p[0] + Math.cos(k * Math.PI / 3) * h, y, p[1] + Math.sin(k * Math.PI / 3) * h]);
      for (let k = 1; k + 1 < 6; k++) B.tri3(ring[0], ring[k], ring[k + 1], col, UP);
    }
  }

  // ------------------------------------------------------------------ the circuit
  function circuit(data) {
    const F = data.fine, n = F.length;
    let cx = 0, cz = 0; for (const p of F) { cx += p[0]; cz += p[1]; }
    const coarse = F.filter((_, i) => i % 2 === 0);
    const dist = (x, z) => { let d = Infinity; for (const p of coarse) { const q = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (q < d) d = q; } return Math.sqrt(d); };
    const nearest = (x, z) => { let best = 0, d = Infinity; F.forEach((p, i) => { const q = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (q < d) { d = q; best = i; } }); return best; };
    const frame = i => {                                                 // position, unit tangent and unit left-hand normal at a cross-section
      const a = F[(i - 1 + n) % n], b = F[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      return { p: F[i], t, n: [-t[1], t[0]] };
    };
    return { F, n, centre: [cx / n, cz / n], dist, nearest, frame };
  }

  // ------------------------------------------------------------------ ground: floor, hills, water, streets
  function ground(B, road, data) {
    const [cx, cz] = road.centre;
    // paved where the town is (within a block of a building, or of the road), meadows beyond
    const BLOCK = 80, blocks = new Set();
    for (const b of data.buildings) blocks.add(Math.floor(b.p[0][0] / BLOCK) + ',' + Math.floor(b.p[0][1] / BLOCK));
    for (const p of road.F) blocks.add(Math.floor(p[0] / BLOCK) + ',' + Math.floor(p[1] / BLOCK));
    const builtUp = (x, z) => { const i = Math.floor(x / BLOCK), j = Math.floor(z / BLOCK); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (blocks.has((i + a) + ',' + (j + b))) return true; return false; };
    // wooded hills all round, a wide gap where the Allan valley opens (towards the south-west and the east)
    const hill = (x, z) => {
      const r = Math.hypot(x - cx, z - cz), k = smooth(HILLS_FROM, HILLS_FROM + 900, r);
      if (k <= 0) return 0;
      return k * (60 + 150 * fbm(x * 0.0011 + 3.1, z * 0.0011 + 8.7)) * (0.55 + 0.45 * smooth(HILLS_FROM + 500, EDGE, r));
    };
    const colourAt = (x, z, h) => {
      if (h > 6) return shade(C.forest[Math.floor(hash2(Math.round(x / 60), Math.round(z / 60)) * 3)], 0.9 + 0.2 * noise(x * 0.02, z * 0.02));
      return builtUp(x, z) ? C.floor : shade(C.meadow, 0.94 + 0.12 * noise(x * 0.01, z * 0.01));
    };
    const cell = (x0, z0, s) => {
      const c = [[x0, z0], [x0 + s, z0], [x0 + s, z0 + s], [x0, z0 + s]].map(([x, z]) => [x, GROUND + hill(x, z), z]);
      const mx = x0 + s / 2, mz = z0 + s / 2, col = colourAt(mx, mz, hill(mx, mz));
      B.tri3(c[0], c[1], c[2], col, UP); B.tri3(c[0], c[2], c[3], col, UP);
    };
    // 40 m cells over the town, 160 m cells beyond
    const inner = 1280, snap = v => Math.round(v / 160) * 160, ox = snap(cx), oz = snap(cz);
    for (let x = ox - inner; x < ox + inner; x += 40) for (let z = oz - inner; z < oz + inner; z += 40) cell(x, z, 40);
    for (let x = ox - EDGE; x < ox + EDGE; x += 160) for (let z = oz - EDGE; z < oz + EDGE; z += 160)
      if (x < ox - inner || x >= ox + inner || z < oz - inner || z >= oz + inner) cell(x, z, 160);

    for (const p of data.parks) flat(B, p, PARK_Y, shade(C.park, 0.92 + 0.16 * hash2(p[0][0], p[0][1])));
    for (const w of data.water) { if (w.area) flat(B, w.area, WATER_Y, C.water); else ribbon(B, w.line, w.width, WATER_Y, C.water); }
    for (const s of data.streets) { if (s.area) flat(B, s.area, STREET_Y, C.square); else ribbon(B, s.line, s.width, STREET_Y, C.street); }
    for (const r of data.rails) ribbon(B, r, 3.4, RAIL_Y, C.rail);
    return { hill };
  }

  // ------------------------------------------------------------------ props
  function Props(B) {
    // a prism on any footprint, from y0 to y1, with a flat lid
    const prism = (P, y0, y1, wall, lid) => {
      const ccw = signedArea(P) > 0;
      P.forEach((a, i) => {
        const b = P[(i + 1) % P.length], out = ccw ? [b[1] - a[1], 0, -(b[0] - a[0])] : [-(b[1] - a[1]), 0, b[0] - a[0]];
        B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], wall, out);
      });
      if (lid) flat(B, P, y1, lid);
    };
    const circle = (x, z, r, sides, turn = 0) => { const P = []; for (let k = 0; k < sides; k++) { const a = turn + k * 2 * Math.PI / sides; P.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return P; };
    const cone = (P, y0, apex, col) => {
      const ccw = signedArea(P) > 0;
      P.forEach((a, i) => { const b = P[(i + 1) % P.length], out = ccw ? [b[1] - a[1], 0.5, -(b[0] - a[0])] : [-(b[1] - a[1]), 0.5, b[0] - a[0]]; B.tri3([a[0], y0, a[1]], [b[0], y0, b[1]], apex, col, out); });
    };
    // round tree: a trunk and a faceted crown
    const tree = (x, z, y, size, rnd) => {
      const h = size * (0.9 + 0.5 * rnd()), r = h * 0.42, col = C.leaves[Math.floor(rnd() * C.leaves.length)], turn = rnd() * 6;
      prism(circle(x, z, 0.22 * size / 5, 4), y, y + h * 0.45, C.trunk, null);
      const ring = circle(x, z, r, 6, turn);
      cone(ring, y + h * 0.55, [x, y + h * 1.25, z], col);
      for (let k = 0; k < 6; k++) { const a = ring[k], b = ring[(k + 1) % 6]; B.tri3([a[0], y + h * 0.55, a[1]], [b[0], y + h * 0.55, b[1]], [x, y + h * 0.28, z], shade(col, 0.8), [a[0] - x, -1, a[1] - z]); }
    };
    const fir = (x, z, y, h, rnd) => { const col = C.forest[Math.floor(rnd() * 3)]; cone(circle(x, z, h * 0.3, 5, rnd() * 6), y + h * 0.15, [x, y + h, z], col); };
    return { prism, circle, cone, tree, fir };
  }

  // ------------------------------------------------------------------ buildings
  function Buildings(B, X, road) {
    // A building on its footprint: walls, windows near the road, and a hipped tiled roof (the footprint
    // shrunk towards its middle and raised) or a flat one for the big sheds and blocks.
    function building(P, o) {
      const ccw = signedArea(P) > 0, c = centroid(P), y0 = o.base, y1 = y0 + o.height;
      const outward = (a, b) => (ccw ? [b[1] - a[1], 0, -(b[0] - a[0])] : [-(b[1] - a[1]), 0, b[0] - a[0]]);
      P.forEach((a, i) => {
        const b = P[(i + 1) % P.length], out = outward(a, b), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], shade(o.wall, 0.94 + 0.12 * hash2(a[0], b[1])), out);
        if (!o.windows || l < 4.5) return;
        const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l, nx = out[0] / l * 0.07, nz = out[2] / l * 0.07;
        const count = Math.max(1, Math.floor(l / (o.bay || 3.1))), floors = Math.max(1, Math.round(o.height / (o.storey || FLOOR))), fh = o.height / floors;
        const w = o.windowWidth || 1.0, wh = Math.min(o.windowHeight || 1.6, fh - 0.9);
        for (let f = 0; f < floors; f++) for (let k = 0; k < count; k++) {
          const s = (k + 0.5) * l / count - w / 2, wy = y0 + f * fh + (fh - wh) * 0.55;
          const p = t => [a[0] + ux * (s + t) + nx, a[1] + uz * (s + t) + nz];
          const q0 = p(0), q1 = p(w);
          B.quad([q0[0], wy, q0[1]], [q1[0], wy, q1[1]], [q1[0], wy + wh, q1[1]], [q0[0], wy + wh, q0[1]], o.glass || C.window, out);
        }
      });
      if (o.roof === 'flat') { flat(B, P, y1, C.flatRoof); return; }
      const k = o.ridge || 0.38, rise = o.rise, top = P.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]), tiles = o.tiles;
      P.forEach((a, i) => {
        const j = (i + 1) % P.length, b = P[j], out = outward(a, b);
        B.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [top[j][0], y1 + rise, top[j][1]], [top[i][0], y1 + rise, top[i][1]], shade(tiles, 0.9 + 0.2 * hash2(b[0], a[1])), [out[0], Math.hypot(out[0], out[2]), out[2]]);
      });
      flat(B, top, y1 + rise, shade(tiles, 1.05));
    }
    return { building };
  }

  // ------------------------------------------------------------------ the town
  function town(B, road, data, hill, rnd) {
    const X = Props(B), { building } = Buildings(B, X, road);
    const stats = { buildings: 0, detailed: 0, trees: 0, stands: 0 };
    const same = (a, b) => Array.isArray(b) && a.length === b.length && a[0][0] === b[0][0] && a[0][1] === b[0][1];
    const L = data.landmarks || {};

    // ---- the castle's rock: a faceted mound under the castle, kept off the road
    let rock = null;
    if (Array.isArray(L.chateau)) {
      const c = centroid(L.chateau), reach = Math.max(...L.chateau.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])));
      const top = reach + 14, foot = Math.min(top + 26, road.dist(c[0], c[1]) - 13);
      if (foot > top * 0.6) {
        const upper = Math.min(top, foot - 8), ringTop = X.circle(c[0], c[1], upper, 14, 0.3), ringFoot = X.circle(c[0], c[1], foot, 14, 0.3);
        ringTop.forEach((a, i) => {
          const j = (i + 1) % 14, b = ringTop[j], fa = ringFoot[i], fb = ringFoot[j];
          B.quad([fa[0], GROUND, fa[1]], [fb[0], GROUND, fb[1]], [b[0], ROCK_HEIGHT, b[1]], [a[0], ROCK_HEIGHT, a[1]], i % 2 ? C.rock : C.rockDark, [a[0] - c[0], 1, a[1] - c[1]]);
        });
        flat(B, ringTop, ROCK_HEIGHT, C.park);
        rock = { c, upper, foot };
      }
    }
    const baseAt = (x, z) => (rock != null && Math.hypot(x - rock.c[0], z - rock.c[1]) < rock.upper ? ROCK_HEIGHT : rock != null && Math.hypot(x - rock.c[0], z - rock.c[1]) < rock.foot ? null : GROUND);

    // ---- landmarks: what OpenStreetMap cannot tell, said here
    const special = [
      [L.chateau, { height: 15, wall: C.castle, tiles: C.castleRoof, rise: 6, ridge: 0.3, windows: true, bay: 4, towers: 'round' }],
      [L.temple, { height: 14, wall: C.stone, tiles: C.tiles[1], rise: 7, ridge: 0.25, windows: true, bay: 4.5, storey: 14, windowHeight: 7, windowWidth: 1.6 }],
      [L.mairie, { height: 12, wall: C.pinkStone, tiles: C.slate, rise: 4, windows: true }],
      [L.halles, { height: 9, wall: C.walls[6], tiles: C.tiles[0], rise: 7, ridge: 0.3, windows: true, bay: 3.4 }],
      [L.eglise, { height: 17, wall: C.stone, tiles: C.slate, rise: 6, ridge: 0.25, windows: true, bay: 5, storey: 17, windowHeight: 8, windowWidth: 1.7, towers: 'square' }],
      [L.templeGeorges, { height: 11, wall: C.stone, tiles: C.tiles[2], rise: 5, windows: true, bay: 4, storey: 11, windowHeight: 5 }],
    ];

    for (const b of data.buildings) {
      const P = b.p, c = centroid(P), area = Math.abs(signedArea(P)), base = baseAt(c[0], c[1]);
      if (base == null) continue;                                        // on the slope of the rock
      const h = hash2(c[0] * 0.37, c[1] * 0.41), near = road.dist(c[0], c[1]) < DETAIL;
      const found = special.find(([poly]) => poly != null && same(P, poly));
      let o;
      if (found) o = { ...found[1] };
      else {
        const floors = b.levels || (b.height ? Math.round(b.height / FLOOR) : area < 70 ? 2 : area < 260 ? 2 + Math.floor(h * 2.2) : area < 900 ? 3 + Math.floor(h * 2) : area < 2500 ? 2 + Math.floor(h * 3) : 2);
        const big = area >= 1100 || P.length > 14;
        o = { height: Math.max(1, floors) * FLOOR + 0.6, wall: big ? C.plain[Math.floor(h * 3)] : C.walls[Math.floor(hash2(c[1] * 0.9, c[0] * 0.7) * C.walls.length)],
          roof: big ? 'flat' : 'hip', tiles: C.tiles[Math.floor(h * 4)], rise: clamp(Math.sqrt(area) * 0.24, 1.8, 5), windows: near };
        if (b.kind === 'worship') Object.assign(o, { height: 12, wall: C.stone, roof: 'hip', rise: 5, tiles: C.slate });
        if (b.kind === 'station') Object.assign(o, { height: 9, wall: C.stone, roof: 'hip', rise: 3, tiles: C.slate, windows: true });
      }
      o.base = base;
      building(P, o);
      stats.buildings++; if (o.windows) stats.detailed++;
      if (o.towers) {                                                    // at the two ends of the footprint's long side
        let far = [0, 1], d = 0;
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const q = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]); if (q > d) { d = q; far = [i, j]; } }
        const ends = o.towers === 'round' ? far.map(i => P[i]) : (() => {  // a church has both its towers at the same end
          const a = P[far[0]], next = P[(far[0] + 1) % P.length], prev = P[(far[0] + P.length - 1) % P.length];
          const side = Math.hypot(next[0] - a[0], next[1] - a[1]) < Math.hypot(prev[0] - a[0], prev[1] - a[1]) ? next : prev;
          return [a, side];
        })();
        for (const e of ends) {
          const x = e[0] + (c[0] - e[0]) * 0.12, z = e[1] + (c[1] - e[1]) * 0.12;
          if (o.towers === 'round') { const ring = X.circle(x, z, 6.5, 10); X.prism(ring, base, base + 27, C.castle, null); X.cone(X.circle(x, z, 7.3, 10), base + 27, [x, base + 39, z], C.castleRoof); }
          else { const sq = X.circle(x, z, 4.2, 4, Math.PI / 4); X.prism(sq, base, base + 30, C.stone, null); X.cone(X.circle(x, z, 4.6, 4, Math.PI / 4), base + 30, [x, base + 41, z], C.slate); }
        }
      }
    }

    // ---- who stands where: a coarse map of the buildings, for whatever is planted afterwards
    const CELL = 24, grid = new Map();
    for (const b of data.buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of b.p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b.p); }
    }
    const built = (x, z, margin = 0) => {
      for (let i = Math.floor((x - margin) / CELL); i <= Math.floor((x + margin) / CELL); i++) for (let j = Math.floor((z - margin) / CELL); j <= Math.floor((z + margin) / CELL); j++)
        for (const P of grid.get(i + ',' + j) || []) { if (inPoly(x, z, P)) return true; if (margin > 0) for (const q of P) if (Math.hypot(q[0] - x, q[1] - z) < margin) return true; }
      return false;
    };
    const wet = (x, z) => data.water.some(w => (w.area ? inPoly(x, z, w.area) : w.line.some(q => Math.hypot(q[0] - x, q[1] - z) < w.width / 2 + 3)));

    // ---- trees: in the parks, along the Allan, firs on the hills
    const plant = (x, z, size) => { if (road.dist(x, z) < 13 || built(x, z, 2.5) || wet(x, z) || baseAt(x, z) !== GROUND) return; X.tree(x, z, GROUND, size, rnd); stats.trees++; };
    for (const p of data.parks) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      for (let x = x0; x <= x1; x += 11) for (let z = z0; z <= z1; z += 11) { const tx = x + (rnd() - 0.5) * 7, tz = z + (rnd() - 0.5) * 7; if (rnd() < 0.7 && inPoly(tx, tz, p)) plant(tx, tz, 6.5); }
    }
    for (const w of data.water) if (w.line && w.width >= 15) for (let i = 0; i + 1 < w.line.length; i++) {
      const a = w.line[i], b = w.line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1) continue;
      for (let s = rnd() * 16; s < l; s += 16) for (const side of [-1, 1]) { const o = side * (w.width / 2 + 5 + rnd() * 3); plant(a[0] + (b[0] - a[0]) * s / l - (b[1] - a[1]) / l * o, a[1] + (b[1] - a[1]) * s / l + (b[0] - a[0]) / l * o, 7.5); }
    }
    const [cx, cz] = road.centre;
    for (let k = 0; k < 2600; k++) {
      const a = rnd() * 2 * Math.PI, r = HILLS_FROM + 150 + rnd() * rnd() * 1500, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = hill(x, z);
      if (h > 5) X.fir(x, z, GROUND + h - 0.5, 11 + rnd() * 9, rnd);
    }

    // ---- lines painted across the road: start, checkpoints, finish. They follow the road exactly; the track
    // parts keep their own copy under the asphalt (tools/make_montbeliard.js)
    const across = (i, depth, along, col, lanes) => {
      const f = road.frame(i), [x, z, y, left, right] = f.p, Y = y + 0.03;
      const at = (u, v) => [x + f.n[0] * u + f.t[0] * v, Y, z + f.n[1] * u + f.t[1] * v];
      const n = lanes || 1, w = (left + right) / n;
      for (let k = 0; k < n; k++) { const u0 = -right + k * w, u1 = u0 + w; B.quad(at(u0, along), at(u1, along), at(u1, along + depth), at(u0, along + depth), typeof col === 'function' ? col(k) : col, UP); }
    };
    const gateIndex = g => road.nearest(g.gx * 5, g.gz * 5);
    across(0, 0.6, -0.3, C.startLine);
    for (const g of data.checkpoints) across(gateIndex(g), 1.0, -0.5, C.checkpoint);
    { const i = gateIndex(data.finish); for (let r = 0; r < 2; r++) across(i, 0.9, r * 0.9 - 0.9, k => ((k + r) % 2 ? C.startLine : C.black), 10); }

    // ---- grandstands, where the town leaves room beside the road
    const stand = (x, z, ux, uz, nx, nz) => {                            // 26 m long, six rows rising away from the road
      for (let r = 0; r < 6; r++) {
        const d0 = r * 1.1, d1 = d0 + 1.1, y1 = 1.2 + r * 0.75, col = C.seats[r % 2];
        const p = (s, d) => [x + ux * s + nx * d, z + uz * s + nz * d];
        const a = p(-13, d0), b = p(13, d0), c = p(13, d1), e = p(-13, d1);
        B.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [e[0], y1, e[1]], col, UP);
        B.quad([a[0], r === 0 ? GROUND : y1 - 0.75, a[1]], [b[0], r === 0 ? GROUND : y1 - 0.75, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], r === 0 ? C.standFrame : shade(col, 0.8), [-nx, 0, -nz]);
      }
      const back = [x + nx * 6.6, z + nz * 6.6];
      B.quad([back[0] - ux * 13, GROUND, back[1] - uz * 13], [back[0] + ux * 13, GROUND, back[1] + uz * 13], [back[0] + ux * 13, 6, back[1] + uz * 13], [back[0] - ux * 13, 6, back[1] - uz * 13], C.standFrame, [nx, 0, nz]);
    };
    let lastStand = -100;
    for (let i = 10; i < road.n && stats.stands < 8; i += 6) {
      if (i - lastStand < 40) continue;
      const f = road.frame(i), before = road.frame((i - 5 + road.n) % road.n), after = road.frame((i + 5) % road.n);
      if (before.t[0] * after.t[0] + before.t[1] * after.t[1] < 0.995) continue;      // on the straights only
      for (const side of [1, -1]) {
        const off = (side > 0 ? f.p[3] : f.p[4]) + 5.5, nx = f.n[0] * side, nz = f.n[1] * side, x = f.p[0] + nx * off, z = f.p[1] + nz * off;
        let free = true;
        for (let s = -13; s <= 13 && free; s += 6.5) for (let d = 0; d <= 7 && free; d += 3.5) { const px = x + f.t[0] * s + nx * d, pz = z + f.t[1] * s + nz * d; if (built(px, pz, 2) || wet(px, pz) || road.dist(px, pz) < off - 6.5 || baseAt(px, pz) !== GROUND) free = false; }
        if (!free) continue;
        stand(x, z, f.t[0], f.t[1], nx, nz); stats.stands++; lastStand = i; break;
      }
    }
    return stats;
  }

  // ------------------------------------------------------------------ entry point
  function build(data) {
    const road = circuit(data), rnd = random(SEED);
    const terrain = Builder(), objects = Builder();
    const { hill } = ground(terrain, road, data);
    const stats = town(objects, road, data, hill, rnd);
    return { terrain: terrain.done(), objects: objects.done(), stats };
  }

  const api = { build };
  if (typeof window !== 'undefined') window.ApexMontbeliard = api;
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
