// Apex graphics: light-weight visual changes to the world (not the cars, not the physics).
//
//   - shadows: softer edges, slightly deeper
//   - sky: deeper gradient, glow around the sun, brighter clouds
//   - ambiances: time-of-day presets (sky, sun and sky-light colours) picked from the home screen.
//     They only change colours, so they cost nothing; "day" leaves the game's own lighting alone.
//   - track models: smooth shading on curved surfaces (turns, slopes, loops, barriers, pillars)
//     instead of visible facets. Only the shading normals change, computed once when the game
//     loads: the geometry is the one the physics collides with and is left exactly as it is.
//   - loading: the track parts' vertices smoothed and merged with integer keys (no string per vertex),
//     and the circuits' Winter and Desert colours only built when a track asks for them.
//
// Nothing here adds per-pixel work besides the shadow filter.
// The game calls into window.ApexGfx from the hooks added by patch_bundle.js.
(() => {
  'use strict';

  const PCF_SOFT_SHADOW_MAP = 2;    // THREE.PCFSoftShadowMap

  const LOOK = {
    shadow: { intensity: 0.74, radius: 2.5 },
    smoothAngle: 50,                // degrees: faces meeting at a flatter angle than this are shaded as one curved surface
  };

  // Colours are display (sRGB) values. sun / sky / ground / fog are left out of "day": the game's own are used.
  const AMBIANCES = {
    day: {
      label: ['Jour', 'Day'],
      horizon: [0.78, 0.89, 1.0], zenith: [0.05, 0.36, 0.90], glow: [1.0, 0.84, 0.60], clouds: [0.97, 0.98, 1.0], cloudDensity: 0.6,
    },
    golden: {
      label: ['Heure dorée', 'Golden hour'],
      horizon: [1.0, 0.80, 0.56], zenith: [0.22, 0.44, 0.82], glow: [1.0, 0.72, 0.36], clouds: [1.0, 0.88, 0.72], cloudDensity: 0.6,
      sun: [1.0, 0.80, 0.56, 4.9], sky: [0.50, 0.58, 0.86, 4.2], ground: [0.80, 0.66, 0.52], fog: [1.0, 0.84, 0.66],
    },
    dusk: {
      label: ['Crépuscule', 'Dusk'],
      horizon: [0.98, 0.56, 0.42], zenith: [0.10, 0.12, 0.38], glow: [1.0, 0.50, 0.30], clouds: [0.92, 0.62, 0.62], cloudDensity: 0.62,
      sun: [1.0, 0.60, 0.44, 3.6], sky: [0.34, 0.36, 0.70, 4.0], ground: [0.56, 0.44, 0.50], fog: [0.86, 0.56, 0.50],
    },
    overcast: {
      label: ['Couvert', 'Overcast'],
      horizon: [0.80, 0.83, 0.86], zenith: [0.50, 0.56, 0.64], glow: [0.9, 0.9, 0.9], clouds: [0.80, 0.82, 0.85], cloudDensity: 0.86,
      sun: [0.95, 0.97, 1.0, 2.4], sky: [0.78, 0.82, 0.92, 5.8], ground: [0.62, 0.62, 0.62], fog: [0.80, 0.83, 0.86],
    },
  };
  const STORAGE_KEY = 'goofytrack_ambiance';
  let ambiance = 'day';
  const loadAmbiance = () => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved in AMBIANCES) ambiance = saved; } catch (e) { /* storage unavailable */ } };
  loadAmbiance();
  // the account's save, come down as the game starts (apex-account.js)
  window.addEventListener('apex-account-save', () => {
    loadAmbiance();
    const button = document.querySelector('#ui .apex-ambiance');
    if (button) button.textContent = ambianceLabel();
    applySky();
    applied = null;
  });
  let skyMaterial = null;
  let applied = null;             // ambiance currently applied to lights and fog
  const originals = new WeakMap(); // light or fog -> the game's own colours

  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const ambianceLabel = () => (french() ? 'Ambiance : ' : 'Mood: ') + AMBIANCES[ambiance].label[french() ? 0 : 1];

  function applySky() {
    if (skyMaterial == null) return;
    const a = AMBIANCES[ambiance], u = skyMaterial.uniforms;
    u.apexHorizon.value.set(...a.horizon);
    u.apexZenith.value.set(...a.zenith);
    u.apexGlow.value.set(...a.glow);
    u.cloudLight.value.set(...a.clouds);
    u.cloudDensity.value = a.cloudDensity;
  }

  // Lights and fog: remember the game's colours the first time, then apply the preset (or restore them)
  function applyLights(scene, list) {
    const a = AMBIANCES[ambiance];
    for (const light of list) {
      if (!originals.has(light)) originals.set(light, { color: light.color.clone(), ground: light.groundColor && light.groundColor.clone(), intensity: light.intensity });
      const o = originals.get(light);
      if (light.isHemisphereLight) {
        if (a.sky) { light.color.setRGB(a.sky[0], a.sky[1], a.sky[2], 'srgb'); light.groundColor.setRGB(...a.ground, 'srgb'); light.intensity = a.sky[3]; }
        else { light.color.copy(o.color); light.groundColor.copy(o.ground); light.intensity = o.intensity; }
      } else if (a.sun) { light.color.setRGB(a.sun[0], a.sun[1], a.sun[2], 'srgb'); light.intensity = a.sun[3]; }
      else { light.color.copy(o.color); light.intensity = o.intensity; }
    }
    if (scene.fog != null) {
      if (!originals.has(scene.fog)) originals.set(scene.fog, { color: scene.fog.color.clone() });
      if (a.fog) scene.fog.color.setRGB(...a.fog, 'srgb'); else scene.fog.color.copy(originals.get(scene.fog).color);
    }
  }

  // "Ambiance" button in the home screen's bottom bar
  function addMenuButton() {
    const bar = document.querySelector('#ui .menu-ui > .button-bar');
    if (bar == null || bar.querySelector('.apex-ambiance') != null) return;
    const button = document.createElement('button');
    button.className = 'button apex-ambiance';
    button.textContent = ambianceLabel();
    button.addEventListener('click', () => {
      const names = Object.keys(AMBIANCES);
      ambiance = names[(names.indexOf(ambiance) + 1) % names.length];
      try { localStorage.setItem(STORAGE_KEY, ambiance); } catch (e) { /* storage unavailable */ }
      button.textContent = ambianceLabel();
      applySky();
      applied = null;
    });
    bar.insertBefore(button, bar.querySelector('.right'));
  }
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(addMenuButton).observe(document.getElementById('ui'), { childList: true, subtree: true });
  });

  let lights = { scanned: -1, list: [] };
  let gameRenderer = null;

  function sceneLights(scene) {
    // Lights sit directly in the scene; rescan only when its content changes.
    if (lights.scanned !== scene.children.length) {
      lights = { scanned: scene.children.length, list: scene.children.filter(o => o.isDirectionalLight || o.isHemisphereLight) };
      applied = null;
    }
    return lights.list;
  }

  const smoothed = new Map();    // normals already worked out for the big meshes, see smooth()
  window.ApexGfx = {
    look: LOOK, // tweakable live from the console

    // Renderer created (game = the game's own wrapper around the three.js renderer)
    init(renderer, game) {
      renderer.shadowMap.type = PCF_SOFT_SHADOW_MAP;
      gameRenderer = game;
    },

    // For other modules: a new material must be declared to the game (its shadow system patches shaders),
    // and textures are built with the class the sky's cloud texture is made of.
    registerMaterial(material) { if (gameRenderer != null) gameRenderer.addMaterial(material); },
    makeTexture(image) { return skyMaterial == null ? null : new skyMaterial.uniforms.sampler.value.constructor(image); },

    // Before each frame: the game recreates its lights and fog when settings change
    frame(renderer, scene) {
      const list = sceneLights(scene);
      for (const light of list) {
        if (!light.castShadow || light.shadow.intensity === LOOK.shadow.intensity) continue;
        light.shadow.intensity = LOOK.shadow.intensity;
        light.shadow.radius = LOOK.shadow.radius;
      }
      const key = ambiance + (scene.fog != null ? '+fog' : '');
      if (applied !== key) { applyLights(scene, list); applied = key; }
    },

    // Sky dome material, before its first compilation
    sky(material) {
      let f = material.fragmentShader;
      f = f.replace('vec3 horizonColor = vec3(255.0 / 255.0, 255.0 / 255.0, 255.0 / 255.0);', 'vec3 horizonColor = apexHorizon;');
      f = f.replace('vec3 zenithColor = vec3(5.0 / 255.0, 140.0 / 255.0, 255.0 / 255.0);', 'vec3 zenithColor = apexZenith;');
      f = f.replace('pow(clamp(fPos.y / 1000000.0, 0.01, 1.0), 0.2)', 'pow(clamp(fPos.y / 1000000.0, 0.0, 1.0), 0.42)');
      // warm halo around the sun, wide and faint plus tight and bright
      f = f.replace('vec3 normal = normalize(-fPos);', `vec3 normal = normalize(-fPos);
        float apexSun = max(0.0, dot(normal, sunPosition));
        skyColor += apexGlow * (pow(apexSun, 6.0) * 0.14 + pow(apexSun, 90.0) * 0.45);`);
      material.fragmentShader = 'uniform vec3 apexHorizon;\nuniform vec3 apexZenith;\nuniform vec3 apexGlow;\n' + f;
      // colours live in uniforms so the ambiance can change without recompiling the sky
      for (const name of ['apexHorizon', 'apexZenith', 'apexGlow']) material.uniforms[name] = { value: material.uniforms.cloudLight.value.clone() };
      material.needsUpdate = true;
      skyMaterial = material;
      applySky();
    },

    // Track part geometry (triangle soup with one flat normal per face), right after the game computed
    // its normals. Vertices sharing a position get the area-weighted average of the neighbouring face
    // normals that lie within the crease angle; sharper edges stay crisp. Positions are not touched.
    smooth(geometry) {
      const position = geometry.attributes.position, normal = geometry.attributes.normal;
      if (position == null || normal == null || geometry.index != null) return;
      const P = position.array, N = normal.array, count = position.count;
      // The game asks several times for the same big meshes (the circuits' roads): the answer is kept.
      // (The game replaces Math by its own, slower, deterministic one: lengths are taken with ** 0.5 here.)
      const key = count > 20000 ? count + ':' + P[0] + ':' + P[count] + ':' + P[2 * count] + ':' + P[3 * count - 1] : null;
      if (key != null && smoothed.has(key)) { N.set(smoothed.get(key)); normal.needsUpdate = true; return; }
      const cosLimit = Math.cos(LOOK.smoothAngle * Math.PI / 180);

      // Area-weighted normal of every triangle (one per triangle), and its length
      const triangles = count / 3 | 0;
      const face = new Float32Array(triangles * 3), faceLength = new Float32Array(triangles);
      for (let t = 0; t < triangles; t++) {
        const a = t * 9, b = a + 3, c = a + 6;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        face[t * 3] = nx; face[t * 3 + 1] = ny; face[t * 3 + 2] = nz;
        faceLength[t] = (nx * nx + ny * ny + nz * nz) ** 0.5;
      }

      // Vertices at the same place (to the millimetre), as linked lists: head of each group, next vertex in it.
      // Integers in a hash table rather than strings in a Map: the circuits have hundreds of thousands of
      // vertices, and the strings kept the garbage collector busy for seconds as the game loaded.
      const mm = x => { const r = x * 1000; return r >= 0 ? (r + 0.5) | 0 : -((0.5 - r) | 0); };
      const qx = new Int32Array(count), qy = new Int32Array(count), qz = new Int32Array(count);
      let size = 1;
      while (size < count * 2) size *= 2;
      const table = new Int32Array(size).fill(-1), next = new Int32Array(count).fill(-1), heads = [];
      for (let v = 0; v < count; v++) {
        const x = qx[v] = mm(P[v * 3]), y = qy[v] = mm(P[v * 3 + 1]), z = qz[v] = mm(P[v * 3 + 2]);
        let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
        for (;;) {
          const h = table[slot];
          if (h < 0) { table[slot] = v; heads.push(v); break; }
          if (qx[h] === x && qy[h] === y && qz[h] === z) { next[v] = next[h]; next[h] = v; break; }
          slot = (slot + 1) & (size - 1);
        }
      }

      const out = new Float32Array(N.length);
      for (const head of heads) {
        for (let v = head; v >= 0; v = next[v]) {
          const f = v / 3 | 0, fx = face[f * 3], fy = face[f * 3 + 1], fz = face[f * 3 + 2], fl = faceLength[f];
          let sx = 0, sy = 0, sz = 0;
          if (fl > 0) {
            for (let w = head; w >= 0; w = next[w]) {
              const g = w / 3 | 0, gx = face[g * 3], gy = face[g * 3 + 1], gz = face[g * 3 + 2], gl = faceLength[g];
              if (gl > 0 && (fx * gx + fy * gy + fz * gz) / (fl * gl) >= cosLimit) { sx += gx; sy += gy; sz += gz; }
            }
          }
          const sl = (sx * sx + sy * sy + sz * sz) ** 0.5;
          if (sl > 0) { out[v * 3] = sx / sl; out[v * 3 + 1] = sy / sl; out[v * 3 + 2] = sz / sl; }
          else { out[v * 3] = N[v * 3]; out[v * 3 + 1] = N[v * 3 + 1]; out[v * 3 + 2] = N[v * 3 + 2]; }
        }
      }
      N.set(out);
      normal.needsUpdate = true;
      if (key != null) smoothed.set(key, out);
    },

    // The colours of a part (colour id -> its mesh) that can be built later: defer(id, build) keeps the function,
    // and get() builds the mesh the first time it is asked for (patch_bundle.js). Parts as big as a circuit wait.
    LazyMap: class extends Map {
      defer(key, build) { this.set(key, null); (this.builds ??= new Map()).set(key, build); }
      get(key) {
        const build = this.builds?.get(key);
        if (build != null) { this.builds.delete(key); this.set(key, build()); }
        return super.get(key);
      }
      *values() { for (const key of this.keys()) yield this.get(key); }
      *entries() { for (const key of this.keys()) yield [key, this.get(key)]; }
      [Symbol.iterator]() { return this.entries(); }
      forEach(f, self) { for (const [key, value] of this.entries()) f.call(self, value, key, this); }
    },
    deferColour: geometry => geometry.attributes.position.count > 100000,

    // Track part geometry, smoothed above, made indexed for drawing: the same as three.js's mergeVertices
    // (tolerance 1e-4: every component rounded the same way, vertices kept in the order they first come, the
    // values of the first one kept), with integer keys in a hash table instead of a string per vertex.
    // Geometries it was not written for (indexed, interleaved, normalized, morphed) go to three.js's own.
    merge(geometry, original) {
      const names = Object.keys(geometry.attributes);
      const attributes = names.map(n => geometry.attributes[n]);
      if (geometry.index != null || Object.keys(geometry.morphAttributes).length > 0
        || attributes.some(a => a.isInterleavedBufferAttribute || a.normalized || a.array == null || a.itemSize > 4)) return original(geometry);
      const count = geometry.attributes.position.count;
      if (attributes.some(a => a.count !== count)) return original(geometry);
      // ~~(value * 1e4 + 0.5), as three.js does
      const width = attributes.reduce((s, a) => s + a.itemSize, 0), q = new Int32Array(count * width);
      for (let v = 0, o = 0; v < count; v++) {
        for (const a of attributes) {
          const A = a.array, s = a.itemSize;
          for (let k = 0; k < s; k++) q[o++] = ~~(A[v * s + k] * 1e4 + 0.5);
        }
      }
      let size = 1;
      while (size < count * 2) size *= 2;
      const table = new Int32Array(size).fill(-1);   // slot -> new vertex
      const first = new Int32Array(count);           // new vertex -> the old one it comes from
      const index = new Array(count);
      let unique = 0;
      for (let v = 0; v < count; v++) {
        const o = v * width;
        let h = 0x811c9dc5;
        for (let k = 0; k < width; k++) h = Math.imul(h ^ q[o + k], 16777619);
        let slot = h & (size - 1);
        for (;;) {
          const u = table[slot];
          if (u < 0) { table[slot] = unique; first[unique] = v; index[v] = unique++; break; }
          const p = first[u] * width;
          let same = true;
          for (let k = 0; k < width; k++) if (q[p + k] !== q[o + k]) { same = false; break; }
          if (same) { index[v] = u; break; }
          slot = (slot + 1) & (size - 1);
        }
      }
      const result = geometry.clone();
      names.forEach((n, i) => {
        const a = attributes[i], s = a.itemSize, A = a.array, out = new A.constructor(unique * s);
        for (let u = 0; u < unique; u++) for (let k = 0; k < s; k++) out[u * s + k] = A[first[u] * s + k];
        result.setAttribute(n, new a.constructor(out, s, a.normalized));
      });
      result.setIndex(index);
      return result;
    },
  };
})();
