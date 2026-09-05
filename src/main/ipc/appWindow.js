// IPC: app-window controls, external links, the bundled-help launcher, app
// version, the dev-tools gate, and the renderer→log bridge.
//
// CommonJS, Electron-free: every
// dependency arrives via `ctx` (and `ipcMain` is passed in), so this module is
// require-able in plain Node for smoke checks. `ctx.getMainWindow()` is called
// per-invocation because the window ref is reassigned on (re)create.
function register(ipcMain, ctx) {
  ipcMain.on('window-control', (event, action) => handleWindowControl(ctx, action, event.sender));
  ipcMain.on('window-move', (event, rect) => handleWindowMove(ctx, rect, event.sender));
  ipcMain.on('window-background', (event, color) => handleWindowBackground(ctx, color));
  ipcMain.on('toggle-devtools', () => handleToggleDevtools(ctx));
  ipcMain.on('open-external', (event, url) => handleOpenExternal(ctx, url));
  ipcMain.handle('help:open', async (event, opts) => handleHelpOpen(ctx, opts));
  ipcMain.handle('get-app-version', () => ctx.app.getVersion());
  ipcMain.handle('app:dev-allowed', () => ctx.devToolsAllowed);
  ipcMain.on('diag:log', (event, msg) => { try { ctx.log(`[renderer] ${msg}`); } catch (_) {} });
}

// Acts on whichever window sent the request. Torn-off tool windows are
// frameless too and draw the same buttons, so they have to control themselves
// rather than the main window. Falls back to the main window when the sender
// cannot be resolved.
function handleWindowControl(ctx, action, sender) {
  const win = (sender && ctx.BrowserWindow?.fromWebContents(sender)) || ctx.getMainWindow();
  if (!win || win.isDestroyed()) return;
  switch (action) {
    case 'minimize': win.minimize(); break;
    case 'maximize':
      win.isMaximized() ? win.unmaximize() : win.maximize();
      break;
    case 'close': win.close(); break;
  }
}

// Move the window that asked, in screen coordinates. A torn-off tool draws its
// own title bar and drags itself, because the drag has to light the layout's
// drop targets as it passes over them, which an OS-driven window move cannot do.
//
// Every step states the whole rectangle, at a size that is never measured
// during a drag. The window's size in DIP is a rounding of its physical size,
// and setting it back converts with another rounding; on a display that is not
// at 100% scale the two do not cancel, so every measurement can cost a pixel,
// and a measurement whose result is fed into the next set is a feedback loop
// that grows the window for as long as it runs.
//
// So the size is measured once per window and refreshed only by a resize the
// user made. Telling those apart matters: SetWindowPos delivers the resize
// event synchronously from inside setBounds, so a listener that re-measured on
// every resize WAS the feedback loop, one pixel per step. A drag brackets its
// moves with an end message, and resizes inside that bracket are this handler's
// own echo, not the user's; a resize this module makes itself is flagged while
// it runs, for the same reason.
//
// The size held is a steady one, see steadySize: most DIP sizes come out a
// pixel larger at some positions than at others, and a window whose pixel size
// flips as it moves re-lays out its content at every flip.
const dragSizes = new WeakMap();   // win → {width, height, steady} in DIP
const dragging = new WeakSet();
const settling = new WeakSet();

