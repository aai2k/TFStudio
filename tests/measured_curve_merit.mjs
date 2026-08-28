import assert from 'node:assert/strict';

import {
    DLSOptimizer,
    buildEvalContext,
    calcMF,
    densifyOperandsForFeatures,
    evaluateOperands,
    expandMeasuredCurveOperands,
    makeMeasuredCurveOperand,
    makeOperand,
    operandEvaluationErrors,
    operandSampleLambdas,
    requiredLambdas,
} from '../src/utils/physics/optimizer.js';
import {
    measuredCurveSpacing,
    sampleMeasuredCurve,
} from '../src/utils/io/spectrumTable.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    measuredFitMeritOperands, measuredFitSnapshot, orphanFitBlocks, restoredFitCurves,
} from '../src/components/windows/dataExchange/spectrumExchange/model.js';
import { buildTargetGeometry } from '../src/utils/physics/spectrumTargets/geometry.js';
import {
    editableColsForRow,
    rowDisplayMeta,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

const resolveMat = id => getMaterial(id);

function designWithThickness(thickness) {
    return {
        name: 'Measured target recovery',
        incidentMedium: 'Air',
        exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness, locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
    };
}

const curve = {
    id: 'curve-r',
    name: 'Measured R',
    quantity: 'R',
    x: [400, 410, 420, 430, 440],
    y: [0.10, 0.20, 0.40, 0.30, 0.20],
    aoi: 7,
    pol: 'p',
    side: 'front',
};

// Sampling stays tied to the measured data unless the user explicitly asks
// for thinning or PCHIP interpolation.
assert.equal(measuredCurveSpacing(curve), 10);
assert.deepEqual(sampleMeasuredCurve(curve, {
    mode: 'measured', rangeMin: 405, rangeMax: 435,
}).lambdas, [410, 420, 430]);
assert.deepEqual(sampleMeasuredCurve(curve, {
    mode: 'thinned', rangeMin: 400, rangeMax: 440, thinEvery: 2,
}).lambdas, [400, 420, 440]);

const uniform = sampleMeasuredCurve(curve, {
    mode: 'uniform', rangeMin: 400, rangeMax: 440, stepNm: 5,
});
assert.deepEqual(uniform.lambdas, [400, 405, 410, 415, 420, 425, 430, 435, 440]);
assert.equal(uniform.stepTooFine, true);
assert.ok(uniform.targets.every(value => value >= 0.1 && value <= 0.4),
    'shape-preserving interpolation must not overshoot the measured extrema');

const clipped = sampleMeasuredCurve(curve, {
    mode: 'measured', rangeMin: 400, rangeMax: 440, safeRange: [410, 430],
});
assert.deepEqual(clipped.lambdas, [410, 420, 430]);
assert.equal(clipped.clipped, true);

// A step the user can type must come back as a reportable reason, never as an
// exception: the caller runs inside a render.
const tooFine = sampleMeasuredCurve(curve, {
    mode: 'uniform', rangeMin: 400, rangeMax: 440, stepNm: 0.001,
});
assert.equal(tooFine.error, 'points');
assert.deepEqual(tooFine.lambdas, []);
assert.equal(sampleMeasuredCurve(curve, {
    mode: 'uniform', rangeMin: 400, rangeMax: 440, stepNm: 0,
}).error, 'step');
assert.equal(
    measuredFitSnapshot(designWithThickness(100), curve, { mode: 'uniform', stepNm: 0.001 }).error,
    'points',
    'the dialog must be told which limit was hit',
);

// A compact snapshot owns cloned sample arrays and survives .tfs-style JSON
// serialization without depending on the live imported curve.
const sourceLambdas = [450, 500, 550, 600, 650];
const sourceTargets = [0.10, 0.12, 0.18, 0.16, 0.11];
const snapshot = makeMeasuredCurveOperand({
    id: 'measured-block',
    curveId: 'curve-r',
    curveName: 'Measured R',
    quantity: 'R',
    aoi: 3,
    pol: 's',
    side: 'front',
    sampleLambdas: sourceLambdas,
    sampleTargets: sourceTargets,
    weight: 2.5,
});
sourceLambdas[0] = 999;
sourceTargets[0] = 0.99;
assert.deepEqual(snapshot.sampleLambdas, [450, 500, 550, 600, 650]);
assert.deepEqual(snapshot.sampleTargets, [0.10, 0.12, 0.18, 0.16, 0.11]);
assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).sampleTargets, snapshot.sampleTargets);
assert.deepEqual(operandSampleLambdas(snapshot), snapshot.sampleLambdas);

