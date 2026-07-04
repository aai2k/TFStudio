/**
 * Monochromatic Monitoring Simulator.
 *
 * Simulates a deposition process in a vacuum chamber equipped with a SINGLE-
 * wavelength monitoring device (the classical thin-film monitoring method —
 * predates broadband and is still used heavily for quarter-wave stacks where
 * the canonical cut is at a signal extremum).
 *
 * Per-layer monitoring strategy ("Monitoring System"):
 *   - 'turning' — terminate at the next signal extremum (max or min). Standard
 *                 for QW layers; cut is direction-blind once the running
 *                 extremum has been confirmed past by `confirmScans` samples.
 *                 Order 1 (first extremum) only in v1.
 *   - 'level'   — terminate when the signal crosses a target level in the
 *                 expected direction. Used when the layer's cut is NOT at an
 *                 extremum (non-QW, mid-slope). The target level is the
 *                 theoretical signal at d=d_target with nominal materials.
 *   - 'time'    — no signal feedback; cut at d_target / realized_rate. The
 *                 monitor records the calibrated rate but no spectrum. Use
 *                 this for layers excluded from optical monitoring (e.g.
 *                 monitored separately with quartz). v1 still applies the
 *                 user-set rms_rel error on top.
 *
 * Reference: H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12;
 * A. V. Tikhonravov & M. K. Trubetskov, "Computational manufacturing as a
 * bridge between design and production," Appl. Opt. 44, 6877 (2005).
 *
 * v1 scope:
 *   - Front-only coatings.
 *   - Single per-layer monitor λ (constant across the layer; per-layer config).
 *   - 3 strategies: turning / level / time (Swing deferred).
 *   - Same per-material rate (mean + RMS) + per-material Δn,Δk model as BBM.
 *   - Mean shutter delay + RMS — applied post-decision.
 *   - Same Welford as-built spectral corridor on the user's display grid.
 *   - Yield based on as-built MF vs user tolerance.
 *
 * Deferred:
 *   - Swing monitoring (k-th extremum / fractional swing past extremum).
 *   - Multi-extremum (order > 1) turning.
 *   - Witness chip vs direct monitoring distinction (we treat the design
 *     itself as the monitored substrate).
 *   - Rate temporal correlation, calibration drift, shutter delay
 *     auto-correction algorithm. Same v1 deferrals as BBM.
 */

import { tmmAvg } from '../physics/thinFilmMath.js';
import {
    buildEvalContext,
    evaluateOperands,
    calcMF,
    requiredLambdas as requiredOperandLambdas,
} from '../physics/optimizer.js';
import { mulberry32, deriveSeed, displayLambdas } from './monitoringSim.js';

// ── RNG helpers (Box-Muller via Mulberry32; same shape as monitoringSim) ─────

