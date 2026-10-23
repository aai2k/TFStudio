/**
 * The windows that draw a design's spectrum outside Optical Evaluation show
 * what it shows under a cone of incidence.
 *
 * Optical Evaluation averages every spectrum over the design's cone. On the
 * cone-user-distribution fixture (a 12° cone with a user intensity table) the
 * same averages are drawn by
 *   1. the wavelength-angle map, for each channel and polarization;
 *   2. the Plot Engine surface at a fixed wavelength, which takes one point at
 *      a time;
 *   3. the Plot Engine curves, along wavelength and along angle;
 *   4. the Variator, both arms;
 *   5. the Measured Spectra preview and the curve editor's backdrop;
 *   6. the analysis worker's evaluations those windows send a design under a
 *      cone to, given the design as the window sends it.
 *
 * Run: node tests/cone_matches_optical_evaluation.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixtureFile } from './_apiCorpus.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');

const api = await import('../src/api/index.js');
const { computeOpticalSpectrum } = await import('../src/components/windows/analysis/opticalEvaluation/spectrum.js');
const { computeSurface } = await import('../src/utils/physics/plotQuantities.js');
const { buildMapSpec } = await import('../src/components/windows/analysis/wavelengthAngleMap/mapSpec.js');
const { computeCurveResults } = await import('../src/components/windows/analysis/plotEngine/curveResults.js');
const { computeVariatorSpectrum, captureVariatorBaseline } = await import('../src/components/windows/optimization/variator/model.js');
const { designPreview, previewGrid } = await import('../src/components/windows/dataExchange/spectrumExchange/designPreview.js');
const { designBackdrop } = await import('../src/components/windows/dataExchange/curveEditor/designBackdrop.js');
const { tableFromCurve } = await import('../src/components/windows/dataExchange/curveEditor/curveTable.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { designMaterialLookup, embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { resolveEvalMode, makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');

await api.init();

const design = api.openDesign(fixtureFile('cone-user-distribution'));
assert.ok(coneIsActive(makeConeSpec(design.cone)), 'the fixture is under a cone');
const mode = resolveEvalMode(design);
const range = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 50 };
const angles = [0, 45];
const shown = computeOpticalSpectrum(design, { ...range, thetas: angles }, mode);
const at45 = shown.series[1];
const i550 = shown.lambda.indexOf(550);

const close = (actual, expected, label) => {
    assert.equal(actual.length, expected.length, `${label}: length`);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12,
        `${label}[${index}]: ${value}, Optical Evaluation ${expected[index]}`));
};

// The cone moves R at 45°, so a window drawing the collimated value fails here.
{
    const collimated = computeOpticalSpectrum({ ...design, cone: undefined }, { ...range, thetas: [45] }, mode);
    assert.ok(Math.abs(collimated.series[0].R[i550] - at45.R[i550]) > 1e-3,
        `the cone changes R at 550 nm, 45° (${collimated.series[0].R[i550]} against ${at45.R[i550]})`);
}

// ── 1. The wavelength-angle map ──────────────────────────────────────────────
for (const channel of ['T', 'R', 'A']) {
    for (const pol of ['avg', 's', 'p']) {
        const spec = buildMapSpec({
            ...range, angleStart: 0, angleEnd: 45, angleStep: 45, channel, pol,
        }, mode);
        const map = computeSurface(spec, design, designMaterialLookup(design));
        assert.ok(map.ok, `map ${channel} ${pol}`);
        const key = pol === 'avg' ? channel : `${channel}${pol}`;
        angles.forEach((theta, row) => close(map.z[row], shown.series[row][key], `map ${key} at ${theta}°`));
    }
}

// ── 2. The Plot Engine surface, one point at a time ──────────────────────────
{
    const thickness = design.frontLayers[0].thickness;
    const surface = computeSurface({
        z: 'R', polarization: 'avg', surfaceMode: mode, fixedLambda_nm: 550, fixedAOI_deg: 0,
        xVar: 'thk:0', xFrom: thickness, xTo: thickness, xSteps: 2,
        yVar: 'aoi', yFrom: 0, yTo: 45, ySteps: 2,
    }, design, designMaterialLookup(design));
    assert.ok(surface.ok);
    close([surface.z[0][0], surface.z[1][0]], [shown.series[0].R[i550], at45.R[i550]], 'surface R at 550 nm');
}

// ── 3. The Plot Engine curves ────────────────────────────────────────────────
const curves = [
    { id: 'lambda', visible: true, xAxis: 'wavelength', yChannel: 'R', polarization: 'avg', surfaceMode: mode,
        aoiFixed_deg: 45, rangeFrom: 400, rangeTo: 800, rangeStep: 50 },
    { id: 'lambda-s', visible: true, xAxis: 'wavelength', yChannel: 'T', polarization: 's', surfaceMode: mode,
        aoiFixed_deg: 45, rangeFrom: 400, rangeTo: 800, rangeStep: 50 },
    { id: 'aoi', visible: true, xAxis: 'aoi', yChannel: 'R', polarization: 'avg', surfaceMode: mode,
        lambdaFixed_nm: 550, rangeFrom: 0, rangeTo: 45, rangeStep: 45 },
];
const curveResults = computeCurveResults(curves, design);
{
    close(curveResults.lambda.y, at45.R, 'curve R along wavelength at 45°');
    close(curveResults['lambda-s'].y, at45.Ts, 'curve Ts along wavelength at 45°');
    close(curveResults.aoi.y, [shown.series[0].R[i550], at45.R[i550]], 'curve R along angle at 550 nm');
}

// ── 4. The Variator ──────────────────────────────────────────────────────────
const variatorRequest = {
    design, params: { ...range, theta: 45, polarization: 'avg' }, evalMode: mode,
    dN: {}, dK: {}, baseline: captureVariatorBaseline(design),
};
const variator = computeVariatorSpectrum(variatorRequest);
{
    close(variator.R, at45.R, 'Variator R');
    close(variator.T, at45.T, 'Variator T');
    close(variator.Rbase, at45.R, 'Variator baseline R');
}

// ── 5. The Measured Spectra preview and the curve editor's backdrop ──────────
const measured = { x: [400, 600, 800], y: [0.02, 0.02, 0.02], quantity: 'R', aoi: 45, pol: 'avg' };
const fine = computeOpticalSpectrum(design, { ...previewGrid(400, 800), thetas: [45] }, mode).series[0];
const preview = designPreview(design, measured, []);
{
    assert.equal(preview.error, null);
    close(preview.data.series[0].R, fine.R, 'Measured Spectra preview R');
}
const table = tableFromCurve(measured, 'spectrum');
const conditions = { aoi: 45, pol: 'avg' };
const backdrop = designBackdrop(design, table, conditions, []);
close(backdrop[0].y, fine.R, 'curve editor backdrop R');

// ── 6. The analysis worker's evaluations ─────────────────────────────────────
{
    const sent = embedDesignMaterials(design);
    assert.deepEqual(dispatchAnalysisEvaluation('plotCurves', { design: sent, curves }), curveResults,
        'the worker draws the Plot Engine curves the window would');
    assert.deepEqual(dispatchAnalysisEvaluation('variatorSpectrum', { ...variatorRequest, design: sent }), variator,
        'the worker draws the Variator spectrum the window would');
    assert.deepEqual(dispatchAnalysisEvaluation('designPreview', { design: sent, curve: measured, missing: [] }), preview,
        'the worker draws the Measured Spectra preview the window would');
    assert.deepEqual(dispatchAnalysisEvaluation('designBackdrop', { design: sent, table, conditions, missing: [] }), backdrop,
        "the worker draws the curve editor's backdrop the window would");
}

console.log('PASS: cone_matches_optical_evaluation');
