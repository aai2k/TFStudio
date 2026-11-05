/**
 * Delete, Cut, Copy and Duplicate act on the rows of what is selected, from
 * the keys, the right-click menu and the toolbar: the rows selected as rows,
 * or else every row holding a selected cell. A header or comment row has no
 * cells, so a rectangle drawn across one leaves it out, and a right-click on
 * one acts on that row alone. The cell selection goes with the rows, so no
 * cell stays lit on rows that move, and after Delete or Cut the focus goes to
 * the row that moves up, so the keys go on working without a click.
 * Run: node tests/mf_table_row_actions.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const written = [];
Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async text => { written.push(text); }, readText: async () => '' } },
    configurable: true, writable: true,
});
// The table's modules read their hooks from the harness and everything else,
// createElement included, from React.
const runtime = makeHookRuntime();
Object.setPrototypeOf(runtime.React, globalThis.React);
const mfTable = '../src/components/windows/optimization/meritFunctionEditor/mfTable';
const { useMFTableSelection } = await importWithHookRuntime(`${mfTable}/useTableSelection.js`, runtime);
const { useTableContextMenu } = await importWithHookRuntime(`${mfTable}/useTableContextMenu.js`, runtime);
const { MFTable } = await importWithHookRuntime(`${mfTable}/MFTable.js`, runtime);
const { COLS } = await import(`${mfTable}/operandViewModel.js`);

const row = (id, type) => ({
    id, type, enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1,
});
const operands = [
    { id: 'h', type: 'DMFS', enabled: true, comment: 'block' },
    row('a', 'RAV'),
    { id: 'n', type: 'BLNK', enabled: true, comment: 'note' },
    row('b', 'TAV'),
    row('c', 'R'),
];
const noop = () => {};
const deleted = [];
const duplicated = [];
const props = {
    operands, selectedId: null, onSelect: noop, onEdit: noop, onInsertAt: noop, onAdd: noop,
    onDuplicate: ids => duplicated.push(ids), onDelete: ids => deleted.push(ids),
};
const render = () => runtime.render(() => useMFTableSelection(props));
const keyEvent = (key, extra = {}) => ({
    key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target: {}, preventDefault() {}, ...extra,
});
// The operand types of each copy made as operands.
const copiedTypes = () => written.splice(0).map(text => text.split('\n').map(line => line.split('\t')[0]));
// A right-click as the table's DOM reports it: the cell's place in its row is
// its column, and the row carries its index.
const rightClick = (rowIdx, colKey) => {
    const cell = { cellIndex: COLS.findIndex(col => col.key === colKey), parentElement: { dataset: { row: String(rowIdx) } } };
    return { target: { tagName: 'TD', dataset: {}, closest: () => cell }, clientX: 0, clientY: 0, preventDefault() {} };
};
// A key as the table sees it: the selection is set up, the key goes in, and
// the table is drawn again.
const keyOn = (select, key, ctrlKey = false) => {
    let table = render();
    select(table);
    table = render();
    table.onKeyDown(keyEvent(key, { ctrlKey }));
    return render();
};
// A rectangle from row 1 to row 3, across the comment row between them.
const rectangle = table => { table.focusAt(1, 'aoi'); render().extendTo(3, 'pol'); };
// The table with its right-click menu.
const te = makeLocale().meritFunctionEditor;
const cm = te.contextMenu;
const renderWithMenu = () => runtime.render(() => {
    const selection = useMFTableSelection(props);
    return { ...selection, menu: useTableContextMenu({ ...props, ...selection, te }) };
});
// The menu's entries by id, opened on a cell once the rectangle from `from` to
// `to` is drawn.
const menuAt = (from, to, rowIdx, colKey) => {
    renderWithMenu().focusAt(...from);
    renderWithMenu().extendTo(...to);
    renderWithMenu().menu.onContextMenu(rightClick(rowIdx, colKey));
    return Object.fromEntries(renderWithMenu().menu.items.filter(item => item.id).map(item => [item.id, item]));
};

// ── Delete: a focused cell takes its row ─────────────────────────────────────
{
    keyOn(table => table.focusAt(3, 'target'), 'Delete');
    assert.deepEqual(deleted.splice(0), [['b']]);
}

// ── Delete: a rectangle takes every row it holds a cell in ───────────────────
{
    const after = keyOn(rectangle, 'Delete');
    assert.deepEqual(deleted.splice(0), [['a', 'b']], 'the comment row it crosses stays');
    assert.equal(after.range, null);
}

// ── Delete: cells gathered with Ctrl take their rows ─────────────────────────
{
    const after = keyOn(table => { table.focusAt(1, 'target'); render().toggleCell(4, 'weight'); }, 'Delete');
    assert.deepEqual(deleted.splice(0), [['a', 'c']]);
    assert.equal(after.extraCells.size, 0, 'none stays selected on the rows that move up');
}

// ── Delete: rows selected as rows go ─────────────────────────────────────────
{
    keyOn(table => table.selectRow('n', false, false), 'Delete');
    assert.deepEqual(deleted.splice(0), [['n']]);
}

// ── Ctrl+X cuts the same rows ────────────────────────────────────────────────
{
    const after = keyOn(rectangle, 'x', true);
    assert.deepEqual(copiedTypes(), [['RAV', 'TAV']], 'the rows of a rectangle are copied as operands');
    assert.deepEqual(deleted.splice(0), [['a', 'b']], 'and removed');
    assert.equal(after.range, null);
    keyOn(table => table.focusAt(4, 'weight'), 'x', true);
    assert.deepEqual(copiedTypes(), [['R']], 'a focused cell cuts its row');
    assert.deepEqual(deleted.splice(0), [['c']]);
}

// ── Ctrl+D duplicates them ───────────────────────────────────────────────────
{
    const after = keyOn(rectangle, 'd', true);
    assert.deepEqual(duplicated.splice(0), [['a', 'b']], 'every row of a rectangle is duplicated');
    assert.equal(after.range, null, 'no rectangle stays on the rows the copies push down');
}

// ── After Delete or Ctrl+X the keys go on working ────────────────────────────
// The window drops the rows and selects none. Once the shorter list is drawn,
// the focus is on the row that moved up into the first removed row's place,
// in the same column, or on the last row when none is left below.
{
    runtime.reset();
    let rows = ['p', 'q', 'r', 's'].map(id => row(id, 'T'));
    const removed = [];
    const own = { ...props, onDelete: ids => { removed.push(ids); rows = rows.filter(op => !ids.includes(op.id)); } };
    const draw = () => runtime.render(() => useMFTableSelection({ ...own, operands: rows }));
    // A key goes in, the table is drawn with what the window then holds, and
    // the effects that drawing scheduled run, as React runs them.
    const press = (key, ctrlKey = false) => {
        draw().onKeyDown(keyEvent(key, { ctrlKey }));
        draw();
        runtime.pendingEffects().forEach(effect => effect());
        return draw();
    };
    draw();
    draw().focusAt(1, 'target');
    let table = press('Delete');
    assert.deepEqual(removed.splice(0), [['q']]);
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'target' }, 'the row that moved up has the focus');
    table = press('ArrowDown');
    assert.deepEqual(table.focusCell, { rowIdx: 2, colKey: 'target' }, 'so an arrow moves on from it');
    table = press('Delete');
    assert.deepEqual(removed.splice(0), [['s']], 'and Delete takes the next row');
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'target' }, 'with no row below, the last row has the focus');
    table = press('x', true);
    assert.deepEqual(removed.splice(0), [['r']], 'Ctrl+X moves the focus the same way');
    assert.deepEqual(table.focusCell, { rowIdx: 0, colKey: 'target' });
    written.splice(0);
}

// ── The menu's row entries take the rows the keys take ───────────────────────
// A right-click inside a rectangle keeps it, so each entry there takes every
// row the rectangle holds a cell in and says how many. A right-click outside
// it moves the focus to the cell clicked, and the entries take its row.
{
    runtime.reset();
    const inside = menuAt([1, 'aoi'], [3, 'pol'], 3, 'aoi');
    assert.deepEqual(['cut', 'copy', 'duplicate', 'delete'].map(id => inside[id].label),
        [cm.cutOperand(2), cm.copyOperand(2), cm.duplicateOperand(2), cm.deleteOperand(2)],
        'each entry counts the rows it acts on');
    inside.copy.onClick();
    assert.deepEqual(copiedTypes(), [['RAV', 'TAV']], 'Copy takes them as operands');
    inside.duplicate.onClick();
    assert.deepEqual(duplicated.splice(0), [['a', 'b']], 'Duplicate copies each of them');
    assert.equal(renderWithMenu().range, null, 'no rectangle stays on the rows the copies push down');
    menuAt([1, 'aoi'], [3, 'pol'], 3, 'aoi').cut.onClick();
    assert.deepEqual(copiedTypes(), [['RAV', 'TAV']], 'Cut copies them');
    assert.deepEqual(deleted.splice(0), [['a', 'b']], 'and removes them');
    menuAt([1, 'aoi'], [3, 'pol'], 3, 'aoi').delete.onClick();
    assert.deepEqual(deleted.splice(0), [['a', 'b']], 'as Delete does');
    const after = renderWithMenu();
    assert.equal(after.range, null, 'no rectangle stays on the rows that move up');
    assert.equal(after.focusCell, null);
    const outside = menuAt([1, 'aoi'], [3, 'pol'], 4, 'weight');
    assert.deepEqual(['cut', 'delete'].map(id => outside[id].label), [cm.cutOperand(1), cm.deleteOperand(1)]);
    outside.delete.onClick();
    assert.deepEqual(deleted.splice(0), [['c']], 'outside it, the row clicked');
}

// ── A right-click on a header or comment row acts on that row ────────────────
// Such a row has no cells, so a rectangle drawn across it does not hold it:
// a right-click there selects the row, and the menu acts on it alone.
{
    runtime.reset();
    for (const [rowIdx, id] of [[0, 'h'], [2, 'n']]) {
        const menu = menuAt([0, 'type'], [4, 'target'], rowIdx, 'type');
        assert.equal(menu.delete.label, cm.deleteOperand(1), `${id}: the entry names one row`);
        menu.delete.onClick();
        assert.deepEqual(deleted.splice(0), [[id]], `${id}: Delete takes the row clicked, not the rectangle's rows`);
    }
}

// ── The toolbar's Delete clears the selection as the key does ────────────────
// The whole table is drawn, so the button is the one the window shows.
{
    runtime.reset();
    const t = makeLocale();
    const tableProps = {
        ...props, computed: operands.map(() => 0), noOperandsMsg: '',
        onClear: noop, onMoveUp: noop, onMoveDown: noop, c: makeTheme(), t,
    };
    // The integral presets are read through React when the table is drawn.
    const draw = () => {
        const real = globalThis.React;
        globalThis.React = runtime.React;
        try {
            return runtime.render(() => MFTable(tableProps));
        } finally {
            globalThis.React = real;
        }
    };
    const deleteButton = tree => {
        const stack = [tree];
        while (stack.length) {
            const node = stack.pop();
            if (Array.isArray(node)) stack.push(...node);
            else if (node?.props) {
                const face = node.props.label?.props?.children;
                if (Array.isArray(face) && face.includes(t.meritFunctionEditor.deleteOperand)) return node;
                stack.push(node.props.children);
            }
        }
        return null;
    };
    draw().props.onContextMenu(rightClick(3, 'aoi'));
    draw().props.onKeyDown(keyEvent('ArrowDown', { shiftKey: true }));
    deleteButton(draw()).props.onClick();
    assert.deepEqual(deleted.splice(0), [['b', 'c']], 'the button takes the rows of the rectangle');
    assert.equal(deleteButton(draw()).props.disabled, true,
        'and leaves no cell selected on the rows that move up');
}

console.log('mf_table_row_actions: passed');
