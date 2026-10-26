// Builds the F1-style car model for the PolyTrack mod.
// Replaces the "Body" and "Suspension" meshes of the original car.glb, adds the wings (Wing0.., one mesh per
// style) and leaves everything else (collision shape, rims, exhausts) byte-for-byte untouched, so the physics
// are unchanged.
//
// Usage: node build_car.js [output.glb]
const fs = require('fs');
const path = require('path');
const { Part, sampleKeys, ring, loft, cap, box, extrude, tube, smoothPath, airfoil, wing, ellipsoid, computeNormals } = require('./meshlib');

const { APP, ORIGINALS } = require('./config');

const SRC = path.join(ORIGINALS, 'car.glb');
const OUT = process.argv[2] || path.join(APP, 'models', 'car.glb');

// Reference heights in chassis space (fixed by the game's physics)
const GROUND = -0.738;          // road surface with suspension at rest
const FRONT_AXLE_Z = 1.3478, REAR_AXLE_Z = -1.52686;
const MORPH_REST = 0.108;       // suspension morph offset at rest (influence 0.216 * 0.5)

// One Part per material
const main = new Part(), black = new Part(), frame = new Part(), helmet = new Part(), visor = new Part();
const susp = new Part();

// ---------------------------------------------------------------- Monocoque: nose, tub, gearbox
// [z, half width, top, bottom, roundness]
const tubKeys = [
  [1.97, 0.035, -0.540, -0.580, 2.2],
  [1.92, 0.062, -0.512, -0.594, 2.4],
  [1.75, 0.090, -0.458, -0.594, 2.6],
  [1.50, 0.115, -0.388, -0.580, 2.8],
  [1.20, 0.145, -0.308, -0.570, 3.0],
  [0.90, 0.185, -0.238, -0.585, 3.2],
  [0.60, 0.230, -0.182, -0.610, 3.4],
  [0.40, 0.250, -0.156, -0.620, 3.5],
  [0.00, 0.270, -0.126, -0.620, 3.5],
  [-0.30, 0.275, -0.110, -0.620, 3.5],
  [-0.60, 0.270, -0.130, -0.620, 3.2],
  [-0.95, 0.235, -0.200, -0.610, 3.0],
  [-1.30, 0.170, -0.280, -0.570, 2.8],
  [-1.55, 0.125, -0.305, -0.500, 2.5],
  [-1.72, 0.100, -0.315, -0.445, 2.2],
];
const COCKPIT_FRONT = 0.40, COCKPIT_REAR = -0.265, COCKPIT_FLOOR = -0.31;
const N = 36, RIM_K = 3;
const tubZ = [];
for (let z = 1.97; z > 0.44; z -= 0.05) tubZ.push(+z.toFixed(3));
tubZ.push(0.425, COCKPIT_FRONT, 0.355, 0.30, 0.24, 0.18, 0.12, 0.06, 0, -0.06, -0.12, -0.18, -0.235, COCKPIT_REAR, -0.285);
for (let z = -0.33; z > -1.71; z -= 0.055) tubZ.push(+z.toFixed(3));
tubZ.push(-1.72);
// How many ring points on each side of the centreline are sunk into the cockpit opening
const dipAt = z => (z <= 0.355 && z >= -0.235) ? 2 : (z === COCKPIT_FRONT || z === COCKPIT_REAR) ? 1 : 0;
const tubRings = tubZ.map(z => {
  const [, w, top, bot, n] = sampleKeys(tubKeys, z);
  const r = ring(z, { w, top, bot, n, N });
  const d = dipAt(z);
  if (d > 0) {
    const rimX = r[RIM_K][0] - 0.014;
    for (let k = -d; k <= d; k++) {
      const p = r[(k + N) % N];
      p[0] = d === 2 ? rimX * k / 2 : p[0];
      p[1] = COCKPIT_FLOOR;
    }
  }
  return r;
});
loft(tubRings, (i, k) => {
  const d = Math.max(dipAt(tubZ[i]), dipAt(tubZ[i + 1]));
  if (d === 0) return main;
  const kk = k > N / 2 ? k - N : k; // signed index, quad spans kk..kk+1
  return (kk >= -(d + 1) && kk + 1 <= d + 1) ? black : main;
});
cap(main, tubRings[0], true);
cap(frame, tubRings[tubRings.length - 1], false);

