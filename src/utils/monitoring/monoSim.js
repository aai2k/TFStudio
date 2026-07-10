/**
 * monoSim — Monochromatic (single-wavelength) Monitoring Simulator engine.
 *
 * Companion to monitoringSim.js (broadband). Broadband and
 * monochromatic monitoring are the SAME computational-manufacturing experiment
 * differing only in the cut rule, so this module deliberately mirrors
 * `simulateRun` (monitoringSim.js): identical cfg fields (rates + OU correlation,
 * per-material Δn/Δk, shutter delay, excluded layers, signal random/drift) and
 * an identical return shape, so the wizard reuses the same playback / results /
 * spectrum code. The ONE difference is the per-layer termination rule:
 *
 *   'turning' — Turning-point (extremum) monitoring. The layer is cut when the
 *               single-wavelength signal passes its order-th extremum. Classical
 *               method for quarter-wave stacks, where the design cut coincides
 *               with a max/min of the monitor signal (the cut is first-order
 *               insensitive to small thickness errors). Macleod §12.2.
 *   'level'   — Level monitoring. The layer is cut when the signal crosses the
 *               theoretical level S(d_target) (nominal materials) in the
 *               expected direction. For non-QW (mid-slope) cuts.
 *   'time'    — Thickness / time monitoring (no optical feedback). Cut at
 *               d_target on the realized rate plus a relative-thickness error.
 *               Also used for layers excluded from optical monitoring (quartz).
 *
 * The monitor uses NOMINAL materials and its accumulated as-built history of the
 * previous layers to predict the target level / extremum, while the "true"
 * chamber signal is generated from the per-run perturbed (truth) materials —
 * exactly the BBM convention, so monitoring imprecision propagates to the final
 * spectral performance.
 *
 * References:
 *   - H. A. Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 *   - A. V. Tikhonravov & M. K. Trubetskov, Appl. Opt. 44, 6877 (2005).
 *   - A. V. Tikhonravov, M. K. Trubetskov, T. V. Amotchkina, Appl. Opt. 45,
 *     7863 (2006) — choosing a monochromatic-monitoring strategy.
 */

import { tmmAvg } from '../physics/thinFilmMath.js';
import { mulberry32, deriveSeed, ouStep, makeShiftedMaterial } from './monitoringSim.js';

export { mulberry32, deriveSeed, makeShiftedMaterial };

function gauss(rng) {
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Single-wavelength signal sampler (storage order, top→substrate) ───────────
function pickChar(res, char, pol) {
    if (char === 'R') return pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
    if (char === 'A') return pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
    return pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
}

function singleSignal(lam, theta, pol, char, incMat, subMat, mats, thicks) {
    const lNDs = [];
    for (let i = 0; i < mats.length; i++) {
        if (thicks[i] > 0) lNDs.push({ n: mats[i].getNK(lam), d: thicks[i] });
    }
    const res = tmmAvg(lam, theta, incMat.getNK(lam), subMat.getNK(lam), lNDs);
    return pickChar(res, char, pol);
}

// ── Model curve analysis (target level + extrema) ─────────────────────────────
function analyzeModelCurve(monLam, theta, pol, char, incMat, subMat,
                           modelPrevMats, modelThicksPrev, curMat, dTarget) {
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 81;
    const ds = new Float64Array(NP);
    const ys = new Float64Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        ds[s] = d;
        ys[s] = singleSignal(monLam, theta, pol, char, incMat, subMat,
            modelPrevMats.concat([curMat]), modelThicksPrev.concat([d]));
    }
    const targetIdx = Math.max(1, Math.min(NP - 2, Math.round((dTarget / dHi) * (NP - 1))));
    const extrema = [];
    for (let s = 1; s < NP - 1; s++) {
        const a = ys[s - 1], b = ys[s], cv = ys[s + 1];
        if ((b > a && b >= cv) || (b < a && b <= cv)) {
            extrema.push({ d: ds[s], isMax: b > a });
        }
    }
    return { sAtTarget: ys[targetIdx], sStart: ys[0], extrema, dHi };
}

// ── Per-layer monitor table helpers (for the wizard) ──────────────────────────

/**
 * Most-sensitive monitoring wavelength for layer `layerIdx` — Strategy 1
 * (Tikhonravov 2006): the λ in [lamA, lamB] that maximises |dS/dd| at d_target.
 */
