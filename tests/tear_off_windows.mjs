/**
 * Tearing a tool window out of the docking layout
 * (src/components/docking/PopoutWindow.js, FloatFrame.js, DockingLayout.js).
 *
 * A torn-off window is a real OS window but not a second renderer: it is a React
 * portal into a window this process opened, so the tool keeps the design and the
 * run state it already had. What that leaves worth asserting is the arithmetic
 * that crosses between the two windows (a drag in one has to resolve to a drop
 * zone in the other), the rule that keeps a restored window reachable when the
 * monitor it was on is gone, and the strip that gets it back into the layout.
 *
 * Run: node tests/tear_off_windows.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

const require = createRequire(import.meta.url);

shimBrowserGlobals();
await loadApp();

const { toScreenPoint, toClientPoint } = await import('../src/components/docking/PopoutWindow.js');
const { FloatFrame } = await import('../src/components/docking/FloatFrame.js');
const { clampToScreen, saveLayout, loadSavedLayout, previewSize, hasNativeWindows } =
    await import('../src/components/docking/DockingLayout.js');
const { makeGroup, addTab, removeTab, cleanup, splitGroup, newTabId } =
    await import('../src/components/docking/treeUtils.js');

const c = makeTheme();
const t = makeLocale('en');

// ── Point conversion between two windows ──────────────────────────────────────

// screenX/screenY are the viewport's own offset on the desktop, so a client
// point converts by adding it and comes back by subtracting it.
const fakeWin = (screenX, screenY, innerWidth, innerHeight) =>
    ({ screenX, screenY, innerWidth, innerHeight });

const main = fakeWin(0, 0, 1400, 900);
const float = fakeWin(1500, 200, 720, 520);

assert.deepEqual(toScreenPoint(float, 10, 20), { x: 1510, y: 220 });
assert.deepEqual(toScreenPoint(main, 10, 20), { x: 10, y: 20 });

// A point over the float is off the main window entirely.
assert.equal(toClientPoint(main, 1510, 220), null,
    'a point on the second monitor must not resolve inside the main window');

// Dragging the float's strip back across the main window resolves to a point
// inside it, which is what the zone hit test needs.
assert.deepEqual(toClientPoint(main, 640, 500), { x: 640, y: 500 });

// The two conversions are inverses.
const round = toClientPoint(main, ...Object.values(toScreenPoint(main, 333, 444)));
assert.deepEqual(round, { x: 333, y: 444 });

// Edges count as inside; a pixel past them does not. This is the same test the
// tear-off uses in reverse to decide a tab was dropped outside the frame.
assert.ok(toClientPoint(main, 0, 0), 'the top-left corner is inside');
assert.ok(toClientPoint(main, 1400, 900), 'the bottom-right corner is inside');
assert.equal(toClientPoint(main, -1, 400), null);
assert.equal(toClientPoint(main, 700, 901), null);

// A window sitting at a negative offset (a monitor left of the primary) still
// resolves, which is the case a naive clamp to zero would break.
const leftMonitor = fakeWin(-1920, 0, 1200, 800);
assert.deepEqual(toScreenPoint(leftMonitor, 100, 50), { x: -1820, y: 50 });
assert.deepEqual(toClientPoint(leftMonitor, -1820, 50), { x: 100, y: 50 });

// ── Keeping a restored window reachable ───────────────────────────────────────

const oneScreen = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 };

// A rectangle already on screen is left where it is.
assert.deepEqual(
    clampToScreen({ left: 200, top: 100, width: 800, height: 600 }, oneScreen),
    { left: 200, top: 100, width: 800, height: 600 });

// Saved on a second monitor that is no longer attached: the window would open
// where nobody can reach it, so it comes back onto the screen we have.
const stranded = clampToScreen({ left: 2600, top: 300, width: 800, height: 600 }, oneScreen);
assert.ok(stranded.left >= 0 && stranded.left + stranded.width <= 1920,
    `a window saved off-screen must be pulled back, got left=${stranded.left}`);
assert.ok(stranded.top >= 0 && stranded.top + stranded.height <= 1040);

// Same for a monitor that used to sit above or to the left.
const negative = clampToScreen({ left: -2000, top: -900, width: 800, height: 600 }, oneScreen);
assert.ok(negative.left >= 0 && negative.top >= 0);

// Hanging off the right edge far enough that the strip is unreachable.
const hanging = clampToScreen({ left: 1900, top: 1030, width: 800, height: 600 }, oneScreen);
assert.ok(hanging.left + hanging.width <= 1920 && hanging.top + hanging.height <= 1040);

// A window larger than the screen is cut down to it, never below the minimum.
const huge = clampToScreen({ left: 0, top: 0, width: 5000, height: 4000 }, oneScreen);
assert.deepEqual(huge, { left: 0, top: 0, width: 1920, height: 1040 });
const tiny = clampToScreen({ left: 10, top: 10, width: 10, height: 10 }, oneScreen);
assert.equal(tiny.width, 320);
assert.equal(tiny.height, 240);

// Nothing saved at all still yields a usable rectangle.
const blank = clampToScreen(undefined, oneScreen);
assert.ok(blank.width >= 320 && blank.height >= 240);
assert.ok(Number.isFinite(blank.left) && Number.isFinite(blank.top));

// A screen object the browser did not fill in must not produce NaN.
const noInfo = clampToScreen({ left: 100, top: 100, width: 800, height: 600 }, null);
assert.ok(Object.values(noInfo).every(Number.isFinite));

// ── Layout persistence ────────────────────────────────────────────────────────

localStorage.clear();
const docked = makeGroup([{ id: 'ta', title: 'Design Editor', toolId: 'design-editor' }]);
saveLayout(docked, [
    { id: 'tb', toolId: 'optical-eval', title: 'Optical Evaluation',
      bounds: { left: 300, top: 150, width: 900, height: 640 } },
]);

const restored = loadSavedLayout();
assert.equal(restored.tree.type, 'tabs');
assert.equal(restored.tree.tabs[0].toolId, 'design-editor');
assert.equal(restored.floats.length, 1);
assert.equal(restored.floats[0].toolId, 'optical-eval');
assert.equal(restored.floats[0].title, 'Optical Evaluation');
assert.ok(restored.floats[0].id, 'a restored float needs an id of its own');
assert.notEqual(restored.floats[0].id, 'tb', 'ids are re-keyed so they cannot collide');

// A layout saved before tear-off existed is a bare tree, and still loads.
localStorage.setItem('tfstudio-saved-layout', JSON.stringify(docked));
const legacy = loadSavedLayout();
assert.equal(legacy.tree.type, 'tabs');
assert.deepEqual(legacy.floats, [], 'an old layout has no floats, not undefined');

localStorage.clear();
assert.equal(loadSavedLayout(), null, 'nothing saved means nothing to restore');

localStorage.setItem('tfstudio-saved-layout', '{ not json');
assert.equal(loadSavedLayout(), null, 'a corrupt layout must not throw on startup');
localStorage.clear();

// ── The tree operations a tear-off and a redock perform ───────────────────────

// Tearing the second tab off a two-tab group leaves the first behind.
let tree = makeGroup([
    { id: 't1', title: 'Design Editor', toolId: 'design-editor' },
    { id: 't2', title: 'Optical Evaluation', toolId: 'optical-eval' },
]);
const [detached, torn] = removeTab(tree, 't2');
tree = cleanup(detached);
assert.equal(torn.toolId, 'optical-eval');
assert.equal(tree.tabs.length, 1);
assert.equal(tree.tabs[0].toolId, 'design-editor');

// Tearing off the only tab empties the layout rather than leaving a dead group.
const [emptied] = removeTab(tree, 't1');
assert.equal(cleanup(emptied), null);

// Docking it back on an edge splits the group it was dropped on.
const back = { id: newTabId(), title: 'Optical Evaluation', toolId: 'optical-eval' };
const split = splitGroup(tree, tree.id, 'h', 'end', back);
assert.equal(split.type, 'split');
assert.equal(split.direction, 'h');
assert.equal(split.children.length, 2);
assert.equal(split.children[1].tabs[0].toolId, 'optical-eval');

// Docking it into the centre joins the group instead, and selects it.
const joined = addTab(tree, tree.id, back);
assert.equal(joined.tabs.length, 2);
assert.equal(joined.activeTab, 1);

// ── The float's own strip ─────────────────────────────────────────────────────

const frame = renderToStaticMarkup(React.createElement(FloatFrame, {
    c, t, locale: 'en',
    toolId: 'optical-eval',
    title: 'Optical Evaluation',
    helpAnchor: 'analysis/optical-evaluation',
    onDock: () => {}, onClose: () => {},
}, React.createElement('div', null, 'tool body')));

assert.ok(frame.includes('Optical Evaluation'), 'the strip names the tool');
assert.ok(frame.includes('tool body'), 'the tool renders inside the frame');
assert.ok(frame.includes(t.docking.dock), 'the strip offers a way back into the layout');
assert.ok(frame.includes(t.docking.close), 'the strip offers a close button');
assert.ok(frame.includes(t.docking.dragToDock), 'the strip says the drag docks it');
assert.ok(frame.includes('data-tutorial-tool="optical-eval"'),
    'the tutorial coach anchors on a floated tool the same way it does on a docked one');

// The name is not drawn as a tab. There is one tool in the window and nothing to
// switch to, so a tab here only makes the window look like the layout it left.
assert.equal(frame.includes('cursor:grab'), false, 'the title is a title, not a handle');
assert.equal(/border-bottom:2px solid/.test(frame), false,
    'and carries no active-tab underline');

// The window is frameless, so this strip is its title bar: it carries the window
// buttons, and dragging it moves the window the way a title bar does.
assert.ok(frame.includes(t.docking.minimize), 'the strip has a minimize button');
assert.ok(frame.includes(t.docking.maximize), 'the strip has a maximize button');

// ── The float moves itself, rather than being moved by the OS ─────────────────
//
// Handing the strip to the OS with `-webkit-app-region: drag` costs the drag its
// mouse events: no document sees them, so the layout underneath cannot light its
// drop targets as the window passes over it. The compass never appeared and the
// only way back was the dock button. The app carries the move instead, wherever
// the platform lets it place a window at all. The Wayland section below covers
// the one place that trade is forced the other way.

// The buttons on the strip mark themselves `no-drag` in either mode, which does
// nothing unless something is a drag region; what matters is the strip itself.
const marksDragRegion = (html) =>
    html.replace(/-webkit-app-region:no-drag/g, '').includes('-webkit-app-region:drag');

assert.equal(marksDragRegion(frame), false,
    'an OS-driven window move cannot tell the layout where the cursor is');

const appWindowIpc = require('../src/main/ipc/appWindow.js');

const channels = new Map();
const moves = [];
// The size a window reports is a rounding of its physical size, and setting it
// back rounds again; on a display that is not at 100% scale the two do not
// cancel, so every measurement can cost a pixel. Modelled here as a window
// whose size reads one larger than what was last set. SetWindowPos also
// delivers the resize event synchronously from inside setBounds, and the model
// does too: a handler that re-measures on that event is a feedback loop that
// grows the window on every single step, which is the bug as shipped twice.
const scaled = () => ({
    isDestroyed: () => false,
    bounds: { x: 0, y: 0, width: 720, height: 520 },
    reads: 0,
    listeners: {},
    on(event, cb) { this.listeners[event] = cb; },
    getBounds() {
        this.reads++;
        return { ...this.bounds, width: this.bounds.width + 1, height: this.bounds.height + 1 };
    },
    setBounds(next) {
        const resized = next.width !== this.bounds.width || next.height !== this.bounds.height;
        this.bounds = { ...next };
        moves.push({ ...next });
        if (resized) this.listeners.resize?.();
    },
    setPosition(x, y) {
        const b = this.getBounds();
        this.setBounds({ ...b, x, y });
    },
});
const floatWindow = scaled();
const theMainWindow = scaled();

appWindowIpc.register(
    { on: (channel, cb) => channels.set(channel, cb), handle: (channel, cb) => channels.set(channel, cb) },
    { BrowserWindow: { fromWebContents: (sender) => sender }, getMainWindow: () => theMainWindow },
);

const move = channels.get('window-move');
assert.ok(move, 'the renderer has somewhere to send the move');

// One drag: measured once, then the same size on every step. The first set
// echoes a resize event from inside setBounds; re-measuring on it is the
// feedback loop, one pixel per step.
move({ sender: floatWindow }, { x: 300.4, y: 120.6 });
move({ sender: floatWindow }, { x: 340, y: 160 });
move({ sender: floatWindow }, { x: 380, y: 200 });
assert.deepEqual(moves, [
    { x: 300, y: 121, width: 721, height: 521 },
    { x: 340, y: 160, width: 721, height: 521 },
    { x: 380, y: 200, width: 721, height: 521 },
], 'the window moves, rounded, at one unchanging size');
move({ sender: floatWindow }, { end: true });

// A second grab must not measure again: on a scaled display each measurement
// grows the window by a pixel, which is the same bug at one pixel per click.
moves.length = 0;
move({ sender: floatWindow }, { x: 400, y: 200 });
move({ sender: floatWindow }, { end: true });
assert.deepEqual(moves, [{ x: 400, y: 200, width: 721, height: 521 }],
    'a new grab reuses the size instead of measuring the window again');
assert.equal(floatWindow.reads, 1,
    'the size is measured once in the window\'s life, not once per grab');

// A resize outside a drag is the user's, and is the one thing that refreshes it.
floatWindow.bounds = { ...floatWindow.bounds, width: 900, height: 600 };
floatWindow.listeners.resize();
moves.length = 0;
move({ sender: floatWindow }, { x: 10, y: 20 });
move({ sender: floatWindow }, { end: true });
assert.deepEqual(moves, [{ x: 10, y: 20, width: 901, height: 601 }],
    'a window the user resized keeps its new size on the next drag');

// Everything else is refused rather than throwing a window off the screen.
moves.length = 0;
move({ sender: theMainWindow }, { x: 10, y: 10 });
move({ sender: floatWindow }, { x: NaN, y: 10 });
move({ sender: floatWindow }, { x: 10, y: undefined });
move({ sender: null }, { x: 10, y: 10 });
move({ sender: floatWindow }, null);
assert.deepEqual(moves, [], 'and nothing else moved anything');

// ── The held size covers the same pixels wherever the window stands ───────────
//
// Windows lays a DIP rectangle onto pixels by rounding its origin and enclosing
// its far edge, so the pixel width is ceil((x + w) * s) - floor(x * s) and
// changes with x for most widths. Modelled here at 125%, the scale Electron
// reported on the machine this was seen on: 802 DIP is 1003 pixels at one
// position and 1004 a step over, and every flip re-lays out the window's
// content, so its controls twitch while it is dragged. 801 DIP is 1002 pixels
// everywhere. The reverse conversion rounds the same way, so a size read back
// is one or two DIP larger than what was set.

const scale = 1.25;
const enclose = (r, s) => ({
    x: Math.round(r.x * s), y: Math.round(r.y * s),
    width: Math.ceil((r.x + r.width) * s) - Math.floor(r.x * s),
    height: Math.ceil((r.y + r.height) * s) - Math.floor(r.y * s),
});
const dipToScreenRect = (_win, dip) => enclose(dip, scale);
const screenToDipRect = (px) => enclose(px, 1 / scale);

// The old rule, holding whatever DIP width was measured, is not steady.
const measuredWidths = new Set([300, 301, 302, 303].map(x =>
    dipToScreenRect(null, { x, y: 0, width: 802, height: 1 }).width));
assert.deepEqual([...measuredWidths].sort(), [1003, 1004],
    'the same DIP width covers a different number of pixels at different positions');

// A window as the OS holds it: a pixel rectangle, reported back in DIP.
const scaledWindow = (pixels) => ({
    pixels,
    resizes: 0,
    listeners: {},
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    getMinimumSize: () => [320, 240],
    on(event, cb) { this.listeners[event] = cb; },
    getBounds() { return screenToDipRect(this.pixels); },
    setBounds(dip) {
        const next = dipToScreenRect(this, dip);
        const resized = next.width !== this.pixels.width || next.height !== this.pixels.height;
        this.pixels = next;
        if (resized) { this.resizes++; this.listeners.resize?.(); }
    },
    setSize(width, height) { this.setBounds({ ...this.getBounds(), width, height }); },
});

const steadyChannels = new Map();
appWindowIpc.register(
    { on: (channel, cb) => steadyChannels.set(channel, cb), handle: () => {} },
    {
        BrowserWindow: { fromWebContents: (sender) => sender },
        getMainWindow: () => theMainWindow,
        screen: { dipToScreenRect },
    },
);
const steadyMove = steadyChannels.get('window-move');

// Opened 1003 by 753 pixels, which no DIP size holds steadily. The first move
// may settle it; after that the window covers the same pixels at every step.
const wobbly = scaledWindow({ x: 125, y: 125, width: 1003, height: 753 });
const sizesSeen = [];
for (let step = 0; step < 12; step++) {
    steadyMove({ sender: wobbly }, { x: 300 + step, y: 200 + step });
    sizesSeen.push(`${wobbly.pixels.width}x${wobbly.pixels.height}`);
}
steadyMove({ sender: wobbly }, { end: true });
assert.equal(new Set(sizesSeen).size, 1,
    `the window keeps one pixel size through the drag, saw ${[...new Set(sizesSeen)].join(', ')}`);
assert.equal(sizesSeen[0], '1002x752',
    'the size held is the nearest steady one, a pixel or two under what was measured');
assert.equal(wobbly.resizes, 1, 'the one resize is the settling on the first move');

// A window settled when it is created never resizes during a drag at all.
const fresh = scaledWindow({ x: 500, y: 300, width: 1003, height: 753 });
appWindowIpc.settleWindowSize({ screen: { dipToScreenRect } }, fresh);
assert.equal(`${fresh.pixels.width}x${fresh.pixels.height}`, '1002x752',
    'settling snaps a new window to a steady size');
fresh.resizes = 0;
for (let step = 0; step < 8; step++) steadyMove({ sender: fresh }, { x: 600 + step, y: 400 + step });
steadyMove({ sender: fresh }, { end: true });
assert.equal(fresh.resizes, 0, 'and its drag begins and ends at that size');

// The user resizes the window by its frame to a size that is not steady. When
// they let go it is snapped to the nearest steady size, and the next drag holds
// that one without a further change.
fresh.pixels = { ...fresh.pixels, width: 1250, height: 900 };
fresh.listeners.resize();
fresh.resizes = 0;
fresh.listeners.resized();
assert.equal(fresh.resizes, 1, 'letting go of the frame settles the size once');
const afterResize = `${fresh.pixels.width}x${fresh.pixels.height}`;
assert.notEqual(afterResize, '1002x752', 'to the size the user chose, not the old one');
fresh.resizes = 0;
for (let step = 0; step < 8; step++) steadyMove({ sender: fresh }, { x: 100 + step, y: 100 + step });
steadyMove({ sender: fresh }, { end: true });
assert.equal(fresh.resizes, 0, 'and the next drag never resizes it');
assert.equal(`${fresh.pixels.width}x${fresh.pixels.height}`, afterResize);

// ── The browser build does not tear off ───────────────────────────────────────
//
// There is no OS window to give the tool there: window.open makes a popup the
// blocker may eat, and the tab has already left the tree, so the tool would
// vanish with it. A drop on nothing in the browser leaves the tab where it was.
const layoutSource = readFileSync(
    new URL('../src/components/docking/DockingLayout.js', import.meta.url), 'utf8');
assert.match(layoutSource, /if \(hasNativeWindows\(\)\) \{\s*\r?\n\s*tearOff\(/,
    'tearing off is gated on the host that makes it possible');

// The gate has to name the capability, not the bridge. The browser demo's shim
// exists to impersonate window.electronAPI, so the bridge being present says
// nothing about whether a tool can be given a window: gating on that let a drop
// on nothing in the demo open a popup, portal into it, and take the page down.
assert.equal(hasNativeWindows(), true, 'the desktop bridge declares its windows');

const desktopApi = window.electronAPI;
window.electronAPI = { getAppVersion: () => Promise.resolve('web-demo') };
assert.equal(hasNativeWindows(), false,
    'a stand-in bridge with no window to give is not the desktop app');

// A layout carrying a torn-off tool can still reach such a host. Every tool in
// it comes back, docked, rather than as a window the host cannot open.
localStorage.clear();
saveLayout(docked, [
    { id: 'tb', toolId: 'optical-eval', title: 'Optical Evaluation',
      bounds: { left: 300, top: 150, width: 900, height: 640 } },
]);
const inBrowser = loadSavedLayout();
assert.deepEqual(inBrowser.floats, [], 'a host without windows restores no floats');
assert.deepEqual(
    inBrowser.tree.tabs.map(tab => tab.toolId), ['design-editor', 'optical-eval'],
    'and the tool that was torn off is docked instead of lost');

window.electronAPI = desktopApi;
localStorage.clear();

for (const code of ['en', 'ru', 'zh']) {
    const tl = makeLocale(code);
    for (const key of ['dock', 'close', 'dragToDock', 'dropHere', 'minimize', 'maximize']) {
        assert.ok(tl.docking[key], `${code}: docking.${key} is missing`);
    }
}

// ── An empty workspace is still somewhere to drop ─────────────────────────────
//
// Tearing the last docked window out leaves no tree. The workspace then drew
// nothing at all: no pane, so no tab group, so no compass, and the window could
// only be brought back from its dock button.

const { EmptyDropTarget } = await import('../src/components/docking/DockingLayout.js');
const emptyTarget = renderToStaticMarkup(React.createElement(EmptyDropTarget, { c, t, lit: false }));
assert.ok(emptyTarget.includes('data-dockzone="center"'),
    'the drop hit test reads data-dockzone, so an area without one can never be dropped on');
assert.ok(emptyTarget.includes(t.docking.dropHere), 'and it says what it is');

// The target is one centred button, not the whole area. Covering the workspace
// meant a float could not be left hovering over the empty window: anywhere the
// user let go of it docked it.
assert.ok(emptyTarget.includes('pointer-events:none'),
    'the area around the button is not part of the target');
assert.ok(emptyTarget.includes('width:48px'),
    'the target is a button, sized like the compass, not the workspace');
const zones = emptyTarget.split('data-dockzone').length - 1;
assert.equal(zones, 1, 'exactly one drop zone');
assert.equal(emptyTarget.includes('inset:12px'), false,
    'nothing target-like spans the area while the button is not hovered');
const litTarget = renderToStaticMarkup(React.createElement(EmptyDropTarget, { c, t, lit: true }));
assert.ok(litTarget.includes('inset:12px'),
    'hovering the button shades where the tool will land, like a compass preview');

assert.equal(/!tree && floats\.length === 0/.test(layoutSource), false,
    'the workspace shows whenever nothing is docked, tools floating or not');
assert.match(layoutSource, /!tree && dragActive && h\(EmptyDropTarget/,
    'and offers somewhere to drop while a window is dragged over it');

// ── A floated tool resizes with its window ────────────────────────────────────
//
// The portal renders into the float's document while the code observing the
// element still runs in the main window. A ResizeObserver only reports elements
// belonging to its own document, so the global constructor never fires for a
// floated element: the chart keeps the size the window opened at and spills out
// of the frame the moment the user resizes it.

const { observeResize } = await import('../src/components/ui/observeResize.js');

const built = [];
class FakeObserver {
    constructor(realm) { this.realm = realm; this.observed = []; built.push(this); }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
}
const mainRealm = class extends FakeObserver { constructor() { super('main'); } };
const floatRealm = class extends FakeObserver { constructor() { super('float'); } };

const previousObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = mainRealm;

const floated = { ownerDocument: { defaultView: { ResizeObserver: floatRealm } } };
const observer = observeResize(floated, () => {});
assert.equal(observer.realm, 'float',
    "an observer from the main window's realm never reports an element in another document");
assert.deepEqual(observer.observed, [floated], 'and it is actually observing it');

// A docked element still uses the one realm there is.
const inLayout = { ownerDocument: { defaultView: { ResizeObserver: mainRealm } } };
assert.equal(observeResize(inLayout, () => {}).realm, 'main');

// A detached element has no view to ask; the global is the only thing left.
assert.equal(observeResize({ ownerDocument: null }, () => {}).realm, 'main');
assert.equal(observeResize(null, () => {}), null, 'and no element is not a crash');

globalThis.ResizeObserver = previousObserver;

// ── And its readout is drawn in its own window ────────────────────────────────
//
// A tooltip has to leave the chart container or the container clips it. Sent to
// "the body", which is resolved from the global, a floated chart's readout is
// built in the main window and drawn behind the float that asked for it.

const { axisTooltip, itemTooltip, tooltipContainer } =
    await import('../src/components/ui/chartOptions.js');

const floatBody = { name: 'the float document body' };
const chartInFloat = { ownerDocument: { body: floatBody } };

assert.equal(tooltipContainer(chartInFloat), floatBody);
for (const [name, tip] of [['axis', axisTooltip()], ['item', itemTooltip()]]) {
    assert.equal(tip.appendToBody, undefined,
        `${name}: appendToBody resolves the global document, which is the main window's`);
    assert.equal(tip.appendTo(chartInFloat), floatBody,
        `${name}: the readout belongs to the document its chart is in`);
}

// ── The drag preview is window-shaped ─────────────────────────────────────────

// It keeps the pane's proportions, so what is under the cursor looks like the
// window being dragged rather than a name chip.
const wide = previewSize({ width: 1200, height: 600 });
assert.ok(Math.abs(wide.width / wide.height - 2) < 0.01, 'the preview keeps the pane aspect');
assert.ok(wide.width <= 340 && wide.height <= 250, 'and stays small enough to see past');

const tall = previewSize({ width: 400, height: 900 });
assert.ok(tall.height <= 250);
assert.ok(tall.width >= 200, 'never so narrow it stops reading as a window');

// A pane smaller than the cap is not blown up.
const small = previewSize({ width: 260, height: 180 });
assert.deepEqual(small, { width: 260, height: 180 });

// No pane to measure (a tab dragged before layout settles) still gives a size.
const fallback = previewSize(undefined);
assert.ok(fallback.width >= 200 && fallback.height >= 130);

// ── The float follows the pointer, not its own reported position ──────────────
//
// The window is moved by the drag itself. The position it reports lags those
// moves by a frame or more and skips some, while the pointer inside it is
// already measured from where the window really is. Adding the two lands a
// step behind on every move after the first, so the window jumps back and the
// drag shakes. The pointer's desktop position is read off the event instead.

const { dragOrigin } = await import('../src/components/docking/FloatFrame.js');

// Grabbed 40px in from the left edge of a window at x=100.
const grab = { x: 40, y: 12 };
let windowAt = 100;    // where the window really is
let reportedAt = 100;  // what it reports, one move behind once the drag starts
const expected = [];
const fromEvent = [];
const fromReported = [];
for (const pointerAt of [180, 230, 260]) {
    // The OS stamps the event with the pointer's desktop position and with its
    // position inside the window as the window really stands.
    const event = { screenX: pointerAt, screenY: 112, clientX: pointerAt - windowAt, clientY: 12 };
    expected.push(pointerAt - grab.x);
    fromEvent.push(dragOrigin(grab, event).x);
    fromReported.push(reportedAt + event.clientX - grab.x);
    reportedAt = windowAt;
    windowAt = dragOrigin(grab, event).x;
}
assert.deepEqual(fromEvent, expected, 'the grab point stays under the pointer on every move');
assert.deepEqual(fromReported, [140, 150, 170],
    'summing the reported position with the pointer inside falls further behind each move');
assert.equal(dragOrigin(grab, { screenX: 180, screenY: 112 }).y, 100, 'and the same holds vertically');

const frameSource = readFileSync(
    new URL('../src/components/docking/FloatFrame.js', import.meta.url), 'utf8');
assert.equal(/win\.screen[XY]/.test(frameSource), false,
    'the strip never asks the window where it is in the middle of moving it');

// ── Where the app may not place its own windows ───────────────────────────────
//
// Wayland has no request for a client to position its own toplevel. The move is
// accepted and remembered: setBounds returns cleanly, getBounds hands the asked
// origin back, and the renderer's screenX/screenY, derived from that same
// remembered origin, track it exactly. Every number above stays correct and the
// window does not move, so nothing measured against a fake window can catch it.
// What is worth asserting is the decision made from that, and the strip built on
// it: the compositor is asked to do the moving instead.

const { canPlaceOwnWindows, usesWayland } =
    require('../src/main/windowPlacement.js');

// Only Linux can take the ability away.
assert.equal(canPlaceOwnWindows({ platform: 'win32', env: {}, argv: [] }), true);
assert.equal(canPlaceOwnWindows({ platform: 'darwin', env: {}, argv: [] }), true);
assert.equal(
    canPlaceOwnWindows({ platform: 'win32', env: { WAYLAND_DISPLAY: 'wayland-0' }, argv: [] }), true,
    'a stray Wayland variable does not disarm a platform that has no Wayland');

// A Linux session that offers Wayland is taken as Wayland, by either signal.
assert.equal(usesWayland({ WAYLAND_DISPLAY: 'wayland-0' }, []), true);
assert.equal(usesWayland({ XDG_SESSION_TYPE: 'wayland' }, []), true,
    'the socket variable can be unset and libwayland will still find wayland-0');
assert.equal(usesWayland({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, []), false);
assert.equal(usesWayland({}, []), false);

// An explicit backend settles it either way, over any session.
assert.equal(usesWayland({ WAYLAND_DISPLAY: 'wayland-0' }, ['--ozone-platform=x11']), false,
    'the X11 backend places its own windows, whatever session it runs on');
assert.equal(usesWayland({}, ['--ozone-platform=wayland']), true);
assert.equal(usesWayland({ WAYLAND_DISPLAY: 'wayland-0' }, ['--ozone-platform-hint=x11']), false);
assert.equal(usesWayland({ WAYLAND_DISPLAY: 'wayland-0' }, ['--ozone-platform-hint=auto']), true);
// Chromium takes the last of a repeated switch, so this reading has to as well.
assert.equal(usesWayland({}, ['--ozone-platform=wayland', '--ozone-platform=x11']), false);

// The guess leans towards Wayland where the session is unclear: reading X11 as
// Wayland costs dragging a window home, which the Dock button also does, while
// reading Wayland as X11 brings back a window that cannot be moved at all.
assert.equal(canPlaceOwnWindows(
    { platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, argv: [] }), false);

// The strip the decision builds. Rendered with the bridge reporting each answer.
const renderStrip = (bridge) => {
    const had = Object.prototype.hasOwnProperty.call(globalThis.window, 'electronAPI');
    const before = globalThis.window.electronAPI;
    globalThis.window.electronAPI = bridge;
    try {
        return renderToStaticMarkup(React.createElement(FloatFrame, {
            c, t, locale: 'en',
            toolId: 'optical-eval',
            title: 'Optical Evaluation',
            onDock: () => {}, onClose: () => {},
        }, React.createElement('div', null, 'tool body')));
    } finally {
        if (had) globalThis.window.electronAPI = before;
        else delete globalThis.window.electronAPI;
    }
};

const compositorDrags = renderStrip({ nativeWindowDrag: true });
assert.equal(marksDragRegion(compositorDrags), true,
    'the strip asks the compositor to move a window the app cannot place itself');
assert.ok(compositorDrags.includes(t.docking.dragToMove),
    'and says the drag moves the window rather than docking it');
assert.equal(compositorDrags.includes(t.docking.dragToDock), false,
    'it never offers a gesture that cannot reach a drop target');
assert.match(compositorDrags, /-webkit-app-region:no-drag/,
    'the buttons on the strip opt out, or the compositor swallows the click');

const appDrags = renderStrip({ nativeWindowDrag: false });
assert.equal(marksDragRegion(appDrags), false,
    'where the app can place its own windows the strip stays an ordinary handle');
assert.ok(appDrags.includes(t.docking.dragToDock),
    'and goes on offering the drag that docks it');

// A host with no bridge at all, the browser demo, keeps the app-driven path.
assert.ok(renderStrip(undefined).includes(t.docking.dragToDock));

// A window the app cannot place is one it cannot walk across the desktop, so the
// tear-off preview is withheld rather than left standing still through a drag;
// startDragPreview then falls back to an element that does follow the cursor.
const preloadSource = readFileSync(
    new URL('../src/preload.js', import.meta.url), 'utf8');
assert.match(preloadSource, /dragGhost: nativeWindowDrag \? null :/,
    'the drag preview window is withheld where it could not be moved');

const layoutPreview = readFileSync(
    new URL('../src/components/docking/DockingLayout.js', import.meta.url), 'utf8');
assert.match(layoutPreview, /const bridge = [^;]*electronAPI\.dragGhost/,
    'and startDragPreview takes the absence as its cue to draw an element instead');

// ── A divider in a float is dragged in the float's own document ───────────────
//
// The Monitor Worksheet splits its table from its plot with the docking
// divider. Listening on this module's `document` for the drag meant that in a
// torn-off window the divider never moved, and the listeners stayed mounted on
// the main window with the resize cursor stuck on it: the next mouse move over
// the main window resized the float's panes from there.

const splitSource = readFileSync(
    new URL('../src/components/docking/SplitPane.js', import.meta.url), 'utf8');
assert.equal(/\bdocument\./.test(splitSource), false,
    'the divider drag never touches the global document');
assert.match(splitSource, /ownerDocument/, 'it listens on the document the divider is in');

// ── A plot in a float hears the release in its own window ─────────────────────
//
// zrender follows a drag that leaves the chart, a scrollbar handle pulled past
// the plot's edge or a zoom box drawn out of it, through listeners it mounts
// on the global document, which is the main window's. A floated plot then
// never hears the release, and the handle keeps following the pointer whenever
// it comes back over the plot.

const { drawChart } = await import('../src/components/ui/plotSurface.js');

const mainDocument = { name: 'main document' };
const floatDocument = { name: 'float document' };
const previousRuntime = globalThis.echarts;
const releaseScopes = [];
globalThis.echarts = {
    getInstanceByDom: () => null,
    init: () => {
        const scope = { domTarget: mainDocument, mounted: {} };
        releaseScopes.push(scope);
        return {
            setOption() {}, on() {}, isDisposed: () => false,
            getZr: () => ({ on() {}, handler: { proxy: { _globalHandlerScope: scope } } }),
        };
    },
};
const chartElement = (doc) => ({ ownerDocument: doc, clientWidth: 400, clientHeight: 300 });
const chartOption = { grid: { left: 10, right: 10, top: 10, bottom: 10 }, series: [] };

drawChart(chartElement(floatDocument), { current: null }, chartOption);
assert.equal(releaseScopes[0].domTarget, floatDocument,
    'a floated chart tracks the release in its own document');
drawChart(chartElement(mainDocument), { current: null }, chartOption);
assert.equal(releaseScopes[1].domTarget, mainDocument,
    'a docked chart stays on the document it always used');

globalThis.echarts = previousRuntime;

// ── An overlay is placed against the window it opens in ───────────────────────
//
// A picker measures its trigger in its own window's client coordinates and then
// hangs the list off it with `position: fixed`, which in a torn-off window is
// that window's viewport. Deciding where the list fits from the main window's
// height told it there was room below that the small window it sits in does not
// have, so the list ran past the bottom edge and the document clipped it.

const picker = await import('../src/components/ui/PickerDropdown.js');
const { ownerWindow, dismissDocuments, listenForDismiss } =
    await import('../src/components/ui/ownerWindow.js');

// The media pickers sit at the foot of the Design Editor settings section.
const mediaTrigger = { top: 448, bottom: 470, left: 60, width: 120 };
const floatView = { innerWidth: 720, innerHeight: 520 };

const placedInFloat = picker.dropPositionFrom(mediaTrigger, 260, floatView);
assert.equal(placedInFloat.top, null, 'a list with no room below it in its own window opens upward');
assert.equal(placedInFloat.bottom, floatView.innerHeight - mediaTrigger.top + 2,
    'and is pinned to the top of its trigger');
assert.ok(placedInFloat.maxH <= mediaTrigger.top - 4, 'never taller than the room it has');

// The same trigger measured against the main window is told the whole list fits
// below it, which is what put the list under the foot of the float.
const placedAgainstMain = picker.dropPositionFrom(mediaTrigger, 260, { innerWidth: 1400, innerHeight: 1040 });
assert.equal(placedAgainstMain.top, mediaTrigger.bottom + 2, 'the main window really does have the room');
assert.ok(placedAgainstMain.top + placedAgainstMain.maxH > floatView.innerHeight,
    'so the list it places runs past the bottom edge of a torn-off window');

// A window narrower than the list keeps it on screen instead of off the left edge.
assert.equal(picker.dropPositionFrom({ top: 40, bottom: 62, left: 60, width: 120 }, 260,
    { innerWidth: 200, innerHeight: 520 }).left, 4,
    'a list wider than the window it is in starts at the edge of that window');

// The window an overlay belongs to is the one its trigger is rendered in.
assert.equal(ownerWindow({ ownerDocument: { defaultView: floatView } }), floatView);
assert.equal(ownerWindow({ ownerDocument: null }), window, 'a detached trigger has only the global');
assert.equal(ownerWindow(null), window);

const pickerSource = readFileSync(
    new URL('../src/components/ui/PickerDropdown.js', import.meta.url), 'utf8');
assert.equal(/window\.inner(Width|Height)/.test(pickerSource), false,
    'the picker never measures the main window to place a list drawn in another one');
assert.match(pickerSource, /dropPositionFrom\(trigger\.getBoundingClientRect\(\), minDropWidth, ownerWindow\(trigger\)\)/,
    'it measures the window its trigger is in');

const savedMfSource = readFileSync(new URL(
    '../src/components/windows/optimization/meritFunctionEditor/SavedMfMenu.js', import.meta.url), 'utf8');
assert.match(savedMfSource, /ownerWindow\(trigger\)/,
    'and so does the saved merit-function list, which opens off a bar at the window foot');

// ── A picker in a float hears the clicks that should close it ─────────────────
//
// A mousedown in a torn-off window never reaches the main document: the two
// share no event path. Listening there alone left every list opened in a float
// standing open, so opening the substrate material list on top of the incident
// one left both on screen.

assert.deepEqual(dismissDocuments({ ownerDocument: document }), [document],
    'a docked picker listens on the one document there is');
const pickerDoc = { defaultView: floatView };
assert.deepEqual(dismissDocuments({ ownerDocument: pickerDoc }), [pickerDoc, document],
    'a floated picker listens in its own window, and in the main one so a click there closes it too');
assert.deepEqual(dismissDocuments(null), [document], 'and an unmounted overlay is not a crash');

assert.equal(/\bdocument\.(add|remove)EventListener/.test(pickerSource), false,
    'the picker never mounts its dismissal on the global document');
assert.match(pickerSource, /listenForDismiss\(triggerRef\.current/,
    'it mounts on the documents its own trigger belongs to');

// The listeners really do go on both, and come off both again.
const listenerLog = [];
const recordingDoc = (name) => ({
    defaultView: floatView,
    addEventListener: (type) => listenerLog.push('+' + name + ':' + type),
    removeEventListener: (type) => listenerLog.push('-' + name + ':' + type),
});
document.addEventListener = (type) => listenerLog.push('+main:' + type);
document.removeEventListener = (type) => listenerLog.push('-main:' + type);
const stopListening = listenForDismiss({ ownerDocument: recordingDoc('float') },
    { mousedown: () => {}, keydown: () => {} });
assert.deepEqual(listenerLog,
    ['+float:mousedown', '+float:keydown', '+main:mousedown', '+main:keydown'],
    'a floated overlay watches its own window for the click that should close it');
listenerLog.length = 0;
stopListening();
assert.deepEqual(listenerLog,
    ['-float:mousedown', '-float:keydown', '-main:mousedown', '-main:keydown'],
    'and leaves nothing mounted on either window behind it');

const catalogMenuSource = readFileSync(new URL(
    '../src/components/windows/design/materialEditor/catalogMenu.js', import.meta.url), 'utf8');
assert.equal(/\bdocument\.(add|remove)EventListener/.test(catalogMenuSource), false,
    'nor does the Material Editor catalog menu');

// ── A menu drawn from the stylesheet wears the theme in a float ───────────────
//
// The palette reaches the stylesheets as `--tf-*` properties set on the main
// document's root element, so cloning the stylesheets into a float brought the
// rules that read them and none of the values. Every class-styled control in a
// float then drew from the dark fallbacks the rules carry for safety, whatever
// theme the app was in.

const { mirrorRootStyle } = await import('../src/components/docking/PopoutWindow.js');

const fakeRoot = (style) => {
    const attributes = new Map(style == null ? [] : [['style', style]]);
    return {
        documentElement: {
            getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
            setAttribute: (name, value) => attributes.set(name, value),
            removeAttribute: (name) => attributes.delete(name),
        },
        styleAttribute: () => (attributes.has('style') ? attributes.get('style') : null),
    };
};

const palette = '--tf-panel: #f4f4f4; --tf-text: #202020;';
const floatRoot = fakeRoot(null);
mirrorRootStyle(fakeRoot(palette), floatRoot);
assert.equal(floatRoot.styleAttribute(), palette,
    'a float carries the palette the main window is painted with');

// Switching to a theme that sets nothing leaves no stale palette behind.
mirrorRootStyle(fakeRoot(null), floatRoot);
assert.equal(floatRoot.styleAttribute(), null);

const popoutSource = readFileSync(
    new URL('../src/components/docking/PopoutWindow.js', import.meta.url), 'utf8');
assert.match(popoutSource, /mirrorRootStyle\(document, doc\)/, 'a window takes the palette as it opens');
assert.match(popoutSource, /MutationObserver/, 'and follows a theme change while it is open');

// ── A context menu is clamped to the window it is opened in ───────────────────

const { clampToViewport } = await import('../src/components/ui/ContextMenu.js');
const menuBounds = { width: 190, height: 240 };
assert.deepEqual(clampToViewport(600, 400, menuBounds, floatView), { left: 526, top: 276 },
    'a menu near the corner of a float is pulled back inside it');
assert.deepEqual(clampToViewport(600, 400, menuBounds, { innerWidth: 1400, innerHeight: 1040 }),
    { left: 600, top: 400 }, 'and is left where it was asked for when the room is there');

// ── A prompt raised in a float opens over that float ──────────────────────────
//
// Save MF, and the Material Editor rename and delete, ask through the dialog
// host they are handed. The app host renders in the main window tree, so a
// torn-off tool given that one got its dialog on the main window, behind the
// window it was asked from.

const { FloatToolHost } = await import('../src/components/docking/DockingLayout.js');
const { WINDOW_REGISTRY: registry } = await import('../src/components/docking/windowRegistry.js');

let toolDialogHost = null;
registry['tearoff-prompt-probe'] = {
    component: ({ setInputDialog }) => {
        toolDialogHost = setInputDialog;
        return React.createElement('div', null, 'probe tool');
    },
    title: 'probe', label: 'probe', dialog: true,
};
const appDialogHost = () => { throw new Error('a float must not prompt through the app host'); };
const floatHtml = renderToStaticMarkup(withDesign(React.createElement(FloatToolHost, {
    toolId: 'tearoff-prompt-probe', c, t, setInputDialog: appDialogHost,
})));
delete registry['tearoff-prompt-probe'];

assert.ok(floatHtml.includes('probe tool'), 'the float renders its tool');
assert.equal(typeof toolDialogHost, 'function', 'and hands it a dialog host');
assert.notEqual(toolDialogHost, appDialogHost,
    'one of its own, so the prompt opens over the window that asked for it');

assert.equal(/h\(ToolContent, \{\s*toolId: f\.toolId/.test(layoutSource), false,
    'the app hosts no longer reach a torn-off tool');
assert.match(layoutSource, /h\(FloatToolHost, \{/, 'which is given hosts of its own instead');

// The material repair a blocked tool offers is raised the same way, so it opens
// in the float too rather than on the main window behind it.
assert.equal(/h\(FloatToolHost, \{[^}]*onReplaceMaterials/.test(layoutSource), false,
    'and that includes the material repair a blocked window offers');

console.log('PASS tear_off_windows');