// ---------------------------------------------------------------- Airbox and engine cover spine
const spineKeys = [
  [-0.20, 0.085, 0.185, -0.140, 2.6],
  [-0.32, 0.100, 0.192, -0.160, 2.6],
  [-0.55, 0.115, 0.176, -0.200, 2.6],
  [-0.90, 0.100, 0.100, -0.250, 2.4],
  [-1.25, 0.065, -0.020, -0.300, 2.2],
  [-1.55, 0.036, -0.150, -0.330, 2.0],
  [-1.70, 0.022, -0.240, -0.350, 2.0],
];
const spineRings = [];
for (let z = -0.20; z > -1.705; z -= 0.05) {
  const [, w, top, bot, n] = sampleKeys(spineKeys, +z.toFixed(3));
  spineRings.push(ring(+z.toFixed(3), { w, top, bot, n, taper: 0.62, N: 28 }));
}
loft(spineRings, main);
cap(main, spineRings[0], true);
cap(main, spineRings[spineRings.length - 1], false);
// Air intake above the driver's head
cap(black, ring(-0.196, { w: 0.05, top: 0.165, bot: 0.045, n: 2.4, N: 20 }), true);
// Shark fin
extrude(main, [[-0.78, 0.09], [-0.95, 0.105], [-1.52, 0.02], [-1.60, -0.16], [-1.30, -0.10]], -0.006, 0.006, (z, y, x) => [x, y, z]);
// T-cam
box(black, 0, 0.207, -0.40, 0.032, 0.036, 0.11);

// ---------------------------------------------------------------- Sidepods
// [z, centre x, half width, top, bottom, roundness]
const podKeys = [
  [0.44, 0.400, 0.165, -0.225, -0.430, 3.0],
  [0.30, 0.415, 0.185, -0.205, -0.470, 3.2],
  [0.00, 0.425, 0.195, -0.200, -0.540, 3.4],
  [-0.40, 0.410, 0.195, -0.225, -0.600, 3.4],
  [-0.80, 0.355, 0.170, -0.300, -0.615, 3.2],
  [-1.10, 0.280, 0.130, -0.390, -0.615, 3.0],
  [-1.35, 0.200, 0.070, -0.470, -0.610, 2.6],
];
for (const side of [1, -1]) {
  const rings = [];
  for (let z = 0.44; z > -1.355; z -= 0.05) {
    const [zz, xc, w, top, bot, n] = sampleKeys(podKeys, +z.toFixed(3));
    const r = ring(zz, { w, top, bot, n, xc, N: 28 });
    rings.push(side === 1 ? r : r.map(p => [-p[0], p[1], p[2]]).reverse());
  }
  loft(rings, main);
  cap(main, rings[rings.length - 1], false);
  // Inlet: painted lip, then a recessed dark duct
  const [, xc, w, top, bot, n] = podKeys[0];
  const shrink = (s, z) => {
    const r = ring(z, { w: w * s, top: (top + bot) / 2 + (top - bot) / 2 * s, bot: (top + bot) / 2 - (top - bot) / 2 * s, n, xc, N: 28 });
    return side === 1 ? r : r.map(p => [-p[0], p[1], p[2]]).reverse();
  };
  const lip = shrink(0.80, 0.44), deep = shrink(0.74, 0.37);
  loft([lip, rings[0]], main);
  loft([deep, lip], black);
  cap(black, deep, true);
}

