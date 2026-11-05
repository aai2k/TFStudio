/**
 * Backspace opens the focused cell's editor with its text cleared, as in a
 * spreadsheet: a number cell opens empty, Type opens its picker with an empty
 * search, Pol opens its list, and a dash, which holds no value, opens nothing.
 * A row selection has no cell to clear, and the on/off mark is left alone.
 * Run: node tests/mf_table_backspace.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useMFTableSelection } = await importWithHookRuntime(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/useTableSelection.js',
    runtime);

const operands = [
    { id: 'r', type: 'R', enabled: true, lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 's', target: 0.1, weight: 1 },
    { id: 'n', type: 'BLNK', enabled: true, comment: 'note' },
];
const noop = () => {};
const edits = [];
const props = {
    operands, selectedId: null, onSelect: noop, onEdit: (...args) => edits.push(args),
    onDelete: noop, onInsertAt: noop, onDuplicate: noop, onAdd: noop,
};
const render = () => runtime.render(() => useMFTableSelection(props));
// Backspace with the focus on one cell, or with a row selected; what opens.
const backspace = select => {
    let table = render();
    table.setEditCell(null);
    select(table);
    table = render();
    table.onKeyDown({
        key: 'Backspace', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
        target: {}, preventDefault() {},
    });
    return render().editCell;
};
const onCell = colKey => backspace(table => table.focusAt(0, colKey));

assert.deepEqual(onCell('target'), { rowIdx: 0, colKey: 'target', initValue: '' }, 'a number cell opens empty');
assert.deepEqual(onCell('aoi'), { rowIdx: 0, colKey: 'aoi', initValue: '' });
assert.deepEqual(onCell('type'), { rowIdx: 0, colKey: 'type', initValue: '' },
    'Type opens its picker with nothing in the search box');
assert.deepEqual(onCell('pol'), { rowIdx: 0, colKey: 'pol', initValue: 's' }, 'Pol opens its list');
assert.equal(onCell('lambdaEnd'), null, 'a dash holds no value to clear');
assert.equal(onCell('enabled'), null, 'the on/off mark is not a value');
assert.deepEqual(edits, [], 'and is not switched');
assert.equal(backspace(table => table.selectRow('r', false, false)), null, 'a selected row has no cell to clear');
assert.equal(backspace(table => table.focusAt(1, 'target')), null, 'nor has a comment row');

console.log('mf_table_backspace: passed');
