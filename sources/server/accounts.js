// GoofyTrack accounts: one save per player, shared by all the PCs they play on (apex-account.js).
//
// The save is encrypted by the game with a key derived from the password, and the password itself never
// leaves the PC: the game derives two keys from it, one to encrypt, the other ("auth") to log in. This
// server only sees the second one, and keeps a scrypt hash of it. What it stores is an opaque blob, with a
// version number so that two PCs saving at once do not overwrite each other (the second gets a 409 with the
// newer save, merges it and tries again).
//
//   POST /account/register  { name, auth }           -> { name, id, verified, session, version: 0 }
//   POST /account/login     { name, auth }           -> { name, id, verified, session, version, blob, wrap, recovery }
//   GET  /account/save[?have=<version>]              -> { version, blob } (no blob when the PC already has that version)
//   PUT  /account/save      { version, blob }        -> { version }, or 409 { version, blob }
//   POST /account/logout
//
// The key of the save never changes: an account made with a password encrypts with the key derived from it, and
// once the password changes the game keeps that key "wrapped" (encrypted) with the new password's ("wrap"). A
// recovery code, made by the game and shown to the player once, wraps it too: with the code, a forgotten password
// can be replaced and the save is still read. The server only sees the wraps and the hash of each "auth":
//   POST /account/password  { auth, newAuth, wrap }          -> {}             the password, changed (session)
//   POST /account/recovery  { recoveryAuth, wrap }           -> {}             a new recovery code (session)
//   POST /account/recover   { name, recoveryAuth }           -> { wrap }       the code checked: its wrap
//   POST /account/reset     { name, recoveryAuth, auth, wrap } -> as login     a new password; every PC logged out
//   POST /account/keyname   { name }                          -> { keyName }   the name to derive the keys from (RENAMED_ACCOUNTS)
//
// Each account also has a public number (#0001, #0002... in the order they were made), by which players add
// each other as friends. Friends see each other's profile (name, flag, car), whether they are playing, and
// the invite code of the room they are in (hosting it or not), to join it in one click:
//   POST /account/presence  { profile: { nickname, countryCode, carStyle, tokenHash, tokenHashes, badges, distance, driving, vmax }, state: 'menu' | 'playing', room: code | null }
//                           -> { id, verified, badges, unlocks, requests, online[, nickname] }     every 30 s while the game runs
//                              (nickname: the name the team imposes on this account, NICKNAMES; the game renames its profile)
//   POST /account/unlock    { id, item, give }       -> { id, unlocks }    a creator gives an unlockable item (or takes it, give: false)
//   GET  /account/friends                            -> { me, friends, requests, sent }
//   POST /account/friends   { action: 'add' | 'accept' | 'decline' | 'cancel' | 'remove', id }
//   GET  /account/player?name=<account name> | ?id=<number>   -> a player's public card, no session needed
//        (with one: whether you are friends, or asked): profile, stats the game sends with its presence, best place
//        on the mod's boards. The game links a track's author to the account of that name.
// Adding someone sends them a request; adding someone who has asked first makes you friends at once.
// A hosted room comes from the multiplayer server itself (server.js): the game hosting a room says whose it is.
// A room joined comes with the presence, and only counts while the multiplayer server still has it open.
// All but register and login take the session as "Authorization: Bearer <session>".
//
// RESERVED_IDS ("julio:7777,shyn:1,chlo:2", the default) keeps numbers for some names: an account of such a name that has
// another number takes this one as the server starts, if it is free, its friends' lists and requests following
// (Julio was #0001 until 2.17, Shyn #0002; Chlo, #0003 at first, took #0002 in 2.24.1). CREATOR_IDS ("7777,1") are
// shown with the "creator" check mark.
// REMOVED_ACCOUNTS ("chloooo", the default) deletes accounts by name as the server starts, before the numbers move:
// their file in the gist (its history keeps it), their sessions, and their number in the others' friends lists and
// requests (Chloooo #0002, a second account of Chlo's, in 2.24.1).
//
// RENAMED_ACCOUNTS ("ffff:Dash", the default) renames accounts as the server starts: the account named before the colon
// is then named after it, logs in and shows by that name (the old one still logs in). The game derives the password's
// keys from the name the account was made with: the account keeps it (keyName), and the game asks for it before
// deriving them, POST /account/keyname { name } -> { keyName } (the name itself for any other name, known or not).
// Its file in the gist goes with its name (the old one deleted, its history keeps it).
//
// Badges, shown next to a player's name: 'creator' (CREATOR_IDS), 'vip' (VIP_IDS), 'p1:<trackId>', 'p2:…', 'p3:…' while the
// player holds that place on a circuit of the mod (records.js), and the counted badges, 'km:<km>', 'h:<hours>' and 'kmh:<km/h>',
// once they have driven that far, that long or that fast (vmax: tenths of km/h; it took over from topSpeed, counted before the TGV badge existed, no longer read) (COUNTED_BADGES: the game counts them, in the encrypted save, and gives the
// most of its profiles with the presence, profile.distance in metres and profile.driving in seconds; the account keeps
// the most it heard, so a badge won stays). A player picks up to two of the badges they own (the presence's
// profile.badges); others see those they still own. The presence answers with all they own.
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
const FAILED_RECOVERIES = 5;            // wrong recovery codes per name, every hour
const REGISTRATIONS = 5;                // per address, every hour
const MAX_FRIENDS = 100;
const MAX_REQUESTS = 50;                // waiting for an answer, per account
const MAX_BADGES = 2;                   // shown next to a name
const MAX_PROFILES = 8;                 // game profiles of an account counted on the boards (profile.tokenHashes)
// the counted badges (apex-account.js, COUNTED_BADGES there): id prefix -> the account's count, its unit, the tiers,
// and the most a game may say (above, it is not believed)
const COUNTED_BADGES = {
  km: { count: 'distance', unit: 1000, tiers: [500, 1000, 2500, 5000, 10000, 40075], max: 1e10 },   // metres
  h: { count: 'driving', unit: 3600, tiers: [5, 10, 25, 50, 100, 250], max: 1e9 },                   // seconds
  kmh: { count: 'vmax', unit: 10, tiers: [574.8], max: 20000 },                                      // tenths of km/h (the game's top speed)
};
// the stats a game sends with its presence, shown on the player's card (apex-account.js, publicStats), and the most
// each may say: the tracks, then what the game counts (metres, seconds, km/h, races and the sum of their places)
const STATS = { tracks: 1e6, circuits: 1e6, custom: 1e6, official: 1e6, metres: 1e11, timedMetres: 1e11, seconds: 1e10, topKmh: 1e4,
  finishes: 1e8, races: 1e7, wins: 1e7, podiums: 1e7, places: 1e9, tournaments: 1e6 };
