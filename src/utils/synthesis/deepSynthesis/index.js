// Deep Synthesis: the synthesis lab's giga4 method on TFStudio's merit and
// engines (synthesis-lab/src/giga4.c). The start (start.js: the comb, gradual
// evolution or the given design refined, the trim to the layer cap), then the
// search over the layer structure (search.js). Every random draw is made on
// this thread from run.rng and every refinement runs as a job on run.runner,
// so the result does not depend on the thread count.

import { REFINE_DEFAULTS } from './evaluator.js';
import { RACE } from './race.js';
import { GE } from './gradualEvolution.js';
import { stopRequested } from './deepNeedle.js';
import { deepSynthesisParts } from './capabilities.js';
import { runStart } from './start.js';
import { SEARCH, runSearch } from './search.js';
import { RunnerFailure } from './runner.js';

// The method's constants by part. comb, ge, search and race are read here
// (race goes to every race of the run as run.race). refine is read by the
// evaluator from its spec.refine; the window builds that from this section.
export const DEEP_SYNTHESIS_DEFAULTS = Object.freeze({
    comb: true, ge: GE, race: RACE, search: SEARCH, refine: REFINE_DEFAULTS,
});

const noop = () => {};

// What the window reports about the start: how it was made, its merit and
// layer count, the evolution's steps and reason, the comb's design, the trim.
function startSummary(start, st) {
    return {
        kind: start.length > 0 ? 'refined' : (st.growComb ? 'combGe' : 'ge'),
        mf: st.x.mf, n: st.x.layers.length,
        steps: st.ge ? st.ge.steps : 0, reason: st.ge ? st.ge.reason : null,
        comb: st.comb ? { mf: st.comb.mf, n: st.comb.layers.length } : null,
        trimmedFrom: st.trimmedFrom,
    };
}

// The comb applies to the target but no cavity period fits it.
function partsAfterStart(parts, st) {
    if (st.combWhy !== 'noPeriod') return parts;
    return { ...parts, comb: { ...parts.comb, on: false, why: 'noPeriod' } };
}

function bestOf(run) {
    return run.best ? { layers: run.best.layers, mf: run.best.mf } : { layers: null, mf: Infinity };
}

// The start, then the search unless Stop came first. `out` gathers what the
// result reports as each phase ends, so a rejected job still returns it.
async function startAndSearch({ ev, start, o, run }, out) {
    const st = await runStart(ev, start, o, run);
    out.start = startSummary(start, st);
    out.parts = partsAfterStart(out.parts, st);
    if (stopRequested(run)) return;
    (run.onEvent ?? noop)({ type: 'phase', phase: 'search' });
    out.search = (await runSearch(st.ev, st, o.search, run)).stats;
}

// ev: the run's evaluator (evaluator.js). start: the Layers the run starts
// from ([] for no design). opts: DEEP_SYNTHESIS_DEFAULTS with any section
// replaced. run: { runner, log, shouldStop, onEvent, rng, regrid, best };
// run.race is set here from opts.race.
// Resolves to the best design within ev.maxLayers ({ layers, mf }; layers
// null when there is none), stopped (a Stop, or a runner job rejected, e.g.
// by pool.terminate(); then the design is the best so far and `error` says
// why), the parts in use (capabilities.js), the start's summary, the
// search's statistics and the run's trace.
export async function runDeepSynthesis(ev, start, opts, run) {
    const o = { ...DEEP_SYNTHESIS_DEFAULTS, ...opts };
    run.race = o.race;
    const out = { parts: deepSynthesisParts(ev), start: null, search: null, trace: run.log.trace };
    try {
        await startAndSearch({ ev, start, o, run }, out);
        return { ...bestOf(run), stopped: stopRequested(run), ...out };
    } catch (err) {
        if (!(err instanceof RunnerFailure)) throw err;
        return { ...bestOf(run), stopped: true, error: err.message, ...out };
    }
}
