// Restores the unmodified game: removes resources/app and puts the original archive back.
//
//   node uninstall.js ["C:\path\to\PolyTrack-v0.6.3-win32-x64"]
const fs = require('fs');

if (process.argv[2]) process.env.POLYTRACK_DIR = process.argv[2];
const { ARCHIVE, ARCHIVE_BACKUP, APP } = require('./config');

if (!fs.existsSync(ARCHIVE_BACKUP)) {
  console.error('resources/app.asar.original not found: the mod does not seem to be installed here.');
  process.exit(1);
}
fs.rmSync(APP, { recursive: true, force: true });
fs.renameSync(ARCHIVE_BACKUP, ARCHIVE);
console.log('Mod removed, original game restored.');
