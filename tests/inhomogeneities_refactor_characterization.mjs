import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
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
const html = renderToStaticMarkup(withDesign(
    React.createElement(Inhomogeneities, { c, t, theme: c }),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), '95be4f034e5ee3ad');

const baseline = {
    lambda: [500], T: [0.4], R: [0.5], A: [0.1],
    Ts: [0.42], Rs: [0.48], Tp: [0.38], Rp: [0.52],
};
const perturbed = {
    lambda: [500], T: [0.3], R: [0.55], A: [0.15],
    Ts: [0.32], Rs: [0.53], Tp: [0.28], Rp: [0.57],
};
const allOn = { T: true, R: true, A: true };
const traces = figure.buildOverlayTraces(baseline, perturbed, allOn);
assert.deepEqual(traces.map(trace => trace.name), [
    'T homogeneous', 'T with interlayers',
    'R homogeneous', 'R with interlayers',
    'A homogeneous', 'A with interlayers',
]);
assert.deepEqual(traces.map(trace => trace.line), [
    { color: '#4fc3f7', dash: 'dot', width: 1.4 },
    { color: '#4fc3f7', width: 2 },
    { color: '#ef5350', dash: 'dot', width: 1.4 },
    { color: '#ef5350', width: 2 },
    { color: '#66bb6a', dash: 'dot', width: 1.4 },
    { color: '#66bb6a', width: 2 },
]);
assert.deepEqual(traces.map(trace => trace.y), [[40], [30], [50], [55.00000000000001], [10], [15]]);

// A polarization is picked from the spectrum that was already computed, so it
// draws a curve of its own rather than replacing T and R.
assert.deepEqual(
    figure.buildOverlayTraces(baseline, perturbed, { T: true, Ts: true, Tp: true })
        .map(trace => trace.name),
    [
        'T homogeneous', 'T with interlayers',
        'Ts homogeneous', 'Ts with interlayers',
        'Tp homogeneous', 'Tp with interlayers',
    ]);
assert.deepEqual(figure.enabledOverlayCurves({ A: true, R: true, Ts: true }), ['Ts', 'R', 'A'],
    'the drawing order follows the control row, not the order the keys were set');
assert.deepEqual(figure.buildOverlayTraces(baseline, perturbed, {}), [],
    'switching every curve off leaves an empty plot rather than falling back to all of them');

// The legend is localized: the window passes the locale's wording through.
assert.deepEqual(
    figure.buildOverlayTraces(baseline, perturbed, { T: true }, undefined,
        { homogeneous: 'однородн.', graded: 'с переходными' }).map(trace => trace.name),
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

console.log('PASS: inhomogeneities_refactor_characterization');
