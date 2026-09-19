/**
 * Fitting a design to a measured Ψ or Δ.
 *
 * A curve imported in Measured Ellipsometry becomes one measured-curve block
 * in the merit function, the way a measured spectrum does. What it needs that
 * a spectrum did not: the Δ convention travels with the block and is converted
 * on the way into the residual, Δ differences are taken the short way round
 * the circle, and each channel carries its own residual scale. Ψ and Δ are
 * fitted one curve at a time: a Ψ needs no Δ beside it.
 *
 * Run: node tests/measured_ellipsometry_merit.mjs
 */
import assert from 'node:assert/strict';

import { initWasmForTest } from './_wasmInit.mjs';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import {
    DLSOptimizer, buildEvalContext, calcMF, densifyOperandsForFeatures, evaluateOperands,
    expandMeasuredCurveOperands, isEllipsometricMeasuredCurve, makeMeasuredCurveOperand,
    makeOperand, operandEvaluationErrors, operandResidualScale, requiredLambdas,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { makeMeasuredCurve } from '../src/utils/io/spectrumTable.js';
import {
    CALCULATED_DELTA_CONVENTION, convertDeltaConvention, toDeltaConvention,
} from '../src/utils/physics/thinFilmMath.js';
import { measuredEllipsometryOverlays } from '../src/components/windows/analysis/ellipsometryEvaluation/model.js';
import {
    ellipsometryFitSnapshot, fitDialogText, orphanEllipsometryFitBlocks,
    restoredEllipsometryCurves, sampleDeltaCurve,
} from '../src/components/windows/dataExchange/measuredEllipsometry/fitModel.js';
import {
    measuredFitMeritOperands, orphanFitBlocks,
} from '../src/components/windows/dataExchange/spectrumExchange/model.js';
import { buildTargetGeometry } from '../src/utils/physics/spectrumTargets/geometry.js';
import {
    editableColsForRow, fmtCurrent, rowDisplayMeta,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { getLocale } from '../src/constants/locales/index.js';

await initWasmForTest();

const resolveMat = id => getMaterial(id);
const wrap = value => ((value % 360) + 360) % 360;
const shortWay = value => ((value + 180) % 360 + 360) % 360 - 180;

function designWith(tio2, sio2, extra = {}) {
    return {
        name: 'Ψ/Δ recovery',
        incidentMedium: 'Air',
        exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness: tio2, locked: false },
            { id: 'L2', material: 'SiO2', thickness: sio2, locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
        ...extra,
    };
}

// The "measurement": the true design's own Ψ and Δ at 70°, with Δ written the
// way an instrument writes it, in the Azzam-Bashara sign.
const AOI = 70;
const trueDesign = designWith(120, 200);
const lambdas = Array.from({ length: 61 }, (_, index) => 400 + index * 5);
const trueContext = buildEvalContext(trueDesign, resolveMat);
const pointOps = type => lambdas.map((lambda, index) => makeOperand({
    id: `${type}-${index}`, type, lambdaStart: lambda, lambdaEnd: lambda, aoi: AOI, target: 0,
}));
const truePsi = Array.from(evaluateOperands(pointOps('PSI'), trueContext));
const trueDelta = Array.from(evaluateOperands(pointOps('DEL'), trueContext));
const fileDelta = toDeltaConvention(trueDelta, 'azzam');
assert.ok(fileDelta.some((value, index) => Math.abs(value - trueDelta[index]) > 1),
    'the instrument sign differs from the calculated one, so the conversion is not a no-op');

const psiCurve = { ...makeMeasuredCurve({
    name: 'witness: Psi', x: lambdas, xUnit: 'nm', y: truePsi, quantity: 'PSI', aoi: AOI, side: 'front',
}), id: 'psi-curve' };
const deltaCurve = { ...makeMeasuredCurve({
    name: 'witness: Delta', x: lambdas, xUnit: 'nm', y: fileDelta, quantity: 'DEL', aoi: AOI,
    side: 'front', deltaConvention: 'azzam',
}), id: 'delta-curve' };

// ── Each curve becomes a block of its own ────────────────────────────────────
const fitPsi = ellipsometryFitSnapshot(trueDesign, psiCurve, { weight: 2 });
const fitDelta = ellipsometryFitSnapshot(trueDesign, deltaCurve, { weight: 2 });
assert.equal(fitPsi.error, null);
assert.equal(fitDelta.error, null);
const psiBlock = fitPsi.operand;
const deltaBlock = fitDelta.operand;
// The two blocks of one measurement, as a design holds them after both fits.
const fit = { operands: [psiBlock, deltaBlock] };
assert.deepEqual([psiBlock.quantity, deltaBlock.quantity], ['PSI', 'DEL']);
assert.equal(psiBlock.pairId, undefined, 'a curve fits on its own: nothing ties it to a partner');
assert.equal(deltaBlock.deltaConvention, 'azzam', 'the Δ block records the sign its file was written in');
assert.equal(psiBlock.deltaConvention, undefined, 'Ψ has no sign convention');
assert.deepEqual([psiBlock.aoi, psiBlock.side, psiBlock.pol, psiBlock.weight], [AOI, 'front', 'avg', 2]);
assert.deepEqual(psiBlock.sampleLambdas, lambdas);
assert.deepEqual(deltaBlock.sampleTargets, fileDelta, 'the snapshot keeps the file values as written');
assert.ok(isEllipsometricMeasuredCurve(psiBlock) && isEllipsometricMeasuredCurve(deltaBlock));
assert.ok(!isEllipsometricMeasuredCurve(makeMeasuredCurveOperand({ quantity: 'R' })));

// A Δ taken at another angle is another target, at its own angle.
const otherAngle = ellipsometryFitSnapshot(trueDesign, { ...deltaCurve, aoi: 65 });
assert.equal(otherAngle.error, null);
assert.equal(otherAngle.operand.aoi, 65);

// ── What the fit refuses ─────────────────────────────────────────────────────
assert.equal(ellipsometryFitSnapshot(trueDesign, null).error, 'empty', 'no curve, no fit');
assert.equal(ellipsometryFitSnapshot(trueDesign, { ...psiCurve, aoi: 0 }).error, 'aoi',
    'at normal incidence Ψ and Δ say nothing about the film');
assert.equal(ellipsometryFitSnapshot(trueDesign, { ...psiCurve, side: 'back' }).error, 'backSide',
    'Ψ and Δ are evaluated on the front stack alone');
assert.equal(ellipsometryFitSnapshot(designWith(120, 200, { surfaceMode: 'back_only' }), psiCurve).error,
    'side', 'a design evaluated on its back side cannot take a front-side curve');

// ── Expansion and the Δ convention ───────────────────────────────────────────
const points = expandMeasuredCurveOperands(fit.operands);
assert.equal(points.length, 2 * lambdas.length);
assert.ok(points.slice(0, lambdas.length).every(point => point.type === 'PSI'));
assert.ok(points.slice(lambdas.length).every(point => point.type === 'DEL'));
assert.ok(points.every(point => point.measurementSide === 'front' && point.weight === 2 / lambdas.length));
const engineTargets = convertDeltaConvention(fileDelta, 'azzam', CALCULATED_DELTA_CONVENTION);
points.slice(lambdas.length).forEach((point, index) => {
    assert.equal(point.target, engineTargets[index]);
    assert.ok(Math.abs(shortWay(point.target - trueDelta[index])) < 1e-9,
        'an expanded Δ point targets the calculated sign, so the true design scores zero');
});
assert.deepEqual(requiredLambdas(fit.operands), lambdas);
assert.deepEqual(
    densifyOperandsForFeatures(fit.operands, trueDesign, resolveMat, { enabled: false }), points,
    'ellipsometric blocks expand at the run seam like photometric ones');

// ── The true design scores zero, in both forms ───────────────────────────────
{
    const direct = evaluateOperands(fit.operands, trueContext);
    assert.ok(direct[0] < 1e-9 && direct[1] < 1e-9, `true design should score ~0, got ${direct[0]}, ${direct[1]}`);
    assert.ok(calcMF(points, evaluateOperands(points, trueContext)) < 1e-9);
}

// ── Direct block evaluation equals the pointwise expansion ───────────────────
{
    const design = designWith(132, 188);
    const ctx = buildEvalContext(design, resolveMat);
    const other = makeOperand({
        id: 'other', type: 'R', lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 'avg', target: 0.05, weight: 0.75,
    });
    const directOps = [...fit.operands, other];
    const expandedOps = [...points, other];
    const directMf = calcMF(directOps, evaluateOperands(directOps, ctx));
    const expandedMf = calcMF(expandedOps, evaluateOperands(expandedOps, ctx));
    assert.ok(directMf > 0.001, 'a perturbed design must not score zero');
    assert.ok(Math.abs(directMf - expandedMf) < 1e-12,
        `direct block MF ${directMf} must equal expanded MF ${expandedMf}`);
}

// ── Each channel carries its own residual scale ──────────────────────────────
assert.equal(operandResidualScale(psiBlock), operandResidualScale({ type: 'PSI' }));
assert.equal(operandResidualScale(deltaBlock), operandResidualScale({ type: 'DEL' }));
assert.equal(operandResidualScale(psiBlock), 10);
assert.equal(operandResidualScale(deltaBlock), 20);
assert.equal(operandResidualScale(makeMeasuredCurveOperand({ quantity: 'R' })), 1);

// ── Δ residuals wrap inside the block ────────────────────────────────────────
{
    // Every target one degree past the long way round: the short way is one
    // degree, and without the wrap the block would read 359.
    const oneDegreeOff = makeMeasuredCurveOperand({
        ...deltaBlock, id: 'one-off',
        sampleTargets: toDeltaConvention(trueDelta.map(value => wrap(value + 359)), 'azzam'),
    });
    const [rms] = evaluateOperands([oneDegreeOff], trueContext);
    assert.ok(Math.abs(rms - 1) < 1e-9, `Δ block must score the short way round, got ${rms}`);
}

// ── A uniform resample of Δ never crosses through 180° ───────────────────────
{
    const acrossCut = makeMeasuredCurve({
        name: 'cut', x: [400, 410, 420, 430], xUnit: 'nm', y: [350, 358, 2, 10],
        quantity: 'DEL', aoi: 70, side: 'front',
    });
    const uniform = sampleDeltaCurve(acrossCut, { mode: 'uniform', rangeMin: 400, rangeMax: 430, stepNm: 5 });
    assert.deepEqual(uniform.lambdas, [400, 405, 410, 415, 420, 425, 430]);
    assert.ok(uniform.targets.every(value => value >= 340 || value <= 20),
        `interpolated Δ must stay near the cut, got ${uniform.targets.map(v => v.toFixed(1))}`);
    assert.ok(uniform.targets.every(value => value >= 0 && value < 360));
    assert.deepEqual(sampleDeltaCurve(acrossCut, { mode: 'measured' }).targets, [350, 358, 2, 10],
        'the measured grid keeps the readings as written');
}

// ── Side checks reach the point evaluator ────────────────────────────────────
{
    const backContext = buildEvalContext(designWith(120, 200, { surfaceMode: 'back_only' }), resolveMat);
    const errors = operandEvaluationErrors(evaluateOperands(points.slice(0, 1), backContext));
    assert.match(errors[0], /front-side incidence/);
    const backBlock = makeMeasuredCurveOperand({ ...psiBlock, id: 'back-block', side: 'back' });
    const blockErrors = operandEvaluationErrors(evaluateOperands([backBlock], backContext));
    assert.match(blockErrors[0], /front side only/);
}

// ── The targets draw on the Ellipsometry plot, not on Optical Evaluation ─────
{
    const view = { mode: 'spectral', side: 'front', showPsi: true, showDelta: true, deltaConvention: 'azzam' };
    const withCurves = { measuredEllipsometry: [psiCurve, deltaCurve], meritOperands: fit.operands };
    assert.equal(measuredEllipsometryOverlays(withCurves, view).length, 2,
        'while the curves are drawn the targets are not, or the measurement would appear twice');

    const orphaned = { measuredEllipsometry: [], meritOperands: fit.operands };
    const targets = measuredEllipsometryOverlays(orphaned, view);
    assert.equal(targets.length, 2, 'a target whose curve is gone is drawn from its own snapshot');
    assert.ok(targets.every(overlay => overlay.name.includes('fit target') && overlay.aoi === AOI));
    assert.deepEqual(targets.find(overlay => !overlay.psi).y, fileDelta,
        'in the file’s own convention the snapshot is drawn as written');
    const reversed = measuredEllipsometryOverlays(orphaned, { ...view, deltaConvention: 'reversed' });
    assert.deepEqual(reversed.find(overlay => !overlay.psi).y, convertDeltaConvention(fileDelta, 'azzam', 'reversed'),
        'switching the plot’s convention moves the target with it');
    assert.equal(measuredEllipsometryOverlays(orphaned, { ...view, showDelta: false }).length, 1);
    assert.equal(measuredEllipsometryOverlays(orphaned, { ...view, side: 'back' }).length, 0);

    const hiddenDelta = { measuredEllipsometry: [psiCurve, { ...deltaCurve, visible: false }], meritOperands: fit.operands };
    const mixed = measuredEllipsometryOverlays(hiddenDelta, view);
    assert.equal(mixed.length, 2);
    assert.ok(mixed.some(overlay => !overlay.psi && overlay.name.includes('fit target')),
        'hiding the curve puts its target back on the plot');

    assert.equal(buildTargetGeometry(fit.operands).lines.length, 0,
        'a Ψ/Δ block is not drawn on a spectrum in percent');
    assert.equal(orphanFitBlocks(orphaned).length, 0,
        'Measured Spectra does not claim ellipsometric targets as its orphans');
}

// ── The curves come back from the targets ────────────────────────────────────
{
    const orphaned = { measuredEllipsometry: [], meritOperands: fit.operands };
    assert.equal(orphanEllipsometryFitBlocks(orphaned).length, 2);
    const restored = restoredEllipsometryCurves(orphaned);
    assert.equal(restored.measuredEllipsometry.length, 2);
    const [psiBack, deltaBack] = restored.measuredEllipsometry;
    assert.deepEqual([psiBack.quantity, deltaBack.quantity], ['PSI', 'DEL']);
    assert.equal(deltaBack.deltaConvention, 'azzam');
    assert.deepEqual(deltaBack.y, fileDelta);
    assert.equal(psiBack.aoi, AOI);
    assert.equal(restored.meritOperands[0].curveId, psiBack.id, 'each block adopts the curve it got back');
    const after = { ...orphaned, ...restored };
    assert.equal(orphanEllipsometryFitBlocks(after).length, 0);
    assert.equal(restoredEllipsometryCurves(after), null, 'restoring twice must not copy the curves');
}

// ── Output policy takes several blocks at once ───────────────────────────────
{
    const existing = makeOperand({ id: 'existing', type: 'T', lambdaStart: 550 });
    const appended = measuredFitMeritOperands([existing], fit.operands, {
        outputMode: 'append', constraintsEnabled: true,
        minThicknessNm: 12, maxThicknessNm: 900, constraintWeight: 3,
    });
    assert.deepEqual(appended.map(op => op.type), ['T', 'MCURVE', 'MCURVE', 'MNT', 'MXT']);
    assert.deepEqual(measuredFitMeritOperands([existing], fit.operands, { outputMode: 'replace' }).map(op => op.type),
        ['MCURVE', 'MCURVE']);
}

// ── The dialog's strings ─────────────────────────────────────────────────────
{
    const t = getLocale('en');
    const text = fitDialogText(t);
    assert.equal(text.fitTitle, t.measuredEllipsometry.fitTitle);
    assert.equal(text.fitErrors.aoi, t.measuredEllipsometry.fitErrors.aoi);
    assert.equal(text.fitErrors.range, t.spectrumExchange.fitErrors.range, 'the shared errors are kept');
    assert.equal(text.fitCreate, t.spectrumExchange.fitCreate);
}

// ── The merit table shows degrees, and still knows a pair an older design saved ──
{
    // Blocks written by a release that stamped Ψ and Δ as one fit carry a
    // shared pair id, and the table still calls out a switched-off partner.
    const paired = [{ ...psiBlock, pairId: 'pair-1' }, { ...deltaBlock, pairId: 'pair-1' }];
    const meta = rowDisplayMeta(psiBlock, 0.5, false);
    assert.equal(meta.isPhs, true);
    assert.equal(meta.phaseUnit, '°');
    assert.equal(meta.useFraction, false, 'a Ψ block is not shown in percent');
    assert.equal(meta.rawResidual, 0.5);
    assert.equal(fmtCurrent(0.5, meta), '0.500 °');
    assert.deepEqual(editableColsForRow(psiBlock), ['enabled', 'weight']);
    const spectrumMeta = rowDisplayMeta(makeMeasuredCurveOperand({ quantity: 'R' }), 0.012, false);
    assert.equal(spectrumMeta.rawResidual, 1.2, 'a photometric block still reads in percent');

    shimBrowserGlobals();
    await loadApp();
    const { rowRenderers } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandCells.js'
    );
    const c = makeTheme();
    const t = getLocale('en');
    const typeCell = (op, operands) => rowRenderers(op, meta).type(
        { op, c, t, operands, tdBase: () => ({}) }, 'type', 60);
    const alone = typeCell(psiBlock, [psiBlock, deltaBlock]);
    assert.equal(alone.props.children, 'MCURVE Ψ', 'the row names its channel');
    assert.equal(alone.props.style.color, c.text, 'a block fitted on its own has no partner to miss');

    const complete = typeCell(paired[0], paired);
    assert.equal(complete.props.style.color, c.text);
    assert.ok(!complete.props.title.includes('Δ of this measurement'));
    const halfOff = typeCell(paired[0], [paired[0], { ...paired[1], enabled: false }]);
    assert.equal(halfOff.props.style.color, c.warning, 'a switched-off partner is called out');
    assert.ok(halfOff.props.title.includes(t.meritFunctionEditor.measuredPairOff('Δ')));
    const halfGone = typeCell(paired[0], [paired[0]]);
    assert.ok(halfGone.props.title.includes(t.meritFunctionEditor.measuredPairGone('Δ')));

    const polCell = rowRenderers(psiBlock, meta).pol({ op: psiBlock, c, tdBase: () => ({}) }, 'pol', 40);
    assert.equal(polCell.props.children, '—', 'Ψ and Δ use both polarizations');
}

// ── Known-design recovery through the ordinary least-squares path ────────────
{
    const optimizer = new DLSOptimizer(fit.operands, designWith(100, 215), resolveMat);
    assert.equal(optimizer.operands.length, 2 * lambdas.length, 'the optimizer expands both blocks');
    for (let iteration = 0; iteration < 80 && !optimizer.isConverged(); iteration++) optimizer.step();
    optimizer.restoreBest();
    assert.ok(Math.abs(optimizer.thicknesses[0] - 120) < 0.05 && Math.abs(optimizer.thicknesses[1] - 200) < 0.05,
        `expected 120 / 200 nm, got ${optimizer.thicknesses.map(v => v.toFixed(3))}`);
    assert.ok(optimizer.mfBest < 1e-6, `expected a near-zero recovered MF, got ${optimizer.mfBest}`);
}

console.log('PASS: measured_ellipsometry_merit');
