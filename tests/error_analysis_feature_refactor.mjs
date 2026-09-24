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

const { getLocale } = await import('../src/constants/locales/index.js');
const EA = getLocale('en').errorAnalysis;

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
const option = buildErrorOption({ result, char: 'R', c, corridorSigma: 2, showEnvelope: true, tr: EA });
// Series names are display text and come from the locale.
assert.deepEqual(option.series.map((series) => series.name || null), [
    '__corridor_base__', EA.chartCorridor(2), EA.chartMean, EA.chartTheoretical('R'),
    EA.chartEnvelopeMin, EA.chartEnvelope,
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

// The statistics panel shows the yield's 95 % interval and the seed the run was
// drawn from; the error strip holds the seed, empty meaning a fresh one.
{
    const { renderToStaticMarkup } = await import('react-dom/server');
    const [{ TrialStatisticsPanel }, { ErrorEditor }] = await Promise.all([
        import('../src/components/windows/analysis/errorAnalysis/TrialStatisticsPanel.js'),
        import('../src/components/windows/analysis/errorAnalysis/ErrorControls.js'),
    ]);
    const run = {
        ...result, nTrials: 200, char: 'R', seed: 123456789,
        spec: { yield: 0.95, passCount: 190, evaluated: 200, yieldInterval: [0.91042, 0.97262], perQualifier: [] },
    };
    const panel = renderToStaticMarkup(React.createElement(TrialStatisticsPanel, {
        result: run, stats: { byOffender: [], byRms: [], nFailTrials: 0 },
        spread: { meanSig: 0, maxSig: 0, maxLam: null, meanWidth: 0 },
        corridorSigma: 1, c, ea: EA,
    }));
    assert.ok(panel.includes(EA.yieldInterval) && panel.includes('91.0–97.3%'), 'the yield interval is shown');
    assert.ok(panel.includes('123456789'), 'the seed of the run is shown');

    const editorState = {
        nTrials: 200, distribution: 'gaussian', rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0, rmsImN: 0,
        perMaterial: false, keepOPT: false, seed: null,
    };
    const empty = renderToStaticMarkup(React.createElement(ErrorEditor, { c, ea: EA, state: editorState }));
    assert.ok(empty.includes(`placeholder="${EA.seedRandom}"`), 'an empty seed reads as random');
    const seeded = renderToStaticMarkup(React.createElement(ErrorEditor, { c, ea: EA, state: { ...editorState, seed: 4242 } }));
    assert.ok(seeded.includes('value="4242"'), 'a set seed is shown in its field');
}

console.log('PASS: error_analysis_feature_refactor');
