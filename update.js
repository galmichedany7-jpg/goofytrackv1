// Checks GitHub for a newer GoofyTrack release, downloads it over this folder and reinstalls it into the game.
//
//   node update.js ["C:\path\to\PolyTrack-v0.6.3-win32-x64"] [--play] [--check] [--force]
//
//   --play   start the game afterwards (whether or not there was an update)
//   --check  only say whether an update is available
//   --force  reinstall into the game even when everything is up to date
//
// Or double-click "Mettre a jour GoofyTrack.bat" / "Jouer a GoofyTrack.bat".
//
// - Folder downloaded as a ZIP: the latest release's source code is downloaded from GitHub and copied over
//   this folder (files you added are kept). The repository being private, the first run asks for a GitHub
//   token, kept in update-settings.json (never committed).
// - Folder cloned with git: `git pull` instead, with your own git credentials (refused if you have local changes).
// Then build.js runs if the game does not have this version installed yet. The game folder is asked once
// (or found next to this folder) and remembered in update-settings.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync, spawn } = require('child_process');

const REPO = 'galmichedany7-jpg/goofytrackv1';
const SETTINGS = path.join(__dirname, 'update-settings.json');
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const gameArg = process.argv.slice(2).find(a => !a.startsWith('--'));

const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = s => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
// The mod version of this folder, read fresh (config.js changes during an update)
const sourceVersion = () => /MOD_VERSION:\s*'([^']+)'/.exec(fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'))[1];
// The mod version built into the game: build.js writes it at the top of the theme
const installedVersion = game => {
  try { return /--apx-version: "VERSION ([^"]+)"/.exec(fs.readFileSync(path.join(game, 'resources', 'app', 'apex-theme.css'), 'utf8'))[1]; } catch { return null; }
};
// "V2.4.1" -> [2, 4, 1]; compares numerically, a missing part counting as 0
const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

let rl;
const ask = async question => { rl ??= readline.createInterface({ input: process.stdin, output: process.stdout }); return (await rl.question(question)).trim(); };
const fail = message => { console.error('\n' + message); process.exitCode = 1; };

async function findGame(settings) {
  const isGame = dir => dir && fs.existsSync(path.join(dir, 'PolyTrack.exe')) && fs.existsSync(path.join(dir, 'resources'));
  if (gameArg) return path.resolve(gameArg);
  if (isGame(settings.game)) return settings.game;
  // next to this folder, or next to its parent (the ZIP unpacks into a folder of its own)
  for (const base of [path.join(__dirname, '..'), path.join(__dirname, '..', '..')]) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    for (const entry of entries)
      if (entry.isDirectory() && isGame(path.join(base, entry.name))) return path.resolve(base, entry.name);
  }
  while (true) {
    const dir = (await ask('Dossier de PolyTrack (celui qui contient PolyTrack.exe) : ')).replace(/^"|"$/g, '');
    if (isGame(dir)) return path.resolve(dir);
    console.log('PolyTrack.exe introuvable dans ce dossier.');
  }
}

async function github(url, settings, raw = false) {
  while (true) {
    const headers = { 'User-Agent': 'GoofyTrack-updater', Accept: 'application/vnd.github+json' };
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;
    const res = await fetch(url, { headers });
    if (res.ok) return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
    // A private repository answers 404 (or 401 with a bad token) until we authenticate
    if (res.status !== 404 && res.status !== 401) throw new Error(`GitHub a répondu ${res.status} ${res.statusText}`);
    if (!process.stdin.isTTY) throw new Error('Le dépôt GitHub est privé : lancez la mise à jour une fois à la main pour enregistrer un token.');
    console.log(settings.token ? '\nCe token ne donne pas accès au dépôt.' : '\nLe dépôt GitHub est privé : il faut un token GitHub pour le lire (une seule fois).');
    console.log('Créez-le sur https://github.com/settings/personal-access-tokens/new :');
    console.log(`  Repository access : Only select repositories > ${REPO}   Permissions : Contents > Read-only`);
    settings.token = await ask('Token (laissez vide pour annuler) : ');
    if (!settings.token) throw new Error('Mise à jour annulée.');
    saveSettings(settings);
  }
}

function gameRunning() {
  try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq PolyTrack.exe', '/NH'], { encoding: 'utf8' }).includes('PolyTrack.exe'); } catch { return false; }
}

// Folder downloaded as a ZIP: replace it with the latest release
async function updateFromRelease(settings) {
  const release = await github(`https://api.github.com/repos/${REPO}/releases/latest`, settings);
  const latest = release.tag_name.replace(/^v/i, ''), current = sourceVersion();
  if (!newer(latest, current)) { console.log(`GoofyTrack ${current} est la dernière version.`); return false; }
  console.log(`Nouvelle version disponible : ${release.name || release.tag_name} (vous avez la ${current})`);
  if (flags.has('--check')) return false;

  console.log('Téléchargement…');
  const zip = await github(release.zipball_url, settings, true);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goofytrack-'));
  try {
    fs.writeFileSync(path.join(temp, 'release.zip'), zip);
    const out = path.join(temp, 'release');
    fs.mkdirSync(out);
    execFileSync('tar', ['-xf', path.join(temp, 'release.zip'), '-C', out]);   // tar ships with Windows 10 and later
    // GitHub puts everything in one folder named after the repository and the commit
    const [root] = fs.readdirSync(out);
    if (!root || !fs.existsSync(path.join(out, root, 'build.js'))) throw new Error("L'archive téléchargée ne ressemble pas à GoofyTrack.");
    fs.cpSync(path.join(out, root), __dirname, { recursive: true, force: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`GoofyTrack ${sourceVersion()} téléchargé.`);
  return true;
}

// Folder cloned with git: pull, as the README says
function updateFromGit() {
  const git = (...args) => execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim();
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

async function main() {
  const settings = loadSettings();
  const isGit = fs.existsSync(path.join(__dirname, '.git'));
  try {
    isGit ? updateFromGit() : await updateFromRelease(settings);
  } catch (e) {
    // Offline or GitHub unreachable: still let the player in with what they have
    fail(`Impossible de vérifier les mises à jour : ${e.message}`);
    if (!flags.has('--play')) return;
    process.exitCode = 0;
  }
  if (flags.has('--check')) return;

  const game = await findGame(settings);
  if (settings.game !== game) { settings.game = game; saveSettings(settings); }

  const version = sourceVersion(), installed = installedVersion(game);
  if (installed !== version || flags.has('--force')) {
    console.log(installed ? `Installation de GoofyTrack ${version} dans le jeu (il avait la ${installed})…` : `Installation de GoofyTrack ${version} dans le jeu…`);
    while (gameRunning()) await ask('PolyTrack est ouvert : fermez le jeu puis appuyez sur Entrée.');
    // a fresh process, so the build runs the scripts just downloaded
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), game], { stdio: 'inherit' });
  } else {
    console.log(`Le jeu a déjà GoofyTrack ${version}.`);
  }

  if (flags.has('--play')) {
    spawn(path.join(game, 'PolyTrack.exe'), [], { cwd: game, detached: true, stdio: 'ignore' }).unref();
    console.log('Bon jeu !');
  }
}

main().catch(e => fail(e.message)).finally(() => rl?.close());
