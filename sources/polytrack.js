// The game without a PolyTrack install (2.25): what setup.js copies from PolyTrack 0.6.3, downloaded instead.
//
// - The app: Electron, the free (MIT) runtime the PolyTrack desktop app is made of, in its version (ELECTRON), from
//   its official GitHub release, checked against the release's SHA-256 sums. electron.exe becomes GoofyTrack.exe
//   (Electron.app becomes GoofyTrack.app on macOS), given the GoofyTrack icon and name (setup.js).
// - The game: the files of PolyTrack 0.6.3, from Kodub's own web version of it (WEB), each checked against the
//   SHA-256 of the desktop app's copy (polytrack_0.6.3.json). The web version and the desktop one are the same build
//   but for a few words (TO_DESKTOP), which are turned into the desktop's before the check. They are kept, with our
//   own desktop app (electron/), as resources/app.asar.original: the pristine archive build.js starts from.
//
//   node sources/polytrack.js                 the app and the game, whichever is missing (build.js runs this)
//   node sources/polytrack.js --manifest      writes polytrack_0.6.3.json from a PolyTrack 0.6.3 archive (resources/app.asar.original)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { MAC, GAME, EXE, RESOURCES, ARCHIVE, ARCHIVE_BACKUP, SUPPORTED_VERSION, MOD_VERSION } = require('./config');
const asar = require('./asar');

const ELECTRON = '39.1.1';                                         // the version of the PolyTrack 0.6.3 desktop app
const WEB = `https://app-polytrack.kodub.com/${SUPPORTED_VERSION}/`;  // Kodub's web version, one folder per game version
const MANIFEST = path.join(__dirname, `polytrack_${SUPPORTED_VERSION}.json`);
const OWN = ['package.json', 'electron/main.js', 'electron/preload.js'];   // the desktop app's own files: ours instead
// web -> desktop: the web version only runs on kodub.com, and says it is the web version
const TO_DESKTOP = {
  'main.bundle.js': [
    ['function o(){let e;return e=[/\\.kodub\\.com$/],!e.some((e=>e.test(location.hostname)))}', 'function o(){return!1}'],
    ['"kodub",await(l?.initialize())', '"electron",await(l?.initialize())'],
  ],
  'error_screen.bundle.js': [['"Platform: kodub"', '"Platform: electron"'],
    ['e.textContent="Reload",e.addEventListener("click",(()=>{window.location.reload()}))', 'e.textContent="Quit",e.addEventListener("click",(()=>{window.electron?.quit()}))']],
};
// package.json of the archive: the game's version (build.js checks it), and the app's name, which keeps the saves
// where PolyTrack keeps them (electron/main.js)
const PACKAGE = { name: 'goofytrack', productName: 'PolyTrack', version: SUPPORTED_VERSION, private: true, main: 'electron/main.js' };

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const mb = n => (n / 1048576).toFixed(1) + ' Mo';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// a download, tried again when the server is busy (Kodub's answers 429 to many requests at once) or the network fails
async function download(url, onProgress) {
  for (let attempt = 1; ; attempt++) {
    let retry;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'GoofyTrack-installer' } });
      if (res.ok) {
        if (!onProgress) return Buffer.from(await res.arrayBuffer());
        const total = Number(res.headers.get('content-length')) || 0, chunks = [];
        let got = 0;
        for await (const chunk of res.body) { chunks.push(chunk); got += chunk.length; onProgress(got, total); }
        return Buffer.concat(chunks);
      }
      if (res.status !== 429 && res.status < 500) throw Object.assign(new Error(`${url} : erreur ${res.status}`), { final: true });
      retry = (Number(res.headers.get('retry-after')) || 0) * 1000;
    } catch (e) {
      if (e.final) throw e;
      retry = 0;
    }
    if (attempt >= 8) throw new Error(`${url} : téléchargement impossible (serveur injoignable ?)`);
    await wait(Math.max(retry, 1000 * 2 ** Math.min(attempt, 5)));
  }
}

// ---------------------------------------------------------------- the app (Electron)
function electronZip() {
  const platform = MAC ? 'darwin' : 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' && !MAC ? 'ia32' : 'x64';
  return `electron-v${ELECTRON}-${platform}-${arch}.zip`;
}

function unzip(zip, dir) {
  if (MAC) return execFileSync('ditto', ['-x', '-k', zip, dir]);
  // Windows 10 and later ship bsdtar, which reads zips (the tar of Git Bash, first in its PATH, does not)
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(tar)) return execFileSync(tar, ['-xf', zip, '-C', dir]);
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]);
}

