/**
 * Per-layer deposition helpers shared by simulateRun's layer loop: the
 * realized deposition rate (OU correlated process), the chamber that grows a
 * layer at that fluctuating rate, the dead-reckoned cut for layers excluded
 * from broadband monitoring (time/quartz), and the post-cut thickness/shutter
 * deviations independent of monitoring.
 */

import { gauss, ouStep, ouStepIntegral } from './rng.js';

/**
 * Realized deposition rate at the start of a layer via the OU correlated
 * process. `prevR` is this material's rate when it last grew (undefined on
 * its first layer); `dtc` is the wall-clock time since then. First visit of
 * a material draws from N(mean, sigma); later visits step the OU process
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
 * The chamber side of one layer: thickness grown so far (nm), the current
 * deposition rate (nm/s) and the time since the layer started (s). Only the
 * simulation reads it; the monitor sees the layer through its spectra.
 */
export function startLayerGrowth(r0) {
    return { d: 0, r: r0, t: 0 };
}

/**
 * Grow the layer for `dt` seconds. The rate is the material's OU process,
 * stepped exactly over `dt`, and the thickness gained is its exact integral
 * over the step, so a layer's thickness noise is the same whatever the scan
 * interval. A layer never loses material, so a negative integral (a rate
 * excursion below zero) adds nothing.
 */
export function growLayer(chamber, dt, rateSpec, rng) {
    if (!(dt > 0)) return chamber;
    const { r, area } = ouStepIntegral(chamber.r, rateSpec, dt, rng);
    chamber.d += Math.max(0, area);
    chamber.r = r;
    chamber.t += dt;
    return chamber;
}

/**
 * Cut for a layer excluded from the broadband fit (monitored by other means,
 * time or quartz crystal). As-built thickness deviates from target only by
 * the supplementary monitoring's relative thickness error `relPct` (%). The
 * layer's duration is taken at its starting rate, and the rate process is
 * carried through that duration so the next layer of the material continues
 * from it. The monitor's model records the target, which is what the other
 * monitor reports.
 */
export function excludedLayerCut(chamber, d_target, relPct, rateSpec, rng) {
    const relErr = relPct > 0 ? gauss(rng) * relPct / 100 : 0;
    const d = Math.max(0, d_target * (1 + relErr));
    const cut_time = d / chamber.r;
    growLayer(chamber, cut_time, rateSpec, rng);
    chamber.d = d;
    return { cut_time, cut_d_hat: d_target };
}

/**
 * Extra as-built thickness deviation independent of monitoring: an additive
 * σ (nm) plus a relative σ (% of target), drawn once per layer.
 */
export function drawExtraThickness(d_target, sigmaThkAbsNm, sigmaThkRelPct, rng) {
    if (!(sigmaThkAbsNm > 0 || sigmaThkRelPct > 0)) return 0;
    const sigma_d = sigmaThkAbsNm + (sigmaThkRelPct / 100) * d_target;
    return sigma_d > 0 ? gauss(rng) * sigma_d : 0;
}

/**
 * Shutter-close delay (s): the shutter does not close at the cut decision,
 * so the layer keeps growing for this long. The monitor's cut time is a
 * scan-clock event; the delay only adds material and wall-clock time after it.
 */
export function drawShutterDelay(shutterMeanS, shutterRmsS, rng) {
    if (!(shutterMeanS > 0 || shutterRmsS > 0)) return 0;
    return Math.max(0, shutterMeanS + (shutterRmsS > 0 ? gauss(rng) * shutterRmsS : 0));
}
