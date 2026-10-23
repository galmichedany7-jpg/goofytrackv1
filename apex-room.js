// Apex room extras (multiplayer)
//
//   1. Top 5 board   best times set in the current room
//   2. Room ghost    the fastest run seen in the room, replayed alongside your own run
//   3. Race rooms    hosted with the "Race" game mode. The host runs an event made of:
//                      qualifying   (optional) free timed laps, the best one sets the grid order
//                      formation    (optional) one untimed lap from the grid slots
//                      race         a look at the circuit, five lights, then N laps; live standings,
//                                   and a podium once everybody is in (the two scenes: apex-show.js)
//
// 1 and 2 only use data the game already exchanges, so they work next to unmodified players.
// 3 needs extra messages. They travel on the message type the game reserves for mods (255) and are
// only sent to players that announced this mod, so unmodified players stay connected and simply
// keep practising while an event runs.
//
// Laps: the physics (WebAssembly) ends a run when the car reaches the finish with every checkpoint.
// For a race of several laps the physics gets a copy of the track with one extra checkpoint far
// above the track, so the run never ends; laps are counted here by watching the car cross the
// checkpoint and finish detectors. This needs a circuit whose finish line sits next to the start.
//
// The game calls into window.ApexRoom from the hooks added by patch_bundle.js.
(() => {
  'use strict';

  const GHOST_FADE_DISTANCE = 5;      // metres; the ghost fades out when it overlaps your car
  const GHOST_OPACITY = 0.5;          // the ghost is a hint, not a car in the way
  const GHOST_TAG_OPACITY = 0.45;     // its name and time, above it
  const GHOST_LINGER_FRAMES = 1500;   // keep showing the ghost for 1.5 s after it crosses the line
  const SELF_SAMPLE_FRAMES = 50;      // sample own car at the same rate as network updates
  const MOD_MESSAGE = 255;            // message type reserved by the game for mods
  const INTRO_MS = 3000;              // race start -> the lights come up: the camera shows the circuit
  const LIGHTS_MS = 6500;             // lights come up -> lights out (5 lights, one per second)
  const PODIUM_AHEAD = 7;             // metres from the start line to the podium
  const PODIUM_CARS = 9;
  const START_HEIGHT = 0.2;           // the start transform is a car's centre, 0.2 to 0.35 m above the road: the podium's floor
  const GRID_ROW_GAP = 3.0;           // metres between two grid slots along the track
  const GRID_SIDE = 1.15;             // metres left/right of the racing line
  const LOOP_DISTANCE = 50;           // metres; a finish this close to the start makes the track a circuit
  const TELEPORT_DISTANCE = 40;       // metres in one frame: a respawn, not a crossing
  const MAX_LAPS = 20;
  const SETTINGS_KEY = 'goofytrack.raceSettings';

  // Game modules (webpack ids of PolyTrack 0.6.3)
  const MOD_TRACK_DATA = 9117, MOD_PARTS = 2600, MOD_ROTATION = 5494;
  const PART_SIZE = 5;                // metres per track unit
  const CHECKPOINT_PART = 52;
  const DETECTOR_CHECKPOINT = 0, DETECTOR_FINISH = 1;

  // Texts follow the game's language setting (published by a hook), the system language until then
  const TEXTS_FR = {
    top: 'TOP 5', race: 'COURSE', quali: 'QUALIFS', formation: 'FORMATION', results: 'RÉSULTATS', go: 'PARTEZ',
    mode: 'Course', modeInfo: 'Qualifications, tour de formation puis course en plusieurs tours, départ arrêté aux feux.',
    laps: 'Tours', qualiOpt: 'Qualifications', formationOpt: 'Tour de formation',
    lapsOf: (a, b) => `${a}/${b}`, lap: 'TOUR', best: 'Meilleur', last: 'Dernier',
    waitGrid: 'En attente de la grille', finished: p => `ARRIVÉE  P${p}`, notLoop: 'Piste sans boucle : 1 tour', contact: 'Collisions activées',
    start: 'Lancer', toFormation: 'Tour de formation', toRace: 'Départ', stop: 'Arrêter', done: 'Terminer',
    qualiHud: 'QUALIFICATIONS', formationHud: 'TOUR DE FORMATION', resultsHud: 'COURSE TERMINÉE',
    buildMismatch: "Erreur : votre version de GoofyTrack n'est pas celle de l'hôte. Installez le même build que lui.",
  };
  const TEXTS_EN = {
    top: 'TOP 5', race: 'RACE', quali: 'QUALIFYING', formation: 'FORMATION', results: 'RESULTS', go: 'GO',
    mode: 'Race', modeInfo: 'Qualifying, formation lap, then a race over several laps from a standing start.',
    laps: 'Laps', qualiOpt: 'Qualifying', formationOpt: 'Formation lap',
    lapsOf: (a, b) => `${a}/${b}`, lap: 'LAP', best: 'Best', last: 'Last',
    waitGrid: 'Waiting for the grid', finished: p => `FINISHED  P${p}`, notLoop: 'Track does not loop: 1 lap', contact: 'Collisions on',
    start: 'Start', toFormation: 'Formation lap', toRace: 'Start race', stop: 'Stop', done: 'Finish',
    qualiHud: 'QUALIFYING', formationHud: 'FORMATION LAP', resultsHud: 'RACE OVER',
    buildMismatch: "Error: your GoofyTrack build is not the same as the host's. Install the same build.",
  };
  const T = new Proxy({}, {
    get: (_, key) => ((window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr') ? TEXTS_FR : TEXTS_EN)[key],
  });

  let ctx = null;          // supplied by the game: { owner, connection, track, makeCar, getSelfCar, interpolate, restart }
  let players = [];        // latest player list
  let live = new Map();    // player id -> { resetCounter, states[] } run currently being driven
  let best = new Map();    // player id -> { frames, states[], nickname, countryCode, carStyle }
  let ghost = null;        // { car, playerId, frames, states, lastT, index }
  let board = null, lights = null, hud = null, hudText = '';
  let selfId = null;
  let selfLastFrames = -1;
  let course = null;       // { checkpoints:[[detector]] by order, finishes:[detector], loop }
  let race = null;         // see newRace()
  let run = null;          // own progress in the current phase, see newRun()
  let raceCounter = 0;
  let pendingRoom = null;  // race room settings chosen on the host screen, applied when the room opens
  let parked = null;       // own car's state while it waits for the lights: what a car at rest looks like
  let stage = null;        // the podium: { cars: [{ car, state, placed }] }, no cars once the player has left it
  let runCounts = true;    // the own run began on the track's start line, on the real track (set when the car spawns)

  const isHost = () => ctx != null && typeof ctx.connection.apexPeers === 'function';
  const room = () => (ctx != null && ctx.connection.apexRoom) || { race: false };
  const formatTime = frames => {
    const ms = Math.round(frames) % 1000, s = Math.floor(frames / 1000) % 60, m = Math.floor(frames / 60000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  };
  const formatGap = ms => '+' + (ms / 1000).toFixed(3);
  const recordFrames = p => (p.record == null ? null : p.record.numberOfFrames);
  const nameOf = id => { const p = players.find(p => p.id === id); return p ? p.nickname : '?'; };

  let webpackRequire = null;
  const gameModule = id => {
    if (webpackRequire == null) window.webpackChunk.push([[Symbol('apex')], {}, r => { webpackRequire = r; }]);
    return webpackRequire(id);
  };

  // ================================================================== settings
  const DEFAULT_SETTINGS = { laps: 3, quali: true, formation: true };
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s && typeof s === 'object') return sanitizeSettings(s);
    } catch (e) { /* storage unavailable */ }
    return { ...DEFAULT_SETTINGS };
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  }
  const sanitizeSettings = s => ({
    laps: Math.max(1, Math.min(MAX_LAPS, Math.round(Number(s.laps)) || DEFAULT_SETTINGS.laps)),
    quali: s.quali !== false,
    formation: s.formation !== false,
  });
  let settings = loadSettings();

  // ================================================================== run capture
  function pushState(id, resetCounter, state) {
    let r = live.get(id);
    if (r == null || resetCounter > r.resetCounter || (state.frames === 0 && r.states.length > 1)) {
      r = { resetCounter, states: [] };
      live.set(id, r);
    }
    const last = r.states[r.states.length - 1];
    if (last == null || state.frames > last.frames) r.states.push(state);
  }

  function sampleSelf() {
    if (selfId == null) return;
    const car = ctx.getSelfCar();
    if (car == null) return;
    const state = car.getCarState();
    if (state.frames < selfLastFrames) live.delete(selfId); // reset: start a new run
    const r = live.get(selfId);
    const last = r && r.states[r.states.length - 1];
    if (last == null || state.frames - last.frames >= SELF_SAMPLE_FRAMES || (state.finishFrames != null && last.finishFrames == null))
      pushState(selfId, 0, state);
    selfLastFrames = state.frames;
  }

  // A player's record changed: the run they are driving right now is the one that set it.
  function commitRun(player, frames) {
    const r = live.get(player.id);
    if (r == null || r.states.length < 2) return;
    const lastFrames = r.states[r.states.length - 1].frames;
    if (lastFrames < frames - 1000) return; // we did not see this run, e.g. record set before we joined
    best.set(player.id, { frames, states: r.states, nickname: player.nickname, countryCode: player.countryCode, carStyle: player.carStyle });
  }

  const leaderRun = () => {
    let leader = null;
    for (const [id, r] of best) if (leader == null || r.frames < leader.run.frames) leader = { id, run: r };
    return leader;
  };

  // ================================================================== ghost
  function disposeGhost() {
    if (ghost != null) { ghost.car.dispose(); ghost = null; }
  }

  function refreshGhost() {
    const leader = leaderRun();
    if (leader == null) { disposeGhost(); return; }
    if (ghost != null && ghost.playerId === leader.id && ghost.frames === leader.run.frames) return;
    disposeGhost();
    const car = ctx.makeCar();
    car.setCarStyle(leader.run.carStyle);
    car.setNameTag(leader.run.countryCode, leader.run.nickname, leader.run.frames);   // the time: see patch_bundle.js
    car.audioVolume = 0;
    car.setVisible(false);
    ghost = { car, playerId: leader.id, frames: leader.run.frames, states: leader.run.states, lastT: -1, index: 0 };
  }

  function updateGhost(dt) {
    if (ghost == null) return;
    const self = ctx.getSelfCar();
    if (race != null || self == null || !self.hasStarted()) { ghost.car.setVisible(false); ghost.lastT = -1; ghost.index = 0; return; }
    const t = self.getTime().numberOfFrames;
    const states = ghost.states;
    if (t > ghost.frames + GHOST_LINGER_FRAMES || t > states[states.length - 1].frames) { ghost.car.setVisible(false); return; }
    const snap = t < ghost.lastT || ghost.lastT < 0;
    if (snap) ghost.index = 0;
    while (ghost.index < states.length - 2 && states[ghost.index + 1].frames <= t) ghost.index++;
    const a = states[ghost.index], b = states[ghost.index + 1];
    const span = b.frames - a.frames;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.frames) / span)) : 0;
    ghost.car.setCarState(k > 0 ? ctx.interpolate(a, b, k) : a, snap);
    ghost.car.setVisible(true);
    const d = ghost.car.getPosition().distanceTo(self.getPosition());
    const near = Math.max(0, Math.min(1, d / GHOST_FADE_DISTANCE));
    ghost.car.setOpacity(near * GHOST_OPACITY);
    if (ghost.car.apexTagOpacity) ghost.car.apexTagOpacity(near * GHOST_TAG_OPACITY);
    ghost.car.update(dt);
    ghost.lastT = t;
  }

  // ================================================================== mod messages
  const encode = obj => {
    const body = new TextEncoder().encode(JSON.stringify(obj));
    const bytes = new Uint8Array(1 + body.length);
    bytes[0] = MOD_MESSAGE;
    bytes.set(body, 1);
    return bytes;
  };
  const HELLO = new Uint8Array([MOD_MESSAGE]); // empty mod message: ignored by unmodified clients

  function sendToPeer(peer, bytes) {
    try { peer.dataChannel.send(bytes); } catch (e) { console.error('Apex: failed to send mod message', e); }
  }
  function broadcast(obj) {            // host -> every player running the mod
    const bytes = encode(obj);
    for (const peer of ctx.connection.apexPeers()) if (peer.apexMod) sendToPeer(peer, bytes);
  }
  function sendToHost(obj) {           // client -> host
    if (ctx.connection.apexHostIsMod) ctx.connection.apexSend(encode(obj));
  }
  function greetPeers() {
    if (!isHost()) return;
    for (const peer of ctx.connection.apexPeers()) {
      if (peer.apexGreeted) continue;
      peer.apexGreeted = true;
      sendToPeer(peer, HELLO);
    }
  }
  const decode = payload => {
    try { return JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return null; }
  };
  const roomMessage = r => ({ t: 'room', race: !!r.race, laps: r.laps, quali: r.quali, formation: r.formation });

  // ================================================================== track geometry
  const rotate = (q, v) => {           // rotate vector v by quaternion q
    const { x, y, z, w } = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };
  const unrotate = (q, v) => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Checkpoint and finish detectors in world space, from the track the game is running.
  function buildCourse(sceneTrack) {
    const { Hw: partConfig } = gameModule(MOD_PARTS);
    const { hT: partRotation } = gameModule(MOD_ROTATION);
    const vec = v => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
    const byOrder = new Map(), finishes = [];
    const track = sceneTrack.getTrackData();
    track.forEachPart((x, y, z, id, rotation, axis, color, checkpointOrder) => {
      const detector = partConfig(id).detector;
      if (detector == null) return;
      const q = partRotation(rotation, axis);
      const c = rotate(q, vec(detector.center));
      const size = vec(detector.size);
      const d = {
        c: [x * PART_SIZE + c[0], y * PART_SIZE + c[1], z * PART_SIZE + c[2]],
        q: { x: q.x, y: q.y, z: q.z, w: q.w },
        half: [size[0] / 2, size[1] / 2, size[2] / 2],
      };
      if (detector.type === DETECTOR_FINISH) finishes.push(d);
      else if (detector.type === DETECTOR_CHECKPOINT && checkpointOrder != null) {
        if (!byOrder.has(checkpointOrder)) byOrder.set(checkpointOrder, []);
        byOrder.get(checkpointOrder).push(d);
      }
    });
    const start = track.getStartTransform();
    const s = start ? [start.position.x, start.position.y, start.position.z] : null;
    return {
      checkpoints: [...byOrder.keys()].sort((a, b) => a - b).map(k => byOrder.get(k)),
      finishes,
      loop: s != null && finishes.some(f => dist(f.c, s) < LOOP_DISTANCE),
    };
  }

  // The game tests the whole car body against a detector, here only the car's centre moves:
  // grow the box by about half a car in every direction.
  const CAR_EXTENT = [2, 1.5, 2.5];

  // Does the segment a -> b touch the detector box? (slab test in the detector's own frame)
  function crosses(d, a, b) {
    const la = unrotate(d.q, [a.x - d.c[0], a.y - d.c[1], a.z - d.c[2]]);
    const lb = unrotate(d.q, [b.x - d.c[0], b.y - d.c[1], b.z - d.c[2]]);
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 3; i++) {
      const delta = lb[i] - la[i], h = d.half[i] + CAR_EXTENT[i];
      if (Math.abs(delta) < 1e-9) { if (Math.abs(la[i]) > h) return false; continue; }
      let u = (-h - la[i]) / delta, v = (h - la[i]) / delta;
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
      if (t0 > t1) return false;
    }
    return true;
  }

  const raceLaps = () => (course != null && course.loop ? room().laps || 1 : 1);

  // The physics gets the track with one more checkpoint, out of reach above the track, so that a
  // multi-lap race never "finishes" for the game. Laps are counted by updateLaps() instead.
  function simTrack(track) {
    const save = track.toSaveString();
    if (race == null || race.phase !== 'race' || race.laps <= 1) return save;
    try {
      const TrackData = gameModule(MOD_TRACK_DATA).A;
      const copy = new TrackData(track.environment, track.sunDirection);
      let maxOrder = -1, maxY = -Infinity, px = 0, pz = 0;
      track.forEachPart((x, y, z, id, rotation, axis, color, checkpointOrder, startOrder) => {
        copy.addPart(x, y, z, id, rotation, axis, color, checkpointOrder, startOrder);
        if (checkpointOrder != null) maxOrder = Math.max(maxOrder, checkpointOrder);
        if (y > maxY) { maxY = y; px = x; pz = z; }
      });
      copy.addPart(px, maxY + 400, pz, CHECKPOINT_PART, 0, 0, 0, maxOrder + 1, null);
      return copy.toSaveString();
    } catch (e) {
      console.error('Apex: could not prepare the multi-lap track', e);
      return save;
    }
  }

  // ================================================================== race: grid
  // Grid slots follow the line driven by the fastest run seen in the room, so they stay on the road
  // even when the track bends right after the start. Without any run they extend straight ahead.
  function buildGrid(order) {
    const start = ctx.track().getStartTransform();
    const startState = { position: start.position, quaternion: start.quaternion };
    const leader = leaderRun();
    let path = leader ? leader.run.states : null;
    // only a run seen from its very start describes the road ahead of the line
    if (path != null && Math.hypot(path[0].position.x - start.position.x, path[0].position.y - start.position.y, path[0].position.z - start.position.z) > 2) path = null;
    const pointAt = distance => {
      if (path == null || distance <= 0) {
        const fwd = rotate(startState.quaternion, [0, 0, 1]);
        return { p: [startState.position.x + fwd[0] * distance, startState.position.y + fwd[1] * distance, startState.position.z + fwd[2] * distance], q: startState.quaternion };
      }
      let walked = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i].position, b = path[i + 1].position;
        const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (walked + seg >= distance && seg > 0) {
          const s = ctx.interpolate(path[i], path[i + 1], (distance - walked) / seg);
          return { p: [s.position.x, s.position.y, s.position.z], q: s.quaternion };
        }
        walked += seg;
      }
      const last = path[path.length - 1];
      return { p: [last.position.x, last.position.y, last.position.z], q: last.quaternion };
    };
    return order.map((id, k) => {
      const { p, q } = pointAt((order.length - 1 - k) * GRID_ROW_GAP);
      const side = rotate(q, [k % 2 === 0 ? -GRID_SIDE : GRID_SIDE, 0, 0]);
      return { id, p: [p[0] + side[0], p[1] + side[1], p[2] + side[2]], q: [q.x, q.y, q.z, q.w] };
    });
  }

  // Mod players, fastest first: qualifying times when there are some, room times otherwise.
  function gridOrder() {
    const modIds = new Set(ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id));
    modIds.add(selfId);
    const timeOf = p => {
      if (race.quali.size > 0) return race.quali.has(p.id) ? race.quali.get(p.id) : null;
      return recordFrames(p);
    };
    return players.filter(p => modIds.has(p.id)).sort((a, b) => {
      const fa = timeOf(a), fb = timeOf(b);
      if (fa == null && fb == null) return a.id - b.id;
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }).map(p => p.id);
  }

  const slotFor = id => (race == null || race.grid == null || (race.phase !== 'formation' && race.phase !== 'race')
    ? null : race.grid.find(s => s.id === id) || null);
  // Cars are solid for each other in a race room, all the time: free practice, qualifying,
  // formation lap and race. See apex-collide.js.
  //   on a grid (formation, race)   the cars of the grid, from the moment they sit on it
  //   otherwise                     every car that is moving; cars start from the same spot there,
  //                                 and a car inside another one only turns solid once clear of it
  const collisionSession = () => {
    if (ctx == null || !room().race) return null;
    const onGrid = race != null && race.grid != null && (race.phase === 'formation' || race.phase === 'race');
    if (!onGrid) return { remotes: ctx.remotes(), solid: () => true, moving: true };
    if (slotFor(selfId) == null) return null;       // joined during the race: only watching
    const grid = race.grid;
    return { remotes: ctx.remotes(), solid: id => grid.some(s => s.id === id), moving: false };
  };
  // Phases where the cars drive ordinary runs: from the start line, on the real track, on their own clock
  const timeTrialPhase = () => race == null || race.phase === 'quali' || race.phase === 'results';
  const applySlot = (transform, slot) => {
    if (slot == null) return transform;
    const P = transform.position.constructor, Q = transform.quaternion.constructor;
    return { position: new P(slot.p[0], slot.p[1], slot.p[2]), quaternion: new Q(slot.q[0], slot.q[1], slot.q[2], slot.q[3]) };
  };

  // ================================================================== race: state
  // The host owns the event and broadcasts it whole on every change; players report their own
  // laps and times. Phases: quali -> formation -> race -> results (quali and formation optional).
  const newRace = () => ({
    n: ++raceCounter, phase: null, laps: 1, grid: null, goAt: 0,
    quali: new Map(),    // id -> best qualifying time (ms)
    done: new Set(),     // ids that completed the formation lap
    progress: new Map(), // id -> { lap, ms } laps completed, race clock at the last one
    results: [],         // [{ id, ms }] finishing order
  });
  const newRun = () => ({ lap: 0, nextCp: 0, lastPos: null, lastLapMs: null, lastLapTime: null, best: null, sentDone: false, finished: false });

  const stateMessage = () => ({
    t: 'state', n: race.n, phase: race.phase, laps: race.laps, grid: race.grid,
    lights: race.phase === 'race' ? Math.max(0, Math.round(race.goAt - performance.now())) : 0,
    quali: [...race.quali], done: [...race.done], progress: [...race.progress].map(([id, p]) => [id, p.lap, p.ms]), results: race.results,
  });
  const publish = () => { if (isHost() && race != null) broadcast(stateMessage()); renderBoard(); };

  function enterPhase(phase) {          // everybody, host included
    race.phase = phase;
    if (phase === 'race') race.goAt = performance.now() + INTRO_MS + LIGHTS_MS;
    if (phase !== 'results') {
      run = newRun();
      live = new Map();
      selfLastFrames = -1;
      ctx.restart();
    }
    if (phase === 'race') showIntro();
    renderBoard();
  }

  // ---- host
  function hostStart() {
    if (!isHost() || race != null) return;
    race = newRace();
    race.laps = raceLaps();
    const r = room();
    hostGoTo(r.quali ? 'quali' : r.formation ? 'formation' : 'race');
  }
  function hostNext() {
    if (!isHost() || race == null) return;
    if (race.phase === 'quali') hostGoTo(room().formation ? 'formation' : 'race');
    else if (race.phase === 'formation') hostGoTo('race');
  }
  function hostGoTo(phase) {
    if (phase === 'formation' || (phase === 'race' && race.grid == null)) race.grid = buildGrid(gridOrder());
    enterPhase(phase);
    publish();
  }
  function hostStop() {
    if (!isHost() || race == null) return;
    broadcast({ t: 'end', n: race.n });
    endRace();
  }
  const gridPresent = () => race.grid.filter(s => players.some(p => p.id === s.id)).map(s => s.id);
  function hostCheckProgress() {
    if (race.phase === 'formation' && gridPresent().every(id => race.done.has(id))) { hostGoTo('race'); return; }
    if (race.phase === 'race' && gridPresent().every(id => race.results.some(r => r.id === id))) { race.phase = 'results'; publish(); return; }
    publish();
  }
  function hostReport(id, msg) {        // a player (or the host itself) reported something
    if (race == null || msg.n !== race.n) return;
    const onGrid = race.grid != null && race.grid.some(s => s.id === id); // players who joined later only watch
    if (msg.t !== 'q' && !onGrid) return;
    if (msg.t === 'q' && race.phase === 'quali' && Number.isFinite(msg.ms) && msg.ms > 0) {
      if (!race.quali.has(id) || msg.ms < race.quali.get(id)) race.quali.set(id, msg.ms);
    } else if (msg.t === 'fd' && race.phase === 'formation') {
      race.done.add(id);
    } else if (msg.t === 'lap' && race.phase === 'race' && Number.isInteger(msg.lap) && msg.lap >= 0 && Number.isFinite(msg.ms)) {
      if (race.results.some(r => r.id === id)) return;
      race.progress.set(id, { lap: Math.min(msg.lap, race.laps), ms: msg.ms });
      if (msg.lap >= race.laps) race.results.push({ id, ms: msg.ms });
    } else return;
    hostCheckProgress();
  }
  function report(msg) {                // own events: straight to the host logic, or over the wire
    msg.n = race.n;
    if (isHost()) hostReport(selfId, msg);
    else sendToHost(msg);
  }

  // ---- players
  function applyState(msg) {
    if (!Array.isArray(msg.quali) || !Array.isArray(msg.done) || !Array.isArray(msg.progress) || !Array.isArray(msg.results)) return;
    const fresh = race == null || race.n !== msg.n;
    if (fresh) race = { ...newRace(), n: msg.n };
    const phaseChanged = fresh || race.phase !== msg.phase;
    race.laps = msg.laps;
    race.grid = msg.grid;
    race.quali = new Map(msg.quali);
    race.done = new Set(msg.done);
    race.progress = new Map(msg.progress.map(([id, lap, ms]) => [id, { lap, ms }]));
    race.results = msg.results;
    if (phaseChanged) {
      enterPhase(msg.phase);
      if (msg.phase === 'race') {
        race.goAt = performance.now() + msg.lights;
        if (msg.lights < LIGHTS_MS + INTRO_MS / 2 && window.ApexShow) window.ApexShow.stop();   // joined late: straight to the lights
      }
    } else renderBoard();
  }

  function endRace() {
    race = null;
    run = null;
    closeStage();
    if (lights != null) { lights.remove(); lights = null; }
    setHud('');
    live = new Map();
    selfLastFrames = -1;
    ctx.restart();
    renderBoard();
  }

  function onMessage(msg, fromPeer) {
    if (msg == null || typeof msg !== 'object') return;
    if (fromPeer != null) { hostReport(fromPeer.id, msg); return; }
    if (msg.t === 'room') { ctx.connection.apexRoom = roomMessage(msg); renderBoard(); }
    else if (msg.t === 'state') applyState(msg);
    else if (msg.t === 'end' && race != null) endRace();
  }

  // ================================================================== race: own car, every frame
  function updateRace() {
    if (race == null || run == null) return;
    const self = ctx.getSelfCar();
    const now = performance.now();
    renderLights(now);
    if (self == null) return;
    const state = self.getCarState();
    if (race.phase === 'race' && now < race.goAt && state.frames === 0 && !state.hasStarted) parked = state;
    if (state.frames < selfLastFrames && race.phase !== 'results') {   // the player restarted their run
      const keepBest = run.best;
      run = newRun();
      run.best = keepBest;
      if (race.phase === 'race' && now >= race.goAt) report({ t: 'lap', lap: 0, ms: Math.round(now - race.goAt) });
    }
    selfLastFrames = state.frames;

    if (race.phase === 'quali' && self.hasFinished()) {
      const ms = self.getFinishTime().numberOfFrames;
      if (run.best == null || ms < run.best) { run.best = ms; report({ t: 'q', ms }); }
    } else if (race.phase === 'formation' && self.hasFinished() && !run.sentDone) {
      run.sentDone = true;
      report({ t: 'fd' });
    } else if (race.phase === 'race' && now >= race.goAt) {
      if (!self.hasStarted()) self.start();
      updateLaps(state, now);
    }
    renderHud(now);
  }

  // Race time is measured on the shared clock (since lights out), not on the car's own timer,
  // so restarting your car during a race does not give you a fresh clock.
  function updateLaps(state, now) {
    if (run.finished) return;
    const p = state.position;
    const last = run.lastPos;
    run.lastPos = { x: p.x, y: p.y, z: p.z };
    let lapDone = false;
    if (last != null && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) < TELEPORT_DISTANCE) {
      if (run.nextCp < course.checkpoints.length) {
        if (course.checkpoints[run.nextCp].some(d => crosses(d, last, p))) run.nextCp++;
      } else if (course.finishes.some(d => crosses(d, last, p))) lapDone = true;
    }
    if (state.finishFrames != null) lapDone = true; // single-lap race: the game's own finish
    if (lapDone) completeLap(now, state.finishFrames != null);
  }
  function completeLap(now, lastLap) {
    const ms = Math.round(now - race.goAt);
    run.lap = lastLap ? race.laps : run.lap + 1;
    run.nextCp = 0;
    run.lastLapTime = ms - (run.lastLapMs || 0);
    run.lastLapMs = ms;
    if (run.lap >= race.laps) run.finished = true;
    report({ t: 'lap', lap: run.lap, ms });
  }

  // ================================================================== race: intro and podium (apex-show.js)
  const startPlace = () => {
    const start = ctx.track().getStartTransform(), q = start.quaternion;
    return { p: [start.position.x, start.position.y, start.position.z], q: [q.x, q.y, q.z, q.w] };
  };
  function showIntro() {
    if (!window.ApexShow) return;
    try {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      ctx.track().getTrackData().forEachPart((x, y, z) => [x, y, z].forEach((v, k) => { min[k] = Math.min(min[k], v * PART_SIZE); max[k] = Math.max(max[k], v * PART_SIZE); }));
      const slot = slotFor(selfId);
      window.ApexShow.intro({ min, max }, slot != null ? { p: slot.p, q: slot.q } : startPlace(), INTRO_MS);
    } catch (e) { console.error('Apex: no race intro', e); }
  }

  // The podium stands on the road just after the start line, facing down the road; on it, copies of
  // the cars in finishing order (the cars themselves stay wherever their drivers left them).
  function openStage() {
    stage = { cars: [] };
    if (!window.ApexShow) return;
    try {
      const start = startPlace(), forward = rotate({ x: start.q[0], y: start.q[1], z: start.q[2], w: start.q[3] }, [0, 0, 1]), up = rotate({ x: start.q[0], y: start.q[1], z: start.q[2], w: start.q[3] }, [0, 1, 0]);
      const road = { p: [0, 1, 2].map(k => start.p[k] + forward[k] * PODIUM_AHEAD - up[k] * START_HEIGHT), q: start.q };
      const finishers = race.results.map(r => ({ result: r, player: players.find(p => p.id === r.id) })).filter(f => f.player != null).slice(0, PODIUM_CARS);
      const slots = window.ApexShow.podium(road, finishers.length);
      const self = ctx.getSelfCar(), model = parked || (self != null ? self.getCarState() : null);
      if (model == null) return;
      finishers.forEach((f, i) => {
        const car = ctx.makeCar(), s = slots[i];
        car.setCarStyle(f.player.carStyle);
        car.setNameTag(f.player.countryCode, (i + 1) + '. ' + f.player.nickname, f.result.ms);
        car.audioVolume = 0;
        const state = { ...model, frames: 0, speedKmh: 0, hasStarted: false, finishFrames: null, steering: 0, brakeLightEnabled: false, collisionImpulses: [],
          wheelSuspensionVelocity: model.wheelSuspensionVelocity.map(() => 0), wheelDeltaRotation: model.wheelDeltaRotation.map(() => 0),
          controls: { up: false, right: false, down: false, left: false, reset: false },
          position: { x: s.p[0], y: s.p[1], z: s.p[2] }, quaternion: { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] } };
        stage.cars.push({ car, state, placed: false });
      });
    } catch (e) { console.error('Apex: no podium', e); }
  }
  function closeStage() {
    if (stage == null) return;
    for (const c of stage.cars) c.car.dispose();
    stage = null;
    if (window.ApexShow) window.ApexShow.clear();
  }
  function updateStage(dt) {
    if (race == null || race.phase !== 'results') { closeStage(); return; }
    if (stage == null) openStage();
    // the player has seen it: the podium goes, so that it does not stand across the road for those who drive on
    if (stage.cars.length > 0 && !window.ApexShow.active()) { for (const c of stage.cars) c.car.dispose(); stage.cars = []; window.ApexShow.clear(); }
    for (const c of stage.cars) {
      c.car.setCarState(c.state, !c.placed);
      c.placed = true;
      c.car.setVisible(true);
      c.car.setOpacity(1);
      if (c.car.apexTagOpacity) c.car.apexTagOpacity(1);
      c.car.update(dt);
    }
  }
  // while the podium is on screen the camera is not on the car: it is not driven either
  const watching = () => stage != null && stage.cars.length > 0 && window.ApexShow.active();

  // ================================================================== UI
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function renderLights(now) {
    if (race == null || race.phase !== 'race') return;
    const left = race.goAt - now;
    if (left < -1500 || left > LIGHTS_MS) { if (lights != null) { lights.remove(); lights = null; } return; }
    if (lights == null) {
      lights = el('div', 'apex-race-lights');
      for (let i = 0; i < 5; i++) lights.appendChild(el('span'));
      lights.appendChild(el('p', null, T.go));
      document.getElementById('ui').appendChild(lights);
    }
    const lit = left <= 0 ? 0 : Math.max(0, Math.min(5, 5 - Math.floor(left / 1000)));
    lights.classList.toggle('go', left <= 0);
    [...lights.querySelectorAll('span')].forEach((s, i) => s.classList.toggle('on', i < lit));
  }

  function setHud(text, sub) {
    const key = text + '|' + (sub || '');
    if (key === hudText) return;
    hudText = key;
    if (!text) { if (hud != null) { hud.remove(); hud = null; } return; }
    if (hud == null) { hud = el('div', 'apex-race-hud'); document.getElementById('ui').appendChild(hud); }
    hud.textContent = '';
    hud.appendChild(el('div', 'main', text));
    if (sub) hud.appendChild(el('div', 'sub', sub));
  }

  function renderHud(now) {
    if (race == null || run == null) { setHud(''); return; }
    if (race.phase === 'quali') setHud(T.qualiHud, run.best != null ? T.best + '  ' + formatTime(run.best) : null);
    else if (race.phase === 'formation') setHud(T.formationHud, run.sentDone ? T.waitGrid : null);
    else if (race.phase === 'race') {
      if (now < race.goAt) { setHud(''); return; }
      const position = race.results.findIndex(r => r.id === selfId);
      if (run.finished && position >= 0) setHud(T.finished(position + 1), formatTime(race.results[position].ms));
      else setHud(T.lap + '  ' + T.lapsOf(Math.min(run.lap + 1, race.laps), race.laps),
        run.lastLapTime != null ? T.last + '  ' + formatTime(run.lastLapTime) : null);
    } else if (race.phase === 'results') {
      const position = race.results.findIndex(r => r.id === selfId);
      setHud(T.resultsHud, position >= 0 ? T.finished(position + 1) : null);
    }
  }

  function row(cls, cells) {
    const r = el('div', 'row' + cls);
    for (const [c, text] of cells) r.appendChild(el('span', c, text));
    return r;
  }
  const selfCls = id => (id === selfId ? ' self' : '');

  // Live order: finished cars by time, then by laps completed and when, then the grid order.
  function raceOrder() {
    const finished = race.results.map(r => r.id);
    const others = race.grid.map(s => s.id).filter(id => !finished.includes(id));
    const gridIndex = id => race.grid.findIndex(s => s.id === id);
    others.sort((a, b) => {
      const pa = race.progress.get(a), pb = race.progress.get(b);
      const la = pa ? pa.lap : 0, lb = pb ? pb.lap : 0;
      if (la !== lb) return lb - la;
      if (la > 0 && pa.ms !== pb.ms) return pa.ms - pb.ms;
      return gridIndex(a) - gridIndex(b);
    });
    return [...finished, ...others];
  }

  function renderRaceRows() {
    if (race.phase === 'quali') {
      const ranked = [...race.quali].sort((a, b) => a[1] - b[1]);
      const pole = ranked.length ? ranked[0][1] : 0;
      ranked.forEach(([id, ms], i) => board.appendChild(row(selfCls(id), [
        ['rank', String(i + 1)], ['name', nameOf(id)], ['time', formatTime(ms)], ['gap', i === 0 ? '' : formatGap(ms - pole)],
      ])));
      if (ranked.length === 0) board.appendChild(el('div', 'empty', '--:--.---'));
      return;
    }
    if (race.phase === 'formation') {
      race.grid.forEach((s, i) => board.appendChild(row(selfCls(s.id) + (race.done.has(s.id) ? '' : ' pending'), [
        ['rank', String(i + 1)], ['name', nameOf(s.id)], ['time', race.done.has(s.id) ? '✓' : ''], ['gap', ''],
      ])));
      return;
    }
    const winner = race.results[0];
    raceOrder().forEach((id, i) => {
      const result = race.results.find(r => r.id === id);
      const p = race.progress.get(id);
      const time = result ? formatTime(result.ms) : T.lapsOf(Math.min((p ? p.lap : 0) + 1, race.laps), race.laps);
      board.appendChild(row(selfCls(id) + (result ? '' : ' pending'), [
        ['rank', String(i + 1)], ['name', nameOf(id)], ['time', time], ['gap', result && result !== winner ? formatGap(result.ms - winner.ms) : ''],
      ]));
    });
  }

  function renderTopFive() {
    const ranked = players.filter(p => recordFrames(p) != null).sort((a, b) => recordFrames(a) - recordFrames(b)).slice(0, 5);
    if (ranked.length === 0) board.appendChild(el('div', 'empty', '--:--.---'));
    const leaderFrames = ranked.length ? recordFrames(ranked[0]) : 0;
    ranked.forEach((p, i) => board.appendChild(row((p.isSelf ? ' self' : '') + (ghost != null && ghost.playerId === p.id ? ' ghost' : ''), [
      ['rank', String(i + 1)], ['name', p.nickname], ['time', formatTime(recordFrames(p))],
      ['gap', i === 0 ? '' : formatGap(recordFrames(p) - leaderFrames)],
    ])));
  }

  function button(label, cls, onClick) {
    const b = el('button', 'race-button' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  // Event settings: editable by the host between events, read-only for everybody else
  function renderSettings(editable) {
    const r = room();
    const box = el('div', 'race-settings');
    const laps = el('div', 'laps');
    laps.appendChild(el('span', 'label', T.laps));
    const loop = course == null || course.loop;
    if (editable && loop) {
      const change = d => updateRoom({ laps: Math.max(1, Math.min(MAX_LAPS, r.laps + d)) });
      laps.appendChild(button('−', 'step', () => change(-1)));
      laps.appendChild(el('span', 'value', String(r.laps)));
      laps.appendChild(button('+', 'step', () => change(1)));
    } else laps.appendChild(el('span', 'value', String(loop ? r.laps : 1)));
    box.appendChild(laps);
    if (!loop) box.appendChild(el('div', 'note', T.notLoop));
    for (const [key, label] of [['quali', T.qualiOpt], ['formation', T.formationOpt]]) {
      const opt = el(editable ? 'button' : 'div', 'toggle' + (r[key] ? ' on' : ''), label);
      if (editable) opt.addEventListener('click', () => updateRoom({ [key]: !r[key] }));
      box.appendChild(opt);
    }
    board.appendChild(box);
  }

  function updateRoom(change) {
    const r = { ...room(), ...change };
    ctx.connection.apexRoom = r;
    settings = sanitizeSettings(r);
    saveSettings(settings);
    broadcast(roomMessage(r));
    renderBoard();
  }

  function renderBoard() {
    if (ctx == null) return;
    if (board == null) {
      board = el('div', 'apex-room-board');
      document.getElementById('ui').appendChild(board);
    }
    board.textContent = '';
    const raceRoom = room().race;
    const titleText = race == null ? T.top
      : race.phase === 'quali' ? T.quali : race.phase === 'formation' ? T.formation : race.phase === 'results' ? T.results : T.race;
    const title = el('div', 'title', titleText);
    title.appendChild(el('span', null, String(players.length)));
    board.appendChild(title);

    if (race != null) renderRaceRows();
    else renderTopFive();

    if (!raceRoom) return;
    if (window.ApexCollide) board.appendChild(el('div', 'contact', T.contact));
    if (race == null) renderSettings(isHost());
    if (!isHost()) return;
    if (race == null) board.appendChild(button(T.start, '', hostStart));
    else if (race.phase === 'quali') board.appendChild(button(room().formation ? T.toFormation : T.toRace, '', hostNext));
    else if (race.phase === 'formation') board.appendChild(button(T.toRace, '', hostNext));
    if (race != null) board.appendChild(button(race.phase === 'results' ? T.done : T.stop, 'stop', hostStop));
  }

  // ---- host screen: options of the "Race" game mode
  function renderHostOptions(container, mode) {
    let box = container.querySelector('.apex-race-options');
    if (mode !== 'race') { if (box != null) box.remove(); return; }
    if (box == null) { box = el('div', 'apex-race-options'); container.appendChild(box); }
    box.textContent = '';
    const laps = el('div', 'laps');
    laps.appendChild(el('span', 'label', T.laps));
    const value = el('span', 'value', String(settings.laps));
    const slider = el('input', 'slider');
    Object.assign(slider, { type: 'range', min: '1', max: String(MAX_LAPS), value: String(settings.laps) });
    slider.addEventListener('input', () => { settings.laps = Number(slider.value); value.textContent = slider.value; saveSettings(settings); });
    laps.append(slider, value);
    box.appendChild(laps);
    for (const [key, label] of [['quali', T.qualiOpt], ['formation', T.formationOpt]]) {
      const opt = el('button', 'button toggle' + (settings[key] ? ' selected' : ''), label);
      opt.addEventListener('click', () => { settings[key] = !settings[key]; opt.classList.toggle('selected', settings[key]); saveSettings(settings); });
      box.appendChild(opt);
    }
  }

  // ================================================================== hooks called by the game
  window.ApexRoom = {
    // Debug helpers for the console: a read-only snapshot, your own car, and a way to simulate laps
    debugCar: () => (ctx != null ? ctx.getSelfCar() : null),
    debugLap:() => { if (run != null && !run.finished && race != null && race.phase === 'race') completeLap(performance.now(), false); },
    debug: () => ({
      players: players.length, host: isHost(), hostIsMod: !!(ctx && ctx.connection.apexHostIsMod), room: ctx && ctx.connection.apexRoom,
      modPeers: isHost() ? ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id) : null,
      course: course && { checkpoints: course.checkpoints.length, finishes: course.finishes.length, loop: course.loop },
      live: [...live].map(([id, r]) => [id, r.states.length]),
      best: [...best].map(([id, r]) => [id, r.frames, r.states.length]),
      ghost: ghost && { playerId: ghost.playerId, frames: ghost.frames, lastT: ghost.lastT },
      race: race && { ...stateMessage(), goIn: Math.round(race.goAt - performance.now()) },
      run,
    }),

    begin(context) {
      this.end();
      ctx = context;
      try { course = buildCourse(ctx.track()); } catch (e) { console.error('Apex: could not read the track', e); course = { checkpoints: [], finishes: [], loop: false }; }
      if (isHost() && ctx.connection.apexRoom == null) {
        ctx.connection.apexRoom = pendingRoom || { race: false };
        pendingRoom = null;
      }
      if (window.ApexLobby) window.ApexLobby.session(true);
    },
    onPlayers(list) {
      if (ctx == null) return;
      const previous = new Map(players.map(p => [p.id, recordFrames(p)]));
      players = list;
      const self = list.find(p => p.isSelf);
      selfId = self ? self.id : null;
      if (race == null) {
        for (const p of list) {
          const frames = recordFrames(p);
          if (frames != null && frames !== previous.get(p.id)) commitRun(p, frames);
        }
      }
      for (const id of [...best.keys()]) if (!list.some(p => p.id === id)) best.delete(id);
      for (const id of [...live.keys()]) if (!list.some(p => p.id === id)) live.delete(id);
      greetPeers();
      refreshGhost();
      if (isHost() && race != null) hostCheckProgress(); // somebody may have left the grid
      else renderBoard();
    },
    onRemoteState(playerId, resetCounter, state) {
      if (ctx != null && race == null) pushState(playerId, resetCounter, state);
    },
    update(dt) {
      if (ctx == null) return;
      if (race == null) sampleSelf();
      updateRace();
      updateStage(dt);
      updateGhost(dt);
      if (window.ApexCollide) window.ApexCollide.frame(collisionSession());
      if (window.ApexLobby && isHost()) {               // what the room list shows of this room (apex-lobby.js)
        const self = players.find(p => p.isSelf);
        window.ApexLobby.hostFrame({
          host: self ? self.nickname : null, countryCode: self ? self.countryCode : null, players: players.length,
          race: !!room().race, phase: race ? race.phase : null, laps: room().race ? raceLaps() : null,
          info: ctx.connection.apexInfo ? ctx.connection.apexInfo() : null,
        });
      }
    },
    end(owner) {
      // A new session may already have taken over; only its owner can tear it down.
      if (owner !== undefined && ctx != null && ctx.owner !== owner) return;
      if (ctx != null && window.ApexLobby) window.ApexLobby.session(false);
      disposeGhost();
      closeStage();
      if (window.ApexShow) window.ApexShow.clear();
      if (window.ApexCollide) window.ApexCollide.frame(null);
      if (board != null) { board.remove(); board = null; }
      if (lights != null) { lights.remove(); lights = null; }
      setHud('');
      ctx = null; players = []; live = new Map(); best = new Map(); selfId = null; selfLastFrames = -1;
      race = null; run = null; course = null; parked = null;
    },

    // --- race hooks
    startTransform(transform) {
      runCounts = timeTrialPhase();
      return applySlot(transform, slotFor(selfId));
    },
    remoteStart(playerId, transform) { return applySlot(transform, slotFor(playerId)); },
    simStart() {                                   // where the physics puts the car being driven
      const s = slotFor(selfId);
      return s == null ? null : { position: { x: s.p[0], y: s.p[1], z: s.p[2] }, quaternion: { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] } };
    },
    locked() { return (race != null && race.phase === 'race' && performance.now() < race.goAt) || watching(); },
    raceActive() { return race != null; },
    // A finished run becomes a personal record (and goes to the leaderboard) like in time trial, except
    // formation and race laps: they start from a grid slot, on the shared clock, on a track that never
    // finishes, so neither their time nor their replay stands on its own. Qualifying laps do count.
    countsAsRecord() { return runCounts && timeTrialPhase(); },
    simTrack(track) { return simTrack(track); },

    // --- host screen ("Race" game mode next to Casual / Competitive)
    modeLabel: () => T.mode,
    modeInfo: () => T.modeInfo,
    hostModeChanged(container, mode) { renderHostOptions(container, mode); },
    hosting(mode) { pendingRoom = mode === 'race' ? { race: true, ...settings } : null; },
    buildMismatch: () => T.buildMismatch,

    // --- mod messages
    fromPeer(connection, peer, payload) {          // host received a mod message from a player
      // The handshake does not depend on a game being loaded: it can arrive while the track is still loading.
      if (payload.length === 0) {
        peer.apexMod = true;
        if (connection.apexRoom != null) sendToPeer(peer, encode(roomMessage(connection.apexRoom)));
        if (ctx != null && race != null && connection === ctx.connection) sendToPeer(peer, encode(stateMessage()));
        if (ctx != null) renderBoard();
        return;
      }
      if (ctx == null || connection !== ctx.connection) return;
      if (peer.apexMod) onMessage(decode(payload), peer);
    },
    fromHost(connection, payload) {                // player received a mod message from the host
      if (payload.length === 0) {
        if (!connection.apexHostIsMod) { connection.apexHostIsMod = true; connection.apexSend(HELLO); }
        return;
      }
      const msg = decode(payload);
      if (msg != null && msg.t === 'room') { connection.apexRoom = roomMessage(msg); if (ctx != null) renderBoard(); return; }
      if (ctx == null || connection !== ctx.connection) return;
      onMessage(msg, null);
    },
  };
})();
