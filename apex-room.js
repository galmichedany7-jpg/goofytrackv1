// Apex room extras (multiplayer)
//
//   1. Top 5 board   best times set in the current room
//   2. Room ghost    the fastest run seen in the room, replayed alongside your own run
//   3. Race mode     the host turns the room into a race: the times set so far act as qualifying,
//                    cars line up on a grid in that order, five lights go out, first across the
//                    line wins
//
// 1 and 2 only use data the game already exchanges, so they work next to unmodified players.
// 3 needs extra messages. They travel on the message type the game reserves for mods (255) and are
// only sent to players that announced this mod, so unmodified players stay connected and simply
// keep practising while a race runs.
//
// The game calls into window.ApexRoom from the hooks added by patch_bundle.js.
(() => {
  'use strict';

  const GHOST_FADE_DISTANCE = 5;      // metres; the ghost fades out when it overlaps your car
  const GHOST_LINGER_FRAMES = 1500;   // keep showing the ghost for 1.5 s after it crosses the line
  const SELF_SAMPLE_FRAMES = 50;      // sample own car at the same rate as network updates
  const MOD_MESSAGE = 255;            // message type reserved by the game for mods
  const LIGHTS_MS = 6500;             // race message -> lights out (5 lights, one per second)
  const GRID_ROW_GAP = 3.0;           // metres between two grid slots along the track
  const GRID_SIDE = 1.15;             // metres left/right of the racing line

  const FR = (navigator.language || '').toLowerCase().startsWith('fr');
  const T = FR
    ? { top: 'TOP 5', grid: 'GRILLE', race: 'COURSE', start: 'Lancer la course', stop: 'Terminer la course', go: 'PARTEZ' }
    : { top: 'TOP 5', grid: 'GRID', race: 'RACE', start: 'Start race', stop: 'End race', go: 'GO' };

  let ctx = null;          // supplied by the game: { owner, makeCar, getSelfCar, interpolate, connection, restart }
  let players = [];        // latest player list
  let live = new Map();    // player id -> { resetCounter, states[] } run currently being driven
  let best = new Map();    // player id -> { frames, states[], nickname, countryCode, carStyle }
  let ghost = null;        // { car, playerId, frames, states, lastT, index }
  let board = null, lights = null;
  let selfId = null;
  let selfLastFrames = -1;
  let race = null;         // { n, grid:[{id,p,q}], goAt, phase:'countdown'|'racing', results:[{id,ms}], sentFinish }
  let raceCounter = 0;

  const isHost = () => ctx != null && typeof ctx.connection.apexPeers === 'function';
  const formatTime = frames => {
    const ms = Math.round(frames) % 1000, s = Math.floor(frames / 1000) % 60, m = Math.floor(frames / 60000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  };
  const recordFrames = p => (p.record == null ? null : p.record.numberOfFrames);
  const nameOf = id => { const p = players.find(p => p.id === id); return p ? p.nickname : '?'; };

  // ================================================================== run capture
  function pushState(id, resetCounter, state) {
    let run = live.get(id);
    if (run == null || resetCounter > run.resetCounter || (state.frames === 0 && run.states.length > 1)) {
      run = { resetCounter, states: [] };
      live.set(id, run);
    }
    const last = run.states[run.states.length - 1];
    if (last == null || state.frames > last.frames) run.states.push(state);
  }

  function sampleSelf() {
    if (selfId == null) return;
    const car = ctx.getSelfCar();
    if (car == null) return;
    const state = car.getCarState();
    if (state.frames < selfLastFrames) live.delete(selfId); // reset: start a new run
    const run = live.get(selfId);
    const last = run && run.states[run.states.length - 1];
    if (last == null || state.frames - last.frames >= SELF_SAMPLE_FRAMES || (state.finishFrames != null && last.finishFrames == null))
      pushState(selfId, 0, state);
    selfLastFrames = state.frames;
  }

  // A player's record changed: the run they are driving right now is the one that set it.
  function commitRun(player, frames) {
    const run = live.get(player.id);
    if (run == null || run.states.length < 2) return;
    const lastFrames = run.states[run.states.length - 1].frames;
    if (lastFrames < frames - 1000) return; // we did not see this run, e.g. record set before we joined
    best.set(player.id, { frames, states: run.states, nickname: player.nickname, countryCode: player.countryCode, carStyle: player.carStyle });
  }

  const leaderRun = () => {
    let leader = null;
    for (const [id, run] of best) if (leader == null || run.frames < leader.run.frames) leader = { id, run };
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
    car.setNameTag(leader.run.countryCode, leader.run.nickname + '  ' + formatTime(leader.run.frames));
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
    ghost.car.setOpacity(Math.max(0, Math.min(1, d / GHOST_FADE_DISTANCE)) * 0.75);
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

  // ================================================================== race
  const rotate = (q, v) => {           // rotate vector v by quaternion q
    const { x, y, z, w } = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };

  // Grid slots follow the line driven by the fastest qualifying run, so they stay on the road even
  // when the track bends right after the start. Without any run they extend straight ahead.
  function buildGrid(order) {
    const self = ctx.getSelfCar();
    const leader = leaderRun();
    const path = leader ? leader.run.states : null;
    const startState = path ? path[0] : self.getCarState();
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

  function hostStartRace() {
    if (!isHost() || race != null) return;
    const modIds = new Set(ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id));
    modIds.add(selfId);
    const order = players.filter(p => modIds.has(p.id)).sort((a, b) => {
      const fa = recordFrames(a), fb = recordFrames(b);
      if (fa == null && fb == null) return a.id - b.id;
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }).map(p => p.id);
    const msg = { t: 'race', n: ++raceCounter, grid: buildGrid(order), lights: LIGHTS_MS };
    broadcast(msg);
    beginRace(msg);
  }

  function hostEndRace() {
    if (!isHost() || race == null) return;
    broadcast({ t: 'end', n: race.n });
    endRace();
  }

  function beginRace(msg) {
    race = { n: msg.n, grid: msg.grid, goAt: performance.now() + msg.lights, phase: 'countdown', results: [], sentFinish: false };
    live = new Map();
    ctx.restart();
    renderBoard();
  }

  function endRace() {
    race = null;
    if (lights != null) { lights.remove(); lights = null; }
    live = new Map();
    selfLastFrames = -1;
    ctx.restart();
    renderBoard();
  }

  function addResult(id, ms) {
    if (race == null || race.results.some(r => r.id === id)) return;
    race.results.push({ id, ms });
    race.results.sort((a, b) => a.ms - b.ms);
  }

  function onMessage(msg, fromPeer) {
    if (msg == null || typeof msg !== 'object') return;
    if (fromPeer != null) {
      // host side: a player crossed the line
      if (msg.t === 'fin' && race != null && msg.n === race.n && Number.isFinite(msg.ms) && msg.ms > 0) {
        addResult(fromPeer.id, msg.ms);
        broadcast({ t: 'res', n: race.n, results: race.results });
        renderBoard();
      }
      return;
    }
    // client side
    if (msg.t === 'race' && Array.isArray(msg.grid) && Number.isFinite(msg.lights)) beginRace(msg);
    else if (msg.t === 'res' && race != null && msg.n === race.n && Array.isArray(msg.results)) { race.results = msg.results; renderBoard(); }
    else if (msg.t === 'end' && race != null) endRace();
  }

  function updateRace() {
    if (race == null) return;
    const self = ctx.getSelfCar();
    const now = performance.now();
    renderLights(now);
    if (race.phase === 'countdown' && now >= race.goAt) { race.phase = 'racing'; renderBoard(); }
    if (race.phase !== 'racing' || self == null) return;
    if (!self.hasStarted()) self.start();
    if (self.hasFinished()) reportFinish(Math.round(now - race.goAt));
  }

  // Race time is measured on the shared clock (since lights out), not on the car's own timer,
  // so restarting your car during a race does not give you a fresh clock.
  function reportFinish(ms) {
    if (race == null || race.sentFinish) return;
    race.sentFinish = true;
    if (isHost()) { addResult(selfId, ms); broadcast({ t: 'res', n: race.n, results: race.results }); }
    else sendToHost({ t: 'fin', n: race.n, ms });
    renderBoard();
  }

  const slotFor = id => (race == null ? null : race.grid.find(s => s.id === id) || null);
  const applySlot = (transform, slot) => {
    if (slot == null) return transform;
    const P = transform.position.constructor, Q = transform.quaternion.constructor;
    return { position: new P(slot.p[0], slot.p[1], slot.p[2]), quaternion: new Q(slot.q[0], slot.q[1], slot.q[2], slot.q[3]) };
  };

  // ================================================================== UI
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function renderLights(now) {
    if (race == null) return;
    const left = race.goAt - now;
    if (left < -1500) { if (lights != null) { lights.remove(); lights = null; } return; }
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

  function row(cls, cells) {
    const r = el('div', 'row' + cls);
    for (const [c, text] of cells) r.appendChild(el('span', c, text));
    return r;
  }

  function renderBoard() {
    if (ctx == null) return;
    if (board == null) {
      board = el('div', 'apex-room-board');
      document.getElementById('ui').appendChild(board);
    }
    board.textContent = '';
    const title = el('div', 'title', race == null ? T.top : race.phase === 'countdown' ? T.grid : T.race);
    title.appendChild(el('span', null, String(players.length)));
    board.appendChild(title);

    if (race != null) {
      // finished cars first (by time), then everybody else in grid order
      const done = new Set(race.results.map(r => r.id));
      const winner = race.results[0];
      race.results.forEach((r, i) => board.appendChild(row(r.id === selfId ? ' self' : '', [
        ['rank', String(i + 1)], ['name', nameOf(r.id)], ['time', formatTime(r.ms)], ['gap', i === 0 ? '' : '+' + ((r.ms - winner.ms) / 1000).toFixed(3)],
      ])));
      race.grid.filter(s => !done.has(s.id)).forEach((s, i) => board.appendChild(row((s.id === selfId ? ' self' : '') + ' pending', [
        ['rank', race.phase === 'countdown' ? String(i + 1) : 'â€“'], ['name', nameOf(s.id)], ['time', ''], ['gap', ''],
      ])));
    } else {
      const ranked = players.filter(p => recordFrames(p) != null).sort((a, b) => recordFrames(a) - recordFrames(b)).slice(0, 5);
      if (ranked.length === 0) board.appendChild(el('div', 'empty', '--:--.---'));
      const leaderFrames = ranked.length ? recordFrames(ranked[0]) : 0;
      ranked.forEach((p, i) => board.appendChild(row((p.isSelf ? ' self' : '') + (ghost != null && ghost.playerId === p.id ? ' ghost' : ''), [
        ['rank', String(i + 1)], ['name', p.nickname], ['time', formatTime(recordFrames(p))],
        ['gap', i === 0 ? '' : '+' + ((recordFrames(p) - leaderFrames) / 1000).toFixed(3)],
      ])));
    }

    if (isHost()) {
      const button = el('button', 'race-button' + (race != null ? ' stop' : ''), race == null ? T.start : T.stop);
      button.addEventListener('click', () => (race == null ? hostStartRace() : hostEndRace()));
      board.appendChild(button);
    }
  }

  // ================================================================== hooks called by the game
  window.ApexRoom = {
    // Debug helpers for the console: a read-only snapshot, and a way to simulate crossing the line
    debugFinish: ms => reportFinish(ms),
    debug: () => ({
      players: players.length, host: isHost(), hostIsMod: !!(ctx && ctx.connection.apexHostIsMod),
      modPeers: isHost() ? ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id) : null,
      live: [...live].map(([id, r]) => [id, r.states.length]),
      best: [...best].map(([id, r]) => [id, r.frames, r.states.length]),
      ghost: ghost && { playerId: ghost.playerId, frames: ghost.frames, lastT: ghost.lastT },
      race: race && { n: race.n, phase: race.phase, grid: race.grid, results: race.results, goIn: Math.round(race.goAt - performance.now()) },
    }),

    begin(context) {
      this.end();
      ctx = context;
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
      renderBoard();
    },
    onRemoteState(playerId, resetCounter, state) {
      if (ctx != null && race == null) pushState(playerId, resetCounter, state);
    },
    update(dt) {
      if (ctx == null) return;
      if (race == null) sampleSelf();
      updateRace();
      updateGhost(dt);
    },
    end(owner) {
      // A new session may already have taken over; only its owner can tear it down.
      if (owner !== undefined && ctx != null && ctx.owner !== owner) return;
      disposeGhost();
      if (board != null) { board.remove(); board = null; }
      if (lights != null) { lights.remove(); lights = null; }
      ctx = null; players = []; live = new Map(); best = new Map(); selfId = null; selfLastFrames = -1;
      race = null;
    },

    // --- race hooks
    startTransform(transform) { return applySlot(transform, slotFor(selfId)); },
    remoteStart(playerId, transform) { return applySlot(transform, slotFor(playerId)); },
    locked() { return race != null && race.phase === 'countdown'; },
    raceActive() { return race != null; },

    // --- mod messages
    fromPeer(connection, peer, payload) {          // host received a mod message from a player
      // The handshake does not depend on a game being loaded: it can arrive while the track is still loading.
      if (payload.length === 0) { peer.apexMod = true; if (ctx != null) renderBoard(); return; }
      if (ctx == null || connection !== ctx.connection) return;
      if (peer.apexMod) onMessage(decode(payload), peer);
    },
    fromHost(connection, payload) {                // player received a mod message from the host
      if (payload.length === 0) {
        if (!connection.apexHostIsMod) { connection.apexHostIsMod = true; connection.apexSend(HELLO); }
        return;
      }
      if (ctx == null || connection !== ctx.connection) return;
      onMessage(decode(payload), null);
    },
  };
})();