export function pickSensitiveLambda(design, resolveMat, layerIdx, lamA, lamB, theta, pol, char) {
    const front = design.frontLayers || [];
    if (!front[layerIdx]) return design.referenceWavelength || 550;
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);
    const mats = front.slice(0, layerIdx + 1).map(l => resolveMat(l.material));
    const thicks = front.slice(0, layerIdx + 1).map(l => l.thickness || 0);
    const d = thicks[layerIdx];
    const eps = Math.max(0.05, 0.005 * d);
    const NG = 60;
    const step = (lamB - lamA) / (NG - 1);
    let bestLam = lamA, bestSlope = -1;
    for (let g = 0; g < NG; g++) {
        const lam = lamA + g * step;
        const tP = thicks.slice(); tP[layerIdx] = d + eps;
        const tM = thicks.slice(); tM[layerIdx] = Math.max(0, d - eps);
        const sP = singleSignal(lam, theta, pol, char, incMat, subMat, mats, tP);
        const sM = singleSignal(lam, theta, pol, char, incMat, subMat, mats, tM);
        const slope = Math.abs((sP - sM) / (2 * eps));
        if (slope > bestSlope) { bestSlope = slope; bestLam = lam; }
    }
    return Math.round(bestLam);
}

/**
 * Default strategy: 'turning' if d_target is within 6% of an integer number of
 * quarter-waves at λ_mon, else 'level'. Zero-thickness → 'time'.
 */
export function autoMonoStrategy(layer, mat, monLambda) {
    const dt = Math.max(0, layer.thickness || 0);
    if (dt <= 0) return 'time';
    let nAt = 1.6;
    try { const [nRe] = mat.getNK(monLambda); if (Number.isFinite(nRe) && nRe > 0) nAt = nRe; } catch (_) {}
    const qw = monLambda / (4 * nAt);
    const ratio = dt / qw;
    const nearest = Math.round(ratio);
    if (nearest >= 1 && Math.abs(ratio - nearest) < 0.06) return 'turning';
    return 'level';
}

/**
 * Build the per-layer monitor table aligned to design.frontLayers (storage
 * order). Row: { lambda, strategy, order, sigmaRelPct }.
 */
export function defaultMonoTable(design, resolveMat, opts = {}) {
    const ref = design.referenceWavelength || 550;
    const front = design.frontLayers || [];
    const lamA = Number.isFinite(opts.lamA) ? opts.lamA : ref * 0.7;
    const lamB = Number.isFinite(opts.lamB) ? opts.lamB : ref * 1.3;
    const theta = opts.theta ?? 0;
    const pol = opts.pol || 'avg';
    const char = opts.char || 'T';
    return front.map((l, i) => {
        const mat = resolveMat(l.material);
        const lambda = opts.autoPickLambda
            ? pickSensitiveLambda(design, resolveMat, i, lamA, lamB, theta, pol, char)
            : ref;
        return { lambda, strategy: autoMonoStrategy(l, mat, lambda), order: 1, sigmaRelPct: 0 };
    });
}

// ── Single-run simulator ──────────────────────────────────────────────────────

/**
 * Simulate one monochromatic-monitoring deposition run. cfg matches
 * monitoringSim.simulateRun, except the monitoring system is per-layer:
 *   - monTable: [{ lambda, strategy:'turning'|'level'|'time', order, sigmaRelPct }]
 *   - mon:      { char, theta, polarization, scanIntervalSec, confirmScans }
 * Return shape is identical to simulateRun (+ cutStrategies).
 */
// Signal crossed sAtTarget in the expected start→target direction this scan.
function _crossedInDir(startDir, up, dn) {
    if (startDir > 0) return up;
    if (startDir < 0) return dn;
    return up || dn;
}

// One turning-mode scan. Tracks the running extreme within a tight window around
// the model's predicted extremum (hysteretic 3σ band) and cuts `confirmScans`
// after it reverses. Mutates `st` = { runExtS, runExtD, runExtT, confirm };
// `tc` = { extIsMax, trackD0, trackD1, armD, confirmScans, noiseFrac, bufFill }.
// Returns { d, t } to cut at, or null.
function _turningStep(sS, d_now, t, st, tc) {
    const sigmaS = tc.noiseFrac * Math.abs(sS) / Math.sqrt(tc.bufFill);
    const margin = Math.max(2e-4, 3 * sigmaS);
    if (d_now >= tc.trackD0 && d_now <= tc.trackD1) {
        if (tc.extIsMax ? (sS > st.runExtS + margin) : (sS < st.runExtS - margin)) {
            st.runExtS = sS; st.runExtD = d_now; st.runExtT = t;
        }
    }
    const past = d_now >= tc.armD && st.runExtD > 0 &&
        (tc.extIsMax ? (st.runExtS - sS > margin) : (sS - st.runExtS > margin));
    if (!past) { st.confirm = 0; return null; }
    st.confirm++;
    return st.confirm >= tc.confirmScans ? { d: st.runExtD, t: st.runExtT } : null;
}

