import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [directEntry, model, figure, persistence, saveActions, timeline, wizardShell] = await Promise.all([
    import('../src/components/windows/dataExchange/processSimulator/ProcessSimulator.js'),
    import('../src/components/windows/dataExchange/processSimulator/model.js'),
    import('../src/components/windows/dataExchange/processSimulator/figure.js'),
    import('../src/components/windows/dataExchange/processSimulator/persistence.js'),
    import('../src/components/windows/dataExchange/processSimulator/useProcessSave.js'),
    import('../src/components/windows/dataExchange/processSimulator/Timeline.js'),
    import('../src/components/windows/simulation/wizardKit/useWizardShell.js'),
]);
const { ProcessSimulator } = directEntry;

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(ProcessSimulator, { c, theme: c, t: makeLocale() })
));
assert.match(html, /Deposition sequence/);
assert.ok(html.length > 10000, 'the full simulator controls render');

// The row holds what defines the run and what is drawn. The monitor's own
// geometry, the spectral range and the export step are behind the Settings
// button, so the row fits a docked window without wrapping and rearranging
// itself on every resize.
for (const label of ['Active side', 'Deposit on', 'Opposite side', 'Quantity', 'Show all layers']) {
    assert.ok(html.includes(label), `${label} is on the control row`);
}
assert.match(html, /aria-expanded="false"/, 'the settings panel is closed behind its button');
for (const label of ['Polarization', 'Export step (nm)']) {
    assert.ok(!html.includes(label), `${label} is a setting, not a row control`);
}

// A number field is a text field, not type="number": a native number input
// renders and accepts the decimal separator of the browser locale, so a step of
// 0.4375 reads back as 0,4375 on a machine set to Russian.
assert.doesNotMatch(html, /type="number"/, 'numbers are typed into text fields');
assert.match(html, /inputMode="decimal"/);

// An auto-sized table redraws every column as the material names change, so the
// numbers move under the pointer while a run plays.
assert.match(html, /table-layout:fixed/, 'the sequence table holds its columns');
assert.match(html,
    /<colgroup><col style="width:26px"\/><col\/><col style="width:86px"\/><col style="width:54px"\/><\/colgroup>/,
    'the thickness heading has enough room to show its complete unit');

// The bar down the left of a row marks the layer the timeline is on, so a run
// moving through the stack is as easy to follow as a layer picked by hand.
assert.match(html, /box-shadow:inset 2px 0 0 /, 'the current layer carries the marker');
assert.match(html, /tabindex="0"/, 'the sequence takes focus so the arrow keys reach it');

// A native range thumb is inset by half its own width at each end, so ticks
// placed at a plain percentage drift away from it, worst on a narrow window
// where the same pixel error is a larger share of a short track.
assert.equal(timeline.thumbCentre(0), 'calc(0% + 6px)');
assert.equal(timeline.thumbCentre(1), 'calc(100% - 6px)');
assert.equal(timeline.thumbCentre(0.5), 'calc(50% + 0px)', 'the midpoint needs no correction');
assert.match(html, /--tfs-thumb:12px/, 'the CSS thumb size comes from the constant the ticks use');

function renderWith(persisted, withDesignOf) {
    localStorage.clear();
    persistence.savePersist(persisted);
    return renderToStaticMarkup(withDesign(
        React.createElement(ProcessSimulator, { c, theme: c, t: makeLocale() }), withDesignOf));
}

// The data-range warning checks the materials the chamber sees. A layer whose
// data stops at 700 nm raises the notice badge over the default 400-1100 nm
// range and is quiet once the range is pulled inside its data.
const narrowDesign = {
    id: 'narrow', name: 'Narrow',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ id: 'n1', material: 'x:narrow', thickness: 100 }],
    backLayers: [],
    materials: {
        'x:narrow': {
            id: 'x:narrow', name: 'Narrow', formulaNum: -1, lambdaMin: 0.4, lambdaMax: 0.7,
            tabData: [[400, 1.5, 0], [550, 1.5, 0], [700, 1.5, 0]],
        },
    },
};
assert.match(renderWith({ lambdaStart: 400, lambdaEnd: 1100 }, narrowDesign), /⚠/,
    'a range past a material\'s data raises the notice badge');
assert.doesNotMatch(renderWith({ lambdaStart: 450, lambdaEnd: 650 }, narrowDesign), /⚠/,
    'a range inside every material\'s data raises nothing');

