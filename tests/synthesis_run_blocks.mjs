/**
 * Run blocks for the synthesis windows (synthesisShared/runBlocks.js) and the
 * Needle actions built on them.
 *
 * A block is one press of Run. The behaviour it has to guarantee:
 *   • Reset undoes ONE run and leaves earlier runs and their rows alone, so
 *     pressing it again steps back another run.
 *   • Clear history forgets every run and does not touch the design.
 *   • The history table separates blocks, so rows from an earlier run cannot be
 *     read as part of the one on screen.
 *
 * The old model had one baseline taken at the first Run and one flat list, so a
 * Reset after a second run restored the design from before the FIRST run and
 * wiped both runs' rows. These assertions are what stops that coming back.
 *
 * Run: node tests/synthesis_run_blocks.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

// needleActions reaches the shared synthesis helpers, which pull in UI modules
// that read the global React the app loads as a vendor bundle.
shimBrowserGlobals();
const {
    activeRunNum, activeBaseline, openRunBlock, undoRunBlock,
    runSeparatorIds, runBlockSummary,
} = await import('../src/components/windows/optimization/synthesisShared/runBlocks.js');
const { performReset, clearRunHistory } =
    await import('../src/components/windows/optimization/needleVariation/needleActions.js');

const layers = (...d) => d.map((thickness, i) => ({ id: `L${i}`, material: 'SiO2', thickness }));
const design = (front) => ({ frontLayers: layers(...front), backLayers: [] });

// ── The model ───────────────────────────────────────────────────────────────
{
    assert.equal(activeRunNum([]), 0, 'no runs yet');
    assert.equal(activeBaseline([]), null, 'nothing to reset to before the first Run');

    const r1 = openRunBlock([], design([100]));
    assert.equal(activeRunNum(r1), 1);
    assert.deepEqual(activeBaseline(r1).frontLayers.map(l => l.thickness), [100]);

    const r2 = openRunBlock(r1, design([100, 200]));
    assert.equal(activeRunNum(r2), 2, 'each Run press opens the next block');
    assert.deepEqual(activeBaseline(r2).frontLayers.map(l => l.thickness), [100, 200],
        'the newest block holds the design that press started from');

    // The baseline is a copy: editing the design afterwards must not rewrite it.
    const live = design([100]);
    const r3 = openRunBlock([], live);
    live.frontLayers[0].thickness = 999;
    assert.equal(activeBaseline(r3).frontLayers[0].thickness, 100,
        'a block keeps its own copy of the baseline');
}

// ── Undo one run at a time ──────────────────────────────────────────────────
{
    let runs = openRunBlock([], design([100]));
    runs = openRunBlock(runs, design([100, 200]));
    const gens = [
        { id: 'a', runNum: 1, mf: 0.5 },
        { id: 'b', runNum: 1, mf: 0.4 },
        { id: 'c', runNum: 2, mf: 0.3 },
    ];

    const first = undoRunBlock(runs, gens);
    assert.equal(first.runNum, 2, 'Reset undoes the newest run');
    assert.deepEqual(first.gens.map(g => g.id), ['a', 'b'], 'the earlier run keeps its rows');
    assert.deepEqual(first.baseline.frontLayers.map(l => l.thickness), [100, 200],
        'and restores what THAT run started from, not the first run');

    const second = undoRunBlock(first.runs, first.gens);
    assert.equal(second.runNum, 1, 'pressing Reset again steps back another run');
    assert.deepEqual(second.gens, [], 'which drops the remaining rows');
    assert.deepEqual(second.baseline.frontLayers.map(l => l.thickness), [100]);

    assert.equal(undoRunBlock(second.runs, second.gens), null, 'nothing left to undo');
}

// ── Separators ──────────────────────────────────────────────────────────────
{
    // Rows arrive newest first, the order the table renders them in.
    const display = [
        { id: 'c', runNum: 2 }, { id: 'b', runNum: 1 }, { id: 'a', runNum: 1 },
    ];
    assert.deepEqual([...runSeparatorIds(display)], ['c', 'b'],
        'one separator above the newest row of each block');

    const legacy = [{ id: 'x' }, { id: 'y' }];
    assert.equal(runSeparatorIds(legacy).size, 0,
        'rows recorded before run blocks existed read as one block');

    const runs = openRunBlock([], design([100, 200]));
    const summary = runBlockSummary(runs, [{ id: 'a', runNum: 1, mf: 0.4 }], 1);
    assert.equal(summary.count, 1);
    assert.equal(summary.bestMF, 0.4);
    assert.equal(summary.startLayers, 2);
}

// ── The Needle actions on top of the model ──────────────────────────────────
function makeCtx(startFront) {
    const applied = [];
    const ref = (v) => ({ current: v });
    const noop = () => {};
    const ctx = {
        stopOpt: noop, dlsRef: ref(null),
        savedDesignRef: ref(null), baseDesignRef: ref(null),
        designRef: ref({ id: 'D', ...design(startFront), surfaceMode: 'front_only' }),
        gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
        runsRef: ref([]), runOpenRef: ref(false),
        setGenerations: noop, setTopDesigns: noop, setMf: noop, setMfBest: noop,
        setOmf: noop, setOmfBest: noop, setGeneration: noop, setLayerCount: noop,
        setCanReset: (v) => { ctx.canReset = v; },
        setStatusMsg: noop,
        t: { needle: { runSeparator: (n) => `Run ${n}` } },
        canReset: false,
    };
    const updateDesign = (patch) => {
        applied.push(patch);
        Object.assign(ctx.designRef.current, patch);
    };
    return { ctx, updateDesign, applied };
}

{
    const { ctx, updateDesign } = makeCtx([100]);
    // Run 1 from a 1-layer design, producing two generations.
    ctx.runsRef.current = openRunBlock(ctx.runsRef.current, ctx.designRef.current);
    ctx.gensRef.current = [
        { id: 'a', runNum: 1, genNum: 1, mf: 0.5, layerCount: 2, frontSnap: layers(90, 60), backSnap: [] },
        { id: 'b', runNum: 1, genNum: 2, mf: 0.4, layerCount: 3, frontSnap: layers(90, 60, 30), backSnap: [] },
    ];
    Object.assign(ctx.designRef.current, design([90, 60, 30]));

    // Run 2 from what run 1 produced, one more generation.
    ctx.runsRef.current = openRunBlock(ctx.runsRef.current, ctx.designRef.current);
    ctx.gensRef.current = [...ctx.gensRef.current,
        { id: 'c', runNum: 2, genNum: 3, mf: 0.2, layerCount: 4, frontSnap: layers(88, 58, 28, 20), backSnap: [] }];
    Object.assign(ctx.designRef.current, design([88, 58, 28, 20]));

    performReset(ctx, updateDesign);
    assert.deepEqual(ctx.designRef.current.frontLayers.map(l => l.thickness), [90, 60, 30],
        'Reset restores what the SECOND run started from');
    assert.deepEqual(ctx.gensRef.current.map(g => g.id), ['a', 'b'],
        'and drops only the second run\'s rows');
    assert.equal(ctx.runsRef.current.length, 1, 'the first run block is still there');
    assert.equal(ctx.canReset, true, 'so Reset is still available');

    performReset(ctx, updateDesign);
    assert.deepEqual(ctx.designRef.current.frontLayers.map(l => l.thickness), [100],
        'a second Reset steps back to the design before the first run');
    assert.deepEqual(ctx.gensRef.current, [], 'and clears the remaining rows');
    assert.equal(ctx.canReset, false, 'with nothing left to undo');
}

{
    const { ctx, updateDesign, applied } = makeCtx([100]);
    ctx.runsRef.current = openRunBlock(ctx.runsRef.current, ctx.designRef.current);
    ctx.gensRef.current = [{ id: 'a', runNum: 1, genNum: 1, mf: 0.4, layerCount: 3, frontSnap: layers(90, 60, 30), backSnap: [] }];
    Object.assign(ctx.designRef.current, design([90, 60, 30]));

    clearRunHistory(ctx);
    assert.deepEqual(applied, [], 'Clear history writes nothing to the design');
    assert.deepEqual(ctx.designRef.current.frontLayers.map(l => l.thickness), [90, 60, 30],
        'so the synthesis result is kept');
    assert.deepEqual(ctx.gensRef.current, [], 'the rows are gone');
    assert.deepEqual(ctx.runsRef.current, [], 'and so are the blocks');
    assert.equal(ctx.canReset, false, 'Reset has nothing to undo afterwards');
}

console.log('Synthesis run blocks passed.');
