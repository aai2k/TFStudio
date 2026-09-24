/**
 * Material tables whose cells hold no number, and an OptiLayer design whose
 * folder holds a material file like that.
 *
 * A cell with no number in it (null, empty, text) is missing: its row is left
 * out, never read as n = 0, and a table with no row left gives no material.
 * Text in a cell is read the way the Material Editor's grid reads it, so the
 * editor's preview and the saved material give the same n,k. An empty k is 0
 * in both.
 *
 * The OptiLayer reader refuses a file whose n column holds no number, as it
 * refuses one with no n column. The material import lists it with the files it
 * could not read; a design import passes it over as it passes over any file
 * the reader refuses, and the design still imports.
 *
 * Run: node tests/material_import_unusable_table.mjs
 */
import assert from 'node:assert/strict';
import { createTabulatedNKSampler, LINEAR_INTERPOLATION } from '../src/utils/materials/pchip.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { parseOptiLayerFile } from '../src/utils/materials/optilayerParser.js';
import { D_LINE_NM } from '../src/utils/materials/optilayerParser/constants.js';
import { parseMaterialFiles } from '../src/utils/materials/materialFileImport.js';
import { parseOptiLayerDesign } from '../src/utils/io/designImport/optilayerDesign.js';
import { parseDesignFiles } from '../src/utils/io/designImport/designFileImport.js';
import { buildNKFromDraft } from '../src/components/windows/design/materialEditor/nkSamplers.js';

// ── A cell with no number is missing, not zero ───────────────────────────────

const blankN = [[400, null, 0], [600, '', 0], [800, 'n/a', 0]];
assert.equal(createTabulatedNKSampler(blankN), null, 'a table whose n cells hold no number gives no sampler');
assert.equal(makeGetNK({ formulaNum: -1, tabData: blankN }), null, 'and no material, rather than n = 0');
assert.equal(createTabulatedNKSampler([[null, 1.5, 0], ['', 1.6, 0]]), null,
    'nor does one whose wavelength cells hold none');

const partial = [[400, 1.50, 0], [500, null, 0], [600, '', 0], [700, 1.47, 0]];
const kept = [[400, 1.50, 0], [700, 1.47, 0]];
for (const rule of [undefined, LINEAR_INTERPOLATION]) {
    const partialNK = createTabulatedNKSampler(partial, rule);
    const keptNK = createTabulatedNKSampler(kept, rule);
    assert.deepEqual(partialNK.tabData, kept, `${partialNK.interp}: rows with a blank n are left out`);
    for (const nm of [450, 500, 550, 600, 650]) {
        assert.equal(partialNK(nm)[0], keptNK(nm)[0], `${partialNK.interp}: n at ${nm} nm comes from the rows that hold one`);
    }
}
assert.deepEqual(createTabulatedNKSampler([[400, 1.5, null], [700, 1.47, '']]).tabData, [[400, 1.5, 0], [700, 1.47, 0]],
    'an empty k is 0');

// The Material Editor's preview and the material saved from the same cells.
{
    const draft = {
        type: 'tabular',
        rows: [
            { lam: '400', n: '1,50', k: '' },
            { lam: '500', n: '', k: '' },
            { lam: '600', n: 'x', k: '0' },
            { lam: '700', n: '1.47', k: '1e-4' },
            { lam: '800', n: '1.46', k: '2E-4' },
        ],
    };
    const editor = buildNKFromDraft(draft);
    const catalog = makeGetNK({ formulaNum: -1, tabData: draft.rows.map(row => [row.lam, row.n, row.k]) });
    for (const nm of [400, 450, 500, 600, 650, 750, 800]) {
        assert.deepEqual(catalog(nm), editor(nm), `the table reads its cells as the editor does, at ${nm} nm`);
    }
}

// ── OptiLayer: a file whose n column holds no number ──────────────────────────

