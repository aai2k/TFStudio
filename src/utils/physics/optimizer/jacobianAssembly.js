/**
 * Analytic Jacobian assembly for the least-squares engine.
 *
 * Pure functions that build the exact analytic ∂(residual)/∂(thickness) Jacobian
 * used by `LSQEngine._analyticJacobian`. Each concern lives in its own module
 * under `jacobianAssembly/`; this barrel re-exports the public surface:
 *  - layerJacobian.js  — `computeLayerJacobian` per-(λ,pol,aoi) TMM Jacobian
 *    package (single-front, single-back, full-system composition).
 *  - pointEvaluators.js — `_surfaceLayout` mode resolution and
 *    `makePointEvaluators` (memoized propDeriv/propVal over free variables).
 *  - jacRows.js / bandRows.js / extremumRows.js — the per-operand-type row
 *    builders and the `_jacRow` dispatch.
 *
 * References: Macleod, Thin-Film Optical Filters §2.6.4; Sullivan & Dobrowolski,
 * Appl. Opt. 35 (1996).
 */

export { _surfaceLayout, makePointEvaluators } from './jacobianAssembly/pointEvaluators.js';
export { _jacRow } from './jacobianAssembly/jacRows.js';