function gauss(rng) {
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function makeShiftedMaterial(baseMat, dn, dk) {
    if (!dn && !dk) return baseMat;
    return {
        ...baseMat,
        getNK: (lam) => {
            const [n, k] = baseMat.getNK(lam);
            return [n + dn, Math.max(0, k + dk)];
        },
    };
}

// ── Single-λ signal sampler ───────────────────────────────────────────────────

function singleSignal(lam, theta, pol, char, incMat, subMat, mats, thicks) {
    const lNDs = [];
    for (let i = 0; i < mats.length; i++) {
        if (thicks[i] > 0) lNDs.push({ n: mats[i].getNK(lam), d: thicks[i] });
    }
    const n0 = incMat.getNK(lam);
    const ns = subMat.getNK(lam);
    const res = tmmAvg(lam, theta, n0, ns, lNDs);
    if (char === 'T') return pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
    if (char === 'R') return pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
    return pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
}

function spectrumOnGrid(lambdas, theta, pol, char, incMat, subMat, mats, thicks) {
    const out = new Float64Array(lambdas.length);
    for (let li = 0; li < lambdas.length; li++) {
        out[li] = singleSignal(lambdas[li], theta, pol, char, incMat, subMat, mats, thicks);
    }
    return out;
}

// ── Per-layer monitor-strategy config (defaults + auto-pick) ─────────────────

/**
 * Default monitor strategy for a layer.
 *
 * Heuristic (matches the standard practice):
 *  - If d_target's optical thickness is within 5% of an integer multiple of
 *    λ_mon/4 → 'turning' (the signal extremum coincides with the cut, max
 *    precision). Use the design reference wavelength λ₀ as monitor λ if not
 *    overridden.
 *  - Else 'level'.
 *
 * The user can override per layer in the UI.
 */
export function autoStrategy(layer, mat, monLambda) {
    const dt = Math.max(0, layer.thickness || 0);
    if (dt <= 0) return 'time';
    let n_at = 1.45;
    try {
        const [n_re] = mat.getNK(monLambda);
        if (Number.isFinite(n_re) && n_re > 0) n_at = n_re;
    } catch (_) { /* keep default */ }
    const qw = monLambda / (4 * n_at);
    const ratio = dt / qw;
    const nearest = Math.round(ratio);
    if (nearest >= 1 && Math.abs(ratio - nearest) < 0.05) return 'turning';
    return 'level';
}

/**
 * Pick the most-sensitive monitoring wavelength for layer `i` —
 * Strategy 1 (Tikhonravov 2006). Returns the λ in the design's spectrum band
 * that maximises |dS/dd_i| evaluated at d = d_target_i, with the previous
 * layers fixed at their nominal thicknesses.
 *
 * Picking λ_mon = design.referenceWavelength for ALL layers (the previous
 * default) is catastrophic for non-QW designs: at the reference wavelength
 * an AR coating is already at the spectral target (R≈0, T≈1) so the signal
 * is at its EXTREMUM and has near-zero slope dS/dd — the cut decision is
 * fundamentally unmonitorable there, and yield collapses to 0% even at zero
 * noise. Strategy 1 forces λ_mon onto a sensitive slope per layer.
 *
 * Reference: Tikhonravov, Trubetskov, Amotchkina,
 *   "Statistical approach to choosing a strategy of monochromatic
 *    monitoring of optical coating production," Appl. Opt. 45, 7863 (2006).
 */
export function pickSensitiveLambda(design, resolveMat, layerIdx,
                                    lambdas, theta, pol, char) {
    const front = design.frontLayers || [];
    if (!front[layerIdx]) return design.referenceWavelength || 550;
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const mats = front.slice(0, layerIdx + 1).map(l => resolveMat(l.material));
    const thicksTarget = front.slice(0, layerIdx + 1).map(l => l.thickness || 0);
    const d = thicksTarget[layerIdx];
    // Numerical derivative dS/dd at d_target — central difference with a tiny
    // step. We only care about the WAVELENGTH that maximises |dS/dd|, so the
    // absolute step doesn't need to be tuned.
    const eps = Math.max(0.05, 0.005 * d);
    let bestLam = lambdas[0];
    let bestSlope = -1;
    for (const lam of lambdas) {
        const tPlus  = thicksTarget.slice(); tPlus[layerIdx]  = d + eps;
        const tMinus = thicksTarget.slice(); tMinus[layerIdx] = d - eps;
        const sP = singleSignal(lam, theta, pol, char, incMat, subMat, mats, tPlus);
        const sM = singleSignal(lam, theta, pol, char, incMat, subMat, mats, tMinus);
        const slope = Math.abs((sP - sM) / (2 * eps));
        if (slope > bestSlope) { bestSlope = slope; bestLam = lam; }
    }
    return bestLam;
}

/**
 * Per-layer signal-quality diagnostics — Entry Variation and Final Swing —
 * from the automatic monitoring strategies (default thresholds:
 * EV ≥ 4%, 20% ≤ swing ≤ 80%). Returns { ev, finalSwing, ok, strategy } so
 * the UI can flag layers that are fundamentally unmonitorable at the chosen
 * wavelength.
 *
 * Swing definition: sample the signal vs growing thickness over [0, dHi]
 * where dHi ≥ 2·d_target. Find the extrema bracketing d_target. Final swing
 * is the position of S(d_target) between those bracketing endpoints (or the
 * scan boundaries if no extremum exists on that side), in [0, 1]. For a
 * sinusoidal-like signal a cut at mid-amplitude → swing ≈ 0.5 (ideal for
 * level monitoring); a cut at an extremum → swing ≈ 0 or 1 (ideal for
 * turning monitoring, terrible for level). A purely monotonic layer (no
 * extrema in scan) gets swing = position of d_target within [0, dHi],
 * which is ~0.5 for typical scans — correctly reflecting the layer is
 * usable for level monitoring (the old code returned 0 here, which falsely
 * flagged perfectly-fine monotonic layers as unmonitorable).
 */
export function monitorSignalQuality(design, resolveMat, layerIdx, lambda,
                                    theta, pol, char, strategy = 'level') {
    const front = design.frontLayers || [];
    if (!front[layerIdx]) return { ev: 0, finalSwing: 0, ok: false, strategy };
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const matsPrev = front.slice(0, layerIdx).map(l => resolveMat(l.material));
    const thicksPrev = front.slice(0, layerIdx).map(l => l.thickness || 0);
    const matCur = resolveMat(front[layerIdx].material);
    const d_target = front[layerIdx].thickness || 0;
    if (d_target <= 0) return { ev: 0, finalSwing: 0, ok: false, strategy };
    const dHi = Math.max(2 * d_target, d_target + 50);
    const NP = 80;
    const ys = new Float64Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        ys[s] = singleSignal(lambda, theta, pol, char, incMat, subMat,
            matsPrev.concat([matCur]), thicksPrev.concat([d]));
    }
    const targetIdx = Math.max(1, Math.min(NP - 2,
        Math.round((d_target / dHi) * (NP - 1))));
    const sEnd = ys[targetIdx];
    let yMin = Infinity, yMax = -Infinity;
    for (let s = 0; s < NP; s++) { if (ys[s] < yMin) yMin = ys[s]; if (ys[s] > yMax) yMax = ys[s]; }
    const fullRange = yMax - yMin;
    if (fullRange <= 1e-9) return { ev: 0, finalSwing: 0, ok: false, strategy };

    // Find all extrema in the scan; record those left/right of d_target.
    let extLeftIdx = -1, extRightIdx = -1, firstExtIdx = -1;
    for (let s = 1; s < NP - 1; s++) {
        const a = ys[s-1], b = ys[s], cv = ys[s+1];
        if ((b > a && b > cv) || (b < a && b < cv)) {
            if (firstExtIdx < 0) firstExtIdx = s;
            if (s <= targetIdx) extLeftIdx = s;
            else if (extRightIdx < 0) { extRightIdx = s; }
        }
    }

    // Bracketing endpoints for the swing calculation. If the cut is between
    // two extrema, swing measures position between them. If only one side has
    // an extremum, the other boundary is the scan endpoint. With no extrema
    // (purely monotonic layer signal), swing is just position within the scan
    // — typically ~0.5 for d_target = dHi/2, correctly indicating mid-slope.
    const sLow  = extLeftIdx  >= 0 ? ys[extLeftIdx]  : ys[0];
    const sHigh = extRightIdx >= 0 ? ys[extRightIdx] : ys[NP - 1];
    const localRange = Math.abs(sHigh - sLow);
    let finalSwing;
    if (localRange > 1e-9) {
        finalSwing = Math.abs(sEnd - sLow) / localRange;
        finalSwing = Math.min(1, Math.max(0, finalSwing));
    } else {
        // Degenerate (sLow ≈ sHigh): cut is essentially at an extremum.
        finalSwing = 0;
    }

    // EV: change from start of layer to first extremum (or end-to-end if no
    // extremum). Always normalized to the full signal range over the scan.
    const ev = firstExtIdx >= 0
        ? Math.abs(ys[0] - ys[firstExtIdx]) / fullRange
        : Math.abs(sEnd - ys[0]) / fullRange;

    // Strategy-aware acceptance:
    //   - level: needs steep slope at cut → swing ∈ [0.2, 0.8]
    //   - turning: needs the cut to coincide with an extremum → swing ≈ 0 or 1
    //   - time: doesn't use signal, so trivially OK.
    let ok;
    if (strategy === 'turning') {
        ok = ev >= 0.04 && (finalSwing <= 0.15 || finalSwing >= 0.85);
    } else if (strategy === 'time') {
        ok = true;
    } else {
        ok = ev >= 0.04 && finalSwing >= 0.2 && finalSwing <= 0.8;
    }
    return { ev, finalSwing, ok, strategy };
}

