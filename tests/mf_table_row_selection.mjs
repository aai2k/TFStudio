/**
 * Rows are selected the way a spreadsheet's row headers select them.
 *
 * A press in the row-number column selects the row, and a drag down the
 * column selects the run of rows crossed, header and comment rows included. A
 * drag begun on a cell grows the rectangle of cells and passes over a header
 * or comment row, which has no cells, without making it a corner.
 *
 * Selecting a row also drops the focused cell. Without that, a comment row
 * clicked after a data cell was focused left the cell lit and the keyboard
 * acting on it, so the row just clicked was not the one anything happened to.
 * Run: node tests/mf_table_row_selection.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useMFTableSelection } = await importWithHookRuntime(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/useTableSelection.js',
    runtime);
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');

const operands = [
    { id: 'h', type: 'DMFS', enabled: true, comment: 'block' },
    { id: 'a', type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 },
    { id: 'n', type: 'BLNK', enabled: true, comment: 'note' },
    { id: 'b', type: 'TGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 },
    { id: 'c', type: 'R', enabled: true, lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 'avg', target: 0, weight: 1 },
];
const noop = () => {};
const props = {
    operands, selectedId: null, onSelect: noop, onEdit: noop, onDelete: noop,
    onInsertAt: noop, onDuplicate: noop, onAdd: noop,
};
const render = () => runtime.render(() => useMFTableSelection(props));
const rows = selection => [...selection.selIds].sort();

// ── Entering a cell with no button held changes nothing ──────────────────────
{
    let table = render();
    table.focusAt(1, 'aoi');
    table = render();
    table.dragOver(3, 'pol');
    table = render();
    assert.equal(table.range, null, 'no drag was begun');
    assert.deepEqual(table.focusCell, { rowIdx: 1, colKey: 'aoi' });
}

// ── Selecting a row drops the focused cell ───────────────────────────────────
{
    let table = render();
    table.selectRow('n', false, false);
    table = render();
    assert.deepEqual(rows(table), ['n'], 'the comment row is selected');
    assert.equal(table.focusCell, null, 'and no cell stays lit or acted on');
    assert.equal(table.range, null);
}

// ── A drag from the row-number column selects the run of rows ────────────────
{
    let table = render();
    table.selectRow('a', false, false);
    table.beginDrag('rows');
    table = render();
    table.dragOver(2, null);
    table = render();
    assert.deepEqual(rows(table), ['a', 'n'], 'a comment row, which has no cells, joins the run');
    table.dragOver(3, 'aoi');
    table = render();
    assert.deepEqual(rows(table), ['a', 'b', 'n'], 'and so does a row entered over one of its cells');
    assert.equal(table.focusCell, null, 'a drag over rows focuses no cell');
    table.dragOver(1, null);
    table = render();
    assert.deepEqual(rows(table), ['a'], 'the run shrinks back the way it grew');
}

// ── A drag from a cell grows the rectangle and passes over a comment row ─────
{
    let table = render();
    table.focusAt(1, 'aoi');
    table.beginDrag('cells');
    table = render();
    assert.deepEqual(rows(table), [], 'focusing a cell drops the row selection');
    table.dragOver(2, null);
    table = render();
    assert.equal(table.range, null, 'a row without cells is no corner of the rectangle');
    table.dragOver(3, 'pol');
    table = render();
    assert.deepEqual(table.range, { rowStart: 1, rowEnd: 3, colKeys: ['aoi', 'pol'] });
    assert.deepEqual(rows(table), [], 'a drag over cells selects no rows');
}

// ── A header or comment row is dragged over, not selected as text ────────────
// The rows are one line of text each, and a drag across them selected that
// text instead of the rows.
{
    const ctx = {
        computed: [], evaluationErrors: [], bandLevels: [], contributions: [], largestContribution: 0,
        selIds: new Set(), focusCell: null, editCell: null, operands, integralPresets: [],
        isMathPct: () => false, c: makeTheme(), t: makeLocale(),
        onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop, commitEdit: noop,
        navigate: noop, setEditCell: noop, beginDrag: noop, dragOver: noop,
    };
    const html = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null,
        [0, 2].map(index => renderOperandRow(ctx, operands[index], index)))));
    const tags = html.match(/<tr[^>]*>/g);
    assert.equal(tags.length, 2);
    for (const tag of tags) assert.match(tag, /user-select:none/, `${tag} holds no text to select`);
    assert.match(html, /<input[^>]*user-select:text/, 'the comment itself can still be selected to edit it');
}

console.log('mf_table_row_selection: passed');
