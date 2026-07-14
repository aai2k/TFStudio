import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ SpectrumExchange }, model, session, actionHooks] = await Promise.all([
    import('../src/components/windows/dataExchange/spectrumExchange/SpectrumExchange.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/model.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/session.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/importActions.js'),
]);

const c = makeTheme();
const t = makeLocale();
const markup = renderToStaticMarkup(withDesign(React.createElement(SpectrumExchange, { c, t })));
assert.equal(markup.length, 1724);
assert.equal(
    createHash('sha256').update(markup).digest('hex'),
    '8380b0a9905f8f94bf815995ce433d3a6e542b8736f8dc80f40caeaf0cf8aaf4',
);

function SessionProbe({ nextValue }) {
    const [value, setValue] = session.useSession('tab');
    if (nextValue && value !== nextValue) setValue(nextValue);
    return React.createElement('span', null, value);
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
assert.equal(createHash('sha256').update(csv.text).digest('hex').slice(0, 16), '2ad7bc48ab40aab7');

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
assert.equal(actionEvents[1][1].measuredCurves.at(-1), actions.previewCurve);
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
