/**
 * Opening a characterized material in the Material Editor.
 *
 * A material saved from n,k Characterization carries a dispersion fit like any
 * other, but it was fitted to a measured spectrum rather than to a table of n
 * and k, so it has no residual against a table. The editor's fit panel read
 * that residual unconditionally and took the whole application down when the
 * user clicked the material in its catalog.
 *
 * Run: node tests/material_editor_characterized_fit.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { filmSpectrum } from '../src/utils/materials/characterization/sampleSpectrum.js';
import { characterizeFilm } from '../src/utils/materials/characterization/nkFit.js';
import { fitTabulatedMaterial } from '../src/utils/materials/dispersionFits.js';

shimBrowserGlobals();
await loadApp();
await initWasmForTest();

const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { characterizedMaterial } = await import('../src/components/windows/dataExchange/nkCharacterization/model.js');

const c = makeTheme();
const t = makeLocale();
const me = t.materialEditor;

const render = draft => renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft, onChange() {}, onSave() {}, onRevert() {}, onDelete() {}, dirty: false, catalogs: [], c, t,
}));

// ── A real characterized material, made the way the window makes one ─────────
const lambdas = Array.from({ length: 101 }, (_, index) => 400 + 4 * index);
const sample = {
    incident: getMaterial('Air'), substrate: getMaterial('BK7'), exit: getMaterial('Air'),
    substrateThicknessMm: 1, geometry: 'slab',
    lambdas, aoi: 0, pol: 'avg', side: 'front',
};
const measured = filmSpectrum(sample, getMaterial('TiO2'), 250);
const result = characterizeFilm({
    sample,
    channels: ['T', 'R'].map(quantity => ({
        quantity, lambdas, values: measured[quantity], aoi: 0, pol: 'avg', side: 'front',
    })),
    indexModel: 'cauchy', thicknessNm: 250, fixThickness: true,
});
assert.ok(!result.error, `the fixture must characterize: ${result.error}`);

const material = characterizedMaterial(result, { id: 'tio2_run_14', name: 'TiO2 run 14' });
assert.ok(material.dispersionFit, 'a characterized material carries its fit');
assert.deepEqual(material.dispersionFit.residuals, {},
    'and that fit has no residual against a table, because it was not fitted to one');

// ── The editor opens it instead of crashing ──────────────────────────────────
{
    let html;
    assert.doesNotThrow(() => { html = render(materialToDraft('user_films', material)); },
        'clicking a characterized material in its catalog must not take the window down');
    assert.ok(html.includes('Cauchy'), 'the fit is still named');
    assert.ok(!/residual: RMS\s*(undefined|NaN)/.test(html),
        'and no residual is invented for a fit that has none');
    assert.ok(html.includes(measuredSourceText(material.dispersionFit.source)),
        'the panel says what the fit was made from instead');
}

function measuredSourceText(source) {
    return typeof me.fitFromMeasurement === 'function'
        ? me.fitFromMeasurement(source)
        : source;
}

// ── An ordinary table fit still reports its residuals ────────────────────────
{
    const rows = lambdas.map(nm => [nm, getMaterial('TiO2').getNK(nm)[0], 0]);
    const table = {
        id: 'lab', name: 'Lab', formulaNum: -1, tabData: rows,
        coefficients: [], kTable: [], lambdaMin: 0.4, lambdaMax: 0.8,
        dispersionFit: {
            ...fitTabulatedMaterial(rows, { rangeNm: [400, 800], nModel: 'cauchy' }),
            active: true,
        },
    };
    assert.ok(table.dispersionFit.residuals.n, 'a table fit does have one');
    const html = render(materialToDraft('user_lab', table));
    assert.match(html, /n residual: RMS/, 'and the panel still shows it');
}

console.log('PASS: material_editor_characterized_fit');
