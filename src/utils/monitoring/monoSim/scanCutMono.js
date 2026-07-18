/**
 * Optical-feedback cut search for one layer (strategy 'turning' or 'level').
 * Simulates the monitor scan-by-scan: the model curve (nominal materials)
 * sets the target extremum/level, the truth curve (perturbed materials) plus
 * noise + drift is what the monitor "sees". Returns the realized cut
 * { cut_d_actual, cut_time } and the advanced wall-clock `t_global`. Mirrors
 * the classical turning/level rules (Macleod §12.2); see simulateRunMono for
 * the cfg meaning.
 */

import { gauss } from './rng.js';
import { singleSignal, analyzeModelCurve } from './signalModel.js';
import { _turningStep, _levelStep } from './cutSteps.js';

// Which extremum (order-th) to track, given the model-curve analysis.
// Choose the extremum the design intends to cut at: for order 1 the one
// NEAREST the design target (robust to a spurious early ripple); for higher
// orders the order-th in growth sequence. If the model curve has NO extremum
// in range (e.g. a monotonic layer signal), fall back to d_target with the
// slope-sign as the extremum type — the tight window then never reverses, so
// the layer safely dead-reckons instead of mis-cutting at ~0 nm.
function resolveExtremumTarget(an, order, d_target) {
    if (!an.extrema.length) {
        return { extD: d_target, extIsMax: an.sAtTarget >= an.sStart };
    }
    const ext = order === 1
        ? an.extrema.reduce((best, e) =>
            Math.abs(e.d - d_target) < Math.abs(best.d - d_target) ? e : best, an.extrema[0])
        : an.extrema[Math.min(order - 1, an.extrema.length - 1)];
    return { extD: ext.d, extIsMax: ext.isMax };
}

// One scan's smoothed measured signal: truth curve + noise + drift, run
// through the layer's moving-average smoother. `ctx` bundles the fixed
// per-scan context: { monLam, truthMatsUpto, truthThicksPrev, sys, noiseFrac,
// driftSlope, rng, smooth }. `smooth` returns { value, ready } — ready once
// the moving-average window has filled.
function measureMonoScan(d_now, t_global, ctx) {
    const { monLam, truthMatsUpto, truthThicksPrev, sys, noiseFrac, driftSlope, rng, smooth } = ctx;
    const sTrue = singleSignal(monLam, truthMatsUpto, truthThicksPrev.concat([d_now]), sys);
    const eps = noiseFrac > 0 ? gauss(rng) * noiseFrac : 0;
    const sMeas = sTrue * (1 + eps) + driftSlope * t_global;
    return smooth(sMeas);
}

// Scan-by-scan cut search, once the model curve + tracking config are set up.
// `ctx` bundles { maxScans, dt, r, measureCtx, strat, tState, tCfg, lState,
// lCfg, t_global }. Returns the advanced t_global and the cut hit ({d, t}) or
// null if no scan confirmed within the budget.
function runMonoScanLoop(ctx) {
    const { maxScans, dt, r, measureCtx, strat, tState, tCfg, lState, lCfg } = ctx;
    let t_global = ctx.t_global;
    let hit = null;

    for (let k = 1; k <= maxScans; k++) {
        const t = k * dt;
        const d_now = r * t;
        t_global += dt;

        const m = measureMonoScan(d_now, t_global, measureCtx);
        if (!m.ready) continue;

        hit = strat === 'turning'
            ? _turningStep(m.value, d_now, t, tState, tCfg)
            : _levelStep(m.value, d_now, t, lState, lCfg);
        if (hit) break;
    }
    return { hit, t_global };
}

export function _scanCutMono(p) {
    const { monLam, theta, pol, char, incMat, subMat, modelMats, modelThicksPrev,
            i, d_target, truthMats, truthThicksPrev, r, dt, t_target, confirmScans,
            noiseFrac, driftSlope, strat, order, rng } = p;
    let { t_global, cut_d_actual, cut_time } = p;

    const sys = { theta, pol, char, incMat, subMat };
    const model = { prevMats: modelMats.slice(0, i), thicksPrev: modelThicksPrev, curMat: modelMats[i] };
    const an = analyzeModelCurve(monLam, model, d_target, sys);
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
        return { value: c > 0 ? s / c : v, ready: bufFill >= SMOOTH_W };
    };

    // Turning tracking bounds around the predicted extremum + the level-mode
    // crossing direction; the per-scan detectors own their mutable state.
    const { extD, extIsMax } = resolveExtremumTarget(an, order, d_target);
    const tState = { runExtS: extIsMax ? -Infinity : Infinity, runExtD: 0, runExtT: 0, confirm: 0 };
    const tCfg = { extIsMax, trackD0: 0.8 * extD, trackD1: 1.15 * extD, armD: 0.9 * extD,
                   confirmScans, noiseFrac, bufFill: SMOOTH_W };
    const lState = { prevDiff: null, crossed: false, confirm: 0 };
    const lCfg = { sAtTarget: an.sAtTarget, startDir: Math.sign(an.sAtTarget - an.sStart) || 1, confirmScans };
    const measureCtx = { monLam, truthMatsUpto, truthThicksPrev, sys, noiseFrac, driftSlope, rng, smooth };

    const scan = runMonoScanLoop({ maxScans, dt, r, measureCtx, strat, tState, tCfg, lState, lCfg, t_global });
    t_global = scan.t_global;
    if (scan.hit) { cut_d_actual = scan.hit.d; cut_time = scan.hit.t; }

    return { cut_d_actual, cut_time, t_global };
}
