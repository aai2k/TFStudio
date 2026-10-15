/**
 * The Monte-Carlo trial inspector, the Design Cleaner, the Variator, Needle
 * Manual, page 2 of the monitoring wizards, the Stack Formula preview and
 * Design Import number layers as the Design Editor does; Monte Carlo and the
 * Cleaner name them by material name.
 *
 * Front layers are stored air side first, but the Design Editor calls the one on
 * the substrate F1 (L1); back layers are stored substrate first and B1 is the
 * one on the substrate. A catalog id such as 'builtin:TiO2' is never shown.
 *
 * Run: node tests/layer_numbers_in_tool_windows.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { matFriendlyName } = await import('../src/components/windows/optimization/synthesisShared/materialNames.js');

const h = React.createElement;
const c = makeTheme();
const t = makeLocale();
const text = element => renderToStaticMarkup(element).replace(/<[^>]*>/g, '\n')
    .split('\n').map(part => part.trim()).filter(Boolean);

// Air side first: F3 is the thin Ta2O5 next to the air, F1 the SiO2 on the
// substrate.
const design = {
    id: 'numbers', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'a', material: 'builtin:Ta2O5', thickness: 2 },
        { id: 'b', material: 'builtin:TiO2', thickness: 60 },
        { id: 'c', material: 'builtin:SiO2', thickness: 94 },
    ],
    backLayers: [
        { id: 'd', material: 'builtin:MgF2', thickness: 100 },
        { id: 'e', material: 'builtin:Al2O3', thickness: 3 },
    ],
};
const noIds = (lines, where) => assert.ok(!lines.some(line => line.includes('builtin:')), `${where} shows a catalog id`);

// Every block runs, and the failures are listed together.
const failures = [];
async function check(name, fn) {
    try { await fn(); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

await check('Monte-Carlo trial inspector', async () => {
    const { buildLayerStatistics, buildTrialDetailRows } = await import(
        '../src/components/windows/analysis/errorAnalysis/trialModel.js');
    const input = { design, front: design.frontLayers, back: design.backLayers, hasFront: true, hasBack: true };
    const rows = buildTrialDetailRows({ ...input, trial: null });
    assert.deepEqual(rows.map(row => row.label), ['F3', 'F2', 'F1', 'B1', 'B2'], 'trial rows');
    assert.ok(rows[0].material.startsWith('Ta2O5') && rows[3].material.startsWith('MgF2'), 'trial rows name the materials');
    noIds(rows.map(row => row.material), 'the trial rows');
    const trials = [{ dThkF: [0, 0, 5], dThkB: [0, 0] }];
    const worst = buildLayerStatistics({ ...input, trials }).byRms[0];
    assert.equal(worst.label, 'F1', 'the most perturbed layer is the one on the substrate');
    assert.ok(worst.material.startsWith('SiO2'), `it reads ${worst.material}`);
});

await check('Design Cleaner', async () => {
    const { listThinLayers, cleanupDesign } = await import('../src/utils/synthesis/designCleaner.js');
    const { CleanerThinList } = await import(
        '../src/components/windows/optimization/designCleaner/CleanerThinList.js');
    const { CleanerOpsTable } = await import(
        '../src/components/windows/optimization/designCleaner/CleanerOpsTable.js');
    const dc = t.designCleaner;
    const thin = text(h(CleanerThinList, { c, dc, units: t.units, design, thinList: listThinLayers(design, 5) }));
    assert.ok(thin.includes('F3') && thin.includes('B2'), `the thin-layer list reads ${thin.join(' | ')}`);
    assert.ok(!thin.includes('F1') && !thin.includes('B1'), 'the thin layers keep their own numbers');
    noIds(thin, 'the thin-layer list');

    // The thin Ta2O5 (F3) and Al2O3 (B2) are removed.
    const { ops } = cleanupDesign(design, { dMin: 5, mergeAdjacent: true, cleanBack: true });
    const table = text(h(CleanerOpsTable, { c, dc, units: t.units, design, ops, dMin: 5 }));
    assert.ok(table.includes('F3') && table.includes('B2') && !table.includes('F1'), `the operations read ${table.join(' | ')}`);
    noIds(table, 'the operations');
    // With two SiO2 layers in a row, the one on the substrate (F1) merges into
    // its neighbour (F2).
    const pair = { ...design, frontLayers: [{ id: 'x', material: 'builtin:SiO2', thickness: 50 }, design.frontLayers[2]], backLayers: [] };
    const merge = cleanupDesign(pair, { dMin: 5, mergeAdjacent: true, cleanBack: true }).ops;
    const merged = text(h(CleanerOpsTable, { c, dc, units: t.units, design: pair, ops: merge, dMin: 5 }));
    assert.ok(merged.includes('F1') && merged.includes('→ F2'), `the merge reads ${merged.join(' | ')}`);
});

await check('Variator', async () => {
    const { LayerSliderList } = await import('../src/components/windows/optimization/variator/LayerSliderList.js');
    const sliders = side => text(h('div', null, LayerSliderList({
        design, layers: side === 'front' ? design.frontLayers : design.backLayers, side,
        baseById: new Map(), dThk: {}, onChange() {}, c, v: t.variator, units: t.units,
    })));
    const front = sliders('front').filter(line => /^F\d/.test(line));
    const back = sliders('back').filter(line => /^B\d/.test(line));
    assert.deepEqual(front.map(line => line.split(' ')[0]), ['F3', 'F2', 'F1'], `the front sliders read ${front.join(' | ')}`);
    assert.ok(front[0].includes('Ta2O5'), 'F3 is the Ta2O5 next to the air');
    assert.deepEqual(back.map(line => line.split(' ')[0]), ['B1', 'B2'], `the back sliders read ${back.join(' | ')}`);
});

await check('Needle Manual', async () => {
    const { resolveHostInfo } = await import('../src/components/windows/optimization/needleManual/model.js');
    const tn = t.needleManual;
    const scan = side => ({ side, layers: side === 'front' ? design.frontLayers : design.backLayers });
    const gap = (side, pos) => resolveHostInfo({ intra: false, pos }, scan(side), 1, tn, design).gapLabel;
    const name = (side, k) => matFriendlyName(scan(side).layers[k].material, design);
    assert.equal(gap('front', 0), tn.gapIncident(3, name('front', 0)), 'the front gap at the air is next to F3');
    assert.equal(gap('front', 3), tn.gapSubstrate(1, name('front', 2)), 'the front gap at the substrate is next to F1');
    assert.equal(gap('front', 1), tn.gapBetween(3, name('front', 0), 2, name('front', 1)));
    assert.equal(gap('back', 0), tn.gapSubstrate(1, name('back', 0)), 'the back gap at the substrate is next to B1');
    assert.equal(gap('back', 2), tn.gapExit(2, name('back', 1)), 'the back gap at the exit medium is next to B2');
    const host = resolveHostInfo({ intra: true, layerK: 0, frac: 0.5 }, scan('front'), 1, tn, design);
    assert.equal(host.hostNumber, 3, 'a needle inside the air-side layer goes into layer 3');
    for (const side of ['front', 'back']) {
        const bare = resolveHostInfo({ intra: false, pos: 0 }, { side, layers: [] }, 1, tn, design).gapLabel;
        assert.equal(bare, tn.gapBare, `a needle on the bare ${side} substrate names no layer`);
    }
});

await check('Monitoring wizard, excluded layers', async () => {
    const { PageDeviations } = await import('../src/components/windows/simulation/wizardKit/PageDeviations.js');
    const layers = design.frontLayers;
    const rows = text(h(PageDeviations, {
        p: { matDev: {}, layers: layers.map(() => ({})), shutterMean: 0, shutterRms: 0 }, set() {},
        materialIds: [], layers, resolveMat: id => ({ name: id }), c, B: t.bbmSim,
    }));
    const numbers = rows.filter(line => /^\d$/.test(line));
    assert.deepEqual(numbers, ['3', '2', '1'], `the layer numbers read ${numbers.join(', ')}`);
});

await check('Stack Formula preview', async () => {
    const { LayerTable } = await import('../src/components/windows/design/stackFormula/LayerTable.js');
    const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
    const rows = text(h(LayerTable, {
        compiled: { ok: true, layers: design.frontLayers }, refLambda: 550,
        resolveMaterial: designMaterialLookup(design), c, sf: t.stackFormula,
    }));
    const numbers = rows.filter(line => /^\d$/.test(line));
    assert.deepEqual(numbers, ['3', '2', '1'], `the preview numbers read ${numbers.join(', ')}`);
});

await check('Design Import', async () => {
    const { DesignImportDialog } = await import('../src/components/dialogs/designImport/DesignImportDialog.js');
    const { buildImportedDesign } = await import('../src/utils/io/designImport/buildDesign.js');
    // The preview lists the front layers incident side first, so its first row
    // is the layer the Design Editor will call 2.
    const dds ='<EssentialMacleodDesign><Parameters><ReferenceWavelength> 550</ReferenceWavelength><ThicknessType>P</ThicknessType></Parameters>'
        + '<Medium>Air</Medium><Substrate>Glass</Substrate><Layers>'
        + '<Layer LayerNumber="1"><Material>MgF2</Material><Thickness> 100</Thickness></Layer>'
        + '<Layer LayerNumber="2"><Material>TiO2</Material><Thickness> 50</Thickness></Layer></Layers></EssentialMacleodDesign>';
    // Server rendering warns about the material picker's layout effect.
    const consoleError = console.error;
    console.error = () => {};
    const rows = text(h(DesignImportDialog, {
        fileImport: { files: [{ name: 'two', ext: 'dds', dir: 'ml', text: dds }], units: {} },
        setFileImport() {}, onCommit() {}, folders: [{ id: 'f1', name: 'My Designs' }], defaultFolderId: 'f1', t, c,
    }));
    console.error = consoleError;
    const numberOf = material => rows[rows.indexOf(material) - 1];
    assert.ok(numberOf('MgF2') === '2' && numberOf('TiO2') === '1', `the preview reads ${rows.join(' | ')}`);
    const item = {
        name: 'two', program: 'macleod', file: 'two.dds', referenceWavelengthNm: 550, angleDeg: 0, matchAngleDeg: 0, matchMedium: 1,
        incidentMedium: 'Air', substrate: 'Glass', exitMedium: null, substrateThicknessMm: null, backSurface: false,
        front: [{ material: 'TiO2', thicknessNm: 50, optical: null, locked: false },
            { material: 'Unknown', thicknessNm: null, optical: { kind: 'fwot', value: 0.25 }, locked: false }],
        back: [], formula: null, symbols: {}, constants: {}, comments: [], notes: [],
    };
    const { warnings } = buildImportedDesign(item, name => ({ Air: 'builtin:Air', Glass: 'builtin:BK7', TiO2: 'builtin:TiO2' })[name] || null, t.designImport);
    assert.equal(warnings[0]?.index, 1, 'a warning names the layer on the substrate layer 1');
});

if (failures.length) {
    console.error(`layer_numbers_in_tool_windows: ${failures.length} failed`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log('layer_numbers_in_tool_windows: passed');