// One level-mode scan. Cuts `confirmScans` after the smoothed signal crosses the
// theoretical level sAtTarget in the expected direction. Mutates `st` =
// { prevDiff, crossed, confirm }; `lc` = { sAtTarget, startDir, confirmScans }.
// Returns { d, t } to cut at, or null.
function _levelStep(sS, d_now, t, st, lc) {
    const diff = sS - lc.sAtTarget;
    if (st.prevDiff !== null && !st.crossed) {
        const up = st.prevDiff < 0 && diff >= 0;
        const dn = st.prevDiff > 0 && diff <= 0;
        if (_crossedInDir(lc.startDir, up, dn)) st.crossed = true;
    }
    st.prevDiff = diff;
    if (!st.crossed) return null;
    st.confirm++;
    return st.confirm >= lc.confirmScans ? { d: d_now, t } : null;
}

// Optical-feedback cut search for one layer (strategy 'turning' or 'level').
// Simulates the monitor scan-by-scan: the model curve (nominal materials) sets
// the target extremum/level, the truth curve (perturbed materials) plus noise +
// drift is what the monitor "sees". Returns the realized cut { cut_d_actual,
// cut_time } and the advanced wall-clock `t_global`. `p` bundles the per-layer
// context so this stays a pure function of its inputs. Mirrors the classical
// turning/level rules (Macleod §12.2); see simulateRunMono for the cfg meaning.
function _scanCutMono(p) {
    const { monLam, theta, pol, char, incMat, subMat, modelMats, modelThicksPrev,
            i, d_target, truthMats, truthThicksPrev, r, dt, t_target, confirmScans,
            noiseFrac, driftSlope, strat, order, rng } = p;
    let { t_global, cut_d_actual, cut_time } = p;

    const an = analyzeModelCurve(monLam, theta, pol, char, incMat, subMat,
        modelMats.slice(0, i), modelThicksPrev, modelMats[i], d_target);
    const maxScans = Math.max(2, Math.ceil((Math.max(t_target * 2, t_target + 10 / r)) / dt));
    const truthMatsUpto = truthMats.slice(0, i + 1);

    const SMOOTH_W = Math.max(3, confirmScans + 1);
    const buf = new Array(SMOOTH_W).fill(NaN);
    let bufFill = 0, bufHead = 0;
    const smooth = (v) => {
        buf[bufHead] = v; bufHead = (bufHead + 1) % SMOOTH_W;
        if (bufFill < SMOOTH_W) bufFill++;
        let s = 0, c = 0;
        for (let b = 0; b < bufFill; b++) if (!Number.isNaN(buf[b])) { s += buf[b]; c++; }
        return c > 0 ? s / c : v;
    };

    // Turning mode: the model predicts WHICH extremum (order) and roughly
    // WHERE (extD); bound the running-extreme search TIGHTLY around it so
    // post-peak noise (or a later feature) cannot creep the recorded
    // extreme forward, and use a hysteretic 3σ band so noise on the flat
    // turning-point top cannot latch it forward either.
    // Choose the extremum the design intends to cut at: for order 1 the
    // one NEAREST the design target (robust to a spurious early ripple);
    // for higher orders the order-th in growth sequence. If the model
    // curve has NO extremum in range (e.g. a monotonic layer signal),
    // fall back to d_target with the slope-sign as the extremum type —
    // the tight window then never reverses, so the layer safely
    // dead-reckons instead of mis-cutting at ~0 nm.
    let ext = null;
    if (an.extrema.length) {
        ext = order === 1
            ? an.extrema.reduce((best, e) =>
                Math.abs(e.d - d_target) < Math.abs(best.d - d_target) ? e : best, an.extrema[0])
            : an.extrema[Math.min(order - 1, an.extrema.length - 1)];
    }
    const extD = ext ? ext.d : d_target;
    const extIsMax = ext ? ext.isMax : (an.sAtTarget >= an.sStart);
    // Turning tracking bounds around the predicted extremum + the level-mode
    // crossing direction; the per-scan detectors own their mutable state.
    const tState = { runExtS: extIsMax ? -Infinity : Infinity, runExtD: 0, runExtT: 0, confirm: 0 };
    const tCfg = { extIsMax, trackD0: 0.8 * extD, trackD1: 1.15 * extD, armD: 0.9 * extD,
                   confirmScans, noiseFrac, bufFill: SMOOTH_W };
    const lState = { prevDiff: null, crossed: false, confirm: 0 };
    const lCfg = { sAtTarget: an.sAtTarget, startDir: Math.sign(an.sAtTarget - an.sStart) || 1, confirmScans };

    for (let k = 1; k <= maxScans; k++) {
        const t = k * dt;
        const d_now = r * t;
        t_global += dt;

        const sTrue = singleSignal(monLam, theta, pol, char, incMat, subMat,
            truthMatsUpto, truthThicksPrev.concat([d_now]));
        const eps = noiseFrac > 0 ? gauss(rng) * noiseFrac : 0;
        const sMeas = sTrue * (1 + eps) + driftSlope * t_global;
        const sS = smooth(sMeas);
        if (bufFill < SMOOTH_W) continue;

        const hit = strat === 'turning'
            ? _turningStep(sS, d_now, t, tState, tCfg)
            : _levelStep(sS, d_now, t, lState, lCfg);
        if (hit) { cut_d_actual = hit.d; cut_time = hit.t; break; }
    }
    return { cut_d_actual, cut_time, t_global };
}

