/**
 * monoSim — Monochromatic (single-wavelength) Monitoring Simulator engine.
 *
 * Companion to monitoringSim.js (broadband). Broadband and
 * monochromatic monitoring are the SAME computational-manufacturing experiment
 * differing only in the cut rule, so this module deliberately mirrors
 * `simulateRun` (monitoringSim.js): identical cfg fields (rates + OU correlation,
 * per-material Δn/Δk, shutter delay, excluded layers, signal random/drift) and
 * an identical return shape, so the wizard reuses the same playback / results /
 * spectrum code. See simulateRunMono.js for the per-layer termination rules
 * ('turning' / 'level' / 'time').
 *
 * Implementation is split across sibling modules in ./monoSim/ :
 *   - rng.js                  Gaussian draw (mirrors monitoringSim's, same
 *                              formula/draw order — kept local per file)
 *   - signalModel.js           single-λ signal sampler + model-curve analysis
 *   - monitorTable.js          sensitive-λ pick, auto strategy, default table
 *   - cutSteps.js              turning/level per-scan cut detectors
 *   - scanCutMono.js           the optical-feedback scan loop for one layer
 *   - materialPerturbation.js  per-run material Δn/Δk draws
 *   - layerDeposition.js       realized-rate draw, time-cut, shutter latency
 *   - simulateRunMonoConfig.js cfg destructuring/defaults
 *   - layerLoop.js             per-layer step (exported below via simulateRunMono)
 *   - simulateRunMono.js       the run orchestrator (exported below)
 *
 * References:
 *   - H. A. Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 *   - A. V. Tikhonravov & M. K. Trubetskov, Appl. Opt. 44, 6877 (2005).
 *   - A. V. Tikhonravov, M. K. Trubetskov, T. V. Amotchkina, Appl. Opt. 45,
 *     7863 (2006) — choosing a monochromatic-monitoring strategy.
 */

export { mulberry32, deriveSeed, makeShiftedMaterial } from './monitoringSim.js';
export { pickSensitiveLambda, autoMonoStrategy, defaultMonoTable } from './monoSim/monitorTable.js';
export { simulateRunMono } from './monoSim/simulateRunMono.js';
