/**
 * Broadband optical-feedback cut search for one layer (the non-excluded
 * case). The chamber grows the layer at its fluctuating rate. At every scan
 * the monitor reads the true stack (perturbed materials) plus noise and
 * drift, and fits the growing layer's thickness with its own model: nominal
 * materials over its own estimates of the layers below. A thickness/rate
 * tracker weighs each fitted thickness by the fit's own uncertainty against
 * how fast the rate can wander, and the monitor times the shutter to close
 * where the tracked thickness reaches the target, between scans.
 * `confirmScans` is a noise guard, not a delay: the tracker has to put the
 * target within confirmScans scans on that many consecutive scans before a
 * cut is timed.
 *
 * The monitor never reads the chamber's thickness or rate. It knows the
 * target, the rate specification (mean, rms, correlation time) and its own
 * clock.
 *
 * `p` bundles the per-layer context so this stays a pure function of its
 * inputs; `t_global` is threaded through because drift accumulates across
 * the whole run, not just this layer.
 */

import { gauss } from './rng.js';
import { fit1DThickness, fitGridStep, fitVariance } from './spectralFit.js';
import { growLayer } from './layerDeposition.js';
import { createMonitorTmmEvaluator } from '../../physics/thinFilmMath.js';

// Add measurement noise + drift to the true scan:
//   T_meas(λ) = T_true(λ) · (1 + ε_rnd) + ε_abs + drift · t_global
// Multiplicative random noise (% of signal) models shot noise scaling with
// intensity; the absolute term is the photometric noise floor, which does
// not shrink with the signal. `sig` = { noiseStdFrac, absNoiseFrac,
// driftSlope, rng }.
function buildMeasuredSpectrum(T_true, sig, t_global) {
    const { noiseStdFrac, absNoiseFrac, driftSlope, rng } = sig;
    const T_meas = new Float64Array(T_true.length);
    for (let li = 0; li < T_true.length; li++) {
        const eps = noiseStdFrac > 0 ? gauss(rng) * noiseStdFrac : 0;
        const abs = absNoiseFrac > 0 ? gauss(rng) * absNoiseFrac : 0;
        T_meas[li] = T_true[li] * (1 + eps) + abs + driftSlope * t_global;
    }
    return T_meas;
}

// ── Thickness/rate tracker ───────────────────────────────────────────────────
//
// A two-state Kalman filter over the layer's thickness d (nm) and rate r
// (nm/s) with covariance P (Kalman, J. Basic Eng. 82, 35 (1960)). Between
// scans d grows at r and r takes a random walk: the continuous white-noise
// acceleration model, process noise q·[[dt³/3, dt²/2], [dt²/2, dt]]
// (Bar-Shalom, Li & Kirubarajan, Estimation with Applications to Tracking and
// Navigation, Wiley 2001). q = 2σ²/τ is the short-time diffusion of the OU
// rate, so a steady rate (σ = 0) or a zero correlation time, whose
// fluctuation averages out of the thickness, gives q = 0 and the tracker
// reduces to a weighted least-squares line from the layer's start through
// every estimate. The layer starts at d = 0 exactly; the rate starts at the
// nominal rate with a spread of the nominal rate itself, loose enough that
// the estimates decide it.

function createTracker(rNom, rateSpec) {
    const q = rateSpec.sigma > 0 && rateSpec.corrTime > 0
        ? 2 * rateSpec.sigma * rateSpec.sigma / rateSpec.corrTime : 0;
    return { d: 0, r: rNom, P00: 0, P01: 0, P11: rNom * rNom, q };
}

function trackerPredict(kf, dt) {
    const { q } = kf;
    kf.d += kf.r * dt;
    kf.P00 += 2 * dt * kf.P01 + dt * dt * kf.P11 + q * dt * dt * dt / 3;
    kf.P01 += dt * kf.P11 + q * dt * dt / 2;
    kf.P11 += q * dt;
}

// Measurement update with a fitted thickness z of variance R (nm²).
function trackerUpdate(kf, z, R) {
    const S = kf.P00 + R;
    const K0 = kf.P00 / S;
    const K1 = kf.P01 / S;
    const y = z - kf.d;
    kf.d += K0 * y;
    kf.r += K1 * y;
    kf.P11 -= K1 * kf.P01;
    kf.P01 *= 1 - K0;
    kf.P00 *= 1 - K0;
}

