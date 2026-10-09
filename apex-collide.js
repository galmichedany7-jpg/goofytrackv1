// Apex collisions: cars hit each other in race rooms.
//
// The physics (Bullet, compiled to WebAssembly) simulates every player's car alone in its own world,
// on that player's machine; the other cars are only drawn. This file makes them solid:
//
//   game page      the other cars are drawn where they are now (dead reckoning from their last
//                  network updates) instead of 150 ms in the past, and their position and speed are
//                  handed to the physics worker every frame
//   physics worker after every physics step (1000 per second) the player's car is tested against
//                  those cars; on contact its speed and spin are changed directly in the physics
//                  memory, the way Bullet's own applyImpulse would do it
//
// Every player only ever moves their own car. Both sides of a contact see it (each from their own
// screen) and each one pushes itself away, so the two cars bounce apart.
//
// The same file is loaded by the page (index.html) and by the worker (importScripts).
(() => {
  'use strict';

  // ------------------------------------------------------------------ shared: car footprint
  // The cars are tested as rectangles seen from above (collision mesh plus wheels), when they are
  // at about the same height. Forward is +z in the car's own frame.
  const HALF_WIDTH = 0.86, HALF_LENGTH = 1.97;
  const HEIGHT = 0.9;                // metres; cars further apart vertically pass over each other

  // Rectangle a against rectangle b: false when apart (hit.gap says by how much), else hit holds
  // the way out for a. Each is { x, z, fx, fz } (centre, unit forward direction).
  // The way out is the shallowest of the four sides, unless one is given (`side`, as returned in
  // hit.side): a contact keeps the side it started on, or two cars deep into each other would
  // suddenly be thrown out sideways.
  const AXES = [0, 0, 0, 0, 0, 0, 0, 0];
  const hit = { nx: 0, nz: 0, depth: 0, gap: 0, side: -1 };
  function overlap(a, b, side = -1) {
    AXES[0] = a.fx; AXES[1] = a.fz; AXES[2] = a.fz; AXES[3] = -a.fx;
    AXES[4] = b.fx; AXES[5] = b.fz; AXES[6] = b.fz; AXES[7] = -b.fx;
    const dx = a.x - b.x, dz = a.z - b.z;
    let best = Infinity;
    for (let k = 0; k < 8; k += 2) {
      const lx = AXES[k], lz = AXES[k + 1];
      const d = dx * lx + dz * lz;
      const reach = HALF_LENGTH * (Math.abs(a.fx * lx + a.fz * lz) + Math.abs(b.fx * lx + b.fz * lz))
        + HALF_WIDTH * (Math.abs(a.fz * lx - a.fx * lz) + Math.abs(b.fz * lx - b.fx * lz));
      const depth = reach - Math.abs(d);
      if (depth <= 0) { hit.gap = -depth; return false; }
      if (side === k || (side < 0 && depth < best)) { best = depth; const s = d < 0 ? -1 : 1; hit.nx = lx * s; hit.nz = lz * s; hit.side = k; }
    }
    hit.depth = best;
    return true;
  }

  // Where the two rectangles touch, given the way out (nx, nz) for a: the middle of the stretch
  // they share along the contact, halfway between the two faces.
  const point = { x: 0, z: 0 };
  const reach = (r, lx, lz) => HALF_LENGTH * Math.abs(r.fx * lx + r.fz * lz) + HALF_WIDTH * Math.abs(r.fz * lx - r.fx * lz);
  function contactPoint(a, b, nx, nz) {
    const tx = -nz, tz = nx;
    const at = a.x * tx + a.z * tz, bt = b.x * tx + b.z * tz, ar = reach(a, tx, tz), br = reach(b, tx, tz);
    const along = (Math.max(at - ar, bt - br) + Math.min(at + ar, bt + br)) / 2;
    const across = (a.x * nx + a.z * nz - reach(a, nx, nz) + b.x * nx + b.z * nz + reach(b, nx, nz)) / 2;
    point.x = tx * along + nx * across; point.z = tz * along + nz * across;
  }

  // Direction a car points to, seen from above (falls back to the last known one when it stands on its nose)
  function heading(q, out) {
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const l = Math.hypot(fx, fz);
    if (l > 0.2) { out.fx = fx / l; out.fz = fz / l; }
  }

  const MESSAGE = 'apexObstacles', STATUS = 'apexCollideStatus';

  // ================================================================== physics worker
  if (typeof importScripts === 'function') {
    // Contact response. A contact is a stiff damped spring along the way out, at 1000 steps a second.
    const STIFFNESS = 900;           // 1/s²: 10 m/s of closing speed is stopped in about 0.3 m
    const DAMPING = 28;              // 1/s: takes the bounce out
    const MAX_PUSH = 1500;           // m/s² cap on what one contact can do
    const FRICTION = 0.3;            // rubbing along the other car
    const SPIN = 0.5;                // share of the physical spin a hit gives (1 would be a free body)
    const ARM_GAP = 0.25;            // metres apart before a car that appeared inside yours turns solid
    const STALE_MS = 120;            // without news for this long, a car stops being moved ahead
    const SIDEWAYS = 0.15;           // share of a sideways push a car on its tyres gives way to
    const EXPECTED_MS = 400;         // an expected reaction of the other car that never shows up fades out
    const SHIFT_MS = 250;            // and so does the distance it was expected to cover
    const TELEPORT = 5;              // metres in one step: a respawn

    // Where the car's rigid body (Bullet's btRigidBody) keeps its data, found by looking at the
    // memory of PolyTrack 0.6.3's physics and checked again on every use.
    // The position the game reports is the one of the body's motion state, stored twice inside the
    // body, 64 bytes apart. (The body's own transform, 224 bytes before, is NOT always equal to it:
    // Bullet interpolates the motion state, so the two can differ in the last bits.) Offsets are
    // relative to the first of those two copies; the body is recognised by them and by its
    // angular factor (1, 1, 1) and inverse mass (three equal values) further on.
    const SECOND_COPY = 64, LINEAR_VELOCITY = 260, ANGULAR_VELOCITY = 276, INVERSE_MASS = 292, INVERSE_INERTIA_Y = 348;
    const ANGULAR_FACTOR = 492, INVERSE_MASS_VECTOR = 508;
    const RESCAN_STEPS = 250;

    // The car state the physics writes after each step: car id (4 bytes), frames (3), speed (4),
    // flags (1), finish time (3, only when finished), next checkpoint (2), position, quaternion,
    // number of collision impulses (1) and the impulses, wheel contacts, ...
    const FLAGS = 11, STATE_BYTES = 227, MAX_IMPULSES = 4;
    const SOUND_STEPS = 55;          // long enough to be in one network update (every 50 steps)

    const obstacles = new Map();     // player id -> obstacle
    const body = { carId: null, address: 0, wait: 0 };
    const own = { x: 0, z: 0, fx: 0, fz: 1 }, ownQ = { x: 0, y: 0, z: 0, w: 1 };
    let view = null, last = null, sound = null;
    // what happened lately, sent to the page once a second (shown by ApexCollide.debug())
    const status = { steps: 0, near: 0, unarmed: 0, contacts: 0, scans: 0, failedScans: 0, address: 0, cars: 0 };

    function findBody(F, x, y, z) {
      let found = 0;
      for (let i = 0, n = F.length - 150; i < n; i++) {
        if (F[i] !== x || F[i + 1] !== y || F[i + 2] !== z) continue;
        const copy = i + SECOND_COPY / 4, factor = i + ANGULAR_FACTOR / 4, mass = i + INVERSE_MASS_VECTOR / 4;
        if (F[copy] !== x || F[copy + 1] !== y || F[copy + 2] !== z) continue;
        if (F[factor] !== 1 || F[factor + 1] !== 1 || F[factor + 2] !== 1) continue;
        if (!(F[mass] > 1e-4 && F[mass] < 0.1) || F[mass + 1] !== F[mass] || F[mass + 2] !== F[mass] || F[i + INVERSE_MASS / 4] !== F[mass]) continue;
        if (found !== 0) return 0;   // two candidates (two cars on the same spot): try again later
        found = i * 4;
      }
      return found;
    }

    // Adds one collision impulse to the state, so that the game plays its crash sound (here and,
    // through the network, for the other players).
    function addImpulse(u8, ptr, finished, value) {
      const count = ptr + FLAGS + 1 + (finished ? 3 : 0) + 2 + 12 + 16;
      const n = u8[count];
      if (n >= MAX_IMPULSES) return;
      const at = count + 1 + 4 * n;
      u8.copyWithin(at + 4, at, ptr + STATE_BYTES - 4);
      view.setFloat32(at, value, true);
      u8[count] = n + 1;
    }

    globalThis.ApexCollide = {
      // Messages from the page; true when the message was one of ours.
      message(data) {
        if (data == null || data.messageType !== MESSAGE) return false;
        const seen = new Set();
        for (const o of data.cars) {
          seen.add(o.id);
          let ob = obstacles.get(o.id);
          if (ob == null || ob.epoch !== o.epoch) {
            ob = { epoch: o.epoch, armed: false, side: -1, px: 0, pz: 0, cx: 0, cz: 0, vx: o.vx, vz: o.vz };
            obstacles.set(o.id, ob);
          }
          // The reaction we expected from this car (px, pz) now shows in its real speed: what has
          // arrived is no longer expected.
          const expected = Math.hypot(ob.px, ob.pz);
          if (expected > 1e-6) {
            const arrived = ((o.vx - ob.vx) * ob.px + (o.vz - ob.vz) * ob.pz) / expected;
            const left = Math.max(0, expected - Math.max(0, arrived)) / expected;
            ob.px *= left; ob.pz *= left;
          }
          ob.x = o.x + ob.cx; ob.y = o.y; ob.z = o.z + ob.cz; ob.fx = o.fx; ob.fz = o.fz;
          ob.vx = o.vx; ob.vz = o.vz; ob.spin = o.spin; ob.age = 0;
        }
        for (const id of [...obstacles.keys()]) if (!seen.has(id)) obstacles.delete(id);
        return true;
      },

      // After each physics step of a car. `car` is the worker's record, `ptr` the state just written.
      afterStep(M, car, ptr) {
        if (car.userControls == null) return;      // replays and ghosts are left alone
        if (obstacles.size === 0) { last = null; return; }
        if (++status.steps >= 1000) {
          status.cars = obstacles.size; status.address = body.address;
          postMessage({ messageType: STATUS, status: { ...status } });
          status.steps = status.near = status.unarmed = status.contacts = status.scans = status.failedScans = 0;
        }
        const u8 = M.HEAPU8, F = M.HEAPF32;
        if (view == null || view.buffer !== u8.buffer) view = new DataView(u8.buffer);
        const finished = (u8[ptr + FLAGS] & 2) !== 0;
        const at = ptr + FLAGS + 1 + (finished ? 3 : 0) + 2;
        const x = view.getFloat32(at, true), y = view.getFloat32(at + 4, true), z = view.getFloat32(at + 8, true);
        ownQ.x = view.getFloat32(at + 12, true); ownQ.y = view.getFloat32(at + 16, true);
        ownQ.z = view.getFloat32(at + 20, true); ownQ.w = view.getFloat32(at + 24, true);

        // a respawn puts the car anywhere, maybe inside another one: nothing is solid until clear of it
        if (last == null || last.id !== car.id || Math.hypot(x - last.x, y - last.y, z - last.z) > TELEPORT) {
          for (const ob of obstacles.values()) ob.armed = false;
          sound = null;
        }
        last = { id: car.id, x, y, z };
        if (sound != null) { addImpulse(u8, ptr, finished, sound.value); if (--sound.steps <= 0) sound = null; }
        if (finished) return;

        own.x = x; own.z = z;
        heading(ownQ, own);

        let address = 0;                            // looked up only when a car is close
        for (const ob of obstacles.values()) {
          // the other car keeps moving between two messages from the page
          if (ob.age < STALE_MS) {
            ob.age++;
            ob.x += (ob.vx + ob.px) * 0.001; ob.z += (ob.vz + ob.pz) * 0.001;
            const c = Math.cos(ob.spin * 0.001), s = Math.sin(ob.spin * 0.001), fx = ob.fx;
            ob.fx = fx * c + ob.fz * s; ob.fz = ob.fz * c - fx * s;
          }
          ob.cx = (ob.cx + ob.px * 0.001) * (1 - 1 / SHIFT_MS); ob.cz = (ob.cz + ob.pz * 0.001) * (1 - 1 / SHIFT_MS);
          ob.px *= 1 - 1 / EXPECTED_MS; ob.pz *= 1 - 1 / EXPECTED_MS;

          const dx = x - ob.x, dz = z - ob.z;
          if (dx * dx + dz * dz > 25 || Math.abs(y - ob.y) > HEIGHT) { ob.armed = true; ob.side = -1; continue; }
          if (!overlap(own, ob, ob.side)) { if (hit.gap > ARM_GAP) ob.armed = true; ob.side = -1; continue; }
          status.near++;
          if (!ob.armed) { status.unarmed++; continue; }

          if (address === 0) {
            address = body.carId === car.id ? body.address : 0;
            const i = address >> 2;
            const valid = address !== 0 && F[i] === x && F[i + 1] === y && F[i + 2] === z;
            if (!valid) {
              if (body.carId === car.id && body.wait > 0) { body.wait--; return; }
              address = findBody(F, x, y, z);
              status.scans++; if (address === 0) status.failedScans++;
              body.carId = car.id; body.address = address; body.wait = address === 0 ? RESCAN_STEPS : 0;
              if (address === 0) return;
            }
          }
          const lv = (address + LINEAR_VELOCITY) >> 2, av = (address + ANGULAR_VELOCITY) >> 2;
          const nx = hit.nx, nz = hit.nz, depth = hit.depth;
          contactPoint(own, ob, nx, nz);
          const rx = point.x - x, rz = point.z - z, ox = point.x - ob.x, oz = point.z - ob.z;
          // speed of each car at the contact point (v + spin x r, seen from above)
          const sx = F[lv] + F[av + 1] * rz, sz = F[lv + 2] - F[av + 1] * rx;
          const tx = ob.vx + ob.px + ob.spin * oz, tz = ob.vz + ob.pz - ob.spin * ox;
          const closing = (sx - tx) * nx + (sz - tz) * nz;   // negative while the cars close in
          let push = Math.min(MAX_PUSH, STIFFNESS * depth - DAMPING * closing);
          if (ob.side < 0) {
            ob.side = hit.side;
            if (closing < -1.5) sound = { value: Math.min(4000, -closing * 400), steps: SOUND_STEPS };
          }
          status.contacts++;
          if (push <= 0) continue;
          push *= 0.001;                            // m/s gained in this step
          const sliding = -(sx - tx) * nz + (sz - tz) * nx;  // along the other car
          const rub = Math.max(-FRICTION * push, Math.min(FRICTION * push, -sliding));
          const dvx = nx * push - nz * rub, dvz = nz * push + nx * rub;
          F[lv] += dvx; F[lv + 2] += dvz;
          // the same impulse, applied at the contact point, turns the car
          const mass = 1 / F[(address + INVERSE_MASS) >> 2];
          F[av + 1] += SPIN * F[(address + INVERSE_INERTIA_Y) >> 2] * mass * (rz * dvx - rx * dvz);
          // The other car is pushed just as hard the other way. Its own machine does that, and we only
          // see it a little later: until then, count on it. Without this each car would take the whole
          // hit on its own screen and they would swap speeds like billiard balls.
          // Pushed along its length it rolls away; pushed sideways its tyres hold most of it.
          const along = dvx * ob.fx + dvz * ob.fz, across = (dvx * ob.fz - dvz * ob.fx) * SIDEWAYS;
          ob.px -= ob.fx * along + ob.fz * across; ob.pz -= ob.fz * along - ob.fx * across;
        }
      },
    };
    return;
  }

  // ================================================================== game page
  const LATENCY_MS = 50;             // guess for the trip of an update through the host
  const MAX_AHEAD_MS = 250;          // never draw a car further ahead of its last update than this
  const CATCH_UP = 10;               // 1/s: how fast the drawn car moves to the predicted one
  const JUMP = 12;                   // metres between two updates: a respawn
  const MAX_SPIN = 6;                // rad/s
  const STALE_FRAMES = 1000;         // an update this much older than the last one is late, not a restart

  const tracks = new Map();          // player id -> what we know about that car
  const ids = new WeakMap();         // the game's record of a remote car -> player id
  let physics = null, listening = null;   // last status of the worker, and the worker we listen to
  let active = false, sentEmpty = true, solid = new Set();   // solid: ids of the cars handed to the physics

  const mul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const normalize = q => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };
  // q turned by the spin w (rad/s, world frame) for t seconds
  const turned = (q, w, t) => {
    const rate = Math.hypot(w.x, w.y, w.z), angle = rate * t;
    if (angle < 1e-6) return q;
    const s = Math.sin(angle / 2) / rate;
    return normalize(mul({ x: w.x * s, y: w.y * s, z: w.z * s, w: Math.cos(angle / 2) }, q));
  };
  const blend = (a, b, k) => {
    const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
    return normalize({ x: a.x + (b.x * s - a.x) * k, y: a.y + (b.y * s - a.y) * k, z: a.z + (b.z * s - a.z) * k, w: a.w + (b.w * s - a.w) * k });
  };

  function newTrack(resetCounter) {
    return { reset: resetCounter, last: null, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, offset: Infinity, epoch: 0, shown: null, snap: true };
  }

  window.ApexCollide = {
    debug: () => ({ active, physics, cars: [...tracks].map(([id, t]) => ({ id, epoch: t.epoch, v: t.v, shown: t.shown && t.shown.p, last: t.last && t.last.position })) }),

    // Is this remote car (the game's record of it) one that can be hit right now?
    isSolid: entry => active && solid.has(ids.get(entry)),

    // A network update of another player's car
    remote(id, resetCounter, state) {
      let t = tracks.get(id);
      if (t == null) { t = newTrack(resetCounter); tracks.set(id, t); }
      const now = performance.now(), prev = t.last;
      const jumped = prev != null && Math.hypot(state.position.x - prev.position.x, state.position.y - prev.position.y, state.position.z - prev.position.z) > JUMP;
      // Updates travel on an unordered channel: one that arrives after a newer one is dropped,
      // it is not a restart.
      if (prev != null && resetCounter === t.reset && !jumped && state.frames < prev.frames && prev.frames - state.frames < STALE_FRAMES) return;
      if (resetCounter !== t.reset || prev == null || state.frames < prev.frames || jumped) {
        t.reset = resetCounter; t.epoch++; t.snap = true; t.offset = Infinity;
        t.v = { x: 0, y: 0, z: 0 }; t.w = { x: 0, y: 0, z: 0 };
      } else if (state.frames > prev.frames) {
        const dt = (state.frames - prev.frames) / 1000;
        t.v = { x: (state.position.x - prev.position.x) / dt, y: (state.position.y - prev.position.y) / dt, z: (state.position.z - prev.position.z) / dt };
        // spin from the change of orientation
        const p = prev.quaternion;
        let d = mul(state.quaternion, { x: -p.x, y: -p.y, z: -p.z, w: p.w });
        if (d.w < 0) d = { x: -d.x, y: -d.y, z: -d.z, w: -d.w };
        const sin = Math.hypot(d.x, d.y, d.z);
        const rate = sin < 1e-6 ? 0 : Math.min(MAX_SPIN, 2 * Math.atan2(sin, d.w) / dt) / sin;
        t.w = { x: d.x * rate, y: d.y * rate, z: d.z * rate };
      } else return;                                // same instant again: nothing new
      // The car's clock (frames) against ours: the smallest difference seen is the quickest trip.
      if (state.hasStarted && state.frames > 0) t.offset = Math.min(t.offset + 2, now - state.frames);
      else t.offset = Infinity;
      t.last = state;
    },

    // Every frame, for each remote car, just before the game draws it
    place(entry, dt) {
      if (!active) return;
      const t = tracks.get(ids.get(entry));
      if (t == null || t.last == null) return;
      const s = t.last;
      let ahead = 0;
      if (s.hasStarted && s.finishFrames == null && t.offset !== Infinity)
        ahead = Math.max(0, Math.min(MAX_AHEAD_MS, performance.now() - t.offset - s.frames + LATENCY_MS)) / 1000;
      const target = {
        p: { x: s.position.x + t.v.x * ahead, y: s.position.y + t.v.y * ahead, z: s.position.z + t.v.z * ahead },
        q: turned(s.quaternion, t.w, ahead),
      };
      const snap = t.snap || t.shown == null;
      if (snap) t.shown = target;
      else {
        const k = 1 - Math.exp(-dt * CATCH_UP), p = t.shown.p;
        p.x += t.v.x * dt; p.y += t.v.y * dt; p.z += t.v.z * dt;
        p.x += (target.p.x - p.x) * k; p.y += (target.p.y - p.y) * k; p.z += (target.p.z - p.z) * k;
        t.shown.q = blend(turned(t.shown.q, t.w, dt), target.q, k);
      }
      t.snap = false;
      entry.car.setCarState({ ...s, position: { ...t.shown.p }, quaternion: { ...t.shown.q } }, snap);
    },

    // Every frame, after the cars were placed. `session` is null when cars must not collide,
    // else { remotes: Map(player id -> the game's record), solid: id => boolean, moving: boolean }
    // (moving: only cars that have started count).
    frame(session) {
      const worker = window.ApexSimWorker;
      active = session != null && worker != null;
      if (worker != null && listening !== worker) {
        listening = worker;
        worker.addEventListener('message', e => { if (e.data != null && e.data.messageType === STATUS) physics = e.data.status; });
      }
      if (!active) {
        if (!sentEmpty && worker != null) worker.postMessage({ messageType: MESSAGE, cars: [] });
        sentEmpty = true;
        solid.clear();
        for (const t of tracks.values()) { t.shown = null; t.snap = true; }
        if (session == null) tracks.clear();
        return;
      }
      const cars = [], f = { fx: 0, fz: 1 };
      for (const [id, entry] of session.remotes) {
        ids.set(entry, id);
        const t = tracks.get(id);
        if (t == null || t.shown == null || t.last.finishFrames != null || !session.solid(id)) continue;
        if (session.moving && !t.last.hasStarted) continue;
        heading(t.shown.q, f);
        const moving = t.last.hasStarted;
        cars.push({ id, epoch: t.epoch, x: t.shown.p.x, y: t.shown.p.y, z: t.shown.p.z, fx: f.fx, fz: f.fz,
          vx: moving ? t.v.x : 0, vz: moving ? t.v.z : 0, spin: moving ? t.w.y : 0 });
      }
      for (const id of [...tracks.keys()]) if (!session.remotes.has(id)) tracks.delete(id);
      solid = new Set(cars.map(c => c.id));
      if (cars.length === 0 && sentEmpty) return;
      worker.postMessage({ messageType: MESSAGE, cars });
      sentEmpty = cars.length === 0;
    },
  };
})();
