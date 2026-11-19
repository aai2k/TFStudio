/**
 * After Stop, the MF, OMF and layer-count readouts of Needle Automatic and
 * Gradual Evolution belong to the design the screen shows, the last one the run
 * accepted, not to the in-flight candidate a worker previewed last.
 *
 *   1. With an accepted row in the history, Stop shows that row's values.
 *   2. With no row of that design, even when the history has rows of others (a
 *      Restore or an edit sent the run elsewhere), Stop empties the MF and OMF
 *      readouts and shows the layer count of the design the run started from.
 *
 * Each window runs on its fake window (_needleWindow.mjs, _geWindow.mjs) with a
 * pool whose workers wait, so a preview can be sent and the run stopped.
 *
 * Run: node tests/synthesis_stop_readouts.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const needle = await import('./_needleWindow.mjs');
const ge = await import('./_geWindow.mjs');
const { startWindowRun: startNeedle } = await import('../src/components/windows/optimization/needleVariation/windowRun.js');
const { startWindowRun: startGe } = await import('../src/components/windows/optimization/gradualEvolution/windowRun.js');

const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ops = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [needle.layer('S', 'SiO2', 100)], backLayers: [],
    surfaceMode: 'front_only', mfEvalMode: 'side',
};
const snap = layers => layers.map(({ material, thickness }) => ({ material, thickness }));
const row = { genNum: 1, mf: 0.25, omf: 0.2, layerCount: 3, runNum: 1, frontSnap: snap(design.frontLayers), backSnap: [] };
// A history row of another design: Restore or an edit left the run starting elsewhere.
const otherRow = { genNum: 2, mf: 0.75, omf: 0.7, layerCount: 5, runNum: 1, frontSnap: [{ material: 'TiO2', thickness: 33 }], backSnap: [] };

const windows = {
    'Needle Automatic': {
        make: () => needle.makeWindow({ design: { ...design, id: 'readouts' }, ops, pool, maxLayers: 6, deltaNm: 0.5, dMin: 1, dlsIter: 10, targetMF: 1e-4 }),
        start: startNeedle, rows: win => win.ctx.gensRef, waitingPool: needle.makeWaitingPool, withSettings: needle.withWindowSettings,
        storage: { smartSeed: '1' },
    },
    'Gradual Evolution': {
        make: () => {
            const win = ge.makeWindow({ design, ops, pool, maxLayers: 6, maxGeCycles: 3, dMin: 15, dlsIter: 10, targetMF: 1e-4, deepSearch: false }, 'readouts');
            ge.useWindow(win);
            return win;
        },
        start: startGe, rows: win => win.ctx.cyclesRef, waitingPool: ge.makeWaitingPool, withSettings: ge.withWindowSettings,
        storage: {},
    },
};

for (const [name, w] of Object.entries(windows)) {
    for (const history of ['the design shown', 'another design', 'none']) {
        const withRow = history === 'the design shown';
        const win = w.make();
        const pools = [];
        win.ctx.makeWorkerPool = () => { const p = w.waitingPool(); pools.push(p); return p; };
        await w.withSettings(w.storage, async () => {
            const run = w.start(win.ctx);
            if (history !== 'none') w.rows(win).current = history === 'the design shown' ? [otherRow, row] : [otherRow];
            pools[0].tick(9.9);
            assert.equal(win.shown.mf, 9.9, `${name}: setup, the candidate's MF is on show`);

            win.ctx.stopOpt('');
            const label = `${name}, with history of ${history}`;
            if (withRow) {
                assert.equal(win.shown.mf, row.mf, `${label}: the MF readout is the accepted row's`);
                assert.equal(win.shown.omf, row.omf, `${label}: the OMF readout is the accepted row's`);
                assert.equal(win.shown.layerCount, row.layerCount, `${label}: the layer count is the accepted row's`);
            } else {
                assert.equal(win.shown.mf, null, `${label}: no candidate MF is left on show`);
                assert.equal(win.shown.omf, null, `${label}: no candidate OMF is left on show`);
                assert.equal(win.shown.layerCount, design.frontLayers.length, `${label}: the layer count is the start design's`);
            }
            for (const p of pools) p.terminate();
            await run.catch(() => {});
        });
    }
}

console.log('Synthesis stop readouts tests passed.');
process.exit(0);