// ── Per-layer sim helpers (cfg semantics shared with simulateRun) ─────────────

// Per-material Δn/Δk draw: systematic + random, from a matDev override if present
// else the global σ_Re(n)/σ_Im(n). Returns { dn, dk, inh }.
function _drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng) {
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
function _realizedRate(rateSpec, prevR, dtc, rng) {
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
function _timeCut(d_target, r, relPct, rng) {
    const relErr = relPct > 0 ? gauss(rng) * relPct / 100 : 0;
    const cut_d_actual = Math.max(0, d_target * (1 + relErr));
    return { cut_d_actual, cut_time: cut_d_actual / r };
}

// Shutter-close latency: the layer keeps growing for `delay` s after the cut
// decision. `shutter` = { meanS, rmsS }. Returns the adjusted
// { cut_d_actual, cut_time }.
function _applyShutter(cut_d_actual, cut_time, r, shutter, rng) {
    const delay = Math.max(0, shutter.meanS + (shutter.rmsS > 0 ? gauss(rng) * shutter.rmsS : 0));
    return { cut_d_actual: Math.max(0, cut_d_actual + r * delay), cut_time: cut_time + delay };
}

export function simulateRunMono(design, resolveMat, cfg) {
    const rng           = cfg.rng || Math.random;
    const rates         = cfg.rates || new Map();
    const sigmaReN      = cfg.sigmaReN ?? 0;
    const sigmaImN      = cfg.sigmaImN ?? 0;
    const perMaterial   = cfg.perMaterial != null ? !!cfg.perMaterial : true;
    const monTable      = cfg.monTable || [];
    const mon           = cfg.mon || {};
    const sig           = cfg.sig || {};
    const char          = mon.char || 'T';
    const theta         = mon.theta ?? 0;
    const pol           = mon.polarization || 'avg';
    const dt            = Math.max(1e-6, mon.scanIntervalSec ?? 0.5);
    const confirmScans  = Math.max(1, Math.floor(mon.confirmScans ?? 2));
    const randomPct     = sig.randomPct ?? 1.0;
    const driftPctPer1000s = sig.driftPctPer1000s ?? 0;
    const shutterMeanS  = cfg.shutterDelayMeanS ?? 0;
    const shutterRmsS   = cfg.shutterDelayRmsS  ?? 0;
    const excludeLayers     = cfg.excludeLayers || null;
    const relThkErrByLayer  = cfg.relThkErrByLayer || null;
    const recordTrajectory  = !!cfg.recordTrajectory;
    const refLam = design.referenceWavelength || 550;

    const incId  = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = (design.frontLayers || []).map(l => ({ ...l }));
    const N = front.length;

    // Per-material Δn, Δk draws.
    const matIds = new Set();
    for (const l of front) matIds.add(l.material);
    const matDev = cfg.matDev || null;
    const matDraws = new Map();
    if (perMaterial) for (const id of matIds) matDraws.set(id, _drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng));

    const modelMats = front.map(l => resolveMat(l.material));
    const layerDeltas = new Array(N);
    const truthMats = front.map((l, i) => {
        const d = perMaterial ? matDraws.get(l.material) : _drawMatDelta(l.material, matDev, sigmaReN, sigmaImN, rng);
        const dn = d?.dn ?? 0, dk = d?.dk ?? 0, inh = d?.inh ?? 0;
        layerDeltas[i] = { dn, dk, inh };
        return makeShiftedMaterial(modelMats[i], dn, dk);
    });

    const driftSlope = driftPctPer1000s > 0
        ? (gauss(rng) * driftPctPer1000s) / 100 / 1000
        : 0;

    const asBuilt        = new Array(N);
    const cutTimes       = new Array(N);
    const realizedRates  = new Array(N);
    const cutStrategies  = new Array(N);
    const estimated      = recordTrajectory ? new Array(N) : null;
    let t_global = 0;

    const ouRate  = new Map();
    const ouLastT = new Map();
    let tElapsed = 0;

    const truthThicksPrev = [];
    const modelThicksPrev = [];

    for (let i = 0; i < N; i++) {
        const layer = front[i];
        const d_target = Math.max(0, layer.thickness || 0);
        const matId    = layer.material;
        const monRow   = monTable[i] || {};
        const monLam   = monRow.lambda || refLam;
        const order    = Math.max(1, Math.floor(monRow.order || 1));
        const isExcluded = !!(excludeLayers && excludeLayers.has(i));
        let strat = isExcluded ? 'time' : (monRow.strategy || 'turning');
        cutStrategies[i] = strat;

        // Realized rate via OU correlated process (identical to simulateRun).
        const rateSpec = rates.get(matId) || { mean: 0.5, sigma: 0 };
        const dtc = Math.max(0, tElapsed - (ouLastT.get(matId) ?? 0));
        const r = _realizedRate(rateSpec, ouRate.get(matId), dtc, rng);
        ouRate.set(matId, r);
        realizedRates[i] = r;

        const t_target = d_target / r;
        let cut_time = t_target;
        let cut_d_actual = r * t_target;   // fallback: dead-reckon to target
        const cut_d_hat = d_target;

        if (strat === 'time') {
            const relPct = isExcluded
                ? (relThkErrByLayer ? (relThkErrByLayer[i] || 0) : 0)
                : (monRow.sigmaRelPct || 0);
            ({ cut_d_actual, cut_time } = _timeCut(d_target, r, relPct, rng));
            t_global += t_target;
        } else if (d_target > 0) {
            const scan = _scanCutMono({
                monLam, theta, pol, char, incMat, subMat, modelMats, modelThicksPrev,
                i, d_target, truthMats, truthThicksPrev, r, dt, t_target, confirmScans,
                noiseFrac: randomPct / 100, driftSlope, strat, order, rng,
                t_global, cut_d_actual, cut_time,
            });
            cut_d_actual = scan.cut_d_actual;
            cut_time     = scan.cut_time;
            t_global     = scan.t_global;
        }

        if (shutterMeanS > 0 || shutterRmsS > 0) {
            ({ cut_d_actual, cut_time } = _applyShutter(cut_d_actual, cut_time, r,
                { meanS: shutterMeanS, rmsS: shutterRmsS }, rng));
        }

        asBuilt[i] = Math.max(0, cut_d_actual);
        cutTimes[i] = cut_time;
        if (estimated) estimated[i] = cut_d_hat;

        tElapsed += cut_time;
        ouLastT.set(matId, tElapsed);
        if (cfg.onLayer) cfg.onLayer(i + 1, N);

        truthThicksPrev.push(asBuilt[i]);
        modelThicksPrev.push(asBuilt[i]);
    }

    const out = {
        asBuiltFront: asBuilt,
        targetFront:  front.map(l => l.thickness || 0),
        matDeltas:    layerDeltas,
        cutTimes,
        rates:        realizedRates,
        cutStrategies,
    };
    if (recordTrajectory) {
        out.estimatedFront = estimated;
        out.materialsFront = front.map(l => l.material);
    }
    return out;
}