/**
 * Build the per-layer monitor table from a design. Returns an array of
 * `{ strategy, lambda, level?, sigmaRelPct }` aligned to design.frontLayers.
 *
 * By default lambda = design.referenceWavelength (the classical
 * setup; keeps existing tests stable). Pass
 * `opts.autoPickLambda: true` to use Strategy 1 (most-sensitive wavelength
 * per layer, Tikhonravov 2006) — recommended for the UI initial state so
 * non-QW designs (e.g. AR) don't land on a degenerate λ where the signal is
 * at an extremum and the cut can't be monitored.
 */
export function defaultMonitorTable(design, resolveMat, opts = {}) {
    const ref = design.referenceWavelength || 550;
    const front = design.frontLayers || [];
    if (!opts.autoPickLambda) {
        return front.map(l => {
            const mat = resolveMat(l.material);
            return {
                strategy:    autoStrategy(l, mat, ref),
                lambda:      ref,
                sigmaRelPct: 0,
            };
        });
    }
    const lamA = Number.isFinite(opts.lambdaA) ? opts.lambdaA
        : (Number.isFinite(design.spectrumLambdaStart) ? design.spectrumLambdaStart : 400);
    const lamB = Number.isFinite(opts.lambdaB) ? opts.lambdaB
        : (Number.isFinite(design.spectrumLambdaEnd) ? design.spectrumLambdaEnd : 1000);
    const step = Math.max(5, Math.round((lamB - lamA) / 40));
    const grid = [];
    for (let lam = lamA; lam <= lamB + 1e-6; lam += step) grid.push(lam);
    const theta = opts.theta ?? 0;
    const pol   = opts.pol   || 'avg';
    const char  = opts.char  || 'T';
    return front.map((l, i) => {
        const mat = resolveMat(l.material);
        const pickedLam = pickSensitiveLambda(design, resolveMat, i, grid, theta, pol, char);
        return {
            strategy:    autoStrategy(l, mat, pickedLam),
            lambda:      pickedLam,
            sigmaRelPct: 0,
        };
    });
}

