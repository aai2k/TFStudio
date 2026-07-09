/**
 * Analytic Jacobian assembly for the least-squares engine.
 *
 * Pure functions that build the exact analytic ∂(residual)/∂(thickness) Jacobian
 * used by `LSQEngine._analyticJacobian`, factored out of the engine so each piece
 * is small and independently readable:
 *  - `computeLayerJacobian` — per-(λ,pol,aoi) TMM Jacobian package for a surface
 *    mode (single-front direct, single-back reversed-stack, or the Macleod §2.6.4
 *    full-system composition).
 *  - `makePointEvaluators` — memoized propDeriv/propVal over free variables.
 *  - `_jacRow*` — per-operand-type Jacobian-row builders + the `_jacRow` dispatch.
 *  - `_surfaceLayout` — surface mode → { mode, varSide } resolution.
 *
 * References: Macleod, Thin-Film Optical Filters §2.6.4; Sullivan & Dobrowolski,
 * Appl. Opt. 35 (1996).
 */

import { tmmJacEval } from './evalCore.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../spectralWeightings.js';
import {
    isConstraint, isRangeTarget, isIntegral, isMinmax, isMinType, polFromType,
} from './operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg } from './sampling.js';

// Per-point layer-thickness Jacobian at one (λ, polCode, aoi). Returns the
// property values (R/T/A) and their per-layer thickness derivatives for the
// active surface mode. `cfg` bundles the engine fields this needs so the routine
// stays a pure function of its inputs:
//   { mode, n0mat, nsmat, neMat, mats, thk, N, ctx, subThickMm }
// where mode ∈ {'singleFront','singleBack','full'}.
function computeLayerJacobian(lam, polCode, aoi, cfg) {
    const { mode, n0mat, nsmat, neMat, mats, thk, N, ctx, subThickMm } = cfg;
    if (mode === 'singleFront') {
        const n0 = n0mat.getNK(lam);
        const ns = nsmat.getNK(lam);
        const layers = thk.map((d, i) => ({ n: mats[i].getNK(lam), d }));
        const J = tmmJacEval(lam, aoi, polCode, n0, ns, layers);
        return { kind: 'singleFront', R: J.R, T: J.T, A: J.A,
                 dR: J.dRdd, dT: J.dTdd, dA: J.dAdd };
    }
    if (mode === 'singleBack') {
        // backThicks are stored substrate→exit; for light incident from
        // the exit medium the TMM sees them in exit→substrate order, so
        // reverse for the call. Derivatives indexed in reversed-stack
        // positions; map back to storage indices on the way out.
        const n0 = neMat.getNK(lam);
        const ns = nsmat.getNK(lam);
        const layersRev = [];
        for (let i = N - 1; i >= 0; i--) {
            layersRev.push({ n: mats[i].getNK(lam), d: thk[i] });
        }
        const J = tmmJacEval(lam, aoi, polCode, n0, ns, layersRev);
        const dR = new Array(N), dT = new Array(N), dA = new Array(N);
        for (let i = 0; i < N; i++) {
            const j = N - 1 - i;
            dR[i] = J.dRdd[j]; dT[i] = J.dTdd[j]; dA[i] = J.dAdd[j];
        }
        return { kind: 'singleBack', R: J.R, T: J.T, A: J.A, dR, dT, dA };
    }
    // ── Full system (symmetric / both_independent) ─────────────────
    // Compose three TMM Jacobians via Macleod §2.6.4:
    //   T_sys = T_f · P · T_b / (1 − R_f' · R_b · P²)
    //   R_sys = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
    // Then propagate per-layer ∂R/∂d, ∂T/∂d through the same chain
    // rule used in scanNeedlesAnalytic (front insertions read fwd+rev,
    // back insertions read bck).
    const n0 = n0mat.getNK(lam);
    const ns = nsmat.getNK(lam);
    const ne = neMat.getNK(lam);

    const sin0 = Math.sin(aoi * Math.PI / 180);
    const sinSub = ns[0] > 0 ? Math.min(1, n0[0] * sin0 / ns[0]) : 0;
    const cosSub = Math.sqrt(1 - sinSub * sinSub);
    const aoiSub = Math.asin(sinSub) * 180 / Math.PI;

    const frontMats   = ctx.frontMats;
    const frontThicks = ctx.frontThicks;
    const backMats    = ctx.backMats;
    const backThicks  = ctx.backThicks;

    const fLayers    = frontThicks.map((d, i) => ({ n: frontMats[i].getNK(lam), d }));
    const fLayersRev = [...fLayers].reverse();
    const bLayers    = backThicks.map((d, i)  => ({ n: backMats[i].getNK(lam),  d }));

    const Jfwd = tmmJacEval(lam, aoi,    polCode, n0, ns, fLayers);
    const Jrev = tmmJacEval(lam, aoiSub, polCode, ns, n0, fLayersRev);
    const Jbck = tmmJacEval(lam, aoiSub, polCode, ns, ne, bLayers);

    const k_sub    = ns[1];
    const d_sub_nm = subThickMm * 1e6;
    const P  = (k_sub > 0 && cosSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosSub))
        : 1.0;
    const P2 = P * P;

    const Rf  = Jfwd.R, Tf  = Jfwd.T;
    const Rfp = Jrev.R, Tfp = Jrev.T;
    const Rb  = Jbck.R, Tb  = Jbck.T;

    const D     = 1 - Rfp * Rb * P2;
    const invD2 = 1 / (D * D);
    const R_sys = Rf + (Tf * Tfp * P2 * Rb) / D;
    const T_sys = (Tf * P * Tb) / D;
    const A_sys = Math.max(0, 1 - R_sys - T_sys);

    const Nf = fLayers.length, Nb = bLayers.length;
    const dR_front = new Array(Nf), dT_front = new Array(Nf), dA_front = new Array(Nf);
    for (let i = 0; i < Nf; i++) {
        const dRf  = Jfwd.dRdd[i],          dTf  = Jfwd.dTdd[i];
        // Front layer i (storage air→sub) sits at reversed-pass index (Nf-1-i).
        const dRfp = Jrev.dRdd[Nf - 1 - i], dTfp = Jrev.dTdd[Nf - 1 - i];
        const dT   = (P * Tb) * invD2 * (D * dTf + Tf * P2 * Rb * dRfp);
        const dR   = dRf + (P2 * Rb) * invD2 *
                        (D * (dTf * Tfp + Tf * dTfp) + Tf * Tfp * P2 * Rb * dRfp);
        dR_front[i] = dR; dT_front[i] = dT; dA_front[i] = -(dR + dT);
    }
    const dR_back = new Array(Nb), dT_back = new Array(Nb), dA_back = new Array(Nb);
    for (let i = 0; i < Nb; i++) {
        const dRb = Jbck.dRdd[i], dTb = Jbck.dTdd[i];
        const dT  = (P * Tf) * invD2 * (D * dTb + Tb * P2 * Rfp * dRb);
        const dR  = (Tf * Tfp * P2) * invD2 * dRb;
        dR_back[i] = dR; dT_back[i] = dT; dA_back[i] = -(dR + dT);
    }

    return { kind: 'full', R: R_sys, T: T_sys, A: A_sys,
             dR_front, dT_front, dA_front,
             dR_back,  dT_back,  dA_back };
}

