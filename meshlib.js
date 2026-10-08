// Small procedural mesh toolkit used by build_car.js
// Coordinates are in the car's chassis space: +x left, +y up, +z forward.

class Part {
  constructor() { this.pos = []; this.idx = []; this.morph = []; }
  v(x, y, z, morph = null) {
    this.pos.push(x, y, z);
    this.morph.push(morph);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  get count() { return this.pos.length / 3; }
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Catmull-Rom interpolation of keyframe rows [z, a, b, ...] at a given z (keys sorted by descending z)
function sampleKeys(keys, z) {
  let i = 0;
  while (i < keys.length - 2 && z < keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (z - k1[0]) / (k2[0] - k1[0])));
  const out = [z];
  for (let c = 1; c < k1.length; c++) {
    // Tangents scaled for non-uniform key spacing
    const d1 = (k2[0] - k1[0]);
    const m1 = k0 === k1 ? (k2[c] - k1[c]) : (k2[c] - k0[c]) / (k2[0] - k0[0]) * d1;
    const m2 = k3 === k2 ? (k2[c] - k1[c]) : (k3[c] - k1[c]) / (k3[0] - k1[0]) * d1;
    const t2 = t * t, t3 = t2 * t;
    out.push((2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2);
  }
  return out;
}

// Closed superellipse ring of N points at depth z. Starts at top centre and goes towards +x.
function ring(z, { w, top, bot, n = 2.5, xc = 0, taper = 1, N = 36 }) {
  const yc = (top + bot) / 2, h = (top - bot) / 2;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const t = 2 * Math.PI * k / N;
    const s = Math.sin(t), c = Math.cos(t);
    const sx = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    const sy = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const W = w * lerp(1, taper, smooth((sy + 1) / 2));
    pts.push([xc + W * sx, yc + h * sy, z]);
  }
  return pts;
}

// Loft quads between consecutive rings. matFn(i, k) picks the Part for the quad between ring i/i+1, point k/k+1.
function loft(rings, matFn, { closed = true } = {}) {
  const N = rings[0].length;
  const maps = new Map(); // Part -> Map(key -> vertex index)
  const vert = (part, i, k) => {
    let m = maps.get(part);
    if (!m) maps.set(part, m = new Map());
    const key = i * N + k;
    let v = m.get(key);
    if (v == null) { const p = rings[i][k]; v = part.v(p[0], p[1], p[2], p[3] || null); m.set(key, v); }
    return v;
  };
  const kMax = closed ? N : N - 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < kMax; k++) {
      const part = typeof matFn === 'function' ? matFn(i, k) : matFn;
      if (!part) continue;
      const k1 = (k + 1) % N;
      part.quad(vert(part, i, k), vert(part, i, k1), vert(part, i + 1, k1), vert(part, i + 1, k));
    }
  }
  return { vert };
}

// Flat cap closing a ring with a triangle fan. `front` = cap faces the direction the ring was wound for (+z side).
function cap(part, pts, front = true) {
  const c = pts.reduce((a, p) => add(a, p), [0, 0, 0]).map(v => v / pts.length);
  const ci = part.v(c[0], c[1], c[2]);
  const vi = pts.map(p => part.v(p[0], p[1], p[2], p[3] || null));
  for (let k = 0; k < pts.length; k++) {
    const a = vi[k], b = vi[(k + 1) % pts.length];
    front ? part.tri(ci, b, a) : part.tri(ci, a, b);
  }
}

