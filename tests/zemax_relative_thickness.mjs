/**
 * A COAT layer given in waves becomes the same thickness in nm in the Zemax
 * Coatings window's Coatings tab, in its import to the front coating and in
 * Save to Coating Library.
 *
 * Zemax reads a MATE table by straight lines between its rows and holds the end
 * rows outside it (OpticStudio User Manual, "The MATE Data Section"), so a
 * relative thickness t at λ₀ is t·λ₀/n(λ₀) with that n. The check uses a table
 * of five rows at λ₀ between rows, on a row and outside the table.
 *
 * Run: node tests/zemax_relative_thickness.mjs
 */
import assert from 'node:assert/strict';

const cm = await import('../src/utils/materials/catalogManager.js');
const { parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const { coatLayerThkNm } = await import('../src/components/windows/dataExchange/zemaxCoatings/model.js');
const { convertSelectedCoating } = await import('../src/components/windows/dataExchange/zemaxCoatings/coatingLayers.js');
const en = (await import('../src/constants/locales/en.js')).default;

cm.initCatalogs({});

const doc = parseZemaxCoating([
    'MATE TIO2', '0.40 2.60 0', '0.45 2.45 0', '0.50 2.36 0', '0.60 2.28 0', '0.80 2.22 0',
    'COAT QW', 'TIO2 0.25 0',
].join('\n'));
const byName = { TIO2: doc.materials[0] };
const imported = refNm => convertSelectedCoating(
    { z: en.zemaxCoatings, doc, selCoating: 0, fileName: 'QW.DAT', filePath: 'C:\\lab\\QW.DAT', refNm }, { write: false });

// By hand at 550 nm, halfway between the rows at 500 and 600 nm: n = 2.32.
assert.ok(Math.abs(coatLayerThkNm(doc.coatings[0].layers[0], byName, 550) - 0.25 * 550 / 2.32) < 1e-9,
    'the Coatings tab reads the table by straight lines');

for (const refNm of [350, 425, 550, 600, 700, 900]) {
    const shown = coatLayerThkNm(doc.coatings[0].layers[0], byName, refNm);
    const { layers } = imported(refNm);
    assert.ok(Math.abs(layers[0].thickness - shown) < 1e-9,
        `at ${refNm} nm the import gives ${layers[0].thickness} nm, the Coatings tab ${shown} nm`);
}
assert.ok(!cm.getCatalogs().some(cat => cat.id.startsWith('zemax_')), 'and nothing is written');

console.log('PASS: zemax_relative_thickness');
