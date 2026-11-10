/**
 * A math row's reference cells are text with a list drawn in the page, the
 * way the Pol cell is. The arrow keys stay with the table and move to the next
 * cell, rather than changing the row being read as a focused native dropdown
 * would; Enter, a double-click or the chevron drops the table's other rows
 * under it.
 * Run: node tests/mf_table_reference_list.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
const { startEdit } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js');

// React warns on every server render of a layout effect, which each open list
// has; that warning is all this keeps out of the output.
const consoleError = console.error;
console.error = (...args) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) consoleError(...args);
};

const c = makeTheme();
const t = makeLocale();
const mfe = t.meritFunctionEditor;
const noop = () => {};
const base = (id, type, extra = {}) => ({
    id, type, enabled: true, lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 'avg', target: 0, weight: 1, ...extra,
});
const operands = [
    base('r', 'R'),
    base('tav', 'TAV', { lambdaStart: 400, lambdaEnd: 700 }),
    base('single', 'OPGT', { refId: 'r' }),
    base('pair', 'DIFF', { refId1: 'r', refId2: 'tav' }),
    base('stale', 'ABSO', { refId: 'gone' }),
    base('unset', 'OPLT'),
];
const rowProps = overrides => ({
    computed: [], evaluationErrors: [], bandLevels: [], contributions: [], largestContribution: 0,
    selIds: new Set(), focusCell: null, editCell: null, operands, integralPresets: [],
    isMathPct: () => false, c, t,
    onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop, commitEdit: noop,
    navigate: noop, setEditCell: noop, beginDrag: noop, dragOver: noop, pressCell: noop,
    ...overrides,
});
const rowHtml = (rowIdx, overrides = {}) => renderToStaticMarkup(React.createElement('table', null,
    React.createElement('tbody', null, renderOperandRow(rowProps(overrides), operands[rowIdx], rowIdx))));
// A row's cells in column order: number, on/off, type, λ Start, λ End, ...
const cellsOf = html => html.split('<td').slice(1);
const LAMBDA_START = 3;
const LAMBDA_END = 4;

// ── At rest each reference is text naming the row it reads ───────────────────
{
    const rows = [2, 3, 4, 5].map(rowIdx => rowHtml(rowIdx));
    for (const html of rows) assert.ok(!html.includes('<select'), 'no native dropdown in a math row');
    const [single, pair, stale, unset] = rows.map(cellsOf);
    assert.ok(single[LAMBDA_START].includes('>#1 R</span>'), 'λ Start names the row read by number and type');
    assert.ok(pair[LAMBDA_START].includes('>#1 R</span>') && pair[LAMBDA_END].includes('>#2 TAV</span>'),
        'a pair row names its first row in λ Start and its second in λ End');
    assert.ok(stale[LAMBDA_START].includes(`>${mfe.refDeleted}</span>`), 'a row since deleted is marked so');
    assert.ok(stale[LAMBDA_START].includes(`title="${mfe.refDeletedTip}"`));
    assert.ok(unset[LAMBDA_START].includes(`>${mfe.refPick}</span>`), 'an empty reference asks for a row');
    assert.ok(![single, pair, stale, unset].some(cells => [LAMBDA_START, LAMBDA_END].some(i => cells[i].includes('tf-caret'))),
        'no chevron until the cell is focused');
}

// ── Focused, it shows the chevron that opens the list ────────────────────────
assert.match(cellsOf(rowHtml(2, { focusCell: { rowIdx: 2, colKey: 'lambdaStart' } }))[LAMBDA_START],
    />#1 R<\/span><span class="tf-caret"[^>]*><\/span><\/span><\/td>/,
    'the focused reference carries the chevron after its text');
assert.ok(!cellsOf(rowHtml(2, { focusCell: { rowIdx: 2, colKey: 'lambdaEnd' } }))[LAMBDA_END].includes('tf-caret'),
    'a row that reads one row has nothing to pick in λ End');

// ── Open, the table's other rows hang under the cell ─────────────────────────
// Under an entry that empties the reference, named as an empty cell is, or as
// a reference to a deleted row is.
const marked = html => html.match(/<div[^>]*font-weight:600[^>]*>([^<>]+)<\/div>/)?.[1];
{
    const html = rowHtml(3, { editCell: { rowIdx: 3, colKey: 'lambdaEnd', initValue: '' } });
    const list = html.match(/<div[^>]*position:fixed[^>]*>[\s\S]*?<\/div><\/td>/)?.[0];
    assert.ok(list, 'the editor is a list dropped under the cell');
    assert.deepEqual([...list.matchAll(/>([^<>]+)<\/div>/g)].map(match => match[1]),
        [mfe.refPick, '#1 R', '#2 TAV', '#3 OPGT', '#5 ABSO', '#6 OPLT'], 'every row but the one doing the reading');
    assert.equal(marked(list), '#2 TAV', 'the row it reads is marked');
    assert.ok(!html.includes('<select'), 'no native dropdown');
    const stale = rowHtml(4, { editCell: { rowIdx: 4, colKey: 'lambdaStart', initValue: '' } });
    assert.equal(marked(stale), mfe.refDeleted, 'a reference to a deleted row marks the entry that empties it');
}

// ── A pick sets the reference and puts the focus back on the cell ────────────
{
    const calls = [];
    const element = renderOperandRow(rowProps({
        editCell: { rowIdx: 3, colKey: 'lambdaEnd', initValue: '' },
        onEdit: (...args) => calls.push(['edit', ...args]),
        setEditCell: cell => calls.push(['editCell', cell]),
        focusAt: (...args) => calls.push(['focus', ...args]),
    }), operands[3], 3);
    // The row is a memo of its view; the view is called directly to reach the
    // list's own handlers.
    const findList = node => {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) return node.map(findList).find(Boolean) || null;
        if (typeof node.props?.onCommit === 'function') return node;
        return findList(node.props?.children);
    };
    const list = findList(element.type.type(element.props));
    assert.ok(list, 'the open cell holds the list');
    list.props.onCommit('single');
    list.props.onCommit(null);
    assert.deepEqual(calls, [
        ['edit', 'pair', '_patch', { refId2: 'single' }], ['editCell', null], ['focus', 3, 'lambdaEnd'],
        ['edit', 'pair', '_patch', { refId2: null }], ['editCell', null], ['focus', 3, 'lambdaEnd'],
    ], 'the entry heading the list empties the reference');
}

// ── From the keyboard ────────────────────────────────────────────────────────
// Enter opens the list. A typed key picks nothing, since the rows have no
// letter to pick by, and the dash of a row that reads one row opens nothing.
{
    const calls = [];
    const ctx = {
        operands, isMathPct: () => false, onEdit: (...args) => calls.push(['edit', ...args]),
        setFocusCell: cell => calls.push(['focus', cell]), setEditCell: cell => calls.push(['editCell', cell]),
    };
    startEdit(ctx, 3, 'lambdaEnd', null);
    startEdit(ctx, 2, 'lambdaStart', '5');
    startEdit(ctx, 2, 'lambdaEnd', null);
    assert.deepEqual(calls, [
        ['focus', { rowIdx: 3, colKey: 'lambdaEnd' }], ['editCell', { rowIdx: 3, colKey: 'lambdaEnd', initValue: '' }],
    ]);
}

console.error = consoleError;
console.log('mf_table_reference_list: passed');
