/**
 * More windows speak the UI language and name a material by its name: the ones
 * left over after untranslated_window_labels.mjs.
 *
 *   1. Merit Function Editor: the header row's prefix, a comment row's
 *      placeholder, a math row's reference cell and a custom integral's cell.
 *   2. Integral Values: the detector choices, a custom integral's weighting,
 *      and the min and max marks on the plot.
 *   3. Systematic Deviations: the legend.
 *   4. Material Editor: the built-in catalog in the selector and the list.
 *   5. Plot Engine: the 2D axis titles, the layer names, a curve's settings,
 *      and a new curve's name.
 *   6. Broadband and monochromatic monitoring: the Resulting Performance legend.
 *
 * Every block runs, and the failures are listed together.
 *
 * Run: node tests/more_window_labels.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const h = React.createElement;
const c = makeTheme();
const en = getLocale('en');
const translated = [['ru', getLocale('ru')], ['zh', getLocale('zh')], ['it', getLocale('it')]];
const html = element => renderToStaticMarkup(element);

const failures = [];
let passed = 0;
async function check(name, fn) {
    try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
function expect(condition, message) {
    if (!condition) throw new Error(message);
}

// Front layers are stored air side first: L2 is the TiO2 on the air side, L1
// the SiO2 on the substrate.
const design = {
    id: 'more-labels', name: 'Labels', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:SiO2', thickness: 1 }, referenceWavelength: 550,
    frontLayers: [
        { id: 'a', material: 'builtin:TiO2', thickness: 60 },
        { id: 'b', material: 'builtin:SiO2', thickness: 94 },
    ],
    backLayers: [],
};

// ── 1. Merit Function Editor ─────────────────────────────────────────────────
{
    const { renderOperandRow } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
    const row = (t, op, operands = [op]) => html(h('table', null, h('tbody', null, renderOperandRow({
        selIds: new Set(), c, t, onEdit() {}, selectRow() {}, beginDrag() {}, dragOver() {},
        isMathPct: () => false, focusAt() {}, pressCell() {}, integralPresets: [], operands,
    }, op, 0))));

    await check('MF header row prefix', () => {
        const header = row(en, { id: 'h', type: 'DMFS', comment: '', enabled: true });
        expect(header.includes(`▶ DMFS: ${en.meritFunctionEditor.defaultDmfs}`), `the header row reads ${header}`);
    });
    await check('MF comment row placeholder', () => {
        for (const [code, t] of translated) {
            const comment = row(t, { id: 'b', type: 'BLNK', comment: '', enabled: true });
            expect(!comment.includes('# comment'), `${code} reads "# comment"`);
            expect(comment.includes(`placeholder="${t.meritFunctionEditor.commentPlaceholder}"`),
                `${code} has no comment placeholder of its own`);
        }
    });
    // A math operand whose reference is gone, and one with none picked yet.
    const reference = (t, refId) => {
        const op = { id: 'm', type: 'OPGT', refId, enabled: true };
        return row(t, op, [op, { id: 'x', type: 'TAV', enabled: true }]);
    };
    await check('MF reference cell', () => {
        for (const [code, t] of translated) {
            const mfe = t.meritFunctionEditor;
            expect(reference(t, 'deleted-row').includes(mfe.refDeleted), `${code} stale reference is not ${mfe.refDeleted}`);
            expect(reference(t, null).includes(mfe.refPick), `${code} empty reference is not ${mfe.refPick}`);
        }
    });
    await check('MF custom integral cell', () => {
        const op = { id: 'i', type: 'TIW', enabled: true, source: 'D65', detector: 'photopic', lambdaStart: 400, lambdaEnd: 700 };
        for (const [code, t] of translated) {
            expect(!row(t, op).includes('Custom integral'), `${code} reads "Custom integral"`);
        }
    });
}

// ── 2. Integral Values ───────────────────────────────────────────────────────
{
    const { INITIAL_BUILDER, buildIntegralDefinitions, makeCustomDefinition } = await import(
        '../src/components/windows/analysis/integralValues/integralModel.js');
    const { weightingText } = await import('../src/utils/physics/integralValues/builtinWeightings.js');
    const { buildOverlayOption } = await import('../src/components/windows/analysis/integralValues/overlayFigure.js');

    await check('Integral Values detector choices', () => {
        for (const [code, t] of translated) {
            for (const key of ['photopic', 'flat']) {
                expect(t.illuminants[key] !== en.illuminants[key], `${code} ${key} is the English "${en.illuminants[key]}"`);
            }
        }
    });
    await check('Integral Values custom weighting', () => {
        const custom = makeCustomDefinition(INITIAL_BUILDER, 1);
        const added = buildIntegralDefinitions([custom]).at(-1);
        for (const [code, t] of translated) {
            const tr = t.integralValues.weightings;
            const label = weightingText(added.weighting, tr).label;
            expect(label === tr.custom(custom.label) && !label.includes('weight'), `${code} names it "${label}"`);
        }
    });
    await check('Integral Values min and max marks', () => {
        const spectrum = { lambda: [500, 600], T: [0.9, 0.8] };
        const minMaxMarks = { min: 0.8, lamAtMin: 600, max: 0.9, lamAtMax: 500 };
        for (const [code, t] of translated) {
            const iv = t.integralValues;
            const [min, max] = buildOverlayOption({ spectrum, char: 'T', minMaxMarks, colors: {}, labels: iv, units: t.units })
                .series.slice(1).map(series => series.name);
            expect(min.startsWith(`${iv.col_min} `) && max.startsWith(`${iv.col_max} `), `${code} reads ${min}, ${max}`);
        }
    });
}

// ── 3. Systematic Deviations ─────────────────────────────────────────────────
{
    const { buildSpectrumSeries } = await import(
        '../src/components/windows/analysis/systematicDeviations/spectrumFigure.js');
    await check('Systematic Deviations legend', () => {
        const spectrum = { lambda: [500, 600], T: [0.9, 0.8] };
        for (const [code, t] of translated) {
            const sd = t.systematicDeviations;
            const names = buildSpectrumSeries(spectrum, spectrum, { channel: 'T', showBaseline: true, sd })
                .map(series => series.name);
            expect(names.join() === `T ${sd.baseline},T ${sd.deviated}`, `${code} reads ${names.join(', ')}`);
            expect(sd.deviated !== en.systematicDeviations.deviated, `${code} keeps "deviated" in English`);
        }
    });
}

// ── 4. Material Editor ───────────────────────────────────────────────────────
{
    const { renderLeftPanel } = await import(
        '../src/components/windows/design/materialEditor/materialEditorLeftPanel.js');
    const { getCatalog, searchMaterials } = await import('../src/utils/materials/catalogManager.js');
    const { setCurrentLocale } = await import('../src/constants/locales/index.js');
    const builtin = getCatalog('builtin');
    const noop = () => {};
    // The list under All catalogs names each material's catalog.
    const results = searchMaterials('', 'builtin').slice(0, 3);
    const panel = (t, catFilter, currentCatalog) => html(renderLeftPanel({
        c, me: t.materialEditor, catFilter, setCatFilter: noop, setEditDraft: noop,
        browseCatalogs: [builtin], currentCatalog, isUserCatalog: false, importing: false,
        menuOpen: false, setMenuOpen: noop, menuTriggerRef: { current: null },
        addMenuOpen: false, setAddMenuOpen: noop, addMenuTriggerRef: { current: null },
        query: '', setQuery: noop, results, notification: null,
        editDraft: null, selectedId: null, handleSelectMaterial: noop, handleNewMaterial: noop,
    }));
    await check('Material Editor catalog selector and list', () => {
        for (const [code, t] of translated) {
            setCurrentLocale(code);
            const one = panel(t, 'builtin', builtin);
            const all = panel(t, 'all', null);
            const name = t.pool.builtinCatalog;
            expect(!one.includes('Built-in') && !all.includes('Built-in'), `${code} lists the built-in catalog as "Built-in"`);
            expect(one.includes(`title="${name}"`) && all.includes(`· ${name}`), `${code} does not name the built-in catalog`);
        }
        setCurrentLocale('en');
    });
}

// ── 5. Plot Engine ───────────────────────────────────────────────────────────
{
    const { buildCurveOption } = await import('../src/components/windows/analysis/plotEngine/charts/CurveChart.js');
    const { CurveRow } = await import('../src/components/windows/analysis/plotEngine/CurveRow.js');
    const { buildAxisTargetOptions, buildAxisVarOptions, makeDefaultCurve } = await import(
        '../src/utils/physics/plotQuantities.js');

    await check('Plot Engine 2D axis titles', () => {
        for (const [code, t] of translated) {
            const title = xAxis => buildCurveOption([{ id: 'a', visible: true, xAxis }], {}, c, t).xAxis.name;
            expect(title('wavelength') === t.spectralAxis.lambdaShort, `${code} wavelength axis reads "${title('wavelength')}"`);
            expect(title('aoi') === t.plotEngine.varAOI, `${code} angle axis reads "${title('aoi')}"`);
        }
    });
    await check('Plot Engine layer names', () => {
        const targets = buildAxisTargetOptions(design, true).map(option => option.label);
        expect(targets.includes('L1 (SiO2)') && targets.includes('L2 (TiO2)'), `the layers read ${targets.join(', ')}`);
        const tokens = buildAxisVarOptions(design, true).map(option => option.label).join(' | ');
        expect(!/builtin:|thickness|index|Wavelength/.test(tokens), `the axis titles read ${tokens}`);
    });
    await check('Plot Engine curve settings', () => {
        const curve = makeDefaultCurve({ dash: 'dot' });
        for (const [code, t] of translated) {
            const pe = t.plotEngine;
            // What the dropdowns show, without the option values, which are ids.
            const shown = html(h(CurveRow, { curve, onUpdate() {}, onDelete() {}, c, t }))
                .replace(/<[^>]*>/g, '\n').split('\n').map(text => text.trim());
            const ids = ['front', 'back', 'total', 'solid', 'dashdot', 'avg'].filter(id => shown.includes(id));
            expect(ids.length === 0, `${code} lists ${ids.join(', ')}`);
            expect(shown.includes(pe.surfaceModes.front) && shown.includes(pe.dashes.dot) && shown.includes(pe.xAOI),
                `${code} does not name the surfaces, dashes and the angle axis`);
        }
    });
    await check('Plot Engine new curve name', () => {
        for (const [code, t] of translated) {
            const curve = makeDefaultCurve({ nameCurve: t.plotEngine.curveName });
            expect(!curve.label.includes('curve'), `${code} names a new curve "${curve.label}"`);
        }
    });
}

// ── 6. Broadband and monochromatic monitoring, Resulting Performance ─────────
{
    const { performanceSeries } = await import('../src/components/windows/simulation/wizardKit/PageResults.js');
    await check('Monitoring wizard performance legend', () => {
        const spectrum = { lambda: [500, 600], values: [0.9, 0.8] };
        for (const [code, t] of translated) {
            for (const block of ['bbmSim', 'monoSim']) {
                const names = performanceSeries({ theory: spectrum, manuf: spectrum }, c, t[block]).map(series => series.name);
                expect(names.every(name => name && name !== 'theory' && name !== 'manufactured'),
                    `${code} ${block} reads ${names.join(', ')}`);
            }
        }
    });
}

if (failures.length) {
    console.error(`more_window_labels: ${failures.length} failed, ${passed} passed`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log(`more_window_labels: ${passed} passed`);