// On witness chips the chip setup sits in the sidebar, whose width is fixed,
// the opposite-surface choice does not apply, and the sequence table carries
// the chip column.
const chipHtml = renderWith({ mode: 'chips' }, narrowDesign);
for (const label of ['Layers per chip', 'Chip glass', 'Witness ratio']) {
    assert.ok(chipHtml.includes(label), `${label} is in the sidebar on witness chips`);
}
assert.ok(!chipHtml.includes('Opposite side'), 'a witness chip has no opposite-surface choice');
assert.match(chipHtml, /<colgroup><col style="width:26px"\/><col style="width:50px"\/><col\/>/,
    'the sequence table gains the chip column');
localStorage.clear();

const design = {
    id: 'process-model',
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 2 },
    frontLayers: [
        { id: 'top', material: 'builtin:TiO2', thickness: 80 },
        { id: 'sub', material: 'builtin:SiO2', thickness: 120 },
        { id: 'zero', material: 'builtin:MgF2', thickness: 0 },
    ],
    backLayers: [{ id: 'back', material: 'builtin:MgF2', thickness: 60 }],
};
const front = model.buildDepositionModel(design, 'front');
assert.deepEqual(front.activeDep.map(layer => [layer.id, layer.materialId, layer.thickness]), [
    ['sub-builtin:SiO2', 'builtin:SiO2', 120],
    ['top-builtin:TiO2', 'builtin:TiO2', 80],
]);
assert.deepEqual(front.otherDep.map(layer => layer.id), ['back-builtin:MgF2']);
assert.deepEqual(front.materials, ['builtin:SiO2', 'builtin:TiO2', 'builtin:MgF2']);
assert.equal(front.substrateThk, 2);
assert.equal(model.buildDepositionModel({
    ...design, substrate: { material: 'builtin:BK7', thickness: 0 },
}, 'front').substrateThk, 0, 'process model preserves zero substrate thickness');
const back = model.buildDepositionModel(design, 'back');
assert.deepEqual(back.activeDep.map(layer => layer.id), ['back-builtin:MgF2']);
assert.deepEqual(back.otherDep.map(layer => layer.id), [
    'sub-builtin:SiO2', 'top-builtin:TiO2',
]);

assert.equal(model.effectiveRate({ H: '2.5' }, 'H'), 2.5);
assert.equal(model.effectiveRate({ H: 0 }, 'H'), 1);
assert.deepEqual(model.buildLayerTimes(front.activeDep, {
    'builtin:SiO2': 2,
    'builtin:TiO2': 4,
}), [60, 20]);
assert.deepEqual(model.buildCumulativeTimes([2, 3, 0.5]), [0, 2, 5, 5.5]);
assert.deepEqual(model.deriveProgressState(1, [0, 2, 5], [2, 3], 2), {
    layerIdx: 1, frac: 0.5, completedSteps: 0,
});
assert.deepEqual(model.deriveProgressState(2, [0, 2, 5], [2, 3], 2), {
    layerIdx: 2, frac: 0, completedSteps: 1,
});
assert.deepEqual(model.deriveProgressState(5, [0, 2, 5], [2, 3], 2), {
    layerIdx: 2, frac: 1, completedSteps: 2,
});
assert.deepEqual(model.deriveProgressState(0, [0], [], 0), {
    layerIdx: 0, frac: 0, completedSteps: 0,
});

// Clicking a layer moves the timeline to it. A boundary belongs to the layer
// after it, so the seek has to stop short of the end or the readouts name the
// wrong layer: every step must come back as itself, fully deposited.
{
    const times = [2, 3, 5];
    const cumulative = model.buildCumulativeTimes(times);
    for (const step of [1, 2, 3]) {
        const state = model.deriveProgressState(
            model.stepSeekTime(cumulative, times, step), cumulative, times, 3);
        assert.equal(state.layerIdx, step, `seeking to layer ${step} lands on layer ${step}`);
        assert.ok(state.frac > 0.999, `layer ${step} is deposited where the seek lands`);
    }
}

let wizardContext;
function WizardShellProbe() {
    wizardContext = wizardShell.useWizardShell({
        ...design, substrate: { material: 'builtin:BK7', thickness: 0 },
    }).ctx;
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(WizardShellProbe));
assert.equal(wizardContext.subThk, 0, 'monitoring wizard preserves zero substrate thickness');