const STATS_SAVE = 10 * 60 * 1000;      // the counts change all the time while driving: saved at most every 10 minutes, unless more changed
const ONLINE = 75 * 1000;               // since the last presence: the game sends one every 30 s
const RESERVED_IDS = new Map((process.env.RESERVED_IDS ?? 'julio:7777,shyn:1,chlo:2').split(',').filter(Boolean)
  .map(pair => pair.split(':')).map(([name, id]) => [name.normalize('NFC').toLowerCase(), Number(id)]));
const REMOVED_ACCOUNTS = new Set((process.env.REMOVED_ACCOUNTS ?? 'chloooo').split(',').filter(Boolean).map(name => name.normalize('NFC').toLowerCase()));
const RENAMED_ACCOUNTS = new Map((process.env.RENAMED_ACCOUNTS ?? 'ffff:Dash').split(',').filter(Boolean)
  .map(pair => pair.split(':')).map(([from, to]) => [from.normalize('NFC').toLowerCase(), String(to || '').trim()]).filter(([, to]) => to));
const CREATOR_IDS = new Set((process.env.CREATOR_IDS ?? '7777,1').split(',').filter(Boolean).map(Number));
// the VIP diamond: friends and the first players, by number (#0003 is 3); "2,3" by default: Chlo and Dash
const VIP_IDS = new Set((process.env.VIP_IDS ?? '2,3').split(',').filter(Boolean).map(Number));
// The garage's unlockable items (apex-rarity.js, `unlock`): the icons, won in tournaments and events. UNLOCKS gives
// them to accounts by number, "mp4_7a:7777+42,other:…" (by default the McLaren and the Renault to Julio and Dany, the Renault
// to Dash #0003 too); a creator gives or takes
// one with POST /account/unlock { id, item, give }, kept with the account (unlocks). The presence says which a player owns.
const UNLOCKABLES = ['mp4_7a', 'r26'];
const UNLOCKS = new Map((process.env.UNLOCKS ?? 'mp4_7a:7777+1,r26:7777+1+3').split(',').filter(Boolean)
  .map(pair => pair.split(':')).map(([item, ids]) => [item, new Set((ids || '').split('+').filter(Boolean).map(Number))]));