// ---------------------------------------------------------------- Floor and diffuser
const floorHalf = [[0.10, 1.00], [0.26, 0.92], [0.56, 0.62], [0.62, 0.40], [0.62, -0.55], [0.53, -1.00], [0.50, -1.18], [0.50, -1.30]];
const floorPoly = [...floorHalf, ...floorHalf.map(([x, z]) => [-x, z]).reverse()];
extrude(frame, floorPoly, -0.650, -0.625, (x, z, y) => [x, y, z]);
// Diffuser ramp with strakes
extrude(frame, [[-1.30, -0.650], [-1.30, -0.625], [-1.74, -0.475], [-1.74, -0.500]], -0.50, 0.50, (z, y, x) => [x, y, z]);
for (const x of [-0.494, -0.25, 0, 0.25, 0.494])
  extrude(frame, [[-1.30, -0.650], [-1.74, -0.500], [-1.74, -0.650]], x - 0.006, x + 0.006, (z, y, xx) => [xx, y, z]);
// Rear crash structure
{
  const rings = [-1.45, -1.70, -1.955].map((z, i) => ring(z, { w: [0.07, 0.055, 0.045][i], top: [-0.47, -0.475, -0.485][i], bot: [-0.585, -0.57, -0.565][i], n: 3, N: 16 }));
  loft(rings, frame);
  cap(frame, rings[2], false);
}

// ---------------------------------------------------------------- Wings (front and rear, one mesh per style)
// Each style is a mesh of its own, Wing0..: the garage's Wing tab swaps it like the exhausts (patch_bundle.js),
// so its index is saved in the car style: never reorder them (apex-rarity.js names them in this order).
// The wings take the "Wing" material: the pattern and primary colour, or a colour of their own.
// The brake lights (rain light and endplate lights) come with them, as the game lights a single material.
// Physics are untouched: the collision shape is the original one.
const plate = (part, pts, x, t = 0.006) => extrude(part, pts, x - t, x + t, (z, y, xx) => [xx, y, z]);   // pts: [z, y]
const pair = (fn, x) => { fn(x); fn(-x); };
// Elements spanning the stations given by x: f(x) -> { z, y, scale? } of the leading edge
const span = (xs, f) => xs.map(x => ({ x, ...f(x) }));
const FRONT_SPAN = [-0.78, -0.6, -0.4, -0.2, -0.08, 0.08, 0.2, 0.4, 0.6, 0.78];
const REAR_SPAN = [-0.47, -0.235, 0, 0.235, 0.47];
const lights = (light, x, y, z, h) => { pair(xx => box(light, xx, y, z, 0.014, h, 0.008), x); box(light, 0, -0.525, -1.962, 0.07, 0.07, 0.014); };
const standardFront = w => {
  // [leading edge z, y, chord, angle of attack]; flaps drop slightly towards the tips
  [[1.99, -0.625, 0.125, 3], [1.89, -0.606, 0.105, 13], [1.805, -0.578, 0.095, 24]].forEach(([z, y, chord, aoa], e) =>
    wing(w, airfoil(chord, { thickness: 0.11, camber: 0.05, aoa }), span(FRONT_SPAN, x => ({ z, y: y - e * 0.012 * (x / 0.78) ** 2 }))));
  pair(x => plate(w, [[2.00, -0.655], [2.00, -0.605], [1.90, -0.505], [1.70, -0.470], [1.70, -0.655]], x), 0.786);
};
const standardEndplates = (w, top = 0.19) => pair(x => plate(w, [[-1.50, -0.40], [-1.50, top - 0.09], [-1.58, top], [-1.97, top], [-1.97, -0.12], [-1.84, -0.40]], x), 0.476);
const beamWing = f => wing(f, airfoil(0.13, { thickness: 0.11, camber: 0.05, aoa: 15 }), span(REAR_SPAN, () => ({ z: -1.66, y: -0.29 })));
const swanNeck = (f, x = 0) => plate(f, [[-1.42, -0.26], [-1.63, 0.045], [-1.76, 0.062], [-1.60, -0.30]], x, 0.009);

