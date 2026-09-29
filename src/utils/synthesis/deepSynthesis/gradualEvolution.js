// Gradual evolution (ge.c; Tikhonravov et al., SPIE 5250, 312 (2004), and
// Appl. Opt. 46, 704 (2007)): from no design, or from a given one, a forced
// step that grows the total optical thickness, then the deep needle cycle,
// until one of the stops. As giga4 runs it (giga4.c 480-491, 507): deep
// search, outer steps, joint moves once the steps stall, raced refinements,
// the cycle stop and the keep-patience stop.
//
// Each forced step is taken to its next minimum and refined (Trubetskov,
// Appl. Opt. 59, A75, 2020, p. A76), the refinements raced; a step refined
// back to where it started is out. The best step goes through the needle
// cycle; when the cycle takes the design back to the previous step's, the
// next-best step is tried, up to `retries`.

import { sameDesign } from './design.js';
import { enough, makeKeeper, offer } from './trace.js';
import { forcedSteps } from './steps.js';
import { deepNeedleCycle, raceOnRunner, stopRequested } from './deepNeedle.js';

// ge.c 97-98 (patience, retries), giga4.c 482-491 (outer, pairs, cycle from
// fast=1) and 507 with giga4.c 31 (keep_patience 4).
export const GE = Object.freeze({ outer: true, pairs: true, cycle: true, patience: 20, retries: 5, keepPatience: 4 });
export const BEST_TOL = 1e-9;   // ge.c 359 and 370: a new best merit is below the old * (1 - BEST_TOL)

const noop = () => {};

// ge.c by_merit 181-185: merit, then the order the steps were listed in.
const byMerit = (a, b) => ((a.mf > b.mf) - (a.mf < b.mf)) || a.idx - b.idx;

// ge.c forced_candidates 244-298 with deep search and race: every forced step
// at its next minimum and refined, raced; a step whose refinement ends on the
// design it started from (ge.c back_to_D 231-236) is out of the race and of
// the list. Returns every step as { step, idx, layers, mf }, the lowest
// refined merit first, ties in listed order, the ones out (mf Infinity) last.
export async function forcedCandidates(ev, layers, run, { outer = GE.outer } = {}) {
    const steps = forcedSteps(layers, ev.pool, { outer });
    const from = { layers, mf: ev.mf(layers) };
    const backToD = (R, mf) => sameDesign(ev.nRef, { layers: R, mf }, from);
    const preps = steps.map(step => ({ kind: 'step', step }));
    const raced = await raceOnRunner(ev, preps, { layers, reject: backToD }, run);
    const out = raced.map((it, idx) => {
        const back = Number.isFinite(it.mf) && backToD(it.layers, it.mf);
        return { step: steps[idx], idx, layers: it.layers, mf: back ? Infinity : it.mf };
    });
    return out.sort(byMerit);
}

function leadingFinite(cands) {
    const n = cands.findIndex(c => !Number.isFinite(c.mf));
    return n < 0 ? cands : cands.slice(0, n);
}

// ge.c 334-350: the needle cycle from the best steps, best first, until one
// does not come back to the previous step's design. { moved, saw } (saw: the
// stop rule held after the cycle) or { reason }.
async function tryCandidates(g, valid) {
    const pairs = g.o.pairs && g.sinceBest > 0;   // ge.c 337: joint moves only once the steps stall
    for (const c of valid.slice(0, g.o.retries)) {
        const r = await deepNeedleCycle(g.ev, c.layers, { pairs }, g.run);
        const saw = r.reason === 'enough' || enough(g.run.log.trace, g.ev.targetMf);
        const design = { layers: r.layers, mf: r.mf };
        if (!(g.prev && sameDesign(g.ev.nRef, design, g.prev))) return { moved: design, saw };
        if (r.reason === 'stopped' || saw) return { reason: r.reason === 'stopped' ? 'stopped' : 'enough' };
    }
    return { reason: 'undone' };
}

// ge.c 327-330: the forced steps, then the needle cycle from the best of them.
async function takeStep(g) {
    const cands = await forcedCandidates(g.ev, g.D, g.run, g.o);
    if (stopRequested(g.run)) return { reason: 'stopped' };
    const valid = leadingFinite(cands);
    return valid.length > 0 ? tryCandidates(g, valid) : { reason: 'noStep' };
}

