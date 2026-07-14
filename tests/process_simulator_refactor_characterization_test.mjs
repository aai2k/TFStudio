import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [directEntry, model, figure, persistence, saveActions] = await Promise.all([
    import('../src/components/windows/dataExchange/processSimulator/ProcessSimulator.js'),
    import('../src/components/windows/dataExchange/processSimulator/model.js'),
    import('../src/components/windows/dataExchange/processSimulator/figure.js'),
    import('../src/components/windows/dataExchange/processSimulator/persistence.js'),
    import('../src/components/windows/dataExchange/processSimulator/useProcessSave.js'),
]);
const { ProcessSimulator } = directEntry;

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(ProcessSimulator, { c, theme: c, t: makeLocale() })
));
assert.equal(html.length, 13692);
assert.equal(
    createHash('sha256').update(html).digest('hex'),
    'adb905c2ae2fe0e0b78d34164f1e82b4d7f99ea7b345e48c1cdad327229a53ae',
);

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
const traces = figure.spectraTraces({
    lambdas: [500, 600],
    baseline: [0.1, 0.2],
    stepCurves: [[0.3, 0.4], [0.5, 0.6]],
    liveCurve: [0.7, 0.8],
    currentStep: 2,
    showSteps: true,
    quantity: 'T',
}, colors, sp);
assert.deepEqual(traces.map(trace => trace.y), [
    [10, 20], [30, 40], [50, 60], [70, 80],
]);
assert.equal(traces[2].line.color, 'hsla(0, 70%, 55%, 0.95)');
assert.equal(traces[2].line.width, 2);
assert.deepEqual(figure.spectraLayout('R', colors).yaxis.range, [0, 100]);
assert.deepEqual(figure.SPECTRA_CONFIG.modeBarButtonsToRemove, [
    'select2d', 'lasso2d', 'autoScale2d',
]);

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
