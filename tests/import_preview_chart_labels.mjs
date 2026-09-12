/**
 * The two Data Exchange import previews label their charts.
 *
 * Both previews reuse the chart of the analysis window that owns the same
 * curves, and both charts read their axis title, and the spectrum chart its
 * curve names, out of strings the caller passes. Each builds its ECharts option
 * inside an effect, so a caller that leaves one out is invisible until the
 * chart paints.
 *
 * The spectrum preview passed neither, and the missing titles threw while
 * reading the title for the unit the moment an imported curve reached the
 * chart. React unmounted the tree and the whole app went white. The
 * ellipsometry preview drew an axis with no name.
 *
 * Nothing here runs effects, so each test builds the option out of the props
 * the preview hands over, which is what the effect does.
 *
 * Run: node tests/import_preview_chart_labels.mjs
 */

import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { SpectrumPreview }, { SpectrumChart }, { buildChartOption },
    { ImportTab }, { EllipsometryChart, buildEllipsometryOption }, ellipsometryModel,
] = await Promise.all([
    import('../src/components/windows/dataExchange/spectrumExchange/SpectrumPreview.js'),
    import('../src/components/windows/analysis/opticalEvaluation/SpectrumChart.js'),
    import('../src/components/windows/analysis/opticalEvaluation/model.js'),
    import('../src/components/windows/dataExchange/measuredEllipsometry/ImportTab.js'),
    import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js'),
    import('../src/components/windows/dataExchange/measuredEllipsometry/model.js'),
]);

function findElement(node, type) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const hit = findElement(child, type);
            if (hit) return hit;
        }
        return null;
    }
    return node.type === type ? node : findElement(node.props?.children, type);
}

const t = makeLocale();
const c = makeTheme();
const palette = { background: c.bg, paper: c.panel, grid: c.border, text: c.text };
const lambdas = [450, 500, 550];

// ── Spectrum Exchange: an imported spectrum over the design's own curve ──────

const imported = {
    id: 'imported', name: 'sample: R', quantity: 'R',
    x: lambdas, y: [0.06, 0.05, 0.04],
    color: '#ef5350', aoi: 8, pol: 'avg', side: 'front',
};
// Neither preview holds state, so each is called as a plain function to read
// the element it builds.
const spectrumChart = findElement(SpectrumPreview({
    c, sx: t.spectrumExchange, t,
    controller: {
        design: makeSampleDesign(),
        previewCurve: imported,
        previewData: { lambda: lambdas, series: [{ theta: 8, R: [0.061, 0.052, 0.043] }] },
        previewRange: { min: 450, max: 550 },
        previewShowCurves: { T: false, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false },
    },
}), SpectrumChart);
assert.ok(spectrumChart, 'an imported curve reaches the spectrum chart');

const spectrumOption = buildChartOption({
    ...spectrumChart.props,
    targetsVisible: spectrumChart.props.showTargets,
    bgColor: c.bg, paperColor: c.panel, gridColor: c.border, textColor: c.text,
});
assert.equal(spectrumOption.xAxis.name, t.spectralAxis.nm,
    'the axis carries the locale title, and building the option at all is the point');
const names = spectrumOption.series.map(series => series.name);
assert.ok(names.includes(t.opticalEval.curveLabels.R), 'the computed curve is named from the locale');
assert.ok(names.includes(`${imported.name} (R meas)`), 'the imported curve is drawn over it');

// ── Measured Ellipsometry: an imported Ψ/Δ pair ──────────────────────────────

const preview = ellipsometryModel.chartData([
    { quantity: 'PSI', name: 'Ψ', x: lambdas, y: [20, 21, 22], aoi: 65 },
    { quantity: 'DEL', name: 'Δ', x: lambdas, y: [150, 152, 154], aoi: 65 },
], t.spectralAxis.nm);
const ellipsometryChart = findElement(ImportTab({
    c, mx: t.measuredEllipsometry,
    controller: { loading: false, onImport() {}, fileName: 'sample.dat', preview },
}), EllipsometryChart);
assert.ok(ellipsometryChart, 'an imported pair reaches the ellipsometry chart');

const ellipsometryOption = buildEllipsometryOption(
    ellipsometryChart.props.data, palette, ellipsometryChart.props.xLabel);
assert.equal(ellipsometryOption.xAxis.name, t.spectralAxis.nm,
    'the preview names its wavelength axis, as the evaluation window does');

console.log('import_preview_chart_labels: passed');
