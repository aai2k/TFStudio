// Refinement method catalog and per-method configuration.
//
//   sqp       — Bounded Sequential QP (second-order; hard MNT/MXT box)      DEFAULT
//   dls       — Damped Least Squares / Levenberg–Marquardt (local)
//   cg        — Conjugate Gradient (local, gradient-only; large designs)
//   newton    — Modified Newton (dense analytic Hessian; quadratic endgame)
//   newton-cg — Truncated Newton (matrix-free; scales to large stacks)
//   dls-multi — DLS from N perturbed starts, keep best (local, escapes shallow mins)
//   de        — Differential Evolution (global, gradient-free, worker-pool parallel)
//   sa        — Simulated Annealing (global, gradient-free)
//   all       — try every method, keep the best result (dls-multi last; slowest)
// SQP is the default (see loadMethod): a single-pass polish of a fixed stack
// converges in the fewest iterations and satisfies the thickness bounds exactly.
// CG is the most robust large-design local polisher; DE/SA are global explorers
// for poor/multimodal starts.
export const REFINE_METHODS = ['sqp', 'dls', 'cg', 'newton', 'newton-cg', 'dls-multi', 'de', 'sa', 'all'];

// Order used by 'all'. dls-multi last (slowest).
export const ALL_ORDER = ['cg', 'dls', 'newton', 'newton-cg', 'sqp', 'de', 'sa', 'dls-multi'];

// Per-method iteration budget for the single-worker engines. The second-order
// methods (newton / newton-cg / sqp) converge quadratically near the minimum, so
// they need far fewer steps than LM.
export const MAXITER_FOR = { cg: 600, dls: 500, newton: 200, 'newton-cg': 200, sqp: 200, sa: 400, de: 250 };

const METHOD_KEY = 'tfstudio-refinement-method';

export function loadMethod() {
    try { const m = localStorage.getItem(METHOD_KEY); if (m && REFINE_METHODS.includes(m)) return m; } catch (_) {}
    // SQP: best/tied-best MF across the grand benchmark in
    // EVERY case, constrained AND unconstrained — decisively so on hard
    // constrained problems (the common case: designers usually set a min-
    // thickness). It handles MNT natively (box-QP) and finds thick-layer
    // solutions that satisfy the constraint for free. Slower on hard problems
    // than DLS/Newton-CG, but the quality margin is large; speed-first users can
    // switch to DLS.
    return 'sqp';
}

export function saveMethod(m) { try { localStorage.setItem(METHOD_KEY, m); } catch (_) {} }

// Unlocked layer count the surface mode exposes — gates parallel DE.
export function countFreeVars(design) {
    const sm = design?.surfaceMode || 'front_only';
    const cnt = (arr) => (arr || []).filter(l => !l.locked).length;
    if (sm === 'back_only') return cnt(design.backLayers);
    if (sm === 'both_independent') return cnt(design.frontLayers) + cnt(design.backLayers);
    return cnt(design.frontLayers);
}
