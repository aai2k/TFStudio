/**
 * The preview that follows the cursor while a docked tool is dragged
 * (src/main/dragGhost.js, startDragPreview in DockingLayout.js).
 *
 * The preview used to be a `<div>` on document.body. An element cannot be
 * painted outside the window that owns it, so it was cut off at the frame edge,
 * which is where a tear-off is aimed: the user drags towards the desktop or a
 * second monitor and the thing they are aiming with vanishes at the border they
 * are trying to cross. In the app it is now a window of its own, carrying a
 * picture of the pane it came from.
 *
 * Run: node tests/drag_preview_window.mjs
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

const require = createRequire(import.meta.url);
const dragGhost = require('../src/main/dragGhost.js');

// ── Fakes for the two Electron objects it touches ────────────────────────────

const created = [];
class FakeWindow {
    constructor(options) {
        this.options = options;
        this.destroyed = false;
        this.visible = false;
        this.bounds = null;
        this.background = null;
        this.topmost = null;
        this.ignoresMouse = false;
        this.loaded = [];
        this.resolveLoad = null;
        created.push(this);
    }
    setAlwaysOnTop(flag, level) { this.topmost = { flag, level }; }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setBackgroundColor(value) { this.background = value; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    // Windows rescales a window as it crosses between displays of different
    // scale factors. Moving it corner-only leaves that rescale standing, so the
    // drift is modelled here: only a call that restates the size undoes it.
    setPosition(x, y) {
        this.bounds = {
            ...this.bounds, x, y,
            width: this.bounds.width + 8, height: this.bounds.height + 6,
        };
    }
    loadURL(url) {
        this.loaded.push(url);
        return new Promise(resolve => { this.resolveLoad = resolve; });
    }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.visible = false; this.onClosed?.(); }
    isDestroyed() { return this.destroyed; }
    on(event, cb) { if (event === 'closed') this.onClosed = cb; }
}

const SHOT = 'data:image/png;base64,iVBORw0KGgo=';
const captures = [];
const resizes = [];
const fakeImage = {
    isEmpty: () => false,
    resize: (opts) => { resizes.push(opts); return { toDataURL: () => SHOT }; },
};
const fakeMain = {
    isDestroyed: () => false,
    webContents: { capturePage: async (rect) => { captures.push(rect); return fakeImage; } },
};
const ctx = { BrowserWindow: FakeWindow, getMainWindow: () => fakeMain };

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const colors = { panel: '#252526', bg: '#1e1e1e', border: '#3a3a3a', accent: '#0a84ff', text: '#cccccc', textDim: '#9a9a9a' };
const pane = { x: 300, y: 100, width: 720, height: 520 };
const drag = extra => ({ x: 500, y: 400, width: 300, height: 200, title: 'Optical Evaluation', pane, ...colors, ...extra });

// ── It is a window, and one that cannot interfere with the drag ──────────────

dragGhost.show(ctx, drag());
assert.equal(created.length, 1, 'the preview is a window of its own');
const win = created[0];

assert.equal(win.options.focusable, false,
    'a focusable preview takes the mouse capture and ends the gesture that created it');
assert.equal(win.ignoresMouse, true, 'and it never swallows a click meant for the layout');
assert.equal(win.options.frame, false);
assert.equal(win.options.skipTaskbar, true, 'a preview is not a window the user switches to');
assert.equal(win.options.show, false, 'never shown before its document is in it');
assert.deepEqual(win.topmost, { flag: true, level: 'screen-saver' },
    'it has to sit above the app, and above a maximized window on the screen it moves to');

// ── Held where the window it stands for will open ────────────────────────────
//
// tearOff() opens the real window at (screenPoint.x - 38, screenPoint.y - 12).
// The preview uses the same offset, so the window lands where the preview was
// instead of jumping on drop.
assert.deepEqual(win.bounds, { x: 500 - 38, y: 400 - 12, width: 300, height: 200 });

// ── It carries the pane, not an empty box with a name on it ──────────────────

await flush();
assert.deepEqual(captures, [pane], 'the picture is of the pane being dragged');
assert.deepEqual(resizes, [{ width: 300, height: 200, quality: 'good' }],
    'scaled to the preview, so the document is not a megabyte of base64');
assert.equal(win.visible, false, 'and nothing is shown before the picture is in it');

const [documentUrl] = win.loaded;
assert.match(decodeURIComponent(documentUrl), /url\("data:image\/png;base64,/,
    'the capture is what the preview body is painted with');

win.resolveLoad();
await flush();
assert.equal(win.visible, true);

// ── Dragging it does not make it grow ────────────────────────────────────────
//
// Windows rescales a window that crosses between displays of different scale
// factors. Moved corner-only, the preview creeps larger the further it goes; the
// size has to be reasserted on every step.
dragGhost.move({ x: 900, y: 700 });
assert.deepEqual(win.bounds, { x: 900 - 38, y: 700 - 12, width: 300, height: 200 },
    'a move restates the whole rectangle, size included');

// A move mid-load is not lost to the placement the load finished with.
dragGhost.hide();
dragGhost.show(ctx, drag());
assert.equal(created.length, 1, 'the window is built once and reused: building one is visible at 60Hz');
dragGhost.move({ x: 640, y: 480 });
await flush();
win.resolveLoad();
await flush();
assert.deepEqual(win.bounds, { x: 640 - 38, y: 480 - 12, width: 300, height: 200 },
    'the preview finishes loading where the cursor is now, not where the drag started');

// ── A drag that ends first leaves nothing stranded ───────────────────────────

dragGhost.hide();
assert.equal(win.visible, false);

dragGhost.show(ctx, drag());
dragGhost.hide();                 // let go before the picture came back
await flush();
win.resolveLoad?.();
await flush();
assert.equal(win.visible, false,
    'an always-on-top preview shown after its drag ended would sit over everything');

// move() after the drag is over is ignored rather than resurrecting a position.
const restingBounds = { ...win.bounds };
dragGhost.move({ x: 10, y: 10 });
assert.deepEqual(win.bounds, restingBounds);

// ── Closing the app actually closes it ───────────────────────────────────────
//
// A hidden window still counts in BrowserWindow.getAllWindows(), so leaving the
// preview alive stops 'window-all-closed' from firing and the app never quits.
dragGhost.destroy();
assert.equal(win.destroyed, true, 'the preview is destroyed with the main window, not just hidden');

created.length = 0;
dragGhost.show(ctx, drag());
assert.equal(created.length, 1, 'and a drag after that builds a fresh one');
await flush();
dragGhost.destroy();

// ── A capture that fails costs the picture, not the drag ─────────────────────

created.length = 0;
const blind = { BrowserWindow: FakeWindow, getMainWindow: () => { throw new Error('gone'); } };
dragGhost.show(blind, drag());
await flush();
const blindWin = created[0];
assert.equal(blindWin.loaded.length, 1, 'the preview is still built and still shown');
assert.equal(decodeURIComponent(blindWin.loaded[0]).includes('url("data:image'), false);
blindWin.resolveLoad();
await flush();
assert.equal(blindWin.visible, true);
dragGhost.destroy();

// ── The document is built from untrusted-shaped input ────────────────────────

const escaped = dragGhost.documentFor({ ...colors, title: '<img src=x onerror=1>' });
assert.equal(escaped.includes('<img'), false, 'a window title is text, not markup');
assert.match(escaped, /&lt;img/);

// Colours and the picture are interpolated into a stylesheet, so anything not
// shaped like a hex colour or a base64 PNG falls back rather than being written
// into the document.
assert.equal(dragGhost.safeColor('#1e1e1e', '#000'), '#1e1e1e');
assert.equal(dragGhost.safeColor('#abc', '#000'), '#abc');
assert.equal(dragGhost.safeColor('red; } body { x:y', '#000'), '#000');
assert.equal(dragGhost.safeColor(undefined, '#000'), '#000');
assert.equal(dragGhost.documentFor({ ...colors, accent: 'url(evil)', title: 'x' }).includes('url(evil)'), false);
assert.equal(dragGhost.safeShot(SHOT), SHOT);
assert.equal(dragGhost.safeShot('data:image/svg+xml,<svg onload=1>'), null);
assert.equal(dragGhost.safeShot('data:image/png;base64,AAA"),url(evil'), null);

// ── The renderer sends it there instead of drawing it ────────────────────────

shimBrowserGlobals();
await loadApp();
const { startDragPreview, previewSize } =
    await import('../src/components/docking/DockingLayout.js');

const appended = [];
globalThis.document.body.appendChild = (node) => { appended.push(node); return node; };
globalThis.window.screenX = 120;
globalThis.window.screenY = 60;

const calls = [];
globalThis.window.electronAPI = {
    dragGhost: {
        show: (opts) => calls.push(['show', opts]),
        move: (point) => calls.push(['move', point]),
        hide: () => calls.push(['hide']),
    },
};

const c = makeTheme();
const sourceRect = { left: 300, top: 100, width: 720, height: 520 };
const preview = startDragPreview({ c, title: 'Design Editor', sourceRect, clientX: 40, clientY: 30 });
preview.move(300, 200);
preview.end();

assert.deepEqual(appended, [],
    'an element on document.body is clipped at the frame edge: that was the bug');
assert.deepEqual(calls.map(call => call[0]), ['show', 'move', 'hide']);

// The window is positioned on the desktop, so the cursor has to cross out of
// the viewport's own coordinates first.
assert.equal(calls[0][1].x, 120 + 40);
assert.equal(calls[0][1].y, 60 + 30);
assert.deepEqual(calls[1][1], { x: 120 + 300, y: 60 + 200 });

// The pane goes over as page coordinates, which is what capturePage reads.
assert.deepEqual(calls[0][1].pane, { x: 300, y: 100, width: 720, height: 520 });

// It is the size the preview has always been, so the drop is not a surprise.
const { width, height } = previewSize(sourceRect);
assert.equal(calls[0][1].width, width);
assert.equal(calls[0][1].height, height);
assert.equal(calls[0][1].title, 'Design Editor');
assert.equal(calls[0][1].panel, c.panel, 'and it is drawn in the running theme');

// ── The browser build still gets a preview ───────────────────────────────────
//
// There it has no windows to give it and no desktop to drop on, so the element
// is right and the viewport is the whole world anyway.
delete globalThis.window.electronAPI;
const fallback = startDragPreview({ c, title: 'Design Editor', sourceRect, clientX: 40, clientY: 30 });
assert.equal(appended.length, 1, 'without the bridge the preview is drawn in the page');
assert.equal(appended[0].style.left, '40px');
fallback.move(300, 200);
assert.equal(appended[0].style.left, '300px');
fallback.end();

console.log('drag_preview_window: passed');
