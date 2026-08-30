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

const [{ SpectrumExchange }, { MeasuredFitDialog }, model, session, actionHooks] = await Promise.all([
    import('../src/components/windows/dataExchange/spectrumExchange/SpectrumExchange.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/MeasuredFitDialog.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/model.js'),
    import('../src/components/windows/windowSession.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/importActions.js'),
]);

const c = makeTheme();
const t = makeLocale();
const markup = renderToStaticMarkup(withDesign(React.createElement(SpectrumExchange, { c, t })));
assert.equal(markup.length, 6388);
assert.equal(
    createHash('sha256').update(markup).digest('hex'),
    '4f36a51bd11f032f5cdedb1af99fda9b5519ceead0b5c246a856a4397cdd5315',
);

const previewDesign = {
    ...makeSampleDesign(),
    measuredCurves: [{
        id: 'preview', name: 'Preview R', quantity: 'R',
        x: [450, 500, 550], y: [0.1, 0.08, 0.06],
        color: '#ef5350', visible: true, aoi: 8, pol: 'p', side: 'front',
        yWasPercent: false,
    }],
};
const previewMarkup = renderToStaticMarkup(withDesign(
    React.createElement(SpectrumExchange, { c, t }), previewDesign));
assert.match(previewMarkup, /Preview R/);
assert.match(previewMarkup, /Trim range/);
assert.match(previewMarkup, /Fit…/);
assert.doesNotMatch(previewMarkup, /Import a spectrum or select an existing curve/,
    'a stored or directly imported JCAMP curve must reach the preview chart');
assert.match(previewMarkup, /min-height:200px/,
    'the selected imported curve should render the real spectrum chart');
assert.match(previewMarkup, /tfs-spectrum-import-layout/);
assert.match(previewMarkup, /tfs-spectrum-import-preview/);
assert.match(previewMarkup, /grid-template-columns:112px minmax\(0, 1fr\)/,
    'import metadata labels need enough width for Angle of incidence');
assert.ok(previewMarkup.length > markup.length, 'curve preview should render more than the empty state');

const dialogCurve = previewDesign.measuredCurves[0];
const dialogConfig = {
    ...model.defaultMeasuredFitOptions(dialogCurve),
    outputMode: 'replace', constraintsEnabled: true,
    minThicknessNm: 12, maxThicknessNm: 900, constraintWeight: 2,
};
const dialogMarkup = renderToStaticMarkup(React.createElement(MeasuredFitDialog, {
    c, sx: t.spectrumExchange,
    controller: {
        fitDialogCurve: dialogCurve,
        fitConfig: dialogConfig,
        fitSnapshot: model.measuredFitSnapshot(previewDesign, dialogCurve, dialogConfig),
        setFitOption() {}, onCreateFitOperand() {}, closeFitDialog() {},
        missingMaterialIds: [],
    },
}));
assert.match(dialogMarkup, /Fit to measured curve/);
assert.match(dialogMarkup, /Append/);
assert.match(dialogMarkup, /Replace/);
assert.match(dialogMarkup, /Add thickness constraints/);
assert.match(dialogMarkup, /Minimum thickness/);
assert.match(dialogMarkup, /Maximum thickness/);

// The window is unmounted whenever its tab is not the active one, so the tab
// selection has to come back from the store rather than from React state.
const { spectrumExchangeSession } = await import(
    '../src/components/windows/dataExchange/spectrumExchange/sessionState.js');

function SessionProbe({ nextValue }) {
    const [state, setField] = session.useWindowSession(spectrumExchangeSession, null);
    if (nextValue && state.tab !== nextValue) setField('tab', nextValue);
    return React.createElement('span', null, state.tab);
}

assert.equal(renderToStaticMarkup(React.createElement(SessionProbe, { nextValue: 'export' })), '<span>export</span>');
assert.equal(renderToStaticMarkup(React.createElement(SessionProbe)), '<span>export</span>');
assert.equal(renderToStaticMarkup(React.createElement(SessionProbe, { nextValue: 'import' })), '<span>import</span>');

assert.deepEqual(model.designExportSelection('0, 12.5, invalid', { T: true, R: false, A: true }), {
    thetas: [0, 12.5],
    quantities: ['T', 'A'],
});
assert.deepEqual(model.designExportSelection('invalid', { T: false, R: true, A: false }), {
    thetas: [0],
    quantities: ['R'],
});

const design = {
    name: 'Measured / Sample',
    measuredCurves: [{
        name: 'R sample', quantity: 'R', x: [500, 600], y: [0.25, 0.5],
    }],
};
const csv = model.measuredExportDocument(design, 'csv');
assert.equal(csv.fileName, 'Measured_Sample_measured.csv');
assert.equal(createHash('sha256').update(csv.text).digest('hex').slice(0, 16), '1e39511d96338a8a');

const selectedExport = model.measuredExportDocument({
    name: 'Selected',
    measuredCurves: [
        { id: 'a', name: 'A', quantity: 'T', x: [400, 500], y: [0.9, 0.8] },
        { id: 'b', name: 'B', quantity: 'R', x: [400, 500], y: [0.1, 0.2] },
    ],
}, 'csv', {
    curves: [{ id: 'b', name: 'B', quantity: 'R', x: [400, 500], y: [0.1, 0.2], trimMin: 500 }],
    xUnit: 'um',
    asPercent: false,
});
assert.equal(selectedExport.text,
    '# Selected\r\n# AOI 0 deg, front side\r\n# Polarization: average\r\n'
    + 'Wavelength (µm),B R\r\n0.5,0.2\r\n');

