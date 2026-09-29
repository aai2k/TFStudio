// Successive halving of candidate refinements (race.c race_refine 117-193;
// Jamieson and Talwalkar, AISTATS 2016, Algorithm 1). Every candidate is
// refined for `first` iterations; the best 1/eta, at least `keep`, go on to eta
// times the iterations in all and the rest are dropped; after `rungs` cuts the
// survivors are refined to the end. A candidate whose refinement ended early
// keeps its place with its final merit and costs nothing more. When no
// survivor stands (every one rejected), the dropped are refined to the end one
// at a time, the latest cut's best first, until one stands.
//
// A rung is one call of the injected runRung(items, upto) with the candidates
// still running, each an independent refinement job; the caller's runner may
// send them to workers in any order as long as it returns them in item order.
// Cuts are made afterwards on the calling thread, in index order, so the
// result is the same for any thread count.
//
// The verdict is the top-level `mf` of each returned item (race.c F[i]):
// finite for a design refined to the end and standing, Infinity for one
// dropped, rejected, void (its preparation failed) or cut short by a stop.
// `item.part.mf` stays the refinement's own merit where it stands.

// race.c race_options 65-76: first rung iterations, cut ratio, cuts, least kept.
export const RACE = Object.freeze({ first: 27, eta: 3, rungs: 2, keep: 1 });

const never = () => false;

// race.c race_options 67-74: the lab's lower bounds on each setting.
function raceOptions(opts) {
    const { runRung, maxIter, reject, shouldStop } = opts;
    if (typeof runRung !== 'function') throw new TypeError('raceRefine: runRung must be a function');
    if (!(maxIter >= 0)) throw new TypeError('raceRefine: maxIter must be a number >= 0');
    const int = (key, least) => Math.max(least, Math.floor(opts[key] ?? RACE[key]));
    return {
        runRung, maxIter, reject: reject ?? null, shouldStop: shouldStop ?? never,
        first: int('first', 1), eta: int('eta', 2), rungs: int('rungs', 0), keep: int('keep', 1),
    };
}

function newState(items) {
    return {
        items: items.slice(),
        mf: items.map(() => Infinity),
        alive: items.map((_, i) => i),
        spares: [],
    };
}

// race.c by_merit 95-99: merit, then index.
function byMerit(mf) {
    return (a, b) => ((mf[a] > mf[b]) - (mf[a] < mf[b])) || a - b;
}

function takeBatch(st, run, out) {
    if (!Array.isArray(out) || out.length !== run.length) {
        throw new Error(`raceRefine: runRung returned ${out?.length} items for ${run.length}`);
    }
    run.forEach((i, k) => { st.items[i] = out[k]; });
}

// race.c drop_rejected 105-115.
function dropRejected(st, reject) {
    if (!reject) return;
    st.alive = st.alive.filter(i => {
        const { layers, part } = st.items[i];
        if (!(part.done && reject(layers, part.mf))) return true;
        st.mf[i] = Infinity;
        return false;
    });
}

// race.c 131-135 (rung_one 87-91). A void item's preparation failed, so in the
// lab it never entered the race: it leaves without becoming a spare.
async function rung(st, o, upto) {
    const run = st.alive.filter(i => !st.items[i].part.done);
    if (run.length > 0) takeBatch(st, run, await o.runRung(run.map(i => st.items[i]), upto));
    st.alive = st.alive.filter(i => !st.items[i].part.void);
    for (const i of st.alive) st.mf[i] = st.items[i].part.mf;
    dropRejected(st, o.reject);
}

// race.c 137-161: the dropped go to the front of the spares, best first, so the
// latest cut's best is the first one revived.
function cut(st, o) {
    const ranked = st.alive.slice().sort(byMerit(st.mf));
    const keep = Math.min(Math.max(Math.ceil(ranked.length / o.eta), o.keep), ranked.length);
    const dropped = ranked.slice(keep);
    for (const i of dropped) st.mf[i] = Infinity;
    st.spares = dropped.concat(st.spares);
    st.alive = ranked.slice(0, keep).sort((a, b) => a - b);
}

// race.c 127-163. Returns true when stopped.
async function runRungs(st, o) {
    let budget = o.first;
    for (let g = 0; g <= o.rungs && st.alive.length > 0; g++) {
        if (o.shouldStop()) return true;
        const last = g === o.rungs;
        await rung(st, o, last || budget > o.maxIter ? o.maxIter : budget);
        if (last) break;
        cut(st, o);
        budget *= o.eta;
    }
    return false;
}

// race.c 181-191 (race_fix = 0). A spare whose refinement had ended is not run
// again: refine_part returns its merit as it stands (refine.c 573).
async function revive(st, o) {
    for (let s = 0; s < st.spares.length && st.alive.length === 0; s++) {
        if (o.shouldStop()) return;
        st.alive = [st.spares[s]];
        await rung(st, o, o.maxIter);
    }
}

// Only a design refined to the end can stand; after a stop that leaves the
// survivors whose refinement had already ended.
function verdict(st) {
    return st.items.map((item, i) => ({ ...item, mf: item.part.done ? st.mf[i] : Infinity }));
}

// items: Array<{ layers, prep, part }>, every one a candidate. opts: { runRung,
// maxIter, reject, shouldStop, first, eta, rungs, keep }; reject(layers, mf)
// turns down a design whose refinement has ended (ge.c back_to_D).
// Returns the items in input order, each with its verdict `mf`.
export async function raceRefine(items, opts) {
    const o = raceOptions(opts);
    const st = newState(items);
    if (!(await runRungs(st, o))) await revive(st, o);
    return verdict(st);
}
