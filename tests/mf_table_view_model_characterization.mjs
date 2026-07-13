import assert from 'node:assert/strict';
import {
    COLS, TABLE_W, deltaColor, dynamicHeaderLabels,
    editableColsForRow, fmtCurrent, fmtDelta, fmtTargetDisplay,
    rowDisplayMeta, typeRgba,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';

const op = (type, extra = {}) => ({ id: type, type, target: 0.5, ...extra });
const theme = { success: 'success', error: 'error', textDim: 'dim' };

assert.deepEqual(COLS.map(col => [col.key, col.label]), [
    ['num', '#'], ['enabled', '✓'], ['type', 'Type'], ['lambdaStart', 'λ / Layer'],
    ['lambdaEnd', 'End *'], ['aoi', 'AOI (°)'], ['pol', 'Pol'], ['target', 'Target'],
    ['weight', 'Weight'], ['current', 'Current'], ['delta', 'Δ'],
]);
assert.equal(TABLE_W, 728);

const headerCases = [
    [null, ['λ / Layer', 'End *']],
    [op('DMFS'), ['λ / Layer', 'End *']],
    [op('BLNK'), ['Comment', '—']],
    [op('TT'), ['Cmp', '—']],
    [op('MNT'), ['Layer 1', 'Layer 2 (range)']],
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
    { cur: percentMeta.cur, tgt: percentMeta.tgt, delta: percentMeta.rawDelta, fraction: percentMeta.useFraction },
    { cur: 42.5, tgt: 40, delta: 2.5, fraction: true },
);
assert.equal(fmtCurrent(percentMeta.cur, percentMeta), '42.500 %');
assert.equal(fmtDelta(percentMeta.rawDelta, percentMeta), '+2.500 %');
assert.equal(fmtTargetDisplay(op('R', { target: 0.1234 }), percentMeta), '12.34');

const rawMeta = rowDisplayMeta(op('TT', { target: 100 }), 98.25, false);
assert.equal(fmtCurrent(rawMeta.cur, rawMeta), '98.25 nm');
assert.equal(fmtDelta(rawMeta.rawDelta, rawMeta), '-1.75 nm');
assert.equal(fmtTargetDisplay(op('TT', { target: 100 }), rawMeta), '100.00');

const rampOp = op('TGT', { target: 0.1, targetEnd: 0.9 });
const rampMeta = rowDisplayMeta(rampOp, 0.025, false);
assert.equal(rampMeta.rawDelta, 2.5);
assert.equal(fmtTargetDisplay(rampOp, rampMeta), '10.0→90.0');
assert.equal(fmtTargetDisplay(op('RGT', { target: 0.3 }), rowDisplayMeta(op('RGT', { target: 0.3 }), null, false)), '30.0→30.0');

const mathPercentMeta = rowDisplayMeta(op('OPGT', { target: 0.99 }), 0.97, true);
assert.equal(fmtCurrent(mathPercentMeta.cur, mathPercentMeta), '97.00');
assert.equal(fmtDelta(mathPercentMeta.rawDelta, mathPercentMeta), '-2.00');
assert.equal(fmtTargetDisplay(op('OPGT', { target: 0.99 }), mathPercentMeta), '99.00');
const mathRawMeta = rowDisplayMeta(op('DIFF', { target: 5 }), 7, false);
assert.equal(fmtTargetDisplay(op('DIFF', { target: 5 }), mathRawMeta), '5.000');

const normal = op('R');
assert.equal(deltaColor(normal, 0.499, percentMeta, theme), 'success');
assert.equal(deltaColor(normal, 0.5, percentMeta, theme), '#ffa726');
assert.equal(deltaColor(normal, 1.999, percentMeta, theme), '#ffa726');
assert.equal(deltaColor(normal, 2, percentMeta, theme), '#ef5350');
const argMeta = rowDisplayMeta(op('MXWT', { target: 500 }), 500, false);
assert.equal(deltaColor(op('MXWT'), 0.999, argMeta, theme), 'success');
assert.equal(deltaColor(op('MXWT'), 1, argMeta, theme), '#ffa726');
assert.equal(deltaColor(op('MXWT'), 5, argMeta, theme), '#ef5350');
assert.equal(deltaColor(op('MNT'), 0, rowDisplayMeta(op('MNT'), 0.5, false), theme), 'success');
assert.equal(deltaColor(op('MNT'), -0.01, rowDisplayMeta(op('MNT'), 0.5, false), theme), 'error');
assert.equal(deltaColor(op('MXT'), 0, rowDisplayMeta(op('MXT'), 0.5, false), theme), 'success');
assert.equal(deltaColor(op('MXT'), 0.01, rowDisplayMeta(op('MXT'), 0.5, false), theme), 'error');
assert.equal(deltaColor(op('TT', { cmp: 'le' }), 0, rawMeta, theme), 'success');
assert.equal(deltaColor(op('TT', { cmp: 'ge' }), -0.01, rawMeta, theme), 'error');
assert.equal(deltaColor(op('OPGT'), 0, mathRawMeta, theme), 'success');
assert.equal(deltaColor(op('OPLT'), 0, mathRawMeta, theme), 'success');
assert.equal(deltaColor(normal, null, percentMeta, theme), 'dim');

assert.equal(typeRgba('T', 0.12), 'rgba(80,150,255,0.12)');
assert.equal(typeRgba('unknown', 0.5), null);
console.log('mf_table_view_model_characterization: passed');
