// Apex records: the leaderboards of the mod's own tracks (Killer Loop, Monaco GP...).
//
// Those tracks do not exist on the PolyTrack servers. patch_bundle.js sends their leaderboard requests
// to the GoofyTrack server instead (server/records.js), in the same format, so the game's leaderboard
// screen, ghosts and "Watch" work on them as on any official track. Records set on other tracks still
// go to PolyTrack, untouched.
//
// The PolyTrack token never leaves the game for our server: a record is signed with a secret derived
// from it, and the player is known there by the same public hash as on the official boards.
//
// The official boards show each player's car of the moment, not the one their record was set with. So the
// car of each run uploaded to PolyTrack also goes to our server (uploaded), which keeps the one of the
// player's best run; the boards the game shows ask it for the cars of their entries (styles) and show the
// one kept where the time is the same, as do the runs replayed from them (recordingStyle).
(() => {
  'use strict';

  const SHA256_MODULE = 1312;     // webpack id of the game's sha256 (PolyTrack 0.6.3)
  const STYLES_TIMEOUT = 2500;    // ms: past that (the server asleep) the board shows the cars PolyTrack gives

  let webpackRequire = null;
  const sha256 = text => {
    if (webpackRequire == null) window.webpackChunk.push([[Symbol('apex-records')], {}, r => { webpackRequire = r; }]);
    return webpackRequire(SHA256_MODULE).sha256(text);
  };
  const hash = token => sha256(token);                                  // = the profile's tokenHash
  const secret = token => sha256('goofytrack-records:' + token);
  const server = () => String(window.GOOFY_SERVER || 'https://goofytrack.onrender.com/');

  const byEntry = new Map();      // official entry id -> the car its record was set with

  // a run uploaded to an official board, with the car it was driven with
  function uploaded(token, trackId, frames, carStyle) {
    try {
      const body = new URLSearchParams({ userToken: secret(token), userTokenHash: hash(token), trackId, frames: String(frames), carStyle });
      fetch(server() + 'carStyle', { method: 'POST', body }).catch(() => { /* the board keeps the car of the moment */ });
    } catch (e) { console.warn('GoofyTrack records: car of the run', e); }
  }

  // entries: [{ id, userId, frames }] of an official board -> Map(entry id -> car style string), the entries
  // whose record was set with another car than the one PolyTrack shows; empty when the server does not answer
  async function styles(trackId, entries) {
    const found = new Map();
    const users = [...new Set(entries.map(e => e.userId).filter(u => typeof u === 'string'))];
    if (users.length === 0) return found;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), STYLES_TIMEOUT);
    try {
      const res = await fetch(server() + 'carStyles?trackId=' + encodeURIComponent(trackId) + '&users=' + users.join(','), { signal: abort.signal });
      const cars = res.ok ? await res.json() : {};
      for (const e of entries) {
        const kept = cars && Object.prototype.hasOwnProperty.call(cars, e.userId) ? cars[e.userId] : null;
        if (Array.isArray(kept) && kept[0] === e.frames && typeof kept[1] === 'string') { found.set(e.id, kept[1]); byEntry.set(e.id, kept[1]); }
      }
    } catch (e) { /* asleep or offline */ } finally { clearTimeout(timer); }
    return found;
  }

  // ---------------------------------------------------------------- ghosts that no longer replay (2.26)
  // The game found a ghost that does not reach the finish in its time: the track or the physics changed since it was
  // set. Its name goes in the game's message; on a track of the mod it is reported to our server (signed as the
  // records are), which takes it off the board once two players have seen it fail on a build other than the record's.
  const modTrack = id => (Array.isArray(window.GOOFY_MOD_TRACKS) ? window.GOOFY_MOD_TRACKS : []).some(t => t.id === id);
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const reported = new Set();     // trackId:nickname:frames, once per game
  let invalid = [];               // names of the ghosts found since the last message
  function invalidGhost(sceneTrack, settings, build) {
    try {
      const nickname = String(settings?.nickname || '').trim(), frames = settings?.time?.numberOfFrames;
      if (nickname && !invalid.includes(nickname)) invalid.push(nickname);
      const trackId = sceneTrack?.getTrackData?.().getId?.();
      if (!modTrack(trackId) || !nickname || !(frames > 0)) return;
      const key = trackId + ':' + nickname + ':' + frames;
      if (reported.has(key)) return;
      reported.add(key);
      const p = window.ApexAccount?.profile?.();
      if (p == null || typeof p.token !== 'string') return;
      const body = new URLSearchParams({ userToken: secret(p.token), userTokenHash: hash(p.token), trackId, nickname, frames: String(frames), build: String(build || '') });
      fetch(server() + 'invalidRecord', { method: 'POST', body }).catch(() => { /* next time */ });
    } catch (e) { console.warn('GoofyTrack records: invalid ghost', e); }
  }
  function invalidText() {
    const names = invalid;
    invalid = [];
    if (names.length === 0) return null;
    const who = names.join(', ');
    return french()
      ? `Fantôme invalide : ${who}. La piste ou le jeu a changé depuis ce temps, il ne retombe plus sur son chrono. Sur une piste du mod, il est signalé et sera retiré du classement.`
      : `Invalid ghost: ${who}. The track or the game changed since this time was set, it no longer replays to its time. On a mod track, it is reported and will be taken off the board.`;
  }

  window.ApexRecords = {
    invalidGhost,
    invalidText,
    hash,
    secret,
    uploaded,
    styles,
    recordingStyle: id => byEntry.get(id),
  };
})();
