// The two Deep Synthesis worker jobs, as synthesisWorker.js runs them and the
// serial runner runs them in-thread:
//   deepSynthesisRaceRung  items prepared on their first rung and refined up
//                          to `upto` iterations in all (prep.js runRungItem);
//   deepSynthesisChild     search children (moves.js runChild) and comb seed
//                          growths (comb.js growSeed).
// Each job builds its own evaluator from the tables it carries, so its result
// is a pure function of the message and no engine cache crosses jobs.

import { makeEvaluator } from './evaluator.js';
import { runRungItem } from './prep.js';
import { growSeed } from './comb.js';
import { runChild } from './moves.js';

export const JOB_TYPES = Object.freeze({ rung: 'deepSynthesisRaceRung', child: 'deepSynthesisChild' });

// A child item: 'carve' | 'pair' | 'refine' is a search child, 'grow' a comb seed.
export function runChildItem(ev, item) {
    return item.kind === 'grow' ? growSeed(ev, item.layers) : runChild(ev, item);
}

// job: { type, materials, spec, items, upto (rung jobs) }. Returns { items }
// with one result per item, in item order.
export function runDeepSynthesisJob(job, resolveMat) {
    const ev = makeEvaluator(job.spec, { materials: job.materials, resolveMat });
    if (job.type === JOB_TYPES.rung) return { items: job.items.map(item => runRungItem(ev, item, job.upto)) };
    if (job.type === JOB_TYPES.child) return { items: job.items.map(item => runChildItem(ev, item)) };
    throw new Error(`runDeepSynthesisJob: unknown job type ${job.type}`);
}
