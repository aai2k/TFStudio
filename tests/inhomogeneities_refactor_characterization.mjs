import assert from 'node:assert/strict';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ Inhomogeneities }, figure, model] = await Promise.all([
    import('../src/components/windows/analysis/inhomogeneities/Inhomogeneities.js'),
    import('../src/components/windows/analysis/inhomogeneities/figure.js'),
    import('../src/components/windows/analysis/inhomogeneities/model.js'),
]);

const c = makeTheme();
const t = makeLocale();

const baseline = {
    lambda: [500], T: [0.4], R: [0.5], A: [0.1],
    Ts: [0.42], Rs: [0.48], Tp: [0.38], Rp: [0.52],
};
const perturbed = {
    lambda: [500], T: [0.3], R: [0.55], A: [0.15],
    Ts: [0.32], Rs: [0.53], Tp: [0.28], Rp: [0.57],
};
const allOn = { T: true, R: true, A: true };
const series = figure.buildOverlaySeries(baseline, perturbed, allOn);
assert.deepEqual(series.map(item => item.name), [
    'T base', 'T graded',
    'R base', 'R graded',
    'A base', 'A graded',
]);
assert.deepEqual(series.map(item => item.lineStyle), [
    { color: '#4fc3f7', width: 1.4, type: 'dotted', opacity: 0.55 },
    { color: '#4fc3f7', width: 2, type: 'solid' },
    { color: '#ef5350', width: 1.4, type: 'dotted', opacity: 0.55 },
    { color: '#ef5350', width: 2, type: 'solid' },
    { color: '#66bb6a', width: 1.4, type: 'dotted', opacity: 0.55 },
    { color: '#66bb6a', width: 2, type: 'solid' },
]);
assert.deepEqual(series.map(item => item.data.map(point => point[1])), [[40], [30], [50], [55.00000000000001], [10], [15]]);

// A polarization is picked from the spectrum that was already computed, so it
// draws a curve of its own rather than replacing T and R.
assert.deepEqual(
    figure.buildOverlaySeries(baseline, perturbed, { T: true, Ts: true, Tp: true })
        .map(item => item.name),
    [
        'T base', 'T graded',
        'Ts base', 'Ts graded',
        'Tp base', 'Tp graded',
    ]);
assert.deepEqual(figure.enabledOverlayCurves({ A: true, R: true, Ts: true }), ['Ts', 'R', 'A'],
    'the drawing order follows the control row, not the order the keys were set');
assert.deepEqual(figure.buildOverlaySeries(baseline, perturbed, {}), [],
    'switching every curve off leaves an empty plot rather than falling back to all of them');

// The legend is localized: the window passes the locale's wording through.
assert.deepEqual(
    figure.buildOverlaySeries(baseline, perturbed, { T: true }, undefined,
        { homogeneous: 'однородн.', graded: 'с переходными' }).map(item => item.name),
    ['T однородн.', 'T с переходными']);

const design = makeSampleDesign();
design.backLayers = [{ id: 'b1', material: 'builtin:SiO2', thickness: 80 }];
const inh = {
    interlayers: [{ afterIndex: 0, thickness: 5, profile: 'linear', slices: 4, enabled: true }],
    backInterlayers: [{ afterIndex: -1, thickness: 3, profile: 'linear', slices: 3, enabled: true }],
};
const stacks = model.buildExpandedStacks(design, inh);
assert.equal(stacks.frontExp.length, 6);
assert.equal(stacks.backExp.length, 4);
const specInputs = model.buildSpecificationInputs(design, inh);
assert.equal(specInputs.specDesign.frontLayers.length, 6);
assert.equal(specInputs.specDesign.backLayers.length, 4);
assert.equal(specInputs.resolve(specInputs.specDesign.frontLayers[1].material), specInputs.specDesign.frontLayers[1].material);

const params = {
    lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1, theta: 0, polarization: 'avg',
};
for (const mode of ['front', 'back', 'total']) {
    const spectra = model.computeInhomogeneitySpectra(design, params, inh, mode);
    const homogeneous = model.computeInhomogeneitySpectra(
        design, params, { interlayers: [], backInterlayers: [] }, mode,
    );
    assert.deepEqual(spectra.baseline, homogeneous.baseline);
    assert.deepEqual(homogeneous.perturbed, homogeneous.baseline);
    assert.equal(spectra.perturbed.lambda.length, 1);
    assert.notEqual(spectra.perturbed.T[0], spectra.baseline.T[0]);
}

// ── A (s) and A (p) ───────────────────────────────────────────────────────────
// Every switch has a curve, a colour and a place in the table, so A gets s and
// p beside the average the way T and R do.
{
    const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
    const { overlayColumns } = await import('../src/components/windows/analysis/inhomogeneities/tableModel.js');
    const colors = ANALYSIS_DEFAULTS.inhomogeneities.colors;
    for (const { q, members } of figure.CURVE_GROUPS) {
        assert.deepEqual(members.map(member => member.pol), ['avg', 's', 'p'], `${q} offers avg, s and p`);
        for (const { key } of members) {
            assert.ok(figure.OVERLAY_CURVES.includes(key), `${key} is drawn`);
            assert.match(colors[key], /^#[0-9a-f]{6}$/, `${key} has a colour`);
        }
    }
    const withA = { ...perturbed, As: [0.12], Ap: [0.18] };
    const drawn = figure.buildOverlaySeries({ ...baseline, As: [0.08], Ap: [0.12] }, withA, { A: true, As: true, Ap: true });
    assert.deepEqual(drawn.map(item => item.name),
        ['A base', 'A graded', 'As base', 'As graded', 'Ap base', 'Ap graded']);
    assert.deepEqual(drawn.filter((_, i) => i % 2).map(item => item.lineStyle.color), ['#66bb6a', '#a5d6a7', '#2e7d32']);
    assert.deepEqual(overlayColumns(t, { As: true, Ap: true }).map(column => column.key).slice(-4),
        ['As0', 'As', 'Ap0', 'Ap'], 'the table has a homogeneous and a graded column for each');

    // A thin chromium film under silica at 45°: s and p absorb differently, and
    // their mean is the A the window already drew.
    const absorbing = {
        ...makeSampleDesign(),
        frontLayers: [{ id: 'c1', material: 'builtin:Cr', thickness: 8 }, { id: 'c2', material: 'builtin:SiO2', thickness: 95 }],
        backLayers: [{ id: 'c3', material: 'builtin:Cr', thickness: 5 }],
    };
    const oblique = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, theta: 45, polarization: 'avg' };
    for (const mode of ['front', 'back', 'total']) {
        const { perturbed: spectrum } = model.computeInhomogeneitySpectra(absorbing, oblique, inh, mode);
        assert.ok(spectrum.As && spectrum.Ap, `${mode}: the spectrum carries As and Ap`);
        spectrum.A.forEach((value, i) => {
            assert.ok(Math.abs((spectrum.As[i] + spectrum.Ap[i]) / 2 - value) < 1e-12, `${mode}: (As + Ap) / 2 = A`);
            assert.ok(Math.abs(spectrum.As[i] - spectrum.Ap[i]) > 1e-4, `${mode}: s and p absorb differently`);
        });
    }
}

console.log('PASS: inhomogeneities_refactor_characterization');
