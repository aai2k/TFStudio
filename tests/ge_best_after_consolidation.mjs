/**
 * The Gradual Evolution window's best after a run whose consolidation ends
 * above the lowest merit the run passed through.
 *
 * Consolidation removes layers while the merit rises by no more than its
 * tolerance, so the design a run ends on can sit above an earlier row. That
 * design is the run's best: the Best readout, the history table's marker and
 * the Best button name it, at the end of the run and after the window
 * remounts.
 *
 *   1. At the end of the run the Best readout is the merit of the design the
 *      run ended on.
 *   2. A remount, a new window on the same design that reads the run back from
 *      the session cache, shows the same Best readout.
 *   3. The row the table marks and the Best button applies (bestRowOf) is the
 *      design the run ended on.
 *   4. After a second run that ends higher, the Best readout at its end is the
 *      one a remount shows: the lower of the two runs' designs.
 *
 * The workers give scripted answers (_geWindow.mjs), with a consolidation that
 * removes a layer and raises the merit.
 *
 * Run: node tests/ge_best_after_consolidation.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { startWindowRun } = await import('../src/components/windows/optimization/gradualEvolution/windowRun.js');
const helpers = await import('../src/components/windows/optimization/gradualEvolution/geStateHelpers.js');
const ge = await import('./_geWindow.mjs');

const same = (a, b) => a.length === b.length && a.every((l, i) => l.material === b[i].material && l.thickness === b[i].thickness);

// Each consolidation removes the last front layer and leaves the merit at the
// next of these values: above every row the scripted runs reach, and higher
// in the second run than in the first.
const RAISED = [0.47, 0.49];
let consolidations = 0;
const removePass = ({ front, back }) => {
    const mf = RAISED[consolidations++];
    const nf = front.slice(0, -1);
    return { removed: 1, mf, omf: mf, frontLayers: nf, backLayers: back, nLayers: nf.length + back.length, baseLayers: front.length + back.length, baseMf: mf - 0.01 };
};

const spec = {
    worker: 'scripted', answers: { removePass },
    design: {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [ge.layer('S', 'SiO2', 100)], backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    },
    ops: [makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
    pool: ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) })),
    maxLayers: 4, maxGeCycles: 5, targetMF: 1e-9, dlsIter: 5, dMin: 10, deepSearch: false,
};
const ID = 'best-after-consolidation';

const run = async (win) => {
    await ge.withWindowSettings({ consolidate: '1' }, async () => {
        startWindowRun(win.ctx);
        await ge.settle(win);
    });
};
// A fresh mount of the window on the design, as switching back to its tab does.
const remount = () => {
    const win = ge.makeWindow(spec, ID);
    helpers.restoreOrClearForDesign(win.ctx.designRef.current, { ...win.ctx, lastDesignId: { current: null } });
    return win;
};

const win = ge.makeWindow(spec, ID);
ge.useWindow(win);
await run(win);

const rows = win.ctx.cyclesRef.current;
const ended = rows[rows.length - 1];
assert.equal(win.ctx.runningRef.current, false, 'setup: the run is over');
assert.equal(ended.type, 'clean', 'setup: the run ended with a consolidation');
assert.equal(ended.mf, RAISED[0], 'setup: the consolidation left the merit it was given');
assert.ok(Math.min(...rows.map(r => r.mf)) < ended.mf, 'setup: an earlier row has a lower merit than the design the run ended on');
assert.ok(same(ended.frontSnap, win.ctx.designRef.current.frontLayers), 'setup: the design shown is the consolidated one');

// 1.
assert.equal(win.shown.mfBest, ended.mf, 'at the end of the run the Best readout is the merit of the design the run ended on');

// 2.
assert.equal(remount().shown.mfBest, win.shown.mfBest, 'a remount shows the Best readout the end of the run showed');

// 3.
const best = helpers.bestRowOf(rows);
assert.equal(best.mf, ended.mf, 'the row the table marks and the Best button applies has the merit of the design the run ended on');
assert.ok(same(best.frontSnap, ended.frontSnap), 'and its design');

// 4.
await run(win);
const second = win.ctx.cyclesRef.current.filter(r => r.runNum === 2);
assert.ok(second.length > 0 && second[second.length - 1].mf === RAISED[1], 'setup: the second run ended with its own consolidation');
assert.equal(win.shown.mfBest, RAISED[0], 'after a second run that ends higher, Best is the first run\'s design');
assert.equal(remount().shown.mfBest, win.shown.mfBest, 'and a remount shows the same');

console.log('PASS ge_best_after_consolidation');
process.exit(0);
