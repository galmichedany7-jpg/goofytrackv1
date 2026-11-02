// Apex room extras (multiplayer)
//
//   1. Session board best times set in the current room, live (places sliding, personal bests on purple, banners)
//   2. Room ghost    the fastest run seen in the room, replayed alongside your own run
//   3. Race rooms    hosted with the "Race" game mode. The host runs an event made of:
//                      qualifying   (optional) free timed laps, the best one sets the grid order
//                      formation    (optional) one untimed lap from the grid slots
//                      race         a look at the circuit, five lights, then N laps; live standings,
//                                   and a podium once everybody is in (the two scenes: apex-show.js)
//                    The host picks the event's format:
//                      race         as above (any track)
//                      tournament   "tournoi course": the same, on a circuit fit for tournaments (TOURNAMENT_CIRCUITS),
//                                   two timed attempts each in qualifying, a grid drawn at random without
//                                   qualifying; the winner counts a tournament won
//                      endurance    each driver picks a strategy (apex-endurance.js), then a race against the clock
//                                   (15 to 20 minutes) with fuel, tyres and pit stops; once the time is up, every car
//                                   finishes as it next crosses the line; the most laps win
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
  // Grids painted on a circuit's start straight (tools/forest_design.js, drawn by apex-town.js), by the id of its
  // start part: behind the start line, the pole's box `first` metres back, `gap` metres between two boxes, staggered
  // `side` metres left and right of the middle of the road
  const PAINTED_GRIDS = { 229: { first: 8, gap: 8, side: 4.5, slots: 16 } };
  // Circuits fit for tournaments, by the id of their start part: a grid painted behind the start line (above) and a
  // pit lane the cars can drive into (Forest Speedway, tools/forest_design.js). pits, in the start line's frame
  // (metres; z along the road, > 0 past the line; x across it, on either side): where the cars stop (box), the whole
  // lane (lane, the speed limiter) and how far it is from the middle of the road. road: the circuit's road part, and
  // the same road without the wall that closes the pit lane in the other modes (patch_bundle.js, OPEN_PITS)
  const TOURNAMENT_CIRCUITS = { 229: { pits: { box: [-120, 110], lane: [-175, 165], across: [19, 37] }, road: [228, 227] } };
  const KINDS = ['race', 'tournament', 'endurance'];
  const QUALI_ATTEMPTS = 2;           // timed laps each in a tournament's qualifying
  const MIN_MINUTES = 15, MAX_MINUTES = 20;   // an endurance race
  const START_GATE = 40;              // metres either side of the middle of the road: the line that counts endurance laps, pit lane included
  const LOOP_DISTANCE = 50;           // metres; a finish this close to the start makes the track a circuit
  const TELEPORT_DISTANCE = 40;       // metres in one frame: a respawn, not a crossing
  const MAX_LAPS = 20;
  const SETTINGS_KEY = 'goofytrack.raceSettings';
  const WATCH_JOIN_MS = 60000;        // "Watch" in the room list holds for the room joined within a minute

  // Game modules (webpack ids of PolyTrack 0.6.3)
  const MOD_TRACK_DATA = 9117, MOD_PARTS = 2600, MOD_ROTATION = 5494;
  const PART_SIZE = 5;                // metres per track unit
  const CHECKPOINT_PART = 52;
  const DETECTOR_CHECKPOINT = 0, DETECTOR_FINISH = 1;

  // Texts follow the game's language setting (published by a hook), the system language until then
  const TEXTS_FR = {
    top: 'MEILLEURS TEMPS', race: 'COURSE', quali: 'QUALIFS', formation: 'FORMATION', results: 'RÉSULTATS', go: 'PARTEZ',
    mode: 'Course', modeInfo: 'Qualifications, tour de formation puis course en plusieurs tours, départ arrêté aux feux.',
    laps: 'Tours', qualiOpt: 'Qualifications', formationOpt: 'Tour de formation',
    lapsOf: (a, b) => `${a}/${b}`, lap: 'TOUR', best: 'Meilleur', last: 'Dernier',
    waitGrid: 'En attente de la grille', finished: p => `ARRIVÉE  P${p}`, notLoop: 'Piste sans boucle : 1 tour', contact: 'Collisions activées',
    start: 'Lancer', toFormation: 'Tour de formation', toRace: 'Départ', stop: 'Arrêter', done: 'Terminer',
    qualiHud: 'QUALIFICATIONS', formationHud: 'TOUR DE FORMATION', resultsHud: 'COURSE TERMINÉE',
    buildMismatch: "Erreur : votre version de GoofyTrack n'est pas celle de l'hôte. Installez le même build que lui.",
    gameMode: 'Mode de jeu', casual: 'Décontracté', competitive: 'Compétitif', changeTrack: 'Changer de piste',
    casualInfo: 'Les joueurs jouent pour améliorer leurs meilleurs temps personnels.',
    competitiveInfo: 'Les joueurs s\'affrontent pour établir le meilleur temps de la session.',
    selectTrack: 'Sélectionner la piste', back: 'Retour', confirm: 'Valider', nextSession: 'Prochaine session', personalBest: 'RECORD PERSONNEL', sessionBest: 'MEILLEUR TEMPS DE LA SESSION',
    youPropose: 'Vous proposez une nouvelle session', hostProposes: "L'hôte propose une nouvelle session", voteTrack: 'Circuit',
    yes: 'Oui', no: 'Non', accept: 'Accepter', decline: 'Refuser', cancelVote: 'Annuler la proposition',
    tally: (y, n, t) => `${y} pour · ${n} contre · ${t} joueurs`,
    accepted: 'Proposition acceptée', declined: 'Proposition refusée', cancelled: "Proposition annulée par l'hôte",
    startsIn: s => `Nouvelle session dans ${s} s`,
    watch: 'Regarder', drive: 'Reprendre le volant', watchers: n => n + (n > 1 ? ' spectateurs' : ' spectateur'),
    format: 'Format', kind_race: 'Course libre', kind_tournament: 'Tournoi course', kind_endurance: 'Endurance',
    info_tournament: 'Tournoi : 2 tentatives chronométrées en qualifications (sinon grille tirée au sort), tour de formation, puis la course. Le vainqueur gagne le tournoi.',
    info_endurance: 'Tournoi endurance : chacun choisit sa stratégie (essence, vitesse, pneus), puis course contre la montre avec ravitaillements aux stands. Le plus de tours gagne.',
    minutes: 'Durée', minutesValue: m => `${m} min`, notEligible: 'Tournois : piste sans grille ni stands valides. Seul Forest Speedway convient pour l\'instant.',
    attempt: (a, b) => `Tentative ${a}/${b}`, qualiDone: 'Qualifications terminées', strategy: 'STRATÉGIES', strategyHud: 'CHOIX DE LA STRATÉGIE',
    waitStrategies: (a, b) => `${a}/${b} pilotes ont choisi`, timeLeft: t => `${t} restantes`, lastLap: 'DERNIER TOUR', lapsDone: n => `${n} T`,
    tournamentWon: 'TOURNOI GAGNÉ', randomGrid: 'Grille tirée au sort',
  };
  const TEXTS_EN = {
    top: 'BEST TIMES', race: 'RACE', quali: 'QUALIFYING', formation: 'FORMATION', results: 'RESULTS', go: 'GO',
    mode: 'Race', modeInfo: 'Qualifying, formation lap, then a race over several laps from a standing start.',
    laps: 'Laps', qualiOpt: 'Qualifying', formationOpt: 'Formation lap',
    lapsOf: (a, b) => `${a}/${b}`, lap: 'LAP', best: 'Best', last: 'Last',
    waitGrid: 'Waiting for the grid', finished: p => `FINISHED  P${p}`, notLoop: 'Track does not loop: 1 lap', contact: 'Collisions on',
    start: 'Start', toFormation: 'Formation lap', toRace: 'Start race', stop: 'Stop', done: 'Finish',
    qualiHud: 'QUALIFYING', formationHud: 'FORMATION LAP', resultsHud: 'RACE OVER',
    buildMismatch: "Error: your GoofyTrack build is not the same as the host's. Install the same build.",
    gameMode: 'Game Mode', casual: 'Casual', competitive: 'Competitive', changeTrack: 'Change Track',
    casualInfo: 'Players play to improve their personal best times.',
    competitiveInfo: 'Players compete to set the best time in the session.',
    selectTrack: 'Select Track', back: 'Back', confirm: 'Confirm', nextSession: 'Next session', personalBest: 'PERSONAL BEST', sessionBest: 'FASTEST OF THE SESSION',
    youPropose: 'You propose a new session', hostProposes: 'The host proposes a new session', voteTrack: 'Track',
    yes: 'Yes', no: 'No', accept: 'Accept', decline: 'Decline', cancelVote: 'Cancel the proposal',
    tally: (y, n, t) => `${y} for · ${n} against · ${t} players`,
    accepted: 'Proposal accepted', declined: 'Proposal declined', cancelled: 'Proposal cancelled by the host',
    startsIn: s => `New session in ${s} s`,
    watch: 'Watch', drive: 'Back to driving', watchers: n => n + (n > 1 ? ' spectators' : ' spectator'),
    format: 'Format', kind_race: 'Free race', kind_tournament: 'Race tournament', kind_endurance: 'Endurance',
    info_tournament: 'Tournament: 2 timed attempts in qualifying (otherwise a grid drawn at random), formation lap, then the race. The winner wins the tournament.',
    info_endurance: 'Endurance tournament: everybody picks a strategy (fuel, speed, tyres), then a race against the clock with pit stops. The most laps win.',
    minutes: 'Duration', minutesValue: m => `${m} min`, notEligible: 'Tournaments: this track has no proper grid and pits. Only Forest Speedway fits for now.',
    attempt: (a, b) => `Attempt ${a}/${b}`, qualiDone: 'Qualifying done', strategy: 'STRATEGIES', strategyHud: 'PICK YOUR STRATEGY',
    waitStrategies: (a, b) => `${a}/${b} drivers have picked`, timeLeft: t => `${t} left`, lastLap: 'LAST LAP', lapsDone: n => `${n} L`,
    tournamentWon: 'TOURNAMENT WON', randomGrid: 'Grid drawn at random',
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
  let watchNext = 0;       // the room list's "Watch": when it was clicked, the room then joined is watched (apex-spectate.js)
  let silenced = null;     // the own car, once its sound is off while watching

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
  const DEFAULT_SETTINGS = { laps: 3, quali: true, formation: true, kind: 'race', minutes: MIN_MINUTES };
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
    kind: KINDS.includes(s.kind) ? s.kind : 'race',
    minutes: Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(Number(s.minutes)) || MIN_MINUTES)),
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
  const roomMessage = r => ({ t: 'room', race: !!r.race, laps: r.laps, quali: r.quali, formation: r.formation, kind: KINDS.includes(r.kind) ? r.kind : 'race', minutes: r.minutes });
  // the event's format (null: not a race room), and whether the track can hold a tournament
  const kindOf = r => (r.race ? (KINDS.includes(r.kind) ? r.kind : 'race') : null);
  const eligible = () => course != null && course.circuit != null && course.loop;

  // ================================================================== GoofyTrack accounts of the players
  // Each player tells the host their account number (apex-account.js) once the host greets them ('acct'), and the
  // host sends everybody the numbers by player id ('accts'), its own with them: a click on a player in the game's
  // player list opens their card, from which they can be added as a friend. Kept on the connection, as the room
  // settings: it can arrive while the track is still loading.
  let lastConnection = null;           // the room's connection, between two tracks too (the player list)
  const accountId = id => (Number.isSafeInteger(id) && id > 0 ? id : null);
  const accountsOf = connection => (connection.apexAccounts ??= new Map());   // player id -> account number or null
  const accountsMessage = connection => {
    const list = [...accountsOf(connection)];
    const self = connection.getPlayers?.().find(p => p.isSelf);
    if (self != null) list.push([self.id, accountId(window.ApexAccount?.id)]);
    return { t: 'accts', list };
  };
  function hostAccounts(connection) {   // to every player running the mod
    const bytes = encode(accountsMessage(connection));
    for (const peer of connection.apexPeers()) if (peer.apexMod) sendToPeer(peer, bytes);
  }
  function onAccountMessage(connection, msg, peer) {
    if (peer != null && msg.t === 'acct') {
      accountsOf(connection).set(peer.id, accountId(msg.id));
      hostAccounts(connection);
      return true;
    }
    if (peer == null && msg.t === 'accts' && Array.isArray(msg.list)) {
      connection.apexAccounts = new Map(msg.list.filter(e => Array.isArray(e) && Number.isInteger(e[0])).map(([id, n]) => [id, accountId(n)]));
      return true;
    }
    return false;
  }
  // a row of the game's player list (patch_bundle.js): a click opens the player's card, your own for your row
  function playerRow(row, player) {
    if (!window.ApexAccount) return;
    row.classList.add('apex-openable');
    row.addEventListener('click', event => {
      if (event.target.closest('button') != null) return;          // the host's kick button
      if (player.isSelf) { window.ApexAccount.open(); return; }
      const known = lastConnection?.apexAccounts;
      window.ApexAccount.openPlayer(known ? known.get(player.id) ?? null : null);
    });
    row.dataset.apexPlayer = player.id;
    row.classList.toggle('apex-watching', spectatorsOf(lastConnection).has(player.id));
  }

  // ================================================================== spectators (apex-spectate.js)
  // A player who watches the room tells the host ('spec'), and the host sends everybody the ids of those who watch
  // ('specs'), its own with them. Their parked cars are hidden, and left out of the grid, the collisions and the
  // mini-map. Kept on the connection, as the accounts: watching lasts from one track to the next.
  const NOBODY = new Set();
  const spectatorsOf = connection => (connection != null && connection.apexSpectators) || NOBODY;
  const isSpectator = id => ctx != null && spectatorsOf(ctx.connection).has(id);
  const watchingSelf = () => ctx != null && ctx.connection.apexWatching === true;
  function hostSpectators(connection) {   // who watches now: to every player running the mod, when it changed
    const ids = connection.apexPeers().filter(p => p.apexWatching).map(p => p.id);
    const self = connection.getPlayers?.().find(p => p.isSelf);
    if (connection.apexWatching && self != null) ids.push(self.id);
    const was = spectatorsOf(connection);
    if (ids.length === was.size && ids.every(id => was.has(id))) return;
    connection.apexSpectators = new Set(ids);
    const bytes = encode({ t: 'specs', ids });
    for (const peer of connection.apexPeers()) if (peer.apexMod) sendToPeer(peer, bytes);
    spectatorsChanged(connection);
  }
  function onSpectatorMessage(connection, msg, peer) {
    if (peer != null && msg.t === 'spec') { peer.apexWatching = msg.on === true; hostSpectators(connection); return true; }
    if (peer == null && msg.t === 'specs' && Array.isArray(msg.ids)) {
      connection.apexSpectators = new Set(msg.ids.filter(Number.isInteger));
      spectatorsChanged(connection);
      return true;
    }
    return false;
  }
  function spectatorsChanged(connection) {
    const ids = spectatorsOf(connection);
    for (const r of document.querySelectorAll('#ui [data-apex-player]')) r.classList.toggle('apex-watching', ids.has(Number(r.dataset.apexPlayer)));
    if (ctx == null || ctx.connection !== connection) return;
    if (isHost() && race != null) hostCheckProgress();   // a car of the grid may have stopped driving
    else renderBoard();
  }

  function setWatching(on) {
    if (ctx == null || watchingSelf() === on) return;
    ctx.connection.apexWatching = on;
    if (isHost()) hostSpectators(ctx.connection);
    else sendToHost({ t: 'spec', on });
    if (!on) stopWatching();
    ctx.restart();       // back on the start line: parked while watching, a fresh run when driving again
    if (on) startWatching();
    renderBoard();
  }
  function startWatching() {
    const ui = document.getElementById('ui');
    if (ui != null) ui.classList.add('apex-spectating');      // the HUD of your own car goes (apex-theme.css)
    if (window.ApexSpectate) window.ApexSpectate.watch(ctx.owner, watchCars, () => setWatching(false));
  }
  function stopWatching() {
    const ui = document.getElementById('ui');
    if (ui != null) ui.classList.remove('apex-spectating');
    if (window.ApexSpectate && ctx != null) window.ApexSpectate.unwatch(ctx.owner);
  }
  // The cars that can be watched: in race order during a race, as the game lists the players otherwise
  function watchCars() {
    if (ctx == null) return [];
    const remotes = ctx.remotes(), order = race != null && race.grid != null ? raceOrder() : [];
    const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    return players.filter(p => !p.isSelf && !isSpectator(p.id) && remotes.get(p.id)?.car != null)
      .sort((a, b) => rank(a.id) - rank(b.id))
      .map(p => ({ id: p.id, name: p.nickname, info: watchInfo(p, order), car: remotes.get(p.id).car }));
  }
  function watchInfo(p, order) {
    if (race != null && race.phase === 'race' && race.grid != null) {
      const done = race.results.findIndex(r => r.id === p.id);
      if (done >= 0) return T.finished(done + 1);
      const at = order.indexOf(p.id), progress = race.progress.get(p.id);
      if (endurance()) return at < 0 ? null : 'P' + (at + 1) + '  ·  ' + T.lapsDone(progress ? progress.lap : 0);
      return at < 0 ? null : 'P' + (at + 1) + '  ·  ' + T.lap + ' ' + T.lapsOf(Math.min((progress ? progress.lap : 0) + 1, race.laps), race.laps);
    }
    if (race != null && race.phase === 'quali') return race.quali.has(p.id) ? formatTime(race.quali.get(p.id)) : null;
    const frames = recordFrames(p);
    return frames == null ? null : formatTime(frames);
  }

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
    let circuit = null;
    track.forEachPart((x, y, z, id, rotation, axis, color, checkpointOrder) => {
      if (TOURNAMENT_CIRCUITS[id] != null && PAINTED_GRIDS[id] != null) circuit = TOURNAMENT_CIRCUITS[id];
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
      circuit,
      start: start ? { p: s, q: { x: start.quaternion.x, y: start.quaternion.y, z: start.quaternion.z, w: start.quaternion.w } } : null,
    };
  }
  // a point in the start line's frame: [across, up, along the road (> 0 past the line)]
  const startFrame = p => unrotate(course.start.q, [p.x - course.start.p[0], p.y - course.start.p[1], p.z - course.start.p[2]]);
  // where a point stands in the pit lane of the circuit: 'box', 'lane' or null (apex-endurance.js)
  function pitAt(p) {
    if (course == null || course.circuit == null || course.start == null) return null;
    const { box, lane, across } = course.circuit.pits, [x, y, z] = startFrame(p), off = Math.abs(x);
    if (Math.abs(y) > 6 || off < across[0] || off > across[1]) return null;
    return z >= box[0] && z <= box[1] ? 'box' : z >= lane[0] && z <= lane[1] ? 'lane' : null;
  }
  // does the segment a -> b cross the start line forwards, on the road or in the pit lane? (endurance laps)
  function crossesStart(a, b) {
    if (course == null || course.start == null) return false;
    const la = startFrame(a), lb = startFrame(b);
    if (!(la[2] < 0 && lb[2] >= 0)) return false;
    const k = -la[2] / (lb[2] - la[2]), x = la[0] + (lb[0] - la[0]) * k, y = la[1] + (lb[1] - la[1]) * k;
    return Math.abs(x) < START_GATE && Math.abs(y) < 8;
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
  // An endurance race also opens the pit lane: the circuit's road is swapped for the same road without the wall
  // that closes the pit lane everywhere else.
  function simTrack(track) {
    const save = track.toSaveString();
    const endurance = race != null && race.kind === 'endurance' && race.phase === 'race';
    if (race == null || race.phase !== 'race' || (race.laps <= 1 && !endurance)) return save;
    try {
      const TrackData = gameModule(MOD_TRACK_DATA).A;
      const copy = new TrackData(track.environment, track.sunDirection);
      const road = endurance && course != null && course.circuit != null ? course.circuit.road : null;
      let maxOrder = -1, maxY = -Infinity, px = 0, pz = 0;
      track.forEachPart((x, y, z, id, rotation, axis, color, checkpointOrder, startOrder) => {
        copy.addPart(x, y, z, road != null && id === road[0] ? road[1] : id, rotation, axis, color, checkpointOrder, startOrder);
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
    // a circuit with a grid painted behind its start line: one car per box, the pole in the front one
    let painted = null;
    ctx.track().getTrackData().forEachPart((x, y, z, id) => { if (PAINTED_GRIDS[id] != null) painted = PAINTED_GRIDS[id]; });
    if (painted != null) {
      const fwd = rotate(startState.quaternion, [0, 0, 1]), q = startState.quaternion;
      return order.map((id, k) => {
        const d = -(painted.first + k * painted.gap), side = rotate(q, [k % 2 === 0 ? -painted.side : painted.side, 0, 0]);
        const p = startState.position;
        return { id, p: [p.x + fwd[0] * d + side[0], p.y + fwd[1] * d + side[1], p.z + fwd[2] * d + side[2]], q: [q.x, q.y, q.z, q.w] };
      });
    }
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

  // The mod players who can take part (not watching)
  function contenders() {
    const modIds = new Set(ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id));
    modIds.add(selfId);
    return players.filter(p => modIds.has(p.id) && !isSpectator(p.id)).map(p => p.id);
  }
  // Mod players, fastest first: qualifying times when there are some, room times otherwise. A tournament without
  // qualifying times draws its grid at random.
  function gridOrder() {
    if (race.kind !== 'race' && race.quali.size === 0) {
      const ids = contenders();
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      return ids;
    }
    const modIds = new Set(ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id));
    modIds.add(selfId);
    const timeOf = p => {
      if (race.quali.size > 0) return race.quali.has(p.id) ? race.quali.get(p.id) : null;
      return recordFrames(p);
    };
    return players.filter(p => modIds.has(p.id) && !isSpectator(p.id)).sort((a, b) => {
      const fa = timeOf(a), fb = timeOf(b);
      if (fa == null && fb == null) return a.id - b.id;
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }).map(p => p.id);
  }

  const gridPhase = () => race != null && (race.phase === 'formation' || race.phase === 'strategy' || race.phase === 'race');
  const slotFor = id => (race == null || race.grid == null || !gridPhase() ? null : race.grid.find(s => s.id === id) || null);
  // Cars are solid for each other in a race room, all the time: free practice, qualifying,
  // formation lap and race. See apex-collide.js.
  //   on a grid (formation, race)   the cars of the grid, from the moment they sit on it
  //   otherwise                     every car that is moving; cars start from the same spot there,
  //                                 and a car inside another one only turns solid once clear of it
  const collisionSession = () => {
    if (ctx == null || !room().race || watchingSelf()) return null;
    const onGrid = race != null && race.grid != null && gridPhase();
    if (!onGrid) return { remotes: ctx.remotes(), solid: id => !isSpectator(id), moving: true };
    if (slotFor(selfId) == null) return null;       // joined during the race: only watching
    const grid = race.grid;
    return { remotes: ctx.remotes(), solid: id => grid.some(s => s.id === id) && !isSpectator(id), moving: false };
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
  // laps and times. Phases: quali -> formation -> race -> results (quali and formation optional),
  // strategy -> race -> results for an endurance race.
  const newRace = () => ({
    n: ++raceCounter, phase: null, laps: 1, grid: null, goAt: 0, kind: 'race', minutes: 0,
    quali: new Map(),    // id -> best qualifying time (ms)
    attempts: new Map(), // id -> timed laps driven in a tournament's qualifying
    done: new Set(),     // ids that completed the formation lap
    strat: new Map(),    // id -> strategy picked for an endurance race (apex-endurance.js)
    progress: new Map(), // id -> { lap, ms } laps completed, race clock at the last one
    results: [],         // [{ id, ms, lap }] finishing order
  });
  const newRun = () => ({ lap: 0, nextCp: 0, lastPos: null, lastLapMs: null, lastLapTime: null, best: null, sentDone: false, finished: false, attempts: 0, sentRun: false, strategy: null, picking: false, fuelled: false });
  const endurance = () => race != null && race.kind === 'endurance';
  const raceMs = () => race.minutes * 60000;

  const stateMessage = () => ({
    t: 'state', n: race.n, phase: race.phase, laps: race.laps, grid: race.grid, kind: race.kind, minutes: race.minutes,
    lights: race.phase === 'race' ? Math.max(0, Math.round(race.goAt - performance.now())) : 0,
    quali: [...race.quali], attempts: [...race.attempts], done: [...race.done], strat: [...race.strat].map(([id]) => id),
    progress: [...race.progress].map(([id, p]) => [id, p.lap, p.ms]), results: race.results,
  });
  const publish = () => { if (isHost() && race != null) broadcast(stateMessage()); renderBoard(); };

  function enterPhase(phase) {          // everybody, host included
    const was = run;
    race.phase = phase;
    if (phase === 'race') race.goAt = performance.now() + INTRO_MS + LIGHTS_MS;
    if (phase !== 'results') {
      run = newRun();
      if (was != null && phase === 'race') run.strategy = was.strategy;     // picked during the strategy phase
      live = new Map();
      selfLastFrames = -1;
      ctx.restart();
    }
    if (phase !== 'strategy' && window.ApexEndurance) window.ApexEndurance.closePicker();
    if (phase !== 'race' && window.ApexEndurance) window.ApexEndurance.stop();
    if (phase === 'race') showIntro();
    renderBoard();
  }

  // ---- host
  function hostStart() {
    if (!isHost() || race != null) return;
    const r = room(), kind = kindOf(r);
    if (kind !== 'race' && !eligible()) return;
    race = newRace();
    race.kind = kind;
    race.laps = kind === 'endurance' ? 0 : raceLaps();
    race.minutes = kind === 'endurance' ? r.minutes : 0;
    hostGoTo(kind === 'endurance' ? 'strategy' : r.quali ? 'quali' : r.formation ? 'formation' : 'race');
  }
  function hostNext() {
    if (!isHost() || race == null) return;
    if (race.phase === 'quali') hostGoTo(room().formation ? 'formation' : 'race');
    else if (race.phase === 'formation' || race.phase === 'strategy') hostGoTo('race');
  }
  function hostGoTo(phase) {
    if (phase === 'formation' || phase === 'strategy' || (phase === 'race' && race.grid == null)) race.grid = buildGrid(gridOrder());
    enterPhase(phase);
    publish();
  }
  function hostStop() {
    if (!isHost() || race == null) return;
    // an endurance race whose time is up: the order as it stands is the result, for those still out on the track
    if (endurance() && race.phase === 'race' && performance.now() - race.goAt >= raceMs()) {
      for (const id of raceOrder()) if (!race.results.some(r => r.id === id)) {
        const p = race.progress.get(id);
        race.results.push({ id, ms: p ? p.ms : Math.round(performance.now() - race.goAt), lap: p ? p.lap : 0 });
      }
      race.phase = 'results';
      publish();
      return;
    }
    broadcast({ t: 'end', n: race.n });
    endRace();
  }
  const gridPresent = () => race.grid.filter(s => players.some(p => p.id === s.id) && !isSpectator(s.id)).map(s => s.id);
  function hostCheckProgress() {
    if (race.phase === 'quali' && race.kind === 'tournament') {
      const ids = contenders();
      if (ids.length > 0 && ids.every(id => (race.attempts.get(id) || 0) >= QUALI_ATTEMPTS)) { hostNext(); return; }
    }
    if (race.phase === 'strategy' && gridPresent().every(id => race.strat.has(id))) { hostGoTo('race'); return; }
    if (race.phase === 'formation' && gridPresent().every(id => race.done.has(id))) { hostGoTo('race'); return; }
    if (race.phase === 'race' && gridPresent().every(id => race.results.some(r => r.id === id))) { race.phase = 'results'; publish(); return; }
    publish();
  }
  // endurance results: the most laps first, then who completed them first
  const byLaps = (a, b) => b.lap - a.lap || a.ms - b.ms;
  function hostReport(id, msg) {        // a player (or the host itself) reported something
    if (race == null || msg.n !== race.n) return;
    const onGrid = race.grid != null && race.grid.some(s => s.id === id); // players who joined later only watch
    if (msg.t !== 'q' && !onGrid) return;
    if (msg.t === 'q' && race.phase === 'quali' && Number.isFinite(msg.ms) && msg.ms > 0) {
      if (race.kind === 'tournament') {               // two timed laps each, the best one counts
        const n = race.attempts.get(id) || 0;
        if (n >= QUALI_ATTEMPTS) return;
        race.attempts.set(id, n + 1);
      }
      if (!race.quali.has(id) || msg.ms < race.quali.get(id)) race.quali.set(id, msg.ms);
    } else if (msg.t === 'st' && race.phase === 'strategy') {
      race.strat.set(id, window.ApexEndurance ? window.ApexEndurance.strategyOf(msg.s) : msg.s);
    } else if (msg.t === 'fd' && race.phase === 'formation') {
      race.done.add(id);
    } else if (msg.t === 'lap' && race.phase === 'race' && Number.isInteger(msg.lap) && msg.lap >= 0 && Number.isFinite(msg.ms)) {
      if (race.results.some(r => r.id === id)) return;
      if (race.kind === 'endurance') {
        race.progress.set(id, { lap: msg.lap, ms: msg.ms });
        if (msg.done === true) { race.results.push({ id, ms: msg.ms, lap: msg.lap }); race.results.sort(byLaps); }
      } else {
        race.progress.set(id, { lap: Math.min(msg.lap, race.laps), ms: msg.ms });
        if (msg.lap >= race.laps) race.results.push({ id, ms: msg.ms });
      }
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
    race.kind = KINDS.includes(msg.kind) ? msg.kind : 'race';
    race.minutes = Number(msg.minutes) || 0;
    race.quali = new Map(msg.quali);
    race.attempts = new Map(Array.isArray(msg.attempts) ? msg.attempts : []);
    race.strat = new Map((Array.isArray(msg.strat) ? msg.strat : []).map(id => [id, true]));   // who has picked, not what
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
    if (window.ApexEndurance) { window.ApexEndurance.stop(); window.ApexEndurance.closePicker(); }
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
    if (watchingSelf()) { setHud(''); return; }       // the lights are shown, the own car stays parked
    const state = self.getCarState();
    if (race.phase === 'race' && now < race.goAt && state.frames === 0 && !state.hasStarted) parked = state;
    if (state.frames < selfLastFrames && race.phase !== 'results') {   // the player restarted their run
      const was = run;
      run = newRun();
      run.best = was.best;
      run.attempts = was.attempts;
      run.strategy = was.strategy;
      run.picking = was.picking;
      if (endurance()) {
        // back on the grid in an endurance race: the laps done stay, the lap under way starts again, so does the fuel
        Object.assign(run, { lap: was.lap, lastLapMs: was.lastLapMs, lastLapTime: was.lastLapTime, finished: was.finished, fuelled: was.fuelled });
      } else if (race.phase === 'race' && now >= race.goAt) report({ t: 'lap', lap: 0, ms: Math.round(now - race.goAt) });
    }
    selfLastFrames = state.frames;

    if (race.phase === 'quali' && self.hasFinished()) {
      const ms = self.getFinishTime().numberOfFrames;
      if (race.kind === 'tournament') {               // each timed lap is an attempt, two of them
        if (!run.sentRun && run.attempts < QUALI_ATTEMPTS) {
          run.sentRun = true;
          run.attempts++;
          if (run.best == null || ms < run.best) run.best = ms;
          report({ t: 'q', ms });
        }
      } else if (run.best == null || ms < run.best) { run.best = ms; report({ t: 'q', ms }); }
    } else if (race.phase === 'strategy') {
      pickStrategy();
    } else if (race.phase === 'formation' && self.hasFinished() && !run.sentDone) {
      run.sentDone = true;
      report({ t: 'fd' });
    } else if (race.phase === 'race' && now >= race.goAt) {
      if (!self.hasStarted()) self.start();
      if (endurance()) updateEndurance(state, now);
      else updateLaps(state, now);
    }
    renderHud(now);
  }

  // The strategy of an endurance race, picked on a popup before the start (apex-endurance.js): it can be changed
  // until the race starts; the host only learns that the driver has picked.
  function pickStrategy() {
    if (run.picking || !window.ApexEndurance || slotFor(selfId) == null) return;
    run.picking = true;
    window.ApexEndurance.pick(run.strategy, key => {
      if (run == null || race == null || race.phase !== 'strategy') return;
      run.strategy = key;
      report({ t: 'st', s: key });
    });
  }

  // Endurance laps: the start line crossed forwards after every checkpoint, by the road or the pit lane. Once the time
  // is up, the next crossing ends the driver's race.
  function updateEndurance(state, now) {
    if (slotFor(selfId) == null) return;              // joined during the race: only watching
    if (!run.fuelled && window.ApexEndurance) { run.fuelled = true; window.ApexEndurance.start(run.strategy); }
    if (run.finished) { if (window.ApexEndurance) window.ApexEndurance.stop(); return; }
    if (window.ApexEndurance) window.ApexEndurance.frame(state, pitAt);
    const p = state.position, last = run.lastPos;
    run.lastPos = { x: p.x, y: p.y, z: p.z };
    if (last == null || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) >= TELEPORT_DISTANCE) return;
    if (run.nextCp < course.checkpoints.length) {
      if (course.checkpoints[run.nextCp].some(d => crosses(d, last, p))) run.nextCp++;
      return;
    }
    if (!crossesStart(last, p)) return;
    const ms = Math.round(now - race.goAt);
    run.lap++;
    run.nextCp = 0;
    run.lastLapTime = ms - (run.lastLapMs || 0);
    run.lastLapMs = ms;
    if (ms >= raceMs()) run.finished = true;
    report({ t: 'lap', lap: run.lap, ms, done: run.finished });
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
    // the profile card counts the races finished against others, the wins and the podiums (apex-account.js);
    // the last car in may only learn its place with the results
    // (an endurance race's places are only known with the results: the cars finish one lap after another)
    // the winner of a tournament also counts a tournament won
    const placed = race.phase === 'results' || (race.phase === 'race' && !endurance() && run.finished);
    if (placed && !run.counted && race.grid != null && race.grid.length >= 2 && race.grid.some(s => s.id === selfId)) {
      const position = race.results.findIndex(r => r.id === selfId);
      if (position >= 0) {
        run.counted = true;
        window.ApexStats?.race(position + 1);
        if (race.kind !== 'race' && position === 0) { run.won = true; window.ApexStats?.tournament(); }
      }
    }
    if (race.phase === 'quali') {
      if (race.kind === 'tournament') setHud(T.qualiHud, (run.attempts >= QUALI_ATTEMPTS ? T.qualiDone : T.attempt(run.attempts + 1, QUALI_ATTEMPTS))
        + (run.best != null ? '  ·  ' + T.best + '  ' + formatTime(run.best) : ''));
      else setHud(T.qualiHud, run.best != null ? T.best + '  ' + formatTime(run.best) : null);
    } else if (race.phase === 'strategy') {
      const grid = race.grid ? gridPresent() : [];
      setHud(T.strategyHud, T.waitStrategies(grid.filter(id => race.strat.has(id)).length, grid.length));
      if (window.ApexEndurance) window.ApexEndurance.pickerStatus(T.waitStrategies(grid.filter(id => race.strat.has(id)).length, grid.length));
    } else if (race.phase === 'formation') setHud(T.formationHud, run.sentDone ? T.waitGrid : null);
    else if (race.phase === 'race') {
      if (now < race.goAt) { setHud(''); return; }
      const position = race.results.findIndex(r => r.id === selfId);
      if (endurance()) {
        const left = raceMs() - (now - race.goAt);
        if (run.finished) setHud(T.finished(position >= 0 ? position + 1 : '-'), T.lapsDone(run.lap));
        else setHud(left > 0 ? T.lap + '  ' + (run.lap + 1) : T.lastLap,
          (left > 0 ? T.timeLeft(clock(left)) : '') + (run.lastLapTime != null ? (left > 0 ? '  ·  ' : '') + T.last + '  ' + formatTime(run.lastLapTime) : ''));
      } else if (run.finished && position >= 0) setHud(T.finished(position + 1), formatTime(race.results[position].ms));
      else setHud(T.lap + '  ' + T.lapsOf(Math.min(run.lap + 1, race.laps), race.laps),
        run.lastLapTime != null ? T.last + '  ' + formatTime(run.lastLapTime) : null);
    } else if (race.phase === 'results') {
      const position = race.results.findIndex(r => r.id === selfId);
      setHud(run.won ? T.tournamentWon : T.resultsHud, position >= 0 ? T.finished(position + 1) : null);
    }
  }
  const clock = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // id: the player's, by which the row slides to its new place (renderBoard)
  function row(cls, cells, id) {
    const r = el('div', 'row' + cls);
    if (id != null) r.dataset.id = id;
    for (const [c, text] of cells) r.appendChild(el('span', c, text));
    return r;
  }
  const selfCls = id => (id === selfId ? ' self' : '');

  // Live order: finished cars by time, then by laps completed and when, then the grid order.
  // (endurance: everybody by laps then time, finished or not; a car still out may yet complete one more lap)
  function raceOrder() {
    const finished = race.results.map(r => r.id);
    const others = race.grid.map(s => s.id).filter(id => !finished.includes(id));
    const gridIndex = id => race.grid.findIndex(s => s.id === id);
    const byProgress = (a, b) => {
      const pa = race.progress.get(a), pb = race.progress.get(b);
      const la = pa ? pa.lap : 0, lb = pb ? pb.lap : 0;
      if (la !== lb) return lb - la;
      if (la > 0 && pa.ms !== pb.ms) return pa.ms - pb.ms;
      return gridIndex(a) - gridIndex(b);
    };
    if (endurance() && race.phase !== 'results') return race.grid.map(s => s.id).sort(byProgress);
    others.sort(byProgress);
    return [...finished, ...others];
  }

  function renderRaceRows() {
    if (race.phase === 'strategy') {
      race.grid.forEach((s, i) => board.appendChild(row(selfCls(s.id) + (race.strat.has(s.id) ? '' : ' pending'), [
        ['rank', String(i + 1)], ['name', nameOf(s.id)], ['time', race.strat.has(s.id) ? '✓' : ''], ['gap', ''],
      ], s.id)));
      return;
    }
    if (endurance() && race.phase !== 'quali') {
      const order = raceOrder(), lead = race.progress.get(order[0]);
      order.forEach((id, i) => {
        const p = race.progress.get(id), done = race.results.some(r => r.id === id), laps = p ? p.lap : 0;
        const gap = i === 0 || lead == null ? '' : laps < lead.lap ? '-' + (lead.lap - laps) + ' ' + T.lap : p ? formatGap(p.ms - lead.ms) : '';
        board.appendChild(row(selfCls(id) + (done ? '' : ' pending'), [['rank', String(i + 1)], ['name', nameOf(id)], ['time', T.lapsDone(laps)], ['gap', gap]], id));
      });
      return;
    }
    if (race.phase === 'quali') {
      const ranked = [...race.quali].sort((a, b) => a[1] - b[1]);
      const pole = ranked.length ? ranked[0][1] : 0;
      // a tournament: the attempts each driver has left
      const left = id => (race.kind === 'tournament' ? ' ' + '●'.repeat(Math.max(0, QUALI_ATTEMPTS - (race.attempts.get(id) || 0))) : '');
      ranked.forEach(([id, ms], i) => board.appendChild(row(selfCls(id), [
        ['rank', String(i + 1)], ['name', nameOf(id) + left(id)], ['time', formatTime(ms)], ['gap', i === 0 ? '' : formatGap(ms - pole)],
      ], id)));
      if (ranked.length === 0) board.appendChild(el('div', 'empty', '--:--.---'));
      return;
    }
    if (race.phase === 'formation') {
      race.grid.forEach((s, i) => board.appendChild(row(selfCls(s.id) + (race.done.has(s.id) ? '' : ' pending'), [
        ['rank', String(i + 1)], ['name', nameOf(s.id)], ['time', race.done.has(s.id) ? '✓' : ''], ['gap', ''],
      ], s.id)));
      return;
    }
    const winner = race.results[0];
    raceOrder().forEach((id, i) => {
      const result = race.results.find(r => r.id === id);
      const p = race.progress.get(id);
      const time = result ? formatTime(result.ms) : T.lapsOf(Math.min((p ? p.lap : 0) + 1, race.laps), race.laps);
      board.appendChild(row(selfCls(id) + (result ? '' : ' pending'), [
        ['rank', String(i + 1)], ['name', nameOf(id)], ['time', time], ['gap', result && result !== winner ? formatGap(result.ms - winner.ms) : ''],
      ], id));
    });
  }

  // The session board, live as on a TV timing tower: the best times, a player improving theirs gets their time on
  // purple (a personal best) for a few seconds, a flash, and the places gained; the rows slide to their new places
  // (renderBoard), and a banner tells it under the board (announce).
  const BOARD_ROWS = 8;               // and your own row under them when you are further down
  const IMPROVED_MS = 6000;           // the purple time and the places gained stay this long
  const FLASH_MS = 1200;
  const QUIET_MS = 3000;              // after a session starts: the casual mode's personal bests arrive, not news
  let improved = new Map();           // player id -> { time, gain (ms, null for a first time), from (place or null), to }
  let sessionStart = 0;
  const rankedPlayers = list => list.filter(p => recordFrames(p) != null).sort((a, b) => recordFrames(a) - recordFrames(b) || a.id - b.id);

  // the records that came with a new player list: who improved, from which place to which
  function noteImprovements(before, list) {
    if (race != null || performance.now() - sessionStart < QUIET_MS) return;
    const oldRank = rankedPlayers(before).map(p => p.id), newRank = rankedPlayers(list).map(p => p.id);
    const oldFrames = new Map(before.map(p => [p.id, recordFrames(p)]));
    for (const p of list) {
      const frames = recordFrames(p);
      if (frames == null || !oldFrames.has(p.id)) continue;      // no time, or a player who just came in
      const was = oldFrames.get(p.id);
      if (was != null && frames >= was) continue;
      const from = oldRank.indexOf(p.id), info = { time: performance.now(), gain: was == null ? null : was - frames, from: from < 0 ? null : from + 1, to: newRank.indexOf(p.id) + 1 };
      improved.set(p.id, info);
      announce(p, frames, info);
    }
    if (improved.size) setTimeout(renderBoard, IMPROVED_MS + 50);   // the purple goes
  }

  function renderTopFive() {
    const ranked = rankedPlayers(players);
    if (ranked.length === 0) board.appendChild(el('div', 'empty', '--:--.---'));
    const shown = ranked.slice(0, BOARD_ROWS), selfIndex = ranked.findIndex(p => p.isSelf);
    if (selfIndex >= BOARD_ROWS) shown.push(ranked[selfIndex]);
    const leaderFrames = ranked.length ? recordFrames(ranked[0]) : 0, now = performance.now();
    for (const p of shown) {
      const i = ranked.indexOf(p), info = improved.get(p.id), age = info ? now - info.time : Infinity;
      const fresh = age < IMPROVED_MS, up = fresh && info.from != null && info.to < info.from ? info.from - info.to : 0;
      const r = row((p.isSelf ? ' self' : '') + (ghost != null && ghost.playerId === p.id ? ' ghost' : '') + (fresh ? ' pb' : '')
        + (age < FLASH_MS ? ' flash' : '') + (i >= BOARD_ROWS ? ' detached' : ''), [
        ['rank', String(i + 1)], ['name', p.nickname], ['time', formatTime(recordFrames(p))],
        ['gap', i === 0 ? '' : formatGap(recordFrames(p) - leaderFrames)],
      ], p.id);
      if (up) r.querySelector('.name').prepend(el('span', 'up', '▲' + up));
      // the animations go on where they were: the board is drawn again often
      if (fresh) for (const e of [r, r.querySelector('.time')]) e.style.animationDelay = -Math.round(age) + 'ms';
      board.appendChild(r);
    }
  }

  // ---- the banner: who improved, under the board, one after the other
  const BANNER_MS = 4000;
  let banners = [], bannerEl = null, bannerTimer = null;
  function announce(p, frames, info) {
    banners = banners.filter(b => b.id !== p.id);          // only their latest time
    banners.push({ id: p.id, nickname: p.nickname, self: !!p.isSelf, frames, ...info });
    if (bannerTimer == null) nextBanner();
  }
  function nextBanner() {
    bannerTimer = null;
    if (bannerEl != null) { bannerEl.remove(); bannerEl = null; }
    const b = banners.shift();
    if (b == null || ctx == null) return;
    bannerEl = el('div', 'apex-room-banner' + (b.to === 1 ? ' leader' : '') + (b.self ? ' self' : ''));
    const head = el('div', 'head', b.to === 1 ? T.sessionBest : T.personalBest);
    const body = el('div', 'body');
    body.appendChild(el('span', 'pos', 'P' + b.to));
    if (b.from != null && b.to < b.from) body.appendChild(el('span', 'up', '▲' + (b.from - b.to)));
    body.appendChild(el('span', 'name', b.nickname));
    body.appendChild(el('span', 'time', formatTime(b.frames)));
    if (b.gain != null) body.appendChild(el('span', 'gain', '−' + (b.gain / 1000).toFixed(3)));
    bannerEl.append(head, body);
    if (board != null) Object.assign(bannerEl.style, { top: (board.offsetTop + board.offsetHeight + 10) + 'px', width: board.offsetWidth + 'px', boxSizing: 'border-box' });
    document.getElementById('ui').appendChild(bannerEl);
    bannerTimer = setTimeout(nextBanner, BANNER_MS);
  }
  function clearBanners() {
    clearTimeout(bannerTimer);
    bannerTimer = null;
    banners = [];
    if (bannerEl != null) { bannerEl.remove(); bannerEl = null; }
  }

  function button(label, cls, onClick) {
    const b = el('button', 'race-button' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  // Event settings: editable by the host between events, read-only for everybody else
  function renderSettings(editable) {
    const r = room(), kind = kindOf(r);
    const box = el('div', 'race-settings');
    // the format: free race, race tournament, endurance
    const formats = el('div', 'formats');
    for (const k of KINDS) {
      const opt = el(editable ? 'button' : 'div', 'toggle format' + (k === kind ? ' on' : ''), T['kind_' + k]);
      if (editable) opt.addEventListener('click', () => updateRoom({ kind: k }));
      formats.appendChild(opt);
    }
    box.appendChild(formats);
    if (kind !== 'race' && !eligible()) box.appendChild(el('div', 'note', T.notEligible));
    const stepper = (label, value, text, change) => {
      const line = el('div', 'laps');
      line.appendChild(el('span', 'label', label));
      if (editable) {
        line.appendChild(button('−', 'step', () => change(-1)));
        line.appendChild(el('span', 'value', text));
        line.appendChild(button('+', 'step', () => change(1)));
      } else line.appendChild(el('span', 'value', text));
      box.appendChild(line);
    };
    if (kind === 'endurance') {
      stepper(T.minutes, r.minutes, T.minutesValue(r.minutes), d => updateRoom({ minutes: Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, r.minutes + d)) }));
      board.appendChild(box);
      return;
    }
    const loop = course == null || course.loop;
    if (loop) stepper(T.laps, r.laps, String(r.laps), d => updateRoom({ laps: Math.max(1, Math.min(MAX_LAPS, r.laps + d)) }));
    else {
      const laps = el('div', 'laps');
      laps.appendChild(el('span', 'label', T.laps));
      laps.appendChild(el('span', 'value', '1'));
      box.appendChild(laps);
      box.appendChild(el('div', 'note', T.notLoop));
    }
    for (const [key, label] of [['quali', T.qualiOpt], ['formation', T.formationOpt]]) {
      const opt = el(editable ? 'button' : 'div', 'toggle' + (r[key] ? ' on' : ''), label);
      if (editable) opt.addEventListener('click', () => updateRoom({ [key]: !r[key] }));
      box.appendChild(opt);
    }
    if (kind === 'tournament' && !r.quali) box.appendChild(el('div', 'note subtle', T.randomGrid));
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
    // where each player's row was, to slide it from there (the rows are made again)
    const was = new Map([...board.querySelectorAll('.row[data-id]')].map(r => [r.dataset.id, r.getBoundingClientRect().top]));
    board.textContent = '';
    const raceRoom = room().race;
    const titleText = race == null ? T.top
      : race.phase === 'quali' ? T.quali : race.phase === 'formation' ? T.formation : race.phase === 'strategy' ? T.strategy : race.phase === 'results' ? T.results : T.race;
    const title = el('div', 'title', titleText);
    title.appendChild(el('span', null, String(players.length)));
    board.appendChild(title);

    if (race != null) renderRaceRows();
    else renderTopFive();
    for (const r of board.querySelectorAll('.row[data-id]')) {
      const from = was.get(r.dataset.id), dy = from == null ? 0 : from - r.getBoundingClientRect().top;
      if (Math.abs(dy) > 1 && r.animate) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }

    if (raceRoom) renderRaceControls();
    // watching the room (apex-spectate.js)
    const watchers = spectatorsOf(ctx.connection).size;
    if (watchers > 0) board.appendChild(el('div', 'watchers', T.watchers(watchers)));
    board.appendChild(button(watchingSelf() ? T.drive : T.watch, 'watch' + (watchingSelf() ? ' on' : ''), () => setWatching(!watchingSelf())));
  }
  function renderRaceControls() {
    if (window.ApexCollide) board.appendChild(el('div', 'contact', T.contact));
    if (race == null) renderSettings(isHost());
    if (!isHost()) return;
    if (race == null) {
      const start = button(T.start, '', hostStart);
      start.disabled = kindOf(room()) !== 'race' && !eligible();
      board.appendChild(start);
    } else if (race.phase === 'quali') board.appendChild(button(room().formation ? T.toFormation : T.toRace, '', hostNext));
    else if (race.phase === 'formation' || race.phase === 'strategy') board.appendChild(button(T.toRace, '', hostNext));
    const timeUp = race != null && endurance() && race.phase === 'race' && performance.now() - race.goAt >= raceMs();
    if (race != null) board.appendChild(button(race.phase === 'results' || timeUp ? T.done : T.stop, 'stop', hostStop));
  }

  // ---- host screen: options of the "Race" game mode
  function renderHostOptions(container, mode) {
    let box = container.querySelector('.apex-race-options');
    if (mode !== 'race') { if (box != null) box.remove(); return; }
    if (box == null) { box = el('div', 'apex-race-options'); container.appendChild(box); }
    box.textContent = '';
    // the format, then its settings: laps and the two options, or the endurance race's duration
    const formats = el('div', 'formats');
    for (const k of KINDS) {
      const b = el('button', 'button toggle format' + (settings.kind === k ? ' selected' : ''), T['kind_' + k]);
      b.addEventListener('click', () => { settings.kind = k; saveSettings(settings); renderHostOptions(container, mode); });
      formats.appendChild(b);
    }
    box.appendChild(formats);
    if (settings.kind !== 'race') box.appendChild(el('div', 'format-info', T['info_' + settings.kind]));
    const range = (label, min, max, key, text) => {
      const line = el('div', 'laps');
      line.appendChild(el('span', 'label', label));
      const value = el('span', 'value', text(settings[key]));
      const slider = el('input', 'slider');
      Object.assign(slider, { type: 'range', min: String(min), max: String(max), value: String(settings[key]) });
      slider.addEventListener('input', () => { settings[key] = Number(slider.value); value.textContent = text(settings[key]); saveSettings(settings); });
      line.append(slider, value);
      box.appendChild(line);
    };
    if (settings.kind === 'endurance') { range(T.minutes, MIN_MINUTES, MAX_MINUTES, 'minutes', T.minutesValue); return; }
    range(T.laps, 1, MAX_LAPS, 'laps', String);
    for (const [key, label] of [['quali', T.qualiOpt], ['formation', T.formationOpt]]) {
      const opt = el('button', 'button toggle' + (settings[key] ? ' selected' : ''), label);
      opt.addEventListener('click', () => { settings[key] = !settings[key]; opt.classList.toggle('selected', settings[key]); saveSettings(settings); });
      box.appendChild(opt);
    }
  }

  // ================================================================== "Change track": the host screen again
  // In a room, the game's "Change track" opens its track selection and starts the next session as soon as a track is
  // picked, in the same mode. The mod puts the host screen back in between, made of the game's own boxes (so it
  // looks the same): the mode (the game's two and Race, with the race settings), the track (the current one until
  // another is picked on the game's track selection), then Confirm. The room settings go to the players at once,
  // the new session starts 5 s later (the game's countdown) in the mode picked.
  const CASUAL = 0, COMPETITIVE = 1;  // the game's multiplayer modes
  let changing = null;                // the box: { root, connection, mode, track: { trackMetadata, trackData } | null, thumbnail, select, show }
  function closeChange() {
    if (changing == null) return;
    changing.root.remove();
    document.removeEventListener('keydown', onChangeKey, true);
    changing = null;
  }
  function onChangeKey(event) {
    if (event.key !== 'Escape' || changing == null || changing.root.classList.contains('hidden')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeChange();
  }
  // select: the game's own "Change track" (its track selection)
  function changeTrack(select) {
    if (changing != null) { closeChange(); return; }   // the same button closes it
    if (ctx == null || !isHost()) { select(); return; }
    const connection = ctx.connection, info = connection.apexInfo ? connection.apexInfo() : {};
    changing = {
      connection, select, thumbnail: null,
      mode: room().race ? 'race' : info.mode === COMPETITIVE ? COMPETITIVE : CASUAL,
      track: connection.apexSession ? connection.apexSession() : null,   // the track of the room: the mode alone can change
    };
    const root = el('div', 'multiplayer-ui apex-change-track');
    const host = el('div', 'host');
    const box = el('div', 'main-box apex-lobby-host');   // apex-lobby.js: no room list toggle here
    root.appendChild(host);
    host.appendChild(box);
    box.appendChild(el('h2', null, T.changeTrack));

    const modes = el('div', 'game-mode-container');
    box.appendChild(modes);
    modes.appendChild(el('div', 'title', T.gameMode));
    const description = el('div', 'info');
    const describe = () => {
      description.textContent = changing.mode === 'race' ? T.modeInfo : changing.mode === COMPETITIVE ? T.competitiveInfo : T.casualInfo;
      renderHostOptions(modes, changing.mode);
    };
    const buttons = [[CASUAL, T.casual], [COMPETITIVE, T.competitive], ['race', T.mode]].map(([mode, label]) => {
      const b = el('button', 'button' + (mode === changing.mode ? ' selected' : ''), label);
      b.addEventListener('click', () => {
        changing.mode = mode;
        for (const other of buttons) other.classList.toggle('selected', other === b);
        describe();
      });
      modes.appendChild(b);
      return b;
    });
    modes.appendChild(description);
    describe();

    const trackButton = el('button', 'button track-button');
    box.appendChild(trackButton);
    trackButton.addEventListener('click', () => { root.classList.add('hidden'); select(); });

    const bar = el('div', 'buttons');
    box.appendChild(bar);
    const back = el('button', 'button');
    back.innerHTML = '<img class="button-icon" src="images/back.svg"> ';
    back.append(T.back);
    back.addEventListener('click', closeChange);
    const confirm = el('button', 'button', T.confirm);
    confirm.addEventListener('click', applyChange);
    bar.append(back, confirm);

    // the track, with its thumbnail once one was picked (the current track has none at hand)
    changing.show = () => {
      const { track, thumbnail } = changing;
      trackButton.textContent = '';
      let image;
      if (thumbnail instanceof HTMLCanvasElement) {
        image = el('canvas', 'thumbnail');
        image.width = thumbnail.width;
        image.height = thumbnail.height;
        image.getContext('2d')?.drawImage(thumbnail, 0, 0);
      } else {
        image = el('img', 'thumbnail');
        image.crossOrigin = 'anonymous';
        image.src = typeof thumbnail === 'string' ? thumbnail : 'images/empty.svg';
      }
      trackButton.appendChild(image);
      trackButton.appendChild(el('div', 'name' + (track ? '' : ' placeholder'), track ? track.trackMetadata.name : T.selectTrack));
      confirm.disabled = track == null;
    };
    changing.show();
    changing.root = root;
    document.getElementById('ui').appendChild(root);
    document.addEventListener('keydown', onChangeKey, true);
  }
  // a track picked on the game's track selection: back to the box (true), or the game's own way when it is not open
  function trackPicked(trackMetadata, trackData, thumbnail) {
    if (changing == null) return false;
    changing.track = { trackMetadata, trackData };
    changing.thumbnail = thumbnail ?? null;
    changing.root.classList.remove('hidden');
    changing.show();
    return true;
  }
  function trackCancelled() {
    if (changing != null) changing.root.classList.remove('hidden');
  }
  function applyChange() {
    const { connection, mode, track } = changing;
    if (track == null) return;
    closeChange();
    const plan = { connection, mode, track, room: mode === 'race' ? { race: true, ...settings } : { race: false } };
    // with others in the room (running the mod: the others cannot vote), they vote on it first
    if (electorate(connection).length >= 2) startVote(plan); else launch(plan);
  }
  // the next session starts: room settings to the players, then the game's 5 s countdown
  function launch({ connection, mode, track, room: r }) {
    connection.apexRoom = r;
    // the next session, for the results' footer (before the game ends this one: the messages keep their order)
    const next = { t: 'next', track: String(track.trackMetadata.name || ''), mode: mode === 'race' ? (kindOf(r) === 'race' ? 'race' : kindOf(r)) : mode === COMPETITIVE ? 'competitive' : 'casual' };
    connection.apexNext = next;
    for (const message of [roomMessage(r), next]) {
      const bytes = encode(message);
      for (const peer of connection.apexPeers()) if (peer.apexMod) sendToPeer(peer, bytes);
    }
    if (ctx != null && ctx.connection === connection) renderBoard();
    connection.startNewSession(mode === 'race' ? COMPETITIVE : mode, track.trackMetadata, track.trackData);
  }
  // "Next session: track - mode" in place of the game's "A new session will start shortly" (the player list, as a
  // session ends); null: the game's text (the host changed the track without the mod)
  function nextSessionText() {
    const next = lastConnection && lastConnection.apexNext;
    if (next == null || !next.track) return null;
    return `${T.nextSession} : ${next.track} - ${{ casual: T.casual, competitive: T.competitive, race: T.mode, tournament: T.kind_tournament, endurance: T.kind_endurance }[next.mode] || T.casual}`;
  }
  function onNextMessage(connection, msg) {
    if (msg.t !== 'next' || typeof msg.track !== 'string') return false;
    connection.apexNext = { track: msg.track.slice(0, 80), mode: msg.mode };
    // the results may be shown already
    const text = nextSessionText();
    for (const e of document.querySelectorAll('#ui .player-list-ui .session-ended-text')) if (text) e.textContent = text;
    return true;
  }

  // ================================================================== the vote on a new session
  // With two players or more, the session the host picked on "Change track" is put to the vote: every player
  // running the mod sees it (track, mode, race settings) and accepts or declines it; the host's own vote is for.
  // An absolute majority of the voters (more than half, the host counted) wins: then the session starts (the
  // game's 5 s countdown), counted down on the popup. It is declined as soon as that majority cannot be reached
  // any more, or when the time runs out.
  //   host -> players  { t: 'vote', n, track, mode, race: { laps, quali, formation } | null, yes, no, total, left }
  //                    (again on every vote), then { t: 'voted', n, ok, yes, no, total, cancelled }
  //   player -> host   { t: 'ballot', n, yes }
  const VOTE_MS = 20000;              // to vote
  const RESULT_MS = 5000;             // the result stays shown: the countdown to the new session
  let voteCounter = 0;
  let vote = null;                    // the host's: { n, plan, voters: [player id], yes: Set, no: Set, timer }
  let popup = null;                   // the popup shown: { root, state, ballot, tick }
  const selfPlayer = connection => (connection.getPlayers ? connection.getPlayers().find(p => p.isSelf) : null);
  const electorate = connection => {
    const self = selfPlayer(connection);
    return [...(self ? [self.id] : []), ...connection.apexPeers().filter(p => p.apexMod).map(p => p.id)];
  };
  const modeName = mode => ({ casual: T.casual, competitive: T.competitive, race: T.mode }[mode] || T.casual);
  const modeKey = mode => (mode === 'race' ? 'race' : mode === COMPETITIVE ? 'competitive' : 'casual');

  function startVote(plan) {
    if (vote != null) endVote(false, true);
    const { connection } = plan;
    const self = selfPlayer(connection);
    vote = { n: ++voteCounter, plan, voters: electorate(connection), yes: new Set(self ? [self.id] : []), no: new Set(), deadline: performance.now() + VOTE_MS };
    vote.timer = setTimeout(() => endVote(false), VOTE_MS);
    publishVote();
  }
  // the voters still in the room
  const presentVoters = () => {
    const here = new Set(vote.plan.connection.getPlayers().map(p => p.id));
    return vote.voters.filter(id => here.has(id));
  };
  function voteMessage() {
    const voters = presentVoters(), { plan } = vote;
    return {
      t: 'vote', n: vote.n, track: String(plan.track.trackMetadata.name || ''), mode: modeKey(plan.mode),
      race: plan.room.race ? { laps: plan.room.laps, quali: !!plan.room.quali, formation: !!plan.room.formation, kind: plan.room.kind, minutes: plan.room.minutes } : null,
      yes: voters.filter(id => vote.yes.has(id)).length, no: voters.filter(id => vote.no.has(id)).length, total: voters.length,
      left: Math.max(0, Math.round(vote.deadline - performance.now())),
    };
  }
  function toVoters(message) {
    const bytes = encode(message);
    for (const peer of vote.plan.connection.apexPeers()) if (peer.apexMod) sendToPeer(peer, bytes);
  }
  // after every vote, and when a player leaves: decided yet?
  function publishVote() {
    if (vote == null) return;
    const m = voteMessage();
    if (m.yes * 2 > m.total) return endVote(true);
    if (m.no * 2 >= m.total) return endVote(false);   // the majority is out of reach
    toVoters(m);
    showVote({ ...m, host: true });
  }
  function endVote(ok, cancelled = false) {
    if (vote == null) return;
    const m = voteMessage(), { plan } = vote;
    clearTimeout(vote.timer);
    const result = { t: 'voted', n: vote.n, ok, yes: m.yes, no: m.no, total: m.total, cancelled };
    toVoters(result);
    vote = null;
    showResult({ ...m, ...result, host: true });
    if (ok) launch(plan);
  }
  function onBallot(peer, msg) {
    if (vote == null || msg.n !== vote.n || !vote.voters.includes(peer.id)) return;
    vote.yes.delete(peer.id);
    vote.no.delete(peer.id);
    (msg.yes ? vote.yes : vote.no).add(peer.id);
    publishVote();
  }
  // a player: the host's messages
  function onVoteMessage(connection, msg) {
    if (msg.t === 'vote' && Number.isInteger(msg.n) && typeof msg.track === 'string') {
      showVote({ ...msg, track: msg.track.slice(0, 80), connection });
      return true;
    }
    if (msg.t === 'voted' && popup != null && popup.state.n === msg.n) {
      showResult({ ...popup.state, ...msg });
      return true;
    }
    return false;
  }

  // ---- the popup (the game's boxes, as the host screen)
  function closePopup() {
    if (popup == null) return;
    clearInterval(popup.tick);
    clearTimeout(popup.close);
    popup.root.remove();
    popup = null;
  }
  function popupBox(title) {
    const root = el('div', 'multiplayer-ui apex-vote');
    const host = el('div', 'host');
    const box = el('div', 'main-box apex-lobby-host');
    root.appendChild(host);
    host.appendChild(box);
    box.appendChild(el('h2', null, title));
    document.getElementById('ui').appendChild(root);
    return { root, box };
  }
  function voteDetails(box, s) {
    const details = el('div', 'game-mode-container details');
    const line = (label, value) => {
      const row = el('div', 'detail');
      row.append(el('span', 'label', label), el('span', 'value', value));
      details.appendChild(row);
    };
    line(T.voteTrack, s.track);
    line(T.gameMode, modeName(s.mode));
    if (s.race) {
      const kind = KINDS.includes(s.race.kind) ? s.race.kind : 'race';
      line(T.format, T['kind_' + kind]);
      if (kind === 'endurance') line(T.minutes, T.minutesValue(s.race.minutes));
      else {
        line(T.laps, String(s.race.laps));
        line(T.qualiOpt, s.race.quali ? T.yes : T.no);
        line(T.formationOpt, s.race.formation ? T.yes : T.no);
      }
    }
    box.appendChild(details);
  }
  const tallyText = s => T.tally(s.yes, s.no, s.total);
  function showVote(s) {
    if (popup != null && (popup.state.n !== s.n || popup.result)) closePopup();
    if (popup == null) {
      const { root, box } = popupBox(s.host ? T.youPropose : T.hostProposes);
      voteDetails(box, s);
      const status = el('div', 'status');
      const tally = el('span', 'tally'), time = el('span', 'time');
      status.append(tally, time);
      box.appendChild(status);
      const bar = el('div', 'buttons');
      box.appendChild(bar);
      popup = { root, box, tally, time, bar, ballot: null, deadline: 0, state: s };
      if (s.host) {
        const cancel = el('button', 'button', T.cancelVote);
        cancel.addEventListener('click', () => endVote(false, true));
        bar.appendChild(cancel);
      } else {
        const cast = yes => {
          popup.ballot = yes;
          decline.classList.toggle('selected', !yes);
          accept.classList.toggle('selected', yes);
          s.connection.apexSend(encode({ t: 'ballot', n: s.n, yes }));
        };
        const decline = el('button', 'button decline', T.decline), accept = el('button', 'button accept', T.accept);
        decline.addEventListener('click', () => cast(false));
        accept.addEventListener('click', () => cast(true));
        bar.append(decline, accept);
      }
      popup.tick = setInterval(() => { if (popup) popup.time.textContent = Math.max(0, Math.ceil((popup.deadline - performance.now()) / 1000)) + ' s'; }, 250);
      // the host gone: no result will come
      popup.close = setTimeout(closePopup, (s.left ?? VOTE_MS) + 3000);
    }
    popup.state = { ...popup.state, ...s };
    popup.deadline = performance.now() + (s.left ?? VOTE_MS);
    popup.tally.textContent = tallyText(s);
    popup.time.textContent = Math.ceil((s.left ?? VOTE_MS) / 1000) + ' s';
  }
  function showResult(s) {
    if (popup == null || popup.state.n !== s.n) {     // a player who joined during the vote: no popup to update
      closePopup();
      const { root, box } = popupBox(s.host ? T.youPropose : T.hostProposes);
      voteDetails(box, s);
      const status = el('div', 'status');
      const tally = el('span', 'tally'), time = el('span', 'time');
      status.append(tally, time);
      box.appendChild(status);
      popup = { root, box, tally, time, bar: el('div', 'buttons'), state: s };
      box.appendChild(popup.bar);
    }
    clearInterval(popup.tick);
    clearTimeout(popup.close);
    popup.result = true;
    popup.state = { ...popup.state, ...s };
    popup.bar.textContent = '';
    popup.root.classList.add(s.ok ? 'accepted' : 'declined');
    popup.tally.textContent = tallyText(s);
    const verdict = el('div', 'verdict', s.ok ? T.accepted : s.cancelled ? T.cancelled : T.declined);
    popup.bar.appendChild(verdict);
    if (s.ok) {
      const end = performance.now() + RESULT_MS;
      const count = () => { if (popup) popup.time.textContent = T.startsIn(Math.max(0, Math.ceil((end - performance.now()) / 1000))); };
      count();
      popup.tick = setInterval(count, 250);
    } else popup.time.textContent = '';
    popup.close = setTimeout(closePopup, s.ok ? RESULT_MS : 3000);
  }

  // ================================================================== hooks called by the game
  window.ApexRoom = {
    // Debug helpers for the console: a read-only snapshot, your own car, and a way to simulate laps
    debugCar: () => (ctx != null ? ctx.getSelfCar() : null),
    debugLap:() => { if (run != null && !run.finished && race != null && race.phase === 'race') completeLap(performance.now(), false); },
    debug: () => ({
      players: players.length, host: isHost(), hostIsMod: !!(ctx && ctx.connection.apexHostIsMod), room: ctx && ctx.connection.apexRoom,
      modPeers: isHost() ? ctx.connection.apexPeers().filter(p => p.apexMod).map(p => p.id) : null,
      course: course && { checkpoints: course.checkpoints.length, finishes: course.finishes.length, loop: course.loop, tournament: eligible() },
      endurance: window.ApexEndurance ? window.ApexEndurance.debug() : null,
      live: [...live].map(([id, r]) => [id, r.states.length]),
      best: [...best].map(([id, r]) => [id, r.frames, r.states.length]),
      ghost: ghost && { playerId: ghost.playerId, frames: ghost.frames, lastT: ghost.lastT },
      race: race && { ...stateMessage(), goIn: Math.round(race.goAt - performance.now()) },
      run,
    }),

    begin(context) {
      this.end();
      ctx = context;
      sessionStart = performance.now();
      lastConnection = ctx.connection;
      ctx.connection.apexNext = null;           // announced for this session: done
      try { course = buildCourse(ctx.track()); } catch (e) { console.error('Apex: could not read the track', e); course = { checkpoints: [], finishes: [], loop: false }; }
      if (isHost() && ctx.connection.apexRoom == null) {
        ctx.connection.apexRoom = pendingRoom || { race: false };
        pendingRoom = null;
      }
      if (window.ApexLobby) window.ApexLobby.session(true);
      if (watchNext > 0 && performance.now() - watchNext < WATCH_JOIN_MS) ctx.connection.apexWatching = true;
      watchNext = 0;
      if (watchingSelf()) {                     // still watching from the last track, or joined to watch
        if (isHost()) hostSpectators(ctx.connection);
        else sendToHost({ t: 'spec', on: true });
        startWatching();
      }
    },
    onPlayers(list) {
      if (ctx == null) return;
      const previous = new Map(players.map(p => [p.id, recordFrames(p)])), before = players;
      players = list;
      noteImprovements(before, list);
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
      if (isHost()) hostSpectators(ctx.connection);     // a spectator may have left
      refreshGhost();
      if (isHost() && race != null) hostCheckProgress(); // somebody may have left the grid
      if (vote != null) publishVote();                   // a voter may have left
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
      if (watchingSelf()) {                     // the own car stays parked, out of sight and silent
        const self = ctx.getSelfCar();
        if (self != null) {
          self.setVisible(false);
          if (self !== silenced) { self.audioVolume = 0; silenced = self; }
        }
      }
      if (window.ApexLobby && isHost()) {               // what the room list shows of this room (apex-lobby.js)
        const self = players.find(p => p.isSelf);
        window.ApexLobby.hostFrame({
          host: self ? self.nickname : null, countryCode: self ? self.countryCode : null, players: players.length,
          race: !!room().race, kind: kindOf(room()), phase: race ? race.phase : null, laps: room().race && kindOf(room()) !== 'endurance' ? raceLaps() : null,
          info: ctx.connection.apexInfo ? ctx.connection.apexInfo() : null,
        });
      }
    },
    end(owner) {
      // A new session may already have taken over; only its owner can tear it down.
      if (owner !== undefined && ctx != null && ctx.owner !== owner) return;
      if (ctx != null && window.ApexLobby) window.ApexLobby.session(false);
      stopWatching();
      silenced = null;
      closeChange();
      if (vote != null) { clearTimeout(vote.timer); vote = null; }   // the room left during a vote
      if (popup != null && !popup.result) closePopup();
      disposeGhost();
      closeStage();
      if (window.ApexShow) window.ApexShow.clear();
      if (window.ApexCollide) window.ApexCollide.frame(null);
      if (board != null) { board.remove(); board = null; }
      improved = new Map();
      clearBanners();
      if (lights != null) { lights.remove(); lights = null; }
      setHud('');
      ctx = null; players = []; live = new Map(); best = new Map(); selfId = null; selfLastFrames = -1;
      race = null; run = null; course = null; parked = null;
      if (window.ApexEndurance) { window.ApexEndurance.stop(); window.ApexEndurance.closePicker(); }
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
    locked() { return (race != null && (race.phase === 'strategy' || (race.phase === 'race' && performance.now() < race.goAt))) || watching() || watchingSelf(); },
    raceActive() { return race != null; },

    // --- spectators (apex-spectate.js)
    watchNext(on) { watchNext = on ? performance.now() : 0; },   // the room list: watch (true) or drive (false) the room it joins
    watching: () => watchingSelf(),
    isSpectator: id => isSpectator(id),
    // a car of the game's list of other cars (patch_bundle.js): hidden, its driver watches
    hiddenCar(entry) {
      if (ctx == null || spectatorsOf(ctx.connection).size === 0) return false;
      for (const [id, e] of ctx.remotes()) if (e === entry) return isSpectator(id);
      return false;
    },
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
    // the Tournaments tab (apex-tournament.js): the Race mode's settings for the tournament about to be hosted
    prepare(change) { settings = sanitizeSettings({ ...settings, ...change }); saveSettings(settings); },
    buildMismatch: () => T.buildMismatch,
    playerRow,
    changeTrack,
    trackPicked,
    trackCancelled,
    nextSessionText,

    // --- mod messages
    fromPeer(connection, peer, payload) {          // host received a mod message from a player
      // The handshake does not depend on a game being loaded: it can arrive while the track is still loading.
      lastConnection = connection;
      if (payload.length === 0) {
        peer.apexMod = true;
        sendToPeer(peer, encode(accountsMessage(connection)));
        if (connection.apexRoom != null) sendToPeer(peer, encode(roomMessage(connection.apexRoom)));
        if (spectatorsOf(connection).size > 0) sendToPeer(peer, encode({ t: 'specs', ids: [...spectatorsOf(connection)] }));
        if (ctx != null && race != null && connection === ctx.connection) sendToPeer(peer, encode(stateMessage()));
        if (ctx != null) renderBoard();
        return;
      }
      if (!peer.apexMod) return;
      const msg = decode(payload);
      if (msg != null && typeof msg === 'object' && (onAccountMessage(connection, msg, peer) || onSpectatorMessage(connection, msg, peer))) return;
      if (msg != null && msg.t === 'ballot') { onBallot(peer, msg); return; }
      if (ctx == null || connection !== ctx.connection) return;
      onMessage(msg, peer);
    },
    fromHost(connection, payload) {                // player received a mod message from the host
      lastConnection = connection;
      if (payload.length === 0) {
        if (!connection.apexHostIsMod) {
          connection.apexHostIsMod = true;
          connection.apexSend(HELLO);
          connection.apexSend(encode({ t: 'acct', id: accountId(window.ApexAccount?.id) }));
          if (connection.apexWatching) connection.apexSend(encode({ t: 'spec', on: true }));
        }
        return;
      }
      const msg = decode(payload);
      if (msg != null && typeof msg === 'object' && (onAccountMessage(connection, msg, null) || onSpectatorMessage(connection, msg, null) || onNextMessage(connection, msg) || onVoteMessage(connection, msg))) return;
      if (msg != null && msg.t === 'room') { connection.apexRoom = roomMessage(msg); if (ctx != null) renderBoard(); return; }
      if (ctx == null || connection !== ctx.connection) return;
      onMessage(msg, null);
    },
  };
})();
