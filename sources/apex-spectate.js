// Apex spectate: other cameras than the one behind your own car
//
//   1. Spectator     in a room, "Regarder" on the room board (or in the room list) parks your car, hides it from the
//                    others and puts the camera on another player (apex-room.js runs it): ← → (Q D) changes player,
//                    C the view (behind, wide, onboard, TV), F the free camera
//   2. Free camera   flies anywhere: Z Q S D (W A S D) or the arrows, E and A (E and Q) up and down, Shift faster, the
//                    wheel sets the speed, drag the mouse to look around. While watching a room, and in the replay
//                    viewer (F, or its button)
//
// Like apex-show.js it only moves the camera for the picture being drawn: the game's own camera is put back right
// after each frame (hooks added by patch_bundle.js around the renderer's draw call), so nothing of the game depends on
// what is shown here. The race intro and the podium (apex-show.js) come first.
(() => {
  'use strict';

  const VIEWS = [                     // what the camera does when it follows a car
    { key: 'chase', back: 6.4, up: 2.2 },
    { key: 'wide', back: 14, up: 5.5 },
    { key: 'onboard' },               // the car's own cockpit camera
    { key: 'tv' },                    // fixed points beside the road, the camera turning to watch the car go by
  ];
  const TV_AHEAD = 48, TV_SIDE = 12, TV_UP = 4.5, TV_RANGE = 75;   // metres
  const JUMP = 30;                    // metres in one frame: a respawn, the camera does not glide there
  const FREE_SPEED = 22;              // metres per second, Shift: five times as fast
  const LOOK = 0.0045;                // radians per pixel the mouse moves
  const TAG_RANGE = 160;              // metres: name tags of the cars seen from further are left as the game had them

  const TEXTS = {
    fr: { watching: 'SPECTATEUR', free: 'CAMÉRA LIBRE', nobody: 'En attente d\'un pilote', driver: 'pilote', view: 'vue',
      freeCam: 'Caméra libre', back: 'Suivre un pilote', leave: 'Reprendre le volant', quit: 'quitter', move: 'bouger',
      upDown: 'monter, descendre', fast: 'vite', wheel: 'molette : vitesse', drag: 'glisser : regarder', shift: 'Maj', esc: 'Échap',
      views: { chase: 'Poursuite', wide: 'Large', onboard: 'Embarquée', tv: 'TV' } },
    en: { watching: 'SPECTATOR', free: 'FREE CAMERA', nobody: 'Waiting for a driver', driver: 'driver', view: 'view',
      freeCam: 'Free camera', back: 'Follow a driver', leave: 'Back to driving', quit: 'leave', move: 'move',
      upDown: 'up, down', fast: 'fast', wheel: 'wheel: speed', drag: 'drag: look', shift: 'Shift', esc: 'Esc', views: { chase: 'Chase', wide: 'Wide', onboard: 'Onboard', tv: 'TV' } },
  };
  const T = () => TEXTS[(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'];

  // the keys, by their place on the keyboard (event.code): the letters move with the layout (Z Q S D on AZERTY)
  const MOVES = {
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyE: 'up', PageUp: 'up', KeyQ: 'down', PageDown: 'down', ShiftLeft: 'fast', ShiftRight: 'fast',
  };

  let source = null;       // what is watched: { kind: 'room' | 'replay', owner, cars() -> [{ id, name, info, car }], leave() }
  let mode = 'off';        // 'follow' (a room), 'free', or 'off' (the game's camera)
  let targetId = null, view = 0;
  let follow = { id: null, eye: null, heading: 0, last: null, tv: null, tvSide: 1, zoom: 1 };
  let freeCam = { p: [0, 20, 0], yaw: 0, pitch: 0, speed: 1 };
  let shown = null;        // the camera of the last picture: { p, q }, where the free camera starts from
  let saved = null, savedTags = [];
  let overlay = null, overlayKey = '', lastAt = 0, lastList = [];
  const held = new Set();
  let drag = null;

  const rotate = (q, v) => {
    const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const mixAngle = (a, b, k) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * k;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

  // ================================================================== camera
  function before(scene, camera) {
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastAt) / 1000));
    lastAt = now;
    if (source == null || mode === 'off' || (window.ApexShow && window.ApexShow.active())) { remember(camera); render(); return; }
    saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    const placed = mode === 'free' ? placeFree(camera, dt) : placeFollow(camera, dt);
    if (!placed) { after(camera); remember(camera); render(); return; }
    camera.updateMatrixWorld(true);
    remember(camera);
    showTags(camera);
    render();
  }
  function after(camera) {
    for (const [tag, visible, quaternion] of savedTags) { tag.visible = visible; tag.quaternion.copy(quaternion); tag.updateMatrixWorld(true); }
    savedTags = [];
    if (saved == null) return;
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.updateMatrixWorld(true);
    saved = null;
  }
  function remember(camera) {
    const p = camera.position, q = camera.quaternion;
    shown = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
  }

  function placeFree(camera, dt) {
    const c = freeCam, cp = Math.cos(c.pitch);
    const forward = [-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp], right = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
    const m = [0, 0, 0], add = (v, s) => { m[0] += v[0] * s; m[1] += v[1] * s; m[2] += v[2] * s; };
    if (held.has('forward')) add(forward, 1);
    if (held.has('back')) add(forward, -1);
    if (held.has('right')) add(right, 1);
    if (held.has('left')) add(right, -1);
    if (held.has('up')) m[1] += 1;
    if (held.has('down')) m[1] -= 1;
    const length = Math.hypot(m[0], m[1], m[2]);
    if (length > 0) {
      const step = FREE_SPEED * c.speed * (held.has('fast') ? 5 : 1) * dt / length;
      c.p[0] += m[0] * step; c.p[1] += m[1] * step; c.p[2] += m[2] * step;
    }
    camera.position.set(c.p[0], c.p[1], c.p[2]);
    camera.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    return true;
  }
  function startFree() {
    if (shown != null) {
      const f = rotate(shown.q, [0, 0, -1]);
      freeCam.p = shown.p.slice();
      freeCam.yaw = Math.atan2(-f[0], -f[2]);
      freeCam.pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
    }
    held.clear();
  }

  // The car being followed: the one picked, the first of the list when it is gone
  function target() {
    const list = source.cars();
    lastList = list;
    return list.find(c => c.id === targetId) || list[0] || null;
  }
  function placeFollow(camera, dt) {
    const t = target();
    if (t == null) return false;
    targetId = t.id;
    const p = t.car.getPosition(), q = t.car.getQuaternion();
    const P = [p.x, p.y, p.z], Q = [q.x, q.y, q.z, q.w], f = rotate(Q, [0, 0, 1]);
    const snap = follow.id !== t.id || follow.last == null || dist(follow.last, P) > JUMP;
    follow.id = t.id;
    follow.last = P;
    const v = VIEWS[view];
    const heading = Math.atan2(f[0], f[2]);
    follow.heading = snap ? heading : mixAngle(follow.heading, heading, ease(dt, 5));
    if (v.key === 'onboard' && t.car.cameraCockpit != null && !t.car.hasFinished()) {
      // the game only moves the cameras of the car being driven: this one's, for this picture
      t.car.updateCameras(dt);
      const cockpit = t.car.cameraCockpit;
      camera.position.copy(cockpit.position);
      camera.quaternion.copy(cockpit.quaternion);
      follow.eye = null;
      return true;
    }
    if (v.key === 'tv') {
      if (snap || follow.tv == null || dist(follow.tv, P) > TV_RANGE) {
        // the next point ahead of the car, on one side of the road then the other
        follow.tvSide = -follow.tvSide;
        const side = Math.hypot(f[0], f[2]) > 1e-3 ? [f[2] / Math.hypot(f[0], f[2]), 0, -f[0] / Math.hypot(f[0], f[2])] : [1, 0, 0];
        const ahead = snap ? TV_AHEAD * 0.4 : TV_AHEAD;
        follow.tv = [0, 1, 2].map(k => P[k] + f[k] * ahead + side[k] * TV_SIDE * follow.tvSide + (k === 1 ? TV_UP : 0));
      }
      camera.position.set(follow.tv[0], follow.tv[1], follow.tv[2]);
      camera.lookAt(P[0], P[1] + 0.6, P[2]);
      follow.eye = null;
      return true;
    }
    const shape = v.back != null ? v : VIEWS[0];       // onboard after the finish: from behind
    const back = shape.back * follow.zoom, up = shape.up * follow.zoom;
    const want = [P[0] - Math.sin(follow.heading) * back, P[1] + up, P[2] - Math.cos(follow.heading) * back];
    follow.eye = snap || follow.eye == null ? want : mix(follow.eye, want, ease(dt, 10));
    camera.position.set(follow.eye[0], follow.eye[1], follow.eye[2]);
    camera.lookAt(P[0], P[1] + 0.9, P[2]);
    return true;
  }

  // The game shows the name tags near its own camera and turns them to it: here, those near ours, turned to ours
  // (not the one of the car followed, which would sit in the middle of the picture)
  function showTags(camera) {
    const opacity = window.ApexHud ? window.ApexHud.tagOpacity() : 1;
    for (const c of mode === 'follow' ? lastList : source.cars()) {
      const tag = c.car.apexTag ? c.car.apexTag() : null;
      if (tag == null) continue;
      const followed = mode === 'follow' && c.id === targetId;
      if (!followed && camera.position.distanceTo(tag.position) > TAG_RANGE) continue;
      savedTags.push([tag, tag.visible, tag.quaternion.clone()]);
      tag.visible = !followed && opacity > 0;
      if (tag.visible) tag.lookAt(camera.position);
      tag.updateMatrixWorld(true);
    }
  }

  // ================================================================== controls
  function setMode(next) {
    if (next === mode) return;
    if (next === 'free') startFree();
    if (next === 'follow') follow.id = null;          // glide-free start behind the car
    mode = next;
    held.clear();
    drag = null;
    render();
  }
  function cycle(step) {
    const list = source.cars();
    if (list.length === 0) return;
    const i = list.findIndex(c => c.id === targetId);
    targetId = list[((i < 0 ? 0 : i + step) % list.length + list.length) % list.length].id;
    render();
  }
  function nextView() { view = (view + 1) % VIEWS.length; follow.tv = null; follow.id = null; render(); }
  function toggleFree() {
    if (mode === 'free') setMode(source.kind === 'room' ? 'follow' : 'off');
    else setMode('free');
  }

  const typing = e => e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') != null;
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  function onKey(e) {
    if (source == null || typing(e) || document.querySelector('#ui .settings-menu-ui') != null) return;
    const down = e.type === 'keydown', code = e.code;
    if (down && code === 'KeyF') { if (!e.repeat) toggleFree(); eat(e); return; }
    if (mode === 'free') {
      if (down && code === 'Escape' && source.kind === 'replay') { setMode('off'); eat(e); return; }
      const move = MOVES[code];
      if (move != null) { if (down) held.add(move); else held.delete(move); eat(e); }
      return;
    }
    if (mode !== 'follow') return;
    if (code === 'ArrowRight' || code === 'KeyD') { if (down && !e.repeat) cycle(1); eat(e); }
    else if (code === 'ArrowLeft' || code === 'KeyA') { if (down && !e.repeat) cycle(-1); eat(e); }
    else if (code === 'KeyC' || code === 'KeyV') { if (down && !e.repeat) nextView(); eat(e); }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', () => { held.clear(); drag = null; });

  const onCanvas = e => e.target instanceof HTMLCanvasElement;
  window.addEventListener('mousedown', e => {
    if (source == null || mode !== 'free' || !onCanvas(e) || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('mousemove', e => {
    if (drag == null) return;
    freeCam.yaw -= (e.clientX - drag.x) * LOOK;
    freeCam.pitch = Math.max(-1.55, Math.min(1.55, freeCam.pitch - (e.clientY - drag.y) * LOOK));
    drag = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('mouseup', () => { drag = null; }, true);
  window.addEventListener('wheel', e => {
    if (source == null || !onCanvas(e) || e.deltaY === 0) return;
    const k = e.deltaY > 0 ? 1 / 1.18 : 1.18;
    if (mode === 'free') freeCam.speed = Math.max(0.1, Math.min(12, freeCam.speed * k));
    else if (mode === 'follow') follow.zoom = Math.max(0.55, Math.min(3, follow.zoom / k));
    else return;
    render();
  }, { capture: true, passive: true });

  // ================================================================== overlay
  const keyName = code => (window.ApexHud && window.ApexHud.keyLabel(code)) || ({ ShiftLeft: T().shift }[code] || code.replace(/^Key/, ''));
  const el = (parent, tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  const hint = (parent, keys, label) => {
    const h = el(parent, 'span', 'hint');
    for (const k of keys) el(h, 'kbd', null, k);
    el(h, null, null, label);
    return h;
  };
  const button = (parent, cls, label, onClick) => {
    const b = el(parent, 'button', cls, label);
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return b;
  };

  // Drawn again only when what it shows changes (it is asked every frame)
  function render() {
    const ui = document.getElementById('ui');
    if (source == null || ui == null || (window.ApexShow && window.ApexShow.active() && source.kind === 'room')) { removeOverlay(); return; }
    const t = mode === 'follow' ? lastList.find(c => c.id === targetId) || null : null;
    const key = [source.kind, mode, view, t && t.id, t && t.name, t && t.info, lastList.length, freeCam.speed.toFixed(1), apexLanguageKey()].join('|');
    if (overlay != null && overlay.isConnected && key === overlayKey) return;
    overlayKey = key;
    if (overlay == null || !overlay.isConnected) { overlay = el(null, 'div'); ui.appendChild(overlay); }
    overlay.className = 'apex-spectate ' + source.kind + ' ' + mode;
    overlay.textContent = '';
    const tx = T();
    if (mode === 'off') {                       // the replay viewer, before the free camera
      button(overlay, 'open', tx.freeCam, () => setMode('free')).appendChild(el(null, 'kbd', null, 'F'));
      return;
    }
    const head = el(overlay, 'div', 'head');
    el(head, 'span', 'badge', mode === 'free' ? tx.free : tx.watching);
    if (mode === 'follow') {
      if (lastList.length > 1) button(head, 'step', '‹', () => cycle(-1));
      el(head, 'span', 'name', t ? t.name : tx.nobody);
      if (t && t.info) el(head, 'span', 'info', t.info);
      if (lastList.length > 1) button(head, 'step', '›', () => cycle(1));
    } else el(head, 'span', 'info', '×' + freeCam.speed.toFixed(1));
    const keys = el(overlay, 'div', 'keys');
    if (mode === 'follow') {
      if (lastList.length > 1) hint(keys, [keyName('KeyA'), keyName('KeyD')], tx.driver);
      hint(keys, [keyName('KeyC')], tx.view + ' : ' + tx.views[VIEWS[view].key]);
      hint(keys, ['F'], tx.freeCam.toLowerCase());
    } else {
      hint(keys, [keyName('KeyW'), keyName('KeyA'), keyName('KeyS'), keyName('KeyD')], tx.move);
      hint(keys, [keyName('KeyE'), keyName('KeyQ')], tx.upDown);
      hint(keys, [keyName('ShiftLeft')], tx.fast);
      el(keys, 'span', 'hint', tx.wheel);
      el(keys, 'span', 'hint', tx.drag);
      hint(keys, source.kind === 'replay' ? ['F', tx.esc] : ['F'], tx.quit);
    }
    const actions = el(overlay, 'div', 'actions');
    if (mode === 'follow') button(actions, '', tx.views[VIEWS[(view + 1) % VIEWS.length].key], nextView);
    if (source.kind === 'room') button(actions, '', mode === 'free' ? tx.back : tx.freeCam, toggleFree);
    else button(actions, '', tx.quit, () => setMode('off'));
    if (source.kind === 'room' && source.leave) button(actions, 'leave', tx.leave, () => source.leave());
  }
  const apexLanguageKey = () => (window.apexLanguage || navigator.language || '').slice(0, 2);
  function removeOverlay() {
    if (overlay != null) { overlay.remove(); overlay = null; }
    overlayKey = '';
  }

  function close() {
    source = null; mode = 'off'; lastList = []; held.clear(); drag = null; follow.id = null; follow.tv = null;
    removeOverlay();
  }

  window.ApexSpectate = {
    before, after,
    active: () => source != null && mode !== 'off',
    debug: () => ({ source: source && source.kind, mode, targetId, view: VIEWS[view].key, cars: lastList.map(c => c.id), freeCam, follow: { zoom: follow.zoom } }),

    // A room: watch the cars of the others. cars() -> [{ id, name, info, car }], leave(): back to driving
    watch(owner, cars, leave) {
      if (source != null && source.kind === 'room' && source.owner === owner) return;
      close();
      source = { kind: 'room', owner, cars, leave };
      lastList = cars();
      mode = 'follow';
      render();
    },
    unwatch(owner) { if (source != null && source.kind === 'room' && (owner === undefined || source.owner === owner)) close(); },

    // The replay viewer: the free camera, off until F (or its button). cars() -> [{ car }]
    replay(owner, cars) { close(); source = { kind: 'replay', owner, cars: () => cars().map((c, i) => ({ id: i, car: c.car })) }; render(); },
    replayEnd(owner) { if (source != null && source.kind === 'replay' && source.owner === owner) close(); },
  };
})();
