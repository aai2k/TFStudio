/**
 * The report prints what the analysis windows show for a design with a cone
 * angle.
 *
 * Optical Evaluation, Integral Values and Color Evaluation average every
 * spectrum over the design's cone of incidence, and so does the report: a
 * collimated beam at the cone axis would give a spectrum, colour and integrals
 * that disagree with the windows for the same design. A design without a cone
 * prints the collimated result.
 */
import assert from 'node:assert/strict';

globalThis.window = Object.assign(new EventTarget(), { electronAPI: {} });

const [
    { buildSpectrum, computeColor, computeIntegrals },
    { computeOpticalSpectrum },
    { computeSpectrumForMode },
    { computeColorReport },
    { computeIntegralValueBatch, DEFAULT_INTEGRALS },
    { resolveEvalMode },
    { evaluateSpectrum },
    { designMaterialLookup },
] = await Promise.all([
    import('../src/utils/report/reportData.js'),
    import('../src/components/windows/analysis/opticalEvaluation/spectrum.js'),
    import('../src/components/windows/analysis/integralValues/spectrum.js'),
    import('../src/components/windows/analysis/colorEvaluation/colorModel.js'),
    import('../src/utils/physics/integralValues.js'),
    import('../src/utils/physics/optimizer.js'),
    import('../src/utils/physics/thinFilmMath.js'),
    import('../src/utils/materials/designMaterials.js'),
]);

const stack = Array.from({ length: 15 }, (_, index) => ({
    id: `l${index}`, material: index % 2 ? 'builtin:SiO2' : 'builtin:TiO2', thickness: index % 2 ? 94 : 57,
}));
const collimated = {
    id: 'd', name: 'd', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', referenceWavelength: 550,
    substrate: { material: 'builtin:BK7', thickness: 1 }, surfaceMode: 'front_only',
    frontLayers: stack, backLayers: [],
};
const coned = { ...collimated, cone: { enabled: true, halfAngleDeg: 25 } };
const close = (actual, expected, label) => {
    assert.equal(actual.length, expected.length, `${label}: length`);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12,
        `${label}[${index}]: report ${value}, window ${expected[index]}`));
};

// ── Spectrum: the values Optical Evaluation draws ────────────────────────────
{
    const range = { lambdaStart: 600, lambdaEnd: 640, lambdaStep: 20, thetas: [0, 30] };
    const report = buildSpectrum(coned, range);
    const shown = computeOpticalSpectrum(coned, { ...range, polarization: 'avg' }, resolveEvalMode(coned));
    report.series.forEach((series, index) => {
        for (const key of ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp']) {
            close(series[key], shown.series[index][key], `θ=${series.theta} ${key}`);
        }
    });
    assert.deepEqual(Object.keys(report.series[0]).sort(),
        ['A', 'Ap', 'As', 'R', 'Rp', 'Rs', 'T', 'Tp', 'Ts', 'theta'], 'the output shape is unchanged');
    assert.equal(report.evalMode, 'front');
}

// ── Integral values: the numbers Integral Values prints ──────────────────────
{
    const report = computeIntegrals(coned, { theta: 0, pol: 'avg' });
    const spectrum = computeSpectrumForMode(coned,
        { lambdaStart: 280, lambdaEnd: 2500, lambdaStep: 5, theta: 0, polarization: 'avg' }, 'front');
    const shown = computeIntegralValueBatch(spectrum, DEFAULT_INTEGRALS);
    assert.deepEqual(report.values, shown);
}

// ── Colour: the coordinates Color Evaluation shows ───────────────────────────
{
    const options = { characteristic: 'R', pol: 'avg', theta: 0, observer: '2', illuminant: 'D65', step: 5 };
    const report = computeColor(coned, options).report;
    const shown = computeColorReport({ design: coned, evalMode: 'front', setError() {}, ...options });
    assert.ok(Math.abs(report.xy.x - shown.xy.x) < 1e-12 && Math.abs(report.xy.y - shown.xy.y) < 1e-12,
        `report xy (${report.xy.x}, ${report.xy.y}), window xy (${shown.xy.x}, ${shown.xy.y})`);
}

// ── Without a cone nothing changes ───────────────────────────────────────────
{
    const resolve = designMaterialLookup(collimated);
    const layers = stack.map(layer => ({ material: resolve(layer.material), thickness: layer.thickness }));
    const report = buildSpectrum(collimated, { lambdaStart: 600, lambdaEnd: 640, lambdaStep: 20, thetas: [10] });
    const direct = evaluateSpectrum(
        { lambdaStart: 600, lambdaEnd: 640, lambdaStep: 20, theta: 10, polarization: 'avg' },
        resolve('builtin:Air'), resolve('builtin:BK7'), layers);
    for (const key of ['T', 'R', 'A', 'Ts', 'Rs', 'As', 'Tp', 'Rp', 'Ap']) {
        assert.deepEqual(report.series[0][key], direct[key], `${key} is the collimated value, bit for bit`);
    }
}

console.log('PASS: readers_report_cone');
