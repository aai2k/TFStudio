/**
 * Surface-mode layout resolution and the memoized analytic-Jacobian point
 * evaluators.
 *
 *  - `_surfaceLayout` — surface mode → { mode, varSide } resolution.
 *  - `makePointEvaluators` — memoized propDeriv/propVal over free variables,
 *    mapping a `computeLayerJacobian` package's per-side per-layer derivatives
 *    onto the free-variable vector per the surface mode's layout.
 */

import { computeLayerJacobian } from './layerJacobian.js';

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