// Per-layer thickness-derivative array of one characteristic (T/R/A) from a
// computeLayerJacobian package. `side` selects '' (single-surface), 'front', or
// 'back' for the composed full-system derivatives.
function _pickDeriv(J, char, side) {
    if (side === 'front') return char === 'T' ? J.dT_front : char === 'R' ? J.dR_front : J.dA_front;
    if (side === 'back')  return char === 'T' ? J.dT_back  : char === 'R' ? J.dR_back  : J.dA_back;
    return char === 'T' ? J.dT : char === 'R' ? J.dR : J.dA;
}

// Accumulate the composed full-system per-side derivatives onto the free vector,
// keyed by how the surface mode lays free variables out. `map` = { N, nFront,
// nBack }.
const VAR_SIDE_ACCUM = {
    // thk[i] is the front variable; the auto-mirrored back layer (Nb-1-i) shares
    // the same physical thickness, so its sensitivity adds to the same free
    // variable. (Nf = Nb = N by construction in symmetric mode.)
    symmetric(out, df, db, weight, { N }) {
        for (let i = 0; i < N; i++) out[i] += weight * (df[i] + db[N - 1 - i]);
    },
    // both_independent: free vector is [front..., back...].
    both(out, df, db, weight, { nFront, nBack }) {
        for (let i = 0; i < nFront; i++) out[i]          += weight * df[i];
        for (let i = 0; i < nBack;  i++) out[nFront + i] += weight * db[i];
    },
    // back_only + total: free vars = back layers only.
    back(out, df, db, weight, { nBack }) {
        for (let i = 0; i < nBack; i++) out[i] += weight * db[i];
    },
    // front_only + total: free vars = front layers only.
    front(out, df, db, weight, { nFront }) {
        for (let i = 0; i < nFront; i++) out[i] += weight * df[i];
    },
};

