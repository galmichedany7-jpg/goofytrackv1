// Checks GitHub for a newer GoofyTrack, downloads it into the GoofyTrack folder and rebuilds the game (GoofyTrack.exe,
// or GoofyTrack.app on macOS).
//
//   node sources/update.js [--play] [--check] [--status] [--force] ["C:\path\to\PolyTrack-v0.6.3-win32-x64"]
//   (macOS: "/path/to/PolyTrack.app")
//
//   --play    start the game afterwards (whether or not there was an update)
//   --check   only say whether an update is available
//   --status  print, as one line of JSON, what "GoofyTrack Launcher.exe" shows (installed and latest version…)
//   --force   rebuild the game even when everything is up to date
//
// Or open "GoofyTrack Launcher.exe" (Windows) or "GoofyTrack Launcher.command" (macOS), which run this script
// (sources/launcher/).
//
// - Folder cloned with git: `git pull`, i.e. the latest commits, with your own git credentials (refused if
//   you have local changes).
// - Folder downloaded as a ZIP: the latest release's source code is downloaded from GitHub (public repository,
//   no account or token needed) and copied over the GoofyTrack folder (files you added are kept).
// Then build.js runs if the game does not have this version yet. The very first time, the game is made from
// a PolyTrack 0.6.3 install (given as argument, found next to the folder, or asked), copied into the folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync, spawn } = require('child_process');
const { MAC, ROOT, EXE, installedVersion } = require('./config');
const { findPolyTrack, isPolyTrack, polyTrackApp } = require('./setup');
const layout = require('./layout');

const REPO = 'galmichedany7-jpg/goofytrackv1';
const LAUNCHER = path.join(ROOT, 'GoofyTrack Launcher.exe');   // Windows (macOS: "GoofyTrack Launcher.command", a script)
const SETTINGS = path.join(__dirname, 'update-settings.json');
const OLD_SETTINGS = path.join(ROOT, 'update-settings.json');    // where 2.17 and older kept them
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const polyTrackArg = process.argv.slice(2).find(a => !a.startsWith('--'));
// Run by the launcher (no console): nothing can be asked, the launcher asks beforehand
const interactive = !!process.stdin.isTTY;

const loadSettings = () => {
  if (!fs.existsSync(SETTINGS) && fs.existsSync(OLD_SETTINGS)) fs.renameSync(OLD_SETTINGS, SETTINGS);
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
};
const saveSettings = s => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
// The mod version of this folder, read fresh (config.js changes during an update)
const sourceVersion = () => /MOD_VERSION:\s*'([^']+)'/.exec(fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'))[1];
// "V2.4.1" -> [2, 4, 1]; compares numerically, a missing part counting as 0
const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

let rl;
const ask = async question => { rl ??= readline.createInterface({ input: process.stdin, output: process.stdout }); return (await rl.question(question)).trim(); };
const fail = message => { console.error('\n' + message); process.exitCode = 1; };

// The PolyTrack install the game is made from, the first time only
function knownSource(settings) {
  if (polyTrackArg) return polyTrackApp(polyTrackArg) || path.resolve(polyTrackArg);
  if (isPolyTrack(settings.game)) return settings.game;   // where older versions installed the mod
  return findPolyTrack();
}
async function findSource(settings) {
  const known = knownSource(settings);
  if (known) return known;
  const what = MAC ? 'PolyTrack.app' : 'le dossier qui contient PolyTrack.exe';
  if (!interactive) throw new Error(`PolyTrack 0.6.3 introuvable : indiquez ${what}.`);
  while (true) {
    const dir = await ask(MAC ? 'Faites glisser PolyTrack.app ici puis appuyez sur Entrée : ' : 'Dossier de PolyTrack (celui qui contient PolyTrack.exe) : ');
    if (isPolyTrack(dir)) return polyTrackApp(dir);
    console.log(MAC ? 'Ce n\'est pas PolyTrack.app pour macOS.' : 'PolyTrack.exe introuvable dans ce dossier.');
  }
}

async function github(url, raw = false) {
  const res = await fetch(url, { headers: { 'User-Agent': 'GoofyTrack-updater', Accept: 'application/vnd.github+json' } });
  if (res.ok) return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
  if (res.status === 404) throw new Error(`dépôt ${REPO} ou release introuvable sur GitHub (le dépôt doit être public).`);
  if (res.status === 403 || res.status === 429) throw new Error('GitHub limite le nombre de vérifications : réessayez dans une heure.');
  throw new Error(`GitHub a répondu ${res.status} ${res.statusText}`);
}
const latestRelease = () => github(`https://api.github.com/repos/${REPO}/releases/latest`);

function gameRunning() {
  if (MAC) {   // the app's processes all run from inside it
    try { return execFileSync('pgrep', ['-f', path.join(EXE, 'Contents', 'MacOS') + '/'], { encoding: 'utf8' }).trim() !== ''; } catch { return false; }
  }
  const name = path.basename(EXE);
  try { return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { encoding: 'utf8' }).includes(name); } catch { return false; }
}
function startGame() {
  if (MAC) spawn('open', [EXE], { detached: true, stdio: 'ignore' }).unref();
  else spawn(EXE, [], { cwd: path.dirname(EXE), detached: true, stdio: 'ignore' }).unref();
}

