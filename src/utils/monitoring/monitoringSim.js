/**
 * Broadband Monitoring Simulator.
 *
 * Simulates a deposition process in a vacuum chamber equipped with a broadband
 * spectrophotometric monitoring device. At each scan, the simulator generates a
 * "true" noisy spectrum from the actual current stack, then fits the
 * current-layer thickness using the *nominal* model (the monitor doesn't know
 * the per-run material perturbations); the cut decision is made when the fitted
 * thickness reaches the target. The resulting as-built thickness is the actual
 * thickness at cut time, so monitoring imprecision propagates to the final
 * spectral performance.
 *
 * Implementation is split across sibling modules in ./monitoringSim/ :
 *   - rng.js                 seedable RNG, Gaussian draw, OU rate process
 *   - materialPerturbation.js per-run material Δn/Δk model
 *   - spectralFit.js          spectrum sampling + 1-D thickness fit
 *   - layerDeposition.js      realized-rate draw, excluded/shutter cuts
 *   - broadbandCutSearch.js   the optical-feedback scan loop for one layer
 *   - simulateRun.js          the run orchestrator (exported below)
 *
 * References:
 *   - A. V. Tikhonravov & M. K. Trubetskov, "Computational manufacturing as a
 *     bridge between design and production," Appl. Opt. 44, 6877 (2005).
 *   - H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12 (Production
 *     monitoring).
 */

export { mulberry32, deriveSeed, ouStep, sampleOURatePath } from './monitoringSim/rng.js';
export { makeShiftedMaterial } from './monitoringSim/materialPerturbation.js';
export { simulateRun } from './monitoringSim/simulateRun.js';
