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
 * v1 scope:
 *   - Front-only coatings (back-coating monitoring deferred).
 *   - Single AOI, single polarization, T or R only.
 *   - Per-material random Δn, Δk (one draw per run; per-material or per-layer).
 *   - Per-material deposition-rate mean + RMS (white Gaussian — no temporal
 *     correlation in v1; the correlation-time feature is deferred).
 *   - Random multiplicative measurement noise on the spectrum.
 *   - Optional linear drift component on the spectrum.
 *   - Monte Carlo over N runs → Welford-accumulated as-built T/R/A corridor
 *     (mean ± kσ), per-layer thickness statistics, and yield (% of runs whose
 *     as-built merit function stays ≤ tolerance).
 *
 * Deferred:
 *   - Shutter delay (mean + RMS).
 *   - Drift/calibration drift (only random + simple linear drift in v1).
 *   - Rate temporal correlation (Markov / Ornstein-Uhlenbeck process).
 *   - Systematic inhomogeneity through layer depth.
 *   - AOI sweeps in the scan band.
 *   - Back-side coating monitoring.
 *
 * References:
 *   - A. V. Tikhonravov & M. K. Trubetskov, "Computational manufacturing as a
 *     bridge between design and production," Appl. Opt. 44, 6877 (2005).
 *   - H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12 (Production
 *     monitoring).
 */

import { tmmAvg, createMonitorTmmEvaluator } from '../physics/thinFilmMath.js';
import {
    buildEvalContext,
    evaluateOperands,
    calcMF,
    requiredLambdas as requiredOperandLambdas,
} from '../physics/optimizer.js';

// ── RNG: seedable Mulberry32 + Box-Muller Gaussian draw ──────────────────────
//
// Deterministic per-run seeds enable two things:
//   1. bit-identical results between the serial path and the worker-pool path
//      (each trial is seeded from a stable derivation of cfg.seed + runIdx);
//   2. reproducible bug reports — a failed yield run can be replayed exactly
//      by re-feeding the seed.
//
// Mulberry32 is a small fast PRNG with 2³² period; that's plenty for one trial
// (MMS/BBM uses O(10³) draws per run). We split a global cfg.seed into per-run
// seeds with splitmix32-style mixing so adjacent runs are uncorrelated.

