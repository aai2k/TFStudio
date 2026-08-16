import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { initCatalogs },
    { ToolContent },
    { DesignEditor },
    { MissingMaterialsBanner },
    { collectMaterials, replaceMaterialReferences },
    { MaterialPicker },
    { SpectralMonitor },
    { ReportGenerator },
    { MaterialResolutionModalGuard },
    { SpectrumExchange },
    { ExportTab: SpectrumExportTab },
    { ExportTab: ZemaxExportTab },
] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/docking/DockingLayout.js'),
    import('../src/components/windows/design/designEditor/DesignEditor.js'),
    import('../src/components/materials/MissingMaterialsNotice.js'),
    import('../src/components/dialogs/ReplaceMaterialsDialog.js'),
    import('../src/components/ui/MaterialPicker.js'),
    import('../src/components/SpectralMonitor.js'),
    import('../src/components/windows/information/reportGenerator/ReportGenerator.js'),
    import('../src/components/materials/MaterialResolutionModalGuard.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/SpectrumExchange.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/ExportTab.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/ExportTab.js'),
]);

initCatalogs({});
const c = makeTheme();
const t = makeLocale();
const missingId = 'user_gone:Ta2O5';
const otherMissingId = 'user_gone:MgF2';
const broken = {
    id: 'broken', name: 'Broken design',
    incidentMedium: missingId,
    substrate: { material: missingId, thickness: 1 },
    exitMedium: 'builtin:Air',
    surfaceMode: 'front_only', mfEvalMode: 'side', referenceWavelength: 550,
    frontLayers: [{ id: 'f1', material: missingId, thickness: 100, locked: false }],
    backLayers: [{ id: 'b1', material: otherMissingId, thickness: 80, locked: false }],
};

const blocked = renderToStaticMarkup(React.createElement(ToolContent, {
    toolId: 'optical-eval', c, theme: c, t,
    missingMaterialIds: [missingId], onReplaceMaterials: () => {},
}));
assert.match(blocked, /data-material-resolution="blocked"/);
assert.match(blocked, /Calculation blocked/);
assert.doesNotMatch(blocked, /Calculate/,
    'the evaluation component is not mounted behind the missing-material notice');

const banner = renderToStaticMarkup(React.createElement(MissingMaterialsBanner, {
    ids: [missingId], c, t, onRepair: () => {},
}));
assert.match(banner, /data-material-resolution="warning"/);
assert.match(banner, /Replace materials/);

const editor = renderToStaticMarkup(withDesign(
    React.createElement(DesignEditor, { c, t }), broken));
assert.match(editor, /data-material-missing="true"/,
    'unresolved layer rows are visibly marked');
assert.match(editor, /Ta2O5/);
const missingPicker = renderToStaticMarkup(React.createElement(MaterialPicker, {
    value: missingId, onChange: () => {}, c, t,
}));
assert.match(missingPicker, />Ta2O5<\/span>/,
    'a missing current value is presented by its own id rather than as Air');
const missingPickerInDesign = renderToStaticMarkup(withDesign(
    React.createElement(MaterialPicker, { value: missingId, onChange: () => {}, c, t }),
    broken));
assert.match(missingPickerInDesign, />Ta2O5<\/span>/,
    'design-scoped resolution does not turn a missing reference into Air in the trigger');

const monitor = renderToStaticMarkup(withDesign(
    React.createElement(SpectralMonitor, { c, t }), broken));
assert.match(monitor, /monitors paused/,
    'the always-mounted spectral monitor reports its blocked state');

const report = renderToStaticMarkup(React.createElement(ReportGenerator, {
    c, t, onClose: () => {}, designs: { [broken.id]: broken },
    activeDesignId: broken.id, folderName: 'Demo',
}));
assert.match(report, /Report generation is blocked/,
    'the report generator reports missing material data before computing');

const guardedModal = renderToStaticMarkup(withDesign(
    React.createElement(MaterialResolutionModalGuard, {
        c, t, onClose: () => {},
    }, React.createElement('div', { 'data-simulation-mounted': 'true' })), broken));
assert.match(guardedModal, /data-material-resolution="blocked"/);
assert.doesNotMatch(guardedModal, /data-simulation-mounted/,
    'calculation modals do not mount their child while materials are unresolved');

const exchange = renderToStaticMarkup(withDesign(
    React.createElement(SpectrumExchange, { c, t }), broken));
assert.match(exchange, /Import measured spectrum/,
    'measured-spectrum import remains available for a broken design');
const spectrumExport = renderToStaticMarkup(React.createElement(SpectrumExportTab, {
    c, sx: t.spectrumExchange, section: {}, rowFlex: {},
    controller: {
        expSource: 'design', setExpSource: () => {},
        expFormat: 'csv', setExpFormat: () => {},
        missingMaterialIds: [missingId],
    },
}));
assert.match(spectrumExport, /Design-spectrum export is blocked/);

const zemaxExport = renderToStaticMarkup(React.createElement(ZemaxExportTab, {
    c, z: t.zemaxCoatings, design: broken, missingMaterialIds: [missingId],
}));
assert.match(zemaxExport, /COATING\.DAT export is blocked/,
    'Zemax import remains available while its current-design export panel is blocked');

const history = renderToStaticMarkup(withDesign(React.createElement(ToolContent, {
    toolId: 'history', c, theme: c, t, missingMaterialIds: [missingId],
}), broken));
assert.doesNotMatch(history, /data-material-resolution="blocked"/,
    'History remains available as a recovery route');

assert.deepEqual(collectMaterials(broken), [
    { id: missingId, count: 3 },
    { id: 'builtin:Air', count: 1 },
    { id: otherMissingId, count: 1 },
], 'media, substrate and both layer stacks participate in replacement counts');

const repaired = replaceMaterialReferences(broken, {
    [missingId]: 'builtin:Air',
    [otherMissingId]: 'builtin:SiO2',
});
assert.equal(repaired.incidentMedium, 'builtin:Air');
assert.equal(repaired.substrate.material, 'builtin:Air');
assert.equal(repaired.frontLayers[0].material, 'builtin:Air');
assert.equal(repaired.backLayers[0].material, 'builtin:SiO2');
assert.equal(repaired.frontLayers[0].thickness, 100,
    'replacement preserves physical layer data');

console.log('PASS: material_resolution_ui');
