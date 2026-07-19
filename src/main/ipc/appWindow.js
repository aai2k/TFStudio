// IPC: app-window controls, external links, the bundled-help launcher, app
// version, the dev-tools gate, and the renderer→log bridge.
//
// CommonJS, Electron-free: every
// dependency arrives via `ctx` (and `ipcMain` is passed in), so this module is
// require-able in plain Node for smoke checks. `ctx.getMainWindow()` is called
// per-invocation because the window ref is reassigned on (re)create.
function register(ipcMain, ctx) {
  ipcMain.on('window-control', (event, action) => handleWindowControl(ctx, action));
  ipcMain.on('toggle-devtools', () => handleToggleDevtools(ctx));
  ipcMain.on('open-external', (event, url) => handleOpenExternal(ctx, url));
  ipcMain.handle('help:open', async (event, opts) => handleHelpOpen(ctx, opts));
  ipcMain.handle('get-app-version', () => ctx.app.getVersion());
  // Whether DevTools / reload are permitted (dev, or packaged + --debug). The
  // renderer uses this to hide the dev-only View menu items in shipped builds.
  ipcMain.handle('app:dev-allowed', () => ctx.devToolsAllowed);
  // Renderer → app-debug.log bridge, so we can diagnose a packaged build (where
  // DevTools is off) by reading the log next to the exe.
  ipcMain.on('diag:log', (event, msg) => { try { ctx.log(`[renderer] ${msg}`); } catch (_) {} });
}

function handleWindowControl(ctx, action) {
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;   // window may be gone
  switch (action) {
    case 'minimize': mainWindow.minimize(); break;
    case 'maximize':
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
      break;
    case 'close': mainWindow.close(); break;
  }
}

function handleToggleDevtools(ctx) {
  if (!ctx.devToolsAllowed) return;   // DevTools disabled in packaged builds (unless --debug)
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  if (mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  } else {
    mainWindow.webContents.openDevTools();
  }
}

function handleOpenExternal(ctx, url) {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) ctx.shell.openExternal(url);
}

// Open the bundled help site in the user's default browser via the local HTTP
// server (see src/main/helpServer.js). The anchor is a Starlight route slug
// (e.g. 'design/design-editor'); 'index'/falsy targets the landing page. The
// locale (en|ru) maps to Starlight's root vs. /ru/ output paths.
async function handleHelpOpen(ctx, opts) {
  const { fs, path, log, helpServer, shell } = ctx;
  try {
    const helpServerRoot = helpServer.getHelpServerRoot();
    const helpServerPort = helpServer.getHelpServerPort();
    const { anchor, locale } = opts || {};
    if (!helpServerRoot) {
      log(`help:open: server root not initialized (run "npm run docs:build")`);
      return { success: false, error: 'help-not-built' };
    }
    if (!helpServerPort) {
      log(`help:open: help server not listening yet`);
      return { success: false, error: 'help-server-not-ready' };
    }

    // Build the on-disk path to verify the page exists, then translate to an
    // HTTP URL. Fall back to landing if the anchor is missing so the user
    // never lands on a dead link.
    const segs = [];
    if (locale === 'ru') segs.push('ru');
    if (anchor && anchor !== 'index') segs.push(...anchor.split('/').filter(Boolean));

    let diskCandidate = path.join(helpServerRoot, ...segs, 'index.html');
    let urlSegs = segs.slice();
    if (!fs.existsSync(diskCandidate)) {
      log(`Help page missing: ${diskCandidate} — falling back`);
      if (locale === 'ru' && fs.existsSync(path.join(helpServerRoot, 'ru', 'index.html'))) {
        urlSegs = ['ru'];
      } else {
        urlSegs = [];
      }
    }

    const pathPart = urlSegs.length ? urlSegs.join('/') + '/' : '';
    const url = `http://127.0.0.1:${helpServerPort}/${pathPart}`;
    await shell.openExternal(url);
    return { success: true, url };
  } catch (err) {
    ctx.log(`help:open failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
