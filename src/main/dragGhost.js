// The preview that follows the cursor while a docked tool is being dragged.
//
// It has to be a window of its own. Drawn as an element in the renderer, the
// preview is confined to the main window's viewport and is cut off at the frame
// edge, which is exactly where it matters: the user is aiming at the desktop or
// at a second monitor, and the thing they are aiming with disappears at the
// border they are trying to cross.
//
// One window serves every drag. It is built on the first one and hidden between
// them, because building a BrowserWindow takes long enough to be seen at the
// start of a gesture. It never takes focus and never takes the mouse, so the
// drag stays with the window that started it.
//
// CommonJS and Electron-free: `ctx.BrowserWindow` arrives from the caller, so
// this module is require-able in plain Node for smoke checks.

// Where the cursor holds the preview. The same offset a torn-off window opens
// at, so the window lands where the preview was rather than jumping on drop.
const HELD_X = 38;
const HELD_Y = 12;

// Matches the renderer's preview bounds (see previewSize in DockingLayout).
const MIN_W = 200, MAX_W = 340;
const MIN_H = 130, MAX_H = 250;

let ghost = null;
let placement = null;   // latest requested screen rect, or null between drags
let generation = 0;     // guards a load that resolves after its drag ended

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Colours arrive from the renderer's theme, and are interpolated into a
// stylesheet: anything that is not a plain hex colour is dropped for the
// shipped default rather than written into the document.
function safeColor(value, fallback) {
    return typeof value === 'string' && HEX.test(value.trim()) ? value.trim() : fallback;
}

function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function clampSize(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

// A base64 PNG and nothing else, since it is interpolated into a CSS url().
const SHOT = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
function safeShot(value) {
    return typeof value === 'string' && SHOT.test(value) ? value : null;
}

// The preview is opaque. A translucent one over the desktop reads as a glitch,
// and over a bright background behind the app it looks like it is being cut off
// at the main window's edge, which is the very thing this window exists to stop.
function documentFor(opts) {
    const panel = safeColor(opts.panel, '#252526');
    const bg = safeColor(opts.bg, '#1e1e1e');
    const border = safeColor(opts.border, '#3a3a3a');
    const accent = safeColor(opts.accent, '#0a84ff');
    const text = safeColor(opts.text, '#cccccc');
    const textDim = safeColor(opts.textDim, '#9a9a9a');
    // The pane as it looked when the drag began, so what follows the cursor is
    // the window's own contents rather than an empty box with its name on it.
    // A capture that failed leaves the panel colour behind it.
    const shot = safeShot(opts.shot);
    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;cursor:default;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none}
body{box-sizing:border-box;background:${panel};border:1px solid ${accent};
  display:flex;flex-direction:column}
.strip{display:flex;align-items:center;height:24px;padding:0 8px;background:${bg};
  border-bottom:1px solid ${border};color:${text};font-size:11px}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.buttons{color:${textDim};font-size:10px;letter-spacing:2px}
.body{flex:1;background:${panel}${shot ? ` url("${shot}") top left/100% 100% no-repeat` : ''}}
</style><div class="strip"><span class="name">${escapeHtml(opts.title)}</span>
<span class="buttons">&#8211; &#9633; &#215;</span></div><div class="body"></div>`;
}

// A picture of the pane being dragged, scaled down to the preview. Captured
// from the main window before the preview is shown, so the preview is never in
// its own shot. Any failure here costs the picture, not the drag.
async function capturePane(ctx, rect, width, height) {
    try {
        const main = ctx.getMainWindow && ctx.getMainWindow();
        if (!main || main.isDestroyed() || !rect) return null;
        const area = {
            x: Math.max(0, Math.round(rect.x)),
            y: Math.max(0, Math.round(rect.y)),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
        if (!(area.width > 0 && area.height > 0)) return null;
        const image = await main.webContents.capturePage(area);
        if (!image || image.isEmpty()) return null;
        return image.resize({ width, height, quality: 'good' }).toDataURL();
    } catch (_) {
        return null;
    }
}

function ensure(ctx) {
    if (ghost && !ghost.isDestroyed()) return ghost;
    ghost = new ctx.BrowserWindow({
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        // The drag belongs to the window it started in. A focusable preview
        // would take the mouse capture with it and end the gesture.
        focusable: false,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: false,
        },
    });
    // Above the app, and above a maximized window on whichever screen the
    // cursor has moved to.
    ghost.setAlwaysOnTop(true, 'screen-saver');
    ghost.setIgnoreMouseEvents(true);
    ghost.on('closed', () => { ghost = null; placement = null; });
    return ghost;
}

function show(ctx, opts) {
    if (!opts || !ctx || !ctx.BrowserWindow) return;
    const width = clampSize(opts.width, MIN_W, MAX_W, 240);
    const height = clampSize(opts.height, MIN_H, MAX_H, 170);
    const x = clampSize(opts.x, -1e6, 1e6, 0) - HELD_X;
    const y = clampSize(opts.y, -1e6, 1e6, 0) - HELD_Y;
    placement = { x, y, width, height };

    let win;
    try { win = ensure(ctx); } catch (_) { return; }   // no preview is better than no drag
    const mine = ++generation;
    win.setBackgroundColor(safeColor(opts.panel, '#252526'));
    win.setBounds(placement);

    capturePane(ctx, opts.pane, width, height)
        .then(shot => {
            if (mine !== generation || !ghost || ghost.isDestroyed()) return null;
            const html = documentFor({ ...opts, shot });
            return ghost.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        })
        .then(() => {
            // The drag can end while the picture is being taken or the document
            // loaded. Showing the preview after that strands one on screen.
            if (mine !== generation || !ghost || ghost.isDestroyed() || !placement) return;
            ghost.setBounds(placement);
            ghost.showInactive();
        })
        .catch(() => {});
}

function move(point) {
    if (!ghost || ghost.isDestroyed() || !placement || !point) return;
    const x = clampSize(point.x, -1e6, 1e6, null);
    const y = clampSize(point.y, -1e6, 1e6, null);
    if (x === null || y === null) return;
    placement = { ...placement, x: x - HELD_X, y: y - HELD_Y };
    // The whole rectangle, not just the corner: a window moved across displays
    // of different scale factors is rescaled by Windows on each step, so a
    // preview positioned move by move creeps larger the further it is dragged.
    ghost.setBounds(placement);
}

function hide() {
    generation++;
    placement = null;
    if (ghost && !ghost.isDestroyed()) ghost.hide();
}

// Called when the main window goes away. A hidden window still counts in
// BrowserWindow.getAllWindows(), so leaving this one alive would stop
// 'window-all-closed' from firing and the app would never quit.
function destroy() {
    generation++;
    placement = null;
    if (ghost && !ghost.isDestroyed()) ghost.destroy();
    ghost = null;
}

function register(ipcMain, ctx) {
    ipcMain.on('drag-ghost:show', (event, opts) => show(ctx, opts));
    ipcMain.on('drag-ghost:move', (event, point) => move(point));
    ipcMain.on('drag-ghost:hide', () => hide());
}

module.exports = { register, show, move, hide, destroy, documentFor, safeColor, safeShot, escapeHtml };
