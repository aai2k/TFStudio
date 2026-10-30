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
 *      cone to, given the design as the window sends it;
 *   7. Inhomogeneities, with no interlayers and with an interlayer between two
 *      halves of the layer, which is that layer made thicker, and Roughness,
 *      with σ 0 and with σ 2 nm of either kind between two halves of the
 *      layer, which leaves the design as it was; and the worker's evaluations
 *      of both windows.
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
const { inhomogeneitySpectraState } = await import('../src/components/windows/analysis/inhomogeneities/model.js');
const { calculateRoughness } = await import('../src/components/windows/analysis/roughnessScattering/model.js');
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

// ── 7. Inhomogeneities and Roughness ─────────────────────────────────────────
{
    const params = { ...range, theta: 45, polarization: 'avg' };
    const none = { interlayers: [], backInterlayers: [] };
    const plain = inhomogeneitySpectraState({ design, params, inh: none, evalMode: mode });
    assert.equal(plain.error, null);
    for (const key of ['R', 'T', 'A', 'Rs', 'Tp']) {
        close(plain.baseline[key], at45[key], `Inhomogeneities homogeneous ${key}`);
        close(plain.perturbed[key], at45[key], `Inhomogeneities graded ${key} with no interlayers`);
    }
    // The fixture's one layer in two halves, a 10 nm interlayer of its own
    // material between them: the layer 10 nm thicker, as Optical Evaluation
    // shows it.
    const [layer] = design.frontLayers;
    const halves = { ...design, frontLayers: [{ ...layer, thickness: layer.thickness / 2 }, { ...layer, thickness: layer.thickness / 2 }] };
    const thicker = computeOpticalSpectrum({ ...design, frontLayers: [{ ...layer, thickness: layer.thickness + 10 }] },
        { ...range, thetas: [45] }, mode).series[0];
    const graded = { interlayers: [{ afterIndex: 0, thickness: 10, profile: 'sigmoid', slices: 7, enabled: true }], backInterlayers: [] };
    const split = inhomogeneitySpectraState({ design: halves, params, inh: graded, evalMode: mode });
    close(split.perturbed.R, thicker.R, 'Inhomogeneities graded R, an interlayer inside the layer');
    close(split.perturbed.T, thicker.T, 'Inhomogeneities graded T, an interlayer inside the layer');

    const smoothOnly = calculateRoughness({ design, params, rough: { mode: 'uniform', sigma: 0, range: 'long' }, evalMode: mode });
    assert.equal(smoothOnly.error, null);
    for (const key of ['R', 'T', 'Rs', 'Tp']) {
        close(smoothOnly.data.ideal[key], at45[key], `Roughness smooth ${key}`);
        close(smoothOnly.data.specular[key], at45[key], `Roughness rough ${key} at σ 0`);
    }
    // A rough interface inside one material takes its 2σ out of the layer
    // beneath and puts back the same material, so the design is unchanged.
    for (const kind of ['short', 'long']) {
        const rough = { mode: 'perInterface', sigma: 0, range: kind, sigmas: [0, 2, 0], ranges: [] };
        const inside = calculateRoughness({ design: halves, params, rough, evalMode: mode });
        close(inside.data.specular.R, at45.R, `Roughness rough R, ${kind} range inside the layer`);
        close(inside.data.specular.T, at45.T, `Roughness rough T, ${kind} range inside the layer`);
    }

    const sent = embedDesignMaterials(halves);
    const request = { design: halves, params, inh: graded, evalMode: mode };
    assert.deepEqual(dispatchAnalysisEvaluation('inhomogeneitySpectra', { ...request, design: sent }), split,
        'the worker draws the Inhomogeneities spectra the window would');
    const roughRequest = { design: halves, params, rough: { mode: 'uniform', sigma: 1.5, range: 'short' }, evalMode: mode };
    assert.deepEqual(dispatchAnalysisEvaluation('roughnessSpectra', { ...roughRequest, design: sent }), calculateRoughness(roughRequest),
        'the worker draws the Roughness spectra the window would');
}

console.log('PASS: cone_matches_optical_evaluation');
