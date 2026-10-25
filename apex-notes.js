// Patch notes in the game: a "Patch notes" button in the home screen's bottom bar opens PATCHNOTES.md,
// one fold per version, the latest open. A dot on the button until the latest version has been read.
//
// build.js puts the text of PATCHNOTES.md in window.GOOFY_PATCHNOTES, in front of this script. Only what
// players care about is shown: the "Mise à jour" (how to install) paragraphs and the "Outils" / "Comment
// c'est fait" (development) sections stay in the file. Display only: not part of the build fingerprint,
// which is why the styles live here and not in apex-theme.css.
(() => {
  'use strict';

  const SEEN_KEY = 'goofytrack_patchnotes_seen';
  const HIDDEN_SECTIONS = ['Outils', 'Comment c\'est fait'];
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');

  // "## V2.11 : title" -> { version: '2.11', title, lines }
  function parse(markdown) {
    const versions = [];
    for (const line of String(markdown || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
      const head = /^## V?([\d.]+)\s*:\s*(.*)$/.exec(line);
      if (head) versions.push({ version: head[1], title: head[2], lines: [] });
      else if (versions.length) versions[versions.length - 1].lines.push(line);
    }
    return versions;
  }

  // **bold**, `code` and [links](...) (shown as their text): built as nodes, never as HTML
  function inline(parent, text) {
    const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;
    let last = 0, m;
    while ((m = re.exec(text)) != null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] != null) inline(parent.appendChild(document.createElement('strong')), m[1]);
      else if (m[2] != null) parent.appendChild(document.createElement('code')).textContent = m[2];
      else inline(parent, m[3]);
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderBody(lines) {
    const body = document.createElement('div');
    body.className = 'body';
    let list = null, sub = null, hidden = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { list = sub = null; continue; }
      const section = /^\*\*([^*]+)\*\*(.*)$/.exec(line);
      if (section) {
        list = sub = null;
        // "**Mise à jour** : …" is the end of a version's notes; "**Outils**" starts a hidden section
        if (section[1].startsWith('Mise à jour')) { hidden = true; continue; }
        hidden = HIDDEN_SECTIONS.includes(section[1]);
        if (hidden) continue;
        if (!section[2].trim() || /^\s*\(/.test(section[2])) { inline(body.appendChild(document.createElement('h4')), section[1]); continue; }
      }
      if (hidden) continue;
      const item = /^(\s*)[-*] (.*)$/.exec(line) || /^(\s*)\d+\. (.*)$/.exec(line);
      if (item) {
        if (item[1].length >= 2 && list) {
          sub ??= list.lastElementChild.appendChild(document.createElement('ul'));
          inline(sub.appendChild(document.createElement('li')), item[2]);
        } else {
          list ??= body.appendChild(document.createElement('ul'));
          sub = null;
          inline(list.appendChild(document.createElement('li')), item[2]);
        }
        continue;
      }
      list = sub = null;
      inline(body.appendChild(document.createElement('p')), line);
    }
    return body;
  }

  const versions = parse(window.GOOFY_PATCHNOTES);
  const latest = versions.length ? versions[0].version : null;
  const seen = () => { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } };

  let overlay = null;
  function close() {
    if (overlay == null) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
  }
  // Escape closes the notes and nothing else: the game must not see it
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }

  function open() {
    if (overlay != null) return;
    overlay = document.createElement('div');
    overlay.className = 'apex-notes';
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const panel = overlay.appendChild(document.createElement('div'));
    panel.className = 'panel';
    const header = panel.appendChild(document.createElement('div'));
    header.className = 'header';
    header.appendChild(document.createElement('h2')).textContent = 'Patch notes';
    const closeButton = header.appendChild(document.createElement('button'));
    closeButton.className = 'close';
    closeButton.textContent = '✕';
    closeButton.title = french() ? 'Fermer' : 'Close';
    closeButton.addEventListener('click', close);
    const list = panel.appendChild(document.createElement('div'));
    list.className = 'list';
    versions.forEach((v, i) => {
      const fold = list.appendChild(document.createElement('details'));
      fold.open = i === 0;
      const summary = fold.appendChild(document.createElement('summary'));
      summary.appendChild(document.createElement('span')).className = 'version';
      summary.lastChild.textContent = 'V' + v.version;
      inline(summary.appendChild(document.createElement('span')), v.title);
      summary.lastChild.className = 'title';
      fold.appendChild(renderBody(v.lines));
    });
    if (!versions.length) list.appendChild(document.createElement('p')).textContent = french() ? 'Aucune note de version.' : 'No patch notes.';
    document.getElementById('ui').appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    try { localStorage.setItem(SEEN_KEY, latest); } catch (e) { /* storage unavailable */ }
    document.querySelectorAll('#ui .apex-notes-button').forEach(b => b.classList.remove('unread'));
  }

  function addMenuButton() {
    const bar = document.querySelector('#ui .menu-ui > .button-bar');
    if (bar == null || bar.querySelector('.apex-notes-button') != null) return;
    const button = document.createElement('button');
    button.className = 'button apex-notes-button' + (latest && seen() !== latest ? ' unread' : '');
    button.textContent = 'Patch notes';
    button.appendChild(document.createElement('span')).className = 'dot';
    button.addEventListener('click', open);
    bar.insertBefore(button, bar.querySelector('.right'));
  }

  // the button stands on the right, just above "Terms & Privacy" (the bar's .right: floated, 6px from the bar's padding)
  const STYLE = `
#ui .menu-ui > .button-bar > .apex-notes-button { position: absolute; right: 22px; bottom: calc(100% - 4px); margin: 0; }
#ui .apex-notes-button > .dot { display: none; }
#ui .apex-notes-button.unread > .dot {
  display: inline-block; width: 8px; height: 8px; margin-left: 8px; border-radius: 50%; vertical-align: middle;
  background-color: var(--apx-accent, #f20d16); box-shadow: 0 0 8px var(--apx-accent, #f20d16);
}
#ui .apex-notes {
  position: absolute; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  background-color: rgba(0, 0, 0, 0.45); pointer-events: auto;
}
#ui .apex-notes > .panel {
  display: flex; flex-direction: column; width: min(780px, calc(100% - 32px)); max-height: calc(100% - 64px);
  border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--apx-blur, blur(22px)); color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif);
  text-align: left; user-select: text;
}
#ui .apex-notes .header {
  display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 14px 26px;
  border-bottom: 1px solid var(--apx-line, rgba(255, 255, 255, 0.09));
}
#ui .apex-notes h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
#ui .apex-notes .close {
  width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%; cursor: pointer; font-size: 16px;
  color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
#ui .apex-notes .close:hover { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-notes .list { overflow-y: auto; padding: 10px 14px 18px 14px; }
#ui .apex-notes details { margin: 4px 0; border-radius: var(--apx-r-md, 12px); }
#ui .apex-notes details[open] { background-color: var(--apx-fill, rgba(255, 255, 255, 0.055)); }
#ui .apex-notes summary {
  display: flex; align-items: baseline; gap: 12px; padding: 12px 14px; border-radius: var(--apx-r-md, 12px);
  cursor: pointer; list-style: none; font-size: 16px; font-weight: 600;
}
#ui .apex-notes summary::-webkit-details-marker { display: none; }
#ui .apex-notes summary:hover { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
#ui .apex-notes summary .version {
  flex: none; min-width: 64px; padding: 3px 10px; border-radius: var(--apx-r-pill, 999px); text-align: center;
  font-size: 13px; letter-spacing: 0.08em; color: var(--apx-fg, #f3f5f8); background-color: var(--apx-ink-700, #222835);
}
#ui .apex-notes details:first-child summary .version { color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16); }
#ui .apex-notes .body { padding: 0 20px 14px 20px; font-size: 14px; line-height: 1.5; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
#ui .apex-notes .body h4 { margin: 14px 0 4px 0; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--apx-fg, #f3f5f8); }
#ui .apex-notes .body p { margin: 8px 0; }
#ui .apex-notes .body ul { margin: 4px 0; padding-left: 20px; }
#ui .apex-notes .body li { margin: 3px 0; }
#ui .apex-notes .body li::marker { color: var(--apx-accent, #f20d16); }
#ui .apex-notes .body strong { color: var(--apx-fg, #f3f5f8); font-weight: 600; }
#ui .apex-notes .body code { font-family: Consolas, monospace; font-size: 13px; }
`;

  window.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(document.createElement('style')).textContent = STYLE;
    new MutationObserver(addMenuButton).observe(document.getElementById('ui'), { childList: true, subtree: true });
  });
})();
