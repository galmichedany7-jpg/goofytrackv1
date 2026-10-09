// Where the game lives. Pass the game folder as the first argument of build.js / uninstall.js,
// or set POLYTRACK_DIR; by default the game is expected next to this folder.
const path = require('path');

const GAME = path.resolve(process.env.POLYTRACK_DIR || path.join(__dirname, '..', 'PolyTrack-v0.6.3-win32-x64'));
const RESOURCES = path.join(GAME, 'resources');

module.exports = {
  GAME,
  RESOURCES,
  ARCHIVE: path.join(RESOURCES, 'app.asar'),                  // the game as shipped
  ARCHIVE_BACKUP: path.join(RESOURCES, 'app.asar.original'),  // same file, set aside while the mod is installed
  APP: path.join(RESOURCES, 'app'),                           // unpacked, modded copy the game loads instead
  ORIGINALS: path.join(__dirname, 'original'),                // pristine game files the build starts from (never committed)
  SUPPORTED_VERSION: '0.6.3',
  MOD_NAME: 'GoofyTrack',                                     // shown on the home screen, with the version
  MOD_VERSION: '2.3',                                       // home screen badge, menu footer, build fingerprint
  // Our matchmaking server (server/), in place of the PolyTrack one. GOOFY_SERVER overrides it, e.g. for a local test.
  SERVER_URL: process.env.GOOFY_SERVER || 'https://goofytrack.onrender.com/',
};
