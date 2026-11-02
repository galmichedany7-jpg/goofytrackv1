// Apex tournaments: the "Tournaments" tab of the track selection, where the community tab was.
//
// Time trial tournaments ("tournoi chrono", server/tournaments.js): a player opens one on a track for 10 minutes to
// 3 days and becomes its host; everybody drives that track whenever they like during that time, and the best time set
// in it wins. Every finished run on the track while it is open is sent to the server, solo or in a room (except the
// laps of a race, which start from the grid). The winner's game counts the win on their profile card (ApexStats) when
// it next sees the result, once per tournament (the ids already counted are synced with the account).
//
// The race and endurance tournaments are rooms: they are hosted from the Multiplayer screen, in the Race mode, with
// the "Tournament" or "Endurance" format (apex-room.js). The tab says so.
//
// patch_bundle.js turns the community tab's button into this one (label, open) and hands over the track selection's
// own way of starting a track (selection), with which "Drive" starts the tournament's track as if picked in the list.
(() => {
  'use strict';

  const SERVER = () => String(window.GOOFY_SERVER || 'https://goofytrack.onrender.com/');
  const DURATIONS = [10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320];   // minutes, the slider's steps
  const REFRESH_OPEN = 15000;          // the list, while the tab is open
  const REFRESH_DRIVING = 60000;       // the tournament of the track driven
  const REFRESH_IDLE = 5 * 60000;      // to learn the results (the wins to count)
  const CREDITED_KEY = 'goofytrack.tournaments.credited';   // ids of the chrono tournaments already counted (synced)

  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  let list = [];                       // the server's tournaments, as last fetched
  let skew = 0;                        // server clock - this PC's clock (ms)
  let fetched = 0, fetching = null, failed = false;   // failed: 'outdated' (a server without the tournaments, 404), 'offline' or false
  let play = null;                     // the track selection's own "start this track" (patch_bundle.js)
  let overlay = null, view = 'list', expanded = new Set(), message = null;
  // the tournament being made: its kind, its track (a time trial: picked in the game's track list) and settings
  let creating = { kind: 'chrono', track: null, minutes: 60, laps: 3, quali: true, formation: true, raceMinutes: 15 };
  let picking = false, pickBar = null;
  const KINDS = ['chrono', 'tournament', 'endurance'];
  const KIND_TEXT = () => ({
    chrono: { name: tr('Tournoi chrono', 'Time trial tournament'), info: tr('une piste, de 10 minutes à 3 jours, le meilleur temps réalisé pendant ce temps gagne. Chaque tour bouclé compte, en solo comme en room.',
      'one track, 10 minutes to 3 days, the best time set in that time wins. Every finished lap counts, solo or in a room.') },
    tournament: { name: tr('Tournoi course', 'Race tournament'), info: tr('une course en plusieurs tours, qualifications en 2 tentatives (sinon grille tirée au sort), tour de formation. Le premier arrivé gagne.',
      'a race over several laps, qualifying in 2 attempts (otherwise a grid drawn at random), formation lap. The first car home wins.') },
    endurance: { name: tr('Tournoi endurance', 'Endurance tournament'), info: tr('15 à 20 minutes, chacun sa stratégie (essence, vitesse, pneus), ravitaillements aux stands. Le plus de tours gagne.',
      '15 to 20 minutes, a strategy each (fuel, speed, tyres), pit stops. The most laps win.') },
  });
  // the circuit of the race and endurance tournaments (apex-room.js, TOURNAMENT_CIRCUITS)
  const ROOM_TRACK = () => {
    const t = officialTracks().find(x => x.trackMetadata.name === 'Forest Speedway');
    return { name: 'Forest Speedway', thumbnail: t?.thumbnail || 'tracks/official/thumbnails/forest.png' };
  };
  let driving = null;                  // { track, id: track id } the track driven, for the badge and the runs sent
  let hud = null, hudKey = '';

  const now = () => Date.now() + skew;
  const formatTime = ms => {
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = Math.round(ms) % 1000;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
  };
  function remaining(ms) {
    if (ms <= 0) return tr('terminé', 'over');
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    if (d > 0) return `${d} ${tr('j', 'd')} ${h} h`;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  }
  const durationText = minutes => (minutes >= 1440 ? `${minutes / 1440} ${tr(minutes > 1440 ? 'jours' : 'jour', minutes > 1440 ? 'days' : 'day')}`
    : minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`);
  const isOpen = t => Date.parse(t.end) > now();

  // ---------------------------------------------------------------- the player
  // the profile picked in the game (apex-account.js) and its ids on the server, as for the records (apex-records.js)
  function me() {
    const p = window.ApexAccount?.profile?.();
    if (p == null || !window.ApexRecords) return null;
    try { return { nickname: p.nickname || '?', countryCode: p.countryCode || '', hash: window.ApexRecords.hash(p.token), secret: window.ApexRecords.secret(p.token) }; } catch (e) { return null; }
  }
  const readCredited = () => { try { const v = JSON.parse(localStorage.getItem(CREDITED_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

  // ---------------------------------------------------------------- server
  async function refresh(force) {
    if (fetching) return fetching;
    if (!force && Date.now() - fetched < 5000) return list;
    const who = me();
    fetching = fetch(SERVER() + 'tournaments' + (who ? '?userTokenHash=' + who.hash : ''), { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(Object.assign(new Error(String(res.status)), { status: res.status }))))
      .then(out => {
        if (Array.isArray(out.tournaments)) list = out.tournaments;
        const server = Date.parse(out.serverTime);
        if (Number.isFinite(server)) skew = server - Date.now();
        fetched = Date.now();
        failed = false;
        credit(who);
      })
      .catch(e => { failed = e.status === 404 ? 'outdated' : 'offline'; })
      .finally(() => { fetching = null; render(); updateHud(); });
    return fetching;
  }
  function post(route, fields) {
    const who = me();
    if (who == null) return Promise.reject(new Error(tr('Aucun profil de joueur', 'No player profile')));
    const body = new URLSearchParams({ userToken: who.secret, userTokenHash: who.hash, nickname: who.nickname, countryCode: who.countryCode, ...fields });
    return fetch(SERVER() + route, { method: 'POST', body }).then(async res => {
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    });
  }
  const merge = t => { const i = list.findIndex(x => x.id === t.id); if (i < 0) list.unshift(t); else list[i] = t; };

  // the wins not counted yet: the finished tournaments this profile won
  function credit(who) {
    if (who == null || !window.ApexStats?.tournament) return;
    const done = readCredited(), won = list.filter(t => t.winner && t.winner.userId === who.hash && !done.includes(t.id));
    if (won.length === 0) return;
    for (const t of won) { window.ApexStats.tournament(); done.push(t.id); }
    try { localStorage.setItem(CREDITED_KEY, JSON.stringify(done.slice(-500))); } catch (e) { /* storage full */ }
    toast(won.length === 1 ? tr(`Vous avez gagné le tournoi chrono sur ${won[0].trackName} !`, `You won the time trial tournament on ${won[0].trackName}!`)
      : tr(`Vous avez gagné ${won.length} tournois chrono !`, `You won ${won.length} time trial tournaments!`));
  }

  // ---------------------------------------------------------------- driving a tournament's track
  const current = () => (driving == null ? null : list.find(t => t.trackId === driving.id && isOpen(t)) || null);
  function track(sceneTrack) {
    driving = null;
    if (sceneTrack != null) try { driving = { track: sceneTrack, id: sceneTrack.getTrackData().getId() }; } catch (e) { console.warn('Apex tournaments: no track id', e); }
    if (driving != null) refresh(false);
    updateHud();
  }
  // a run crossed the finish line on the track driven
  function finished(frames) {
    const t = current();
    if (t == null || !(frames > 0)) return;
    // the laps of a race start from the grid, on the shared clock: not a time on their own (apex-room.js)
    if (window.ApexRoom && window.ApexRoom.raceActive() && !window.ApexRoom.countsAsRecord()) return;
    post('tournaments/time', { id: String(t.id), frames: String(Math.round(frames)) })
      .then(out => { merge(out); updateHud(); render(); })
      .catch(e => console.warn('Apex tournaments: time not sent', e.message));
  }

  function updateHud() {
    const t = current(), ui = document.getElementById('ui');
    const key = t == null ? '' : [t.id, t.self ? t.self.position + ':' + t.self.frames : '-', Math.floor((Date.parse(t.end) - now()) / 1000)].join('|');
    if (key === hudKey) return;
    hudKey = key;
    if (t == null || ui == null) { hud?.remove(); hud = null; return; }
    if (hud == null || !hud.isConnected) { hud = document.createElement('div'); hud.className = 'apex-tournament-hud'; ui.appendChild(hud); }
    hud.textContent = '';
    hud.appendChild(document.createElement('span')).className = 'tag';
    hud.lastChild.textContent = tr('TOURNOI CHRONO', 'TIME TRIAL TOURNAMENT');
    const info = hud.appendChild(document.createElement('span'));
    info.className = 'info';
    info.textContent = remaining(Date.parse(t.end) - now()) + '  ·  ' + (t.self ? `P${t.self.position} / ${t.total}  ·  ${formatTime(t.self.frames)}` : tr('pas encore de temps', 'no time yet'));
  }

  // ---------------------------------------------------------------- the tab
  const el = (parent, tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  function button(parent, label, cls, onClick) {
    const b = el(parent, 'button', 'button' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', event => { event.stopPropagation(); onClick(b); });
    return b;
  }
  const officialTracks = () => (Array.isArray(window.ApexOfficialTracks) ? window.ApexOfficialTracks.filter(t => t && t.id && t.trackMetadata) : []);
  const trackOf = id => officialTracks().find(t => t.id === id) || null;

  function open() {
    if (overlay != null) return;
    view = 'list';
    message = null;
    overlay = el(document.getElementById('ui'), 'div', 'apex-tournament');
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    render();
    refresh(true);
  }
  function close() {
    if (picking) { picking = false; pickBar?.remove(); pickBar = null; }
    if (overlay == null) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.key !== 'Escape' || overlay == null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (picking) stopPicking();
    else if (view !== 'list') { view = 'list'; render(); } else close();
  }

  function render() {
    if (overlay == null) return;
    const scroll = overlay.querySelector('.list')?.scrollTop || 0;
    overlay.textContent = '';
    const panel = el(overlay, 'div', 'panel');
    const header = el(panel, 'div', 'header');
    el(header, 'h2', null, view === 'create' ? tr('Nouveau tournoi', 'New tournament') : tr('Tournois', 'Tournaments'));
    const close_ = el(header, 'button', 'close', '✕');
    close_.addEventListener('click', close);
    const body = el(panel, 'div', 'list');
    if (view === 'create') renderCreate(body); else renderList(body);
    body.scrollTop = scroll;
  }

  function renderList(body) {
    const intro = el(body, 'div', 'intro');
    for (const kind of KINDS) {
      const p = el(intro, 'p');
      el(p, 'strong', null, KIND_TEXT()[kind].name + ' : ');
      p.append(KIND_TEXT()[kind].info);
    }
    el(intro, 'p', 'rooms', tr('Les tournois course et endurance se jouent dans une room : « Créer un tournoi » prépare l\'écran Héberger.',
      'Race and endurance tournaments are played in a room: "Create a tournament" sets up the Host screen.'));
    const bar = el(body, 'div', 'actions');
    button(bar, tr('Créer un tournoi', 'Create a tournament'), 'primary', () => { view = 'create'; message = null; render(); });
    if (message) el(body, 'div', 'message', message);

    el(body, 'h3', null, tr('Tournois chrono', 'Time trial tournaments'));
    if (failed === 'outdated') {
      el(body, 'div', 'message', tr('Le serveur GoofyTrack n\'a pas encore la mise à jour des tournois chrono : il doit être redéployé (Render). Les tournois course et endurance marchent déjà.',
        'The GoofyTrack server does not have the time trial tournaments yet: it must be redeployed (Render). Race and endurance tournaments already work.'));
      return;
    }
    if (failed && list.length === 0) { el(body, 'div', 'empty', tr('Serveur GoofyTrack injoignable. Il se réveille peut-être (jusqu\'à une minute).', 'GoofyTrack server unreachable. It may be waking up (up to a minute).')); return; }
    const running = list.filter(isOpen), done = list.filter(t => !isOpen(t));
    el(body, 'h3', null, tr('En cours', 'Open'));
    if (running.length === 0) el(body, 'div', 'empty', fetched ? tr('Aucun tournoi en cours. Créez le premier !', 'No tournament open. Create the first one!') : tr('Chargement…', 'Loading…'));
    for (const t of running) renderTournament(body, t);
    if (done.length) {
      el(body, 'h3', null, tr('Terminés', 'Finished'));
      for (const t of done) renderTournament(body, t);
    }
  }

  function renderTournament(body, t) {
    const live = isOpen(t), card = el(body, 'div', 'card' + (live ? ' live' : ' done'));
    const known = trackOf(t.trackId);
    const thumb = el(card, 'img', 'thumb');
    thumb.src = known?.thumbnail || 'images/empty.svg';
    const main = el(card, 'div', 'main');
    el(main, 'div', 'name', t.trackName);
    el(main, 'div', 'meta', `${tr('Hôte', 'Host')} : ${t.host.nickname}  ·  ${t.total} ${tr(t.total > 1 ? 'pilotes' : 'pilote', t.total === 1 ? 'driver' : 'drivers')}`);
    const time = el(main, 'div', 'time' + (live ? '' : ' over'), live ? tr('Fin dans ', 'Ends in ') + remaining(Date.parse(t.end) - now()) : tr('Terminé le ', 'Ended ') + new Date(t.end).toLocaleString());
    time.dataset.end = t.end;
    if (!live) {
      el(main, 'div', 'winner', t.winner ? `🏆 ${t.winner.nickname}  ·  ${formatTime(t.winner.frames)}` : tr('Aucun temps', 'No time set'));
    } else if (t.entries.length) {
      el(main, 'div', 'leader', `P1  ${t.entries[0].nickname}  ·  ${formatTime(t.entries[0].frames)}`);
    }
    if (t.self) el(main, 'div', 'self', `${tr('Vous', 'You')} : P${t.self.position}  ·  ${formatTime(t.self.frames)}`);

    const side = el(card, 'div', 'side');
    if (live) {
      const go = button(side, tr('Jouer', 'Drive'), 'primary', () => drive(t));
      if (play == null || known == null) { go.disabled = true; go.title = known == null ? tr('Piste inconnue de ce jeu', 'Track not in this game') : tr('Ouvrez cet onglet depuis la sélection des pistes', 'Open this tab from the track selection'); }
    }
    button(side, expanded.has(t.id) ? tr('Masquer', 'Hide') : tr('Classement', 'Standings'), '', () => { expanded.has(t.id) ? expanded.delete(t.id) : expanded.add(t.id); render(); });
    if (live && t.host.self) button(side, tr('Terminer', 'End now'), 'stop', b => {
      b.disabled = true;
      post('tournaments/stop', { id: String(t.id) }).then(out => { merge(out); credit(me()); render(); }).catch(e => { message = e.message; render(); });
    });

    if (expanded.has(t.id)) {
      const board = el(card, 'div', 'board');
      if (t.entries.length === 0) el(board, 'div', 'empty', '--:--.---');
      const leader = t.entries[0]?.frames ?? 0;
      t.entries.forEach((e, i) => {
        const row = el(board, 'div', 'row' + (t.self && t.self.position === i + 1 ? ' self' : ''));
        el(row, 'span', 'rank', String(i + 1));
        el(row, 'span', 'pname', e.nickname);
        el(row, 'span', 'ptime', formatTime(e.frames));
        el(row, 'span', 'gap', i === 0 ? '' : '+' + ((e.frames - leader) / 1000).toFixed(3));
      });
      if (t.total > t.entries.length) el(board, 'div', 'more', `+ ${t.total - t.entries.length}`);
    }
  }

  function drive(t) {
    const known = trackOf(t.trackId);
    if (play == null || known == null) return;
    close();
    try { play(known); } catch (e) { console.error('Apex tournaments: could not start the track', e); }
  }

  // ---------------------------------------------------------------- making a tournament
  // A time trial is made here, on the server; a race or endurance tournament is a room: its settings go to the Race
  // mode (apex-room.js) and the game is taken to its host screen, Forest Speedway picked, for the player to host it.
  function renderCreate(body) {
    const form = el(body, 'div', 'create');
    el(form, 'label', null, tr('Type de tournoi', 'Tournament type'));
    const kinds = el(form, 'div', 'kinds');
    for (const kind of KINDS) {
      const card = el(kinds, 'button', 'kind' + (creating.kind === kind ? ' selected' : ''));
      el(card, 'div', 'name', KIND_TEXT()[kind].name);
      el(card, 'div', 'info', KIND_TEXT()[kind].info);
      card.addEventListener('click', event => { event.stopPropagation(); creating.kind = kind; message = null; render(); });
    }

    el(form, 'label', null, tr('Piste', 'Track'));
    const chrono = creating.kind === 'chrono';
    const track = chrono ? creating.track : ROOM_TRACK();
    const pick = el(form, 'button', 'button track-pick' + (chrono ? '' : ' fixed'));
    const thumb = el(pick, 'img', 'thumb');
    thumb.src = track?.thumbnail || 'images/empty.svg';
    el(pick, 'div', 'name' + (track ? '' : ' placeholder'), track ? track.name : tr('Choisir la piste', 'Pick the track'));
    if (chrono) {
      el(pick, 'div', 'change', track ? tr('Changer', 'Change') : '');
      pick.addEventListener('click', event => { event.stopPropagation(); startPicking(); });
    } else el(form, 'p', 'hint', tr('Seul circuit avec une vraie grille de départ et des stands pour l\'instant.', 'The only circuit with a proper grid and pits for now.'));

    if (chrono) {
      el(form, 'label', null, tr('Durée', 'Duration'));
      slider(form, 0, DURATIONS.length - 1, Math.max(0, DURATIONS.indexOf(creating.minutes)), i => { creating.minutes = DURATIONS[i]; return durationText(creating.minutes); });
      el(form, 'p', 'hint', tr('Vous devenez l\'hôte du tournoi : vous pouvez le terminer plus tôt. Chaque tour bouclé sur la piste pendant la durée compte, le meilleur temps gagne.',
        'You become the tournament\'s host: you can end it early. Every lap finished on the track in that time counts, the best time wins.'));
    } else if (creating.kind === 'tournament') {
      el(form, 'label', null, tr('Tours', 'Laps'));
      slider(form, 1, 20, creating.laps, v => { creating.laps = v; return String(v); });
      const options = el(form, 'div', 'options');
      for (const [key, label] of [['quali', tr('Qualifications (2 tentatives)', 'Qualifying (2 attempts)')], ['formation', tr('Tour de formation', 'Formation lap')]]) {
        const b = el(options, 'button', 'button toggle' + (creating[key] ? ' selected' : ''), label);
        b.addEventListener('click', event => { event.stopPropagation(); creating[key] = !creating[key]; b.classList.toggle('selected', creating[key]); });
      }
      el(form, 'p', 'hint', tr('Sans qualifications, la grille est tirée au sort. Le premier arrivé gagne le tournoi.', 'Without qualifying, the grid is drawn at random. The first car home wins the tournament.'));
    } else {
      el(form, 'label', null, tr('Durée de la course', 'Race duration'));
      slider(form, 15, 20, creating.raceMinutes, v => { creating.raceMinutes = v; return v + ' min'; });
      el(form, 'p', 'hint', tr('Chaque pilote choisit sa stratégie avant le départ. Le plus de tours à la fin du temps gagne.', 'Every driver picks a strategy before the start. The most laps when the time is up wins.'));
    }

    if (message) el(form, 'div', 'message', message);
    const bar = el(form, 'div', 'actions');
    button(bar, tr('Retour', 'Back'), '', () => { view = 'list'; message = null; render(); });
    if (chrono) {
      const go = button(bar, tr('Lancer le tournoi', 'Start the tournament'), 'primary', b => {
        b.disabled = true;
        const t = creating.track;
        post('tournaments/create', { trackId: t.id, trackName: t.name, minutes: String(creating.minutes) })
          .then(out => { merge(out); expanded.add(out.id); view = 'list'; message = null; creating.track = null; render(); })
          .catch(e => { message = tr('Impossible de créer le tournoi : ', 'Could not create the tournament: ') + e.message; render(); });
      });
      go.disabled = creating.track == null || failed === 'outdated';
    } else {
      const go = button(bar, tr('Préparer la room', 'Set up the room'), 'primary', b => { b.disabled = true; hostRoom(); });
      go.disabled = !window.ApexRoom?.prepare;
    }
  }
  function slider(parent, min, max, value, show) {
    const row = el(parent, 'div', 'duration');
    const input = el(row, 'input', 'slider');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: '1', value: String(value) });
    const text = el(row, 'span', 'value', show(value));
    input.addEventListener('input', () => { text.textContent = show(Number(input.value)); });
    input.addEventListener('click', event => event.stopPropagation());
  }

  // ---- the time trial's track: the overlay steps aside, the next track clicked in the game's list is the one
  // (the track selection hands its clicks to wrapPick first, patch_bundle.js)
  function startPicking() {
    picking = true;
    if (overlay) overlay.classList.add('hidden');
    pickBar?.remove();
    pickBar = el(document.getElementById('ui'), 'div', 'apex-tournament-pickbar');
    el(pickBar, 'span', null, tr('Cliquez sur la piste du tournoi chrono', 'Click the time trial tournament\'s track'));
    const cancel = el(pickBar, 'button', 'button', tr('Annuler', 'Cancel'));
    cancel.addEventListener('click', event => { event.stopPropagation(); stopPicking(); });
  }
  function stopPicking() {
    picking = false;
    pickBar?.remove();
    pickBar = null;
    if (overlay) { overlay.classList.remove('hidden'); render(); }
  }
  // the track selection's "a track was clicked" (trackMetadata, environment, load, kind, id, thumbnail)
  function wrapPick(chosen) {
    return function (...args) {
      if (!picking) return chosen.apply(this, args);
      const [metadata, , , kind, id] = args, known = typeof id === 'string' ? trackOf(id) : null;
      if (known == null || kind === 'custom') message = tr('Choisissez une piste officielle ou un circuit du mod : les autres joueurs n\'ont pas vos pistes perso.', 'Pick an official track or a mod circuit: the other players do not have your custom tracks.');
      else { creating.track = { id: known.id, name: metadata?.name || known.trackMetadata.name, thumbnail: known.thumbnail }; message = null; }
      stopPicking();
      return undefined;
    };
  }

  // ---- a race or endurance tournament: the Race mode's settings, then the host screen with everything picked
  async function hostRoom() {
    window.ApexRoom.prepare(creating.kind === 'endurance'
      ? { kind: 'endurance', minutes: creating.raceMinutes }
      : { kind: 'tournament', laps: creating.laps, quali: creating.quali, formation: creating.formation });
    close();
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const shown = e => e != null && e.offsetParent !== null;
    const until = async find => { for (let i = 0; i < 60; i++) { const e = find(); if (shown(e)) return e; await wait(100); } return null; };
    const buttons = scope => [...document.querySelectorAll('#ui ' + scope + ' button')].filter(shown);
    const fail = () => toast(tr('Ouvrez Multijoueur > Héberger, mode Course, format tournoi : les réglages sont prêts.', 'Open Multiplayer > Host, Race mode, tournament format: the settings are ready.'));
    // out of the track selection, to the home screen, Multiplayer, Host
    const back = await until(() => buttons('.track-selection-ui').find(b => b.querySelector('img[src*="back"]') || /^(back|retour)$/i.test(b.innerText.trim())));
    if (back == null) return fail();
    back.click();
    const multiplayer = await until(() => document.querySelectorAll('#ui .menu-ui > .main-buttons-container > .button-image')[3]);   // Garage, Editor, Settings, Multiplayer, Play
    if (multiplayer == null) return fail();
    multiplayer.click();
    const host = await until(() => buttons('.multiplayer-ui').find(b => /^(host|héberger)$/i.test(b.innerText.trim())) || buttons('.multiplayer-ui')[1]);
    if (host == null) return fail();
    host.click();
    // the Race mode (its format is the one just prepared), then the track: Forest Speedway in the game's list
    const race = await until(() => buttons('.multiplayer-ui').find(b => b.innerText.trim() === window.ApexRoom.modeLabel()));
    if (race == null) return fail();
    race.click();
    const select = await until(() => document.querySelector('#ui .multiplayer-ui .track-button'));
    if (select == null) return fail();
    select.click();
    const row = await until(() => [...document.querySelectorAll('#ui .track-selection-ui .track')].find(e => shown(e) && e.innerText.trim().startsWith(ROOM_TRACK().name)));
    if (row == null) return fail();
    (row.querySelector('button') || row).click();
    await wait(300);
    toast(tr('Room prête : vérifiez les réglages et cliquez sur Héberger.', 'Room ready: check the settings and click Host.'));
  }

  // the countdowns, every second
  setInterval(() => {
    if (overlay != null) for (const e of overlay.querySelectorAll('.time[data-end]')) {
      const left = Date.parse(e.dataset.end) - now();
      if (left > 0) e.textContent = tr('Fin dans ', 'Ends in ') + remaining(left);
      else if (!e.classList.contains('over')) { e.classList.add('over'); refresh(true); }
    }
    if (driving != null) updateHud();
  }, 1000);
  // the list now and then: while the tab is open, on a tournament's track, and seldom otherwise (the wins to count)
  setInterval(() => {
    const age = Date.now() - fetched;
    if ((overlay != null && age > REFRESH_OPEN) || (current() != null && age > REFRESH_DRIVING) || age > REFRESH_IDLE) refresh(true);
  }, 5000);

  function toast(text) {
    const ui = document.getElementById('ui');
    if (ui == null) return;
    const t = el(ui, 'div', 'apex-tournament-toast', text);
    setTimeout(() => t.remove(), 7000);
  }

  const STYLE = `
#ui .apex-tournament {
  position: absolute; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  background-color: rgba(0, 0, 0, 0.45); pointer-events: auto;
}
#ui .apex-tournament > .panel {
  display: flex; flex-direction: column; width: min(860px, calc(100% - 32px)); max-height: calc(100% - 64px);
  border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--apx-blur, blur(22px)); color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif); text-align: left;
}
#ui .apex-tournament .header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 14px 26px; border-bottom: 1px solid var(--apx-line, rgba(255,255,255,.09)); }
#ui .apex-tournament h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
#ui .apex-tournament h3 { margin: 18px 6px 8px; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .close { width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%; cursor: pointer; font-size: 16px; color: inherit; background-color: var(--apx-fill, rgba(255,255,255,.055)); }
#ui .apex-tournament .list { overflow-y: auto; padding: 12px 18px 20px; }
#ui .apex-tournament .intro p { margin: 4px 6px; font-size: 14px; line-height: 1.45; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .intro p.rooms { font-size: 13px; color: var(--apx-fg-subtle, rgba(243,245,248,.36)); }
#ui .apex-tournament .actions { display: flex; gap: 10px; justify-content: flex-end; margin: 12px 6px 4px; }
#ui .apex-tournament .button { margin: 0; padding: 8px 16px; font-size: 15px; cursor: pointer; pointer-events: auto; }
#ui .apex-tournament .button.primary { background-color: var(--apx-accent, #f20d16); color: var(--apx-accent-ink, #fff); }
#ui .apex-tournament .button.stop { color: var(--apx-bad, #ff5a6e); }
#ui .apex-tournament .button:disabled { opacity: 0.4; cursor: default; }
#ui .apex-tournament .empty, #ui .apex-tournament .message { margin: 8px 6px; font-size: 14px; color: var(--apx-fg-subtle, rgba(243,245,248,.36)); }
#ui .apex-tournament .message { color: var(--apx-warn, #ffd24a); }
#ui .apex-tournament .card {
  display: grid; grid-template-columns: 112px 1fr auto; gap: 6px 16px; align-items: center; margin: 8px 0; padding: 12px;
  border-radius: var(--apx-r-md, 12px); background-color: var(--apx-fill, rgba(255,255,255,.055)); box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09));
}
#ui .apex-tournament .card.live { box-shadow: inset 3px 0 0 var(--apx-accent, #f20d16), inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); }
#ui .apex-tournament .card .thumb { width: 112px; height: 63px; object-fit: cover; border-radius: var(--apx-r-sm, 8px); background: #000; image-rendering: pixelated; }
#ui .apex-tournament .card .name { font-size: 18px; font-weight: 700; }
#ui .apex-tournament .card .meta, #ui .apex-tournament .card .leader, #ui .apex-tournament .card .self, #ui .apex-tournament .card .winner { font-size: 13px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); font-variant-numeric: tabular-nums; }
#ui .apex-tournament .card .time { font-size: 13px; font-weight: 600; color: var(--apx-accent, #f20d16); font-variant-numeric: tabular-nums; }
#ui .apex-tournament .card .time.over { color: var(--apx-fg-subtle, rgba(243,245,248,.36)); }
#ui .apex-tournament .card .winner { color: var(--apx-warn, #ffd24a); font-weight: 600; }
#ui .apex-tournament .card .self { color: var(--apx-fg, #f3f5f8); }
#ui .apex-tournament .card .side { display: flex; flex-direction: column; gap: 6px; }
#ui .apex-tournament .card .board { grid-column: 1 / -1; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--apx-line, rgba(255,255,255,.09)); }
#ui .apex-tournament .board .row { display: grid; grid-template-columns: 34px 1fr 96px 70px; padding: 3px 6px; font-size: 14px; font-variant-numeric: tabular-nums; border-radius: 6px; }
#ui .apex-tournament .board .row.self { background-color: var(--apx-accent-soft, rgba(242,13,22,.13)); }
#ui .apex-tournament .board .rank { color: var(--apx-fg-subtle, rgba(243,245,248,.36)); }
#ui .apex-tournament .board .gap, #ui .apex-tournament .board .more { text-align: right; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .create { display: flex; flex-direction: column; gap: 8px; padding: 6px; }
#ui .apex-tournament .create label { margin-top: 8px; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .create select { padding: 8px 10px; font-size: 15px; font-family: inherit; color: var(--apx-fg, #f3f5f8); background-color: var(--apx-ink-800, #171b24); border: 1px solid var(--apx-line-strong, rgba(255,255,255,.18)); border-radius: var(--apx-r-sm, 8px); pointer-events: auto; }
#ui .apex-tournament .create .duration { display: flex; align-items: center; gap: 14px; }
#ui .apex-tournament .create .slider { flex: 1; accent-color: var(--apx-accent, #f20d16); pointer-events: auto; cursor: pointer; }
#ui .apex-tournament .create .value { min-width: 80px; text-align: right; font-size: 20px; font-weight: 700; color: var(--apx-accent, #f20d16); }
#ui .apex-tournament .create .hint { margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: var(--apx-fg-subtle, rgba(243,245,248,.36)); }
#ui .apex-tournament.hidden { display: none; }
#ui .apex-tournament .intro strong { color: var(--apx-fg, #f3f5f8); font-weight: 600; }
#ui .apex-tournament .create .kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
#ui .apex-tournament .create .kind {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: none; border-radius: var(--apx-r-md, 12px); text-align: left; cursor: pointer;
  font-family: inherit; color: inherit; background-color: var(--apx-fill, rgba(255,255,255,.055)); box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); pointer-events: auto;
}
#ui .apex-tournament .create .kind:hover { background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); }
#ui .apex-tournament .create .kind.selected { background-color: var(--apx-accent-soft, rgba(242,13,22,.13)); box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16); }
#ui .apex-tournament .create .kind .name { font-size: 16px; font-weight: 700; }
#ui .apex-tournament .create .kind .info { font-size: 12px; line-height: 1.4; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .create .track-pick { display: flex; align-items: center; gap: 14px; padding: 8px; text-align: left; }
#ui .apex-tournament .create .track-pick .thumb { width: 112px; height: 63px; object-fit: cover; border-radius: var(--apx-r-sm, 8px); background: #000; image-rendering: pixelated; }
#ui .apex-tournament .create .track-pick .name { flex: 1; font-size: 18px; font-weight: 700; }
#ui .apex-tournament .create .track-pick .name.placeholder { color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-tournament .create .track-pick .change { font-size: 13px; color: var(--apx-accent, #f20d16); }
#ui .apex-tournament .create .track-pick.fixed { cursor: default; }
#ui .apex-tournament .create .options { display: flex; gap: 10px; }
#ui .apex-tournament .create .options .toggle { flex: 1; }
#ui .apex-tournament .create .options .toggle.selected { background-color: var(--apx-accent-soft, rgba(242,13,22,.13)); box-shadow: inset 0 0 0 1px var(--apx-accent-ring, rgba(242,13,22,.55)); }
#ui .apex-tournament-pickbar {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 110; display: flex; align-items: center; gap: 16px; padding: 10px 12px 10px 20px;
  border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-glass-strong, rgba(12,14,19,.9)); box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16), var(--apx-shadow, none);
  font-family: var(--apx-font, sans-serif); font-size: 16px; font-weight: 600; color: var(--apx-fg, #f3f5f8); pointer-events: auto;
}
#ui .apex-tournament-pickbar .button { margin: 0; padding: 6px 14px; pointer-events: auto; }
#ui .apex-tournament-hud {
  position: absolute; left: 50%; top: 64px; transform: translateX(-50%); display: flex; gap: 12px; align-items: center; padding: 7px 16px;
  border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-glass, rgba(12,14,19,.72)); backdrop-filter: var(--apx-blur, blur(22px));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); font-family: var(--apx-font, sans-serif); pointer-events: none; white-space: nowrap;
}
#ui .apex-tournament-hud .tag { font-size: 13px; font-weight: 700; letter-spacing: 0.16em; color: var(--apx-accent, #f20d16); }
#ui .apex-tournament-hud .info { font-size: 14px; color: var(--apx-fg, #f3f5f8); font-variant-numeric: tabular-nums; }
#ui .apex-race-hud ~ .apex-tournament-hud { top: 100px; }
#ui .apex-tournament-toast {
  position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 120; padding: 12px 22px; border-radius: var(--apx-r-md, 12px);
  background-color: var(--apx-glass-strong, rgba(12,14,19,.9)); box-shadow: inset 0 0 0 1px var(--apx-warn, #ffd24a), var(--apx-shadow, none);
  color: var(--apx-warn, #ffd24a); font-family: var(--apx-font, sans-serif); font-size: 16px; font-weight: 600; pointer-events: none;
}
`;
  window.addEventListener('DOMContentLoaded', () => { document.head.appendChild(document.createElement('style')).textContent = STYLE; });
  setTimeout(() => refresh(true), 10000);   // the wins to count, once the game and the profile are up

  window.ApexTournament = {
    label: () => tr('Tournois', 'Tournaments'),
    open,
    refresh: () => refresh(true),
    // the track selection's way of starting one of its tracks (patch_bundle.js)
    selection(start) { play = start; },
    wrapPick,
    // apex-hud.js: the track driven (null when it ends), a run that crossed the finish line
    track,
    finished,
    debug: () => ({ list, skew, fetched, failed, driving: driving && driving.id, current: current(), play: play != null }),
  };
})();
