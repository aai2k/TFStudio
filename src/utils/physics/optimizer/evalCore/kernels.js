/**
 * TMM kernel entry points: each picks the WASM kernel when the feature flag is on
 * and a module is instantiated in this thread, and falls back to the JS
 * implementation in thinFilmMath.js otherwise. Every wrapper returns the same
 * shape from both paths, so callers never branch on which one ran.
 */

import { tmm, tmmNeedleScan, tmmThicknessJacobian, tmmThicknessHessian } from '../../thinFilmMath.js';
import { tmmWasmActive, getTmmWasm } from '../../../../tmmcore.js';

// Single (λ,θ,pol) R/T/A — WASM kernel when the feature flag is on AND a module
// is instantiated (in this thread), else the JS tmm(). pol: 's'|'p'. Behind the
// flag (default off) so optimizer output is unchanged until the .wasm is built,
// the flag enabled, and tests/wasm_tmm_equivalence.mjs passes.
export function tmmOne(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmOne(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
    }
    return tmm(lam, aoi, polCode, n0, ns, layers);
}

// Analytic thickness Jacobian for one (λ,θ,pol) — WASM kernel when active, else
// the JS tmmThicknessJacobian(). Returns the SAME shape ({R,T,A,dRdd,dTdd,dAdd,N})
// so the DLS _analyticJacobian chain rule is unchanged. Behind the flag (off by
// default); the DLS step is the other optimizer hot path besides mfAt.
export function tmmJacEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmJacobian(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
    }
    return tmmThicknessJacobian(lam, aoi, polCode, n0, ns, layers);
}

// Analytic thickness HESSIAN — WASM kernel when active AND the loaded module
// carries it (older .wasm builds lack it → JS fallback), else JS. Returns the
// SAME shape ({R,T,A,dRdd,dTdd,dAdd,d2Rdd,d2Tdd,d2Add,N}) as the JS oracle so the
// SQP/Newton getH() consumer is unchanged. The dense Hessian is ~17× a gradient
// and was the un-accelerated hot spot starving SQP in synthesis.
export function tmmHessEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        const w = getTmmWasm();
        if (w.hasHessian()) {
            return w.tmmHessian(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
        }
    }
    return tmmThicknessHessian(lam, aoi, polCode, n0, ns, layers);
}

// Analytic needle P-function scan — WASM kernel when active, else JS. Returns
// the SAME nested {R,T,A,gaps,intra,N} so the Needle/GE scanners are unchanged.
export function tmmNeedleScanEval(lam, aoi, polCode, n0, ns, layers, candNs, fracs) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmNeedleScan(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers, candNs, fracs);
    }
    return tmmNeedleScan(lam, aoi, polCode, n0, ns, layers, candNs, fracs);
}