const Air = { getNK: () => [1, 0] };
const Sub = { getNK: () => [1.52, 0] };
const H = { getNK: () => [2.1, 0] };
const L = { getNK: () => [1.45, 0] };
const spectrumOptions = {
    activeDep: [{ matObj: H, thickness: 80 }, { matObj: L, thickness: 120 }],
    otherDep: [{ matObj: L, thickness: 60 }],
    activeSide: 'front', secondSurface: 'coated', quantity: 'R',
    aoi: 17, polarization: 'avg',
    lambdaStart: 500, lambdaEnd: 540, lambdaStep: 20,
    incidentMat: Air, substrateMat: Sub, exitMat: Air, substrateThk: 1,
    layerIdx: 2, frac: 0.25,
};
assert.deepEqual(model.computeSpectrum(spectrumOptions), {
    lambda: [500, 520, 540],
    values: [0.14687603497767276, 0.16392105997083806, 0.17893765779820353],
});
assert.deepEqual(model.computeSpectrum({
    ...spectrumOptions, activeSide: 'back', quantity: 'A', layerIdx: 1, frac: 0.5,
}), {
    lambda: [500, 520, 540],
    values: [1.6653345369377348e-16, 0, 5.551115123125783e-17],
});

const absorbingBackOptions = {
    ...spectrumOptions,
    activeDep: [{ matObj: { getNK: () => [2.1, 0.12] }, thickness: 80 }, { matObj: L, thickness: 120 }],
    otherDep: [{ matObj: L, thickness: 60 }, { matObj: { getNK: () => [2.1, 0.12] }, thickness: 45 }],
    activeSide: 'back', quantity: 'R', layerIdx: 2, frac: 0.25,
    substrateMat: { getNK: () => [1.52, 0.01] },
};
assert.deepEqual(model.computeSpectrum(absorbingBackOptions), {
    lambda: [500, 520, 540],
    values: [0.22068057797541313, 0.2137858146328576, 0.2069011301535813],
});
assert.deepEqual(model.computeSpectrum({ ...absorbingBackOptions, quantity: 'A' }), {
    lambda: [500, 520, 540],
    values: [0.7793194220245869, 0.7862141853671425, 0.7930988698464188],
});

const sp = makeLocale().processSim;
const colors = figure.spectraColors(c);
const series = figure.buildSpectraSeries({
    lambdas: [500, 600],
    baselinePoints: figure.buildStepPoints([500, 600], [[0.1, 0.2]])[0],
    stepPoints: figure.buildStepPoints([500, 600], [[0.3, 0.4], [0.5, 0.6]]),
    liveCurve: [0.7, 0.8],
    focusStep: 2,
    showAll: true,
    quantity: 'T',
}, colors, sp);
assert.deepEqual(series.map(item => item.data.map(point => point[1])), [
    [10, 20], [50, 60], [70, 80],
], 'baseline, focused step and live curve; the haze is not a series');
assert.equal(series[1].lineStyle.color, 'hsla(0, 70%, 55%, 0.95)');
assert.equal(series[1].lineStyle.width, 2.4);
const chartOption = figure.buildSpectraOption({ quantity: 'R' }, colors, sp);
assert.deepEqual([chartOption.yAxis.min, chartOption.yAxis.max], [0, 100]);
assert.ok(chartOption.toolbox.feature.saveAsImage, 'native chart export remains available');

