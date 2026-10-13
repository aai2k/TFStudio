/**
 * Stack Formula and Filter Design report a material with no index at λ₀
 * instead of building its quarter wave 0 nm thick.
 *
 * Past a pole of its formula a material has no index, and a quarter wave of it
 * has no thickness. The built-in SiO2 and BK7 formulas have none at 9 µm.
 *
 *   1. Stack Formula: a formula with SiO2 at λ₀ = 9000 nm does not compile; the
 *      error names SiO2 and λ₀ and points at the layer.
 *   2. A design's layers are not written back as 0 quarter waves of SiO2, and
 *      the QWOT column shows no value for it.
 *   3. Filter Design: step 2 names the material and does not go on.
 *
 * Run: node tests/quarter_wave_without_index.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { initCatalogs, materialLabel, getMaterialById } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { buildStackFromFormula, formulaOf } = await import('../src/utils/synthesis/stackFormula.js');
const { formulaErrorText } = await import('../src/components/windows/design/stackFormula/FormulaPanel.js');
const { LayerTable } = await import('../src/components/windows/design/stackFormula/LayerTable.js');
const { materialWithoutIndex, DEFAULTS } = await import('../src/components/windows/optimization/filterDesignWizard/model.js');
const { StepParams } = await import('../src/components/windows/optimization/filterDesignWizard/StepParams.js');

const EN = getLocale('en');
const c = makeTheme();
const SIO2 = 'builtin:SiO2';
const IR = 9000;
assert.ok(Number.isNaN(getMaterialById(SIO2).getNK(IR)[0]), 'the SiO2 formula has no index at 9 µm');

// ── 1. A formula that uses the material ──────────────────────────────────────
{
    const compiled = buildStackFromFormula({ text: 'H L H L', refLambda: IR });
    assert.equal(compiled.ok, false, 'no stack is built');
    assert.equal(compiled.errorKey, 'noIndex');
    assert.deepEqual(compiled.errorArgs, [materialLabel(SIO2), IR], 'the error names the material and λ₀');
    assert.equal(compiled.errorPos, 2, 'and points at the first L');
    const text = formulaErrorText(compiled, EN.stackFormula.errors);
    assert.ok(text.includes(materialLabel(SIO2)) && text.includes(String(IR)), text);
    const visible = buildStackFromFormula({ text: 'H L H L', refLambda: 550 });
    assert.ok(visible.ok && visible.layers.every(layer => layer.thickness > 0), 'at 550 nm the same formula builds');
    const tio2Only = buildStackFromFormula({ text: 'H 2H', refLambda: IR });
    assert.ok(tio2Only.ok && tio2Only.layers.every(layer => layer.thickness > 0), 'TiO2 alone still builds at 9 µm');
}

// ── 2. Layers written back, and the QWOT column ──────────────────────────────
{
    const layers = [{ material: 'builtin:TiO2', thickness: 900 }, { material: SIO2, thickness: 1500 }];
    assert.throws(() => formulaOf({ layers, refLambda: IR }), error => error.code === 'MATERIAL_HAS_NO_INDEX'
        && error.materialId === SIO2 && error.lambdaNm === IR, 'SiO2 is not counted as 0 quarter waves');
    const resolveMaterial = id => getMaterialById(id);
    const html = renderToStaticMarkup(React.createElement(LayerTable, {
        compiled: { ok: true, layers }, refLambda: IR, resolveMaterial, c, sf: EN.stackFormula,
    }));
    const cells = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(match => match[1]);
    assert.equal(cells[2 + 4], '—', 'the SiO2 row shows no QWOT');
    assert.notEqual(cells[2], '—', 'the TiO2 row shows its QWOT');
    assert.ok(!cells.includes('0.000'), `no QWOT reads 0: ${cells.join(' | ')}`);
}

// ── 3. Filter Design, step 2 ─────────────────────────────────────────────────
{
    const p = { ...DEFAULTS, lambda0_nm: IR };
    assert.equal(materialWithoutIndex({ ...DEFAULTS }), null, 'the defaults have an index at their λ₀');
    assert.equal(materialWithoutIndex(p), SIO2, 'L is the first material with no index at 9 µm');
    const html = renderToStaticMarkup(React.createElement(StepParams, { p, set() {}, c, t: EN }));
    const shown = EN.filterDesign.step2.noIndex(materialLabel(SIO2), IR).replace(/'/g, '&#x27;');
    assert.ok(html.includes(shown), 'step 2 names it');

    const runtime = makeHookRuntime();
    const { useFilterDesign } = await importWithHookRuntime(
        '../src/components/windows/optimization/filterDesignWizard/useFilterDesign.js', runtime);
    const render = () => runtime.render(() => useFilterDesign({ onClose() {}, onGenerate() {}, folderName: 'Designs', t: EN }));
    render().next();
    assert.equal(render().step, 2);
    assert.equal(render().nextDisabled, false, 'step 2 goes on at the default λ₀');
    render().set('lambda0_nm', IR);
    assert.equal(render().nextDisabled, true, 'and stops at a λ₀ where L has no index');
}

console.log('Quarter wave without an index tests passed.');
