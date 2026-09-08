/**
 * The Pol cell edits through a list, not a hidden shortcut.
 *
 * As a plain text cell the polarization could only be changed by knowing that
 * a typed a, s or p sets it, which nothing in the cell suggested. Focused, the
 * cell shows a chevron at its right; the chevron, Enter or a double-click puts
 * the three values in the cell as a list, the way Enter puts the operand
 * picker in the Type cell. The typed letter still works.
 * Run: node tests/mf_table_pol_editor.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');

const c = makeTheme();
const t = makeLocale();
const noop = () => {};
const operands = [
    { id: 'a', type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 's', target: 0, targetEnd: 0, weight: 1 },
    { id: 'm', type: 'MNT', enabled: true, lambdaStart: 1, lambdaEnd: 4, aoi: 0, pol: 'avg', target: 25, weight: 1 },
];
const html = (overrides = {}) => renderToStaticMarkup(React.createElement('table', null,
    React.createElement('tbody', null, operands.map((op, index) => renderOperandRow({
        computed: [0.1, 24], evaluationErrors: [], bandLevels: [], contributions: [0.5, 0], largestContribution: 0.5,
        selIds: new Set(), focusCell: null, editCell: null, operands, integralPresets: [],
        isMathPct: () => false, c, t,
        onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop, commitEdit: noop,
        navigate: noop, setEditCell: noop, beginDrag: noop, dragOver: noop,
        ...overrides,
    }, op, index)))));

// ── At rest the cell is its value and nothing else ───────────────────────────
assert.match(html(), />s<\/td>/, 'the polarization is the cell text');
assert.ok(!html().includes('▾'), 'no chevron until the cell is focused');

// ── Focused, it shows the chevron that opens the list ────────────────────────
assert.match(html({ focusCell: { rowIdx: 0, colKey: 'pol' } }), />s<span[^>]*>▾<\/span><\/td>/,
    'the focused Pol cell carries the chevron after its value');
assert.ok(!html({ focusCell: { rowIdx: 0, colKey: 'aoi' } }).includes('▾'),
    'a focused cell of another column shows none');
assert.ok(!html({ focusCell: { rowIdx: 1, colKey: 'pol' } }).includes('▾'),
    'a constraint has no polarization to pick, so its dash shows none');

// ── Editing, the list of the three values hangs under the cell ───────────────
// It is drawn in the page, like the operand picker. A native dropdown was
// tried first: in the app's window it opened as a widget of its own, took the
// focus and reported no pick back, so the cell neither changed nor closed.
{
    const editing = html({ editCell: { rowIdx: 0, colKey: 'pol', initValue: 's' } });
    const list = editing.match(/<div[^>]*position:fixed[^>]*>[\s\S]*?<\/div><\/td>/)?.[0];
    assert.ok(list, 'the editor is a list dropped under the cell');
    for (const pol of ['avg', 's', 'p']) assert.match(list, new RegExp(`>${pol}</div>`), `${pol} is offered`);
    assert.match(list, /<div[^>]*font-weight:600[^>]*>s<\/div>/, 'the current value is marked');
    assert.match(list, /visibility:hidden/, 'unmeasured, it is out of sight rather than at the page corner');
    assert.equal((editing.match(/position:fixed/g) || []).length, 1, 'the other row keeps its text');
    assert.ok(!editing.includes('<select'), 'no native dropdown');
}

console.log('mf_table_pol_editor: passed');
