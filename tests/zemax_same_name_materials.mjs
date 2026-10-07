/**
 * A COATING.DAT that defines one material name twice, and one written in
 * lower case.
 *
 * The Materials tab selects by row. Checking one of two records that share a
 * name checks that record only, and each one imports on its own: the later
 * one under a name that tells it apart, and importing both never replaces one
 * with the other in the catalog. A name in lower case imports when its row is
 * checked. A COAT layer naming the repeated material is still built with the
 * last record of that name. The tab marks the repeated rows.
 *
 * Run: node tests/zemax_same_name_materials.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();

const cm = await import('../src/utils/materials/catalogManager.js');
const { parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const { fileMaterialNames } = await import('../src/components/windows/dataExchange/zemaxCoatings/catalogImport.js');
const { MaterialsTab } = await import('../src/components/windows/dataExchange/zemaxCoatings/MaterialsTab.js');
const runtime = makeHookRuntime();
const { useMaterialImportAction, useCoatingImportAction } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/zemaxCoatings/useImportActions.js', runtime);

const c = makeTheme();
const z = makeLocale('en').zemaxCoatings;

// Two TIO2 records with different data, then a material named in lower case.
const doc = parseZemaxCoating([
    'MATE TIO2', '0.40 2.35 0', '0.80 2.25 0',
    'MATE TIO2', '0.40 2.45 0', '0.80 2.35 0',
    'MATE sio2', '0.40 1.47 0', '0.80 1.45 0',
    'COAT AR', 'TIO2 0.1 1', 'sio2 0.1 1',
].join('\n'));
assert.equal(doc.materials.length, 3, 'the reader keeps both records of the repeated name');

cm.initCatalogs({});
const catalogOf = (catName) => cm.getCatalogs().find(cat => cat.name === catName);
const n400 = (material) => cm.getMaterialById(material).getNK(400)[0];
const byName = (cat) => Object.fromEntries(Object.entries(cat.materials).map(([id, m]) => [m.name, `${cat.id}:${id}`]));

// ── How the records are told apart ──────────────────────────────────────────
assert.deepEqual(fileMaterialNames(doc.materials), [
    { name: 'TIO2', repeat: { index: 1, count: 2 } },
    { name: 'TIO2 (2)', repeat: { index: 2, count: 2 } },
    { name: 'sio2', repeat: null },
]);
assert.deepEqual(fileMaterialNames([{ name: 'MgF2' }, { name: 'MGF2' }, { name: 'MGF2 (2)' }]).map(row => row.name),
    ['MgF2', 'MGF2 (3)', 'MGF2 (2)'], 'Zemax names are case-insensitive, and a number the file already uses is skipped');

// ── Selection: one row, not every row of the name ───────────────────────────
function tableRows(selRows, setSelRows = () => {}) {
    const tab = MaterialsTab({ c, z, doc, selRows, setSelRows, importMaterials: () => {} });
    const table = tab.props.children.type(tab.props.children.props);
    return table.props.children[1].props.children;
}
const checkedOf = rows => rows.map(row => row.props.children[0].props.children.props.checked);
{
    let selected = new Set();
    tableRows(selected, next => { selected = next; })[0].props.onClick();
    assert.deepEqual([...selected], [0], 'clicking the first TIO2 selects that row');
    assert.deepEqual(checkedOf(tableRows(selected)), [true, false, false], 'and checks it alone');
    tableRows(selected, next => { selected = next; })[1].props.onClick();
    tableRows(selected, next => { selected = next; })[0].props.onClick();
    assert.deepEqual(checkedOf(tableRows(selected)), [false, true, false], 'unchecking one leaves the other checked');
}

// ── The repeated rows are marked ────────────────────────────────────────────
{
    const html = renderToStaticMarkup(React.createElement(MaterialsTab, {
        c, z, doc, selRows: new Set(), setSelRows: () => {}, importMaterials: () => {},
        loading: false, onLoad: () => {}, fileName: 'SAME.DAT', panelWidth: null, setPanelWidth: () => {},
    }));
    assert.ok(html.includes(z.repeatedRow(1, 2)) && html.includes(z.repeatedRow(2, 2)), 'both TIO2 rows are marked');
    assert.ok(html.includes(z.repeatedRowTip('TIO2 (2)')), 'the second says the name it imports under');
    assert.ok(!html.includes(z.repeatedRow(1, 1)), 'a name defined once is not marked');
}

function importRows(selRows, filePath, all = false) {
    const flashes = [];
    let dialog = null;
    const importMaterials = runtime.render(() => useMaterialImportAction({
        z, flash: (type, message) => flashes.push([type, message]), doc, selRows,
        fileName: 'SAME.DAT', filePath, setInputDialog: (d) => { dialog = d; },
    }));
    importMaterials(all);
    return { flash: flashes.at(-1), dialog };
}

// ── Import of each record, one at a time ────────────────────────────────────
{
    const FILE = 'C:\\lib\\each\\SAME.DAT';
    const first = importRows(new Set([0]), FILE);
    assert.equal(first.flash[1], z.importedMaterials(1, 'Zemax SAME'), 'the first record imports alone');
    const second = importRows(new Set([1]), FILE);
    assert.equal(second.dialog, null, 'the second record is not offered as a replacement for the first');
    assert.equal(second.flash[1], z.importedMaterials(1, 'Zemax SAME'));
    const names = byName(catalogOf('Zemax SAME'));
    assert.deepEqual(Object.keys(names).sort(), ['TIO2', 'TIO2 (2)'], 'both records are in the catalog, told apart');
    assert.equal(n400(names.TIO2), 2.35);
    assert.equal(n400(names['TIO2 (2)']), 2.45);
}

// ── Import of both after one of them ────────────────────────────────────────
{
    const FILE = 'C:\\lib\\both\\SAME.DAT';
    importRows(new Set([0]), FILE);
    const both = importRows(new Set([0, 1]), FILE);
    assert.equal(both.dialog, null, 'nothing of the catalog is offered for replacement');
    const names = byName(catalogOf('Zemax SAME 2'));
    assert.deepEqual(Object.keys(names).sort(), ['TIO2', 'TIO2 (2)']);
    assert.equal(n400(names.TIO2), 2.35, 'the first keeps its data');
    assert.equal(n400(names['TIO2 (2)']), 2.45, 'the second has its own');
    const again = importRows(null, FILE, true);
    assert.equal(again.dialog, null, 'importing the whole file again changes nothing');
    assert.equal(Object.keys(catalogOf('Zemax SAME 2').materials).length, 3, 'and adds only sio2');
}

// ── A name in lower case imports when its row is checked ────────────────────
{
    const lower = importRows(new Set([2]), 'C:\\lib\\lower\\SAME.DAT');
    assert.equal(lower.flash[0], 'success');
    assert.equal(lower.flash[1], z.importedMaterials(1, 'Zemax SAME 3'), 'one material, not none');
    const names = byName(catalogOf('Zemax SAME 3'));
    assert.deepEqual(Object.keys(names), ['sio2']);
    assert.equal(n400(names.sio2), 1.47);
}

// ── A COAT layer naming the repeated material takes its last record ─────────
{
    const updates = [];
    const importCoating = runtime.render(() => useCoatingImportAction({
        z, flash: () => {}, doc, selCoating: 0, fileName: 'SAME.DAT', filePath: 'C:\\lib\\coat\\SAME.DAT',
        refNm: 550, checkpoint: () => {}, updateDesign: patch => updates.push(patch),
    }));
    importCoating();
    const [tio2, sio2] = updates[0].frontLayers;
    assert.equal(n400(tio2.material), 2.45, 'the layer is built with the last TIO2 record');
    assert.equal(cm.getMaterialById(tio2.material).name, 'TIO2 (2)', 'which the design names as the tab does');
    assert.equal(n400(sio2.material), 1.47, 'the lower-case name resolves too');
    assert.deepEqual([tio2.thickness, sio2.thickness], [100, 100]);
}

console.log('PASS: zemax_same_name_materials');
