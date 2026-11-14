/**
 * Colour rows (RCOL, TCOL) in the Merit Function Editor.
 *
 *   1. The type picker lists RCOL and TCOL in a Color tab, after the weighted
 *      integrals, in every language.
 *   2. λ Start is the Color list: the cell shows the quantity's symbol, its
 *      list names every quantity in full, and a pick sets the row's quantity.
 *      λ End is the list of illuminant and observer pairs, D65 · 2° to
 *      E · 10°, and a pick sets both.
 *   3. With a colour row in focus the λ headers read Color and ILL-OBS, ILL-OBS
 *      titled Illuminant and observer, in every language. Each language's
 *      ILL-OBS fits whole in the λ End column at its 47 px floor, whose header
 *      has 39 px for text past its padding: measured in Chromium in the
 *      header's font (system-ui, 600, 10 px, 0.03 em spacing) as 37.9 px for
 *      ILL-OBS, 38.3 for Ист·наб, 25.0 for 照/观 and 37.3 for ILL-OSS.
 *   4. A colour row takes a Step, 0 for its automatic grid, as a band row.
 *   5. Current prints in the quantity's unit and Target to its places; a
 *      target typed in is kept as typed, not read as a percentage.
 *   6. A row turned into a colour row reads Y under D65 · 2° with a target of 0;
 *      R to T keeps the quantity, and a row turned into another type drops it.
 *   7. The Color cell copies as the quantity's id and takes a pasted id, x
 *      as x and X as X; the ILL-OBS cell copies and takes its pair. Rows
 *      copied as text hold the two in place of a band, and pasted back as
 *      text they come back with their quantity, illuminant and observer.
 *
 * Run: node tests/mf_table_color_rows.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const dir = '../src/components/windows/optimization/meritFunctionEditor';
const { renderOperandRow } = await import(`${dir}/mfTable/OperandRows.js`);
const { MFTable } = await import(`${dir}/mfTable/MFTable.js`);
const { COLS, dynamicHeaderLabels, rowDisplayMeta, fmtCurrent, fmtTargetDisplay, editableColsForRow } = await import(`${dir}/mfTable/operandViewModel.js`);
const { cellEdit, cellInitialText, flagCellText } = await import(`${dir}/mfTable/editModel.js`);
const { retypeOperand, editOperand, makeRowOperand } = await import(`${dir}/meritOperandModel.js`);
const { looksLikeOperandRows, parseOperandsTsv, serializeOperandsTsv } = await import(`${dir}/mfTable/operandClipboard.js`);
const { OperandTypePicker } = await import(`${dir}/mfTable/OperandTypePicker.js`);
const { makeOperand, takesStepFlag } = await import('../src/utils/physics/optimizer.js');
const { COLOR_QUANTITIES } = await import('../src/utils/physics/colorimetry.js');
const { buildMfePresetList } = await import('../src/utils/physics/integralValues.js');

const consoleError = console.error;
console.error = (...args) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) consoleError(...args);
};

const c = makeTheme();
const LOCALES = ['en', 'ru', 'zh', 'it'];
const t = makeLocale();
const mfe = t.meritFunctionEditor;
const noop = () => {};
const integralPresets = buildMfePresetList([]);
const colorRow = (id, extra = {}) => ({ ...makeOperand({ type: 'RCOL', ...extra }), id });
const rav = { ...makeOperand({ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, target: 0 }), id: 'rav' };
const rows = [rav, colorRow('y', { target: 0.5 }), colorRow('a', { color: 'a*', illuminant: 'D50', observer: 10 })];
const rowProps = (overrides) => ({
    computed: [], evaluationErrors: [], bandLevels: [], contributions: [], largestContribution: 0,
    selIds: new Set(), focusCell: null, editCell: null, operands: rows, integralPresets,
    isMathPct: () => false, c, t,
    onEdit: noop, selectRow: noop, focusAt: noop, startEdit: noop, commitEdit: noop,
    navigate: noop, setEditCell: noop, beginDrag: noop, dragOver: noop, pressCell: noop,
    ...overrides,
});
const rowHtml = (rowIdx, overrides = {}) => renderToStaticMarkup(React.createElement('table', null,
    React.createElement('tbody', null, renderOperandRow(rowProps(overrides), rows[rowIdx], rowIdx))));
const cellOf = (html, colKey) => html.split('<td').slice(1)[COLS.findIndex(col => col.key === colKey)];
const opened = (rowIdx, colKey) => cellOf(rowHtml(rowIdx, { editCell: { rowIdx, colKey, initValue: '' } }), colKey);
const entries = html => [...html.matchAll(/>([^<>]+)<\/div>/g)].map(match => match[1]);
const decode = text => text.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

// ── 1. The type picker ───────────────────────────────────────────────────────
for (const code of LOCALES) {
    const tl = makeLocale(code);
    const groups = tl.meritFunctionEditor.operandGroups;
    const html = renderToStaticMarkup(React.createElement(OperandTypePicker, { value: 'RCOL', onChange: noop, c, t: tl, autoOpen: true }));
    const tabs = [...html.matchAll(/>([^<>]+)<\/button>/g)].map(m => m[1]);
    assert.equal(tl.meritFunctionEditor.operandTypes.RCOL.group, 'color', `${code}: RCOL is in the Color group`);
    assert.equal(tl.meritFunctionEditor.operandTypes.TCOL.group, 'color', `${code}: TCOL is in the Color group`);
    assert.equal(tabs.indexOf(groups.color), tabs.indexOf(groups.integral) + 1, `${code}: the Color tab follows the weighted integrals`);
    assert.ok(html.includes(tl.meritFunctionEditor.operandTypes.RCOL.label) && html.includes(tl.meritFunctionEditor.operandTypes.TCOL.label),
        `${code}: and lists RCOL and TCOL`);
}

// ── 2. The two lists ─────────────────────────────────────────────────────────
assert.ok(cellOf(rowHtml(1), 'lambdaStart').includes('>Y</span>'), 'the Color cell shows Y');
assert.ok(cellOf(rowHtml(2), 'lambdaStart').includes('>a*</span>'), 'and a*');
assert.ok(cellOf(rowHtml(1), 'lambdaEnd').includes('>D65 · 2°</span>'), 'λ End shows the pair');
assert.ok(cellOf(rowHtml(2), 'lambdaEnd').includes('>D50 · 10°</span>'));
assert.ok(cellOf(rowHtml(1), 'lambdaEnd').includes(`title="${mfe.illObsTip}"`), 'and says what it holds');
const colorEntries = entries(opened(1, 'lambdaStart')).map(decode);
assert.equal(colorEntries.length, COLOR_QUANTITIES.length, 'every quantity is listed');
assert.deepEqual(colorEntries.slice(0, 9), ['X', mfe.colorLuminous, 'Z', 'x', 'y', 'u′ (1976)', 'v′ (1976)', 'u (1960)', 'v (1960)']);
assert.deepEqual(colorEntries.slice(-5), [`λd (${t.units.nm})`, `λc (${t.units.nm})`, mfe.colorPurity, `CCT (${t.units.K})`, 'Duv']);
assert.deepEqual(entries(opened(1, 'lambdaEnd')), [
    'D65 · 2°', 'D65 · 10°', 'D50 · 2°', 'D50 · 10°', 'A · 2°', 'A · 10°', 'E · 2°', 'E · 10°',
]);
{
    const ru = makeLocale('ru');
    const html = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null,
        renderOperandRow(rowProps({ t: ru, editCell: { rowIdx: 1, colKey: 'lambdaStart', initValue: '' } }), rows[1], 1))));
    const list = entries(cellOf(html, 'lambdaStart'));
    assert.ok(list.includes(`λd (${ru.units.nm})`) && list.includes(ru.meritFunctionEditor.colorPurity), 'the list is in the UI language');
}
const pick = (rowIdx, colKey, value) => {
    const calls = [];
    const element = renderOperandRow(rowProps({
        editCell: { rowIdx, colKey, initValue: '' }, onEdit: (...args) => calls.push(args),
    }), rows[rowIdx], rowIdx);
    const find = node => {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) return node.map(find).find(Boolean) || null;
        if (typeof node.props?.onCommit === 'function') return node;
        return find(node.props?.children);
    };
    find(element.type.type(element.props)).props.onCommit(value);
    return calls;
};
assert.deepEqual(pick(1, 'lambdaStart', 'hab'), [['y', '_patch', { color: 'hab' }]], 'a pick sets the quantity');
assert.deepEqual(pick(1, 'lambdaEnd', 'A · 10°'), [['y', '_patch', { illuminant: 'A', observer: 10 }]], 'and the pair');

// ── 3. The headers ───────────────────────────────────────────────────────────
for (const code of LOCALES) {
    const tl = makeLocale(code);
    const cols = tl.meritFunctionEditor.cols;
    const labels = dynamicHeaderLabels(rows[1], cols);
    assert.equal(labels.lambdaStart, cols.color, `${code}: λ Start reads Color`);
    assert.equal(labels.lambdaEnd, cols.illObs, `${code}: λ End reads ILL-OBS`);
    assert.equal(labels.flag, cols.step, `${code}: Flag reads Step`);
    const html = renderToStaticMarkup(React.createElement(MFTable, {
        operands: rows, computed: [0.04, 0.886, 60.5], selectedId: 'y', noOperandsMsg: '',
        onSelect: noop, onEdit: noop, onAdd: noop, onInsertAt: noop, onDuplicate: noop, onDelete: noop,
        onClear: noop, onMoveUp: noop, onMoveDown: noop, c, t: tl,
    }));
    assert.ok(html.includes(`title="${tl.meritFunctionEditor.illObsTip}"`) && html.includes(`>${cols.illObs}</th>`),
        `${code}: the ILL-OBS header, titled ${tl.meritFunctionEditor.illObsTip}`);
    assert.ok(html.includes(`>${cols.color}</th>`), `${code}: the Color header`);
}
assert.equal(mfe.cols.illObs, 'ILL-OBS');
assert.equal(mfe.illObsTip, 'Illuminant and observer');

// ── 4. Step ──────────────────────────────────────────────────────────────────
assert.ok(takesStepFlag(rows[1]), 'a colour row takes a Step');
assert.equal(rows[1].flag, 0, 'starting at 0');
assert.equal(flagCellText(rows[1]), '0');
assert.deepEqual(editableColsForRow(rows[1]), ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight', 'flag']);

// ── 5. Current and Target ────────────────────────────────────────────────────
const shown = (color, value, target, tl = t) => {
    const op = colorRow('q', { color, target });
    const meta = rowDisplayMeta(op, value, false, null, tl.units);
    return [fmtCurrent(meta.cur, meta), fmtTargetDisplay(op, meta)];
};
assert.deepEqual(shown('Y', 0.886, 0.5), ['0.886 %', '0.50'], 'Y in %, with its unit');
assert.deepEqual(shown('x', 0.16186, 0.23), ['0.1619', '0.230'], 'x to four places, its target to three');
assert.deepEqual(shown('a*', 60.501, 0), ['60.50', '0.00'], 'a* to two');
assert.deepEqual(shown('hab', 294.278, 290), ['294.28 °', '290.00']);
assert.deepEqual(shown('dominant', 456.42, 480), [`456.42 ${t.units.nm}`, '480.00']);
assert.deepEqual(shown('dominant', 456.42, 480, makeLocale('ru')), ['456.42 нм', '480.00'], 'nm in the UI language');
assert.deepEqual(shown('CCT', 6512.4, 6500), [`6512 ${t.units.K}`, '6500']);
assert.deepEqual(shown('purity', 0.6883, 0.5), ['0.688', '0.500'], 'purity as a fraction');
assert.equal(shown('Y', null, 0.5)[0], '\u2014', 'no value: the dash of an empty cell');
{
    const typed = editOperand([rows[1]], 'y', 'target', '1.5')[0];
    assert.equal(typed.target, 1.5, 'a target is kept as typed');
    assert.equal(cellInitialText(typed, 'target', false, { operands: rows, integralPresets }), '1.5');
    const hue = rowDisplayMeta(colorRow('h', { color: 'hab', target: 5 }), 355, false, null, t.units);
    assert.equal(hue.rawResidual, -10, 'a hue misses the short way round');
}

// ── 6. Changing the type ─────────────────────────────────────────────────────
{
    const made = retypeOperand(rav, 'RCOL');
    assert.equal(made.color, 'Y');
    assert.equal(made.illuminant, 'D65');
    assert.equal(made.observer, 2);
    assert.equal(made.target, 0);
    assert.deepEqual([made.lambdaStart, made.lambdaEnd], [380, 780], 'it reads the band the observer tables cover');
    const toT = retypeOperand(rows[2], 'TCOL');
    assert.deepEqual([toT.color, toT.illuminant, toT.observer], ['a*', 'D50', 10], 'R to T keeps the quantity and the pair');
    const back = retypeOperand(rows[2], 'RAV');
    assert.ok(!('color' in back) && !('illuminant' in back) && !('observer' in back), 'another type drops them');
}

// ── 7. Clipboard ─────────────────────────────────────────────────────────────
{
    const table = { operands: rows, integralPresets };
    assert.equal(cellInitialText(rows[2], 'lambdaStart', false, table), 'a*', 'the Color cell copies its id');
    assert.equal(cellInitialText(rows[2], 'lambdaEnd', false, table), 'D50 · 10°', 'the pair copies as it reads');
    assert.deepEqual(cellEdit(rows[1], 'lambdaStart', 'Duv', table), ['_patch', { color: 'Duv' }], 'a pasted id picks it');
    assert.deepEqual(cellEdit(rows[1], 'lambdaEnd', 'e · 10°', table), ['_patch', { illuminant: 'E', observer: 10 }]);
    assert.equal(cellEdit(rows[1], 'lambdaStart', '550', table), null, 'a wavelength is not a colour');
    // x and X, y and Y differ only in case.
    for (const quantity of COLOR_QUANTITIES) {
        assert.deepEqual(cellEdit(rows[1], 'lambdaStart', quantity, table), ['_patch', { color: quantity }], `${quantity} pastes as itself`);
    }

    // Whole rows as text, as a spreadsheet gives them back: each line holds the
    // row's Color and ILL-OBS where a band row holds its band.
    const source = [
        colorRow('c1', { color: 'x', illuminant: 'A', observer: 10, aoi: 30, pol: 's', target: 0.23, weight: 2, flag: -1 }),
        colorRow('c2', { type: 'TCOL', color: 'y', illuminant: 'D50', observer: 2, target: 0.3 }),
        colorRow('c3', { color: "u'", illuminant: 'E', observer: 10, aoi: 45, pol: 'p', target: 0.19, flag: 2 }),
        colorRow('c4', { color: 'Hunter L', target: 40 }),
        colorRow('c5', { type: 'TCOL', color: 'CCT', illuminant: 'D65', observer: 10, target: 6500 }),
    ];
    const text = serializeOperandsTsv(source, new Set(source.map(op => op.id)));
    assert.equal(text.split('\n')[0], 'RCOL\tx\tA · 10°\t30\ts\t-1\t0.23\t2', 'a line holds Color and ILL-OBS as the cells copy them');
    assert.ok(looksLikeOperandRows(text.split('\n').map(line => line.split('\t'))), 'and still reads as rows');
    const fields = op => [op.type, op.color, op.illuminant, op.observer, op.aoi, op.pol, op.flag, op.target, op.weight, op.lambdaStart, op.lambdaEnd];
    assert.deepEqual(parseOperandsTsv(text).map(makeRowOperand).map(fields), source.map(fields), 'pasted as text, each row comes back');
}

console.error = consoleError;
console.log('mf_table_color_rows: passed');
