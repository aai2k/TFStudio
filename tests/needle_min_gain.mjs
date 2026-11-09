/**
 * A Needle generation counts as an improvement only when it lowers the merit
 * by at least SYNTHESIS_MIN_GAIN of it.
 *
 * Without that floor the analytic scan always finds a needle with a negative
 * slope, its refinement lowers the merit by a few parts in a million, and the
 * run keeps adding layers that stay near the thickness floor until it hits the
 * layer limit. It then never reaches the needle-optimal state that starts its
 * thicker restart, which is what a thick filter such as a gain flattening
 * filter needs (needle/rescue.js).
 *
 * The accept step (needle/refine.js, refineBatches) is driven with a fake
 * worker pool that returns set merits for each candidate:
 *   1. a batch whose best gains less than the floor is not taken, the next
 *      batch is tried, and with none better the cycle ends unaccepted, which
 *      the run reads as needle-optimal;
 *   2. a batch whose best gains more than the floor is taken;
 *   3. a first batch below the floor and a second above it: the second is
 *      taken.
 *
 * Run: node tests/needle_min_gain.mjs
 */

import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { refineBatches } = await import('../src/utils/needle/refine.js');
const { SYNTHESIS_MIN_GAIN } = await import('../src/utils/synthesis/synthesisConfig.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const MF0 = 0.01;
const below = MF0 * (1 - SYNTHESIS_MIN_GAIN / 2);
const above = MF0 * (1 - SYNTHESIS_MIN_GAIN * 2);
const start = [{ id: 'h', material: 'H', thickness: 100, locked: false }];

// A run at merit MF0 whose pool answers the k-th candidate batch with
// batches[k], one merit per candidate, and finds no parked layers to drop.
function fakeRun(batches) {
    let batchesSent = 0;
    const run = {
        K: 2, maxBatches: batches.length, targetMF: 0, scanSides: ['front'],
        operands: [], materials: {}, dMin: 1, refineIter: 5, innerEngine: 'cg',
        best: { mf: MF0, omf: MF0, frontLayers: start, backLayers: [] },
        genNum: 0, prevBestMF: MF0, rows: [], runT0: performance.now(), markRescue: false, hooks: {},
        designSnap: (frontLayers, backLayers) => ({ frontLayers, backLayers }),
        deep: value => structuredClone(value), emit: () => {}, onTick: () => {},
        workerPool: {
            map: async jobs => {
                if (jobs[0].type === 'dropParked') return jobs.map(() => ({ removed: 0 }));
                const merits = batches[batchesSent++];
                return jobs.map((_, i) => ({
                    mfAfter: merits[i], omf: merits[i], backLayers: [],
                    frontLayers: [...start, { id: `n${i}`, material: 'L', thickness: 1.2, locked: false }],
                }));
            },
        },
    };
    return { run, sent: () => batchesSent };
}

const queue = [0, 1, 2, 3].map(pos => ({ pos, materialId: 'L', dMF: -1e-5 * (4 - pos), side: 'front' }));

{
    const { run, sent } = fakeRun([[below, MF0], [below, below]]);
    const out = await refineBatches(run, queue);
    ok(out.accepted === false, `1: a gain under the floor was accepted (${JSON.stringify(out)})`);
    ok(sent() === 2, `1: ${sent()} batches tried, not 2`);
    ok(run.best.mf === MF0 && run.genNum === 0, '1: the best changed on a gain under the floor');
}
{
    const { run, sent } = fakeRun([[above, below]]);
    const out = await refineBatches(run, queue);
    ok(out.accepted === true, `2: a gain over the floor was not accepted (${JSON.stringify(out)})`);
    ok(sent() === 1 && run.best.mf === above && run.genNum === 1, '2: the best is not the batch\'s best');
}
{
    const { run, sent } = fakeRun([[below, below], [above, below]]);
    const out = await refineBatches(run, queue);
    ok(out.accepted === true && sent() === 2, `3: the second batch was not taken (${JSON.stringify(out)}, ${sent()} sent)`);
    ok(run.best.mf === above, '3: the best is not the second batch\'s best');
}

if (fails === 0) {
    console.log(`PASS: Needle takes a generation only when it lowers the merit by ${SYNTHESIS_MIN_GAIN} of it or more.`);
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exitCode = 1;
}
