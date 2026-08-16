import assert from 'node:assert/strict';
import {
    COLS, TABLE_W, columnPercent, contributionBarWidth, dynamicHeaderLabels,
    editableColsForRow, fmtContribution, fmtCurrent, fmtResidual, fmtTargetDisplay,
    isRangeType, residualTooltip, rowDisplayMeta, typeRgba,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import {
    OPERAND_TYPES, isBlank, isConstraint, isDmfs, isIntegral, isMath,
    isTotalThickness,
} from '../src/utils/physics/optimizer/operandModel.js';

const op = (type, extra = {}) => ({ id: type, type, target: 0.5, ...extra });
const theme = { success: 'success', error: 'error', textDim: 'dim' };

assert.deepEqual(COLS.map(col => [col.key, col.label]), [
    ['num', '#'], ['enabled', '✓'], ['type', 'Type'], ['lambdaStart', 'λ / Layer'],
    ['lambdaEnd', 'End *'], ['aoi', 'AOI (°)'], ['pol', 'Pol'], ['target', 'Target'],
    ['weight', 'Weight'], ['current', 'Current'], ['contribution', '% of MF²'],
]);
// The whole table has to fit a half-width window without horizontal scrolling.
// A 1920-wide screen at 125% display scaling gives about 575 CSS px there, and a
// vertical scrollbar takes ~15 of them.
assert.equal(TABLE_W, 548);
assert.ok(TABLE_W <= 555, 'operand table must fit a half-width window at 125% scaling');
// The longest operand names (GDDTFLAT, TODTFLAT) have to read in full inside the
// type picker, which spends ~25 px of the column on its padding and caret.
assert.ok(COLS.find(col => col.key === 'type').w >= 80);

// Widths are shares of the table, so the rows span the window at any width and
// the columns keep their proportions. The shares must total the whole table or
// the layout leaves a gap it distributes by its own rules.
const shares = COLS.map(col => parseFloat(columnPercent(col)));
assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100) < 1e-9,
    'column shares must add up to the full table width');
assert.equal(columnPercent(COLS[0]).endsWith('%'), true);
assert.ok(shares[COLS.findIndex(col => col.key === 'type')]
    > shares[COLS.findIndex(col => col.key === 'num')],
    'growing the window widens the columns that hold text, not just the row numbers');

const headerCases = [
    [null, ['λ / Layer', 'End *']],
    [op('DMFS'), ['λ / Layer', 'End *']],
    [op('BLNK'), ['Comment', '—']],
    [op('TT'), ['Cmp', '—']],
    [op('MNT'), ['Layer 1', 'Layer 2']],
    [op('TIW'), ['Integral', '—']],
    [op('MXWT'), ['λ Start', 'λ End']],
    [op('OPGT'), ['Ref Op#', '—']],
    [op('DIFF'), ['Ref Op#1', 'Ref Op#2']],
    [op('TAV'), ['λ Start', 'λ End']],
    [op('TGT'), ['λ Start', 'λ End']],
    [op('TMN'), ['λ Start', 'λ End']],
    [op('R'), ['λ', '—']],
];
for (const [operand, expected] of headerCases) {
    const labels = dynamicHeaderLabels(operand);
    assert.deepEqual([labels.lambdaStart, labels.lambdaEnd], expected, operand?.type || 'none');
}

