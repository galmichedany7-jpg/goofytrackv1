// Laguna Coupé body (build_car.js, Body3): turns the 3D model of the 2008 Renault Laguna Coupé (an OBJ exported from
// SketchUp, its textures beside it) into models/laguna.bin, which build_car.js fits onto the chassis.
//
//   node tools/make_laguna.js "C:\path\to\2008RenaultLagunaCoupe.obj"
//
// Only the outside of the car is kept: the wheels, brakes and interior are left out (the game's wheels take their
// place). Each face of the body takes the class of the colour its texture shows under it: the paint (red on the
// model) becomes the car's paint, the dark trim black, the grey trim metal, the light parts chrome; the tail lights
// (their place in the texture) light up with the brakes, the headlights are kept apart. The windows are glass.
//
// laguna.bin: "LGN1", the number of groups (u32), then for each group its name (8 bytes, ASCII, space padded), its
// vertex count and index count (u32 each), the vertices (int16 x, y, z, in 1/20000 of the model's unit, x from the
// car's centreline, y up from the ground, z back from the front bumper), then the indices (u16), the triangles turning
// counter-clockwise seen from outside.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OBJ = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'models', 'laguna.bin');
if (!OBJ) { console.error('Usage: node tools/make_laguna.js <model.obj> [laguna.bin]'); process.exit(1); }

