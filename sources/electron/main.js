// GoofyTrack's desktop app (Electron main process): the game's window. Our own, in place of the one of the PolyTrack
// desktop app, which it behaves like (build.js puts it in resources/app/electron/, polytrack.js in the archive it makes):
// one instance, full screen (F11 or Alt+Enter), links to kodub.com opened in the browser, the PolyTrack servers
// spoken to as the desktop app does.
//
// The app's name stays "PolyTrack" (package.json, productName): the saves, in the profile Electron keeps under that
// name (%APPDATA%\PolyTrack, ~/Library/Application Support/PolyTrack), are those of the players' PolyTrack.
const { app, BrowserWindow, session, shell, ipcMain } = require('electron');
const path = require('path');

let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win == null) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// no other page in the window: the game's own links to kodub.com (and its music's credits) open in the browser
const EXTERNAL = url => url.startsWith('https://www.kodub.com/') || url === 'https://opengameart.org/content/sci-fi-theme-1';
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL(url)) setImmediate(() => shell.openExternal(url));
    return { action: 'deny' };
  });
  contents.on('will-navigate', e => e.preventDefault());
});

// what the game asks the desktop app (preload.js)
ipcMain.on('get-argv', e => { e.returnValue = process.argv; });
ipcMain.on('log-message', (e, text) => console.log(text));
ipcMain.on('quit', () => app.quit());
ipcMain.on('is-fullscreen', e => { e.returnValue = win != null && win.isFullScreen(); });
ipcMain.on('set-fullscreen', (e, on) => { if (win) win.setFullScreen(!!on); });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1024, height: 800, minWidth: 320, minHeight: 200, fullscreen: true, useContentSize: true, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'images', 'goofytrack_icon.ico'),   // the taskbar and Alt+Tab (Windows)
    webPreferences: { devTools: false, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.removeMenu();
  win.webContents.on('before-input-event', (event, input) => {
    if (input.isAutoRepeat || input.type !== 'keyDown') return;
    if (input.code === 'F11' || (input.alt && input.code === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.webContents.on('will-prevent-unload', e => e.preventDefault());
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-change', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-change', false));
  // the PolyTrack servers (official leaderboards, profiles) answer the desktop app's origin
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    details.requestHeaders.Origin = 'https://app-polytrack-desktop.kodub.com';
    callback({ requestHeaders: details.requestHeaders });
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
});