const lmText = (doc) => JSON.stringify({ nType: 0, kType: 0, ...doc });
const lm = (name, wavelength, n, k) => ({ name, ext: 'lm', text: lmText({ wavelength, n, k, name }) });
const blank = lm('Blank', [400, 1000, 1600], [null, null, null], [0, 0, 0]);
const text = lm('Text', [400, 1000, 1600], ['n/a', 'n/a', 'n/a'], [0, 0, 0]);
const good = lm('SiO2 table', [400, 1000, 1600], [1.47, 1.45, 1.44], [0, 0, 0]);

for (const file of [blank, text]) {
    assert.throws(() => parseOptiLayerFile(file.text, `${file.name}.lm`), /has no n data/,
        `${file.name}.lm is refused by the reader`);
}
assert.throws(() => parseOptiLayerFile(lmText({ nType: 99, wavelength: [400, 1000], n: [null, null], k: [0, 0] }), 'X.lm'),
    /has no n data/, 'also when the table stands in for a dispersion model the reader does not know');

{
    const picked = parseMaterialFiles([blank, text, good]);
    assert.deepEqual(picked.items.map(item => item.file), ['SiO2 table.lm'], 'the material import offers the usable file');
    assert.deepEqual(picked.errors.map(error => error.file), ['Blank.lm', 'Text.lm'],
        'and lists the other two with the files it could not read');
    assert.ok(picked.errors.every(error => /has no n data/.test(error.error)), 'saying why');
}

// A table with some blank n cells imports; its d-line index is read from the
// rows that hold an n, as the material's own n,k is.
{
    const gappy = parseOptiLayerFile(lmText({ name: 'Gappy', wavelength: [400, 550, 600, 1000], n: [1.47, null, 1.46, 1.45], k: [0, 0, 0, 0] }), 'Gappy.lm');
    const rowsWithN = createTabulatedNKSampler([[400, 1.47, 0], [600, 1.46, 0], [1000, 1.45, 0]]);
    assert.equal(gappy.nd, rowsWithN(D_LINE_NM)[0], `nd from the rows that hold an n: ${gappy.nd}`);
    assert.equal(makeGetNK(gappy)(D_LINE_NM)[0], gappy.nd, 'and the same as the material gives');
}

// ── A design whose folder holds such a file ───────────────────────────────────

// Layer H (n 2.35) matches no folder file; layer Blank names the refused file
// and has the index of the folder's SiO2 table.
const design = JSON.stringify({
    VERSION: 1, name: 'AR', controlW: 1000, matchAngle: 0, matchMedium: 1,
    layers: [
        { abbr: 'H', qwot_thickness: 1, status: 'A', zn_re: 2.35, zn_im: 0 },
        { abbr: 'Blank', qwot_thickness: 1, status: 'A', zn_re: 1.45, zn_im: 0 },
    ],
});
const folder = [text, blank, good];
const unreadable = folder.map(file => (file === good ? file : { ...file, text: '{ not json' }));

const imported = parseOptiLayerDesign(design, 'AR.dsg', { siblings: folder });
assert.deepEqual(imported, parseOptiLayerDesign(design, 'AR.dsg', { siblings: unreadable }),
    'the design imports as it does when the two files cannot be read at all');
assert.ok(!Object.hasOwn(imported.embedded, 'Blank') && !Object.hasOwn(imported.embedded, 'Text'),
    'neither refused file is carried into the design');
assert.equal(imported.front[0].material, 'SiO2 table', 'the layer named after a refused file is matched by its index');
assert.ok(Object.hasOwn(imported.constants, imported.front[1].material), 'a layer no file matches keeps its stored index');

{
    const batch = parseDesignFiles([{ name: 'AR', ext: 'dsg', dir: 'folder', text: design, siblings: folder }]);
    assert.deepEqual(batch.errors, [], 'the import does not fail');
    assert.equal(batch.items.length, 1);
}

console.log('PASS: material_import_unusable_table');
