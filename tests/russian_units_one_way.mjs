/**
 * The Russian UI writes nm and fs one way: нм and фс.
 *
 * Axis titles, settings and report headings already wrote нм and фс; the
 * readouts built in code wrote nm and fs. Unit symbols now come from one table,
 * t.units, which every one of them reads.
 *
 *   1. No Russian sentence writes nm or fs in Latin.
 *   2. The merit table's Current and Target cells, GD/GDD, Pulse analysis, the
 *      status-bar monitor form and Systematic Deviations' offset unit write нм
 *      and фс in Russian, and nm and fs in English.
 *   3. The report's λ column reads λ, нм.
 *
 * Run: node tests/russian_units_one_way.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const ru = getLocale('ru');
const en = getLocale('en');
const c = makeTheme();
const h = React.createElement;
const text = html => html.replace(/<[^>]*>/g, ' ');

// ── 1. Russian sentences ─────────────────────────────────────────────────────
{
    const source = readFileSync(new URL('../src/constants/locales/ru.js', import.meta.url), 'utf-8');
    // What a string shows, with its ${...} placeholders, which name values, left out.
    const literals = (source.match(/'[^'\n]*'|`[^`\n]*`/g) || []).map(literal => literal.replace(/\$\{[^}]*\}/g, ''));
    const latin = literals.filter(literal => /[А-Яа-яЁё]/.test(literal) && /(^|[^A-Za-z_])(nm|fs)(?![A-Za-z_])/.test(literal));
    assert.deepEqual(latin, [], 'a Russian string writes nm or fs in Latin');
    assert.deepEqual(ru.units, { nm: 'нм', fs: 'фс', fs2: 'фс²', fs3: 'фс³', fsPerNm: 'фс/нм', newtonPerM: 'Н/м' });
}

// ── 2. Readouts built in code ────────────────────────────────────────────────
{
    const { renderOperandRow } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
    const row = (t, op, value) => text(renderToStaticMarkup(h('table', null, h('tbody', null, renderOperandRow({
        selIds: new Set(), c, t, onEdit() {}, selectRow() {}, beginDrag() {}, dragOver() {},
        isMathPct: () => false, focusAt() {}, pressCell() {}, integralPresets: [], operands: [op],
        computed: [value],
    }, op, 0)))));
    const gdd = { id: 'g', type: 'GDD', enabled: true, lambdaStart: 800, aoi: 0, pol: 'avg', target: -40, weight: 1 };
    const total = { id: 't', type: 'TT', enabled: true, lambdaStart: 1, lambdaEnd: 1, target: 500, weight: 1 };
    assert.ok(row(ru, gdd).includes('-40.00 фс²'), `ru merit table GDD target: ${row(ru, gdd)}`);
    assert.ok(row(en, gdd).includes('-40.00 fs²'), 'en keeps fs²');
    const { rowDisplayMeta, fmtCurrent } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js');
    const meta = rowDisplayMeta(total, 498.5, false, null, ru.units);
    assert.equal(fmtCurrent(meta.cur, meta), '498.50 нм', 'ru merit table thickness');

    const { quantityMeta } = await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
    assert.equal(quantityMeta('gdd', ru.gdgdd, undefined, ru.units).unit, 'фс²', 'ru GD/GDD readout');
    assert.equal(quantityMeta('cdc', en.gdgdd, undefined, en.units).unit, 'fs/nm', 'en GD/GDD readout');
    assert.equal(quantityMeta('phase', ru.gdgdd, undefined, ru.units).unit, '°');

    const { resultsTable } = await import('../src/components/windows/analysis/pulseAnalysis/viewModel.js');
    const metrics = new Proxy({}, { get: () => 1 });
    const pulse = resultsTable({ metrics, chirped: false }, ru.pulseAnalysis, ru.units);
    assert.deepEqual([...new Set(pulse.rows.map(r => r.unit))], ['фс', '%', 'фс²', 'фс³', 'нм', ''], 'ru Pulse results');

    const { AddForm } = await import('../src/components/SpectralMonitor.js');
    const form = text(renderToStaticMarkup(withDesign(h(AddForm, {
        c, t: ru, onAdd() {}, onCancel() {}, initial: null, mode: 'add',
    }))));
    assert.ok(form.includes('нм') && !/\bnm\b/.test(form), `ru monitor form: ${form}`);

    const { SystematicEditor } = await import('../src/components/windows/analysis/systematicDeviations/SystematicControls.js');
    const { emptyDeviation } = await import('../src/utils/physics/systematicDeviations.js');
    const state = { mode: 'single', design: { frontLayers: [], backLayers: [] }, dev: emptyDeviation(), uniqueMats: [], updateGlobal() {}, updateMat() {} };
    const editor = renderToStaticMarkup(h(SystematicEditor, { c, sd: ru.systematicDeviations, state, units: ru.units }));
    assert.ok(editor.includes('<option value="nm" selected="">нм</option>'), 'ru offset unit');
    for (const [file, passes] of [
        ['analysis/gdGddEvaluation/GDGDDEvaluation.js', 'units: t.units'],
        ['analysis/pulseAnalysis/PulseAnalysis.js', 'resultsTable(shown, text, t.units)'],
        ['analysis/systematicDeviations/SystematicDeviations.js', 'units: t.units'],
        ['analysis/materialDispersion/MaterialDispersionEvaluation.js', 't.units[quantityMeta.unitKey]'],
    ]) {
        const source = readFileSync(new URL(`../src/components/windows/${file}`, import.meta.url), 'utf-8');
        assert.ok(source.includes(passes), `${file} does not pass the unit table`);
    }
}

// ── 3. The report's λ column ─────────────────────────────────────────────────
{
    const { buildGdGdd } = await import('../src/utils/report/sections/dispersion.js');
    const lambda = [500, 510, 520];
    const ctx = {
        tr: ru.report, block: { id: 'b' }, designs: [],
        settings: { tableStep: 10, plot: 'none', quantities: { gdd: true } },
        data: { blocks: { b: { lambda, gdd: [1, 2, 3], target: 'R', side: 'front', theta: 0, pol: 'avg', invalid: 0 } } },
    };
    const html = buildGdGdd(ctx);
    assert.ok(html.includes('λ, нм') && !html.includes('λ, nm'), 'ru report λ column');
    assert.equal(en.report.lambdaColumn, 'λ, nm');
}

console.log('russian_units_one_way passed.');
