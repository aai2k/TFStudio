import { DEFAULT_REFINE_METHOD } from '../../../../utils/optimizers/index.js';
import { REFINE_METHODS } from '../../../../utils/refinement/methods.js';

// The Refinement window's method selection, kept as a global app setting. The
// method catalog itself is utils/refinement/methods.js.

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
    return DEFAULT_REFINE_METHOD;
}

export function saveMethod(m) { try { localStorage.setItem(METHOD_KEY, m); } catch (_) {} }
