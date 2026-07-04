const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./main/logger');
const { log, flushLog } = logger;
const { safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto } = require('./main/paths');
const seed = require('./main/seed');
const helpServer = require('./main/helpServer');
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


function createWindow() {
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
    backgroundColor: '#eceef1',
    show: false,
    icon: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'tfstudio-purple2.ico' : 'tfstudio-purple2.png'),
    frame: false,
    titleBarStyle: 'hidden'
  });

  // Packaged builds load the bundled + minified renderer (build/app/); dev loads raw src/.
  mainWindow.loadFile(appIndexFile());

  mainWindow.once('ready-to-show', () => { mainWindow.show(); });

  if (devToolsAllowed && (process.argv.includes('--dev') || process.argv.includes('--debug'))) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('maximize', () => { mainWindow.webContents.send('window-maximized'); });
  mainWindow.on('unmaximize', () => { mainWindow.webContents.send('window-unmaximized'); });

  Menu.setApplicationMenu(null);
}


function setupIpcHandlers() {
  const userDataPath = app.getPath('userData');

  // User-facing data lives in Documents\TFStudio so it persists across app installs.
  const userDocsDir  = path.join(app.getPath('documents'), 'TFStudio');
  const projectsDir  = path.join(userDocsDir, 'Projects');
  const materialsDir = path.join(userDocsDir, 'Materials');
  const integralsDir = path.join(userDocsDir, 'IntegralPresets');
  const qualifiersDir = path.join(userDocsDir, 'Qualifiers');
  const meritFunctionsDir = path.join(userDocsDir, 'MeritFunctions');
  const reportPresetsDir = path.join(userDocsDir, 'ReportPresets');
  const brandingDir = path.join(userDocsDir, 'Branding');

  // Machine-local settings stay in the portable AppData folder.
  const settingsPath = path.join(userDataPath, 'settings.json');

  for (const dir of [projectsDir, materialsDir, integralsDir, qualifiersDir, meritFunctionsDir, reportPresetsDir, brandingDir]) {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); log(`Created directory: ${dir}`); }
      catch (err) { log(`Failed to create ${dir}: ${err.message}`); }
    }
  }

  // ── IPC: all domain handlers live in src/main/ipc/ ──────────────
  // Shared services bag passed to every handler module via registerAllIpc.
  // getMainWindow is a closure (the window ref is reassigned on create); the dir
  // paths + safe* helpers are consumed by the projects/catalogs/report/rii groups.
  const ctx = {
    app, shell, dialog, BrowserWindow, fs, path, log,
    devToolsAllowed, isPackaged, srcDir: __dirname,
    getMainWindow: () => mainWindow,
    helpServer,
    safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto,
    userDataPath, userDocsDir, settingsPath,
    projectsDir, materialsDir, integralsDir, qualifiersDir,
    meritFunctionsDir, reportPresetsDir, brandingDir,
  };
  registerAllIpc(ipcMain, ctx);


  // Ensure Materials subfolders exist for each catalog source.
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
