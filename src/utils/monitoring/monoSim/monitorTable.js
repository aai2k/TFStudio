/**
 * Per-layer monitor table builder for the wizard: monitoring-plan selection
 * (wavelength + termination strategy per layer), the default strategy rule,
 * and the table itself.
 */

import {
    findExtrema, nearestExtremum, sampleLayerCurve, signalAt, signalErrorOf, slopeAtCut,
    terminationError,
} from './worksheetSignal.js';
import { CHAMBER_MEDIUM_ID } from '../chamberMedium.js';

// Candidate wavelengths tried per layer, matching the worksheet's search.
const LAM_STEPS = 25;

// What a timed (dead-reckoned) cut is good for, as a fraction of the target:
// the rate-calibration uncertainty of a stabilized process. An optical rule
// has to beat this to be planned, because a fragile optical cut can miss by
// most of the layer and poison every cut after it, while a timed cut's error
// is bounded and never cascades.
const TIME_CUT_REL_ERR = 0.03;

// Quarter wave in the growing layer at the monitor wavelength, which sizes
// the curve sampling for the search.
function quarterWave(curMat, lam) {
    return lam / (4 * Math.max(1e-6, curMat.getNK(lam)[0] || 1.6));
}

// The cut error this layer would suffer at this wavelength, in nm, scored the
// way the engine actually cuts (cutSteps.js):
//
//   turning  cuts at the model extremum nearest the target, so the error is
//            that extremum's displacement from the target plus the
//            curvature-limited detection error;
//   level    cuts at the FIRST crossing of the target level in the
//            start-to-target direction, so an earlier same-direction crossing
//            IS the cut and scores as that miss; a clean crossing scores as
//            signal noise over slope.
//
// Returns the better rule and its error, which is what makes maximum raw
// sensitivity the wrong criterion: a band-edge wavelength has the steepest
// slope AND ambiguous crossings, and this score charges it for the latter.
function scoreLayerAt(ctx, dTarget, noise) {
    const curve = sampleLayerCurve(ctx, dTarget, quarterWave(ctx.curMat, ctx.lam), true);
    const sCut = signalAt(ctx, dTarget);
    const signalError = signalErrorOf(noise, sCut);

    const ext = nearestExtremum(findExtrema(curve), dTarget);
    const turning = ext
        ? Math.abs(ext.d - dTarget) + terminationError({
            strategy: 'turning', signalError, slope: 0, cutExtremum: ext,
        })
        : Infinity;

    // The engine recomputes its level from the monitor's accumulated as-built
    // stack, so the level VALUE tracks deposition errors; what has to survive
    // them is the crossing's uniqueness. The pick therefore counts only if the
    // crossing stays clean with the layers beneath a couple of percent thick
    // AND thin, the scale of realized cut errors; otherwise it is scored as
    // the full miss an early crossing produces.
    const level = [1, 1.02, 0.98].every(s => levelCutIsClean(ctx, s, dTarget, noise))
        ? terminationError({
            strategy: 'level', signalError, slope: slopeAtCut(ctx, dTarget),
        })
        : dTarget;
    return turning <= level
        ? { err: turning, strategy: 'turning' }
        : { err: level, strategy: 'level' };
}

// Whether a level cut on this layer terminates where it should, with the
// layers beneath scaled by `belowScale`: the level must sit several noise
// widths away from the layer's starting signal (the engine cuts on the FIRST
// crossing, and a level within noise of the start is crossed the moment the
// shutter opens), and no earlier same-direction crossing may exist.
function levelCutIsClean(ctx, belowScale, dTarget, noise) {
    const p = belowScale === 1 ? ctx
        : { ...ctx, belowThicks: ctx.belowThicks.map(t => t * belowScale) };
    const curve = sampleLayerCurve(p, dTarget, quarterWave(p.curMat, p.lam), true);
    const sCut = signalAt(p, dTarget);
    const signalError = signalErrorOf(noise, sCut);
    if (Math.abs(sCut - curve.s[0]) < 5 * signalError) return false;
    const startDir = Math.sign(sCut - curve.s[0]) || 1;
    for (let k = 1; k < curve.s.length && curve.d[k] < dTarget - curve.h; k++) {
        const up = curve.s[k - 1] < sCut && curve.s[k] >= sCut;
        const dn = curve.s[k - 1] > sCut && curve.s[k] <= sCut;
        if (startDir > 0 ? up : dn) return false;
    }
    return true;
}