const editableCases = [
    ['DMFS', ['enabled']],
    ['BLNK', ['enabled']],
    ['TT', ['enabled', 'type', 'lambdaStart', 'target', 'weight']],
    ['MXT', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight']],
    ['RIW', ['enabled', 'type', 'lambdaStart', 'aoi', 'pol', 'target', 'weight']],
    ['MNWR', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
    ['ABSO', ['enabled', 'type', 'lambdaStart', 'target', 'weight']],
    ['SUMM', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight']],
    ['R', ['enabled', 'type', 'lambdaStart', 'aoi', 'pol', 'target', 'weight']],
    ['RAV', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
    ['RGT', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
    ['RMX', ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
];
for (const [type, expected] of editableCases) assert.deepEqual(editableColsForRow(op(type)), expected, type);

const percentMeta = rowDisplayMeta(op('R', { target: 0.4 }), 0.425, false);
assert.deepEqual(
    { cur: percentMeta.cur, tgt: percentMeta.tgt, residual: percentMeta.rawResidual, fraction: percentMeta.useFraction },
    { cur: 42.5, tgt: 40, residual: 2.5, fraction: true },
);
assert.equal(fmtCurrent(percentMeta.cur, percentMeta), '42.500 %');
assert.equal(fmtResidual(percentMeta.rawResidual, percentMeta), '+2.500 %');
assert.equal(fmtTargetDisplay(op('R', { target: 0.1234 }), percentMeta), '12.34');

const rawMeta = rowDisplayMeta(op('TT', { target: 100 }), 98.25, false);
assert.equal(fmtCurrent(rawMeta.cur, rawMeta), '98.25 nm');
assert.equal(fmtResidual(rawMeta.rawResidual, rawMeta), '-1.75 nm');
assert.equal(fmtTargetDisplay(op('TT', { target: 100 }), rawMeta), '100.00');

const rampOp = op('TGT', { target: 0.1, targetEnd: 0.9 });
const rampMeta = rowDisplayMeta(rampOp, 0.025, false);
assert.equal(rampMeta.rawResidual, 2.5);
assert.equal(fmtTargetDisplay(rampOp, rampMeta), '10.0→90.0');
assert.equal(fmtTargetDisplay(op('RGT', { target: 0.3 }), rowDisplayMeta(op('RGT', { target: 0.3 }), null, false)), '30.0→30.0');

const mathPercentMeta = rowDisplayMeta(op('OPGT', { target: 0.99 }), 0.97, true);
assert.equal(fmtCurrent(mathPercentMeta.cur, mathPercentMeta), '97.00');
assert.equal(fmtResidual(mathPercentMeta.rawResidual, mathPercentMeta), '-2.00');
assert.equal(fmtTargetDisplay(op('OPGT', { target: 0.99 }), mathPercentMeta), '99.00');
const mathRawMeta = rowDisplayMeta(op('DIFF', { target: 5 }), 7, false);
assert.equal(fmtTargetDisplay(op('DIFF', { target: 5 }), mathRawMeta), '5.000');

const normal = op('R');

// The contribution column replaced a per-type coloured Δ. It is a share of one
// sum, so it formats the same way on every row type and needs no thresholds.
assert.equal(fmtContribution(null), '—');
assert.equal(fmtContribution(0), '0');
assert.equal(fmtContribution(0.0005), '<0.1%');
assert.equal(fmtContribution(0.713), '71.3%');
assert.equal(fmtContribution(1), '100.0%');

// The bar is scaled to the largest share in the table, not to 100%, so the top
// row always fills its cell and a table of small shares stays readable.
assert.equal(contributionBarWidth(null, 0.7), 0);
assert.equal(contributionBarWidth(0, 0.7), 0);
assert.equal(contributionBarWidth(0.7, 0.7), 1);
assert.equal(contributionBarWidth(0.35, 0.7), 0.5);
assert.equal(contributionBarWidth(0.7, 0), 0, 'no largest share, no bar');
// A share too small to see still gets a sliver rather than vanishing.
assert.equal(contributionBarWidth(1e-6, 1), 0.02);

// The residual is still reachable in the cell tooltip, where its per-type
// meaning can be spelled out instead of left to the reader.
assert.equal(residualTooltip(percentMeta), 'Current − target: +2.500 %');
assert.equal(residualTooltip(rowDisplayMeta(op('MNT'), 0.5, false)), 'Slack +0.00 nm');
assert.equal(residualTooltip(
    rowDisplayMeta(op('GDDFLAT', { target: -40 }), 28.6, false, -37.5)),
    'RMS deviation +28.600 fs²');
assert.equal(residualTooltip(
    rowDisplayMeta(op('GDDFLAT', { target: -40 }), 28.6, false, -37.5),
    { residualRms: 'СКО' }), 'СКО +28.600 fs²');
assert.equal(residualTooltip(rowDisplayMeta(normal, null, false)), null);

assert.equal(typeRgba('T', 0.12), 'rgba(80,150,255,0.12)');
assert.equal(typeRgba('unknown', 0.5), null);

// The λ End column is driven by three independent functions: the header label,
// the editable-column list, and isRangeType (which decides value vs dash in
// textCell). They must agree for every operand, or a row shows a dash on a
// column the keyboard will still walk into and edit.
for (const type of OPERAND_TYPES) {
    if (isBlank(type) || isDmfs(type) || isTotalThickness(type)
        || isIntegral(type) || isMath(type) || isConstraint(type)) continue;
    const row = op(type, { lambdaStart: 600, lambdaEnd: 900 });
    const labelled = dynamicHeaderLabels(row).lambdaEnd !== '—';
    assert.equal(editableColsForRow(row).includes('lambdaEnd'), labelled,
        `${type}: λ End editability must match its header label`);
    assert.equal(isRangeType(type), labelled,
        `${type}: λ End cell must show a value exactly when the header names one`);
}

// A flatness operand's value is an RMS deviation, so it cannot be read against
// the target level and falls to zero exactly as the row is met. Current shows
// the achieved band level instead, and the RMS moves to the tooltip.
const flatOp = op('GDDFLAT', { target: -40 });
const flatMeta = rowDisplayMeta(flatOp, 28.636, false, -37.53);
assert.equal(flatMeta.cur, -37.53, 'Current is the achieved band level');
assert.equal(flatMeta.rawResidual, 28.636, 'the tooltip carries the RMS deviation');
assert.equal(fmtCurrent(flatMeta.cur, flatMeta), '-37.530 fs²');
assert.equal(fmtTargetDisplay(flatOp, flatMeta), '-40.00 fs²');

// At the optimum the RMS is zero and the level equals the target, so the row
// reads as satisfied rather than as a total miss.
const metOp = op('GDDFLAT', { target: -40 });
const metMeta = rowDisplayMeta(metOp, 0, false, -40);
assert.equal(fmtCurrent(metMeta.cur, metMeta), '-40.000 fs²');
assert.equal(metMeta.rawResidual, 0);

// Without a band level (worker results, older callers) the row falls back to
// the operand's own value rather than showing nothing.
assert.equal(rowDisplayMeta(flatOp, 28.636, false).cur, 28.636);

// Range-target ramps keep their existing display: they have no single level.
const rampUnchanged = rowDisplayMeta(op('TGT', { target: 0.1, targetEnd: 0.9 }), 0.025, false);
assert.equal(rampUnchanged.cur, 2.5);
assert.equal(rampUnchanged.rawResidual, 2.5);

// Flatness operands sample a band, so they carry a λ End; the pointwise phase
// operands are single-wavelength and must not.
for (const type of ['GDFLAT', 'GDTFLAT', 'GDDFLAT', 'GDDTFLAT', 'TODFLAT', 'TODTFLAT']) {
    assert.equal(isRangeType(type), true, `${type} spans a wavelength band`);
    assert.equal(dynamicHeaderLabels(op(type)).lambdaEnd, 'λ End');
}
for (const type of ['PR', 'PT', 'DPR', 'DPT', 'GD', 'GDT', 'GDD', 'GDDT', 'TOD', 'TODT']) {
    assert.equal(isRangeType(type), false, `${type} is evaluated at one wavelength`);
    assert.equal(dynamicHeaderLabels(op(type)).lambdaEnd, '—');
}

console.log('mf_table_view_model_characterization: passed');