function handleWindowMove(ctx, move, sender) {
  const win = sender && ctx.BrowserWindow?.fromWebContents(sender);
  if (!win || win.isDestroyed() || win === ctx.getMainWindow()) return;
  if (move && move.end) { dragging.delete(win); return; }
  const { x, y } = move || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  if (!dragSizes.has(win)) watchSize(ctx, win);
  const { width, height } = heldSize(ctx, win);
  dragging.add(win);
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

// Measure the window once, and follow the resizes the user makes from then on.
function watchSize(ctx, win) {
  const { width, height } = win.getBounds();
  dragSizes.set(win, steadySize(ctx, win, { width, height }));
  win.on('resize', () => {
    if (win.isDestroyed() || dragging.has(win) || settling.has(win)) return;
    const measured = win.getBounds();
    dragSizes.set(win, { width: measured.width, height: measured.height, steady: false });
  });
  // Fires once when the user lets go of the frame. The size they chose is
  // snapped to the nearest steady one, a pixel or two away, so the next drag
  // does not begin by resizing the window.
  win.on('resized', () => {
    if (win.isDestroyed() || dragging.has(win)) return;
    applyHeldSize(ctx, win);
  });
}

// The size a drag holds, steadied if a user resize left it raw.
function heldSize(ctx, win) {
  let size = dragSizes.get(win);
  if (!size.steady) {
    size = steadySize(ctx, win, size);
    dragSizes.set(win, size);
  }
  return size;
}

function applyHeldSize(ctx, win) {
  const { width, height } = heldSize(ctx, win);
  if (win.isMaximized?.() || win.isFullScreen?.()) return;
  settling.add(win);
  try { win.setSize(width, height); } finally { settling.delete(win); }
}

// Give a torn-off window a steady size from its first moment, so its first
// drag does not begin by resizing it.
function settleWindowSize(ctx, win) {
  if (!win || win.isDestroyed()) return;
  if (!dragSizes.has(win)) watchSize(ctx, win);
  applyHeldSize(ctx, win);
}

// Windows lays a DIP rectangle onto pixels by rounding its origin and enclosing
// its far edge, so a width w at position x covers ceil((x + w) * s) - floor(x * s)
// pixels: for most widths, one pixel more at some positions than at others. At
// 125% a window 802 DIP wide covers 1003 pixels at one position and 1004 a step
// to the right, and each flip re-lays out its content, so the controls inside
// twitch as it is dragged. One width in every few is steady: 801 DIP is 1002
// pixels wherever it stands.
//
// Nothing here assumes that arithmetic. The conversion is asked whether a
// candidate comes out the same size at a run of positions, and the nearest
// steady candidate to the size given is the answer, the smaller one first since
// a measured size is rounded up. Where the conversion is not offered (Linux,
// macOS) the size stands as given.
const STEADY_SEARCH = 6;    // candidates tried either side of the given size
const STEADY_PHASES = 12;   // positions probed; covers scale denominators up to 12

function steadySize(ctx, win, size) {
  const screen = ctx.screen;
  const steadied = { width: size.width, height: size.height, steady: true };
  if (!screen || typeof screen.dipToScreenRect !== 'function') return steadied;
  const { x, y } = win.getBounds();
  const [minWidth, minHeight] = win.getMinimumSize?.() || [0, 0];
  const convert = (rect) => screen.dipToScreenRect(win, rect);
  steadied.width = steadyLength(size.width, minWidth,
    (w, k) => convert({ x: x + k, y, width: w, height: 1 }).width);
  steadied.height = steadyLength(size.height, minHeight,
    (h, k) => convert({ x, y: y + k, width: 1, height: h }).height);
  return steadied;
}

function steadyLength(length, min, pixelsAt) {
  const steady = (candidate) => {
    const first = pixelsAt(candidate, 0);
    for (let k = 1; k < STEADY_PHASES; k++) {
      if (pixelsAt(candidate, k) !== first) return false;
    }
    return true;
  };
  if (steady(length)) return length;
  for (let d = 1; d <= STEADY_SEARCH; d++) {
    for (const candidate of [length - d, length + d]) {
      if (candidate >= min && steady(candidate)) return candidate;
    }
  }
  return length;
}

// Repaint every window's frame in the new theme's background, so a resize right
// after a theme change does not expose the old colour along the edge. The
// startup colour comes from settings; this keeps the running app in step.
function handleWindowBackground(ctx, color) {
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
  for (const win of ctx.BrowserWindow?.getAllWindows() || []) {
    if (!win.isDestroyed()) win.setBackgroundColor(color);
  }
}

function handleToggleDevtools(ctx) {
  if (!ctx.devToolsAllowed) return;
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  if (mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  } else {
    mainWindow.webContents.openDevTools();
  }
}

function handleOpenExternal(ctx, url) {
  if (typeof url !== 'string') return;
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      ctx.shell.openExternal(url);
    }
  } catch (_) {}
}

// Open the bundled help site in the user's default browser via the local HTTP
// server (see src/main/helpServer.js). The anchor is a Starlight route slug
// (e.g. 'design/design-editor'); 'index'/falsy targets the landing page. The
// locale (en|ru|zh) maps to Starlight's per-language output subtree.
// DOC_LOCALES: locales that have their own subtree in the Starlight build
// (root = en). zh has no translated pages yet, so it falls through to English.
const DOC_LOCALES = ['ru', 'zh'];
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

    const segs = [];
    if (DOC_LOCALES.includes(locale)) segs.push(locale);
    if (anchor && anchor !== 'index') segs.push(...anchor.split('/').filter(Boolean));

    let diskCandidate = path.join(helpServerRoot, ...segs, 'index.html');
    let urlSegs = segs.slice();
    if (!fs.existsSync(diskCandidate)) {
      log(`Help page missing: ${diskCandidate} — falling back`);
      if (DOC_LOCALES.includes(locale) && fs.existsSync(path.join(helpServerRoot, locale, 'index.html'))) {
        urlSegs = [locale];
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

module.exports = { register, settleWindowSize };
