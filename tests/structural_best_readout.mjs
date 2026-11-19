/**
 * The Structural Optimizer's Best readout is the best merit in the history the
 * window shows, not the best of the run that is going: a run pressed after a
 * worse row was restored ends worse than the history's best, and the readout
 * keeps saying what the table highlights and Best applies.
 *
 * Run: node tests/structural_best_readout.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { startWindowRun } = await import('../src/components/windows/optimization/structuralOptimizer/windowRun.js');
const { makeWindow, useWindow, withWindowSettings } = await import('./_structuralWindow.mjs');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const SPEC = {
    design: {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [layer('F1', 'TiO2', 90), layer('F2', 'SiO2', 110)], backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    },
    ops: [{ id: 'op', type: 'RAV', enabled: true, lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }],
    cfg: { maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120, maxLayers: 20, kinds: ['perturb'], deepMode: false, deepMaxMin: 0, seed: 7 },
    normalMf: [0.6, 0.5],
};

const win = makeWindow(SPEC, 'best-readout');
useWindow(win);
// A row from an earlier run, better than anything this run reaches.
win.ctx.gensRef.current = [{
    id: 'earlier', genNum: 1, mf: 0.01, omf: 0.01, layerCount: 2, runNum: 1, kind: 'seed',
    layers: SPEC.design.frontLayers, frontSnap: SPEC.design.frontLayers, backSnap: [],
}];
const bests = [];
const record = win.ctx.setMfBest;
win.ctx.setMfBest = value => { bests.push(value); record(value); };

await withWindowSettings({}, async () => {
    win.press = {};
    startWindowRun(win.ctx);
    const end = performance.now() + 3000;
    while (win.ctx.runningRef.current && performance.now() < end) await tick();
    for (let i = 0; i < 20; i++) await tick();
});

assert.ok(bests.length > 0, 'the run shows a Best');
assert.ok(bests.every(value => value <= 0.01), `no Best shown is worse than the history's 0.01 (${bests.join(', ')})`);
console.log('PASS structural_best_readout');
process.exit(0);
