/**
 * Synthesis (Needle / Gradual Evolution / Structural) run configuration —
 * PUBLIC BARREL.
 *
 * localStorage-backed user settings shared by the synthesis windows: inner
 * refiner choice, worker thread budget, candidate-search breadth, needle
 * sensitivity culling, seed-handling mode, finalize-time consolidation, and
 * the smart QW/HW AR seed generator toggle. Renderer-only (each getter falls
 * back to a sensible default when localStorage is unavailable, e.g. inside a
 * worker or a headless test).
 *
 * The implementation is split into focused modules under ./synthesisConfig/:
 *   innerEngine       → getSynthesisInnerEngine / setSynthesisInnerEngine
 *   threads           → detectCores / defaultThreadCount / getThreadCount /
 *                        setThreadCount / threadSelectOptions
 *   candBatches       → getSynthesisCandMode / setSynthesisCandMode /
 *                        getSynthesisMaxBatches
 *   needleSensitivity → getNeedleSensMode / setNeedleSensMode /
 *                        getNeedleSensFloor / cullMarginalNeedles
 *   seedMode          → getSynthesisSeedMode / setSynthesisSeedMode /
 *                        PRESERVE_BULK_GENTLE_ITER
 *   consolidate       → getSynthesisConsolidate(Tol) / setSynthesisConsolidate(Tol)
 *   smartSeed         → getSynthesisSmartSeed / setSynthesisSmartSeed
 * This file re-exports their full surface so every existing importer
 * (components, workers, tests) is unchanged.
 *
 * NOTE: adaptive merit sampling is ALWAYS ON and has no setting —
 * it's a correctness fix (the merit was blind to spectral features narrower than
 * the operand grid step) and a no-op on smooth designs, so there is nothing to
 * toggle. The engine lives in optimizer.js (densifyOperandsForFeatures); each
 * optimizer window calls it at run launch via a local densifyForRun helper.
 */

export * from './synthesisConfig/innerEngine.js';
export * from './synthesisConfig/threads.js';
export * from './synthesisConfig/candBatches.js';
export * from './synthesisConfig/needleSensitivity.js';
export * from './synthesisConfig/seedMode.js';
export * from './synthesisConfig/consolidate.js';
export * from './synthesisConfig/smartSeed.js';
