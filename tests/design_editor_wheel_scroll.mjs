/**
 * The Design Editor's mouse wheel steps only the active thickness cell, the
 * outlined one in the selected row, and a wheel still scrolling the layer list
 * scrolls on over it.
 *
 * Scrolling the table with the pointer in a thickness column used to step every
 * cell the scroll carried under the pointer.
 *
 * Run: node tests/design_editor_wheel_scroll.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

// An element or document that keeps its listeners and fires them on demand.
function listenerTarget(ownerDocument) {
    const listeners = [];
    return {
        ownerDocument,
        listeners,
        addEventListener(type, fn, options) {
            listeners.push({ type, fn, capture: options?.capture === true });
        },
        removeEventListener(type, fn) {
            const index = listeners.findIndex(entry => entry.type === type && entry.fn === fn);
            if (index >= 0) listeners.splice(index, 1);
        },
        fire(type, event, capture = false) {
            for (const entry of [...listeners]) {
                if (entry.type === type && entry.capture === capture) entry.fn(event);
            }
        },
    };
}

const doc = listenerTarget(null);
doc.activeElement = null;

// Just enough React to mount a cell once: state holds its initial value, a ref
// that starts empty starts on the cell's element, and each effect runs as it
// is declared.
let mounting = null;
globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => ({ current: initial === null ? mounting : initial }),
    useEffect: effect => { effect(); },
    useCallback: fn => fn,
};

const { ThicknessCell } = await import(
    '../src/components/windows/design/designEditor/ThicknessCell.js');

function mountCell({ active }) {
    const element = listenerTarget(doc);
    const steps = [];
    mounting = element;
    ThicknessCell({
        value_nm: 100, onChange() {}, locked: false, c: {},
        materialId: 'builtin:SiO2', refLambda: 550, unit: 'nm', primary: true, active,
        onStep: ticks => steps.push(ticks), stepTitles: { up: '', down: '' },
    });
    mounting = null;
    return { element, steps };
}

// One notch away from the user at `time` ms, over `cell` or, with no cell,
// over another part of the table. The event reaches the cell first and then
// bubbles to the document.
function wheel(cell, time) {
    const event = {
        deltaY: -100, deltaX: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false,
        timeStamp: time, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
    };
    cell?.element.fire('wheel', event);
    doc.fire('wheel', event);
    return event;
}

const other = mountCell({ active: false });
const clicked = mountCell({ active: true });
mountCell({ active: true });

// ── A cell that was not clicked never takes the wheel ───────────────────────
let event = wheel(other, 0);
assert.equal(other.steps.length, 0, 'the wheel over a cell not clicked steps nothing');
assert.equal(event.defaultPrevented, false, 'and leaves the list to scroll');
assert.equal(other.element.listeners.length, 0, 'it holds no wheel listener at all');

// ── A scroll carries on over the clicked cell ─────────────────────────────────
wheel(null, 100);
event = wheel(clicked, 150);
assert.equal(clicked.steps.length, 0, 'a scroll reaching the clicked cell does not step it');
assert.equal(event.defaultPrevented, false, 'the list keeps scrolling');
wheel(clicked, 900);
wheel(clicked, 1800);
assert.equal(clicked.steps.length, 0, 'while ticks keep coming less than a second apart');

// ── After a pause, the clicked cell steps ─────────────────────────────────────
event = wheel(clicked, 2800);
assert.deepEqual(clicked.steps, [1], 'a second after the scroll the clicked cell steps');
assert.equal(event.defaultPrevented, true, 'and the list does not scroll under the step');
wheel(clicked, 2850);
wheel(clicked, 2900);
assert.deepEqual(clicked.steps, [1, 1, 1], 'every tick of that spin steps it');

// ── A click ends the scroll at once ──────────────────────────────────────────
wheel(null, 5000);
doc.fire('pointerdown', {}, true);
wheel(clicked, 5050);
assert.equal(clicked.steps.length, 4, 'a click straight after a scroll lets the next tick step');

// One pair of document listeners serves every cell.
assert.equal(doc.listeners.filter(entry => entry.type === 'wheel').length, 1,
    'the document carries one wheel listener however many cells are mounted');

console.log('PASS design_editor_wheel_scroll');
