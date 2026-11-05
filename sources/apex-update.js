// New version available: at launch, the game asks GitHub for the latest GoofyTrack release (the same one
// GoofyTrack Launcher installs, sources/update.js) and, when it is newer than this build, says so in a popup.
// An older build no longer meets the others in the rooms and its progress may not be kept, so the popup offers to
// quit and open the launcher (electron/main.js), or to play on anyway. Once per launch: the account reloads the
// page once the save is written (apex-account.js), which must not show it again.
//
// build.js puts the version of this build in window.GOOFY_VERSION and the repository in window.GOOFY_REPO, in
// front of this script. Display only: not part of the build fingerprint.
(() => {
  'use strict';

  const SHOWN_KEY = 'goofytrack_update_shown';   // sessionStorage: survives the account's reload, not a new launch
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  // "V2.4.1" -> [2, 4, 1]; compares numerically, a missing part counting as 0 (as update.js does)
  const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };

  async function latestRelease() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`https://api.github.com/repos/${window.GOOFY_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: controller.signal,
      });
      return res.ok ? await res.json() : null;   // offline, rate limited, no release: say nothing
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  let overlay = null;
  function close() {
    if (overlay == null) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', swallow, true);
  }
  // the game sees no key while the popup is up; Escape plays on
  function swallow(event) { event.stopImmediatePropagation(); }
  function onKey(event) {
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }

  function show(latest) {
    const fr = french();
    const desktop = window.electron != null && typeof window.electron.openLauncher === 'function';
    overlay = document.createElement('div');
    overlay.className = 'apex-update';
    const panel = overlay.appendChild(document.createElement('div'));
    panel.className = 'panel';
    panel.appendChild(document.createElement('div')).className = 'badge';
    panel.lastChild.textContent = 'V' + latest;
    panel.appendChild(document.createElement('h2')).textContent = fr ? 'Mise à jour disponible' : 'Update available';
    panel.appendChild(document.createElement('p')).textContent = fr
      ? `GoofyTrack ${latest} est sorti (vous avez la ${window.GOOFY_VERSION}).`
      : `GoofyTrack ${latest} is out (you have ${window.GOOFY_VERSION}).`;
    panel.appendChild(document.createElement('p')).textContent = fr
      ? 'Pour continuer à enregistrer votre progression et jouer en multijoueur, quittez le jeu et lancez GoofyTrack Launcher pour mettre à jour.'
      : 'To keep saving your progress and play multiplayer, quit the game and open GoofyTrack Launcher to update.';
    const error = panel.appendChild(document.createElement('p'));
    error.className = 'error';
    const buttons = panel.appendChild(document.createElement('div'));
    buttons.className = 'buttons';
    const later = buttons.appendChild(document.createElement('button'));
    later.className = 'later';
    later.textContent = fr ? 'Jouer quand même' : 'Play anyway';
    later.addEventListener('click', close);
    if (desktop) {
      const go = buttons.appendChild(document.createElement('button'));
      go.className = 'go';
      go.textContent = fr ? 'Quitter et ouvrir le launcher' : 'Quit and open the launcher';
      go.addEventListener('click', async () => {
        go.disabled = true;
        const failure = await window.electron.openLauncher();   // quits the game once the launcher is open
        if (failure) {
          go.disabled = false;
          error.textContent = fr ? `Impossible d'ouvrir le launcher : ${failure}` : `Could not open the launcher: ${failure}`;
        }
      });
      setTimeout(() => go.focus(), 0);
    }
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', swallow, true);
  }

  async function check() {
    if (!window.GOOFY_VERSION || !window.GOOFY_REPO) return;
    try { if (sessionStorage.getItem(SHOWN_KEY)) return; } catch (e) { /* storage unavailable */ }
    const release = await latestRelease();
    if (release == null || typeof release.tag_name !== 'string') return;
    const latest = release.tag_name.replace(/^v/i, '');
    if (!newer(latest, window.GOOFY_VERSION)) return;
    try { sessionStorage.setItem(SHOWN_KEY, latest); } catch (e) { /* storage unavailable */ }
    show(latest);
  }

  const STYLE = `
.apex-update {
  position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  background-color: rgba(0, 0, 0, 0.55); pointer-events: auto;
}
.apex-update > .panel {
  width: min(520px, calc(100% - 32px)); padding: 28px 30px 24px 30px; box-sizing: border-box;
  border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12, 14, 19, 0.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255, 255, 255, 0.09)), var(--apx-shadow, 0 18px 50px rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--apx-blur, blur(22px)); color: var(--apx-fg, #f3f5f8); font-family: var(--apx-font, sans-serif);
  text-align: left;
}
.apex-update .badge {
  display: inline-block; padding: 3px 12px; border-radius: var(--apx-r-pill, 999px); font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16);
}
.apex-update h2 { margin: 12px 0 10px 0; font-size: 22px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.apex-update p { margin: 8px 0; font-size: 15px; line-height: 1.5; color: var(--apx-fg-muted, rgba(243, 245, 248, 0.75)); }
.apex-update p.error { color: var(--apx-accent, #f20d16); }
.apex-update p.error:empty { display: none; }
.apex-update .buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.apex-update button {
  padding: 10px 18px; border: none; border-radius: var(--apx-r-pill, 999px); cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600; color: var(--apx-fg, #f3f5f8);
  background-color: var(--apx-fill, rgba(255, 255, 255, 0.055));
}
.apex-update button:hover { background-color: var(--apx-fill-hover, rgba(255, 255, 255, 0.11)); }
.apex-update button.go { color: var(--apx-accent-ink, #fff); background-color: var(--apx-accent, #f20d16); }
.apex-update button.go:hover { filter: brightness(1.12); }
.apex-update button:disabled { opacity: 0.6; cursor: default; }
`;

  window.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(document.createElement('style')).textContent = STYLE;
    check();
  });
})();
