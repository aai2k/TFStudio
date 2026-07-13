import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ ErrorAnalysis }, { buildErrorFigure }, trialModel] = await Promise.all([
    import('../src/components/windows/analysis/errorAnalysis/ErrorAnalysis.js'),
    import('../src/components/windows/analysis/errorAnalysis/ErrorChart.js'),
    import('../src/components/windows/analysis/errorAnalysis/trialModel.js'),
]);

const c = makeTheme();
const t = makeLocale();
const markup = renderToStaticMarkup(withDesign(React.createElement(ErrorAnalysis, { c, t, theme: c })));
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), 'faf05be445848a81');

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
const figure = buildErrorFigure({ result, char: 'R', c, corridorSigma: 2, showEnvelope: true });
assert.deepEqual(figure.data.map((trace) => trace.name || null), [
    null, 'Corridor (±2σ)', 'Exp (mean)', 'R theoretical', null, 'Min/max envelope',
]);
assert.deepEqual(figure.data[0].y, [20, 20.000000000000007]);
assert.deepEqual(figure.data[1].y, [60.00000000000001, 100]);

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
