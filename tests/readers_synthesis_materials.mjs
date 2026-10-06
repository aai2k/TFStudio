/**
 * The synthesis windows and the materials a design carries itself.
 *
 * A Herpin equivalent layer has a material of its own: a constant index E with
 * no absorption, an equivalent of the collapsed group at one wavelength and
 * normal incidence only. It is a layer material of the design, and the default
 * pool is the design's own layer materials, but it must never be offered as a
 * film to insert.
 *
 * A material that travelled inside a .tfs and is in no catalog here must be
 * named and coloured in the synthesis windows the way the Design Editor shows
 * it, from the definition the design carries, not by its id tail in a hash
 * colour.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    catalogManager,
    { herpinCollapsePreview },
    { defaultPoolSelection },
    { getPoolMaterials, poolCatalogs, poolMatEntries },
    { buildDesignCatalog, DESIGN_CATALOG_ID },
    { matFriendlyName },
    { matColor, matColorAlpha },
    { buildPlotData, resolveHostInfo },
    { SynthesisHistoryTable },
    { MaterialPoolPanel },
    { synthesisSidebarSession },
    { PreviewPanel },
] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/windows/design/designEditor/layerTools.js'),
    import('../src/components/windows/optimization/synthesisShared/catSelection.js'),
    import('../src/components/windows/optimization/synthesisShared/catalogPool.js'),
    import('../src/utils/materials/designCatalog.js'),
    import('../src/components/windows/optimization/synthesisShared/materialNames.js'),
    import('../src/components/windows/optimization/synthesisShared/materialColors.js'),
    import('../src/components/windows/optimization/needleManual/model.js'),
    import('../src/components/windows/optimization/synthesisShared/SynthesisHistoryTable.js'),
    import('../src/components/windows/optimization/synthesisShared/MaterialPoolPanel.js'),
    import('../src/components/windows/optimization/synthesisShared/sessionState.js'),
    import('../src/components/windows/optimization/needleManual/PreviewPanel.js'),
]);

const c = makeTheme();
const t = makeLocale();
catalogManager.initCatalogs({});

// ── A Herpin equivalent material is never a synthesis candidate ─────────────
{
    const base = {
        ...makeSampleDesign(), id: 'herpin-pool',
        frontLayers: [
            { id: 'x', material: 'builtin:TiO2', thickness: 57 },
            { id: 'a', material: 'builtin:SiO2', thickness: 20 },
            { id: 'b', material: 'builtin:TiO2', thickness: 15 },
            { id: 'c', material: 'builtin:SiO2', thickness: 20 },
        ],
    };
    const design = herpinCollapsePreview(base, 'front', ['a', 'b', 'c'], 550).design;
    const herpinId = design.frontLayers.find(layer => layer.material.startsWith('herpin-')).material;

    const selection = defaultPoolSelection(design);
    const pool = getPoolMaterials(selection.cats, { excluded: selection.excl, design });
    assert.deepEqual(pool.map(entry => entry.id), ['builtin:TiO2'],
        'the default pool is the real film the stack is made of, nothing else');

    const everything = new Set([DESIGN_CATALOG_ID, ...catalogManager.getCatalogs().map(cat => cat.id)]);
    const widest = getPoolMaterials(everything, { design });
    assert.ok(!widest.some(entry => entry.id === herpinId), 'not even with every catalog ticked');
    assert.ok(!poolMatEntries(buildDesignCatalog(design, '')).some(entry => entry.fullId === herpinId),
        'and the pool panel does not list it');

    // A file saved before the material carried its group: the id alone marks it.
    const record = design.materials?.[herpinId];
    const bare = { ...design, materials: { [herpinId]: { ...record, group: undefined } } };
    assert.ok(!getPoolMaterials(everything, { design: bare }).some(entry => entry.id === herpinId),
        'a Herpin material is recognised by its id prefix as well');
}

// ── A catalog material under an id the design computes with its own copy ────
// The copy came from another computer's catalog of the same id with other n,k.
// A layer inserted under that id computes with the copy, so the catalog's
// material is not scanned in its place.
{
    const X = { id: 'X', name: 'Ta2O5 (lab)', formulaNum: -1, tabData: [[400, 2.1, 0], [800, 2.0, 0]] };
    catalogManager.initCatalogs({ lab: { id: 'lab', uid: 'stamp-here', name: 'Lab', source: 'user', materials: { X } } });
    const design = {
        ...makeSampleDesign(), id: 'conflict-pool',
        frontLayers: [{ id: 'l1', material: 'lab:X', thickness: 60 }],
        materials: { 'lab:X': { ...X, name: 'Ta2O5 their lab', tabData: [[400, 2.3, 0], [800, 2.2, 0]], catalogUid: 'stamp-there' } },
    };
    const labOnly = getPoolMaterials(new Set(['lab']), { design });
    assert.deepEqual(labOnly.map(entry => entry.id), [], 'the catalog\'s material is not a candidate under that id');
    const withDesign = getPoolMaterials(new Set(['lab', DESIGN_CATALOG_ID]), { design });
    assert.equal(withDesign.find(entry => entry.id === 'lab:X')?.mat.getNK(550)[0] > 2.2, true,
        'through the design group it is, with the n,k the design computes with');
    catalogManager.initCatalogs({});
}

// ── Names and colours come from the definition the design carries ───────────
const carried = 'user_lab_1a2b3c4d:TiO2tab';
const design = {
    ...makeSampleDesign(), id: 'received',
    frontLayers: [
        { id: 'l1', material: carried, thickness: 60 },
        { id: 'l2', material: 'builtin:SiO2', thickness: 90 },
    ],
    materials: {
        [carried]: {
            id: 'TiO2tab', name: 'Titania (measured)', color: '#123456', formulaNum: -1,
            coefficients: [], kTable: [], tabData: [[300, 2.42, 0], [1200, 2.3, 0]],
        },
    },
};
{
    assert.equal(matFriendlyName(carried), 'TiO2tab', 'without the design only the id is known');
    assert.equal(matFriendlyName(carried, design), 'Titania (measured)');
    assert.equal(matColor(carried, design), '#123456');
    assert.equal(matColorAlpha(carried, design, 0.5), 'rgba(18, 52, 86, 0.5)');

    // A material that resolves nowhere keeps the old fallback.
    const gone = 'user_lab_1a2b3c4d:Gone';
    assert.equal(matFriendlyName(gone, design), 'Gone');
    assert.equal(matColor(gone, design), matColor(gone));
    // A catalog material is unchanged by passing the design.
    assert.equal(matFriendlyName('builtin:SiO2', design), matFriendlyName('builtin:SiO2'));
    assert.equal(matColor('builtin:SiO2', design), matColor('builtin:SiO2'));
}

// ── Needle Manual: profile legend, layer bands, gap label and preview ───────
{
    const layers = design.frontLayers;
    const scan = {
        zb: [0, 60, 150], layers,
        candidates: [
            { materialId: carried, pos: 1, intra: false, grad: -0.2 },
            { materialId: 'builtin:SiO2', pos: 1, intra: false, grad: -0.1 },
        ],
    };
    const plot = buildPlotData(scan, design);
    const legend = plot.materials.find(entry => entry.materialId === carried);
    assert.equal(legend.name, 'Titania (measured)');
    assert.equal(legend.color, '#123456');
    assert.equal(plot.bands[0].color, '#123456', 'the layer band has the material colour');

    const tn = t.needleManual;
    const selected = { materialId: carried, pos: 1, intra: false, grad: -0.2, z: 60 };
    const host = resolveHostInfo(selected, scan, 1, tn, design);
    assert.ok(host.gapLabel.includes('Titania (measured)'), `gap label: ${host.gapLabel}`);

    const html = renderToStaticMarkup(React.createElement(PreviewPanel, {
        selected, hostInfo: host, dNew: 10, dRange: [1, 200], predictedOMF: null, omf0: null,
        evaluationBusy: false, onDNew() {}, onApply() {}, onStop() {}, busy: false, refining: false,
        design, c, t,
    }));
    assert.ok(html.includes('Titania (measured)'), 'the preview names the material');
    assert.ok(html.includes('#123456'), 'and shows its colour');
}

// ── History table and pool panel, inside the design they belong to ──────────
{
    const labels = {
        noGens: '-', genCol: 'G', sideCol: 'S', layersCol: 'L', mfCol: 'MF', totCol: 'T',
        timeCol: 't', dMFCol: 'd', matCol: 'M', restore: 'R', sideBack: 'B', sideFront: 'F',
        runSeparator: n => `Run ${n}`, rescueRow: 'rescue',
    };
    const rows = [{ id: 'g1', genNum: 1, layerCount: 3, mf: 0.1, tot: 150, tMs: 100, dMF: -0.01, insertMat: carried }];
    const table = renderToStaticMarkup(withDesign(React.createElement(SynthesisHistoryTable, {
        rows, bestMF: 0.1, onRestore() {}, showSide: false, c, labels,
    }), design));
    assert.ok(table.includes('Titania (measured)'), 'the history names the inserted material');
    assert.ok(table.includes('rgba(18, 52, 86, 0.27)'), 'in its own colour');

    synthesisSidebarSession.write(null, { poolExpanded: { probe: new Set([DESIGN_CATALOG_ID]) } });
    const panel = renderToStaticMarkup(withDesign(React.createElement(MaterialPoolPanel, {
        sessionKey: 'probe', catalogs: poolCatalogs(design, 'This design'),
        selectedCats: new Set([DESIGN_CATALOG_ID]), excludedMats: new Set(),
        onToggleCat() {}, onSelectAllCats() {}, onClearCats() {}, onToggleMat() {},
        running: false, c, labels: { materialPool: 'Pool', poolAll: 'All', poolClear: 'Clear' },
    }), design));
    assert.ok(panel.includes('Titania (measured)'), 'the pool lists the material by its name');
    assert.ok(panel.includes('background:#123456'), 'with the colour the Design Editor shows');
    synthesisSidebarSession.reset();
}

console.log('PASS: readers_synthesis_materials');