// Map a Jacobian package's per-side per-layer derivatives onto the free-variable
// vector `out` (weighted, accumulating). `map` bundles the layout the surface
// mode fixes: { N, varSide, nFront, nBack }, varSide ∈
// {'front','back','both','symmetric'}.
function accumulateJacInto(out, J, char, weight, map) {
    if (J.kind === 'singleFront' || J.kind === 'singleBack') {
        const d = _pickDeriv(J, char, '');
        for (let i = 0; i < map.N; i++) out[i] += weight * d[i];
        return;
    }
    VAR_SIDE_ACCUM[map.varSide](out, _pickDeriv(J, char, 'front'), _pickDeriv(J, char, 'back'), weight, map);
}

// Value of one characteristic (T/R/A) from a computeLayerJacobian package.
function _pickVal(Jc, char) { return char === 'T' ? Jc.T : char === 'R' ? Jc.R : Jc.A; }

// Resolve the analytic-Jacobian surface layout from the design's surface mode.
// `mode` selects the computeLayerJacobian path (singleFront / singleBack / full,
// where full covers symmetric, both_independent, and any full-system scoring);
// `varSide` selects how full-system per-side derivatives map onto free variables.
export function _surfaceLayout(surfaceMode, evalFull) {
    const isFull = evalFull || surfaceMode === 'symmetric' || surfaceMode === 'both_independent';
    const mode = isFull ? 'full'
               : surfaceMode === 'front_only' ? 'singleFront'
               : surfaceMode === 'back_only'  ? 'singleBack'
               :                                'full';
    const varSide = surfaceMode === 'both_independent' ? 'both'
                  : surfaceMode === 'symmetric'        ? 'symmetric'
                  : surfaceMode === 'back_only'        ? 'back'
                  :                                      'front';
    return { mode, varSide };
}

// Build the memoized point evaluators used to assemble the analytic Jacobian:
//   propDeriv(λ,pol,char,aoi) → ∂(property)/∂d for every free variable
//   propVal(λ,pol,char,aoi)   → the property value
// both honoring pol='avg' as ½(s+p). `jacCfg` is the computeLayerJacobian config;
// `sideMap` is the free-variable layout { N, varSide, nFront, nBack }. One
// Jacobian package is cached per (λ, polCode, aoi) and reused across operands.
export function makePointEvaluators(jacCfg, sideMap) {
    const jacCache = new Map();
    const getJac = (lam, polCode, aoi) => {
        const key = lam + '|' + polCode + '|' + aoi;
        let v = jacCache.get(key);
        if (v === undefined) { v = computeLayerJacobian(lam, polCode, aoi, jacCfg); jacCache.set(key, v); }
        return v;
    };
    const propDeriv = (lam, pol, char, aoi) => {
        const out = new Array(sideMap.N).fill(0);
        if (pol === 'avg') {
            accumulateJacInto(out, getJac(lam, 's', aoi), char, 0.5, sideMap);
            accumulateJacInto(out, getJac(lam, 'p', aoi), char, 0.5, sideMap);
        } else {
            accumulateJacInto(out, getJac(lam, pol, aoi), char, 1.0, sideMap);
        }
        return out;
    };
    const propVal = (lam, pol, char, aoi) => {
        if (pol === 'avg')
            return 0.5 * (_pickVal(getJac(lam, 's', aoi), char) + _pickVal(getJac(lam, 'p', aoi), char));
        return _pickVal(getJac(lam, pol, aoi), char);
    };
    return { propDeriv, propVal };
}

// ── Per-operand analytic Jacobian rows ────────────────────────────────────────
// Each builder returns the length-nFree Jacobian row for one operand. `jc`
// bundles the shared context: { comp, freeIdx, nFree, ctx, propDeriv, propVal }.

// Index of the min (isMin) or max thickness over all[lo..hi].
function _constraintArgExtremum(all, lo, hi, isMin) {
    let argj = lo, best = all[lo] || 0;
    for (let jj = lo; jj <= hi; jj++) {
        const v = all[jj] || 0;
        if (isMin ? v < best : v > best) { best = v; argj = jj; }
    }
    return argj;
}

