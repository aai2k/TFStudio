/**
 * Linear-algebra solvers for the optimizer (DLS / Newton / SQP steps).
 *
 * PURE and
 * dependency-free: Householder-QR damped least squares, Cholesky (PD) solve,
 * Steihaug truncated-CG (matrix-free), and a primal active-set box QP. Used by
 * DLSOptimizer. References: Golub & Van Loan §5.3; Nocedal & Wright 2e Alg.7.2.
 */

// ── Damped least-squares solve via Householder QR ────────────────────────────
//
// Solves  min_x ‖ A x − b ‖₂  for an over-determined system (M ≥ N) with
// Householder QR.  In the DLS step A is the *augmented* Marquardt matrix
// [ J ; diag(√(λ·sᵢ)) ] and b = [ −r ; 0 ], so the least-squares solution is
// exactly the damped step  (JᵀJ + λ·S) Δ = −Jᵀr  — but solved WITHOUT ever
// forming JᵀJ.  The working condition number is therefore κ(A) instead of
// κ(A)² (Golub & Van Loan, *Matrix Computations*, §5.3; same reasoning as
// OpenFilters `moremath/QR.py`, and the numerical-stability requirement in
// CLAUDE.md / Macleod).  The damping block makes A full column rank for any
// λ>0, so plain Householder QR is well-posed — no column pivoting needed.
export function solveLeastSquaresQR(A, b) {
    const M = A.length;
    const N = A[0].length;
    const R = A.map(row => row.slice());   // operate on copies
    const c = b.slice();
    for (let k = 0; k < N; k++) {
        // Householder reflector zeroing column k below the diagonal.
        let norm = 0;
        for (let i = k; i < M; i++) norm += R[i][k] * R[i][k];
        norm = Math.sqrt(norm);
        if (norm < 1e-300) continue;       // null column → leave x_k = 0
        const alpha = R[k][k] >= 0 ? -norm : norm;
        const v = new Array(M).fill(0);
        v[k] = R[k][k] - alpha;
        for (let i = k + 1; i < M; i++) v[i] = R[i][k];
        let vtv = 0;
        for (let i = k; i < M; i++) vtv += v[i] * v[i];
        if (vtv < 1e-300) continue;
        for (let j = k; j < N; j++) {
            let s = 0;
            for (let i = k; i < M; i++) s += v[i] * R[i][j];
            s = (2 * s) / vtv;
            for (let i = k; i < M; i++) R[i][j] -= s * v[i];
        }
        let sc = 0;
        for (let i = k; i < M; i++) sc += v[i] * c[i];
        sc = (2 * sc) / vtv;
        for (let i = k; i < M; i++) c[i] -= sc * v[i];
    }
    // Back-substitution on the upper-triangular N×N block.
    const x = new Array(N).fill(0);
    for (let i = N - 1; i >= 0; i--) {
        let s = c[i];
        for (let j = i + 1; j < N; j++) s -= R[i][j] * x[j];
        x[i] = Math.abs(R[i][i]) < 1e-300 ? 0 : s / R[i][i];
    }
    return x;
}

// ── Cholesky solve for symmetric positive-definite systems (Newton step) ──────
// Solves A·x = b for symmetric A via LLᵀ. Returns null if A is not positive
// definite (a pivot ≤ 0) — the modified-Newton driver uses that signal to
// raise damping until the damped Hessian is PD (this is the trust-region
// safeguard that makes "Hyper Newton" robust on indefinite Hessians far from
// the minimum). A is the upper-triangle-filled n×n matrix; only A[i][j], j≤i
// is read.
export function choleskySolve(A, b) {
    const n = b.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let s = A[i][j];
            for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
            if (i === j) {
                if (!(s > 0)) return null;      // not positive definite
                L[i][i] = Math.sqrt(s);
            } else {
                L[i][j] = s / L[j][j];
            }
        }
    }
    // Forward solve L·y = b
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
        y[i] = s / L[i][i];
    }
    // Back solve Lᵀ·x = y
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
        x[i] = s / L[i][i];
    }
    return x;
}

