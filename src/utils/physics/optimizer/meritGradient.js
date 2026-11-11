/**
 * Slopes of the least-squares engine's merit over the layer thicknesses
 * (lsqEngine.js): the central-difference Jacobian of its residuals, used where
 * the analytic Jacobian declines a merit term, and the gradient of MF.
 *
 * `eng` is the engine: its residuals, analytic Jacobian, evaluation and merit,
 * its finite-difference step `h` and its bounds D_MIN and D_MAX, nm.
 */
import { mfWeightDenominator } from './evalCore.js';

// The central-difference step on layer k, and the two points it reaches
// inside the bounds.
function differencePoints(eng, thk, k) {
    const hk = Math.max(eng.h, Math.abs(thk[k]) * 1e-4);
    const thkP = [...thk]; thkP[k] = Math.min(thk[k] + hk, eng.D_MAX);
    const thkM = [...thk]; thkM[k] = Math.max(thk[k] - hk, eng.D_MIN);
    return { thkP, thkM, dh: thkP[k] - thkM[k] };
}

/**
 * Central-difference Jacobian J[m × nFree] of the residuals over the
 * variables freeIdx. Costs 2·nFree extra TMM passes.
 */
export function fdJacobian(eng, thk, freeIdx, m) {
    const nFree = freeIdx.length;
    const J = Array.from({ length: m }, () => new Array(nFree).fill(0));
    for (let ci = 0; ci < nFree; ci++) {
        const { thkP, thkM, dh } = differencePoints(eng, thk, freeIdx[ci]);
        const rP = eng._residuals(thkP);
        const rM = eng._residuals(thkM);
        if (dh > 0) for (let ri = 0; ri < m; ri++) J[ri][ci] = (rP[ri] - rM[ri]) / dh;
    }
    return J;
}

// Central-difference ∇MF, used when the analytic Jacobian declines a merit
// term (ramp/TT/total single-side). Differentiates the true MF directly;
// writes into g and returns it.
function gradientByDifferences(eng, thk, free, g) {
    eng.mfAt(thk);   // warm the eval cache at the base point
    for (const k of free) {
        const { thkP, thkM, dh } = differencePoints(eng, thk, k);
        g[k] = dh <= 0 ? 0 : (eng.mfAt(thkP) - eng.mfAt(thkM)) / dh;
    }
    return g;
}

// g[free[c]] = scale · (Jᵀr)_c.
function scaledJtr(J, r, free, scale, g) {
    for (let ci = 0; ci < free.length; ci++) {
        let s = 0;
        for (let ri = 0; ri < r.length; ri++) s += J[ri][ci] * r[ri];
        g[free[ci]] = s * scale;
    }
    return g;
}

/**
 * Exact analytic gradient ∇MF(thk), length thk.length, zero at locked
 * indices. Derivation: MF = √(SSR/ΣW), SSR = Σ rᵢ² = dot(_residuals).
 * _analyticJacobian is J = ∂(_residuals)/∂d, so ∂SSR/∂dⱼ = 2(Jᵀr)ⱼ and
 *   ∇MF = ∇SSR / (2·ΣW·MF) = (Jᵀr)·MF / SSR
 * (ΣW cancels via SSR = ΣW·MF²). Falls back to central differences on mfAt
 * when the analytic Jacobian declines a merit term, the same fallback policy
 * as the step. Both branches return the true ∇MF, so CG sees a consistent
 * gradient whichever branch it takes.
 */
export function meritGradient(eng, thk, freeIdxIn) {
    const free  = freeIdxIn || thk.map((_, i) => i).filter(i => !eng.lockedMask[i]);
    const g     = new Array(thk.length).fill(0);
    if (free.length === 0) return g;

    // One evaluation at the base point serves the residuals and the Jacobian
    // (M5). The gradient is the hot path for CG (default synthesis refiner)
    // and Newton-CG, so this halves its TMM cost per call. Pure ⇒ bit-identical.
    const compBase = eng._evaluate(thk);
    const r   = eng._residuals(thk, compBase);
    let SSR = 0;
    for (let i = 0; i < r.length; i++) SSR += r[i] * r[i];
    if (SSR === 0 || r.length === 0) return g;   // already at a target → zero gradient

    const J = eng._analyticJacobian(thk, free, compBase);
    if (!J) return gradientByDifferences(eng, thk, free, g);
    // ∇MF = (Jᵀr) / (‖r‖ · √D)  where MF = √(SSR/D) and SSR = Σ(√w·r)².
    // D is calcMF's normalization denominator over the rows it scored at this
    // point (optical weight only, never the MNT/MXT/TT constraint weights, and
    // never a comment row's), so the gradient is the gradient of the reported
    // MF. Over environments D is the groups' mean weight sum D̄
    // (environmentGroups.js), with MF = ‖r‖/√D̄.
    let sumW = eng._groups ? eng._groups.weightSum(compBase) : mfWeightDenominator(eng.operands, compBase);
    if (sumW <= 0) sumW = 1;
    const normR = Math.sqrt(SSR);           // = ‖r‖ = √D · MF
    return scaledJtr(J, r, free, 1 / (normR * Math.sqrt(sumW)), g);
}
