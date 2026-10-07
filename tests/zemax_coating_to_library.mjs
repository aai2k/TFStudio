/**
 * Save to Coating Library from the Zemax Coatings window.
 *
 * The selected COAT goes through the library's own Save Coating dialog and
 * comes out as an entry with its layers in deposition order, substrate first,
 * each material under the id the window's import gives it and carrying its
 * record, between the active design's incident medium and substrate. Saving
 * writes no catalog. The entry applies back to a design as the stack the
 * import makes: on a computer that never imported the file it computes with
 * the records it carries, and once the file has been imported it names the
 * very materials the import put in the catalog.
 *
 * Run: node tests/zemax_coating_to_library.mjs
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
const actions = await importOnHarness('../src/components/windows/dataExchange/zemaxCoatings/useImportActions.js');
const dialog = await importOnHarness('../src/components/windows/design/coatingLibrary/SaveCoatingDialog.js');
const { useCoatingImportAction, useLibraryAction } = actions.module;
const { SaveCoatingDialog } = dialog.module;

const cm = await import('../src/utils/materials/catalogManager.js');
const { parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const { makeCoatingEntry } = await import('../src/utils/coatingLibrary/entryModel.js');
const { validateEntry } = await import('../src/utils/coatingLibrary/validateEntry.js');
const { applyCoatingPatch } = await import('../src/utils/coatingLibrary/applyCoating.js');
const { designMaterialLookup, resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');

const c = makeTheme();
const t = makeLocale('en');
const z = t.zemaxCoatings;
const sd = t.coatingLibrary.saveDialog;

const doc = parseZemaxCoating([
    'MATE H', '0.30 2.40 -0.001', '1.00 2.20 0',
    'MATE L', '0.30 1.48 0', '1.00 1.44 0',
    'COAT AR4', 'H 0.25 0', 'L 0.1 1', 'H 0.05 1', 'L 0.25 0',
].join('\n'));
const FILE = { fileName: 'LAB.DAT', filePath: 'C:\\lab\\LAB.DAT' };
const GLASS = 'user_glass_00000001:G';
// The active design: its substrate is a material only the design carries.
const design = {
    id: 'lens', name: 'Lens', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: GLASS, thickness: 1 }, referenceWavelength: 550,
    frontLayers: [], backLayers: [],
    materials: { [GLASS]: { id: 'G', name: 'Lab glass', formulaNum: -1, tabData: [[300, 1.52, 0], [1000, 1.5, 0]] } },
};
const windowArgs = { z, doc, selCoating: 0, refNm: 550, ...FILE };

// The coating the window hands the dialog, and the warnings it would report.
function libraryCoating() {
    let opened = null;
    const flashes = [];
    actions.runtime.reset();
    const saveToLibrary = actions.runtime.render(() => useLibraryAction({
        ...windowArgs, design, flash: (type, message) => flashes.push([type, message]),
        setLibraryCoating: (value) => { opened = value; },
    }));
    saveToLibrary();
    assert.deepEqual(flashes, [], 'the dialog opens without a complaint');
    return opened;
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

// Press Save on the dialog opened on `coating`; returns what was written and the dialog's text.
async function saveThroughDialog(coating) {
    let savedName = null;
    let closed = false;
    dialog.runtime.reset();
    const tree = expand(dialog.runtime.render(() => SaveCoatingDialog({
        coating, c, t, onClose: () => { closed = true; }, onSaved: (name) => { savedName = name; },
    })));
    const strings = [];
    let saveButton = null;
    let nameField = null;
    walk(tree, (node) => {
        const { children } = node.props;
        for (const child of [].concat(children)) if (typeof child === 'string') strings.push(child);
        if (node.type === 'button' && children === sd.save) saveButton = node;
        if (node.type === 'input' && node.props.autoFocus) nameField = node;
    });
    const before = saved.length;
    await saveButton.props.onClick();
    assert.equal(saved.length, before + 1, 'Save writes one coating');
    assert.ok(closed, 'and closes the dialog');
    return { record: saved.at(-1), savedName, strings, nameValue: nameField.props.value };
}

const pairs = (layers) => layers.map(({ material, thickness }) => [material, thickness]);

// ── A file never imported: nothing is written, the entry carries its records ─
cm.initCatalogs({});
let firstEntry;
{
    const opened = libraryCoating();
    assert.ok(!cm.getCatalogs().some(cat => cat.id.startsWith('zemax_')), 'opening the dialog writes no catalog');
    const { coating } = opened;
    assert.deepEqual(coating.layers.map(layer => layer.material.split(':')[1]), ['h', 'l', 'h', 'l'], 'incident side first, as the file lists them');

    const { record, savedName, strings, nameValue } = await saveThroughDialog(coating);
    assert.equal(nameValue, 'AR4', 'the dialog proposes the COAT name');
    assert.ok(strings.includes(t.coatingLibrary.layersShort(4)), 'and says how many layers it saves');
    assert.ok(!strings.includes(sd.front) && !strings.includes(sd.back), 'with no side to pick');
    assert.equal(savedName, 'AR4');

    const entry = makeCoatingEntry(record);
    firstEntry = entry;
    assert.deepEqual(pairs(entry.layers), pairs([...coating.layers].reverse()), 'the entry holds the layers substrate first');
    assert.match(entry.layers[0].material, /^zemax_lab_[0-9a-f]{8}:l$/, 'under the id the import gives them');
    assert.equal(entry.layers[1].thickness, 50, 'an absolute thickness in nm');
    assert.equal(entry.incidentMedium, 'builtin:Air', 'the incident medium is the active design\'s');
    assert.equal(entry.substrate, GLASS, 'and so is the substrate');
    assert.deepEqual(Object.keys(entry.materials).sort(), [...new Set(entry.layers.map(layer => layer.material)), GLASS].sort(),
        'every material that is not built in is embedded, the design\'s substrate included');
    assert.deepEqual(entry.materials[entry.layers[1].material].tabData, [[300, 2.4, 0.001], [1000, 2.2, 0]], 'with the file\'s data');
    assert.equal(entry.source, z.librarySource('AR4', 'LAB.DAT'));
    assert.equal(entry.referenceWavelength, 550, 'λ₀ is the one the thicknesses were converted at');
    assert.deepEqual(validateEntry(entry), [], 'the entry is sound');
}

// It applies to a design here, where no catalog holds its materials, as the
// stack the import makes, computed with the file's data.
let importedLayers;
{
    const { patch, clashes } = applyCoatingPatch(design, firstEntry, { side: 'front', mode: 'replace' });
    assert.deepEqual(clashes, []);
    const applied = { ...design, ...patch };
    const updates = [];
    actions.runtime.reset();
    const importCoating = actions.runtime.render(() => useCoatingImportAction({
        ...windowArgs, flash: () => {}, checkpoint: () => {}, updateDesign: (p) => updates.push(p),
    }));
    importCoating();
    importedLayers = updates[0].frontLayers;
    const imported = { ...design, frontLayers: importedLayers };
    assert.deepEqual(applied.frontLayers.map(layer => layer.thickness), importedLayers.map(layer => layer.thickness),
        'the same thicknesses, incident side first');
    const nk = (d) => {
        const lookup = designMaterialLookup(d);
        return d.frontLayers.map(layer => [400, 550, 900].map(lambda => lookup(layer.material).getNK(lambda)));
    };
    assert.deepEqual(nk(applied), nk(imported), 'and the same n,k layer by layer');
    for (const layer of applied.frontLayers) {
        assert.equal(resolveDesignMaterial(applied, layer.material).status, 'embedded', 'from the records the entry carries');
    }
}

// ── The file imported before: the entry names the import's own materials ────
{
    const { coating } = libraryCoating();
    const { record } = await saveThroughDialog(coating);
    const entry = makeCoatingEntry(record);
    assert.deepEqual(pairs(entry.layers), pairs([...importedLayers].reverse()),
        'layer for layer the materials and thicknesses the import put on the design');
    const catId = importedLayers[0].material.split(':')[0];
    assert.equal(entry.materials[entry.layers[0].material].catalogUid, cm.getCatalog(catId).uid,
        'each record is the catalog\'s, stamped with it');
    const { patch, clashes } = applyCoatingPatch({ ...design, frontLayers: [] }, entry, { side: 'front' });
    assert.deepEqual(clashes, []);
    assert.deepEqual(pairs(patch.frontLayers), pairs(importedLayers), 'and applies back as that stack');
}

// A COAT the window cannot convert is reported, and no dialog opens.
{
    let opened = null;
    const flashes = [];
    actions.runtime.reset();
    actions.runtime.render(() => useLibraryAction({
        ...windowArgs, selCoating: 5, design, flash: (type, message) => flashes.push([type, message]),
        setLibraryCoating: (value) => { opened = value; },
    }))();
    assert.equal(opened, null);
    assert.deepEqual(flashes, [['error', z.importNotStack]]);
}

console.log('PASS: zemax_coating_to_library');
