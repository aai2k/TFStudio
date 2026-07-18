/**
 * Per-layer sim helpers (cfg semantics shared with monitoringSim.simulateRun):
 * per-material Δn/Δk draw, the OU-correlated realized rate, the time/quartz
 * dead-reckoned cut, and the shutter-close latency.
 */

import { gauss } from './rng.js';
import { ouStep } from '../monitoringSim.js';

// Per-material Δn/Δk draw: systematic + random, from a matDev override if present
// else the global σ_Re(n)/σ_Im(n). Returns { dn, dk, inh }.
export function _drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng) {
    if (matDev && matDev.has(id)) {
        const dv = matDev.get(id);
        const dn = (dv.reNSyst || 0) + (dv.reNRand > 0 ? gauss(rng) * dv.reNRand : 0);
        const dk = (dv.imNSyst || 0) + (dv.imNRand > 0 ? gauss(rng) * dv.imNRand : 0);
        return { dn, dk, inh: dv.systInh || 0 };
    }
    const dn = sigmaReN > 0 ? gauss(rng) * sigmaReN : 0;
    const dk = sigmaImN > 0 ? gauss(rng) * sigmaImN : 0;
    return { dn, dk, inh: 0 };
}

// Realized deposition rate for one layer via the OU correlated process (shared
// with simulateRun). `dtc` = wall-clock since this material last grew. First
// visit of a material draws from N(mean, sigma); later visits step the OU
// process with memory a = exp(-dtc/τ). Clamped to >1e-6 nm/s.
export function _realizedRate(rateSpec, prevR, dtc, rng) {
    let r;
    if (prevR === undefined) {
        r = rateSpec.mean + (rateSpec.sigma > 0 ? gauss(rng) * rateSpec.sigma : 0);
    } else {
        const a = rateSpec.corrTime > 0 ? Math.exp(-dtc / rateSpec.corrTime) : 0;
        r = ouStep(prevR, rateSpec.mean, rateSpec.sigma, a, rng);
    }
    return r <= 1e-6 ? Math.max(1e-6, rateSpec.mean) : r;
}

// Time/thickness cut (no optical feedback): dead-reckon to d_target on the
// realized rate plus a relative-thickness error draw. `relPct` is the layer's
// relative-thickness σ (%) — from relThkErrByLayer for excluded (quartz)
// layers, else the monitor row's sigmaRelPct. Returns { cut_d_actual, cut_time }.
export function _timeCut(d_target, r, relPct, rng) {
    const relErr = relPct > 0 ? gauss(rng) * relPct / 100 : 0;
    const cut_d_actual = Math.max(0, d_target * (1 + relErr));
    return { cut_d_actual, cut_time: cut_d_actual / r };
}

// Shutter-close latency: the layer keeps growing for `delay` s after the cut
// decision. `shutter` = { meanS, rmsS }. Returns the adjusted
// { cut_d_actual, cut_time }.
export function _applyShutter(cut_d_actual, cut_time, r, shutter, rng) {
    const delay = Math.max(0, shutter.meanS + (shutter.rmsS > 0 ? gauss(rng) * shutter.rmsS : 0));
    return { cut_d_actual: Math.max(0, cut_d_actual + r * delay), cut_time: cut_time + delay };
}