// ge.c 359-368: a new best clears the cycle list; otherwise, with cycle, a
// design met since the last new best ends the run, and so does patience.
function bestOrStall(g, d) {
    if (d.mf < (g.best ? g.best.mf : Infinity) * (1 - BEST_TOL)) {
        g.best = d;
        g.sinceBest = 0;
        g.seen = [];
        return null;
    }
    if (g.o.cycle) {
        if (g.seen.some(s => sameDesign(g.ev.nRef, d, s))) return 'cycle';
        g.seen.push(d);
    }
    g.sinceBest++;
    return g.sinceBest >= g.o.patience ? 'stalled' : null;
}

// ge.c 369-372: keepPatience steps without a better design in run.log.keep.
function keptStop(g) {
    const keep = g.run.log.keep;
    if (!(g.o.keepPatience > 0 && keep)) return null;
    if (keep.mf < g.keptMf * (1 - BEST_TOL)) {
        g.keptMf = keep.mf;
        g.sinceKept = 0;
        return null;
    }
    g.sinceKept++;
    return g.sinceKept >= g.o.keepPatience ? 'kept' : null;
}

// ge.c 373-376 (max_tot is not ported).
function endStop(g, d, saw) {
    if (saw) return 'enough';
    if (d.mf <= g.ev.targetMf) return 'target';
    return d.layers.length >= g.ev.maxLayers ? 'maxLayers' : null;
}

// ge.c 351-376: the step taken, then the stops in the C's order.
function afterMove(g, { moved, saw }) {
    g.steps++;
    g.D = moved.layers;
    g.prev = moved;
    (g.run.onEvent ?? noop)({ type: 'geStep', step: g.steps, layers: moved.layers, mf: moved.mf, reason: null });
    return bestOrStall(g, moved) ?? keptStop(g) ?? endStop(g, moved, saw);
}

// A keeper holding the same design, its merit on the new evaluator's grid.
function rescoredKeeper(ev, keep) {
    if (!keep) return keep;
    const out = makeKeeper(keep.cap);
    if (keep.layers) offer(out, ev.mf(keep.layers), keep.layers);
    return out;
}

// TFStudio only, no lab counterpart: a synthesis run's band sample counts grow
// with the design (runGrid.js), so run.regrid may hand a new evaluator for the
// design about to be worked on. Everything compared against later is rescored
// on it, so merits from two grids are never compared; trace points already
// recorded stay.
function regrid(g) {
    const next = g.run.regrid ? g.run.regrid(g.D) : null;
    if (!next) return;
    const rescore = d => d && { layers: d.layers, mf: next.mf(d.layers) };
    g.ev = next;
    g.prev = rescore(g.prev);
    g.best = rescore(g.best);
    g.seen = g.seen.map(rescore);
    g.run.log.keep = rescoredKeeper(next, g.run.log.keep);
    if (Number.isFinite(g.keptMf)) g.keptMf = g.run.log.keep.mf;
}

// One pass of ge.c ge_run's loop: Stop, the regrid, the step and its stops.
// A reason ends the run; null goes on.
async function nextStep(g) {
    if (stopRequested(g.run)) return 'stopped';
    regrid(g);
    const step = await takeStep(g);
    return step.moved ? afterMove(g, step) : step.reason;
}

// ge.c ge_run 317-384. start: the Layers to grow ([] for no design). opts:
// GE's fields; the layer cap and the target are ev.maxLayers and ev.targetMf.
// run: { runner, log, shouldStop, onEvent, regrid }; the needle cycles record
// to run.log, and the keep-patience stop reads run.log.keep, which a regrid
// replaces by a rescored keeper (read the result's `keep`, not a keeper held
// from before the call).
// Returns the evaluator it ended with, the lowest-merit design of the run
// (null when no step was taken), the reason ('target' | 'maxLayers' |
// 'noStep' | 'undone' | 'stalled' | 'enough' | 'cycle' | 'kept' | 'stopped'),
// the number of steps and run.log.keep.
export async function runGradualEvolution(ev, start, opts, run) {
    const g = {
        ev, run, o: { ...GE, ...opts }, D: start, best: null, prev: null, seen: [],
        sinceBest: 0, sinceKept: 0, keptMf: Infinity, steps: 0,
    };
    let reason = null;
    while (!reason) reason = await nextStep(g);
    return { ev: g.ev, best: g.best, reason, steps: g.steps, keep: run.log.keep };
}
