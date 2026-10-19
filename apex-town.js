// Apex town: the real surroundings of the circuits built from maps (Montbéliard, Strasbourg, Dijon,
// Spa-Francorchamps), in low poly. Looks only.
//
// These places are not invented: tracks/<circuit>.json (written by tools/make_circuit.js) carries the real
// map around the lap, from OpenStreetMap, in the circuit's own frame, and for Spa the real relief (EU-DEM).
// From it:
//
//   ground      the land at its real heights where the map has them (flat towns otherwise), streets and
//               squares, parks and meadows, rivers and canals, railways, wooded hills on the horizon
//   town        every building on its real footprint, in the colours of the place, with windows on the
//               ones near the road; forests planted where the map has forests
//   landmarks   what makes each place: said by hand in STYLES below (the map gives footprints, not looks)
//   circuit     the lines painted across the road, grandstands where there is room
//
// OpenStreetMap seldom gives heights: storeys are taken from the map when it has them, else guessed from
// the size of each building. No 3D model or texture is shipped, and the same seed always gives the same town.
//
// A town whose style has `rich` (Dijon) is drawn in more detail, as Monaco is: dressed fronts (windows, sills,
// shutters, shops, balconies, cornices), mansards with dormers, chimneys, plane trees and lamps along the road.
// The detail fades with the distance to the road, and the fronts that are not seen from it stay plain.
//
// Coordinates are the circuit's own: metres, the start line at the origin, heights counted from it.
// Nothing here is collided with: the road keeps its own barriers.
//
// window.ApexTown.build(circuit) returns { terrain, objects }, each { positions, normals, colors }
// (linear RGB, one colour per vertex, flat triangles), like apex-monaco.js; apex-scenery.js turns them into meshes.
(() => {
  'use strict';

  const FLOOR = 3.1;                // storey height
  const GROUND = -0.5;              // the land beside the road, just under it; what lies on it, from the bottom up:
  const PARK_Y = 0.1, WATER_Y = 0.2, STREET_Y = 0.3, RAIL_Y = 0.4;
  const ROCK_HEIGHT = 13;           // Montbéliard: the castle's rock above the lower town

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

  // ------------------------------------------------------------------ colours (display sRGB)
  const C = {
    floor: [0.60, 0.58, 0.54], street: [0.40, 0.40, 0.42], square: [0.78, 0.74, 0.67], park: [0.44, 0.59, 0.33], meadow: [0.47, 0.60, 0.35],
    woodFloor: [0.24, 0.38, 0.22], water: [0.30, 0.47, 0.55], rail: [0.42, 0.38, 0.35], forest: [[0.20, 0.36, 0.20], [0.24, 0.41, 0.22], [0.17, 0.32, 0.19]],
    flatRoof: [0.52, 0.52, 0.53], slate: [0.30, 0.32, 0.37], copper: [0.42, 0.56, 0.50], window: [0.22, 0.29, 0.40], glass: [0.16, 0.20, 0.26],
    stone: [0.80, 0.70, 0.54], paleStone: [0.84, 0.79, 0.66], pinkStone: [0.76, 0.56, 0.49], vosges: [0.62, 0.43, 0.39], castle: [0.86, 0.82, 0.72], castleRoof: [0.44, 0.26, 0.21],
    white: [0.72, 0.73, 0.75], iron: [0.50, 0.57, 0.57],
    rock: [0.62, 0.59, 0.54], rockDark: [0.52, 0.50, 0.46],
    trunk: [0.42, 0.32, 0.24], leaves: [[0.27, 0.47, 0.24], [0.33, 0.54, 0.27], [0.39, 0.58, 0.29], [0.24, 0.42, 0.24]],
    startLine: [0.92, 0.92, 0.92], checkpoint: [0.95, 0.72, 0.10], black: [0.07, 0.07, 0.08],
    standFrame: [0.58, 0.60, 0.63], seats: [[0.70, 0.16, 0.16], [0.80, 0.22, 0.20]],
    // the glazed tiles of Burgundy: green, ochre, black and red, laid in bands
    glazed: [[0.20, 0.42, 0.26], [0.84, 0.66, 0.22], [0.12, 0.12, 0.13], [0.62, 0.22, 0.16]],
    // detailed fronts (the towns whose style has `rich`)
    pane: [0.25, 0.34, 0.47], door: [0.30, 0.22, 0.17], ironwork: [0.13, 0.13, 0.14], zinc: [0.55, 0.57, 0.60], chimney: [0.66, 0.42, 0.34],
    lamp: [0.20, 0.22, 0.22], lampGlass: [0.95, 0.92, 0.78],
    shutters: [[0.45, 0.55, 0.62], [0.42, 0.52, 0.40], [0.74, 0.72, 0.66], [0.50, 0.30, 0.24], [0.36, 0.42, 0.50]],
    signs: [[0.55, 0.12, 0.12], [0.15, 0.30, 0.22], [0.14, 0.20, 0.34], [0.80, 0.62, 0.20], [0.30, 0.30, 0.32]],
    awnings: [[0.62, 0.16, 0.14], [0.18, 0.40, 0.26], [0.85, 0.85, 0.82], [0.20, 0.30, 0.50], [0.75, 0.55, 0.20]],
  };
  const PLAIN = [[0.74, 0.73, 0.70], [0.68, 0.69, 0.70], [0.78, 0.76, 0.70]];   // sheds, shops and modern blocks, anywhere
  const lin = c => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

  // ------------------------------------------------------------------ the places
  // walls, tiles: the colours of the ordinary houses. floors: storeys added to the guess (town centres are
  // taller than a small town). steep: how steep the roofs are. detail: metres from the road within which
  // buildings get windows. hills: height of the invented hills on the horizon, where there is no real relief.
  // landmarks(L): what stands on the footprints the map names (tools/circuits.js gives them these keys).
  const STYLES = {
    montbeliard: {
      seed: 1397,                    // the county passes to the house of Württemberg
      // fronts of the old town: lime-washed in warm and pale colours, as in the towns of the Rhine
      walls: [[0.80, 0.66, 0.42], [0.84, 0.75, 0.52], [0.80, 0.60, 0.52], [0.74, 0.52, 0.42], [0.66, 0.74, 0.62], [0.62, 0.72, 0.80], [0.85, 0.81, 0.72],
        [0.78, 0.71, 0.60], [0.82, 0.56, 0.36], [0.72, 0.65, 0.76], [0.86, 0.78, 0.58], [0.76, 0.76, 0.72]],
      tiles: [[0.52, 0.27, 0.19], [0.47, 0.24, 0.18], [0.57, 0.31, 0.21], [0.44, 0.25, 0.20]],
      floors: 0, steep: 0.24, detail: 95, hills: 1, rock: 'chateau',
      landmarks: () => ({
        chateau: { height: 15, wall: C.castle, tiles: C.castleRoof, rise: 6, ridge: 0.3, windows: true, bay: 4, towers: { shape: 'round', at: 'ends', radius: 6.5, height: 27, roof: 12, wall: C.castle, top: C.castleRoof } },
        temple: { height: 14, wall: C.stone, tiles: [0.47, 0.24, 0.18], rise: 7, ridge: 0.25, windows: true, bay: 4.5, storey: 14, windowHeight: 7, windowWidth: 1.6 },
        mairie: { height: 12, wall: C.pinkStone, tiles: C.slate, rise: 4, windows: true },
        halles: { height: 9, wall: [0.85, 0.81, 0.72], tiles: [0.52, 0.27, 0.19], rise: 7, ridge: 0.3, windows: true, bay: 3.4 },
        eglise: { height: 17, wall: C.stone, tiles: C.slate, rise: 6, ridge: 0.25, windows: true, bay: 5, storey: 17, windowHeight: 8, windowWidth: 1.7, towers: { shape: 'square', at: 'front', radius: 4.2, height: 30, roof: 11, wall: C.stone, top: C.slate } },
        templeGeorges: { height: 11, wall: C.stone, tiles: [0.57, 0.31, 0.21], rise: 5, windows: true, bay: 4, storey: 11, windowHeight: 5 },
      }),
    },
    strasbourg: {
      seed: 1439,                    // the cathedral's spire is finished
      // Alsace: white, cream and ochre fronts, some pink and pale green, under steep brown roofs
      walls: [[0.86, 0.84, 0.78], [0.84, 0.78, 0.62], [0.80, 0.66, 0.46], [0.78, 0.60, 0.50], [0.70, 0.74, 0.62], [0.82, 0.80, 0.70], [0.76, 0.56, 0.42], [0.86, 0.82, 0.66], [0.72, 0.70, 0.66], [0.80, 0.72, 0.60]],
      tiles: [[0.42, 0.25, 0.19], [0.38, 0.23, 0.18], [0.47, 0.28, 0.20], [0.35, 0.24, 0.20]],
      floors: 1, steep: 0.36, detail: 70, hills: 0.25,
      landmarks: () => {
        const tower = { height: 22, wall: C.vosges, tiles: [0.38, 0.23, 0.18], rise: 9, ridge: 0.1 };
        const palace = { height: 19, wall: C.paleStone, tiles: C.slate, rise: 5, windows: true, bay: 4, storey: 6, windowHeight: 3.2, windowWidth: 1.5 };
        return {
          // Notre-Dame: pink sandstone of the Vosges, one spire only, 142 m, on the north side of the west front
          cathedrale: { height: 32, wall: C.vosges, tiles: C.copper, rise: 12, ridge: 0.2, windows: true, bay: 7, storey: 32, windowHeight: 16, windowWidth: 2.4,
            towers: { shape: 'square', at: 'west', radius: 8, height: 66, wall: C.vosges, spire: { radius: 6.5, height: 76, sides: 8, wall: C.vosges }, flatTop: C.vosges } },
          saintPaul: { height: 22, wall: C.pinkStone, tiles: C.slate, rise: 8, ridge: 0.22, windows: true, bay: 6, storey: 22, windowHeight: 11, windowWidth: 2,
            towers: { shape: 'square', at: 'front', radius: 4.6, height: 46, roof: 30, wall: C.pinkStone, top: C.slate } },
          saintThomas: { height: 18, wall: C.pinkStone, tiles: [0.38, 0.23, 0.18], rise: 9, ridge: 0.25, windows: true, bay: 6, storey: 18, windowHeight: 9, windowWidth: 1.8,
            towers: { shape: 'square', at: 'west', radius: 6, height: 34, roof: 8, wall: C.pinkStone, top: C.slate } },
          saintPierre: { height: 15, wall: C.pinkStone, tiles: [0.42, 0.25, 0.19], rise: 8, ridge: 0.25, windows: true, bay: 5, storey: 15, windowHeight: 7, towers: { shape: 'square', at: 'west', radius: 4, height: 30, roof: 14, wall: C.pinkStone, top: C.slate } },
          rohan: { ...palace, wall: [0.86, 0.78, 0.62] }, opera: { ...palace, height: 20 }, mairie: { ...palace, height: 14 }, aubette: { ...palace, height: 15 },
          palaisRhin: { ...palace, height: 22, towers: { shape: 'round', at: 'centre', radius: 11, height: 30, roof: 12, wall: C.paleStone, top: C.slate } },
          bnu: { ...palace, height: 21, towers: { shape: 'round', at: 'centre', radius: 9, height: 28, roof: 9, wall: C.paleStone, top: C.copper } },
          tns: { ...palace, height: 20 }, justice: { ...palace, height: 20 }, universite: { ...palace, height: 20 },
          douane: { height: 13, wall: [0.84, 0.78, 0.62], tiles: [0.42, 0.25, 0.19], rise: 9, ridge: 0.2, windows: true },
          tour1: tower, tour2: tower, tour3: tower, tour4: tower,   // the towers of the Ponts Couverts
        };
      },
    },
    dijon: {
      seed: 1364,                    // Philip the Bold becomes duke of Burgundy
      // Burgundy limestone: creams and warm greys, a few ochres
      walls: [[0.86, 0.80, 0.68], [0.82, 0.76, 0.64], [0.88, 0.84, 0.74], [0.78, 0.72, 0.62], [0.84, 0.74, 0.58], [0.80, 0.78, 0.72], [0.86, 0.78, 0.66], [0.76, 0.70, 0.60]],
      tiles: [[0.50, 0.28, 0.20], [0.44, 0.27, 0.21], [0.36, 0.30, 0.28], [0.54, 0.32, 0.22]],
      floors: 1, steep: 0.30, detail: 70, hills: 0.6,
      // detailed fronts: windows with sills and shutters, shops and awnings on the street, string courses and cornices,
      // stone buildings under slate mansards with dormers and balconies, chimneys, plane trees and lamps along the road
      rich: {
        near: 140, far: 330,           // full detail within `near` metres of the road, windows only up to `far`
        stone: [[0.88, 0.84, 0.74], [0.84, 0.80, 0.70], [0.90, 0.86, 0.77], [0.86, 0.81, 0.69]],   // the limestone fronts
        stoneShare: 0.65,              // share of the buildings of four floors or more built in stone under a mansard
        glazed: 0.015,                 // share of the houses under glazed tiles
        plainArea: 5000,               // footprints larger than this are schools, halls and shops: flat roofs
        trees: 5, lamps: 10,           // along the road: a plane tree every 5 cross-sections a side, a lamp every 10
      },
      landmarks: () => {
        const stone ={ height: 17, wall: C.paleStone, tiles: C.slate, rise: 5, windows: true, bay: 4, storey: 5.5, windowHeight: 3, windowWidth: 1.4 };
        const church = { height: 20, wall: C.paleStone, rise: 9, ridge: 0.22, windows: true, bay: 6, storey: 20, windowHeight: 10, windowWidth: 2 };
        return {
          palais: { ...stone, height: 18 },
          tourPhilippe: { tower: { shape: 'square', radius: 5.5, height: 46, wall: C.paleStone, flatTop: C.paleStone } },   // the dukes' tower, over the palace
          cathedrale: { ...church, height: 24, glazed: true, towers: { shape: 'square', at: 'front', radius: 5, height: 42, roof: 16, wall: C.paleStone, top: C.glazed[0] },
            fleche: { radius: 3, height: 93, wall: C.slate } },   // Saint-Bénigne: glazed roof, a 93 m spire over the crossing
          notreDame: { ...church, tiles: C.slate, towers: { shape: 'square', at: 'centre', radius: 4, height: 40, roof: 14, wall: C.paleStone, top: C.slate } },
          saintMichel: { ...church, tiles: C.slate, towers: { shape: 'square', at: 'front', radius: 5, height: 44, roof: 7, wall: C.paleStone, top: C.copper } },
          saintPhilibert: { ...church, height: 15, tiles: C.slate, towers: { shape: 'square', at: 'centre', radius: 3.4, height: 28, roof: 22, wall: C.paleStone, top: C.paleStone } },
          halles: { height: 10, wall: C.iron, tiles: C.slate, rise: 4, ridge: 0.5, windows: true, bay: 3, storey: 10, windowHeight: 6, windowWidth: 2, glass: C.glass },
          theatre: stone, prefecture: stone, poste: { ...stone, height: 20 },
          porteGuillaume: { arch: { width: 12, depth: 5, height: 13, wall: C.paleStone } },   // the gate on Place Darcy
        };
      },
    },
    spa: {
      seed: 1921,                    // the first race on the triangle Francorchamps - Malmedy - Stavelot
      // the Ardennes: grey stone and white render under slate
      walls: [[0.80, 0.80, 0.78], [0.66, 0.64, 0.60], [0.74, 0.72, 0.68], [0.84, 0.83, 0.80], [0.60, 0.58, 0.55]],
      tiles: [C.slate, [0.34, 0.35, 0.38], [0.27, 0.29, 0.33], [0.36, 0.33, 0.33]],
      floors: 0, steep: 0.30, detail: 140, hills: 1,
      landmarks: () => {
        const pits = { height: 12, wall: C.white, roof: 'flat', windows: true, bay: 6, storey: 4, windowHeight: 2.4, windowWidth: 4.5, glass: C.glass };
        return { pitsF1: { ...pits, height: 14 }, pitsEndurance: pits, hotelSource: { height: 13, wall: [0.84, 0.83, 0.80], tiles: C.slate, rise: 4, windows: true } };
      },
    },
  };

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
  const boundsOf = P => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; };
  const inPoly = (x, z, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], b = P[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  // Is a point inside one of many polygons? (their boxes are checked first)
  function Areas(polygons) {
    const list = polygons.map(P => ({ P, b: boundsOf(P) }));
    return (x, z) => { for (const { P, b } of list) if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inPoly(x, z, P)) return true; return false; };
  }
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
  // a polygon lying flat at height y (a number, or a function of x and z where the land is not level)
  const flat = (B, P, y, col) => {
    const Y = typeof y === 'function' ? y : () => y;
    for (const [a, b, c] of triangulate(P)) B.tri3([P[a][0], Y(P[a][0], P[a][1]), P[a][1]], [P[b][0], Y(P[b][0], P[b][1]), P[b][1]], [P[c][0], Y(P[c][0], P[c][1]), P[c][1]], col, UP);
  };
  // A ribbon of a given width along a line, lying on the land; corners are filled with a hexagon.
  // Where the land is not level (step > 0) the line is cut into short pieces that follow it.
  function ribbon(B, line, width, y, col, step = 0) {
    const h = width / 2, Y = typeof y === 'function' ? y : () => y;
    let pts = line;
    if (step > 0) { pts = []; line.forEach((a, i) => { if (i + 1 === line.length) { pts.push(a); return; } const b = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }); }
    const ys = pts.map(p => Y(p[0], p[1]));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.05) continue;
      const nx = -(b[1] - a[1]) / l * h, nz = (b[0] - a[0]) / l * h;
      B.quad([a[0] + nx, ys[i], a[1] + nz], [a[0] - nx, ys[i], a[1] - nz], [b[0] - nx, ys[i + 1], b[1] - nz], [b[0] + nx, ys[i + 1], b[1] + nz], col, UP);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      if (step > 0 && i % 2) continue;
      const p = pts[i], ring = []; for (let k = 0; k < 6; k++) ring.push([p[0] + Math.cos(k * Math.PI / 3) * h, ys[i], p[1] + Math.sin(k * Math.PI / 3) * h]);
      for (let k = 1; k + 1 < 6; k++) B.tri3(ring[0], ring[k], ring[k + 1], col, UP);
    }
  }

  // ------------------------------------------------------------------ the circuit
  function circuit(data) {
    const F = data.fine, n = F.length;
    let cx = 0, cz = 0; for (const p of F) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    let reach = 0; for (const p of F) reach = Math.max(reach, Math.hypot(p[0] - cx, p[1] - cz));
    // the road's points in 60 m boxes: the nearest one to any place, without looking at them all
    const BOX = 60, boxes = new Map();
    F.forEach((p, i) => { const k = Math.floor(p[0] / BOX) + ',' + Math.floor(p[1] / BOX); if (!boxes.has(k)) boxes.set(k, []); boxes.get(k).push(i); });
    const near = (x, z, rings = 2) => {                                  // { d, y } of the nearest point within rings * 60 m, else d = Infinity
      const bi = Math.floor(x / BOX), bj = Math.floor(z / BOX);
      let d = Infinity, y = 0;
      for (let i = bi - rings; i <= bi + rings; i++) for (let j = bj - rings; j <= bj + rings; j++) for (const k of boxes.get(i + ',' + j) || []) { const p = F[k], q = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (q < d) { d = q; y = p[2]; } }
      return { d: Math.sqrt(d), y };
    };
    const dist = (x, z) => near(x, z).d;
    // distance to the road within rings * 60 m, and the unit direction towards its nearest point ({ d: Infinity } beyond)
    const towards = (x, z, rings = 2) => {
      const bi = Math.floor(x / BOX), bj = Math.floor(z / BOX);
      let d = Infinity, best = -1;
      for (let i = bi - rings; i <= bi + rings; i++) for (let j = bj - rings; j <= bj + rings; j++) for (const k of boxes.get(i + ',' + j) || []) { const p = F[k], q = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (q < d) { d = q; best = k; } }
      if (best < 0) return { d: Infinity, x: 0, z: 0 };
      d = Math.sqrt(d);
      return { d, x: (F[best][0] - x) / (d || 1), z: (F[best][1] - z) / (d || 1) };
    };
    const nearest = (x, z) => { let best = 0, d = Infinity; F.forEach((p, i) => { const q = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (q < d) { d = q; best = i; } }); return best; };
    const frame = i => {                                                 // position, unit tangent and unit left-hand normal at a cross-section
      const a = F[(i - 1 + n) % n], b = F[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      return { p: F[i], t, n: [-t[1], t[0]] };
    };
    return { F, n, centre: [cx, cz], reach, bounds: boundsOf(F), near, dist, towards, nearest, frame };
  }

  // ------------------------------------------------------------------ the land
  // Height of the land anywhere: the real relief where the map has it, the road's own height beside the road
  // (the road was smoothed and its slopes capped: the land joins it over 90 m), and invented wooded hills
  // beyond the map.
  function Land(road, data, style) {
    const [cx, cz] = road.centre, R = data.relief, hillsFrom = road.reach + 700, edge = road.reach + 2900;
    let real = null;
    if (R) {
      const { x0, z0, step, cols, rows, h } = R, f = R.frame, scale = R.scale || 1, zero = R.startHeight || 0;
      real = (x, z) => {
        const mx = f.origin[0] + x * f.cos + z * f.sin, mz = f.origin[1] - x * f.sin + z * f.cos;   // back into the map's frame
        const u = clamp((mx - x0) / step, 0, cols - 1.001), v = clamp((mz - z0) / step, 0, rows - 1.001), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const a = h[i * rows + j], b = h[(i + 1) * rows + j], c = h[i * rows + j + 1], d = h[(i + 1) * rows + j + 1];
        return ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv) * scale - zero;
      };
    }
    const hill = (x, z) => {
      const r = Math.hypot(x - cx, z - cz), k = smooth(hillsFrom, hillsFrom + 900, r);
      return k <= 0 ? 0 : k * style.hills * (60 + 150 * fbm(x * 0.0011 + 3.1, z * 0.0011 + 8.7)) * (0.55 + 0.45 * smooth(hillsFrom + 500, edge, r));
    };
    const height = (x, z) => {
      if (!real) return GROUND + hill(x, z);
      const n = road.near(x, z), land = real(x, z) + GROUND;
      return n.d === Infinity ? land : n.y + GROUND + (land - n.y - GROUND) * smooth(11, 90, n.d);
    };
    return { height, hill, real: !!real, hillsFrom, edge };
  }

  function ground(B, road, data, land, inWoods) {
    const [cx, cz] = road.centre;
    // paved where the town is (within a block of a building, or of the road), meadows beyond
    const BLOCK = 80, blocks = new Set();
    if (!land.real) {
      for (const b of data.buildings) blocks.add(Math.floor(b.p[0][0] / BLOCK) + ',' + Math.floor(b.p[0][1] / BLOCK));
      for (const p of road.F) blocks.add(Math.floor(p[0] / BLOCK) + ',' + Math.floor(p[1] / BLOCK));
    }
    const builtUp = (x, z) => { const i = Math.floor(x / BLOCK), j = Math.floor(z / BLOCK); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (blocks.has((i + a) + ',' + (j + b))) return true; return false; };
    const inParks = Areas(data.parks);
    const colourAt = (x, z) => {
      if (!land.real && land.hill(x, z) > 6) return shade(C.forest[Math.floor(hash2(Math.round(x / 60), Math.round(z / 60)) * 3)], 0.9 + 0.2 * noise(x * 0.02, z * 0.02));
      if (builtUp(x, z)) return C.floor;
      if (inWoods(x, z)) return shade(C.woodFloor, 0.92 + 0.16 * noise(x * 0.02, z * 0.02));
      if (land.real && Math.hypot(x - cx, z - cz) > road.reach + 500 && !inParks(x, z)) return shade(C.forest[Math.floor(hash2(Math.round(x / 60), Math.round(z / 60)) * 3)], 0.95 + 0.1 * noise(x * 0.02, z * 0.02));
      return shade(C.meadow, 0.94 + 0.12 * noise(x * 0.01, z * 0.01));
    };
    const cell = (x0, z0, s) => {
      const c = [[x0, z0], [x0 + s, z0], [x0 + s, z0 + s], [x0, z0 + s]].map(([x, z]) => [x, land.height(x, z), z]);
      const col = colourAt(x0 + s / 2, z0 + s / 2);
      B.tri3(c[0], c[1], c[2], col, UP); B.tri3(c[0], c[2], c[3], col, UP);
    };
    // fine cells over the place itself (finer where the land has relief), 160 m cells beyond
    const fine = land.real ? 32 : 40, big = 160, snap = v => Math.round(v / big) * big, pad = land.real ? 640 : 800;
    const x0 = snap(road.bounds[0] - pad), z0 = snap(road.bounds[1] - pad), x1 = snap(road.bounds[2] + pad), z1 = snap(road.bounds[3] + pad);
    for (let x = x0; x < x1; x += fine) for (let z = z0; z < z1; z += fine) cell(x, z, fine);
    const ox = snap(cx), oz = snap(cz), E = snap(land.edge);
    for (let x = ox - E; x < ox + E; x += big) for (let z = oz - E; z < oz + E; z += big) if (x < x0 || x >= x1 || z < z0 || z >= z1) cell(x, z, big);

    // what lies on the land: draped over it where it is not level
    const on = lift => (land.real ? (x, z) => land.height(x, z) + lift : GROUND + lift), step = land.real ? 12 : 0;
    if (!land.real) for (const p of data.parks) flat(B, p, GROUND + PARK_Y, shade(C.park, 0.92 + 0.16 * hash2(p[0][0], p[0][1])));
    for (const w of data.water) { if (w.area) flat(B, w.area, on(WATER_Y), C.water); else ribbon(B, w.line, w.width, on(WATER_Y), C.water, step); }
    for (const s of data.streets) { if (s.area) flat(B, s.area, on(STREET_Y), C.square); else ribbon(B, s.line, s.width, on(STREET_Y), C.street, step); }
    for (const r of data.rails) ribbon(B, r, 3.4, on(RAIL_Y), C.rail, step);
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
      P.forEach((a, i) => { const b = P[(i + 1) % P.length], out = ccw ? [b[1] - a[1], 0.5, -(b[0] - a[0])] : [-(b[1] - a[1]), 0.5, b[0] - a[0]]; B.tri3([a[0], y0, a[1]], [b[0], y0, b[1]], apex, shade(col, 0.92 + 0.16 * (i % 2)), out); });
    };
    // a tower: round or square shaft, then a pointed roof, a flat top or a spire of its own
    const tower = (x, z, base, t) => {
      const sides = t.shape === 'round' ? 10 : 4, turn = t.shape === 'round' ? 0 : Math.PI / 4 + (t.turn || 0), top = base + t.height;
      prism(circle(x, z, t.radius, sides, turn), base - 3, top, t.wall, t.flatTop || null);
      if (t.roof) cone(circle(x, z, t.radius * 1.1, sides, turn), top, [x, top + t.roof, z], t.top);
      if (t.spire) cone(circle(x, z, t.spire.radius, t.spire.sides || 8, 0.4), top, [x, top + t.spire.height, z], t.spire.wall);
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
    // a faceted ball (icosahedron), for the crowns of the plane trees
    const ball = (x, y, z, rx, ry, rz, cols, rnd) => {
      const v = ICO.v.map(p => { const k = 0.91 + rnd() * 0.18; return [x + p[0] * rx * k, y + p[1] * ry * k, z + p[2] * rz * k]; });
      ICO.f.forEach((f, i) => {
        const a = v[f[0]], b = v[f[1]], c = v[f[2]], m = [(a[0] + b[0] + c[0]) / 3 - x, (a[1] + b[1] + c[1]) / 3 - y, (a[2] + b[2] + c[2]) / 3 - z];
        B.tri3(a, b, c, shade(cols[i % cols.length], m[1] > 0 ? 1.12 : 0.96), m);
      });
    };
    // a plane tree of the boulevards: a pale trunk and a round crown
    const planeTree = (x, z, y, rnd) => {
      const h = 4.6 + rnd() * 1.4, r = 3.4 + rnd() * 1.2, col = C.leaves[Math.floor(rnd() * C.leaves.length)];
      prism(circle(x, z, 0.32, 5, rnd() * 6), y - 0.5, y + h + r * 0.4, [0.62, 0.58, 0.48], null);
      ball(x, y + h + r * 0.75, z, r, r * 0.85, r, [col, shade(col, 0.94), shade(col, 1.05)], rnd);
    };
    // a street lamp: a pole, an arm over the road (ux, uz) and its lantern
    const lamp = (x, z, y, ux, uz) => {
      const H = 7.5, hx = x + ux * 1.6, hz = z + uz * 1.6;
      prism(circle(x, z, 0.13, 4), y - 0.3, y + H, C.lamp, C.lamp);
      prism([[x - uz * 0.08, z + ux * 0.08], [hx - uz * 0.08, hz + ux * 0.08], [hx + uz * 0.08, hz - ux * 0.08], [x + uz * 0.08, z - ux * 0.08]], y + H - 0.25, y + H - 0.1, C.lamp, C.lamp);
      prism(circle(hx, hz, 0.32, 4), y + H - 0.75, y + H - 0.25, C.lampGlass, C.lamp);
    };
    return { prism, circle, cone, tower, tree, fir, ball, planeTree, lamp };
  }
  const ICO = (() => {
    const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(p => { const l = Math.hypot(...p); return p.map(c => c / l); });
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    return { v, f };
  })();

  // ------------------------------------------------------------------ buildings
  // A building on its footprint: walls, windows near the road, and a hipped tiled roof (the footprint
  // shrunk towards its middle and raised) or a flat one for the big sheds and blocks.
  function building(B, P, o) {
    const ccw = signedArea(P) > 0, c = centroid(P), y0 = o.base, y1 = y0 + o.height;
    const outward = (a, b) => (ccw ? [b[1] - a[1], 0, -(b[0] - a[0])] : [-(b[1] - a[1]), 0, b[0] - a[0]]);
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length], out = outward(a, b), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      B.quad([a[0], y0 - o.foot, a[1]], [b[0], y0 - o.foot, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], shade(o.wall, 0.94 + 0.12 * hash2(a[0], b[1])), out);
      if (!o.windows || l < 4.5) return;
      const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l, nx = out[0] / l * 0.07, nz = out[2] / l * 0.07;
      const count = Math.max(1, Math.floor(l / (o.bay || 3.1))), floors = Math.max(1, Math.round(o.height / (o.storey || FLOOR))), fh = o.height / floors;
      const w = Math.min(o.windowWidth || 1.0, l / count - 0.5), wh = Math.min(o.windowHeight || 1.6, fh - 0.9);
      for (let f = 0; f < floors; f++) for (let k = 0; k < count; k++) {
        const s = (k + 0.5) * l / count - w / 2, wy = y0 + f * fh + (fh - wh) * 0.55;
        const p = t => [a[0] + ux * (s + t) + nx, a[1] + uz * (s + t) + nz];
        const q0 = p(0), q1 = p(w);
        B.quad([q0[0], wy, q0[1]], [q1[0], wy, q1[1]], [q1[0], wy + wh, q1[1]], [q0[0], wy + wh, q0[1]], o.glass || C.window, out);
      }
    });
    if (o.roof === 'flat') { flat(B, P, y1, o.lid || C.flatRoof); return; }
    const k = o.ridge || 0.38, top = P.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
    const bands = o.glazed ? 6 : 1;                                      // glazed roofs are laid in bands of colour
    P.forEach((a, i) => {
      const j = (i + 1) % P.length, b = P[j], out = outward(a, b), towards = [out[0], Math.hypot(out[0], out[2]), out[2]];
      for (let s = 0; s < bands; s++) {
        const t0 = s / bands, t1 = (s + 1) / bands, at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, y1 + o.rise * t, p[1] + (q[1] - p[1]) * t];
        const col = o.glazed ? C.glazed[(s + i) % C.glazed.length] : shade(o.tiles, 0.9 + 0.2 * hash2(b[0], a[1]));
        B.quad(at(a, top[i], t0), at(b, top[j], t0), at(b, top[j], t1), at(a, top[i], t1), col, towards);
      }
    });
    flat(B, top, y1 + o.rise, o.glazed ? C.glazed[2] : shade(o.tiles, 1.05));
  }

  // ------------------------------------------------------------------ detailed buildings (the towns whose style has `rich`)
  // The footprint drawn in by d metres from every side (each corner moved along its bisector), or null where it is
  // too narrow for that: an edge would turn over, or two edges cross.
  function insetBy(P, d) {
    const n = P.length, s = signedArea(P) > 0 ? 1 : -1, I = [];
    const inward = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l * s, (b[0] - a[0]) / l * s]; };
    for (let i = 0; i < n; i++) {
      const p = P[(i + n - 1) % n], a = P[i], b = P[(i + 1) % n], n1 = inward(p, a), n2 = inward(a, b);
      let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) { mx = n2[0]; mz = n2[1]; } else { mx /= ml; mz /= ml; }
      const k = d / Math.max(0.35, mx * n2[0] + mz * n2[1]);
      I.push([a[0] + mx * k, a[1] + mz * k]);
    }
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], c = I[i], e = I[(i + 1) % n]; if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 0) return null; }
    if (signedArea(I) * s < Math.abs(signedArea(P)) * 0.06) return null;
    if (n <= 64) {
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = I[i], b = I[(i + 1) % n], c = I[j], e = I[(j + 1) % n];
        if (cross(a, b, c) * cross(a, b, e) < 0 && cross(c, e, a) * cross(c, e, b) < 0) return null;
      }
    }
    return I;
  }

  // A building of the town, in detail. o.look says how its fronts are dressed; o.rich carries the road (to know
  // which fronts are seen from it), the level of detail (2: everything, 1: windows and cornices, 0: plain walls),
  // the props and the random generator.
  //   walls       windows on every floor (sills, shutters), a door or a shop with its sign and awning on the ground
  //               floor, a string course over it, balconies on the 2nd and top floors of the stone buildings, a cornice
  //   roof        hipped (tiles) or mansard (slate, zinc on top, dormers), drawn in from the footprint whatever its
  //               shape; chimneys on the tiled ones; flat for the large halls
  function richBuilding(B, P, o) {
    const R = o.rich, L = o.look, X = R.X, rnd = R.rnd, ccw = signedArea(P) > 0, y0 = o.base, y1 = y0 + o.height;
    const floors = Math.max(1, Math.round(o.height / FLOOR)), fh = o.height / floors, edges = [];
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.05) { edges.push(null); return; }
      const ex = (b[0] - a[0]) / l, ez = (b[1] - a[1]) / l, ox = ccw ? ez : -ez, oz = ccw ? -ex : ex, out = [ox, 0, oz];
      B.quad([a[0], y0 - o.foot, a[1]], [b[0], y0 - o.foot, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], shade(o.wall, 0.94 + 0.12 * hash2(a[0], b[1])), out);
      const e = { a, b, l, ex, ez, ox, oz, seen: false };
      edges.push(e);
      if (!R.tier || l < 2.6) return;
      // the backs and the courtyards are not seen from the road
      let to = R.road.towards((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3);
      if (to.d === Infinity) to = R.from;
      const facing = ox * to.x + oz * to.z, full = R.tier === 2 && to.d < R.near;
      if (facing < (to.d < 45 ? -0.6 : full ? -0.15 : 0.1)) return;
      e.seen = true;
      e.full = full;
      const at = (t, y, off) => [a[0] + ex * t + ox * off, y, a[1] + ez * t + oz * off];
      const face = (t0, t1, ya, yb, col, off) => B.quad(at(t0, ya, off), at(t1, ya, off), at(t1, yb, off), at(t0, yb, off), col, out);
      const slab = (t0, t1, y, d0, d1, col) => {
        B.quad(at(t0, y, d0), at(t1, y, d0), at(t1, y, d1), at(t0, y, d1), col, UP);
        B.quad(at(t0, y - 0.15, d0), at(t1, y - 0.15, d0), at(t1, y - 0.15, d1), at(t0, y - 0.15, d1), shade(col, 0.7), [0, -1, 0]);
      };
      // ground floor: a shop where the front faces the road close by
      let first = 0;
      if (full && L.shops && to.d < 55 && facing > 0.35 && l > 5 && fh > 2.9 && rnd() < 0.85) {
        const top = y0 + Math.min(2.8, fh - 0.4);
        face(0.5, l - 0.5, y0 + 0.15, top, C.glass, 0.1);
        face(0.35, l - 0.35, top + 0.05, top + 0.42, C.signs[Math.floor(rnd() * C.signs.length)], 0.16);
        if (rnd() < 0.55) {
          const col = C.awnings[Math.floor(rnd() * C.awnings.length)], ya = top + 0.2, t0 = 0.4, t1 = Math.min(l - 0.4, 0.4 + 12);
          B.quad(at(t0, ya, 0.18), at(t1, ya, 0.18), at(t1, ya - 0.6, 1.6), at(t0, ya - 0.6, 1.6), col, [ox, 1, oz]);
          B.quad(at(t0, ya, 0.18), at(t1, ya, 0.18), at(t1, ya - 0.6, 1.6), at(t0, ya - 0.6, 1.6), shade(col, 0.6), [-ox, -1, -oz]);
          face(t0, t1, ya - 0.95, ya - 0.6, shade(col, 0.9), 1.6);
        }
        first = 1;
      }
      const count = Math.max(1, Math.floor((l - 0.6) / L.bay)), step = l / count, w = Math.min(L.windowWidth, step - 0.7);
      e.count = count; e.step = step;
      if (!full && w >= 0.5 && floors >= 2) {
        // seen from afar: a column of glass in every bay, the floors drawn across it in the wall's colour (as Monaco's towers)
        const wh = Math.min(L.windowHeight, fh - 1.1), gap = (fh - wh) / 2;
        if (wh >= 0.6) {
          for (let k = 0; k < count; k++) { const t = (k + 0.5) * step - w / 2; face(t, t + w, y0 + gap, y1 - gap, L.glass, 0.06); }
          for (let f = 1; f < floors; f++) face(0, l, y0 + f * fh - gap, y0 + f * fh + gap, shade(o.wall, 0.97), 0.1);
        }
      } else if (w >= 0.5) for (let f = first; f < floors; f++) {
        const fy = y0 + f * fh, wh = Math.min(L.windowHeight, fh - 1.1), wy = fy + Math.max(0.5, (fh - wh) * 0.5);
        if (wh < 0.6) break;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) * step - w / 2;
          if (f === 0 && full && k === count >> 1) { face(t - 0.1, t + w + 0.1, fy, fy + Math.min(2.5, fh - 0.4), C.door, 0.06); continue; }
          face(t, t + w, wy, wy + wh, L.glass, 0.06);
          if (!full) continue;
          if (to.d < 60) face(t - 0.12, t + w + 0.12, wy - 0.2, wy, L.sill, 0.14);
          if (L.shutter && step - w > 1.25) { face(t - 0.58, t - 0.06, wy, wy + wh, L.shutter, 0.1); face(t + w + 0.06, t + w + 0.58, wy, wy + wh, L.shutter, 0.1); }
        }
        if (full && L.balconies && floors >= 4 && f >= 1 && (f === 2 || f === floors - 1) && l > 3) {
          slab(0.2, l - 0.2, fy + 0.15, 0.05, 0.75, L.sill);                   // the balcony, its railing: a band of ironwork and a handrail
          face(0.2, l - 0.2, fy + 0.15, fy + 0.45, C.ironwork, 0.75);
          face(0.2, l - 0.2, fy + 0.92, fy + 1.02, C.ironwork, 0.75);
        }
      }
      if (full && floors >= 2) face(0, l, y0 + fh - 0.1, y0 + fh + 0.2, L.band, 0.12);   // string course over the ground floor
      face(0, l, y1 - 0.55, y1, L.band, 0.3);                                     // cornice
    });

    if (o.roof === 'flat') { flat(B, P, y1, o.lid || C.flatRoof); return; }
    const area = Math.abs(signedArea(P)), mansard = o.roof === 'mansard';
    let d = mansard ? 2.4 : clamp(Math.sqrt(area) * 0.3, 1.6, 6), I = null;
    for (let k = 0; k < 4 && !I; k++) { I = insetBy(P, d); if (!I) d *= 0.6; }
    if (!I) { flat(B, P, y1, shade(o.tiles, 0.9)); return; }                     // too thin for a roof: a terrace
    const rise = mansard ? d * 1.75 : Math.min(7, d * o.pitch), top = y1 + rise, bands = o.glazed ? 4 : 1;
    P.forEach((a, i) => {
      const e = edges[i]; if (!e) return;
      const j = (i + 1) % P.length, b = P[j], towards = [e.ox, mansard ? 0.6 : 1, e.oz];
      for (let s = 0; s < bands; s++) {
        const t0 = s / bands, t1 = (s + 1) / bands, on = (p, q, t) => [p[0] + (q[0] - p[0]) * t, y1 + rise * t, p[1] + (q[1] - p[1]) * t];
        const col = o.glazed ? C.glazed[(s + i) % C.glazed.length] : shade(o.tiles, 0.9 + 0.2 * hash2(b[0], a[1]));
        B.quad(on(a, I[i], t0), on(b, I[j], t0), on(b, I[j], t1), on(a, I[i], t1), col, towards);
      }
      // dormers on the fronts seen from the road, one over every window (every other one on a house)
      if (!e.full || !L.dormers || rise < 2.6 || e.l < 4.5) return;
      const F = (t, s) => { const u = t / e.l, ix = I[i][0] + (I[j][0] - I[i][0]) * u, iz = I[i][1] + (I[j][1] - I[i][1]) * u, bx = a[0] + e.ex * t, bz = a[1] + e.ez * t; return [bx + (ix - bx) * s, y1 + rise * s, bz + (iz - bz) * s]; };
      const up = (p, h) => [p[0], p[1] + h, p[2]], fwd = (p, k) => [p[0] + e.ox * k, p[1], p[2] + e.oz * k];
      const s0 = 0.12, s1 = s0 + 1.4 / rise, sp = s0 + 2.0 / rise;
      if (sp > 0.95) return;
      for (let k = 0; k < e.count; k += L.dormerEvery) {
        const tc = (k + 0.5) * e.step; if (tc < 1 || tc > e.l - 1) continue;
        const BL = F(tc - 0.6, s0), BR = F(tc + 0.6, s0), TL = up(BL, 1.4), TR = up(BR, 1.4), PF = up([(TL[0] + TR[0]) / 2, TL[1], (TL[2] + TR[2]) / 2], 0.6);
        const KL = F(tc - 0.6, s1), KR = F(tc + 0.6, s1), PB = F(tc, sp), out = [e.ox, 0, e.oz];
        B.quad(BL, BR, TR, TL, o.dormer, out); B.tri3(TL, TR, PF, o.dormer, out);
        const WL = fwd(F(tc - 0.38, s0), 0.04), WR = fwd(F(tc + 0.38, s0), 0.04);
        B.quad(up(WL, 0.25), up(WR, 0.25), up(WR, 1.2), up(WL, 1.2), L.glass, out);
        B.tri3(BL, TL, KL, shade(o.dormer, 0.85), [-e.ex, 0, -e.ez]); B.tri3(BR, TR, KR, shade(o.dormer, 0.85), [e.ex, 0, e.ez]);
        B.quad(TL, PF, PB, KL, o.dormerRoof, [e.ox - e.ex, 1, e.oz - e.ez]); B.quad(TR, PF, PB, KR, o.dormerRoof, [e.ox + e.ex, 1, e.oz + e.ez]);
      }
    });
    flat(B, I, top, mansard ? C.zinc : o.glazed ? C.glazed[2] : shade(o.tiles, 1.05));
    // chimneys on the tiled roofs
    if (o.chimneys && R.tier) {
      const c = centroid(I);
      for (let k = 0, n = area > 220 ? 2 : 1; k < n; k++) {
        const p = I[Math.floor(rnd() * I.length)], x = p[0] + (c[0] - p[0]) * 0.3, z = p[1] + (c[1] - p[1]) * 0.3;
        if (!inPoly(x, z, I)) continue;
        X.prism(X.circle(x, z, 0.5, 4, Math.atan2(edges[0] ? edges[0].ez : 0, edges[0] ? edges[0].ex : 1) + Math.PI / 4), top - 0.4, top + 1.2 + rnd() * 0.7, C.chimney, shade(C.chimney, 0.6));
      }
    }
  }

  // ------------------------------------------------------------------ the town
  function town(B, road, data, land, style, inWoods, rnd) {
    const X = Props(B), stats = { buildings: 0, detailed: 0, trees: 0, firs: 0, stands: 0 };
    const same = (a, b) => Array.isArray(b) && a.length === b.length && a[0][0] === b[0][0] && a[0][1] === b[0][1];
    const L = data.landmarks || {}, special = style.landmarks(L);
    const west = data.north ? [data.north[1], -data.north[0]] : [-1, 0];

    // ---- Montbéliard: the castle's rock, a faceted mound under the castle, kept off the road
    let rock = null;
    if (style.rock && Array.isArray(L[style.rock])) {
      const P = L[style.rock], c = centroid(P), reach = Math.max(...P.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])));
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
    // where things stand: on the land, on the rock, or nowhere (the rock's slope)
    const baseAt = (x, z) => {
      if (rock != null) { const d = Math.hypot(x - rock.c[0], z - rock.c[1]); if (d < rock.upper) return ROCK_HEIGHT; if (d < rock.foot) return null; }
      return land.height(x, z);
    };
    const foot = land.real ? 4 : 0;                                      // walls go down into sloping land

    // a gate: two piers and a lintel, across the nearest stretch of road
    const arch = (at, base, a) => {
      const f = road.frame(road.nearest(at[0], at[1])), ux = f.n[0], uz = f.n[1], vx = f.t[0], vz = f.t[1];
      const box = (u0, u1, y0, y1) => X.prism([[u0, -a.depth / 2], [u1, -a.depth / 2], [u1, a.depth / 2], [u0, a.depth / 2]].map(([u, v]) => [at[0] + ux * u + vx * v, at[1] + uz * u + vz * v]), y0, y1, a.wall, a.wall);
      box(-a.width / 2, -a.width / 4, base, base + a.height); box(a.width / 4, a.width / 2, base, base + a.height); box(-a.width / 4, a.width / 4, base + a.height * 0.62, base + a.height);
    };

    // ---- detailed towns: what each building is, and how much of it is drawn
    const rich = style.rich;
    const richStyle = (P, c, area, h, floors, b) => {
      const R = rich, from = road.towards(c[0], c[1], 6), d = from.d;
      const tier = d < R.near ? 2 : d < R.far ? 1 : 0;
      // the blocks of the old town come as one footprint for several houses: as tall as a house, not a shed
      if (!b.levels && !b.height && area >= 2500 && area < R.plainArea) floors = 3 + Math.floor(h * 2) + style.floors;
      const pick = (list, k) => list[Math.floor(hash2(c[0] * k, c[1] * (k + 0.3)) * list.length) % list.length];
      const kind = area >= R.plainArea ? 'plain' : floors >= 4 && hash2(c[1] * 0.53, c[0] * 0.61) < R.stoneShare ? 'stone' : 'house';
      const o = { height: clamp(floors, 1, 30) * FLOOR + 0.6, rich: { tier, road, from, near: R.near, X, rnd } };
      if (kind === 'plain') {
        const wall = PLAIN[Math.floor(h * 3)];
        return Object.assign(o, { wall, roof: 'flat', look: { glass: C.glass, sill: shade(wall, 1.05), band: shade(wall, 0.9), bay: 3.4, windowWidth: 2.0, windowHeight: 1.5, shops: true } });
      }
      if (kind === 'stone') {
        const wall = pick(R.stone, 0.71);
        return Object.assign(o, { wall, roof: 'mansard', tiles: pick([C.slate, [0.34, 0.36, 0.41], [0.28, 0.30, 0.34]], 0.37), dormer: shade(wall, 1.02), dormerRoof: C.slate,
          look: { glass: C.pane, sill: shade(wall, 1.07), band: shade(wall, 1.08), bay: 3.0, windowWidth: 1.25, windowHeight: 2.1, balconies: true, shops: true, dormers: true, dormerEvery: 1 } });
      }
      const wall = style.walls[Math.floor(hash2(c[1] * 0.9, c[0] * 0.7) * style.walls.length)], tiles = style.tiles[Math.floor(h * style.tiles.length)];
      return Object.assign(o, { wall, roof: 'hip', tiles, pitch: style.steep / 0.3, glazed: hash2(c[0] * 0.13, c[1] * 0.17) < R.glazed, chimneys: true, dormer: shade(wall, 1.02), dormerRoof: tiles,
        look: { glass: C.pane, sill: [0.86, 0.82, 0.74], band: shade(wall, 1.08), bay: 2.9, windowWidth: 1.05, windowHeight: 1.65, shops: true,
          shutter: hash2(c[0] * 0.29, c[1] * 0.31) < 0.7 ? pick(C.shutters, 0.43) : null, dormers: hash2(c[0] * 0.47, c[1] * 0.19) < 0.4, dormerEvery: 2 } });
    };

    // ---- buildings
    for (const b of data.buildings) {
      const P = b.p, c = centroid(P), area = Math.abs(signedArea(P)), base = baseAt(c[0], c[1]);
      if (base == null) continue;
      const h = hash2(c[0] * 0.37, c[1] * 0.41), near = road.dist(c[0], c[1]) < style.detail;
      let key = Object.keys(special).find(k => same(P, L[k]));
      // a tower or a gate the map has as a footprint of its own: it is built on it, in place of a house
      if (key && (special[key].tower || special[key].arch)) { if (special[key].tower) X.tower(c[0], c[1], base, special[key].tower); else arch(c, base, special[key].arch); continue; }
      let o;
      if (key) o = { ...special[key] };
      else if (b.kind === 'stand') o = { height: b.height || 8, wall: C.standFrame, roof: 'flat', lid: C.seats[Math.floor(h * 2)] };   // a grandstand: its seats seen from above
      else {
        const guess = (area < 70 ? 2 : area < 260 ? 2 + Math.floor(h * 2.2) : area < 900 ? 3 + Math.floor(h * 2) : area < 2500 ? 2 + Math.floor(h * 3) : 2) + (area >= 70 && area < 2500 ? style.floors : 0);
        const floors = b.levels || (b.height ? Math.round(b.height / FLOOR) : guess);
        const big = area >= 1100 || P.length > 14;
        o = { height: clamp(floors, 1, 30) * FLOOR + 0.6, wall: big ? PLAIN[Math.floor(h * 3)] : style.walls[Math.floor(hash2(c[1] * 0.9, c[0] * 0.7) * style.walls.length)],
          roof: big ? 'flat' : 'hip', tiles: style.tiles[Math.floor(h * style.tiles.length)], rise: clamp(Math.sqrt(area) * style.steep, 1.8, 3.5 + 12 * style.steep), windows: near };
        if (b.kind === 'worship') Object.assign(o, { height: 12, wall: C.stone, roof: 'hip', rise: 5, tiles: C.slate });
        if (b.kind === 'station') Object.assign(o, { height: 9, wall: C.stone, roof: 'hip', rise: 3, tiles: C.slate, windows: true });
        if (rich && !b.kind) o = richStyle(P, c, area, h, floors, b);
      }
      o.base = base; o.foot = foot;
      if (o.look) richBuilding(B, P, o);
      else building(B, P, o);
      stats.buildings++; if (o.windows || (o.rich && o.rich.tier)) stats.detailed++;
      if (o.fleche) { const f = o.fleche; X.cone(X.circle(c[0], c[1], f.radius, 8), base + o.height + o.rise, [c[0], base + f.height, c[1]], f.wall); }
      const t = o.towers;
      if (t) {
        // the two ends of the footprint's long side; a church has its towers at one end, or one tower in the west
        let far = [0, 1], d = 0;
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const q = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]); if (q > d) { d = q; far = [i, j]; } }
        let spots;
        if (t.at === 'centre') spots = [c];
        else if (t.at === 'west') { let best = P[0]; for (const p of P) if (p[0] * west[0] + p[1] * west[1] > best[0] * west[0] + best[1] * west[1]) best = p; spots = [[best[0] + (c[0] - best[0]) * 0.22, best[1] + (c[1] - best[1]) * 0.22]]; }
        else {
          const ends = t.at === 'ends' ? far.map(i => P[i]) : (() => {
            const a = P[far[0]], next = P[(far[0] + 1) % P.length], prev = P[(far[0] + P.length - 1) % P.length];
            return [a, Math.hypot(next[0] - a[0], next[1] - a[1]) < Math.hypot(prev[0] - a[0], prev[1] - a[1]) ? next : prev];
          })();
          spots = ends.map(e => [e[0] + (c[0] - e[0]) * 0.12, e[1] + (c[1] - e[1]) * 0.12]);
        }
        for (const s of spots) X.tower(s[0], s[1], base, t);
      }
    }
    // ---- landmarks the map only has as a point
    for (const [key, o] of Object.entries(special)) {
      const at = L[key] && !Array.isArray(L[key]) && L[key].at; if (!at) continue;
      const base = baseAt(at[0], at[1]); if (base == null) continue;
      if (o.tower) X.tower(at[0], at[1], base, o.tower);
      if (o.arch) arch(at, base, o.arch);
    }

    // ---- who stands where: a coarse map of the buildings, for whatever is planted afterwards
    const CELL = 24, grid = new Map();
    for (const b of data.buildings) {
      const [x0, z0, x1, z1] = boundsOf(b.p);
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b.p); }
    }
    const built = (x, z, margin = 0) => {
      for (let i = Math.floor((x - margin) / CELL); i <= Math.floor((x + margin) / CELL); i++) for (let j = Math.floor((z - margin) / CELL); j <= Math.floor((z + margin) / CELL); j++)
        for (const P of grid.get(i + ',' + j) || []) { if (inPoly(x, z, P)) return true; if (margin > 0) for (const q of P) if (Math.hypot(q[0] - x, q[1] - z) < margin) return true; }
      return false;
    };
    const waterAreas = Areas(data.water.filter(w => w.area).map(w => w.area)), waterLines = data.water.filter(w => w.line);
    const wet = (x, z) => waterAreas(x, z) || waterLines.some(w => w.line.some(q => Math.hypot(q[0] - x, q[1] - z) < w.width / 2 + 3));
    const onStreet = (x, z) => data.streets.some(s => s.line && s.line.some(q => Math.hypot(q[0] - x, q[1] - z) < s.width / 2 + 2));

    // ---- trees: in the parks, along the wide rivers; forests where the map has them; firs on the invented hills
    const plant = (x, z, size) => { if (road.dist(x, z) < 13 || built(x, z, 2.5) || wet(x, z)) return; const y = baseAt(x, z); if (y == null) return; X.tree(x, z, y, size, rnd); stats.trees++; };
    if (!land.real) for (const p of data.parks) {
      const [x0, z0, x1, z1] = boundsOf(p);
      for (let x = x0; x <= x1; x += 11) for (let z = z0; z <= z1; z += 11) { const tx = x + (rnd() - 0.5) * 7, tz = z + (rnd() - 0.5) * 7; if (rnd() < 0.7 && inPoly(tx, tz, p)) plant(tx, tz, 6.5); }
    }
    for (const w of data.water) if (w.line && w.width >= 15) for (let i = 0; i + 1 < w.line.length; i++) {
      const a = w.line[i], b = w.line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1) continue;
      for (let s = rnd() * 16; s < l; s += 16) for (const side of [-1, 1]) { const o = side * (w.width / 2 + 5 + rnd() * 3); plant(a[0] + (b[0] - a[0]) * s / l - (b[1] - a[1]) / l * o, a[1] + (b[1] - a[1]) * s / l + (b[0] - a[0]) / l * o, 7.5); }
    }
    for (const p of data.woods || []) {
      const [x0, z0, x1, z1] = boundsOf(p), gap = 15;
      for (let x = x0; x <= x1 && stats.firs < 30000; x += gap) for (let z = z0; z <= z1; z += gap) {
        const tx = x + (rnd() - 0.5) * 11, tz = z + (rnd() - 0.5) * 11;
        if (!inPoly(tx, tz, p) || road.dist(tx, tz) < 17 || built(tx, tz, 3) || onStreet(tx, tz)) continue;
        X.fir(tx, tz, land.height(tx, tz) - 0.5, 12 + rnd() * 10, rnd); stats.firs++;
      }
    }
    if (!land.real && style.hills > 0) {
      const [cx, cz] = road.centre;
      for (let k = 0; k < 2600; k++) {
        const a = rnd() * 2 * Math.PI, r = land.hillsFrom + 150 + rnd() * rnd() * 1500, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = land.hill(x, z);
        if (h > 5) { X.fir(x, z, GROUND + h - 0.5, 11 + rnd() * 9, rnd); stats.firs++; }
      }
    }

    // ---- lines painted across the road: start, checkpoints, finish. They follow the road exactly; the track
    // parts keep their own copy under the asphalt (tools/make_circuit.js)
    const across = (i, depth, along, col, lanes) => {
      const f = road.frame(i), g = road.frame((i + 1) % road.n), [x, z, y, left, right] = f.p, Y = y + 0.03, slope = (g.p[2] - y) / (Math.hypot(g.p[0] - x, g.p[1] - z) || 1);
      const at = (u, v) => [x + f.n[0] * u + f.t[0] * v, Y + slope * v, z + f.n[1] * u + f.t[1] * v];
      const n = lanes || 1, w = (left + right) / n;
      for (let k = 0; k < n; k++) { const u0 = -right + k * w, u1 = u0 + w; B.quad(at(u0, along), at(u1, along), at(u1, along + depth), at(u0, along + depth), typeof col === 'function' ? col(k) : col, UP); }
    };
    const gateIndex = g => road.nearest(g.gx * 5, g.gz * 5);
    across(0, 0.6, -0.3, C.startLine);
    for (const g of data.checkpoints) across(gateIndex(g), 1.0, -0.5, C.checkpoint);
    { const i = gateIndex(data.finish); for (let r = 0; r < 2; r++) across(i, 0.9, r * 0.9 - 0.9, k => ((k + r) % 2 ? C.startLine : C.black), 10); }

    // ---- grandstands, where the place leaves room beside a straight
    const stand = (x, z, y, ux, uz, nx, nz) => {                         // 26 m long, six rows rising away from the road
      const floor = Math.min(y + GROUND, land.height(x + nx * 6, z + nz * 6)) - 1;
      for (let r = 0; r < 6; r++) {
        const d0 = r * 1.1, d1 = d0 + 1.1, y1 = y + 1.2 + r * 0.75, col = C.seats[r % 2];
        const p = (s, d) => [x + ux * s + nx * d, z + uz * s + nz * d];
        const a = p(-13, d0), b = p(13, d0), c = p(13, d1), e = p(-13, d1);
        B.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [e[0], y1, e[1]], col, UP);
        B.quad([a[0], r === 0 ? floor : y1 - 0.75, a[1]], [b[0], r === 0 ? floor : y1 - 0.75, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], r === 0 ? C.standFrame : shade(col, 0.8), [-nx, 0, -nz]);
      }
      const back = [x + nx * 6.6, z + nz * 6.6];
      B.quad([back[0] - ux * 13, floor, back[1] - uz * 13], [back[0] + ux * 13, floor, back[1] + uz * 13], [back[0] + ux * 13, y + 6, back[1] + uz * 13], [back[0] - ux * 13, y + 6, back[1] - uz * 13], C.standFrame, [nx, 0, nz]);
    };
    let lastStand = -100;
    const stands = [];                                                   // [x, z, ux, uz] of each one's middle
    const most = Math.max(8, Math.round(road.n / 90));
    for (let i = 10; i < road.n && stats.stands < most; i += 6) {
      if (i - lastStand < 40) continue;
      const f = road.frame(i), before = road.frame((i - 5 + road.n) % road.n), after = road.frame((i + 5) % road.n);
      if (before.t[0] * after.t[0] + before.t[1] * after.t[1] < 0.995 || Math.abs(after.p[2] - before.p[2]) > 1.2) continue;   // on the level straights only
      for (const side of [1, -1]) {
        const off = (side > 0 ? f.p[3] : f.p[4]) + 5.5, nx = f.n[0] * side, nz = f.n[1] * side, x = f.p[0] + nx * off, z = f.p[1] + nz * off;
        let free = true;
        for (let s = -13; s <= 13 && free; s += 6.5) for (let d = 0; d <= 7 && free; d += 3.5) { const px = x + f.t[0] * s + nx * d, pz = z + f.t[1] * s + nz * d; if (built(px, pz, 2) || wet(px, pz) || road.dist(px, pz) < off - 6.5 || baseAt(px, pz) == null || (rock && baseAt(px, pz) === ROCK_HEIGHT) || inWoods(px, pz)) free = false; }
        if (!free) continue;
        stand(x, z, f.p[2], f.t[0], f.t[1], nx, nz); stats.stands++; lastStand = i; stands.push([x + nx * 3.3, z + nz * 3.3, f.t[0], f.t[1]]); break;
      }
    }

    // ---- detailed towns: plane trees and lamps along the road, where the pavement is free
    if (rich) {
      const inStand = (x, z) => stands.some(([sx, sz, ux, uz]) => Math.abs((x - sx) * ux + (z - sz) * uz) < 15.5 && Math.abs(-(x - sx) * uz + (z - sz) * ux) < 6);
      // a street crossing the road (not one running along it, which the road was laid on)
      const crossing = (x, z, tx, tz) => data.streets.some(s => s.line && s.line.some((q, k) => {
        const r = s.line[k + 1]; if (!r) return false;
        const lx = r[0] - q[0], lz = r[1] - q[1], l2 = lx * lx + lz * lz; if (l2 < 0.01) return false;
        const u = clamp(((x - q[0]) * lx + (z - q[1]) * lz) / l2, 0, 1), d = Math.hypot(q[0] + lx * u - x, q[1] + lz * u - z);
        return d < s.width / 2 + 2 && Math.abs(lx * tx + lz * tz) / Math.sqrt(l2) < 0.75;
      }));
      const spot = (i, side, extra, margin) => {
        const f = road.frame(i), edge = side > 0 ? f.p[3] : f.p[4], off = edge + extra, nx = f.n[0] * side, nz = f.n[1] * side, x = f.p[0] + nx * off, z = f.p[1] + nz * off;
        if (road.dist(x, z) < off - 1 || built(x, z, margin) || wet(x, z) || inStand(x, z) || crossing(x, z, f.t[0], f.t[1])) return null;
        const y = baseAt(x, z); return y == null ? null : { x, z, y, nx, nz };
      };
      for (let i = 0; i < road.n; i += rich.trees) for (const side of [1, -1]) {
        const s = spot(i, side, 5.5, 3); if (!s) continue;
        X.planeTree(s.x, s.z, s.y, rnd); stats.trees++;
      }
      for (let i = Math.floor(rich.lamps / 2), k = 0; i < road.n; i += rich.lamps, k++) {
        const side = k % 2 ? 1 : -1, s = spot(i, side, 2.4, 1.5); if (!s) continue;
        X.lamp(s.x, s.z, s.y, -s.nx, -s.nz); stats.lamps = (stats.lamps || 0) + 1;
      }
    }
    return stats;
  }

  // ------------------------------------------------------------------ entry point
  function build(data) {
    const style = STYLES[data.town] || STYLES.montbeliard;
    const road = circuit(data), rnd = random(style.seed), land = Land(road, data, style), inWoods = Areas(data.woods || []);
    const terrain = Builder(), objects = Builder();
    ground(terrain, road, data, land, inWoods);
    const stats = town(objects, road, data, land, style, inWoods, rnd);
    return { terrain: terrain.done(), objects: objects.done(), stats };
  }

  const api = { build };
  if (typeof window !== 'undefined') window.ApexTown = api;
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