// Constraint (MNT/MXT): subgradient of sw·max(0, ±(target−comp)); comp = min
// (MNT) or max (MXT) over the 1-based layer-index range.
function _jacRowConstraint(op, i, jc) {
    const { comp, freeIdx, nFree, ctx } = jc;
    const row = new Array(nFree).fill(0);
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const lo = Math.max(0, Math.round(op.lambdaStart) - 1);
    const hi = Math.min(all.length - 1, Math.round(op.lambdaEnd) - 1);
    if (lo > hi) return row;
    const isMin = op.type === 'MNT';
    const violated = isMin ? (op.target - comp[i] > 0) : (comp[i] - op.target > 0);
    if (!violated) return row;
    const ci = freeIdx.indexOf(_constraintArgExtremum(all, lo, hi, isMin));
    if (ci >= 0) row[ci] = Math.sqrt(op.weight) * (isMin ? -1 : 1);
    return row;
}

// Continuous per-λ target (TGT/RGT/AGT): residual = sw·comp, comp = √(mean dev²);
// ∂comp/∂d_k = (1/(comp·n))·Σ dev_s·∂val_s/∂d_k.
function _jacRowRangeTarget(op, i, jc) {
    const { comp, freeIdx, nFree, propVal, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const cval = comp[i];
    if (cval <= 1e-12) return row;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const t0 = op.target;
    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
    for (let s = 0; s < n; s++) {
        const ti  = t0 + (t1 - t0) * (s / (n - 1));
        const dev = propVal(lams[s], pol, char, op.aoi) - ti;
        const d   = propDeriv(lams[s], pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] += dev * d[freeIdx[ci]];
    }
    const scale = sw / (cval * n);
    for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    return row;
}

// Weighted-integral: residual = sw·(C̄_w − target),
//   ∂C̄_w/∂d_j = Σ_i (w_i / Σ w_k) · ∂C_i/∂d_j   (linear, exact).
function _jacRowIntegral(op, i, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const S    = resolveSourceSpec(op.source   || { id: 'E' });
    const D    = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0;
    const wts = new Array(n);
    for (let s = 0; s < n; s++) {
        const w = S.sampler(lams[s]) * D.sampler(lams[s]);
        wts[s] = w; den += w;
    }
    if (den <= 1e-30) return row;
    const invDen = 1 / den;
    for (let s = 0; s < n; s++) {
        const wi = wts[s] * invDen;
        if (!(wi > 0)) continue;
        const d = propDeriv(lams[s], pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] += wi * d[freeIdx[ci]];
    }
    for (let ci = 0; ci < nFree; ci++) row[ci] *= sw;
    return row;
}

// Worst-case min/max: residual = sw·max(0, ±(target−comp)); when active the
// extremum is attained at one wavelength λ* (the argmin/argmax on the SAME grid
// evalOperand used), so the subgradient is sw·(±1)·∂C(λ*)/∂d_j.
function _jacRowMinmax(op, i, jc) {
    const { comp, freeIdx, nFree, propVal, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const isMin = isMinType(op.type);
    const violated = isMin ? (op.target - comp[i] > 0) : (comp[i] - op.target > 0);
    if (!violated) return row;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    let argS = 0, bestV = isMin ? Infinity : -Infinity;
    for (let s = 0; s < n; s++) {
        const v = propVal(lams[s], pol, char, op.aoi);
        if (isMin ? v < bestV : v > bestV) { bestV = v; argS = s; }
    }
    // ∂residual/∂comp under the violated branch: +1 for max, −1 for min.
    const dResSign = isMin ? -1 : +1;
    const d = propDeriv(lams[argS], pol, char, op.aoi);
    for (let ci = 0; ci < nFree; ci++) row[ci] = sw * dResSign * d[freeIdx[ci]];
    return row;
}

// Band mean (TAV/RAV/AAV, residual = sw·(mean − target)) or single-λ
// (residual = sw·(val − target)).
function _jacRowMeanOrSingle(op, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    if (isRangeAvg(op.type)) {
        const lams = operandSampleLambdas(op);
        const n = lams.length;
        for (let s = 0; s < n; s++) {
            const d = propDeriv(lams[s], pol, char, op.aoi);
            for (let ci = 0; ci < nFree; ci++) row[ci] += d[freeIdx[ci]];
        }
        const scale = sw / n;
        for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    } else {
        const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] = sw * d[freeIdx[ci]];
    }
    return row;
}

// Dispatch one operand to its Jacobian-row builder.
export function _jacRow(op, i, jc) {
    if (isConstraint(op.type))  return _jacRowConstraint(op, i, jc);
    if (isRangeTarget(op.type)) return _jacRowRangeTarget(op, i, jc);
    if (isIntegral(op.type))    return _jacRowIntegral(op, i, jc);
    if (isMinmax(op.type))      return _jacRowMinmax(op, i, jc);
    return _jacRowMeanOrSingle(op, jc);
}
