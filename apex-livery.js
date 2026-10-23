// Liveries: three car designs kept per profile, picked in the garage. The garage only paints the car: its
// "Switch Profile" button becomes "Liveries", its Save no longer opens the name and flag window (that lives
// on the profile card, apex-account.js), and the cars parked beside the player's are its other liveries.
//
// Picking a livery puts it on the car at once (saved like the garage's Save, so the leaderboards show it);
// the garage's Save writes the car to the livery picked. An empty slot starts as a copy of the car.
//
// Stored in localStorage, synced with the account (apex-account.js):
//   goofytrack.liveries   { [profile token]: { active: 0..2, slots: [car style or null, ×3] } }
//
// patch_bundle.js has the garage call garage(api) when it opens (api: get, set, save, dirty, parked, click; null
// when it closes), saved(token, style) after each Save, open() from its Liveries button and parked(i) for
// the cars beside the player's.
(() => {
  'use strict';

  const KEY = 'goofytrack.liveries';
  const SLOTS = 3;
  const GAME = 'polytrack_v5_prod_';
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  const readAll = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const writeAll = all => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage full */ } };

  // the profile picked in the game: { token, carStyle }
  function profile() {
    const picked = parseInt(localStorage.getItem(GAME + 'user_slot'), 10);
    for (const slot of [picked, 0, 1, 2]) {
      try {
        const p = Number.isInteger(slot) ? JSON.parse(localStorage.getItem(GAME + 'user_' + slot)) : null;
        if (p && typeof p.token === 'string') return p;
      } catch (e) { /* not a profile */ }
    }
    return null;
  }

  // the liveries of the profile picked, the first one being its car the first time
  function entry() {
    const p = profile();
    if (p == null) return null;
    const all = readAll();
    let e = all[p.token];
    if (!e || !Array.isArray(e.slots)) e = { active: 0, slots: [] };
    e.slots = Array.from({ length: SLOTS }, (_, i) => (typeof e.slots[i] === 'string' ? e.slots[i] : null));
    if (!(e.active >= 0 && e.active < SLOTS)) e.active = 0;
    // the car changed elsewhere (another PC, an older version): it is the livery picked
    if (typeof p.carStyle === 'string' && e.slots[e.active] !== p.carStyle) e.slots[e.active] = p.carStyle;
    if (JSON.stringify(all[p.token]) !== JSON.stringify(e)) { all[p.token] = e; writeAll(all); }
    return { token: p.token, ...e };
  }
  function store(e) {
    const all = readAll();
    all[e.token] = { active: e.active, slots: e.slots };
    writeAll(all);
  }

  // ---------------------------------------------------------------- the game's car thumbnails
  const CAR_THUMBNAIL = 3787, CAR_STYLE = 8724;     // webpack ids of PolyTrack 0.6.3
  let gameRequire = null;
  const gameModule = id => {
    if (gameRequire == null) window.webpackChunk.push([[Symbol('apex-livery')], {}, r => { gameRequire = r; }]);
    return gameRequire(id);
  };
  const thumbnail = style => gameModule(CAR_THUMBNAIL).F(gameModule(CAR_STYLE).A.deserializeSafe(style), { addCancelCallback() {} });

  // ---------------------------------------------------------------- the garage
  let garage = null;
  let bypass = false;          // the next click on the button opens the game's profiles (profile card)
  let panel = null;

  const css = document.createElement('style');
  // the game's styles come later (the garage's chunk): hence !important
  css.textContent = '#ui .customization-ui > .profile-button-container{display:none!important}'   // name and flag: the profile card's
    + '.livery-ui .slot .name .badge{margin-left:10px;font-size:18px;opacity:.6}';
  document.head.appendChild(css);

  function close() {
    if (panel == null) return;
    panel.remove();
    panel = null;
    window.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();   // not the garage's own Escape (exit)
    close();
  }

  function pick(i) {
    const e = entry();
    if (garage == null || e == null) return;
    if (i !== e.active) {
      if (garage.dirty()) garage.save();          // the changes made go to the livery they were made on
      const now = entry();
      now.active = i;
      if (now.slots[i] == null) now.slots[i] = garage.get();
      store(now);
      garage.set(now.slots[i]);
    }
    garage.save();
    garage.parked();
    close();
  }

  // the window, made like the game's profile list (its styles)
  function open() {
    if (bypass) { bypass = false; return false; }
    const e = entry();
    if (garage == null || e == null) return false;
    close();
    const ui = document.getElementById('ui');
    panel = document.createElement('div');
    panel.className = 'profile-selection-ui livery-ui';
    const background = document.createElement('div');
    background.className = 'background';
    background.addEventListener('click', close);
    const box = document.createElement('div');
    box.className = 'container';
    const top = document.createElement('div');
    top.className = 'top-bar';
    const title = document.createElement('h2');
    title.textContent = tr('Livrées', 'Liveries');
    top.appendChild(title);
    box.appendChild(top);

    for (let i = 0; i < SLOTS; i++) {
      const style = i === e.active ? garage.get() : e.slots[i];   // the car as it is now, saved or not
      const slot = document.createElement('div');
      slot.className = 'slot';
      const button = document.createElement('button');
      button.className = 'button main' + (i === e.active ? ' selected' : '');
      button.addEventListener('click', () => { garage?.click(); pick(i); });
      const images = document.createElement('div');
      images.className = 'image-container';
      const placeholder = document.createElement('img');
      placeholder.className = 'placeholder show';
      placeholder.src = 'images/car_thumbnail_placeholder.png';
      images.appendChild(placeholder);
      if (style != null) {
        const img = document.createElement('img');
        thumbnail(style).then(url => { if (!url) return; img.src = url; placeholder.classList.remove('show'); img.classList.add('show'); }).catch(() => {});
        images.appendChild(img);
      }
      const names = document.createElement('div');
      names.className = 'name-container';
      const name = document.createElement('span');
      name.className = 'name' + (style == null ? ' empty' : '');
      name.textContent = style == null ? tr('Vide : nouvelle livrée', 'Empty: new livery') : tr('Livrée ', 'Livery ') + (i + 1);
      if (i === e.active) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = tr('sur la voiture', 'on the car');
        name.appendChild(badge);
      }
      const rarity = style == null ? null : window.ApexRarity?.ofStyle(style);   // its pattern (apex-rarity.js)
      if (rarity != null) {
        const pattern = document.createElement('span');
        pattern.className = 'pattern';
        pattern.style.color = rarity.color;
        pattern.textContent = `${rarity.name} · ${rarity.rarityName}`;
        name.appendChild(pattern);
      }
      names.appendChild(name);
      button.append(images, names);
      slot.appendChild(button);
      box.appendChild(slot);
    }

    const bottom = document.createElement('div');
    bottom.className = 'bottom-bar';
    const closeButton = document.createElement('button');
    closeButton.className = 'button';
    closeButton.innerHTML = '<img class="button-icon" src="images/cancel.svg"> ';
    closeButton.append(document.createTextNode(tr('Fermer', 'Close')));
    closeButton.addEventListener('click', () => { garage?.click(); close(); });
    bottom.appendChild(closeButton);
    box.appendChild(bottom);

    panel.append(background, box);
    ui.appendChild(panel);
    window.addEventListener('keydown', onKey, true);
    return true;
  }

  window.ApexLivery = {
    garage(api) { garage = api; if (api == null) close(); else entry(); },
    open,
    label: () => tr('Livrées', 'Liveries'),
    // after the garage's Save: the car is the livery picked
    saved(token, style) {
      const e = entry();
      if (e == null || e.token !== token) return;
      e.slots[e.active] = style;
      store(e);
    },
    // the car parked at place i beside the player's: the other liveries (null: none there)
    parked(i) {
      const e = entry();
      return e == null || i >= SLOTS || i === e.active ? null : e.slots[i];
    },
    // the profile card's "Switch profile": the game's own profile list, through the garage's button
    switchProfile() { bypass = true; },
  };
})();