// The plan for one layer of the run. A layer whose cut sits on an extremum
// at the reference keeps the turning point there OUTRIGHT: turning at λref
// carries the classical cumulative self-compensation, which no per-layer
// score can see, so no per-layer score is allowed to trade it away. The
// candidate search is for the layers the reference cannot serve; a layer no
// wavelength can terminate on (a flat, index-matched signal) falls back to
// the defaults rather than an arbitrary pick.
function planForLayer({ front, i, resolveMat, sys, ref, candidates, noise }) {
    const d = Math.max(0, front[i].thickness || 0);
    if (d <= 0) return { lambda: ref, strategy: 'time' };
    const curMat = resolveMat(front[i].material);
    // The layers beneath the growing one: higher storage indices, already
    // in outermost-first order as the signal model wants.
    const belowMats = [];
    const belowThicks = [];
    for (let k = i + 1; k < front.length; k++) {
        belowMats.push(resolveMat(front[k].material));
        belowThicks.push(front[k].thickness || 0);
    }
    // Turning at the reference is kept when the cut sits on an extremum there
    // AND the reversal is still strong enough to detect within the engine's
    // own tracking window (about a quarter of a quarter-wave for a
    // first-order cut): it carries the classical cumulative self-compensation
    // that no per-layer score can see. Deep inside a forming stopband the
    // signal saturates and the reversal amplitude dies; such a layer falls
    // through to the search and is monitored outside the band, the way a deep
    // quarter-wave mirror is monitored at a real coater.
    const refCtx = { lam: ref, curMat, belowMats, belowThicks, sys };
    const dQWref = quarterWave(curMat, ref);
    const refExt = nearestExtremum(
        findExtrema(sampleLayerCurve(refCtx, d, dQWref, true)), d);
    if (refExt && Math.abs(refExt.d - d) <= dQWref / 8) {
        const sigErr = signalErrorOf(noise, signalAt(refCtx, d));
        const detect = terminationError({
            strategy: 'turning', signalError: sigErr, slope: 0, cutExtremum: refExt,
        });
        if (detect <= dQWref / 4) return { lambda: ref, strategy: 'turning' };
    }
    let best = null;
    for (const lam of candidates) {
        const score = scoreLayerAt({ lam, curMat, belowMats, belowThicks, sys }, d, noise);
        if (!best || score.err < best.err) best = { ...score, lambda: lam };
    }
    // No optical rule better than dead reckoning exists for this layer at any
    // candidate wavelength: cut it by time, the way an unmonitorable layer is
    // handled at a real coater.
    if (!(best.err < TIME_CUT_REL_ERR * d)) return { lambda: ref, strategy: 'time' };
    return { lambda: best.lambda, strategy: best.strategy };
}

/**
 * Monitoring plan for every layer: the wavelength AND termination strategy
 * whose cut is most precise, chosen together. The design reference wavelength
 * is the incumbent and a candidate replaces it only by strictly beating it,
 * so a quarter-wave layer keeps λref with a turning cut — and the cumulative
 * self-compensation that comes with it — instead of drifting to the band
 * edge, where raw sensitivity peaks but the cut rules stop being reliable.
 *
 * `noisePct` is the monitor's random error in percent of the reading;
 * `absNoisePct` is its photometric noise floor in percent of full scale. The
 * floor is what retires a wavelength whose signal has saturated: without it
 * a dead reading would score as noiseless.
 *
 * @returns {{lambda: number, strategy: string}[]} aligned to
 *          design.frontLayers (storage order).
 */
export function pickMonitoringPlan({
    design, resolveMat, lamA, lamB, theta, pol, char, chipMaterial,
    noisePct = 0.3, absNoisePct = 0.1,
}) {
    const front = design.frontLayers || [];
    const N = front.length;
    if (!N) return [];
    const ref = design.referenceWavelength || 550;
    // The monitor watches the witness chip: in air, since the chip hangs in
    // the chamber whatever the design is embedded in, and on the design
    // substrate's glass unless `chipMaterial` names another material.
    const subId = chipMaterial || (design.substrate?.material ?? 'BK7');
    const sys = {
        theta, pol, char,
        incMat: resolveMat(CHAMBER_MEDIUM_ID), subMat: resolveMat(subId),
        subThickMM: design.substrate?.thickness ?? 1,
    };
    const noise = { relFrac: Math.max(0, noisePct) / 100, absFrac: Math.max(0, absNoisePct) / 100 };

    const candidates = [ref];
    for (let g = 0; g < LAM_STEPS; g++) {
        candidates.push(Math.round(lamA + (g * (lamB - lamA)) / (LAM_STEPS - 1)));
    }

    const out = new Array(N);
    for (let i = 0; i < N; i++) {
        out[i] = planForLayer({ front, i, resolveMat, sys, ref, candidates, noise });
    }
    return out;
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
    const plan = opts.autoPickLambda
        ? pickMonitoringPlan({
            design, resolveMat, lamA, lamB, theta, pol, char,
            chipMaterial: opts.chipMaterial,
        })
        : null;
    return front.map((l, i) => {
        const mat = resolveMat(l.material);
        const lambda = plan ? plan[i].lambda : ref;
        const strategy = plan ? plan[i].strategy : autoMonoStrategy(l, mat, lambda);
        return { lambda, strategy, order: 1, sigmaRelPct: 0 };
    });
}
