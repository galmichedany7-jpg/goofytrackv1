// Turns a PolyTrack 0.6.3 desktop install into the GoofyTrack game, inside the GoofyTrack folder (above sources/): the game's files are
// copied there (never committed, see .gitignore) and given the GoofyTrack icon and name. The PolyTrack install itself
// is left as it was. build.js runs this when the game is not there yet.
//
// - Windows: the files of the PolyTrack folder, PolyTrack.exe becoming GoofyTrack.exe.
// - macOS: PolyTrack.app, copied as GoofyTrack.app (its Info.plist and icon changed). Changing an app breaks its
//   signature, which macOS checks before opening it: seal() signs it again, for this Mac only, after every build.
//
//   node setup.js "C:\path\to\PolyTrack-v0.6.3-win32-x64" [--move]      (macOS: the PolyTrack.app, or its folder)
//
//   --move   move the files instead of copying them (same drive only), leaving the PolyTrack folder empty
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MAC, GAME, EXE, RESOURCES, ARCHIVE_BACKUP, MOD_NAME, MOD_VERSION } = require('./config');

const POLYTRACK_EXE = MAC ? 'PolyTrack.app' : 'PolyTrack.exe';
const ICON = path.join(__dirname, 'images', MAC ? 'goofytrack_icon.icns' : 'goofytrack_icon.ico');

// The PolyTrack install a path names: on macOS the .app itself or a folder holding it, else the folder of PolyTrack.exe
function polyTrackApp(dir) {
  if (!dir) return null;
  dir = String(dir).trim().replace(/^["']|["']$/g, '');
  if (MAC) dir = dir.replace(/\\(.)/g, '$1');   // a path dropped in Terminal escapes its spaces
  dir = path.resolve(dir);
  if (MAC) {
    for (const app of [dir, path.join(dir, POLYTRACK_EXE)])
      if (app.endsWith('.app') && fs.existsSync(path.join(app, 'Contents', 'Resources'))
        && ['app.asar', 'app.asar.original'].some(n => fs.existsSync(path.join(app, 'Contents', 'Resources', n)))
        && path.resolve(app) !== path.resolve(EXE)) return app;
    return null;
  }
  return fs.existsSync(path.join(dir, POLYTRACK_EXE)) && fs.existsSync(path.join(dir, 'resources')) ? dir : null;
}
const isPolyTrack = dir => !!polyTrackApp(dir);

// A PolyTrack install next to the GoofyTrack folder (or next to its parent: a ZIP unpacks into a folder of its own),
// and on macOS in the Applications folders too
function findPolyTrack() {
  const bases = [path.join(GAME, '..'), path.join(GAME, '..', '..')];
  if (MAC) for (const apps of ['/Applications', path.join(os.homedir(), 'Applications'), path.join(os.homedir(), 'Downloads')])
    if (isPolyTrack(apps)) return polyTrackApp(apps);
  for (const base of bases) {
    if (MAC && isPolyTrack(base)) return polyTrackApp(base);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    for (const entry of entries)
      if (entry.isDirectory() && isPolyTrack(path.join(base, entry.name))) return polyTrackApp(path.join(base, entry.name));
  }
  return null;
}

// macOS: the app's Info.plist, read and written with plutil (part of macOS)
const PLIST = path.join(EXE, 'Contents', 'Info.plist');
const plistRead = key => { try { return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', PLIST], { encoding: 'utf8' }).trim() || null; } catch { return null; } };
const plistWrite = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, PLIST]);

// The game's icon, name and version (Explorer or Finder, shortcuts, Task Manager). Fails on Windows while the game is running.
function rebrand(version) {
  if (MAC) {
    plistWrite('CFBundleName', MOD_NAME);
    plistWrite('CFBundleDisplayName', MOD_NAME);
    plistWrite('CFBundleShortVersionString', version);
    plistWrite('CFBundleVersion', version);
    const icon = plistRead('CFBundleIconFile') || 'electron.icns';
    fs.copyFileSync(ICON, path.join(RESOURCES, icon.endsWith('.icns') ? icon : icon + '.icns'));
    return;
  }
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tools', 'rebrand_exe.ps1'),
    EXE, ICON, MOD_NAME, version], { stdio: 'inherit' });
}

// The version written in the game's properties ("2.12.0.0" on Windows, "2.12" on macOS), or null
function exeVersion() {
  if (MAC) return plistRead('CFBundleShortVersionString');
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${EXE.replace(/'/g, "''")}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}
const fullVersion = version => MAC ? version : [...version.split('.'), 0, 0, 0].slice(0, 4).map(n => parseInt(n, 10) || 0).join('.');

// macOS: sign the app again, for this Mac only (any change inside it breaks its signature, and an Apple Silicon Mac
// does not run unsigned code), and drop the "downloaded from the Internet" mark that would make Gatekeeper refuse it
function seal() {
  if (!MAC) return;
  try { execFileSync('xattr', ['-cr', EXE]); } catch { /* nothing to clear */ }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', EXE], { stdio: 'inherit' });
}

function setup(source, { move = false } = {}) {
  const found = polyTrackApp(source);
  if (!found) throw new Error(`${POLYTRACK_EXE} introuvable dans ${source}`);
  source = found;
  const resources = MAC ? path.join(source, 'Contents', 'Resources') : path.join(source, 'resources');
  const archive = ['app.asar.original', 'app.asar'].map(name => path.join(resources, name)).find(file => fs.existsSync(file));
  if (!archive) throw new Error(`app.asar introuvable dans ${source} : est-ce bien PolyTrack pour ${MAC ? 'macOS' : 'Windows'} ?`);
  console.log(`${move ? 'Déplacement' : 'Copie'} de PolyTrack (${source}) dans ${GAME}…`);

  if (MAC) {
    // the whole app at once: ditto keeps the links and permissions of its frameworks
    if (move) fs.renameSync(source, EXE);
    else execFileSync('ditto', [source, EXE]);
    const copied = ['app.asar.original', 'app.asar'].map(name => path.join(RESOURCES, name)).find(file => fs.existsSync(file));
    fs.rmSync(path.join(RESOURCES, 'app'), { recursive: true, force: true });   // a modded copy: build.js makes its own
    for (const name of ['app.asar', 'app.asar.original']) if (path.join(RESOURCES, name) !== copied) fs.rmSync(path.join(RESOURCES, name), { force: true });
    if (copied !== ARCHIVE_BACKUP) fs.renameSync(copied, ARCHIVE_BACKUP);
  } else {
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
    for (const name of fs.readdirSync(resources)) {
      if ((name === 'app' && !move) || name === 'app.asar' || name === 'app.asar.original') continue;
      transfer(path.join(resources, name), path.join(GAME, 'resources', name));
    }
    transfer(archive, ARCHIVE_BACKUP);
    if (move) for (const dir of [resources, source]) try { fs.rmdirSync(dir); } catch {}   // only if empty
  }
  rebrand(MOD_VERSION);
  console.log(`Le jeu est maintenant ${path.basename(EXE)} dans ce dossier.`);
}

module.exports = { setup, rebrand, exeVersion, fullVersion, seal, findPolyTrack, isPolyTrack, polyTrackApp };

if (require.main === module) {
  const source = process.argv.slice(2).find(a => !a.startsWith('--')) || findPolyTrack();
  if (!source) { console.error(`Indiquez où est PolyTrack : node setup.js "${MAC ? '/chemin/vers/PolyTrack.app' : 'C:\\chemin\\vers\\PolyTrack'}"`); process.exit(1); }
  setup(source, { move: process.argv.includes('--move') });
}
