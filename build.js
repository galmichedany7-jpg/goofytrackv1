// Installs / rebuilds the mod into a PolyTrack desktop install.
//
//   node build.js ["C:\path\to\PolyTrack-v0.6.3-win32-x64"]
//
// First run: the game's archive (resources/app.asar) is set aside as app.asar.original and unpacked
// into resources/app, which the game then loads instead. Every run rebuilds the modded files from
// the pristine archive, so it is safe to run again after editing the mod. `node uninstall.js` undoes it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.argv[2]) process.env.POLYTRACK_DIR = process.argv[2];
const { GAME, ARCHIVE, ARCHIVE_BACKUP, APP, ORIGINALS, SUPPORTED_VERSION, MOD_NAME, MOD_VERSION, SERVER_URL, EDITOR_CHUNK } = require('./config');
const asar = require('./asar');

if (!fs.existsSync(path.join(GAME, 'resources'))) {
  console.error(`PolyTrack was not found in:\n  ${GAME}\nPass the game folder as an argument: node build.js "C:\\path\\to\\PolyTrack"`);
  process.exit(1);
}

// 1. Set the original archive aside (first install only)
if (!fs.existsSync(ARCHIVE_BACKUP)) {
  if (!fs.existsSync(ARCHIVE)) { console.error('resources/app.asar is missing: is this a PolyTrack desktop install?'); process.exit(1); }
  fs.renameSync(ARCHIVE, ARCHIVE_BACKUP);
  console.log('Original game archive kept as resources/app.asar.original');
}
const version = JSON.parse(asar.readFile(ARCHIVE_BACKUP, 'package.json').toString('utf8')).version;
if (version !== SUPPORTED_VERSION) console.warn(`Warning: this mod targets PolyTrack ${SUPPORTED_VERSION}, found ${version}. The code patches will most likely not apply.`);

// 2. Unpack the game (first install only), and keep pristine copies of the files the build transforms
if (!fs.existsSync(APP)) console.log(`Unpacked ${asar.extractAll(ARCHIVE_BACKUP, APP)} game files into resources/app`);
fs.mkdirSync(ORIGINALS, { recursive: true });
fs.mkdirSync(path.join(ORIGINALS, 'electron'), { recursive: true });
for (const [inner, name] of [['models/car.glb', 'car.glb'], ['main.bundle.js', 'main.bundle.js'], ['simulation_worker.bundle.js', 'simulation_worker.bundle.js'], [EDITOR_CHUNK, EDITOR_CHUNK], ['index.html', 'index.html'], ['electron/main.js', 'electron/main.js']])
  fs.writeFileSync(path.join(ORIGINALS, name), asar.readFile(ARCHIVE_BACKUP, inner));

// 3. Build
const run = script => process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8', env: process.env }));
run('build_car.js');
run('build_patterns.js');
run('patch_bundle.js');

// The mod's scripts, loaded before the game in this order (the game calls into them from the hooks of patch_bundle.js)
const MOD_SCRIPTS = ['apex-gfx.js', 'apex-hud.js', 'apex-records.js', 'apex-monaco.js', 'apex-town.js', 'apex-scenery.js', 'apex-collide.js', 'apex-show.js', 'apex-room.js'];
for (const file of MOD_SCRIPTS) fs.copyFileSync(path.join(__dirname, file), path.join(APP, file));
// The theme reads the version from a CSS variable (home screen badge)
fs.writeFileSync(path.join(APP, 'apex-theme.css'), `html:root { --apx-version: "VERSION ${MOD_VERSION}"; }\n` + fs.readFileSync(path.join(__dirname, 'apex-theme.css'), 'utf8').replace(/^\uFEFF/, ''));
fs.copyFileSync(path.join(__dirname, 'goofytrack-logo.svg'), path.join(APP, 'images', 'logo.svg'));
fs.copyFileSync(path.join(__dirname, 'audio', 'goofytrack_music.mp3'), path.join(APP, 'audio', 'goofytrack_music.mp3'));   // "Vroum Vroum" by Teknah
fs.copyFileSync(path.join(__dirname, 'audio', 'goofytrack_waiting.mp3'), path.join(APP, 'audio', 'goofytrack_waiting.mp3'));   // "WAITING" by Teknah (track selection menu)
for (const icon of ['riviera.svg', 'riviera_colored.svg']) fs.copyFileSync(path.join(__dirname, 'images', icon), path.join(APP, 'images', icon));   // Riviera environment
// App icon: the window (taskbar, Alt+Tab) uses the .ico (patched into electron/main.js), the web manifest the .svg
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
if (!html.includes(mainScript) || !html.includes('</head>')) throw new Error('index.html does not look like the supported game version');
// wake the GoofyTrack server as the game starts: a free host can take ~30 s to come out of sleep
const wake = '<script>fetch(' + JSON.stringify(SERVER_URL + 'health') + ').catch(()=>{})</script>';
html = html.replace(mainScript, wake + MOD_SCRIPTS.map(file => `<script defer="defer" src="${file}"></script>`).join('') + mainScript).replace('</head>', '<link rel="stylesheet" href="apex-theme.css"/></head>');
fs.writeFileSync(path.join(APP, 'index.html'), html);
console.log(`${MOD_NAME} ${MOD_VERSION} installed: apex-theme.css, ${MOD_SCRIPTS.join(', ')}, goofytrack-logo.svg, goofytrack_music.mp3, goofytrack_waiting.mp3, ` + require('./tracks').map(t => t.file).join(', '));
console.log(`Done. Start ${path.join(GAME, 'PolyTrack.exe')}`);
