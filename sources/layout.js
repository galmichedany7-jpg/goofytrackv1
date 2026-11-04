// The GoofyTrack folder as a player sees it: GoofyTrack.exe and "GoofyTrack Launcher.exe" (install, update,
// rebuild). Everything else at the top is hidden (Windows' hidden attribute, like .git): sources/ (this code),
// the game's own files, which have to stay next to the exe (setup.js copies them there), and a few
// files that have to be at the top for git, GitHub and Render, or for older updaters.
//
// Up to 2.17 the code was at the top of the folder. The updater of those versions, which runs the update to
// this layout, reads the new version from ./config.js and then runs ./build.js: both stay at the top as relays
// to sources/ (ROOT_RELAYS), and the build then clears the files of the old layout away (tidy).
//
// A hidden file cannot be overwritten on Windows: reveal() shows the top files again before an update copies a
// release over them, and the build hides them once more (hide).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, GAME, MOD_VERSION } = require('./config');

const ROOT_RELAYS = ['build.js', 'config.js'];
// committed at the top, hidden
const ROOT_FILES = [...ROOT_RELAYS, '.gitignore', 'render.yaml', 'README.md', 'LICENSE', 'sources'];
// the game's files next to the exe (setup.js), hidden
const isGameFile = name => /\.(dll|pak|bin)$/i.test(name)
  || ['icudtl.dat', 'locales', 'resources', 'version', 'vk_swiftshader_icd.json', 'LICENSE.electron', 'LICENSES.chromium.html'].includes(name);

// the top of the folder in 2.17 and older: what the update leaves there (a ZIP is copied over the folder, nothing removed)
const OLD_FILES = ['apex-account.js', 'apex-collide.js', 'apex-gfx.js', 'apex-hud.js', 'apex-livery.js', 'apex-lobby.js', 'apex-monaco.js',
  'apex-notes.js', 'apex-rarity.js', 'apex-records.js', 'apex-room.js', 'apex-scenery.js', 'apex-show.js', 'apex-theme.css', 'apex-town.js',
  'asar.js', 'build_car.js', 'build_patterns.js', 'goofytrack-logo.svg', 'meshlib.js', 'patch_bundle.js', 'serve.js', 'setup.js',
  'track_outlines.js', 'update.js', 'PATCHNOTES.md', 'Jouer a GoofyTrack.bat',
  // 2.21 and older: the two scripts the launcher replaced
  'Construire GoofyTrack.bat', 'Mettre a jour GoofyTrack.bat'];
const OLD_FOLDERS = ['audio', 'docs', 'images', 'tools', 'tracks', 'server'];
// what the old layout kept that is not in the repository: moved into sources/ rather than lost
const OLD_KEPT = ['original', 'update-settings.json', path.join('server', 'records.json'), path.join('server', 'accounts.json')];

const windows = process.platform === 'win32';
const attrib = (flag, file) => { if (windows && fs.existsSync(file)) try { execFileSync('attrib', [flag, file], { stdio: 'ignore' }); } catch { /* left as it is */ } };

function hide() {
  if (!fs.existsSync(path.join(ROOT, 'sources'))) return;     // a copy of the code without its folder around it
  for (const name of ROOT_FILES) attrib('+h', path.join(ROOT, name));
  if (path.resolve(GAME) === path.resolve(ROOT)) for (const name of fs.readdirSync(ROOT)) if (isGameFile(name)) attrib('+h', path.join(ROOT, name));
}
function reveal() {
  for (const name of ROOT_FILES) attrib('-h', path.join(ROOT, name));
}

// the relay ./config.js says the version (the old updater reads it as text, sources/config.js is the one used)
function writeRelays() {
  const file = path.join(ROOT, 'config.js');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(/MOD_VERSION: '[^']*'/, `MOD_VERSION: '${MOD_VERSION}'`);
  if (next === text) return;
  attrib('-h', file);
  fs.writeFileSync(file, next);
}

// the files of the old layout, after an update to this one
function tidy() {
  const sources = path.join(ROOT, 'sources');
  if (!fs.existsSync(sources)) return;
  const moved = [];
  for (const name of OLD_KEPT) {
    const from = path.join(ROOT, name), to = path.join(sources, name);
    if (!fs.existsSync(from)) continue;
    if (!fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); moved.push(name); }
    else if (name === 'original') fs.rmSync(from, { recursive: true, force: true });   // pristine copies, made again by the build
  }
  // the circuit tools' points, as old as the layout (tools/*_points.json)
  const oldTools = path.join(ROOT, 'tools');
  if (fs.existsSync(oldTools)) for (const name of fs.readdirSync(oldTools)) {
    if (!name.endsWith('_points.json') || fs.existsSync(path.join(sources, 'tools', name))) continue;
    fs.renameSync(path.join(oldTools, name), path.join(sources, 'tools', name));
  }
  const removed = [];
  for (const name of [...OLD_FILES, ...OLD_FOLDERS]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { recursive: true, force: true });
    removed.push(name);
  }
  if (moved.length || removed.length) console.log(`Dossier rangé : le code est maintenant dans sources/ (${removed.length} ancien(s) fichier(s) retiré(s) du dossier principal).`);
}

module.exports = { hide, reveal, tidy, writeRelays, ROOT_RELAYS };
