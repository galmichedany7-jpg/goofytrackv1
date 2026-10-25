// Leaderboards of the tracks shipped with the mod (Killer Loop, Monaco GP...).
//
// These tracks do not exist on the PolyTrack servers, so the game sends their records here instead
// (see patch_bundle.js, "mod track leaderboards"). The four requests speak the same format as the
// official server, so the game's own leaderboard screen shows them unchanged:
//
//   GET  /leaderboard?trackId=&skip=&amount=&userTokenHash=     a page of the board, and the player's own entry
//   GET  /leaderboardUserEntry?trackId=&userTokenHash=          the player's own entry, or null
//   GET  /recordings?ids=1,2                                    runs to replay (ghosts, "Watch")
//   POST /leaderboard   userToken, userTokenHash, nickname, countryCode, carStyle, trackId, frames, recording
//
// One entry per player and track: their best time. A player is known by the hash of their PolyTrack
// token (the same public id as on the official boards). That hash is public, so a record is only
// accepted with a secret derived from the token itself; the first record of a player ties the two.
//
// Storage: a secret GitHub Gist when GITHUB_TOKEN is set (free hosts wipe their disk on every
// restart), a local JSON file otherwise.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FRAMES = 6e6;                 // the game's own limit is 100 minutes
const MAX_RECORDING = 10000;            // characters, as in the game
const MAX_ENTRIES_PER_TRACK = 1000;
const MAX_TRACKS = 200;
const FIRST_ID = 8e15;                  // far above the official record ids: the game tells them apart by value
const GIST_FILE = 'goofytrack-records.json';
const GIST_DESCRIPTION = 'GoofyTrack records';
const SAVE_DELAY = 5000;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

