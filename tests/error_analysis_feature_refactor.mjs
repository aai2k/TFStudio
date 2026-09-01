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

const [{ ErrorAnalysis }, { buildErrorOption }, trialModel] = await Promise.all([
    import('../src/components/windows/analysis/errorAnalysis/ErrorAnalysis.js'),
    import('../src/components/windows/analysis/errorAnalysis/ErrorChart.js'),
    import('../src/components/windows/analysis/errorAnalysis/trialModel.js'),
]);

const c = makeTheme();
const t = makeLocale();

const result = {
    lambda: [500, 600],
    mean: [0.4, 0.8],
    stdev: [0.1, 0.3],
    lower: [0, 0],
    upper: [1, 1],
    theory: [0.5, 0.7],
    envLower: [0.2, 0.3],
    envUpper: [0.6, 1],
};
const option = buildErrorOption({ result, char: 'R', c, corridorSigma: 2, showEnvelope: true });
assert.deepEqual(option.series.map((series) => series.name || null), [
    '__corridor_base__', 'Corridor (±2σ)', 'Exp (mean)', 'R theoretical', 'Envelope min', 'Min/max envelope',
]);
assert.deepEqual(option.series[0].data.map(point => point[1]), [20, 20.000000000000007]);
assert.deepEqual(option.series[1].data.map(point => point[1]), [40.00000000000001, 80]);
assert.equal(option.series[0].stack, 'corridor');
assert.equal(option.series[1].stack, 'corridor');

const design = makeSampleDesign();
const trials = [
    { dThkF: [1, -2], dThkB: null, spec: { allPass: false } },
    { dThkF: [3, 4], dThkB: null, spec: { allPass: true } },
];
const stats = trialModel.buildLayerStatistics({
    trials, front: design.frontLayers, back: [], hasFront: true, hasBack: false,
});
assert.equal(stats.nFailTrials, 1);
assert.equal(stats.nPassTrials, 1);
assert.deepEqual(stats.byRms.map((layer) => layer.label), ['F2', 'F1']);

const events = [];
trialModel.loadTrialThicknesses({
    front: design.frontLayers,
    back: [],
    dThkF: [-200, 5],
    dThkB: null,
    checkpoint: () => events.push('checkpoint'),
    updateDesign: (patch) => events.push(patch),
});
assert.equal(events[0], 'checkpoint');
assert.deepEqual(events[1].frontLayers.map((layer) => layer.thickness), [0, 95]);

console.log('PASS: error_analysis_feature_refactor');
