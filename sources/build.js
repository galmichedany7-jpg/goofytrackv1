// Builds GoofyTrack: the game in the GoofyTrack folder, above this one (GoofyTrack.exe, or GoofyTrack.app on macOS),
// made from PolyTrack 0.6.3.
//
//   node sources/build.js ["C:\path\to\PolyTrack-v0.6.3-win32-x64"]     (or the launcher's "Reconstruire")
//   node sources/build.js ["/path/to/PolyTrack.app"]                     (macOS)
//
// First run: the game is downloaded into the GoofyTrack folder (polytrack.js: Electron from GitHub, PolyTrack 0.6.3 from
// Kodub's web version), or copied from a PolyTrack install given or found next to it (setup.js), then its archive (resources/app.asar, inside the app on
// macOS) is set aside as app.asar.original and unpacked into resources/app, which the game loads instead. Every run rebuilds
// the modified files from the pristine archive, so it is safe to run again after editing the code.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { GAME, EXE, ARCHIVE, ARCHIVE_BACKUP, APP, ORIGINALS, SUPPORTED_VERSION, MOD_NAME, MOD_VERSION, SERVER_URL, EDITOR_CHUNK, GARAGE_CHUNK, GITHUB_REPO } = require('./config');
const asar = require('./asar');
const setup = require('./setup');
const layout = require('./layout');

// The files the layout of 2.17 and older left at the top of the folder (layout.js)
layout.tidy();

// 0. The game itself, the first time: copied from a PolyTrack install given or found next to the folder, else
// downloaded (its progress shown as it goes)
if (!fs.existsSync(EXE)) {
  const source = process.argv[2] || setup.findPolyTrack();
  if (source) setup.setup(source);
}
if (!fs.existsSync(EXE) || (!fs.existsSync(ARCHIVE_BACKUP) && !fs.existsSync(ARCHIVE))) {
  try { execFileSync(process.execPath, [path.join(__dirname, 'polytrack.js')], { stdio: 'inherit' }); }
  catch { console.error(`${path.basename(EXE)} could not be installed in ${GAME} (see above)`); process.exit(1); }
}

// 1. Set the original archive aside (first install only; polytrack.js writes it there itself)
if (!fs.existsSync(ARCHIVE_BACKUP)) {
  fs.renameSync(ARCHIVE, ARCHIVE_BACKUP);
  console.log('Original game archive kept as resources/app.asar.original');
}
const version = JSON.parse(asar.readFile(ARCHIVE_BACKUP, 'package.json').toString('utf8')).version;
if (version !== SUPPORTED_VERSION) console.warn(`Warning: this mod targets PolyTrack ${SUPPORTED_VERSION}, found ${version}. The code patches will most likely not apply.`);

// 2. Unpack the game (first install only), and keep pristine copies of the files the build transforms
if (!fs.existsSync(APP)) console.log(`Unpacked ${asar.extractAll(ARCHIVE_BACKUP, APP)} game files into resources/app`);
fs.mkdirSync(ORIGINALS, { recursive: true });
for (const [inner, name] of [['models/car.glb', 'car.glb'], ['main.bundle.js', 'main.bundle.js'], ['simulation_worker.bundle.js', 'simulation_worker.bundle.js'], [EDITOR_CHUNK, EDITOR_CHUNK], [GARAGE_CHUNK, GARAGE_CHUNK], ['index.html', 'index.html']])
  fs.writeFileSync(path.join(ORIGINALS, name), asar.readFile(ARCHIVE_BACKUP, inner));

// 3. Build
const run = script => process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8', env: process.env }));
run('build_car.js');
run('build_patterns.js');
run('patch_bundle.js');

