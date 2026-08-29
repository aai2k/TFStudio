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
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { toScreenPoint, toClientPoint } = await import('../src/components/docking/PopoutWindow.js');
const { FloatFrame } = await import('../src/components/docking/FloatFrame.js');
const { clampToScreen, saveLayout, loadSavedLayout, previewSize } =
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
assert.ok(frame.includes('-webkit-app-region:drag'), 'the strip moves the window');
assert.ok(frame.includes('-webkit-app-region:no-drag'),
    'the buttons must not move the window');

for (const code of ['en', 'ru', 'zh']) {
    const tl = makeLocale(code);
    for (const key of ['dock', 'close', 'dragToDock', 'minimize', 'maximize']) {
        assert.ok(tl.docking[key], `${code}: docking.${key} is missing`);
    }
}

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

console.log('PASS tear_off_windows');
