/**
 * The Edge Filter window (src/components/windows/design/edgeFilter/).
 *
 *   1. It opens on the design: its media, its reference wavelength as the
 *      edge, and its lowest and highest index as materials A and B, at normal
 *      incidence with 10 periods; after that on the materials and settings of
 *      the last opening, where the design can use them.
 *   2. With the built-in materials, the period the search picks, written as a
 *      Stack Formula formula and built by Stack Formula's own code, has its s
 *      and p zone edges at the edge wavelength. Where two periods meet, their
 *      outer layers become one layer.
 *   3. An absorbing material is named, and a material with no index at the
 *      edge stops the search.
 *   4. Replace, Append and New design put the filter in the design as Stack
 *      Formula does, the searched medium on the side the light arrives from.
 *   5. The search runs in its worker and can be stopped there.
 *   6. The ribbon opens the window, and its formula opens in Stack Formula,
 *      which puts it in the design with the same media.
 *   7. The table lists the periods with the best one picked, drawing only the
 *      rows in view, and fits its half of the dialog in every language; the
 *      formula row shows the picked period.
 *   8. Its help button opens a page that exists in both languages, whose
 *      example formula is the one the window gives for the case it names.
 *
 * Run: node tests/edge_filter_window.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { layerMatrix, matmul, snellCosTheta } = await import('../src/tmmcore.js');
const { searchEdgeFilters } = await import('../src/utils/synthesis/edgeFilter.js');
const model = await import('../src/components/windows/design/edgeFilter/model.js');
const { edgeFilterPatch, buildNewEdgeFilterDesign } = await import('../src/components/windows/design/edgeFilter/designBuild.js');
const { startEdgeSearch, stopEdgeSearch } = await import('../src/components/windows/design/edgeFilter/searchRun.js');
const { SolutionsTable } = await import('../src/components/windows/design/edgeFilter/SolutionsTable.js');
const { RESULT_ROW_HEIGHT } = await import('../src/components/ui/ResultsSection.js');
const { ResultsPanel } = await import('../src/components/windows/design/edgeFilter/ResultsPanel.js');
const { AppModals } = await import('../src/components/AppModals.js');
const { EdgeFilterDialog } = await import('../src/components/windows/design/edgeFilter/EdgeFilterDialog.js');
const { useAppCommands } = await import('../src/hooks/useAppCommands.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');

const h = React.createElement;
const c = makeTheme();
const t = makeLocale('en');
const ef = t.edgeFilter;

const design = {
    id: 'edge', name: 'Edge', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 }, referenceWavelength: 510,
    frontLayers: [
        { id: 'h', material: 'builtin:TiO2', thickness: 50 },
        { id: 'l', material: 'builtin:SiO2', thickness: 80 },
    ],
    backLayers: [], surfaceMode: 'front_only',
};

// ── 1. Starting inputs ───────────────────────────────────────────────────────
const opening = model.initialInputs(design);
assert.equal(opening.edgeLambda, 510);
assert.equal(opening.incidentMat, 'builtin:Air');
assert.equal(opening.substrateMat, 'builtin:BK7');
assert.equal(opening.matA, 'builtin:SiO2', 'A is the lowest index of the design');
assert.equal(opening.matB, 'builtin:TiO2', 'B is the highest');
assert.deepEqual([opening.pass, opening.angle, opening.periods, opening.lower, opening.upper, opening.step],
    ['short', 0, 10, 0.1, 1, 0.05], 'a first opening: normal incidence, 10 periods, the manual\'s range of a');
const empty = model.initialInputs({ ...design, frontLayers: [] });
assert.deepEqual([empty.matA, empty.matB], ['builtin:SiO2', 'builtin:TiO2'], 'an empty design gets the example pair');
{
    // The settings of the last opening come back; the edge and the media are
    // the design's whatever was used last time.
    const { readRememberedInputs, rememberInputs } = await import('../src/components/windows/design/edgeFilter/rememberedInputs.js');
    const store = new Map();
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
    const last = { ...opening, pass: 'long', angle: 30, periods: 25, lower: 0.2, upper: 1.5, step: 0.01,
                   matA: 'builtin:MgF2', matB: 'builtin:Ta2O5', edgeLambda: 800, incidentMat: 'builtin:BK7' };
    rememberInputs(last, storage);
    const reopened = model.initialInputs(design, readRememberedInputs(storage));
    for (const key of model.REMEMBERED_INPUTS) assert.equal(reopened[key], last[key], `${key} is remembered`);
    assert.deepEqual([reopened.edgeLambda, reopened.incidentMat], [510, 'builtin:Air'], 'the edge and the media are the design\'s');
    const gone = model.initialInputs(design, { matA: 'user_lab:gone', matB: 'builtin:Ta2O5', angle: 'x', pass: 'up' });
    assert.deepEqual([gone.matA, gone.matB, gone.angle, gone.pass], ['builtin:SiO2', 'builtin:TiO2', 0, 'short'],
        'a material that is gone, or a setting that is not one, gives the design\'s pair and the defaults');
    assert.deepEqual(readRememberedInputs({ getItem: () => '{broken' }), {}, 'unreadable storage gives nothing');
    assert.deepEqual(readRememberedInputs(undefined), {}, 'and so does none');
}

// The rest of this test works the manual's example at 45° with 19 periods.
const inputs = { ...opening, angle: 45, periods: 19 };

// ── 2. From the search to Stack Formula's layers ─────────────────────────────
const prepared = model.edgeRequest(design, inputs);
assert.deepEqual(prepared.absorbing, [], 'SiO2 and TiO2 are lossless at 510 nm');
const resolve = designMaterialLookup(design);
assert.equal(prepared.request.nA, resolve('builtin:SiO2').getNK(510)[0], 'the search takes n at the edge');
const { solutions } = searchEdgeFilters(prepared.request);
const best = solutions[0];
const symbols = model.formulaSymbols(inputs, prepared.request);
assert.deepEqual(symbols.symbolMap, { H: 'builtin:TiO2', L: 'builtin:SiO2' }, 'H and L as Stack Formula reads them');
const formula = model.periodFormula(best, symbols, 19);
const [outer, inner] = best.outer === 'A' ? ['L', 'H'] : ['H', 'L'];
const six = x => Number(x.toFixed(6));
assert.equal(formula,
    `(${six(best.a)}${outer} ${six(best.b)}${inner} ${six(best.c)}${outer} ${six(best.b)}${inner} ${six(best.a)}${outer})^19`);
assert.ok(!model.periodFormula(best, symbols, 1).includes('^'), 'one period is written without a group');

const compiled = model.compileEdgeFilter(design, formula, symbols.symbolMap, 510);
assert.ok(compiled.ok, 'Stack Formula builds the formula');
assert.equal(compiled.layers.length, 5 * 19 - 18, 'the outer layers of neighbouring periods are one layer');
const [first, , , , joined] = compiled.layers;
assert.ok(Math.abs(joined.thickness - 2 * first.thickness) < 1e-9, 'a joined layer is two outer layers thick');
assert.ok(compiled.layers.every((l, i) => i === 0 || l.material !== compiled.layers[i - 1].material),
    'no two touching layers share a material');

// The first period, from the built thicknesses, has its zone edge at 510 nm.
function n11(layers, lambda, pol) {
    const sin0 = [Math.sin(Math.PI / 4), 0], cos0 = [Math.cos(Math.PI / 4), 0];
    let M = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    for (const { material, thickness } of layers) {
        const n = [resolve(material).getNK(lambda)[0], 0];
        M = matmul(M, layerMatrix(n, thickness, lambda, snellCosTheta([1, 0], sin0, n, cos0), pol));
    }
    return M[0][0][0];
}
const period = [first, compiled.layers[1], compiled.layers[2], compiled.layers[3], first];
for (const pol of ['s', 'p']) {
    assert.ok(Math.abs(n11(period, 510, pol) - best.sigma) < 1e-5, `${pol}: N11 = ${n11(period, 510, pol)} at the edge`);
}

// The preview: s, p and their mean.
const preview = model.edgePreviewSpectrum(design, compiled, inputs);
assert.ok(!preview.error && preview.lambda.length > 100);
preview.T.forEach((value, i) => assert.ok(Math.abs(value - (preview.Ts[i] + preview.Tp[i]) / 2) < 1e-12));

// ── 3. Absorbing and missing materials ───────────────────────────────────────
const withCr = model.edgeRequest(design, { ...inputs, matB: 'builtin:Cr' });
assert.deepEqual(withCr.absorbing, ['builtin:Cr'], 'chromium absorbs at 510 nm');
const broken = { 'user_x:Bad': { id: 'Bad', name: 'Broken film', formulaNum: -1, tabData: [[400, 0, 0], [700, 0, 0]] } };
assert.deepEqual(model.edgeRequest({ ...design, materials: broken }, { ...inputs, matA: 'user_x:Bad' }), { errorKey: 'noIndex' });

// ── 4. Into the design ───────────────────────────────────────────────────────
const searched = { ...inputs, incidentMat: 'builtin:BK7', substrateMat: 'builtin:SiO2' };
const front = edgeFilterPatch({ design, mode: 'replace', isSym: false, effSide: 'front', compiled, inputs: searched, formula, stamp: 1 });
assert.equal(front.frontLayers.length, compiled.layers.length);
assert.equal(front.incidentMedium, 'builtin:BK7', 'the searched medium faces the front coating');
assert.equal(front.substrate.material, 'builtin:SiO2');
assert.equal(front.referenceWavelength, 510, 'the quarter waves are those at the edge');
assert.equal(front.stackFormula, formula);
const back = edgeFilterPatch({ design, mode: 'replace', isSym: false, effSide: 'back', compiled, inputs: searched, formula, stamp: 1 });
assert.equal(back.exitMedium, 'builtin:BK7', 'and the back coating from the exit side');
assert.equal(back.backLayers.length, compiled.layers.length);
const appended = edgeFilterPatch({ design, mode: 'append', isSym: false, effSide: 'front', compiled, inputs: searched, formula, stamp: 2 });
assert.equal(appended.frontLayers.length, compiled.layers.length + 2, 'Append keeps the coating already there');
for (const [side, mode] of [['front', 'front_only'], ['back', 'back_only'], ['both', 'both_independent']]) {
    const made = buildNewEdgeFilterDesign({ newName: ef.defaultName, effSide: side, compiled, inputs: searched, formula });
    assert.equal(made.name, ef.defaultName);
    assert.equal(made.surfaceMode, mode, `a new design with the filter on ${side}`);
    assert.equal((side === 'back' ? made.backLayers : made.frontLayers).length, compiled.layers.length);
    const ids = [...made.frontLayers, ...made.backLayers].map(l => l.id);
    assert.equal(new Set(ids).size, ids.length, 'layer ids are unique');
}

// ── 5. The worker ────────────────────────────────────────────────────────────
// Each worker made is kept, and remembers whether it was terminated.
const workersMade = [];
globalThis.Worker = class extends NodeModuleWorker {
    constructor(...args) { super(...args); workersMade.push(this); }
    terminate() { this.terminated = true; super.terminate(); }
};
const started = performance.now();
const fromWorker = await new Promise((resolveRun) => {
    const workerRef = { current: null };
    startEdgeSearch({
        workerRef, request: prepared.request, signature: 'a', setProgress() {},
        finish: (result, signature) => resolveRun({ result, signature, workerRef }),
    });
});
const runMs = performance.now() - started;
assert.equal(fromWorker.signature, 'a');
assert.deepEqual(fromWorker.result.solutions, solutions, 'the worker answers as the search does');
assert.equal(fromWorker.workerRef.current, null, 'a finished search lets its worker go');
assert.ok(workersMade[0].terminated, 'and ends it');
// Stop the same search at once and wait well past the time it took to run.
{
    let reported = false;
    const workerRef = { current: null };
    startEdgeSearch({
        workerRef, request: prepared.request, signature: 'b',
        setProgress() { reported = true; }, finish: () => { reported = true; },
    });
    const stopped = workerRef.current;
    stopEdgeSearch(workerRef);
    await new Promise(r => setTimeout(r, Math.max(1000, 3 * runMs)));
    assert.equal(workerRef.current, null);
    assert.ok(stopped.terminated, 'Stop ends the worker');
    assert.equal(reported, false, 'a stopped search reports nothing');
}
// A worker that was stopped can still have a message on its way. Only the
// worker the ref holds may report, so a search replaced by a new one is silent.
{
    const fakes = [];
    globalThis.Worker = class { constructor() { fakes.push(this); } postMessage() {} terminate() { this.terminated = true; } };
    const reports = [];
    const workerRef = { current: null };
    const start = signature => startEdgeSearch({
        workerRef, request: prepared.request, signature,
        setProgress: () => reports.push(['progress', signature]),
        finish: (result, ranWith) => reports.push(['finish', ranWith]),
    });
    start('old');
    start('new');
    const [old, current] = fakes;
    assert.ok(old.terminated, 'a new search stops the one before it');
    old.onmessage({ data: { type: 'progress', done: 1, total: 19 } });
    old.onmessage({ data: { type: 'result', result: { solutions: [] } } });
    const logError = console.error;
    console.error = () => {};
    old.onerror({ message: 'late' });
    console.error = logError;
    assert.deepEqual(reports, [], 'the replaced search reports nothing');
    current.onmessage({ data: { type: 'progress', done: 1, total: 19 } });
    current.onmessage({ data: { type: 'result', result: { solutions: [] } } });
    assert.deepEqual(reports, [['progress', 'new'], ['finish', 'new']], 'the new one does');
    globalThis.Worker = NodeModuleWorker;
}

// ── 6. Ribbon and hand-off ───────────────────────────────────────────────────
{
    const calls = [];
    const dialogs = new Proxy({}, { get: (_, key) => (value) => calls.push([key, value]) });
    let commands = null;
    function Probe() { commands = useAppCommands({ dialogs, workspace: { openTool() {} }, project: {}, store: {}, welcome: {} }); return null; }
    renderToStaticMarkup(h(Probe));
    commands.handleToolAction('edge-filter');
    assert.deepEqual(calls, [['setShowEdgeFilter', true]], 'the ribbon button opens the window');
}
{
    const calls = [];
    const tree = AppModals({
        c, t, settings: {}, welcome: {}, activeDesignId: design.id,
        dialogs: {
            showEdgeFilter: true,
            setShowEdgeFilter: v => calls.push(['edge', v]), setShowStackFormula: v => calls.push(['formula', v]),
        },
        project: { selectedFolder: { name: 'Designs' }, addItemFromDesign() {} },
        inputDialog: null, messageNotifications: [], onDismissMessage() {},
    });
    const guard = [].concat(tree.props.children).find(el => el?.props?.children?.type === EdgeFilterDialog);
    assert.ok(guard, 'the window is drawn behind the material guard');
    const seed = model.stackFormulaSeed(formula, symbols.symbolMap, inputs);
    guard.props.children.props.onOpenStackFormula(seed);
    assert.deepEqual(calls, [['edge', false], ['formula', seed]], 'Stack Formula opens on the formula in its place');
    assert.deepEqual(seed.rows, [
        { sym: 'H', matId: 'builtin:TiO2', fixed: true }, { sym: 'L', matId: 'builtin:SiO2', fixed: true },
    ]);
    assert.equal(seed.refLambda, 510);
}
// Put in from Stack Formula after Open in Stack Formula, the filter gets the
// media the Edge Filter's own Replace and Append give it, on every side. The
// searched medium is glass here, as for a filter inside a cube, so it differs
// from the design's exit medium.
{
    const { useStackFormula } = await import('../src/components/windows/design/stackFormula/useStackFormula.js');
    const { buildReplaceAppendPatch } = await import('../src/components/windows/design/stackFormula/designBuild.js');
    const inGlass = { ...inputs, incidentMat: 'builtin:BK7' };
    const seed = model.stackFormulaSeed(formula, symbols.symbolMap, inGlass);
    let sf = null;
    function Probe() {
        sf = useStackFormula({ design, updateDesign() {}, checkpoint() {}, onClose() {}, seed, t });
        return null;
    }
    renderToStaticMarkup(h(Probe));
    for (const effSide of ['front', 'back', 'both']) {
        for (const mode of ['replace', 'append']) {
            const viaFormula = buildReplaceAppendPatch({
                design, mode, isSym: false, effSide, compiled: sf.compiled, refLambda: sf.refLambda,
                substrateMat: sf.substrateMat, incidentMat: sf.incidentMat, exitMat: sf.exitMat, text: sf.text, stamp: 1,
            });
            const direct = edgeFilterPatch({ design, mode, isSym: false, effSide, compiled, inputs: inGlass, formula, stamp: 1 });
            for (const key of ['incidentMedium', 'exitMedium', 'substrate', 'referenceWavelength', 'surfaceMode']) {
                assert.deepEqual(viaFormula[key], direct[key], `${mode} on ${effSide}: ${key}`);
            }
        }
    }
}

// ── 7. The table and the formula row ─────────────────────────────────────────
{
    const state = {
        inputs, solutions, current: { result: { solutions }, selected: 0 }, running: false,
        select() {}, formula, compiled, openInStackFormula() {},
    };
    const table = renderToStaticMarkup(withDesign(h(SolutionsTable, { state, design, c, ef }), design));
    assert.ok(table.includes(best.a.toFixed(4)) && table.includes(best.b.toFixed(4)), 'the best period is listed');
    // A fine step over a wide range of a finds tens of thousands of periods, and
    // a click on a row draws the table again: only the rows in view are drawn.
    const many = Array.from({ length: 80000 }, (_, i) => solutions[i % solutions.length]);
    const long = renderToStaticMarkup(withDesign(h(SolutionsTable, {
        state: { ...state, solutions: many, current: { result: { solutions: many }, selected: 0 } }, design, c, ef,
    }), design));
    const drawn = (long.match(/<tr/g) || []).length;
    assert.ok(drawn < 60, `80,000 periods draw ${drawn} rows`);
    const below = Math.max(...[...long.matchAll(/height:(\d+)px/g)].map(match => Number(match[1])));
    assert.ok(below / RESULT_ROW_HEIGHT > 79900, 'the rows not drawn still give the scrollbar its full length');
    const panel = renderToStaticMarkup(withDesign(h(ResultsPanel, { state, c, ef, design, lambdaAxis: 'λ' }), design));
    assert.ok(panel.includes(`value="${formula}"`), 'the formula row shows the picked period');
    assert.ok(panel.includes(ef.found(solutions.length)));
    const none = renderToStaticMarkup(withDesign(h(SolutionsTable, {
        state: { ...state, solutions: [], current: { result: { solutions: [] }, selected: 0 } }, design, c, ef,
    }), design));
    assert.ok(none.includes(ef.none), 'an empty search says so');
    const failed = renderToStaticMarkup(withDesign(h(SolutionsTable, {
        state: { ...state, solutions: [], current: { result: { errorKey: 'sameIndex' }, selected: 0 } }, design, c, ef,
    }), design));
    assert.ok(failed.includes(ef.errors.sameIndex), 'a refused search says why');

    // The three widths share one header with their unit, and the eight columns
    // fit the results half of the dialog in every language. The dialog is
    // DIALOG_WIDTH wide with 20 px of padding a side; the inputs and the results
    // grow from 340 and 420 px either side of a 16 px gap; a column is its
    // widest text in digits plus 16 px (ui/virtualRows.js), and a digit is taken
    // at 0.64 em of the table's 11.5 px, wider than in the usual UI fonts.
    assert.equal((table.match(/\(nm\)/g) || []).length, 1, 'the unit is written once, over the three widths');
    assert.match(table, /colSpan="3"[^>]*>Width \(nm\)</i, 'in a header that spans them');
    const { DIALOG_WIDTH } = await import('../src/components/windows/design/edgeFilter/EdgeFilterDialog.js');
    const resultsWidth = 420 + (DIALOG_WIDTH - 2 * 20 - 16 - 340 - 420) / 2;
    for (const lang of ['en', 'ru', 'zh', 'it']) {
        const local = makeLocale(lang).edgeFilter;
        const html = renderToStaticMarkup(withDesign(h(SolutionsTable, { state, design, c, ef: local }), design));
        const chars = [...html.matchAll(/calc\((\d+)ch \+ 16px\)/g)].map(match => Number(match[1]));
        assert.equal(chars.length, 8, `${lang}: eight columns`);
        const needed = chars.reduce((sum, n) => sum + n * 0.64 * 11.5 + 16, 0);
        assert.ok(needed <= resultsWidth, `${lang}: the table needs ${needed.toFixed(0)} px of the ${resultsWidth} px it has`);
    }

    // The pass switch is Stack Formula's side switch with the two passes on it.
    const { SideSeg } = await import('../src/components/windows/design/stackFormula/ui.js');
    const passSwitch = renderToStaticMarkup(h(SideSeg, {
        value: 'long', onChange() {}, c, opts: [['short', ef.shortPass], ['long', ef.longPass]],
    }));
    const buttons = [...passSwitch.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
        .map(([, attrs, label]) => ({ label, lit: attrs.includes(`background-color:${c.accent}`) }));
    assert.deepEqual(buttons, [{ label: ef.shortPass, lit: false }, { label: ef.longPass, lit: true }]);
    // The parts InputsPanel draws at its top level, the pass switch among them;
    // the fields and pickers inside its rows are left out.
    const { InputsPanel } = await import('../src/components/windows/design/edgeFilter/InputsPanel.js');
    const inputsPanel = InputsPanel({
        state: { inputs: { ...inputs, pass: 'long' }, setInput() {}, running: false, progress: null,
                 prepared: { absorbing: [] }, search() {}, stop() {} },
        c, t, ef, design,
    });
    const parts = [].concat(inputsPanel.props.children)
        .filter(el => typeof el?.type === 'function').map(el => renderToStaticMarkup(el));
    assert.ok(parts.some(html => html.includes(passSwitch)), 'the Edge Filter draws its pass switch with it, lit on its pass');
}

// ── 8. The help page ─────────────────────────────────────────────────────────
{
    const { readFileSync, existsSync } = await import('node:fs');
    const { EDGE_FILTER_HELP } = await import('../src/components/windows/design/edgeFilter/EdgeFilterDialog.js');
    for (const slug of [`${EDGE_FILTER_HELP}.md`, `zh/${EDGE_FILTER_HELP}.md`]) {
        const page = new URL(`../docs-site/src/content/docs/${slug}`, import.meta.url);
        assert.ok(existsSync(page), `the help button opens ${slug}`);
        const text = readFileSync(page, 'utf8');
        assert.match(text, /^ribbonIcon: edge-filter$/m, `${slug} shows the ribbon icon`);
        // Its example formula is the one section 2 gets for the case it names:
        // the built-in SiO2 and TiO2, edge at 510 nm, 45° in air.
        assert.ok(text.includes(`\`${formula}\``), `${slug} quotes ${formula}, the formula the window gives`);
    }
    const { ICONS: docsIcons } = await import('../docs-site/src/components/ribbon-icons.js');
    assert.ok(docsIcons['edge-filter'], 'the docs site has the icon to show');
}

console.log(`edge_filter_window: passed (${solutions.length} periods for SiO2/TiO2 at 510 nm, best a=${best.a.toFixed(2)} b=${best.b.toFixed(4)} c=${best.c.toFixed(4)}, outer ${best.outer})`);
process.exit(0);