const points = expandMeasuredCurveOperands([snapshot]);
assert.equal(points.length, snapshot.sampleLambdas.length);
assert.ok(points.every((point, index) => (
    point.type === 'R'
    && point.target === snapshot.sampleTargets[index]
    && point.weight === snapshot.weight / snapshot.sampleLambdas.length
    && point.measurementSide === 'front'
)));
assert.deepEqual(requiredLambdas([snapshot]), snapshot.sampleLambdas);
assert.deepEqual(
    densifyOperandsForFeatures([snapshot], designWithThickness(100), resolveMat, { enabled: false }),
    points,
    'measured blocks must expand even when adaptive feature sampling is disabled',
);

// Direct one-row evaluation and the optimizer's pointwise expansion are
// mathematically identical, including in a mixed-weight merit function.
const comparisonDesign = designWithThickness(100);
const comparisonContext = buildEvalContext(comparisonDesign, resolveMat);
const other = makeOperand({
    id: 'other', type: 'T', lambdaStart: 525, lambdaEnd: 525,
    aoi: 0, pol: 'avg', target: 0.8, weight: 0.75,
});
const directOps = [snapshot, other];
const expandedOps = [...points, other];
const directMf = calcMF(directOps, evaluateOperands(directOps, comparisonContext));
const expandedMf = calcMF(expandedOps, evaluateOperands(expandedOps, comparisonContext));
assert.ok(Math.abs(directMf - expandedMf) < 1e-14,
    `direct block MF ${directMf} must equal expanded MF ${expandedMf}`);

// Incidence side is semantic input, not display-only metadata. A mismatch is
// reported as an operand error and cannot silently score a front-side curve.
const wrongSide = makeMeasuredCurveOperand({
    ...snapshot, id: 'wrong-side', side: 'back',
});
const wrongSideValues = evaluateOperands([wrongSide], comparisonContext);
assert.match(operandEvaluationErrors(wrongSideValues)[0], /expects back-side incidence/);
assert.equal(calcMF([wrongSide], wrongSideValues), Infinity);

// The import-window model generates one table row with the selected curve's
// quantity/AOI/polarization/side and exact sampled data.
const fit = measuredFitSnapshot(comparisonDesign, curve, {
    mode: 'thinned', rangeMin: 400, rangeMax: 440, thinEvery: 2, weight: 4,
});
assert.equal(fit.error, null);
assert.deepEqual(fit.operand.sampleLambdas, [400, 420, 440]);
assert.deepEqual(fit.operand.sampleTargets, [0.10, 0.40, 0.20]);
assert.deepEqual(
    [fit.operand.quantity, fit.operand.aoi, fit.operand.pol, fit.operand.side, fit.operand.weight],
    ['R', 7, 'p', 'front', 4],
);
assert.equal(measuredFitSnapshot(
    { ...comparisonDesign, surfaceMode: 'back_only' }, curve,
).error, 'side');

const existingRow = makeOperand({ id: 'existing', type: 'T', lambdaStart: 550 });
const generationConfig = {
    outputMode: 'append', constraintsEnabled: true,
    minThicknessNm: 12, maxThicknessNm: 900, constraintWeight: 3,
};
const appended = measuredFitMeritOperands([existingRow], fit.operand, generationConfig);
assert.deepEqual(appended.map(op => op.type), ['T', 'MCURVE', 'MNT', 'MXT']);
assert.deepEqual(appended.slice(-2).map(op => [op.target, op.weight]), [[12, 3], [900, 3]]);
const replaced = measuredFitMeritOperands([existingRow], fit.operand, {
    ...generationConfig, outputMode: 'replace',
});
assert.deepEqual(replaced.map(op => op.type), ['MCURVE', 'MNT', 'MXT']);