// The mod's scripts, loaded before the game in this order (the game calls into them from the hooks of patch_bundle.js)
// (the account first: it watches the storage from the start)
const MOD_SCRIPTS = ['apex-account.js', 'apex-gfx.js', 'apex-hud.js', 'apex-records.js', 'apex-monaco.js', 'apex-town.js', 'apex-scenery.js', 'apex-collide.js', 'apex-show.js', 'apex-spectate.js', 'apex-endurance.js', 'apex-room.js', 'apex-tournament.js', 'apex-lobby.js', 'apex-notes.js', 'apex-update.js', 'apex-rarity.js', 'apex-livery.js'];
for (const file of MOD_SCRIPTS) fs.copyFileSync(path.join(__dirname, file), path.join(APP, file));
// The account keeps its save on our server, whose address it is handed in front of its script, with the mod's
// tracks (the profile card counts the circuits finished and asks the server for their boards; the P1 badges
// draw their outline, track_outlines.js), and the game's own official tracks, read from its code (the card counts
// the official tracks finished)
// (with the community tracks, listed with them since 2.17: patch_bundle.js)
const gameTracks = [...fs.readFileSync(path.join(ORIGINALS, 'main.bundle.js'), 'utf8').matchAll(/\{id:"([0-9a-f]{64})",(?:trackMetadata:\{name:"[^"]+",author:"Kodub"|group:"[^"]+",trackMetadata:\{name:"[^"]+",author:)/g)].map(m => m[1]);
if (gameTracks.length === 0) throw new Error('main.bundle.js: the official tracks were not found');
// The server draws the Track of the Week among the same tracks (server/weekly.js): their ids, rewritten only when
// they change (the file is committed, and the update script pulls over it)
const weeklyFile = path.join(__dirname, 'server', 'official_tracks.json');
const weeklyTracks = [...gameTracks, ...require('./tracks').map(t => t.id)];
let weeklyKept = null;
try { weeklyKept = JSON.parse(fs.readFileSync(weeklyFile, 'utf8')); } catch {}
if (JSON.stringify(weeklyKept) !== JSON.stringify(weeklyTracks)) fs.writeFileSync(weeklyFile, JSON.stringify(weeklyTracks, null, 1) + '\n');
fs.writeFileSync(path.join(APP, 'apex-account.js'), 'window.GOOFY_SERVER = ' + JSON.stringify(SERVER_URL) + ';\n'
  + 'window.GOOFY_GAME_TRACKS = ' + JSON.stringify(gameTracks) + ';\n'
  + 'window.GOOFY_MOD_TRACKS = ' + JSON.stringify(require('./tracks').map(t => ({ id: t.id, name: t.name, author: t.author, outline: require('./track_outlines').outline(t) }))) + ';\n'
  + fs.readFileSync(path.join(__dirname, 'apex-account.js'), 'utf8'));
// The physics worker slows the cars down in the gravel traps and, a little, on the grass (apex-sand.js): the traps of each
// circuit and where its barriers stand, in front of its script
const sandData = {};
for (const [key, c] of Object.entries(require('./tools/circuits'))) {
  if (c.stunt) continue;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'tracks', key, key + '.json'), 'utf8'));
  if (!data.sand || data.sand.length === 0) continue;
  sandData[c.ids.road] = { fine: data.fine.flatMap(p => [p[0], p[1], p[2]]), half: data.fine.flatMap(p => [p[3], p[4]]), sand: data.sand, edge: data.fine[0].length > 5 ? data.fine.flatMap(p => [p[5], p[6]]) : null };
  if (c.openRoad) sandData[c.openRoad] = sandData[c.ids.road];   // the same road, pit lane open (endurance races)
}
fs.writeFileSync(path.join(APP, 'apex-sand.js'), 'self.APEX_SAND = ' + JSON.stringify(sandData) + ';\n' + fs.readFileSync(path.join(__dirname, 'apex-sand.js'), 'utf8'));
// The room list asks the server for the rooms of this very build: the one the patched game connects with
const buildQuery = /multiplayer\/join(\?mod=[^"]+)"/.exec(fs.readFileSync(path.join(APP, 'main.bundle.js'), 'utf8'))[1];
fs.writeFileSync(path.join(APP, 'apex-lobby.js'), 'window.GOOFY_ROOMS = ' + JSON.stringify(SERVER_URL + 'rooms' + buildQuery) + ';\n' + fs.readFileSync(path.join(__dirname, 'apex-lobby.js'), 'utf8'));
// The patch notes button shows PATCHNOTES.md, handed to it in front of its script
fs.writeFileSync(path.join(APP, 'apex-notes.js'), 'window.GOOFY_PATCHNOTES = ' + JSON.stringify(fs.readFileSync(path.join(__dirname, 'PATCHNOTES.md'), 'utf8')) + ';\n' + fs.readFileSync(path.join(__dirname, 'apex-notes.js'), 'utf8'));
// The update popup compares this build's version with the latest release of the repository, handed to it in front of its script
fs.writeFileSync(path.join(APP, 'apex-update.js'), 'window.GOOFY_VERSION = ' + JSON.stringify(MOD_VERSION) + ';\nwindow.GOOFY_REPO = ' + JSON.stringify(GITHUB_REPO) + ';\n' + fs.readFileSync(path.join(__dirname, 'apex-update.js'), 'utf8'));
// The theme reads the version from a CSS variable (home screen badge)
fs.writeFileSync(path.join(APP, 'apex-theme.css'), `html:root { --apx-version: "VERSION ${MOD_VERSION}"; }\n` + fs.readFileSync(path.join(__dirname, 'apex-theme.css'), 'utf8').replace(/^\uFEFF/, ''));
fs.copyFileSync(path.join(__dirname, 'goofytrack-logo.svg'), path.join(APP, 'images', 'logo.svg'));
fs.copyFileSync(path.join(__dirname, 'audio', 'goofytrack_music.mp3'), path.join(APP, 'audio', 'goofytrack_music.mp3'));   // "Vroum Vroum" by Teknah
fs.copyFileSync(path.join(__dirname, 'audio', 'goofytrack_waiting.mp3'), path.join(APP, 'audio', 'goofytrack_waiting.mp3'));   // "WAITING" by Teknah (track selection menu)
fs.copyFileSync(path.join(__dirname, 'audio', 'engine_mp4_7a.wav'), path.join(APP, 'audio', 'engine_mp4_7a.wav'));   // the MP4/7A body's V12 (tools/make_engine_sound.js)
fs.copyFileSync(path.join(__dirname, 'audio', 'engine_r26.wav'), path.join(APP, 'audio', 'engine_r26.wav'));   // the R26 body's V8 (tools/make_engine_sound.js)
for (const icon of ['riviera.svg', 'riviera_colored.svg']) fs.copyFileSync(path.join(__dirname, 'images', icon), path.join(APP, 'images', icon));   // Riviera environment
fs.copyFileSync(path.join(__dirname, 'images', 'wing.svg'), path.join(APP, 'images', 'wing.svg'));   // the garage's Wing tab
fs.copyFileSync(path.join(__dirname, 'images', 'body.svg'), path.join(APP, 'images', 'body.svg'));   // the garage's Body tab
// The desktop app: our own (electron/), in place of the one of PolyTrack's archive
fs.mkdirSync(path.join(APP, 'electron'), { recursive: true });
for (const file of ['main.js', 'preload.js']) fs.copyFileSync(path.join(__dirname, 'electron', file), path.join(APP, 'electron', file));
// App icon: the window (taskbar, Alt+Tab) uses the .ico (electron/main.js), the web manifest the .svg
fs.copyFileSync(path.join(__dirname, 'images', 'goofytrack_icon.ico'), path.join(APP, 'images', 'goofytrack_icon.ico'));
fs.copyFileSync(path.join(__dirname, 'images', 'goofytrack_icon.svg'), path.join(APP, 'images', 'icons', 'icon.svg'));
for (const track of require('./tracks')) {
  fs.copyFileSync(path.join(__dirname, 'tracks', track.file), path.join(APP, 'tracks', 'official', track.file));
  fs.copyFileSync(path.join(__dirname, 'tracks', track.thumbnail), path.join(APP, 'tracks', 'official', 'thumbnails', track.thumbnail));
}
// Monaco: its track parts go with the game's models; its centreline, from which apex-monaco.js builds the town
fs.copyFileSync(path.join(__dirname, 'tracks', 'monaco', 'monaco.glb'), path.join(APP, 'models', 'monaco.glb'));
fs.copyFileSync(path.join(__dirname, 'tracks', 'monaco', 'monaco.json'), path.join(APP, 'tracks', 'monaco.json'));
// The circuits built from real maps (tools/circuits.js): the same, with the map of the place in their json (apex-town.js draws it)
for (const key of Object.keys(require('./tools/circuits'))) {
  fs.copyFileSync(path.join(__dirname, 'tracks', key, key + '.glb'), path.join(APP, 'models', key + '.glb'));
  fs.copyFileSync(path.join(__dirname, 'tracks', key, key + '.json'), path.join(APP, 'tracks', key + '.json'));
}
fs.rmSync(path.join(APP, 'apex-montbeliard.js'), { force: true });   // scenery script of 2.8
for (const old of ['monaco_decor.bin', 'monaco_decor.jpg']) fs.rmSync(path.join(APP, 'tracks', old), { force: true });   // scenery of 2.3 and 2.4
const mainScript = '<script defer="defer" src="main.bundle.js">';
let html = fs.readFileSync(path.join(ORIGINALS, 'index.html'), 'utf8');
if (!html.includes(mainScript) || !html.includes('<head>') || !html.includes('</head>')) throw new Error('index.html does not look like the supported game version');
// wake the GoofyTrack server as the game starts: a free host can take ~30 s to come out of sleep
const wake = '<script>fetch(' + JSON.stringify(SERVER_URL + 'health') + ').catch(()=>{})</script>';
// <title>: the window's name (Electron would otherwise show the app's, "PolyTrack")
html = html.replace('<head>', `<head><title>${MOD_NAME}</title>`).replace(mainScript, wake + MOD_SCRIPTS.map(file => `<script defer="defer" src="${file}"></script>`).join('') + mainScript).replace('</head>', '<link rel="stylesheet" href="apex-theme.css"/></head>');
fs.writeFileSync(path.join(APP, 'index.html'), html);
console.log(`${MOD_NAME} ${MOD_VERSION} installed: apex-theme.css, ${MOD_SCRIPTS.join(', ')}, goofytrack-logo.svg, goofytrack_music.mp3, goofytrack_waiting.mp3, ` + require('./tracks').map(t => t.file).join(', '));
// The exe carries the version in its properties: refresh them when it changes (or could not be, the game being open)
if (setup.exeVersion() !== setup.fullVersion(MOD_VERSION)) {
  try { setup.rebrand(MOD_VERSION); } catch { console.warn(`Could not update the version shown in ${path.basename(EXE)}'s properties (is the game running?)`); }
}
// macOS: the app was just changed, so it is signed again (setup.js)
setup.seal();
// Only the game and the launcher stay in sight (layout.js)
layout.writeRelays();
layout.hide();
console.log(`Done. Start ${EXE}`);
