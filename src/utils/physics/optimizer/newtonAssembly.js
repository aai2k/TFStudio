/**
 * Second-order (Newton) system assembly for the least-squares engine.
 *
 * Pure functions that build the merit-function Hessian used by
 * `LSQEngine._newtonSystem` / `_gaussNewtonSystem`, factored out of the engine.
 * Each concern lives in its own module under `newtonAssembly/`; this barrel
 * re-exports the public surface:
 *  - gaussNewton.js: `_jtjUpper` / `_mirrorUpper` (JᵀJ + Jᵀr).
 *  - hessianSampler.js: `makeHessianSampler`, comp value / first / second
 *    thickness derivatives over free variables, one wavelength at a time
 *    (single-front direct; single-back reversed and remapped to storage order).
 *  - curvature.js: `addCurvature`, the second-order curvature S of every
 *    operand, and `_operandSupportsFullNewton` eligibility.
 *
 * Reference: Tikhonov–Tikhonravov–Trubetskov 1993; Nocedal & Wright 2e.
 */

export { _jtjUpper, _mirrorUpper } from './newtonAssembly/gaussNewton.js';
export { makeHessianSampler } from './newtonAssembly/hessianSampler.js';
export {
    addCurvature,
    _operandSupportsFullNewton,
} from './newtonAssembly/curvature.js';
