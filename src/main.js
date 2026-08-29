const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./main/logger');
const { log, flushLog } = logger;
const { safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto } = require('./main/paths');
const seed = require('./main/seed');
const helpServer = require('./main/helpServer');
const { createUserPaths } = require('./main/userPaths');
const dragGhost = require('./main/dragGhost');
const { registerAllIpc } = require('./main/ipc');

const isPackaged = app.isPackaged;
// DevTools allowed in dev always, and in packaged builds only when launched with
// --debug (so we can diagnose a shipped build without weakening normal installs).
const devToolsAllowed = !isPackaged || process.argv.includes('--debug');
let exeDir;
if (isPackaged) {
  exeDir = path.dirname(process.execPath);
} else {
  exeDir = app.getAppPath();
}
logger.init(exeDir);

let portableDataDir = path.join(exeDir, 'AppData');


log('=== App Startup ===');
log(`Packaged: ${isPackaged}`);
log(`Exe directory: ${exeDir}`);
log(`Data directory: ${portableDataDir}`);

try {
  if (!fs.existsSync(portableDataDir)) {
    fs.mkdirSync(portableDataDir, { recursive: true });
    log(`Created data directory: ${portableDataDir}`);
  }
  const testFile = path.join(portableDataDir, '.write-test');
  fs.writeFileSync(testFile, 'test', 'utf-8');
  fs.unlinkSync(testFile);
  log('Data directory is writable');
} catch (err) {
  log(`Failed to set up data directory: ${err.message}`);
  // MP7: the exe dir is read-only (Program Files, a locked USB, a network share),
  // so the portable AppData beside it is unwritable. Using it for userData anyway
  // would make settings / license / localStorage all fail silently. Fall back to
  // the OS per-user app-data directory instead of soldiering on with a dead dir.
  try {
    const fallback = path.join(app.getPath('appData'), 'TFStudio');
    fs.mkdirSync(fallback, { recursive: true });
    portableDataDir = fallback;
    log(`Falling back to per-user data directory: ${fallback}`);
  } catch (err2) {
    log(`Per-user fallback data directory also failed: ${err2.message}`);
  }
}

app.setPath('userData', portableDataDir);
flushLog();

let mainWindow;
let userPaths;

// MP6: single-instance lock. Two instances would share the portable userData —
// the same Chromium profile, settings.json (last-writer-wins), the log file, and
// load-folders' duplicate cleanup could move aside a file the other instance just
// wrote. Hand off to the already-running instance and exit before any further
// init runs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function appIndexFile() {
  return isPackaged
    ? path.join(__dirname, '..', 'build', 'app', 'index.html')
    : path.join(__dirname, 'index.html');
}


// The colour the window frame paints with before the renderer has drawn, and in
// any area a resize exposes. It has to be the current theme's background or the
// app flashes the wrong colour on startup and along the edge while resizing;
// the renderer writes it to settings whenever the theme changes. Dark is the
// safer default for a first run, since the shipped themes mostly are.
const FALLBACK_WINDOW_BG = '#1e1e1e';
function windowBackgroundColor() {
  try {
    const saved = readJsonSafe(path.join(app.getPath('userData'), 'settings.json'));
    const color = saved && saved.windowBackground;
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  } catch (_) { /* settings unreadable: the fallback is fine */ }
  return FALLBACK_WINDOW_BG;
}


