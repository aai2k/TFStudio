/**
 * Redraw cost of the merit-function table.
 *
 * The table is asked to render whenever anything above it does: a dock divider
 * commits a size once per frame while it is dragged, and a merit function runs
 * to hundreds of rows. A row that rebuilds its eleven cells on each of those
 * renders is what makes a large table lag, so the rows are memoised and the
 * props they are handed have to stay identical when nothing about them changed.
 * Run: node tests/mf_table_row_memo.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');

const MEMO = Symbol.for('react.memo');
const c = makeTheme();
const t = makeLocale();
const noop = () => {};

const operands = [
    { id: 'a', type: 'DMFS', enabled: true, comment: 'Broadband AR' },
    { id: 'b', type: 'BLNK', enabled: true, comment: 'notes' },
    { id: 'd', type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 },
    { id: 'e', type: 'TGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 },
];

// Everything MFTable holds steady between renders: results that change only
// when the design does, the presets loaded once at startup, the palette and the
// locale, and the callbacks useCallback keeps. A row's memo rests on these
// keeping their identity, so the fixture shares them the way the window does.
const computed = [null, null, 0.004, 0.995];
const contributions = [0, 0, 0.5, 0.5];
const evaluationErrors = [];
const bandLevels = [];
const integralPresets = [];
const NOTHING_SELECTED = new Set();

function context(overrides = {}) {
    return {
        computed, evaluationErrors, bandLevels, contributions,
        largestContribution: 0.5,
        selIds: NOTHING_SELECTED, focusCell: null, editCell: null,
        operands, integralPresets, isMathPct: noop, c, t,
        onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop,
        commitEdit: noop, navigate: noop, setEditCell: noop, setFocusCell: noop,
        ...overrides,
    };
}

const rows = ctx => operands.map((op, index) => renderOperandRow(ctx, op, index));
const samePropsAt = (first, second, index) => {
    const before = first[index].props;
    const after = second[index].props;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].every(key => Object.is(before[key], after[key]));
};

// ── Every row kind is memoised ───────────────────────────────────────────────
{
    for (const row of rows(context())) {
        assert.equal(row.type.$$typeof, MEMO, `${row.key} is drawn through React.memo`);
    }
}

// ── A render that changes nothing hands every row the props it already had ───
// This is what a dock-divider drag does sixty times a second.
{
    const ctx = context();
    const first = rows(ctx);
    const second = rows(ctx);
    for (let index = 0; index < operands.length; index++) {
        assert.ok(samePropsAt(first, second, index),
            `row ${index} keeps its props when nothing changed`);
    }
}

// ── Moving the focused cell touches only the rows involved ───────────────────
{
    const before = rows(context({ focusCell: { rowIdx: 2, colKey: 'target' } }));
    const after = rows(context({ focusCell: { rowIdx: 3, colKey: 'target' } }));
    assert.ok(samePropsAt(before, after, 0), 'a row away from the focus is untouched');
    assert.ok(samePropsAt(before, after, 1), 'a comment row away from the focus is untouched');
    assert.ok(!samePropsAt(before, after, 2), 'the row losing the focus is redrawn');
    assert.ok(!samePropsAt(before, after, 3), 'the row taking the focus is redrawn');
    assert.equal(before[2].props.focusColKey, 'target', 'the focused row is told its column');
    assert.equal(before[3].props.focusColKey, null, 'every other row is told there is none');
}

// ── Editing a cell touches only that row ─────────────────────────────────────
{
    const edit = { rowIdx: 2, colKey: 'target', initValue: '0' };
    const before = rows(context());
    const after = rows(context({ editCell: edit }));
    assert.ok(samePropsAt(before, after, 3), 'a row that is not being edited is untouched');
    assert.ok(!samePropsAt(before, after, 2), 'the row being edited is redrawn');
    assert.equal(after[2].props.rowEdit, edit, 'the edited row is handed the edit');
    assert.equal(after[3].props.rowEdit, null, 'every other row is handed none');
}

// ── Selecting a row touches only the rows whose selection changed ────────────
{
    const before = rows(context({ selIds: new Set(['d']) }));
    const after = rows(context({ selIds: new Set(['e']) }));
    assert.ok(samePropsAt(before, after, 0), 'an unselected row is untouched by a selection move');
    assert.ok(!samePropsAt(before, after, 2), 'the row losing the selection is redrawn');
    assert.ok(!samePropsAt(before, after, 3), 'the row taking the selection is redrawn');
}

console.log('mf_table_row_memo: passed');
