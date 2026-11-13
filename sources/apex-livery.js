// Liveries: three car designs kept per profile, picked in the garage. The garage only paints the car: its
// "Switch Profile" button becomes "Liveries", its Save no longer opens the name and flag window (that lives
// on the profile card, apex-account.js), and the cars parked beside the player's are its other liveries.
//
// Picking a livery puts it on the car at once (saved like the garage's Save, so the leaderboards show it);
// the garage's Save writes the car to the livery picked. An empty slot starts as a copy of the car.
//
// Stored in localStorage, synced with the account (apex-account.js):
//   goofytrack.liveries   { [profile token]: { active: 0..2, slots: [car style or null, ×3], names: [name or null, ×3] } }
//
// patch_bundle.js has the garage call garage(api) when it opens (api: get, set, save, dirty, parked, click; null
// when it closes), saved(token, style) after each Save, open() from its Liveries button and parked(i) for
// the cars beside the player's.
//
// The wing colour (Paint tab, fifth picker): until it is moved the wings take the pattern and the primary
// colour as before (wingHex null), the picker showing the colour the pattern mostly gives them; moved, it is
// the wings' own colour, and its "Auto" button goes back to the pattern. The garage's paint panel calls
// wingPicker(panel, element, picker) once, wingStyle(panel, style, picker) on each car it builds and
// wingShow(panel, style, picker) when it is handed a car; the panel keeps apxWing and apxWingHex.
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
    e.names = Array.from({ length: SLOTS }, (_, i) => (typeof e.names?.[i] === 'string' && e.names[i] ? e.names[i] : null));
    if (!(e.active >= 0 && e.active < SLOTS)) e.active = 0;
    // the car changed elsewhere (another PC, an older version): it is the livery picked
    if (typeof p.carStyle === 'string' && e.slots[e.active] !== p.carStyle) e.slots[e.active] = p.carStyle;
    if (JSON.stringify(all[p.token]) !== JSON.stringify(e)) { all[p.token] = e; writeAll(all); }
    return { token: p.token, ...e };
  }
  function store(e) {
    const all = readAll();
    all[e.token] = { active: e.active, slots: e.slots, names: e.names };
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

  // ---------------------------------------------------------------- the wing colour
  // the share of the secondary colour on the wings, by pattern (null until its picture is read): rows of the
  // front and rear wings in the patterns' texture space (build_patterns.js), across the width they cover
  const wingShare = new Map();
  const WING_AREAS = [[12, 90, 80, 940], [885, 1005, 345, 675]];   // [y0, y1, x0, x1] of 1024
  let wingPanel = null;   // { panel, picker } of the garage open
  function share(pattern) {
    if (wingShare.has(pattern)) return wingShare.get(pattern);
    wingShare.set(pattern, null);
    const url = gameModule(CAR_STYLE).A.patterns[pattern]?.url;
    if (url == null) return null;
    const img = new Image();
    img.addEventListener('load', () => {
      const size = 128, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, size, size);
      const data = g.getImageData(0, 0, size, size).data;
      let sum = 0, n = 0;
      for (const [y0, y1, x0, x1] of WING_AREAS)
        for (let y = Math.floor(y0 * size / 1024); y < Math.ceil(y1 * size / 1024); y++)
          for (let x = Math.floor(x0 * size / 1024); x < Math.ceil(x1 * size / 1024); x++) { sum += data[(y * size + x) * 4 + 1]; n++; }
      wingShare.set(pattern, sum / n / 255);
      // the picker of the garage open shows it, if it follows this pattern
      const w = wingPanel;
      if (w != null && w.panel.apxWingHex == null && w.panel.apxWingStyle?.pattern === pattern) show(w.panel, w.picker, autoHex(w.panel.apxWingStyle));
    });
    img.src = url;
    return null;
  }
  // the colour the pattern mostly gives the wings
  const autoHex = style => ((share(style.pattern) ?? 0) >= 0.5 ? style.secondaryHex : style.primaryHex);

  let showing = false;   // the picker is being set here: its change is not the player's
  function show(panel, picker, hex) {
    if (panel.apxWingTarget === hex && panel.apxWingShown != null) return;
    showing = true;
    try {
      panel.apxWingShown = null;
      picker.color = new picker.color.constructor(hex);
      panel.apxWingShown = picker.color.getHex();   // as the picker gives it back (it keeps HSV)
      panel.apxWingTarget = hex;
    } finally { showing = false; }
  }
  const markAuto = panel => panel.apxWingAuto?.classList.toggle('selected', panel.apxWingHex == null);
  // an icon's pattern keeps its colours, and its wings the pattern (patch_bundle.js, ICONS): the Primary, Secondary
  // and Wing pickers are greyed out while it is on the car, a note over them saying why, their colours kept for the
  // other patterns
  function lockPaint(panel, style) {
    const locked = gameModule(CAR_STYLE).A.isIcon?.(style.pattern) ?? false;
    const name = locked ? window.ApexRarity?.info(style.pattern)?.name : null;
    // (an icon, or a pattern that keeps its colours as they do: the Laguna GT Monaco GP's white)
    const icon = window.ApexRarity?.info(style.pattern)?.rarity === 'icon';
    const text = icon ? tr(`Couleur d'origine de l'Icône « ${name} » : elle fait partie du design et ne se change pas.`,
      `The original colour of the Icon "${name}": it is part of the design and cannot be changed.`)
      : tr(`Couleur d'origine du motif « ${name} » : elle fait partie du design et ne se change pas.`,
        `The original colour of the pattern "${name}": it is part of the design and cannot be changed.`);
    for (const box of [panel.apxPrimaryBox, panel.apxPrimaryBox?.nextElementSibling, panel.apxWingBox]) {
      if (box == null) continue;
      box.classList.toggle('apx-locked', locked);
      let note = box.querySelector(':scope > .apx-lock-note');
      if (locked && note == null) { note = document.createElement('div'); note.className = 'apx-lock-note'; box.appendChild(note); }
      if (note != null) note.textContent = locked ? '🔒 ' + text : '';
    }
  }

  // ---------------------------------------------------------------- the garage
  let garage = null;
  let bypass = false;          // the next click on the button opens the game's profiles (profile card)
  let panel = null;

  const css = document.createElement('style');
  // the game's styles come later (the garage's chunk): hence !important
  css.textContent = '#ui .customization-ui > .profile-button-container{display:none!important}'   // name and flag: the profile card's
    + '.livery-ui .slot .name .badge{margin-left:10px;font-size:18px;opacity:.6}'
    // the pencil that renames a livery, and the field it opens in place of the name
    + '.livery-ui .slot{position:relative}'
    + '.livery-ui .slot .apx-rename{position:absolute;right:14px;top:14px;width:34px;height:34px;padding:0;border:none;border-radius:8px;cursor:pointer;'
    + 'font-size:17px;line-height:34px;color:#cfd3da;background:rgba(255,255,255,.08)}'
    + '.livery-ui .slot .apx-rename:hover{color:#fff;background:rgba(255,255,255,.18)}'
    + '.livery-ui .slot input.apx-livery-name{width:calc(100% - 60px);box-sizing:border-box;padding:4px 8px;font:inherit;font-size:24px;font-weight:700;'
    + 'color:#fff;background:rgba(0,0,0,.35);border:2px solid var(--accent-color,#e10600);border-radius:8px;outline:none}'
    // the wing picker's Auto button, in its title
    + '#ui .customization-panel-ui .color h2{position:relative}'
    + '#ui .customization-panel-ui .color h2 .apx-wing-auto{position:absolute;right:0;top:50%;transform:translateY(-50%);margin:0;padding:2px 8px;'
    + 'font:inherit;font-size:12px;letter-spacing:.06em;color:#cfd3da;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25);border-radius:6px;cursor:pointer}'
    + '#ui .customization-panel-ui .color h2 .apx-wing-auto:hover{background:rgba(255,255,255,.16)}'
    + '#ui .customization-panel-ui .color h2 .apx-wing-auto.selected{color:#fff;background:var(--accent-color,#e10600);border-color:transparent}'
    // a picker an icon's pattern locks (lockPaint)
    + '#ui .customization-panel-ui .color{position:relative}'
    + '#ui .customization-panel-ui .color.apx-locked{pointer-events:none}'
    + '#ui .customization-panel-ui .color.apx-locked>:not(.apx-lock-note){opacity:.3;filter:grayscale(1)}'
    + '#ui .customization-panel-ui .color>.apx-lock-note{display:none}'
    + '#ui .customization-panel-ui .color.apx-locked>.apx-lock-note{display:flex;align-items:center;justify-content:center;position:absolute;inset:30px 8px 8px;'
    + 'padding:10px;border-radius:8px;text-align:center;font-size:14px;line-height:1.3;color:#fff;background:rgba(8,40,44,.88);box-shadow:inset 0 0 0 1px #22e6c8}';
  document.head.appendChild(css);

  function close() {
    if (panel == null) return;
    panel.remove();
    panel = null;
    window.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.code !== 'Escape' || event.target?.classList?.contains('apx-livery-name')) return;   // the name field's own Escape
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

  const NAME_LENGTH = 24;
  const nameOf = (e, i) => e.names[i] || tr('Livrée ', 'Livery ') + (i + 1);
  // the pencil beside a livery: its name becomes a field, Enter or leaving it keeps the name, Escape gives up
  function renameButton(slot, i) {
    const pencil = document.createElement('button');
    pencil.className = 'apx-rename';
    pencil.textContent = '✎';
    pencil.title = tr('Renommer la livrée', 'Rename the livery');
    pencil.addEventListener('click', event => {
      event.stopPropagation();
      const name = slot.querySelector('.name');
      const e = entry();
      if (name == null || e == null) return;
      const field = document.createElement('input');
      Object.assign(field, { className: 'apx-livery-name', type: 'text', value: e.names[i] || '', placeholder: nameOf(e, i), maxLength: NAME_LENGTH, spellcheck: false });
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        if (keep) {
          const now = entry();
          if (now != null) { now.names[i] = field.value.trim().slice(0, NAME_LENGTH) || null; store(now); }
        }
        if (panel != null) open();   // drawn again, with the new name
      };
      field.addEventListener('keydown', event => {
        event.stopPropagation();   // not the game's keys (the garage's Escape, driving keys)
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      });
      field.addEventListener('blur', () => finish(true));
      field.addEventListener('click', event => event.stopPropagation());
      name.replaceWith(field);
      pencil.remove();
      field.focus();
      field.select();
    });
    slot.appendChild(pencil);
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
      name.textContent = style == null ? tr('Vide : nouvelle livrée', 'Empty: new livery') : nameOf(e, i);
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
      if (style != null) renameButton(slot, i);
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
    garage(api) { garage = api; if (api == null) { close(); wingPanel = null; } else entry(); },
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
    wingLabel: () => tr('Aileron', 'Wing'),
    // the wing picker's box: its Auto button (the pattern's colours)
    wingPicker(panel, element, picker) {
      wingPanel = { panel, picker };
      const button = document.createElement('button');
      button.className = 'apx-wing-auto selected';
      button.textContent = 'Auto';
      button.title = tr('L\'aileron prend le motif et la couleur principale', 'The wings take the pattern and the primary colour');
      button.addEventListener('click', () => {
        garage?.click();
        panel.apxWingHex = null;
        panel.apxWingTarget = undefined;
        panel.apxWingShown = null;
        picker.color = picker.color;   // the panel builds the car again (wingStyle), now with the pattern's wings
      });
      element.querySelector('h2')?.appendChild(button);
      panel.apxWingAuto = button;
      panel.apxWingBox = element;
      panel.apxPrimaryBox = element.parentElement?.firstElementChild;   // Primary, the first of the left column
      for (let i = 0; i < gameModule(CAR_STYLE).A.patterns.length; i++) share(i);   // read before they are picked
    },
    // the car the panel built: its wing, and the colour the picker was moved to
    wingStyle(panel, style, picker) {
      if (picker != null && panel.apxWingShown != null && picker.color.getHex() !== panel.apxWingShown) {
        panel.apxWingHex = picker.color.getHex();
        panel.apxWingShown = panel.apxWingHex;
        panel.apxWingTarget = panel.apxWingHex;
      }
      style.wing = panel.apxWing ?? 0;
      style.wingHex = panel.apxWingHex ?? null;
      style.body = panel.apxBody ?? 0;
      panel.apxWingStyle = style;
      if (picker != null && style.wingHex == null && !showing) show(panel, picker, autoHex(style));
      markAuto(panel);
      lockPaint(panel, style);
    },
    // the car handed to the panel (it has set apxWing and apxWingHex from it)
    wingShow(panel, style, picker) {
      if (picker == null) return;
      panel.apxWingStyle = style;
      panel.apxWingTarget = undefined;
      show(panel, picker, style.wingHex ?? autoHex(style));
      markAuto(panel);
      lockPaint(panel, style);
    },
    bodyLabel: () => tr('Carrosserie', 'Body'),
  };
})();
