/**
 * DLS multi-start inside a method list runs N perturbed starts: none of its
 * restarts is the unperturbed start design, which a list runs as its own entry.
 *
 * Run: node tests/list_multi_start_restarts.mjs
 */
import assert from 'node:assert/strict';
import { runMultiP } from '../src/utils/refinement/listMultiStart.js';

const posted = [];
class FakeWorker {
    postMessage(job) {
        posted.push(job.design);
        setTimeout(() => this.onmessage({ data: { type: 'done', iter: 3, mf: 0.1, mfBest: 0.1, frontLayers: job.design.frontLayers, backLayers: [], reason: 'stalled' } }), 0);
    }
    terminate() {}
}
const R = { plan: { threads: 2 }, makeWorker: () => new FakeWorker(), track: () => () => {}, onProgress() {} };
const payload = {
    surfaceMode: 'front_only',
    frontLayers: [{ id: 'a', material: 'TiO2', thickness: 100, locked: false }, { id: 'b', material: 'SiO2', thickness: 90, locked: false }],
    backLayers: [],
};
await runMultiP(R, { ops: [], payload, materials: {}, N: 3, pct: 30, alive: () => true, onProg: null, seed: 5 });

assert.equal(posted.length, 3, 'three restarts run');
const thicknesses = design => design.frontLayers.map(l => l.thickness).join(',');
for (const design of posted) assert.notEqual(thicknesses(design), thicknesses(payload), 'every restart is perturbed');
console.log('PASS list_multi_start_restarts');