// Axis-aligned box with flat faces
function box(part, cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const f = (a, b, c, d) => part.quad(part.v(...a), part.v(...b), part.v(...c), part.v(...d));
  f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // top
  f([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom
  f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
  f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
  f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // front
  f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // back
}

// Ear clipping triangulation of a simple 2D polygon; returns index triples
function triangulate(poly) {
  const n = poly.length;
  const area = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0);
  const idx = poly.map((_, i) => i);
  if (area < 0) idx.reverse();
  const tris = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (cr(a, b, c) <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        if (cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// Extrude a 2D polygon along one axis. map(u, v, t) -> [x, y, z] places polygon point (u, v) at extrusion coord t.
function extrude(part, poly, t0, t1, map) {
  const tris = triangulate(poly);
  for (const [t, flip] of [[t0, false], [t1, true]]) {
    const vi = poly.map(p => part.v(...map(p[0], p[1], t)));
    for (const [a, b, c] of tris) flip ? part.tri(vi[a], vi[c], vi[b]) : part.tri(vi[a], vi[b], vi[c]);
  }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    part.quad(part.v(...map(p[0], p[1], t0)), part.v(...map(q[0], q[1], t0)), part.v(...map(q[0], q[1], t1)), part.v(...map(p[0], p[1], t1)));
  }
}

// Tube swept along a polyline. pts: [x, y, z, morph?]; radius: number or per-point array.
function tube(part, pts, radius, { sides = 8, caps = true, flatten = 1 } = {}) {
  const rings = [];
  let up = [0, 1, 0];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const dir = norm(sub(next, prev));
    if (Math.abs(dot(dir, up)) > 0.95) up = [1, 0, 0];
    const side = norm(cross(up, dir));
    up = norm(cross(dir, side));
    const r = Array.isArray(radius) ? radius[i] : radius;
    const pr = [];
    for (let k = 0; k < sides; k++) {
      const a = 2 * Math.PI * k / sides;
      const o = add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r * flatten));
      pr.push([pts[i][0] + o[0], pts[i][1] + o[1], pts[i][2] + o[2], pts[i][3] || null]);
    }
    rings.push(pr);
  }
  loft(rings, part);
  if (caps) { cap(part, rings[0], true); cap(part, rings[rings.length - 1], false); }
}

// Smooth a polyline with Catmull-Rom subdivision
function smoothPath(pts, sub_ = 4) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < sub_; s++) {
      const t = s / sub_, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(pts[pts.length - 1].slice(0, 3));
  return out;
}

// Airfoil outline in (z, y): leading edge at (0, 0), chord runs towards -z, trailing edge raised by the angle of attack.
// Inverted camber (downforce). Returns a closed loop of points.
function airfoil(chord, { thickness = 0.12, camber = 0.06, aoa = 0, n = 9 } = {}) {
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const xi = 0.5 * (1 - Math.cos(Math.PI * i / n));
    const yt = 5 * thickness * (0.2969 * Math.sqrt(xi) - 0.126 * xi - 0.3516 * xi * xi + 0.2843 * xi ** 3 - 0.1036 * xi ** 4);
    const yc = -camber * 4 * xi * (1 - xi);
    up.push([xi, yc + yt]);
    lo.push([xi, yc - yt]);
  }
  const loop = [...up, ...lo.slice(1, -1).reverse()];
  const a = aoa * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return loop.map(([x, y]) => [-(x * ca - y * sa) * chord, (x * sa + y * ca) * chord]);
}

// Wing element: airfoil lofted along the span. stations: [{x, z, y, scale?}] where (z, y) is the leading edge.
function wing(part, profile, stations, { capPart = part } = {}) {
  const rings = stations.map(s => profile.map(([pz, py]) => [s.x, s.y + py * (s.scale ?? 1), s.z + pz * (s.scale ?? 1)]));
  loft(rings, part);
  cap(capPart, rings[0], false);
  cap(capPart, rings[rings.length - 1], true);
}

// Ellipsoid patch (full sphere by default). Angles in radians: azimuth around y (0 = +z), elevation from the horizon.
function ellipsoid(part, c, r, { az0 = -Math.PI, az1 = Math.PI, el0 = -Math.PI / 2, el1 = Math.PI / 2, nAz = 20, nEl = 12 } = {}) {
  const rings = [];
  for (let j = 0; j <= nEl; j++) {
    const el = lerp(el0, el1, j / nEl);
    const pr = [];
    for (let i = 0; i <= nAz; i++) {
      const az = lerp(az0, az1, i / nAz);
      pr.push([c[0] + r[0] * Math.cos(el) * Math.sin(az), c[1] + r[1] * Math.sin(el), c[2] + r[2] * Math.cos(el) * Math.cos(az)]);
    }
    rings.push(pr);
  }
  loft(rings, part, { closed: false });
}

// Per-vertex smooth normals (same result three.js computes at load time)
function computeNormals(part) {
  const n = new Float32Array(part.pos.length);
  const P = i => [part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]];
  for (let t = 0; t < part.idx.length; t += 3) {
    const [a, b, c] = [part.idx[t], part.idx[t + 1], part.idx[t + 2]];
    const fn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    for (const v of [a, b, c]) { n[v * 3] += fn[0]; n[v * 3 + 1] += fn[1]; n[v * 3 + 2] += fn[2]; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (l > 0) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } else n[i + 1] = 1;
  }
  return n;
}

module.exports = { Part, lerp, smooth, sampleKeys, ring, loft, cap, box, extrude, tube, smoothPath, airfoil, wing, ellipsoid, computeNormals, triangulate };
