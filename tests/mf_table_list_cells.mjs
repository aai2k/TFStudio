/**
 * The comparison of a thickness or force row, an integral's preset and a PPEF
 * row's curve block pick from a list drawn in the page, as Pol and a math
 * row's references do. No row holds a native dropdown, which would take the
 * arrow keys and change the cell instead of moving to the next one. Enter and
 * Backspace open the list and a typed key opens nothing, and on every cell of
 * every operand type whatever a key opens is drawn, so the table is never left
 * waiting on an editor that is not there.
 *
 * A curve block's list starts with an entry that empties the cell, and an
 * integral of its own setup heads the presets with that setup, which picks
 * nothing.
 * Run: node tests/mf_table_list_cells.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { renderOperandRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
const { startEdit } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js');
const { COLS, editableColsForRow } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js');
const { OPERAND_TYPES } = await import('../src/utils/physics/optimizer.js');
const { buildMfePresetList } = await import('../src/utils/physics/integralValues.js');

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
const integralPresets = buildMfePresetList([]);
const base = (id, type, extra = {}) => ({
    id, type, enabled: true, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    target: 0.5, targetEnd: 0.5, weight: 1, ...extra,
});
const operands = [
    base('r', 'R', { lambdaStart: 550, lambdaEnd: 550 }),
    base('tt', 'TT', { cmp: 'ge', target: 1200 }),
    base('str', 'STR'),
    base('vis', 'TIW', { presetKey: 'Tvis', lambdaStart: 380, lambdaEnd: 780 }),
    base('own', 'TIW'),
    base('gain', 'MCURVE', { quantity: 'T', curveName: 'Gain target' }),
    base('ppef', 'PPEF', { refId: 'gain' }),
    base('lost', 'PPEF', { refId: 'gone' }),
    base('fresh', 'PPEF'),
];
const rowProps = (rows, overrides) => ({
    computed: [], evaluationErrors: [], bandLevels: [], contributions: [], largestContribution: 0,
    selIds: new Set(), focusCell: null, editCell: null, operands: rows, integralPresets,
    isMathPct: () => false, c, t,
    onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop, commitEdit: noop,
    navigate: noop, setEditCell: noop, beginDrag: noop, dragOver: noop, pressCell: noop,
    ...overrides,
});
const rowHtml = (rows, rowIdx, overrides = {}) => renderToStaticMarkup(React.createElement('table', null,
    React.createElement('tbody', null, renderOperandRow(rowProps(rows, overrides), rows[rowIdx], rowIdx))));
// One cell's markup, found by its column.
const cellOf = (html, colKey) => html.split('<td').slice(1)[COLS.findIndex(col => col.key === colKey)];
const at = (rowIdx, overrides) => cellOf(rowHtml(operands, rowIdx, overrides), 'lambdaStart');
const open = rowIdx => at(rowIdx, { editCell: { rowIdx, colKey: 'lambdaStart', initValue: '' } });
const entries = html => [...html.matchAll(/>([^<>]+)<\/div>/g)].map(match => match[1]);

// ── At rest each is text ─────────────────────────────────────────────────────
for (const rowIdx of [1, 2, 3, 4, 6, 7, 8]) {
    assert.ok(!rowHtml(operands, rowIdx).includes('<select'), `${operands[rowIdx].type} holds no native dropdown`);
}
assert.ok(at(1).includes('>≥</span>'), 'the comparison shows its sign');
assert.ok(at(1).includes(`title="${mfe.comparisonTitles.TT.ge}"`), 'and says what it means');
assert.ok(at(3).includes('>Tvis</span>'), 'an integral shows its preset');
const ownSetup = at(4).match(/>([^<>]+)<\/span><\/span><\/td>/)[1];
assert.ok(at(4).includes(`title="${mfe.customIntegralTip(ownSetup)}"`),
    'an integral with no preset describes its own setup');
assert.ok(at(6).includes('>#6 Gain target</span>'), 'a PPEF row names its curve block by row and name');
assert.ok(at(7).includes(`>${mfe.curveRefGone}</span>`), 'a block since deleted is marked so');
assert.ok(at(8).includes(`>${mfe.curveRefPick}</span>`), 'an empty one asks for a block');
assert.match(at(1, { focusCell: { rowIdx: 1, colKey: 'lambdaStart' } }), /<span class="tf-caret"/,
    'focused, the cell shows the chevron that opens its list');

// ── Open, each lists its choices with the current one marked ─────────────────
const marked = html => html.match(/<div[^>]*font-weight:600[^>]*>([^<>]+)<\/div>/)?.[1];
const presetLabels = integralPresets.map(preset => preset.label);
assert.deepEqual(entries(open(1)), ['≤', '≥', '=']);
assert.equal(marked(open(1)), '≥');
assert.deepEqual(entries(open(3)), presetLabels);
assert.equal(marked(open(3)), 'Tvis');
assert.deepEqual(entries(open(4)), [ownSetup, ...presetLabels], 'an integral of its own setup heads the presets with it');
assert.equal(marked(open(4)), ownSetup);
assert.deepEqual(entries(open(6)), [mfe.curveRefPick, '#6 Gain target'],
    'the curve blocks, under the entry that empties the cell');
assert.equal(marked(open(7)), mfe.curveRefGone, 'a block since deleted marks the entry that empties the cell');
{
    const alone = [base('solo', 'PPEF')];
    const html = cellOf(rowHtml(alone, 0, { editCell: { rowIdx: 0, colKey: 'lambdaStart', initValue: '' } }), 'lambdaStart');
    assert.deepEqual(entries(html), [mfe.curveRefPick], 'with no curve block in the table, that entry is all there is');
}

// ── A pick makes the edit the dropdown made ──────────────────────────────────
{
    const pick = (rowIdx, value) => {
        const calls = [];
        const element = renderOperandRow(rowProps(operands, {
            editCell: { rowIdx, colKey: 'lambdaStart', initValue: '' },
            onEdit: (...args) => calls.push(args),
        }), operands[rowIdx], rowIdx);
        // The row is a memo of its view; the view is called directly to reach
        // the list's own handlers.
        const findList = node => {
            if (!node || typeof node !== 'object') return null;
            if (Array.isArray(node)) return node.map(findList).find(Boolean) || null;
            if (typeof node.props?.onCommit === 'function') return node;
            return findList(node.props?.children);
        };
        const list = findList(element.type.type(element.props));
        assert.ok(list, `${operands[rowIdx].type} draws its list`);
        list.props.onCommit(value);
        return calls;
    };
    assert.deepEqual(pick(1, 'le'), [['tt', 'cmp', 'le']]);
    const rsol = integralPresets.find(preset => preset.key === 'Rsol');
    assert.deepEqual(pick(3, 'Rsol'), [['vis', '_patch', {
        type: 'RIW', presetKey: 'Rsol', source: { ...rsol.sourceSpec }, detector: { ...rsol.detectorSpec },
        lambdaStart: rsol.band[0], lambdaEnd: rsol.band[1],
    }]], 'a preset sets the channel, the source, the detector and the band');
    assert.deepEqual(pick(8, 'gain'), [['fresh', '_patch', { refId: 'gain' }]]);
    assert.deepEqual(pick(6, null), [['ppef', '_patch', { refId: null }]], 'the entry heading the list empties the cell');
    assert.deepEqual(pick(4, null), [], 'an integral of its own setup picked again changes nothing');
}

// ── Enter and Backspace open the list; a typed key opens nothing ─────────────
for (const rowIdx of [1, 3, 6]) {
    const opened = initChar => {
        let edit = null;
        startEdit({
            operands, isMathPct: () => false, onEdit: noop,
            setFocusCell: noop, setEditCell: cell => { edit = cell; },
        }, rowIdx, 'lambdaStart', initChar);
        return edit;
    };
    const list = { rowIdx, colKey: 'lambdaStart', initValue: '' };
    const type = operands[rowIdx].type;
    assert.deepEqual(opened(null), list, `Enter opens the ${type} list`);
    assert.deepEqual(opened(''), list, `Backspace opens the ${type} list`);
    assert.equal(opened('7'), null, `a typed key opens nothing on ${type}`);
}

// ── Enter picks the highlighted entry, the one that empties the cell too ─────
{
    const runtime = makeHookRuntime();
    runtime.React.createElement = React.createElement;
    const { CellList } = await importWithHookRuntime(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/CellControls.js?harness', runtime);
    const picked = [];
    const list = runtime.render(() => CellList({
        options: [{ value: null, label: mfe.curveRefPick }, { value: 'gain', label: '#6 Gain target' }],
        value: null, onCommit: value => picked.push(value), onCancel: noop, c,
    }));
    list.props.onKeyDown({ key: 'Enter', stopPropagation: noop, preventDefault: noop });
    assert.deepEqual(picked, [null]);
}

// ── Whatever editing opens is drawn ──────────────────────────────────────────
// On every editable cell of a row of every type, Enter, Backspace and a typed
// key either open nothing or open an editor the cell then draws: a text box,
// the type picker or a list.
{
    const rows = OPERAND_TYPES.map((type, index) => base(`row${index}`, type));
    for (const [rowIdx, op] of rows.entries()) {
        for (const colKey of editableColsForRow(op)) {
            for (const initChar of [null, '', '7']) {
                let opened = null;
                startEdit({
                    operands: rows, isMathPct: () => false, onEdit: noop,
                    setFocusCell: noop, setEditCell: cell => { opened = cell; },
                }, rowIdx, colKey, initChar);
                if (!opened) continue;
                const cell = cellOf(rowHtml(rows, rowIdx, { editCell: opened }), colKey);
                assert.match(cell, /<input|position:fixed/,
                    `${op.type} ${colKey} draws the editor that ${JSON.stringify(initChar)} opened`);
            }
        }
    }
}

console.error = consoleError;
console.log('mf_table_list_cells: passed');
