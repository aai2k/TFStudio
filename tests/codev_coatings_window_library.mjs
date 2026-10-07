/**
 * Save to Coating Library from the CODE V Coatings window.
 *
 * The stack read from a file goes through the library's own Save Coating
 * dialog and comes out as an entry with its layers in deposition order,
 * substrate first, each material under the id the window's import gives it
 * and carrying its record. The incident medium and the substrate are the
 * file's INC and SUB: an index of n 1 with no k is built-in Air, any other
 * index or MIC table the material the import makes of it, embedded. Saving
 * writes no catalog. The dialog opens with the band of the analysis
 * wavelengths and the first angle of ANG. The entry applies back to a design
 * as the stack the import makes, on either side: on a computer that never
 * imported the file it computes with the records it carries, and once the
 * file has been imported it names the very materials the import put in the
 * catalog.
 *
 * Run: node tests/codev_coatings_window_library.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();

const saved = [];
window.electronAPI = new Proxy({
    saveCoating: async (record) => { saved.push(JSON.parse(JSON.stringify(record))); return { success: true }; },
}, { get: (target, key) => target[key] || (() => Promise.resolve({ success: true })) });

// Each module runs its hooks on a harness of its own, and draws with React's
// own createElement.
const realReact = globalThis.React;
async function importOnHarness(specifier) {
    const runtime = makeHookRuntime();
    globalThis.React = { ...realReact, ...runtime.React };
    try {
        return { runtime, module: await import(specifier) };
    } finally {
        globalThis.React = realReact;
    }
}
const actions = await importOnHarness('../src/components/windows/dataExchange/codevCoatings/useImportActions.js');
const dialog = await importOnHarness('../src/components/windows/design/coatingLibrary/SaveCoatingDialog.js');
const { useImportAction, useLibraryAction } = actions.module;
const { SaveCoatingDialog } = dialog.module;

const cm = await import('../src/utils/materials/catalogManager.js');
const { parseCodevSeq } = await import('../src/utils/io/codevCoatingFile.js');
const { makeCoatingEntry } = await import('../src/utils/coatingLibrary/entryModel.js');
const { validateEntry } = await import('../src/utils/coatingLibrary/validateEntry.js');
const { applyCoatingPatch } = await import('../src/utils/coatingLibrary/applyCoating.js');
const { designMaterialLookup, resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');

const c = makeTheme();
const t = makeLocale('en');
const z = t.codevCoatings;
const sd = t.coatingLibrary.saveDialog;

const seq = (lines) => ['MUL', 'MDA', 'PHT Y', ...lines, 'MEX'].join('\r\n');
const MIC = ['MIC', "  MWL 450 550 650", "  'H' 2.40 2.35 2.31", "  'L' 1.47 1.46 1.455", "  'G' 1.525 1.52 1.515", 'END'];
const LAYERS = ["COA 60 100 'H'", "COA 95 0 'L'", 'COA 12 0 2.0 0.01'];
const SEQ = seq(["TIT 'AR on glass'", 'WL 450 550 650', 'REF 550', 'ANG 12 30', ...MIC, 'INC 1.0', ...LAYERS, "SUB 'G'"]);
const FILE = { fileName: 'ar.seq', filePath: 'C:\\coatings\\ar.seq' };

// The active design the coating is applied to: air on BK7, both sides empty.
const design = {
    id: 'lens', name: 'Lens', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'both_independent', frontLayers: [], backLayers: [],
};

// What the window hands the dialog, and what it reported.
function openLibrary(stack, file = FILE) {
    let opened = null;
    const flashes = [];
    actions.runtime.reset();
    const saveToLibrary = actions.runtime.render(() => useLibraryAction({
        z, stack, ...file, flash: (type, message) => flashes.push([type, message]),
        setLibrary: (value) => { opened = value; },
    }));
    saveToLibrary();
    return { coating: opened, flashes };
}

// The layers the window's import puts on one side of `design`.
function importLayers(stack, side) {
    const updates = [];
    actions.runtime.reset();
    actions.runtime.render(() => useImportAction({
        z, stack, ...FILE, flash: () => {}, checkpoint: () => {}, updateDesign: (patch) => updates.push(patch),
    }))(side);
    return updates[0][side === 'back' ? 'backLayers' : 'frontLayers'];
}

// Every function component of the dialog is drawn without hooks, so the tree
// can be expanded by calling them.
function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}
function walk(node, visit) {
    if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
    if (!node || typeof node !== 'object') return;
    visit(node);
    walk(node.props.children, visit);
}

// Press Save on the dialog opened on `coating`; returns what was written and what the dialog showed.
async function saveThroughDialog(coating) {
    let savedName = null;
    let closed = false;
    dialog.runtime.reset();
    const tree = expand(dialog.runtime.render(() => SaveCoatingDialog({
        coating, c, t, onClose: () => { closed = true; }, onSaved: (name) => { savedName = name; },
    })));
    const strings = [];
    const inputs = [];
    let saveButton = null;
    walk(tree, (node) => {
        const { children } = node.props;
        for (const child of [].concat(children)) if (typeof child === 'string') strings.push(child);
        if (node.type === 'button' && children === sd.save) saveButton = node;
        if (node.type === 'input') inputs.push(node.props.value);
    });
    const before = saved.length;
    await saveButton.props.onClick();
    assert.equal(saved.length, before + 1, 'Save writes one coating');
    assert.ok(closed, 'and closes the dialog');
    return { entry: makeCoatingEntry(saved.at(-1)), savedName, strings, inputs };
}

const pairs = (layers) => layers.map(({ material, thickness }) => [material, thickness]);
const nkAt = (d, layers) => {
    const lookup = designMaterialLookup(d);
    return layers.map(layer => [450, 550, 650].map(lambda => lookup(layer.material).getNK(lambda)));
};

// ── A file never imported: nothing is written, the entry carries its records ─
cm.initCatalogs({});
const stack = parseCodevSeq(SEQ);
let neverImported;
{
    const { coating, flashes } = openLibrary(stack);
    assert.deepEqual(flashes, [], 'the dialog opens without a complaint');
    assert.ok(!cm.getCatalogs().some(cat => cat.id.startsWith('codev_')), 'opening the dialog writes no catalog');
    assert.deepEqual(coating.band, [450, 650], 'the band opens at the analysis wavelengths');
    assert.equal(coating.aoi, 12, 'and the angle at the first of ANG');

    const { entry, savedName, strings, inputs } = await saveThroughDialog(coating);
    neverImported = entry;
    assert.equal(inputs[0], 'AR on glass', 'the dialog proposes the title of the file');
    assert.ok(inputs.includes('450') && inputs.includes('650') && inputs.includes('12'), `with its band and angle: ${inputs}`);
    assert.ok(strings.includes(t.coatingLibrary.layersShort(3)), 'it says how many layers it saves');
    assert.ok(!strings.includes(sd.front) && !strings.includes(sd.back), 'and has no side to pick');
    assert.equal(savedName, 'AR on glass');

    assert.deepEqual(pairs(entry.layers), pairs([...coating.layers].reverse()), 'the entry holds the layers substrate first');
    assert.deepEqual(entry.layers.map(layer => layer.thickness), [12, 95, 60], 'deposition order, in nm');
    assert.match(entry.layers[2].material, /^codev_ar_[0-9a-f]{8}:h$/, 'under the id the import gives them');
    assert.equal(entry.incidentMedium, 'builtin:Air', 'INC 1.0 is built-in Air');
    assert.match(entry.substrate, /^codev_ar_[0-9a-f]{8}:g$/, 'SUB is the MIC material G, in the catalog of the file');
    assert.equal(entry.materials[entry.substrate].name, 'G');
    assert.deepEqual(Object.keys(entry.materials).sort(), [...new Set([...entry.layers.map(layer => layer.material), entry.substrate])].sort(),
        'every material is embedded, the substrate included, and Air is not');
    assert.deepEqual(entry.bands, [[450, 650]]);
    assert.equal(entry.aoi, 12);
    assert.equal(entry.referenceWavelength, 550);
    assert.equal(entry.source, z.librarySource('ar.seq'));
    assert.deepEqual(validateEntry(entry), [], 'the entry is sound');

    const glass = designMaterialLookup({ ...design, materials: entry.materials })(entry.substrate);
    assert.ok(Math.abs(glass.getNK(550)[0] - 1.52) < 1e-9, 'the substrate has the index of the MIC table');
}

// It applies to a design here, where no catalog holds its materials, as the
// stack the import makes, computed with the data of the file.
let importedFront;
{
    const { patch, clashes } = applyCoatingPatch(design, neverImported, { side: 'front' });
    assert.deepEqual(clashes, []);
    const applied = { ...design, ...patch };
    for (const layer of applied.frontLayers) {
        assert.equal(resolveDesignMaterial(applied, layer.material).status, 'embedded', 'from the records the entry carries');
    }
    importedFront = importLayers(stack, 'front');
    const imported = { ...design, frontLayers: importedFront };
    assert.deepEqual(applied.frontLayers.map(layer => layer.thickness), importedFront.map(layer => layer.thickness),
        'the same thicknesses, incident side first');
    assert.deepEqual(nkAt(applied, applied.frontLayers), nkAt(imported, importedFront), 'and the same n,k layer by layer');
}

// ── The file imported before: the entry names the import's own materials ────
{
    const catId = importedFront[0].material.split(':')[0];
    const { coating } = openLibrary(stack);
    const { entry } = await saveThroughDialog(coating);
    assert.deepEqual(pairs(entry.layers), pairs([...importedFront].reverse()),
        'layer for layer the materials and thicknesses the import put on the design');
    assert.equal(entry.materials[entry.layers[0].material].catalogUid, cm.getCatalog(catId).uid,
        'each record is the catalog\'s, stamped with it');
    assert.ok(entry.substrate.startsWith(`${catId}:`), 'SUB takes an id in the same catalog');
    assert.equal(resolveDesignMaterial({ ...design, materials: entry.materials }, entry.substrate).status, 'embedded',
        'which the import did not register, so the entry carries it');
    assert.deepEqual(validateEntry(entry), []);

    const front = applyCoatingPatch(design, entry, { side: 'front' });
    assert.deepEqual(front.clashes, []);
    assert.deepEqual(pairs(front.patch.frontLayers), pairs(importedFront), 'it applies to the front as the front import');
    const back = applyCoatingPatch(design, entry, { side: 'back' });
    assert.deepEqual(pairs(back.patch.backLayers), pairs(importLayers(stack, 'back')), 'and to the back as the back import');
    assert.equal(cm.getCatalog(catId).materials[entry.substrate.split(':')[1]], undefined, 'saving registered nothing');
}

// ── Inline media other than n 1 are materials of their own, embedded ─────────
{
    const water = parseCodevSeq(seq(['WL 450 550 650', ...MIC, 'INC 1.33', ...LAYERS, 'SUB 1.52']));
    const { coating } = openLibrary(water, { fileName: 'water.seq', filePath: 'C:\\coatings\\water.seq' });
    const { entry } = await saveThroughDialog(coating);
    const lookup = designMaterialLookup({ ...design, materials: entry.materials });
    assert.notEqual(entry.incidentMedium, 'builtin:Air', 'INC 1.33 is not air');
    assert.ok(Math.abs(lookup(entry.incidentMedium).getNK(550)[0] - 1.33) < 1e-12, 'it is n 1.33');
    assert.ok(Math.abs(lookup(entry.substrate).getNK(550)[0] - 1.52) < 1e-12, 'SUB 1.52 is n 1.52');
    assert.ok(entry.materials[entry.incidentMedium] && entry.materials[entry.substrate], 'both embedded');
    assert.equal(entry.name, 'water', 'a file with no TIT is named after the file');
    assert.equal(entry.aoi, 0, 'and with no ANG opens at normal incidence');
    assert.deepEqual(validateEntry(entry), []);
}

// ── WLG: the band opens at the wavelengths as shown, and the entry is sound ──
{
    const wlg = parseCodevSeq(seq(['WLG 400 700 10', ...MIC, ...LAYERS, "SUB 'G'"]));
    assert.notEqual(wlg.wavelengthsNm[0], 400, 'WLG wavelengths are float32 sums, not round numbers');
    const { coating } = openLibrary(wlg, { fileName: 'wlg.seq', filePath: 'C:\\coatings\\wlg.seq' });
    assert.equal(coating.band[0], 400, `the band starts at 400 nm, not ${wlg.wavelengthsNm[0]}`);
    assert.ok(Math.abs(coating.band[1] - wlg.wavelengthsNm.at(-1)) < 1e-4, `and ends at the last of them: ${coating.band[1]}`);
    const { entry } = await saveThroughDialog(coating);
    assert.deepEqual(validateEntry(entry), [], 'the materials cover the band the dialog opened with');
}

// One analysis wavelength is no band: the dialog opens with its own.
{
    const { coating } = openLibrary(parseCodevSeq(seq(['WL 550', ...MIC, ...LAYERS, "SUB 'G'"])));
    assert.equal(coating.band, undefined);
}

// With no file read there is nothing to save, and nothing is said.
{
    const { coating, flashes } = openLibrary(null);
    assert.equal(coating, null);
    assert.deepEqual(flashes, []);
}

console.log('PASS: codev_coatings_window_library');
