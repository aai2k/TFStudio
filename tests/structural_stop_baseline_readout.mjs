/**
 * Structural Optimizer, Stop on a later Run press before the run finds a new
 * best: the readouts are the merit reported with the starting design.
 *
 * A press after the first has history rows already, so the run reports its
 * refined starting design, with its MF, OMF and layer count, without making it
 * a row. That design is the one the next Run goes on from and is on screen, but
 * no history row matches it. Stop then shows the values the run reported with
 * it, not empty readouts and not the last in-flight refine's.
 *
 * The run uses the real in-thread worker. The second press is stopped from the
 * first layer-count report, which comes with the starting design.
 *
 * Run: node tests/structural_stop_baseline_readout.mjs
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
}, 'baseline-readout');
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
    const rowsBefore = win.ctx.gensRef.current.length;
    assert.ok(rowsBefore > 0, 'setup: the first run left history rows');

    let reported = null;
    const setLayerCount = win.ctx.setLayerCount;
    win.ctx.setLayerCount = value => {
        setLayerCount(value);
        if (reported || !win.ctx.runningRef.current) return;
        reported = {
            mf: win.shown.mf, omf: win.shown.omf, layerCount: value,
            layers: JSON.parse(JSON.stringify(win.ctx.baseDesignRef.current.frontLayers)),
        };
        win.ctx.stopOpt();
    };
    startWindowRun(win.ctx);
    await finish();

    assert.ok(reported && reported.mf != null, 'setup: the second press reported its starting design with a merit');
    assert.ok(!win.ctx.gensRef.current.some(row => sameLayers(row.frontSnap, reported.layers)),
        'setup: no history row is the starting design');
    assert.equal(win.shown.mf, reported.mf, 'the MF readout is the one reported with the starting design');
    assert.equal(win.shown.omf, reported.omf, 'the OMF readout is the one reported with the starting design');
    assert.equal(win.shown.layerCount, reported.layerCount, 'the layer count is the one reported with it');
});

console.log('Structural stop baseline readout tests passed.');
process.exit(0);