// The name shown, imposed by number: "3:Dash" by default (fff, account "ffff", renamed Dash in 2.25: RENAMED_ACCOUNTS).
// The presence answers with this one and the game renames its profile to it, so the boards follow at the next record.
const NICKNAMES = new Map((process.env.NICKNAMES ?? '3:Dash').split(',').filter(Boolean)
  .map(pair => pair.split(':')).map(([id, name]) => [Number(id), String(name || '').trim().slice(0, 32)]).filter(([, name]) => name));
const COUNTRY = /^[a-z]{2}$/i;
// the frames a player can put around their car (apex-account.js, FRAMES there): the badges one of which it needs
// (by kind: 'p1' for any P1 badge), or null for the colours anyone picks
const FRAMES = {
  red: null, white: null, orange: null, blue: null, green: null, purple: null, pink: null,
  bronze: ['p1', 'p2', 'p3'], silver: ['p1', 'p2'], gold: ['p1'], creator: ['creator'], vip: ['vip'],
};

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
  const statsSaved = new Map();         // key -> when the account was last saved for its stats alone
  const rooms = new Map();              // key -> invite code of the room the player hosts
  const dirty = new Set();
  let ready = false, saveTimer = null, saving = Promise.resolve();
  const failedLogins = limiter(FAILED_LOGINS, 15 * 60 * 1000);
  const failedRecoveries = limiter(FAILED_RECOVERIES, 60 * 60 * 1000);
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
    // accounts removed (REMOVED_ACCOUNTS): first, so that their number is free for a reserved one
    for (const key of REMOVED_ACCOUNTS) {
      const a = accounts.get(key);
      if (a == null) continue;
      accounts.delete(key);
      if (byId.get(a.id) === key) byId.delete(a.id);
      for (const s of a.sessions) bySession.delete(s);
      changed(key);        // saveNow deletes its file
      for (const [other, b] of accounts) {
        if (!b.friends.includes(a.id) && !b.requests.includes(a.id)) continue;
        b.friends = b.friends.filter(f => f !== a.id);
        b.requests = b.requests.filter(r => r !== a.id);
        changed(other);
      }
      log(`accounts: ${a.name} #${a.id} removed`);
    }
    // accounts renamed (RENAMED_ACCOUNTS): under their new name, keeping the one their keys come from
    for (const [from, to] of RENAMED_ACCOUNTS) {
      const a = accounts.get(from), key = keyOf(to);
      if (a == null || !NAME.test(to) || accounts.has(key)) continue;
      a.keyName ??= a.name;
      const old = a.name;
      a.name = to;
      accounts.delete(from);
      accounts.set(key, a);
      if (byId.get(a.id) === from) byId.set(a.id, key);
      for (const h of a.sessions) bySession.set(h, key);
      changed(from);       // saveNow deletes its old file
      changed(key);
      log(`accounts: ${old} #${a.id} renamed ${to}`);
    }
    // reserved numbers changed since the accounts were made: they move, and every list that holds the old one
    for (const [key, id] of RESERVED_IDS) {
      const a = accounts.get(key);
      if (a == null || a.id === id || byId.has(id)) continue;
      const old = a.id;
      byId.delete(old);
      byId.set(id, key);
      a.id = id;
      changed(key);
      for (const [other, b] of accounts) {
        if (!b.friends.includes(old) && !b.requests.includes(old)) continue;
        b.friends = b.friends.map(f => (f === old ? id : f));
        b.requests = b.requests.map(r => (r === old ? id : r));
        changed(other);
      }
      log(`accounts: ${a.name} renumbered #${old} -> #${id}`);
    }
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
        // an account no longer there (REMOVED_ACCOUNTS): its file goes (null deletes a file of a gist)
        for (const key of keys) files[fileOf(key)] = accounts.has(key) ? { content: JSON.stringify(accounts.get(key)) } : null;
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
    if (name.toLowerCase() === 'anonymous') return [400, { error: 'anonymous' }];   // the game's name for a new profile (2.24)
    if (registrations.over(address)) return [429, { error: 'too many accounts' }];
    const key = keyOf(name);
    if (accounts.has(key) || REMOVED_ACCOUNTS.has(key) || RENAMED_ACCOUNTS.has(key)) return [409, { error: 'name taken' }];   // a removed one would go at the next start
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
    const key = keyFor(name), account = accounts.get(key);
    if (failedLogins.over(key)) return [429, { error: 'too many attempts' }];
    // same answer, and about the same time, for an unknown name and a wrong password
    const hash = await scrypt(body.auth, account ? account.salt : '0'.repeat(32));
    if (account == null || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.hash, 'hex'))) {
      failedLogins.hit(key);
      return [403, { error: 'wrong name or password' }];
    }
    return loggedIn(key);
  }
  // the account a name logs into: its own, or the one it was renamed (RENAMED_ACCOUNTS)
  function keyFor(name) {
    const key = keyOf(name);
    if (accounts.has(key) || !RENAMED_ACCOUNTS.has(key)) return key;
    return keyOf(RENAMED_ACCOUNTS.get(key));
  }
  // the name an account's keys are derived from (unknown names: themselves, as for any account never renamed)
  function keyName(body) {
    const name = String(body.name || '').trim();
    if (!NAME.test(name)) return [400, { error: 'bad request' }];
    const account = accounts.get(keyFor(name));
    return [200, { keyName: account?.keyName ?? name }];
  }
  const loggedIn = key => {
    const account = accounts.get(key);
    return [200, { name: account.name, keyName: account.keyName ?? account.name, id: account.id, verified: verifiedOf(account.id), session: newSession(key), version: account.version, blob: account.blob,
      wrap: account.wrap ?? null, recovery: account.recovery != null }];
  };

  // ---------------------------------------------------------------- password and recovery code
  const WRAP = /^[A-Za-z0-9+/=]{40,200}$/;     // a 32-byte key, encrypted (iv + key + tag), in base64
  const authMatches = async (auth, salt, hash) => crypto.timingSafeEqual(Buffer.from(await scrypt(auth, salt), 'hex'), Buffer.from(hash, 'hex'));
  async function setPassword(account, auth, wrap) {
    account.salt = crypto.randomBytes(16).toString('hex');
    account.hash = await scrypt(auth, account.salt);
    account.wrap = wrap;
  }

  async function changePassword(s, body) {
    if (!HEX64.test(body.auth || '') || !HEX64.test(body.newAuth || '') || !WRAP.test(body.wrap || '')) return [400, { error: 'bad request' }];
    if (failedLogins.over(s.key)) return [429, { error: 'too many attempts' }];
    if (!await authMatches(body.auth, s.account.salt, s.account.hash)) { failedLogins.hit(s.key); return [403, { error: 'wrong password' }]; }
    await setPassword(s.account, body.newAuth, body.wrap);
    changed(s.key);
    log(`accounts: ${s.account.name} changed their password`);
    return [200, {}];
  }

  async function setRecovery(s, body) {
    if (!HEX64.test(body.recoveryAuth || '') || !WRAP.test(body.wrap || '')) return [400, { error: 'bad request' }];
    const salt = crypto.randomBytes(16).toString('hex');
    s.account.recovery = { salt, hash: await scrypt(body.recoveryAuth, salt), wrap: body.wrap, made: new Date().toISOString() };
    changed(s.key);
    return [200, {}];
  }

  // the recovery code of that account, checked: same answer for an unknown name, no code, a wrong code
  async function recoveryOf(body) {
    const name = String(body.name || '').trim();
    if (!NAME.test(name) || !HEX64.test(body.recoveryAuth || '')) return { error: [400, { error: 'bad request' }] };
    const key = keyFor(name), account = accounts.get(key), r = account?.recovery;
    if (failedRecoveries.over(key)) return { error: [429, { error: 'too many attempts' }] };
    const ok = await authMatches(body.recoveryAuth, r ? r.salt : '0'.repeat(32), r ? r.hash : '0'.repeat(64));
    if (!ok || r == null) { failedRecoveries.hit(key); return { error: [403, { error: 'wrong name or code' }] }; }
    return { key, account };
  }
  async function recover(body) {
    const { error, account } = await recoveryOf(body);
    return error ?? [200, { wrap: account.recovery.wrap }];
  }
  async function reset(body) {
    if (!HEX64.test(body.auth || '') || !WRAP.test(body.wrap || '')) return [400, { error: 'bad request' }];
    const { error, key, account } = await recoveryOf(body);
    if (error) return error;
    await setPassword(account, body.auth, body.wrap);
    for (const h of account.sessions) bySession.delete(h);     // whoever had the old password is logged out
    account.sessions = [];
    presence.delete(key);
    changed(key);
    log(`accounts: ${account.name} reset their password with their recovery code`);
    return loggedIn(key);
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
  // the account's game profiles on the boards: the one played and the others of its save (profile.tokenHashes), so a
  // place made with any of them counts, on any PC
  const hashesOf = a => [...new Set([a.profile?.tokenHash, ...(a.profile?.tokenHashes || [])].filter(Boolean))];
  // their podiums together: the best place on each circuit
  const podiumOfAccount = a => {
    const best = new Map();
    for (const h of hashesOf(a)) for (const p of podium(h)) if (!(best.get(p.trackId) <= p.position)) best.set(p.trackId, p.position);
    return [...best].map(([trackId, position]) => ({ trackId, position })).sort((x, y) => x.position - y.position);
  };
  const bestPlaceOfAccount = a => hashesOf(a).map(h => bestPlace(h, a.profile.bestTrack)).filter(Boolean)
    .reduce((b, p) => (b == null || p.position < b.position || (p.position === b.position && p.trackId === a.profile.bestTrack) ? p : b), null);
  // the badges a player owns now
  const badgesOf = a => [...(CREATOR_IDS.has(a.id) ? ['creator'] : []), ...(VIP_IDS.has(a.id) ? ['vip'] : []), ...podiumOfAccount(a).map(p => 'p' + p.position + ':' + p.trackId),
    ...Object.entries(COUNTED_BADGES).flatMap(([kind, c]) => c.tiers.filter(n => (a[c.count] || 0) >= n * c.unit).map(n => kind + ':' + n))];
  // the frame picked, if the badges it needs are still owned (else none: the game shows its default)
  const frameOf = a => {
    const needs = FRAMES[a.profile?.frame];
    if (needs === undefined) return null;
    return needs == null || badgesOf(a).some(b => needs.includes(b.split(':')[0])) ? a.profile.frame : null;
  };
  // the unlockable items a player owns
  const unlocksOf = a => UNLOCKABLES.filter(item => UNLOCKS.get(item)?.has(a.id) || (a.unlocks || []).includes(item));
  // a creator gives an item to a player, or takes it back (those of UNLOCKS stay)
  function giveUnlock(s, body) {
    if (!CREATOR_IDS.has(s.account.id)) return [403, { error: 'creators only' }];
    const key = byId.get(Number(body.id)), item = String(body.item || '');
    if (key == null) return [404, { error: 'no such player' }];
    if (!UNLOCKABLES.includes(item)) return [400, { error: 'no such item' }];
    const a = accounts.get(key), had = a.unlocks || [];
    a.unlocks = body.give === false ? had.filter(i => i !== item) : [...new Set([...had, item])];
    if (a.unlocks.length === 0) delete a.unlocks;
    changed(key);
    log(`accounts: #${s.account.id} ${body.give === false ? 'took' : 'gave'} ${item} ${body.give === false ? 'from' : 'to'} #${a.id}`);
    return [200, { id: a.id, unlocks: unlocksOf(a) }];
  }
  const isOnline = key => Date.now() - (presence.get(key)?.time ?? 0) < ONLINE;
  // the room a player is in: the one they host, or the one they said they joined if it is still open
  const roomOf = key => rooms.get(key) ?? (roomOpen(presence.get(key)?.room) ? presence.get(key).room : null);
  // what a player shows to others; the room's code only to friends
  function view(key, friend) {
    const a = accounts.get(key), p = a.profile || {}, online = isOnline(key), room = online ? roomOf(key) : null;
    const out = {
      id: a.id, name: a.name, verified: verifiedOf(a.id),
      badges: (p.badges || []).filter(b => badgesOf(a).includes(b)),   // those picked, still owned
      frame: frameOf(a),
      nickname: NICKNAMES.get(a.id) || p.nickname || a.name, countryCode: p.countryCode || null, carStyle: p.carStyle || null,
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
      const count = (n, max = 1e6) => (Number.isSafeInteger(n) && n >= 0 && n < max ? n : null);
      const stats = p.stats && typeof p.stats === 'object' ? p.stats : {};
      const profile = {
        nickname: NICKNAMES.get(s.account.id) || String(p.nickname || '').trim().slice(0, 32) || null,
        countryCode: COUNTRY.test(p.countryCode || '') ? p.countryCode : null,
        carStyle: typeof p.carStyle === 'string' && p.carStyle.length <= 200 ? p.carStyle : null,
        tokenHash: HEX64.test(p.tokenHash || '') ? p.tokenHash : null,   // the player's id on the boards (public)
        tokenHashes: Array.isArray(p.tokenHashes) ? [...new Set(p.tokenHashes.filter(h => HEX64.test(h || '')))].slice(0, MAX_PROFILES) : [],   // the account's other profiles
        badges: Array.isArray(p.badges) ? [...new Set(p.badges.filter(b => typeof b === 'string' && b.length <= 80))].slice(0, MAX_BADGES) : [],
        bestTrack: HEX64.test(p.bestTrack || '') ? p.bestTrack : null,   // the best place shown, when tied on several circuits
        frame: Object.hasOwn(FRAMES, p.frame) ? p.frame : null,          // the ring around the car (shown while allowed: view)
        stats: Object.fromEntries(Object.entries(STATS).map(([k, max]) => [k, count(stats[k], max)])),
      };
      const before = s.account.profile;
      if (JSON.stringify(profile) !== JSON.stringify(before)) {
        s.account.profile = profile;   // shown at once; saved now if more than the stats changed
        const rest = p => JSON.stringify({ ...p, stats: null });
        if (before == null || rest(profile) !== rest(before) || Date.now() - (statsSaved.get(s.key) ?? 0) > STATS_SAVE) {
          statsSaved.set(s.key, Date.now());
          changed(s.key);
        }
      }
      // the counted badges: the most the game gave, kept
      for (const c of Object.values(COUNTED_BADGES)) {
        const n = Number(p[c.count]);
        if (Number.isFinite(n) && n > (s.account[c.count] || 0) && n < c.max) { s.account[c.count] = Math.floor(n); changed(s.key); }
      }
    }
    const a = s.account;
    return [200, { id: a.id, name: a.name, keyName: a.keyName ?? a.name, verified: verifiedOf(a.id), badges: badgesOf(a), unlocks: unlocksOf(a), requests: a.requests.length, online: keysOf(a.friends).filter(isOnline).length, recovery: a.recovery != null,
      ...(NICKNAMES.has(a.id) ? { nickname: NICKNAMES.get(a.id) } : {}) }];
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
    out.best = bestPlaceOfAccount(a);
    if (s != null) {
      out.self = s.key === key;
      out.friend = friend;
      out.requested = a.requests.includes(s.account.id);
      out.asked = s.account.requests.includes(a.id);   // they asked first: adding them makes you friends
    }
    return [200, out];
  }

  // the account number of a session when it is a creator's (CREATOR_IDS), else null: the special tournaments and
  // rooms (tournaments.js, server.js) are theirs only
  function creatorOf(session) {
    const key = typeof session === 'string' && HEX64.test(session) ? bySession.get(sha256(session)) : null, a = key == null ? null : accounts.get(key);
    return a != null && CREATOR_IDS.has(a.id) ? a.id : null;
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
      if (['POST /account/register', 'POST /account/login', 'POST /account/recover', 'POST /account/reset', 'POST /account/keyname'].includes(route)) {
        const body = await readJson(req);
        if (body == null || typeof body !== 'object') return [400, { error: 'bad request' }];
        const address = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (route === 'POST /account/keyname') return keyName(body);
        if (route === 'POST /account/recover') return recover(body);
        if (route === 'POST /account/reset') return reset(body);
        return route === 'POST /account/register' ? register(body, address) : login(body);
      }
      if (route === 'GET /account/player') return getPlayer(req, url.searchParams);
      const routes = ['GET /account/save', 'PUT /account/save', 'POST /account/logout', 'POST /account/presence', 'GET /account/friends', 'POST /account/friends',
        'POST /account/password', 'POST /account/recovery', 'POST /account/unlock'];
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
      if (route === 'POST /account/password') return changePassword(s, body);
      if (route === 'POST /account/recovery') return setRecovery(s, body);
      if (route === 'POST /account/unlock') return giveUnlock(s, body);
      return putSave(s, body);
    })().then(([status, out]) => reply(res, status, out), e => { console.error('accounts:', e); reply(res, 500, { error: 'server error' }); });
    return true;
  }

  const storage = () => (githubToken ? 'gist' : 'file');
  return { load, handle, hostRoom, creatorOf, flush: () => (saveTimer != null ? saveNow() : saving), stats: () => ({ ready, accounts: accounts.size, storage: storage() }) };
}

module.exports = { createAccounts };