export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Derive a per-run seed from a base seed + run index. splitmix32 — large
// jumps in seed space for small jumps in input.
export function deriveSeed(base, runIdx) {
    let x = ((base >>> 0) + Math.imul(runIdx | 0, 0x9E3779B1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21F0AAAD);
    x = Math.imul(x ^ (x >>> 15), 0x735A2D97);
    return (x ^ (x >>> 15)) >>> 0;
}

function gauss2(rng) {
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const ang = 2 * Math.PI * u2;
    return [mag * Math.cos(ang), mag * Math.sin(ang)];
}

function gauss(rng) {
    return gauss2(rng)[0];
}

// ── Ornstein–Uhlenbeck correlated-rate process ───────────────────────────────
//
// Real deposition rates fluctuate as a *stationary, temporally correlated*
// random process (correlation time of several seconds — a
// "Fluctuations / Corr. time" parameter), NOT as white noise. We model this with
// an Ornstein–Uhlenbeck (OU) process: the mean-reverting Gaussian process
// whose exact discrete update over a step Δt is
//
//     r_{k+1} = mean + a·(r_k − mean) + σ·√(1−a²)·N(0,1),   a = e^{−Δt/τ}
//
// which preserves the stationary mean `mean` and stationary std `σ` for any Δt
// and any correlation time τ.  As τ→0 the decay a→0 and the update collapses to
// independent white draws  r = mean + σ·N(0,1)  — exactly the v1 behavior — so
// callers that pass τ=0 (or omit it) are bit-identical to the old white model.
//
// Reference: Gillespie, "Exact numerical simulation of the Ornstein-Uhlenbeck
// process and its integral," Phys. Rev. E 54, 2084 (1996), Eq. (2.13).

/**
 * One exact OU step. `a = exp(-dt/tau)`; pass a precomputed `a` to avoid recompute.
 * @returns next process value.
 */
export function ouStep(prev, mean, sigma, a, rng) {
    if (sigma <= 0) return mean;
    if (!(a > 0)) return mean + gauss(rng) * sigma;          // τ→0 ⇒ white
    return mean + a * (prev - mean) + Math.sqrt(Math.max(0, 1 - a * a)) * sigma * gauss(rng);
}

/**
 * Sample a stationary OU rate path r(t) on a uniform time grid — used to
 * preview the simulated deposition-rate fluctuations (page 1 of the wizard).
 *
 * @param {number} mean   stationary mean rate
 * @param {number} sigma  stationary rms fluctuation
 * @param {number} tau    correlation time (same time unit as dt); τ≤0 ⇒ white
 * @param {number} dt     time step
 * @param {number} n      number of samples
 * @param {Function} rng  Math.random-style draw
 * @returns {{ t: number[], r: number[] }}
 */
export function sampleOURatePath(mean, sigma, tau, dt, n, rng = Math.random) {
    const a = tau > 0 ? Math.exp(-dt / tau) : 0;
    const t = new Array(n);
    const r = new Array(n);
    // Start from a stationary draw so the path doesn't relax from the mean.
    let cur = sigma > 0 ? mean + gauss(rng) * sigma : mean;
    for (let i = 0; i < n; i++) {
        t[i] = i * dt;
        r[i] = cur;
        cur = ouStep(cur, mean, sigma, a, rng);
    }
    return { t, r };
}

// ── Spectrum sampler at arbitrary wavelength array ────────────────────────────

/**
 * Sample one spectral characteristic (T, R, or A) on an explicit λ array.
 * Returns a Float64Array of length lambdas.length.
 *
 * This bypasses evaluateSpectrum's auto-built grid because the monitoring scan
 * band has its own λ_min / λ_max / nPoints (linear in λ) that doesn't need to
 * align with the user's spectrum-display grid.
 */
function sampleChar(lambdas, theta, pol, char,
                    incMat, subMat, frontMats, frontThicks) {
    const out = new Float64Array(lambdas.length);
    const layers = [];
    for (let i = 0; i < frontMats.length; i++) {
        if (frontThicks[i] > 0) {
            layers.push({ mat: frontMats[i], d: frontThicks[i] });
        }
    }

    for (let li = 0; li < lambdas.length; li++) {
        const lam = lambdas[li];
        const n0 = incMat.getNK(lam);
        const ns = subMat.getNK(lam);
        const lNDs = layers.map(l => ({ n: l.mat.getNK(lam), d: l.d }));
        const res = tmmAvg(lam, theta, n0, ns, lNDs);
        let v;
        if (char === 'T')      v = pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
        else if (char === 'R') v = pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
        else                   v = pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
        out[li] = v;
    }
    return out;
}

/**
 * 1-D thickness fit by golden-section + parabolic refinement.
 *
 * Minimizes  f(d) = Σ_λ (T_meas[λ] − T_model(d, λ))²  over d ∈ [dLo, dHi].
 *
 * Bounded Brent-style search; ~20 evaluations typical, each evaluation is one
 * TMM sweep across the scan band. We don't need very high precision — sub-nm
 * is more than enough to drive a cut decision.
 */
function fit1DThickness({
    sampleModel,
    T_meas,
    dLo, dHi, dGuess,
    maxIter = 14, tol = 0.05,    // 0.05 nm tolerance, ~14 golden steps for cut decision
}) {
    // Residual sum-of-squares at thickness d. `sampleModel(d)` returns the model
    // characteristic over the scan grid with the growing layer at thickness d —
    // an O(Nλ) incremental evaluation (the completed-stack matrix is cached by
    // the caller's evaluator) instead of a full-stack TMM sweep. Bit-identical to
    // the old sampleChar(... [completed…, currentMat], [prevThicks…, d]).
    const f = (d) => {
        const Tm = sampleModel(Math.max(0, d));
        let ss = 0;
        for (let i = 0; i < Tm.length; i++) {
            const r = T_meas[i] - Tm[i];
            ss += r * r;
        }
        return ss;
    };

    // Golden-section search, optionally seeded by dGuess.
    // We bracket the minimum by stepping out from dGuess in both directions
    // until f stops decreasing (or we hit the bounds), then golden-section
    // within the bracket.
    let a = dLo, b = dHi;
    if (dGuess != null && dGuess > dLo && dGuess < dHi) {
        // Try to tighten bracket around dGuess: step ±width
        const width = Math.max(2.0, (dHi - dLo) * 0.05);   // initial step ~ 2 nm or 5% of band
        let xL = Math.max(dLo, dGuess - width);
        let xR = Math.min(dHi, dGuess + width);
        let fL = f(xL), fM = f(dGuess), fR = f(xR);
        // If guess is best, tight bracket
        if (fM < fL && fM < fR) {
            a = xL; b = xR;
        } else if (fL < fM) {
            // Minimum likely to the left → expand left
            a = dLo; b = dGuess;
        } else {
            a = dGuess; b = dHi;
        }
    }

    // Golden-section search on [a, b]
    const phi = (Math.sqrt(5) - 1) / 2;          // ~0.618
    let x1 = b - phi * (b - a);
    let x2 = a + phi * (b - a);
    let f1 = f(x1), f2 = f(x2);
    for (let it = 0; it < maxIter; it++) {
        if (b - a < tol) break;
        if (f1 < f2) {
            b = x2; x2 = x1; f2 = f1;
            x1 = b - phi * (b - a);
            f1 = f(x1);
        } else {
            a = x1; x1 = x2; f1 = f2;
            x2 = a + phi * (b - a);
            f2 = f(x2);
        }
    }
    return 0.5 * (a + b);
}

// ── Material perturbation proxy (same idea as errorAnalysis.js) ───────────────

export function makeShiftedMaterial(baseMat, dn, dk) {
    if (!dn && !dk) return baseMat;
    return {
        ...baseMat,
        getNK: (lam) => {
            const [n, k] = baseMat.getNK(lam);
            // k ≥ 0 — a non-absorbing material can't become "negatively absorbing"
            const kOut = Math.max(0, k + dk);
            return [n + dn, kOut];
        },
    };
}

// ── Single-run simulator ──────────────────────────────────────────────────────

/**
 * Simulate one deposition run.
 *
 * @param {object} design        TFStudio design object (CLAUDE.md schema)
 * @param {Function} resolveMat  id → material object (with `.getNK(λ)`)
 * @param {object} cfg
 *   - rates:            Map<materialId, { mean: nm/s, sigma: nm/s }>
 *                       per-material deposition-rate stats. Missing materials
 *                       default to { mean: 0.5, sigma: 0 }.
 *   - sigmaReN:         absolute σ on Re(n) per-material (default 0)
 *   - sigmaImN:         absolute σ on Im(n) per-material (default 0)
 *   - perMaterial:      true → one Δn/Δk draw shared across all layers of the
 *                       same material id (default true)
 *   - sigmaThkAbsNm:    extra additive σ on as-built thickness (nm), independent
 *                       of monitoring (e.g. shutter jitter). Default 0.
 *   - sigmaThkRelPct:   extra relative σ on as-built thickness (%). Default 0.
 *   - mon: monitoring system config
 *       - char:        'T' | 'R'           (default 'T')
 *       - theta:       deg                  (default 0)
 *       - polarization:'s'|'p'|'avg'       (default 'avg')
 *       - lambdaStart, lambdaEnd: nm        (default 400, 1000)
 *       - nPoints:     samples per scan     (default 41)
 *       - scanIntervalSec: time between scans (default 0.5)
 *       - confirmScans: # consecutive scans with d_hat ≥ d_target needed to
 *                       trigger cut (default 2). Suppresses single-scan
 *                       outliers from noisy spectra.
 *   - sig: signal-error config
 *       - randomPct:   per-point Gaussian random noise (% of signal). Default 1.
 *       - driftPctPer1000s: linear drift (additive percentage points per 1000 s)
 *                          drawn once per run as N(0, driftPctPer1000s/√3) and
 *                          accumulated linearly. Default 0.
 *   - rng:             Math.random()-style function (default Math.random)
 *
 * @returns {{
 *   asBuiltFront: number[],     // as-built thickness per front layer (nm)
 *   targetFront:  number[],     // theoretical target thickness per layer
 *   matDeltas:    {dn:number,dk:number}[],   // per-layer Δn, Δk applied
 *   cutTimes:     number[],     // cut time per layer (s)
 *   rates:        number[],     // realized rate per layer (nm/s)
 * }}
 */
export function simulateRun(design, resolveMat, cfg) {
    const rng           = cfg.rng || Math.random;
    const rates         = cfg.rates || new Map();
    const sigmaReN      = cfg.sigmaReN ?? 0;
    const sigmaImN      = cfg.sigmaImN ?? 0;
    const perMaterial   = cfg.perMaterial != null ? !!cfg.perMaterial : true;
    const sigmaThkAbsNm = cfg.sigmaThkAbsNm ?? 0;
    const sigmaThkRelPct = cfg.sigmaThkRelPct ?? 0;
    const mon           = cfg.mon || {};
    const sig           = cfg.sig || {};
    const char          = mon.char || 'T';
    const theta         = mon.theta ?? 0;
    const pol           = mon.polarization || 'avg';
    const lamA          = mon.lambdaStart ?? 400;
    const lamB          = mon.lambdaEnd ?? 1000;
    const nPoints       = Math.max(3, mon.nPoints ?? 41);
    const dt            = Math.max(1e-6, mon.scanIntervalSec ?? 0.5);
    const confirmScans  = Math.max(1, Math.floor(mon.confirmScans ?? 2));
    const randomPct     = sig.randomPct ?? 1.0;
    const driftPctPer1000s = sig.driftPctPer1000s ?? 0;
    // Shutter delay: the shutter does not close instantly at
    // the cut decision, so a small extra thickness r·delay is deposited. The
    // delay itself is N(mean, rms²) seconds, drawn once per layer.
    const shutterMeanS  = cfg.shutterDelayMeanS ?? 0;
    const shutterRmsS   = cfg.shutterDelayRmsS  ?? 0;
    // Layers monitored by other means (time / quartz) are excluded from the
    // broadband fit; their thickness error is driven purely by a relative
    // thickness-error spec. `excludeLayers` is a Set of front-layer indices;
    // `relThkErrByLayer` is a per-layer % (index-aligned to front layers).
    const excludeLayers     = cfg.excludeLayers || null;
    const relThkErrByLayer  = cfg.relThkErrByLayer || null;
    const recordTrajectory  = !!cfg.recordTrajectory;

    // Build scan λ grid (uniform in λ)
    const lambdas = new Float64Array(nPoints);
    const stepLam = (lamB - lamA) / (nPoints - 1);
    for (let i = 0; i < nPoints; i++) lambdas[i] = lamA + i * stepLam;

    const incId  = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = (design.frontLayers || []).map(l => ({ ...l }));
    const N = front.length;

    // ── Draw per-material Δn, Δk for this run ─────────────────────────────────
    const matIds = new Set();
    for (const l of front) matIds.add(l.material);

    // Per-material refractive-index deviation specs. When
    // provided, each material gets a SYSTEMATIC offset (reNSyst, deterministic)
    // plus a RANDOM draw N(0, reNRand²); `systInh` (%) is the systematic
    // inhomogeneity, recorded for reporting. Falls back to the global
    // sigmaReN/sigmaImN model when `matDev` is absent (keeps MC bit-identical).
    const matDev = cfg.matDev || null;
    const drawMatDelta = (id) => {
        if (matDev && matDev.has(id)) {
            const dv = matDev.get(id);
            const dn = (dv.reNSyst || 0) + (dv.reNRand > 0 ? gauss(rng) * dv.reNRand : 0);
            const dk = (dv.imNSyst || 0) + (dv.imNRand > 0 ? gauss(rng) * dv.imNRand : 0);
            return { dn, dk, inh: dv.systInh || 0 };
        }
        const dn = sigmaReN > 0 ? gauss(rng) * sigmaReN : 0;
        const dk = sigmaImN > 0 ? gauss(rng) * sigmaImN : 0;
        return { dn, dk, inh: 0 };
    };

    const matDraws = new Map();    // id → { dn, dk, inh }
    if (perMaterial) {
        for (const id of matIds) matDraws.set(id, drawMatDelta(id));
    }

    // Truth materials (perturbed) and model materials (nominal)
    const modelMats = front.map(l => resolveMat(l.material));
    const layerDeltas = new Array(N);
    const truthMats = front.map((l, i) => {
        const d = perMaterial ? matDraws.get(l.material) : drawMatDelta(l.material);
        const dn = d?.dn ?? 0, dk = d?.dk ?? 0, inh = d?.inh ?? 0;
        layerDeltas[i] = { dn, dk, inh };
        return makeShiftedMaterial(modelMats[i], dn, dk);
    });

    // ── Draw drift rate (once per run) ────────────────────────────────────────
    // Linear in time, additive to T_meas. driftPctPer1000s is a tolerance; we
    // draw the actual drift slope from N(0, σ_drift) so the corridor is symmetric.
    // Convert to fraction-per-second:  slope = drawn_pct / 100 / 1000
    const driftSlope = driftPctPer1000s > 0
        ? (gauss(rng) * driftPctPer1000s) / 100 / 1000
        : 0;

    // ── Layer-by-layer deposition ─────────────────────────────────────────────
    const asBuilt = new Array(N);
    const cutTimes = new Array(N);
    const realizedRates = new Array(N);
    const estimated = recordTrajectory ? new Array(N) : null;   // monitor d_hat at cut
    let t_global = 0;       // cumulative time across all layers (for drift)

    // OU rate-process state: last realized rate + last deposition time per
    // material id, so the realized per-layer rate is temporally correlated
    // across layers of the same material at the user's correlation time.
    const ouRate    = new Map();   // matId → last realized rate
    const ouLastT   = new Map();   // matId → cumulative time at last deposition
    let tElapsed = 0;              // cumulative deposition time at layer start

    // Truth-side previous layers' as-built thicknesses (used for the TRUE scan)
    const truthThicksPrev = [];

    // Model-side previous layers' as-built thicknesses — what the monitor "knows"
    // it deposited. v1 assumes monitor tracks its own as-built (i.e., uses the
    // SAME as-built thicknesses for the model). This is the standard BBM
    // assumption: previous layers are fixed history.
    const modelThicksPrev = [];

    for (let i = 0; i < N; i++) {
        const layer = front[i];
        const d_target = Math.max(0, layer.thickness || 0);
        const matId    = layer.material;

        // Deactivated / zero-thickness layer: deposit NOTHING. Without this guard
        // the cut search runs on a 0-target layer and the confirmScans fallback
        // (d_hat ≥ d_target=0 is immediately true) can deposit spurious material.
        // The monochromatic engines already guard this (monoSim.js: `d_target>0`).
        if (d_target <= 0) {
            realizedRates[i] = 0;
            asBuilt[i] = 0;
            cutTimes[i] = 0;
            if (estimated) estimated[i] = 0;
            truthThicksPrev.push(0);
            modelThicksPrev.push(0);
            if (cfg.onLayer) cfg.onLayer(i + 1, N);
            continue;
        }
        const rateSpec = rates.get(matId) || { mean: 0.5, sigma: 0 };
        // Realized rate for this layer (clipped to > 0). Correlated in time via
        // an OU process at the material's correlation time τ; with τ≤0 the first
        // rng draw reduces EXACTLY to the v1 white draw  mean + σ·N(0,1)  so
        // existing Monte-Carlo runs (which pass no corrTime) stay bit-identical.
        const tau  = rateSpec.corrTime ?? 0;
        const prev = ouRate.get(matId);
        let r;
        if (prev === undefined) {
            // First layer of this material — stationary draw (= old white draw).
            r = rateSpec.mean + (rateSpec.sigma > 0 ? gauss(rng) * rateSpec.sigma : 0);
        } else {
            const dtc = Math.max(0, tElapsed - (ouLastT.get(matId) ?? 0));
            const a = tau > 0 ? Math.exp(-dtc / tau) : 0;
            r = ouStep(prev, rateSpec.mean, rateSpec.sigma, a, rng);
        }
        if (r <= 1e-6) r = Math.max(1e-6, rateSpec.mean);   // prevent zero/negative rates
        ouRate.set(matId, r);
        realizedRates[i] = r;

        // Cut search bounds: 0 to ~5× target (allow large overshoot)
        const dHiCap = Math.max(d_target * 3, d_target + 50);

        // Time to reach the target at the actual rate (purely theoretical reference)
        const t_target = d_target / r;
        // Cap simulation time: at worst, scan until we're 50% over target
        const t_max = Math.max(t_target * 2.0, t_target + 10 / r);
        const maxScans = Math.max(2, Math.ceil(t_max / dt));

        let d_hat_prev = 0;
        // Default fallback when the fit never confirms a crossing within the
        // simulation budget — dead-reckoning by the nominal rate (the realized
        // rate r is what the chamber knows about; in practice a real plant
        // also tracks the deposition rate from a separate signal). This gives
        // a fallback as-built equal to r·t_target = d_target on the realized
        // rate, NOT to d_target verbatim, so the as-built still varies with
        // any rate jitter.
        let cut_time = t_target;
        let cut_d_actual = r * t_target;
        let cut_d_hat = d_target;          // monitor's estimate at cut (fallback: believes target hit)
        let aboveCount = 0;                // consecutive scans with d_hat ≥ d_target

        // Layers monitored by other means (time / quartz crystal) are excluded
        // from the broadband fit. Their as-built thickness deviates from target
        // only by the supplementary monitoring's relative thickness error.
        const isExcluded = !!(excludeLayers && excludeLayers.has(i));
        if (isExcluded) {
            const relPct = relThkErrByLayer ? (relThkErrByLayer[i] || 0) : 0;
            const relErr = relPct > 0 ? gauss(rng) * relPct / 100 : 0;
            cut_d_actual = Math.max(0, d_target * (1 + relErr));
            cut_time = cut_d_actual / r;
            cut_d_hat = d_target;
        }

        // Performance: only run the (expensive) spectral fit when the actual
        // thickness is close enough to the target that a fit *could* return
        // d_hat ≥ d_target. Before that, just step the simulation. This is a
        // pure speedup — the early-deposition fits would never trigger a cut
        // anyway (d_hat closely tracks d_actual under noise, and d_actual ≪
        // d_target by construction). Real BBM systems do continuously fit but
        // with O(1) Kalman-style updates; we'd need a worker to do that
        // affordably in JS. The threshold is fitStartFrac of d_target.
        // `fitStartFrac` (default 0.6) and the golden-section iteration count
        // (`fitMaxIter`, default 14) are the two dominant cost levers — the live
        // single-run wizard raises the former and lowers the latter for an
        // interactive Start; the Monte-Carlo path passes neither, so its results
        // are unchanged.
        const fitStartFrac = cfg.fitStartFrac ?? 0.6;
        const fitMaxIter   = cfg.fitMaxIter ?? 14;

        // Fast monitoring: the layers already deposited below the
        // growing layer are FIXED for the whole of this layer, so cache their
        // characteristic-matrix product ONCE and vary only the growing top layer
        // per scan / per golden-section step — O(Nλ) per evaluation instead of
        // O(Nλ·i). Bit-identical to the old per-scan full-stack sampleChar
        // (matrix associativity). truth*/model* prev arrays are pushed only AFTER
        // this layer's loop, so they are constant here.
        const truthEval = isExcluded ? null
            : createMonitorTmmEvaluator(theta, incMat, subMat, truthMats.slice(0, i), truthThicksPrev, lambdas);
        const modelEval = isExcluded ? null
            : createMonitorTmmEvaluator(theta, incMat, subMat, modelMats.slice(0, i), modelThicksPrev, lambdas);

        // Loop over scan times (skipped entirely for excluded layers)
        for (let k = 1; !isExcluded && k <= maxScans; k++) {
            const t = k * dt;
            const d_actual_k = r * t;
            t_global += dt;

            // Skip the fit if we're far from target — pure performance gate.
            if (d_actual_k < fitStartFrac * d_target) continue;

            // True (noisy-free) scan: truth materials, truth previous + current
            // actual — incremental (only the growing layer varies per scan).
            const T_true = truthEval.sample(char, pol, truthMats[i], d_actual_k);

            // Add measurement noise:
            //   T_meas(λ) = T_true(λ) · (1 + ε_rnd) + drift · t_global
            // Multiplicative random noise (% of signal) is a reasonable model
            // for a spectrophotometer where shot noise scales with intensity.
            const T_meas = new Float64Array(T_true.length);
            const noiseStdFrac = randomPct / 100;
            for (let li = 0; li < T_true.length; li++) {
                const eps = noiseStdFrac > 0 ? gauss(rng) * noiseStdFrac : 0;
                T_meas[li] = T_true[li] * (1 + eps) + driftSlope * t_global;
            }

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

            // Cut decision: require `confirmScans` consecutive scans where
            // d_hat ≥ d_target. This suppresses single-scan outliers from a
            // noisy fit (a real BBM controller uses a similar smoothing).
            // No back-extrapolation in v1 — cut error is (cut_d_actual − d_target).
            if (d_hat >= d_target) {
                aboveCount++;
                if (aboveCount >= confirmScans) {
                    cut_time = t;
                    cut_d_actual = d_actual_k;
                    cut_d_hat = d_hat;
                    break;
                }
            } else {
                aboveCount = 0;
            }
            d_hat_prev = d_hat;
        }

        // Apply any extra thickness deviation (independent of monitoring)
        let extra = 0;
        if (sigmaThkAbsNm > 0 || sigmaThkRelPct > 0) {
            const sigma_d = sigmaThkAbsNm + (sigmaThkRelPct / 100) * d_target;
            extra = sigma_d > 0 ? gauss(rng) * sigma_d : 0;
        }

        // Shutter delay: the shutter closes `delay` seconds after the cut
        // decision, depositing an extra r·delay of material. delay ~ N(mean,rms²)
        // (clipped ≥ 0). Drawn only when a delay is configured, so default runs
        // are unaffected.
        let shutterExtra = 0;
        if (shutterMeanS > 0 || shutterRmsS > 0) {
            const delay = Math.max(0, shutterMeanS + (shutterRmsS > 0 ? gauss(rng) * shutterRmsS : 0));
            shutterExtra = r * delay;
        }

        const d_built = Math.max(0, cut_d_actual + extra + shutterExtra);

        asBuilt[i] = d_built;
        cutTimes[i] = cut_time;
        if (estimated) estimated[i] = cut_d_hat;

        // Advance the OU clock: record when this material was last deposited so
        // the next layer of the same material decorrelates over the elapsed time.
        tElapsed += cut_time;
        ouLastT.set(matId, tElapsed);

        // Optional per-layer progress hook (used by the wizard's run worker to
        // drive a progress bar). MC path passes none.
        if (cfg.onLayer) cfg.onLayer(i + 1, N);

        // Update truth and model histories. The monitor's model history is the
        // monitor's BEST ESTIMATE of what it just deposited, which (in our
        // simplification) equals the as-built thickness. This is realistic for
        // BBM: the monitor's fit at cut time gives the estimated thickness,
        // and the monitor uses that estimate going forward.
        truthThicksPrev.push(d_built);
        modelThicksPrev.push(d_built);
    }

    const out = {
        asBuiltFront: asBuilt,
        targetFront:  front.map(l => l.thickness || 0),
        matDeltas:    layerDeltas,
        cutTimes,
        rates:        realizedRates,
    };
    if (recordTrajectory) {
        // Per-layer trajectory for the live deposition view (page 5) and the
        // resulting-performance tables (page 6).
        out.estimatedFront = estimated;
        out.materialsFront = front.map(l => l.material);
    }
    return out;
}

// ── Monte Carlo orchestrator ──────────────────────────────────────────────────

/**
 * Run N broadband-monitoring simulations and accumulate statistics.
 *
 * Computes an as-built design per run, then evaluates its T/R/A spectrum on the
 * USER's display grid (`spectrumParams`) — separate from the monitor's scan
 * grid, so the corridor matches what the user sees in OpticalEvaluation. Welford
 * online accumulation; final corridor is mean ± kσ.
 *
 * Per-layer thickness statistics (mean, std, min, max) are computed across runs.
 *
 * Yield is the fraction of runs whose as-built merit function (re-evaluated
 * against `design.meritOperands`) is ≤ `yieldTolerance`. If the design has no
 * operands, yield is reported as null.
 *
 * @param {object} design
 * @param {Function} resolveMat
 * @param {object} cfg            (see simulateRun for the inner fields)
 *   + nRuns:           number of Monte Carlo runs (default 20)
 *   + corridorSigma:   k in mean ± kσ (default 1)
 *   + char:            'T'|'R'|'A' for the displayed corridor (default mon.char or 'T')
 *   + spectrumParams:  { lambdaStart, lambdaEnd, lambdaStep, theta, polarization } for the display grid
 *   + yieldTolerance:  MF threshold for yield (default 2× theoretical MF)
 *   + onProgress:      callback ({i, total, partial?}) per run
 *
 * @returns {{
 *   lambda:       number[],
 *   theory:       number[],
 *   mean:         number[],
 *   stdev:        number[],
 *   lower:        number[],
 *   upper:        number[],
 *   nRuns:        number,
 *   char:         string,
 *   perLayer: { mean: number[], stdev: number[], absErr: number[], relErr: number[], min: number[], max: number[], target: number[] },
 *   yield:        number|null,
 *   yieldDetails: { mfTheory: number, mfRuns: number[], pass: number, total: number, tol: number },
 * }}
 */
export async function runMonteCarloBBM(design, resolveMat, cfg = {}) {
    const nRuns        = Math.max(1, Math.floor(cfg.nRuns ?? 20));
    const onProgress   = cfg.onProgress || null;
    const shouldCancel = cfg.shouldCancel || (() => false);
    const seedBase     = cfg.seed != null ? (cfg.seed >>> 0) : null;

    const { ctx: displayCtx, theoryY } = buildDisplayCtxBBM(design, resolveMat, cfg);
    const mfTheory = theoryMF(design, resolveMat);
    const yieldTol = cfg.yieldTolerance ?? (mfTheory * 2);
    const operands = design.meritOperands || [];

    const trials = [];
    for (let trial = 0; trial < nRuns; trial++) {
        if (shouldCancel()) break;
        // Yield to the event loop so the UI stays responsive and the progress
        // bar repaints. Each run is heavy; without this the window freezes
        // for the full duration of the MC.
        if (trial > 0) await new Promise(r => setTimeout(r, 0));

        const rng = seedBase != null
            ? mulberry32(deriveSeed(seedBase, trial))
            : Math.random;
        trials.push(runOneTrialBBM(design, resolveMat, cfg, rng, displayCtx, operands));
        if (onProgress) onProgress({ i: trial + 1, total: nRuns });
    }

    return accumulateTrials(trials, design, resolveMat, displayCtx, theoryY, mfTheory, yieldTol);
}

// ── λ-grid helpers (Approach-A pre-sampling contract) ────────────────────────
//
// The worker pool pre-samples every referenced material's [n,k] on the EXACT
// union of λ values these helpers compute. To keep worker results bit-identical
// to the serial path the floats MUST match — same expressions, same rounding.
//
// The contract:
//   • monitorScanLambdas(cfg.mon)  must equal the simulateRun() inner loop.
//   • displayLambdas(spectrumParams) must equal runMonteCarloBBM()'s loop.
//   • requiredOperandLambdas (from optimizer.js) handles operand λs.

export function monitorScanLambdas(monCfg) {
    const lamA    = monCfg.lambdaStart ?? 400;
    const lamB    = monCfg.lambdaEnd   ?? 1000;
    const nPoints = Math.max(3, monCfg.nPoints ?? 41);
    const stepLam = (lamB - lamA) / (nPoints - 1);
    const out = new Array(nPoints);
    for (let i = 0; i < nPoints; i++) out[i] = lamA + i * stepLam;
    return out;
}

export function displayLambdas(spectrumParams) {
    const lA = spectrumParams.lambdaStart ?? 400;
    const lB = spectrumParams.lambdaEnd   ?? 800;
    const dl = spectrumParams.lambdaStep  ?? 5;
    const out = [];
    for (let l = lA; l <= lB + 1e-9; l += dl) {
        out.push(Math.round(l * 1000) / 1000);
    }
    return out;
}

/**
 * Union of every λ a BBM Monte-Carlo run will sample. The worker pool
 * pre-samples each material on exactly this grid.
 */
export function requiredLambdasBBM(cfg) {
    const set = new Set();
    for (const l of monitorScanLambdas(cfg.mon || {})) set.add(l);
    for (const l of displayLambdas(cfg.spectrumParams || {})) set.add(l);
    if (Array.isArray(cfg.operands)) {
        for (const l of requiredOperandLambdas(cfg.operands)) set.add(l);
    }
    return Array.from(set).sort((a, b) => a - b);
}

// ── Single-trial work (shared by serial + parallel paths) ─────────────────────
//
// One Monte-Carlo trial = simulateRun (truth materials + monitor fit + cut) +
// as-built display spectrum (Yi) + as-built MF (for yield). Factored out so
// runMonteCarloBBM and the worker call the same code.
//
// Returns the per-trial payload needed by the main-thread accumulator: per-run
// thicknesses, the display-grid spectrum, and (optionally) the MF. The display
// grid is passed in to avoid recomputing the floats per trial.

export function runOneTrialBBM(design, resolveMat, cfg, rng, displayCtx, operands) {
    const cfg2 = { ...cfg, rng };
    const runResult = simulateRun(design, resolveMat, cfg2);

    const front = design.frontLayers || [];
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const modelMats = front.map(l => resolveMat(l.material));
    const truthMats = front.map((l, i) => makeShiftedMaterial(
        modelMats[i],
        runResult.matDeltas[i].dn,
        runResult.matDeltas[i].dk
    ));

    const spectrum = sampleChar(
        displayCtx.lambdas, displayCtx.theta, displayCtx.pol, displayCtx.char,
        incMat, subMat, truthMats, runResult.asBuiltFront
    );

    let mf = null;
    if (operands && operands.length > 0) {
        const perturbedDesign = {
            ...design,
            frontLayers: front.map((l, i) => ({ ...l, thickness: runResult.asBuiltFront[i] })),
        };
        // Per-layer truthMats override only for materials in this front stack —
        // substrate / incident / back materials still come from the host resolveMat.
        const truthById = new Map();
        for (let i = 0; i < front.length; i++) truthById.set(front[i].material, truthMats[i]);
        const perturbedResolve = (id) => truthById.get(id) || resolveMat(id);
        const ctx  = buildEvalContext(perturbedDesign, perturbedResolve);
        const comp = evaluateOperands(operands, ctx);
        // OPTICAL MF only — drop MNT/MXT penalties. Tolerance / simulator
        // features must reflect spectrum behaviour, not constraint proximity.
        mf = calcMF(operands, comp, { skipConstraints: true });
    }

    return {
        asBuiltFront: runResult.asBuiltFront,
        matDeltas:    runResult.matDeltas,
        cutTimes:     runResult.cutTimes,
        rates:        runResult.rates,
        spectrum:     Array.from(spectrum),
        mf,
    };
}

// ── Main-thread accumulator (Welford over an ordered run list) ────────────────
//
// Given an array of per-trial payloads in run-index order, produce the same
// shape that runMonteCarloBBM returns. Bit-identical to the serial path when
// fed runs in the same order with the same seeds.
function accumulateTrials(trials, design, resolveMat, displayCtx, theoryY, mfTheory, yieldTol) {
    const front = design.frontLayers || [];
    const N = front.length;
    const targetThicks = front.map(l => l.thickness || 0);
    const nLam = displayCtx.lambdas.length;

    const meanY = new Float64Array(nLam);
    const m2Y   = new Float64Array(nLam);
    const sumD  = new Float64Array(N);
    const sumD2 = new Float64Array(N);
    const minD  = new Float64Array(N).fill(Infinity);
    const maxD  = new Float64Array(N).fill(-Infinity);
    const mfRuns = [];

    let runsDone = 0;
    for (const t of trials) {
        if (!t) continue;
        runsDone++;
        const ab = t.asBuiltFront;
        for (let i = 0; i < N; i++) {
            const d = ab[i];
            sumD[i]  += d;
            sumD2[i] += d * d;
            if (d < minD[i]) minD[i] = d;
            if (d > maxD[i]) maxD[i] = d;
        }
        const Yi = t.spectrum;
        for (let i = 0; i < nLam; i++) {
            const x = Yi[i];
            const d1 = x - meanY[i];
            meanY[i] += d1 / runsDone;
            const d2 = x - meanY[i];
            m2Y[i]  += d1 * d2;
        }
        if (t.mf != null) mfRuns.push(t.mf);
    }

    const stdevY = new Float64Array(nLam);
    for (let i = 0; i < nLam; i++) {
        stdevY[i] = runsDone > 0 ? Math.sqrt(m2Y[i] / runsDone) : 0;
    }
    const lower = new Array(nLam), upper = new Array(nLam);
    const k = displayCtx.corridorSigma;
    for (let i = 0; i < nLam; i++) {
        lower[i] = Math.max(0, meanY[i] - k * stdevY[i]);
        upper[i] = Math.min(1, meanY[i] + k * stdevY[i]);
    }

    const meanD = new Array(N), stdevD = new Array(N);
    const absErr = new Array(N), relErr = new Array(N);
    for (let i = 0; i < N; i++) {
        const m = runsDone > 0 ? sumD[i] / runsDone : 0;
        const v = runsDone > 0 ? Math.max(0, sumD2[i] / runsDone - m * m) : 0;
        meanD[i]  = m;
        stdevD[i] = Math.sqrt(v);
        absErr[i] = m - targetThicks[i];
        relErr[i] = targetThicks[i] > 0 ? (absErr[i] / targetThicks[i]) * 100 : 0;
    }

    let yieldFrac = null, pass = 0;
    if (mfRuns.length > 0) {
        for (const mf of mfRuns) if (mf <= yieldTol) pass++;
        yieldFrac = pass / mfRuns.length;
    }

    return {
        lambda:  Array.from(displayCtx.lambdas),
        theory:  Array.from(theoryY),
        mean:    Array.from(meanY),
        stdev:   Array.from(stdevY),
        lower, upper,
        nRuns:   runsDone,
        char:    displayCtx.char,
        perLayer: {
            target: targetThicks,
            mean: meanD, stdev: stdevD,
            absErr, relErr,
            min: Array.from(minD).map(v => v === Infinity ? 0 : v),
            max: Array.from(maxD).map(v => v === -Infinity ? 0 : v),
        },
        yield: yieldFrac,
        yieldDetails: { mfTheory, mfRuns, pass, total: mfRuns.length, tol: yieldTol },
    };
}

// Build the display context + theoretical reference spectrum used by both paths.
function buildDisplayCtxBBM(design, resolveMat, cfg) {
    const corridorChar = cfg.char || (cfg.mon?.char) || 'T';
    const spectrumParams = cfg.spectrumParams || {
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5,
        theta: 0, polarization: 'avg',
    };
    const lambdas = Float64Array.from(displayLambdas(spectrumParams));
    const ctx = {
        lambdas,
        theta:          spectrumParams.theta ?? 0,
        pol:            spectrumParams.polarization || 'avg',
        char:           corridorChar,
        corridorSigma:  cfg.corridorSigma ?? 1.0,
    };

    const front = design.frontLayers || [];
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const modelMats = front.map(l => resolveMat(l.material));
    const targetThicks = front.map(l => l.thickness || 0);
    const theoryY = sampleChar(ctx.lambdas, ctx.theta, ctx.pol, ctx.char,
                               incMat, subMat, modelMats, targetThicks);
    return { ctx, theoryY };
}

// Compute the theoretical merit function (yield baseline).
function theoryMF(design, resolveMat) {
    const operands = design.meritOperands || [];
    if (operands.length === 0) return 0;
    const ctx0  = buildEvalContext(design, resolveMat);
    const comp0 = evaluateOperands(operands, ctx0);
    // Optical merit only — see comment at the per-run mf calculation.
    return calcMF(operands, comp0, { skipConstraints: true });
}

// ── Parallel Monte-Carlo orchestrator (WorkerPool-driven) ─────────────────────
//
// Pre-samples materials, fans `nRuns` across `pool.size` workers in contiguous
// chunks, gathers per-trial payloads, then accumulates Welford in run-index
// order so the answer is bit-identical to running the same seed serial.
//
// Each worker runs `runOneTrialBBM` internally on its assigned chunk and posts
// `{type:'tick', kind:'trial', runIdx, trial}` for every completed trial. The
// orchestrator forwards `onProgress({i, total})` to the UI per tick.
//
// Cancellation = pool.terminate(); pending workers are killed; partial trials
// already received are aggregated and returned.

export async function runMonteCarloBBMParallel(design, resolveMat, cfg, pool) {
    const nRuns = Math.max(1, Math.floor(cfg.nRuns ?? 20));
    const onProgress   = cfg.onProgress || null;
    const shouldCancel = cfg.shouldCancel || (() => false);
    const seedBase     = (cfg.seed ?? 0xC0FFEE) >>> 0;
    const operands     = design.meritOperands || [];

    const { ctx: displayCtx, theoryY } = buildDisplayCtxBBM(design, resolveMat, cfg);
    const mfTheory = theoryMF(design, resolveMat);
    const yieldTol = cfg.yieldTolerance ?? (mfTheory * 2);

    // Pre-sample materials on the union of all λs the worker will touch
    const { collectDesignMaterialIds, buildPresampledTable } = await import('../physics/optimizer.js');
    const lambdas = requiredLambdasBBM({ ...cfg, operands });
    const ids = collectDesignMaterialIds(design);
    const pairs = ids.map(id => ({ id, mat: resolveMat(id) }));
    const materials = buildPresampledTable(lambdas, pairs);

    // Partition nRuns roughly evenly across the pool
    const K = pool.size;
    const chunks = [];
    let cursor = 0;
    for (let w = 0; w < K; w++) {
        const remaining = nRuns - cursor;
        const remWorkers = K - w;
        const sz = Math.ceil(remaining / remWorkers);
        if (sz <= 0) continue;
        chunks.push({ start: cursor, count: sz });
        cursor += sz;
    }

    const trials = new Array(nRuns).fill(null);
    let done = 0;
    let cancelled = false;

    // Strip callbacks before serializing — onProgress/shouldCancel are
    // functions and `Worker.postMessage` will throw on structured clone.
    // (Materials are already plain `{lambdas,n,k}` arrays; design + monTable
    // + rates Map clone fine.)
    const cfgForWorker = { ...cfg };
    delete cfgForWorker.onProgress;
    delete cfgForWorker.shouldCancel;
    delete cfgForWorker.rng;
    const jobs = chunks.map(ch => ({
        cmd: 'bbm',
        materials,
        design,
        cfg: cfgForWorker,
        operands,
        displayCtx: {
            lambdas: Array.from(displayCtx.lambdas),
            theta:   displayCtx.theta,
            pol:     displayCtx.pol,
            char:    displayCtx.char,
        },
        runStart: ch.start,
        runCount: ch.count,
        seedBase,
    }));

    const promises = jobs.map((job, jobIdx) => pool.run(job, (tick) => {
        if (tick.kind === 'trial' && tick.trial) {
            trials[tick.runIdx] = tick.trial;
            done++;
            if (onProgress) onProgress({ i: done, total: nRuns });
            if (shouldCancel()) { cancelled = true; pool.terminate(); }
        }
    }));

    try {
        await Promise.all(promises);
    } catch (e) {
        if (!cancelled) throw e;
    }

    return accumulateTrials(trials, design, resolveMat, displayCtx, theoryY, mfTheory, yieldTol);
}

// ── Single-layer signal preview (no Monte Carlo, no fitting) ──────────────────

/**
 * Generate one "ideal" (noise-free) preview of the monitoring signal for a
 * given layer being deposited, used for UI preview pane ("Preview Layer"
 * feature).
 *
 * Returns spectra at three fractions of the layer thickness (80 %, 90 %, 100 %)
 * for visual orientation — a green/yellow/blue overlay scheme.
 */
export function previewLayerSignal(design, resolveMat, layerIndex, monCfg = {}) {
    const lamA    = monCfg.lambdaStart ?? 400;
    const lamB    = monCfg.lambdaEnd ?? 1000;
    const nPoints = Math.max(3, monCfg.nPoints ?? 41);
    const char    = monCfg.char || 'T';
    const theta   = monCfg.theta ?? 0;
    const pol     = monCfg.polarization || 'avg';

    const lambdas = new Float64Array(nPoints);
    const stepLam = (lamB - lamA) / (nPoints - 1);
    for (let i = 0; i < nPoints; i++) lambdas[i] = lamA + i * stepLam;

    const incId  = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = design.frontLayers || [];
    const modelMats = front.map(l => resolveMat(l.material));
    const i = Math.max(0, Math.min(front.length - 1, layerIndex));
    const d_target = front[i]?.thickness || 0;

    // Previous layers fully grown
    const prevThicks = front.slice(0, i).map(l => l.thickness || 0);

    const sampleAtFrac = (frac) => {
        const dCur = d_target * frac;
        const matsAll = modelMats.slice(0, i + 1);
        const thicksAll = prevThicks.concat([dCur]);
        return Array.from(sampleChar(lambdas, theta, pol, char,
                                      incMat, subMat, matsAll, thicksAll));
    };

    return {
        lambda:   Array.from(lambdas),
        frac80:   sampleAtFrac(0.8),
        frac90:   sampleAtFrac(0.9),
        frac100:  sampleAtFrac(1.0),
        char,
        layerIndex: i,
    };
}