function createRecords({ githubToken = process.env.GITHUB_TOKEN, gistId = process.env.GIST_ID,
  file = process.env.RECORDS_FILE || path.join(__dirname, 'records.json'), log = console.log } = {}) {
  // tracks: trackId -> [{ id, userId, nickname, countryCode, carStyle, frames, recording, time }]
  // keys:   userId -> sha256(secret)
  let data = { nextId: FIRST_ID, tracks: {}, keys: {} };
  let ready = false, saveTimer = null, saving = Promise.resolve();

  // ---------------------------------------------------------------- storage
  const github = async (method, url, body) => {
    const res = await fetch('https://api.github.com' + url, {
      method,
      headers: { Authorization: 'Bearer ' + githubToken, Accept: 'application/vnd.github+json', 'User-Agent': 'goofytrack-server' },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  async function load() {
    if (githubToken) {
      if (!gistId) {          // find the gist by its description, or make it
        const mine = await github('GET', '/gists?per_page=100');
        const found = mine.find(g => g.description === GIST_DESCRIPTION && g.files[GIST_FILE]);
        if (found) gistId = found.id;
        else {
          gistId = (await github('POST', '/gists', { description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: JSON.stringify(data) } } })).id;
          log(`records: new gist ${gistId}`);
        }
      }
      const gist = await github('GET', '/gists/' + gistId);
      const f = gist.files[GIST_FILE];
      if (f) data = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
      log(`records: loaded from gist ${gistId}`);
    } else if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      log(`records: loaded from ${file}`);
    } else log(`records: none yet, will be saved to ${file} (set GITHUB_TOKEN to keep them in a gist)`);
    // a host that wipes its disk (Render free plan) forgets every record on each restart
    if (!githubToken && process.env.RENDER) console.error('records: WARNING no GITHUB_TOKEN on Render: the records are lost on every restart (every sleep)');
    const count = Object.values(data.tracks).reduce((n, t) => n + t.length, 0);
    log(`records: ${count} on ${Object.keys(data.tracks).length} track(s)`);
    ready = true;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const content = JSON.stringify(data);
    saving = saving.then(async () => {
      if (githubToken) await github('PATCH', '/gists/' + gistId, { files: { [GIST_FILE]: { content } } });
      else fs.writeFileSync(file, content);
    }).catch(e => { console.error('records: save failed', e.message); scheduleSave(); });
    return saving;
  }
  function scheduleSave() {
    if (saveTimer == null) saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  // ---------------------------------------------------------------- board
  const board = trackId => (Object.prototype.hasOwnProperty.call(data.tracks, trackId) ? data.tracks[trackId] : []);
  const sorted = entries => entries.sort((a, b) => a.frames - b.frames || a.time.localeCompare(b.time) || a.id - b.id);
  const positionOf = (entries, userId) => entries.findIndex(e => e.userId === userId) + 1;   // 0: not on the board
  const userEntry = (entries, userId) => {
    const i = entries.findIndex(e => e.userId === userId);
    return i < 0 ? null : { position: i + 1, frames: entries[i].frames, id: entries[i].id };
  };
  const publicEntry = e => ({
    id: e.id, userId: e.userId, nickname: e.nickname, countryCode: e.countryCode, frames: e.frames,
    time: e.time, carStyle: e.carStyle, verifiedState: 1,   // 1 = Verified: nobody re-simulates the runs here
  });

  function getLeaderboard(q) {
    const entries = board(q.get('trackId'));
    const skip = Math.max(0, parseInt(q.get('skip'), 10) || 0);
    const amount = Math.max(0, Math.min(100, parseInt(q.get('amount'), 10) || 20));
    return {
      total: entries.length,
      entries: entries.slice(skip, skip + amount).map(publicEntry),
      userEntry: userEntry(entries, q.get('userTokenHash')),
    };
  }

  const getUserEntry = q => userEntry(board(q.get('trackId')), q.get('userTokenHash'));

  function getRecordings(q) {
    const ids = String(q.get('ids') || '').split(',').slice(0, 50).map(Number);
    const byId = new Map();
    for (const entries of Object.values(data.tracks)) for (const e of entries) byId.set(e.id, e);
    return ids.map(id => {
      const e = byId.get(id);
      return e ? { recording: e.recording, frames: e.frames, verifiedState: 1, carStyle: e.carStyle } : null;
    });
  }

  // -> [status, body]
  function submit(form) {
    const trackId = form.get('trackId'), userId = form.get('userTokenHash'), secret = form.get('userToken');
    const frames = Number(form.get('frames')), recording = form.get('recording'), carStyle = form.get('carStyle');
    const nickname = String(form.get('nickname') || '').trim().slice(0, 32);
    const countryCode = form.get('countryCode');
    if (!HEX64.test(trackId || '') || !HEX64.test(userId || '') || !HEX64.test(secret || '')) return [400, 'bad request'];
    if (!Number.isSafeInteger(frames) || frames <= 0 || frames > MAX_FRAMES) return [400, 'bad frames'];
    if (typeof recording !== 'string' || recording.length === 0 || recording.length >= MAX_RECORDING) return [400, 'bad recording'];
    if (typeof carStyle !== 'string' || carStyle.length > 200 || nickname === '') return [400, 'bad profile'];
    if (countryCode != null && !/^[a-z]{2}$/i.test(countryCode)) return [400, 'bad country'];

    const key = sha256(secret);
    if (data.keys[userId] == null) data.keys[userId] = key;
    else if (data.keys[userId] !== key) return [403, 'wrong token'];

    if (!Object.prototype.hasOwnProperty.call(data.tracks, trackId)) {
      if (Object.keys(data.tracks).length >= MAX_TRACKS) return [507, 'too many tracks'];
      data.tracks[trackId] = [];
    }
    const entries = data.tracks[trackId];
    const previousPosition = positionOf(entries, userId);
    const old = entries.find(e => e.userId === userId);
    if (old != null && old.frames <= frames) {
      // not better: keep the entry, refresh the name and car shown on it
      if (old.nickname !== nickname || old.carStyle !== carStyle || old.countryCode !== (countryCode || null)) {
        Object.assign(old, { nickname, carStyle, countryCode: countryCode || null });
        scheduleSave();
      }
      return [200, { uploadId: old.id, previousPosition, newPosition: previousPosition }];
    }
    if (old == null && entries.length >= MAX_ENTRIES_PER_TRACK && frames >= entries[entries.length - 1].frames) return [507, 'board full'];
    const entry = { id: data.nextId++, userId, nickname, countryCode: countryCode || null, carStyle, frames, recording, time: new Date().toISOString() };
    if (old != null) entries.splice(entries.indexOf(old), 1);
    entries.push(entry);
    sorted(entries);
    if (entries.length > MAX_ENTRIES_PER_TRACK) entries.length = MAX_ENTRIES_PER_TRACK;
    scheduleSave();
    log(`records: ${nickname} ${frames} ms on ${trackId.slice(0, 8)} (P${positionOf(entries, userId)})`);
    return [200, { uploadId: entry.id, previousPosition, newPosition: positionOf(entries, userId) }];
  }

  // ---------------------------------------------------------------- http
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  // true when the request was one of ours
  function handle(req, res, url) {
    const routes = { '/leaderboard': true, '/leaderboardUserEntry': true, '/recordings': true };
    if (!routes[url.pathname]) return false;
    if (!ready) { reply(res, 503, 'records not loaded yet'); return true; }
    if (req.method === 'GET') {
      if (url.pathname === '/leaderboard') reply(res, 200, getLeaderboard(url.searchParams));
      else if (url.pathname === '/leaderboardUserEntry') reply(res, 200, getUserEntry(url.searchParams));
      else reply(res, 200, getRecordings(url.searchParams));
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/leaderboard') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => { const [status, out] = submit(new URLSearchParams(body)); reply(res, status, out); });
      return true;
    }
    reply(res, 405, 'method not allowed');
    return true;
  }

  // a player's best place on the mod's boards: { position, trackId } or null (profile cards, accounts.js)
  // (the circuit the player picked, among those where they hold that place: accounts.js, profile.bestTrack)
  function bestOf(userId, preferred) {
    let best = null;
    for (const [trackId, entries] of Object.entries(data.tracks)) {
      const position = positionOf(entries, userId);
      if (position > 0 && (best == null || position < best.position || (position === best.position && trackId === preferred))) best = { position, trackId };
    }
    return best;
  }

  // the mod's circuits where a player is on the podium: [{ trackId, position: 1..3 }], first places first
  // (their P1, P2 and P3 badges, accounts.js)
  function podiumOf(userId) {
    return Object.entries(data.tracks).map(([trackId, entries]) => ({ trackId, position: positionOf(entries, userId) }))
      .filter(p => p.position >= 1 && p.position <= 3).sort((a, b) => a.position - b.position);
  }

  const storage = () => (githubToken ? 'gist' : 'file');
  return { load, handle, bestOf, podiumOf, flush: () => (saveTimer != null ? saveNow() : saving), stats: () => ({ ready, tracks: Object.keys(data.tracks).length, storage: storage() }) };
}

module.exports = { createRecords };
