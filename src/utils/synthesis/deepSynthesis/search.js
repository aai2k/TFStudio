// The search over the layer structure (giga4.c run_alns 605-976, one chain):
// rounds of children drawn from the incumbent, each a destroy and a repair
// (moves.js), accepted by record-to-record travel against the chain's record
// with a deviation that falls over the run, and operator weights adapted to
// the scores the children earn (Ropke and Pisinger, Transp. Sci. 40, 455
// (2006); Dueck, J. Comput. Phys. 104, 86 (1993)).
//
// On top of that (giga4.c 1-11, 96-119, 800-882): a chain whose round of
// children from an incumbent worse than its record accepts nothing goes back
// to the record, and a design it went back from is no move afterwards; after
// `stale` rounds from one incumbent with nothing accepted, the chain accepts by
// the starting deviation; a child whose destroyed design, repair and window
// were already run is not run again (the memo).
//
// Moves are drawn and destroyed on this thread, the children run on
// run.runner, and every decision is made on this thread in child order once
// the round is back, so the result is the same for any thread count.
//
// The children's memo and runs are in searchChildren.js, the acceptance rule
// and the operator weights in searchAcceptance.js.

import { floorHeld } from './needleHelpers.js';
import { passIndices, targetPoints } from './points.js';
import { stopRequested } from './deepNeedle.js';
import { DESTROYS, REPAIRS, drawMove, dropLayers } from './moves.js';
import { destroyRound, keepResults, resolveRepeats, runChildren, traceChildren } from './searchChildren.js';
import { held, judgeRound, perOperator, reweigh } from './searchAcceptance.js';

export { memoKey, memoFind } from './searchChildren.js';
export { judgeRound } from './searchAcceptance.js';

export const SEARCH = Object.freeze({
    rounds: 60,        // giga4.c 32
    children: 10,      // giga4.c 498
    rrt: 0.1,          // giga4.c 33: starting deviation, relative to the record's MF
    segment: 5,        // giga4.c 501: rounds between weight updates
    stall: 8,          // giga4.c 30: rounds without a new best before the stop
    combStall: 0,      // giga4.c 36: no stall stop when the search starts from the comb or grew from it
    stale: 2,          // giga4.c 39: rounds from one incumbent, none accepted, before rrt applies again
    scoreBest: 33, scoreBetter: 9, scoreAccepted: 13, react: 0.1,   // giga4.c 517
});

const noop = () => {};

// ── State ────────────────────────────────────────────────────────────────────

function pointsOf(ev) {
    const { points } = targetPoints(ev);
    return { points, pass: passIndices(points) };
}

// giga4.c 644-671 with one chain: the chain starts from the comb's design when
// it is better than x; a start from the comb, or grown from it, takes the
// comb's stall. start: { x, comb, growComb } (start.js).
export function searchState(ev, { x, comb, growComb }, opts = {}) {
    const o = { ...SEARCH, ...opts };
    const fromComb = !!comb && comb.mf < x.mf;
    const inc = held(fromComb ? comb : x);
    return {
        ev, o, ...pointsOf(ev), stall: fromComb || growComb ? o.combStall : o.stall,
        inc, rec: inc, best: inc, atRec: true, rrec: 0, stay: 0, gone: [], memo: [],
        weights: perOperator(1), score: perOperator(0), uses: perOperator(0), newBests: perOperator(0),
        round: 0, since: 0, rb: 0, accepted: 0, restarted: 0, returned: 0, repeats: 0, stalled: false,
    };
}

// giga4.c 677-679 (the time limit is Stop here): 'target', 'stopped',
// 'stalled' or null.
function stopReason(s, run) {
    if (s.best.mf <= s.ev.targetMf) return 'target';
    if (stopRequested(run)) return 'stopped';
    const { stall, since, rb } = s;
    return stall > 0 && since >= stall && 2 * since >= rb ? 'stalled' : null;
}

