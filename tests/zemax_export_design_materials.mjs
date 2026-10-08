/**
 * Zemax Coatings export writes every material the way the design computes it.
 *
 * A material the design carries itself (a file from another computer, a
 * deleted catalog, a Herpin equivalent layer) has no catalog entry here, so
 * the export resolves every material through the design, never written as
 * n = 1, k = 0, names the MATE after the material, and refuses with a message
 * for an id that resolves nowhere.
 *
 * Run: node tests/zemax_export_design_materials.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
globalThis.window = globalThis;
globalThis.electronAPI = { saveCatalog: async () => ({ success: true }), deleteCatalog: async () => ({ success: true }) };

const cm = await import('../src/utils/materials/catalogManager.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const runtime = makeHookRuntime();
const { useGenerateAction } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/zemaxCoatings/useExportActions.js', runtime);
const z = getLocale('en').zemaxCoatings;

cm.initCatalogs({});
cm.addCatalog({
    id: 'user_lab_00000001', name: 'Lab', source: 'user',
    materials: { L: { id: 'L', name: 'Silica lab', formulaNum: -1, tabData: [[400, 1.47, 0], [550, 1.46, 0], [800, 1.45, 0]] } },
});

const theirs = 'user_their_cat_9f00aa11:Ta2O5';
const herpinId = 'herpin-1791311162350-z3w3ye';
const design = {
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'l1', material: theirs, thickness: 65 },
        { id: 'l2', material: 'user_lab_00000001:L', thickness: 94 },
        { id: 'l3', material: herpinId, thickness: 80, herpin: { version: 1, equivalentIndex: 1.8932, referenceWavelength: 550 } },
    ],
    materials: {
        [theirs]: { id: 'Ta2O5', name: 'Ta2O5 their lab', formulaNum: -1, tabData: [[400, 2.2, 0.001], [550, 2.12, 0], [800, 2.08, 0]] },
    },
};

function generate(d, scope = 'used') {
    let preview = null;
    const flashes = [];
    // Hooks shared across windows read React when they run, so the harness
    // stands in for React while it renders.
    const real = globalThis.React;
    globalThis.React = runtime.React;
    let run;
    try {
        run = runtime.render(() => useGenerateAction({
            z, flash: (type, message) => flashes.push([type, message]), design: d,
            gStart: 500, gEnd: 600, gStep: 50, scope, coatName: 'AR', thMode: 'relative', refNm: 550,
            setPreview: (text) => { preview = text; },
        }));
    } finally {
        globalThis.React = real;
    }
    run();
    return { preview, flashes };
}

{
    const { preview, flashes } = generate(design);
    assert.equal(flashes.at(-1)[0], 'success');
    const doc = parseZemaxCoating(preview);
    assert.equal(flashes.at(-1)[1], z.generated(doc.materials.length, doc.coatings[0].layers.length),
        'the report is the locale text, with the counts of MATE records and layers written');
    const byName = Object.fromEntries(doc.materials.map(m => [m.name, m]));
    const at = (name, um) => byName[name].points.find(p => Math.abs(p[0] - um) < 1e-9);

    assert.ok(byName.TA2O5_THEIR_LAB, `the design's own material is named after it: ${Object.keys(byName)}`);
    assert.equal(at('TA2O5_THEIR_LAB', 0.55)[1], 2.12, 'and written with its own n');
    const herpinMate = Object.keys(byName).find(name => name.startsWith('HERPIN'));
    assert.ok(herpinMate, 'the Herpin material is written');
    assert.equal(at(herpinMate, 0.55)[1], 1.8932);
    assert.equal(at('SILICA_LAB', 0.55)[1], 1.46, 'a catalog material as before');

    // The file writes 8 significant digits.
    const [l1, l2, l3] = doc.coatings[0].layers;
    assert.ok(Math.abs(l1.thickness - 2.12 * 65 / 550) < 1e-7, `relative thickness with the design's n (${l1.thickness})`);
    assert.ok(Math.abs(l2.thickness - 1.46 * 94 / 550) < 1e-7);
    assert.ok(Math.abs(l3.thickness - 1.8932 * 80 / 550) < 1e-7);
}

// Scope "all" adds the design's own materials to the catalogs' ones.
{
    const { preview } = generate(design, 'all');
    const names = parseZemaxCoating(preview).materials.map(m => m.name);
    assert.ok(names.includes('TA2O5_THEIR_LAB'), 'the carried material is in an all-catalogs export');
    assert.ok(names.includes('SILICA_LAB'));
}

// An id that resolves nowhere is refused, never written as air.
{
    const broken = { ...design, frontLayers: [...design.frontLayers, { id: 'l4', material: 'user_gone_12345678:X', thickness: 10 }] };
    const { preview, flashes } = generate(broken);
    assert.equal(flashes.at(-1)[0], 'error', 'the export is refused');
    assert.equal(flashes.at(-1)[1], z.exportUnresolved('user_gone_12345678:X'), 'with a message naming the material');
    assert.equal(preview, '', 'and no preview is left to save');
}

// A catalog entry with no n,k (an empty table) that the design does not use
// does not stop an all-catalogs export; it is left out.
{
    cm.addCatalog({
        id: 'user_lab_00000001', name: 'Lab', source: 'user',
        materials: {
            L: { id: 'L', name: 'Silica lab', formulaNum: -1, tabData: [[400, 1.47, 0], [550, 1.46, 0], [800, 1.45, 0]] },
            Empty: { id: 'Empty', name: 'Not measured yet', formulaNum: -1, tabData: [] },
        },
    });
    const { preview, flashes } = generate(design, 'all');
    assert.equal(flashes.at(-1)[0], 'success', `the export goes through: ${flashes.at(-1)[1]}`);
    const names = parseZemaxCoating(preview).materials.map(m => m.name);
    assert.ok(!names.some(name => name.startsWith('NOT_MEASURED')), 'and the empty entry is not written');
}

// Built-in materials stored bare, as synthesis inserts them: every layer of the
// coating names a material the file defines, in either scope.
{
    const bare = { ...design, materials: undefined, frontLayers: [
        { id: 'b1', material: 'TiO2', thickness: 50 }, { id: 'b2', material: 'builtin:SiO2', thickness: 90 },
        { id: 'b3', material: 'SiO2', thickness: 20 },
    ] };
    for (const scope of ['used', 'all']) {
        const { preview, flashes } = generate(bare, scope);
        assert.equal(flashes.at(-1)[0], 'success', `${scope}: ${flashes.at(-1)[1]}`);
        const doc = parseZemaxCoating(preview);
        const defined = new Set(doc.materials.map(m => m.name));
        for (const layer of doc.coatings[0].layers) {
            assert.ok(defined.has(layer.material), `${scope}: layer material ${layer.material} is defined in the file`);
        }
        const silica = doc.materials.filter(m => m.name.startsWith('SIO2'));
        assert.equal(silica.length, 1, `${scope}: SiO2 bare and prefixed is one MATE record`);
    }
}

console.log('PASS: zemax_export_design_materials');
