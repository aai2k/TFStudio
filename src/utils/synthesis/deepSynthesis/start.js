// The search's start (giga4.c run_alns 519-604): the coupled-cavity comb when
// the target has pass bands between stop bands, then gradual evolution from
// the comb's design or from nothing when the run starts from no design, or the
// given design refined; then, above the layer cap, one layer deleted at a time.
//
// Gradual evolution keeps the best design within the cap (keep_start), seeded
// with the comb's design, so its keep-patience stop counts the steps that did
// not improve on the comb (giga4.c 546-560).

import { newPart } from './evaluator.js';
import { makeKeeper, offer, push } from './trace.js';
import { combApplies, runComb } from './comb.js';
import { runGradualEvolution } from './gradualEvolution.js';
import { refineOnRunner, stopRequested } from './deepNeedle.js';

const noop = () => {};
const heldOf = keep => (keep && keep.layers ? { layers: keep.layers, mf: keep.mf } : null);
const emitPhase = (run, phase) => (run.onEvent ?? noop)({ type: 'phase', phase });

// run.best: the best design within the cap so far, what the run ends with
// when a runner job is rejected (index.js).
function offerBest(ev, run, d) {
    if (!d || d.layers.length > ev.maxLayers) return;
    if (d.mf < (run.best ? run.best.mf : Infinity)) run.best = { layers: d.layers, mf: d.mf };
}

// body() run with keep as the run's keeper, as the C swaps job->keep around the
// comb and gradual evolution (giga4.c 533-541, 566-575); the outer keeper is
// put back after. On the way out, also when a job is rejected (Stop terminates
// the pool), the keeper's design is offered to run.best, so the designs body
// recorded are not lost. A regrid replaces run.log.keep by a keeper rescored
// on the grid run.best was rescored on (geRun), so the two compare.
async function withKeeper(ev, run, keep, body) {
    const outer = run.log.keep;
    run.log.keep = keep;
    try {
        return await body();
    } finally {
        offerBest(ev, run, heldOf(run.log.keep));
        run.log.keep = outer;
    }
}

// The run as gradual evolution sees it: each step offers the kept design to
// run.best, and a regrid rescores run.best on the new grid, as gradual
// evolution rescores its keeper.
function geRun(ev, run) {
    const onEvent = e => {
        if (e.type === 'geStep') offerBest(ev, run, heldOf(run.log.keep));
        (run.onEvent ?? noop)(e);
    };
    const regrid = run.regrid && (layers => {
        const next = run.regrid(layers);
        if (next && run.best) run.best = { layers: run.best.layers, mf: next.mf(run.best.layers) };
        return next;
    });
    return { ...run, onEvent, regrid };
}

// giga4.c 525-544: the comb's best design within the cap, from a keeper of its
// own, offered to the run's keeper. { ev, comb, why }; comb null when the comb
// found nothing.
async function combPhase(ev, run) {
    const applies = combApplies(ev);
    if (!applies.on) return { ev, comb: null, why: applies.why };
    emitPhase(run, 'comb');
    const r = await withKeeper(ev, run, makeKeeper(ev.maxLayers), () => runComb(ev, run));
    const comb = r.kept && Number.isFinite(r.kept.mf) ? r.kept : null;
    if (comb) offer(run.log.keep, comb.mf, comb.layers);
    return { ev: r.ev, comb, why: r.why };
}

// giga4.c 563-589: gradual evolution from the comb's design, or from nothing,
// with its own keeper as the run's; x is the kept design, else its best, else
// the design it started from.
async function evolvePhase(ev, comb, opts, run) {
    emitPhase(run, 'ge');
    const from = comb ? comb.layers : [];
    const kept = makeKeeper(ev.maxLayers);
    if (comb) offer(kept, comb.mf, comb.layers);
    const g = await withKeeper(ev, run, kept, () => runGradualEvolution(ev, from, opts.ge, geRun(ev, run)));
    const x = heldOf(g.keep) ?? g.best ?? { layers: from, mf: g.ev.mf(from) };
    return { ev: g.ev, x, ge: { steps: g.steps, reason: g.reason } };
}

// giga4.c 590-594: the given design refined; gradual evolution does not run.
async function refinePhase(ev, start, run) {
    emitPhase(run, 'refine');
    const x = await refineOnRunner(ev, start, run);
    push(run.log.trace, x.mf, x.layers.length);
    return { ev, x, ge: null };
}

// giga4.c trim 384-404: every one-layer deletion refined (rung jobs), the best
// kept, ties to the upper layer, until the design is within the cap. Pushes
// each. A Stop leaves the design where it stands.
async function trim(ev, x, run) {
    let cur = x;
    while (cur.layers.length > ev.maxLayers && !stopRequested(run)) {
        const items = cur.layers.map((_, k) => ({ layers: cur.layers, prep: { kind: 'delete', k }, part: newPart() }));
        const out = await run.runner.rung(ev, items, ev.refineOpts.maxIter);
        let best = 0;
        for (let k = 1; k < out.length; k++) if (out[k].part.mf < out[best].part.mf) best = k;
        cur = { layers: out[best].layers, mf: out[best].part.mf };
        push(run.log.trace, cur.mf, cur.layers.length);
    }
    return cur;
}

// giga4.c run_alns 519-604. start: the Layers the run starts from ([] for no
// design). opts: { comb, ge } (index.js DEEP_SYNTHESIS_DEFAULTS). run: the run
// context; phases go to run.onEvent and run.best follows the best design
// within the cap. Returns the evaluator it ended with, x (the search's start,
// within the cap unless stopped), the comb's design (rescored on that
// evaluator) or null, growComb (evolution grew the comb's design), ge ({
// steps, reason } or null), trimmedFrom (the layer count before the trim, or
// null) and combWhy (why the comb did not run, or null).
export async function runStart(ev, start, opts, run) {
    push(run.log.trace, ev.mf(start), start.length);
    const c = opts.comb ? await combPhase(ev, run) : { ev, comb: null, why: null };
    const growComb = start.length === 0 && !!c.comb;
    const s = start.length === 0 ? await evolvePhase(c.ev, c.comb, opts, run) : await refinePhase(c.ev, start, run);
    const n0 = s.x.layers.length;
    if (n0 > s.ev.maxLayers && !stopRequested(run)) emitPhase(run, 'trim');
    const x = await trim(s.ev, s.x, run);
    offerBest(s.ev, run, x);
    const comb = c.comb && s.ev !== c.ev ? { layers: c.comb.layers, mf: s.ev.mf(c.comb.layers) } : c.comb;
    const trimmedFrom = x.layers.length < n0 ? n0 : null;
    return { ev: s.ev, x, comb, growComb, ge: s.ge, trimmedFrom, combWhy: c.why };
}