const actionEvents = [];
const actionDesign = {
    measuredCurves: [
        { id: 'keep', name: 'Keep', x: [500], y: [0.1], quantity: 'T' },
        { id: 'remove', name: 'Remove', x: [500], y: [0.2], quantity: 'R' },
    ],
};
let actions;
function ActionProbe() {
    actions = actionHooks.useImportActions({
        sx: t.spectrumExchange,
        design: actionDesign,
        updateDesign: (patch) => actionEvents.push(['update', patch]),
        checkpoint: () => actionEvents.push('checkpoint'),
        flash: (type, msg) => actionEvents.push(['flash', type, msg]),
        parsed: { x: [500], columns: [{ name: 'Imported', values: [25] }] },
        col: { name: 'Imported', values: [25] },
        name: 'Guard', xUnit: 'nm', quantity: 'R', yscale: 'percent', fileName: 'guard.csv',
        setLoading: (value) => actionEvents.push(['loading', value]),
        setStatus: (value) => actionEvents.push(['status', value]),
        setParsed: (value) => actionEvents.push(['parsed', value]),
        setFileName: (value) => actionEvents.push(['file', value]),
        setColIdx: (value) => actionEvents.push(['column', value]),
        setOv: (value) => actionEvents.push(['overrides', value]),
        setXUnit: (value) => actionEvents.push(['unit', value]),
        setName: (value) => actionEvents.push(['name', value]),
    });
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(ActionProbe));
actions.onAdd();
assert.equal(actionEvents[0], 'checkpoint');
assert.equal(actionEvents[1][0], 'update');
const firstAdded = actionEvents[1][1].measuredCurves.at(-1);
assert.deepEqual(firstAdded.y, actions.previewCurve.y);
assert.equal(firstAdded.name, actions.previewCurve.name);

// The preview curves are memoized, so adding twice hands the same object over
// twice. Each curve on the design must still get an id of its own, or toggling
// one flips the other and neither can be removed on its own.
actionEvents.length = 0;
actions.onAdd();
const secondAdded = actionEvents[1][1].measuredCurves.at(-1);
assert.notEqual(secondAdded.id, firstAdded.id, 'a curve added twice must not reuse its id');
assert.deepEqual(secondAdded.y, firstAdded.y);
actionEvents.length = 0;
actions.removeCurve('remove');
assert.deepEqual(actionEvents.slice(0, 2), [
    'checkpoint',
    ['update', { measuredCurves: [actionDesign.measuredCurves[0]] }],
]);
actionEvents.length = 0;
actions.toggleCurve('keep');
assert.equal(actionEvents[0][0], 'update');
assert.equal(actionEvents[0][1].measuredCurves[0].visible, false);
assert.equal(actionEvents.includes('checkpoint'), false);

actionEvents.length = 0;
actions.setCurveScale('keep', 'percent');
assert.equal(actionEvents[0], 'checkpoint');
assert.equal(actionEvents[1][1].measuredCurves[0].y[0], 0.001);
assert.equal(actionEvents[1][1].measuredCurves[0].yWasPercent, true);

actionEvents.length = 0;
actions.setCurveTrim('keep', 'min', 500);
assert.equal(actionEvents[0], 'checkpoint');
assert.equal(actionEvents[1][1].measuredCurves[0].trimMin, 500);

const multiEvents = [];
let multiActions;
function MultiColumnProbe() {
    const parsed = {
        x: [500, 600],
        columns: [
            { name: 'Transmission', x: [500, 600], values: [90, 91], quantity: 'T', isPercent: true },
            { name: 'Reflection', x: [500, 600], values: [8, 7], quantity: 'R', isPercent: true },
        ],
    };
    multiActions = actionHooks.useImportActions({
        sx: t.spectrumExchange,
        design: { measuredCurves: [] },
        updateDesign: (patch) => multiEvents.push(['update', patch]),
        checkpoint: () => multiEvents.push('checkpoint'),
        flash: (type, msg) => multiEvents.push(['flash', type, msg]),
        parsed,
        col: parsed.columns[0],
        xUnit: 'nm',
        fileName: 'pair.csv',
        ov: { 1: { name: 'Rear R' } },
        aoi: 8,
        pol: 'p',
        side: 'back',
        setLoading() {}, setStatus() {}, setParsed() {}, setFileName() {},
        setColIdx() {}, setOv() {}, setXUnit() {},
    });
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(MultiColumnProbe));
multiActions.onAdd();
const importedPair = multiEvents[1][1].measuredCurves;
assert.equal(importedPair.length, 2);
assert.deepEqual(importedPair.map(curve => [curve.name, curve.quantity]), [
    ['pair: Transmission', 'T'],
    ['Rear R', 'R'],
]);
assert.ok(importedPair.every(curve => curve.aoi === 8 && curve.pol === 'p' && curve.side === 'back'));

const originalApi = window.electronAPI;
window.electronAPI = {
    spectrumPickFile: async () => ({
        success: true,
        fileName: 'table.csv',
        text: 'wavelength,T\n500,10\n600,20',
    }),
};
actionEvents.length = 0;
await actions.onImport();
window.electronAPI = originalApi;
assert.deepEqual(actionEvents.slice(0, 2), [['loading', true], ['status', null]]);
assert.ok(actionEvents.some(event => event[0] === 'parsed' && event[1].nRows === 2));
assert.deepEqual(actionEvents.at(-1), ['loading', false]);

console.log('PASS: spectrum_exchange_feature_refactor');
