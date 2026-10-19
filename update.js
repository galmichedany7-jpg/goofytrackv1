// Checks GitHub for a newer GoofyTrack, downloads it into this folder and rebuilds the game (GoofyTrack.exe).
//
//   node update.js [--play] [--check] [--force] ["C:\path\to\PolyTrack-v0.6.3-win32-x64"]
//
//   --play   start the game afterwards (whether or not there was an update)
//   --check  only say whether an update is available
//   --force  rebuild the game even when everything is up to date
//
// Or double-click "Mettre a jour GoofyTrack.bat" / "Jouer a GoofyTrack.bat".
//
// - Folder cloned with git: `git pull`, i.e. the latest commits, with your own git credentials (refused if
//   you have local changes).
// - Folder downloaded as a ZIP: the latest release's source code is downloaded from GitHub and copied over
//   this folder (files you added are kept). The repository being private, the first run asks for a GitHub
//   token, kept in update-settings.json (never committed).
// Then build.js runs if the game does not have this version yet. The very first time, the game is made from
// a PolyTrack 0.6.3 install (given as argument, found next to this folder, or asked), copied into this folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync, spawn } = require('child_process');
const { EXE, installedVersion } = require('./config');
const { findPolyTrack, isPolyTrack } = require('./setup');

const REPO = 'galmichedany7-jpg/goofytrackv1';
const SETTINGS = path.join(__dirname, 'update-settings.json');
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const polyTrackArg = process.argv.slice(2).find(a => !a.startsWith('--'));

const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
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
async function findSource(settings) {
  if (polyTrackArg) return path.resolve(polyTrackArg);
  if (isPolyTrack(settings.game)) return settings.game;   // where older versions installed the mod
  const found = findPolyTrack();
  if (found) return found;
  while (true) {
    const dir = (await ask('Dossier de PolyTrack (celui qui contient PolyTrack.exe) : ')).replace(/^"|"$/g, '');
    if (isPolyTrack(dir)) return path.resolve(dir);
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
  const name = path.basename(EXE);
  try { return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { encoding: 'utf8' }).includes(name); } catch { return false; }
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

  const source = fs.existsSync(EXE) ? null : await findSource(settings);

  const version = sourceVersion(), installed = installedVersion();
  if (source || installed !== version || flags.has('--force')) {
    console.log(installed ? `Construction de GoofyTrack ${version} (le jeu avait la ${installed})…` : `Construction de GoofyTrack ${version}…`);
    while (gameRunning()) await ask('GoofyTrack est ouvert : fermez le jeu puis appuyez sur Entrée.');
    // a fresh process, so the build runs the scripts just downloaded
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), ...(source ? [source] : [])], { stdio: 'inherit' });
    if (source && 'game' in settings) { delete settings.game; saveSettings(settings); }
    if (source) console.log(`\nLe jeu est maintenant dans ce dossier : ${EXE}\nL'ancien dossier de PolyTrack n'est plus utilisé par GoofyTrack.`);
  } else {
    console.log(`Le jeu a déjà GoofyTrack ${version}.`);
  }

  if (flags.has('--play')) {
    spawn(EXE, [], { cwd: path.dirname(EXE), detached: true, stdio: 'ignore' }).unref();
    console.log('Bon jeu !');
  }
}

main().catch(e => fail(e.message)).finally(() => rl?.close());