// ---------------------------------------------------------------- the paint's texture (PNG, 8 bits, not interlaced)
function readPng(buf) {
  let o = 8, w, h, type;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), name = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8 || d[12]) throw new Error('PNG not supported'); }
    else if (name === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + p) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = line[x * bpp + (bpp >= 3 ? k : 0)];
    prev = line;
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------- the model
const lines = fs.readFileSync(OBJ, 'utf8').split(/\r?\n/);
const mtl = {};
{
  const file = lines.find(l => l.startsWith('mtllib '));
  let name = null;
  if (file) for (const l of fs.readFileSync(path.join(path.dirname(OBJ), file.slice(7).trim()), 'utf8').split(/\r?\n/)) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'newmtl') name = p[1];
    else if (p[0] === 'map_Kd') mtl[name] = path.join(path.dirname(OBJ), p.slice(1).join(' '));
  }
}
const MODEL_CENTRE_X = -0.3231;                // the car's centreline in the model (written out below)
const PAINT_MTL = '_auto_2';                    // the body: paint, trim, lights, badges, in one texture
const GLASS_MTL = ['_auto_4'];                  // the windows (the headlights' covers, Translucent_Glass_Gray, go)
const UNDER_MTL = '_auto_3';                    // under the car
const tex = readPng(fs.readFileSync(mtl[PAINT_MTL]));
const texel = (u, v) => {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(tex.w - 1, Math.floor(u * tex.w)), y = Math.min(tex.h - 1, Math.floor((1 - v) * tex.h));
  return [...tex.data.subarray((y * tex.w + x) * 3, (y * tex.w + x) * 3 + 3)];
};
// where the lights are drawn in the texture (pixels of the 512 x 512 picture)
const TAIL_LIGHT = [88, 88, 280, 128], HEADLIGHT = [270, 0, 420, 122];
const inRect = ([x0, y0, x1, y1], u, v) => {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = u * tex.w, y = (1 - v) * tex.h;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
function classOf(rgb) {
  const [r, g, b] = rgb, hi = Math.max(r, g, b);
  if (r > 25 && r > 2.5 * Math.max(g, b)) return r > 110 ? 'light' : 'paint';   // the paint, or a reflector
  if (hi < 42) return 'black';
  if (hi < 112) return 'metal';
  return 'chrome';
}

const V = [], VT = [], VN = [];
const groups = {};   // name -> { pos: [], idx: [], keys: Map }
const group = name => groups[name] ?? (groups[name] = { pos: [], idx: [], keys: new Map() });
let material = null, kept = 0, dropped = 0;
for (const l of lines) {
  const p = l.trim().split(/\s+/);
  if (p[0] === 'v') V.push(p.slice(1, 4).map(Number));
  else if (p[0] === 'vt') VT.push(p.slice(1, 3).map(Number));
  else if (p[0] === 'vn') VN.push(p.slice(1, 4).map(Number));
  else if (p[0] === 'usemtl') material = p[1];
  else if (p[0] === 'f') {
    const corners = p.slice(1).map(q => q.split('/').map(n => parseInt(n, 10) - 1));
    let name = null;
    if (material === PAINT_MTL) {
      const c = [0, 1, 2].map(k => corners.reduce((s, [vi]) => s + V[vi][k], 0) / corners.length);
      const uvs = corners.map(([, ti]) => VT[ti]);
      const cu = uvs.reduce((s, t) => s + t[0], 0) / uvs.length, cv = uvs.reduce((s, t) => s + t[1], 0) / uvs.length;
      if (c[2] > 1.25 && inRect(TAIL_LIGHT, cu, cv)) name = 'tail';
      else if (c[2] < 0.3 && inRect(HEADLIGHT, cu, cv)) name = 'head';
      else {
        // the colour under the face: its centre, and halfway to each corner, the most frequent class wins
        const votes = {};
        for (const [u, v] of [[cu, cv], ...uvs.map(t => [(t[0] + cu) / 2, (t[1] + cv) / 2])]) {
          const k = classOf(texel(u, v));
          votes[k] = (votes[k] ?? 0) + 1;
        }
        name = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
        // the mirrors, black on the Monaco GP
        if (name === 'paint' && Math.abs(c[0] - MODEL_CENTRE_X) > 0.276 && c[1] > 0.262 && c[1] < 0.40 && c[2] > 0.46 && c[2] < 0.64) name = 'black';
      }
    } else if (GLASS_MTL.includes(material)) name = 'glass';
    else if (material === UNDER_MTL) name = 'under';
    if (!name) { dropped++; continue; }
    kept++;
    const G = group(name);
    // the vertices as the model shares them (its own smoothing), by position and normal
    const ids = corners.map(([vi, , ni]) => {
      const key = vi + '/' + ni;
      if (!G.keys.has(key)) { G.keys.set(key, G.pos.length / 3); G.pos.push(...V[vi]); }
      return G.keys.get(key);
    });
    // turned to face the way of the model's normals
    const P = i => G.pos.slice(i * 3, i * 3 + 3);
    const [a, b, c] = [P(ids[0]), P(ids[1]), P(ids[2])];
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const vn = corners.reduce((s, [, , ni]) => VN[ni] ? s.map((x, k) => x + VN[ni][k]) : s, [0, 0, 0]);
    const flip = n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0;
    for (let k = 1; k + 1 < ids.length; k++) G.idx.push(...(flip ? [ids[0], ids[k + 1], ids[k]] : [ids[0], ids[k], ids[k + 1]]));
  }
}

// ---------------------------------------------------------------- centred on the car's centreline, written out
const body = groups.paint.pos;
let xMin = Infinity, xMax = -Infinity;
for (let i = 0; i < body.length; i += 3) { xMin = Math.min(xMin, body[i]); xMax = Math.max(xMax, body[i]); }
const cx = (xMin + xMax) / 2, Q = 20000;
const parts = [];
const head = Buffer.alloc(8); head.write('LGN1', 0, 'ascii'); head.writeUInt32LE(Object.keys(groups).length, 4); parts.push(head);
for (const [name, G] of Object.entries(groups)) {
  const h = Buffer.alloc(16); h.write(name.padEnd(8), 0, 'ascii'); h.writeUInt32LE(G.pos.length / 3, 8); h.writeUInt32LE(G.idx.length, 12);
  const pos = new Int16Array(G.pos.length);
  G.pos.forEach((x, i) => { pos[i] = Math.round((i % 3 === 0 ? x - cx : x) * Q); });
  if (G.pos.length / 3 > 65535) throw new Error(name + ': too many vertices');
  parts.push(h, Buffer.from(pos.buffer), Buffer.from(new Uint16Array(G.idx).buffer));
  console.log(`${name.padEnd(7)} ${String(G.pos.length / 3).padStart(6)} vertices ${String(G.idx.length / 3).padStart(6)} triangles`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat(parts));
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB): ${kept} faces kept, ${dropped} left out, centreline x = ${cx.toFixed(4)}`);
