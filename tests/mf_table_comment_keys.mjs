/**
 * A comment row is typed into and left from the keys, as a text cell is.
 *
 * A comment row has no cells, so an arrow onto one selects it as a row and the
 * keys stay with the table. A key typed there had no cell to start an edit in
 * and did nothing until the comment was clicked. Once clicked, the comment's
 * input took every key, Up and Down included, and the row could only be left
 * with the mouse.
 *
 * A key typed on the row starts the comment with that key, the way it starts a
 * text cell's value, and the input takes the focus with the caret after it. Up
 * and Down leave the comment for the row above or below, as they leave a
 * cell's editor; Escape gives the keys back to the table on the comment's own
 * row, with the comment as typed. Left and Right stay in the text. A DMFS
 * header has no comment to type into and is left as it was.
 * Run: node tests/mf_table_comment_keys.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useMFTableSelection } = await importWithHookRuntime(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/useTableSelection.js',
    runtime);

// The row module is loaded with a React that hands back plain elements and runs
// effects, so the comment's input can be found, pressed, and seen to take the
// focus.
const realReact = globalThis.React;
const rowReact = makeEffectRuntime({
    ...realReact,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    memo: component => component,
});
globalThis.React = rowReact;
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
globalThis.React = realReact;

const operands = [
    { id: 'a', type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 },
    { id: 'n', type: 'BLNK', enabled: true, comment: 'note' },
    { id: 'b', type: 'TGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 },
    { id: 'h', type: 'DMFS', enabled: true, comment: 'block' },
];
const noop = () => {};
const edits = [];
const props = {
    operands, selectedId: null, onSelect: noop, onEdit: (...args) => edits.push(args),
    onDelete: noop, onInsertAt: noop, onDuplicate: noop, onAdd: noop,
};
const render = () => runtime.render(() => useMFTableSelection(props));
const rows = table => [...table.selIds].sort();
const keyEvent = key => ({
    key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target: {},
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
});
const press = (table, key) => {
    const event = keyEvent(key);
    table.onKeyDown(event);
    return event;
};

// A fresh table with the keys on the comment row, arrived at by an arrow from
// the Target cell above it.
function arrowOntoComment() {
    runtime.reset();
    let table = render();
    table.focusAt(0, 'target');
    table = render();
    press(table, 'ArrowDown');
    return render();
}

// ── A key typed on a comment row starts its comment ──────────────────────────
{
    let table = arrowOntoComment();
    assert.deepEqual(rows(table), ['n'], 'the arrow selected the comment row');
    const typed = press(table, 'x');
    table = render();
    assert.deepEqual(edits.splice(0), [['n', 'comment', 'x']], 'the key replaces the comment, as on a text cell');
    assert.deepEqual(table.editCell, { rowIdx: 1, colKey: 'comment' }, 'and the comment is open to the keys that follow');
    assert.equal(typed.prevented, true, 'the key goes in through the edit alone, not a second time from the browser');
}
{
    runtime.reset();
    let table = render();
    table.selectRow('n', false, false);
    table = render();
    press(table, 'Q');
    table = render();
    assert.deepEqual(edits.splice(0), [['n', 'comment', 'Q']], 'a comment row selected with a click takes the key too');
    assert.deepEqual(table.editCell, { rowIdx: 1, colKey: 'comment' });
}
{
    runtime.reset();
    let table = render();
    table.selectRow('h', false, false);
    table = render();
    const typed = press(table, 'x');
    table = render();
    assert.deepEqual(edits, [], 'a DMFS header takes no typed key');
    assert.equal(table.editCell, null);
    assert.equal(typed.prevented, false);
}

// ── Up, Down and Escape give the keys back to the table ──────────────────────
{
    let table = arrowOntoComment();
    let tableFocused = 0;
    table.tableRef.current = { focus() { tableFocused++; } };
    press(table, 'x');
    edits.splice(0);
    table = render();
    tableFocused = 0;

    table.leaveComment(1, 1);
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 2, colKey: 'target' },
        'Down leaves for the row below, in the column the keys came in by');
    assert.deepEqual(rows(table), [], 'which takes the focus as a cell');
    assert.equal(table.editCell, null, 'the comment is closed');
    assert.ok(tableFocused > 0, 'and the keys are the table\'s again');

    press(table, 'ArrowUp');
    table = render();
    table.leaveComment(1, -1);
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 0, colKey: 'target' }, 'Up leaves for the row above');

    press(table, 'ArrowDown');
    table = render();
    press(table, 'y');
    table = render();
    table.leaveComment(1, 0);
    table = render();
    assert.deepEqual(rows(table), ['n'], 'Escape stays on the comment row');
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'target' });
    assert.equal(table.editCell, null);
    assert.deepEqual(edits.splice(0), [['n', 'comment', 'y']], 'with the comment as typed');
}
{
    // A click into the comment drops the focused cell, so the keys go on in
    // the Type column, as they do from any row selected with a click.
    runtime.reset();
    let table = render();
    table.selectRow('n', false, false, true);
    table = render();
    table.leaveComment(1, 1);
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 2, colKey: 'type' });
}

// ── The Type cell of a comment row ───────────────────────────────────────────
// The keys reach it as on any row, and a letter typed there opens the operand
// picker with that letter, so a BLNK can be turned into an operand without the
// mouse. The row has no on/off mark: it is never scored.
{
    let table = arrowOntoComment();
    press(table, 'ArrowLeft');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'type' }, 'Left from the comment reaches the Type cell');
    assert.deepEqual(rows(table), ['n'], 'and the row stays selected for the row keys');
    const typed = press(table, 'r');
    table = render();
    assert.deepEqual(table.editCell, { rowIdx: 1, colKey: 'type', initValue: 'r' },
        'a letter typed there opens the picker with that letter');
    assert.deepEqual(edits, [], 'and leaves the comment alone');
    assert.equal(typed.prevented, false);

    table.setEditCell(null);
    table = render();
    press(table, 'Enter');
    table = render();
    assert.deepEqual(table.editCell, { rowIdx: 1, colKey: 'type', initValue: '' }, 'Enter opens it too');

    table.setEditCell(null);
    table = render();
    press(table, 'ArrowRight');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'lambdaStart' }, 'Right from Type is the comment');
    press(table, 'ArrowRight');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 2, colKey: 'enabled' }, 'and Right again is the next row');

    press(table, 'ArrowUp');
    table = render();
    press(table, 'ArrowLeft');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'type' }, 'Left from the comment is Type');
    press(table, 'ArrowLeft');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'num' }, 'and Left from Type the row number');
    assert.deepEqual(rows(table), ['n']);
    press(table, 'ArrowRight');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'type' }, 'Right from the row number is Type');
}
{
    // Right from the last cell of a row wraps to the comment row's Type, past
    // the column where its on/off mark would be.
    runtime.reset();
    let table = render();
    table.focusAt(0, 'weight');
    table = render();
    press(table, 'ArrowRight');
    table = render();
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'type' });

    // Down the on/off column onto a comment row switches nothing.
    table.focusAt(0, 'enabled');
    table = render();
    press(table, 'ArrowDown');
    table = render();
    press(table, 'Enter');
    table = render();
    assert.deepEqual(edits, [], 'Enter there has no mark to switch');
    assert.equal(table.editCell, null);
    press(table, 'z');
    assert.deepEqual(edits.splice(0), [['n', 'comment', 'z']], 'and a typed key goes to the comment');
}

// ── The comment row as drawn ─────────────────────────────────────────────────
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
const inputIn = tree => find(tree, node => node.type === 'input');
const typeCellIn = tree => find(tree, node => node.type === 'td' && node.props.onDoubleClick);
const commentCellIn = tree => find(tree, node => node.type === 'td' && node.props.colSpan);
const textIn = node => (node && typeof node === 'object'
    ? [node.props?.children].flat(Infinity).map(textIn).join('') : String(node ?? ''));

// Draws the comment row as the table does and runs its effects, with a stand-in
// for the input element attached to its ref before they run, as React attaches
// the element.
function drawComment(editCell, focusCell = null) {
    const calls = [];
    const field = {
        value: '', focused: false, caret: null,
        focus() { this.focused = true; },
        setSelectionRange(start, end) { this.caret = [start, end]; },
    };
    const row = renderOperandRow({
        selIds: new Set(['n']), editCell, focusCell, c: makeTheme(), t: makeLocale(),
        onEdit: noop, beginDrag: noop, dragOver: noop,
        selectRow: (...args) => calls.push(['select', ...args]),
        pressCell: (rowIdx, colKey) => calls.push(['press', rowIdx, colKey]),
        startEdit: (...args) => calls.push(['startEdit', ...args]),
        setEditCell: value => calls.push(['editCell', value]),
        leaveComment: (...args) => calls.push(['leave', ...args]),
        focusAt: (...args) => calls.push(['focus', ...args]),
    }, { ...operands[1], comment: 'x' }, 1);
    rowReact.unmount();
    let input = null;
    let tree = null;
    rowReact.run(() => {
        tree = row.type(row.props);
        input = inputIn(tree);
        field.value = input.props.value;
        input.props.ref.current = field;
        return tree;
    });
    return { tree, input, field, calls };
}

{
    const { tree, calls } = drawComment(null);
    assert.ok(!/[✓○]/.test(textIn(tree)), 'a comment row draws no on/off mark');
    const typeCell = typeCellIn(tree);
    assert.equal(textIn(typeCell), 'BLNK');
    const event = keyEvent('');
    event.button = 0;
    typeCell.props.onMouseDown(event);
    assert.deepEqual(calls.splice(0), [['press', 1, 'type']], 'a press on Type focuses that cell');
    assert.equal(event.stopped, true, 'rather than selecting the row alone');
    typeCell.props.onDoubleClick();
    assert.deepEqual(calls.splice(0), [['startEdit', 1, 'type', null]], 'a double-click opens the picker');
}
{
    const focusedOn = colKey => drawComment(null, { rowIdx: 1, colKey }).tree;
    const outlined = cell => /solid/.test(cell.props.style.outline || '');
    assert.ok(outlined(typeCellIn(focusedOn('type'))), 'the focused Type cell is outlined');
    assert.ok(!outlined(commentCellIn(focusedOn('type'))));
    assert.ok(outlined(commentCellIn(focusedOn('target'))), 'any other column of the row is the comment');
    assert.ok(!outlined(typeCellIn(focusedOn('target'))));
    assert.ok(!outlined(commentCellIn(drawComment(null).tree)), 'nothing is outlined without the focus');
    assert.ok(!outlined(commentCellIn(focusedOn('num'))), 'nor with the focus on the row number');
}
{
    const { tree, calls } = drawComment({ rowIdx: 1, colKey: 'type', initValue: 'r' });
    const picker = find(tree, node => node.props?.initialQuery !== undefined);
    assert.equal(picker.props.initialQuery, 'r', 'the picker opens in the Type cell with the typed letter');
    assert.equal(typeCellIn(tree).props.onMouseDown, undefined, 'and a press in it is the picker\'s own');
    picker.props.onClose('escape');
    assert.deepEqual(calls, [['editCell', null], ['focus', 1, 'type']],
        'closing it closes the cell; see mf_cell_editor_close_focus.mjs for where the focus goes');
}

{
    const { field } = drawComment({ rowIdx: 1, colKey: 'comment' });
    assert.equal(field.focused, true, 'opened from the keys, the input takes the focus');
    assert.deepEqual(field.caret, [1, 1], 'with the caret after the typed key');
    assert.equal(drawComment(null).field.focused, false, 'a comment nobody opened leaves the focus alone');
    assert.equal(drawComment({ rowIdx: 1, colKey: 'target' }).field.focused, false,
        'nor does a cell editor left on its row number');
}
{
    const { input, calls } = drawComment(null);
    for (const [key, step] of [['ArrowDown', 1], ['ArrowUp', -1], ['Escape', 0]]) {
        const event = keyEvent(key);
        input.props.onKeyDown(event);
        assert.deepEqual(calls.splice(0), [['leave', 1, step]], `${key} leaves the comment`);
        assert.equal(event.prevented, true);
        assert.equal(event.stopped, true, `${key} is the comment's alone`);
    }
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'x']) {
        const event = keyEvent(key);
        input.props.onKeyDown(event);
        assert.deepEqual(calls, [], `${key} stays in the text`);
        assert.equal(event.prevented, false);
    }
    input.props.onFocus();
    assert.deepEqual(calls.splice(0), [['select', 'n', false, false, true]],
        'focused with the mouse or Tab, the comment selects its row');
}
{
    const { input, calls } = drawComment({ rowIdx: 1, colKey: 'comment' });
    input.props.onFocus?.();
    assert.deepEqual(calls, [], 'opened from the keys, its row is already selected and the column is kept');
    input.props.onBlur();
    assert.deepEqual(calls, [['editCell', null]], 'leaving it by the mouse closes it');
}

console.log('mf_table_comment_keys: passed');
