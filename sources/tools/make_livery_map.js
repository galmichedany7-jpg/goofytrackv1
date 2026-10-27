// Draws the livery maps: a simple picture of where each part of the car falls on a pattern's 1024 x 1024 picture
// (build_patterns.js), one by body, read from the built models/car.glb. Each zone in its own flat colour, named,
// over a grid every 128 px: to keep under a design in a drawing program, or just to look at.
//
// Each pixel takes the zone of the point of the car it paints (where several do, the highest): the wings; then on
// the body the nose (ahead of the cockpit), the middle (the cockpit, then the engine cover), the two flanks of the
// sidepods and the tail. The zones' edges follow the car's own lines: a pixel, not a whole triangle, decides. The
// right half of the picture (x over 512) is the car's left (the driver's), the left half its right.
//
//   node tools/make_livery_map.js [output dir]   (docs by default)
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs');
const glb = fs.readFileSync(path.join(require('../config').APP, 'models', 'car.glb'));

const json = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)));
const bin = glb.slice(28 + glb.readUInt32LE(12));
const material = name => json.materials.findIndex(m => m.name === name);
// an accessor's values, as arrays of its components
function read(index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const data = new Type(bin.buffer, bin.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * size);
  return Array.from({ length: a.count }, (_, i) => Array.from(data.slice(i * size, i * size + size)));
}
// a mesh's triangles in the material: their corners in texture space (px) and on the car
function triangles(meshName, mat) {
  const mesh = json.meshes.find(m => m.name === meshName), out = [];
  for (const p of mesh.primitives.filter(p => p.material === mat)) {
    const pos = read(p.attributes.POSITION), uv = read(p.attributes.TEXCOORD_0);
    const idx = p.indices != null ? read(p.indices).map(v => v[0]) : uv.map((_, i) => i);
    for (let i = 0; i < idx.length; i += 3) {
      const k = [idx[i], idx[i + 1], idx[i + 2]];
      out.push({ uv: k.map(j => uv[j].map(c => c * 1024)), pos: k.map(j => pos[j]) });
    }
  }
  return out;
}
// each pixel's point on the car (the highest of the triangles over it), or none: [x, y, z] by pixel
function raster(tris) {
  const points = new Array(1024 * 1024).fill(null);
  for (const { uv: [a, b, c], pos } of tris) {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(1023, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(1023, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const u = px + 0.5, v = py + 0.5;
      const l0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / d, l1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
      const p = [0, 1, 2].map(j => l0 * pos[0][j] + l1 * pos[1][j] + l2 * pos[2][j]), old = points[py * 1024 + px];
      if (!old || p[1] > old[1]) points[py * 1024 + px] = p;
    }
  }
  return points;
}

// the zones, in the order they are drawn: name (French / English), colour
const ZONES = {
  frontWing: ['Aileron avant / Front wing', '#8ecae6'],
  rearWing: ['Aileron arrière / Rear wing', '#8ecae6'],
  nose: ['Nez / Nose', '#ffd166'],
  cockpit: ['Cockpit', '#f4a261'],
  cover: ['Capot moteur / Engine cover', '#e76f51'],
  left: ['Flanc et ponton gauche / Left side', '#b5e48c'],
  right: ['Flanc et ponton droit / Right side', '#76c893'],
  tail: ['Arrière / Tail', '#bdb2ff'],
};
// the body's zone of a point on the car (z: the nose +2, the tail -2; x over 0 the car's left)
function zone([x, , z]) {
  if (z > 0.75) return 'nose';
  if (z < -1.45) return 'tail';
  if (Math.abs(x) < 0.2) return z > -0.15 ? 'cockpit' : 'cover';
  return x > 0 ? 'left' : 'right';
}

const grid = Array.from({ length: 7 }, (_, i) => (i + 1) * 128).map(v =>
  `<line x1="${v}" y1="0" x2="${v}" y2="1024"/><line x1="0" y1="${v}" x2="1024" y2="${v}"/>`
  + `<text x="${v + 3}" y="14">${v}</text><text x="3" y="${v - 4}">${v}</text>`).join('');
const label = (x, y, text) => {
  const w = text.length * 7.6 + 14;
  return `<rect x="${(x - w / 2).toFixed(0)}" y="${(y - 11).toFixed(0)}" width="${w.toFixed(0)}" height="22" rx="11" fill="#fff" opacity="0.9"/>`
    + `<text x="${x.toFixed(0)}" y="${(y + 5).toFixed(0)}" text-anchor="middle">${text}</text>`;
};

fs.mkdirSync(OUT, { recursive: true });
const wings = raster(json.meshes.filter(m => /^Wing\d/.test(m.name)).flatMap(m => triangles(m.name, material('Wing'))));
for (const [body, file, title] of [['Body', 'standard', 'Standard'], ['Body1', 'mp4_7a', 'McLaren MP4/7A 1992'], ['Body2', 'r26', 'Renault R26 2006']]) {
  const points = raster(triangles(body, material('Main')));
  // each pixel's zone: the body's over the wings'
  const zones = points.map((p, i) => (p ? zone(p) : wings[i] ? (wings[i][2] > 0 ? 'frontWing' : 'rearWing') : null));
  let shapes = '', labels = '';
  for (const [key, [name, colour]] of Object.entries(ZONES)) {
    // the zone's pixels, row by row in runs, and their middle
    let d = '', n = 0, sx = 0, sy = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      if (zones[y * 1024 + x] !== key) continue;
      let end = x;
      while (end + 1 < 1024 && zones[y * 1024 + end + 1] === key) end++;
      const len = end - x + 1;
      d += `M${x} ${y}h${len}v1h-${len}z`;
      n += len; sx += (x + end + 1) / 2 * len; sy += (y + 0.5) * len;
      x = end;
    }
    if (!n) continue;
    shapes += `<path d="${d}" fill="${colour}" shape-rendering="crispEdges"/>`;
    labels += label(sx / n, sy / n, name);
  }
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<rect width="1024" height="1024" fill="#f7f7f5"/>
${shapes}
<g stroke="#000" stroke-opacity="0.12" fill="#000" fill-opacity="0.45" font-family="Arial" font-size="11">${grid}</g>
<line x1="512" y1="0" x2="512" y2="1024" stroke="#000" stroke-opacity="0.35" stroke-dasharray="8 6"/>
<g font-family="Arial" font-size="13" font-weight="bold" fill="#222">${labels}</g>
<g font-family="Arial" font-size="15" font-weight="bold" fill="#222" text-anchor="middle">
<text x="512" y="1016">${title} : avant en haut, arrière en bas · axe central x = 512</text>
<text x="256" y="545" fill-opacity="0.35" font-size="22">← côté DROIT de la voiture</text>
<text x="768" y="545" fill-opacity="0.35" font-size="22">côté GAUCHE de la voiture →</text>
</g>
</svg>
`;
  fs.writeFileSync(path.join(OUT, `livery_map_${file}.svg`), svg);
}
console.log(`Wrote 3 livery maps to ${OUT}`);
