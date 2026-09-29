// Coupled-cavity comb seeds for targets with several pass bands (cavity.c),
// each refined at the floor and grown by the probe needle.
//
// A stack of equal periods of one thick cavity layer and one thin reflector
// layer is never an absentee, so it has a stop band at every order
//     m = 2 (n_c d_c cos t_c + n_r d_r cos t_r) / lambda
// and a pass band between each two (Macleod, Thin-Film Optical Filters, 5th
// ed., 2018, pp. 208-211 and 286-297). The comb is written down from the
// target (cavity.c 17-58):
//   1. It applies when every point of the optical merit is a pass point
//      (T = 1 or R = 0) or a stop point (T = 0 or R = 1), with at least two
//      runs of pass points between stop points in wavelength order.
//   2. Cavity and reflector are the pool's highest and lowest index materials,
//      each way round. The reflector is the floor thick, and twice the floor
//      while that does not pass a quarter wave at the middle of the target's
//      range; without a floor the first is a fifth of that quarter wave.
//   3. The cavity thickness maximizes the fit S(d_c) = sum w s cos(2 pi m) /
//      sum w, s = +1 at stop points and -1 at pass points, over the range where
//      the orders across the target spread by at least P - 1 and at most 2P
//      (P pass runs). The two best local maxima with S > 0 are kept.
//   4. Seeds: 4, 6 and 8 cavities with a reflector between each two, without
//      and with a reflector at each end.
//   5. Every seed is refined; seeds that refine to an earlier seed's design go.
//   6. Every remaining seed is grown by the probe needle up to the layer cap,
//      each run on its own trace so one seed's plateau does not stop another.
// Nothing here draws random numbers, so the result is the same on any number
// of threads.

import { sameDesign } from './design.js';
import { makeTrace, makeKeeper, offer, record, appendPoints } from './trace.js';
import { newPart } from './evaluator.js';
import { probeNeedleRun } from './needleHelpers.js';
import { targetPoints, passRuns, nCos } from './points.js';

export const COMB = Object.freeze({
    periods: 2,                           // cavity.c 287: best cavity thicknesses kept per cavity, reflector and thickness
    thickMult: Object.freeze([1, 2]),     // cavity.c 288: reflector at 1 and 2 floors
    cavities: Object.freeze([4, 6, 8]),   // cavity.c 289
    ends: Object.freeze([false, true]),   // cavity.c 302: without and with end reflectors
    stepsPerOrder: 64,                    // cavity.c 158: a scan step moves an order by 1/64 at most
    noFloorDivisor: 5,                    // cavity.c 295: without a floor the first reflector is a quarter wave / 5
    growTries: 10,                        // needle.c 103: candidates tried per scan with a floor
});

const TWO_PI = 2 * Math.PI;
const never = () => false;

// The entries of largest and smallest key, the first listed on ties.
function extremes(list, key) {
    let hi = list[0], lo = list[0];
    for (const x of list) {
        if (key(x) > key(hi)) hi = x;
        if (key(x) < key(lo)) lo = x;
    }
    return { hi, lo };
}

// ── Where the comb applies ───────────────────────────────────────────────────

function offReason(allPassStop, runs) {
    if (!allPassStop) return 'notPassStop';
    return runs < 2 ? 'passRuns' : null;
}

// cavity.c 270-271 and the header's step 1 (17-24). why: null when the comb
// runs, 'notPassStop' when some optical row or point is neither a pass nor a
// stop target, 'passRuns' with fewer than two pass runs.
export function combApplies(ev) {
    const { points, allPassStop } = targetPoints(ev);
    const runs = passRuns(points, allPassStop);
    const why = offReason(allPassStop, runs);
    return { on: why === null, why, passRuns: runs, points };
}

// ── Cavity thickness ─────────────────────────────────────────────────────────

// cavity.c comb_periods 147-153: per point, the cavity's order per nm of
// cavity (a, 1/nm), the reflector's order (b) and the signed weight, + at a
// stop point and - at a pass point.
function orderTerms(ev, points, { cavity, reflector, reflectorNm }) {
    return points.map(p => ({
        a: 2 * nCos(ev, cavity, p) / p.lam,
        b: 2 * nCos(ev, reflector, p) * reflectorNm / p.lam,
        ws: p.weight * (p.kind === 'stop' ? 1 : -1),
    }));
}

// cavity.c 164-172: the fit at cavity thickness d (nm), and whether the orders
// across the target spread by at least P - 1 and at most 2P.
function fitAt(terms, sumW, d, P) {
    let s = 0, mlo = Infinity, mhi = -Infinity;
    for (const t of terms) {
        const m = t.a * d + t.b;
        s += t.ws * Math.cos(TWO_PI * m);
        mlo = Math.min(mlo, m);
        mhi = Math.max(mhi, m);
    }
    const spread = mhi - mlo;
    return { S: s / sumW, inRange: spread >= P - 1 && spread <= 2 * P };
}

