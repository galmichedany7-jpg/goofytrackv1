// Apex scenery: the landscape around the track (mountains, forests, rocks). Looks only.
//
// The game's mountains are a coarse ring of triangles that the physics also collides with.
// That original mesh is kept, untouched, for the physics (patch_bundle.js makes the game read it
// from mesh.userData.apexPhysics). What is drawn instead is rebuilt here from the same heights:
//
//   - the same hills, sampled several times finer and roughened with noise
//   - a second, taller range behind them for the skyline
//   - faces coloured by slope and altitude: grass, rock and snow caps in summer; snow, bare rock
//     and ice in winter; sand, banded red rock and pale summits in the desert
//   - pine forests on the foothills (summer, winter) or boulders (desert)
//
// Everything is one static mesh using the game's own mountain material, built when a track loads.
// The game calls into window.ApexScenery from the hooks added by patch_bundle.js.
(() => {
  'use strict';

  const RING = 100;                 // metres between two rings of the original mountains
  const RINGS = 7;                  // the original spans 7 rings
  const BACKDROP_RINGS = 9;         // extra range drawn behind them
  const MAX_TRIANGLES = 44000;      // budget for the terrain; props add at most ~16000
  const ENVIRONMENTS = { 3495480: 'summer', 11053224: 'winter', 11171394: 'desert' }; // by the game's ground colour

  // Display (sRGB) colours. `null` means "the game's ground colour", so slopes blend into the plain.
  const PALETTES = {
    summer: {
      ground: null, patch: 0.82, rock: [0.47, 0.45, 0.40], high: [0.60, 0.59, 0.56], snow: [0.93, 0.95, 0.98],
      foliage: [[0.13, 0.33, 0.18], [0.16, 0.38, 0.20], [0.20, 0.43, 0.22]], trunk: [0.30, 0.21, 0.14],
    },
    winter: {
      ground: null, patch: 0.94, rock: [0.40, 0.45, 0.55], high: [0.86, 0.90, 0.96], snow: [0.96, 0.98, 1.0],
      foliage: [[0.16, 0.30, 0.27], [0.19, 0.34, 0.30], [0.93, 0.96, 1.0]], trunk: [0.26, 0.20, 0.17],
    },
    desert: {
      ground: null, patch: 0.92, rock: [0.70, 0.41, 0.26], high: [0.84, 0.62, 0.42], snow: [0.92, 0.78, 0.58],
      strata: [[0.74, 0.44, 0.27], [0.62, 0.34, 0.22], [0.80, 0.52, 0.32]], boulder: [0.66, 0.44, 0.30],
    },
  };

  let current = null;               // { mesh, physics, hex }

  // Circuits that come with their own scenery: the track part that marks them, and the files to draw.
  // The mesh is a simplified, textured model (see tools/make_monaco.js). It is only drawn, never collided with.
  const TOWNS = { 240: { mesh: 'tracks/monaco_decor.bin', texture: 'tracks/monaco_decor.jpg' } };
  const PART_SIZE = 5;
  const TOWN_BRIGHTNESS = 0.85;     // material colour multiplying the texture
  const townFiles = new Map();      // url -> Promise of { positions, index, uvs, image }
  let town = null;                  // { owner, files, origin, data, mesh }

  function loadTown(files) {
    if (!townFiles.has(files.mesh)) {
      const mesh = fetch(files.mesh).then(r => r.arrayBuffer()).then(buffer => {
        const headerLength = new DataView(buffer).getUint32(0, true);
        const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
        let at = 4 + headerLength; at += (4 - at % 4) % 4;
        const positions = new Float32Array(buffer, at, header.vertices * 3); at += header.vertices * 12;
        const index = new Uint32Array(buffer, at, header.triangles * 3); at += header.triangles * 12;
        return { positions, index, uvs: new Float32Array(buffer, at, header.vertices * 2) };
      });
      const image = new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('texture not found: ' + files.texture)); img.src = files.texture; });
      townFiles.set(files.mesh, Promise.all([mesh, image]).then(([m, img]) => ({ ...m, image: img })));
    }
    return townFiles.get(files.mesh);
  }

  function removeTown() {
    if (town != null && town.mesh != null) {
      if (town.mesh.parent) town.mesh.parent.remove(town.mesh);
      town.mesh.geometry.dispose();
      if (town.mesh.material.map) town.mesh.material.map.dispose();
      town.mesh.material.dispose();
    }
    town = null;
  }

  // The material is a copy of the mountains' one (same lighting), with the town texture instead of vertex colours.
  function showTown() {
    if (town == null || town.data == null || current == null || current.mesh.parent == null || !window.ApexGfx) return;
    if (town.mesh != null) { if (town.mesh.parent !== current.mesh.parent) current.mesh.parent.add(town.mesh); return; }
    const texture = window.ApexGfx.makeTexture(town.data.image);
    if (texture == null) return;                                         // sky not created yet
    texture.colorSpace = 'srgb';
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const material = current.mesh.material.clone();
    material.vertexColors = false;
    material.map = texture;
    material.color.setRGB(TOWN_BRIGHTNESS, TOWN_BRIGHTNESS, TOWN_BRIGHTNESS);
    window.ApexGfx.registerMaterial(material);
    const Geometry = current.physics.constructor, Attribute = current.physics.attributes.position.constructor;
    const geometry = new Geometry();
    geometry.setAttribute('position', new Attribute(town.data.positions, 3));
    geometry.setAttribute('uv', new Attribute(town.data.uvs, 2));
    geometry.setIndex(new Attribute(town.data.index, 1));
    geometry.computeVertexNormals();
    town.mesh = new current.mesh.constructor(geometry, material);
    town.mesh.position.set(town.origin[0], town.origin[1], town.origin[2]);
    town.mesh.receiveShadow = true;
    current.mesh.parent.add(town.mesh);
  }

  // ------------------------------------------------------------------ small maths
  const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); };
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.30 + noise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
  const ridged = (x, y) => { const n = 1 - Math.abs(2 * fbm(x, y) - 1); return n * n; };
  const catmull = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  function random(seed) {           // small deterministic generator: the same track always gets the same forest
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const toLinear = c => Math.pow(c, 2.2);

  // ------------------------------------------------------------------ the original heights
  // The game's mesh is a polar grid: `sectors` slices around the track, RINGS rings of quads, 6 vertices per quad.
  function readOriginal(geometry) {
    const p = geometry.attributes.position.array;
    const quads = p.length / 18;
    const sectors = Math.round(quads / RINGS);
    if (sectors < 3 || sectors * RINGS !== quads) return null;
    const H = [];
    for (let e = 0; e < sectors; e++) {
      const row = [];
      for (let k = 0; k < RINGS; k++) row.push(p[(e * RINGS + k) * 18 + 1]);
      row.push(p[(e * RINGS + RINGS - 1) * 18 + 5 * 3 + 1]);
      H.push(row);
    }
    return { sectors, H, radius: Math.hypot(p[0], p[2]) };
  }

  function heightField(original) {
    const { sectors, H, radius } = original;
    const at = (e, k) => H[((e % sectors) + sectors) % sectors][Math.max(0, Math.min(RINGS, k))];
    // skyline: a few broad summits around the horizon
    const summit = angle => 0.35 + 0.65 * noise(Math.cos(angle) * 2.3 + 11, Math.sin(angle) * 2.3 + 4);
    return (angle, rho) => {
      const x = Math.cos(angle) * rho, z = Math.sin(angle) * rho;
      const v = (rho - radius) / RING;
      if (v <= 0) return 0;
      if (v < RINGS) {
        const u = angle / (2 * Math.PI) * sectors, e = Math.floor(u), k = Math.floor(v), tu = u - e, tv = v - k;
        const col = j => catmull(at(e - 1, k + j), at(e, k + j), at(e + 1, k + j), at(e + 2, k + j), tu);
        const base = Math.max(0, catmull(col(-1), col(0), col(1), col(2), tv));
        const rough = (fbm(x / 70, z / 70) - 0.5) * 0.7 + (fbm(x / 23, z / 23) - 0.5) * 0.25;
        return Math.max(0, base * (1 + rough) + Math.min(1, base / 25) * (ridged(x / 110, z / 110) - 0.35) * 14) * Math.min(1, v * 3);
      }
      const w = (v - RINGS) / BACKDROP_RINGS;                    // 0..1 across the far range
      if (w >= 1) return 0;
      const bump = Math.pow(Math.sin(Math.PI * w), 0.8);
      return bump * summit(angle) * (150 + 190 * ridged(x / 330, z / 330)) * (0.75 + 0.5 * fbm(x / 120, z / 120));
    };
  }

  // ------------------------------------------------------------------ building the mesh
  function build(original, environment, base) {
    const palette = PALETTES[environment];
    const height = heightField(original);
    const { sectors, radius } = original;
    const positions = [], colors = [];
    const tint = c => (c == null ? [1, 1, 1] : [toLinear(c[0]) / base.r, toLinear(c[1]) / base.g, toLinear(c[2]) / base.b]);
    const tri = (a, b, c, color, shade) => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) colors.push(color[0] * shade, color[1] * shade, color[2] * shade);
    };

    // radial rows: fine across the original hills, coarser across the far range
    const rows = [];
    for (let i = 0; i <= RINGS * 3; i++) rows.push(radius + i * RING / 3);
    for (let i = 1; i <= 12; i++) rows.push(radius + RINGS * RING + i * BACKDROP_RINGS * RING / 12);
    const strips = rows.length - 1;
    let columns = sectors * Math.max(3, Math.min(8, Math.ceil(170 / sectors)));
    columns = Math.max(sectors, Math.min(columns, Math.floor(MAX_TRIANGLES / (strips * 2))));

    const grid = [];
    for (let i = 0; i <= columns; i++) {
      const angle = (i % columns) / columns * 2 * Math.PI, line = [];
      for (const rho of rows) line.push([Math.cos(angle) * rho, height(angle, rho), Math.sin(angle) * rho]);
      grid.push(line);
    }
    const terrainColor = (a, b, c) => {
      const y = (a[1] + b[1] + c[1]) / 3, cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const flat = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);  // 1 = level ground, 0 = cliff
      const shade = 0.94 + 0.12 * hash2(cx * 0.37, cz * 0.37);
      if (y > 185 && flat > 0.5) return [tint(palette.snow), shade];
      if (y > 120) return [tint(flat > 0.62 ? palette.high : palette.rock), shade];
      if (flat < 0.80 && y > 6) {
        if (palette.strata) return [tint(palette.strata[Math.abs(Math.floor(y / 11)) % palette.strata.length]), shade];
        return [tint(palette.rock), shade];
      }
      return [tint(null), shade * (fbm(cx / 85, cz / 85) > 0.58 ? palette.patch : 1)];
    };
    for (let i = 0; i < columns; i++) for (let j = 0; j < strips; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      if (a[1] === 0 && b[1] === 0 && c[1] === 0 && d[1] === 0 && j > RINGS * 3) continue; // flat beyond the range: nothing to draw
      // alternate the diagonal so the facets do not line up
      const quad = (i + j) % 2 === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const t of quad) { const [color, shade] = terrainColor(...t); tri(t[0], t[1], t[2], color, shade); }
    }

    // props on the foothills, never closer to the track than the edge of the plain around it
    const rnd = random(sectors * 7919 + Math.round(radius));
    const place = (count, add) => {
      for (let n = 0, tries = 0; n < count && tries < count * 12; tries++) {
        const angle = rnd() * 2 * Math.PI, rho = radius - 95 + Math.pow(rnd(), 1.3) * 560;
        const x = Math.cos(angle) * rho, z = Math.sin(angle) * rho, y = height(angle, rho);
        if (y > 80 || Math.abs(height(angle, rho + 7) - y) > 5.5 || fbm(x / 95 + 3, z / 95 + 8) < 0.46) continue;
        add(x, y - 0.3, z, rnd);
        n++;
      }
    };
    if (palette.foliage) {
      const foliage = palette.foliage.map(tint), trunk = tint(palette.trunk);
      place(Math.max(220, Math.min(600, Math.round(radius * 0.7))), (x, y, z, r) => {
        const s = 0.8 + r() * 0.75, turn = r() * Math.PI, shade = 0.88 + r() * 0.24;
        const ring = (radiusAt, yAt, sides) => Array.from({ length: sides }, (_, i) => {
          const a = turn + i / sides * 2 * Math.PI;
          return [x + Math.cos(a) * radiusAt * s, y + yAt * s, z + Math.sin(a) * radiusAt * s];
        });
        const bottom = ring(0.45, 0, 4), top = ring(0.45, 2.4, 4);
        for (let i = 0; i < 4; i++) { const k = (i + 1) % 4; tri(bottom[i], top[i], top[k], trunk, shade); tri(bottom[i], top[k], bottom[k], trunk, shade); }
        [[3.0, 2.0, 6.2], [2.3, 4.7, 8.8], [1.5, 7.3, 11.2]].forEach(([rad, from, to], tier) => {
          const rim = ring(rad, from, 6), tip = [x, y + to * s, z];
          for (let i = 0; i < 6; i++) tri(rim[i], tip, rim[(i + 1) % 6], foliage[tier], shade * (0.9 + 0.2 * (i % 2)));
        });
      });
    } else {
      const boulder = tint(palette.boulder);
      place(240, (x, y, z, r) => {
        const sx = 2 + r() * 5, sy = 1.2 + r() * 3.5, sz = 2 + r() * 5, turn = r() * Math.PI;
        const pt = (a, up, k) => [x + Math.cos(turn + a) * sx * k, y + up * sy, z + Math.sin(turn + a) * sz * k];
        const rim = [0, 1, 2, 3].map(i => pt(i * Math.PI / 2 + r() * 0.5, 0.25 + r() * 0.3, 0.8 + r() * 0.4));
        const top = pt(0, 1, 0), bottom = pt(0, -0.4, 0);
        for (let i = 0; i < 4; i++) { tri(rim[i], top, rim[(i + 1) % 4], boulder, 0.85 + r() * 0.3); tri(rim[i], rim[(i + 1) % 4], bottom, boulder, 0.7); }
      });
    }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
  }

  function rebuild() {
    const { mesh, physics } = current;
    const material = mesh.material;
    const hex = material.color.getHex();
    current.hex = hex;
    const original = readOriginal(physics);
    if (original == null) return;
    const data = build(original, ENVIRONMENTS[hex] || 'summer', material.color);
    const Geometry = physics.constructor, Attribute = physics.attributes.position.constructor;
    const geometry = new Geometry();
    geometry.setAttribute('position', new Attribute(data.positions, 3));
    geometry.setAttribute('color', new Attribute(data.colors, 3));
    geometry.computeVertexNormals();
    if (mesh.geometry !== physics) mesh.geometry.dispose();
    mesh.geometry = geometry;
    if (!material.vertexColors) { material.vertexColors = true; material.needsUpdate = true; }
  }

  window.ApexScenery = {
    // Read-only snapshot for the console
    debug: () => current && { triangles: current.mesh.geometry.attributes.position.count / 3, physicsVertices: current.physics.attributes.position.count, environment: ENVIRONMENTS[current.hex] },

    // The game just created its mountain mesh
    mountains(mesh) {
      current = null;
      try {
        if (mesh.geometry.attributes.position.count === 0) return;       // very large tracks have no mountains
        mesh.userData.apexPhysics = mesh.geometry;                        // what the physics keeps reading
        current = { mesh, physics: mesh.geometry, hex: -1 };
        rebuild();
      } catch (e) {
        console.error('Apex: scenery unavailable, keeping the original mountains', e);
        if (current != null) { mesh.geometry = current.physics; current = null; }
      }
    },

    // A track is being played: does it bring its own town?
    track(owner, track) {
      removeTown();
      try {
        let found = null;
        track.getTrackData().forEachPart((x, y, z, id) => { if (TOWNS[id] != null && found == null) found = { files: TOWNS[id], origin: [x * PART_SIZE, y * PART_SIZE, z * PART_SIZE] }; });
        if (found == null) return;
        const mine = town = { owner, files: found.files, origin: found.origin, data: null, mesh: null };
        loadTown(found.files).then(data => { if (town === mine) mine.data = data; }).catch(e => console.error('Apex: town scenery unavailable', e));
      } catch (e) { console.error('Apex: town scenery unavailable', e); }
    },
    trackEnd(owner) {
      if (town != null && town.owner === owner) removeTown();
    },

    // Each frame: the ground colour tells which environment is shown; recolour and replant when it changes
    frame() {
      try { showTown(); } catch (e) { console.error('Apex: town scenery failed', e); removeTown(); }
      if (current == null) return;
      if (current.mesh.parent == null) { current = null; return; }        // mountains were cleared
      if (current.mesh.material.color.getHex() !== current.hex) {
        try { rebuild(); } catch (e) { console.error('Apex: scenery rebuild failed', e); current = null; }
      }
    },
  };
})();
