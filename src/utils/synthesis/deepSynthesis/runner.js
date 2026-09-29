// Runners of the Deep Synthesis jobs (jobs.js). A runner sends one job per
// item, so a pool balances the load, and returns the results in item order:
//   rung(ev, items, upto) -> Promise<Item[]>     race rungs, refinements
//   child(ev, items)      -> Promise<Result[]>   search children, comb growths
// The serial runner runs the same job messages in this thread, one after
// another, with a fresh material resolver per job, so a serial run and a pool
// run execute the same code on the same data.

import { makeResolveMat } from '../../workers/resolveMat.js';
import { JOB_TYPES, runDeepSynthesisJob } from './jobs.js';

// A job that did not come back: the pool was terminated by Stop, a worker
// failed, or the serial runner saw Stop. The run ends on the best design so
// far (index.js).
export class RunnerFailure extends Error {
    constructor(cause) {
        super(cause?.message ?? String(cause));
        this.name = 'RunnerFailure';
        this.cause = cause;
    }
}

// One job message per item; `upto` on rung jobs only.
function jobsFor(ev, type, items, upto) {
    const extra = upto === undefined ? {} : { upto };
    return items.map(item => ({ type, materials: ev.materials, spec: ev.spec, items: [item], ...extra }));
}

function makeRunner(runJobs, threads) {
    return {
        threads,
        rung: (ev, items, upto) => runJobs(jobsFor(ev, JOB_TYPES.rung, items, upto)),
        child: (ev, items) => runJobs(jobsFor(ev, JOB_TYPES.child, items)),
    };
}

const warn = m => console.warn(m.message);

// A turn of the event loop before each serial job, so a Stop pressed while the
// run holds this thread is seen at the next check.
const nextTurn = () => new Promise(resolve => (typeof setImmediate === 'function'
    ? setImmediate(resolve) : setTimeout(resolve, 0)));

const never = () => false;

async function passGate(gate) {
    try {
        await gate();
    } catch (err) {
        throw new RunnerFailure(err);
    }
}

// shouldStop: the caller's Stop, read before each job. A batch runs on this
// thread, so a Stop fails the rest of it as a terminated pool fails the jobs
// in flight, instead of waiting for the whole batch.
// gate: awaited before each batch, or null. The run worker asks the window
// for its turn there; a refusal fails the batch as a Stop does, so a serial
// run ends at the batch a pooled run would.
export function makeSerialRunner({ shouldStop = never, gate = null } = {}) {
    return makeRunner(async (jobs) => {
        if (gate) await passGate(gate);
        const out = [];
        for (const job of jobs) {
            await nextTurn();
            if (shouldStop()) throw new RunnerFailure(new Error('stopped'));
            const resolveMat = makeResolveMat(job.materials, 'deepSynthesis', warn);
            out.push(runDeepSynthesisJob(job, resolveMat).items[0]);
        }
        return out;
    }, 1);
}

// pool: a WorkerPool of synthesisWorker.js, or anything with the same map():
// map(jobs) resolving to the result messages { type: 'result', kind, items } in
// job order.
export function makePoolRunner(pool) {
    return makeRunner(async (jobs) => {
        let results;
        try {
            results = await pool.map(jobs);
        } catch (err) {
            throw new RunnerFailure(err);
        }
        return results.map(r => r.items[0]);
    }, pool.size ?? 1);
}