// cavity.c 175: a local maximum with S > 0 inside the spread range.
function isPeak(prev, cur, next) {
    return cur.inRange && cur.S > 0 && cur.S > prev.S && cur.S >= next.S;
}

// cavity.c 176-181: kept in order of S, ties to the thinner cavity, at most max.
function keepPeak(best, peak, max) {
    let k = best.findIndex(b => b.S < peak.S);
    if (k < 0) k = best.length;
    best.splice(k, 0, peak);
    if (best.length > max) best.length = max;
}

// cavity.c comb_periods 141-185: the COMB.periods cavity thicknesses (nm) of
// best fit, best first. The scan runs on d = (g + 1) h, h moving the fastest
// point's order by 1/64, up to where the orders of the fastest and slowest
// points alone differ by 2P. [] when every point has the same order per nm.
export function combPeriods(ev, points, { cavity, reflector, reflectorNm, passRuns: P }) {
    if (points.length === 0) return [];
    const terms = orderTerms(ev, points, { cavity, reflector, reflectorNm });
    const { hi, lo } = extremes(terms, t => t.a);
    if (!(hi.a > lo.a)) return [];
    const sumW = points.reduce((s, p) => s + p.weight, 0);
    const h = 1 / (COMB.stepsPerOrder * hi.a);
    const ng = Math.trunc((2 * P + lo.b - hi.b) / (hi.a - lo.a) / h) + 2;
    const at = g => fitAt(terms, sumW, (g + 1) * h, P);
    const best = [];
    let prev = at(0), cur = at(1);
    for (let g = 1; g + 1 < ng; g++) {
        const next = at(g + 1);
        if (isPeak(prev, cur, next)) keepPeak(best, { dc: (g + 1) * h, S: cur.S }, COMB.periods);
        prev = cur;
        cur = next;
    }
    return best;
}

// ── Seeds ────────────────────────────────────────────────────────────────────

// cavity.c 278-285: the grid wavelength nearest the middle of the points'
// range, the shorter on ties, nm.
function middleLambda(ev, points) {
    const { hi, lo } = extremes(points, p => p.lam);
    const mid = 0.5 * (lo.lam + hi.lam);
    let best = ev.lambdas[0];
    for (const lam of ev.lambdas) if (Math.abs(lam - mid) < Math.abs(best - mid)) best = lam;
    return best;
}

// cavity.c 294-296: the reflector thicknesses, nm. Past a quarter wave a
// thicker reflector reflects less, so a multiple beyond it is not tried; the
// first thickness always is.
function reflectorThicknesses(ev, reflector, lamMid) {
    const qw = lamMid / (4 * ev.n(reflector, lamMid));
    const t0 = ev.floor > 0 ? ev.floor : qw / COMB.noFloorDivisor;
    const out = [];
    for (let j = 0; j < COMB.thickMult.length && (j === 0 || t0 * COMB.thickMult[j] <= qw); j++) {
        out.push(t0 * COMB.thickMult[j]);
    }
    return out;
}

// cavity.c 301-303: every cavity count, without and with end reflectors.
function seedFamily(base) {
    return COMB.cavities.flatMap(count => COMB.ends.map(ends => ({ ...base, count, ends })));
}

// cavity.c 293-305 for one cavity and reflector; cavities thinner than the floor are skipped.
function sideSeeds(ev, ctx, cavity, reflector) {
    return reflectorThicknesses(ev, reflector, ctx.lamMid).flatMap(reflectorNm =>
        combPeriods(ev, ctx.points, { cavity, reflector, reflectorNm, passRuns: ctx.passRuns })
            .filter(({ dc }) => !(dc < ev.floor))
            .flatMap(({ dc }) => seedFamily({ cavity, reflector, reflectorNm, dc })));
}

// cavity.c 273-307: the seeds { cavity, reflector, count, ends, reflectorNm,
// dc } with cavity and reflector the pool's highest and lowest index at
// ev.lamRef. Order: high-index cavity first, reflector thickness, period
// (best fit first), cavity count, ends.
export function combSeeds(ev, points, passRuns) {
    if (points.length === 0 || ev.pool.length === 0) return [];
    const { hi, lo } = extremes(ev.pool, ev.nRef);
    const ctx = { points, passRuns, lamMid: middleLambda(ev, points) };
    return [...sideSeeds(ev, ctx, hi, lo), ...sideSeeds(ev, ctx, lo, hi)];
}