const WINGS = [
  // 0 Standard: the car's own since 2.0
  ({ w, f, light }) => {
    standardFront(w);
    wing(w, airfoil(0.24, { thickness: 0.12, camber: 0.07, aoa: 12 }), span(REAR_SPAN, () => ({ z: -1.60, y: 0.035 })));
    wing(w, airfoil(0.13, { thickness: 0.11, camber: 0.06, aoa: 32 }), span(REAR_SPAN, () => ({ z: -1.835, y: 0.108 })));
    standardEndplates(w);
    beamWing(f);
    swanNeck(f);
    lights(light, 0.476, 0.02, -1.972, 0.16);
  },
  // 1 Low drag: two thin front elements, a flat rear wing with a small flap, low endplates (Monza)
  ({ w, f, light }) => {
    [[1.99, -0.628, 0.14, 2], [1.875, -0.612, 0.10, 8]].forEach(([z, y, chord, aoa]) =>
      wing(w, airfoil(chord, { thickness: 0.09, camber: 0.03, aoa }), span(FRONT_SPAN.map(x => x * 0.975), () => ({ z, y }))));
    pair(x => plate(w, [[2.00, -0.655], [2.00, -0.615], [1.86, -0.565], [1.74, -0.56], [1.74, -0.655]], x), 0.766);
    wing(w, airfoil(0.28, { thickness: 0.09, camber: 0.03, aoa: 3 }), span(REAR_SPAN, () => ({ z: -1.62, y: 0.02 })));
    wing(w, airfoil(0.07, { thickness: 0.10, camber: 0.04, aoa: 10 }), span(REAR_SPAN, () => ({ z: -1.905, y: 0.055 })));
    pair(x => plate(w, [[-1.52, -0.36], [-1.52, 0.06], [-1.60, 0.10], [-1.97, 0.10], [-1.97, -0.10], [-1.84, -0.36]], x), 0.476);
    beamWing(f);
    swanNeck(f);
    lights(light, 0.476, 0.0, -1.972, 0.12);
  },
  // 2 DRS open: the standard wings, the upper rear flap opened flat, with its actuator
  ({ w, f, light }) => {
    standardFront(w);
    wing(w, airfoil(0.24, { thickness: 0.12, camber: 0.07, aoa: 12 }), span(REAR_SPAN, () => ({ z: -1.60, y: 0.035 })));
    wing(w, airfoil(0.13, { thickness: 0.11, camber: 0.06, aoa: 1 }), span(REAR_SPAN, () => ({ z: -1.80, y: 0.165 })));
    box(f, 0, 0.115, -1.83, 0.03, 0.10, 0.035);
    standardEndplates(w);
    beamWing(f);
    swanNeck(f);
    lights(light, 0.476, 0.02, -1.972, 0.16);
  },
  // 3 High downforce: four front elements, three rear ones, tall endplates, a double beam wing (Monaco)
  ({ w, f, light }) => {
    [[1.99, -0.628, 0.12, 3], [1.895, -0.61, 0.095, 14], [1.82, -0.585, 0.085, 26], [1.755, -0.552, 0.075, 38]].forEach(([z, y, chord, aoa], e) =>
      wing(w, airfoil(chord, { thickness: 0.11, camber: 0.06, aoa }), span(FRONT_SPAN, x => ({ z, y: y - e * 0.01 * (x / 0.78) ** 2 }))));
    pair(x => plate(w, [[2.00, -0.655], [2.00, -0.595], [1.88, -0.47], [1.66, -0.43], [1.66, -0.655]], x), 0.786);
    wing(w, airfoil(0.25, { thickness: 0.12, camber: 0.08, aoa: 14 }), span(REAR_SPAN, () => ({ z: -1.58, y: 0.05 })));
    wing(w, airfoil(0.15, { thickness: 0.11, camber: 0.07, aoa: 30 }), span(REAR_SPAN, () => ({ z: -1.80, y: 0.125 })));
    wing(w, airfoil(0.10, { thickness: 0.11, camber: 0.06, aoa: 48 }), span(REAR_SPAN, () => ({ z: -1.915, y: 0.215 })));
    pair(x => plate(w, [[-1.48, -0.40], [-1.48, 0.14], [-1.56, 0.29], [-1.99, 0.29], [-1.99, -0.12], [-1.84, -0.40]], x), 0.476);
    beamWing(f);
    wing(f, airfoil(0.09, { thickness: 0.11, camber: 0.05, aoa: 30 }), span(REAR_SPAN, () => ({ z: -1.79, y: -0.255 })));
    swanNeck(f);
    lights(light, 0.476, 0.06, -1.992, 0.2);
  },
  // 4 Spoon: wings curving up towards their tips, the front ones deeper in the middle
  ({ w, f, light }) => {
    [[1.99, -0.625, 0.11, 3], [1.89, -0.606, 0.09, 13], [1.805, -0.578, 0.08, 24]].forEach(([z, y, chord, aoa]) =>
      wing(w, airfoil(chord, { thickness: 0.11, camber: 0.05, aoa }), span(FRONT_SPAN, x => ({ z, y: y + 0.035 * (x / 0.78) ** 2, scale: 1 + 0.4 * (1 - (x / 0.78) ** 2) }))));
    pair(x => plate(w, [[2.00, -0.655], [2.00, -0.57], [1.90, -0.48], [1.70, -0.45], [1.70, -0.655]], x), 0.786);
    const xs = [-0.47, -0.35, -0.235, -0.12, 0, 0.12, 0.235, 0.35, 0.47];
    wing(w, airfoil(0.24, { thickness: 0.12, camber: 0.07, aoa: 12 }), span(xs, x => ({ z: -1.60, y: 0.0 + 0.09 * (x / 0.47) ** 2 })));
    wing(w, airfoil(0.13, { thickness: 0.11, camber: 0.06, aoa: 30 }), span(xs, x => ({ z: -1.835, y: 0.075 + 0.09 * (x / 0.47) ** 2 })));
    standardEndplates(w, 0.25);
    beamWing(f);
    swanNeck(f);
    lights(light, 0.476, 0.05, -1.972, 0.2);
  },
  // 5 Seventies: a wide flat table high on two struts, a single plate at the front, square endplates
  ({ w, f, light }) => {
    wing(w, airfoil(0.26, { thickness: 0.08, camber: 0.02, aoa: 5 }), span([-0.80, -0.5, -0.2, 0.2, 0.5, 0.80], () => ({ z: 2.00, y: -0.625 })));
    pair(x => plate(w, [[2.03, -0.665], [2.03, -0.56], [1.72, -0.56], [1.72, -0.665]], x, 0.008), 0.808);
    wing(w, airfoil(0.40, { thickness: 0.07, camber: 0.02, aoa: 6 }), span([-0.56, -0.28, 0, 0.28, 0.56], () => ({ z: -1.62, y: 0.30 })));
    pair(x => plate(w, [[-1.58, 0.21], [-1.58, 0.38], [-2.06, 0.38], [-2.06, 0.21]], x, 0.008), 0.568);
    pair(x => plate(f, [[-1.52, -0.22], [-1.66, 0.31], [-1.80, 0.31], [-1.72, -0.30]], x, 0.01), 0.13);
    lights(light, 0.568, 0.29, -2.066, 0.12);
  },
  // 6 Biplane: two decks at the back, a bridge over the nose at the front
  ({ w, f, light }) => {
    standardFront(w);
    wing(w, airfoil(0.12, { thickness: 0.11, camber: 0.05, aoa: 6 }), span([-0.30, -0.15, 0, 0.15, 0.30], () => ({ z: 1.93, y: -0.47 })));
    pair(x => plate(w, [[1.95, -0.60], [1.95, -0.455], [1.80, -0.455], [1.78, -0.58]], x), 0.306);
    for (const y of [-0.02, 0.25]) {
      wing(w, airfoil(0.22, { thickness: 0.12, camber: 0.07, aoa: 10 }), span(REAR_SPAN, () => ({ z: -1.60, y })));
      wing(w, airfoil(0.11, { thickness: 0.11, camber: 0.06, aoa: 26 }), span(REAR_SPAN, () => ({ z: -1.82, y: y + 0.06 })));
    }
    standardEndplates(w, 0.37);
    pair(x => plate(f, [[-1.62, 0.0], [-1.62, 0.26], [-1.78, 0.30], [-1.78, 0.04]], x, 0.008), 0.2);
    beamWing(f);
    swanNeck(f);
    lights(light, 0.476, 0.12, -1.972, 0.26);
  },
  // 7 Gull: wings in a V, swept back, on twin pylons
  ({ w, f, light }) => {
    const t = x => Math.abs(x) / 0.78;
    [[1.99, -0.625, 0.125, 3], [1.89, -0.606, 0.105, 15]].forEach(([z, y, chord, aoa]) =>
      wing(w, airfoil(chord, { thickness: 0.11, camber: 0.05, aoa }), span(FRONT_SPAN, x => ({ z: z - 0.16 * t(x) ** 1.5, y: y + 0.03 * t(x) ** 2 }))));
    pair(x => plate(w, [[1.86, -0.655], [1.86, -0.58], [1.74, -0.49], [1.58, -0.47], [1.58, -0.655]], x), 0.786);
    const xs = [-0.52, -0.39, -0.26, -0.13, 0, 0.13, 0.26, 0.39, 0.52], g = x => Math.abs(x) / 0.52;
    wing(w, airfoil(0.24, { thickness: 0.12, camber: 0.07, aoa: 12 }), span(xs, x => ({ z: -1.58 - 0.12 * g(x), y: 0.0 + 0.15 * g(x) })));
    wing(w, airfoil(0.13, { thickness: 0.11, camber: 0.06, aoa: 30 }), span(xs, x => ({ z: -1.815 - 0.12 * g(x), y: 0.075 + 0.15 * g(x) })));
    pair(x => plate(w, [[-1.62, -0.30], [-1.56, 0.12], [-1.66, 0.33], [-2.08, 0.33], [-2.02, 0.02], [-1.86, -0.30]], x), 0.526);
    pair(x => plate(f, [[-1.42, -0.26], [-1.60, 0.02], [-1.72, 0.03], [-1.58, -0.30]], x, 0.009), 0.1);
    lights(light, 0.526, 0.1, -2.05, 0.18);
  },
];

