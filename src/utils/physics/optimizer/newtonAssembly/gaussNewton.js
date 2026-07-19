/**
 * Gauss-Newton core matrix ops for the merit-function Hessian.
 *
 * Minimizing MF = √(SSR/ΣW) ≡ minimizing SSR = Σ rₚ²; the Newton system solves
 * H_SSR·Δ = −∇SSR with H_SSR = 2·(JᵀJ + S), S[a][b] = Σₚ rₚ·∂²rₚ/∂dₐ∂d_b (the
 * factor 2 cancels). Gauss-Newton keeps only JᵀJ (S→0 near the optimum).
 */

// Gauss-Newton core: JᵀJ (upper triangle only) and Jtr = Jᵀr for a residual
// vector r0 and Jacobian J (m × nFree).
export function _jtjUpper(J, r0, nFree, m) {
    const H   = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    const Jtr = new Array(nFree).fill(0);
    for (let row = 0; row < m; row++) {
        const Jr = J[row], rr = r0[row];
        for (let a = 0; a < nFree; a++) {
            Jtr[a] += Jr[a] * rr;
            const Jra = Jr[a];
            for (let b = a; b < nFree; b++) H[a][b] += Jra * Jr[b];
        }
    }
    return { H, Jtr };
}

// Fill the lower triangle of an upper-triangular symmetric matrix in place.
export function _mirrorUpper(H, nFree) {
    for (let a = 0; a < nFree; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
}

// H += coef · d2  (upper triangle).
export function _addS(H, nFree, coef, d2) {
    if (!coef) return;
    for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) H[a][b] += coef * d2[a][b];
}