// ── Build expected-direction + level via fine theoretical scan ────────────────
//
// For 'level' mode we need the target level (= theoretical signal at exactly
// d_target with nominal materials and nominal previous as-built) AND the
// expected sign of dS/dd at that point (so a noise-driven crossing in the
// wrong direction doesn't trigger an early cut).
//
// For 'turning' mode we need whether the upcoming extremum is a max or a min.
//
// Sample on a fine grid d ∈ [0, max(2·d_target, d_target+50)] (60 points).
// Cheap — 60 TMMs at one λ per layer, once per RUN (not per scan).

function computeExpected(layer, monCfg, monMat, monLambda, incMat, subMat,
                        modelPrev, modelThicksPrev, theta, pol, char) {
    const dTarget = Math.max(0, layer.thickness || 0);
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 60;
    const ds = new Float64Array(NP);
    const ys = new Float64Array(NP);
    for (let i = 0; i < NP; i++) {
        const d = (i / (NP - 1)) * dHi;
        ds[i] = d;
        const mats = modelPrev.concat([monMat]);
        const thicks = modelThicksPrev.concat([d]);
        ys[i] = singleSignal(monLambda, theta, pol, char, incMat, subMat, mats, thicks);
    }
    // Locate the nearest grid index to d_target
    const targetIdx = Math.max(1, Math.min(NP - 2, Math.round((dTarget / dHi) * (NP - 1))));
    const sAtTarget = ys[targetIdx];
    const dyLeft  = ys[targetIdx]     - ys[targetIdx - 1];
    const dyRight = ys[targetIdx + 1] - ys[targetIdx];
    const slope   = 0.5 * (dyLeft + dyRight);

    // Find the first extremum after d ≈ 0 in the model curve
    let firstExtIdx = -1;
    let firstExtIsMax = false;
    for (let i = 1; i < NP - 1; i++) {
        const a = ys[i - 1], b = ys[i], cv = ys[i + 1];
        if ((b > a && b > cv) || (b < a && b < cv)) {
            firstExtIdx   = i;
            firstExtIsMax = (b > a && b > cv);
            break;
        }
    }
    // Signal at d=0 (substrate stack alone, no current layer). Needed by the
    // level-monitoring detector to decide which side of the target the signal
    // starts on — without this the algorithm fires "past target" on the very
    // first sample whenever s_start already happens to be on the past side
    // (extremely common for AR coatings, where the substrate is reflective
    // and the layer can either drive T up or down at any given λ).
    const sStart = ys[0];
    return {
        sAtTarget,
        sStart,
        slopeAtTarget: slope,
        firstExtD:    firstExtIdx >= 0 ? ds[firstExtIdx] : null,
        firstExtIsMax,
    };
}

// ── Single-run simulator ──────────────────────────────────────────────────────

/**
 * @param {object} design
 * @param {Function} resolveMat
 * @param {object} cfg
 *   - monTable:         per-layer monitor config (defaultMonitorTable shape)
 *   - rates:            Map<materialId, { mean, sigma }>
 *   - sigmaReN, sigmaImN, perMaterial:  same as BBM
 *   - shutter:          { meanMs, sigmaMs }  (delay applied after cut decision)
 *   - common:           { thetaDeg, pol, char, scanIntervalSec, confirmScans }
 *   - sig:              { randomPct, driftPctPer1000s }
 *   - rng:              () => [0, 1) (default Math.random)
 *
 * @returns {{ asBuiltFront, targetFront, matDeltas, cutTimes, rates,
 *             cutStrategies }}
 */