// ---------------------------------------------------------------- Halo, driver, mirrors
{
  const arm = [[0.19, -0.13, -0.46], [0.202, -0.045, -0.36], [0.212, 0.022, -0.22], [0.208, 0.05, -0.06], [0.178, 0.06, 0.12], [0.10, 0.056, 0.26], [0, 0.042, 0.325]];
  const hoop = [...arm.slice(0, -1).map(p => [-p[0], p[1], p[2]]), arm[arm.length - 1], ...arm.slice(0, -1).reverse()];
  tube(frame, smoothPath(hoop, 4), 0.021, { sides: 10 });
  tube(frame, smoothPath([[0, 0.04, 0.325], [0, 0.0, 0.385], [0, -0.09, 0.44], [0, -0.17, 0.47]], 4), [0.019, 0.018, 0.017, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016], { sides: 8, flatten: 1.6 });

  const hc = [0, -0.045, -0.06], hr = [0.100, 0.110, 0.122];
  ellipsoid(helmet, hc, hr);
  ellipsoid(visor, hc, hr.map(r => r * 1.025), { az0: -1.15, az1: 1.15, el0: -0.12, el1: 0.42, nAz: 14, nEl: 5 });

  for (const side of [1, -1]) {
    const x = side * 0.335;
    box(main, x, -0.085, 0.335, 0.105, 0.05, 0.035);
    box(black, x, -0.085, 0.3165, 0.09, 0.038, 0.004);
    tube(frame, [[side * 0.24, -0.165, 0.34], [side * 0.30, -0.10, 0.335]], 0.008, { sides: 6 });
  }
}

