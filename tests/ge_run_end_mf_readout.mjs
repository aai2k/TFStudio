/**
 * A Gradual Evolution run that ends on its own shows the MF of the design it
 * ends on.
 *
 * The run ends on its best design and the window shows that design and its
 * layer count. The MF readout used to keep the last merit a worker previewed
 * while the Best readout showed the lowest one, so the two disagreed at the end
 * of a run. Needle and the Structural Optimizer set the MF from the run's result.
 *
 *   1. After a run that ended on its own, the MF readout is the merit of the
 *      design the run ended on, which is the Best readout, and the OMF readout
 *      is the optical merit of that design.
 *
 * The run uses the real synthesis jobs on the fake window (_geWindow.mjs).
 *
 * Run: node tests/ge_run_end_mf_readout.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const ge = await import('./_geWindow.mjs');
const { startWindowRun } = await import('../src/components/windows/optimization/gradualEvolution/windowRun.js');

const same = (a, b) => a.length === b.length && a.every((l, i) => l.material === b[i].material && l.thickness === b[i].thickness);
const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ops = [makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const win = ge.makeWindow({
    design: {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [ge.layer('F1', 'TiO2', 30), ge.layer('F2', 'SiO2', 50)], backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    },
    ops, pool, maxLayers: 6, maxGeCycles: 3, dMin: 15, dlsIter: 10, targetMF: 1e-6, deepSearch: false,
}, 'run-end-mf');
ge.useWindow(win);

await ge.withWindowSettings({}, async () => {
    startWindowRun(win.ctx);
    await ge.settle(win);
});

assert.ok(win.shown.rows > 1, 'setup: the run recorded rows');
assert.equal(win.ctx.runningRef.current, false, 'setup: the run is over');
assert.equal(win.shown.mf, win.shown.mfBest, 'the MF readout is the merit of the design the run ended on, the Best readout');
const shownLayers = win.ctx.designRef.current;
const row = [...win.ctx.cyclesRef.current].reverse().find(r => same(r.frontSnap, shownLayers.frontLayers) && same(r.backSnap, shownLayers.backLayers));
assert.ok(row, 'setup: the design shown is a row of the history');
assert.equal(win.shown.omf, row.omf, 'the OMF readout is the optical merit of that design');

console.log('PASS ge_run_end_mf_readout');
process.exit(0);