const isGit = () => fs.existsSync(path.join(ROOT, '.git'));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Folder downloaded as a ZIP: replace it with the latest release
async function updateFromRelease() {
  const release = await latestRelease();
  const latest = release.tag_name.replace(/^v/i, ''), current = sourceVersion();
  if (!newer(latest, current)) { console.log(`GoofyTrack ${current} est la dernière version.`); return false; }
  console.log(`Nouvelle version disponible : ${release.name || release.tag_name} (vous avez la ${current})`);
  if (flags.has('--check')) return false;

  console.log('Téléchargement…');
  const zip = await github(release.zipball_url, true);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goofytrack-'));
  try {
    fs.writeFileSync(path.join(temp, 'release.zip'), zip);
    const out = path.join(temp, 'release');
    fs.mkdirSync(out);
    // Windows' own tar (10 and later), which reads ZIPs: another tar first in the PATH (Git's) does not
    const windowsTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(!MAC && fs.existsSync(windowsTar) ? windowsTar : 'tar', ['-xf', path.join(temp, 'release.zip'), '-C', out]);
    // GitHub puts everything in one folder named after the repository and the commit
    const [root] = fs.readdirSync(out);
    if (!root || !fs.existsSync(path.join(out, root, 'sources', 'build.js'))) throw new Error("L'archive téléchargée ne ressemble pas à GoofyTrack.");
    layout.reveal();   // a hidden file cannot be overwritten: the build hides them again
    // The launcher may be the one running this: a running exe cannot be overwritten, but it can be renamed
    // (the launcher deletes the .old file when it starts)
    if (!MAC && fs.existsSync(path.join(out, root, path.basename(LAUNCHER))) && fs.existsSync(LAUNCHER)) {
      fs.rmSync(LAUNCHER + '.old', { force: true });
      fs.renameSync(LAUNCHER, LAUNCHER + '.old');
    }
    fs.cpSync(path.join(out, root), ROOT, { recursive: true, force: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`GoofyTrack ${sourceVersion()} téléchargé.`);
  return true;
}

// Folder cloned with git: pull, as the README says
function updateFromGit() {
  if (git('status', '--porcelain', '--untracked-files=no')) {
    console.log('Ce dossier a des modifications locales : pas de mise à jour automatique, faites `git pull` vous-même.');
    return false;
  }
  if (flags.has('--check')) {
    git('fetch', '--quiet');
    const behind = Number(git('rev-list', '--count', 'HEAD..@{u}'));
    console.log(behind ? `${behind} nouveau(x) commit(s) disponible(s).` : 'GoofyTrack est à jour.');
    return false;
  }
  const before = git('rev-parse', 'HEAD');
  process.stdout.write(git('pull', '--ff-only') + '\n');
  return git('rev-parse', 'HEAD') !== before;
}

// What the launcher shows, as one line of JSON
async function status(settings) {
  const s = { hasGame: fs.existsSync(EXE), installed: installedVersion(), source: sourceVersion(), latest: null, updateAvailable: false, git: isGit(), polyTrack: null, gameRunning: gameRunning(), error: null };
  if (!s.hasGame) s.polyTrack = knownSource(settings);
  try {
    if (s.git) {
      git('fetch', '--quiet');
      const behind = Number(git('rev-list', '--count', 'HEAD..@{u}'));
      s.updateAvailable = behind > 0;
      s.latest = behind ? `${behind} commit(s)` : s.source;
    } else {
      s.latest = (await latestRelease()).tag_name.replace(/^v/i, '');
      s.updateAvailable = newer(s.latest, s.source);
    }
  } catch (e) {
    s.error = e.message;
  }
  process.stdout.write(JSON.stringify(s) + '\n');
}

async function main() {
  const settings = loadSettings();
  if ('token' in settings) { delete settings.token; saveSettings(settings); }   // the repository is public now
  if (flags.has('--status')) return status(settings);
  try {
    isGit() ? updateFromGit() : await updateFromRelease();
  } catch (e) {
    // Offline or GitHub unreachable: still let the player in with what they have
    fail(`Impossible de vérifier les mises à jour : ${e.message}`);
    if (!flags.has('--play') && fs.existsSync(EXE)) return;
    process.exitCode = 0;
  }
  if (flags.has('--check')) return;

  const source = fs.existsSync(EXE) ? null : await findSource(settings);

  const version = sourceVersion(), installed = installedVersion();
  if (source || installed !== version || flags.has('--force')) {
    console.log(installed ? `Construction de GoofyTrack ${version} (le jeu avait la ${installed})…` : `Construction de GoofyTrack ${version}…`);
    while (gameRunning()) {
      if (!interactive) throw new Error('GoofyTrack est ouvert : fermez le jeu puis recommencez.');
      await ask('GoofyTrack est ouvert : fermez le jeu puis appuyez sur Entrée.');
    }
    // a fresh process, so the build runs the scripts just downloaded
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), ...(source ? [source] : [])], { stdio: 'inherit' });
    if (source && 'game' in settings) { delete settings.game; saveSettings(settings); }
    if (source) console.log(`\nLe jeu est maintenant dans le dossier GoofyTrack : ${EXE}\nL'ancien dossier de PolyTrack n'est plus utilisé par GoofyTrack.`);
  } else {
    console.log(`Le jeu a déjà GoofyTrack ${version}.`);
  }
  layout.hide();   // a file git or the release just wrote is no longer hidden (the build hides them too)

  if (flags.has('--play')) {
    startGame();
    console.log('Bon jeu !');
  }
}

main().catch(e => fail(e.message)).finally(() => rl?.close());
