/**
 * Closing a cell's editor gives the keys back to the merit table.
 *
 * A cell's editor holds the keyboard focus while it is open: the operand
 * picker's search box, a list cell's list, a text cell's input. When it closed,
 * the editor went away with the focus in it, so the focus fell to the page: the
 * next key opened nothing and the arrows moved nothing until the table was
 * clicked. Escape out of the operand picker or out of a text cell did this, as
 * did a pick in the picker, Tab to a cell of the same row and Enter on the last
 * row. A list cell such as Pol already put the focus back on itself.
 *
 * Every editor now closes the same way: back to text, and the focus back on
 * the cell, unless the editor closed by a click elsewhere, which leaves the
 * focus where that click put it. A move from a text cell leaves the keys with
 * the table wherever it lands.
 * Run: node tests/mf_cell_editor_close_focus.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const realReact = globalThis.React;
const noop = () => {};

function find(node, test) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const hit = find(child, test);
            if (hit) return hit;
        }
        return null;
    }
    return test(node) ? node : find(node.props?.children, test);
}

// ── The picker says how it closed ────────────────────────────────────────────
// Its Escape and outside-click listeners go on the document, and are kept here
// so the test can fire them.
const listeners = { keydown: new Set(), mousedown: new Set() };
document.addEventListener = (type, fn) => listeners[type]?.add(fn);
document.removeEventListener = (type, fn) => listeners[type]?.delete(fn);
const fire = (type, event) => [...listeners[type]].forEach(fn => fn(event));

const pickerReact = makeEffectRuntime({ ...realReact, useLayoutEffect: noop });
globalThis.React = pickerReact;
const { PickerDropdown } = await import('../src/components/ui/PickerDropdown.js?how-closed');
globalThis.React = realReact;

{
    const closes = [];
    const props = {
        value: 'a', onChange: noop, c: makeTheme(), compact: true, triggerLabel: 'a',
        search: () => [{ id: 'b', label: 'b', title: 'entry b' }],
        autoOpen: true, onClose: how => closes.push(how),
    };
    const redraw = () => pickerReact.run(() => PickerDropdown(props));
    const open = () => { pickerReact.unmount(); return redraw(); };

    open();
    fire('keydown', { key: 'Escape' });
    redraw();
    assert.deepEqual(closes.splice(0), ['escape']);

    open();
    fire('mousedown', { target: {} });
    redraw();
    assert.deepEqual(closes.splice(0), ['outside']);

    find(open(), node => node.props?.title === 'entry b').props.onClick();
    redraw();
    assert.deepEqual(closes.splice(0), ['pick']);

    open().props.children[0].props.onClick();
    redraw();
    assert.deepEqual(closes.splice(0), ['trigger'], 'a press on its own trigger');
    pickerReact.unmount();
}

// ── The cell takes the keys back ─────────────────────────────────────────────
// The rows are drawn with a React that hands back plain elements, so the
// editor open in a cell can be found and told it closed.
const rowReact = makeEffectRuntime({
    ...realReact,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    memo: component => component,
});
globalThis.React = rowReact;
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
globalThis.React = realReact;

const dataRow = { id: 'r', type: 'R', enabled: true, lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 'avg', target: 0, weight: 1 };
const commentRow = { id: 'n', type: 'BLNK', enabled: true, comment: 'note' };

// The row drawn with an editor open in one of its cells, and the editor found
// by `test`.
function drawEditing(op, edit, test) {
    const calls = [];
    const record = name => (...args) => calls.push([name, ...args]);
    const row = renderOperandRow({
        computed: [], evaluationErrors: [], bandLevels: [], contributions: [], largestContribution: 0,
        selIds: new Set(), focusCell: { rowIdx: 0, colKey: edit.colKey }, editCell: { rowIdx: 0, ...edit },
        operands: [op], integralPresets: [], isMathPct: () => false, c: makeTheme(), t: makeLocale(),
        onEdit: record('edit'), focusAt: record('focus'), setEditCell: record('editCell'),
        selectRow: noop, pressCell: noop, startEdit: noop, commitEdit: noop, navigate: noop,
        beginDrag: noop, dragOver: noop, leaveComment: noop,
    }, op, 0);
    rowReact.unmount();
    const tree = rowReact.run(() => row.type(row.props));
    return { editor: find(tree, test), calls };
}

// The Type cell, with the picker open as a typed `r` opens it.
const isPicker = node => node.props?.initialQuery !== undefined;
const drawPicking = op => drawEditing(op, { colKey: 'type', initValue: 'r' }, isPicker);

for (const [what, op] of [['data row', dataRow], ['comment row', commentRow]]) {
    for (const how of ['escape', 'pick', 'trigger']) {
        const { editor: picker, calls } = drawPicking(op);
        assert.equal(picker.props.initialQuery, 'r');
        picker.props.onClose(how);
        assert.deepEqual(calls, [['editCell', null], ['focus', 0, 'type']],
            `${what}, ${how}: the cell closes and the focus is back on Type`);
    }
    const { editor: picker, calls } = drawPicking(op);
    picker.props.onClose('outside');
    assert.deepEqual(calls, [['editCell', null]], `${what}: a click outside leaves the focus where it went`);
}

// A pick on a comment row makes it an operand, which another kind of row
// draws, so the picker is taken away before it can say it closed. The pick
// closes the cell and puts the focus back itself.
{
    const { editor: picker, calls } = drawPicking(commentRow);
    picker.props.onChange('R');
    assert.deepEqual(calls, [['edit', 'n', 'type', 'R'], ['editCell', null], ['focus', 0, 'type']]);
}

// A text cell: Escape closed the editor and nothing more.
for (const colKey of ['lambdaStart', 'aoi', 'target', 'weight']) {
    const { editor: input, calls } = drawEditing(dataRow, { colKey, initValue: '5' },
        node => node.type?.name === 'CellInput');
    input.props.onCancel();
    assert.deepEqual(calls, [['editCell', null], ['focus', 0, colKey]],
        `${colKey}: Escape closes the cell and the focus is back on it`);
}

// A list cell closes the same way: a pick and Escape put the focus back on it,
// the focus leaving it does not.
{
    const isList = node => node.type?.name === 'CellList';
    const drawList = () => drawEditing(dataRow, { colKey: 'pol', initValue: 'avg' }, isList);

    let { editor: list, calls } = drawList();
    list.props.onCommit('s');
    const [edits, closing] = [calls.filter(([name]) => name === 'edit'), calls.filter(([name]) => name !== 'edit')];
    assert.deepEqual(edits, [['edit', 'r', 'pol', 's']], 'a pick sets the value');
    assert.deepEqual(closing, [['editCell', null], ['focus', 0, 'pol']], 'and closes the cell with the focus on it');

    ({ editor: list, calls } = drawList());
    list.props.onCancel(true);
    assert.deepEqual(calls, [['editCell', null], ['focus', 0, 'pol']], 'Escape');

    ({ editor: list, calls } = drawList());
    list.props.onCancel(false);
    assert.deepEqual(calls, [['editCell', null]], 'the focus leaving it');
}

// ── A move from a text cell leaves the keys with the table ───────────────────
// Tab to a cell of the same row only moved the focused cell, and Enter on the
// last row moved nothing, while the editor that held the focus went away.
{
    const runtime = makeHookRuntime();
    const { useMFTableSelection } = await importWithHookRuntime(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/useTableSelection.js',
        runtime);
    const props = {
        operands: [dataRow, { ...dataRow, id: 's' }], selectedId: null, onSelect: noop, onEdit: noop,
        onDelete: noop, onInsertAt: noop, onDuplicate: noop, onAdd: noop,
    };
    const render = () => runtime.render(() => useMFTableSelection(props));
    let table = render();
    let focused = 0;
    table.tableRef.current = { focus() { focused++; } };

    table.focusAt(0, 'lambdaStart');
    table = render();
    focused = 0;
    table.navigate(0, 'lambdaStart', 'right');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 0, colKey: 'lambdaEnd' }, 'Tab moves on along the row');
    assert.ok(focused > 0, 'and the keys are the table\'s');

    table.focusAt(1, 'target');
    table = render();
    focused = 0;
    table.navigate(1, 'target', 'down');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'target' }, 'Enter on the last row stays on its cell');
    assert.ok(focused > 0, 'with the keys the table\'s');

    focused = 0;
    table.navigate(1, 'target', 'up');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 0, colKey: 'target' });
    assert.ok(focused > 0, 'as after a move onto another row');
}

console.log('mf_cell_editor_close_focus: passed');