// ── Steihaug truncated-CG for matrix-free Newton-CG ───────────────────────────
// Vector helpers (plain arrays) + the Steihaug-Toint truncated CG that solves
// the trust-region subproblem  min ½pᵀHp + gᵀp  s.t. ‖p‖ ≤ Δ  using ONLY
// Hessian-vector products hvp(d)=H·d — never the dense H. Handles negative
// curvature and the trust-region boundary (Nocedal & Wright, Numerical
// Optimization 2e, Alg. 7.2). This is the core of "Truncated Newton /
// Newton-CG", the large-scale method.
export function _vdot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function _vnorm(a) { return Math.sqrt(_vdot(a, a)); }
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

// ── Box-constrained QP (primal active-set) for bounded SQP ────────────────────
// Solves  min_Δ  ½ Δᵀ H Δ + gᵀΔ   s.t.  lo ≤ Δ ≤ hi   (element-wise box),
// for a STRICTLY CONVEX H (the caller passes a diagonally-damped, PD Hessian —
// raise damping and retry if this returns null). Textbook primal active-set:
// repeatedly solve the equality-constrained sub-QP on the free set, add the
// first variable that hits a bound along the step, and release a fixed variable
// whose KKT multiplier points back into the feasible region — terminates
// finitely for strictly convex box QPs. Returns the optimal Δ (always feasible:
// lo ≤ Δ ≤ hi, and Δ = 0 must be feasible, i.e. lo ≤ 0 ≤ hi), or null if a
// sub-solve is not PD.
export function solveBoxQP(H, g, lo, hi) {
    const n = g.length;
    const fixed = new Array(n).fill(0);   // 0 free, -1 pinned at lo, +1 pinned at hi
    const Delta = new Array(n).fill(0);
    const maxIter = 4 * n + 20;
    for (let iter = 0; iter < maxIter; iter++) {
        const F = [];
        for (let i = 0; i < n; i++) if (!fixed[i]) F.push(i);
        if (F.length > 0) {
            // Solve H_FF·δ_F = −(g_F + H_FW·Δ_W) on the free set.
            const nf = F.length;
            const Hs = Array.from({ length: nf }, () => new Array(nf).fill(0));
            const bs = new Array(nf).fill(0);
            for (let a = 0; a < nf; a++) {
                let rhs = -g[F[a]];
                for (let i = 0; i < n; i++) if (fixed[i]) rhs -= H[F[a]][i] * Delta[i];
                bs[a] = rhs;
                const Hrow = H[F[a]];
                for (let b = 0; b < nf; b++) Hs[a][b] = Hrow[F[b]];
            }
            const dF = choleskySolve(Hs, bs);
            if (!dF) return null;           // not PD → caller raises damping
            // Max feasible step t∈[0,1] from current Δ toward the sub-solution.
            let t = 1, block = -1, blockSide = 0;
            for (let a = 0; a < nf; a++) {
                const i = F[a], from = Delta[i], to = dF[a];
                if (to < lo[i] - 1e-15) { const tt = (lo[i] - from) / (to - from); if (tt < t) { t = tt; block = i; blockSide = -1; } }
                else if (to > hi[i] + 1e-15) { const tt = (hi[i] - from) / (to - from); if (tt < t) { t = tt; block = i; blockSide = 1; } }
            }
            for (let a = 0; a < nf; a++) { const i = F[a]; Delta[i] = Delta[i] + t * (dF[a] - Delta[i]); }
            if (block >= 0) { Delta[block] = blockSide < 0 ? lo[block] : hi[block]; fixed[block] = blockSide; continue; }
        }
        // Free set at its constrained minimizer → check KKT multipliers of pinned
        // vars: λ_i = (H·Δ + g)_i. Release a var whose objective would drop if it
        // left its bound (λ<0 at lo: increasing helps; λ>0 at hi: decreasing helps).
        const HD = new Array(n).fill(0);
        for (let i = 0; i < n; i++) { let s = 0; const Hi = H[i]; for (let j = 0; j < n; j++) s += Hi[j] * Delta[j]; HD[i] = s; }
        let released = false;
        for (let i = 0; i < n; i++) {
            if (!fixed[i]) continue;
            const lam = HD[i] + g[i];
            if (fixed[i] < 0 && lam < -1e-12) { fixed[i] = 0; released = true; }
            else if (fixed[i] > 0 && lam > 1e-12) { fixed[i] = 0; released = true; }
        }
        if (!released) break;
    }
    return Delta;
}