function createWindow() {
  const backgroundColor = windowBackgroundColor();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: devToolsAllowed,   // off in packaged builds unless launched with --debug
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor,
    show: false,
    icon: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'tfstudio.ico' : 'tfstudio.png'),
    frame: false,
    titleBarStyle: 'hidden'
  });

  // Packaged builds load the bundled + minified renderer (build/app/); dev loads raw src/.
  mainWindow.loadFile(appIndexFile());

  // The window is created hidden and revealed on 'ready-to-show' so users never see
  // an unpainted white frame. That event only fires once the compositor presents a
  // first frame, which is not guaranteed: under native Wayland with no working GPU
  // (VMs, remote desktops, software rendering) it never fires, and the app then runs
  // with no window at all — no crash, nothing in the log, just an invisible process.
  // Back the event with a timer so a missing first frame can't hide the app forever.
  let windowShown = false;
  const revealWindow = () => {
    if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    windowShown = true;
    clearTimeout(revealFallback);
    mainWindow.show();
  };
  const revealFallback = setTimeout(revealWindow, 5000);
  mainWindow.once('ready-to-show', revealWindow);

  if (devToolsAllowed && (process.argv.includes('--dev') || process.argv.includes('--debug'))) {
    mainWindow.webContents.openDevTools();
  }

  // Torn-off tool windows. The renderer calls window.open() with a name of
  // `tfstudio-float-<id>`; the window it gets back is a real top-level window the
  // user can move to another monitor, but it stays in the main window's renderer
  // process, so the React tree behind it is the same one and the design needs no
  // cross-process sync. Anything else asking for a window is denied and sent to
  // the user's browser instead.
  // Size and position come from the features string the renderer passes, which
  // Electron has already turned into window options; these override the rest.
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName && frameName.startsWith('tfstudio-float-')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          // Frameless, like the main window: the tool draws its own strip with
          // the window buttons on it, so a torn-off window never shows two
          // stacked title bars.
          frame: false,
          backgroundColor,
          minWidth: 320,
          minHeight: 240,
          icon: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'tfstudio.ico' : 'tfstudio.png'),
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: devToolsAllowed,
            preload: path.join(__dirname, 'preload.js'),
          },
        },
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (child, { frameName }) => {
    // A torn-off window draws its own maximize button, so it needs the same
    // maximize/unmaximize reports the main window gets, addressed to itself.
    const send = (channel) => () => {
      if (!child.isDestroyed()) child.webContents.send(channel);
    };
    child.on('maximize', send('window-maximized'));
    child.on('unmaximize', send('window-unmaximized'));

    // Dragging a torn-off window over the layout docks it. The drag is the OS
    // one, so the renderer sees no mouse events for it: the main process
    // reports where the cursor is on every move instead, and says when the drag
    // ended.
    const tell = (channel) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, {
          frameName, cursor: screen.getCursorScreenPoint(),
        });
      }
    };
    child.on('move', () => { if (!child.isDestroyed()) tell('float-window-move'); });
    child.on('moved', () => { if (!child.isDestroyed()) tell('float-window-dropped'); });
  });

  // The drag preview is a hidden window between drags, and a hidden window
  // still counts as open: leaving it alive would stop 'window-all-closed' from
  // firing and the app would never quit.
  mainWindow.on('closed', () => { mainWindow = null; dragGhost.destroy(); });
  mainWindow.on('maximize', () => { mainWindow.webContents.send('window-maximized'); });
  mainWindow.on('unmaximize', () => { mainWindow.webContents.send('window-unmaximized'); });

  Menu.setApplicationMenu(null);
}


// Create the per-source subfolders inside the Materials directory and seed the
// bundled catalogs into it. Driven by the current path registry rather than a
// captured string, so it can be re-run against a newly configured folder.
function prepareMaterialsDir(materialsDir) {
  for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
    const subDir = path.join(materialsDir, sub);
    if (!fs.existsSync(subDir)) {
      try { fs.mkdirSync(subDir, { recursive: true }); }
      catch (err) { log(`Failed to create ${subDir}: ${err.message}`); }
    }
  }

  // First-run: copy bundled Schott AGF, coating/substrate catalogs and RII offline mirror.
  try { seed.seedBundledMaterials(materialsDir, { isPackaged, srcDir: __dirname }); }
  catch (err) { log(`seedBundledMaterials error: ${err.message}`); }
}

function setupIpcHandlers() {
  const userDataPath = app.getPath('userData');

  // Machine-local settings stay in the portable AppData folder.
  const settingsPath = path.join(userDataPath, 'settings.json');

  // User-facing data lives in Documents\TFStudio by default so it persists
  // across app installs; each folder can be pointed elsewhere from Settings.
  userPaths = createUserPaths({ documentsDir: app.getPath('documents'), fs, path, log });
  userPaths.loadOverrides(readJsonSafe(settingsPath)?.folders);
  userPaths.ensureAll();

  // ── IPC: all domain handlers live in src/main/ipc/ ──────────────
  // Shared services bag passed to every handler module via registerAllIpc.
  // getMainWindow is a closure (the window ref is reassigned on create); the
  // safe* helpers are consumed by the projects/catalogs/report/rii groups. The
  // user-directory keys are live getters installed by defineCtxGetters, so a
  // handler that reads ctx.<x>Dir per call follows a folder change immediately.
  const ctx = userPaths.defineCtxGetters({
    app, shell, dialog, BrowserWindow, fs, path, log,
    devToolsAllowed, isPackaged, resourcesDir: process.resourcesPath, srcDir: __dirname,
    getMainWindow: () => mainWindow,
    helpServer,
    safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto,
    userDataPath, settingsPath,
    userPaths,
    onUserPathsChanged: () => {
      userPaths.ensureAll();
      prepareMaterialsDir(userPaths.get('materials'));
    },
  });
  registerAllIpc(ipcMain, ctx);

  prepareMaterialsDir(userPaths.get('materials'));
}

app.whenReady().then(() => {
  log('App ready');
  helpServer.startHelpServer({ isPackaged, srcDir: __dirname });
  setupIpcHandlers();   // register once, not per-window (MP5 fix)
  createWindow();
});

app.on('window-all-closed', () => {
  helpServer.stopHelpServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  helpServer.stopHelpServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