export function simulateRunMono(design, resolveMat, cfg) {
    const rng           = cfg.rng || Math.random;
    const rates         = cfg.rates || new Map();
    const sigmaReN      = cfg.sigmaReN ?? 0;
    const sigmaImN      = cfg.sigmaImN ?? 0;
    const perMaterial   = cfg.perMaterial != null ? !!cfg.perMaterial : true;
    const monTable      = cfg.monTable || [];
    const shutter       = cfg.shutter || { meanMs: 0, sigmaMs: 0 };
    const common        = cfg.common  || {};
    const sig           = cfg.sig     || {};
    const theta         = common.thetaDeg ?? 0;
    const pol           = common.pol      || 'avg';
    const char          = common.char     || 'T';
    const dt            = Math.max(1e-6, common.scanIntervalSec ?? 0.5);
    const confirmScans  = Math.max(1, Math.floor(common.confirmScans ?? 2));
    const randomPct     = sig.randomPct ?? 1.0;
    const driftPctPer1000s = sig.driftPctPer1000s ?? 0;

    const incId  = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = (design.frontLayers || []).map(l => ({ ...l }));
    const N = front.length;

    // Per-material Δn, Δk draws (one per run)
    const matIds = new Set();
    for (const l of front) matIds.add(l.material);
    const matDraws = new Map();
    if (perMaterial) {
        for (const id of matIds) {
            const dn = sigmaReN > 0 ? gauss(rng) * sigmaReN : 0;
            const dk = sigmaImN > 0 ? gauss(rng) * sigmaImN : 0;
            matDraws.set(id, { dn, dk });
        }
    }

    const modelMats = front.map(l => resolveMat(l.material));
    const layerDeltas = new Array(N);
    const truthMats = front.map((l, i) => {
        let dn, dk;
        if (perMaterial) {
            const d = matDraws.get(l.material);
            dn = d?.dn ?? 0; dk = d?.dk ?? 0;
        } else {
            dn = sigmaReN > 0 ? gauss(rng) * sigmaReN : 0;
            dk = sigmaImN > 0 ? gauss(rng) * sigmaImN : 0;
        }
        layerDeltas[i] = { dn, dk };
        return makeShiftedMaterial(modelMats[i], dn, dk);
    });

    const driftSlope = driftPctPer1000s > 0
        ? (gauss(rng) * driftPctPer1000s) / 100 / 1000
        : 0;

    const asBuilt = new Array(N);
    const cutTimes = new Array(N);
    const realizedRates = new Array(N);
    const cutStrategies = new Array(N);
    let t_global = 0;

    const truthThicksPrev = [];
    const modelThicksPrev = [];

    for (let i = 0; i < N; i++) {
        const layer = front[i];
        const d_target = Math.max(0, layer.thickness || 0);
        const matId    = layer.material;
        const monRow   = monTable[i] || { strategy: 'time', lambda: 550, sigmaRelPct: 0 };
        const strat    = monRow.strategy || 'time';
        const monLam   = monRow.lambda   || (design.referenceWavelength || 550);
        cutStrategies[i] = strat;

        const rateSpec = rates.get(matId) || { mean: 0.5, sigma: 0 };
        let r = rateSpec.mean + (rateSpec.sigma > 0 ? gauss(rng) * rateSpec.sigma : 0);
        if (r <= 1e-6) r = Math.max(1e-6, rateSpec.mean);
        realizedRates[i] = r;

        const t_target = d_target / r;
        const t_max = Math.max(t_target * 2.0, t_target + 10 / r);
        const maxScans = Math.max(2, Math.ceil(t_max / dt));

        let cut_time = t_target;
        let cut_d_actual = r * t_target;

        if (strat === 'time') {
            // No signal feedback. Cut at theoretical time on the realized rate;
            // apply the per-layer rms-rel extra thickness deviation
            // ("supplementary monitoring types" column).
            const sigmaRel = (monRow.sigmaRelPct ?? 0) / 100;
            const extra = sigmaRel > 0 ? gauss(rng) * sigmaRel * d_target : 0;
            cut_d_actual = Math.max(0, r * t_target + extra);
            cut_time = cut_d_actual / r;
            t_global += t_target;
        } else {
            // Optical monitoring: precompute the expected target level + direction
            // (level mode) or expected extremum direction (turning mode), using
            // NOMINAL materials and the monitor's accumulated AS-BUILT history of
            // previous layers (standard BBM/MMS assumption).
            const expected = computeExpected(layer, monRow, modelMats[i], monLam,
                incMat, subMat, modelMats.slice(0, i), modelThicksPrev,
                theta, pol, char);
            const noiseFracBase = (randomPct / 100);

            // Cut decision state. Single noise spikes can push a raw
            // running-max past the true extremum (and pin the cut time to a
            // spurious sample), so we extremum-track on a SMOOTHED signal: a
            // simple moving average over the last `SMOOTH_W` samples damps
            // any single-point spike by ~1/W. Real BBM controllers do the
            // same (Macleod Ch. 12).
            const SMOOTH_W = Math.max(3, confirmScans + 1);
            const buf = new Array(SMOOTH_W).fill(NaN);
            let bufFill = 0, bufHead = 0;

            // We also clamp the extremum-tracking window to the area where the
            // theoretical model expects an extremum to live (firstExtD ± 30%).
            // Outside that window we still record samples but don't update
            // runMax/runMin, so a noise spike past the extremum can't move
            // runMaxTime forward.
            const extD = expected.firstExtD;
            const trackD0 = extD != null ? Math.max(0, 0.5 * extD) : 0;
            const trackD1 = extD != null ? 1.5 * extD : Infinity;

            let runMaxS = -Infinity, runMinS = Infinity;
            let runMaxTime = 0, runMinTime = 0;
            let runMaxD = 0, runMinD = 0;
            let pastCount = 0;
            let levelCount = 0;

            // Level-monitoring crossing state. The old code checked
            // "s_smooth past target?" each scan, which fired immediately
            // whenever the substrate signal happened to already sit on the
            // past side of sAtTarget — cutting the layer at d ≈ 0. Real
            // level monitors detect a CROSSING: the smoothed signal must
            // actually pass through the target value in the slope-expected
            // direction. Track the previous smoothed diff so we can detect
            // sign changes.
            let prevLevelDiff = null;
            let levelHasCrossed = false;
            // The expected-side direction from start (does the signal need to
            // rise from sStart to sAtTarget, or fall to it?). This is the
            // physically meaningful direction for the cut, not just the
            // sign of the slope at d_target (which can be wrong if sStart
            // is already past target).
            const startToTargetDir = expected.sStart != null
                ? Math.sign(expected.sAtTarget - expected.sStart)
                : (expected.slopeAtTarget >= 0 ? 1 : -1);

            for (let k = 1; k <= maxScans; k++) {
                const t = k * dt;
                const d_actual_k = r * t;
                t_global += dt;

                const truthMatsAll  = truthMats.slice(0, i + 1);
                const truthThicksAll = truthThicksPrev.concat([d_actual_k]);
                const s_true = singleSignal(monLam, theta, pol, char,
                    incMat, subMat, truthMatsAll, truthThicksAll);

                const eps = noiseFracBase > 0 ? gauss(rng) * noiseFracBase : 0;
                const s_meas = s_true * (1 + eps) + driftSlope * t_global;

                // Moving-average smoothing
                buf[bufHead] = s_meas;
                bufHead = (bufHead + 1) % SMOOTH_W;
                if (bufFill < SMOOTH_W) bufFill++;
                let sSum = 0, sCount = 0;
                for (let bi = 0; bi < bufFill; bi++) {
                    const v = buf[bi];
                    if (!Number.isNaN(v)) { sSum += v; sCount++; }
                }
                const s_smooth = sCount > 0 ? sSum / sCount : s_meas;

                // Bounded extremum tracking on the smoothed signal
                if (d_actual_k >= trackD0 && d_actual_k <= trackD1) {
                    if (s_smooth > runMaxS) { runMaxS = s_smooth; runMaxTime = t; runMaxD = d_actual_k; }
                    if (s_smooth < runMinS) { runMinS = s_smooth; runMinTime = t; runMinD = d_actual_k; }
                }

                if (strat === 'turning') {
                    // Past-extremum if the smoothed signal has dropped (or
                    // risen) past the running extremum by more than ~K·σ
                    // of the noise band. Smoothing already kills single-point
                    // spikes so a small threshold is enough.
                    const noiseThresh = Math.max(1e-6,
                        2 * noiseFracBase * Math.abs(s_smooth) / Math.sqrt(Math.max(1, bufFill)) + 1e-4);
                    let pastExtremum = false;
                    let extremumD = d_actual_k;
                    let extremumT = t;
                    if (expected.firstExtIsMax) {
                        if (runMaxS - s_smooth > noiseThresh && bufFill >= SMOOTH_W) {
                            pastExtremum = true;
                            extremumD = runMaxD; extremumT = runMaxTime;
                        }
                    } else {
                        if (s_smooth - runMinS > noiseThresh && bufFill >= SMOOTH_W) {
                            pastExtremum = true;
                            extremumD = runMinD; extremumT = runMinTime;
                        }
                    }
                    if (pastExtremum) {
                        pastCount++;
                        if (pastCount >= confirmScans) {
                            cut_d_actual = extremumD;
                            cut_time = extremumT;
                            break;
                        }
                    } else {
                        pastCount = 0;
                    }
                } else {
                    // 'level' — cut when smoothed signal CROSSES sAtTarget in
                    // the slope-expected direction. A real monitor watches
                    // the signal trajectory and triggers on the transition
                    // through the target value, not on "is the value past
                    // target right now?" — the latter fires on the very first
                    // sample whenever the substrate signal already happens to
                    // sit on the past side (common for AR coatings).
                    const diff = s_smooth - expected.sAtTarget;
                    if (bufFill >= SMOOTH_W) {
                        // Detect a sign change of `diff` in the expected
                        // direction. We use `startToTargetDir` (sign of
                        // sAtTarget − sStart) rather than the slope at
                        // d_target — the former is physically what the
                        // signal will do across the layer, the latter can
                        // disagree near a non-monotonic profile.
                        if (prevLevelDiff !== null && !levelHasCrossed) {
                            const crossedUp   = prevLevelDiff < 0 && diff >= 0;
                            const crossedDown = prevLevelDiff > 0 && diff <= 0;
                            if (startToTargetDir > 0 && crossedUp)   levelHasCrossed = true;
                            if (startToTargetDir < 0 && crossedDown) levelHasCrossed = true;
                            // Direction-agnostic fallback for degenerate
                            // startToTargetDir≈0 (sStart ≈ sAtTarget): a
                            // crossing in either direction counts.
                            if (startToTargetDir === 0 && (crossedUp || crossedDown)) {
                                levelHasCrossed = true;
                            }
                        }
                        prevLevelDiff = diff;

                        if (levelHasCrossed) {
                            levelCount++;
                            if (levelCount >= confirmScans) {
                                cut_d_actual = d_actual_k;
                                cut_time = t;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Shutter delay (mean + RMS) — applies an extra growth period after the
        // cut decision. Mean is deterministic; RMS adds a per-layer N(0,σ) draw.
        if ((shutter.meanMs || 0) > 0 || (shutter.sigmaMs || 0) > 0) {
            const delay_s = ((shutter.meanMs || 0) + gauss(rng) * (shutter.sigmaMs || 0)) / 1000;
            cut_d_actual = Math.max(0, cut_d_actual + r * delay_s);
            cut_time += delay_s;
        }

        asBuilt[i] = cut_d_actual;
        cutTimes[i] = cut_time;
        truthThicksPrev.push(cut_d_actual);
        // Monitor "knows" its as-built (it has the cut decision time × rate).
        modelThicksPrev.push(cut_d_actual);
    }

    return {
        asBuiltFront: asBuilt,
        targetFront:  front.map(l => l.thickness || 0),
        matDeltas:    layerDeltas,
        cutTimes,
        rates:        realizedRates,
        cutStrategies,
    };
}

// ── Single-trial work for the Monte-Carlo orchestrator ────────────────────────

export function runOneTrialMMS(design, resolveMat, cfg, rng, displayCtx, operands) {
    const cfg2 = { ...cfg, rng };
    const runResult = simulateRunMono(design, resolveMat, cfg2);

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

    const spectrum = spectrumOnGrid(
        displayCtx.lambdas, displayCtx.theta, displayCtx.pol, displayCtx.char,
        incMat, subMat, truthMats, runResult.asBuiltFront
    );

    let mf = null;
    if (operands && operands.length > 0) {
        const perturbedDesign = {
            ...design,
            frontLayers: front.map((l, i) => ({ ...l, thickness: runResult.asBuiltFront[i] })),
        };
        const truthById = new Map();
        for (let i = 0; i < front.length; i++) truthById.set(front[i].material, truthMats[i]);
        const perturbedResolve = (id) => truthById.get(id) || resolveMat(id);
        const ctx  = buildEvalContext(perturbedDesign, perturbedResolve);
        const comp = evaluateOperands(operands, ctx);
        // OPTICAL MF only — drop MNT/MXT thickness penalties. Without this,
        // an as-built thickness that crosses a constraint bound (e.g. an
        // already-thin layer that the monitor cut slightly below MNT) would
        // dominate ΔMF and turn the simulation into a constraint-violation
        // detector, not a spectral-performance detector. The user explicitly
        // asked for spectral merit in tolerance / simulator features.
        mf = calcMF(operands, comp, { skipConstraints: true });
    }

    return {
        asBuiltFront: runResult.asBuiltFront,
        matDeltas:    runResult.matDeltas,
        cutTimes:     runResult.cutTimes,
        rates:        runResult.rates,
        cutStrategies: runResult.cutStrategies,
        spectrum:     Array.from(spectrum),
        mf,
    };
}

// ── λ-grid helper for MMS pre-sampling ───────────────────────────────────────

export function requiredLambdasMMS(cfg) {
    const set = new Set();
    if (Array.isArray(cfg.monTable)) {
        for (const m of cfg.monTable) if (m?.lambda) set.add(m.lambda);
    }
    for (const l of displayLambdas(cfg.spectrumParams || {})) set.add(l);
    if (Array.isArray(cfg.operands)) {
        for (const l of requiredOperandLambdas(cfg.operands)) set.add(l);
    }
    return Array.from(set).sort((a, b) => a - b);
}

// ── Theoretical-signal preview (no MC, no noise) ──────────────────────────────
//
// Layer-i monitor signal vs growth fraction, used by the UI preview pane (so
// the user can sanity-check the cut strategy before running the MC).

export function previewMonoSignal(design, resolveMat, layerIndex, monRow,
                                  common = {}) {
    const lam   = monRow?.lambda || design.referenceWavelength || 550;
    const theta = common.thetaDeg ?? 0;
    const pol   = common.pol      || 'avg';
    const char  = common.char     || 'T';

    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = design.frontLayers || [];
    const modelMats = front.map(l => resolveMat(l.material));
    const i = Math.max(0, Math.min(front.length - 1, layerIndex));
    const d_target = front[i]?.thickness || 0;

    const prevThicks = front.slice(0, i).map(l => l.thickness || 0);
    const dHi = Math.max(2 * d_target, d_target + 50);
    const NP = 80;
    const ds = new Array(NP), ys = new Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        const mats   = modelMats.slice(0, i + 1);
        const thicks = prevThicks.concat([d]);
        ds[s] = d;
        ys[s] = singleSignal(lam, theta, pol, char, incMat, subMat, mats, thicks);
    }
    return { d: ds, signal: ys, lambda: lam, dTarget: d_target, char };
}

// ── Main-thread Monte-Carlo orchestrator (serial fallback) ────────────────────
//
// Mirrors runMonteCarloBBM in shape: same return signature, same per-layer
// stats, same Welford-corridor + yield format. Parallel path is in
// `runMonteCarloMMSParallel` below (worker-pool driven).

function buildDisplayCtxMMS(design, resolveMat, cfg) {
    const corridorChar = cfg.char || (cfg.common?.char) || 'T';
    const spectrumParams = cfg.spectrumParams || {
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5,
        theta: 0, polarization: 'avg',
    };
    const lambdas = Float64Array.from(displayLambdas(spectrumParams));
    const ctx = {
        lambdas,
        theta:         spectrumParams.theta ?? 0,
        pol:           spectrumParams.polarization || 'avg',
        char:          corridorChar,
        corridorSigma: cfg.corridorSigma ?? 1.0,
    };
    const front = design.frontLayers || [];
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const modelMats = front.map(l => resolveMat(l.material));
    const targetThicks = front.map(l => l.thickness || 0);
    const theoryY = spectrumOnGrid(ctx.lambdas, ctx.theta, ctx.pol, ctx.char,
                                   incMat, subMat, modelMats, targetThicks);
    return { ctx, theoryY };
}

function theoryMF(design, resolveMat) {
    const ops = design.meritOperands || [];
    if (ops.length === 0) return 0;
    const ctx0  = buildEvalContext(design, resolveMat);
    const comp0 = evaluateOperands(ops, ctx0);
    // Optical merit only — see comment at the per-run mf calculation.
    return calcMF(ops, comp0, { skipConstraints: true });
}

function accumulateTrials(trials, design, displayCtx, theoryY, mfTheory, yieldTol) {
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
        for (let i = 0; i < N; i++) {
            const d = t.asBuiltFront[i];
            sumD[i]  += d;
            sumD2[i] += d * d;
            if (d < minD[i]) minD[i] = d;
            if (d > maxD[i]) maxD[i] = d;
        }
        for (let i = 0; i < nLam; i++) {
            const x = t.spectrum[i];
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

export async function runMonteCarloMMS(design, resolveMat, cfg = {}) {
    const nRuns        = Math.max(1, Math.floor(cfg.nRuns ?? 20));
    const onProgress   = cfg.onProgress || null;
    const shouldCancel = cfg.shouldCancel || (() => false);
    const seedBase     = cfg.seed != null ? (cfg.seed >>> 0) : null;

    const { ctx: displayCtx, theoryY } = buildDisplayCtxMMS(design, resolveMat, cfg);
    const mfTheory = theoryMF(design, resolveMat);
    const yieldTol = cfg.yieldTolerance ?? (mfTheory * 2);
    const operands = design.meritOperands || [];

    const trials = [];
    for (let trial = 0; trial < nRuns; trial++) {
        if (shouldCancel()) break;
        if (trial > 0) await new Promise(r => setTimeout(r, 0));
        const rng = seedBase != null
            ? mulberry32(deriveSeed(seedBase, trial))
            : Math.random;
        trials.push(runOneTrialMMS(design, resolveMat, cfg, rng, displayCtx, operands));
        if (onProgress) onProgress({ i: trial + 1, total: nRuns });
    }
    return accumulateTrials(trials, design, displayCtx, theoryY, mfTheory, yieldTol);
}

export async function runMonteCarloMMSParallel(design, resolveMat, cfg, pool) {
    const nRuns        = Math.max(1, Math.floor(cfg.nRuns ?? 20));
    const onProgress   = cfg.onProgress || null;
    const shouldCancel = cfg.shouldCancel || (() => false);
    const seedBase     = (cfg.seed ?? 0xC0FFEE) >>> 0;
    const operands     = design.meritOperands || [];

    const { ctx: displayCtx, theoryY } = buildDisplayCtxMMS(design, resolveMat, cfg);
    const mfTheory = theoryMF(design, resolveMat);
    const yieldTol = cfg.yieldTolerance ?? (mfTheory * 2);

    const { collectDesignMaterialIds, buildPresampledTable } = await import('../physics/optimizer.js');
    const lambdas = requiredLambdasMMS({ ...cfg, operands });
    const ids = collectDesignMaterialIds(design);
    const pairs = ids.map(id => ({ id, mat: resolveMat(id) }));
    const materials = buildPresampledTable(lambdas, pairs);

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
    let done = 0, cancelled = false;
    const cfgForWorker = { ...cfg };
    delete cfgForWorker.onProgress;
    delete cfgForWorker.shouldCancel;
    delete cfgForWorker.rng;
    const jobs = chunks.map(ch => ({
        cmd: 'mms',
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

    const promises = jobs.map((job) => pool.run(job, (tick) => {
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
    return accumulateTrials(trials, design, displayCtx, theoryY, mfTheory, yieldTol);
}
