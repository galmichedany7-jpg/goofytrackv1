// Compiles "GoofyTrack Launcher.exe" (Launcher.cs) into the GoofyTrack folder, with the C# compiler that ships
// with Windows (.NET Framework 4): nothing to install. The exe is committed, so players never run this; run it
// again after editing Launcher.cs.
//
//   node sources/launcher/build_launcher.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'GoofyTrack Launcher.exe');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework'].map(f => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find(f => fs.existsSync(f));
if (!csc) { console.error('csc.exe (.NET Framework 4) introuvable'); process.exit(1); }

// the launcher that is running cannot be overwritten, but it can be renamed (it deletes the .old file when it starts)
if (fs.existsSync(OUT)) { fs.rmSync(OUT + '.old', { force: true }); try { fs.renameSync(OUT, OUT + '.old'); } catch { /* not running */ } }

execFileSync(csc, [
  '/nologo', '/optimize+', '/target:winexe', '/platform:anycpu',
  `/out:${OUT}`,
  `/win32icon:${path.join(__dirname, '..', 'images', 'goofytrack_icon.ico')}`,
  '/reference:System.Web.Extensions.dll',
  path.join(__dirname, 'Launcher.cs'),
], { stdio: 'inherit' });
try { fs.rmSync(OUT + '.old', { force: true }); } catch { /* still open */ }
console.log(`Lanceur compilé : ${OUT}`);
