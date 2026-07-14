import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ ZemaxCoatings }, model, importHooks, exportHooks] = await Promise.all([
    import('../src/components/windows/dataExchange/zemaxCoatings/ZemaxCoatings.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/model.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/useImportActions.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/useExportActions.js'),
]);

const markup = renderToStaticMarkup(withDesign(React.createElement(ZemaxCoatings, {
    c: makeTheme(), t: makeLocale(),
})));
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), 'f44da11347376b5b');

assert.deepEqual(model.catalogIdFor('My coating.DAT'), {
    id: 'zemax_my_coating', name: 'Zemax My coating',
});

const materials = [
    { name: 'A-B', points: [[0.6, 1.6, -0.02], [0.4, 1.4, 0]] },
    { name: 'A B', points: [[0.4, 2.0, -0.01]] },
    { name: 'A-B', points: [[0.4, 2.2, -0.03]] },
];
const registration = model.buildMaterialRegistration(materials, 'mix.dat');
assert.deepEqual(Object.keys(registration.cat.materials), ['a_b', 'a_b_2', 'a_b_3']);
assert.equal(registration.nameMap['A-B'], 'zemax_mix:a_b_3');
assert.equal(registration.nameMap['A B'], 'zemax_mix:a_b_2');
assert.deepEqual(registration.cat.materials.a_b.tabData, [[400, 1.4, 0], [600, 1.6, 0.02]]);

const selected = model.buildMaterialRegistration(materials, 'mix.dat', new Set(['A B']));
assert.deepEqual(Object.keys(selected.cat.materials), ['a_b']);
assert.equal(selected.nameMap['A B'], 'zemax_mix:a_b');

const names = { first: 'A-B', second: 'A B' };
const resolveName = model.makeZemaxNameResolver((id) => names[id]);
assert.equal(resolveName('first'), 'A_B');
assert.equal(resolveName('second'), 'A_B_2');
assert.equal(resolveName('first'), 'A_B');

const indexedMaterial = { points: [[0.4, 1.4, 0], [0.6, 1.8, 0]] };
assert.equal(model.mateRealIndexAt(indexedMaterial, 500), 1.6);
assert.equal(model.coatLayerThkNm({ material: 'MAT', thickness: 0.5, isAbsolute: 0 }, { MAT: indexedMaterial }, 500), 156.25);
assert.equal(model.coatLayerThkNm({ material: 'MAT', thickness: 0.125, isAbsolute: 1 }, {}, 500), 125);

const design = {
    frontLayers: [{ material: 'H' }, { material: 'L' }, { material: 'H' }],
    backLayers: [{ material: 'B' }], substrate: { material: 'S' },
    incidentMedium: 'Air', exitMedium: 'Air',
};
assert.deepEqual(model.collectExportMaterialIds(design, 'used'), ['H', 'L', 'B', 'S', 'Air']);
assert.deepEqual(model.collectExportMaterialIds(design, 'all', {
    one: { id: 'cat1', materials: { a: {}, b: {} } },
    two: { id: 'cat2', materials: { c: {} } },
}), ['cat1:a', 'cat1:b', 'cat2:c']);

const events = [];
const layers = [{ material: 'H', thickness: 100, locked: false }];
model.applyImportedLayers(
    layers,
    () => events.push('checkpoint'),
    (patch) => events.push(patch),
);
assert.equal(events[0], 'checkpoint');
assert.deepEqual(events[1], { frontLayers: layers });

let importCoating;
const importEvents = [];
function ImportProbe() {
    importCoating = importHooks.useCoatingImportAction({
        z: makeLocale().zemaxCoatings,
        flash: (type, message) => importEvents.push(['flash', type, message]),
        doc: {
            materials: [{ name: 'H', points: [[0.55, 2.0, 0]] }],
            coatings: [{
                name: 'GUARD', type: 'layers',
                layers: [{ material: 'H', thickness: 0.1, isAbsolute: true }],
            }],
        },
        selCoating: 0, fileName: 'guard.dat', refNm: 550,
        checkpoint: () => importEvents.push('checkpoint'),
        updateDesign: (patch) => importEvents.push(['update', patch]),
    });
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(ImportProbe));
importCoating();
assert.equal(importEvents[0], 'checkpoint');
assert.equal(importEvents[1][0], 'update');
assert.deepEqual(importEvents[1][1].frontLayers.map(layer => [layer.material, layer.thickness]), [
    ['zemax_guard:h', 100],
]);

let savePreview;
const saveEvents = [];
function SaveProbe() {
    savePreview = exportHooks.useSaveAction({
        z: makeLocale().zemaxCoatings,
        flash: (type, message) => saveEvents.push(['flash', type, message]),
        preview: 'MATE H 1',
    });
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(SaveProbe));
const originalApi = window.electronAPI;
window.electronAPI = {
    zemaxSaveCoatingFile: async (text, fileName) => {
        saveEvents.push(['save', text, fileName]);
        return { success: true, filePath: 'C:\\COATING.DAT' };
    },
};
await savePreview();
window.electronAPI = originalApi;
assert.deepEqual(saveEvents[0], ['save', 'MATE H 1', 'COATING.DAT']);
assert.deepEqual(saveEvents[1].slice(0, 2), ['flash', 'success']);

console.log('PASS: zemax_coatings_refactor_characterization');
