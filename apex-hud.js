// Apex HUD: two driving aids drawn over the race view, in solo and in multiplayer.
//
//   1. Mini-map     the track layout (same picture as the track thumbnails) with your car as an
//                   arrow and, in a room, the other players as dots
//   2. Live delta   while you drive, how far ahead or behind you are compared with your best
//                   finished run of the session, measured continuously along the track instead
//                   of only at checkpoints
//
// Both read what the game already knows (track layout, car positions); nothing is sent anywhere
// and the physics is not involved.
//
// The mini-map is shown or hidden with a key of its own ("Mini-map" in the game's controls settings,
// M by default), and stays as the player left it from one game to the next.
// The game calls into window.ApexHud from the hooks added by patch_bundle.js.
(() => {
  'use strict';

  const PART_SIZE = 5;            // metres per track grid unit
  const CELL_UNITS = 4;           // grid units per thumbnail cell (one road tile, 20 m)
  const MAP_SIZE = 190;           // largest side of the mini-map, in CSS pixels
  const SAMPLE_FRAMES = 50;       // own car sampled every 50 ms of race time
  const DELTA_MAX_DISTANCE = 30;  // metres from the reference line beyond which the delta is hidden
  const REMOTE_TIMEOUT = 4000;    // ms without news before another player's dot disappears
  const MAP_HIDDEN_KEY = 'goofytrack.minimapHidden';

  let ctx = null;                 // { owner, track, getSelfCar }
  let map = null;                 // { canvas, layer, scale, toPixel(x, z) }
  let delta = null;               // DOM element
  let remotes = new Map();        // player id -> { x, z, at }
  let run = [];                   // states of the run being driven
  let best = null;                // { frames, states } best finished run of the session
  let lastFrames = -1;
  let refIndex = 0;
  let frame = 0;
  let lastDelta = null;
  let mapHidden = false;
  const loadMapHidden = () => { try { mapHidden = localStorage.getItem(MAP_HIDDEN_KEY) === 'true'; } catch (e) { /* storage unavailable */ } };
  loadMapHidden();
  const showMapState = () => { if (map) map.canvas.style.display = mapHidden ? 'none' : ''; };
  window.addEventListener('apex-account-save', () => { loadMapHidden(); showMapState(); });   // the account's save (apex-account.js)

  const ui = () => document.getElementById('ui');
  // Texts the mod adds to the settings menu, in the game's languages (codes as in its translations)
  const TEXTS = {
    map: { en: 'Mini-map', ar: 'الخريطة المصغرة', 'de-DE': 'Minikarte', 'es-ES': 'Minimapa', 'fr-FR': 'Mini-carte', 'it-IT': 'Minimappa', 'ja-JP': 'ミニマップ', 'ko-KR': '미니맵', 'pl-PL': 'Minimapa', 'pt-BR': 'Minimapa', 'pt-PT': 'Minimapa', 'ru-RU': 'Мини-карта', 'tr-TR': 'Mini harita', 'uk-UA': 'Мінікарта', 'zh-CN': '小地图', 'zh-TW': '小地圖' },
    section: { en: 'Players', ar: 'اللاعبون', 'de-DE': 'Spieler', 'es-ES': 'Jugadores', 'fr-FR': 'Joueurs', 'it-IT': 'Giocatori', 'ja-JP': 'プレイヤー', 'ko-KR': '플레이어', 'pl-PL': 'Gracze', 'pt-BR': 'Jogadores', 'pt-PT': 'Jogadores', 'ru-RU': 'Игроки', 'tr-TR': 'Oyuncular', 'uk-UA': 'Гравці', 'zh-CN': '玩家', 'zh-TW': '玩家' },
    tags: { en: 'Show player UI', ar: 'إظهار واجهة اللاعبين', 'de-DE': 'Spieler-UI anzeigen', 'es-ES': 'Mostrar la interfaz de los jugadores', 'fr-FR': 'Afficher l\'UI des joueurs', 'it-IT': 'Mostra l\'interfaccia dei giocatori', 'ja-JP': 'プレイヤーUIを表示', 'ko-KR': '플레이어 UI 표시', 'pl-PL': 'Pokaż interfejs graczy', 'pt-BR': 'Mostrar a interface dos jogadores', 'pt-PT': 'Mostrar a interface dos jogadores', 'ru-RU': 'Показывать интерфейс игроков', 'tr-TR': 'Oyuncu arayüzünü göster', 'uk-UA': 'Показувати інтерфейс гравців', 'zh-CN': '显示玩家界面', 'zh-TW': '顯示玩家介面' },
    name: { en: 'Show name', ar: 'إظهار الاسم', 'de-DE': 'Namen anzeigen', 'es-ES': 'Mostrar el nombre', 'fr-FR': 'Montrer le nom', 'it-IT': 'Mostra il nome', 'ja-JP': '名前を表示', 'ko-KR': '이름 표시', 'pl-PL': 'Pokaż nazwę', 'pt-BR': 'Mostrar o nome', 'pt-PT': 'Mostrar o nome', 'ru-RU': 'Показывать имя', 'tr-TR': 'İsmi göster', 'uk-UA': 'Показувати ім\'я', 'zh-CN': '显示名称', 'zh-TW': '顯示名稱' },
    time: { en: 'Show time', ar: 'إظهار الوقت', 'de-DE': 'Zeit anzeigen', 'es-ES': 'Mostrar el tiempo', 'fr-FR': 'Montrer le temps', 'it-IT': 'Mostra il tempo', 'ja-JP': 'タイムを表示', 'ko-KR': '기록 표시', 'pl-PL': 'Pokaż czas', 'pt-BR': 'Mostrar o tempo', 'pt-PT': 'Mostrar o tempo', 'ru-RU': 'Показывать время', 'tr-TR': 'Süreyi göster', 'uk-UA': 'Показувати час', 'zh-CN': '显示时间', 'zh-TW': '顯示時間' },
    opacity: { en: 'UI opacity', ar: 'عتامة الواجهة', 'de-DE': 'UI-Deckkraft', 'es-ES': 'Opacidad de la interfaz', 'fr-FR': 'Opacité de l\'UI', 'it-IT': 'Opacità dell\'interfaccia', 'ja-JP': 'UIの不透明度', 'ko-KR': 'UI 불투명도', 'pl-PL': 'Krycie interfejsu', 'pt-BR': 'Opacidade da interface', 'pt-PT': 'Opacidade da interface', 'ru-RU': 'Непрозрачность интерфейса', 'tr-TR': 'Arayüz opaklığı', 'uk-UA': 'Непрозорість інтерфейсу', 'zh-CN': '界面不透明度', 'zh-TW': '介面不透明度' },
  };
  // the game's language (none for English), else the system's: the exact code first, then the language alone
  const translate = key => {
    const texts = TEXTS[key], lang = String(window.apexLanguage || navigator.language || '');
    if (texts[lang]) return texts[lang];
    const code = Object.keys(texts).find(c => c.split('-')[0] === lang.split('-')[0].toLowerCase());
    return code ? texts[code] : texts.en;
  };
  // time of a run (ms) as on a name tag: 01:23.456
  const formatRunTime = frames => {
    const ms = Math.round(frames) % 1000, s = Math.floor(frames / 1000) % 60, m = Math.floor(frames / 60000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  };
  const raceActive = () => !!(window.ApexRoom && window.ApexRoom.raceActive && window.ApexRoom.raceActive());

  // ================================================================== keyboard layout
  // Key bindings are physical keys (KeyboardEvent.code, named after a QWERTY keyboard), which the
  // game labels as on QWERTY: on AZERTY the key showing "Z" was called "W", and M was ";". The labels
  // follow the player's own keyboard instead, as Chromium reports it; until it has answered (and if it
  // cannot), the last layout seen, or AZERTY on a French system.
  const LAYOUT_KEY = 'goofytrack.keyboardLayout';
  const AZERTY = {
    KeyQ: 'a', KeyW: 'z', KeyA: 'q', KeyZ: 'w', KeyM: ',', Semicolon: 'm', Comma: ';', Period: ':', Slash: '!',
    Quote: 'ù', BracketLeft: '^', BracketRight: '$', Backslash: '*', Backquote: '²', Minus: ')', Equal: '=',
    Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à',
  };
  const PRINTABLE = /^(Key[A-Z]|Digit\d|Semicolon|Comma|Period|Slash|Quote|BracketLeft|BracketRight|Backslash|Backquote|Minus|Equal|IntlBackslash)$/;
  let layout = null;                                              // code -> character, null: QWERTY
  try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY)); } catch (e) { /* storage unavailable */ }
  if (layout == null && /^fr(-(fr|be|lu|mc))?$/i.test(navigator.language || '')) layout = AZERTY;
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then(m => {
      const seen = {};
      m.forEach((ch, code) => { if (PRINTABLE.test(code)) seen[code] = ch; });
      if (Object.keys(seen).length < 20) return;
      layout = seen;
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(seen)); } catch (e) { /* storage unavailable */ }
    }).catch(() => { /* not allowed here: keep the guess */ });
  }
  const keyLabel = code => {
    const ch = layout && PRINTABLE.test(code) ? layout[code] : null;
    return typeof ch === 'string' && ch.length === 1 && ch.trim() !== '' ? ch.toUpperCase() : null;
  };
  // the key that types this letter on the player's keyboard
  const letterKey = ch => {
    if (layout) for (const code in layout) if (layout[code] === ch) return code;
    return 'Key' + ch.toUpperCase();
  };

  // ================================================================== mini-map
  function buildMap() {
    const start = ctx.track.getStartTransform();
    if (start == null) return null;
    const thumb = ctx.track.getTrackData().createThumbnail();
    const w = thumb.width, h = thumb.height;
    const px = thumb.getContext('2d').getImageData(0, 0, w, h).data;

    // The thumbnail does not say where it sits in the world. Its start tiles are drawn in a known
    // blue, and the car starts in the middle of them: that pins the picture to world coordinates.
    let sx = 0, sy = 0, n = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 4 * (x + y * w);
      if (px[i + 3] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (px[i] === 51 && px[i + 1] === 140 && px[i + 2] === 224) { sx += x; sy += y; n++; }
    }
    if (n === 0 || maxX < 0) return null;
    const cellOf = v => (v / PART_SIZE - 2) / CELL_UNITS;
    const offX = Math.round(sx / n + 0.5 - cellOf(start.position.x));
    const offY = Math.round(sy / n + 0.5 - cellOf(start.position.z));

    // Crop to the track with one cell of margin, and scale to fit the widget
    minX -= 1; minY -= 1; maxX += 1; maxY += 1;
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const scale = Math.max(1.5, Math.min(12, MAP_SIZE / Math.max(cols, rows)));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'apex-minimap';
    canvas.width = Math.round(cols * scale * ratio);
    canvas.height = Math.round(rows * scale * ratio);
    canvas.style.width = Math.round(cols * scale) + 'px';
    canvas.style.height = Math.round(rows * scale) + 'px';

    // Static layer: one rounded square per tile
    const layer = document.createElement('canvas');
    layer.width = canvas.width; layer.height = canvas.height;
    const g = layer.getContext('2d');
    const s = scale * ratio;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 4 * (x + y * w);
      if (px[i + 3] === 0) continue;
      const isStart = px[i] === 51 && px[i + 1] === 140, isFinish = px[i] === 209 && px[i + 1] === 41, isCheckpoint = px[i] === 226 && px[i + 1] === 192;
      g.fillStyle = isStart ? '#4aa3ff' : isFinish ? '#ff5a6e' : isCheckpoint ? '#ffd24a' : 'rgba(243, 245, 248, 0.82)';
      g.fillRect((x - minX) * s, (y - minY) * s, s + 0.5, s + 0.5); // slight overlap: no hairlines between tiles
    }
    return {
      canvas, layer, s,
      toPixel: (x, z) => [(cellOf(x) + offX - minX) * s, (cellOf(z) + offY - minY) * s],
    };
  }

  function drawMap(self) {
    const g = map.canvas.getContext('2d');
    g.clearRect(0, 0, map.canvas.width, map.canvas.height);
    g.drawImage(map.layer, 0, 0);
    const r = Math.max(3.5, map.s * 0.42);
    const now = performance.now();
    for (const [id, p] of remotes) {
      if (now - p.at > REMOTE_TIMEOUT) { remotes.delete(id); continue; }
      const [x, y] = map.toPixel(p.x, p.z);
      g.beginPath(); g.arc(x, y, r * 0.8, 0, 2 * Math.PI);
      g.fillStyle = '#f3f5f8'; g.fill();
      g.lineWidth = r * 0.35; g.strokeStyle = '#0c0e13'; g.stroke();
    }
    // Own car: an arrow pointing where the car points
    const state = self.getCarState();
    const q = state.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y); // forward (0, 0, 1) rotated by q
    const [x, y] = map.toPixel(state.position.x, state.position.z);
    const a = Math.atan2(fz, fx);
    g.save();
    g.translate(x, y); g.rotate(a);
    g.beginPath(); g.moveTo(r * 1.5, 0); g.lineTo(-r, r); g.lineTo(-r * 0.45, 0); g.lineTo(-r, -r); g.closePath();
    g.fillStyle = '#f20d16'; g.fill();
    g.lineWidth = r * 0.35; g.strokeStyle = '#0c0e13'; g.stroke();
    g.restore();
  }

  // ================================================================== live delta
  function sample(self) {
    const state = self.getCarState();
    if (state.frames < lastFrames) { run = []; refIndex = 0; }       // restart
    lastFrames = state.frames;
    const last = run[run.length - 1];
    const finishing = state.finishFrames != null && (last == null || last.finishFrames == null);
    if (last == null || state.frames - last.frames >= SAMPLE_FRAMES || finishing) run.push(state);
    if (finishing && run.length > 2 && (best == null || state.finishFrames < best.frames)) {
      best = { frames: state.finishFrames, states: run };
      run = [];
    }
    return state;
  }

  // Time at which the reference run was at the point of its line closest to (x, y, z)
  function referenceFrames(p) {
    const states = best.states;
    const dist2 = i => { const s = states[i].position; return (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2; };
    // Progress normally moves forward a little each frame; look around the last match first
    let lo = Math.max(0, refIndex - 6), hi = Math.min(states.length - 1, refIndex + 40);
    let bestI = lo, bestD = Infinity;
    for (let i = lo; i <= hi; i++) { const d = dist2(i); if (d < bestD) { bestD = d; bestI = i; } }
    if (bestD > DELTA_MAX_DISTANCE ** 2) {                              // lost (respawn, shortcut): search everywhere
      for (let i = 0; i < states.length; i++) { const d = dist2(i); if (d < bestD) { bestD = d; bestI = i; } }
      if (bestD > DELTA_MAX_DISTANCE ** 2) return null;
    }
    refIndex = bestI;
    // Refine between the two samples around the closest one
    const pick = j => {
      const a = states[j], b = states[j + 1];
      const ax = b.position.x - a.position.x, ay = b.position.y - a.position.y, az = b.position.z - a.position.z;
      const len2 = ax * ax + ay * ay + az * az;
      if (len2 === 0) return null;
      const t = ((p.x - a.position.x) * ax + (p.y - a.position.y) * ay + (p.z - a.position.z) * az) / len2;
      return t < 0 || t > 1 ? null : a.frames + t * (b.frames - a.frames);
    };
    let f = bestI < states.length - 1 ? pick(bestI) : null;
    if (f == null && bestI > 0) f = pick(bestI - 1);
    return f == null ? states[bestI].frames : f;
  }

  function showDelta(state, self) {
    let value = null;
    if (best != null && !raceActive() && self.hasStarted() && state.finishFrames == null) {
      const ref = referenceFrames(state.position);
      if (ref != null) value = (state.frames - ref) / 1000;
    }
    if (delta == null) {
      delta = document.createElement('div');
      delta.className = 'apex-delta';
      ui().appendChild(delta);
    }
    lastDelta = value;
    if (value == null) { delta.classList.add('hidden'); return; }
    delta.classList.remove('hidden');
    delta.classList.toggle('ahead', value < 0);
    delta.textContent = (value < 0 ? '−' : '+') + Math.abs(value).toFixed(2);
  }

  // ================================================================== hooks called by the game
  window.ApexHud = {
    // Read-only snapshot for the console (also used to drive the car in automated tests)
    debug() {
      const self = ctx && ctx.getSelfCar();
      if (!self) return null;
      const s = self.getCarState(), q = s.quaternion;
      return {
        x: s.position.x, y: s.position.y, z: s.position.z, speed: s.speedKmh, frames: s.frames, finished: s.finishFrames,
        heading: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)),
        delta: lastDelta, best: best && best.frames, map: !!map, remotes: remotes.size,
      };
    },

    begin(context) {
      this.end();
      ctx = context;
    },
    remote(playerId, state) {
      if (ctx != null) remotes.set(playerId, { x: state.position.x, z: state.position.z, at: performance.now() });
    },
    update() {
      if (ctx == null) return;
      const self = ctx.getSelfCar();
      if (self == null) return;
      if (map === null) {
        try { map = buildMap() || false; } catch (e) { console.error('Apex: mini-map unavailable', e); map = false; }
        if (map) { ui().appendChild(map.canvas); showMapState(); }
      }
      const state = sample(self);
      if (++frame % 2 === 0) {                 // 30 redraws per second are plenty for both widgets
        if (map) drawMap(self);
        showDelta(state, self);
      }
    },
    // The "Mini-map" key (patch_bundle.js adds it to the game's key bindings)
    toggleMap() {
      mapHidden = !mapHidden;
      try { localStorage.setItem(MAP_HIDDEN_KEY, String(mapHidden)); } catch (e) { /* storage unavailable */ }
      showMapState();
    },
    mapLabel: () => translate('map'),
    // Name tags above the other cars (ghosts, opponents, room ghost): the "Players" settings that
    // patch_bundle.js adds to the game's settings menu. 0: hidden
    tagOpacity() {
      const s = window.ApexSettings;
      if (s == null) return 1;
      if (s.manager.getSetting(s.ids.ApexNameTags) === 'false') return 0;
      const o = s.manager.getSettingFloat(s.ids.ApexNameTagOpacity);
      return Number.isNaN(o) ? 1 : Math.min(1, Math.max(0, o));
    },
    // What a tag shows ({ countryCode, name } as the game draws it), from what its car could show
    // ({ countryCode, name, time in ms }); null: nothing
    tagContent(raw) {
      const s = window.ApexSettings;
      const on = id => s == null || s.manager.getSetting(s.ids[id]) !== 'false';
      const parts = [];
      if (on('ApexNameTagName') && raw.name) parts.push(raw.name);
      if (on('ApexNameTagTime') && raw.time != null) parts.push(formatRunTime(raw.time));
      return parts.length === 0 ? null : { countryCode: on('ApexNameTagName') ? raw.countryCode : null, name: parts.join('  ') };
    },
    // changes when the content settings do: the cars then redraw their tag
    tagStamp() {
      const s = window.ApexSettings;
      return s == null ? '' : s.manager.getSetting(s.ids.ApexNameTagName) + s.manager.getSetting(s.ids.ApexNameTagTime);
    },
    // settings menu: the rows of the section are greyed out while the player UI is off
    syncTagRows(rows) {
      const s = window.ApexSettings;
      const on = s == null || s.manager.getSetting(s.ids.ApexNameTags) !== 'false';
      for (const row of rows) {
        row.classList.toggle('apex-disabled', !on);
        for (const input of row.querySelectorAll('button, input')) input.disabled = !on;
      }
    },
    tagLabel: key => translate(key),
    keyLabel,                 // name of a key on the player's keyboard, null: the game's own name
    mapKey: () => letterKey('m'),
    // M used to be the second key of the cockpit camera. Key bindings saved before the mini-map key
    // existed give M back to the mini-map, once: afterwards the player's own choice is kept.
    // The mini-map key of 2.5 was the QWERTY M ("KeyM", the "," key on AZERTY): left as it was then
    // (M alone), it moves to the key showing M, unless something else already uses that key.
    migrateKeys(bindings, ids) {
      if (!bindings.some(([id]) => id === ids.ApexToggleMinimap))
        return bindings.map(([id, keys]) => (id === ids.VehicleCockpitCamera ? [id, keys.map(k => (k === 'KeyM' ? null : k))] : [id, keys]));
      const m = letterKey('m');
      if (m === 'KeyM' || bindings.some(([, keys]) => keys.includes(m))) return bindings;
      return bindings.map(([id, keys]) => (id === ids.ApexToggleMinimap && keys[0] === 'KeyM' && keys[1] == null ? [id, [m, null]] : [id, keys]));
    },
    end(owner) {
      if (owner !== undefined && ctx != null && ctx.owner !== owner) return;
      if (map) map.canvas.remove();
      if (delta != null) { delta.remove(); delta = null; }
      ctx = null; map = null; remotes = new Map(); run = []; best = null; lastFrames = -1; refIndex = 0; lastDelta = null;
    },
  };
})();
