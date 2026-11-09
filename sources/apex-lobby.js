// Apex lobby: rooms without invite codes
//
//   1. Room list   the Multiplayer screen lists the rooms open on the GoofyTrack server (same build only):
//                  host, track, mode, players. One click joins. The invite code still works, under the list.
//   2. Room info   the game hosting a room tells the server, every few seconds, what the list shows of it.
//                  The host screen has a switch to keep a room out of the list (friends can still join it).
//   3. Presence    the room the player is in, hosted or joined, goes with the account's presence
//                  (apex-account.js): friends can follow them into it from the Friends tab.
//
// The sockets come from the game's own multiplayer code (hooks in patch_bundle.js); ApexRoom (apex-room.js)
// says when a room session starts and ends, and hands the host's room details.
(() => {
  'use strict';

  const ROOMS_URL = window.GOOFY_ROOMS;          // <server>/rooms?mod=<build>, written in front of this script by build.js
  const REFRESH_MS = 4000;                       // the list, while it is shown
  const INFO_MS = 3000;                          // the host's room details
  const LISTED_KEY = 'goofytrack.listedRoom';

  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  let host = null;         // { socket, code } while hosting
  let joinedCode = null;   // the code typed or clicked to join a room
  let inSession = false;   // a multiplayer game is running (ApexRoom.begin .. end)
  let lastInfo = 0, lastRoom = null;

  const normalize = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const listed = () => { try { return localStorage.getItem(LISTED_KEY) !== 'false'; } catch (e) { return true; } };
  const currentRoom = () => (inSession ? (host && host.code) || joinedCode : null);

  // friends see the room at once, not at the next presence (30 s)
  function roomChanged() {
    const room = currentRoom();
    if (room === lastRoom) return;
    lastRoom = room;
    if (window.ApexAccount && window.ApexAccount.presence) window.ApexAccount.presence();
  }

  // ================================================================== sockets
  function hostSocket(socket) {
    const mine = { socket, code: null };
    host = mine;
    lastInfo = 0;
    socket.addEventListener('message', event => {
      try {
        const m = JSON.parse(event.data);
        if (m && m.type === 'createInvite' && typeof m.inviteCode === 'string') { mine.code = m.inviteCode; roomChanged(); }
      } catch (e) { /* the game reports bad messages itself */ }
    });
    socket.addEventListener('close', () => { if (host === mine) { host = null; roomChanged(); } });
    return socket;
  }
  function joinSocket(socket) {
    const send = socket.send.bind(socket);
    let first = true;
    socket.send = data => {
      if (first) {
        first = false;
        try { const m = JSON.parse(data); if (m && typeof m.inviteCode === 'string') joinedCode = normalize(m.inviteCode); } catch (e) { /* not ours */ }
      }
      return send(data);
    };
    return socket;
  }

  // ================================================================== host: what the list shows
  // details: { host, countryCode, players, race, kind, special, phase, laps, info: { mode, track, maxPlayers } }
  // (special: a special tournament, the server keeps the flag for a creator's room only)
  // (kind: the race room's format, apex-room.js: 'race', or a tournament: 'tournament', 'endurance')
  function hostFrame(details) {
    if (host == null || host.code == null || host.socket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - lastInfo < INFO_MS) return;
    lastInfo = now;
    const info = details.info || {};
    try {
      host.socket.send(JSON.stringify({ version: '0.6.3', type: 'roomInfo', info: {
        host: details.host, countryCode: details.countryCode, track: info.track || '', players: details.players,
        maxPlayers: info.maxPlayers ?? null, mode: details.race ? (details.kind === 'tournament' || details.kind === 'endurance' ? details.kind : 'race') : info.mode === 1 ? 'competitive' : 'casual',
        phase: details.phase, laps: details.laps, listed: listed(), special: details.special === true,
      } }));
    } catch (e) { /* the socket is closing */ }
  }

  // ================================================================== screens
  const el = (parent, tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  const MODE_TEXT = { casual: () => tr('Décontracté', 'Casual'), competitive: () => tr('Compétitif', 'Competitive'), race: () => 'Sprint',
    tournament: () => 'Grand Prix', endurance: () => 'Endurance' };
  const RACING = new Set(['race', 'tournament', 'endurance']);
  const PHASE_TEXT = {
    quali: () => tr('Qualifications', 'Qualifying'), formation: () => tr('Tour de formation', 'Formation lap'),
    race: () => tr('En course', 'Racing'), results: () => tr('Résultats', 'Results'), strategy: () => tr('Réglages', 'Setups'),
    null: () => tr('Essais libres', 'Practice'),
  };
  const since = time => {
    const m = Math.max(0, Math.round((Date.now() - time) / 60000));
    return m < 1 ? tr('à l\'instant', 'just now') : m < 60 ? tr(`depuis ${m} min`, `${m} min`) : tr(`depuis ${Math.floor(m / 60)} h`, `${Math.floor(m / 60)} h`);
  };

  let list = null, timer = null, loading = false;

  // joins as the player would: the code in the game's field, then its Join button
  function join(code) {
    const input = document.querySelector('#ui .multiplayer-ui .join input.invite-code'), button = document.querySelector('#ui .multiplayer-ui .join button.join');
    if (input == null || button == null) return;
    input.value = code;
    input.dispatchEvent(new Event('input'));
    button.disabled = false;
    button.click();
  }

  function renderRooms(rooms, error) {
    if (list == null) return;
    const body = list.querySelector('.rooms');
    body.textContent = '';
    if (error) { el(body, 'p', 'state error', error); return; }
    if (rooms.length === 0) {
      el(body, 'p', 'state', tr('Aucune room ouverte pour l\'instant. Créez la vôtre avec « Héberger » !', 'No room open right now. Start yours with "Host"!'));
      return;
    }
    for (const r of rooms) {
      const row = el(body, 'div', 'room');
      const who = el(row, 'div', 'who');
      if (r.countryCode) { const f = el(who, 'img', 'flag'); f.src = 'images/countries/' + r.countryCode + '.svg'; f.draggable = false; }
      el(who, 'span', 'host', r.host);
      if (r.special) el(who, 'span', 'special', tr('★ Tournoi spécial', '★ Special tournament'));
      el(who, 'span', 'track', r.track || '—');
      const what = el(row, 'div', 'what');
      el(what, 'span', 'mode ' + r.mode, (MODE_TEXT[r.mode] || MODE_TEXT.casual)() + (RACING.has(r.mode) && r.laps ? ' · ' + r.laps + ' ' + tr(r.laps > 1 ? 'tours' : 'tour', r.laps > 1 ? 'laps' : 'lap') : ''));
      el(what, 'span', 'phase', RACING.has(r.mode) ? (PHASE_TEXT[r.phase] || PHASE_TEXT.null)() : since(r.since));
      const full = r.maxPlayers != null && r.players >= r.maxPlayers;
      el(row, 'div', 'players' + (full ? ' full' : ''), r.players + (r.maxPlayers != null ? '/' + r.maxPlayers : ''));
      // to watch: the player joins, then watches instead of driving (apex-room.js, apex-spectate.js)
      const w = el(row, 'button', 'button watch-room', tr('Regarder', 'Watch'));
      w.disabled = full;
      w.title = tr('Rejoindre la room en spectateur : votre voiture reste au garage, la caméra suit les pilotes.', 'Join the room as a spectator: your car stays parked, the camera follows the drivers.');
      w.addEventListener('click', () => { if (window.ApexRoom) window.ApexRoom.watchNext(true); join(r.code); });
      const b = el(row, 'button', 'button join-room', full ? tr('Pleine', 'Full') : tr('Rejoindre', 'Join'));
      b.disabled = full;
      b.addEventListener('click', () => { if (window.ApexRoom) window.ApexRoom.watchNext(false); join(r.code); });
    }
  }

  async function refresh() {
    clearTimeout(timer);
    if (list == null || !list.isConnected) { list = null; return; }
    timer = setTimeout(refresh, REFRESH_MS);
    if (loading || !list.offsetParent) return;
    loading = true;
    try {
      const res = await fetch(ROOMS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      renderRooms(await res.json());
    } catch (e) {
      renderRooms([], tr('Serveur injoignable pour l\'instant : nouvel essai dans quelques secondes.', 'Server unreachable for now: trying again in a few seconds.'));
    } finally { loading = false; }
  }

  // The join screen: the list above the invite code, which becomes a small line under it
  function decorateJoin(box) {
    box.classList.add('apex-lobby-box');
    box.parentElement.classList.add('apex-lobby-join');
    const title = box.querySelector('h2');
    if (title) title.textContent = tr('Rooms en cours', 'Open rooms');
    list = el(null, 'div', 'apex-lobby');
    el(list, 'div', 'rooms').appendChild(el(null, 'p', 'state', tr('Recherche des rooms…', 'Looking for rooms…')));
    if (title) title.after(list); else box.prepend(list);
    const codeBox = box.querySelector('.invite-code-container');
    if (codeBox) {
      codeBox.classList.add('apex-code');
      codeBox.prepend(el(null, 'span', 'label', tr('Ou avec un code :', 'Or with a code:')));
    }
    refresh();
  }

  // The host screen: keep the room out of the list
  function decorateHost(box) {
    box.classList.add('apex-lobby-host');
    const toggle = el(null, 'button', 'button toggle apex-listed' + (listed() ? ' selected' : ''), tr('Visible dans la liste des rooms', 'Shown in the room list'));
    toggle.title = tr('Sinon, seuls vos amis (onglet Amis) et ceux qui ont le code peuvent rejoindre.', 'Otherwise only your friends (Friends tab) and those with the code can join.');
    toggle.addEventListener('click', () => {
      const on = !listed();
      try { localStorage.setItem(LISTED_KEY, String(on)); } catch (e) { /* storage unavailable */ }
      toggle.classList.toggle('selected', on);
      lastInfo = 0;
    });
    const buttons = box.querySelector(':scope > .buttons');
    if (buttons) buttons.before(toggle); else box.appendChild(toggle);
  }

  new MutationObserver(() => {
    const join = document.querySelector('#ui .multiplayer-ui > .join > .main-box:not(.apex-lobby-box)');
    if (join) decorateJoin(join);
    const hostBox = document.querySelector('#ui .multiplayer-ui > .host > .main-box:not(.apex-lobby-host)');
    if (hostBox) decorateHost(hostBox);
  }).observe(document.getElementById('ui') || document.documentElement, { childList: true, subtree: true });

  window.ApexLobby = {
    hostSocket, joinSocket, hostFrame,
    // joins a room by its code, from the join screen (apex-tournament.js: a special tournament's room)
    join: code => join(code),
    roomsUrl: () => ROOMS_URL,
    currentRoom,
    session(on) { inSession = on; if (!on) joinedCode = null; roomChanged(); },
    debug: () => ({ host: host && { code: host.code, open: host.socket.readyState }, joinedCode, inSession, room: currentRoom(), listed: listed() }),
  };
})();
