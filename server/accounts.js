// GoofyTrack accounts: one save per player, shared by all the PCs they play on (apex-account.js).
//
// The save is encrypted by the game with a key derived from the password, and the password itself never
// leaves the PC: the game derives two keys from it, one to encrypt, the other ("auth") to log in. This
// server only sees the second one, and keeps a scrypt hash of it. What it stores is an opaque blob, with a
// version number so that two PCs saving at once do not overwrite each other (the second gets a 409 with the
// newer save, merges it and tries again).
//
//   POST /account/register  { name, auth }           -> { name, id, verified, session, version: 0 }
//   POST /account/login     { name, auth }           -> { name, id, verified, session, version, blob }
//   GET  /account/save[?have=<version>]              -> { version, blob } (no blob when the PC already has that version)
//   PUT  /account/save      { version, blob }        -> { version }, or 409 { version, blob }
//   POST /account/logout
//
// Each account also has a public number (#0001, #0002... in the order they were made), by which players add
// each other as friends. Friends see each other's profile (name, flag, car), whether they are playing, and
// the invite code of the room they are in (hosting it or not), to join it in one click:
//   POST /account/presence  { profile: { nickname, countryCode, carStyle, badges }, state: 'menu' | 'playing', room: code | null }
//                           -> { id, verified, badges, requests, online }     every 30 s while the game runs
//   GET  /account/friends                            -> { me, friends, requests, sent }
//   POST /account/friends   { action: 'add' | 'accept' | 'decline' | 'cancel' | 'remove', id }
//   GET  /account/player?name=<account name> | ?id=<number>   -> a player's public card, no session needed
//        (with one: whether you are friends): profile, stats the game sends with its presence, best place
//        on the mod's boards. The game links a track's author to the account of that name.
// Adding someone sends them a request; adding someone who has asked first makes you friends at once.
// A hosted room comes from the multiplayer server itself (server.js): the game hosting a room says whose it is.
// A room joined comes with the presence, and only counts while the multiplayer server still has it open.
// All but register and login take the session as "Authorization: Bearer <session>".
//
// RESERVED_IDS ("julio:1,shyn:2", the default) keeps numbers for some names; CREATOR_IDS ("1,2") are shown with the
// "creator" check mark.
//
// Badges, shown next to a player's name: 'creator' (CREATOR_IDS), 'vip' (VIP_IDS), and 'p1:<trackId>', 'p2:…', 'p3:…' while the
// player holds that place on a circuit of the mod (records.js). A player picks up to two of the badges they own (the
// presence's profile.badges); others see those they still own. The presence answers with all they own.
//
// Storage: one file per account in a secret GitHub Gist when GITHUB_TOKEN is set, a local JSON file otherwise.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GIST_DESCRIPTION = 'GoofyTrack accounts';
const NAME = /^[\p{L}\p{N}_.-]{3,20}$/u;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BLOB = 8 * 1024 * 1024;       // characters of base64
const MAX_SESSIONS = 10;                // per account, the oldest go first
const MAX_ACCOUNTS = 500;
const SAVE_DELAY = 5000;
const FAILED_LOGINS = 10;               // per name, every 15 minutes
const REGISTRATIONS = 5;                // per address, every hour
const MAX_FRIENDS = 100;
const MAX_REQUESTS = 50;                // waiting for an answer, per account
const MAX_BADGES = 2;                   // shown next to a name
const ONLINE = 75 * 1000;               // since the last presence: the game sends one every 30 s
const RESERVED_IDS = new Map((process.env.RESERVED_IDS ?? 'julio:1,shyn:2').split(',').filter(Boolean)
  .map(pair => pair.split(':')).map(([name, id]) => [name.normalize('NFC').toLowerCase(), Number(id)]));
const CREATOR_IDS = new Set((process.env.CREATOR_IDS ?? '1,2').split(',').filter(Boolean).map(Number));
// the VIP diamond: friends and the first players, by number (#0003 is 3)
const VIP_IDS = new Set((process.env.VIP_IDS ?? '').split(',').filter(Boolean).map(Number));
const COUNTRY = /^[a-z]{2}$/i;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const keyOf = name => name.normalize('NFC').toLowerCase();
const fileOf = key => 'account-' + sha256(key).slice(0, 16) + '.json';
const scrypt = (auth, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(auth, salt, 32, (error, hash) => (error ? reject(error) : resolve(hash.toString('hex')))));

