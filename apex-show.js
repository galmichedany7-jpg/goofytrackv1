// Apex show: the two scenes around a race (apex-room.js runs them)
//
//   1. Intro    before the lights, the camera flies round the circuit for three seconds, then dives
//               back behind the car. Space or a click skips it.
//   2. Podium   when everybody has finished, a podium stands on the start straight with the cars of
//               the first three on its steps; the camera drifts in front of it until the player
//               presses Space or clicks.
//
// Both only move the camera for the picture being drawn: the game's own camera is put back right
// after each frame (hooks added by patch_bundle.js around the renderer's draw call), so nothing of
// the game depends on what is shown here.
(() => {
  'use strict';

  const INTRO_BLEND_MS = 750;         // end of the intro: from the flight to the game's camera
  const PODIUM_BLEND_MS = 1100;       // start of the podium: from the game's camera to the podium
  const SKIP_GUARD_MS = 350;          // a key already on its way down when a scene starts does not skip it
  const CAR_HEIGHT = 0.35;            // a resting car's centre above the road

  // The podium, in its own frame: x to the right of the cars, y up, z the way the cars face
  const STEPS = [                     // rank 1 in the middle, 2 on the viewer's left, 3 on the right
    { x: 0, top: 1.5, colour: [0.92, 0.68, 0.12] },
    { x: -3.5, top: 1.0, colour: [0.72, 0.74, 0.78] },
    { x: 3.5, top: 0.6, colour: [0.66, 0.38, 0.18] },
  ];
  const STEP_HALF_WIDTH = 1.7, STEP_HALF_DEPTH = 2.7;
  const FOOT = -0.6;                  // the podium goes down into the road: its height above it is only known roughly
  const BODY = [0.9, 0.9, 0.92], DARK = [0.06, 0.07, 0.09], PANEL = [0.1, 0.12, 0.17];
  // seven-segment digits: which of the segments a b c d e f g are lit
  const DIGITS = { 1: 'bc', 2: 'abged', 3: 'abgcd' };

  const TEXTS = {
    fr: { skip: 'Espace pour passer', podium: 'PODIUM', leave: 'Espace pour continuer' },
    en: { skip: 'Space to skip', podium: 'PODIUM', leave: 'Space to continue' },
  };
  const T = () => TEXTS[(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'];

  let scene = null;        // the game's scene, seen at the last frame
  let view = null;         // the scene being shown: { kind, start, ... }
  let saved = null;        // the game's camera while ours is drawn
  let podium = null;       // { mesh, frame }
  let overlay = null;

  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const rotate = (q, v) => {
    const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };

  // ================================================================== overlay
  function showOverlay(title, hint) {
    hideOverlay();
    const ui = document.getElementById('ui');
    if (ui == null) return;
    overlay = document.createElement('div');
    overlay.className = 'apex-show' + (title ? ' podium' : '');
    ui.classList.toggle('apex-podium', !!title);                      // hides the game's own hints (apex-theme.css)
    if (title) {
      const h = document.createElement('div'); h.className = 'title'; h.textContent = title; overlay.appendChild(h);
      for (let i = 0; i < 36; i++) {                                  // confetti: plain CSS, nothing drawn in 3D
        const c = document.createElement('i');
        c.style.left = (i * 37 % 100) + '%';
        c.style.animationDelay = (-(i * 53 % 40) / 10) + 's';
        c.style.animationDuration = (3 + (i * 17 % 20) / 10) + 's';
        c.style.backgroundColor = ['#ffd23f', '#ff3b5c', '#3fb8ff', '#5be37d', '#ffffff'][i % 5];
        overlay.appendChild(c);
      }
    }
    const p = document.createElement('div'); p.className = 'hint'; p.textContent = hint; overlay.appendChild(p);
    ui.appendChild(overlay);
  }
  function hideOverlay() {
    if (overlay == null) return;
    overlay.remove(); overlay = null;
    const ui = document.getElementById('ui');
    if (ui != null) ui.classList.remove('apex-podium');
  }

  // ================================================================== skipping
  function skip(e) {
    if (view == null || performance.now() - view.start < SKIP_GUARD_MS) return;
    if (e.type === 'keydown' && (e.repeat || e.code !== 'Space')) return;
    if (e.type === 'mousedown' && e.target instanceof Element && e.target.closest('button, input, .apex-room-board') != null) return;
    const now = performance.now();
    if (view.kind === 'intro') { if (now < view.start + view.ms - INTRO_BLEND_MS) view.start = now - (view.ms - INTRO_BLEND_MS); hideOverlay(); }
    else endView();
  }
  window.addEventListener('keydown', skip, true);
  window.addEventListener('mousedown', skip, true);
  function endView() { view = null; hideOverlay(); }

  // ================================================================== camera
  // Where our camera is at time `now`, and how much of the game's own camera is mixed in (0..1)
  function introPose(now) {
    const t = (now - view.start) / view.ms, b = view.box;
    const angle = view.angle + (t - 1) * 1.9;
    const lift = 1 - 0.25 * smooth(t);
    return {
      eye: [b.cx + Math.sin(angle) * b.distance, b.top + b.distance * 0.5 * lift, b.cz + Math.cos(angle) * b.distance],
      target: [b.cx, b.cy, b.cz],
      game: smooth((now - (view.start + view.ms - INTRO_BLEND_MS)) / INTRO_BLEND_MS),
    };
  }
  function podiumPose(now) {
    const s = (now - view.start) / 1000, f = view.frame;
    const sway = Math.sin(s * 0.32) * 5.5, back = 12.5 - Math.cos(s * 0.32) * 1.5;
    return { eye: f.point(sway, 3.0 + Math.sin(s * 0.21) * 0.5, back), target: f.point(0, 1.9, 0), game: 1 - smooth((now - view.start) / PODIUM_BLEND_MS) };
  }

  function before(theScene, camera) {
    scene = theScene;
    if (view == null) return;
    const now = performance.now();
    if (view.kind === 'intro' && now >= view.start + view.ms) { endView(); return; }
    const pose = view.kind === 'intro' ? introPose(now) : podiumPose(now);
    saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
    camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    if (pose.game > 0) { camera.position.lerp(saved.position, pose.game); camera.quaternion.slerp(saved.quaternion, pose.game); }
    if (view.far > camera.far) { camera.far = view.far; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    if (view.kind === 'podium') showTags(camera);
  }
  // The game only shows a car's name tag near its own camera, and turns it towards that one: the tags of
  // the cars on the podium are shown to ours instead. (A tag is a small textured plane right above its car.)
  function showTags(camera) {
    for (const o of scene.children) {
      if (!o.isMesh || o.isInstancedMesh || o.material == null || o.material.map == null || !o.material.transparent) continue;
      if (!view.slots.some(s => Math.hypot(o.position.x - s.p[0], o.position.z - s.p[2]) < 1 && Math.abs(o.position.y - s.p[1]) < 4)) continue;
      o.visible = true;
      o.lookAt(camera.position);
      o.updateMatrixWorld(true);
    }
  }
  function after(camera) {
    if (saved == null) return;
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    if (camera.far !== saved.far) { camera.far = saved.far; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    saved = null;
  }

  // ================================================================== podium mesh
  function boxInto(out, x0, y0, z0, x1, y1, z1, colour) {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, b, c, d] of [[4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [7, 6, 2, 3], [0, 1, 5, 4]])
      for (const i of [a, b, c, a, c, d]) { out.positions.push(...P[i]); out.colors.push(...colour); }
  }
  function digitInto(out, digit, cx, cy, z, size, colour) {
    const w = size * 0.5, h = size, t = size * 0.14, d = 0.06;
    const segment = { a: [-w / 2, h / 2 - t, w / 2, h / 2], g: [-w / 2, -t / 2, w / 2, t / 2], d: [-w / 2, -h / 2, w / 2, -h / 2 + t],
      f: [-w / 2, 0, -w / 2 + t, h / 2], b: [w / 2 - t, 0, w / 2, h / 2], e: [-w / 2, -h / 2, -w / 2 + t, 0], c: [w / 2 - t, -h / 2, w / 2, 0] };
    for (const s of DIGITS[digit]) { const [x0, y0, x1, y1] = segment[s]; boxInto(out, cx + x0, cy + y0, z, cx + x1, cy + y1, z + d, colour); }
  }
  function podiumGeometry() {
    const out = { positions: [], colors: [] };
    STEPS.forEach((s, i) => {
      boxInto(out, s.x - STEP_HALF_WIDTH, FOOT, -STEP_HALF_DEPTH, s.x + STEP_HALF_WIDTH, s.top - 0.12, STEP_HALF_DEPTH, BODY);
      boxInto(out, s.x - STEP_HALF_WIDTH - 0.04, s.top - 0.12, -STEP_HALF_DEPTH - 0.04, s.x + STEP_HALF_WIDTH + 0.04, s.top, STEP_HALF_DEPTH + 0.04, s.colour);
      digitInto(out, i + 1, s.x, (s.top - 0.12) / 2 + 0.04, STEP_HALF_DEPTH, Math.min(0.9, (s.top - 0.12) * 0.66), DARK);
    });
    // a wall behind the steps, with a chequered band along its top
    const W = 6.6, H = 5.2, Z = -STEP_HALF_DEPTH - 0.5;
    boxInto(out, -W, FOOT, Z - 0.3, W, H, Z, PANEL);
    for (let i = 0; i < 22; i++) for (let j = 0; j < 2; j++)
      boxInto(out, -W + i * 0.6, H - 1.2 + j * 0.6, Z, -W + (i + 1) * 0.6, H - 0.6 + j * 0.6, Z + 0.04, (i + j) % 2 ? DARK : BODY);
    return out;
  }
  // A mesh the game can draw, made with the classes and the material of one already in its scene
  function donor() {
    // the mountains or a town's scenery: a plain lit material with a colour per vertex
    let found = null;
    scene.traverse(o => {
      if (found != null || !o.isMesh || o.isInstancedMesh || o.geometry == null || o.geometry.attributes.position == null || o.material == null) return;
      if (o.material.isMeshLambertMaterial && o.material.vertexColors && !o.material.transparent) found = o;
    });
    return found;
  }
  function buildPodium(frame) {
    removePodium();
    if (scene == null) return;
    const from = donor();
    if (from == null) return;
    const data = podiumGeometry(), positions = new Float32Array(data.positions.length);
    for (let i = 0; i < positions.length; i += 3) { const p = frame.point(data.positions[i], data.positions[i + 1], data.positions[i + 2]); positions[i] = p[0]; positions[i + 1] = p[1]; positions[i + 2] = p[2]; }
    const Attribute = from.geometry.attributes.position.constructor, geometry = new from.geometry.constructor();
    geometry.setAttribute('position', new Attribute(positions, 3));
    geometry.setAttribute('color', new Attribute(new Float32Array(data.colors), 3));
    geometry.computeVertexNormals();
    const material = from.material.clone();
    material.vertexColors = true; material.map = null; material.color.setRGB(1, 1, 1);
    if (window.ApexGfx) window.ApexGfx.registerMaterial(material);
    const mesh = new from.constructor(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    scene.add(mesh);
    podium = { mesh, material, geometry };
  }
  function removePodium() {
    if (podium == null) return;
    if (podium.mesh.parent != null) podium.mesh.parent.remove(podium.mesh);
    podium.geometry.dispose(); podium.material.dispose();
    podium = null;
  }

  window.ApexShow = {
    before, after,
    active: () => view != null,
    debug: () => ({ view: view && { kind: view.kind, since: Math.round(performance.now() - view.start) }, podium: podium != null, scene: scene != null }),

    // box: what the circuit occupies { min: [x, y, z], max: [x, y, z] }; start: where the car waits
    intro(box, start, ms) {
      const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
      const radius = Math.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2;
      const distance = Math.max(90, Math.min(1500, radius * 1.25 + (box.max[1] - box.min[1]) * 0.6));
      // the flight ends on the side the car is seen from behind, so the dive back to it is short
      const forward = rotate(start.q, [0, 0, 1]);
      view = { kind: 'intro', start: performance.now(), ms, far: distance * 4 + radius * 2,
        box: { cx, cz, cy: (box.min[1] + box.max[1]) / 2, top: box.max[1], distance }, angle: Math.atan2(start.p[0] - forward[0] * 40 - cx, start.p[2] - forward[2] * 40 - cz) };
      showOverlay(null, T().skip);
    },

    // road: a point of the road's surface { p, q } where the podium goes, facing the way q does.
    // Returns where the cars stand, best first: [{ p: [x, y, z], q: [x, y, z, w] }]
    podium(road, count) {
      const q = road.q, right = rotate(q, [1, 0, 0]), up = rotate(q, [0, 1, 0]), fwd = rotate(q, [0, 0, 1]);
      const frame = { point: (x, y, z) => [0, 1, 2].map(k => road.p[k] + right[k] * x + up[k] * y + fwd[k] * z) };
      try { buildPodium(frame); } catch (e) { console.error('Apex: could not build the podium', e); removePodium(); }
      view = { kind: 'podium', start: performance.now(), frame, far: 0, slots: [] };
      showOverlay(T().podium, T().leave);
      const slots = view.slots;
      for (let i = 0; i < count; i++) {
        // the first three on the steps, the others on the road on both sides
        const step = STEPS[i], k = i - 3;
        const p = podium == null ? frame.point((i - (count - 1) / 2) * 3, CAR_HEIGHT, 0)
          : step != null ? frame.point(step.x, step.top + CAR_HEIGHT, 0)
          : frame.point((k % 2 === 0 ? -1 : 1) * (8.4 + 2.8 * Math.floor(k / 2)), CAR_HEIGHT, 0.5);
        slots.push({ p, q: q.slice() });
      }
      return slots;
    },

    // stop(): the camera goes back to the game; clear(): the podium goes too
    stop() { endView(); },
    clear() { endView(); removePodium(); },
  };
})();
