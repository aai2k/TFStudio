/**
 * Monte Carlo error analysis (Macleod §13.7). See ../errorAnalysis.js for the
 * full statistical model and references.
 */

import { makeMCConfig, initializeMCState } from './mcConfig.js';
import { prepareMCTrial } from './mcDraws.js';
import { evaluateChar } from './spectrumEval.js';
import {
    updateMCStatistics,
    evaluateTrialSpecification,
    recordMCTrial,
    finalizeMCResult,
} from './mcResult.js';

/**
 * Statistical error analysis (Macleod §13.7).
 *
 * For each of N trials, draw independent Gaussian deviations:
 *
 *     Δd_j  ~ N(0, σ_d_j)   with σ_d_j = rmsAbsNm + (rmsRelPct/100) · d_j
 *     Δn_j  ~ N(0, σ_n_j)   (Re(n)  absolute σ)
 *     Δk_j  ~ N(0, σ_k_j)   (Im(n)  absolute σ; k + Δk is clamped at 0, so the
 *                            k error is one-sided on a transparent layer, see
 *                            makeShiftedMaterial)
 *
 * The "keep optical thickness" option
 * links Δd and Δn so n·d stays at the nominal value: d → d · n_nom / (n_nom + Δn),
 * with n_nom taken at the design's reference wavelength.
 * In that case Δd is *derived* from Δn (not drawn independently): the optical
 * thickness of a layer with random variations in thickness and refractive
 * indices is held equal to the initial optical thickness of the same layer.
 *
 * Then a single chosen spectral characteristic C(λ) ∈ {T, R, A} for s/p/avg at
 * a single AOI is evaluated, and online mean + variance are accumulated:
 *
 *     C̄(λ)  = (1/N) Σ C_i(λ)
 *     σ²(λ) = 1/(N − 1) Σ (C_i(λ) − C̄(λ))²    (sample variance)
 *
 * (Welford's online algorithm.) The output corridor is mean ± k·σ (k from
 * `corridorSigma`, default 1, one standard deviation).
 *
 * Every draw comes from one random stream: Mulberry32 seeded with `seed`, or
 * with a random seed when none is given. The result reports the seed, and the
 * same seed with the same settings reproduces the run bit for bit. The
 * specification yield is reported with its 95 % Wilson score interval.
 *
 * @param {object}   design
 * @param {object}   params   { lambdaStart, lambdaEnd, lambdaStep, theta, polarization }
 * @param {Function} resolveMat
 * @param {object}   opts
 *   - char:           'T'|'R'|'A'       (default 'R')
 *   - evalMode:       'front'|'back'|'total'  (default 'front')
 *   - nTrials:        number of Monte-Carlo runs (default 20)
 *   - corridorSigma:  k in mean ± k·σ corridor (default 1)
 *   - rmsAbsNm:       per-layer thickness σ — absolute component, in nm (default 0)
 *   - rmsRelPct:      per-layer thickness σ — relative component, % of d (default 1)
 *   - rmsReN:         absolute σ on Re(n) (default 0)
 *   - rmsImN:         absolute σ on Im(n) (default 0)
 *   - distribution:   'gaussian' | 'uniform' | 'truncated' (default 'gaussian')
 *                     'gaussian':  the set level is σ (RMS); tails unbounded.
 *                     'uniform':   the set level is a HARD ±bound; uniform draw,
 *                                  |Δ| never exceeds it (RMS = bound/√3).
 *                     'truncated': the set level is a HARD ±bound = 3σ; bell
 *                                  shape clipped at ±bound (RMS = 0.987·bound/3).
 *   - keepOpticalThickness: link Δd and Δn so n·d = const at the design's
 *                           reference wavelength (default false)
 *   - perMaterialErrors:    one ΔRe(n)/ΔIm(n) draw per *material id* instead
 *                           of per layer (default false)
 *   - seed:           (optional) positive 32-bit integer seeding the run's
 *                     Mulberry32 stream; a random one is drawn when absent
 *   - rng:            (optional) Math.random()-style function used in place of
 *                     the seeded stream; the result then reports seed null
 *   - onTrial:        (optional) callback ({i, total}) after each completed trial
 *
 * @returns {{
 *   lambda:    number[],
 *   theory:    number[],     // unperturbed C(λ)
 *   mean:      number[],     // sample mean across trials
 *   stdev:     number[],     // sample standard deviation (N − 1) across trials
 *   lower:     number[],     // mean − k·σ (clipped to ≥ 0)
 *   upper:     number[],     // mean + k·σ (clipped to ≤ 1)
 *   nTrials:   number,
 *   char:      string,
 *   seed:      number|null,  // seed the draws came from
 *   settings:  object,       // corridorSigma, rms*, distribution, theta, polarization of this run
 *   spec:      object|null,  // yield, passCount, evaluated, yieldInterval [low, high]
 * }}
 */
export async function runErrorAnalysisMC(design, params, resolveMat, opts = {}) {
    const config = makeMCConfig(design, params, resolveMat, opts);
    const state = initializeMCState(config);

    for (let trial = 0; trial < config.nTrials; trial++) {
        const data = prepareMCTrial(config, state);
        const run = evaluateChar({
            ...config,
            frontLayers: data.frontLayers,
            backLayers: data.backLayers,
            getMatForLayer: data.getMatForLayer,
        });
        updateMCStatistics(state, run[config.char]);
        const trialSpec = evaluateTrialSpecification(
            config, state, data.frontLayers, data.backLayers, data.getMatForLayer,
        );
        recordMCTrial(config, state, trial, data, trialSpec);

        if (config.onTrial) config.onTrial({ i: trial + 1, total: config.nTrials });
        if (config.onYield && (trial + 1) % config.yieldEvery === 0) {
            await config.onYield(trial + 1);
        }
        if (config.shouldCancel && config.shouldCancel()) break;
    }

    return finalizeMCResult(config, state);
}
