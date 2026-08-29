/**
 * Measured curves drawn over the calculated ones.
 *
 * Two rules, both of which were broken:
 *
 *  - A measurement is drawn once. A fit target holds a snapshot of the curve it
 *    was made from, so a design that has both drew the same numbers twice, the
 *    second time as a target line with no name, which is what the tooltip
 *    showed: the curve, then a bare dot repeating its value.
 *  - Measured Ψ/Δ is drawn at all. It had a visibility checkbox and an importer
 *    and nothing put it on the ellipsometry plot.
 *
 * Run: node tests/measured_overlays_on_plots.mjs
 */

import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildChartSeries, buildMeasuredSeries } =
    await import('../src/components/windows/analysis/opticalEvaluation/model.js');
const { buildTargetGeometry } = await import('../src/utils/physics/spectrumTargets.js');
const { measuredEllipsometryOverlays } =
    await import('../src/components/windows/analysis/ellipsometryEvaluation/model.js');
const { buildEllipsometryOption } =
    await import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js');
const { convertDeltaConvention } = await import('../src/utils/physics/thinFilmMath.js');

// ── Optical Evaluation: one measurement, one curve ───────────────────────────

const lambdas = [400, 500, 600, 700];
const values = [0.9, 0.92, 0.93, 0.91];

const curve = {
    id: 'curve-1', name: 'hr_spectrum: T %', quantity: 'T',
    x: lambdas, xUnit: 'nm', y: values, color: '#4aa3ff', aoi: 0, pol: 'avg', side: 'front',
};
const fitBlock = {
    id: 'op-1', type: 'MCURVE', enabled: true, curveId: 'curve-1',
    curveName: 'hr_spectrum: T %', quantity: 'T',
    sampleLambdas: lambdas, sampleTargets: values,
};
const data = { lambda: lambdas, series: [{ theta: 0, T: values, R: values, A: values }] };
const showCurves = { T: true, R: false, A: false, Ts: false, Rs: false, Tp: false, Rp: false };

const seriesFor = (overlays, targets) => buildChartSeries({
    data, showCurves, targets, targetsVisible: true, overlays,
});

// The curve is on the design and a fit target was made from it: one line.
const both = seriesFor([curve], [fitBlock]);
const measuredLines = both.filter(s => s.name && s.name.includes('hr_spectrum'));
assert.equal(measuredLines.length, 1, 'the measurement is drawn once, not once per source');

// And nothing nameless is left repeating its values.
const namelessAtSameValues = both.filter(s =>
    !s.name && Array.isArray(s.data)
    && s.data.some(point => Array.isArray(point?.value ?? point)
        && (point.value ?? point)[1] === values[0] * 100));
assert.deepEqual(namelessAtSameValues, [],
    'no unnamed target line sits on top of the measurement');

// A merit function loaded into a design that does not carry the curve still
// draws the snapshot: that is what the snapshot is for.
const orphaned = seriesFor([], [fitBlock]);
assert.ok(
    orphaned.some(s => s.data?.length && !s.name),
    'a fit target whose curve is gone is still drawn from its own snapshot');

// The same rule at the geometry level, where the decision is made.
assert.equal(buildTargetGeometry([fitBlock]).lines.length, 1);
assert.equal(
    buildTargetGeometry([fitBlock], { drawnCurveIds: new Set(['curve-1']) }).lines.length, 0);
assert.equal(
    buildTargetGeometry([fitBlock], { drawnCurveIds: new Set(['other']) }).lines.length, 1,
    'a different curve being drawn does not hide this block');

// A hidden curve is not drawn, so its fit target goes back to the snapshot.
const hidden = { ...curve, visible: false };
assert.equal(buildMeasuredSeries([hidden]).length, 0);
assert.equal(seriesFor([hidden], [fitBlock]).filter(s => s.data?.length && !s.name).length, 1,
    'hiding the curve leaves the target visible, not the plot empty');

// ── The measured curve keeps a tooltip swatch ────────────────────────────────

const [measured] = buildMeasuredSeries([curve]);
assert.equal(measured.itemStyle.color, curve.color,
    'a transparent fill leaves the tooltip with an invisible marker');
assert.equal(measured.symbol, 'emptyCircle',
    'the reading is still drawn hollow, so it reads as a measurement');

// ── Ellipsometry: measured Ψ/Δ reaches the plot ──────────────────────────────

const psi = {
    id: 'psi-1', name: 'sample', quantity: 'PSI', x: lambdas, xUnit: 'nm',
    y: [20, 21, 22, 23], aoi: 65, side: 'front', color: '#8ad',
};
const delta = {
    id: 'del-1', name: 'sample', quantity: 'DEL', x: lambdas, xUnit: 'nm',
    y: [100, 110, 120, 130], aoi: 65, side: 'front', color: '#d8a',
    deltaConvention: 'azzam',
};
const design = { measuredEllipsometry: [psi, delta] };
const view = { mode: 'spectral', side: 'front', showPsi: true, showDelta: true, deltaConvention: 'azzam' };

const overlays = measuredEllipsometryOverlays(design, view);
assert.equal(overlays.length, 2);
assert.equal(overlays.filter(o => o.psi).length, 1);

// Ψ on the left axis, Δ on the right, same as the calculated pair.
const option = buildEllipsometryOption(
    { x: lambdas, psi: [1, 2, 3, 4], delta: [5, 6, 7, 8], xLabel: 'λ' },
    { background: '#000', paper: '#111', grid: '#222', text: '#eee' },
    { psi: '#0f0', delta: '#f0f' },
    { psi: true, delta: true },
    overlays,
);
const measuredOnChart = option.series.filter(s => s.name && s.name.includes('meas'));
assert.equal(measuredOnChart.length, 2, 'both measured curves reach the chart');
assert.equal(measuredOnChart.find(s => s.name.includes('Ψ')).yAxisIndex, 0);
assert.equal(measuredOnChart.find(s => s.name.includes('Δ')).yAxisIndex, 1);
assert.ok(measuredOnChart.every(s => s.symbol === 'emptyCircle'));
assert.ok(measuredOnChart[0].name.includes('65'), 'the name says which angle it was measured at');