// Focusing a layer greys the other step curves rather than hiding them: a
// monitoring turning point is read against the curves that came before it.
{
    const lambdas = [500, 600];
    const focusData = {
        lambdas,
        baselinePoints: figure.buildStepPoints(lambdas, [[0.1, 0.2]])[0],
        stepPoints: figure.buildStepPoints(lambdas, [[0.3, 0.4], [0.5, 0.6], [0.7, 0.8]]),
        liveCurve: [0.9, 1.0],
        focusStep: 2,
        showAll: true,
        quantity: 'T',
    };
    assert.equal(figure.focusedStep(focusData), 2);
    assert.equal(figure.focusedStep({ ...focusData, focusStep: 7 }), null,
        'a layer the design no longer has is not focused');
    assert.equal(figure.focusedStep({ ...focusData, focusStep: null }), null);

    const focused = figure.buildSpectraSeries(focusData, colors, sp);
    // Baseline, the focused step, the live curve, and nothing else: the
    // unfocused curves are not series at all. ECharts repaints every canvas on
    // any option apply and on every pointer move, so two hundred step series
    // were re-stroked per timeline tick, hover frame and resize step. The haze
    // is rasterized once into an offscreen bitmap instead (syncContextImage)
    // and a repaint costs one drawImage.
    assert.equal(focused.length, 3);
    const inFocus = focused[1];
    assert.equal(inFocus.z, 3, 'the focused curve is drawn over the haze');
    assert.equal(inFocus.lineStyle.color, 'hsla(110, 70%, 55%, 0.95)',
        'the focused curve keeps its own colour at full strength');
    assert.equal(inFocus.tooltip, undefined, 'the focused curve keeps its readout');
    assert.deepEqual(figure.buildSpectraSeries({ ...focusData, showAll: false }, colors, sp)
        .map(item => item.name), focused.map(item => item.name),
        'Show all layers adds no series; the haze is the bitmap');

    // Sixty curves over one plot is a grey haze with the answer somewhere
    // inside it, so only the layer the timeline is on is drawn by default.
    const oneLayer = figure.buildSpectraSeries({ ...focusData, showAll: false }, colors, sp);
    assert.deepEqual(oneLayer.map(item => item.name),
        [sp.legendBaseline, sp.legendStep(2), sp.legendLive],
        'the baseline, the layer in focus and the live curve, and nothing else');

    // The points are shared with the caller, which builds them once per design.
    // Rebuilding twenty thousand of them on every progress tick is what made a
    // long run stutter.
    assert.equal(oneLayer[1].data, focusData.stepPoints[1],
        'a step curve reuses the points it was given');

    assert.deepEqual(figure.buildSpectraOption(focusData, colors, sp).legend.data
        .map(item => (typeof item === 'string' ? item : item.name)),
        [sp.legendBaseline, sp.legendStep(2), sp.legendLive],
        'the legend names the layer the chart is following');
    assert.deepEqual(figure.buildSpectraOption({ ...focusData, focusStep: null }, colors, sp)
        .legend.data.map(item => (typeof item === 'string' ? item : item.name)),
        [sp.legendBaseline, sp.legendLive], 'and stays bounded otherwise');

    // The readout is bounded to the same three curves. A stack of sixty would
    // otherwise put sixty rows in the tooltip and run it off the window.
    {
        const { formatter } = figure.buildSpectraOption(focusData, colors, sp).tooltip;
        const row = (seriesName, value) => ({
            seriesName, axisValue: 732, value: [732, value], marker: '<i></i>',
        });
        const shown = formatter([
            row(sp.legendBaseline, 91.999),
            row(sp.legendStep(1), 71.944),
            row(sp.legendStep(2), 64.43),
            row(sp.legendStep(3), 79.34),
            row(sp.legendLive, 73.2),
        ]);
        for (const name of [sp.legendBaseline, sp.legendStep(2), sp.legendLive]) {
            assert.ok(shown.includes(name), `${name} is in the readout`);
        }
        for (const name of [sp.legendStep(1), sp.legendStep(3)]) {
            assert.ok(!shown.includes(name), `${name} is context, not a readout row`);
        }
        assert.ok(shown.includes('732'), 'the wavelength heads the readout');
        assert.ok(shown.includes('64.43%'), 'values keep their unit');
    }

    // The ruler runs out of room for one number per layer long before the ticks
    // themselves collide, so labels thin out onto round layer numbers.
    assert.equal(timeline.labelStride(8), 1);
    assert.equal(timeline.labelStride(24), 2);
    assert.equal(timeline.labelStride(60), 5, '60 layers label every fifth');
    assert.equal(timeline.labelStride(300), 20);
}

localStorage.clear();
persistence.savePersist({ activeSide: 'back', rates: { H: 2 } });
persistence.savePersist({ quantity: 'R' });
assert.equal(localStorage.getItem('tfstudio-process-sim-v1'),
    '{"activeSide":"back","rates":{"H":2},"quantity":"R"}');
assert.deepEqual(persistence.loadPersist(), {
    activeSide: 'back', rates: { H: 2 }, quantity: 'R',
});

const saveDesign = {
    ...design,
    name: 'Process Guard',
    frontLayers: design.frontLayers.filter(layer => layer.thickness > 0),
};
const saveSetup = {
    activeSide: 'front', secondSurface: 'bare', quantity: 'T', aoi: 0,
    polarization: 'avg', lambdaStart: 500, lambdaEnd: 540, exportStep: 20,
};
let saveController;
function SaveProbe() {
    saveController = saveActions.useProcessSave(saveDesign, saveSetup, 2, sp);
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(SaveProbe));
const originalApi = window.electronAPI;
const saveEvents = [];
window.electronAPI = {
    pickProcessSaveDir: async () => { saveEvents.push('pick'); return { dir: 'C:\\process' }; },
    getAppVersion: async () => { saveEvents.push('version'); return '1.2.0'; },
    saveProcessFiles: async (files, dir) => {
        saveEvents.push(['save', files.length, dir]);
        return { success: true, dir };
    },
};
await saveController.handleSave();
window.electronAPI = originalApi;
assert.deepEqual(saveEvents, ['pick', 'version', ['save', 2, 'C:\\process']]);

console.log('PASS: process_simulator_refactor_characterization');
