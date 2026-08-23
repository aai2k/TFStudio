/**
 * Needle worker-POOL engine — thin-start rescue.
 *
 * A needle is inserted inside existing film, so a stack with very little
 * material in it has nowhere to put one. The scan still finds candidates whose
 * first-order improvement is real but vanishingly small, refinement cannot beat
 * the current best with any of them, and the run reports itself needle-optimal
 * after one or two generations. It is not optimal; it is out of room. Growing
 * total optical thickness before the layers can do their work is the documented
 * behaviour of the method, and forcing that growth in an outer loop is what
 * Gradual Evolution does deliberately (Tikhonravov et al., 2007). Standalone
 * Needle has no such loop.
 *
 * The rescue fires once per run, the first time the loop gives up. It refines a
 * geometric ladder of thicker copies of the current design in parallel on the
 * pool and continues from whichever scores best. How much thickness a problem
 * needs is not knowable in advance, which is why this is a ladder scored by the
 * merit function rather than one chosen factor or a user-set budget.
 *
 * The design held when the rescue starts is kept aside, and finalize returns it
 * if the continued run never beats it, so a rescue can only match or improve the
 * answer it was called on.
 */

import { wpOnTick, wpAlive } from './workerPoolLifecycle.js';

// Thickness multipliers tried in one pool round. Geometric so a few candidates
// span a wide range: on a 130 nm stack this reaches about 2 µm, which covers
// the visible and near-infrared designs a stall is normally hiding behind.
const SCALE_LADDER = [2, 4, 8, 16];

// Stop reasons that mean "no improving needle survived refinement" rather than a
// budget being spent. Only these are worth another start; max-layers and a
// reached target are real endings.
export const isStallReason = (reason) =>
    typeof reason === 'string' && reason.startsWith('Needle-optimal');

const scaleLayers = (layers, factor) =>
    (layers || []).map(l => (l.locked ? { ...l } : { ...l, thickness: (l.thickness || 0) * factor }));

const totalOf = (layers) => (layers || []).reduce((s, l) => s + (Number(l.thickness) || 0), 0);

// A rescue only means something if there is unlocked film to grow.
function hasGrowableFilm(front, back) {
    const growable = arr => (arr || []).some(l => !l.locked && (Number(l.thickness) || 0) > 0);
    return growable(front) || growable(back);
}

// Refine every rung of the ladder in parallel and return the best result, or
// null if the run was torn down or nothing came back.
async function refineLadder(run, front, back) {
    const { ctx } = run;
    const jobs = SCALE_LADDER.map(factor => ({
        type: 'seedDls', operands: run.operands,
        design: run.designSnap(scaleLayers(front, factor), scaleLayers(back, factor)),
        materials: run.materials, dMin: run.dMin, dlsIter: run.dlsIter,
        jobId: 'rescue', side: run.scanSides[0], engine: run.innerEngine,
    }));
    ctx.setPhase('refining');
    ctx.setStatusMsg(ctx.t.needle.rescueTrying(jobs.length));
    const results = await run.workerPool.map(jobs, (i, m) => wpOnTick(run, i, m));
    if (!wpAlive(run)) return null;
    let bi = -1;
    for (let i = 0; i < results.length; i++) {
        if (results[i] && (bi < 0 || results[i].mf < results[bi].mf)) bi = i;
    }
    return bi < 0 ? null : { result: results[bi], factor: SCALE_LADDER[bi] };
}

/**
 * Try one thicker start. Returns true when the loop should carry on from the
 * thickened design, false when the run should finalize with the reason it had.
 *
 * The winning rung is adopted even when its merit is worse than the design the
 * run stalled on: the point is the room it has to grow, not the merit it starts
 * at. `preRescueBest` is what keeps that safe.
 */
export async function wpThinStartRescue(run) {
    const { ctx, best } = run;
    if (run.rescued) return false;
    run.rescued = true;

    const front = best.frontLayers || run.mkLayers(run.curDes.frontLayers);
    const back  = best.backLayers  || run.mkLayers(run.curDes.backLayers);
    if (!hasGrowableFilm(front, back)) return false;

    const picked = await refineLadder(run, front, back);
    if (!picked) return false;

    run.preRescueBest = {
        mf: best.mf,
        frontLayers: run.deep(front),
        backLayers:  run.deep(back),
    };
    const { result, factor } = picked;
    best.mf = result.mf;
    best.frontLayers = run.deep(result.frontLayers || []);
    best.backLayers  = run.deep(result.backLayers  || []);
    // The accept rule compares against `best`, so the ΔMF baseline has to follow
    // it down (or up) to the design the run now continues from.
    run.prevBestMF = best.mf;
    // The next accepted generation is the first from the thicker start, so it can
    // read worse than the one before it. Mark it, so the history says why instead
    // of showing an unexplained step backwards.
    run.markRescue = true;
    ctx.updateDesignRef.current(
        { frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
    ctx.setMf(best.mf);
    ctx.setLayerCount(best.frontLayers.length + best.backLayers.length);
    ctx.setStatusMsg(ctx.t.needle.rescueApplied(factor, Math.round(
        totalOf(best.frontLayers) + totalOf(best.backLayers))));
    console.log(`[Needle] Thin-start rescue: ×${factor} → MF=${best.mf.toFixed(6)} TOT=${
        (totalOf(best.frontLayers) + totalOf(best.backLayers)).toFixed(1)} nm`);
    return true;
}
