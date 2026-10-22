// GoofyTrack account: the game's save (profiles, records and their ghosts, custom tracks, settings) follows
// the player from PC to PC, kept by the GoofyTrack server (server/accounts.js).
//
// The save is encrypted here, with a key derived from the password: the server only keeps an opaque blob,
// and never sees the password, the PolyTrack tokens or anything else of the save. The other half of the
// derived key logs in. A forgotten password cannot be reset: the online copy is lost, not the PCs' own.
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
  const ACCOUNT_KEY = 'goofytrack.account';
  const THUMB_KEY = 'goofytrack.profile.thumbnail';   // { style, url } the badge's last car, shown at once on the next start
  const META_KEY = 'goofytrack.account.times';        // entry id -> time it last changed on this PC (negative: deleted), logged in or not
  const GAME = 'polytrack_v5_prod_';
  const PROFILES = 3;                                  // the game's slots
  const SETTINGS = [GAME + 'settings', GAME + 'key_bindings', GAME + 'is_music_enabled', GAME + 'unlocked_car_styles',
    'goofytrack_ambiance', 'goofytrack.minimapHidden', 'goofytrack.raceSettings'];   // not the keyboard layout: one per PC
  const KDF_ROUNDS = 310000;
  const BOOT_WAIT = 8000;
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
    if (SETTINGS.includes(key)) return 's:' + key;
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
    const cloudEntries = create ? {} : await decrypt(out.blob, keys.key);   // a wrong key fails here, before anything changes
    if (!create) await dropEmptyProfiles(cloudEntries);
    account = { name: out.name, id: out.id, verified: out.verified, session: out.session, key: keys.key };
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
  // their friends to see. The room the player hosts comes from the multiplayer server (hostQuery).
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
          stats: { tracks: s.tracks, circuits: s.circuits.length, custom: s.custom } },
        state: homeReady() ? 'menu' : 'playing',
      }, acc.session);
      if (account !== acc) return;
      if (acc.id !== out.id || acc.verified !== out.verified) { acc.id = out.id; acc.verified = out.verified; saveAccount(); }
      social = { requests: out.requests, online: out.online };
    } catch (e) {
      if (e.status === 401 && account === acc) { account = null; cloud = null; saveAccount(); }
    }
    scheduleBadge();
  }
  setInterval(sendPresence, PRESENCE_EVERY);

  const friendsCall = (method, body) => call(method, '/account/friends', body, account.session);

  // ---------------------------------------------------------------- players (a track's author)
  // A track's author is linked to the account of that name: on a track's page, the name opens the player's card.
  const players = new Map();   // lower-case name -> { time, promise of the card or null }
  function fetchPlayer(name) {
    const key = name.trim().toLowerCase(), known = players.get(key);
    if (known && Date.now() - known.time < 60000) return known.promise;
    const promise = call('GET', '/account/player?name=' + encodeURIComponent(name.trim()), null, account?.session)
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
      verifiedMark(span, player.verified);
      const show = event => { event.preventDefault(); event.stopPropagation(); openPlayer(player.name); };
      span.addEventListener('click', show);
      span.addEventListener('keydown', event => { if (event.key === 'Enter') show(event); });
    });
  }

  // the game's own profile window (name, country), which lives in the garage: opened by the garage's Save
  // (its own Save writes the profile; the profile button's Confirm only prepares it), then the garage closes
  // behind it, nothing left unsaved, back to the home screen and the profile card
  async function editProfile() {
    const wait = async (find, tries = 60) => {
      for (let i = 0; i < tries; i++) { const found = find(); if (found) return found; await new Promise(resolve => setTimeout(resolve, 100)); }
      return null;
    };
    const garageButton = document.querySelector('#ui .menu-ui > .main-buttons-container > .button-image');   // the first one
    if (garageButton == null) return;
    close();
    garageButton.click();
    // the garage's top bar: Exit, Save, Default, Random, Switch Profile
    const top = await wait(() => document.querySelector('#ui .profile-button-container')?.closest('#ui > div')?.querySelector('.top'));
    if (top == null) return;
    const [exit, save] = top.querySelectorAll(':scope > button');
    save.click();
    if (await wait(() => document.querySelector('#ui .profile-settings-ui')) == null) return;
    await wait(() => document.querySelector('#ui .profile-settings-ui') == null, 36000);   // up to an hour to choose
    exit.click();
    if (await wait(homeReady)) { sendPresence(); open(); }   // friends see the new name and flag at once
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

  // stats of a profile, from this PC's save: tracks with a record, the mod's circuits among them, custom tracks
  async function profileStats(p) {
    const hash = await sha256(p.token), prefix = GAME + 'record_' + p.slot + '_', tracks = new Set();
    for (const key of Object.keys(storage)) {
      if (key.startsWith(prefix) && parse(get(key))?.tokenHash === hash) tracks.add(key.slice(-64));
    }
    return {
      hash,
      tracks: tracks.size,
      circuits: MOD_TRACKS.filter(t => tracks.has(t.id)),
      custom: Object.keys(storage).filter(k => k.startsWith(GAME + 'track_')).length,
    };
  }
  // best place on the mod's circuits, from the GoofyTrack server's boards: { position, name } or null
  const places = new Map();       // token hash -> { time, promise }
  function bestPlace(hash, circuits) {
    const known = places.get(hash);
    if (known && Date.now() - known.time < 120000) return known.promise;
    const promise = Promise.all(circuits.map(t =>
      fetch(`${SERVER}leaderboardUserEntry?trackId=${t.id}&userTokenHash=${hash}`)
        .then(res => (res.ok ? res.json() : null))
        .then(e => (e && e.position > 0 ? { position: e.position, name: t.name } : null))
        .catch(() => null)))
      .then(all => all.filter(Boolean).sort((a, b) => a.position - b.position)[0] || null);
    places.set(hash, { time: Date.now(), promise });
    return promise;
  }

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
  const verifiedMark = (parent, verified) => {
    if (verified !== 'creator') return;
    const mark = el(parent, 'span', 'verified');
    mark.innerHTML = CHECK;
    mark.title = tr('Co-créateur de GoofyTrack', 'GoofyTrack co-creator');
  };
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
      const name = badge.querySelector('.name');
      name.textContent = '';
      flag(name, p?.countryCode);
      el(name, 'span', null, p ? p.nickname : tr('Profil', 'Profile'));
      verifiedMark(name, account?.verified);
      const status = badge.querySelector('.status');
      status.textContent = account && kind === 'ok' ? account.name + (account.id ? ' · ' + idText(account.id) : '') : state;
      status.className = 'status ' + kind;
      badge.classList.toggle('requests', account != null && social.requests > 0);   // friend requests waiting
      badge.title = account ? tr('Compte ', 'Account ') + account.name + ' · ' + state : tr('Aucun compte sur ce PC', 'No account on this PC');
    }
  }

  // ---------------------------------------------------------------- profile card
  let mode = 'login', tab = 'profile';
  let viewing = null;            // another player's card, shown instead of the profile (a track's author)
  function render() {
    if (overlay == null) return;
    const panel = overlay.querySelector('.panel');
    panel.textContent = '';
    if (viewing) return renderPlayer(panel, viewing);
    overlay.dataset.view = account != null ? 'account' : 'login';
    const p = currentProfile();

    const header = el(panel, 'div', 'header');
    const car = el(header, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (p) showCar(car, p.carStyle);
    const who = el(header, 'div', 'who');
    const title = el(who, 'h2');
    el(title, 'span', null, p ? p.nickname : tr('Profil', 'Profile'));
    verifiedMark(title, account?.verified);
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
    for (const [t, label] of [['profile', tr('Profil', 'Profile')], ['friends', tr('Amis', 'Friends')]]) {
      const button = el(tabs, 'button', t === tab ? 'active' : null, label);
      if (t === 'friends' && account && social.requests > 0) el(button, 'span', 'count', String(social.requests));
      button.addEventListener('click', () => { tab = t; render(); });
    }

    const body = el(panel, 'div', 'body');
    if (tab === 'friends') return renderFriends(body);
    if (p) {
      const grid = el(body, 'div', 'stats');
      const tile = (label, value, sub) => {
        const t = el(grid, 'div', 'stat');
        el(t, 'div', 'label', label);
        const v = el(t, 'div', 'value', value);
        if (sub != null) el(v, 'span', 'sub', sub);
        return t;
      };
      const tiles = {
        tracks: tile(tr('Pistes bouclées', 'Tracks finished'), '…'),
        circuits: tile(tr('Circuits du mod', 'Mod circuits'), '…'),
        place: tile(tr('Meilleure place', 'Best place'), '…'),
        custom: tile(tr('Pistes perso', 'Custom tracks'), '…'),
      };
      const fill = (t, value, sub) => {
        const v = t.querySelector('.value');
        v.textContent = value;
        if (sub) el(v, 'span', 'sub', sub);
      };
      profileStats(p).then(s => {
        fill(tiles.tracks, String(s.tracks));
        fill(tiles.circuits, `${s.circuits.length} / ${MOD_TRACKS.length}`);
        fill(tiles.custom, String(s.custom));
        tiles.place.title = tr('Sur les classements en ligne des circuits du mod', 'On the online boards of the mod\'s circuits');
        if (!s.circuits.length) return fill(tiles.place, '—');
        bestPlace(s.hash, s.circuits).then(best => fill(tiles.place, best ? 'P' + best.position : '—', best ? best.name : null));
      });
    }
    madeList(body, account?.name);

    const garage = () => {
      const button = document.querySelector('#ui .menu-ui > .main-buttons-container > .button-image');   // the first one
      close();
      button?.click();
    };

    if (account != null) {
      const [state, kind] = accountState();
      const line = el(body, 'p', 'state ' + kind);
      line.append(tr('Compte ', 'Account '), Object.assign(document.createElement('strong'), { textContent: account.name }), ' · ',
        syncing || lastError || lastSync == null ? (lastError || state) : tr('synchronisé ', 'synced ') + ago(lastSync));
      const row = el(body, 'div', 'row');
      el(row, 'button', null, tr('Modifier le profil', 'Edit profile')).addEventListener('click', editProfile);
      el(row, 'button', null, 'Garage').addEventListener('click', garage);
      const now = el(row, 'button', null, tr('Synchroniser', 'Sync now'));
      now.disabled = !!syncing;
      now.addEventListener('click', () => { sync().catch(() => {}); render(); });
      el(row, 'button', null, tr('Se déconnecter', 'Log out')).addEventListener('click', () => logOut().then(render));
      el(body, 'p', 'hint', tr('Profils, records et fantômes, pistes perso et réglages suivent ce compte sur chaque PC où vous vous connectez. Se déconnecter garde tout sur ce PC.',
        'Profiles, records and ghosts, custom tracks and settings follow this account on every PC you log in on. Logging out keeps everything on this PC.'));
      return;
    }

    const row = el(body, 'div', 'row');
    el(row, 'button', null, tr('Modifier le profil', 'Edit profile')).addEventListener('click', editProfile);
    el(row, 'button', null, 'Garage').addEventListener('click', garage);
    el(body, 'h3', null, tr('Compte GoofyTrack', 'GoofyTrack account'));
    el(body, 'p', 'hint', tr('Connectez-vous pour retrouver vos profils, records, pistes perso et réglages sur tous vos PC.',
      'Log in to find your profiles, records, custom tracks and settings on all your PCs.'));
    const modes = el(body, 'div', 'tabs');
    for (const [m, label] of [['login', tr('Se connecter', 'Log in')], ['create', tr('Créer un compte', 'Create an account')]]) {
      const button = el(modes, 'button', m === mode ? 'active' : null, label);
      button.addEventListener('click', () => { mode = m; render(); });
    }
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
      ? tr('3 à 20 lettres, chiffres, - _ ou point. La sauvegarde est chiffrée avec votre mot de passe : s\'il est oublié, la copie en ligne est perdue (pas celle de vos PC).',
        '3 to 20 letters, digits, - _ or dot. The save is encrypted with your password: if it is forgotten, the online copy is lost (not the one on your PCs).')
      : tr('Vos records, profils, pistes perso et réglages de ce PC sont fusionnés avec ceux du compte : rien n\'est perdu.',
        'This PC\'s records, profiles, custom tracks and settings are merged with the account\'s: nothing is lost.'));
    const status = el(form, 'p', 'state');
    const submit = el(form, 'button', 'primary', mode === 'create' ? tr('Créer le compte', 'Create account') : tr('Se connecter', 'Log in'));
    submit.type = 'submit';
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

  // the mod's tracks an account made, as chips
  function madeList(body, name) {
    const made = tracksBy(name);
    if (!made.length) return;
    el(body, 'h3', null, tr('Circuits créés', 'Tracks made') + ` · ${made.length}`);
    const list = el(body, 'div', 'made');
    for (const t of made) el(list, 'span', 'chip', t.name);
  }

  // ---------------------------------------------------------------- another player's card
  async function openPlayer(name) {
    const player = await fetchPlayer(name);
    if (player == null) return;
    if (player.self) { viewing = null; tab = 'profile'; return overlay ? render() : open(); }   // your own: the profile card
    viewing = player;
    if (overlay) render(); else open();
    // the card may be a minute old: refresh it (online, stats)
    players.delete(name.trim().toLowerCase());
    fetchPlayer(name).then(fresh => { if (fresh && viewing?.id === fresh.id) { viewing = fresh; render(); } });
  }

  function renderPlayer(panel, v) {
    overlay.dataset.view = 'player';
    const header = el(panel, 'div', 'header');
    const car = el(header, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (v.carStyle) showCar(car, v.carStyle, false);
    const who = el(header, 'div', 'who');
    const title = el(who, 'h2');
    el(title, 'span', null, v.nickname);
    verifiedMark(title, v.verified);
    const country = el(who, 'div', 'country');
    if (v.countryCode) { flag(country, v.countryCode); el(country, 'span', null, countryName(v.countryCode)); }
    el(who, 'span', 'player-id', idText(v.id));
    const closeButton = el(header, 'button', 'close', '✕');
    closeButton.title = tr('Fermer', 'Close');
    closeButton.addEventListener('click', close);

    const body = el(panel, 'div', 'body');
    const line = el(body, 'p', 'state');
    line.append(tr('Compte ', 'Account '), Object.assign(document.createElement('strong'), { textContent: v.name }), ' · ' + stateText(v));
    const grid = el(body, 'div', 'stats');
    const tile = (label, value, sub) => {
      const t = el(grid, 'div', 'stat');
      el(t, 'div', 'label', label);
      const valueEl = el(t, 'div', 'value', value);
      if (sub) el(valueEl, 'span', 'sub', sub);
    };
    const st = v.stats || {}, dash = n => (n == null ? '—' : String(n));
    tile(tr('Pistes bouclées', 'Tracks finished'), dash(st.tracks));
    tile(tr('Circuits du mod', 'Mod circuits'), `${dash(st.circuits)} / ${MOD_TRACKS.length}`);
    tile(tr('Meilleure place', 'Best place'), v.best ? 'P' + v.best.position : '—', v.best ? MOD_TRACKS.find(t => t.id === v.best.trackId)?.name : null);
    tile(tr('Pistes perso', 'Custom tracks'), dash(st.custom));
    madeList(body, v.name);

    const row = el(body, 'div', 'row');
    if (account == null) {
      el(body, 'p', 'hint', tr('Connectez-vous à un compte GoofyTrack pour ajouter ce joueur en ami.', 'Log in to a GoofyTrack account to add this player as a friend.'));
    } else if (v.friend) {
      el(row, 'span', 'tag', tr('Vous êtes amis', 'You are friends'));
    } else if (v.requested) {
      el(row, 'span', 'tag', tr('Demande d\'ami envoyée', 'Friend request sent'));
    } else {
      const add = el(row, 'button', 'primary', tr('Ajouter en ami', 'Add as a friend'));
      add.addEventListener('click', () => {
        add.disabled = true;
        friendsCall('POST', { action: 'add', id: v.id })
          .then(out => { viewing = { ...v, friend: !!out.friends, requested: !out.friends }; render(); })
          .catch(() => { add.disabled = false; });
      });
    }
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

  const STATE_ORDER = { hosting: 0, menu: 1, playing: 1, offline: 2 };
  const stateText = f => (f.state === 'hosting' ? tr('Héberge une room', 'Hosting a room')
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
    const car = el(row, 'img', 'car');
    car.src = 'images/car_thumbnail_placeholder.png';
    car.draggable = false;
    if (f.carStyle && homeReady()) showCar(car, f.carStyle, false);
    const text = el(row, 'div', 'text');
    const name = el(text, 'div', 'name');
    flag(name, f.countryCode);
    el(name, 'span', null, f.nickname);
    verifiedMark(name, f.verified);
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
#ui .apex-profile .verified svg, #ui .apex-account .verified svg { width: 100%; height: 100%; }
#ui .apex-account h2 { display: flex; align-items: center; gap: 8px; }
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
    get name() { return account?.name ?? null; },
    // added to the multiplayer server's address when hosting a room (patch_bundle.js): friends see the room
    hostQuery: () => (account ? '&account=' + account.session : ''),
  };
})();
