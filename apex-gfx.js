// Apex graphics: light-weight visual changes to the world (not the cars, not the physics).
//
//   - shadows: softer edges, slightly deeper
//   - sky: deeper gradient, glow around the sun, brighter clouds
//   - ambiances: time-of-day presets (sky, sun and sky-light colours) picked from the home screen.
//     They only change colours, so they cost nothing; "day" leaves the game's own lighting alone.
//   - track models: smooth shading on curved surfaces (turns, slopes, loops, barriers, pillars)
//     instead of visible facets. Only the shading normals change, computed once when the game
//     loads: the geometry is the one the physics collides with and is left exactly as it is.
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
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved in AMBIANCES) ambiance = saved; } catch (e) { /* storage unavailable */ }
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

  function sceneLights(scene) {
    // Lights sit directly in the scene; rescan only when its content changes.
    if (lights.scanned !== scene.children.length) {
      lights = { scanned: scene.children.length, list: scene.children.filter(o => o.isDirectionalLight || o.isHemisphereLight) };
      applied = null;
    }
    return lights.list;
  }

  window.ApexGfx = {
    look: LOOK, // tweakable live from the console

    // Renderer created
    init(renderer) {
      renderer.shadowMap.type = PCF_SOFT_SHADOW_MAP;
    },

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
      const cosLimit = Math.cos(LOOK.smoothAngle * Math.PI / 180);

      // Area-weighted face normal of every triangle
      const face = new Float32Array(count * 3);
      for (let v = 0; v < count; v += 3) {
        const a = v * 3, b = a + 3, c = a + 6;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (let k = 0; k < 3; k++) { face[(v + k) * 3] = nx; face[(v + k) * 3 + 1] = ny; face[(v + k) * 3 + 2] = nz; }
      }

      // Vertices at the same place (to the millimetre)
      const groups = new Map();
      for (let v = 0; v < count; v++) {
        const key = Math.round(P[v * 3] * 1000) + ',' + Math.round(P[v * 3 + 1] * 1000) + ',' + Math.round(P[v * 3 + 2] * 1000);
        const g = groups.get(key);
        if (g) g.push(v); else groups.set(key, [v]);
      }

      const out = new Float32Array(N.length);
      for (const group of groups.values()) {
        for (const v of group) {
          const fx = face[v * 3], fy = face[v * 3 + 1], fz = face[v * 3 + 2];
          const fl = Math.hypot(fx, fy, fz);
          let sx = 0, sy = 0, sz = 0;
          if (fl > 0) {
            for (const w of group) {
              const gx = face[w * 3], gy = face[w * 3 + 1], gz = face[w * 3 + 2];
              const gl = Math.hypot(gx, gy, gz);
              if (gl > 0 && (fx * gx + fy * gy + fz * gz) / (fl * gl) >= cosLimit) { sx += gx; sy += gy; sz += gz; }
            }
          }
          const sl = Math.hypot(sx, sy, sz);
          if (sl > 0) { out[v * 3] = sx / sl; out[v * 3 + 1] = sy / sl; out[v * 3 + 2] = sz / sl; }
          else { out[v * 3] = N[v * 3]; out[v * 3 + 1] = N[v * 3 + 1]; out[v * 3 + 2] = N[v * 3 + 2]; }
        }
      }
      N.set(out);
      normal.needsUpdate = true;
    },
  };
})();