// The persisted snapshot remains a compact, protected merit-table row.
assert.deepEqual(editableColsForRow(snapshot), ['enabled', 'weight']);
const rowMeta = rowDisplayMeta(snapshot, 0.012, false);
assert.equal(rowMeta.isMeasured, true);
assert.equal(rowMeta.isRange, true);
assert.equal(rowMeta.rawResidual, 1.2);

// A protected row still has to line up with the rows around it. Every other row
// is as tall as the type picker's trigger; this one shows its type as text and
// collapsed to the line height until it asked for the same height.
shimBrowserGlobals();
await loadApp();
const { rowRenderers } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandCells.js'
);
const typeCellStyle = rowRenderers(snapshot, rowMeta).type(
    { op: snapshot, c: makeTheme(), tdBase: () => ({}) }, 'type', 60,
).props.style;
assert.equal(typeCellStyle.height, 22,
    'the measured row must request the same height as a type-picker row');

// A merit function loaded from a preset carries its fit targets but not the
// curves they came from. The target still has to be visible, and the curve has
// to be recoverable from the snapshot alone.
{
    const loose = makeMeasuredCurveOperand({
        curveId: 'curve-from-another-design', curveName: 'AR front',
        quantity: 'R', aoi: 8, pol: 's', side: 'front',
        sampleLambdas: [400, 500, 600], sampleTargets: [0.04, 0.02, 0.05],
    });
    const designB = { meritOperands: [loose], measuredCurves: [] };

    const drawn = buildTargetGeometry([loose]);
    assert.equal(drawn.lines.length, 1, 'a fit target draws without its curve on the design');
    assert.equal(drawn.lines[0].opId, null, 'a measurement must not be draggable');
    assert.deepEqual(drawn.lines[0].points[0], [400, 4]);

    assert.equal(orphanFitBlocks(designB).length, 1);
    const restored = restoredFitCurves(designB);
    const curve = restored.measuredCurves[0];
    assert.equal(curve.name, 'AR front');
    assert.deepEqual([curve.quantity, curve.aoi, curve.pol, curve.side], ['R', 8, 's', 'front']);
    assert.deepEqual(curve.y, [0.04, 0.02, 0.05]);
    assert.equal(restored.meritOperands[0].curveId, curve.id, 'the block adopts the curve it got back');
    const designAfter = { ...designB, ...restored };
    assert.equal(orphanFitBlocks(designAfter).length, 0);
    assert.equal(restoredFitCurves(designAfter), null, 'restoring twice must not copy the curve');
}

// Known-design recovery: synthesize a measured curve from a 112 nm TiO2 layer,
// start close but wrong, and fit thickness only through the ordinary DLS path.
const trueDesign = designWithThickness(112);
const recoveryLambdas = [450, 475, 500, 525, 550, 575, 600, 625, 650];
const targetProbeOps = recoveryLambdas.map((lambda, index) => makeOperand({
    id: `probe-${index}`, type: 'R', lambdaStart: lambda, lambdaEnd: lambda,
    aoi: 0, pol: 'avg', target: 0, weight: 1,
}));
const recoveryTargets = evaluateOperands(
    targetProbeOps,
    buildEvalContext(trueDesign, resolveMat),
);
const recoveryBlock = makeMeasuredCurveOperand({
    id: 'recovery', quantity: 'R', side: 'front', aoi: 0, pol: 'avg',
    sampleLambdas: recoveryLambdas,
    sampleTargets: Array.from(recoveryTargets),
    weight: 1,
});
const optimizer = new DLSOptimizer([recoveryBlock], designWithThickness(92), resolveMat);
assert.equal(optimizer.operands.length, recoveryLambdas.length,
    'every optimizer entry point must expand the compact block');
for (let iteration = 0; iteration < 80 && !optimizer.isConverged(); iteration++) optimizer.step();
optimizer.restoreBest();
assert.ok(Math.abs(optimizer.thicknesses[0] - 112) < 0.05,
    `expected recovered thickness 112 nm, got ${optimizer.thicknesses[0]}`);
assert.ok(optimizer.mfBest < 1e-7, `expected near-zero recovered MF, got ${optimizer.mfBest}`);

console.log('PASS: measured_curve_merit');
