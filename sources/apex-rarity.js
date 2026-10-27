// Car part rarities: each pattern, rims, exhaust, wing and body of the garage has a name and a rarity, shown on its
// tile, whose frame takes the rarity's colour (common grey to mythic red, then the icons' teal); each tab lists the
// most common first, the rarest at the bottom. The icons are real cars' liveries and parts (their sponsors turned
// into fakes), to be won in tournaments and events: an icon's pattern keeps its colours (patch_bundle.js, ICONS),
// and each of its parts fits any other car.
//
// Unlockable items (`unlock` below) are only picked by the accounts that own them: the server says which
// (server/accounts.js, UNLOCKS; apex-account.js hands them over). Until then their tile shows the car in black, the
// name hidden, and a click only says how to win it; the garage's Random button leaves them out (patch_bundle.js). Display only for now: every part stays free (crates to unlock them may come
// later). The liveries (apex-livery.js) show the name of their pattern.
//
// patch_bundle.js has the garage call item(kind, button, index) for each tile of its Pattern, Rims, Exhaust,
// Wing and Body tabs, kind being 'pattern', 'rims', 'exhaust', 'wing' or 'body'.
(() => {
  'use strict';

  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  const RARITIES = {
    common:    { fr: 'Commun',     en: 'Common',    color: '#9aa1ab' },
    rare:      { fr: 'Rare',       en: 'Rare',      color: '#3fcf62' },
    veryRare:  { fr: 'Très rare',  en: 'Very rare', color: '#3d8bff' },
    epic:      { fr: 'Épique',     en: 'Epic',      color: '#a65cff' },
    legendary: { fr: 'Légendaire', en: 'Legendary', color: '#f7c21a' },
    mythic:    { fr: 'Mythique',   en: 'Mythic',    color: '#ff3d3d' },
    icon:      { fr: 'Icône',      en: 'Icon',      color: '#22e6c8' },
  };
  // by the game's pattern index (build_patterns.js draws them in this order; 16 on are the mod's)
  const PATTERNS = [
    { fr: 'Bande centrale',    en: 'Centre stripe',     rarity: 'common' },
    { fr: 'Double bande',      en: 'Racing stripes',    rarity: 'common' },
    { fr: 'Flancs',            en: 'Flank stripes',     rarity: 'common' },
    { fr: 'Bande filetée',     en: 'Pinstriped band',   rarity: 'rare' },
    { fr: 'Bas de caisse',     en: 'Lower body',        rarity: 'common' },
    { fr: 'Bicolore',          en: 'Split',             rarity: 'rare' },
    { fr: 'Flèche',            en: 'Arrow',             rarity: 'veryRare' },
    { fr: 'Numéros de course', en: 'Roundels',          rarity: 'rare' },
    { fr: 'Fer à cheval',      en: 'Horseshoe',         rarity: 'rare' },
    { fr: 'Aiguille',          en: 'Needle',            rarity: 'veryRare' },
    { fr: 'Coin arrière',      en: 'Wedge',             rarity: 'rare' },
    { fr: 'Arlequin',          en: 'Harlequin',         rarity: 'epic' },
    { fr: 'Chevrons',          en: 'Chevrons',          rarity: 'veryRare' },
    { fr: 'Pois',              en: 'Polka dots',        rarity: 'epic' },
    { fr: 'Dégradé',           en: 'Fade',              rarity: 'epic' },
    { fr: 'Contours',          en: 'Outline',           rarity: 'veryRare' },
    { fr: 'Monaco GP Edition', en: 'Monaco GP Edition', rarity: 'legendary' },
    { fr: 'Numéro géant',      en: 'Big number',        rarity: 'rare' },
    { fr: 'Bande diagonale',   en: 'Diagonal band',     rarity: 'common' },
    { fr: 'Bouts d\'ailerons', en: 'Wing tips',         rarity: 'common' },
    { fr: 'Pointillés',        en: 'Dotted line',       rarity: 'common' },
    { fr: 'Camouflage',        en: 'Camouflage',        rarity: 'epic' },
    { fr: 'Éclair',            en: 'Lightning',         rarity: 'veryRare' },
    { fr: 'Flammes',           en: 'Flames',            rarity: 'epic' },
    { fr: 'Tigre',             en: 'Tiger',             rarity: 'epic' },
    { fr: 'Code-barres',       en: 'Barcode',           rarity: 'veryRare' },
    { fr: 'Carbone',           en: 'Carbon',            rarity: 'veryRare' },
    { fr: 'Spa Edition',       en: 'Spa Edition',       rarity: 'legendary' },
    { fr: 'Strasbourg Edition', en: 'Strasbourg Edition', rarity: 'legendary' },
    { fr: 'Dijon Edition',     en: 'Dijon Edition',     rarity: 'legendary' },
    { fr: 'Montbéliard Edition', en: 'Montbéliard Edition', rarity: 'legendary' },
    { fr: 'Goofy Coaster Edition', en: 'Goofy Coaster Edition', rarity: 'legendary' },
    { fr: 'Killer Loop Edition', en: 'Killer Loop Edition', rarity: 'legendary' },
    { fr: 'Goofy Signature',   en: 'Goofy Signature',   rarity: 'mythic' },
    { fr: 'Champion',          en: 'Champion',          rarity: 'mythic' },
    { fr: 'McLaren MP4/7A 1992', en: 'McLaren MP4/7A 1992', rarity: 'icon', unlock: 'mp4_7a' },
  ];
  // by the game's model index (Wheel0..11, PolyTrack's own; the first three were the free ones)
  const RIMS = [
    { fr: 'Huit branches',     en: 'Eight spoke',       rarity: 'common' },
    { fr: 'Croix',             en: 'Cross',             rarity: 'common' },
    { fr: 'Rayons fins',       en: 'Wire',              rarity: 'rare' },
    { fr: 'Dix branches',      en: 'Ten spoke',         rarity: 'common' },
    { fr: 'Hélice',            en: 'Propeller',         rarity: 'epic' },
    { fr: 'Disque plein',      en: 'Solid disc',        rarity: 'rare' },
    { fr: 'Tourbillon',        en: 'Swirl',             rarity: 'veryRare' },
    { fr: 'Rayons croisés',    en: 'Crossed wire',      rarity: 'veryRare' },
    { fr: 'Rivets',            en: 'Studded',           rarity: 'epic' },
    { fr: 'Perforée',          en: 'Drilled',           rarity: 'rare' },
    { fr: 'Turbine',           en: 'Turbofan',          rarity: 'legendary' },
    { fr: 'Étoile',            en: 'Star',              rarity: 'veryRare' },
    // the mod's (build_car.js, Wheel12..)
    { fr: 'McLaren MP4/7A 1992', en: 'McLaren MP4/7A 1992', rarity: 'icon', unlock: 'mp4_7a' },
  ];
  // by the game's model index (Exhaust0..7, PolyTrack's own; the first two were the free ones)
  const EXHAUSTS = [
    { fr: 'Sortie simple',     en: 'Single',            rarity: 'common' },
    { fr: 'Gros calibre',      en: 'Wide bore',         rarity: 'common' },
    { fr: 'Triple sortie',     en: 'Triple',            rarity: 'epic' },
    { fr: 'Double plat',       en: 'Flat twin',         rarity: 'rare' },
    { fr: 'Évasé',             en: 'Flared',            rarity: 'veryRare' },
    { fr: 'Carré',             en: 'Square',            rarity: 'rare' },
    { fr: 'Double canon',      en: 'Twin barrel',       rarity: 'veryRare' },
    { fr: 'Canon XXL',         en: 'XXL barrel',        rarity: 'legendary' },
    // the mod's (build_car.js, Exhaust8..)
    { fr: 'McLaren MP4/7A 1992', en: 'McLaren MP4/7A 1992', rarity: 'icon', unlock: 'mp4_7a' },
  ];
  // by the mod's model index (Wing0..7, build_car.js draws them in this order)
  const WINGS = [
    { fr: 'Standard',          en: 'Standard',          rarity: 'common' },
    { fr: 'Basse traînée',     en: 'Low drag',          rarity: 'common' },
    { fr: 'DRS ouvert',        en: 'DRS open',          rarity: 'rare' },
    { fr: 'Haut appui',        en: 'High downforce',    rarity: 'rare' },
    { fr: 'Cuillère',          en: 'Spoon',             rarity: 'veryRare' },
    { fr: 'Années 70',         en: 'Seventies',         rarity: 'epic' },
    { fr: 'Biplan',            en: 'Biplane',           rarity: 'legendary' },
    { fr: 'Mouette',           en: 'Gull wing',         rarity: 'mythic' },
    { fr: 'McLaren MP4/7A 1992', en: 'McLaren MP4/7A 1992', rarity: 'icon', unlock: 'mp4_7a' },
  ];
  // by the mod's body index (build_car.js: Body, then Body1..)
  const BODIES = [
    { fr: 'GoofyTrack F1',     en: 'GoofyTrack F1',     rarity: 'common' },
    { fr: 'McLaren MP4/7A 1992', en: 'McLaren MP4/7A 1992', rarity: 'icon', unlock: 'mp4_7a' },
  ];
  const ITEMS = { pattern: PATTERNS, rims: RIMS, exhaust: EXHAUSTS, wing: WINGS, body: BODIES };
  const RANK = Object.keys(RARITIES);   // common first

  function info(index, kind = 'pattern') {
    const p = ITEMS[kind]?.[index];
    if (p == null) return null;
    const r = RARITIES[p.rarity];
    return { name: tr(p.fr, p.en), rarity: p.rarity, rank: RANK.indexOf(p.rarity), rarityName: tr(r.fr, r.en), color: r.color, unlock: p.unlock ?? null };
  }
  // the player may pick it: free, or unlocked by their account
  function owned(kind, index) {
    const unlock = ITEMS[kind]?.[index]?.unlock;
    return unlock == null || (window.ApexAccount?.unlocks ?? []).includes(unlock);
  }
  // how an unlockable item is won, by its unlock
  const HOW = {
    mp4_7a: () => tr('À gagner : premier tournoi GoofyTrack', 'To win: the first GoofyTrack tournament'),
  };
  // a car style as the game saves it (base64url): byte 1 is the pattern
  function ofStyle(style) {
    try { return info(atob(String(style).replace(/-/g, '+').replace(/_/g, '/')).charCodeAt(1)); } catch (e) { return null; }
  }

  const css = document.createElement('style');
  // more specific than the theme's tiles (apex-theme.css) and the garage's own styles, which come later
  css.textContent = `
#ui .customization-panel-ui > .options-panel > button.apx-rarity {
  position: relative; overflow: hidden;
  flex-shrink: 0;   /* overflow: hidden would let the column squeeze the tiles instead of scrolling */
  background-image: linear-gradient(to bottom, color-mix(in srgb, var(--rarity) 30%, transparent), transparent 55%);
  box-shadow: inset 0 0 0 2px var(--rarity);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity:hover {
  background-image: linear-gradient(to bottom, color-mix(in srgb, var(--rarity) 42%, transparent), transparent 65%);
}
/* picked: a white ring around the frame, which keeps its colour (mythic is red too) */
#ui .customization-panel-ui > .options-panel > button.apx-rarity.selected {
  box-shadow: inset 0 0 0 2px var(--rarity), 0 0 0 3px #fff, 0 0 14px 2px color-mix(in srgb, var(--rarity) 70%, transparent);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-rarity-label {
  position: absolute; left: 6px; top: 6px; max-width: calc(100% - 12px); box-sizing: border-box;   /* above the car, drawn lower in the tile */
  padding: 3px 6px; border-radius: 6px; background: rgba(10, 12, 18, 0.72);   /* readable on a white wing too */
  z-index: 2;   /* over the car picture */
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  pointer-events: none; text-align: left; line-height: 1.1;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-rarity-label > .name {
  font-size: 14px; color: #fff; max-width: 100%; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;   /* long names on two lines */
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-rarity-label > .tier {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rarity);
}
/* legendary: a light sweeping across; mythic: a slow glow */
#ui .customization-panel-ui > .options-panel > button.apx-rarity.legendary::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(110deg, transparent 35%, rgba(255, 236, 160, 0.35) 50%, transparent 65%);
  background-size: 250% 100%; animation: apx-rarity-shine 3.2s ease-in-out infinite;
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.mythic { animation: apx-rarity-glow 2.4s ease-in-out infinite; }
/* icon: a teal frame turning around the tile (GoofyTrack's take on the icon series), over a teal sky */
@property --apx-icon-turn { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon {
  background-image: radial-gradient(ellipse at 50% 0%, rgba(34, 230, 200, 0.45), transparent 70%), linear-gradient(to bottom, rgba(18, 140, 190, 0.35), transparent 70%);
  box-shadow: 0 0 12px 1px rgba(34, 230, 200, 0.35);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon.selected {
  box-shadow: 0 0 0 3px #fff, 0 0 18px 4px rgba(34, 230, 200, 0.75);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon::before {
  content: ''; position: absolute; inset: 0; padding: 3px; border-radius: inherit; pointer-events: none; z-index: 1;
  background: conic-gradient(from var(--apx-icon-turn), #22e6c8, #1593d6, #9cfff0, #22e6c8, #1593d6, #9cfff0, #22e6c8);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
  animation: apx-icon-turn 4s linear infinite;
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-rarity-label > .tier::before { content: '◆ '; }
/* and a light sweeping across it, with sparkles twinkling */
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: linear-gradient(115deg, transparent 32%, rgba(156, 255, 240, 0.35) 46%, rgba(255, 255, 255, 0.55) 50%, rgba(156, 255, 240, 0.35) 54%, transparent 68%);
  background-size: 260% 100%; animation: apx-rarity-shine 2.8s ease-in-out infinite;
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles > i {
  position: absolute; width: 12px; height: 12px; opacity: 0;
  background: radial-gradient(circle, #fff 0 1px, rgba(156, 255, 240, 0.9) 1.5px, transparent 4px),
    linear-gradient(transparent 45%, rgba(220, 255, 250, 0.9) 45% 55%, transparent 55%), linear-gradient(90deg, transparent 45%, rgba(220, 255, 250, 0.9) 45% 55%, transparent 55%);
  animation: apx-icon-twinkle 2.4s ease-in-out infinite;
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles > i:nth-child(1) { left: 80%; top: 22%; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles > i:nth-child(2) { left: 12%; top: 64%; animation-delay: 0.8s; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles > i:nth-child(3) { left: 62%; top: 80%; animation-delay: 1.6s; }
@keyframes apx-icon-turn { to { --apx-icon-turn: 360deg; } }
@keyframes apx-icon-twinkle { 0%, 100% { opacity: 0; transform: scale(0.4) rotate(0deg); } 50% { opacity: 1; transform: scale(1.3) rotate(45deg); } }
/* not unlocked: the car in black, a padlock, the way to win it on a click */
#ui .customization-panel-ui > .options-panel > button.apx-rarity.apx-unowned { cursor: not-allowed; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.apx-unowned > img { filter: brightness(0) drop-shadow(0 0 6px rgba(34, 230, 200, 0.5)); }
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-lock {
  position: absolute; left: 50%; top: 58%; transform: translate(-50%, -50%); z-index: 2; padding: 8px 12px; border-radius: 12px; pointer-events: none;
  font-size: 30px; line-height: 1; color: #fff; background: rgba(10, 12, 18, 0.8);
  box-shadow: inset 0 0 0 2px var(--rarity), 0 0 16px 2px color-mix(in srgb, var(--rarity) 55%, transparent);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-how {
  position: absolute; left: 6px; right: 6px; bottom: 6px; z-index: 3; padding: 6px 8px; border-radius: 6px; pointer-events: none;
  font-size: 13px; line-height: 1.2; color: #fff; text-align: center; background: rgba(8, 40, 44, 0.92); box-shadow: inset 0 0 0 1px var(--rarity);
  opacity: 0; transition: opacity 0.2s;
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity.apx-telling > .apx-how { opacity: 1; }
#ui .customization-panel-ui > .options-panel > button.apx-rarity.apx-telling { animation: apx-no 0.35s; }
@keyframes apx-no { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@keyframes apx-rarity-shine { 0% { background-position: 120% 0; } 60%, 100% { background-position: -120% 0; } }
@keyframes apx-rarity-glow { 50% { filter: drop-shadow(0 0 8px var(--rarity)); } }
@media (prefers-reduced-motion: reduce) {
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.legendary::after,
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.mythic,
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.icon::before,
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.icon::after,
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.icon > .apx-sparkles > i { animation: none; }
}
.livery-ui .slot .name .pattern { display: block; margin-top: 4px; font-size: 16px; }`;
  document.head.appendChild(css);

  window.ApexRarity = {
    info,
    ofStyle,
    owned,
    // a tile of the garage's Pattern, Rims, Exhaust, Wing or Body tab, sorted by rarity (the tabs are flex columns)
    item(kind, button, index) {
      const i = info(index, kind);
      if (i == null) return;
      const mine = owned(kind, index);
      button.classList.add('apx-rarity', i.rarity);
      button.style.setProperty('--rarity', i.color);
      button.style.order = String(i.rank * 100 + index);
      const shown = mine ? i.name : tr('À débloquer', 'To unlock');   // the rarity says which, under it
      button.title = mine ? `${i.name} · ${i.rarityName}` : shown;
      if (i.rarity === 'icon') {
        const sparkles = document.createElement('span');
        sparkles.className = 'apx-sparkles';
        sparkles.innerHTML = '<i></i><i></i><i></i>';
        button.appendChild(sparkles);
      }
      if (!mine) {
        button.classList.add('apx-unowned');
        const lock = document.createElement('span');
        lock.className = 'apx-lock';
        lock.textContent = '🔒';
        const how = document.createElement('span');
        how.className = 'apx-how';
        how.textContent = HOW[i.unlock]?.() ?? tr('Pas encore débloqué', 'Not unlocked yet');
        button.append(lock, how);
        let timer = null;
        // before the garage's own listener (same target, capture first): the item is not picked
        button.addEventListener('click', event => {
          event.stopImmediatePropagation();
          button.classList.remove('apx-telling');
          void button.offsetWidth;   // the shake again on each click
          button.classList.add('apx-telling');
          clearTimeout(timer);
          timer = setTimeout(() => button.classList.remove('apx-telling'), 2600);
        }, true);
      }
      const label = document.createElement('span');
      label.className = 'apx-rarity-label';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = shown;
      const tier = document.createElement('span');
      tier.className = 'tier';
      tier.textContent = i.rarityName;
      label.append(name, tier);
      button.appendChild(label);
    },
  };
})();
