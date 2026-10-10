/**
 * Ellipsometry names a fit target drawn from its snapshot as a target.
 *
 * A Ψ/Δ fit target whose curve is no longer on the plot is drawn from the
 * snapshot its merit row carries. Its legend name says it is a fit target, with
 * its quantity and angle, and does not call it a measurement: not
 * 'film (fit target) (Δ meas @ 65°)'. A measured curve keeps its measured name.
 *
 * Run: node tests/ellipsometry_fit_target_name.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { measuredEllipsometryOverlays } = await import('../src/components/windows/analysis/ellipsometryEvaluation/model.js');
const { buildEllipsometryOption } = await import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const design = {
    measuredEllipsometry: [{ id: 'psi', name: 'film', quantity: 'PSI', aoi: 65, x: [500, 600], y: [20, 30], deltaConvention: 'azzam' }],
    meritOperands: [{ id: 'fit', enabled: true, type: 'MCURVE', quantity: 'DEL', curveId: 'gone', curveName: 'film', aoi: 65,
        sampleLambdas: [500, 600], sampleTargets: [100, 120], deltaConvention: 'azzam' }],
};
const view = { mode: 'spectral', side: 'front', showPsi: true, showDelta: true, deltaConvention: 'azzam' };
const overlays = measuredEllipsometryOverlays(design, view, EN.legendNames);
const option = buildEllipsometryOption({ x: [500, 600], psi: [20, 30], delta: [100, 120] }, {}, 'λ',
    { overlays, spectral: true, names: EN.legendNames });
const names = option.series.map(series => series.name);

assert.ok(names.includes('film (Ψ meas @ 65°)'), `the measured Ψ keeps its name: ${names}`);
assert.ok(names.includes('film (Δ fit target @ 65°)'), `the Δ target is named as a fit target: ${names}`);
assert.equal(names.filter(name => /meas/.test(name)).length, 1, `only the measurement says meas: ${names}`);

console.log('Ellipsometry fit target name tests passed.');