// ---------------------------------------------------------------- Suspension (morph targets follow the wheels)
{
  const arm = (a, b, r = 0.012, flatten = 1) => tube(susp, [a, b], r, { sides: 6, flatten });
  [1, -1].forEach((s, si) => {
    // Front corner: target 0 = +x, 1 = -x
    let m = { t: si, w: 1 };
    const fz = FRONT_AXLE_Z;
    const fl = [s * 0.548, -0.42, fz, m], fu = [s * 0.548, -0.19, fz - 0.02, m];
    arm(fl, [s * 0.105, -0.555, 1.55]);
    arm(fl, [s * 0.140, -0.555, 1.10]);
    arm(fu, [s * 0.100, -0.405, 1.50]);
    arm(fu, [s * 0.130, -0.335, 1.12]);
    arm([s * 0.50, -0.43, fz, m], [s * 0.11, -0.36, 1.30], 0.010);          // push rod
    arm([s * 0.548, -0.30, fz + 0.12, m], [s * 0.11, -0.45, 1.47], 0.009);  // track rod
    // Rear corner: target 2 = +x, 3 = -x
    m = { t: 2 + si, w: 1 };
    const rz = REAR_AXLE_Z;
    const rl = [s * 0.584, -0.42, rz, m], ru = [s * 0.584, -0.19, rz, m];
    arm(rl, [s * 0.160, -0.555, -1.20]);
    arm(rl, [s * 0.070, -0.540, -1.62]);
    arm(ru, [s * 0.150, -0.350, -1.22]);
    arm(ru, [s * 0.070, -0.360, -1.60]);
    arm([s * 0.584, -0.30, rz, m], [s * 0.09, -0.42, rz], 0.020);            // drive shaft
    arm([s * 0.52, -0.21, rz + 0.03, m], [s * 0.12, -0.52, -1.40], 0.010);   // pull rod
  });
}