async function installElectron() {
  const name = electronZip(), base = `https://github.com/electron/electron/releases/download/v${ELECTRON}/`;
  console.log(`Téléchargement d'Electron ${ELECTRON} (${name}), le moteur de l'application…`);
  const sums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
  const expected = new RegExp('^([0-9a-f]{64}) \\*?' + name.replace(/\./g, '\\.') + '$', 'm').exec(sums)?.[1];
  if (!expected) throw new Error(`${name} absent des sommes SHA-256 de la release d'Electron`);
  let shown = -1;
  const zip = await download(base + name, (got, total) => {
    const step = total ? Math.floor(got / total * 10) : -1;
    if (step > shown) { shown = step; console.log(`  ${mb(got)}${total ? ' / ' + mb(total) : ''}`); }
  });
  if (sha256(zip) !== expected) throw new Error(`${name} : le fichier téléchargé ne correspond pas à la release d'Electron`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goofytrack-electron-'));
  try {
    const zipFile = path.join(tmp, name), dir = path.join(tmp, 'app');
    fs.writeFileSync(zipFile, zip);
    fs.mkdirSync(dir);
    unzip(zipFile, dir);
    if (MAC) {
      // the whole app at once: ditto keeps the links and permissions of its frameworks
      execFileSync('ditto', [path.join(dir, 'Electron.app'), EXE]);
    } else {
      for (const entry of fs.readdirSync(dir)) {
        // Electron's licence must not replace the one of this repository
        const target = entry === 'electron.exe' ? EXE : path.join(GAME, entry === 'LICENSE' ? 'LICENSE.electron' : entry);
        fs.cpSync(path.join(dir, entry), target, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // Electron's sample app: the game is resources/app (build.js)
  fs.rmSync(path.join(RESOURCES, 'default_app.asar'), { force: true });
  require('./setup').rebrand(MOD_VERSION);
  console.log(`Application installée : ${EXE}`);
}

// ---------------------------------------------------------------- the game (PolyTrack 0.6.3)
function toDesktop(file, buf) {
  let text = buf.toString('utf8');
  for (const [from, to] of TO_DESKTOP[file]) {
    if (!text.includes(from)) throw new Error(`${file} : la version web de PolyTrack ${SUPPORTED_VERSION} a changé`);
    text = text.replace(from, to);
  }
  return Buffer.from(text, 'utf8');
}

async function installGame() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const list = Object.entries(manifest.files);
  const total = list.reduce((n, [, [size]]) => n + size, 0);
  console.log(`Téléchargement de PolyTrack ${SUPPORTED_VERSION} depuis ${WEB} (${list.length} fichiers, ${mb(total)})…`);
  const files = new Map();
  let next = 0, done = 0, shown = 0;
  async function worker() {
    while (next < list.length) {
      const [file, [size, hash]] = list[next++];
      let buf = await download(WEB + file.split('/').map(encodeURIComponent).join('/'));
      if (TO_DESKTOP[file]) buf = toDesktop(file, buf);
      if (buf.length !== size || sha256(buf) !== hash) throw new Error(`${file} : le fichier téléchargé n'est pas celui de PolyTrack ${SUPPORTED_VERSION}`);
      files.set(file, buf);
      done += size;
      if (done / total >= shown / 10) { console.log(`  ${mb(done)} / ${mb(total)}`); while (done / total >= shown / 10) shown++; }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));   // a few at a time: Kodub's server refuses too many

  files.set('package.json', Buffer.from(JSON.stringify(PACKAGE, null, 2) + '\n'));
  for (const file of OWN.slice(1)) files.set(file, fs.readFileSync(path.join(__dirname, file)));
  fs.mkdirSync(RESOURCES, { recursive: true });
  asar.pack(files, ARCHIVE_BACKUP + '.part');
  fs.renameSync(ARCHIVE_BACKUP + '.part', ARCHIVE_BACKUP);
  console.log(`PolyTrack ${SUPPORTED_VERSION} vérifié et gardé dans ${path.relative(GAME, ARCHIVE_BACKUP)}`);
}

// ---------------------------------------------------------------- manifest (development)
// The files of a PolyTrack 0.6.3 desktop archive, with their size and SHA-256, but the desktop app's own
async function writeManifest(archive) {
  const files = {};
  for (const file of asar.list(archive).sort()) {
    if (OWN.includes(file)) continue;
    const buf = asar.readFile(archive, file);
    files[file] = [buf.length, sha256(buf)];
  }
  // the web version must turn into these very files
  for (const file of Object.keys(TO_DESKTOP)) {
    const web = toDesktop(file, await download(WEB + file));
    if (sha256(web) !== files[file][1]) throw new Error(`${file} : la version web ne devient pas celle du bureau`);
  }
  fs.writeFileSync(MANIFEST, JSON.stringify({ version: SUPPORTED_VERSION, electron: ELECTRON, files }, null, 0).replace(/\],"/g, '],\n"') + '\n');
  console.log(`${MANIFEST} : ${Object.keys(files).length} fichiers`);
}

async function main() {
  if (process.argv.includes('--manifest')) return writeManifest(process.argv.slice(2).find(a => !a.startsWith('--')) || ARCHIVE_BACKUP);
  if (!fs.existsSync(EXE)) await installElectron();
  if (!fs.existsSync(ARCHIVE_BACKUP) && !fs.existsSync(ARCHIVE)) await installGame();
}

main().catch(e => { console.error(`Échec : ${e.message}`); process.exitCode = 1; });
