/**
 * The merit table's row handlers keep their identity.
 *
 * Rows are memoised so a render that changes nothing costs nothing, and a memo
 * holds only while the props do. The handlers a row is given are the props most
 * easily lost: one rebuilt from the table's own selection state, or from a
 * fresh arrow the window happened to pass this render, changes every row and
 * puts the whole table back to redrawing on every frame of a divider drag.
 * Run: node tests/mf_table_handler_stability.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

// The row module reads the real React as it loads; the hook under test is the
// only module given the harness, and only while it is being imported.
shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useMFTableSelection } = await importWithHookRuntime(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/useTableSelection.js',
    runtime);
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');

const operands = [
    { id: 'a', type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, target: 0, weight: 1 },
    { id: 'b', type: 'TGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, target: 1, weight: 1 },
];
const noop = () => {};

// Every handler a row is handed. `onEdit` belongs here too: the window rebuilds
// it whenever the operand list changes, which is on every committed edit, so a
// row given the window's own copy loses its memo the moment anything is typed.
// `onKeyDown` is not among them: it belongs to the table's container, not a row.
const ROW_HANDLERS = ['selectRow', 'focusAt', 'startEdit', 'commitEdit', 'navigate', 'isMathPct', 'onEdit'];

const render = props => runtime.render(() => useMFTableSelection(props));
const assertHandlersHeld = (before, after, why) => {
    for (const key of ROW_HANDLERS) {
        assert.equal(before[key], after[key], `${key} keeps its identity ${why}`);
    }
};

// ── A window that rebuilds its callbacks on every render cannot break the memo ──────
// This is the real case: the editor passed a fresh selection callback on every
// render, so the rows were redrawn sixty times a second while a divider moved.
{
    const first = render({
        operands, selectedId: null,
        onSelect: () => {}, onEdit: () => {}, onDelete: () => {},
        onInsertAt: () => {}, onDuplicate: () => {}, onAdd: () => {},
    });
    const second = render({
        operands, selectedId: null,
        onSelect: () => {}, onEdit: () => {}, onDelete: () => {},
        onInsertAt: () => {}, onDuplicate: () => {}, onAdd: () => {},
    });
    assertHandlersHeld(first, second, 'when the window passes fresh callbacks');
}

// ── Selecting a row does not rebuild the handlers ────────────────────────────
// The anchor a shift-click extends from is table state, and reading it at call
// time is what keeps it out of the handlers' identity.
{
    const props = {
        operands, selectedId: null, onSelect: noop, onEdit: noop, onDelete: noop,
        onInsertAt: noop, onDuplicate: noop, onAdd: noop,
    };
    const before = render(props);
    before.selectRow('a', false, false);
    const after = render(props);
    assert.ok(after.selIds.has('a'), 'the click was recorded');
    assertHandlersHeld(before, after, 'after a row is selected');
}

// ── Editing a cell does not rebuild them either ──────────────────────────────
{
    const props = {
        operands, selectedId: null, onSelect: noop, onEdit: noop, onDelete: noop,
        onInsertAt: noop, onDuplicate: noop, onAdd: noop,
    };
    const before = render(props);
    before.focusAt(0, 'target');
    const focused = render(props);
    assert.deepEqual(focused.focusCell, { rowIdx: 0, colKey: 'target' });
    assertHandlersHeld(before, focused, 'after a cell takes the focus');
}

// ── A handler acts on the operands of the render it is called in ─────────────
// Reading through the ref is what allows the identity to be kept, so the value
// read has to be the current one and not the one the handler was built with.
{
    const props = {
        operands, selectedId: null, onSelect: noop, onEdit: noop, onDelete: noop,
        onInsertAt: noop, onDuplicate: noop, onAdd: noop,
    };
    const first = render(props);
    const grown = [...operands, { id: 'c', type: 'RGT', enabled: true, target: 0, weight: 1 }];
    const second = render({ ...props, operands: grown });
    assert.equal(first.focusAt, second.focusAt, 'a longer table does not rebuild the handler');
    let reported = null;
    render({ ...props, operands: grown, onSelect: id => { reported = id; } }).focusAt(2, 'target');
    assert.equal(reported, 'c', 'the handler reaches the row only the newest list has');

    // The same for the edit callback: held steady for the rows, but still
    // calling whichever one the window handed over this render.
    const edits = [];
    render({ ...props, onEdit: (...args) => edits.push(args) }).onEdit('a', 'weight', 3);
    assert.deepEqual(edits, [['a', 'weight', 3]], 'the steady onEdit calls the current one');
}

// ── End to end: a frame of a divider drag redraws no row at all ─────────────
// The handlers above are only worth keeping steady if the rows they reach are
// then handed the props they already had, so the two halves are checked joined
// up: two renders with fresh callbacks, as a dock drag produces, and not one
// row with anything new to draw.
{
    const c = makeTheme();
    const t = makeLocale();
    const computed = operands.map(() => 0.5);
    const integralPresets = [];

    const frame = () => {
        const selection = render({
            operands, selectedId: null,
            onSelect: () => {}, onEdit: () => {}, onDelete: () => {},
            onInsertAt: () => {}, onDuplicate: () => {}, onAdd: () => {},
        });
        const ctx = {
            computed, evaluationErrors: [], bandLevels: [], contributions: computed,
            largestContribution: 1, selIds: selection.selIds,
            focusCell: selection.focusCell, editCell: selection.editCell,
            operands, integralPresets, isMathPct: selection.isMathPct, c, t,
            onEdit: selection.onEdit, selectRow: selection.selectRow, focusAt: selection.focusAt,
            startEdit: selection.startEdit, commitEdit: selection.commitEdit,
            navigate: selection.navigate, setEditCell: selection.setEditCell,
            setFocusCell: selection.setFocusCell,
        };
        return operands.map((op, index) => renderOperandRow(ctx, op, index));
    };

    const before = frame();
    const after = frame();
    const redrawn = before.filter((row, index) => {
        const a = row.props;
        const b = after[index].props;
        return [...new Set([...Object.keys(a), ...Object.keys(b)])]
            .some(key => !Object.is(a[key], b[key]));
    });
    assert.equal(redrawn.length, 0, 'a frame that changed nothing redraws no row');
}

// ── The table hands the rows the steady callback, not the window's own ──────
// The hook can only hold an identity the table actually passes on, and the
// window's `onEdit` prop is in scope at that line, so the two are easy to swap.
{
    const source = await readFile(new URL(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js',
        import.meta.url), 'utf8');
    assert.match(source, /onEdit: handleEdit,/,
        'rowContext carries the steady onEdit from useMFTableSelection');
}

console.log('mf_table_handler_stability: passed');
