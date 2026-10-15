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
 *   4. A Russian report writes нм, мм and мкм in its subtitles, facts, layer
 *      headings, color rows, merit cells and spectrum table, and the Report
 *      window's block summaries write нм.
 *   5. The analysis readouts a window's first render does not show write units
 *      in Russian: the masked-sample notice, the dominant wavelength, the stress
 *      table and tooltip, the index profile's region labels, the sweep and
 *      integral marks, and the spectral unit choices. Everything a window shows
 *      on first render or with its panels open is russian_units_in_windows.mjs.
 *   6. Data exchange: the curve editor's unit names and column titles, the n,k
 *      result rows and the measured-curve fit dialog write units in Russian.
 *
 * Run: node tests/russian_units_one_way.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

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
    assert.deepEqual(ru.units, {
        nm: 'нм', um: 'мкм', mm: 'мм', m: 'м', fs: 'фс', fs2: 'фс²', fs3: 'фс³', fsPerNm: 'фс/нм', newtonPerM: 'Н/м',
        cm1: 'см⁻¹', THz: 'ТГц', eV: 'эВ', MPa: 'МПа', GPa: 'ГПа', ppmPerK: 'ppm/K', celsius: '°C', jPerM2: 'Дж/м²',
    });
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

// A unit symbol written in Latin letters, standing alone.
const LATIN_UNIT = /(^|[^A-Za-z])(nm|mm|µm|um|fs|cm⁻¹|THz|eV|MPa|GPa|N\/m)(?![A-Za-z])/;

// ── 4. The report's subtitles, facts and readouts ────────────────────────────
{
    const { reportLocale } = await import('../src/components/windows/information/report/useReportWindow.js');
    const { newBlock } = await import('../src/utils/report/blocks.js');
    const { gatherDesignData } = await import('../src/utils/report/reportData.js');
    const { composeReport } = await import('../src/utils/report/template.js');
    const design = {
        ...makeSampleDesign(),
        meritOperands: [{ id: 'm', type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0.99, weight: 1 }],
    };
    const blocks = ['facts', 'layers', 'materials', 'color', 'efield', 'riProfile', 'merit'].map(type => newBlock(type))
        .concat(newBlock('spectrum', { spectralUnit: 'um', tableStep: 100 }));
    const report = (lang, designs) => text(composeReport({
        lang, tr: reportLocale(lang), blocks, designs: designs.map(d => ({ design: d, data: gatherDesignData(d, blocks) })),
    }).replace(/<style>[\s\S]*?<\/style>/, ''));
    for (const shown of [report('ru', [design]), report('ru', [design, { ...design, id: 'second', name: 'Second' }])]) {
        assert.ok(!LATIN_UNIT.test(shown), `ru report writes a Latin unit: ${shown.match(LATIN_UNIT)?.[0]}`);
        assert.ok(['нм', 'мм', 'мкм'].every(unit => shown.includes(unit)), 'ru report writes нм, мм and мкм');
    }
    assert.ok(report('en', [design]).includes('550 nm'), 'en report keeps nm');

    const { blockSummary } = await import('../src/components/windows/information/report/blockText.js');
    for (const block of blocks) {
        const summary = blockSummary(ru.report.window, block, ru.units);
        assert.ok(!LATIN_UNIT.test(summary), `ru block summary: ${summary}`);
    }
}

