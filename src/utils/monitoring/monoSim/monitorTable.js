/**
 * Per-layer monitor table builder for the wizard: sensitive-wavelength
 * selection, the default turning/level/time strategy, and the table itself.
 */

import { singleSignal } from './signalModel.js';

/**
 * Most-sensitive monitoring wavelength for layer `layerIdx` — Strategy 1
 * (Tikhonravov 2006): the λ in [lamA, lamB] that maximises |dS/dd| at d_target.
 */
export function pickSensitiveLambda({ design, resolveMat, layerIdx, lamA, lamB, theta, pol, char }) {
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
    const sys = { theta, pol, char, incMat, subMat };
    let bestLam = lamA, bestSlope = -1;
    for (let g = 0; g < NG; g++) {
        const lam = lamA + g * step;
        const tP = thicks.slice(); tP[layerIdx] = d + eps;
        const tM = thicks.slice(); tM[layerIdx] = Math.max(0, d - eps);
        const sP = singleSignal(lam, mats, tP, sys);
        const sM = singleSignal(lam, mats, tM, sys);
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
            ? pickSensitiveLambda({ design, resolveMat, layerIdx: i, lamA, lamB, theta, pol, char })
            : ref;
        return { lambda, strategy: autoMonoStrategy(l, mat, lambda), order: 1, sigmaRelPct: 0 };
    });
}
