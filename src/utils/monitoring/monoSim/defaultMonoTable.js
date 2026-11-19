/**
 * The per-layer monitor table the Mono wizard starts from: the design
 * reference wavelength on every layer, with the termination strategy each
 * layer's signal allows.
 */

import { findExtrema, isFlatCurve, nearestExtremum, sampleLayerCurve } from './worksheetSignal.js';
import { analyzeModelCurve } from './signalModel.js';
import { autoMonoStrategy, chipSystem, layerStack, monitorableAt, pickMonitoringPlan, quarterWave } from './monitorTable.js';

/**
 * Strategy for one layer at the reference wavelength when no plan is picked.
 * A layer within 6% of a whole number of quarter waves (autoMonoStrategy) is
 * cut on its turning point only if its signal on the chip, with the design
 * layers beneath it, really turns within 6% of a quarter wave of the cut: a
 * stack beneath that is not a quarter-wave stack moves the turning point, and
 * a quarter-wave layer on such a stack can turn several nanometres short of
 * its target, where a turning cut would stop it. Such a layer, like every
 * other one, gets a level cut. A layer that leaves no trace on the signal is
 * cut on time, and so is a zero-thickness one, and one with no signal at the
 * reference because a material it is monitored through has no index there.
 */
function defaultStrategyAt(ctx, layer) {
    const d = Math.max(0, layer.thickness || 0);
    if (d <= 0 || !monitorableAt(ctx)) return 'time';
    const dQW = quarterWave(ctx.curMat, ctx.lam);
    const curve = sampleLayerCurve(ctx, d, dQW);
    if (isFlatCurve(curve)) return 'time';
    if (autoMonoStrategy(layer, ctx.curMat, ctx.lam) !== 'turning') return 'level';
    const ext = nearestExtremum(findExtrema(curve), d);
    return ext && Math.abs(ext.d - d) < 0.06 * dQW ? 'turning' : 'level';
}

// The nm between the target thickness `d` and the nearest turning point of the
// model signal of the growing layer on the nominal stack beneath, at `lam`.
// Infinity when there is no signal or it does not turn.
function turnOffsetAt(ctx, model, d, lam) {
    if (!monitorableAt({ ...ctx, lam })) return Infinity;
    const curve = analyzeModelCurve(lam, model, d, ctx.sys);
    if (curve.flat) return Infinity;
    return curve.extrema.reduce((least, extremum) => Math.min(least, Math.abs(extremum.d - d)), Infinity);
}

// Coarse step of the search over the band, nm, and how many of the lowest
// minima of the offset along it are then searched at 1 nm. Six nm and four
// minima trade closeness for time: a search of every wavelength at 1 nm costs
// about three times as many model curves, which freezes the wizard for over a
// second when it opens on a design of a hundred layers.
const COARSE_STEP_NM = 6;
const COARSE_KEPT = 4;

// A wavelength in [lamA, lamB], in whole nm, where the model signal of the
// growing layer on the nominal stack beneath turns near its target thickness
// `d`, as { lambda, off } with `off` the nm between that turn and the target
// (the lowest wavelength among equals). The band is searched every
// COARSE_STEP_NM, and 1 nm steps are tried around the COARSE_KEPT lowest
// minima of the offset found. When the best dip of the offset is not among
// those, the turn found can be slightly farther from the target than the
// nearest one on a 1 nm grid, by under a nanometre in the designs tried. Null
// when no wavelength turns within 6% of a quarter wave of the target (the
// quarter wave at that wavelength), or none has a signal.
function turningWavelengthFor(ctx, d, lamA, lamB) {
    const model = { matsBelow: ctx.belowMats, thicksBelow: ctx.belowThicks, curMat: ctx.curMat };
    const lo = Math.round(lamA), hi = Math.round(lamB);
    const tried = new Map();
    const offAt = (lam) => {
        if (!tried.has(lam)) tried.set(lam, turnOffsetAt(ctx, model, d, lam));
        return tried.get(lam);
    };
    const coarse = [];
    for (let lam = lo; lam <= hi; lam += COARSE_STEP_NM) coarse.push(lam);
    if (coarse[coarse.length - 1] !== hi) coarse.push(hi);
    const profile = coarse.map(lam => ({ lam, off: offAt(lam) }));
    const isMinimum = (point, k) => point.off < Infinity
        && !(profile[k - 1]?.off < point.off) && !(profile[k + 1]?.off < point.off);
    const centres = profile.filter(isMinimum)
        .sort((x, y) => x.off - y.off || x.lam - y.lam).slice(0, COARSE_KEPT);
    for (const { lam } of centres) {
        const from = Math.max(lo, lam - COARSE_STEP_NM + 1), to = Math.min(hi, lam + COARSE_STEP_NM);
        for (let near = from; near < to; near++) offAt(near);
    }
    let best = null;
    for (const [lambda, off] of tried) {
        const closer = !best || off < best.off || (off === best.off && lambda < best.lambda);
        if (off < Infinity && closer) best = { lambda, off };
    }
    return best && best.off <= 0.06 * quarterWave(ctx.curMat, best.lambda) ? best : null;
}

/**
 * Build the per-layer monitor table aligned to design.frontLayers (storage
 * order). Row: { lambda, strategy, order, sigmaRelPct }.
 *
 * A layer 6% or more off a whole number of quarter waves at the reference
 * wavelength cannot be cut on a turning point there, and a level cut on it
 * can miss with ordinary index errors. It is cut on a turning point at the
 * wavelength in [lamA, lamB] (0.7 to 1.3 times the reference by default) where
 * the signal turns nearest its target, and keeps its level cut at the
 * reference when no wavelength turns within 6% of a quarter wave of it.
 */
export function defaultMonoTable(design, resolveMat, opts = {}) {
    const ref = design.referenceWavelength || 550;
    const front = design.frontLayers || [];
    const lamA = Number.isFinite(opts.lamA) ? opts.lamA : ref * 0.7;
    const lamB = Number.isFinite(opts.lamB) ? opts.lamB : ref * 1.3;
    const theta = opts.theta ?? 0;
    const pol = opts.pol || 'avg';
    const char = opts.char || 'T';
    const chipMaterial = opts.chipMaterial;
    if (opts.autoPickLambda) {
        const plan = pickMonitoringPlan({ design, resolveMat, lamA, lamB, theta, pol, char, chipMaterial });
        return plan.map(row => ({ lambda: row.lambda, strategy: row.strategy, order: 1, sigmaRelPct: 0 }));
    }
    const sys = chipSystem({ design, resolveMat, theta, pol, char, chipMaterial });
    return front.map((l, i) => {
        const ctx = { lam: ref, ...layerStack(front, i, resolveMat), sys };
        const strategy = defaultStrategyAt(ctx, l);
        const turn = strategy === 'level' && autoMonoStrategy(l, ctx.curMat, ref) === 'level'
            ? turningWavelengthFor(ctx, l.thickness, lamA, lamB) : null;
        return turn
            ? { lambda: turn.lambda, strategy: 'turning', order: 1, sigmaRelPct: 0 }
            : { lambda: ref, strategy, order: 1, sigmaRelPct: 0 };
    });
}
