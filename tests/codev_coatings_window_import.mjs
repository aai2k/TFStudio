/**
 * CODE V Coatings window, Import tab: opening a .seq or .mul file and putting
 * its layers on the front or the back of the active design.
 *
 * The layers replace one coating, as one undo step, and nothing else of the
 * design changes: its incident medium, exit medium and substrate stay, whatever
 * INC and SUB the file has. The front takes the layers as the file lists them,
 * incident side first; the back takes them reversed, since backLayers are kept
 * substrate side first. The materials the layers use, MIC entries or constant
 * indices, go into a user catalog named after the file, the way a Zemax
 * COATING.DAT import registers its materials: the same file goes back into its
 * own catalog, a material already there is used as it is (edits included), and
 * another file of the same name gets a catalog of its own. A reader error comes
 * out as the locale's sentence.
 *
 * Run: node tests/codev_coatings_window_import.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
globalThis.window = globalThis;
const persisted = { saveCatalog: async () => ({ success: true }), deleteCatalog: async () => ({ success: true }) };
globalThis.electronAPI = persisted;

const cm = await import('../src/utils/materials/catalogManager.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { parseCodevSeq } = await import('../src/utils/io/codevCoatingFile.js');
const runtime = makeHookRuntime();
const { useImportAction, useLoadAction } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/codevCoatings/useImportActions.js', runtime);
const z = getLocale('en').codevCoatings;

cm.initCatalogs({});

const SEQ = [
    'MUL',
    'MDA',
    'PHT Y',
    "TIT 'AR on glass'",
    'WL 450 550 650',
    'REF 550',
    'ANG 0',
    'MIC',
    '  MWL 450 550 650',
    "  'H' 2.40 2.35 2.31",
    "  'L' 1.47 1.46 1.455",
    "  'G' 1.525 1.52 1.515",
    'END',
    'INC 1.0',
    "COA 60 100 'H'",
    "COA 95 0 'L'",
    'COA 12 0 2.0 0.01',
    "SUB 'G'",
    'MEX',
].join('\r\n');

const FILE = 'C:\\coatings\\ar.seq';

function importOnce(stack, { filePath = FILE, fileName = 'ar.seq', side = 'front' } = {}) {
    const events = [];
    runtime.reset();
    const run = runtime.render(() => useImportAction({
        z, flash: (type, message) => events.push(['flash', type, message]),
        stack, fileName, filePath,
        checkpoint: () => events.push(['checkpoint']),
        updateDesign: (patch) => events.push(['update', patch]),
    }));
    run(side);
    return events;
}

const nAt = (id, nm) => cm.getMaterialById(id).getNK(nm);
const catalogOf = (id) => id.slice(0, id.indexOf(':'));
const fields = (layers, key) => layers.map(layer => layer[key]);

// ── Front: the layers as listed, in one undo step, the media untouched ───────
const stack = parseCodevSeq(SEQ);
assert.equal(stack.layers.length, 3);
const first = importOnce(stack);
assert.deepEqual(first[0], ['checkpoint'], 'one undo step, taken before the change');
assert.equal(first[1][0], 'update');
const patch = first[1][1];
{
    assert.deepEqual(Object.keys(patch), ['frontLayers'],
        'only the front coating changes: incident medium, exit medium, substrate and back stay');
    assert.deepEqual(fields(patch.frontLayers, 'thickness'), fields(stack.layers, 'thicknessNm'),
        'thickness in nm, incident side first');
    assert.deepEqual(fields(patch.frontLayers, 'locked'), [true, false, false], 'code 100 is a locked layer');
    const [h, l, metal] = fields(patch.frontLayers, 'material');
    assert.ok(Math.abs(nAt(h, 550)[0] - 2.35) < 1e-9, 'H is the MIC entry, n at 550 nm');
    assert.ok(Math.abs(nAt(l, 450)[0] - 1.47) < 1e-9, 'L is the MIC entry, n at 450 nm');
    assert.ok(Math.abs(nAt(metal, 550)[0] - 2.0) < 1e-9 && Math.abs(nAt(metal, 550)[1] - 0.01) < 1e-9,
        'a constant n, k on the COA line is a material of its own');

    const catId = catalogOf(h);
    assert.match(catId, /^codev_ar_[0-9a-f]{8}$/, 'a catalog of the file, with an id no other computer has');
    const cat = cm.getCatalog(catId);
    assert.equal(cat.name, 'CODE V ar');
    assert.equal(cat.source, 'user');
    assert.equal(cat.sourceFile, FILE);
    for (const layer of patch.frontLayers) assert.equal(catalogOf(layer.material), catId, 'every layer material is in it');
    assert.deepEqual(Object.keys(cat.materials).map(id => `${catId}:${id}`).sort(), [h, l, metal].sort(),
        'and nothing else: neither INC 1.0 nor the MIC entry SUB names');
    const message = first.at(-1);
    assert.equal(message[1], 'success');
    assert.ok(message[2].startsWith(z.importedFront(3, 'CODE V ar')), message[2]);
}

// ── Back: the same layers reversed, since backLayers start at the substrate ──
{
    const events = importOnce(parseCodevSeq(SEQ), { side: 'back' });
    assert.deepEqual(events[0], ['checkpoint'], 'one undo step, taken before the change');
    const backPatch = events[1][1];
    assert.deepEqual(Object.keys(backPatch), ['backLayers'], 'only the back coating changes');
    assert.deepEqual(fields(backPatch.backLayers, 'thickness'), fields(stack.layers, 'thicknessNm').reverse(),
        'the layer the file lists last, at its substrate, is the first stored');
    assert.deepEqual(fields(backPatch.backLayers, 'locked'), [false, false, true]);
    assert.deepEqual(fields(backPatch.backLayers, 'material'), fields(patch.frontLayers, 'material').reverse(),
        'the same materials, from the same catalog');
    assert.ok(events.at(-1)[2].startsWith(z.importedBack(3, 'CODE V ar')), events.at(-1)[2]);
}

// A layer of the same index as INC brings that material in, as a layer material.
{
    const text = SEQ.replace('COA 12 0 2.0 0.01', 'COA 12 0 1.0');
    const events = importOnce(parseCodevSeq(text), { filePath: 'C:\\coatings\\gap.seq', fileName: 'gap.seq' });
    const gap = events[1][1].frontLayers[2].material;
    assert.ok(Math.abs(nAt(gap, 550)[0] - 1.0) < 1e-9, 'n 1.0 on the COA line');
    assert.equal(Object.keys(cm.getCatalog(catalogOf(gap)).materials).length, 3, 'H, L and the n 1.0 layer');
}

// ── The same file again: its own catalog, the materials it holds, edits kept ──
{
    const [h] = patch.frontLayers.map(layer => layer.material);
    const catId = catalogOf(h);
    const before = Object.keys(cm.getCatalog(catId).materials).length;
    const heldId = h.slice(catId.length + 1);
    // The Material Editor saves an edit this way.
    cm.saveUserMaterial(catId, { ...cm.getCatalog(catId).materials[heldId], tabData: [[450, 2.5, 0], [550, 2.45, 0], [650, 2.4, 0]] });

    const again = importOnce(parseCodevSeq(SEQ))[1][1];
    assert.deepEqual(again.frontLayers.map(layer => layer.material), patch.frontLayers.map(layer => layer.material),
        'the layers use the materials the catalog already holds');
    assert.equal(Object.keys(cm.getCatalog(catId).materials).length, before, 'nothing is added twice');
    assert.ok(Math.abs(nAt(h, 550)[0] - 2.45) < 1e-9, 'an edit made in the Material Editor stays');
}

// The status line adds what the conversion noted, not what the reader noted:
// that is on the tab already.
{
    const text = SEQ.replace("COA 95 0 'L'", "COA 95 5 'L'").replace('ANG 0', 'ANG 0\r\nFOO 1');
    const coupled = parseCodevSeq(text);
    assert.ok(coupled.warnings.some(w => w.kind === 'unknownCommand'), 'the reader noted FOO');
    const events = importOnce(coupled, { filePath: 'C:\\coatings\\coupled.seq', fileName: 'coupled.seq' });
    const [, type, message] = events.at(-1);
    assert.equal(type, 'success');
    assert.equal(message, `${z.importedFront(3, 'CODE V coupled')} ${z.warnCoupledLayers(1)}`);
    assert.equal(events[1][1].frontLayers[1].locked, false, 'a coupled layer comes in free');
}

// Another file of the same name is another catalog.
{
    const other = importOnce(parseCodevSeq(SEQ), { filePath: 'D:\\vendor\\ar.seq' })[1][1];
    assert.notEqual(catalogOf(other.frontLayers[0].material), catalogOf(patch.frontLayers[0].material));
}

// ── Opening a file: by extension, with reader errors in the locale ────────────
async function load(result) {
    const events = [];
    window.electronAPI = { ...persisted, codevPickCoatingFile: async () => result };
    runtime.reset();
    const run = runtime.render(() => useLoadAction({
        z, flash: (type, message) => events.push(['flash', type, message]),
        setLoading: (value) => events.push(['loading', value]),
        setStatus: () => {},
        setFile: (file) => events.push(['file', file]),
    }));
    await run();
    return events;
}
{
    const events = await load({ success: true, text: SEQ, fileName: 'ar.seq', filePath: FILE });
    const file = events.find(e => e[0] === 'file')[1];
    assert.equal(file.fileName, 'ar.seq');
    assert.equal(file.filePath, FILE);
    assert.equal(file.stack.layers.length, 3);
    assert.deepEqual(events.find(e => e[0] === 'flash'), ['flash', 'success', z.loadedFile('ar.seq', 3)]);
    assert.deepEqual(events.at(-1), ['loading', false]);
}
{
    const events = await load({ success: true, text: SEQ, fileName: 'ar.mul', filePath: 'C:\\ar.mul' });
    assert.deepEqual(events.find(e => e[0] === 'flash'), ['flash', 'error', z.errNotMul], 'a .mul is read as one');
    assert.ok(!events.some(e => e[0] === 'file'), 'and a file that fails leaves the one shown before');
}
{
    const text = SEQ.replace("COA 95 0 'L'", "COA 'a'");
    const events = await load({ success: true, text, fileName: 'bad.seq', filePath: 'C:\\bad.seq' });
    assert.deepEqual(events.find(e => e[0] === 'flash'), ['flash', 'error', z.errUnknownGroup('a')]);
}
{
    const events = await load({ success: false, canceled: true });
    assert.ok(!events.some(e => e[0] === 'flash'), 'a cancelled dialog says nothing');
    assert.deepEqual(events.at(-1), ['loading', false]);
}

console.log('PASS: codev_coatings_window_import');
