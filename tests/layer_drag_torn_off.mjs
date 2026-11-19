/**
 * Layer drag in the Design Editor follows the window the row is in. A tool torn
 * off into its own window is a portal into another document: its pointer events
 * and its hit test belong to that window, so the drag listens there and finds
 * the row under the pointer there.
 *
 * Run: node tests/layer_drag_torn_off.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const mainEvents = [];
globalThis.window = {
    addEventListener: type => mainEvents.push(type),
    removeEventListener() {},
};
globalThis.requestAnimationFrame = () => { throw new Error('the main window animates the drag'); };
globalThis.document = { elementFromPoint() { throw new Error('the main document is hit-tested'); }, documentElement: { classList: { add() { throw new Error('the main document is marked'); }, remove() {} } } };

const runtime = makeHookRuntime();
const { useLayerDrag } = await importWithHookRuntime('../src/components/windows/design/designEditor/useLayerDrag.js?torn', runtime);

const listeners = {};
const view = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: type => { delete listeners[type]; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
};
const marks = [];
const makeNode = () => ({
    style: {}, removeAttribute() {}, setAttribute() {}, appendChild() {}, remove() {},
});
const target = { dataset: { layerId: 'b' }, getBoundingClientRect: () => ({ top: 100, height: 20 }) };
const doc = {
    defaultView: view,
    body: { appendChild() {} },
    createElement: makeNode,
    documentElement: { classList: { add: name => marks.push(['add', name]), remove: name => marks.push(['remove', name]) } },
    elementFromPoint: () => ({ closest: () => target }),
};
const sourceRow = {
    ownerDocument: doc, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
    cloneNode: () => makeNode(),
};

const reorders = [];
const drag = runtime.render(() => useLayerDrag({
    displayedLayers: [{ id: 'a' }, { id: 'b' }], selectedIds: new Set(), scrollRef: null,
    reorderLayers: (...args) => { reorders.push(args); return true; },
    reversed: false, side: 'front', selectRows() {}, c: { panel: '#fff', accent: '#00f', bg: '#000' },
}));

drag.onPointerDownDrag('a', {
    button: 0, preventDefault() {}, stopPropagation() {}, clientX: 5, clientY: 5,
    currentTarget: { closest: () => sourceRow },
});
assert.deepEqual(mainEvents, [], 'the main window gets no drag listeners');
assert.ok(listeners.pointermove && listeners.pointerup && listeners.pointercancel, 'the row\'s window does');

listeners.pointermove({ clientX: 40, clientY: 112, preventDefault() {} });
assert.deepEqual(marks, [['add', 'tf-layer-dragging']], 'the drag marks the row\'s own document');
listeners.pointerup();
assert.deepEqual(reorders, [['front', ['a'], 'b', 'after', false]], 'the drop is found under the pointer in the row\'s document and reorders');
assert.deepEqual(Object.keys(listeners), [], 'the listeners are removed from that window');

console.log('PASS layer_drag_torn_off');
