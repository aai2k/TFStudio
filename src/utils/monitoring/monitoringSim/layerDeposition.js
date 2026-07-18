/**
 * Per-layer deposition helpers shared by simulateRun's layer loop: the
 * realized deposition rate (OU correlated process), the dead-reckoned cut
 * for layers excluded from broadband monitoring (time/quartz), and the
 * post-cut thickness/shutter deviations independent of monitoring.
 */

import { gauss, ouStep } from './rng.js';

/**
 * Realized deposition rate for one layer via the OU correlated process.
 * `prevR` is the last realized rate for this material (undefined on its
 * first layer); `dtc` is the wall-clock time since that layer. First visit
 * of a material draws from N(mean, sigma); later visits step the OU process
 * with memory a = exp(-dtc/τ). Clamped to >1e-6 nm/s.
 */
export function drawRealizedRate(rateSpec, prevR, dtc, rng) {
    let r;
    if (prevR === undefined) {
        r = rateSpec.mean + (rateSpec.sigma > 0 ? gauss(rng) * rateSpec.sigma : 0);
    } else {
        const a = rateSpec.corrTime > 0 ? Math.exp(-dtc / rateSpec.corrTime) : 0;
        r = ouStep(prevR, rateSpec.mean, rateSpec.sigma, a, rng);
    }
    return r <= 1e-6 ? Math.max(1e-6, rateSpec.mean) : r;
}

/**
 * Cut for a layer excluded from the broadband fit (monitored by other means —
 * time / quartz crystal). As-built thickness deviates from target only by
 * the supplementary monitoring's relative thickness error `relPct` (%).
 */
export function computeExcludedCut(d_target, r, relPct, rng) {
    const relErr = relPct > 0 ? gauss(rng) * relPct / 100 : 0;
    const cut_d_actual = Math.max(0, d_target * (1 + relErr));
    return { cut_d_actual, cut_time: cut_d_actual / r, cut_d_hat: d_target };
}

/**
 * Apply the extra thickness deviations independent of monitoring: a
 * shutter-jitter-style additive/relative σ on as-built thickness, and the
 * shutter-close delay (the shutter doesn't close instantly at the cut
 * decision, so a small extra r·delay is deposited). Returns the as-built
 * thickness; the cut time itself is unaffected by these (monitoring-BBM
 * convention — the monitor's cut_time is a scan-clock event, the shutter
 * delay only adds material after it).
 */
export function applyExtraThicknessAndShutter({
    cut_d_actual, r, d_target, sigmaThkAbsNm, sigmaThkRelPct, shutterMeanS, shutterRmsS, rng,
}) {
    let extra = 0;
    if (sigmaThkAbsNm > 0 || sigmaThkRelPct > 0) {
        const sigma_d = sigmaThkAbsNm + (sigmaThkRelPct / 100) * d_target;
        extra = sigma_d > 0 ? gauss(rng) * sigma_d : 0;
    }

    let shutterExtra = 0;
    if (shutterMeanS > 0 || shutterRmsS > 0) {
        const delay = Math.max(0, shutterMeanS + (shutterRmsS > 0 ? gauss(rng) * shutterRmsS : 0));
        shutterExtra = r * delay;
    }

    return Math.max(0, cut_d_actual + extra + shutterExtra);
}