// ================================================================ GLB assembly
const glb = fs.readFileSync(SRC);
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.slice(20, 20 + jsonLen).toString('utf8'));
const binLen = glb.readUInt32LE(20 + jsonLen);
const chunks = [glb.slice(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen)];
let binSize = binLen;

function addView(buf, target) {
  const pad = (4 - binSize % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); binSize += pad; }
  json.bufferViews.push({ buffer: 0, byteOffset: binSize, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf);
  binSize += buf.length;
  return json.bufferViews.length - 1;
}
function addAccessor(arr, type, withBounds) {
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const isIndex = !(arr instanceof Float32Array);
  const acc = {
    bufferView: addView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), isIndex ? 34963 : 34962),
    componentType: arr instanceof Float32Array ? 5126 : arr instanceof Uint16Array ? 5123 : 5125,
    count: arr.length / comps, type,
  };
  if (withBounds) {
    acc.min = Array(comps).fill(Infinity); acc.max = Array(comps).fill(-Infinity);
    for (let i = 0; i < arr.length; i++) { acc.min[i % comps] = Math.min(acc.min[i % comps], arr[i]); acc.max[i % comps] = Math.max(acc.max[i % comps], arr[i]); }
  }
  json.accessors.push(acc);
  return json.accessors.length - 1;
}

