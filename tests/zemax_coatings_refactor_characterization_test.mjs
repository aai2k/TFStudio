import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    shimBrowserGlobals,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ ZemaxCoatings }, model, importer, importHooks, exportHooks] = await Promise.all([
    import('../src/components/windows/dataExchange/zemaxCoatings/ZemaxCoatings.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/model.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/catalogImport.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/useImportActions.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/useExportActions.js'),
]);

{
    const fresh = importer.catalogIdFor('My coating.DAT');
    assert.match(fresh.id, /^zemax_my_coating_[0-9a-f]{8}$/, 'a new import: the base name plus a random part');
    assert.equal(fresh.name, 'Zemax My coating');
    assert.equal(fresh.existing, null);
}

// Vendor libraries are all called COATING.DAT. Two of them must not land on one
// catalog id, or importing the second wipes the first's materials.
{
    const catalogs = [
        { id: 'zemax_coating', name: 'Zemax COATING', sourceFile: 'C:\\vendorA\\COATING.DAT' },
        { id: 'zemax_coating_2', name: 'Zemax COATING (2)', sourceFile: 'C:\\vendorB\\COATING.DAT' },
        { id: 'zemax_legacy', name: 'Zemax legacy' },
    ];

    assert.equal(importer.catalogIdFor('COATING.DAT', 'C:\\vendorA\\COATING.DAT', catalogs).id, 'zemax_coating',
        're-importing the same file refreshes its own catalog');
    assert.equal(importer.catalogIdFor('COATING.DAT', 'C:\\vendorB\\COATING.DAT', catalogs).id, 'zemax_coating_2',
        'the second vendor file keeps its own id');
    assert.match(importer.catalogIdFor('COATING.DAT', 'C:\\vendorC\\COATING.DAT', catalogs).id, /^zemax_coating_[0-9a-f]{8}$/,
        'a third file gets an id of its own');
    assert.notEqual(importer.catalogIdFor('legacy.dat', 'C:\\any\\legacy.dat', catalogs).id, 'zemax_legacy',
        'a catalog with no recorded origin is not taken over');
}

assert.equal(
    importer.buildMaterialRegistration([{ name: 'H', points: [[0.55, 2, 0]] }],
        'origin.dat', null, 'C:\\lib\\origin.dat').cat.sourceFile,
    'C:\\lib\\origin.dat',
    'the catalog records the file it came from');

const materials = [
    { name: 'A-B', points: [[0.6, 1.6, -0.02], [0.4, 1.4, 0]] },
    { name: 'A B', points: [[0.4, 2.0, -0.01]] },
    { name: 'A-B', points: [[0.4, 2.2, -0.03]] },
];
const registration = importer.buildMaterialRegistration(materials, 'mix.dat');
const mixId = registration.catId;
assert.deepEqual(Object.keys(registration.cat.materials), ['a_b', 'a_b_2', 'a_b_3']);
assert.equal(registration.nameMap['A-B'], `${mixId}:a_b_3`);
assert.equal(registration.nameMap['A B'], `${mixId}:a_b_2`);
assert.deepEqual(registration.cat.materials.a_b.tabData, [[400, 1.4, 0], [600, 1.6, 0.02]]);

const selected = importer.buildMaterialRegistration(materials, 'mix.dat', new Set([1]));
assert.deepEqual(Object.keys(selected.cat.materials), ['a_b']);
assert.equal(selected.nameMap['A B'], `${selected.catId}:a_b`);

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
const [guardLayer] = importEvents[1][1].frontLayers;
assert.match(guardLayer.material, /^zemax_guard_[0-9a-f]{8}:h$/);
assert.equal(guardLayer.thickness, 100);

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
