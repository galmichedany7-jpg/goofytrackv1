// Player rankings (2.26): a "Classements" button on the home screen (top right) opens the GoofyTrack players ranked
// on each stat of their profile card but the average place: distance, time driving, average speed, top speed,
// finishes, races finished, wins, podiums, the Grands Prix and endurance races played and won (between players or
// in a special tournament), tournaments played and won. The server ranks them from the stats each
// game sends with its presence (server/accounts.js, GET /account/rankings): the top 100, and the player's own place
// when logged in. The list is fetched again every 30 s while it is open, and a click on a player opens their card.
(() => {
  'use strict';

  const REFRESH = 30 * 1000;
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);
  const locale = () => (french() ? 'fr-FR' : 'en-GB');
  const number = (n, digits = 0) => n.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const duration = s => { const m = Math.floor(s / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };

  // the card's stats, in its order and sections (apex-account.js); value: what a row shows
  const GROUPS = [
    [() => tr('Au volant', 'Driving'), [
      ['metres', () => tr('Distance parcourue', 'Distance driven'), v => number(v / 1000) + ' km'],
      ['seconds', () => tr('Temps au volant', 'Time driving'), duration],
      ['avgSpeed', () => tr('Vitesse moyenne', 'Average speed'), v => number(v) + ' km/h'],
      ['topKmh', () => tr('Vitesse max', 'Top speed'), v => number(v) + ' km/h'],
      ['finishes', () => tr('Arrivées', 'Finishes'), v => number(v)],
    ]],
    [() => tr('Mode Course en multijoueur', 'Multiplayer race mode'), [
      ['races', () => tr('Courses terminées', 'Races finished'), v => number(v)],
      ['wins', () => tr('Victoires', 'Wins'), v => number(v)],
      ['podiums', () => tr('Podiums', 'Podiums'), v => number(v)],
    ]],
    // the four formats of the card (2.26): played and won
    ...[
      ['gps', 'gpWins', () => tr('Course : Grand Prix', 'Race: Grand Prix'), () => tr('Grands Prix', 'Grands Prix')],
      ['ends', 'endWins', () => tr('Course : Endurance', 'Race: Endurance'), () => tr('Endurances', 'Endurance races')],
      ['tGps', 'tGpWins', () => tr('Tournoi : Grand Prix', 'Tournament: Grand Prix'), () => tr('Tournois Grand Prix', 'Grand Prix tournaments')],
      ['tEnds', 'tEndWins', () => tr('Tournoi : Endurance', 'Tournament: Endurance'), () => tr('Tournois Endurance', 'Endurance tournaments')],
    ].map(([played, won, title, what]) => [title, [
      [played, () => tr('Joués', 'Played'), v => number(v), () => what() + tr(' joués', ' played')],
      [won, () => tr('Gagnés', 'Won'), v => number(v), () => what() + tr(' gagnés', ' won')],
    ]]),
    [() => tr('Tous les tournois', 'All tournaments'), [
      ['entered', () => tr('Tournois joués', 'Tournaments played'), v => number(v)],
      ['tournaments', () => tr('Tournois gagnés', 'Tournaments won'), v => number(v)],
    ]],
  ];
  const STATS = new Map(GROUPS.flatMap(([, list]) => list.map(s => [s[0], s])));

  const el = (parent, tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  let overlay = null, stat = 'metres', timer = null, asked = 0;
  const cache = new Map();               // stat -> { time, data }

  function close() {
    if (overlay == null) return;
    overlay.remove();
    overlay = null;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
  }
  // Escape closes the rankings, not the game's menu; a player's card opened over them closes first (apex-account.js)
  function onKey(event) {
    if (event.key !== 'Escape' || document.querySelector('#ui .apex-account') != null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }

  async function load(which, force = false) {
    const known = cache.get(which);
    if (known && !force && Date.now() - known.time < REFRESH) return known.data;
    const data = await window.ApexAccount.rankings(which);
    cache.set(which, { time: Date.now(), data });
    return data;
  }

  // the list of the stat picked; a message while it loads or when the server cannot be reached
  async function show(which, force = false) {
    stat = which;
    if (overlay == null) return;
    overlay.querySelectorAll('.stats button').forEach(b => b.classList.toggle('on', b.dataset.stat === which));
    const [, label, format, heading] = STATS.get(which);   // heading: the list's title, when the button's is short
    const board = overlay.querySelector('.board');
    board.querySelector('h3').textContent = (heading || label)();
    const list = board.querySelector('.list'), foot = board.querySelector('.foot');
    if (!cache.has(which)) { list.textContent = ''; el(list, 'div', 'message', tr('Chargement…', 'Loading…')); foot.textContent = ''; }
    const ticket = ++asked;
    let data;
    try { data = await load(which, force); } catch (e) {
      if (ticket !== asked || overlay == null) return;
      list.textContent = '';
      el(list, 'div', 'message', e.message || tr('Serveur injoignable.', 'Server unreachable.'));
      return;
    }
    if (ticket !== asked || overlay == null) return;
    list.textContent = '';
    const mine = board.querySelector('.mine');
    mine.textContent = '';
    if (!data.top.length) el(list, 'div', 'message', tr('Personne n\'est encore classé ici.', 'Nobody is ranked here yet.'));
    const row = (p, me, parent = list) => {
      const r = el(parent, 'button', 'row' + (p.rank <= 3 ? ' p' + p.rank : '') + (me ? ' me' : ''));
      r.title = tr('Voir son profil', 'See their profile');
      el(r, 'span', 'rank', String(p.rank));
      const who = el(r, 'span', 'who');
      if (p.countryCode) { const f = el(who, 'img', 'flag'); f.src = 'images/countries/' + p.countryCode + '.svg'; f.draggable = false; }
      el(who, 'span', 'name', p.name);
      window.ApexAccount?.statusMarks?.(who, p);   // the co-creators' check mark, the VIPs' emblem
      el(r, 'span', 'value', format(p.value));
      r.addEventListener('click', () => window.ApexAccount?.openPlayer?.(p.id));
      return r;
    };
    const myId = window.ApexAccount?.id;
    for (const p of data.top) row(p, p.id === myId);
    // the player's own place, held under the list when they are not in it
    if (data.me != null && !data.top.some(p => p.id === data.me.id)) row(data.me, true, mine);
    const notes = [tr(`${number(data.players)} joueur${data.players > 1 ? 's' : ''} classé${data.players > 1 ? 's' : ''}`, `${number(data.players)} player${data.players > 1 ? 's' : ''} ranked`)];
    if (data.minSeconds) notes.push(tr(`à partir de ${Math.round(data.minSeconds / 60)} min de course chronométrée`, `from ${Math.round(data.minSeconds / 60)} min of timed driving`));
    if (window.ApexAccount?.name == null) notes.push(tr('connectez-vous pour y figurer', 'log in to be in it'));
    notes.push(tr('mis à jour toutes les 30 s', 'updated every 30 s'));
    foot.textContent = notes.join('  ·  ');
  }

  function open() {
    if (overlay != null || window.ApexAccount?.rankings == null) return;
    overlay = el(document.getElementById('ui'), 'div', 'apex-rankings');
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const panel = el(overlay, 'div', 'panel');
    const header = el(panel, 'div', 'header');
    el(header, 'h2', null, tr('Classements des joueurs', 'Player rankings'));
    const closeButton = el(header, 'button', 'close', '✕');
    closeButton.title = tr('Fermer', 'Close');
    closeButton.addEventListener('click', close);
    const body = el(panel, 'div', 'content');
    const stats = el(body, 'div', 'stats');
    for (const [title, list] of GROUPS) {
      el(stats, 'div', 'group', title());
      for (const [key, label] of list) {
        const b = el(stats, 'button', null, label());
        b.dataset.stat = key;
        b.addEventListener('click', () => show(key));
      }
    }
    const board = el(body, 'div', 'board');
    el(board, 'h3');
    el(board, 'div', 'list');
    el(board, 'div', 'mine');
    el(board, 'div', 'foot');
    document.addEventListener('keydown', onKey, true);
    timer = setInterval(() => show(stat, true), REFRESH);
    show(stat);
  }

  // the button, top right of the home screen (the profile badge is top left: apex-account.js)
  function addButton() {
    const menu = document.querySelector('#ui .menu-ui');
    if (menu == null || menu.querySelector(':scope > .apex-rankings-button') != null) return;
    const button = el(menu, 'div', 'apex-rankings-button');   // a div: the theme paints the home screen's last button
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    el(button, 'span', 'icon', '🏆');
    el(button, 'span', 'label', tr('Classements', 'Rankings'));
    button.addEventListener('click', open);
    button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  }

  const STYLE = `
#ui .menu-ui > .apex-rankings-button {
  position: absolute; z-index: 3; top: 16px; right: calc(16px + var(--safe-area-horizontal, 0px));
  display: flex; align-items: center; gap: 10px; padding: 12px 22px 12px 18px; cursor: pointer; outline: none;
  border-radius: var(--apx-r-pill, 999px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif); font-size: 18px; font-weight: 700; pointer-events: auto;
  transition: background-color 0.15s;
}
#ui .menu-ui > .apex-rankings-button:hover, #ui .menu-ui > .apex-rankings-button:focus-visible { background-color: var(--apx-ink-700, #222835); }
#ui .menu-ui > .apex-rankings-button .icon { font-size: 20px; }
#ui .menu-ui.loading-screen > .apex-rankings-button, #ui .menu-ui:has(> .main-buttons-container.hidden) > .apex-rankings-button { display: none; }
#ui .apex-rankings {
  position: absolute; inset: 0; z-index: 99; display: flex; align-items: center; justify-content: center;
  background-color: rgba(0, 0, 0, 0.45); pointer-events: auto;
}
#ui .apex-rankings > .panel {
  display: flex; flex-direction: column; width: min(920px, calc(100% - 32px)); height: min(680px, calc(100% - 64px));
  border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--apx-blur, blur(22px)); color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif); text-align: left;
}
#ui .apex-rankings .header {
  display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 14px 26px;
  border-bottom: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09));
}
#ui .apex-rankings h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
#ui .apex-rankings .close {
  width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%; cursor: pointer; font-size: 16px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-rankings .close:hover { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-rankings .content { display: flex; flex: 1; min-height: 0; }
#ui .apex-rankings .stats {
  flex: none; width: 230px; padding: 10px 10px 16px 14px; overflow-y: auto; border-right: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09));
}
#ui .apex-rankings .stats .group {
  margin: 14px 8px 6px 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--apx-fg-subtle, rgba(243, 245, 248, 0.36));
}
#ui .apex-rankings .stats .group:first-child { margin-top: 6px; }
#ui .apex-rankings .stats button {
  display: block; width: 100%; margin: 2px 0; padding: 9px 12px; border: none; border-radius: var(--apx-r-sm, 8px); cursor: pointer;
  text-align: left; font: inherit; font-size: 15px; font-weight: 600; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.62)); background: none;
}
#ui .apex-rankings .stats button:hover { color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-rankings .stats button.on { color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16); }
#ui .apex-rankings .board { display: flex; flex-direction: column; flex: 1; min-width: 0; padding: 14px 18px 12px 18px; }
#ui .apex-rankings h3 { margin: 4px 6px 12px 6px; font-size: 20px; font-weight: 700; }
#ui .apex-rankings .list { flex: 1; overflow-y: auto; }
#ui .apex-rankings .row {
  display: flex; align-items: center; gap: 14px; width: 100%; margin: 0 0 4px 0; padding: 9px 14px; border: none; cursor: pointer;
  border-radius: var(--apx-r-md, 12px); font: inherit; text-align: left; color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-rankings .row:hover { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-rankings .row.me { box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16); }
#ui .apex-rankings .row .rank { flex: none; width: 40px; font-size: 18px; font-weight: 800; text-align: center; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.62)); }
#ui .apex-rankings .row.p1 .rank { color: #f7c21a; }
#ui .apex-rankings .row.p2 .rank { color: #cfd6e0; }
#ui .apex-rankings .row.p3 .rank { color: #d98a4e; }
#ui .apex-rankings .row .who { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; font-size: 17px; font-weight: 600; }
#ui .apex-rankings .row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui .apex-rankings .row .flag { flex: none; width: 24px; height: 18px; }
#ui .apex-rankings .row .verified { flex: none; display: inline-flex; width: 18px; height: 18px; color: #f5c518; }
#ui .apex-rankings .row .verified.vip { width: 28px; height: 18px; filter: drop-shadow(0 0 3px rgba(180, 92, 255, 0.55)); }
#ui .apex-rankings .row .verified svg { width: 100%; height: 100%; }
#ui .apex-rankings .row .value { flex: none; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
#ui .apex-rankings .mine:not(:empty) { padding-top: 8px; border-top: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09)); }
#ui .apex-rankings .mine .row { margin: 0; }
#ui .apex-rankings .message { padding: 30px 10px; text-align: center; font-size: 15px; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.62)); }
#ui .apex-rankings .foot { margin: 10px 6px 0 6px; font-size: 13px; color: var(--apx-fg-subtle, rgba(243, 245, 248, 0.36)); }
@media (max-width: 700px) {
  #ui .apex-rankings .content { flex-direction: column; }
  #ui .apex-rankings .stats { display: flex; width: auto; gap: 6px; padding: 10px 14px; overflow-x: auto; overflow-y: hidden; border-right: none; border-bottom: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09)); }
  #ui .apex-rankings .stats .group { display: none; }
  #ui .apex-rankings .stats button { flex: none; width: auto; white-space: nowrap; }
}
`;

  window.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(document.createElement('style')).textContent = STYLE;
    new MutationObserver(addButton).observe(document.getElementById('ui'), { childList: true, subtree: true });
  });
  window.ApexRankings = { open, close };
})();
