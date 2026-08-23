import assert from 'node:assert/strict';
import { dispatchAnalysisEvaluation } from '../src/utils/workers/analysisEvaluationWorker.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';

const design = {
    id: 'analysis-worker', name: 'Analysis worker fixture',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    cone: { enabled: true, halfAngleDeg: 4, distribution: 'uniform', gridPoints: 2 },
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 60, locked: false },
        { id: 'b', material: 'SiO2', thickness: 90, locked: false },
    ],
    backLayers: [],
};

const spectrum = dispatchAnalysisEvaluation('opticalSpectrum', {
    design, evalMode: 'front',
    params: { lambdaStart: 500, lambdaEnd: 504, lambdaStep: 2, thetas: [0] },
});
assert.equal(spectrum.lambda.length, 3);
assert.equal(spectrum.series.length, 1);
assert.ok(spectrum.series[0].R.every(Number.isFinite));

const integralSpectrum = dispatchAnalysisEvaluation('integralSpectrum', {
    design, evalMode: 'front',
    params: { lambdaStart: 500, lambdaEnd: 504, lambdaStep: 2, theta: 0, polarization: 'avg' },
});
assert.equal(integralSpectrum.lambda.length, 3);
assert.ok(integralSpectrum.T.every(Number.isFinite));

const monitorValues = dispatchAnalysisEvaluation('statusMonitors', {
    design,
    monitors: [
        { type: 'fact', fact: 'layerCount' },
        { type: 'point', qty: 'R', lambda: 550, aoi: 0, pol: 'avg' },
    ],
});
assert.equal(monitorValues[0], 2);
assert.ok(Number.isFinite(monitorValues[1]));

const operands = [makeOperand({
    type: 'RAV', lambdaStart: 500, lambdaEnd: 504,
    aoi: 0, pol: 'avg', target: 0.5, weight: 1,
})];
const merit = dispatchAnalysisEvaluation('meritDisplay', { design, operands });
assert.equal(merit.computed.length, 1);
assert.ok(Number.isFinite(merit.mf));
assert.ok(Number.isFinite(merit.omf));

const candidateDesign = {
    ...design,
    frontLayers: design.frontLayers.map((layer, index) => index === 0
        ? { ...layer, thickness: layer.thickness + 2 }
        : layer),
};
const meritPair = dispatchAnalysisEvaluation('meritPair', { design, candidateDesign, operands });
assert.ok(Number.isFinite(meritPair.before.mf));
assert.ok(Number.isFinite(meritPair.after.mf));
assert.ok(Number.isFinite(meritPair.before.omf));
assert.ok(Number.isFinite(meritPair.after.omf));

const timeline = dispatchAnalysisEvaluation('meritTimeline', {
    design,
    designs: [{ ...design, meritOperands: operands }, { ...candidateDesign, meritOperands: operands }],
});
assert.equal(timeline.length, 2);
assert.ok(timeline.every(entry => Number.isFinite(entry.mf) && entry.materialMissing === false));

assert.throws(
    () => dispatchAnalysisEvaluation('not-real', { design }),
    /Unknown analysis evaluation/,
);

console.log('PASS: analysis_evaluation_worker');
