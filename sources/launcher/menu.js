// The launcher of macOS (and of any system without "GoofyTrack Launcher.exe"): the same choices as the Windows one,
// in a Terminal window. "GoofyTrack Launcher.command" opens it with a double-click.
//
//   node sources/launcher/menu.js
const path = require('path');
const readline = require('readline/promises');
const { spawnSync, spawn } = require('child_process');

const SOURCES = path.join(__dirname, '..');
const MAC = process.platform === 'darwin';
const node = (script, args = [], stdio = 'inherit') => spawnSync(process.execPath, [path.join(SOURCES, script), ...args], { stdio, encoding: 'utf8' });
const bold = s => `\x1b[1m${s}\x1b[0m`, red = s => `\x1b[31m${s}\x1b[0m`, grey = s => `\x1b[90m${s}\x1b[0m`;

function status() {
  const out = node('update.js', ['--status'], ['ignore', 'pipe', 'pipe']);
  try { return JSON.parse(out.stdout.trim().split('\n').pop()); } catch { return { error: (out.stderr || out.stdout || 'état illisible').trim() }; }
}

// One prompt at a time: an open prompt keeps the Terminal in its own mode, which the scripts run in between
// (update.js asks for PolyTrack.app itself) must not inherit
async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

async function main() {
  while (true) {
    console.clear();
    console.log(bold('\n  GoofyTrack\n'));
    console.log(grey('  Recherche de mises à jour…'));
    const s = status();
    console.clear();
    console.log(bold('\n  GoofyTrack\n'));
    console.log(grey(`  ${s.hasGame && s.installed ? 'Version installée : ' + s.installed : 'Jeu pas encore installé'}     Dernière version : ${s.latest || 'inconnue'}`));
    if (s.error) console.log(red(`  Impossible de vérifier les mises à jour : ${s.error}`));
    else if (!s.hasGame) console.log('  Installez le jeu : il se télécharge tout seul (environ 150 Mo, une seule fois).');
    else if (s.updateAvailable) console.log('  Une nouvelle version est disponible.');
    else if (s.installed !== s.source) console.log(`  Le jeu n'a pas encore la version ${s.source} du code : reconstruisez-le.`);
    else console.log('  GoofyTrack est à jour.');
    console.log('');

    const choices = [];
    if (!s.hasGame) choices.push(['Installer', () => install(s)]);
    else if (s.updateAvailable) choices.push([s.git ? 'Mettre à jour' : `Mettre à jour vers la ${s.latest}`, () => node('update.js')]);
    if (s.hasGame) choices.push(['Jouer', 'play'], ['Reconstruire', () => node('build.js')]);
    choices.forEach(([label], i) => console.log(`  ${bold(i + 1)}  ${label}`));
    console.log(`  ${bold('Q')}  Quitter\n`);

    const answer = (await ask('  Votre choix : ')).trim().toLowerCase();
    if (answer === 'q' || answer === '') return;
    const choice = choices[parseInt(answer, 10) - 1];
    if (!choice) continue;
    if (choice[1] === 'play') { play(); return; }
    console.log('');
    if (s.gameRunning && choice[0] !== 'Installer') { await ask(red('  GoofyTrack est ouvert : fermez le jeu puis appuyez sur Entrée.')); continue; }
    const result = choice[1]();
    await ask(`\n  ${result && result.status === 0 ? 'Terminé.' : red('Échec.')} Appuyez sur Entrée pour revenir au menu.`);
  }
}

// update.js copies a PolyTrack.app found next to the folder, or downloads the game (polytrack.js)
function install(s) {
  return s.polyTrack ? node('update.js', [s.polyTrack]) : node('update.js');
}

function play() {
  const { EXE } = require('../config');
  if (MAC) spawn('open', [EXE], { detached: true, stdio: 'ignore' }).unref();
  else spawn(EXE, [], { cwd: path.dirname(EXE), detached: true, stdio: 'ignore' }).unref();
  console.log('\n  Bon jeu !\n');
}

main().catch(e => { console.error(red(e.message)); process.exitCode = 1; });
