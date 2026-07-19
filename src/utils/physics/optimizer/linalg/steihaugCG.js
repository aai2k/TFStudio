/**
 * Steihaug truncated-CG for matrix-free Newton-CG.
 *
 * The Steihaug-Toint truncated CG that solves the trust-region subproblem
 * min ½pᵀHp + gᵀp  s.t. ‖p‖ ≤ Δ  using ONLY Hessian-vector products
 * hvp(d)=H·d — never the dense H. Handles negative curvature and the
 * trust-region boundary (Nocedal & Wright, Numerical Optimization 2e,
 * Alg. 7.2). This is the core of "Truncated Newton / Newton-CG", the
 * large-scale method.
 */

import { _vdot, _vnorm } from './vector.js';

// τ ≥ 0 solving ‖z + τ d‖ = Δ  (positive root); used to hit the TR boundary.
function _toBoundary(z, d, Delta) {
    const a = _vdot(d, d), b = 2 * _vdot(z, d), c = _vdot(z, z) - Delta * Delta;
    const disc = Math.max(0, b * b - 4 * a * c);
    const tau = a > 1e-300 ? (-b + Math.sqrt(disc)) / (2 * a) : 0;
    return z.map((zi, i) => zi + tau * d[i]);
}

export function steihaugCG(hvp, g, Delta, maxIter) {
    const n = g.length;
    const z = new Array(n).fill(0);
    let r = g.slice();                 // residual H·z + g, = g at z = 0
    let d = r.map(x => -x);
    const gnorm = _vnorm(g);
    const tol = Math.min(0.5, Math.sqrt(gnorm)) * gnorm;   // Eisenstat–Walker forcing
    if (gnorm < 1e-300) return z;
    let rr = _vdot(r, r);
    const lim = Math.min(maxIter, n + 5);
    for (let it = 0; it < lim; it++) {
        const Hd = hvp(d);
        const dHd = _vdot(d, Hd);
        if (dHd <= 1e-16 * _vdot(d, d)) return _toBoundary(z, d, Delta);  // neg/zero curvature → boundary
        const alpha = rr / dHd;
        const zNew = z.map((zi, i) => zi + alpha * d[i]);
        if (_vnorm(zNew) >= Delta) return _toBoundary(z, d, Delta);       // crossed TR boundary
        const rNew = r.map((ri, i) => ri + alpha * Hd[i]);
        for (let i = 0; i < n; i++) { z[i] = zNew[i]; r[i] = rNew[i]; }
        if (_vnorm(rNew) < tol) return z;                                // inner convergence
        const rrNew = _vdot(rNew, rNew);
        const beta = rrNew / rr;
        for (let i = 0; i < n; i++) d[i] = -rNew[i] + beta * d[i];
        rr = rrNew;
    }
    return z;
}
