/**
 * Global-Refinement engine registry.
 *
 * All engines share the DLSOptimizer-compatible interface (step / isConverged /
 * restoreBest / applyToDesign / .mf / .mfBest / .thickBest / .thicknesses /
 * .iter / .layerSide), so the Refinement orchestrator and the optimizer worker
 * stay method-agnostic — they just `makeEngine(method, …)` and drive `step()`.
 *
 * These are all REFINEMENT methods (Macleod's sense): they optimize the
 * thickness vector of a fixed stack. They never change the layer count — that
 * is synthesis (Needle / Gradual Evolution).
 *
 *   'dls' → Damped Least Squares / Levenberg–Marquardt  (the LOCAL engine,
 *            lives in optimizer.js; selected in the "Local" Refinement window)
 *   'de'  → Differential Evolution            (global, gradient-free, population)
 *   'sa'  → Simulated Annealing               (global, gradient-free)
 *   'cg'  → Conjugate Gradient (Polak–Ribière) (local, gradient-only, large designs)
 */

import { DLSOptimizer } from '../physics/optimizer.js';
import { DEOptimizer } from './de.js';
import { SAOptimizer } from './sa.js';
import { CGOptimizer } from './cg.js';
import { NewtonOptimizer } from './newton.js';
import { NewtonCGOptimizer } from './newtonCG.js';
import { SQPOptimizer } from './sqp.js';

// CG first / default: empirically it polishes already-decent designs best
// (the common workflow). DE/SA are the global explorers — they shine from a
// poor start or a multimodal landscape, not when refining a good local optimum.
// 'newton' is the second-order LOCAL engine (analytic Hessian, quadratic
// endgame) — fastest convergence on stiff/large designs (front_only).
export const GLOBAL_METHODS = ['cg', 'de', 'sa'];
export const ALL_METHODS    = ['dls', 'newton', 'newton-cg', 'cg', 'de', 'sa'];
export const DEFAULT_GLOBAL_METHOD = 'cg';

export const METHOD_LABELS = {
    dls:         'Damped Least Squares',
    newton:      'Newton (analytic Hessian)',
    'newton-cg': 'Truncated Newton (Newton-CG)',
    de:          'Differential Evolution',
    sa:          'Simulated Annealing',
    cg:          'Conjugate Gradient',
};

// 'sqp' (Bounded Sequential QP, tests/sqp_validation.mjs) is the DEFAULT method
// of the Refinement window (REFINE_METHODS in Refinement.js) — fewest iterations
// on a fixed stack with exact MNT/MXT bound satisfaction. It is omitted from
// ALL_METHODS above only because that array drives the headless "try-all"
// benchmark ordering, not the UI; the window builds its own dropdown list.
const ENGINES = {
    dls:         DLSOptimizer,
    newton:      NewtonOptimizer,
    'newton-cg': NewtonCGOptimizer,
    de:          DEOptimizer,
    sa:          SAOptimizer,
    cg:          CGOptimizer,
    sqp:         SQPOptimizer,
};

export function makeEngine(method, operands, design, resolveMat, opts = {}) {
    const Engine = ENGINES[method] || ENGINES.dls;
    return new Engine(operands, design, resolveMat, opts);
}

export { DEOptimizer, SAOptimizer, CGOptimizer };
