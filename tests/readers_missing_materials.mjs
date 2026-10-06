/**
 * Windows that read a material the design does not hold: the n,k
 * Characterization witness, the witness chip glass of the Monitor Worksheet and
 * the Process Exporter, and the material Material Dispersion plots.
 *
 * Each of them names its material in a session value, so the missing-material
 * gate of the design never sees it. When that material's catalog is deleted,
 * the window must neither compute with Air, nor crash, nor show a raw English
 * error: it says which material is gone, in the user's language, and the chip
 * glass falls back to the design substrate.
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
    nkModel,
    nkResults,
    { nkCharacterizationResultSession },
    { NkCharacterization },
    { monitorWorksheetSession },
    { useMonitorWorksheet },
    { MonitorWorksheet },
    { useChipPlan },
    { buildDepositionModel },
    { buildNotices, ProcessSimulator },
    { MaterialDispersionEvaluation },
    { materialDispersionSession },
    { computeWorksheet },
    { getLocale },
] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/model.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/resultsModel.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/sessionState.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/NkCharacterization.js'),
    import('../src/components/windows/simulation/monitorWorksheet/sessionState.js'),
    import('../src/components/windows/simulation/monitorWorksheet/useMonitorWorksheet.js'),
    import('../src/components/windows/simulation/monitorWorksheet/MonitorWorksheet.js'),
    import('../src/components/windows/dataExchange/processSimulator/useChipPlan.js'),
    import('../src/components/windows/dataExchange/processSimulator/model.js'),
    import('../src/components/windows/dataExchange/processSimulator/ProcessSimulator.js'),
    import('../src/components/windows/analysis/materialDispersion/MaterialDispersionEvaluation.js'),
    import('../src/components/windows/analysis/materialDispersion/sessionState.js'),
    import('../src/utils/report/reportData/worksheet.js'),
    import('../src/constants/locales/index.js'),
]);

const c = makeTheme();
const t = makeLocale();
const LANGUAGES = ['en', 'ru', 'zh', 'it'];
const render = (element, design) => renderToStaticMarkup(withDesign(element, design));
// Text as the server renderer writes it into the markup.
const escaped = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

catalogManager.initCatalogs({});

// A glass in a user catalog, picked in a window and then taken away with its
// catalog in the Material Editor.
function glassInDeletedCatalog(name) {
    const catalog = catalogManager.createUserCatalog(name);
    catalogManager.saveUserMaterial(catalog.id, {
        id: 'B270', name: 'B270', formulaNum: -1,
        tabData: [[300, 1.53, 0], [1200, 1.51, 0]],
    });
    return { catalogId: catalog.id, id: `${catalog.id}:B270` };
}

// ── n,k Characterization refuses to fit on a material that is not there ─────
{
    const lambdas = Array.from({ length: 13 }, (_, index) => 400 + 50 * index);
    const curve = (quantity, id) => ({
        id, name: `witness ${quantity}`, quantity, x: lambdas,
        y: lambdas.map(() => (quantity === 'T' ? 0.9 : 0.08)),
        color: '#888', visible: true, aoi: 0, pol: 'avg', side: 'front',
    });
    const design = {
        ...makeSampleDesign(), id: 'nk-witness',
        substrate: { material: 'builtin:BK7', thickness: 1 },
        measuredCurves: [curve('T', 'meas-t'), curve('R', 'meas-r')],
    };
    const glass = glassInDeletedCatalog('Witness glass');
    const settings = {
        transmittanceId: 'meas-t', reflectanceId: 'meas-r', indexModel: 'cauchy',
        substrateId: glass.id, substrateThicknessMm: '', thicknessNm: '', fixThickness: false,
        lambdaStart: '400', lambdaEnd: '1000',
    };

    const before = nkModel.characterizationRequest(design, settings);
    assert.equal(before.error, undefined, 'with its catalog present the witness glass is fitted on');
    assert.ok(Math.abs(before.request.sample.substrate.n[0] - 1.53) < 0.01,
        'the request carries the glass n, sampled on this thread');

    catalogManager.removeCatalog(glass.catalogId);
    const after = nkModel.characterizationRequest(design, settings);
    assert.equal(after.error, 'materialMissing',
        'a witness glass whose catalog is gone must stop the fit, not become Air');
    assert.deepEqual(after.materialIds, [glass.id]);

    // An imported design whose substrate name was never mapped, and a medium
    // that resolves nowhere, are refused the same way.
    const unmapped = { ...design, substrate: { material: 'missing:Corning 7980', thickness: 1 } };
    assert.deepEqual(nkModel.characterizationRequest(unmapped, { ...settings, substrateId: '' }).materialIds,
        ['missing:Corning 7980']);
    const lostMedium = { ...design, incidentMedium: 'missing:Index oil' };
    assert.deepEqual(nkModel.characterizationRequest(lostMedium, { ...settings, substrateId: '' }).materialIds,
        ['missing:Index oil']);
    assert.equal(nkModel.runCharacterization(unmapped, { ...settings, substrateId: '' }).error,
        'materialMissing', 'the run on this thread is refused too');

    for (const code of LANGUAGES) {
        const nk = getLocale(code).nkCharacterization;
        const [notice] = nkResults.characterizationNotices(after, nk, false);
        assert.ok(notice.label.includes(glass.id),
            `${code}: the notice names the material that is gone: ${notice.label}`);
        assert.equal(notice.tone, 'error');
    }

    nkCharacterizationResultSession.write(design, { result: after, ranWith: 'run' });
    const html = render(React.createElement(NkCharacterization, { c, t, theme: c }), design);
    assert.ok(html.includes(glass.id), 'the plot area says which material is missing');
    assert.ok(!html.includes('materialMissing'), 'never the bare error code');
    nkCharacterizationResultSession.reset();
}

// ── Witness chip glass from a deleted catalog: the design substrate instead ──
const chipDesign = {
    ...makeSampleDesign(), id: 'chip-design',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'a', material: 'builtin:TiO2', thickness: 57 },
        { id: 'b', material: 'builtin:SiO2', thickness: 94 },
    ],
};

function probe(hook, design) {
    let value = null;
    function Probe() { value = hook(); return null; }
    render(React.createElement(Probe), design);
    return value;
}

{
    const glass = glassInDeletedCatalog('Chip glass');
    monitorWorksheetSession.write(chipDesign, { chipMaterial: glass.id });

    const live = probe(() => useChipPlan(chipDesign, 2, true), chipDesign);
    assert.equal(live.plan.chipMaterial, glass.id, 'a glass that resolves is used as picked');
    assert.equal(live.chipGlassMissing, null);

    catalogManager.removeCatalog(glass.catalogId);

    // Process Exporter: the plan falls back to the substrate, so the model the
    // window builds in a memo does not throw into the error boundary.
    const chips = probe(() => useChipPlan(chipDesign, 2, true), chipDesign);
    assert.equal(chips.plan.chipMaterial, null, 'a glass that is gone gives way to the substrate');
    assert.equal(chips.chipGlassMissing, glass.id, 'and the window is told which glass is gone');
    const deposition = buildDepositionModel(chipDesign, 'front', chips.plan);
    assert.equal(deposition.substrateId, 'builtin:BK7');

    const sp = t.processSim;
    const notices = buildNotices({
        sp, t, setup: { secondSurface: 'bare', lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2 },
        deposition, chipMode: true, rangeNotice: null, chipGlassMissing: chips.chipGlassMissing,
    });
    assert.ok(notices.some(notice => notice.label === t.materialResolution.chipGlassMissing(glass.id)),
        'the Process Exporter says the chip glass is gone');

    localStorage.setItem('tfstudio-process-sim-v1', JSON.stringify({
        mode: 'chips', lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50,
    }));
    assert.doesNotThrow(() => render(React.createElement(ProcessSimulator, { c, t }), chipDesign),
        'the Process Exporter renders with a chip glass whose catalog is gone');

    // Monitor Worksheet: same fallback, same notice, and a table rather than
    // the raw English text of the error.
    const sheet = probe(() => useMonitorWorksheet(), chipDesign);
    assert.equal(sheet.error, null, `the worksheet computes on the substrate: ${sheet.error?.message}`);
    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.chipGlassMissing, glass.id);
    const html = render(React.createElement(MonitorWorksheet, { c, t }), chipDesign);
    assert.ok(!html.includes('Unresolved design material'), 'no raw error text in the window');
    assert.ok(html.includes(`title="${t.analysisChrome.notices}"`), 'a notice badge reports the fallback');

    // The Report prints the worksheet the window shows.
    const printed = computeWorksheet(chipDesign, { chipMaterial: glass.id });
    assert.equal(printed.rows.length, 2, 'the report worksheet is computed on the substrate too');
    assert.equal(printed.settings.chipGlass, computeWorksheet(chipDesign, {}).settings.chipGlass,
        'and names the substrate as the chip glass it was computed on');

    for (const code of LANGUAGES) {
        const text = getLocale(code).materialResolution.chipGlassMissing(glass.id);
        assert.ok(text.includes(glass.id), `${code}: the chip notice names the glass`);
    }
    monitorWorksheetSession.reset();
}

// ── A design material that does not resolve is named in the user's language ─
{
    const lost = { ...chipDesign, id: 'lost-substrate', substrate: { material: 'missing:Foo', thickness: 1 } };
    for (const code of LANGUAGES) {
        const locale = getLocale(code);
        const html = render(React.createElement(MonitorWorksheet, { c, t: locale }), lost);
        assert.ok(html.includes(escaped(locale.materialResolution.rowMissing('missing:Foo'))),
            `${code}: the worksheet error is localized`);
        assert.ok(!html.includes('Unresolved design material'), `${code}: no raw English error`);
    }
    monitorWorksheetSession.reset();
}

// ── Material Dispersion says its material is gone instead of an empty plot ──
{
    const glass = glassInDeletedCatalog('Dispersion glass');
    materialDispersionSession.write(chipDesign, { materialId: glass.id });
    const shown = render(React.createElement(MaterialDispersionEvaluation, { c, t }), chipDesign);
    assert.ok(!shown.includes(escaped(t.materialResolution.pickedMissing(glass.id))));

    catalogManager.removeCatalog(glass.catalogId);
    for (const code of LANGUAGES) {
        const locale = getLocale(code);
        const html = render(React.createElement(MaterialDispersionEvaluation, { c, t: locale }), chipDesign);
        assert.ok(html.includes(escaped(locale.materialResolution.pickedMissing(glass.id))),
            `${code}: Material Dispersion names the material that is gone`);
    }
    materialDispersionSession.reset();
}

console.log('PASS: readers_missing_materials');
