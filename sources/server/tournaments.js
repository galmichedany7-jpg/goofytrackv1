// Time trial tournaments ("tournoi chrono"): a player opens one on a track for a set time (10 minutes to 3 days),
// everybody drives that track whenever they like, and the best time set during that time wins. The game sends every
// finished run on the track while the tournament is open (apex-tournament.js); the winner's game counts the win on
// their profile card when it next sees the result.
//
//   GET  /tournaments?userTokenHash=        { serverTime, tournaments: [...] }: the open ones and those of the last days,
//                                           each with its board (best first) and the player's own entry
//   POST /tournaments/create                userToken, userTokenHash, nickname, countryCode, trackId, trackName, minutes,
//                                           session: a GoofyTrack creator's account session makes it a special tournament
//                                           (the official ones, where rewards can be won: the game lists only those)
//   POST /tournaments/time                  userToken, userTokenHash, nickname, countryCode, id, frames
//   POST /tournaments/stop                  userToken, userTokenHash, id: the host ends it now (the best time so far wins)
//
// A player is known by the hash of their PolyTrack token, signed with a secret derived from the token, as for the
// records (records.js): the first request of a player ties the two. As with the records, the times are trusted.
//
// Storage: a secret GitHub Gist when GITHUB_TOKEN is set, a local JSON file otherwise.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_MINUTES = 10, MAX_MINUTES = 3 * 24 * 60;
const MAX_OPEN = 50;                    // tournaments open at once, all hosts together
const MAX_OPEN_PER_HOST = 3;
const MAX_ENTRIES = 500;                // players per tournament
const MAX_FRAMES = 6e6;                 // the game's own limit is 100 minutes
const GRACE = 15 * 1000;                // a run finished just before the end may arrive a little after it
const KEEP_DONE = 7 * 24 * 3600 * 1000; // finished tournaments listed this long
const FORGET = 30 * 24 * 3600 * 1000;   // and kept this long
const BOARD_SIZE = 50;                  // entries sent with each tournament
const GIST_FILE = 'goofytrack-tournaments.json';
const GIST_DESCRIPTION = 'GoofyTrack tournaments';
const SAVE_DELAY = 5000;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

