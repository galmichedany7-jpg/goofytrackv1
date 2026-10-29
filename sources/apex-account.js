// GoofyTrack account: the game's save (profiles, records and their ghosts, custom tracks, settings) follows
// the player from PC to PC, kept by the GoofyTrack server (server/accounts.js).
//
// The save is encrypted here, with a key derived from the password: the server only keeps an opaque blob,
// and never sees the password, the PolyTrack tokens or anything else of the save. The other half of the
// derived key logs in. The key stays the first password's: a new password, or a recovery code made in the
// account's Security, keeps it wrapped (wrapKey), so a forgotten password is replaced with the code.
//
// The save is a set of entries, one per profile (by token), record (by player, mode and track), custom
// track (by name) and setting, each with the time it last changed; a deleted one stays as a null entry
// so that the deletion reaches the other PCs. Two saves merge entry by entry: the best time of a record,
// the latest of anything else. The game's storage is watched (Storage.prototype.setItem) to know when
// and what changes, and the merge goes both ways:
//   - while the game starts: patch_bundle.js has the game wait for ready() (8 s at most, the server may be
//     asleep) after reading its storage format and before reading the save, which gets the account's;
//   - a few seconds after anything synced changes: the save is sent, merged first with the account's.
// The PolyTrack profiles live in 3 slots per PC: a profile of the account takes a free slot, and its
// records the slot of their profile.
//
// The profile picked in the game shows as a badge at the top left of the home screen: its car as the game
// draws it in the leaderboards (redrawn when it changes in the garage), its flag and name, the account's
// state. A click opens the profile card: a few stats from the save and the GoofyTrack server, the account.
//
// build.js puts the server address in window.GOOFY_SERVER and the mod's tracks in window.GOOFY_MOD_TRACKS,
// in front of this script. Display only besides the save, not part of the build fingerprint: the styles live here.
(() => {
  'use strict';

  const SERVER = String(window.GOOFY_SERVER || 'https://goofytrack.onrender.com/');
  const MOD_TRACKS = Array.isArray(window.GOOFY_MOD_TRACKS) ? window.GOOFY_MOD_TRACKS : [];   // [{ id, name }]
  // the official tracks: the game's own (build.js reads them from the game) and the mod's circuits
  const OFFICIAL_TRACKS = [...(Array.isArray(window.GOOFY_GAME_TRACKS) ? window.GOOFY_GAME_TRACKS : []), ...MOD_TRACKS.map(t => t.id)];
  const ACCOUNT_KEY = 'goofytrack.account';
  const THUMB_KEY = 'goofytrack.profile.thumbnail';   // { style, url } the badge's last car, shown at once on the next start
  const META_KEY = 'goofytrack.account.times';        // entry id -> time it last changed on this PC (negative: deleted), logged in or not
  const GAME = 'polytrack_v5_prod_';
  const PROFILES = 3;                                  // the game's slots
  const SETTINGS = [GAME + 'settings', GAME + 'key_bindings', GAME + 'is_music_enabled', GAME + 'unlocked_car_styles',
    'goofytrack_ambiance', 'goofytrack.minimapHidden', 'goofytrack.raceSettings', 'goofytrack.liveries', 'goofytrack.badges', 'goofytrack.badgesSeen', 'goofytrack.bestPlace', 'goofytrack.frame'];   // not the keyboard layout: one per PC
  const STATS_PREFIX = 'goofytrack.stats.';           // + this PC's id: what it counted (synced: one entry per PC, summed)
  const PC_KEY = 'goofytrack.pc';                     // this PC's id (not synced)
  const KDF_ROUNDS = 310000;
  // the game waits this long for the account's save as it starts: the free server sleeps and takes far longer to
  // wake, so past this the game starts on this PC's save, and a save that comes later offers to reload
  const BOOT_WAIT = 3000;
  const PUSH_DELAY = 4000;

  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  // ---------------------------------------------------------------- storage, watched
  const storage = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  let applying = false;          // our own writes: not changes made on this PC
  let reloading = false;         // the save was just written: the game must not put back what it has in memory
  const get = key => { try { return storage.getItem(key); } catch (e) { return null; } };
  const set = (key, value) => { applying = true; try { rawSet.call(storage, key, value); } finally { applying = false; } watched(key); };
  const remove = key => { applying = true; try { rawRemove.call(storage, key); } finally { applying = false; } watched(key); };
  // the profile badge follows the profile picked, its name, flag and car (garage)
  const watched = key => { if (String(key).startsWith(GAME + 'user')) scheduleBadge(); };
  const readJson = key => { try { return JSON.parse(get(key)); } catch (e) { return null; } };

  let account = readJson(ACCOUNT_KEY);    // { name, session, key } of the account logged in
  if (account == null || typeof account !== 'object' || !account.session || !account.key) account = null;
  let times = readJson(META_KEY) || {};
  const saveTimes = () => { try { rawSet.call(storage, META_KEY, JSON.stringify(times)); } catch (e) { /* storage full */ } };
  const saveAccount = () => { try { if (account) rawSet.call(storage, ACCOUNT_KEY, JSON.stringify(account)); else rawRemove.call(storage, ACCOUNT_KEY); } catch (e) { /* storage unavailable */ } };

  // game key (+ its value) -> entry id, or null when the key is not synced
  function idOf(key, value) {
    if (SETTINGS.includes(key) || key.startsWith(STATS_PREFIX)) return 's:' + key;
    if (!key.startsWith(GAME)) return null;
    const rest = key.slice(GAME.length);
    if (rest.startsWith('track_')) return 't:' + rest.slice(6);
    let m = /^user_(\d)$/.exec(rest);
    if (m) { const p = parse(value); return p && typeof p.token === 'string' ? 'p:' + p.token : null; }
    m = /^record_\d+_(default|undeterministic)_([0-9a-f]{64})$/.exec(rest);
    if (m) { const r = parse(value); return r && typeof r.tokenHash === 'string' ? `r:${r.tokenHash}:${m[1]}:${m[2]}` : null; }
    return null;
  }
  function parse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  function touched(key, oldValue, newValue) {
    const now = Date.now();
    const oldId = oldValue == null ? null : idOf(key, oldValue), newId = newValue == null ? null : idOf(key, newValue);
    if (oldId == null && newId == null) return;
    if (oldId != null && oldId !== newId) times[oldId] = -now;   // negative: deleted at that time
    if (newId != null) times[newId] = now;
    saveTimes();
    schedulePush();
  }
  const frozen = (key, value) => reloading && idOf(String(key), value ?? storage.getItem(key)) != null;
  Storage.prototype.setItem = function (key, value) {
    if (this !== storage || applying) return rawSet.call(this, key, value);
    if (frozen(key, String(value))) return;
    const old = this.getItem(key);
    rawSet.call(this, key, value);
    if (old !== String(value)) { touched(String(key), old, String(value)); watched(key); }
  };
  Storage.prototype.removeItem = function (key) {
    if (this !== storage || applying) return rawRemove.call(this, key);
    if (frozen(key, null)) return;
    const old = this.getItem(key);
    rawRemove.call(this, key);
    if (old != null) { touched(String(key), old, null); watched(key); }
  };
  const reload = () => { reloading = true; location.reload(); };

  // ---------------------------------------------------------------- the save
  // entries: id -> { v: value or null (deleted), t: time }
  async function localSave() {
    const entries = {};
    for (const [id, t] of Object.entries(times)) if (t < 0) entries[id] = { v: null, t: -t };
    for (const key of Object.keys(storage)) {
      const value = get(key), id = idOf(key, value);
      if (id == null) continue;
      let t = times[id] > 0 ? times[id] : 0;
      if (id.startsWith('t:')) t = Math.max(t, Number(parse(value)?.saveTime) || 0);
      entries[id] = { v: value, t };
    }
    return entries;
  }

  const framesOf = entry => Number(parse(entry.v)?.frames) || Infinity;
  // the account's save first: it wins a tie (a setting this PC never changed, say)
  function merge(cloud, local) {
    const out = { ...cloud };
    for (const [id, l] of Object.entries(local)) {
      const c = out[id];
      if (c == null) out[id] = l;
      else if (id.startsWith('r:') && c.v != null && l.v != null) {
        // the best time; the same time sent again to a leaderboard (a new upload id) keeps its latest copy
        const lf = framesOf(l), cf = framesOf(c);
        if (lf < cf || (lf === cf && l.t > c.t && l.v !== c.v)) out[id] = { v: l.v, t: Math.max(l.t, c.t) };
      }
      else if (l.t > c.t) out[id] = l;
    }
    return out;
  }

  const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));   // = the game's tokenHash

  // writes the save into the game's storage -> what changed: { records, other }
  async function apply(entries) {
    const changed = { records: 0, other: 0 };
    const write = (key, value, kind) => {
      if (get(key) === value) return;
      if (value == null) remove(key); else set(key, value);
      changed[kind]++;
    };
    // profiles: in the slot they have here, or a free one
    const slotOf = new Map();
    for (let slot = 0; slot < PROFILES; slot++) {
      const token = parse(get(GAME + 'user_' + slot))?.token;
      if (typeof token === 'string') slotOf.set(token, slot);
    }
    const profiles = Object.entries(entries).filter(([id]) => id.startsWith('p:'));
    for (const [id, e] of profiles) {          // deletions first: they free slots
      const token = id.slice(2);
      if (e.v == null && slotOf.has(token)) { write(GAME + 'user_' + slotOf.get(token), null, 'other'); slotOf.delete(token); }
    }
    for (const [id, e] of profiles) {
      const token = id.slice(2);
      if (e.v == null) continue;
      let slot = slotOf.get(token);
      if (slot == null) {
        const used = new Set(slotOf.values());
        slot = [0, 1, 2].find(s => !used.has(s) && get(GAME + 'user_' + s) == null);
        if (slot == null) continue;        // no room here: it stays in the account
        slotOf.set(token, slot);
      }
      write(GAME + 'user_' + slot, e.v, 'other');
    }
    const slotOfHash = new Map();
    for (const [token, slot] of slotOf) slotOfHash.set(await sha256(token), slot);
    const selected = Number(get(GAME + 'user_slot'));
    if (slotOf.size && ![...slotOf.values()].includes(selected)) write(GAME + 'user_slot', String(Math.min(...slotOf.values())), 'other');

    for (const [id, e] of Object.entries(entries)) {
      if (id.startsWith('r:')) {
        const [, hash, mode, track] = id.split(':');
        const slot = slotOfHash.get(hash);
        if (slot != null) write(`${GAME}record_${slot}_${mode}_${track}`, e.v, 'records');
      } else if (id.startsWith('t:')) write(GAME + 'track_' + id.slice(2), e.v, 'other');
      else if (id.startsWith('s:')) write(id.slice(2), e.v, 'other');
    }
    return changed;
  }

  // ---------------------------------------------------------------- encryption
  const toBase64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  // password -> { key: AES key (base64), auth: what logs in (hex) }
  async function deriveKeys(name, password) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ROUNDS,
      salt: new TextEncoder().encode('goofytrack-account:' + name.normalize('NFC').toLowerCase()) }, material, 512));
    return { key: toBase64(bits.subarray(0, 32)), auth: hex(bits.subarray(32)) };
  }
  const aesKey = base64 => crypto.subtle.importKey('raw', fromBase64(base64), 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function encrypt(entries, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const packed = await pipe(new TextEncoder().encode(JSON.stringify({ format: 1, entries })), new CompressionStream('gzip'));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), packed));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv);
    out.set(sealed, 12);
    return toBase64(out);
  }
  async function decrypt(blob, key) {
    if (blob == null) return {};
    const bytes = fromBase64(blob);
    let packed;
    try { packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await aesKey(key), bytes.subarray(12)); }
    catch (e) { throw new Error(tr('La sauvegarde du compte ne se déchiffre pas avec ce mot de passe.', 'The account\'s save does not decrypt with this password.')); }
    const save = JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('gzip'))));
    return save && save.entries && typeof save.entries === 'object' ? save.entries : {};
  }

  // The key of the save never changes (the one of the first password): a new password or a recovery code keeps
  // it "wrapped", encrypted with their own derived key (server/accounts.js). wrap: base64 of iv + sealed key.
  async function wrapKey(wrapper, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(wrapper), fromBase64(key)));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv);
    out.set(sealed, 12);
    return toBase64(out);
  }
  async function unwrapKey(wrapper, wrap) {
    const bytes = fromBase64(wrap);
    return toBase64(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await aesKey(wrapper), bytes.subarray(12))));
  }
  // recovery code: 20 characters easy to copy (no 0/O, 1/I/L), in five groups, about 100 bits
  const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newRecoveryCode = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => CODE_LETTERS[b % CODE_LETTERS.length])
    .join('').replace(/(.{4})(?!$)/g, '$1-');
  const codeText = text => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const recoveryKeys = (name, code) => deriveKeys(name, 'goofytrack-recovery:' + codeText(code));

  // ---------------------------------------------------------------- server
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  async function call(method, path, body, session) {
    const headers = {};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = 'Bearer ' + session;
    let res;
    try { res = await fetch(SERVER + path.replace(/^\//, ''), { method, headers, body: body == null ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new HttpError(0, tr('Serveur injoignable (pas d\'internet ?).', 'Server unreachable (no internet?).')); }
    const out = await res.json().catch(() => ({}));
    if (res.status === 409 && out.version != null) return { conflict: true, ...out };
    if (!res.ok) throw new HttpError(res.status, messageOf(res.status, out.error));
    return out;
  }
  function messageOf(status, error) {
    if (status === 403) return tr('Pseudo ou mot de passe incorrect.', 'Wrong name or password.');
    if (status === 409) return tr('Ce pseudo est déjà pris.', 'This name is taken.');
    if (status === 429) return tr('Trop d\'essais, réessayez dans quelques minutes.', 'Too many attempts, try again in a few minutes.');
    if (status === 401) return tr('Session expirée : reconnectez-vous.', 'Session expired: log in again.');
    if (status === 503) return tr('Le serveur démarre, réessayez dans un instant.', 'The server is starting, try again in a moment.');
    return tr('Erreur du serveur', 'Server error') + ` (${status}${error ? ', ' + error : ''})`;
  }

  // ---------------------------------------------------------------- sync
  let cloud = null;              // { version, entries } last seen on the server
  let syncing = null, pushTimer = null, lastSync = null, lastError = null, booting = false;

  function schedulePush() {
    if (account == null) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync().catch(() => {}), PUSH_DELAY);
  }

  // account save <-> this PC: pull, merge, write here, send the merge when it adds anything
  function sync() {
    if (syncing) return syncing.catch(() => {}).then(() => sync());
    syncing = (async () => {
      const acc = account;
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          if (cloud == null || attempt > 0) {
            const got = await call('GET', '/account/save' + (cloud ? '?have=' + cloud.version : ''), null, acc.session);
            if (got.blob !== undefined || cloud == null) cloud = { version: got.version, entries: await decrypt(got.blob, acc.key) };
          }
          const merged = merge(cloud.entries, await localSave());
          const changed = await apply(merged);
          // the mod's scripts read their settings before the game starts: read them again
          if (changed.other) window.dispatchEvent(new Event('apex-account-save'));
          if (!booting && changed.other) notify(tr('Sauvegarde récupérée depuis un autre PC.', 'Save received from another PC.'), true);
          if (JSON.stringify(merged) === JSON.stringify(cloud.entries)) break;
          const put = await call('PUT', '/account/save', { version: cloud.version, blob: await encrypt(merged, acc.key) }, acc.session);
          if (put.conflict) { cloud = { version: put.version, entries: await decrypt(put.blob, acc.key) }; continue; }
          cloud = { version: put.version, entries: merged };
          break;
        }
        lastSync = Date.now();
        lastError = null;
      } catch (e) {
        lastError = e.message;
        if (e.status === 401 && account === acc) { account = null; cloud = null; saveAccount(); }
        throw e;
      } finally {
        syncing = null;
        refresh();
      }
    })();
    return syncing;
  }

  // the game waits for this before reading its save (patch_bundle.js)
  function ready() {
    if (account == null) return Promise.resolve();
    booting = true;
    const done = sync().catch(e => console.warn('GoofyTrack account:', e.message));
    return Promise.race([done, new Promise(resolve => setTimeout(resolve, BOOT_WAIT))]).finally(() => { booting = false; sendPresence(); });
  }

  // a fresh PC has a profile of its own, made by the game, with no record: it makes way for the account's
  async function dropEmptyProfiles(cloudEntries) {
    if (!Object.keys(cloudEntries).some(id => id.startsWith('p:') && cloudEntries[id].v != null)) return;
    const local = await localSave();
    for (let slot = 0; slot < PROFILES; slot++) {
      const token = parse(get(GAME + 'user_' + slot))?.token;
      if (typeof token !== 'string' || cloudEntries['p:' + token]) continue;
      const hash = await sha256(token);
      if (!Object.keys(local).some(id => id.startsWith('r:' + hash + ':'))) remove(GAME + 'user_' + slot);
    }
  }

  async function logIn(name, password, create) {
    name = name.trim();
    const keys = await deriveKeys(name, password);
    const out = await call('POST', create ? '/account/register' : '/account/login', { name, auth: keys.auth });
    // the save's key: the password's own, or the one it wraps since the password changed
    await enter(out, out.wrap ? await unwrapKey(keys.key, out.wrap) : keys.key, create);
  }
  // a forgotten password replaced with the recovery code: its wrap gives the save's key, wrapped then with the new
  // password; the account's other PCs are logged out
  async function recoverAccount(name, code, password) {
    name = name.trim();
    const rk = await recoveryKeys(name, code);
    const { wrap } = await call('POST', '/account/recover', { name, recoveryAuth: rk.auth });
    const key = await unwrapKey(rk.key, wrap);
    const keys = await deriveKeys(name, password);
    const out = await call('POST', '/account/reset', { name, recoveryAuth: rk.auth, auth: keys.auth, wrap: await wrapKey(keys.key, key) });
    await enter(out, key, false);
  }
  async function enter(out, key, create) {
    const cloudEntries = create ? {} : await decrypt(out.blob, key);   // a wrong key fails here, before anything changes
    if (!create) await dropEmptyProfiles(cloudEntries);
    account = { name: out.name, id: out.id, verified: out.verified, session: out.session, key, recovery: !!out.recovery };
    cloud = { version: out.version, entries: cloudEntries };
    saveAccount();
    booting = true;                // no "reload" notice: it reloads right after
    try { await sync(); } finally { booting = false; }   // this PC's save merged into the account's, and back
    reload();                      // the game reads its profiles and settings once, as it starts
  }

  async function logOut() {
    const acc = account;
    account = null;
    cloud = null;
    saveAccount();
    clearTimeout(pushTimer);
    refresh();
    try { await call('POST', '/account/logout', {}, acc.session); } catch (e) { /* the session expires with the account's others */ }
  }

  // ---------------------------------------------------------------- friends
  // Each account has a public number (#0001...), by which players add each other. While the game runs, it
  // tells the server every 30 s that the player is here, with the profile picked (name, flag, car) for
  // their friends to see, and the room they are in (apex-lobby.js): friends can join it, hosted or not.
  const PRESENCE_EVERY = 30000;
  let social = { requests: 0, online: 0 };     // from the last presence: requests waiting, friends online
  const idText = id => '#' + String(id).padStart(4, '0');

  async function sendPresence() {
    const acc = account;
    if (acc == null) return;
    const p = currentProfile();
    try {
      // with the stats of the profile card, shown to whoever opens the player's card (a track's author)
      const s = p && await profileStats(p);
      const out = await call('POST', '/account/presence', {
        profile: p && { nickname: p.nickname, countryCode: p.countryCode, carStyle: p.carStyle, tokenHash: s.hash,
          stats: publicStats(s), badges: pickedBadges(), bestTrack: get(BEST_KEY), frame: pickedFrame().id,
          distance: Math.round(bestCount('metres')), driving: Math.round(bestCount('seconds')), topSpeed: Math.floor(bestCount('topKmh') * 10) },   // the counted badges (the server keeps the most; tenths of km/h)
        state: homeReady() ? 'menu' : 'playing',
        room: window.ApexLobby ? window.ApexLobby.currentRoom() : null,
      }, acc.session);
      if (account !== acc) return;
      const badges = Array.isArray(out.badges) ? out.badges : acc.badges;   // an older server has none
      const recovery = typeof out.recovery === 'boolean' ? out.recovery : acc.recovery;   // an older server does not say
      // the garage's items it unlocked (apex-rarity.js); a server older than 2.19 does not say: the owners its
      // UNLOCKS gives by default (server/accounts.js)
      const unlocks = Array.isArray(out.unlocks) ? out.unlocks : [7777, 1].includes(out.id) ? ['mp4_7a', 'r26'] : [];
      if (acc.id !== out.id || acc.verified !== out.verified || JSON.stringify(acc.badges) !== JSON.stringify(badges) || acc.recovery !== recovery || JSON.stringify(acc.unlocks) !== JSON.stringify(unlocks)) {
        acc.id = out.id; acc.verified = out.verified; acc.badges = badges; acc.recovery = recovery; acc.unlocks = unlocks; saveAccount();
      }
      social = { requests: out.requests, online: out.online };
    } catch (e) {
      if (e.status === 401 && account === acc) { account = null; cloud = null; saveAccount(); }
    }
    scheduleBadge();
  }
  setInterval(sendPresence, PRESENCE_EVERY);
  // what the others see of the Stats tab (renderPlayer), whole numbers (the server takes nothing else)
  const publicStats = s => {
    const out = { tracks: s.tracks, circuits: s.circuits.length, custom: s.custom, official: s.official };
    for (const k of ['metres', 'timedMetres', 'seconds', 'topKmh', 'finishes', 'races', 'wins', 'podiums', 'places']) out[k] = Math.round(s[k] || 0);
    return out;
  };

  const friendsCall = (method, body) => call(method, '/account/friends', body, account.session);

  // ---------------------------------------------------------------- players (a track's author)
  // A track's author is linked to the account of that name: on a track's page, the name opens the player's card.
  // A friend (friends list) or a player of the room (multiplayer, apex-room.js) is looked up by number.
  const players = new Map();   // 'name:' + lower-case name, or 'id:' + number -> { time, promise of the card or null }
  const playerKey = who => (typeof who === 'number' ? 'id:' + who : 'name:' + who.trim().toLowerCase());
  function fetchPlayer(who) {
    const key = playerKey(who), known = players.get(key);
    if (known && Date.now() - known.time < 60000) return known.promise;
    const query = typeof who === 'number' ? 'id=' + who : 'name=' + encodeURIComponent(who.trim());
    const promise = call('GET', '/account/player?' + query, null, account?.session)
      .catch(e => { if (e.status !== 404) players.delete(key); return null; });
    players.set(key, { time: Date.now(), promise });
    return promise;
  }
  // the mod's tracks this account made (their author is its name)
  const tracksBy = name => MOD_TRACKS.filter(t => t.author && name && t.author.toLowerCase() === name.toLowerCase());

  // the author's name on a track's page becomes a link when an account has that name
  function linkAuthor() {
    const span = document.querySelector('#ui .track-info-ui .track-author > span:not([data-apex])');
    if (span == null) return;
    span.dataset.apex = 'pending';
    const name = span.textContent;
    if (!name.trim()) return;
    fetchPlayer(name).then(player => {
      if (player == null || !span.isConnected) return;
      span.dataset.apex = 'linked';
      span.classList.add('apex-author');
      span.title = tr('Voir le profil de ', 'See the profile of ') + player.name + ' · ' + idText(player.id);
      span.tabIndex = 0;
      badgeMarks(span, badgesOfPlayer(player));
      const show = event => { event.preventDefault(); event.stopPropagation(); openPlayer(player.name); };
      span.addEventListener('click', show);
      span.addEventListener('keydown', event => { if (event.key === 'Enter') show(event); });
    });
  }

  const wait = async (find, tries = 60) => {
    for (let i = 0; i < tries; i++) { const found = find(); if (found) return found; await new Promise(resolve => setTimeout(resolve, 100)); }
    return null;
  };
  // the garage, opened from the home screen: its top bar (Exit, Save, Default, Random, Liveries) and the
  // name and flag button it hides (apex-livery.js: the garage only paints the car)
  async function openGarage() {
    const garageButton = document.querySelector('#ui .menu-ui > .main-buttons-container > .button-image');   // the first one
    if (garageButton == null) return null;
    close();
    garageButton.click();
    const named = await wait(() => document.querySelector('#ui .profile-button-container > button'));
    const top = named?.closest('#ui > div')?.querySelector('.top');
    return top ? { named, buttons: [...top.querySelectorAll(':scope > button')] } : null;
  }

  // the game's own profile window (name, country), which lives in the garage behind its name and flag button
  // (whose Confirm only prepares the change): then the garage's Save writes it and the garage closes, nothing
  // left unsaved, back to the home screen and the profile card
  async function editProfile() {
    if (window.GoofyGame?.profiles) {      // patch_bundle.js: the game's profiles, edited from here
      viewing = null; tab = 'profile'; editing = true; draft = null;
      if (overlay == null) open(); else render();
      return;
    }
    const garage = await openGarage();
    if (garage == null) return;
    const [exit, save] = garage.buttons;
    garage.named.click();
    if (await wait(() => document.querySelector('#ui .profile-settings-ui')) == null) return;
    await wait(() => document.querySelector('#ui .profile-settings-ui') == null, 36000);   // up to an hour to choose
    save.click();
    exit.click();
    if (await wait(homeReady)) { sendPresence(); open(); }   // friends see the new name and flag at once
  }

  // the game's own profile list (switch, import), from the garage's last button, which shows the liveries
  // unless told otherwise; the player is left in the garage, where the list leads
  async function switchProfile() {
    const garage = await openGarage();
    if (garage == null) return;
    window.ApexLivery?.switchProfile();
    garage.buttons[garage.buttons.length - 1].click();
  }

  // joins a friend's room as the player would: Multiplayer, the invite code, Join
  async function joinRoom(code) {
    close();
    const multiplayer = document.querySelectorAll('#ui .menu-ui > .main-buttons-container > .button-image')[3];   // Garage, Editor, Settings, Multiplayer, Play
    if (multiplayer == null) return;
    multiplayer.click();
    for (let i = 0; i < 50; i++) {
      const input = document.querySelector('#ui input.invite-code'), join = document.querySelector('#ui button.join');
      if (input && join && input.offsetParent) {
        input.value = code;
        input.dispatchEvent(new Event('input'));
        join.click();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // ---------------------------------------------------------------- profile
  // the profile picked in the game: { slot, token, nickname, countryCode, carStyle }
  function currentProfile() {
    const picked = parseInt(get(GAME + 'user_slot'), 10);
    for (const slot of [picked, 0, 1, 2]) {
      const p = Number.isInteger(slot) ? parse(get(GAME + 'user_' + slot)) : null;
      if (p && typeof p.token === 'string') return { ...p, slot };
    }
    return null;
  }

  const countryName = code => {
    try { return new Intl.DisplayNames([tr('fr', 'en')], { type: 'region' }).of(code.toUpperCase()); } catch (e) { return code.toUpperCase(); }
  };

  // the game's own car thumbnail (leaderboards): webpack ids of PolyTrack 0.6.3
  const CAR_THUMBNAIL = 3787, CAR_STYLE = 8724, THREE = 4922;
  let gameRequire = null;
  const gameModule = id => {
    if (gameRequire == null) window.webpackChunk.push([[Symbol('apex-account')], {}, r => { gameRequire = r; }]);
    return gameRequire(id);
  };
  const thumbnails = new Map();   // car style -> promise of a data URL (null when it cannot be drawn)
  // own: the player's car, kept for the next start (not a friend's)
  function carThumbnail(style, own) {
    if (!thumbnails.has(style)) thumbnails.set(style, (async () => {
      const saved = readJson(THUMB_KEY);
      if (saved && saved.style === style && saved.url) return saved.url;
      // seen from the front left, closer than in the leaderboards: the whole car fits in the round badge
      const V = gameModule(THREE).Pq0;
      const url = await gameModule(CAR_THUMBNAIL).F(gameModule(CAR_STYLE).A.deserializeSafe(style), { addCancelCallback() {} },
        { position: new V(-1000, 450, 1000), look: new V(0, 0.25, 0), zoom: 0.45 });
      if (!url || await blank(url)) { thumbnails.delete(style); return null; }   // drawn too early: tried again later
      if (own) try { rawSet.call(storage, THUMB_KEY, JSON.stringify({ style, url })); } catch (e) { /* storage full */ }
      return url;
    })().catch(e => { console.warn('GoofyTrack profile: car thumbnail', e); thumbnails.delete(style); return null; }));
    return thumbnails.get(style);
  }
  // an image with nothing drawn on it (the car's models not loaded yet)
  const blank = url => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 32, 32);
      const data = g.getImageData(0, 0, 32, 32).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
      resolve(opaque < 20);
    };
    img.onerror = () => resolve(true);
    img.src = url;
  });
  const showCar = (img, style, own = true) => {
    img.dataset.style = style;
    carThumbnail(style, own).then(url => { if (url && img.dataset.style === style) img.src = url; });
  };

  // stats of a profile, from this PC's save: tracks with a record, the official ones (the game's and the mod's)
  // and the mod's circuits among them, custom tracks; and what the mod counts as it is played (driven, races)
  async function profileStats(p) {
    const hash = await sha256(p.token), prefix = GAME + 'record_' + p.slot + '_', tracks = new Set();
    for (const key of Object.keys(storage)) {
      if (key.startsWith(prefix) && parse(get(key))?.tokenHash === hash) tracks.add(key.slice(-64));
    }
    return {
      hash,
      tracks: tracks.size,
      official: OFFICIAL_TRACKS.filter(id => tracks.has(id)).length,
      circuits: MOD_TRACKS.filter(t => tracks.has(t.id)),
      custom: Object.keys(storage).filter(k => k.startsWith(GAME + 'track_')).length,
      ...countedStats(p.token, hash),
    };
  }

  // ---------------------------------------------------------------- counted stats
  // The game keeps no distance and no race results: the mod counts them (apex-hud.js: metres driven, apex-room.js:
  // races of the race mode against others), per profile (token hash). Each PC writes its own entry and the card
  // shows the sum, so two PCs on the same account never undo each other's counts (the save keeps the latest entry).
  // Kept in memory while driving, written at most every minute, and when the run ends or the game is left.
  // Every count adds up, but the top speed (MAX_STATS), the highest of them. places: the sum of the race places.
  // timedMetres: the metres driven while the time was counted too (the average speed), the time came after the distance
  const STATS_EVERY = 60000;
  const zero = () => ({ metres: 0, timedMetres: 0, seconds: 0, topKmh: 0, finishes: 0, races: 0, wins: 0, podiums: 0, places: 0 });
  const MAX_STATS = ['topKmh'];
  const addStat = (t, k, n) => { t[k] = MAX_STATS.includes(k) ? Math.max(t[k], n) : t[k] + n; };
  const pending = new Map();      // profile token -> counts not written yet
  const hashes = new Map();       // profile token -> its hash, worked out ahead: the last write (game left) cannot wait
  let statsTimer = null;
  let live = null;                // the counts of the profile driving, until the next write (60 calls a second)
  let drivenFrames = 0;
  const pcId = () => {
    let id = get(PC_KEY);
    if (!/^[0-9a-f]{16}$/.test(id || '')) { id = hex(crypto.getRandomValues(new Uint8Array(8))); try { rawSet.call(storage, PC_KEY, id); } catch (e) { /* storage full */ } }
    return id;
  };
  function counting() {
    const p = currentProfile();
    if (p == null) return null;
    if (!hashes.has(p.token)) { hashes.set(p.token, null); sha256(p.token).then(hash => hashes.set(p.token, hash)); }
    if (!pending.has(p.token)) {
      pending.set(p.token, zero());
      clearTimeout(statsTimer);
      statsTimer = setTimeout(flushStats, STATS_EVERY);   // a minute after the first count since the last write
    }
    return (live = pending.get(p.token));
  }
  function flushStats() {
    clearTimeout(statsTimer);
    live = null;
    const key = STATS_PREFIX + pcId(), all = readJson(key) || {};
    let changed = false;
    for (const [token, c] of pending) {
      const hash = hashes.get(token);
      if (hash == null) continue;        // in a moment
      const t = { ...zero(), ...all[hash] };
      for (const k of Object.keys(c)) addStat(t, k, c[k]);
      t.metres = Math.round(t.metres);
      t.timedMetres = Math.round(t.timedMetres);
      t.seconds = Math.round(t.seconds * 10) / 10;   // written often (every run's end): whole seconds would drop the short ones
      t.topKmh = Math.floor(t.topKmh * 10) / 10;   // tenths: the TGV badge is won at 574.8 km/h
      all[hash] = t;
      pending.delete(token);
      changed = true;
    }
    if (changed) try { storage.setItem(key, JSON.stringify(all)); } catch (e) { /* storage full */ }   // watched: synced
    if (pending.size) statsTimer = setTimeout(flushStats, 1000);
    if (changed) checkCountedBadges();
  }
  // the most among the profiles counted on this PC of one count (metres, seconds), all PCs together, with what is
  // not written yet (the counted badges)
  function bestCount(stat) {
    const byHash = new Map(), more = (a, b) => (MAX_STATS.includes(stat) ? Math.max(a, b) : a + b);
    for (const key of Object.keys(storage)) {
      if (!key.startsWith(STATS_PREFIX)) continue;
      const all = readJson(key);
      if (all && typeof all === 'object') for (const [hash, t] of Object.entries(all)) byHash.set(hash, more(byHash.get(hash) || 0, Number(t?.[stat]) || 0));
    }
    for (const [token, c] of pending) { const hash = hashes.get(token); if (hash) byHash.set(hash, more(byHash.get(hash) || 0, c[stat] || 0)); }
    return Math.max(0, ...byHash.values());
  }
  // the profile's counts, from every PC, with what is not written yet
  function countedStats(token, hash) {
    const sum = zero();
    for (const key of Object.keys(storage)) {
      if (!key.startsWith(STATS_PREFIX)) continue;
      const t = readJson(key)?.[hash];
      if (t) for (const k of Object.keys(sum)) addStat(sum, k, Number(t[k]) || 0);
    }
    const c = pending.get(token);
    if (c) for (const k of Object.keys(sum)) addStat(sum, k, c[k]);
    return sum;
  }
  window.ApexStats = {
    // a frame driven (apex-hud.js): metres, seconds of race time, speed
    drive(metres, seconds = 0, kmh = 0) {
      if (!(metres > 0 && metres < 1000)) return;
      const c = live ?? counting();
      if (c == null) return;
      c.metres += metres;
      if (seconds > 0 && seconds < 1) { c.seconds += seconds; c.timedMetres += metres; }
      if (kmh < 2000 && kmh > c.topKmh) c.topKmh = kmh;
      if (++drivenFrames % 600 === 0) checkCountedBadges();   // every ten seconds or so: a badge is announced as it is won
    },
    // a run that crossed the finish line, solo or online
    finish() { const c = counting(); if (c) c.finishes++; },
    race(place) {
      const c = counting();
      if (c == null) return;
      c.races++;
      c.places += place;
      if (place === 1) c.wins++;
      if (place <= 3) c.podiums++;
      flushStats();
    },
    flush: flushStats,
  };
  window.addEventListener('pagehide', () => flushStats());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushStats(); });
  // places on the mod's circuits, from the GoofyTrack server's boards: [{ position, id, name }], best first
  const places = new Map();       // token hash -> { time, promise }
  function boardPlaces(hash, circuits) {
    const known = places.get(hash);
    if (known && Date.now() - known.time < 120000) return known.promise;
    const promise = Promise.all(circuits.map(t =>
      fetch(`${SERVER}leaderboardUserEntry?trackId=${t.id}&userTokenHash=${hash}`)
        .then(res => (res.ok ? res.json() : null))
        .then(e => (e && e.position > 0 ? { position: e.position, id: t.id, name: t.name } : null))
        .catch(() => null)))
      .then(all => all.filter(Boolean).sort((a, b) => a.position - b.position));
    places.set(hash, { time: Date.now(), promise });
    return promise;
  }
  // the best place shown: the circuit the player picked when they hold that place on several (BEST_KEY), else the first
  const BEST_KEY = 'goofytrack.bestPlace';      // id of the circuit picked (synced)
  const tiedBest = list => list.filter(e => e.position === list[0]?.position);
  const shownPlace = list => tiedBest(list).find(e => e.id === get(BEST_KEY)) || list[0] || null;
  const bestPlace = (hash, circuits) => boardPlaces(hash, circuits).then(shownPlace);

  // ---------------------------------------------------------------- interface
  let overlay = null, toast = null;

  function notify(text, withReload) {
    toast?.remove();
    toast = document.createElement('div');
    toast.className = 'apex-account-toast';
    toast.appendChild(document.createElement('span')).textContent = text;
    if (withReload) {
      const b = toast.appendChild(document.createElement('button'));
      b.textContent = tr('Recharger', 'Reload');
      b.addEventListener('click', reload);
    }
    const close = toast.appendChild(document.createElement('button'));
    close.textContent = '✕';
    close.addEventListener('click', () => { toast?.remove(); toast = null; });
    document.getElementById('ui')?.appendChild(toast);
  }

  function close() {
    if (overlay == null) return;
    overlay.remove();
    overlay = null;
    viewing = null;
    viewingFrom = null;
    editing = false;
    securing = null;
    draft = null;
    clearTimeout(friendsTimer);
    removing = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }

  const el = (parent, tag, className, text) => {
    const e = parent.appendChild(document.createElement(tag));
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const ago = time => {
    const s = Math.round((Date.now() - time) / 1000);
    if (s < 60) return tr('à l\'instant', 'just now');
    const m = Math.round(s / 60);
    return m < 60 ? tr(`il y a ${m} min`, `${m} min ago`) : tr(`il y a ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`);
  };
  const flag = (parent, code) => {
    if (!code) return;
    const img = el(parent, 'img', 'flag');
    img.src = 'images/countries/' + code + '.svg';
    img.draggable = false;
    img.title = countryName(code);
  };
  // the check mark of the game's creators, next to their name
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5l2.5 2.1 3.3-.4.9 3.2 2.9 1.6-1.2 3.1 1.2 3.1-2.9 1.6-.9 3.2-3.3-.4L12 22.5l-2.5-2.1-3.3.4-.9-3.2-2.9-1.6 1.2-3.1-1.2-3.1 2.9-1.6.9-3.2 3.3.4z"/>'
    + '<path d="M7.6 12.2l3 3 5.8-6" fill="none" stroke="#14100a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // the distance badges: a road running away, its edges and its centre line
  const ROAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 4 21M15 3l5 18"/><path d="M12 4v3M12 10.5v3M12 17v3.5" stroke-width="2.6"/></svg>';
  // the time badges: a stopwatch, its button and its hand
  const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M10 2.5h4M12 2.5v3.5M12 13.5V9.5M18.5 6.5l1.5-1.5"/></svg>';
  // the speed badges: a high-speed train seen from the side, its long nose, its windows and the rail
  const TRAIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 16.5h15c2.8 0 5-1.3 5-2.7 0-1.3-3.2-2.8-7.5-4.3H2"/><path d="M5 12.5h7.5" stroke-width="2"/><path d="M2.5 20h19" stroke-width="1.6"/></svg>';
  // the VIP diamond: a cut gem in a violet to pink gradient, its facets in light lines
  const DIAMOND = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="apx-vip" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#6a3dff"/><stop offset="0.45" stop-color="#b45cff"/><stop offset="1" stop-color="#ff5fa8"/></linearGradient></defs>'
    + '<path d="M6.5 3.5h11l4 5.5L12 21 2.5 9z" fill="url(#apx-vip)"/>'
    + '<path d="M2.5 9h19M9.5 3.5 7.5 9 12 21l4.5-12-2-5.5M7.5 9 12 3.5 16.5 9" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="0.9" stroke-linejoin="round"/>'
    + '<path d="M6.5 3.5h11l4 5.5L12 21 2.5 9z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8" stroke-linejoin="round"/></svg>';
  // ---------------------------------------------------------------- badges
  // Shown next to a name, two at most: 'creator' (the check mark), 'vip' (the diamond: friends and the first
  // players), 'p1:<trackId>', 'p2:…', 'p3:…' while
  // first, second or third on that circuit of the mod (gold, silver and bronze), and the counted badges once a profile
  // has driven that far or that long, or that fast: 'km:<km>', 'h:<hours>', 'kmh:<km/h>' (COUNTED_BADGES). The server knows who owns what
  // (server/accounts.js); the player picks theirs in the profile editor or on the Badges tab, and the others see them
  // on their cards, in their friends list, on a track's page.
  const BADGES_KEY = 'goofytrack.badges';     // the badges picked (synced): ids, or nothing for the default
  const MAX_BADGES = 2;
  // Counted badges, won for good once one of the profiles has driven that far or that long (on all PCs together,
  // the counts of the Stats tab): this PC knows at once (bestCount), the server from the presence, which keeps the
  // most it heard (COUNTED_BADGES there too). Each family: its id prefix, the count it reads and its unit, its icon.
  const COUNTED_BADGES = [
    { kind: 'km', stat: 'metres', unit: 1000, icon: ROAD, title: ['Distance', 'Distance'], tiers: [
      { n: 500, short: '500', name: ['Baroudeur', 'Wanderer'], tone: 'green' },
      { n: 1000, short: '1K', name: ['Routard', 'Road tripper'], tone: 'blue' },
      { n: 2500, short: '2.5K', name: ['Grand voyageur', 'Voyager'], tone: 'purple' },
      { n: 5000, short: '5K', name: ['Globe-trotteur', 'Globetrotter'], tone: 'gold' },
      { n: 10000, short: '10K', name: ['Légende du bitume', 'Tarmac legend'], tone: 'red' },
      { n: 40075, short: '40K', name: ['Tour du monde', 'Round the world'], tone: 'world' },   // the Equator
    ] },
    { kind: 'h', stat: 'seconds', unit: 3600, icon: CLOCK, title: ['Temps au volant', 'Time driving'], tiers: [
      { n: 5, short: '5h', name: ['Pilote du dimanche', 'Sunday driver'], tone: 'green' },
      { n: 10, short: '10h', name: ['Habitué', 'Regular'], tone: 'blue' },
      { n: 25, short: '25h', name: ['Passionné', 'Enthusiast'], tone: 'purple' },
      { n: 50, short: '50h', name: ['Accro du volant', 'Wheel addict'], tone: 'gold' },
      { n: 100, short: '100h', name: ['Pilote d\'endurance', 'Endurance driver'], tone: 'red' },
      { n: 250, short: '250h', name: ['Une vie au volant', 'A life at the wheel'], tone: 'world' },
    ] },
    { kind: 'kmh', stat: 'topKmh', unit: 1, icon: TRAIN, title: ['Vitesse', 'Speed'], tiers: [
      { n: 574.8, short: 'TGV', name: ['Record du TGV', 'TGV record'], tone: 'tgv' },   // the TGV V150, 3 April 2007
    ] },
  ];
  const UNITS = { km: ' km', h: ' h', kmh: ' km/h' };
  const digitsOf = (family, n) => (family.kind === 'kmh' || (n < 10 && family.kind === 'h') ? 1 : 0);
  const countText = (family, n) => n.toLocaleString(french() ? 'fr-FR' : 'en-US', { maximumFractionDigits: digitsOf(family, n) }) + UNITS[family.kind];
  const doneText = (family, n) => ({
    km: tr(`${countText(family, n)} parcourus`, `${countText(family, n)} driven`),
    h: tr(`${countText(family, n)} au volant`, `${countText(family, n)} at the wheel`),
    kmh: tr(`${countText(family, n)} atteints`, `${countText(family, n)} reached`),
  })[family.kind];
  const goalText = (family, n) => ({
    km: tr(`Parcourir ${countText(family, n)}`, `Drive ${countText(family, n)}`),
    h: tr(`Rouler ${countText(family, n)}`, `Drive for ${countText(family, n)}`),
    kmh: tr(`Atteindre ${countText(family, n)}`, `Reach ${countText(family, n)}`),
  })[family.kind];
  const earnedCounted = () => COUNTED_BADGES.flatMap(f => { const best = bestCount(f.stat); return f.tiers.filter(t => best >= t.n * f.unit).map(t => f.kind + ':' + t.n); });
  const trackName = id => MOD_TRACKS.find(t => t.id === id)?.name || tr('un circuit du mod', 'a mod circuit');
  function badgeInfo(id) {
    if (id === 'creator') return { label: tr('Co-créateur de GoofyTrack', 'GoofyTrack co-creator') };
    if (id === 'vip') return { label: tr('VIP de GoofyTrack', 'GoofyTrack VIP') };
    for (const family of COUNTED_BADGES) {
      const tier = family.tiers.find(t => family.kind + ':' + t.n === id);
      if (tier) return { label: tr(tier.name[0], tier.name[1]) + ' · ' + countText(family, tier.n), name: tr(tier.name[0], tier.name[1]), tier, family };
    }
    const podium = /^p([123]):(.+)$/.exec(typeof id === 'string' ? id : '');
    if (podium) {
      const place = 'P' + podium[1], track = MOD_TRACKS.find(t => t.id === podium[2]);
      return { label: tr(place + ' de ', place + ' at ') + trackName(podium[2]), place, outline: track?.outline || null };
    }
    return null;
  }
  // the badges this player owns: the server's last word (the check mark alone, before it knew of badges), and the
  // counted badges this PC has seen won, before the server hears of them
  const ownedBadges = () => {
    if (account == null) return [];
    const server = Array.isArray(account.badges) ? account.badges : account.verified === 'creator' ? ['creator'] : [];
    return [...new Set([...server, ...earnedCounted()])];
  };
  // those picked and still owned; by default the check mark of the creators
  function pickedBadges() {
    const owned = ownedBadges(), picked = readJson(BADGES_KEY);
    return (Array.isArray(picked) ? picked : owned.filter(b => b === 'creator')).filter(b => owned.includes(b)).slice(0, MAX_BADGES);
  }
  // another player's: those the server shows, or the check mark of an older server
  const badgesOfPlayer = v => (Array.isArray(v?.badges) ? v.badges : v?.verified === 'creator' ? ['creator'] : []);
  function badgeMarks(parent, ids) {
    for (const id of ids.slice(0, MAX_BADGES)) {
      const info = badgeInfo(id);
      if (info == null) continue;
      if (id === 'creator' || id === 'vip') {
        const mark = el(parent, 'span', id === 'vip' ? 'verified vip' : 'verified');
        mark.innerHTML = id === 'vip' ? DIAMOND : CHECK;
        mark.title = info.label;
        continue;
      }
      // a count: its icon (a road, a stopwatch) and the number, in the tier's colour
      if (info.tier) {
        const pill = el(parent, 'span', 'badge-km ' + info.tier.tone);
        pill.innerHTML = info.family.icon;
        el(pill, 'b', null, info.tier.short);
        pill.title = info.label;
        continue;
      }
      // a gold, silver or bronze button: the circuit's outline (track_outlines.js) and the place
      const pill = el(parent, 'span', 'badge-podium ' + info.place.toLowerCase());
      if (info.outline) {
        const svg = pill.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const line = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
        line.setAttribute('d', info.outline);
      }
      el(pill, 'b', null, info.place);
      pill.title = info.label;
    }
  }
  // ---------------------------------------------------------------- badge won
  // A counted badge just won is announced once, at the top of the screen, even in a race. Those announced are kept
  // (synced): another PC of the account does not announce them again. A click on the notice opens the Badges tab.
  const SEEN_KEY = 'goofytrack.badgesSeen';
  const ANNOUNCE_MS = 6500;
  let badgeToast = null, announcing = [];
  function checkCountedBadges() {
    const seen = readJson(SEEN_KEY), known = Array.isArray(seen) ? seen : [];
    const fresh = earnedCounted().filter(id => !known.includes(id));
    if (!fresh.length) return;
    try { storage.setItem(SEEN_KEY, JSON.stringify([...known, ...fresh])); } catch (e) { /* storage full */ }
    // several of a family at once (counts from before this version): its highest; one family after the other
    for (const family of COUNTED_BADGES) {
      const mine = fresh.filter(id => id.startsWith(family.kind + ':'));
      if (mine.length) announcing.push(mine[mine.length - 1]);
    }
    if (badgeToast == null) announceBadge(announcing.shift());
    scheduleBadge();
    if (account != null) sendPresence();           // the server and the friends hear of it now
  }
  function announceBadge(id) {
    const info = badgeInfo(id);
    if (info == null) return;
    badgeToast?.remove();
    const toast = badgeToast = document.createElement('div');
    toast.className = 'apex-badge-toast';
    toast.setAttribute('role', 'status');
    badgeMarks(el(toast, 'div', 'mark'), [id]);
    const text = el(toast, 'div', 'text');
    el(text, 'div', 'title', tr('Nouveau badge !', 'New badge!'));
    el(text, 'div', 'name', info.name);
    const done = doneText(info.family, info.tier.n);
    el(text, 'div', 'sub', account != null
      ? tr(`${done} : mettez-le sur votre profil`, `${done}: put it on your profile`)
      : tr(`${done} : connectez-vous à un compte pour l'afficher`, `${done}: log in to an account to show it`));
    // the next one waiting, once this one is gone
    const dismiss = () => {
      toast.remove();
      if (badgeToast !== toast) return;
      badgeToast = null;
      if (announcing.length) announceBadge(announcing.shift());
    };
    toast.addEventListener('click', () => {
      announcing = [];
      dismiss();
      if (homeReady()) { close(); tab = 'badges'; open(); }
    });
    document.getElementById('ui')?.appendChild(toast);
    setTimeout(() => toast.classList.add('gone'), ANNOUNCE_MS);
    setTimeout(dismiss, ANNOUNCE_MS + 600);
  }

  // ---------------------------------------------------------------- profile frame
  // The ring around the car (home screen, cards, friends list): a colour anyone picks, or a frame won with a badge,
  // shown while the badge is owned (server/accounts.js checks the same: FRAMES there). Others see it through the presence.
  const FRAME_KEY = 'goofytrack.frame';       // id of the frame picked (synced)
  const metal = (a, b, c) => `linear-gradient(160deg, ${a} 0%, ${b} 45%, ${c} 100%)`;
  const FRAMES = [
    { id: 'red', label: ['Rouge', 'Red'], ring: '#f20d16' },
    { id: 'white', label: ['Blanc', 'White'], ring: '#f3f5f8' },
    { id: 'orange', label: ['Orange', 'Orange'], ring: '#ff8a1f' },
    { id: 'blue', label: ['Bleu', 'Blue'], ring: '#2f7bff' },
    { id: 'green', label: ['Vert', 'Green'], ring: '#2ecc71' },
    { id: 'purple', label: ['Violet', 'Purple'], ring: '#9b5cff' },
    { id: 'pink', label: ['Rose', 'Pink'], ring: '#ff5fa8' },
    // won: a podium on a circuit of the mod (bronze for any, silver for P2 or P1, gold for P1), the creators', the VIPs'
    { id: 'bronze', label: ['Bronze', 'Bronze'], ring: metal('#f6cfa6', '#cd8540', '#8c4f1c'), needs: ['p1', 'p2', 'p3'],
      hint: ['Gagné avec un badge de podium P1, P2 ou P3', 'Won with a P1, P2 or P3 podium badge'] },
    { id: 'silver', label: ['Argent', 'Silver'], ring: metal('#ffffff', '#cdd3dc', '#8b95a3'), needs: ['p1', 'p2'],
      hint: ['Gagné avec un badge P1 ou P2', 'Won with a P1 or P2 badge'] },
    { id: 'gold', label: ['Or', 'Gold'], ring: metal('#ffe58a', '#f2c230', '#c48f0a'), needs: ['p1'], glow: 'gold',
      hint: ['Gagné avec un badge P1', 'Won with a P1 badge'] },
    { id: 'creator', label: ['Créateur', 'Creator'], ring: 'conic-gradient(from 200deg, #f5c518, #f20d16, #f5c518, #f20d16, #f5c518)', needs: ['creator'], glow: 'gold',
      hint: ['Réservé aux co-créateurs de GoofyTrack', 'For the GoofyTrack co-creators'] },
    { id: 'vip', label: ['VIP', 'VIP'], ring: metal('#6a3dff', '#b45cff', '#ff5fa8'), needs: ['vip'], glow: 'vip',
      hint: ['Réservé aux VIP de GoofyTrack', 'For the GoofyTrack VIPs'] },
  ];
  const frameLabel = f => tr(f.label[0], f.label[1]);
  const frameAllowed = (f, owned) => !f.needs || owned.some(b => f.needs.includes(String(b).split(':')[0]));
  // the frame picked, if still allowed (else the default, red); another player's comes checked by the server
  const pickedFrame = (id = get(FRAME_KEY)) => FRAMES.find(f => f.id === id && frameAllowed(f, ownedBadges())) || FRAMES[0];
  const frameById = id => FRAMES.find(f => f.id === id) || FRAMES[0];
  function paintFrame(img, f) {
    img.style.setProperty('--apx-frame', f.ring.startsWith('#') ? `linear-gradient(${f.ring}, ${f.ring})` : f.ring);
    img.classList.add('framed');
    img.classList.toggle('glow-gold', f.glow === 'gold');
    img.classList.toggle('glow-vip', f.glow === 'vip');
  }

  // the account's state, in a few words: [text, kind]
  const accountState = () => (account == null ? [tr('Se connecter', 'Log in'), 'out']
    : syncing ? [tr('Synchronisation…', 'Syncing…'), 'busy']
    : lastError ? [tr('Hors ligne', 'Offline'), 'offline']
    : [tr('Synchronisé', 'Synced'), 'ok']);

  // ---------------------------------------------------------------- badge (home screen, top left)
  function addBadge() {
    const menu = document.querySelector('#ui .menu-ui');
    if (menu == null || menu.querySelector(':scope > .apex-profile') != null) return;
    // a div, not a button: the theme paints the last button of the home screen in the accent colour
    const badge = document.createElement('div');
    badge.className = 'apex-profile';
    badge.setAttribute('role', 'button');
    badge.tabIndex = 0;
    badge.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    const car = el(badge, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    const text = el(badge, 'div', 'text');
    el(text, 'div', 'name');
    el(text, 'div', 'status');
    badge.addEventListener('click', open);
    menu.appendChild(badge);
    updateBadge();
  }

  const homeReady = () => document.querySelector('#ui .menu-ui:not(.loading-screen) > .main-buttons-container:not(.hidden)') != null;
  let badgeTimer = null;
  function scheduleBadge() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(updateBadge, 50);
  }
  function updateBadge() {
    const p = currentProfile(), [state, kind] = accountState();
    for (const badge of document.querySelectorAll('#ui .apex-profile')) {
      // the game's car models are ready once the home screen's buttons are shown
      if (p && homeReady()) showCar(badge.querySelector('.car'), p.carStyle);
      paintFrame(badge.querySelector('.car'), pickedFrame());
      const name = badge.querySelector('.name');
      name.textContent = '';
      flag(name, p?.countryCode);
      el(name, 'span', null, p ? p.nickname : tr('Profil', 'Profile'));
      badgeMarks(name, pickedBadges());
      const status = badge.querySelector('.status');
      status.textContent = account && kind === 'ok' ? account.name + (account.id ? ' · ' + idText(account.id) : '') : state;
      status.className = 'status ' + kind;
      badge.classList.toggle('requests', account != null && social.requests > 0);   // friend requests waiting
      badge.title = account ? tr('Compte ', 'Account ') + account.name + ' · ' + state : tr('Aucun compte sur ce PC', 'No account on this PC');
    }
  }

  // ---------------------------------------------------------------- stats
  // a grid's tiles: label, value and its unit
  const statTile = grid => (label, value, sub) => {
    const t = el(grid, 'div', 'stat');
    el(t, 'div', 'label', label);
    const v = el(t, 'div', 'value', value);
    if (sub != null) el(v, 'span', 'sub', sub);
    return t;
  };
  function fill(t, value, sub) {
    const v = t.querySelector('.value');
    v.textContent = value;
    if (sub) el(v, 'span', 'sub', sub);
  }
  const number = (n, digits = n < 100 ? 1 : 0) => n.toLocaleString(french() ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits });
  const percent = (n, of) => (of > 0 ? Math.round(n / of * 100) + ' %' : null);
  const duration = seconds => {
    const m = Math.floor(seconds / 60), h = Math.floor(m / 60);
    return h > 0 ? [String(h), 'h ' + String(m % 60).padStart(2, '0')] : [String(m), 'min'];
  };

  // The Badges tab: every badge of the game, won or not, and how to win it. A click on one won puts it next to the
  // name, or takes it away (two at most: the one shown longest makes way).
  function renderBadgeWall(body) {
    const owned = ownedBadges(), picked = pickedBadges();
    const all = [...COUNTED_BADGES.flatMap(f => f.tiers.map(t => f.kind + ':' + t.n)), ...MOD_TRACKS.flatMap(t => [1, 2, 3].map(n => 'p' + n + ':' + t.id)), 'creator', 'vip'];
    el(body, 'p', 'hint', account == null
      ? tr('Connectez-vous à un compte GoofyTrack pour gagner des badges et les afficher à côté de votre pseudo.', 'Log in to a GoofyTrack account to earn badges and show them next to your name.')
      : tr(`${all.filter(id => owned.includes(id)).length} badge(s) gagné(s) sur ${all.length}. Cliquez sur un badge gagné pour l'afficher à côté de votre pseudo (deux au plus).`,
        `${all.filter(id => owned.includes(id)).length} of ${all.length} badges won. Click a badge you won to show it next to your name (two at most).`));
    const pick = id => {
      const now = pickedBadges();
      const next = now.includes(id) ? now.filter(b => b !== id) : [...now, id].slice(-MAX_BADGES);
      try { storage.setItem(BADGES_KEY, JSON.stringify(next)); } catch (e) { /* storage full */ }   // watched: synced
      scheduleBadge();
      sendPresence();
      render();
    };
    // a badge: won and pickable (a button), or locked; on (shown on the profile) when picked
    const slot = (parent, id, className) => {
      const won = owned.includes(id), on = picked.includes(id);
      const b = el(parent, won ? 'button' : 'div', className + (won ? ' won' : ' locked') + (on ? ' selected' : ''));
      if (won) b.addEventListener('click', () => pick(id));
      return { b, won, on };
    };

    // the counted badges, a section per family, with a gauge up to each tier not won yet
    for (const family of COUNTED_BADGES) {
      const best = bestCount(family.stat) / family.unit;
      el(body, 'h3', null, tr(family.title[0], family.title[1]));
      const wall = el(body, 'div', 'badge-wall');
      for (const t of family.tiers) {
        const id = family.kind + ':' + t.n, { b, won, on } = slot(wall, id, 'badge-tile');
        badgeMarks(el(b, 'div', 'mark'), [id]);
        const text = el(b, 'div', 'text');
        el(text, 'div', 'name', badgeInfo(id).name);
        el(text, 'div', 'how', goalText(family, t.n));
        if (!won) {
          el(el(text, 'div', 'progress'), 'span').style.width = Math.min(100, best / t.n * 100) + '%';
          el(text, 'div', 'how', `${number(best, digitsOf(family, best))} / ${countText(family, t.n)}`);
        }
        if (on) el(text, 'div', 'shown', tr('Sur votre profil', 'On your profile'));
      }
    }

    el(body, 'h3', null, tr('Podiums des circuits', 'Circuit podiums'));
    el(body, 'p', 'hint', tr('Entrez dans le top 3 du classement en ligne d\'un circuit du mod : le badge dure tant que vous gardez la place.',
      'Get into the top 3 of a mod circuit\'s online board: the badge lasts as long as you keep the place.'));
    const circuits = el(body, 'div', 'badge-circuits');
    for (const t of MOD_TRACKS) {
      const row = el(circuits, 'div', 'badge-circuit');
      el(row, 'span', 'name', t.name);
      for (const n of [1, 2, 3]) badgeMarks(slot(row, 'p' + n + ':' + t.id, 'place').b, ['p' + n + ':' + t.id]);
    }

    el(body, 'h3', null, tr('Spéciaux', 'Special'));
    const special = el(body, 'div', 'badge-wall');
    for (const [id, how] of [['creator', tr('Réservé aux co-créateurs de GoofyTrack', 'For the GoofyTrack co-creators')],
      ['vip', tr('Offert aux amis des créateurs et aux premiers joueurs', 'Given to the creators\' friends and the first players')]]) {
      const { b, on } = slot(special, id, 'badge-tile');
      badgeMarks(el(b, 'div', 'mark'), [id]);
      const text = el(b, 'div', 'text');
      el(text, 'div', 'name', badgeInfo(id).label);
      el(text, 'div', 'how', how);
      if (on) el(text, 'div', 'shown', tr('Sur votre profil', 'On your profile'));
    }
  }

  // The sections of stats, on one's own Stats tab (from the save) and on another player's card (what their game sent
  // with its presence: a count it did not send is a dash). circuits: how many; best: { position, trackId } or null,
  // another player's best place (their own Stats tab lists every board)
  function statSections(body, s, best) {
    const section = title => { el(body, 'h3', null, title); return statTile(el(body, 'div', 'stats')); };
    const known = n => typeof n === 'number' && Number.isFinite(n);
    const count = n => (known(n) ? String(n) : '—');

    if (known(s.metres)) {        // counted since 2.17, sent to the others since 2.20.2
      let tile = section(tr('Au volant', 'Driving'));
      tile(tr('Distance parcourue', 'Distance driven'), number(s.metres / 1000), 'km');
      tile(tr('Temps au volant', 'Time driving'), ...(known(s.seconds) ? duration(s.seconds) : ['—']));
      tile(tr('Vitesse moyenne', 'Average speed'), s.seconds > 0 ? number(s.timedMetres / s.seconds * 3.6, 0) : '—', s.seconds > 0 ? 'km/h' : null);
      tile(tr('Vitesse max', 'Top speed'), s.topKmh > 0 ? number(s.topKmh, 0) : '—', s.topKmh > 0 ? 'km/h' : null);
      tile(tr('Arrivées', 'Finishes'), count(s.finishes)).title = tr('Passages de la ligne d\'arrivée, en solo comme en ligne', 'Finish line crossings, solo or online');

      tile = section(tr('Mode Course en multijoueur', 'Multiplayer race mode'));
      tile(tr('Courses terminées', 'Races finished'), count(s.races));
      tile(tr('Victoires', 'Wins'), count(s.wins), percent(s.wins, s.races));
      tile(tr('Podiums', 'Podiums'), count(s.podiums), percent(s.podiums, s.races));
      tile(tr('Place moyenne', 'Average place'), s.races > 0 ? 'P' + number(s.places / s.races, 1) : '—');
    }

    const tile = section(tr('Pistes', 'Tracks'));
    if (best !== undefined) tile(tr('Meilleure place', 'Best place'), best ? 'P' + best.position : '—', best ? MOD_TRACKS.find(t => t.id === best.trackId)?.name : null);
    if (known(s.official) || best === undefined) {
      tile(tr('Pistes officielles', 'Official tracks'), `${count(s.official)} / ${OFFICIAL_TRACKS.length}`).title = tr('Bouclées au moins une fois, circuits du mod compris', 'Finished at least once, the mod\'s circuits included');
    }
    tile(tr('Circuits du mod', 'Mod circuits'), `${count(s.circuits)} / ${MOD_TRACKS.length}`);
    tile(tr('Pistes avec un record', 'Tracks with a record'), count(s.tracks));
    tile(tr('Pistes perso', 'Custom tracks'), count(s.custom));
  }

  // The Stats tab of one's own card: everything the save and the counts know, in sections
  function renderStats(body, p) {
    const wait = el(body, 'p', 'hint', '…');
    profileStats(p).then(s => {
      if (!body.isConnected) return;
      wait.remove();
      statSections(body, { ...s, circuits: s.circuits.length });

      // the place on each circuit's online board, best first
      el(body, 'h3', null, tr('Classements des circuits du mod', 'Mod circuit boards'));
      const list = el(body, 'div', 'board-places');
      if (!s.circuits.length) el(list, 'p', 'hint', tr('Bouclez un circuit du mod pour entrer dans son classement.', 'Finish a mod circuit to get on its board.'));
      else {
        el(list, 'p', 'hint', '…');
        boardPlaces(s.hash, s.circuits).then(all => {
          list.textContent = '';
          if (!all.length) el(list, 'p', 'hint', tr('Classements injoignables pour l\'instant.', 'The boards cannot be reached right now.'));
          for (const e of all) {
            const row = el(list, 'div', 'board-place' + (e.position <= 3 ? ' p' + e.position : ''));
            el(row, 'span', 'pos', 'P' + e.position);
            el(row, 'span', 'name', e.name);
          }
        });
      }
      el(body, 'p', 'hint', tr('Distance, temps, vitesse et courses : comptés par GoofyTrack depuis la version 2.17, sur tous vos PC.',
        'Distance, time, speed and races: counted by GoofyTrack since version 2.17, on all your PCs.'));
    });
  }

  // ---------------------------------------------------------------- profile card
  let mode = 'login', tab = 'profile';
  let viewing = null;            // another player's card, shown instead of the profile (a track's author, a friend)
  let viewingFrom = null;        // 'friends': the card has a way back to the friends list
  let editing = false;           // the profile editor, shown instead of the profile
  let securing = null;           // the account's security (password, recovery code), shown instead: { code } just made
  function render() {
    if (overlay == null) return;
    const panel = overlay.querySelector('.panel');
    panel.textContent = '';
    if (viewing) return renderPlayer(panel, viewing);
    if (editing) return renderEditor(panel);
    if (securing) return renderSecurity(panel);
    overlay.dataset.view = account != null ? 'account' : 'login';
    const p = currentProfile();

    const header = el(panel, 'div', 'header');
    const car = el(header, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (p) showCar(car, p.carStyle);
    paintFrame(car, pickedFrame());
    const who = el(header, 'div', 'who');
    const title = el(who, 'h2');
    el(title, 'span', null, p ? p.nickname : tr('Profil', 'Profile'));
    badgeMarks(title, pickedBadges());
    const country = el(who, 'div', 'country');
    if (p?.countryCode) { flag(country, p.countryCode); el(country, 'span', null, countryName(p.countryCode)); }
    else el(country, 'span', null, tr('Pays non choisi', 'No country set'));
    if (account?.id) {
      // the number friends add you by: a click copies it
      const chip = el(who, 'button', 'player-id', idText(account.id));
      chip.title = tr('Votre numéro de joueur : cliquez pour le copier', 'Your player number: click to copy it');
      chip.addEventListener('click', () => {
        navigator.clipboard?.writeText(idText(account.id)).then(() => { chip.textContent = tr('Copié', 'Copied'); setTimeout(() => { chip.textContent = idText(account.id); }, 1200); }, () => {});
      });
    }
    const closeButton = el(header, 'button', 'close', '✕');
    closeButton.title = tr('Fermer', 'Close');
    closeButton.addEventListener('click', close);

    const tabs = el(panel, 'div', 'card-tabs');
    if (tab === 'stats' && !p) tab = 'profile';
    for (const [t, label] of [['profile', tr('Profil', 'Profile')], ...(p ? [['stats', tr('Stats', 'Stats')]] : []), ['badges', tr('Badges', 'Badges')], ['friends', tr('Amis', 'Friends')]]) {
      const button = el(tabs, 'button', t === tab ? 'active' : null, label);
      if (t === 'friends' && account && social.requests > 0) el(button, 'span', 'count', String(social.requests));
      button.addEventListener('click', () => { tab = t; render(); });
    }

    const body = el(panel, 'div', 'body');
    if (tab === 'friends') return renderFriends(body);
    if (tab === 'stats') return renderStats(body, p);
    if (tab === 'badges') return renderBadgeWall(body);
    if (p) {
      const tile = statTile(el(body, 'div', 'stats'));
      const tiles = {
        place: tile(tr('Meilleure place', 'Best place'), '…'),
        official: tile(tr('Pistes officielles', 'Official tracks'), '…'),
        distance: tile(tr('Distance parcourue', 'Distance driven'), '…'),
        wins: tile(tr('Courses gagnées', 'Races won'), '…'),
      };
      profileStats(p).then(s => {
        fill(tiles.official, `${s.official} / ${OFFICIAL_TRACKS.length}`);
        tiles.official.title = tr('Pistes officielles bouclées au moins une fois, circuits du mod compris', 'Official tracks finished at least once, the mod\'s circuits included');
        fill(tiles.distance, number(s.metres / 1000), 'km');
        tiles.distance.title = tr('Comptée depuis la version 2.17, sur tous vos PC', 'Counted since version 2.17, on all your PCs');
        fill(tiles.wins, String(s.wins));
        tiles.wins.title = tr(`Mode Course en multijoueur : ${s.races} course${s.races > 1 ? 's' : ''} terminée${s.races > 1 ? 's' : ''} contre d'autres joueurs`,
          `Race mode in multiplayer: ${s.races} race${s.races === 1 ? '' : 's'} finished against other players`);
        tiles.place.title = tr('Sur les classements en ligne des circuits du mod', 'On the online boards of the mod\'s circuits');
        if (!s.circuits.length) return fill(tiles.place, '—');
        bestPlace(s.hash, s.circuits).then(best => fill(tiles.place, best ? 'P' + best.position : '—', best ? best.name : null));
      });
    }
    madeList(body, account?.name);

    if (account != null) {
      const [state, kind] = accountState();
      const line = el(body, 'p', 'state ' + kind);
      line.append(tr('Compte ', 'Account '), Object.assign(document.createElement('strong'), { textContent: account.name }), ' · ',
        syncing || lastError || lastSync == null ? (lastError || state) : tr('synchronisé ', 'synced ') + ago(lastSync));
      const row = el(body, 'div', 'row');
      el(row, 'button', null, tr('Modifier le profil', 'Edit profile')).addEventListener('click', editProfile);
      el(row, 'button', null, tr('Changer de profil', 'Switch profile')).addEventListener('click', switchProfile);
      const now = el(row, 'button', null, tr('Synchroniser', 'Sync now'));
      now.disabled = !!syncing;
      now.addEventListener('click', () => { sync().catch(() => {}); render(); });
      const security = el(row, 'button', account.recovery ? null : 'warn', tr('Sécurité', 'Security'));
      security.addEventListener('click', () => { securing = {}; render(); });
      el(row, 'button', null, tr('Se déconnecter', 'Log out')).addEventListener('click', () => logOut().then(render));
      if (!account.recovery) el(body, 'p', 'hint warn', tr('Pas encore de code de secours : sans lui, un mot de passe oublié ne se remplace pas. Créez-le dans Sécurité.',
        'No recovery code yet: without it, a forgotten password cannot be replaced. Make one in Security.'));
      el(body, 'p', 'hint', tr('Profils, records et fantômes, pistes perso et réglages suivent ce compte sur chaque PC où vous vous connectez. Se déconnecter garde tout sur ce PC.',
        'Profiles, records and ghosts, custom tracks and settings follow this account on every PC you log in on. Logging out keeps everything on this PC.'));
      return;
    }

    const row = el(body, 'div', 'row');
    el(row, 'button', null, tr('Modifier le profil', 'Edit profile')).addEventListener('click', editProfile);
    el(row, 'button', null, tr('Changer de profil', 'Switch profile')).addEventListener('click', switchProfile);
    el(body, 'h3', null, tr('Compte GoofyTrack', 'GoofyTrack account'));
    el(body, 'p', 'hint', tr('Connectez-vous pour retrouver vos profils, records, pistes perso et réglages sur tous vos PC.',
      'Log in to find your profiles, records, custom tracks and settings on all your PCs.'));
    const modes = el(body, 'div', 'tabs');
    for (const [m, label] of [['login', tr('Se connecter', 'Log in')], ['create', tr('Créer un compte', 'Create an account')]]) {
      const button = el(modes, 'button', m === mode ? 'active' : null, label);
      button.addEventListener('click', () => { mode = m; render(); });
    }
    if (mode === 'recover') return renderRecover(body);
    const form = el(body, 'form');
    const field = (label, type, autocomplete) => {
      const l = el(form, 'label', null, label);
      const input = el(l, 'input');
      Object.assign(input, { type, autocomplete, spellcheck: false, required: true });
      return input;
    };
    const name = field(tr('Pseudo', 'Name'), 'text', 'username');
    name.maxLength = 20;
    const password = field(tr('Mot de passe', 'Password'), 'password', mode === 'create' ? 'new-password' : 'current-password');
    const confirm = mode === 'create' ? field(tr('Confirmer le mot de passe', 'Confirm password'), 'password', 'new-password') : null;
    el(form, 'p', 'hint', mode === 'create'
      ? tr('3 à 20 lettres, chiffres, - _ ou point. La sauvegarde est chiffrée avec votre mot de passe : créez ensuite un code de secours (Sécurité) pour pouvoir le remplacer si vous l\'oubliez.',
        '3 to 20 letters, digits, - _ or dot. The save is encrypted with your password: then make a recovery code (Security) to replace it if you forget it.')
      : tr('Vos records, profils, pistes perso et réglages de ce PC sont fusionnés avec ceux du compte : rien n\'est perdu.',
        'This PC\'s records, profiles, custom tracks and settings are merged with the account\'s: nothing is lost.'));
    const status = el(form, 'p', 'state');
    const submit = el(form, 'button', 'primary', mode === 'create' ? tr('Créer le compte', 'Create account') : tr('Se connecter', 'Log in'));
    submit.type = 'submit';
    if (mode === 'login') {
      const forgot = el(form, 'button', 'link', tr('Mot de passe oublié ?', 'Forgot your password?'));
      forgot.type = 'button';
      forgot.addEventListener('click', () => { mode = 'recover'; render(); });
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      status.classList.remove('error');
      if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(name.value.trim())) { status.classList.add('error'); status.textContent = tr('Pseudo : 3 à 20 lettres, chiffres, - _ ou point.', 'Name: 3 to 20 letters, digits, - _ or dot.'); return; }
      if (mode === 'create' && password.value.length < 8) { status.classList.add('error'); status.textContent = tr('Mot de passe : 8 caractères au moins.', 'Password: 8 characters at least.'); return; }
      if (confirm && confirm.value !== password.value) { status.classList.add('error'); status.textContent = tr('Les mots de passe ne correspondent pas.', 'The passwords do not match.'); return; }
      submit.disabled = true;
      status.textContent = tr('Connexion… (le serveur peut mettre 30 s à se réveiller)', 'Connecting… (the server can take 30 s to wake up)');
      logIn(name.value, password.value, mode === 'create').catch(e => {
        submit.disabled = false;
        status.classList.add('error');
        status.textContent = e.message;
      });
    });
  }

  // a form of the account's views: its fields (label, type, autocomplete), a status line and its button
  function smallForm(parent, fields, label) {
    const form = el(parent, 'form');
    const inputs = fields.map(([text, type, autocomplete]) => {
      const l = el(form, 'label', null, text);
      const input = el(l, 'input');
      Object.assign(input, { type, autocomplete, spellcheck: false, required: true });
      return input;
    });
    const status = el(form, 'p', 'state');
    const submit = el(form, 'button', 'primary', label);
    submit.type = 'submit';
    const fail = text => { submit.disabled = false; status.className = 'state error'; status.textContent = text; };
    const busy = text => { submit.disabled = true; status.className = 'state'; status.textContent = text; };
    return { form, inputs, status, submit, fail, busy };
  }
  const newPasswordProblem = (password, confirm) => (password.length < 8 ? tr('Mot de passe : 8 caractères au moins.', 'Password: 8 characters at least.')
    : password !== confirm ? tr('Les mots de passe ne correspondent pas.', 'The passwords do not match.') : null);

  // login screen: a forgotten password, replaced with the recovery code
  function renderRecover(body) {
    el(body, 'p', 'hint', tr('Entrez le code de secours créé dans Sécurité, puis un nouveau mot de passe. Les autres PC du compte seront déconnectés.',
      'Enter the recovery code made in Security, then a new password. The account\'s other PCs will be logged out.'));
    const f = smallForm(body, [[tr('Pseudo', 'Name'), 'text', 'username'], [tr('Code de secours', 'Recovery code'), 'text', 'off'],
      [tr('Nouveau mot de passe', 'New password'), 'password', 'new-password'], [tr('Confirmer le mot de passe', 'Confirm password'), 'password', 'new-password']],
    tr('Remplacer le mot de passe', 'Replace the password'));
    const [name, code, password, confirm] = f.inputs;
    name.maxLength = 20;
    code.placeholder = 'XXXX-XXXX-XXXX-XXXX-XXXX';
    const back = el(f.form, 'button', 'link', tr('Retour à la connexion', 'Back to login'));
    back.type = 'button';
    back.addEventListener('click', () => { mode = 'login'; render(); });
    f.form.addEventListener('submit', event => {
      event.preventDefault();
      if (codeText(code.value).length !== 20) return f.fail(tr('Le code de secours a 20 lettres et chiffres.', 'The recovery code has 20 letters and digits.'));
      const problem = newPasswordProblem(password.value, confirm.value);
      if (problem) return f.fail(problem);
      f.busy(tr('Vérification… (le serveur peut mettre 30 s à se réveiller)', 'Checking… (the server can take 30 s to wake up)'));
      recoverAccount(name.value, code.value, password.value).catch(e => f.fail(e.status === 403 ? tr('Pseudo ou code de secours incorrect.', 'Wrong name or recovery code.') : e.message));
    });
  }

  // the account's security: its recovery code (made here, shown once) and its password
  function renderSecurity(panel) {
    overlay.dataset.view = 'security';
    const back = () => { securing = null; render(); };
    const header = el(panel, 'div', 'header');
    const who = el(header, 'div', 'who');
    el(who, 'h2', null, tr('Sécurité du compte', 'Account security'));
    el(who, 'div', 'country', account.name);
    const x = el(header, 'button', 'close', '✕');
    x.title = tr('Retour', 'Back');
    x.addEventListener('click', back);
    const body = el(panel, 'div', 'body');

    el(body, 'h3', null, tr('Code de secours', 'Recovery code'));
    if (securing.code) {
      el(body, 'p', 'hint', tr('Notez ce code maintenant et gardez-le à l\'abri : il ne sera plus affiché. Avec votre pseudo, il permet de remplacer un mot de passe oublié.',
        'Write this code down now and keep it safe: it will not be shown again. With your name, it replaces a forgotten password.'));
      const box = el(body, 'div', 'recovery-code', securing.code);
      box.title = tr('Cliquez pour copier', 'Click to copy');
      const row = el(body, 'div', 'row');
      const copyButton = el(row, 'button', null, tr('Copier', 'Copy'));
      const copied = el(row, 'span', 'hint');
      const copy = () => navigator.clipboard?.writeText(securing.code).then(() => { copied.textContent = tr('Copié !', 'Copied!'); }).catch(() => {});
      box.addEventListener('click', copy);
      copyButton.addEventListener('click', copy);
    } else {
      el(body, 'p', 'hint', account.recovery
        ? tr('Un code de secours est enregistré. En créer un nouveau remplace l\'ancien, qui ne marchera plus.', 'A recovery code is set. Making a new one replaces the old one, which stops working.')
        : tr('Aucun code de secours : si vous oubliez votre mot de passe, la copie en ligne de votre sauvegarde est perdue.', 'No recovery code: if you forget your password, the online copy of your save is lost.'));
      const status = el(body, 'p', 'state');
      const make = el(el(body, 'div', 'row'), 'button', account.recovery ? null : 'primary', account.recovery ? tr('Remplacer le code', 'Replace the code') : tr('Créer un code de secours', 'Make a recovery code'));
      make.addEventListener('click', async () => {
        make.disabled = true;
        status.className = 'state';
        status.textContent = tr('Création…', 'Making it…');
        try {
          const code = newRecoveryCode(), acc = account, rk = await recoveryKeys(acc.name, code);
          await call('POST', '/account/recovery', { recoveryAuth: rk.auth, wrap: await wrapKey(rk.key, acc.key) }, acc.session);
          acc.recovery = true;
          saveAccount();
          if (securing) { securing.code = code; render(); }
        } catch (e) { make.disabled = false; status.className = 'state error'; status.textContent = e.message; }
      });
    }

    el(body, 'h3', null, tr('Changer le mot de passe', 'Change the password'));
    const f = smallForm(body, [[tr('Mot de passe actuel', 'Current password'), 'password', 'current-password'],
      [tr('Nouveau mot de passe', 'New password'), 'password', 'new-password'], [tr('Confirmer le mot de passe', 'Confirm password'), 'password', 'new-password']],
    tr('Changer le mot de passe', 'Change the password'));
    const [current, password, confirm] = f.inputs;
    f.form.addEventListener('submit', async event => {
      event.preventDefault();
      const problem = newPasswordProblem(password.value, confirm.value);
      if (problem) return f.fail(problem);
      f.busy(tr('Changement…', 'Changing…'));
      try {
        const acc = account, now = await deriveKeys(acc.name, current.value), next = await deriveKeys(acc.name, password.value);
        await call('POST', '/account/password', { auth: now.auth, newAuth: next.auth, wrap: await wrapKey(next.key, acc.key) }, acc.session);
        f.form.reset();
        f.submit.disabled = false;
        f.status.className = 'state';
        f.status.textContent = tr('Mot de passe changé. Vos autres PC restent connectés.', 'Password changed. Your other PCs stay logged in.');
      } catch (e) { f.fail(e.status === 403 ? tr('Mot de passe actuel incorrect.', 'Wrong current password.') : e.message); }
    });
  }

  // the mod's tracks an account made, as chips
  function madeList(body, name) {
    const made = tracksBy(name);
    if (!made.length) return;
    el(body, 'h3', null, tr('Circuits créés', 'Tracks made') + ` · ${made.length}`);
    const list = el(body, 'div', 'made');
    for (const t of made) el(list, 'span', 'chip', t.name);
  }

  // ---------------------------------------------------------------- another player's card
  // who: an account name (a track's author) or number (a friend, a player of the room); from: 'friends' when
  // opened from the friends list, which the card then goes back to
  async function openPlayer(who, from = null) {
    const player = await fetchPlayer(who);
    if (player == null) {
      if (typeof who === 'number') notify(tr('Profil injoignable pour l\'instant.', 'This profile cannot be reached right now.'));
      return;
    }
    if (player.self) { viewing = null; tab = 'profile'; return overlay ? render() : open(); }   // your own: the profile card
    viewing = player;
    viewingFrom = from;
    if (overlay) render(); else open();
    // the card may be a minute old: refresh it (online, stats)
    players.delete(playerKey(who));
    fetchPlayer(who).then(fresh => { if (fresh && viewing?.id === fresh.id) { viewing = fresh; render(); } });
  }

  // ---------------------------------------------------------------- profile editor
  // The name, flag and badges, edited from the home screen. The name and flag go through the game's profiles
  // (window.GoofyGame, patch_bundle.js) and on to the PolyTrack server, as the game's own window would send
  // them: otherwise the server's older copy would come back at the next start.
  const COUNTRIES = 5569;        // webpack id of the game's country list (PolyTrack 0.6.3)
  let draft = null;              // { nickname, countryCode, badges, search, flagScroll, bodyScroll } being edited
  const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function countryList() {
    try { return gameModule(COUNTRIES).O().map(c => ({ code: c.code, name: c.name, local: countryName(c.code) })).sort((a, b) => a.local.localeCompare(b.local)); }
    catch (e) { console.warn('GoofyTrack profile: country list', e); return []; }
  }
  function renderEditor(panel) {
    const p = currentProfile();
    const first = draft == null;
    draft ??= { nickname: p?.nickname || '', countryCode: p?.countryCode || null, badges: pickedBadges(), bestTrack: get(BEST_KEY), frame: pickedFrame().id, search: '' };
    const back = () => { editing = false; draft = null; render(); };

    const header = el(panel, 'div', 'header');
    const car = el(header, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (p) showCar(car, p.carStyle);
    paintFrame(car, pickedFrame(draft.frame));     // the frame being picked, below
    const who = el(header, 'div', 'who');
    el(who, 'h2', null, tr('Modifier le profil', 'Edit profile'));
    el(who, 'div', 'country', tr('Pseudo, drapeau et badges', 'Name, flag and badges'));
    const x = el(header, 'button', 'close', '✕');
    x.title = tr('Retour', 'Back');
    x.addEventListener('click', back);

    const body = el(panel, 'div', 'body editor');
    const nameLabel = el(body, 'label', null, tr('Pseudo', 'Name'));
    const name = el(nameLabel, 'input');
    Object.assign(name, { type: 'text', value: draft.nickname, placeholder: 'Anonymous', spellcheck: false, maxLength: 32 });
    name.addEventListener('input', () => { draft.nickname = name.value; });
    el(body, 'p', 'hint', tr('Affiché dans les classements et en ligne.', 'Shown in the leaderboards and online.'));

    const flagTitle = el(body, 'h3', null, tr('Drapeau', 'Flag'));
    const flagPicked = el(flagTitle, 'span', 'picked');
    const search = el(body, 'input', 'flag-search');
    Object.assign(search, { type: 'search', placeholder: tr('Rechercher un pays', 'Search a country'), value: draft.search, spellcheck: false });
    const grid = el(body, 'div', 'flags');
    const countries = [{ code: null, name: 'None', local: tr('Aucun drapeau', 'No flag') }].concat(countryList());
    const fill = () => {
      flagPicked.textContent = ' · ' + (draft.countryCode ? countryName(draft.countryCode) : tr('aucun', 'none'));
      grid.textContent = '';
      const q = norm(draft.search);
      for (const c of countries) {
        if (q && !norm(c.local).includes(q) && !norm(c.name).includes(q)) continue;
        const b = el(grid, 'button', 'flag-option' + (c.code === draft.countryCode ? ' selected' : ''));
        if (c.code) flag(b, c.code);
        el(b, 'span', null, c.local);
        b.title = c.local;
        b.addEventListener('click', () => { draft.countryCode = c.code; fill(); });
      }
    };
    search.addEventListener('input', () => { draft.search = search.value; fill(); });
    fill();
    // the flag picked in view, inside the list only (not the whole panel); then where the player left it, as the
    // panel is drawn again (presence, sync)
    const picked = grid.querySelector('.selected');
    if (draft.flagScroll != null) grid.scrollTop = draft.flagScroll;
    else if (picked) grid.scrollTop = picked.offsetTop - grid.clientHeight / 2 + picked.offsetHeight / 2;
    const kept = draft;          // still there once the editor is closed (draft = null), as the list scrolls one last time
    grid.addEventListener('scroll', () => { kept.flagScroll = grid.scrollTop; });

    const badgesTitle = el(body, 'h3');
    const owned = ownedBadges();
    if (account == null) el(body, 'p', 'hint', tr('Connectez-vous à un compte GoofyTrack pour gagner des badges.', 'Log in to a GoofyTrack account to earn badges.'));
    else if (!owned.length) el(body, 'p', 'hint', tr('Pas encore de badge : roulez 500 km, ou montez sur le podium d\'un circuit du mod. Tous les badges sont dans l\'onglet Badges de votre carte.',
      'No badge yet: drive 500 km, or make the podium on a mod circuit. Every badge is on the Badges tab of your card.'));
    // redrawn in place, not with the whole panel: the flag list keeps its scroll and the flag picked in view
    const list = owned.length ? el(body, 'div', 'badge-list') : null;
    const fillBadges = () => {
      badgesTitle.textContent = tr('Badges', 'Badges') + ' · ' + draft.badges.length + ' / ' + MAX_BADGES;
      if (list == null) return;
      list.textContent = '';
      for (const id of owned) {
        const on = draft.badges.includes(id);
        const b = el(list, 'button', 'badge-option' + (on ? ' selected' : ''));
        badgeMarks(b, [id]);
        el(b, 'span', 'label', badgeInfo(id)?.label || id);
        b.disabled = !on && draft.badges.length >= MAX_BADGES;
        b.addEventListener('click', () => { draft.badges = on ? draft.badges.filter(other => other !== id) : [...draft.badges, id]; fillBadges(); });
      }
    };
    fillBadges();
    if (list) el(body, 'p', 'hint', tr('Deux au plus, à côté de votre pseudo. Un badge P1, P2 ou P3 dure tant que vous gardez votre place sur le podium.',
      'Two at most, next to your name. A P1, P2 or P3 badge lasts as long as you keep your place on the podium.'));

    // the frame: the colours for everyone, the frames won while their badge is owned (locked otherwise, with how to win them)
    const frameTitle = el(body, 'h3', null, tr('Cadre', 'Frame'));
    const framePicked = el(frameTitle, 'span', 'picked');
    const frames = el(body, 'div', 'frame-list');
    const fillFrames = () => {
      framePicked.textContent = ' · ' + frameLabel(pickedFrame(draft.frame));
      frames.textContent = '';
      for (const f of FRAMES) {
        const allowed = frameAllowed(f, owned);
        const b = el(frames, 'button', 'frame-option' + (f.id === pickedFrame(draft.frame).id ? ' selected' : '') + (allowed ? '' : ' locked'));
        b.style.setProperty('--apx-frame', f.ring.startsWith('#') ? `linear-gradient(${f.ring}, ${f.ring})` : f.ring);
        b.title = frameLabel(f) + (f.hint ? ' · ' + tr(f.hint[0], f.hint[1]) : '');
        b.disabled = !allowed;
        b.addEventListener('click', () => { draft.frame = f.id; fillFrames(); paintFrame(car, pickedFrame(draft.frame)); });
      }
    };
    fillFrames();

    // the best place shown on the card, when the player holds it on several circuits (the boards come a moment later)
    const placeBox = el(body, 'div');
    if (p) profileStats(p).then(s => boardPlaces(s.hash, s.circuits)).then(all => {
      const tied = tiedBest(all);
      if (tied.length < 2 || !placeBox.isConnected) return;
      el(placeBox, 'h3', null, tr('Meilleure place affichée', 'Best place shown'));
      const options = el(placeBox, 'div', 'badge-list');
      const fillPlaces = () => {
        options.textContent = '';
        const picked = tied.find(e => e.id === draft.bestTrack) || tied[0];
        for (const e of tied) {
          const b = el(options, 'button', 'badge-option' + (e === picked ? ' selected' : ''));
          el(b, 'span', 'label', 'P' + e.position + tr(' sur ', ' at ') + e.name);
          b.addEventListener('click', () => { draft.bestTrack = e.id; fillPlaces(); });
        }
      };
      fillPlaces();
      el(placeBox, 'p', 'hint', tr('Vous tenez cette place sur plusieurs circuits : choisissez celui que votre profil montre.',
        'You hold this place on several circuits: pick the one your profile shows.'));
    });

    const status = el(body, 'p', 'state');
    const actions = el(body, 'div', 'actions');
    el(actions, 'button', null, tr('Annuler', 'Cancel')).addEventListener('click', back);
    const save = el(actions, 'button', 'primary', tr('Enregistrer', 'Save'));
    save.addEventListener('click', () => {
      const nickname = draft.nickname.trim() || 'Anonymous';
      if (new TextEncoder().encode(nickname).length >= 50) { status.className = 'state error'; status.textContent = tr('Pseudo trop long.', 'Name too long.'); return; }
      saveProfile(nickname, draft.countryCode, draft.badges, draft.bestTrack, draft.frame);
      back();
    });
    if (draft.bodyScroll != null) body.scrollTop = draft.bodyScroll;
    body.addEventListener('scroll', () => { kept.bodyScroll = body.scrollTop; });
    if (first) name.focus();
  }

  function saveProfile(nickname, countryCode, badges, bestTrack, frame) {
    // the badges first: a game that fails on the name or flag must not lose them
    try {
      storage.setItem(BADGES_KEY, JSON.stringify(badges));      // watched: synced
      if (bestTrack && bestTrack !== get(BEST_KEY)) storage.setItem(BEST_KEY, bestTrack);
      if (frame && frame !== get(FRAME_KEY)) storage.setItem(FRAME_KEY, frame);
    } catch (e) { /* storage full */ }
    try {
      const game = window.GoofyGame;
      const before = game.profiles.getCurrentUserProfile();
      if (before.nickname !== nickname || before.countryCode !== countryCode) {
        game.profiles.setNickname(nickname);
        game.profiles.setCountryCode(countryCode);
        const p = game.profiles.getCurrentUserProfile();
        Promise.resolve(game.api?.submitUserProfile(p.token, p.nickname, p.countryCode, p.carStyle)).catch(e => console.warn('GoofyTrack profile: PolyTrack server', e));
      }
    } catch (e) { console.warn('GoofyTrack profile: name and flag', e); }
    scheduleBadge();
    sendPresence();      // friends see the new name, flag and badges at once
  }

  function renderPlayer(panel, v) {
    overlay.dataset.view = 'player';
    if (viewingFrom === 'friends') {
      const back = el(panel, 'button', 'back', '← ' + tr('Amis', 'Friends'));
      back.addEventListener('click', () => { viewing = null; viewingFrom = null; tab = 'friends'; render(); });
    }
    const header = el(panel, 'div', 'header');
    const car = el(header, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (v.carStyle) showCar(car, v.carStyle, false);
    paintFrame(car, v.self ? pickedFrame() : frameById(v.frame));
    const who = el(header, 'div', 'who');
    const title = el(who, 'h2');
    el(title, 'span', null, v.nickname);
    badgeMarks(title, v.self ? pickedBadges() : badgesOfPlayer(v));
    const country = el(who, 'div', 'country');
    if (v.countryCode) { flag(country, v.countryCode); el(country, 'span', null, countryName(v.countryCode)); }
    el(who, 'span', 'player-id', idText(v.id));
    const closeButton = el(header, 'button', 'close', '✕');
    closeButton.title = tr('Fermer', 'Close');
    closeButton.addEventListener('click', close);

    const body = el(panel, 'div', 'body');
    const line = el(body, 'p', 'state');
    line.append(tr('Compte ', 'Account '), Object.assign(document.createElement('strong'), { textContent: v.name }), ' · ' + stateText(v));
    // the friend actions first: the stats run long
    const row = el(body, 'div', 'row');
    if (account == null) {
      el(body, 'p', 'hint', tr('Connectez-vous à un compte GoofyTrack pour ajouter ce joueur en ami.', 'Log in to a GoofyTrack account to add this player as a friend.'));
    } else if (v.friend) {
      el(row, 'span', 'tag', tr('Vous êtes amis', 'You are friends'));
      if (v.room && homeReady()) el(row, 'button', 'primary', tr('Rejoindre sa room', 'Join their room')).addEventListener('click', () => joinRoom(v.room));
    } else if (v.requested) {
      el(row, 'span', 'tag', tr('Demande d\'ami envoyée', 'Friend request sent'));
    } else {
      // they asked first (a server older than 2.20.2 does not say): adding them makes you friends
      const add = el(row, 'button', 'primary', v.asked ? tr('Accepter sa demande d\'ami', 'Accept their friend request') : tr('Ajouter en ami', 'Add as a friend'));
      add.addEventListener('click', () => {
        add.disabled = true;
        friendsCall('POST', { action: 'add', id: v.id })
          .then(out => { viewing = { ...v, friend: !!out.friends, requested: !out.friends }; render(); sendPresence(); })
          .catch(() => { add.disabled = false; });
      });
    }

    statSections(body, v.stats || {}, v.best || null);
    if (v.stats && v.stats.metres == null) {
      el(body, 'p', 'hint', tr('Distance, temps, vitesse et courses : visibles quand ce joueur aura lancé GoofyTrack 2.20.2.',
        'Distance, time, speed and races: shown once this player has started GoofyTrack 2.20.2.'));
    }
    madeList(body, v.name);
  }

  // ---------------------------------------------------------------- friends tab
  let friendsTimer = null, removing = null;
  function renderFriends(body) {
    if (account == null) {
      el(body, 'p', 'hint', tr('Connectez-vous à un compte GoofyTrack pour ajouter vos amis, voir qui joue et rejoindre leurs rooms en un clic.',
        'Log in to a GoofyTrack account to add your friends, see who is playing and join their rooms in one click.'));
      el(el(body, 'div', 'row'), 'button', 'primary', tr('Se connecter', 'Log in')).addEventListener('click', () => { tab = 'profile'; render(); });
      return;
    }
    const form = el(body, 'form', 'add-friend');
    const input = el(form, 'input');
    Object.assign(input, { type: 'text', placeholder: tr('Numéro d\'un ami, ex. #0002', 'A friend\'s number, e.g. #0002'), maxLength: 8, spellcheck: false, autocomplete: 'off' });
    const add = el(form, 'button', 'primary', tr('Ajouter', 'Add'));
    add.type = 'submit';
    const status = el(body, 'p', 'state');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const id = input.value.trim().replace(/^#/, '');
      status.className = 'state';
      if (!/^\d{1,6}$/.test(id)) { status.classList.add('error'); status.textContent = tr('Entrez le numéro d\'un joueur, par exemple #0002.', 'Enter a player\'s number, e.g. #0002.'); return; }
      add.disabled = true;
      friendsCall('POST', { action: 'add', id: Number(id) })
        .then(out => { status.textContent = out.friends ? tr('Vous êtes maintenant amis.', 'You are now friends.') : tr('Demande envoyée.', 'Request sent.'); input.value = ''; loadFriends(); })
        .catch(e => {
          status.classList.add('error');
          status.textContent = e.status === 404 ? tr('Aucun joueur avec ce numéro.', 'No player with this number.')
            : e.status === 400 ? tr('C\'est votre propre numéro.', 'That is your own number.') : e.message;
        })
        .finally(() => { add.disabled = false; });
    });
    el(body, 'div', 'friends-list', tr('Chargement…', 'Loading…'));
    loadFriends();
  }

  const STATE_ORDER = { hosting: 0, room: 0, menu: 1, playing: 1, offline: 2 };
  const stateText = f => (f.state === 'hosting' ? tr('Héberge une room', 'Hosting a room')
    : f.state === 'room' ? tr('Dans une room', 'In a room')
    : f.state === 'menu' ? tr('En ligne', 'Online')
    : f.state === 'playing' ? tr('En jeu', 'Playing')
    : f.lastSeen ? tr('Vu ', 'Seen ') + ago(f.lastSeen) : tr('Hors ligne', 'Offline'));

  // the list follows itself every 10 s while it is shown
  async function loadFriends() {
    clearTimeout(friendsTimer);
    if (overlay == null || tab !== 'friends' || account == null) return;
    friendsTimer = setTimeout(loadFriends, 10000);
    let data;
    try { data = await friendsCall('GET'); } catch (e) {
      const list = overlay?.querySelector('.friends-list');
      if (list) { list.textContent = ''; el(list, 'p', 'state error', e.message); }
      return;
    }
    const list = overlay?.querySelector('.friends-list');
    if (list == null || tab !== 'friends') return;
    list.textContent = '';
    if (social.requests !== data.requests.length) { social.requests = data.requests.length; scheduleBadge(); }
    const act = (action, id) => friendsCall('POST', { action, id }).catch(() => {}).then(loadFriends);

    if (data.requests.length) {
      el(list, 'h3', null, tr('Demandes reçues', 'Friend requests'));
      for (const r of data.requests) friendRow(list, r, [[tr('Accepter', 'Accept'), 'primary', () => act('accept', r.id)], [tr('Refuser', 'Decline'), null, () => act('decline', r.id)]]);
    }
    const online = data.friends.filter(f => f.online).length;
    el(list, 'h3', null, tr('Amis', 'Friends') + ` · ${online} ${tr('en ligne', 'online')}`);
    if (!data.friends.length) {
      el(list, 'p', 'hint', tr(`Pas encore d'amis : donnez votre numéro ${idText(account.id)} à vos amis, ou ajoutez le leur ci-dessus.`,
        `No friends yet: give your number ${idText(account.id)} to your friends, or add theirs above.`));
    }
    data.friends.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.nickname.localeCompare(b.nickname));
    for (const f of data.friends) {
      const actions = [];
      if (f.room) actions.push([tr('Rejoindre', 'Join'), 'primary', () => joinRoom(f.room)]);
      // removing takes a second click
      actions.push(removing === f.id
        ? [tr('Retirer ?', 'Remove?'), 'danger', () => { removing = null; act('remove', f.id); }]
        : ['✕', 'remove', () => { removing = f.id; loadFriends(); }]);
      friendRow(list, f, actions);
    }
    if (data.sent.length) {
      el(list, 'h3', null, tr('Demandes envoyées', 'Requests sent'));
      for (const s of data.sent) friendRow(list, s, [[tr('Annuler', 'Cancel'), null, () => act('cancel', s.id)]]);
    }
  }

  function friendRow(list, f, actions) {
    const row = el(list, 'div', 'friend ' + f.state);
    // a click (not on its buttons) opens the player's card
    row.tabIndex = 0;
    row.title = tr('Voir le profil de ', 'See the profile of ') + f.nickname;
    const show = event => { if (event.target.closest('button') == null) openPlayer(f.id, 'friends'); };
    row.addEventListener('click', show);
    row.addEventListener('keydown', event => { if (event.key === 'Enter') show(event); });
    const car = el(row, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (f.carStyle && homeReady()) showCar(car, f.carStyle, false);
    if (f.frame && f.frame !== FRAMES[0].id) paintFrame(car, frameById(f.frame));   // the friends list rings only a frame picked
    const text = el(row, 'div', 'text');
    const name = el(text, 'div', 'name');
    flag(name, f.countryCode);
    el(name, 'span', null, f.nickname);
    badgeMarks(name, badgesOfPlayer(f));
    el(text, 'div', 'sub', `${f.name} · ${idText(f.id)}`);
    el(text, 'div', 'presence ' + f.state, stateText(f));
    const buttons = el(row, 'div', 'actions');
    for (const [label, className, action] of actions) {
      const b = el(buttons, 'button', className, label);
      if (label === '✕') b.title = tr('Retirer de vos amis', 'Remove from your friends');
      b.addEventListener('click', action);
    }
  }

  function open() {
    if (overlay != null) return;
    overlay = document.createElement('div');
    overlay.className = 'apex-account';
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    // typing a name must not drive the game
    for (const type of ['keydown', 'keyup', 'keypress']) overlay.addEventListener(type, event => { if (event.key !== 'Escape') event.stopPropagation(); });
    el(overlay, 'div', 'panel');
    document.getElementById('ui').appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  // the account view follows the sync; the login form and the friends tab are left alone (what is typed in
  // them stays; the friends list follows itself), unless the player was logged out meanwhile
  function refresh() {
    scheduleBadge();
    if (overlay == null) return;
    if (overlay.dataset.view === 'account' && account == null) return render();
    if (tab === 'profile' && account != null) render();
  }

  const STYLE = `
#ui .menu-ui > .apex-profile {
  position: absolute; z-index: 3; top: 16px; left: calc(16px + var(--safe-area-horizontal, 0px));
  display: flex; align-items: center; gap: 12px; max-width: 320px; padding: 6px 20px 6px 6px; cursor: pointer; outline: none;
  border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif); text-align: left; pointer-events: auto;
  transition: background-color 0.15s;
}
#ui .menu-ui > .apex-profile:hover, #ui .menu-ui > .apex-profile:focus-visible { background-color: var(--apx-ink-700, #222835); }
/* the home screen only: not while it loads, nor over the track selection */
#ui .menu-ui.loading-screen > .apex-profile, #ui .menu-ui:has(> .main-buttons-container.hidden) > .apex-profile { display: none; }
#ui .apex-profile .car, #ui .apex-account .header .car {
  flex: none; width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
  background: radial-gradient(circle at 50% 45%, #4a5266, #1c2029 75%); box-shadow: 0 0 0 2px var(--apx-accent, #f20d16);
}
/* the frame picked (paintFrame): a ring drawn by the border, which takes gradients */
#ui .apex-profile img.car.framed, #ui .apex-account img.car.framed {
  margin: -2px; border: 2px solid transparent; box-shadow: none;
  background: radial-gradient(circle at 50% 45%, #4a5266, #1c2029 75%) padding-box, var(--apx-frame) border-box;
}
#ui .apex-profile img.car.glow-gold, #ui .apex-account img.car.glow-gold { box-shadow: 0 0 10px rgba(242, 194, 48, 0.55); }
#ui .apex-profile img.car.glow-vip, #ui .apex-account img.car.glow-vip { animation: apx-frame-vip 2.8s ease-in-out infinite; }
@keyframes apx-frame-vip { 0%, 100% { box-shadow: 0 0 6px rgba(180, 92, 255, 0.55); } 50% { box-shadow: 0 0 14px rgba(255, 95, 168, 0.85); } }
@media (prefers-reduced-motion: reduce) { #ui .car.glow-vip { animation: none; box-shadow: 0 0 8px rgba(180, 92, 255, 0.6); } }
#ui .apex-account button.warn { box-shadow: inset 0 0 0 1px var(--apx-warn, #f5a524); }
#ui .apex-account .hint.warn { color: var(--apx-warn, #f5a524); }
#ui .apex-account button.link { align-self: flex-start; padding: 2px 0; background: none; font-size: 13px; text-decoration: underline; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account button.link:hover:not(:disabled) { background: none; color: var(--apx-fg, #f3f5f8); }
#ui .apex-account .recovery-code {
  margin: 4px 0 10px 0; padding: 14px; border-radius: var(--apx-r-md, 12px); text-align: center; cursor: copy; user-select: all;
  font-family: ui-monospace, Consolas, monospace; font-size: 20px; font-weight: 700; letter-spacing: 0.08em;
  background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09));
}
#ui .apex-account .frame-list { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
#ui .apex-account .frame-option {
  width: 38px; height: 38px; padding: 0; border-radius: 50%; border: 4px solid transparent;
  background: linear-gradient(#1c2029, #1c2029) padding-box, var(--apx-frame) border-box;   /* a plain colour is only allowed in the last layer */
}
#ui .apex-account .frame-option:hover:not(:disabled) { background: linear-gradient(#2a3040, #2a3040) padding-box, var(--apx-frame) border-box; }
#ui .apex-account .frame-option.selected { outline: 2px solid var(--apx-fg, #f3f5f8); outline-offset: 3px; }
#ui .apex-account button.frame-option.locked { opacity: 0.3; cursor: not-allowed; }
#ui .apex-profile .text { min-width: 0; }
#ui .apex-profile .name { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
#ui .apex-profile .name > span { overflow: hidden; text-overflow: ellipsis; }
#ui .apex-profile .flag, #ui .apex-account .flag { flex: none; width: 22px; height: auto; border-radius: 3px; }
#ui .apex-profile .status { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 13px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-profile .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background-color: #3ccf6e; }
#ui .apex-profile .status.busy::before { background-color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-profile .status.offline::before { background-color: var(--apx-warn, #f5a524); }
#ui .apex-profile .status.out { color: var(--apx-accent, #f20d16); font-weight: 600; }
#ui .apex-profile .status.out::before { display: none; }

#ui .apex-account {
  position: absolute; inset: 0; z-index: 100; display: flex; align-items: flex-start; justify-content: flex-start;
  padding: 84px 16px 16px calc(16px + var(--safe-area-horizontal, 0px)); box-sizing: border-box;
  background-color: rgba(0, 0, 0, 0.35); pointer-events: auto;
}
#ui .apex-account > .panel {
  display: flex; flex-direction: column; width: min(400px, calc(100% - 32px)); max-height: 100%;
  border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--apx-blur, blur(22px)); color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif); text-align: left;
}
#ui .apex-account .header { display: flex; align-items: center; gap: 16px; padding: 20px 20px 16px 22px; border-bottom: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09)); }
#ui .apex-account .header .car { width: 88px; height: 88px; border-radius: var(--apx-r-md, 12px); }
#ui .apex-account .who { flex: 1; min-width: 0; }
#ui .apex-account h2 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; letter-spacing: 0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui .apex-account h3 { margin: 18px 0 6px 0; font-size: 14px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
#ui .apex-account .country { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .header .close { align-self: flex-start; }
#ui .apex-account .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
#ui .apex-account .stat { padding: 10px 12px; border-radius: var(--apx-r-md, 12px); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-account .stat .label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .stat .value { margin-top: 2px; font-size: 22px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ui .apex-account .stat .sub { margin-left: 8px; font-size: 13px; font-weight: 400; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .board-places { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
#ui .apex-account .board-place { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--apx-r-md, 12px); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-account .board-place .pos { min-width: 44px; font-weight: 700; }
#ui .apex-account .board-place.p1 .pos { color: #f2c230; }
#ui .apex-account .board-place.p2 .pos { color: #cdd3dc; }
#ui .apex-account .board-place.p3 .pos { color: #cd8540; }
#ui .apex-account button {
  padding: 9px 16px; border: none; border-radius: var(--apx-r-pill, 999px); cursor: pointer; font: inherit; font-size: 14px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-account button:hover:not(:disabled) { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-account button:disabled { opacity: 0.5; cursor: default; }
#ui .apex-account button.primary { color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16); font-weight: 600; }
#ui .apex-account button.primary:hover:not(:disabled) { filter: brightness(1.12); background-color: var(--apx-accent, #f20d16); }
#ui .apex-account .close { width: 36px; height: 36px; padding: 0; border-radius: 50%; font-size: 16px; }
#ui .apex-account .body { overflow-y: auto; padding: 16px 22px 20px 22px; font-size: 15px; }
#ui .apex-account .tabs { display: flex; gap: 6px; margin: 10px 0 14px 0; padding: 4px; border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-account .tabs button { flex: 1; background: none; }
#ui .apex-account .tabs button.active { background-color: var(--apx-ink-700, #222835); font-weight: 600; }
#ui .apex-account form { display: flex; flex-direction: column; gap: 12px; }
#ui .apex-account label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account input {
  padding: 10px 14px; border: none; border-radius: var(--apx-r-md, 12px); outline: none; font: inherit; font-size: 16px;
  text-transform: none; letter-spacing: normal; user-select: text;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09));
}
#ui .apex-account input:focus { box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16); }
#ui .apex-account p { margin: 0 0 12px 0; line-height: 1.45; }
#ui .apex-account form p { margin: 0; }
#ui .apex-account .hint { font-size: 13px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .state { min-height: 1.45em; font-size: 14px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .state strong { color: var(--apx-fg, #f3f5f8); }
#ui .apex-account .state.error, #ui .apex-account .state.offline { color: #ff6b6b; }
#ui .apex-account .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 12px 0; }
#ui .apex-profile .verified, #ui .apex-account .verified { flex: none; display: inline-flex; width: 18px; height: 18px; color: #f5c518; }
#ui .apex-account h2 .verified { width: 22px; height: 22px; }
#ui .apex-profile .verified.vip, #ui .apex-account .verified.vip, #ui .track-info-ui .verified.vip {
  filter: drop-shadow(0 0 3px rgba(228, 92, 240, 0.55)); animation: apx-vip-glow 2.8s ease-in-out infinite;
}
@keyframes apx-vip-glow { 50% { filter: drop-shadow(0 0 6px rgba(255, 111, 174, 0.9)); } }
@media (prefers-reduced-motion: reduce) { #ui .verified.vip { animation: none; } }
#ui .apex-profile .verified svg, #ui .apex-account .verified svg { width: 100%; height: 100%; }
#ui .apex-account h2 { display: flex; align-items: center; gap: 8px; }
#ui .apex-profile .badge-podium, #ui .apex-account .badge-podium, #ui .track-info-ui .badge-podium {
  flex: none; display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px 0 4px; box-sizing: border-box;
  border-radius: 6px; background: linear-gradient(160deg, #ffe58a 0%, #f2c230 45%, #c48f0a 100%); color: #2a1d02;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.4);
  font-size: 12px; font-weight: 800; letter-spacing: 0.03em; line-height: 1; white-space: nowrap; text-transform: none; cursor: default;
}
#ui .apex-profile .badge-podium svg, #ui .apex-account .badge-podium svg, #ui .track-info-ui .badge-podium svg { width: 15px; height: 15px; flex: none; }
#ui .apex-profile .badge-podium path, #ui .apex-account .badge-podium path, #ui .track-info-ui .badge-podium path {
  fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round;
}
#ui .apex-profile .badge-podium.p2, #ui .apex-account .badge-podium.p2, #ui .track-info-ui .badge-podium.p2 {
  background: linear-gradient(160deg, #ffffff 0%, #cdd3dc 45%, #8b95a3 100%); color: #1b2129;
}
#ui .apex-profile .badge-podium.p3, #ui .apex-account .badge-podium.p3, #ui .track-info-ui .badge-podium.p3 {
  background: linear-gradient(160deg, #f6cfa6 0%, #cd8540 45%, #8c4f1c 100%); color: #2b1505;
}
#ui .apex-account h2 .badge-podium { height: 24px; padding: 0 8px 0 5px; font-size: 14px; }
#ui .apex-account h2 .badge-podium svg { width: 19px; height: 19px; }
/* distance badges (badgeMarks): the podium's shape, a road, the tier's colour */
#ui .apex-profile .badge-km, #ui .apex-account .badge-km, #ui .track-info-ui .badge-km, #ui .apex-badge-toast .badge-km {
  flex: none; display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px 0 4px; box-sizing: border-box;
  border-radius: 6px; color: #fff; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 0 -1px 0 rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.4);
  font-size: 12px; font-weight: 800; letter-spacing: 0.03em; line-height: 1; white-space: nowrap; text-transform: none; cursor: default;
}
#ui .badge-km svg { width: 15px; height: 15px; flex: none; }
#ui .badge-km path { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
#ui .badge-km.green { background: linear-gradient(160deg, #8ef5ae 0%, #2ecc71 45%, #13813f 100%); color: #03200e; text-shadow: none; }
#ui .badge-km.blue { background: linear-gradient(160deg, #a9cdff 0%, #2f7bff 45%, #1546a8 100%); }
#ui .badge-km.purple { background: linear-gradient(160deg, #d6bcff 0%, #9b5cff 45%, #5a2bb3 100%); }
#ui .badge-km.gold { background: linear-gradient(160deg, #ffe58a 0%, #f2c230 45%, #c48f0a 100%); color: #2a1d02; text-shadow: none; }
#ui .badge-km.red { background: linear-gradient(160deg, #ffa3a3 0%, #f20d16 45%, #8f070c 100%); }
#ui .badge-km.world { background: linear-gradient(120deg, #2ecc71, #2f7bff 35%, #9b5cff 60%, #ff5fa8 80%, #f5c518); animation: apx-world-glow 2.8s ease-in-out infinite; }
/* the TGV record: the V150's silver, steel blue and violet, a light running along it */
#ui .badge-km.tgv { background: linear-gradient(100deg, #5a2bb3 0%, #2f5fd0 30%, #c9d3e6 55%, #2f5fd0 80%, #5a2bb3 100%); background-size: 220% 100%; animation: apx-tgv-run 2.2s linear infinite; }
@keyframes apx-tgv-run { from { background-position: 100% 0; } to { background-position: -120% 0; } }
@keyframes apx-world-glow { 50% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 0 9px rgba(155, 92, 255, 0.85); } }
@media (prefers-reduced-motion: reduce) { #ui .badge-km.world, #ui .badge-km.tgv { animation: none; } }
#ui .apex-account h2 .badge-km { height: 24px; padding: 0 8px 0 5px; font-size: 14px; }
#ui .apex-account h2 .badge-km svg { width: 19px; height: 19px; }
/* the Badges tab (renderBadgeWall) */
#ui .apex-account .badge-wall { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
#ui .apex-account .badge-tile {
  display: flex; align-items: flex-start; gap: 12px; width: 100%; box-sizing: border-box; padding: 10px 12px; border: none;
  border-radius: var(--apx-r-md, 12px); text-align: left; font: inherit; color: var(--apx-fg, #f3f5f8);
  background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-account button.badge-tile { cursor: pointer; }
#ui .apex-account button.badge-tile:hover { background-color: var(--apx-ink-700, #222835); }
#ui .apex-account .badge-tile .mark { flex: none; display: flex; min-width: 58px; padding-top: 1px; }
#ui .apex-account .badge-tile .text { flex: 1; min-width: 0; }
#ui .apex-account .badge-tile .name { font-size: 15px; font-weight: 700; }
#ui .apex-account .badge-tile .how { font-size: 12px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .badge-tile .progress { height: 4px; margin: 6px 0 3px 0; border-radius: 2px; overflow: hidden; background-color: rgba(255, 255, 255, 0.1); }
#ui .apex-account .badge-tile .progress span { display: block; height: 100%; border-radius: 2px; background-color: var(--apx-accent, #f20d16); }
#ui .apex-account .badge-tile .shown { margin-top: 3px; font-size: 12px; font-weight: 700; color: var(--apx-accent, #f20d16); }
#ui .apex-account .badge-tile.locked .mark, #ui .apex-account .badge-circuit .place.locked { filter: grayscale(1); opacity: 0.35; }
#ui .apex-account .badge-tile.selected, #ui .apex-account .badge-circuit .place.selected {
  background-color: var(--apx-accent-soft, rgba(242, 13, 22, 0.18)); box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16);
}
#ui .apex-account .badge-circuits { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
#ui .apex-account .badge-circuit {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; border-radius: var(--apx-r-md, 12px);
  background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-account .badge-circuit .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--apx-fg, #f3f5f8); }
#ui .apex-account .badge-circuit .place { display: inline-flex; padding: 4px; border: none; border-radius: 8px; background: none; }
#ui .apex-account .badge-circuit button.place { cursor: pointer; }
#ui .apex-account .badge-circuit button.place:hover { background-color: var(--apx-ink-700, #222835); }
#ui .apex-account .badge-tile .badge-podium, #ui .apex-account .badge-tile .badge-km, #ui .apex-account .badge-tile .verified,
#ui .apex-account .badge-circuit .badge-podium { cursor: inherit; }
/* a badge just won (announceBadge): at the top of the screen, a few seconds */
#ui .apex-badge-toast {
  position: absolute; top: 22px; left: 50%; z-index: 102; transform: translateX(-50%); display: flex; align-items: center; gap: 16px;
  padding: 12px 22px 12px 16px; border-radius: 16px; pointer-events: auto; cursor: pointer; font-family: var(--apx-font, sans-serif);
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), 0 0 0 2px var(--apx-accent, #f20d16), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  animation: apx-badge-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1); transition: opacity 0.5s, transform 0.5s;
}
#ui .apex-badge-toast.gone { opacity: 0; transform: translate(-50%, -14px); }
@keyframes apx-badge-in { from { opacity: 0; transform: translate(-50%, -18px) scale(0.92); } }
@media (prefers-reduced-motion: reduce) { #ui .apex-badge-toast { animation: none; transition: none; } }
#ui .apex-badge-toast .mark { display: flex; padding: 0 12px; }
#ui .apex-badge-toast .mark .badge-km { transform: scale(1.7); }
#ui .apex-badge-toast .title { font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--apx-accent, #f20d16); }
#ui .apex-badge-toast .name { font-size: 19px; font-weight: 800; }
#ui .apex-badge-toast .sub { font-size: 13px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .editor h3 { margin-top: 16px; }
#ui .apex-account .editor .flag-search { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
#ui .apex-account .editor h3 .picked { font-weight: 400; letter-spacing: 0.04em; text-transform: none; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-account .flags { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; max-height: 210px; overflow-y: auto; margin-bottom: 4px; padding-right: 4px; }
#ui .apex-account .flag-option, #ui .apex-account .badge-option {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border-radius: var(--apx-r-md, 12px); text-align: left;
}
#ui .apex-account .flag-option span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui .apex-account .flag-option.selected, #ui .apex-account .badge-option.selected {
  background-color: var(--apx-accent-soft, rgba(242, 13, 22, 0.18)); box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16);
}
#ui .apex-account .badge-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
#ui .apex-account .editor .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
#ui .apex-account h2 > span:first-child { overflow: hidden; text-overflow: ellipsis; }
#ui .apex-account .player-id {
  margin-top: 8px; padding: 3px 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.08em;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-ink-700, #222835);
}
#ui .apex-account span.player-id { display: inline-block; padding: 3px 10px; border-radius: var(--apx-r-pill, 999px); }
#ui .apex-account .made { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
#ui .apex-account .made .chip, #ui .apex-account .tag {
  padding: 5px 12px; border-radius: var(--apx-r-pill, 999px); font-size: 13px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .track-info-ui .track-author > span.apex-author {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer; pointer-events: auto;
  text-decoration: underline; text-decoration-color: var(--apx-accent, #f20d16); text-underline-offset: 3px;
}
#ui .track-info-ui .track-author > span.apex-author:hover { color: var(--apx-accent, #f20d16); }
#ui .track-info-ui .track-author .verified { display: inline-flex; width: 16px; height: 16px; color: #f5c518; }
#ui .track-info-ui .track-author .verified svg { width: 100%; height: 100%; }
#ui .apex-account .card-tabs { display: flex; gap: 6px; margin: 12px 22px 0 22px; padding: 4px; border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-account .card-tabs button { flex: 1; background: none; }
#ui .apex-account .card-tabs button.active { background-color: var(--apx-ink-700, #222835); font-weight: 600; }
#ui .apex-account .card-tabs .count {
  display: inline-block; min-width: 18px; margin-left: 8px; padding: 1px 5px; border-radius: 999px; box-sizing: border-box;
  font-size: 12px; font-weight: 700; color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16);
}
#ui .apex-account .add-friend { flex-direction: row; gap: 8px; margin-bottom: 6px; }
#ui .apex-account .add-friend input { flex: 1; min-width: 0; font-size: 15px; }
#ui .apex-account .friends-list { color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); font-size: 14px; }
#ui .apex-account .friends-list h3 { margin: 14px 0 8px 0; color: var(--apx-fg, #f3f5f8); }
#ui .apex-account .friend { display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin-bottom: 6px; border-radius: var(--apx-r-md, 12px); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-account .friend { cursor: pointer; outline: none; transition: background-color 0.15s; }
#ui .apex-account .friend:hover, #ui .apex-account .friend:focus-visible { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-account > .panel > .back {
  align-self: flex-start; margin: 12px 0 -6px 16px; padding: 5px 12px; font-size: 13px; border-radius: var(--apx-r-pill, 999px);
}
#ui .apex-account .friend .car {
  flex: none; width: 46px; height: 46px; border-radius: 50%; object-fit: cover;
  background: radial-gradient(circle at 50% 45%, #4a5266, #1c2029 75%);
}
#ui .apex-account .friend.offline .car { opacity: 0.55; }
#ui .apex-account .friend .text { flex: 1; min-width: 0; }
#ui .apex-account .friend .name { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--apx-fg, #f3f5f8); white-space: nowrap; }
#ui .apex-account .friend .name > span:not(.verified) { overflow: hidden; text-overflow: ellipsis; }
#ui .apex-account .friend .flag { width: 18px; }
#ui .apex-account .friend .sub { font-size: 12px; }
#ui .apex-account .friend .presence { display: flex; align-items: center; gap: 6px; font-size: 12px; }
#ui .apex-account .friend .presence::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background-color: var(--apx-fg-subtle, rgba(243, 245, 248, 0.35)); }
#ui .apex-account .friend .presence.menu::before, #ui .apex-account .friend .presence.playing::before { background-color: #3ccf6e; }
#ui .apex-account .friend .presence.hosting { color: var(--apx-fg, #f3f5f8); font-weight: 600; }
#ui .apex-account .friend .presence.hosting::before { background-color: var(--apx-accent, #f20d16); }
#ui .apex-account .friend .actions { display: flex; gap: 6px; }
#ui .apex-account .friend .actions button { padding: 7px 12px; font-size: 13px; }
#ui .apex-account .friend .actions .remove { width: 30px; height: 30px; padding: 0; border-radius: 50%; }
#ui .apex-account .friend .actions .danger { color: #fff; background-color: #b3261e; }
#ui .menu-ui > .apex-profile.requests::after {
  content: ""; position: absolute; top: 4px; left: 48px; width: 12px; height: 12px; border-radius: 50%;
  background-color: var(--apx-accent, #f20d16); box-shadow: 0 0 0 2px var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
}
#ui .apex-account-toast {
  position: absolute; left: 50%; bottom: 24px; z-index: 101; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
  padding: 10px 12px 10px 20px; border-radius: var(--apx-r-pill, 999px); pointer-events: auto; font-family: var(--apx-font, sans-serif); font-size: 15px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
}
#ui .apex-account-toast button {
  padding: 6px 14px; border: none; border-radius: var(--apx-r-pill, 999px); cursor: pointer; font: inherit; font-size: 14px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-account-toast button:first-of-type { color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16); }
#ui .apex-account-toast button:last-of-type { color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
`;

  window.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(document.createElement('style')).textContent = STYLE;
    // the badge comes with the home screen, and its car once the home screen's buttons are shown
    let shown = null;
    new MutationObserver(() => {
      addBadge();
      linkAuthor();
      const now = homeReady();
      if (now !== shown) { shown = now; scheduleBadge(); sendPresence(); }   // friends see whether the player is in the menu
    }).observe(document.getElementById('ui'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  setInterval(() => { if (overlay != null && account != null && tab === 'profile' && !syncing) render(); }, 30000);   // "synced x min ago"

  window.ApexAccount = {
    ready, sync, open,
    presence: () => sendPresence(),          // the room changed (apex-lobby.js): friends see it at once
    get name() { return account?.name ?? null; },
    get id() { return account?.id ?? null; },     // the account's number, told to the players of a room (apex-room.js)
    // a player's card by account number, from the room's player list (apex-room.js); null: a player with no account
    openPlayer: id => {
      if (Number.isSafeInteger(id) && id > 0) return openPlayer(id);
      notify(tr('Ce joueur n\'est pas connecté à un compte GoofyTrack.', 'This player is not logged in to a GoofyTrack account.'));
    },
    // the garage's unlockable items this account owns (apex-rarity.js), as the server last said
    get unlocks() { return Array.isArray(account?.unlocks) ? account.unlocks : []; },
    // a creator gives an unlockable item to a player by number, or takes it back (from the console:
    // ApexAccount.unlock('mp4_7a', 42) or ApexAccount.unlock('mp4_7a', 42, false)); the server checks who asks
    unlock: async (item, id, give = true) => {
      if (account == null) throw new Error('not logged in');
      const out = await call('POST', '/account/unlock', { item, id, give }, account.session);
      if (out.id === account.id) sendPresence();
      return out;
    },
    // added to the multiplayer server's address when hosting a room (patch_bundle.js): friends see the room
    hostQuery: () => (account ? '&account=' + account.session : ''),
  };
})();
