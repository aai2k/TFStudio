/**
 * Thin-film optimizer — PUBLIC BARREL.
 *
 * The implementation was split into focused modules under ./optimizer/.
 * This file re-exports their full surface so every existing
 * importer (components, workers, tests) is unchanged. Dependency order (a strict
 * acyclic DAG, no module imports this barrel):
 *   operandModel → filterCatalog · sampling · layerOps · linalg(internal)
 *   → evalCore → lsqEngine · scanners
 *
 * `lsqEngine.js` is the shared analytic least-squares engine (LSQEngine) + the
 * plain DLS/LM refiner (DLSOptimizer); the Newton / Newton-CG / SQP step
 * strategies live in src/utils/optimizers/.
 *
 * Reference: H.A. Macleod, Thin-Film Optical Filters, 5th ed.
 */

export * from './optimizer/operandModel.js';
export * from './optimizer/filterCatalog.js';
export * from './optimizer/coneAngle.js';
export * from './optimizer/sampling.js';
export * from './optimizer/layerOps.js';
export * from './optimizer/consolidate.js';
export * from './optimizer/evalCore.js';
export * from './optimizer/lsqEngine.js';
export * from './optimizer/scanners.js';
