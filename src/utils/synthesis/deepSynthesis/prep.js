// Preparation of a raced item and the rung job that runs it (race.c rung_one
// 87-91). An item's prep is the move that makes its design: a forced step at
// its next minimum, a deep-needle candidate at its best thickness, a
// floor-thick pair or a layer deletion. It runs in the item's first rung job,
// right before the refinement, where the lab runs it in the par_for before the
// race (ge.c 268, needle.c 444 and 486); the refined results are the same and
// the line searches stay off the calling thread.

import { withoutLayer } from './design.js';
import { applyPair, insertOptimal, pairOpts } from './needleHelpers.js';
import { nextMinimum, placeStep, stepStart } from './steps.js';

// ge.c scan_step 216-222 and 278: the step at its next minimum (nextMinimum);
// null when there is none, or when it lies at zero thickness.
function prepareStep(ev, layers, step) {
    const min = nextMinimum(ev, layers, step, stepStart(ev, layers, step));
    return min && min.thickness > 0 ? placeStep(layers, step, min.thickness) : null;
}

// needle.c joint_candidate 399-404: a pair that would pass the layer cap is not
// tried.
function preparePair(ev, layers, { cand, spacerNm }) {
    const out = applyPair(layers, cand, spacerNm, pairOpts(ev));
    return out && out.length <= ev.maxLayers ? out : null;
}

// The preparation of each prep kind.
const PREPARE = {
    step: (ev, layers, prep) => prepareStep(ev, layers, prep.step),
    needle: (ev, layers, prep) => insertOptimal(ev, layers, prep.cand, prep.mf0),
    pair: preparePair,
    delete: (ev, layers, prep) => withoutLayer(layers, prep.k),
};

// The design an item starts its refinement from, or null when its preparation
// fails. A deletion is never void: a joint deletion runs below the cap (the
// needle cycle stops at the cap first) and a trim deletion must run above it
// (needle.c joint_apply 380-385, giga4.c trim_one 376-382).
export function prepare(ev, layers, prep) {
    const make = Object.hasOwn(PREPARE, prep.kind) ? PREPARE[prep.kind] : null;
    if (!make) throw new Error(`prepare: unknown prep kind ${prep.kind}`);
    return make(ev, layers, prep);
}

// The body of a race-rung job: the item's preparation on its first rung, then
// its refinement up to `upto` iterations in all (evaluator refinePart). An item
// whose preparation fails comes back void and done with an infinite merit.
export function runRungItem(ev, item, upto) {
    if (item.part.iters > 0 || !item.prep) return ev.refinePart(item, upto);
    const layers = prepare(ev, item.layers, item.prep);
    if (!layers) return { ...item, prep: null, part: { ...item.part, void: true, done: true, mf: Infinity } };
    return ev.refinePart({ ...item, layers, prep: null }, upto);
}
