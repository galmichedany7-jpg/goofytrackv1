// What the game reads from window.electron (the PolyTrack 0.6.3 code asks for these): main.js answers
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  quit: () => ipcRenderer.send('quit'),
  addFullscreenChangeListener: listener => ipcRenderer.on('fullscreen-change', () => listener()),
  isFullscreen: () => ipcRenderer.sendSync('is-fullscreen'),
  setFullscreen: on => ipcRenderer.send('set-fullscreen', on),
  getArgv: () => ipcRenderer.sendSync('get-argv'),
  log: text => ipcRenderer.send('log-message', text),
  // GoofyTrack: opens GoofyTrack Launcher and quits (apex-update.js); resolves to an error message, or null and quits
  openLauncher: () => ipcRenderer.invoke('open-launcher'),
});