// cavity.c build_seed 129-137: `count` cavities with a reflector between each
// two and, with ends, one outside each end. Index 0 faces the incident medium.
export function buildSeed({ cavity, reflector, count, ends, reflectorNm, dc }) {
    const mirror = () => ({ material: reflector, thickness: reflectorNm });
    const layers = ends ? [mirror()] : [];
    for (let k = 0; k < count; k++) {
        if (k > 0) layers.push(mirror());
        layers.push({ material: cavity, thickness: dc });
    }
    if (ends) layers.push(mirror());
    return layers;
}

// ── Growth (worker body of a 'grow' child) ───────────────────────────────────

const heldOf = keep => (keep.layers ? { layers: keep.layers, mf: keep.mf } : null);

// cavity.c grow_one 226-240 with needle_run's probe branch (insert=probe,
// deep=0, cavity.c 329-332): the run has its own trace, so the stop rule reads
// this run only, and its own keeper of the best design within ev.maxLayers.
// Bounded by the layer cap, so a worker runs it without polling for a stop.
export function growSeed(ev, layers) {
    const log = { trace: makeTrace(), keep: makeKeeper(ev.maxLayers) };
    const tries = ev.floor > 0 ? COMB.growTries : 1;
    const r = probeNeedleRun(ev, layers, { tries, maxLayers: ev.maxLayers, log, targetMf: ev.targetMf });
    return { layers: r.layers, mf: r.mf, reason: r.reason, points: log.trace.points, kept: heldOf(log.keep) };
}

// ── The comb ─────────────────────────────────────────────────────────────────

// cavity.c 313-326: every seed refined to the end, recorded in seed order;
// a seed whose refined design an earlier kept seed reached is dropped.
async function refineSeeds(ev, seeds, run, log) {
    const items = seeds.map(s => ({ layers: buildSeed(s), prep: null, part: newPart() }));
    const refined = await run.runner.rung(ev, items, ev.refineOpts.maxIter);
    const distinct = [];
    refined.forEach((item, seed) => {
        const held = { layers: item.layers, mf: item.part.mf, seed };
        record(log, held.mf, held.layers);
        if (!distinct.some(d => sameDesign(ev.nRef, held, d))) distinct.push(held);
    });
    return distinct;
}

// cavity.c by_rank 198-202: refined merit, then seed index.
function byRank(x, y) {
    return ((x.mf > y.mf) - (x.mf < y.mf)) || x.seed - y.seed;
}

// cavity.c 333-355: each distinct seed grown, best refined first; in that
// order each run's trace is appended to the run's and its kept design offered
// to keep. The best grown design, ties to the earlier run.
async function growSeeds(ev, ranked, run, keep) {
    const grown = await run.runner.child(ev, ranked.map(r => ({ kind: 'grow', layers: r.layers })));
    let best = 0;
    grown.forEach((g, i) => {
        appendPoints(run.log.trace, g.points);
        if (g.kept) offer(keep, g.kept.mf, g.kept.layers);
        if (g.mf < grown[best].mf) best = i;
    });
    const { layers, mf, reason } = grown[best];
    return { layers, mf, reason };
}

// cavity.c 270-307: the seeds, or why there are none ('notPassStop',
// 'passRuns', 'noPeriod').
function combPlan(ev) {
    const applies = combApplies(ev);
    if (!applies.on) return { seeds: [], why: applies.why };
    const seeds = combSeeds(ev, applies.points, applies.passRuns);
    return { seeds, why: seeds.length === 0 ? 'noPeriod' : null };
}

// cavity.c cavity_comb 268-367. Returns the best grown design (it may pass
// ev.maxLayers), the kept design (giga4.c 539 takes this one), the seed
// counts, and why the comb did not run or stopped early: 'notPassStop' |
// 'passRuns' | 'noPeriod' | 'stopped'. Refined seeds and grown runs go to
// run.log.trace. The refined seeds and each growth's kept design are offered
// to run.log.keep, the keeper the caller sets for the comb (giga4.c 533-535),
// so they are there when a job does not come back (Stop terminates the pool);
// without one, to a keeper of the comb's own with cap ev.maxLayers. kept is
// that keeper's design.
export async function runComb(ev, run) {
    const shouldStop = run.shouldStop ?? never;
    const { seeds, why } = combPlan(ev);
    const out = { ev, grown: null, kept: null, seeds: seeds.length, distinct: 0, why: null };
    if (why || shouldStop()) return { ...out, why: why ?? 'stopped' };
    const log = { trace: run.log.trace, keep: run.log.keep ?? makeKeeper(ev.maxLayers) };
    const ranked = (await refineSeeds(ev, seeds, run, log)).sort(byRank);
    out.distinct = ranked.length;
    if (shouldStop()) return { ...out, kept: heldOf(log.keep), why: 'stopped' };
    const grown = await growSeeds(ev, ranked, run, log.keep);
    return { ...out, grown, kept: heldOf(log.keep) };
}
