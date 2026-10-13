/**
 * English left in the Russian, Chinese and Italian UI after
 * more_window_labels.mjs:
 *
 *   1. The averaged polarization reads 'avg' in Error Analysis, the Optical
 *      Evaluation target toolbar, the Spectral Monitor, the Filter Design and
 *      DMF wizards, Settings, and the Report window and document.
 *   2. Measured curves and merit targets on the Optical Evaluation and
 *      Ellipsometry plots: 'meas', 'fit target', 'Measured curve', 'R target'.
 *   3. A custom integral's name and tooltip ('srcTbl', 'detTbl', 'flat',
 *      'Blackbody', 'on'), in Integral Values and the Merit Function Editor.
 *   4. A duplicated design's name, the Filter Design summary line and the
 *      GD/GDD sampling note.
 *
 * Every block runs, and the failures are listed together.
 *
 * Run: node tests/remaining_window_labels.mjs
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const h = React.createElement;
const c = makeTheme();
const translated = [['ru', getLocale('ru')], ['zh', getLocale('zh')], ['it', getLocale('it')]];
const words = element => renderToStaticMarkup(element).replace(/<[^>]*>/g, '\n')
    .split('\n').map(part => part.trim()).filter(Boolean);
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf-8');

const failures = [];
let passed = 0;
async function check(name, fn) {
    try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
function expect(condition, message) {
    if (!condition) throw new Error(message);
}

// ── 1. The averaged polarization ─────────────────────────────────────────────
await check('avg written into the windows', () => {
    const files = [
        'components/windows/analysis/errorAnalysis/ErrorControls.js',
        'components/windows/analysis/opticalEvaluation/TargetToolbar.js',
        'components/windows/information/report/BlockSettings.js',
        'components/windows/optimization/filterDesignWizard/StepMaterials.js',
        'components/windows/optimization/meritFunctionEditor/DMFWizard.js',
        'components/windows/design/specification/QRow.js',
        'components/SpectralMonitor.js',
    ];
    for (const file of files) {
        const text = source(file);
        expect(!/label: 'avg'|\['avg', 'avg'\]|\}, p\)\)|\{ value: p, label: p \}|\}, p\)\s*$/m.test(text), `${file} writes avg itself`);
    }
    // The report document: every section that prints a polarization goes
    // through polText.
    for (const file of ['comparison', 'dispersion', 'monteCarlo', 'otherSections', 'worksheet']) {
        const lines = source(`utils/report/sections/${file}.js`).split('\n');
        const raw = lines.filter(line => /\.pol(arization)?\b/.test(line) && /tt\(tr, 'aoi'/.test(line) && !line.includes('polText'));
        expect(raw.length === 0, `${file}.js prints a polarization as stored: ${raw.join(' | ').trim()}`);
    }
});
// Every label an option stored as 'avg' is rendered with.
const avgOptions = html => [...html.matchAll(/<option value="avg"[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
await check('avg in the DMF wizard', async () => {
    const { DMFWizard } = await import('../src/components/windows/optimization/meritFunctionEditor/DMFWizard.js');
    const { meritWizardSession } = await import('../src/components/windows/optimization/meritFunctionEditor/sessionState.js');
    const design = { id: 'labels', name: 'Labels', frontLayers: [], backLayers: [] };
    // Broadband AR has the angle box's polarization; Gain flattening, the
    // polarization of a target made from a gain.
    const types = [['AR', 'BBAR'], ['CURVE', 'GAIN_FLATTENING']];
    for (const [code, t] of translated) {
        for (const [catId, typeId] of types) {
            meritWizardSession.write(null, { open: true, catId, typeId, params: {} });
            const labels = avgOptions(renderToStaticMarkup(h(DMFWizard, {
                design, onGenerate() {}, operandCount: 0, mf: 0.5, omf: 0.5, busy: false, c, t,
            })));
            expect(labels.length > 0 && labels.every(label => label === t.meritFunctionEditor.wizard.polAvg),
                `${code} ${typeId} offers ${labels.join(', ') || 'no averaged polarization'}`);
        }
    }
});
await check('avg in Settings and the Filter Design plot', async () => {
    expect(source('components/windows/optimization/filterDesignWizard/SpectrumPlot.js').includes("name: 'target'") === false,
        'the Filter Design plot names its target series in English');
    const { WindowFields } = await import('../src/components/dialogs/settings/analysis/WindowFields.js');
    const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
    const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');
    const offersAvg = registry => Object.values(registry.enums || {}).some(spec => spec.options.includes('avg'));
    const windows = Object.keys(ANALYSIS_DEFAULTS).filter(id => offersAvg(ANALYSIS_DEFAULTS[id]));
    expect(windows.length > 0, 'no analysis window offers the averaged polarization');
    for (const [code, t] of translated) {
        for (const windowId of windows) {
            const labels = avgOptions(renderToStaticMarkup(h(WindowFields, {
                windowId, resolved: resolveAnalysisSettings(windowId, {}), onChange() {}, c, t,
            })));
            expect(labels.length > 0 && labels.every(label => label !== 'avg'), `${code} Settings, ${windowId}, offers ${labels.join(', ')}`);
        }
        expect(t.filterDesign.targetSeries, `${code} has no Filter Design target series name`);
    }
});
await check('avg in the locales', () => {
    for (const [code, t] of translated) {
        const avg = [t.errorAnalysis.polAvg, t.statusMonitors.polAvg, t.filterDesign.step1.polAvg,
            t.report.polAvg, t.report.window.polAvg, t.meritFunctionEditor.wizard.polAvg, t.specification.polAvg];
        expect(avg.every(text => text && text !== 'avg'), `${code} reads ${avg.join(', ')}`);
    }
});
await check('avg in the Report window and document', async () => {
    const { blockSummary } = await import('../src/components/windows/information/report/blockText.js');
    const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');
    const { newBlock } = await import('../src/utils/report/blocks.js');
    const { polText } = await import('../src/utils/report/sections/format.js');
    const noop = () => {};
    for (const [code, t] of translated) {
        const W = t.report.window;
        const block = newBlock('integrals', { polarization: 'avg' });
        expect(blockSummary(W, block).includes(W.polAvg), `${code} block summary reads ${blockSummary(W, block)}`);
        const settings = words(h('div', null, BlockSettingsPanel({
            c, W, t, block, index: 0, count: 1, design: null, onChange: noop, onMove: noop, onRemove: noop, onClose: noop,
        })));
        expect(settings.includes(W.polAvg) && !settings.includes('avg'), `${code} block settings offer avg`);
        expect(polText(t.report, 'avg') === t.report.polAvg && polText(t.report, 's') === 's', `${code} document writes avg`);
    }
});

// ── 2. Measured curves and merit targets on the plots ────────────────────────
await check('Optical Evaluation legend', async () => {
    const { buildChartSeries } = await import('../src/components/windows/analysis/opticalEvaluation/model.js');
    const overlays = [{ id: 'curve-1', name: 'witness', quantity: 'R', x: [500, 600], y: [0.1, 0.2], visible: true }];
    const targets = [
        { id: 'p', enabled: true, type: 'R', lambdaStart: 550, target: 0.5, weight: 1 },
        { id: 'm', enabled: true, type: 'MCURVE', quantity: 'T', curveId: 'gone', curveName: 'sample',
            sampleLambdas: [500, 600], sampleTargets: [0.8, 0.9] },
    ];
    for (const [code, t] of translated) {
        // A curve is named by its series; a target by each point, for the tooltip.
        const names = buildChartSeries({
            curveLabels: t.opticalEval.curveLabels, data: null, showCurves: {}, targets, targetsVisible: true,
            overlays, legendNames: t.legendNames,
        }).flatMap(series => [series.name, ...(series.data || []).map(point => point?.targetLabel)])
            .filter(Boolean).join(' | ');
        expect(!/meas|fit target|R target/.test(names), `${code} reads ${names}`);
        const wanted = [t.legendNames.measured('witness', 'R'), t.legendNames.fitTarget('sample'), t.legendNames.target('R')];
        expect(wanted.every(name => names.includes(name)), `${code} does not name the curve and the targets: ${names}`);
    }
});
await check('Ellipsometry legend', async () => {
    const { measuredEllipsometryOverlays } = await import('../src/components/windows/analysis/ellipsometryEvaluation/model.js');
    const { buildEllipsometryOption } = await import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js');
    const design = {
        measuredEllipsometry: [{ id: 'psi', name: 'film', quantity: 'PSI', aoi: 65, x: [500, 600], y: [20, 30], deltaConvention: 'azzam' }],
        meritOperands: [{ id: 'fit', enabled: true, type: 'MCURVE', quantity: 'DEL', curveId: 'gone', aoi: 65,
            sampleLambdas: [500, 600], sampleTargets: [100, 120], deltaConvention: 'azzam' }],
    };
    const view = { mode: 'spectral', side: 'front', showPsi: true, showDelta: true, deltaConvention: 'azzam' };
    for (const [code, t] of translated) {
        const overlays = measuredEllipsometryOverlays(design, view, t.legendNames);
        const option = buildEllipsometryOption({ x: [500, 600], psi: [20, 30], delta: [100, 120] }, {}, 'λ',
            { overlays, spectral: true, names: t.legendNames });
        const names = option.series.map(series => series.name).join(' | ');
        expect(!/meas|fit target|Measured curve/.test(names), `${code} reads ${names}`);
        expect(names.includes(t.legendNames.fitTargetAt(t.legendNames.unnamedCurve, 'Δ', 65)), `${code} does not name the fit target: ${names}`);
    }
});

await check('Variator plot', async () => {
    const { spectrumSeries } = await import('../src/components/windows/optimization/variator/SpectrumPlot.js');
    const data = { lambda: [500, 600], T: [0.9, 0.8], R: [0.1, 0.2], Tbase: [0.9, 0.9], Rbase: [0.1, 0.1] };
    const targets = [{ id: 'p', enabled: true, type: 'R', lambdaStart: 550, target: 0.5, weight: 1 }];
    for (const [code, t] of translated) {
        const names = spectrumSeries(data, targets, true, t)
            .flatMap(series => [series.name, ...(series.data || []).map(point => point?.targetLabel)])
            .filter(Boolean).join(' | ');
        expect(!/baseline/.test(names) && names.includes(t.variator.baselineCurve('T'))
            && names.includes(t.legendNames.target('R')), `${code} reads ${names}`);
    }
});
await check('the windows pass the names in', () => {
    const passes = {
        'components/windows/analysis/opticalEvaluation/ChartPanel.js': 'legendNames: t.legendNames',
        'components/windows/dataExchange/spectrumExchange/SpectrumPreview.js': 'legendNames: t.legendNames',
        'components/windows/analysis/ellipsometryEvaluation/EllipsometryResults.js': 'names: t.legendNames',
        'components/windows/analysis/ellipsometryEvaluation/EllipsometryEvaluation.js': '}, t.legendNames)',
    };
    for (const [file, text] of Object.entries(passes)) expect(source(file).includes(text), `${file} does not pass t.legendNames`);
});

// ── 3. Custom integrals ──────────────────────────────────────────────────────
await check('Integral Values custom name and tooltip', async () => {
    const { INITIAL_BUILDER, makeCustomDefinition, customIntegralReference } = await import(
        '../src/components/windows/analysis/integralValues/integralModel.js');
    const builders = [
        { ...INITIAL_BUILDER, source: { id: 'custom', table: [[400, 1], [700, 1]] }, detector: { id: 'flat' } },
        { ...INITIAL_BUILDER, source: { id: 'blackbody', T: 3000 }, detector: { id: 'custom', table: [[400, 1], [700, 1]] } },
    ];
    for (const [code, t] of translated) {
        const iv = t.integralValues;
        for (const builder of builders) {
            const custom = makeCustomDefinition(builder, 1, iv.customParts);
            const reference = customIntegralReference(custom, iv.customReference);
            expect(!/srcTbl|detTbl|flat|BB\d/.test(custom.label), `${code} names it ${custom.label}`);
            expect(!/Blackbody|Custom|Flat| on /.test(reference), `${code} describes it as ${reference}`);
        }
        // A custom source with no table loaded is weighted by equal energy.
        const empty = makeCustomDefinition({ ...INITIAL_BUILDER, source: { id: 'custom', table: null } }, 1, iv.customParts);
        const reference = customIntegralReference(empty, iv.customReference);
        expect(reference.startsWith('E × '), `${code} names an empty custom source ${reference}`);
    }
});
await check('Merit Function Editor integral cell', async () => {
    const { renderOperandRow } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
    const op = { id: 'i', type: 'TIW', enabled: true, source: { id: 'custom' }, detector: { id: 'flat' }, lambdaStart: 400, lambdaEnd: 700 };
    for (const [code, t] of translated) {
        const row = renderToStaticMarkup(h('table', null, h('tbody', null, renderOperandRow({
            selIds: new Set(), c, t, onEdit() {}, selectRow() {}, beginDrag() {}, dragOver() {},
            isMathPct: () => false, focusAt() {}, pressCell() {}, integralPresets: [], operands: [op],
        }, op, 0))));
        expect(!/srcTbl|flat/.test(row), `${code} integral cell reads English`);
        expect(row.includes(t.integralValues.customParts.sourceTable), `${code} integral cell does not name the source table`);
    }
});

// ── 4. Names and notes ───────────────────────────────────────────────────────
await check('duplicate design name', () => {
    expect(!source('hooks/useDesignActions.js').includes('(copy)'), 'useDesignActions writes "(copy)"');
    for (const [code, t] of translated) {
        expect(!t.explorer.duplicateName('AR').includes('copy'), `${code} names a duplicate ${t.explorer.duplicateName('AR')}`);
    }
});
await check('Filter Design summary and medium', () => {
    for (const file of ['StepAdjust.js', 'StepMaterials.js']) {
        const text = source(`components/windows/optimization/filterDesignWizard/${file}`);
        expect(!text.includes('final, in') && !text.includes("split(':')"), `${file} writes the summary or the medium id itself`);
    }
    for (const [code, t] of translated) {
        expect(!t.filterDesign.step6.summary(12, 'Air', 45).includes('final, in'), `${code} summary is English`);
    }
});
await check('GD/GDD sampling note', () => {
    expect(!source('components/windows/analysis/gdGddEvaluation/GDControls.js').includes('adaptive points'),
        'GDControls writes "adaptive points"');
    for (const [code, t] of translated) {
        expect(!/adaptive|Taylor jets/.test(t.gdgdd.samplingNote(12)), `${code} note is English`);
    }
});

if (failures.length) {
    console.error(`remaining_window_labels: ${failures.length} failed, ${passed} passed`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log(`remaining_window_labels: ${passed} passed`);