// Paint UVs: a "fan" projection around an axis below the car. u follows the angle around the body
// (0.5 = centreline), v runs from the nose (0) to the tail (1). Livery SVGs are drawn in this space.
const UV_AXIS_Y = -0.80, UV_Z_FRONT = 2.05, UV_LENGTH = 4.10;
function uvs(part) {
  const uv = new Float32Array(part.count * 2);
  for (let i = 0; i < part.count; i++) {
    const [x, y, z] = part.pos.slice(i * 3, i * 3 + 3);
    uv[i * 2] = 0.5 + Math.atan2(x, y - UV_AXIS_Y) / Math.PI;
    uv[i * 2 + 1] = (UV_Z_FRONT - z) / UV_LENGTH;
  }
  return uv;
}
function primitive(part, material, { withUv = false, withMorph = false } = {}) {
  const prim = {
    attributes: { POSITION: addAccessor(new Float32Array(part.pos), 'VEC3', true), NORMAL: addAccessor(computeNormals(part), 'VEC3') },
    indices: addAccessor(part.count > 65535 ? new Uint32Array(part.idx) : new Uint16Array(part.idx), 'SCALAR'),
    material, mode: 4,
  };
  if (withUv) prim.attributes.TEXCOORD_0 = addAccessor(uvs(part), 'VEC2');
  if (withMorph) {
    prim.targets = [0, 1, 2, 3].map(t => {
      const d = new Float32Array(part.pos.length);
      part.morph.forEach((m, i) => { if (m && m.t === t) d[i * 3 + 1] = -0.5 * m.w; });
      return { POSITION: addAccessor(d, 'VEC3', true) };
    });
  }
  return prim;
}

const matIndex = name => json.materials.findIndex(m => m.name === name);
// Glossier paint, satin carbon
json.materials[matIndex('Main')].pbrMetallicRoughness.roughnessFactor = 0.28;
json.materials[matIndex('Metal')].pbrMetallicRoughness.roughnessFactor = 0.45;
json.materials[matIndex('AirIntake')].pbrMetallicRoughness.roughnessFactor = 0.6;
json.materials.push({ name: 'Helmet', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.25 } });
json.materials.push({ name: 'Visor', pbrMetallicRoughness: { baseColorFactor: [0.01, 0.01, 0.015, 1], metallicFactor: 0, roughnessFactor: 0.08 } });
// The wings' paint: the body's (pattern and primary colour), or a colour of their own (patch_bundle.js)
json.materials.push({ ...json.materials[matIndex('Main')], name: 'Wing' });

const bodyMesh = json.meshes.find(m => m.name === 'Body');
bodyMesh.primitives = [
  primitive(main, matIndex('Main'), { withUv: true }),
  primitive(black, matIndex('AirIntake'), { withUv: true }),
  primitive(frame, matIndex('Metal'), { withUv: true }),
  primitive(helmet, matIndex('Helmet'), { withUv: true }),
  primitive(visor, matIndex('Visor'), { withUv: true }),
];
const suspMesh = json.meshes.find(m => m.name === 'Suspension');
suspMesh.primitives = [primitive(susp, matIndex('Metal'), { withMorph: true })];

const wingTris = WINGS.map((build, i) => {
  const parts = { w: new Part(), f: new Part(), light: new Part() };
  build(parts);
  json.meshes.push({ name: 'Wing' + i, primitives: [[parts.w, 'Wing'], [parts.f, 'Metal'], [parts.light, 'BrakeLight']].filter(([p]) => p.count > 0).map(([p, m]) => primitive(p, matIndex(m), { withUv: true })) });
  json.nodes.push({ mesh: json.meshes.length - 1, name: 'Wing' + i });
  json.scenes[0].nodes.push(json.nodes.length - 1);
  return Object.values(parts).reduce((s, p) => s + p.idx.length / 3, 0);
});

json.buffers[0].byteLength = binSize;
json.asset.generator += ' + PolyTrack F1 mod';
let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - jsonBuf.length % 4) % 4, 0x20)]);
let binBuf = Buffer.concat(chunks);
binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - binBuf.length % 4) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(OUT, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));

const tris = [main, black, frame, helmet, visor, susp].reduce((s, p) => s + p.idx.length / 3, 0);
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${tris} triangles, ${WINGS.length} wings of ${Math.min(...wingTris)} to ${Math.max(...wingTris)})`);
console.log(`Ground clearance: ${(-0.650 - GROUND).toFixed(3)} m, rest morph offset ${MORPH_REST}`);