// Cut rule on the tracker, `tau` = seconds until the tracked thickness
// reaches the target. A scan is near when the target is at most confirmScans
// scans ahead. Once confirmScans consecutive scans were near and the target
// falls before the next scan, the shutter closes `tau` after this scan, or
// at once when the target has already passed. Returns that wait (s) or null.
function cutWait(rule, tau, dt, confirmScans) {
    rule.near = tau <= confirmScans * dt ? rule.near + 1 : 0;
    if (rule.near < confirmScans || tau >= dt) return null;
    return Math.max(0, tau);
}

// One scan at time t: the measured spectrum of the chamber's stack, the
// monitor's fitted thickness of the growing layer and that fit's variance.
// The variance's difference quotient spans a quarter of the fit's grid step,
// well inside one fringe valley.
function scanEstimate(s, t_global) {
    const T_true = s.truthEval.sample(s.char, s.pol, s.truthMat, s.chamber.d);
    const T_meas = buildMeasuredSpectrum(T_true, s, t_global);
    const sampleModel = (d) => s.modelEval.sample(s.char, s.pol, s.modelMat, d);
    const z = fit1DThickness({ sampleModel, T_meas, dLo: 0, dHi: s.dHiCap, step: s.step });
    return { z, R: fitVariance({ sampleModel, T_meas, d: z, h: s.step / 4 }) };
}

// Scan loop for one layer. The chamber grows between scans and the tracker
// follows on the nominal clock; from the scan at which that clock reaches
// fitStartFrac of the target the monitor fits every scan, updates the
// tracker and applies the cut rule. Without a cut inside the scan budget the
// shutter closes at the last scan.
function runScanLoop(s, p) {
    const { dt, d_target, confirmScans, fitStartFrac, rateSpec, rng } = p;
    const kf = createTracker(s.rNom, rateSpec);
    const rule = { near: 0 };
    let t_global = p.t_global;
    for (let k = 1; k <= s.maxScans; k++) {
        const t = k * dt;
        growLayer(s.chamber, dt, rateSpec, rng);
        trackerPredict(kf, dt);
        t_global += dt;
        if (t * s.rNom < fitStartFrac * d_target) continue;

        const { z, R } = scanEstimate(s, t_global);
        trackerUpdate(kf, z, R);
        const b = kf.r > 0 ? kf.r : s.rNom;
        const wait = cutWait(rule, (d_target - kf.d) / b, dt, confirmScans);
        if (wait !== null) {
            growLayer(s.chamber, wait, rateSpec, rng);
            return { cut_time: t + wait, cut_d_hat: kf.d + b * wait, t_global: t_global + wait };
        }
    }
    return { cut_time: s.maxScans * dt, cut_d_hat: kf.d, t_global };
}

export function runBroadbandLayerCut(p) {
    const {
        theta, incMat, subMat, subThickMM, truthMats, modelMats, i,
        truthThicksBelow, modelThicksBelow, lambdas, char, pol,
        chamber, rateSpec, dt, d_target, dHiCap,
        randomPct, absNoisePct = 0, driftSlope, rng,
    } = p;

    // Scan budget from the monitor's nominal clock: twice the nominal time,
    // or 10 nm past the target at the nominal rate for a short layer.
    const rNom = Math.max(1e-6, rateSpec.mean);
    const tNom = d_target / rNom;
    const maxScans = Math.max(2, Math.ceil(Math.max(2 * tNom, tNom + 10 / rNom) / dt));

    // The layers already deposited below the growing layer are fixed for the
    // whole of this layer, so each evaluator caches their characteristic-
    // matrix product once and varies only the growing layer, O(Nλ) per
    // evaluation. Deposition runs substrate-first, so the layers beneath
    // layer `i` are the higher storage indices i+1…N-1 (storage is
    // air→substrate). Declared outside the try so the finally can release
    // whichever of the two exists: the evaluators hold kernel-side state when
    // the WASM growing evaluator is active.
    let truthEval = null;
    let modelEval = null;
    try {
        truthEval = createMonitorTmmEvaluator(theta, incMat, subMat, truthMats.slice(i + 1), truthThicksBelow, lambdas, subThickMM ?? 1);
        modelEval = createMonitorTmmEvaluator(theta, incMat, subMat, modelMats.slice(i + 1), modelThicksBelow, lambdas, subThickMM ?? 1);
        return runScanLoop({
            truthEval, modelEval, truthMat: truthMats[i], modelMat: modelMats[i], char, pol,
            chamber, rNom, maxScans, dHiCap, step: fitGridStep(modelMats[i], lambdas),
            noiseStdFrac: randomPct / 100, absNoiseFrac: absNoisePct / 100, driftSlope, rng,
        }, p);
    } finally {
        // Unconditional release; the JS evaluators have no free and nothing
        // to release.
        truthEval?.free?.();
        modelEval?.free?.();
    }
}
