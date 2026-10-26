// Turns a PolyTrack 0.6.3 desktop install into the GoofyTrack game, inside the GoofyTrack folder (above sources/): the game's files are
// copied there (never committed, see .gitignore), PolyTrack.exe becoming GoofyTrack.exe with the GoofyTrack icon
// and name. The PolyTrack folder itself is left as it was. build.js runs this when the game is not there yet.
//
//   node setup.js "C:\path\to\PolyTrack-v0.6.3-win32-x64" [--move]
//
//   --move   move the files instead of copying them (same drive only), leaving the PolyTrack folder empty
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { GAME, EXE, ARCHIVE_BACKUP, MOD_NAME, MOD_VERSION } = require('./config');

const POLYTRACK_EXE = 'PolyTrack.exe';
const isPolyTrack = dir => !!dir && fs.existsSync(path.join(dir, POLYTRACK_EXE)) && fs.existsSync(path.join(dir, 'resources'));

// A PolyTrack install next to the GoofyTrack folder (or next to its parent: a ZIP unpacks into a folder of its own)
function findPolyTrack() {
  for (const base of [path.join(GAME, '..'), path.join(GAME, '..', '..')]) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    for (const entry of entries)
      if (entry.isDirectory() && isPolyTrack(path.join(base, entry.name))) return path.resolve(base, entry.name);
  }
  return null;
}

// The exe's icon, name and version (Explorer, shortcuts, Task Manager). Fails while the game is running.
function rebrand(version) {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tools', 'rebrand_exe.ps1'),
    EXE, path.join(__dirname, 'images', 'goofytrack_icon.ico'), MOD_NAME, version], { stdio: 'inherit' });
}

// The version written in the exe's properties ("2.12.0.0"), or null
function exeVersion() {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${EXE.replace(/'/g, "''")}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}
const fullVersion = version => [...version.split('.'), 0, 0, 0].slice(0, 4).map(n => parseInt(n, 10) || 0).join('.');

function setup(source, { move = false } = {}) {
  source = path.resolve(source);
  if (!isPolyTrack(source)) throw new Error(`${POLYTRACK_EXE} introuvable dans ${source}`);
  const archive = ['app.asar.original', 'app.asar'].map(name => path.join(source, 'resources', name)).find(file => fs.existsSync(file));
  if (!archive) throw new Error(`resources/app.asar introuvable dans ${source} : est-ce bien PolyTrack pour Windows ?`);
  console.log(`${move ? 'Déplacement' : 'Copie'} de PolyTrack (${source}) dans ${GAME}…`);

  const transfer = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (move) fs.renameSync(from, to);
    else fs.cpSync(from, to, { recursive: true, force: true });
  };
  for (const name of fs.readdirSync(source)) {
    if (name === 'resources') continue;
    // Electron's licence must not replace the one of this repository
    const target = name === POLYTRACK_EXE ? EXE : path.join(GAME, name === 'LICENSE' ? 'LICENSE.electron' : name);
    transfer(path.join(source, name), target);
  }
  // The pristine archive, which build.js unpacks and modifies into resources/app (a modded copy is only worth moving)
  for (const name of fs.readdirSync(path.join(source, 'resources'))) {
    if ((name === 'app' && !move) || name === 'app.asar' || name === 'app.asar.original') continue;
    transfer(path.join(source, 'resources', name), path.join(GAME, 'resources', name));
  }
  transfer(archive, ARCHIVE_BACKUP);
  if (move) for (const dir of [path.join(source, 'resources'), source]) try { fs.rmdirSync(dir); } catch {}   // only if empty
  rebrand(MOD_VERSION);
  console.log(`Le jeu est maintenant ${path.basename(EXE)} dans ce dossier.`);
}

module.exports = { setup, rebrand, exeVersion, fullVersion, findPolyTrack, isPolyTrack };

if (require.main === module) {
  const source = process.argv.slice(2).find(a => !a.startsWith('--')) || findPolyTrack();
  if (!source) { console.error('Indiquez le dossier de PolyTrack : node setup.js "C:\\chemin\\vers\\PolyTrack"'); process.exit(1); }
  setup(source, { move: process.argv.includes('--move') });
}