// ── 5. Analysis readouts ─────────────────────────────────────────────────────
{
    const shown = [];
    const A = '../src/components/windows/analysis/';
    const { invalidSummary } = await import(`${A}materialDispersion/MaterialDispersionEvaluation.js`);
    shown.push(invalidSummary({ invalid: [{ reason: 'r', maximumThicknessMm: 0.002 }] }, 'um', ru.gdgdd, ru.units));
    const { readoutTableRows } = await import(`${A}colorEvaluation/colorModel.js`);
    const report = new Proxy({ dom: { dom: 575, purity: 0.5 }, cct: {} }, { get: (o, k) => o[k] ?? new Proxy({}, { get: () => 0 }) });
    shown.push(...readoutTableRows(report, ru.colorEval, ru.units).map(row => row.value));
    const { wholeRows } = await import(`${A}stressAnalysis/tableModel.js`);
    shown.push(...wholeRows({}, ru.stressAnalysis, ru.units).map(row => row.unit));
    const { buildStressOption } = await import(`${A}stressAnalysis/StressChart.js`);
    const stress = buildStressOption({
        rows: [{ layerNumber: 1, side: 'front', stressMPa: 100, materialId: 'm' }], matColorMap: {}, bothSides: false,
        sa: ru.stressAnalysis, units: ru.units, c,
    });
    shown.push(stress.tooltip.formatter({ dataIndex: 0, value: 100, marker: '', seriesName: 'm' }));
    const { buildRITotalOption } = await import(`${A}refractiveIndexProfiler/RITotalChart.js`);
    const region = (key, totalThk) => ({ key, label: key, totalThk, z: [0, totalThk], n: [1.5, 1.5], k: [0, 0], layerBounds: [0, totalThk] });
    const profile = buildRITotalOption([region('front', 200), region('substrate', 1)], 'n', { matColorMap: {}, colors: {}, units: ru.units });
    shown.push(...profile.series[0].markPoint.data.map(point => point.label.formatter));
    const { buildSweepOption } = await import(`${A}systematicDeviations/sweepFigure.js`);
    const sweep = buildSweepOption({ lambda: [500], paramValues: [1], T2D: [[0.5]] }, 'T', c, { units: ru.units });
    shown.push(sweep.tooltip.formatter({ seriesName: 'T', value: [0, 0, 50] }));
    const { buildOverlayOption } = await import(`${A}integralValues/overlayFigure.js`);
    const marks = buildOverlayOption({
        spectrum: { lambda: [500, 600], T: [0.9, 0.8] }, char: 'T', colors: {}, labels: ru.integralValues, units: ru.units,
        minMaxMarks: { min: 0.8, lamAtMin: 600, max: 0.9, lamAtMax: 500 },
    });
    shown.push(...marks.series.slice(1).map(series => series.name));
    const { SPECTRAL_UNIT_IDS } = await import('../src/utils/physics/spectralAxis.js');
    shown.push(...SPECTRAL_UNIT_IDS.map(id => ru.units[id]));
    const latin = shown.filter(s => LATIN_UNIT.test(s));
    assert.deepEqual(latin, [], 'a Russian analysis readout writes a Latin unit');
    for (const unit of ['мкм', 'нм', 'Н/м', 'МПа', 'мм', 'см⁻¹', 'ТГц', 'эВ']) {
        assert.ok(shown.some(s => s.includes(unit)), `ru analysis readouts write ${unit}`);
    }
}

// ── 6. Data exchange ─────────────────────────────────────────────────────────
{
    const D = '../src/components/windows/dataExchange/';
    const { X_UNITS } = await import('../src/utils/io/spectrumTable.js');
    const { editorLabels } = await import(`${D}curveEditor/editorLabels.js`);
    const { X_KEY } = await import(`${D}curveEditor/curveTable.js`);
    const shown = [];
    for (const xUnit of [X_UNITS.NM, X_UNITS.UM, X_UNITS.CM1, X_UNITS.EV]) {
        const labels = editorLabels(ru, { xUnit, columns: [] });
        shown.push(labels.xUnit(xUnit), labels.columnTitle(X_KEY));
    }
    const { thicknessText } = await import(`${D}nkCharacterization/resultsModel.js`);
    shown.push(thicknessText({ thicknessNm: 500, thicknessStatus: 'fitted', thicknessSpreadNm: 2 }, ru.nkCharacterization, ru.units));
    const { MeasuredFitDialog } = await import(`${D}spectrumExchange/MeasuredFitDialog.js`);
    const dialog = renderToStaticMarkup(h(MeasuredFitDialog, {
        c, sx: ru.spectrumExchange, units: ru.units,
        controller: {
            fitDialogCurve: { name: 'm', x: [400, 800], y: [0.5, 0.5], quantity: 'T' },
            fitConfig: { mode: 'uniform', rangeMin: 400, rangeMax: 800, stepNm: 5, constraintsEnabled: true },
            fitSnapshot: {}, setFitOption() {}, onCreateFitOperand() {}, closeFitDialog() {}, missingMaterialIds: [],
        },
    }));
    shown.push(...text(dialog).split(/\s{2,}/));
    const latin = shown.filter(s => LATIN_UNIT.test(s));
    assert.deepEqual(latin, [], 'a Russian data-exchange label writes a Latin unit');
    assert.ok(['нм', 'мкм', 'см⁻¹', 'эВ'].every(unit => shown.some(s => s.includes(unit))), 'ru data exchange writes its units');
}

console.log('russian_units_one_way passed.');
