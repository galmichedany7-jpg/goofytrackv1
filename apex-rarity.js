// Car pattern rarities: each pattern of the garage has a name and a rarity, shown on its tile, whose frame
// takes the rarity's colour (common grey to mythic red). Display only for now: every pattern stays free
// (crates to unlock them may come later). The liveries (apex-livery.js) show the name of theirs.
//
// patch_bundle.js has the garage call pattern(button, index) for each tile of its Pattern tab.
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
  ];

  function info(index) {
    const p = PATTERNS[index];
    if (p == null) return null;
    const r = RARITIES[p.rarity];
    return { name: tr(p.fr, p.en), rarity: p.rarity, rarityName: tr(r.fr, r.en), color: r.color };
  }
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
  position: absolute; left: 8px; right: 8px; top: 7px;   /* above the car, drawn lower in the tile */
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  pointer-events: none; text-align: left; line-height: 1.1;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
#ui .customization-panel-ui > .options-panel > button.apx-rarity > .apx-rarity-label > .name {
  font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
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
@keyframes apx-rarity-shine { 0% { background-position: 120% 0; } 60%, 100% { background-position: -120% 0; } }
@keyframes apx-rarity-glow { 50% { filter: drop-shadow(0 0 8px var(--rarity)); } }
@media (prefers-reduced-motion: reduce) {
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.legendary::after,
  #ui .customization-panel-ui > .options-panel > button.apx-rarity.mythic { animation: none; }
}
.livery-ui .slot .name .pattern { display: block; margin-top: 4px; font-size: 16px; }`;
  document.head.appendChild(css);

  window.ApexRarity = {
    info,
    ofStyle,
    // a tile of the garage's Pattern tab
    pattern(button, index) {
      const i = info(index);
      if (i == null) return;
      button.classList.add('apx-rarity', i.rarity);
      button.style.setProperty('--rarity', i.color);
      button.title = `${i.name} · ${i.rarityName}`;
      const label = document.createElement('span');
      label.className = 'apx-rarity-label';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = i.name;
      const tier = document.createElement('span');
      tier.className = 'tier';
      tier.textContent = i.rarityName;
      label.append(name, tier);
      button.appendChild(label);
    },
  };
})();
