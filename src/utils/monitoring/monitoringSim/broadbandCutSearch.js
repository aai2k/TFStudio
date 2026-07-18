/**
 * Broadband optical-feedback cut search for one layer (the non-excluded
 * case). Simulates the monitor scan-by-scan: the truth curve (perturbed
 * materials) plus noise + drift is what the monitor "sees"; the model curve
 * (nominal materials, via `fit1DThickness`) is fit to it to get the monitor's
 * thickness estimate d_hat. The layer cuts once d_hat has stayed at or above
 * d_target for `confirmScans` consecutive scans — this suppresses single-scan
 * outliers from a noisy fit (a real BBM controller uses similar smoothing).
 * No back-extrapolation — cut error is (cut_d_actual − d_target).
 *
 * `p` bundles the per-layer context so this stays a pure function of its
 * inputs; `t_global` is threaded through because drift accumulates across
 * the whole run, not just this layer.
 */

import { gauss } from './rng.js';
import { fit1DThickness } from './spectralFit.js';
import { createMonitorTmmEvaluator } from '../../physics/thinFilmMath.js';

// Add measurement noise + drift to the true scan:
//   T_meas(λ) = T_true(λ) · (1 + ε_rnd) + drift · t_global
// Multiplicative random noise (% of signal) is a reasonable model for a
// spectrophotometer where shot noise scales with intensity.
function buildMeasuredSpectrum(T_true, noiseStdFrac, driftSlope, t_global, rng) {
    const T_meas = new Float64Array(T_true.length);
    for (let li = 0; li < T_true.length; li++) {
        const eps = noiseStdFrac > 0 ? gauss(rng) * noiseStdFrac : 0;
        T_meas[li] = T_true[li] * (1 + eps) + driftSlope * t_global;
    }
    return T_meas;
}

// Cut decision: require `confirmScans` consecutive scans where d_hat ≥
// d_target. This suppresses single-scan outliers from a noisy fit (a real
// BBM controller uses a similar smoothing).
function checkCutConfirm(d_hat, d_target, confirmScans, aboveCount) {
    if (d_hat < d_target) return { aboveCount: 0, confirmed: false };
    const next = aboveCount + 1;
    return { aboveCount: next, confirmed: next >= confirmScans };
}

export function runBroadbandLayerCut(p) {
    const {
        theta, incMat, subMat, truthMats, modelMats, i,
        truthThicksPrev, modelThicksPrev, lambdas, char, pol,
        r, dt, d_target, t_target, dHiCap, confirmScans,
        randomPct, driftSlope, fitStartFrac, fitMaxIter, rng,
    } = p;
    let { t_global } = p;

    // Cap simulation time: at worst, scan until we're 50% over target
    const t_max = Math.max(t_target * 2.0, t_target + 10 / r);
    const maxScans = Math.max(2, Math.ceil(t_max / dt));

    let d_hat_prev = 0;
    let cut_time = t_target;
    let cut_d_actual = r * t_target;
    let cut_d_hat = d_target;          // monitor's estimate at cut (fallback: believes target hit)
    let aboveCount = 0;                // consecutive scans with d_hat ≥ d_target

    // Fast monitoring: the layers already deposited below the growing layer
    // are FIXED for the whole of this layer, so cache their
    // characteristic-matrix product ONCE and vary only the growing top layer
    // per scan / per golden-section step — O(Nλ) per evaluation instead of
    // O(Nλ·i). Bit-identical to a per-scan full-stack sample (matrix
    // associativity).
    const truthEval = createMonitorTmmEvaluator(theta, incMat, subMat, truthMats.slice(0, i), truthThicksPrev, lambdas);
    const modelEval = createMonitorTmmEvaluator(theta, incMat, subMat, modelMats.slice(0, i), modelThicksPrev, lambdas);

    const noiseStdFrac = randomPct / 100;

    for (let k = 1; k <= maxScans; k++) {
        const t = k * dt;
        const d_actual_k = r * t;
        t_global += dt;

        // Performance: only run the (expensive) spectral fit when the actual
        // thickness is close enough to the target that a fit *could* return
        // d_hat ≥ d_target. Before that, just step the simulation.
        if (d_actual_k < fitStartFrac * d_target) continue;

        // True (noisy-free) scan: truth materials, truth previous + current
        // actual — incremental (only the growing layer varies per scan).
        const T_true = truthEval.sample(char, pol, truthMats[i], d_actual_k);
        const T_meas = buildMeasuredSpectrum(T_true, noiseStdFrac, driftSlope, t_global, rng);

        // Fit current-layer thickness using NOMINAL materials and the
        // monitor's accumulated history of previous layers.
        const d_hat = fit1DThickness({
            sampleModel: (d) => modelEval.sample(char, pol, modelMats[i], d),
            T_meas,
            dLo: 0,
            dHi: dHiCap,
            dGuess: d_hat_prev > 0 ? d_hat_prev + r * dt : d_actual_k,
            maxIter: fitMaxIter,
        });

        const cut = checkCutConfirm(d_hat, d_target, confirmScans, aboveCount);
        aboveCount = cut.aboveCount;
        if (cut.confirmed) {
            cut_time = t;
            cut_d_actual = d_actual_k;
            cut_d_hat = d_hat;
            break;
        }
        d_hat_prev = d_hat;
    }

    return { cut_time, cut_d_actual, cut_d_hat, t_global };
}
