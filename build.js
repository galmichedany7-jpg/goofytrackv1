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
const { GAME, ARCHIVE, ARCHIVE_BACKUP, APP, ORIGINALS, SUPPORTED_VERSION, SERVER_URL } = require('./config');
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
for (const [inner, name] of [['models/car.glb', 'car.glb'], ['main.bundle.js', 'main.bundle.js'], ['index.html', 'index.html']])
  fs.writeFileSync(path.join(ORIGINALS, name), asar.readFile(ARCHIVE_BACKUP, inner));

// 3. Build
const run = script => process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8', env: process.env }));
run('build_car.js');
run('build_patterns.js');
run('patch_bundle.js');

for (const file of ['apex-theme.css', 'apex-room.js']) fs.copyFileSync(path.join(__dirname, file), path.join(APP, file));
fs.copyFileSync(path.join(__dirname, 'goofytrack-logo.svg'), path.join(APP, 'images', 'logo.svg'));
for (const track of require('./tracks')) {
  fs.copyFileSync(path.join(__dirname, 'tracks', track.file), path.join(APP, 'tracks', 'official', track.file));
  fs.copyFileSync(path.join(__dirname, 'tracks', track.thumbnail), path.join(APP, 'tracks', 'official', 'thumbnails', track.thumbnail));
}
const mainScript = '<script defer="defer" src="main.bundle.js">';
let html = fs.readFileSync(path.join(ORIGINALS, 'index.html'), 'utf8');
if (!html.includes(mainScript) || !html.includes('</head>')) throw new Error('index.html does not look like the supported game version');
// wake the GoofyTrack server as the game starts: a free host can take ~30 s to come out of sleep
const wake = '<script>fetch(' + JSON.stringify(SERVER_URL + 'health') + ').catch(()=>{})</script>';
html = html.replace(mainScript, wake + '<script defer="defer" src="apex-room.js"></script>' + mainScript).replace('</head>', '<link rel="stylesheet" href="apex-theme.css"/></head>');
fs.writeFileSync(path.join(APP, 'index.html'), html);
console.log('Installed: apex-theme.css, apex-room.js, goofytrack-logo.svg, ' + require('./tracks').map(t => t.file).join(', '));
console.log(`Done. Start ${path.join(GAME, 'PolyTrack.exe')}`);