// ── What is drawn follows the view ───────────────────────────────────────────

assert.deepEqual(measuredEllipsometryOverlays(design, { ...view, mode: 'angular' }), [],
    'an angular sweep plots against angle, and a measured curve runs against wavelength');
assert.deepEqual(measuredEllipsometryOverlays(design, { ...view, side: 'back' }), [],
    'a curve is drawn on the side it was measured on');
assert.equal(measuredEllipsometryOverlays(design, { ...view, showDelta: false }).length, 1,
    'hiding Δ hides the measured Δ with it');
assert.equal(measuredEllipsometryOverlays(design, { ...view, showPsi: false }).length, 1);
assert.equal(
    measuredEllipsometryOverlays({ measuredEllipsometry: [psi, { ...delta, visible: false }] }, view).length, 1,
    'the visibility checkbox in the import window now actually hides the curve');

// ── Δ is drawn in the convention the plot is showing ─────────────────────────

const asAzzam = measuredEllipsometryOverlays(design, view).find(o => !o.psi);
assert.deepEqual(asAzzam.y, delta.y,
    'a file already in the plot\'s convention is drawn as it was measured');

const asReversed = measuredEllipsometryOverlays(
    design, { ...view, deltaConvention: 'reversed' }).find(o => !o.psi);
assert.deepEqual(asReversed.y, convertDeltaConvention(delta.y, 'azzam', 'reversed'),
    'switching the plot to the other convention moves the measurement with it');
assert.deepEqual(asReversed.y, [260, 250, 240, 230]);

// The conversion is its own inverse, which is why one function does both ways.
assert.deepEqual(convertDeltaConvention(asReversed.y, 'reversed', 'azzam'), delta.y);
assert.deepEqual(convertDeltaConvention(delta.y, 'azzam', 'azzam'), delta.y);

// Ψ is a magnitude ratio and is the same either way.
const psiOverlay = measuredEllipsometryOverlays(
    design, { ...view, deltaConvention: 'reversed' }).find(o => o.psi);
assert.deepEqual(psiOverlay.y, psi.y);

// ── The readout lists every curve, not only the ones on the same grid ───────
//
// A design is sampled on its own wavelength step and a measurement on the
// instrument's. On a value axis ECharts puts a series in the tooltip only where
// it has a point exactly at the pointer, so between the design's samples the
// readout showed the measurement alone, and on them the design alone.

const { buildChartOption } = await import('../src/components/windows/analysis/opticalEvaluation/model.js');

const grid = { lambda: [400, 410, 420], series: [{ theta: 0, T: [0.5, 0.6, 0.7], R: [], A: [] }] };
const offGrid = {
    id: 'm1', name: 'witness', quantity: 'T',
    x: [402, 407, 413], xUnit: 'nm', y: [0.51, 0.55, 0.62], color: '#0af',
};
const spectrumOption = buildChartOption({
    data: grid, showCurves: { ...showCurves, T: true }, targets: [], targetsVisible: false,
    overlays: [offGrid], paperColor: '#111', bgColor: '#000', gridColor: '#222', textColor: '#eee',
    yScale: 'percent', spectralUnit: 'nm',
});
const format = spectrumOption.tooltip.formatter;
assert.equal(typeof format, 'function', 'the plot supplies its own readout');

// ECharts matched only the design curve, at one of its own samples.
const atDesignSample = format([{ seriesIndex: 0, seriesName: 'T avg', axisValue: 410, value: [410, 60], marker: '<m/>' }]);
assert.match(atDesignSample, /T avg/);
assert.match(atDesignSample, /witness/, 'the measurement is read even where ECharts did not match it');

// And the other way round, at one of the measurement's samples.
const atMeasuredSample = format([{ seriesIndex: 1, seriesName: 'witness (T meas)', axisValue: 407, value: [407, 55], marker: '<m/>' }]);
assert.match(atMeasuredSample, /witness/);
assert.match(atMeasuredSample, /T avg/, 'the design is read even where ECharts did not match it');

// Past the end of a curve it reports nothing rather than repeating its last
// reading across the rest of the plot.
const pastMeasured = format([{ seriesIndex: 0, seriesName: 'T avg', axisValue: 420, value: [420, 70], marker: '<m/>' }]);
assert.match(pastMeasured, /T avg/);
assert.equal(/witness/.test(pastMeasured), false,
    'a measurement that stops at 413 nm says nothing at 420');

// Target lines and band decoration carry no name and are annotations, not
// readings, so they stay out of the readout.
const withTargets = buildChartOption({
    data: grid, showCurves: { ...showCurves, T: true }, targetsVisible: true,
    targets: [{ id: 'op', type: 'T', enabled: true, lambdaStart: 400, lambdaEnd: 420, target: 0.9 }],
    overlays: [], paperColor: '#111', bgColor: '#000', gridColor: '#222', textColor: '#eee',
    yScale: 'percent', spectralUnit: 'nm',
});
const rows = withTargets.tooltip.formatter(
    [{ seriesIndex: 0, seriesName: 'T avg', axisValue: 410, value: [410, 60], marker: '<m/>' }]);
assert.equal((rows.match(/display:flex/g) || []).length, 1,
    'only the curve is listed, not the target drawn beside it');

console.log('measured_overlays_on_plots: passed');
