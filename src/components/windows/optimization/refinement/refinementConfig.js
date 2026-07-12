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

export const METHOD_LABELS = {
    cg:          'Conjugate Gradient',
    dls:         'Damped Least Squares',
    newton:      'Newton',
    'newton-cg': 'Newton-CG',
    sqp:         'Sequential QP',
    'dls-multi': 'DLS multi-start',
    de:          'Differential Evolution',
    sa:          'Simulated Annealing',
    all:         'Try all — keep best',
};

// Order used by 'all'. dls-multi last (slowest).
export const ALL_ORDER = ['cg', 'dls', 'newton', 'newton-cg', 'sqp', 'de', 'sa', 'dls-multi'];

// Per-method iteration budget for the single-worker engines. The second-order
// methods (newton / newton-cg / sqp) converge quadratically near the minimum, so
// they need far fewer steps than LM.
export const MAXITER_FOR = { cg: 600, dls: 500, newton: 200, 'newton-cg': 200, sqp: 200, sa: 400, de: 250 };

export const METHOD_NOTES = {
    cg:          'Conjugate Gradient — local, gradient-only; great for polishing a decent design / large stacks.',
    dls:         'Damped Least Squares (Levenberg–Marquardt) — the classic local refiner.',
    newton:      'Newton — second-order local refiner. Uses the exact analytic Hessian (JᵀJ + curvature) when scoring a single side (Front or Back with "ignore the other side" on); uses a Gauss-Newton Hessian (JᵀJ) for full-filter evaluation (Both / symmetric, or a single side with "ignore the other side" off). Quadratic endgame, fewest iterations.',
    'newton-cg': 'Truncated Newton (Newton-CG) — matrix-free second-order; solves the Newton step by inner CG using Hessian-vector products. Scales to large stacks; works in all surface modes.',
    sqp:         'Sequential QP (bounded) — Newton step with the layer thickness bounds [MNT/MXT]∩[Dmin,Dmax] as HARD constraints (exact bound satisfaction, no penalty tuning). Works in all surface modes.',
    'dls-multi': 'DLS from N perturbed starts, keep best — escapes shallow local minima.',
    de:          'Differential Evolution — global, gradient-free; for poor starts / multimodal targets (parallel).',
    sa:          'Simulated Annealing — global, gradient-free; accepts uphill moves then cools.',
    all:         'Run every method from the same start and keep the best result (DLS multi-start last).',
};

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
