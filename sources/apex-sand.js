// Apex sand: the gravel traps of the circuits that have some (Forest Speedway) slow the cars down, and their grass verges a little.
//
// The physics (Bullet, compiled to WebAssembly) knows one road surface only. A car whose wheels are in a gravel
// trap has its controls filtered before each physics step (1000 per second): the throttle only works on some of
// the steps, and the brakes catch on some others, as gravel would drag the car down. On the grass between the kerb
// and the barrier the throttle works less often and the brakes catch now and then, less than in the gravel.
// Steering is left alone.
//
// Only the controls are changed, from the car's own state: a replay or a record checked again gives the very
// same run, since every simulation of the car (live, ghost, replay, verification) goes through the same filter.
//
// Loaded by the physics worker (importScripts, patch_bundle.js). build.js puts the traps of each circuit in
// front of this file: self.APEX_SAND = { <road part id>: { fine: [x, z, height, ...], half: [left, right, ...], sand: [[index, left, right], ...],
// edge: [left, right, ...] (the faces of the barriers, or null) } },
// in the circuit's frame (metres, the start line at the origin; tracks/<circuit>.json).
(() => {
  'use strict';
  if (typeof importScripts !== 'function') return;

  const PART_SIZE = 5;              // metres per track unit
  const THROTTLE = 0.2;             // share of the steps on which the throttle works in the gravel
  const BRAKE = 0.3;                // share of the steps on which the brakes catch (above BRAKE_SPEED only)
  const BRAKE_SPEED = 12;           // m/s: slower than that the car rolls out (braking would reverse it)
  const HEIGHT = 1.5;               // metres: higher above the road, the car is flying over the gravel
  const CYCLE = 20;                 // steps: the pattern of throttle and brake repeats every 20 ms
  const GRASS = 0.4;                // share of the steps on which the throttle works on the grass
  const GRASS_BRAKE = 0.1;          // and on which the brakes catch there
  const LEVEL = 4;                  // metres: a point of the road further above or below the car is another stretch (a bridge)

  // the state the physics writes after each step: car id (4 bytes), frames (3), speed (4), flags (1), finish time
  // (3, only when finished), next checkpoint (2), then the position (3 floats)
  const FLAGS = 11;

  const circuits = new Map();       // road part id -> { fine, n, sandL, sandR, half, edge, boxes, reach }
  const BOX = 30;
  function prepare(id) {
    if (circuits.has(id)) return circuits.get(id);
    const data = (self.APEX_SAND || {})[id];
    let c = null;
    if (data != null) {
      const n = data.fine.length / 3, sandL = new Float32Array(n), sandR = new Float32Array(n), boxes = new Map();
      for (const [i, l, r] of data.sand) { sandL[i] = l; sandR[i] = r; }
      // only the points with a trap are looked at (all of them where there are grass verges): they are kept in 30 m boxes
      for (let i = 0; i < n; i++) if (data.edge || sandL[i] > 0 || sandR[i] > 0) {
        const k = Math.floor(data.fine[3 * i] / BOX) + ',' + Math.floor(data.fine[3 * i + 1] / BOX);
        if (!boxes.has(k)) boxes.set(k, []);
        boxes.get(k).push(i);
      }
      const widest = data.edge ? Math.max(...data.edge) : Math.max(...sandL, ...sandR) + 15;
      c = { fine: data.fine, n, sandL, sandR, half: data.half, edge: data.edge, boxes, reach: Math.ceil(widest / BOX) };
    }
    circuits.set(id, c);
    return c;
  }

  // What is (x, y, z) of the circuit's frame on? 'sand' in a gravel trap (beyond the kerb, 0.8 m past the asphalt,
  // inside the trap, on it), 'grass' on a verge (beyond the kerb, before the barrier, on it), else null
  function surface(c, x, y, z) {
    const bi = Math.floor(x / BOX), bj = Math.floor(z / BOX), F = c.fine;
    let best = -1, d = Infinity;
    for (let i = bi - c.reach; i <= bi + c.reach; i++) for (let j = bj - c.reach; j <= bj + c.reach; j++) for (const k of c.boxes.get(i + ',' + j) || []) {
      const q = (F[3 * k] - x) * (F[3 * k] - x) + (F[3 * k + 1] - z) * (F[3 * k + 1] - z);
      if (q < d && Math.abs(y - F[3 * k + 2]) < LEVEL) { d = q; best = k; }
    }
    if (best < 0) return null;
    // across the road at that point: the side, and how far from the centreline
    const a = (best - 1 + c.n) % c.n, b = (best + 1) % c.n;
    const tx = F[3 * b] - F[3 * a], tz = F[3 * b + 1] - F[3 * a + 1], l = Math.hypot(tx, tz) || 1;
    const u = ((x - F[3 * best]) * -tz + (z - F[3 * best + 1]) * tx) / l;   // > 0: on the right
    const half = c.half[best * 2 + (u > 0 ? 1 : 0)], sand = u > 0 ? c.sandR[best] : c.sandL[best], off = Math.abs(u);
    if (y - F[3 * best + 2] >= HEIGHT || off <= half + 0.8) return null;
    if (sand > 0 && off < half + 0.8 + sand) return 'sand';
    return c.edge && off < c.edge[best * 2 + (u > 0 ? 1 : 0)] ? 'grass' : null;
  }

  const cars = new Map();           // car id -> { circuit, origin, x, y, z, speed }
  self.ApexSand = {
    // a car is created on a track: does the track carry a circuit with gravel traps, and where is it?
    car(id, trackData) {
      let found = null;
      trackData.forEachPart((x, y, z, part) => { if (found == null && prepare(part) != null) found = { circuit: prepare(part), origin: [x * PART_SIZE, y * PART_SIZE, z * PART_SIZE] }; });
      if (found == null) { cars.delete(id); return; }
      cars.set(id, { ...found, x: NaN, y: NaN, z: NaN, speed: 0, on: null });
    },
    // the controls of the next step, filtered when the car stands in the gravel or on the grass
    controls(car, controls) {
      const c = cars.get(car.id);
      if (c == null || c.on == null) return controls;
      const phase = car.frames % CYCLE, sand = c.on === 'sand';
      const up = controls.up && phase < (sand ? THROTTLE : GRASS) * CYCLE;
      const brake = c.speed > BRAKE_SPEED && phase >= CYCLE - (sand ? BRAKE : GRASS_BRAKE) * CYCLE;
      return { up: up, right: controls.right, down: controls.down || brake, left: controls.left, reset: controls.reset };
    },
    // after the step: where the car is now
    afterStep(M, car, ptr) {
      const c = cars.get(car.id);
      if (c == null) return;
      const u8 = M.HEAPU8, view = new DataView(u8.buffer, ptr, 64);
      const finished = (u8[ptr + FLAGS] & 2) !== 0, at = FLAGS + 1 + (finished ? 3 : 0) + 2;
      const x = view.getFloat32(at, true) - c.origin[0], y = view.getFloat32(at + 4, true) - c.origin[1], z = view.getFloat32(at + 8, true) - c.origin[2];
      const moved = Math.hypot(x - c.x, y - c.y, z - c.z);
      c.speed = Number.isFinite(moved) && moved < 1 ? moved * 1000 : 0;    // m/s (a respawn jumps: not a speed)
      c.x = x; c.y = y; c.z = z;
      c.on = finished ? null : surface(c.circuit, x, y, z);
    },
  };
})();
