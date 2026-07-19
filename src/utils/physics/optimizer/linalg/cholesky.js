/**
 * Cholesky solve for symmetric positive-definite systems (Newton step).
 *
 * Solves A·x = b for symmetric A via LLᵀ. Returns null if A is not positive
 * definite (a pivot ≤ 0) — the modified-Newton driver uses that signal to
 * raise damping until the damped Hessian is PD (this is the trust-region
 * safeguard that makes "Hyper Newton" robust on indefinite Hessians far from
 * the minimum). A is the upper-triangle-filled n×n matrix; only A[i][j], j≤i
 * is read.
 */

// Cholesky factor A = L Lᵀ (lower L). Reads only A[i][j], j≤i. Returns L, or
// null if A is not positive definite (a pivot ≤ 0).
function _choleskyFactor(A, n) {
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
    return L;
}

export function choleskySolve(A, b) {
    const n = b.length;
    const L = _choleskyFactor(A, n);
    if (!L) return null;                    // not positive definite
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
