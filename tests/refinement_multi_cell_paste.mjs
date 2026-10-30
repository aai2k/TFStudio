/**
 * A paste over several cells of the Refinement window's merit table changes
 * every cell it covers.
 *
 * The table hands a multi-cell paste to the window as one list of edits when
 * the window takes one, and cell by cell when it does not. Refinement took them
 * cell by cell, and each edit started from the operand list of the last render,
 * so each one undid the one before and only the last cell changed.
 *
 *   1. Three targets pasted down the Target column land on three rows, as one
 *      change to the design.
 *   2. The window hands the table that handler.
 *
 * Run: node tests/refinement_multi_cell_paste.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import * as RealReact from 'react';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const store = new Map();
globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 4 }, configurable: true, writable: true,
});

const R = makeEffectRuntime(RealReact);
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { Refinement } = await import('../src/components/windows/optimization/refinement/Refinement.js');
const { MFTable } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');
const { pasteIntoCell } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/cellClipboard.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const band = from => makeOperand({ type: 'RAV', lambdaStart: from, lambdaEnd: from + 50, aoi: 0, pol: 'avg', target: 0, weight: 1 });
let design = {
    id: 'paste', name: 'paste', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 60, locked: false }], backLayers: [],
    meritOperands: [band(450), band(550), band(650)],
};
let changes = 0;
const noop = () => {};
DesignContext.value = {
    get design() { return design; },
    updateDesign: patch => { design = { ...design, ...patch }; changes++; },
    checkpoint: noop, beginOptimization: noop, endOptimization: noop, isOptimizing: false, liveUpdate: true,
};
const theme = new Proxy({}, { get: () => '#888' });
const page = R.run(() => Refinement({ c: theme, theme: 'light', t: EN }));

// The table element the window renders, and the props it hands it.
function findTable(element) {
    if (!element || typeof element !== 'object') return null;
    if (element.type === MFTable) return element.props;
    const children = [].concat(element.props?.children ?? []);
    for (const child of children) {
        const found = findTable(child);
        if (found) return found;
    }
    return null;
}
const table = findTable(page);
assert.ok(table, 'the window renders the merit table');

// ── 1. Three targets down the Target column ──────────────────────────────────
// The table's own Ctrl+V, from the first row's Target cell. No render runs
// between the edits a paste makes.
pasteIntoCell({
    rowIdx: 0, colKey: 'target', operands: design.meritOperands, range: null, extraCells: null,
    commitEdit: noop, onAdd: noop, onEdit: table.onEdit, onEditMany: table.onEditMany,
}, { readText: async () => '1\n2\n3' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(design.meritOperands.map(op => op.target), [0.01, 0.02, 0.03], 'every pasted row takes its value');
assert.equal(changes, 1, 'as one change to the design, so one undo takes it back');

// ── 2. The window hands the table the handler ────────────────────────────────
assert.equal(typeof table.onEditMany, 'function', 'Refinement passes the table a handler for a multi-cell paste');

console.log('Refinement multi-cell paste tests passed.');
