// Builds the F1-style car model for the PolyTrack mod.
// Replaces the "Body" and "Suspension" meshes of the original car.glb and leaves everything else
// (collision shape, rims, exhausts) byte-for-byte untouched, so the physics are unchanged.
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
const main = new Part(), black = new Part(), frame = new Part(), light = new Part(), helmet = new Part(), visor = new Part();
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
  // Rain light
  box(light, 0, -0.525, -1.962, 0.07, 0.07, 0.014);
}

// ---------------------------------------------------------------- Front wing
{
  const span = [-0.78, -0.6, -0.4, -0.2, -0.08, 0.08, 0.2, 0.4, 0.6, 0.78];
  // [leading edge z, y, chord, angle of attack]
  const elements = [[1.99, -0.625, 0.125, 3], [1.89, -0.606, 0.105, 13], [1.805, -0.578, 0.095, 24]];
  elements.forEach(([z, y, chord, aoa], e) => {
    const profile = airfoil(chord, { thickness: 0.11, camber: 0.05, aoa });
    // Flaps drop slightly towards the tips
    wing(main, profile, span.map(x => ({ x, z, y: y - e * 0.012 * (x / 0.78) ** 2 })));
  });
  for (const side of [1, -1]) {
    const x = side * 0.786;
    extrude(main, [[2.00, -0.655], [2.00, -0.605], [1.90, -0.505], [1.70, -0.470], [1.70, -0.655]], x - 0.006, x + 0.006, (z, y, xx) => [xx, y, z]);
  }
}

// ---------------------------------------------------------------- Rear wing
{
  const span = [-0.47, -0.235, 0, 0.235, 0.47].map(x => x);
  wing(main, airfoil(0.24, { thickness: 0.12, camber: 0.07, aoa: 12 }), span.map(x => ({ x, z: -1.60, y: 0.035 })));
  wing(main, airfoil(0.13, { thickness: 0.11, camber: 0.06, aoa: 32 }), span.map(x => ({ x, z: -1.835, y: 0.108 })));
  wing(frame, airfoil(0.13, { thickness: 0.11, camber: 0.05, aoa: 15 }), span.map(x => ({ x, z: -1.66, y: -0.29 })));
  for (const side of [1, -1]) {
    const x = side * 0.476;
    extrude(main, [[-1.50, -0.40], [-1.50, 0.10], [-1.58, 0.19], [-1.97, 0.19], [-1.97, -0.12], [-1.84, -0.40]], x - 0.006, x + 0.006, (z, y, xx) => [xx, y, z]);
    box(light, x, 0.02, -1.972, 0.014, 0.16, 0.008);
  }
  // Swan-neck pylon
  extrude(frame, [[-1.42, -0.26], [-1.63, 0.045], [-1.76, 0.062], [-1.60, -0.30]], -0.009, 0.009, (z, y, x) => [x, y, z]);
}

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

const bodyMesh = json.meshes.find(m => m.name === 'Body');
bodyMesh.primitives = [
  primitive(main, matIndex('Main'), { withUv: true }),
  primitive(black, matIndex('AirIntake'), { withUv: true }),
  primitive(frame, matIndex('Metal'), { withUv: true }),
  primitive(light, matIndex('BrakeLight'), { withUv: true }),
  primitive(helmet, matIndex('Helmet'), { withUv: true }),
  primitive(visor, matIndex('Visor'), { withUv: true }),
];
const suspMesh = json.meshes.find(m => m.name === 'Suspension');
suspMesh.primitives = [primitive(susp, matIndex('Metal'), { withMorph: true })];

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

const tris = [main, black, frame, light, helmet, visor, susp].reduce((s, p) => s + p.idx.length / 3, 0);
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${tris} triangles)`);
console.log(`Ground clearance: ${(-0.650 - GROUND).toFixed(3)} m, rest morph offset ${MORPH_REST}`);
