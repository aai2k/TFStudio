/**
 * The optimization and analysis windows take a comma decimal in their boxes.
 *
 * A native `type="number"` box on an English Windows drops the comma keystroke
 * before the code sees it, so 94,2 typed into one arrives as 942. Each section
 * types 94,2 into a window's decimal boxes and checks that 94.2 reaches the
 * window; a count box is a text field and hands on a typed count.
 *
 *   1. Refinement run controls: max iterations, restarts, perturbation % and
 *      the seed, which empties to "draw a random one", as an entry that is not
 *      a seed does; F5 pressed in a box runs with what was typed there.
 *   2. Variator preview: wavelength start and end, and the angle, 0 to 89.
 *   3. Needle Manual: the scan settings in the sidebar and the thickness of
 *      the needle being inserted.
 *   4. Design Cleaner: minimum thickness and re-optimize iterations.
 *   5. Optimizer Benchmark: the synthesis time budget, 1 to 60 s.
 *   6. Integral Values: the band of a custom integral, typed in its dialog.
 *   7. Optical Evaluation: the angle chips, edited in place and added, where
 *      Escape cancels and the arrow keys step by 1°.
 *
 * Run: node tests/comma_decimal_optimization_and_analysis.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const { getLocale } = await import('../src/constants/locales/index.js');
const { DesignContext } = await import('../src/state/DesignContext.js');

const t = getLocale('en');
const c = {
    bg: '#000', panel: '#111', field: '#111', text: '#eee', textDim: '#999', border: '#333',
    accent: '#39f', accentText: '#fff', success: '#3a3', error: '#f33',
};
// The test React reads a context's value straight off the context object.
DesignContext.value = { liveUpdate: true, setLiveUpdate() {} };

// What the handler `name` receives after `act` is done to the box `pick` chooses.
function received(Component, props, name, pick, act) {
    const values = [];
    const field = mount(Component, { ...props, [name]: value => values.push(value) }, pick);
    act(field);
    return { values, field };
}

// ── 1. Refinement run controls ───────────────────────────────────────────────
{
    const { ControlBar } = await import('../src/components/windows/optimization/refinement/ControlBar.js');
    const noop = () => {};
    // 'dls-multi' shows every box: max iterations, restarts, perturbation %, seed.
    const props = {
        running: false, iter: 0, mf: null, mfBest: null, mfInitial: null, canReset: false,
        method: 'dls-multi', nRestarts: 20, perturbPct: 30, restartIdx: 0, maxIter: 200, seed: null,
        stopReason: null, surfaceMode: 'front_only', mfEvalMode: 'side',
        onRun: noop, onStop: noop, onReset: noop, onBest: noop, onMethod: noop,
        onNRestarts: noop, onPerturbPct: noop, onMaxIter: noop, onSeed: noop, t, c,
    };
    const [maxIter, restarts, perturb, seed] = [0, 1, 2, 3].map(at => inputs => inputs[at]);

    assert.deepEqual(received(ControlBar, props, 'onPerturbPct', perturb, f => f.type('94,2').leave()).values, [94.2],
        'Refinement: perturbation 94,2 is 94.2');
    for (const [pick, name, label] of [[maxIter, 'onMaxIter', 'max iterations'], [restarts, 'onNRestarts', 'restarts']]) {
        const { values, field } = received(ControlBar, props, name, pick, f => f.type('250').press('Enter'));
        assert.deepEqual(values, [250], `Refinement: ${label} takes a typed count`);
        assert.equal(field.input().props.type, 'text', `Refinement: ${label} is a text field`);
    }
    {
        const { values, field } = received(ControlBar, props, 'onSeed', seed, f => f.type('12345').leave());
        assert.deepEqual(values, [12345], 'Refinement: the seed takes a typed seed');
        assert.equal(field.input().props.type, 'text', 'Refinement: the seed is a text field');
        assert.equal(field.input().props.placeholder, t.refinement.seedRandom, 'Refinement: an empty seed says it is random');
        const emptied = received(ControlBar, { ...props, seed: 77 }, 'onSeed', seed, f => f.type('').leave());
        assert.deepEqual(emptied.values, [null], 'Refinement: an emptied seed draws a random one');
        for (const text of ['0', '-5', '5000000000']) {
            const notSeed = received(ControlBar, props, 'onSeed', seed, f => f.type(text).leave());
            assert.deepEqual(notSeed.values, [null], `Refinement: ${text} is not a seed and draws a random one`);
            assert.equal(notSeed.field.shown, '', `Refinement: and the seed box shows empty after ${text}`);
        }
    }
    {
        // F5 with the cursor still in Restarts: the box is left first, so the
        // run reads the 5 typed there, not the 20 it held.
        const { runShortcut, writeThrough } = await import('../src/components/windows/optimization/refinement/useRefinement.js');
        const restartsRef = { current: 20 };
        const field = mount(ControlBar, { ...props, onNRestarts: writeThrough(restartsRef, noop) }, restarts);
        field.type('5');
        let ranWith = null;
        const focused = { activeElement: { blur: () => field.leave() } };
        runShortcut({ key: 'F5', preventDefault() {} }, { running: false, runOpt: () => { ranWith = restartsRef.current; }, stopOpt: noop }, focused);
        assert.equal(ranWith, 5, 'Refinement: F5 runs with the restarts typed into the focused box');
    }
}

// ── 2. Variator preview ──────────────────────────────────────────────────────
{
    const { PreviewToolbar } = await import('../src/components/windows/optimization/variator/PreviewToolbar.js');
    const noop = () => {};
    const params = { lambdaStart: 400, lambdaEnd: 700, theta: 0 };
    const props = {
        c, t, v: t.variator, design: { meritOperands: [], surfaceMode: 'front_only', mfEvalMode: 'side' },
        params, showTargets: false, setShowTargets: noop, showBaseline: false, setShowBaseline: noop,
    };
    // setParams takes an updater; what the window keeps is the updater applied.
    const kept = (pick, text) => received(PreviewToolbar, props, 'setParams', pick, f => f.type(text).leave())
        .values.map(update => update(params));
    const [start, end, angle] = [0, 1, 2].map(at => inputs => inputs[at]);
    assert.equal(kept(start, '94,2')[0]?.lambdaStart, 94.2, 'Variator: wavelength start 94,2 is 94.2');
    assert.equal(kept(end, '94,2')[0]?.lambdaEnd, 94.2, 'Variator: wavelength end 94,2 is 94.2');
    assert.equal(kept(angle, '44,5')[0]?.theta, 44.5, 'Variator: angle 44,5 is 44.5');
    assert.equal(kept(angle, '95')[0]?.theta, 89, 'Variator: an angle past 89 is held at 89');
}

// ── 3. Needle Manual ─────────────────────────────────────────────────────────
{
    const { LeftSidebar } = await import('../src/components/windows/optimization/needleManual/LeftSidebar.js');
    const { PreviewPanel } = await import('../src/components/windows/optimization/needleManual/PreviewPanel.js');
    const noop = () => {};
    const sidebar = {
        catalogs: [], selectedCats: new Set(), excludedMats: new Set(),
        onToggleCat: noop, onSelectAllCats: noop, onClearCats: noop, onToggleMat: noop, operands: [],
        deltaNm: 0.5, dMin: 1, nIntra: 16, refineAfter: true, dlsIter: 60,
        onDeltaNm: noop, onDMin: noop, onNIntra: noop, onRefineAfter: noop, onDlsIter: noop,
        showSideRadio: false, requestedSide: 'front', onRequestedSide: noop, busy: false, c, t,
    };
    // The settings boxes in the order drawn, past the Refine after checkbox.
    const setting = at => inputs => inputs.filter(input => input.props.type !== 'checkbox')[at];
    const typed = (name, at, text) => received(LeftSidebar, sidebar, name, setting(at), f => f.type(text).leave());
    assert.deepEqual(typed('onDeltaNm', 0, '0,25').values, [0.25], 'Needle Manual: scan step 0,25 is 0.25');
    assert.deepEqual(typed('onDMin', 1, '2,5').values, [2.5], 'Needle Manual: minimum thickness 2,5 is 2.5');
    assert.deepEqual(typed('onDeltaNm', 0, '0,01').values, [0.05], 'Needle Manual: the scan step keeps its 0.05 floor');
    for (const [name, at, label] of [['onNIntra', 2, 'profile resolution'], ['onDlsIter', 3, 'refine iterations']]) {
        const { values, field } = typed(name, at, '42');
        assert.deepEqual(values, [42], `Needle Manual: ${label} takes a typed count`);
        assert.equal(field.input().props.type, 'text', `Needle Manual: ${label} is a text field`);
    }

    const design = { frontLayers: [], backLayers: [] };
    const preview = {
        selected: { materialId: 'builtin:SiO2', z: 120, intra: false }, hostInfo: { gapLabel: 'air' },
        dNew: 10, dRange: [1, 200], predictedOMF: null, omf0: null, evaluationBusy: false,
        onApply: noop, onStop: noop, busy: false, refining: false, design, c, t,
    };
    const thickness = inputs => inputs.find(input => input.props.type !== 'range');
    assert.deepEqual(received(PreviewPanel, preview, 'onDNew', thickness, f => f.type('94,2').leave()).values, [94.2],
        'Needle Manual: the inserted thickness 94,2 is 94.2');
}

// ── 4. Design Cleaner ────────────────────────────────────────────────────────
{
    const { CleanerControls, ReoptimizeSettings } = await import('../src/components/windows/optimization/designCleaner/CleanerControls.js');
    const noop = () => {};
    // The minimum thickness is on the row; the iteration box is in the
    // Settings menu with the method, drawn with Re-optimize on.
    const props = {
        c, dc: t.designCleaner, tr: t.refinement, units: t.units, settingsLabel: t.analysisChrome.settings, design: { meritOperands: [{}] },
        sideOffered: true, side: 'both', setSide: noop,
        dMin: 5, setDMin: noop, mergeAdjacent: true, setMergeAdjacent: noop,
        reoptimize: true, setReoptimize: noop, reoptIters: 80, setReoptIters: noop, reoptMethod: 'sqp', setReoptMethod: noop,
        applying: false, progress: null, ops: [], apply: noop, stop: noop, disabled: false,
    };
    const box = at => inputs => inputs.filter(input => input.props.type !== 'checkbox')[at];
    assert.deepEqual(received(CleanerControls, props, 'setDMin', box(0), f => f.type('2,5').leave()).values, [2.5],
        'Design Cleaner: minimum thickness 2,5 is 2.5');
    const { values, field } = received(ReoptimizeSettings, props, 'setReoptIters', box(0), f => f.type('120').leave());
    assert.deepEqual(values, [120], 'Design Cleaner: re-optimize iterations take a typed count');
    assert.equal(field.input().props.type, 'text', 'Design Cleaner: the iteration box is a text field');
}

// ── 5. Optimizer Benchmark ───────────────────────────────────────────────────
{
    const { RunBar } = await import('../src/components/windows/optimization/optimizerBenchmark/RunBar.js');
    const noop = () => {};
    const props = {
        c, budgetSec: 12, showSeeds: false, setShowSeeds: noop, showSummary: false, setShowSummary: noop,
        previewJobs: [], estimate: 0, copied: false, exportResults: noop, hasRun: false, clear: noop, run: noop, stop: noop,
    };
    const budget = inputs => inputs.find(input => input.props.type !== 'checkbox');
    assert.deepEqual(received(RunBar, props, 'setBudgetSec', budget, f => f.type('2,5').leave()).values, [2.5],
        'Optimizer Benchmark: a synthesis budget of 2,5 s is 2.5 s');
    assert.deepEqual(received(RunBar, props, 'setBudgetSec', budget, f => f.type('90').leave()).values, [60],
        'Optimizer Benchmark: the budget is held at 60 s');
}

// ── 6. Integral Values ───────────────────────────────────────────────────────
{
    const { CustomIntegralDialog } = await import('../src/components/windows/analysis/integralValues/CustomIntegralDialog.js');
    const draft = {
        key: null, char: 'T', source: { id: 'D65' }, detector: { id: 'photopic' },
        bandMin: 400, bandMax: 700, name: 'Band', named: true,
    };
    const drafts = [];
    const props = {
        c, t,
        model: {
            draft, setDraft: next => drafts.push(next), customDefs: [],
            openEditor() {}, closeCustom() {}, commitCustom() {},
        },
    };
    // The dialog's inputs are the name, then the band start and end.
    const [start, end] = [1, 2].map(at => inputs => inputs[at]);
    mount(CustomIntegralDialog, props, start).type('94,2').leave();
    mount(CustomIntegralDialog, props, end).type('1100,5').press('Enter');
    assert.deepEqual(drafts.map(next => [next.bandMin, next.bandMax]), [[94.2, 700], [400, 1100.5]],
        'Integral Values: band 94,2 to 1100,5 is 94.2 to 1100.5');
}

// ── 7. Optical Evaluation angle chips ────────────────────────────────────────
{
    const { AoiChips } = await import('../src/components/windows/analysis/opticalEvaluation/AoiChips.js');
    const oe = t.opticalEval;
    // The first node of a rendered tree that `test` accepts.
    const nodeWhere = (node, test) => {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) return node.map(child => nodeWhere(child, test)).find(Boolean) ?? null;
        if (test(node)) return node;
        return nodeWhere([node.props?.children].flat(Infinity), test);
    };
    const chips = values => {
        const changes = [];
        const field = mount(AoiChips, { values, onChange: next => changes.push(next), c, oe });
        const click = test => nodeWhere(field.render(), test).props.onClick();
        return { changes, field, click };
    };
    const addButton = node => node.type === 'button' && node.props.title === oe.addAoiTooltip(6, 89.9);
    const chipLabel = node => node.type === 'span' && node.props.title === oe.editAoiTooltip;

    {
        const { changes, field, click } = chips([10, 45]);
        click(addButton);
        assert.equal(field.input().props.type, 'text', 'Optical Evaluation: the add box is a text field');
        assert.equal(field.input().props.inputMode, 'decimal', 'Optical Evaluation: and brings up a decimal keypad');
        field.type('22,5').press('Enter');
        assert.deepEqual(changes, [[10, 45, 22.5]], 'Optical Evaluation: an added angle of 22,5 is 22.5');
    }
    {
        const { changes, field, click } = chips([10, 45]);
        click(addButton);
        field.type('22,5').press('Escape');
        assert.deepEqual(changes, [], 'Optical Evaluation: Escape in the add box adds nothing');
    }
    {
        const { changes, field, click } = chips([10, 45]);
        click(chipLabel);
        assert.equal(field.input().props.type, 'text', 'Optical Evaluation: an angle being edited is a text field');
        field.type('12,5').leave();
        assert.deepEqual(changes, [[12.5, 45]], 'Optical Evaluation: an angle edited to 12,5 is 12.5');
    }
    {
        const { changes, field, click } = chips([10, 45]);
        click(chipLabel);
        field.type('12,5').press('Escape');
        assert.deepEqual(changes, [], 'Optical Evaluation: Escape leaves the angle as it was');
        assert.equal(nodeWhere(field.render(), node => node.type === 'input'), null,
            'Optical Evaluation: and shows the chip again');
    }
    {
        const { changes, field, click } = chips([10, 45]);
        click(chipLabel);
        field.type('12abc').press('Enter');
        assert.deepEqual(changes, [], 'Optical Evaluation: an angle that is not a number is refused');
    }
    {
        const { changes, field, click } = chips([10, 45]);
        click(chipLabel);
        field.type('88,5').press('ArrowUp');
        assert.equal(field.shown, '89.5', 'Optical Evaluation: the up arrow steps an angle by 1');
        field.press('ArrowUp');
        assert.equal(field.shown, '89.9', 'Optical Evaluation: up to 89.9');
        field.press('ArrowDown').press('Enter');
        assert.deepEqual(changes, [[88.9, 45]], 'Optical Evaluation: and the down arrow back down');
    }
}

console.log('comma_decimal_optimization_and_analysis: passed');
