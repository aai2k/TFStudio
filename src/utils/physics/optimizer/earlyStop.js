// ── Refinement early termination ─────────────────────────────────────────────
// Trubetskov, "Deep search methods for multilayer coating design," Appl. Opt.
// 59, A75 (2020): the one "machine-learning" feature of deep search is to stop
// refinements that cannot win early, by comparing each refinement's merit by
// iteration with the best stored ones, so a wide candidate search (refine
// every P-minimum, keep the best) costs less than one full refinement per
// candidate. This runs an existing DLSOptimizer (lsqEngine.js) to convergence,
// or until its MF by iteration shows it cannot beat a reference run.
//
// It only calls dls.step() and reads dls.mf, so the engine computes as it
// always does. step() accepts only moves that lower the merit, so dls.mf never
// rises and dls.thicknesses always holds the best point: no restoreBest() is
// needed after an early stop.
//
// A refinement is stopped only when it is both (a) on a plateau, its relative
// MF gain over the last `patience` steps below `minRelGain`, and (b) behind
// the reference run at the same iteration by more than `margin`. One that is
// still falling fast is never stopped, since (a) fails. With no reference only
// the plateau test applies, and the stop is an early convergence.
//
// opts: { maxIter=60, reference=null, warmup=4, patience=5, minRelGain=1e-3,
//         margin=0.05 }
// returns { mf, iters, trajectory, aborted }
export function refineWithEarlyStop(dls, opts = {}) {
    const maxIter    = opts.maxIter    ?? 60;
    const reference  = opts.reference  || null;
    const warmup     = opts.warmup     ?? 4;
    const patience   = opts.patience   ?? 5;
    const minRelGain = opts.minRelGain ?? 1e-3;
    const margin     = opts.margin     ?? 0.05;

    const trajectory = [dls.mf];
    let aborted = false;
    while (!(dls.isConverged() || dls.iter >= maxIter)) {
        dls.step();
        trajectory.push(dls.mf);
        const t = trajectory.length - 1;
        if (t < warmup) continue;

        // (a) plateau: relative MF gain over the patience window
        const past    = trajectory[Math.max(0, t - patience)];
        const relGain = past > 0 ? (past - dls.mf) / past : 0;
        if (relGain >= minRelGain) continue;       // still falling: go on

        if (!reference) { aborted = true; break; }  // on a plateau with no reference: converged
        // (b) behind the reference at this iteration: it cannot catch up
        const ref = reference[Math.min(t, reference.length - 1)];
        if (ref != null && dls.mf > ref * (1 + margin)) { aborted = true; break; }
    }
    return { mf: dls.mf, iters: dls.iter, trajectory, aborted };
}
