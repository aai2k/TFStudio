// Refinement method catalog and per-method configuration.
//
//   sqp        Bounded Sequential QP (second-order; hard MNT/MXT box)
//   dls        Damped Least Squares / Levenberg–Marquardt (local)
//   cg         Conjugate Gradient (local, gradient-only; large designs)
//   newton     Modified Newton (dense analytic Hessian; quadratic endgame)
//   newton-cg  Truncated Newton (matrix-free; scales to large stacks)
//   dls-multi  DLS from N perturbed starts, keep best (local, escapes shallow mins)
//   de         Differential Evolution (global, gradient-free, worker-pool parallel)
//   sa         Simulated Annealing (global, gradient-free)
//   all        try every method, keep the best result (dls-multi last; slowest)
// CG is the most robust large-design local polisher; DE/SA are global explorers
// for poor/multimodal starts.
export const REFINE_METHODS = ['sqp', 'dls', 'cg', 'newton', 'newton-cg', 'dls-multi', 'de', 'sa', 'all'];

// Order used by 'all'. dls-multi last (slowest).
export const ALL_ORDER = ['cg', 'dls', 'newton', 'newton-cg', 'sqp', 'de', 'sa', 'dls-multi'];

// Per-method iteration budget for the single-worker engines. The second-order
// methods (newton / newton-cg / sqp) converge quadratically near the minimum, so
// they need far fewer steps than LM.
export const MAXITER_FOR = { cg: 600, dls: 500, newton: 200, 'newton-cg': 200, sqp: 200, sa: 400, de: 250 };

// Methods whose runs draw random numbers. Their runs take a seed, which the
// Design History row keeps.
export const STOCHASTIC_METHODS = new Set(['de', 'sa', 'dls-multi']);

// Multi-start settings a run uses when none are given: restarts, the ±
// percentage each restart scales a free thickness by, and the workers the
// multi-start and DE use at once.
export const DEFAULT_SETTINGS = Object.freeze({ nRestarts: 20, perturbPct: 30, threads: 1 });

// Iteration cap of a one-method run when none is given: the method's natural
// budget. The run still stops early at convergence.
export const defaultMaxIter = method => MAXITER_FOR[method] || 500;

// Unlocked layer count the surface mode exposes; parallel DE needs four.
export function countFreeVars(design) {
    const sm = design?.surfaceMode || 'front_only';
    const cnt = (arr) => (arr || []).filter(l => !l.locked).length;
    if (sm === 'back_only') return cnt(design.backLayers);
    if (sm === 'both_independent') return cnt(design.frontLayers) + cnt(design.backLayers);
    return cnt(design.frontLayers);
}

/**
 * The end-of-run pill of a finished run: 'target' when the merit reached zero
 * to the six decimals shown, 'maxiter' when the optimizer worker reports that
 * the iteration cap cut the run off, otherwise 'stalled', the merit no longer
 * falling.
 */
export function endReasonFor(mf, workerReason) {
    if (mf < 1e-6) return 'target';
    return workerReason === 'maxiter' ? 'maxiter' : 'stalled';
}
