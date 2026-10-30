/**
 * A material imported from a COATING.DAT reads its MATE table by straight lines
 * between the rows, the end rows held outside, as Zemax reads it (OpticStudio
 * User Manual, "The MATE Data Section"): through the Zemax Coatings window's
 * import and through importZemaxCoating, so between rows it has the index
 * Zemax uses.
 *
 * A catalog made from the file by an earlier import reads the table as a
 * smooth curve. A later import lists its materials as changed, and a design
 * saved with one of them keeps computing with it, reopened on this computer or
 * on one without the catalog, until the user replaces it with the file's.
 *
 * Run: node tests/zemax_imported_material_reading.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const api = await import('../src/api/index.js');
const cm = await import('../src/utils/materials/catalogManager.js');
const { buildMaterialRegistration, registerMaterials } = await import('../src/components/windows/dataExchange/zemaxCoatings/catalogImport.js');
const { convertSelectedCoating } = await import('../src/components/windows/dataExchange/zemaxCoatings/coatingLayers.js');
const { mateToTfMaterial, parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const { resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');
const en = (await import('../src/constants/locales/en.js')).default;

await api.init();
globalThis.window ??= globalThis;
globalThis.window.electronAPI = {
    saveCatalog: async () => ({ success: true }),
    deleteCatalog: async () => ({ success: true }),
};

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zemax-reading-'));
const TEXT = [
    'MATE TIO2', '0.40 2.60 0', '0.45 2.45 0', '0.50 2.36 0', '0.60 2.28 0', '0.80 2.22 0',
    'COAT HL', 'TIO2 0.1 1', '',
].join('\n');
const doc = parseZemaxCoating(TEXT);
const datFile = (name) => {
    const file = path.join(TEMP, name);
    fs.writeFileSync(file, TEXT);
    return file;
};

// n by straight lines between the rows at 400, 450, 500, 600 and 800 nm, and on
// the row at 600 nm.
const STRAIGHT = { 425: 2.525, 550: 2.32, 600: 2.28, 700: 2.25 };
const nAt = (material) => Object.fromEntries(Object.keys(STRAIGHT).map(nm => [nm, material.getNK(Number(nm))[0]]));
const assertStraight = (material, where) => {
    for (const [nm, n] of Object.entries(nAt(material))) {
        assert.ok(Math.abs(n - STRAIGHT[nm]) < 1e-12, `${where}: n at ${nm} nm is ${n}, Zemax reads ${STRAIGHT[nm]}`);
    }
};

// The window's Import to front coating registers the material in the file's catalog.
{
    const file = datFile('WINDOW.DAT');
    const { layers } = convertSelectedCoating({ z: en.zemaxCoatings, doc, selCoating: 0, fileName: 'WINDOW.DAT', filePath: file, refNm: 550 }, { write: true });
    assertStraight(cm.getMaterialById(layers[0].material), 'the window\'s import');
}

// importZemaxCoating writes no catalog: the design carries the record.
{
    const { design } = api.importZemaxCoating(api.newDesign({ name: 'API' }), datFile('API.DAT'));
    const resolved = resolveDesignMaterial(design, design.frontLayers[0].material);
    assert.equal(resolved.status, 'embedded', 'the design computes with its own copy');
    assertStraight(resolved.material, 'importZemaxCoating');
}

// A catalog an earlier import made from the file, which read the table as a
// smooth curve, and a design saved with its material.
{
    const file = datFile('EARLIER.DAT');
    const smooth = { ...mateToTfMaterial(doc.materials[0], { comment: 'Imported from EARLIER.DAT' }), interp: 'pchip' };
    const catId = 'zemax_earlier_0a1b2c3d';
    cm.addCatalog({ id: catId, name: 'Zemax EARLIER', source: 'user', sourceFile: file, materials: { tio2: { ...smooth, id: 'tio2' } } });
    const id = `${catId}:tio2`;
    const design = api.insertLayer(api.newDesign({ name: 'Earlier' }), { material: id, thickness: 100 });
    const before = nAt(resolveDesignMaterial(design, id).material);
    assert.notDeepEqual(before, STRAIGHT, 'the smooth reading differs between rows');
    const saved = path.join(TEMP, 'earlier.tfs');
    api.saveDesign(design, saved);

    assert.deepEqual(buildMaterialRegistration(doc.materials, 'EARLIER.DAT', null, file).changed, ['TIO2'],
        'a later import lists the material as changed');
    convertSelectedCoating({ z: en.zemaxCoatings, doc, selCoating: 0, fileName: 'EARLIER.DAT', filePath: file, refNm: 550 }, { write: true });
    assert.deepEqual(nAt(resolveDesignMaterial(api.openDesign(saved), id).material), before,
        'a coating imported again from the file leaves the catalog\'s material, and the saved design reads as it was saved');

    const catalog = cm.getCatalog(catId);
    await cm.removeCatalog(catId);
    const elsewhere = resolveDesignMaterial(api.openDesign(saved), id);
    assert.equal(elsewhere.status, 'embedded');
    assert.deepEqual(nAt(elsewhere.material), before, 'without the catalog the saved design reads its own copy as it was saved');
    cm.addCatalog(catalog);

    registerMaterials(doc.materials, 'EARLIER.DAT', null, file, { replaceChanged: true });
    assertStraight(resolveDesignMaterial(api.openDesign(saved), id).material, 'once the user replaces it');
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log('PASS: zemax_imported_material_reading');
