/**
 * Every Run press of the Structural Optimizer writes its refined starting
 * design as a history row.
 *
 * A press after the first used to refine its starting design, report it and
 * show it as the design the next Run goes on from, but add no row. A run that
 * then found nothing better left the screen on a design the history did not
 * hold, and Best and Restore put back a worse row.
 *
 *   1. The second press's first row is its starting design: kind 'baseline',
 *      generation 0 of its run block, with the merit reported with it.
 *   2. After a run that finds nothing better than its starting design, the
 *      design on screen is a row of the history.
 *   3. A Stop right after a run's first row and a Run after it leave one row of
 *      each generation in the block, not two rows 0.
 *
 * The run uses the real in-thread worker.
 *
 * Run: node tests/structural_baseline_row_each_press.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { startWindowRun } = await import('../src/components/windows/optimization/structuralOptimizer/windowRun.js');
const { makeWindow, useWindow, withWindowSettings } = await import('./_structuralWindow.mjs');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const win = makeWindow({
    worker: 'real',
    design: {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [layer('F1', 'TiO2', 90), layer('F2', 'SiO2', 110)], backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    },
    ops: [{ id: 'op', type: 'RAV', enabled: true, lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }],
    cfg: { maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120, maxLayers: 20, kinds: ['perturb'], deepMode: false, deepMaxMin: 0, seed: 7 },
    normalMf: [0.6, 0.5],
}, 'baseline-row');
useWindow(win);

const finish = async () => {
    const end = performance.now() + 5000;
    while (win.ctx.runningRef.current && performance.now() < end) await tick();
    for (let i = 0; i < 20; i++) await tick();
};
const sameLayers = (a, b) => a.length === b.length && a.every((l, i) => l.material === b[i].material && l.thickness === b[i].thickness);

await withWindowSettings({}, async () => {
    startWindowRun(win.ctx);
    await finish();
    const before = win.ctx.gensRef.current.length;
    assert.ok(before > 0, 'setup: the first press left rows');

    let start = null;
    const setLayerCount = win.ctx.setLayerCount;
    win.ctx.setLayerCount = value => {
        setLayerCount(value);
        if (!start && win.ctx.runningRef.current) {
            start = { mf: win.shown.mf, layers: JSON.parse(JSON.stringify(win.ctx.baseDesignRef.current.frontLayers)) };
        }
    };
    startWindowRun(win.ctx);
    await finish();
    assert.ok(start, 'setup: the second press reported its starting design');

    const rows = win.ctx.gensRef.current;
    const first = rows[before];
    assert.ok(first, 'the second press added rows');
    assert.equal(first.kind, 'baseline', 'its first row is its starting design');
    assert.equal(first.genNum, 0, 'generation 0 of its run block');
    assert.equal(first.runNum, 2, 'of the second block');
    assert.equal(first.mf, start.mf, 'with the merit reported with it');
    assert.ok(sameLayers(first.frontSnap, start.layers), 'and its layers');

    const shown = win.ctx.designRef.current.frontLayers;
    assert.ok(rows.some(row => sameLayers(row.frontSnap, shown)), 'the design on screen after the run is a row of the history');
});

// A Stop right after a run's first row, then Run: the block goes on, with the
// starting design of the second press as its next row and no second row 0.
const second = makeWindow({ ...win.spec, normalMf: [0.6, 0.5] }, 'baseline-row-open-block');
useWindow(second);
await withWindowSettings({}, async () => {
    const setGenerations = second.ctx.setGenerations;
    let stopped = false;
    second.ctx.setGenerations = list => {
        setGenerations(list);
        if (!stopped) { stopped = true; second.ctx.stopOpt(); }
    };
    startWindowRun(second.ctx);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(stopped && !second.ctx.runningRef.current, 'setup: the first press was stopped at its first row');
    second.ctx.setGenerations = setGenerations;
    startWindowRun(second.ctx);
    const end = performance.now() + 5000;
    while (second.ctx.runningRef.current && performance.now() < end) await tick();
    for (let i = 0; i < 20; i++) await tick();

    const rows = second.ctx.gensRef.current;
    const numbers = rows.map(row => `${row.runNum}:${row.genNum}`);
    assert.equal(new Set(numbers).size, numbers.length, `a run block has one row of each generation (${numbers})`);
    assert.equal(rows[0].genNum, 0, 'the block opens with generation 0');
});

console.log('Structural baseline row each press tests passed.');
process.exit(0);