// counts events per key over a window of time
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    over: key => { const h = hits.get(key); return h != null && h.count >= max && Date.now() - h.start < windowMs; },
    hit: key => {
      const h = hits.get(key);
      if (h == null || Date.now() - h.start >= windowMs) hits.set(key, { count: 1, start: Date.now() });
      else h.count++;
    },
  };
}

// bestPlace(tokenHash): the player's best place on the mod's boards (records.js), for the profile cards;
// podium(tokenHash): the circuits where they are in the top three (their P1, P2, P3 badges)
function createAccounts({ githubToken = process.env.GITHUB_TOKEN, gistId = process.env.ACCOUNTS_GIST_ID,
  file = process.env.ACCOUNTS_FILE || path.join(__dirname, 'accounts.json'), log = console.log, bestPlace = () => null, podium = () => [], roomOpen = () => false } = {}) {
  // key (lower-case name) -> { name, id, salt, hash, sessions: [sha256(session)], version, blob, created, updated,
  //                            friends: [id], requests: [id] (asked by them), profile: { nickname, countryCode, carStyle } }
  const accounts = new Map();
  const bySession = new Map();          // sha256(session) -> key
  const byId = new Map();               // public number -> key
  const presence = new Map();           // key -> { time, state, room } (not saved: who is playing now, in which room)
  const rooms = new Map();              // key -> invite code of the room the player hosts
  const dirty = new Set();
  let ready = false, saveTimer = null, saving = Promise.resolve();
  const failedLogins = limiter(FAILED_LOGINS, 15 * 60 * 1000);
  const registrations = limiter(REGISTRATIONS, 60 * 60 * 1000);

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

  function add(account) {
    const key = keyOf(account.name);
    accounts.set(key, account);
    for (const s of account.sessions) bySession.set(s, key);
    if (account.id != null) byId.set(account.id, key);
  }
  // the next free number, skipping those kept for other names
  function newId(key) {
    if (RESERVED_IDS.has(key) && !byId.has(RESERVED_IDS.get(key))) return RESERVED_IDS.get(key);
    const reserved = new Set(RESERVED_IDS.values());
    let id = 1;
    while (byId.has(id) || reserved.has(id)) id++;
    return id;
  }
  // accounts made before the numbers (V2.13 tests): numbered in the order they were made, friends lists added
  function upgrade() {
    const old = [...accounts.entries()].filter(([, a]) => a.id == null)
      .sort(([, a], [, b]) => String(a.created || a.updated).localeCompare(String(b.created || b.updated)));
    for (const [key, a] of old) {
      a.id = newId(key);
      a.created ??= a.updated;
      byId.set(a.id, key);
      changed(key);
    }
    for (const a of accounts.values()) { a.friends ??= []; a.requests ??= []; a.profile ??= null; }
  }

  async function load() {
    if (githubToken) {
      if (!gistId) {          // find the gist by its description, or make it
        const mine = await github('GET', '/gists?per_page=100');
        const found = mine.find(g => g.description === GIST_DESCRIPTION);
        if (found) gistId = found.id;
        else {
          gistId = (await github('POST', '/gists', { description: GIST_DESCRIPTION, public: false, files: { 'README.md': { content: 'GoofyTrack accounts: one encrypted save per player.' } } })).id;
          log(`accounts: new gist ${gistId}`);
        }
      }
      const gist = await github('GET', '/gists/' + gistId);
      for (const [name, f] of Object.entries(gist.files)) {
        if (!name.startsWith('account-')) continue;
        add(JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content));
      }
      log(`accounts: loaded from gist ${gistId}`);
    } else if (fs.existsSync(file)) {
      for (const account of JSON.parse(fs.readFileSync(file, 'utf8'))) add(account);
      log(`accounts: loaded from ${file}`);
    } else log(`accounts: none yet, will be saved to ${file} (set GITHUB_TOKEN to keep them in a gist)`);
    if (!githubToken && process.env.RENDER) console.error('accounts: WARNING no GITHUB_TOKEN on Render: the accounts and their saves are lost on every restart (every sleep)');
    upgrade();
    log(`accounts: ${accounts.size}`);
    ready = true;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const keys = [...dirty];
    dirty.clear();
    saving = saving.then(async () => {
      if (githubToken) {
        const files = {};
        for (const key of keys) files[fileOf(key)] = { content: JSON.stringify(accounts.get(key)) };
        await github('PATCH', '/gists/' + gistId, { files });
      } else fs.writeFileSync(file, JSON.stringify([...accounts.values()]));
    }).catch(e => { console.error('accounts: save failed', e.message); for (const key of keys) dirty.add(key); scheduleSave(); });
    return saving;
  }
  function changed(key) {
    dirty.add(key);
    if (saveTimer == null) saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }
  const scheduleSave = () => { if (saveTimer == null && dirty.size) saveTimer = setTimeout(saveNow, SAVE_DELAY); };

  // ---------------------------------------------------------------- sessions
  function newSession(key) {
    const account = accounts.get(key);
    const session = crypto.randomBytes(32).toString('hex');
    account.sessions.push(sha256(session));
    while (account.sessions.length > MAX_SESSIONS) bySession.delete(account.sessions.shift());
    bySession.set(sha256(session), key);
    changed(key);
    return session;
  }
  function sessionOf(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    if (m == null) return null;
    const hash = sha256(m[1]), key = bySession.get(hash);
    return key == null ? null : { key, hash, account: accounts.get(key) };
  }

  // ---------------------------------------------------------------- requests: -> [status, body]
  async function register(body, address) {
    const name = String(body.name || '').trim();
    if (!NAME.test(name) || !HEX64.test(body.auth || '')) return [400, { error: 'bad request' }];
    if (registrations.over(address)) return [429, { error: 'too many accounts' }];
    const key = keyOf(name);
    if (accounts.has(key)) return [409, { error: 'name taken' }];
    if (accounts.size >= MAX_ACCOUNTS) return [507, { error: 'too many accounts' }];
    registrations.hit(address);
    const salt = crypto.randomBytes(16).toString('hex'), hash = await scrypt(body.auth, salt);
    if (accounts.has(key)) return [409, { error: 'name taken' }];   // made meanwhile
    const now = new Date().toISOString(), id = newId(key);
    accounts.set(key, { name, id, salt, hash, sessions: [], version: 0, blob: null, created: now, updated: now, friends: [], requests: [], profile: null });
    byId.set(id, key);
    log(`accounts: new account ${name} #${id}`);
    return [200, { name, id, verified: verifiedOf(id), session: newSession(key), version: 0 }];
  }

  async function login(body) {
    const name = String(body.name || '').trim();
    if (!NAME.test(name) || !HEX64.test(body.auth || '')) return [400, { error: 'bad request' }];
    const key = keyOf(name), account = accounts.get(key);
    if (failedLogins.over(key)) return [429, { error: 'too many attempts' }];
    // same answer, and about the same time, for an unknown name and a wrong password
    const hash = await scrypt(body.auth, account ? account.salt : '0'.repeat(32));
    if (account == null || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.hash, 'hex'))) {
      failedLogins.hit(key);
      return [403, { error: 'wrong name or password' }];
    }
    return [200, { name: account.name, id: account.id, verified: verifiedOf(account.id), session: newSession(key), version: account.version, blob: account.blob }];
  }

  function getSave(s, have) {
    const { version, blob } = s.account;
    return [200, String(version) === have ? { version } : { version, blob }];
  }

  function putSave(s, body) {
    if (typeof body.blob !== 'string' || body.blob.length === 0 || body.blob.length > MAX_BLOB || !/^[A-Za-z0-9+/=]+$/.test(body.blob)) return [400, { error: 'bad save' }];
    const account = s.account;
    if (body.version !== account.version) return [409, { version: account.version, blob: account.blob }];
    account.version++;
    account.blob = body.blob;
    account.updated = new Date().toISOString();
    changed(s.key);
    return [200, { version: account.version }];
  }

  function logout(s) {
    const account = s.account;
    account.sessions = account.sessions.filter(h => h !== s.hash);
    bySession.delete(s.hash);
    presence.delete(s.key);
    changed(s.key);
    return [200, {}];
  }

  // ---------------------------------------------------------------- friends
  const verifiedOf = id => (CREATOR_IDS.has(id) ? 'creator' : null);
  // the badges a player owns now
  const badgesOf = a => [...(CREATOR_IDS.has(a.id) ? ['creator'] : []), ...(VIP_IDS.has(a.id) ? ['vip'] : []), ...(a.profile?.tokenHash ? podium(a.profile.tokenHash).map(p => 'p' + p.position + ':' + p.trackId) : [])];
  const isOnline = key => Date.now() - (presence.get(key)?.time ?? 0) < ONLINE;
  // the room a player is in: the one they host, or the one they said they joined if it is still open
  const roomOf = key => rooms.get(key) ?? (roomOpen(presence.get(key)?.room) ? presence.get(key).room : null);
  // what a player shows to others; the room's code only to friends
  function view(key, friend) {
    const a = accounts.get(key), p = a.profile || {}, online = isOnline(key), room = online ? roomOf(key) : null;
    const out = {
      id: a.id, name: a.name, verified: verifiedOf(a.id),
      badges: (p.badges || []).filter(b => badgesOf(a).includes(b)),   // those picked, still owned
      nickname: p.nickname || a.name, countryCode: p.countryCode || null, carStyle: p.carStyle || null,
      online, state: online ? (rooms.has(key) ? 'hosting' : room != null ? 'room' : presence.get(key).state) : 'offline',
      lastSeen: presence.get(key)?.time ?? null,
    };
    if (friend && room != null) out.room = room;
    return out;
  }
  const keysOf = ids => ids.map(id => byId.get(id)).filter(key => key != null);

  function updatePresence(s, body) {
    const state = body.state === 'playing' ? 'playing' : 'menu';
    const room = typeof body.room === 'string' ? body.room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || null : null;
    presence.set(s.key, { time: Date.now(), state, room });
    const p = body.profile;
    if (p && typeof p === 'object') {
      const count = n => (Number.isSafeInteger(n) && n >= 0 && n < 1e6 ? n : null);
      const stats = p.stats && typeof p.stats === 'object' ? p.stats : {};
      const profile = {
        nickname: String(p.nickname || '').trim().slice(0, 32) || null,
        countryCode: COUNTRY.test(p.countryCode || '') ? p.countryCode : null,
        carStyle: typeof p.carStyle === 'string' && p.carStyle.length <= 200 ? p.carStyle : null,
        tokenHash: HEX64.test(p.tokenHash || '') ? p.tokenHash : null,   // the player's id on the boards (public)
        badges: Array.isArray(p.badges) ? [...new Set(p.badges.filter(b => typeof b === 'string' && b.length <= 80))].slice(0, MAX_BADGES) : [],
        stats: { tracks: count(stats.tracks), circuits: count(stats.circuits), custom: count(stats.custom) },
      };
      if (JSON.stringify(profile) !== JSON.stringify(s.account.profile)) { s.account.profile = profile; changed(s.key); }
    }
    const a = s.account;
    return [200, { id: a.id, verified: verifiedOf(a.id), badges: badgesOf(a), requests: a.requests.length, online: keysOf(a.friends).filter(isOnline).length }];
  }

  function getFriends(s) {
    const a = s.account;
    const sent = [...accounts.entries()].filter(([, b]) => b.requests.includes(a.id)).map(([key]) => view(key, false));
    return [200, {
      me: view(s.key, true),
      friends: keysOf(a.friends).map(key => view(key, true)),
      requests: keysOf(a.requests).map(key => view(key, false)),
      sent,
    }];
  }

  function friendAction(s, body) {
    const id = Number(String(body.id ?? '').replace(/^#/, ''));
    const otherKey = byId.get(id), me = s.account;
    if (!Number.isSafeInteger(id) || otherKey == null) return [404, { error: 'no such player' }];
    const other = accounts.get(otherKey);
    const unlink = (a, list, x) => { a[list] = a[list].filter(y => y !== x); };
    switch (body.action) {
      case 'add':
      case 'accept':
        if (id === me.id) return [400, { error: 'that is you' }];
        if (me.friends.includes(id)) return [200, {}];
        if (me.requests.includes(id)) {            // they asked first: friends
          if (me.friends.length >= MAX_FRIENDS || other.friends.length >= MAX_FRIENDS) return [507, { error: 'too many friends' }];
          unlink(me, 'requests', id);
          unlink(other, 'requests', me.id);
          me.friends.push(id);
          other.friends.push(me.id);
          changed(s.key);
          changed(otherKey);
          return [200, { friends: true }];
        }
        if (body.action === 'accept') return [404, { error: 'no such request' }];
        if (!other.requests.includes(me.id)) {
          if (other.requests.length >= MAX_REQUESTS) return [507, { error: 'too many requests' }];
          other.requests.push(me.id);
          changed(otherKey);
        }
        return [200, { sent: true }];
      case 'decline':
        unlink(me, 'requests', id);
        break;
      case 'cancel':
        unlink(other, 'requests', me.id);
        changed(otherKey);
        break;
      case 'remove':
        unlink(me, 'friends', id);
        unlink(other, 'friends', me.id);
        changed(otherKey);
        break;
      default:
        return [400, { error: 'bad action' }];
    }
    changed(s.key);
    return [200, {}];
  }

  // a player's public card, looked up by account name (a track's author) or number
  function getPlayer(req, q) {
    const key = q.has('id') ? byId.get(Number(String(q.get('id')).replace(/^#/, ''))) : keyOf(String(q.get('name') || '').trim());
    if (key == null || !accounts.has(key)) return [404, { error: 'no such player' }];
    const a = accounts.get(key), s = sessionOf(req);
    const friend = s != null && s.account.friends.includes(a.id);
    const out = view(key, friend);
    out.stats = a.profile?.stats || null;
    out.best = a.profile?.tokenHash ? bestPlace(a.profile.tokenHash) : null;
    if (s != null) {
      out.self = s.key === key;
      out.friend = friend;
      out.requested = a.requests.includes(s.account.id);
    }
    return [200, out];
  }

  // the multiplayer server tells whose room a code is (server.js): the session handed by the game hosting it
  function hostRoom(session, code) {
    const key = typeof session === 'string' && HEX64.test(session) ? bySession.get(sha256(session)) : null;
    if (key == null) return () => {};
    rooms.set(key, code);
    return () => { if (rooms.get(key) === code) rooms.delete(key); };   // the room closed
  }

  // ---------------------------------------------------------------- http
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readJson = req => new Promise(resolve => {
    let body = '', tooBig = false;
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BLOB + 1024) { tooBig = true; req.destroy(); } });
    req.on('end', () => { try { resolve(tooBig ? null : JSON.parse(body)); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });

  // true when the request was one of ours
  function handle(req, res, url) {
    if (!url.pathname.startsWith('/account/')) return false;
    if (req.method === 'OPTIONS') {      // the game asks before sending JSON or a session
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' });
      res.end();
      return true;
    }
    if (!ready) { reply(res, 503, { error: 'accounts not loaded yet' }); return true; }
    const route = req.method + ' ' + url.pathname;
    (async () => {
      if (route === 'POST /account/register' || route === 'POST /account/login') {
        const body = await readJson(req);
        if (body == null || typeof body !== 'object') return [400, { error: 'bad request' }];
        const address = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        return route === 'POST /account/register' ? register(body, address) : login(body);
      }
      if (route === 'GET /account/player') return getPlayer(req, url.searchParams);
      const routes = ['GET /account/save', 'PUT /account/save', 'POST /account/logout', 'POST /account/presence', 'GET /account/friends', 'POST /account/friends'];
      if (!routes.includes(route)) return [404, { error: 'not found' }];
      const s = sessionOf(req);
      if (s == null) return [401, { error: 'not logged in' }];
      if (route === 'GET /account/save') return getSave(s, url.searchParams.get('have'));
      if (route === 'POST /account/logout') return logout(s);
      if (route === 'GET /account/friends') return getFriends(s);
      const body = await readJson(req);
      if (body == null || typeof body !== 'object') return [400, { error: 'bad request' }];
      if (route === 'POST /account/presence') return updatePresence(s, body);
      if (route === 'POST /account/friends') return friendAction(s, body);
      return putSave(s, body);
    })().then(([status, out]) => reply(res, status, out), e => { console.error('accounts:', e); reply(res, 500, { error: 'server error' }); });
    return true;
  }

  const storage = () => (githubToken ? 'gist' : 'file');
  return { load, handle, hostRoom, flush: () => (saveTimer != null ? saveNow() : saving), stats: () => ({ ready, accounts: accounts.size, storage: storage() }) };
}

module.exports = { createAccounts };
