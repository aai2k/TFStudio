/**
 * The n,k Characterization window: what it shows before a run, what it shows
 * after one, and that the result becomes a material the rest of the application
 * can use.
 *
 * Assertions are on content rather than on a hash of the markup. A hash is the
 * right test for a refactor that must change nothing; this window is new, so
 * there is no earlier behaviour to hold it to, and a hash would only make the
 * next edit look like a regression.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await loadApp();
await initWasmForTest();

const [
    { NkCharacterization },
    { CurvePicker, SampleSettingsContent },
    model,
    resultsModel,
    charts,
    { filmSpectrum },
    { characterizeFilm },
    { getMaterial },
    saveMaterial,
    sessionState,
    catalogManager,
    { buildCharacterizedDesign },
    materialPreview,
    { newSaveDialogState, SaveMaterialDialog },
    { resolveEvalMode },
    { WINDOW_REGISTRY },
] = await Promise.all([
    import('../src/components/windows/design/nkCharacterization/NkCharacterization.js'),
    import('../src/components/windows/design/nkCharacterization/CharacterizationControls.js'),
    import('../src/components/windows/design/nkCharacterization/model.js'),
    import('../src/components/windows/design/nkCharacterization/resultsModel.js'),
    import('../src/components/windows/design/nkCharacterization/charts.js'),
    import('../src/utils/materials/characterization/sampleSpectrum.js'),
    import('../src/utils/materials/characterization/nkFit.js'),
    import('../src/utils/materials/materialDatabase.js'),
    import('../src/components/windows/design/nkCharacterization/saveMaterial.js'),
    import('../src/components/windows/design/nkCharacterization/sessionState.js'),
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/windows/design/nkCharacterization/resultDesign.js'),
    import('../src/components/windows/design/nkCharacterization/materialPreview.js'),
    import('../src/components/windows/design/nkCharacterization/SaveMaterialDialog.js'),
    import('../src/utils/physics/optimizer.js'),
    import('../src/components/docking/windowRegistry.js'),
]);

const c = makeTheme();
const t = makeLocale();
const nk = t.nkCharacterization;

// ── A design with nothing imported says where to import it ────────────────────
{
    const html = renderToStaticMarkup(withDesign(
        React.createElement(NkCharacterization, { c, t, theme: c }),
        makeSampleDesign(),
    ));
    assert.ok(html.includes('Measured Spectra'),
        'an empty window must point at the window that imports a measurement');
}

// ── A design with curves shows the controls and the not-run-yet state ─────────

const air = getMaterial('Air');
const bk7 = getMaterial('BK7');
const cauchy = [2.14, 0.0235, 0.00042];
const film = {
    getNK: (lambda) => {
        const um = lambda / 1000;
        return [cauchy[0] + cauchy[1] / um ** 2 + cauchy[2] / um ** 4, 0];
    },
};
const lambdas = [];
for (let value = 400; value <= 1000; value += 2) lambdas.push(value);
const sample = {
    incident: air, substrate: bk7, exit: air,
    substrateThicknessMm: 1.0, geometry: 'slab',
};
const spectrum = filmSpectrum(
    { ...sample, lambdas, aoi: 0, pol: 'avg', side: 'front' }, film, 420);

function curve(quantity, id) {
    return {
        id, name: `witness ${quantity}`, quantity,
        x: lambdas, y: spectrum[quantity],
        color: '#888', visible: true, aoi: 0, pol: 'avg', side: 'front',
    };
}

const design = {
    ...makeSampleDesign(),
    substrate: { material: 'BK7', thickness: 1.0 },
    measuredCurves: [curve('T', 'meas-t'), curve('R', 'meas-r'), {
        id: 'meas-a', name: 'absorptance', quantity: 'A',
        x: lambdas, y: spectrum.A, color: '#888', visible: true,
    }],
};

{
    const html = renderToStaticMarkup(withDesign(
        React.createElement(NkCharacterization, { c, t, theme: c }), design));
    assert.ok(html.includes(nk.run), 'the run button must be on the control row');
    assert.ok(html.includes(nk.notRunYet), 'the plot area must say what to do first');
    assert.ok(html.includes('grid-template-columns:auto minmax(0, 1fr) auto minmax(0, 1fr)'),
        'the T/R pair must stay together on one row');
}

// ── Long exported names stay inside the T/R curve pickers ────────────────────
{
    const curves = model.characterizableCurves(design);
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
        React.createElement(CurvePicker, {
            c, nk, curves, quantity: 'T', value: 'meas-t', onChange: () => {},
        }),
        React.createElement(CurvePicker, {
            c, nk, curves, quantity: 'R', value: 'meas-r', onChange: () => {},
        }),
    ));
    assert.ok(html.includes('witness T') && html.includes('witness R'),
        'both selected curves must be visible in the closed pickers');
    assert.ok(html.includes('text-overflow:ellipsis') && html.includes('white-space:nowrap'),
        'long curve names must stay on one line inside their selectors');
}

// ── Opening the settings panel renders every setting ─────────────────────────
//
// Popover contents are lazy: the ordinary window snapshot only renders the
// trigger. Rendering the body directly catches missing locale/context props
// that would otherwise crash only when Settings is clicked.
{
    const settings = {
        transmittanceId: 'meas-t', reflectanceId: 'meas-r',
        indexModel: 'cauchy', geometry: 'slab', substrateId: '',
        substrateThicknessMm: '', thicknessNm: '', fixThickness: false,
        lambdaStart: '400', lambdaEnd: '1000',
    };
    const html = renderToStaticMarkup(withDesign(
        React.createElement(SampleSettingsContent, {
            c, t, nk, state: { settings, design, setField: () => {} },
        }),
        design,
    ));
    assert.ok(html.includes(nk.indexModel) && html.includes(nk.substrate),
        'opening Settings must render the model and substrate controls');
    assert.ok(html.includes('BK7'), 'the substrate material picker must render with its locale');
}

// ── Only transmittance and reflectance can be characterized ───────────────────
{
    const usable = model.characterizableCurves(design);
    assert.deepEqual(usable.map(item => item.quantity), ['T', 'R'],
        'an absorptance curve is not something this window can invert');
    const selection = model.defaultCurveSelection(design);
    assert.equal(selection.transmittanceId, 'meas-t');
    assert.equal(selection.reflectanceId, 'meas-r');
}

// ── A run through the window's own settings ───────────────────────────────────

const result = model.runCharacterization(design, {
    transmittanceId: 'meas-t', reflectanceId: 'meas-r',
    indexModel: 'cauchy', geometry: 'slab',
    substrateId: '', substrateThicknessMm: '',
    thicknessNm: '', fixThickness: false,
    lambdaStart: '400', lambdaEnd: '1000',
});
assert.ok(!result.error, `window settings must produce a run: ${result.error}`);
assert.ok(Math.abs(result.thicknessNm - 420) < 0.5,
    `thickness ${result.thicknessNm} through the window path`);

// ── The explicit result survives a dock/tab remount ──────────────────────────
{
    const store = sessionState.nkCharacterizationResultSession;
    store.reset();
    store.write(design, { result, ranWith: 'this-run' });
    assert.equal(store.read(design).result, result,
        'the last extraction must live outside the mounted component');
    const otherDesign = { ...design, id: `${design.id}-other` };
    assert.equal(store.read(otherDesign).result, null,
        'a result must not leak into a different design');
    assert.equal(store.read(design).ranWith, 'this-run',
        'returning to the design restores the result signature and stale state');
    store.reset();
}

// ── The results table ─────────────────────────────────────────────────────────
{
    const rows = resultsModel.resultRows(result, nk);
    const labels = rows.map(row => row.quantity);
    assert.ok(labels.includes(nk.rowThickness));
    assert.ok(labels.includes(nk.rowResidual('T')) && labels.includes(nk.rowResidual('R')));
    assert.ok(labels.includes(nk.rowResolvableExtinction),
        'the smallest resolvable k belongs in the table, so a reported k can be judged');
    assert.ok(labels.some(label => label.startsWith(nk.modelParameter)),
        'the fitted coefficients are what the material is computed from');
    assert.ok(rows.every(row => typeof row.value === 'string' && row.value.length > 0));
    assert.equal(resultsModel.characterizationNotices(result, nk, false).length, 0,
        'a clean run raises nothing');
    assert.deepEqual(
        resultsModel.characterizationNotices(result, nk, true).map(notice => notice.label),
        [nk.stale], 'an edited setting marks the shown result stale');
}

// ── The CSV carries both the model and the points it was fitted to ────────────
{
    const csv = resultsModel.constantsCsv(result).split('\n');
    assert.equal(csv[0], 'lambda_nm,n,k,n_pointwise,k_pointwise,solved');
    assert.equal(csv.length, result.pointwise.lambdas.length + 2);
    assert.equal(csv[1].split(',').length, 6);
}

// ── Both plots build ──────────────────────────────────────────────────────────
{
    const palette = { background: '#000', paper: '#111', grid: '#333', text: '#ccc' };
    const labels = {
        measured: 'measured', calculated: 'calculated',
        pointwiseIndex: 'n', pointwiseExtinction: 'k', residualAxis: 'residual',
    };
    const constants = charts.buildConstantsOption(result, palette, labels, true);
    assert.ok(constants.series.length >= 2, 'the model and its points are both drawn');
    assert.ok(constants.series.some(series => series.type === 'scatter'),
        'the wavelength-by-wavelength extraction is drawn as points');
    // A transparent film has no second axis to spend room on.
    assert.equal(constants.yAxis[1].show, false);

    const fit = charts.buildFitOption(result, palette, labels, false);
    assert.deepEqual(fit.series.map(series => series.name),
        ['T measured', 'T calculated', 'R measured', 'R calculated']);
    const residual = charts.buildFitOption(result, palette, labels, true);
    assert.deepEqual(residual.series.map(series => series.name), ['T', 'R']);
}

// ── The result becomes a material ─────────────────────────────────────────────
{
    const material = model.characterizedMaterial(result, { id: 'ta2o5_run14', name: 'Ta2O5 run 14' });
    assert.equal(material.formulaNum, -1, 'stored the way a fitted tabular material is');
    assert.ok(material.dispersionFit.active, 'the model travels with it');
    assert.equal(material.dispersionFit.source, 'measured R/T');
    assert.ok(material.tabData.length > 100, 'and a sampled table behind the model');
    assert.ok(material.tabData.every(row => row.length === 3 && row[2] >= 0),
        'k must never be stored negative');
    assert.ok(material.comment.includes('420'), 'the thickness is recorded where it can be read');

    // The material has to compute the index it was characterized with.
    const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
    const getNK = makeGetNK(material);
    for (const lambda of [450, 600, 850]) {
        const um = lambda / 1000;
        const expected = cauchy[0] + cauchy[1] / um ** 2 + cauchy[2] / um ** 4;
        assert.ok(Math.abs(getNK(lambda)[0] - expected) < 0.005,
            `saved material n at ${lambda} nm is ${getNK(lambda)[0]}, expected ${expected}`);
    }
}

// ── Saving uses the catalog selected in the dialog ──────────────────────────
{
    catalogManager.initCatalogs({});
    const first = catalogManager.createUserCatalog('Process A');
    const second = catalogManager.createUserCatalog('Process B');
    assert.throws(
        () => saveMaterial.saveCharacterizedMaterial(result, { name: 'Witness run' }),
        /destination catalog/i,
        'with user catalogs present, saving without a selection must never pick one at random',
    );
    const stored = saveMaterial.saveCharacterizedMaterial(result, {
        catalogId: second.id, name: 'Witness run',
    });
    assert.equal(stored.catalogId, second.id);
    assert.equal(stored.catalogName, second.name);
    assert.equal(Object.keys(catalogManager.getCatalog(first.id).materials).length, 0);
    assert.ok(catalogManager.getCatalog(second.id).materials[stored.materialId],
        'the material must be present only in the chosen catalog');
}

// ── Substrate and geometry come from the window, not from a default ───────────
{
    const built = model.sampleFor(design, {
        geometry: 'coating', substrateId: 'SiO2', substrateThicknessMm: '3',
    });
    assert.equal(built.geometry, 'coating');
    assert.equal(built.substrateThicknessMm, 3);
    assert.ok(Math.abs(built.substrate.getNK(550)[0] - 1.46) < 0.02,
        'the substrate override has to reach the model');
    const fromDesign = model.sampleFor(design, {});
    assert.equal(fromDesign.substrateThicknessMm, 1.0);
    assert.equal(fromDesign.geometry, 'coating',
        'a FRONT Optical Evaluation export is a semi-infinite coating spectrum');
    const total = model.sampleFor({ ...design, mfEvalMode: 'total' }, {});
    assert.equal(total.geometry, 'slab',
        'a TOTAL export includes the substrate and its back surface');
}

// ── The thickness setting never starts at zero ───────────────────────────────
{
    const bare = { ...design, frontLayers: [] };
    assert.equal(model.defaultThicknessNm(bare), model.FALLBACK_THICKNESS_NM);
    assert.equal(model.defaultThicknessNm(design), model.FALLBACK_THICKNESS_NM,
        'a multi-layer design says nothing about which film is on the witness');
    const witness = { ...design, frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 312.4 }] };
    assert.equal(model.defaultThicknessNm(witness), 312,
        'a design carrying one film is taken to be that film');

    assert.ok(model.thicknessSettingNm(bare, { thicknessNm: '' }) > 0,
        'an untouched setting must not read as a zero-thickness film');
    assert.equal(model.thicknessSettingNm(witness, { thicknessNm: '450' }), 450);
    assert.equal(model.thicknessSettingNm(witness, { thicknessNm: '0' }), 0,
        'a cleared field still reaches the errors that say the thickness is undetermined');
}

// ── The result opens as a design ─────────────────────────────────────────────
{
    const materialId = 'user_films:ta2o5_run14';
    const build = (settings, curves) => buildCharacterizedDesign({
        design, settings, chosen: curves || model.characterizableCurves(design),
        result, materialId, materialName: 'Ta2O5 run 14',
    });

    const slab = build({ geometry: 'slab' });
    assert.equal(slab.frontLayers.length, 1);
    assert.equal(slab.backLayers.length, 0);
    assert.equal(slab.frontLayers[0].material, materialId);
    assert.equal(slab.frontLayers[0].thickness, result.thicknessNm,
        'the layer carries the thickness that was solved for, not a rounded one');
    assert.ok(slab.frontLayers[0].id, 'a layer written straight to a file needs its own id');
    assert.equal(slab.substrate.material, 'BK7');
    assert.equal(slab.substrate.thickness, 1.0);
    assert.equal(resolveEvalMode(slab), 'total',
        'a slab measurement saw both faces, which is what TOTAL evaluates');
    assert.equal(slab.measuredCurves.length, 2,
        'the design carries the curves it has to reproduce');
    assert.ok(slab.name.includes('Ta2O5 run 14'));

    const coating = build({ geometry: 'coating' });
    assert.equal(resolveEvalMode(coating), 'front',
        '"film only" ignores the other side');

    const backCurves = model.characterizableCurves(design)
        .map(curve => ({ ...curve, side: 'back' }));
    const back = build({ geometry: 'slab' }, backCurves);
    assert.equal(back.frontLayers.length, 0);
    assert.equal(back.backLayers.length, 1);
    assert.equal(back.surfaceMode, 'back_only',
        'a curve measured through the uncoated face puts the film on the far side');

    assert.equal(WINDOW_REGISTRY['nk-characterization'].createDesign, true,
        'the window only receives onCreateDesign while the registry declares it');
}

// ── The save dialog shows the material it is about to write ──────────────────
{
    const material = materialPreview.previewMaterial(result);
    const rows = materialPreview.previewRows(material);
    assert.equal(rows.length, material.tabData.length,
        'the preview table is the stored table, not a second sampling of the fit');
    assert.deepEqual(
        [rows[0].lambda, rows[0].n, rows[0].k], material.tabData[0]);

    const palette = { background: '#000', paper: '#111', grid: '#333', text: '#ccc' };
    const option = materialPreview.buildPreviewOption(material, palette);
    assert.equal(option.series[0].name, 'n');
    assert.equal(option.yAxis[1].show, false, 'a transparent film has no k axis to spend room on');

    const catalogs = [{ id: 'user_a', name: 'Process A' }];
    const html = renderToStaticMarkup(React.createElement(SaveMaterialDialog, {
        c, nk, result, catalogs,
        dialog: newSaveDialogState('Witness run', catalogs),
        onChange: () => {}, onSave: () => {}, onCancel: () => {}, canOpenDesign: true,
    }));
    assert.ok(html.includes(nk.previewTitle), 'the dialog must show the preview');
    assert.ok(html.includes(nk.previewLambda) && html.includes('>n<') && html.includes('>k<'),
        'the numerical preview needs its λ, n and k columns');
    assert.ok(html.includes(rows[0].n.toFixed(5)), 'and the values that will be stored');
    assert.ok(html.includes(nk.save) && html.includes(nk.saveAndOpen),
        'saving and saving into a design are both offered');
}

// ── An unusable selection reports why ─────────────────────────────────────────
{
    const none = model.runCharacterization(design, {
        transmittanceId: '', reflectanceId: '', indexModel: 'cauchy',
    });
    assert.equal(none.error, 'noCurves');
    assert.ok(nk.errors[none.error], 'every error code needs a message');
    for (const code of ['noOverlap', 'tooFewPoints', 'thicknessUndetermined',
        'noThickness', 'notInvertible', 'noModel', 'failed']) {
        assert.ok(nk.errors[code], `missing message for error ${code}`);
    }
    for (const code of ['risingExtinction', 'anomalousDispersion', 'indexOutOfRange',
        'energyExcess', 'modelMismatch', 'extinctionFromReflectanceOnly']) {
        assert.ok(nk.warnings[code], `missing message for warning ${code}`);
    }
}

console.log('PASS: nk_characterization_window');