// TFStudio only, no lab counterpart: run.regrid may hand an evaluator on a
// denser grid for the incumbent (runGrid.js); everything the search compares
// against is rescored on it and the memo emptied, since its merits came from
// the old grid.
function regrid(s, run) {
    const next = run.regrid ? run.regrid(s.inc.layers) : null;
    if (!next) return;
    const rescore = d => ({ layers: d.layers, mf: next.mf(d.layers) });
    Object.assign(s, pointsOf(next), {
        ev: next, memo: [], gone: s.gone.map(rescore),
        inc: rescore(s.inc), rec: rescore(s.rec), best: rescore(s.best),
    });
    run.best = s.best;
}

// ── One round ────────────────────────────────────────────────────────────────

// giga4.c 680-731: the layers held at the floor and those that can drop a
// half wave, then `children` moves; the draws with no destroy allowed give none.
function drawRound(s, run) {
    const { ev, inc } = s;
    const bound = floorHeld(ev, inc.layers);
    const ctx = {
        ev, layers: inc.layers, bound, thick: dropLayers(ev, inc.layers, s.points, s.pass),
        points: s.points, pass: s.pass, weights: s.weights, okRepair: [true, ev.floor > 0, true],
    };
    const moves = [];
    for (let i = 0; i < s.o.children; i++) {
        const m = drawMove(run.rng, ctx);
        if (m) moves.push(m);
    }
    return { moves, bound };
}

// ── The run ──────────────────────────────────────────────────────────────────

function emitRound(s, run) {
    (run.onEvent ?? noop)({
        type: 'round', round: s.round + 1, incumbent: s.inc, record: s.rec, best: s.best,
        accepted: s.accepted, weights: { destroy: [...s.weights.destroy], repair: [...s.weights.repair] },
    });
}

function emitBest(s, run, move) {
    (run.onEvent ?? noop)({
        type: 'best', round: s.round + 1, layers: s.best.layers, mf: s.best.mf,
        destroy: DESTROYS[move.destroy], repair: REPAIRS[move.repair],
    });
}

// One round (giga4.c 680-945); false when no move could be drawn.
async function searchRound(s, run) {
    regrid(s, run);
    const drawn = drawRound(s, run);
    if (drawn.moves.length === 0) return false;
    const kids = destroyRound(s, drawn);
    await runChildren(s, run, kids);
    resolveRepeats(s, kids);
    keepResults(s, kids);
    traceChildren(run, kids);
    const results = kids.map(k => ({ move: k.move, layers: k.out.layers, mf: k.out.mf }));
    const { best, newBest } = judgeRound(s, results);
    if (newBest) {
        run.best = s.best;
        emitBest(s, run, results[best].move);
    }
    reweigh(s);
    emitRound(s, run);
    return true;
}

const named = (names, counts) => Object.fromEntries(names.map((name, i) => [name, counts[i]]));

// giga4.c 947-958.
function statsOf(s) {
    const { round, accepted, restarted, returned, repeats, stalled, since } = s;
    return {
        rounds: round, children: s.o.children, accepted, restarted, returned, repeats, stalled, since,
        newBests: { ...named(DESTROYS, s.newBests.destroy), ...named(REPAIRS, s.newBests.repair) },
        weights: { destroy: [...s.weights.destroy], repair: [...s.weights.repair] },
    };
}

// giga4.c run_alns 605-976 with one chain. start: { x, comb, growComb } from
// start.js, x within ev.maxLayers. opts: SEARCH's fields. run: { runner, log,
// shouldStop, onEvent, rng, regrid, best }; run.best is kept at the best
// design so far. Returns the evaluator it ended with, the best design within
// the cap and the run's statistics.
export async function runSearch(ev, start, opts, run) {
    const s = searchState(ev, start, opts);
    run.best = s.best;
    for (; s.round < s.o.rounds; s.round++) {
        const stop = stopReason(s, run);
        s.stalled = stop === 'stalled';
        if (stop || !(await searchRound(s, run))) break;
    }
    return { ev: s.ev, best: s.best, stats: statsOf(s) };
}
