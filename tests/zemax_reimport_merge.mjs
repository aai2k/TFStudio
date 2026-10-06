/**
 * Importing again from a COATING.DAT that was imported before.
 *
 * The file goes back into the catalog it made the first time, and an import of
 * one coating or of a few materials leaves the rest of that catalog alone: the
 * materials a design uses, the edits made in the Material Editor and the
 * materials the user added. A coating import uses the materials the catalog
 * already holds; a materials import replaces a changed one only when the user
 * says so. A new import gets an id no other computer has, so a design that
 * travels is not computed with another vendor's material of the same name.
 *
 * Run: node tests/zemax_reimport_merge.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');

const writes = [];
globalThis.window = globalThis;
globalThis.electronAPI = {
    saveCatalog: async (cat) => { writes.push(JSON.parse(JSON.stringify(cat))); return { success: true }; },
    deleteCatalog: async () => ({ success: true }),
};

const cm = await import('../src/utils/materials/catalogManager.js');
const importer = await import('../src/components/windows/dataExchange/zemaxCoatings/catalogImport.js');
const { resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const runtime = makeHookRuntime();
const { useMaterialImportAction, useCoatingImportAction } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/zemaxCoatings/useImportActions.js', runtime);
const z = getLocale('en').zemaxCoatings;

const mate = (name, n) => ({ name, points: [[0.4, n + 0.02, 0], [0.55, n, 0], [0.8, n - 0.01, 0]] });
const FILE = 'C:\\Zemax\\COATING.DAT';
const all = [mate('TIO2', 2.35), mate('SIO2', 1.46), mate('MGF2', 1.38), mate('TA2O5', 2.1)];
const n550 = (id) => cm.getMaterialById(id).getNK(550)[0];
const keys = (catId) => Object.keys(cm.getCatalog(catId).materials).sort();
const lastWrite = (catId) => writes.filter(cat => cat.id === catId).at(-1);

cm.initCatalogs({});

// A new import: the file's base name plus a random part, like a user catalog.
const first = importer.registerMaterials(all, 'COATING.DAT', null, FILE);
const catId = first.catId;
assert.match(catId, /^zemax_coating_[0-9a-f]{8}$/, 'a new import gets base id + 8 hex digits');
assert.equal(first.catName, 'Zemax COATING');
assert.equal(cm.getCatalog(catId).sourceFile, FILE);
const uid = cm.getCatalog(catId).uid;
assert.ok(uid, 'the new catalog is stamped');

// The user edits TIO2 in the Material Editor and adds a material of their own.
cm.saveUserMaterial(catId, { ...cm.getCatalog(catId).materials.tio2, tabData: [[400, 2.5, 0], [550, 2.45, 0], [800, 2.4, 0]] });
cm.saveUserMaterial(catId, { id: 'my_ito', name: 'My ITO', formulaNum: -1, tabData: [[400, 1.9, 0.01], [800, 1.7, 0.02]] });
const design = {
    frontLayers: ['tio2', 'ta2o5', 'my_ito'].map((id, i) => ({ id: `l${i}`, material: `${catId}:${id}`, thickness: 50 })),
    substrate: { material: 'builtin:BK7' },
};

// A coating import from the same file that needs only SIO2 and MGF2.
const coat = importer.registerMaterials(all, 'COATING.DAT', new Set(['SIO2', 'MGF2']), FILE);
assert.equal(coat.catId, catId, 'the same path goes back into its own catalog');
assert.deepEqual(keys(catId), ['mgf2', 'my_ito', 'sio2', 'ta2o5', 'tio2'], 'nothing else of the catalog is dropped');
assert.deepEqual(Object.keys(lastWrite(catId).materials).sort(), ['mgf2', 'my_ito', 'sio2', 'ta2o5', 'tio2'], 'nor from its file');
assert.equal(n550(`${catId}:tio2`), 2.45, 'the edit survives');
assert.equal(cm.getCatalog(catId).uid, uid, 'the catalog keeps its stamp');
assert.equal(coat.nameMap.SIO2, `${catId}:sio2`);
for (const layer of design.frontLayers) {
    assert.equal(resolveDesignMaterial(design, layer.material).status, 'catalog', `${layer.material} still resolves`);
}

// A coating import of a material the catalog holds in edited form uses the held one.
const coatTio2 = importer.registerMaterials([mate('TIO2', 2.3)], 'COATING.DAT', new Set(['TIO2']), FILE);
assert.equal(coatTio2.nameMap.TIO2, `${catId}:tio2`);
assert.equal(n550(`${catId}:tio2`), 2.45, 'a coating import does not overwrite a held material');

// A materials import finds the changed one and replaces it only when asked to.
const plan = importer.buildMaterialRegistration(all, 'COATING.DAT', new Set(['TIO2', 'TA2O5']), FILE);
assert.deepEqual(plan.changed, ['TIO2'], 'the edited material is named as changed');
importer.registerMaterials(all, 'COATING.DAT', new Set(['TIO2', 'TA2O5']), FILE);
assert.equal(n550(`${catId}:tio2`), 2.45, 'without the go-ahead the held material stays');
importer.registerMaterials(all, 'COATING.DAT', new Set(['TIO2', 'TA2O5']), FILE, { replaceChanged: true });
assert.equal(n550(`${catId}:tio2`), 2.35, 'with it the file data replaces the held material');
assert.deepEqual(keys(catId), ['mgf2', 'my_ito', 'sio2', 'ta2o5', 'tio2'], 'under the same id');

// The window asks before replacing: Cancel writes nothing, Replace writes the file data.
cm.saveUserMaterial(catId, { ...cm.getCatalog(catId).materials.tio2, tabData: [[400, 2.6, 0], [550, 2.55, 0], [800, 2.5, 0]] });
{
    const flashes = [];
    let dialog = null;
    const importMaterials = runtime.render(() => useMaterialImportAction({
        z, flash: (type, message) => flashes.push([type, message]), doc: { materials: all, coatings: [] },
        selMats: new Set(['TIO2']), fileName: 'COATING.DAT', filePath: FILE, setInputDialog: (d) => { dialog = d; },
    }));
    const before = writes.length;
    importMaterials(false);
    assert.ok(dialog && dialog.confirm, 'a changed material opens a confirmation');
    assert.ok(dialog.message.includes('TIO2'), 'which names it');
    assert.equal(writes.length, before, 'nothing is written while it is open');
    dialog.onCancel();
    assert.equal(writes.length, before, 'Cancel writes nothing');
    assert.equal(n550(`${catId}:tio2`), 2.55);
    importMaterials(false);
    dialog.onConfirm();
    assert.equal(n550(`${catId}:tio2`), 2.35, 'Replace writes the file data');
    assert.equal(flashes.at(-1)[0], 'success');
}

// The coating import through the window keeps the held materials as well.
{
    cm.saveUserMaterial(catId, { ...cm.getCatalog(catId).materials.sio2, tabData: [[400, 1.5, 0], [550, 1.49, 0], [800, 1.48, 0]] });
    const updates = [];
    const importCoating = runtime.render(() => useCoatingImportAction({
        z, flash: () => {}, doc: {
            materials: all,
            coatings: [{ name: 'AR', type: 'layers', layers: [{ material: 'SIO2', thickness: 0.25, isAbsolute: false }] }],
        },
        selCoating: 0, fileName: 'COATING.DAT', filePath: FILE, refNm: 550,
        checkpoint: () => {}, updateDesign: (patch) => updates.push(patch),
    }));
    importCoating();
    const [layer] = updates[0].frontLayers;
    assert.equal(layer.material, `${catId}:sio2`);
    assert.equal(n550(`${catId}:sio2`), 1.49, 'the held SIO2 is kept');
    // The thickness comes from the file's own index, as Zemax computes it.
    assert.ok(Math.abs(layer.thickness - 0.25 * 550 / 1.46) < 1e-9, `thickness from the file's n (${layer.thickness})`);
}

// Another file of the same name is another catalog, with a name of its own.
const other = importer.registerMaterials(all, 'COATING.DAT', null, 'D:\\Vendor B\\COATING.DAT');
assert.notEqual(other.catId, catId);
assert.match(other.catId, /^zemax_coating_[0-9a-f]{8}$/);
assert.equal(other.catName, 'Zemax COATING 2', 'the second one does not share the name');

// A catalog an earlier build made from this path keeps its id and is merged into.
cm.addCatalog({
    id: 'zemax_coating', name: 'Zemax COATING (old)', source: 'user', sourceFile: 'E:\\old\\COATING.DAT',
    materials: { hfo2: { id: 'hfo2', name: 'HFO2', formulaNum: -1, tabData: [[400, 2.0, 0], [800, 1.95, 0]] } },
});
const oldUid = cm.getCatalog('zemax_coating').uid;
const legacy = importer.registerMaterials(all, 'COATING.DAT', new Set(['SIO2']), 'E:\\old\\COATING.DAT');
assert.equal(legacy.catId, 'zemax_coating', 'an existing id is kept');
assert.deepEqual(keys('zemax_coating'), ['hfo2', 'sio2']);
assert.equal(cm.getCatalog('zemax_coating').uid, oldUid);

// A catalog with no recorded origin is not taken over.
cm.addCatalog({ id: 'zemax_legacy', name: 'Zemax legacy', source: 'user', materials: {} });
const fresh = importer.registerMaterials(all, 'legacy.dat', null, 'C:\\any\\legacy.dat');
assert.notEqual(fresh.catId, 'zemax_legacy');
assert.deepEqual(keys('zemax_legacy'), []);

console.log('PASS: zemax_reimport_merge');
