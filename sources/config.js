// Where the game lives: in the GoofyTrack folder, above this one (GoofyTrack.exe and its files, put there by
// setup.js; the code is in sources/). GOOFYTRACK_DIR points the build at another copy, e.g. for a local test.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');                     // the GoofyTrack folder: the exe, the two .bat files, sources/
const GAME = path.resolve(process.env.GOOFYTRACK_DIR || ROOT);
const RESOURCES = path.join(GAME, 'resources');

module.exports = {
  ROOT,
  GAME,
  RESOURCES,
  EXE: path.join(GAME, 'GoofyTrack.exe'),                     // PolyTrack.exe, renamed and given the GoofyTrack icon by setup.js
  ARCHIVE: path.join(RESOURCES, 'app.asar'),                  // the game as shipped
  ARCHIVE_BACKUP: path.join(RESOURCES, 'app.asar.original'),  // same file, set aside while the mod is installed
  APP: path.join(RESOURCES, 'app'),                           // unpacked, modded copy the game loads instead
  ORIGINALS: path.join(__dirname, 'original'),                // pristine game files the build starts from (never committed)
  SUPPORTED_VERSION: '0.6.3',
  EDITOR_CHUNK: '112.bundle.js',                              // the game's editor, loaded on demand (patched for the Riviera environment)
  GARAGE_CHUNK: '604.bundle.js',                              // the garage, loaded on demand (patched for the liveries, apex-livery.js)
  MOD_NAME: 'GoofyTrack',                                     // shown on the home screen, with the version
  MOD_VERSION: '2.21.2',                                   // home screen badge, menu footer, build fingerprint
  // Our matchmaking server (server/), in place of the PolyTrack one. GOOFY_SERVER overrides it, e.g. for a local test.
  SERVER_URL: process.env.GOOFY_SERVER || 'https://goofytrack.onrender.com/',
  // The version built into the game, or null: build.js writes it at the top of the theme
  installedVersion: () => {
    try { return /--apx-version: "VERSION ([^"]+)"/.exec(fs.readFileSync(path.join(RESOURCES, 'app', 'apex-theme.css'), 'utf8'))[1]; } catch { return null; }
  },
};
