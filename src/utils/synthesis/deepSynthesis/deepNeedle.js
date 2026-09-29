// The deep needle cycle (needle.c needle_run 456-499 with deep=1,
// insert=optimal, race on) and its joint moves (joint_step 429-454).
//
// Trubetskov, Appl. Opt. 59, A75 (2020), pp. A76-A77: a needle at every local
// minimum of P along the depth, for every material, each design refined, and
// the lowest refined merit taken. The refinements of a step are raced by
// successive halving (race.js). Under a floor, when no needle gains, the
// joint moves are tried: a pair (two floor-thick layers around a spacer) at the
// best candidates of each material, and the deletion of each layer held at the
// floor.
//
// Preparations and refinements run as rung jobs on run.runner; the needle scan
// and every decision run here, in index order, so the result is the same for
// any thread count.

import { newPart } from './evaluator.js';
import { enough, record } from './trace.js';
import { raceRefine } from './race.js';
import { GAIN_TOL, HELD_TOL, MAX_CANDIDATES, SPACERS, scanWindow } from './needleHelpers.js';

export const DEEP = Object.freeze({ maxDeep: 64, pairM: 8 });   // needle.c 108 max_deep, 111 pair_m

const never = () => false;

// Stop, as the orchestrators poll it between jobs.
export const stopRequested = run => (run.shouldStop ?? never)();

// One refinement to the end on the runner (needle.c 461, refine_clean).
export async function refineOnRunner(ev, layers, run) {
    const [out] = await run.runner.rung(ev, [{ layers, prep: null, part: newPart() }], ev.refineOpts.maxIter);
    return { layers: out.layers, mf: out.part.mf };
}

// Items prepared and refined by the race on the runner (race.c race_refine);
// reject(layers, mf) turns down a design whose refinement has ended. The
// race's settings are run.race over race.js's RACE (index.js sets run.race).
export function raceOnRunner(ev, preps, { layers, reject = null }, run) {
    const items = preps.map(prep => ({ layers, prep, part: newPart() }));
    const runRung = (its, upto) => run.runner.rung(ev, its, upto);
    const shouldStop = () => stopRequested(run);
    return raceRefine(items, { ...run.race, runRung, maxIter: ev.refineOpts.maxIter, reject, shouldStop });
}

// needle.c 488-491 and 446-449: the lowest standing merit, ties to the lower
// index; null when it does not lower mf by more than GAIN_TOL.
function bestGain(raced, mf) {
    let best = { mf: Infinity };
    for (const it of raced) if (it.mf < best.mf) best = it;
    return best.mf < mf * (1 - GAIN_TOL) ? { layers: best.layers, mf: best.mf } : null;
}

// needle.c joint_step 436-439: a pair per spacer at the first DEEP.pairM
// candidates of each material, spacers in floors.
function pairPreps(ev, cands) {
    const per = new Map();
    return cands.flatMap(cand => {
        const seen = per.get(cand.material) ?? 0;
        per.set(cand.material, seen + 1);
        return seen < DEEP.pairM ? SPACERS.map(s => ({ kind: 'pair', cand, spacerNm: s * ev.floor })) : [];
    });
}

// needle.c joint_step 431-441: the pairs (none on an empty design, which has
// no spacer material), then a deletion of every layer held at the floor.
function jointPreps(ev, layers, cands) {
    const limit = ev.floor * (1 + HELD_TOL);
    const deletions = [];
    layers.forEach((l, k) => { if (l.thickness <= limit) deletions.push({ kind: 'delete', k }); });
    return (layers.length > 0 ? pairPreps(ev, cands) : []).concat(deletions);
}

// needle.c joint_step 429-454: the joint moves from cur ({ layers, mf }) raced;
// the best refined design when it lowers cur.mf, else null.
export async function jointStep(ev, cur, cands, run) {
    const preps = jointPreps(ev, cur.layers, cands);
    if (preps.length === 0) return null;
    return bestGain(await raceOnRunner(ev, preps, { layers: cur.layers }, run), cur.mf);
}

// needle.c 470-492: every candidate at its best thickness, raced; the best
// when it gains, else null.
async function deepStep(ev, cur, cands, run) {
    const preps = cands.map(cand => ({ kind: 'needle', cand, mf0: cur.mf }));
    return bestGain(await raceOnRunner(ev, preps, { layers: cur.layers }, run), cur.mf);
}

// needle.c 466-468; Stop stands in for the time limit.
function cycleStop(ev, layers, run) {
    if (layers.length >= ev.maxLayers) return 'maxLayers';
    if (stopRequested(run)) return 'stopped';
    return enough(run.log.trace, ev.targetMf) ? 'enough' : null;
}

// needle.c 473-495: the next design of the cycle, or a reason to end it. With
// pairs and a floor, the joint moves when no needle gains or none exists.
async function nextDesign(ev, cur, pairs, run) {
    const cands = scanWindow(ev, cur.layers, { minima: true, max: Math.min(DEEP.maxDeep, MAX_CANDIDATES) });
    const moved = cands.length > 0 ? await deepStep(ev, cur, cands, run) : null;
    const next = moved ?? (pairs && ev.floor > 0 ? await jointStep(ev, cur, cands, run) : null);
    if (next) return { next };
    if (stopRequested(run)) return { reason: 'stopped' };
    return { reason: cands.length > 0 ? 'noGain' : 'optimal' };
}

// needle.c needle_run 456-499 (deep=1, insert=optimal, race on): refine, then
// deep steps until one of the stops. Records every design it holds to
// run.log. opts: { pairs }. Returns the evaluator it ran with, the design, its
// merit, the reason ('maxLayers' | 'stopped' | 'enough' | 'optimal' |
// 'noGain') and the number of moves taken.
export async function deepNeedleCycle(ev, layers, { pairs }, run) {
    let cur = await refineOnRunner(ev, layers, run);
    record(run.log, cur.mf, cur.layers);
    for (let insertions = 0; ; insertions++) {
        const stop = cycleStop(ev, cur.layers, run);
        if (stop) return { ev, ...cur, reason: stop, insertions };
        const { next, reason } = await nextDesign(ev, cur, pairs, run);
        if (!next) return { ev, ...cur, reason, insertions };
        cur = next;
        record(run.log, cur.mf, cur.layers);
    }
}