function createTournaments({ creatorOf = () => null, githubToken = process.env.GITHUB_TOKEN, gistId = process.env.TOURNAMENTS_GIST_ID,
  file = process.env.TOURNAMENTS_FILE || path.join(__dirname, 'tournaments.json'), log = console.log, now = () => Date.now() } = {}) {
  // list: [{ id, trackId, trackName, host: { userId, nickname, countryCode }, start, end, stopped, special,
  //          entries: [{ userId, nickname, countryCode, frames, time }] best first }]
  // keys: userId -> sha256(secret)
  let data = { nextId: 1, list: [], keys: {} };
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
      if (!gistId) {
        const mine = await github('GET', '/gists?per_page=100');
        const found = mine.find(g => g.description === GIST_DESCRIPTION && g.files[GIST_FILE]);
        if (found) gistId = found.id;
        else {
          gistId = (await github('POST', '/gists', { description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: JSON.stringify(data) } } })).id;
          log(`tournaments: new gist ${gistId}`);
        }
      }
      const gist = await github('GET', '/gists/' + gistId);
      const f = gist.files[GIST_FILE];
      if (f) data = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
    } else if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.list)) data.list = [];
    if (data.keys == null) data.keys = {};
    log(`tournaments: ${data.list.length} kept (${open().length} open)`);
    ready = true;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const content = JSON.stringify(data);
    saving = saving.then(async () => {
      if (githubToken) await github('PATCH', '/gists/' + gistId, { files: { [GIST_FILE]: { content } } });
      else fs.writeFileSync(file, content);
    }).catch(e => { console.error('tournaments: save failed', e.message); scheduleSave(); });
    return saving;
  }
  function scheduleSave() {
    if (saveTimer == null) saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  // ---------------------------------------------------------------- tournaments
  const open = (t = now()) => data.list.filter(x => x.end > t);
  function prune() {
    const before = data.list.length, t = now();
    data.list = data.list.filter(x => x.end > t - FORGET);
    if (data.list.length !== before) scheduleSave();
  }
  const signedBy = (userId, secret) => {
    const key = sha256(secret);
    if (data.keys[userId] == null) { data.keys[userId] = key; scheduleSave(); }
    return data.keys[userId] === key;
  };
  const player = form => {
    const userId = form.get('userTokenHash'), secret = form.get('userToken');
    const nickname = String(form.get('nickname') || '').trim().slice(0, 32), countryCode = form.get('countryCode');
    if (!HEX64.test(userId || '') || !HEX64.test(secret || '')) return [400, 'bad request'];
    if (countryCode != null && countryCode !== '' && !/^[a-z]{2}$/i.test(countryCode)) return [400, 'bad country'];
    if (!signedBy(userId, secret)) return [403, 'wrong token'];
    return [200, { userId, nickname: nickname || '?', countryCode: countryCode ? countryCode.toLowerCase() : null }];
  };
  const find = id => data.list.find(x => x.id === Number(id)) || null;

  function publicTournament(x, userId, t) {
    const done = x.end <= t;
    const position = userId ? x.entries.findIndex(e => e.userId === userId) : -1;
    return {
      id: x.id, trackId: x.trackId, trackName: x.trackName, host: { nickname: x.host.nickname, countryCode: x.host.countryCode, self: x.host.userId === userId },
      start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString(), done, stopped: !!x.stopped, special: !!x.special, total: x.entries.length,
      entries: x.entries.slice(0, BOARD_SIZE).map(e => ({ nickname: e.nickname, countryCode: e.countryCode, frames: e.frames })),
      self: position < 0 ? null : { position: position + 1, frames: x.entries[position].frames },
      // the winner's public id: their game counts the win when it sees it (apex-tournament.js)
      winner: done && x.entries.length ? { nickname: x.entries[0].nickname, countryCode: x.entries[0].countryCode, frames: x.entries[0].frames, userId: x.entries[0].userId } : null,
    };
  }

  function list(q) {
    prune();
    const t = now(), userId = q.get('userTokenHash');
    const shown = data.list.filter(x => x.end > t - KEEP_DONE).sort((a, b) => (a.end > t) !== (b.end > t) ? (a.end > t ? -1 : 1) : a.end > t ? a.end - b.end : b.end - a.end);
    return { serverTime: new Date(t).toISOString(), tournaments: shown.map(x => publicTournament(x, HEX64.test(userId || '') ? userId : null, t)) };
  }

  // -> [status, body]
  function create(form) {
    const [status, who] = player(form);
    if (status !== 200) return [status, who];
    const trackId = form.get('trackId'), trackName = String(form.get('trackName') || '').trim().slice(0, 64), minutes = Number(form.get('minutes'));
    if (!HEX64.test(trackId || '') || trackName === '') return [400, 'bad track'];
    if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) return [400, 'bad duration'];
    const t = now(), running = open(t);
    if (running.length >= MAX_OPEN) return [507, 'too many tournaments'];
    if (running.filter(x => x.host.userId === who.userId).length >= MAX_OPEN_PER_HOST) return [429, 'too many tournaments for this host'];
    const special = creatorOf(form.get('session')) != null;
    const x = { id: data.nextId++, trackId, trackName, host: who, start: t, end: t + minutes * 60000, stopped: false, special, entries: [] };
    data.list.push(x);
    scheduleSave();
    log(`tournaments: #${x.id}${special ? ' (special)' : ''} by ${who.nickname} on ${trackName}, ${minutes} min`);
    return [200, publicTournament(x, who.userId, t)];
  }

  function time(form) {
    const [status, who] = player(form);
    if (status !== 200) return [status, who];
    const x = find(form.get('id')), frames = Number(form.get('frames')), t = now();
    if (x == null) return [404, 'no such tournament'];
    if (!Number.isSafeInteger(frames) || frames <= 0 || frames > MAX_FRAMES) return [400, 'bad frames'];
    if (t < x.start || t > x.end + (x.stopped ? 0 : GRACE)) return [409, 'tournament closed'];
    const old = x.entries.find(e => e.userId === who.userId);
    if (old != null && old.frames <= frames) {
      if (old.nickname !== who.nickname || old.countryCode !== who.countryCode) { Object.assign(old, { nickname: who.nickname, countryCode: who.countryCode }); scheduleSave(); }
      return [200, publicTournament(x, who.userId, t)];
    }
    if (old == null && x.entries.length >= MAX_ENTRIES && frames >= x.entries[x.entries.length - 1].frames) return [507, 'board full'];
    if (old != null) x.entries.splice(x.entries.indexOf(old), 1);
    x.entries.push({ ...who, frames, time: new Date(t).toISOString() });
    x.entries.sort((a, b) => a.frames - b.frames || a.time.localeCompare(b.time));
    if (x.entries.length > MAX_ENTRIES) x.entries.length = MAX_ENTRIES;
    scheduleSave();
    return [200, publicTournament(x, who.userId, t)];
  }

  function stop(form) {
    const [status, who] = player(form);
    if (status !== 200) return [status, who];
    const x = find(form.get('id')), t = now();
    if (x == null) return [404, 'no such tournament'];
    if (x.host.userId !== who.userId) return [403, 'not the host'];
    if (x.end > t) { x.end = t; x.stopped = true; scheduleSave(); log(`tournaments: #${x.id} stopped by its host`); }
    return [200, publicTournament(x, who.userId, t)];
  }

  // ---------------------------------------------------------------- http
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const POSTS = { '/tournaments/create': create, '/tournaments/time': time, '/tournaments/stop': stop };

  // true when the request was one of ours
  function handle(req, res, url) {
    if (url.pathname !== '/tournaments' && !POSTS[url.pathname]) return false;
    if (!ready) { reply(res, 503, 'tournaments not loaded yet'); return true; }
    if (req.method === 'GET' && url.pathname === '/tournaments') { reply(res, 200, list(url.searchParams)); return true; }
    if (req.method === 'POST' && POSTS[url.pathname]) {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 16 * 1024) req.destroy(); });
      req.on('end', () => { const [status, out] = POSTS[url.pathname](new URLSearchParams(body)); reply(res, status, out); });
      return true;
    }
    reply(res, 405, 'method not allowed');
    return true;
  }

  return { load, handle, flush: () => (saveTimer != null ? saveNow() : saving), stats: () => ({ ready, open: open().length }) };
}

module.exports = { createTournaments };
