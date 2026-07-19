/**
 * Damped least-squares solve via Householder QR (the DLS step).
 *
 * Solves  min_x ‖ A x − b ‖₂  for an over-determined system (M ≥ N) with
 * Householder QR.  In the DLS step A is the *augmented* Marquardt matrix
 * [ J ; diag(√(λ·sᵢ)) ] and b = [ −r ; 0 ], so the least-squares solution is
 * exactly the damped step  (JᵀJ + λ·S) Δ = −Jᵀr  — but solved WITHOUT ever
 * forming JᵀJ.  The working condition number is therefore κ(A) instead of
 * κ(A)² (Golub & Van Loan, *Matrix Computations*, §5.3; same reasoning as
 * OpenFilters `moremath/QR.py`, and the numerical-stability requirement in
 * CLAUDE.md / Macleod).  The damping block makes A full column rank for any
 * λ>0, so plain Householder QR is well-posed — no column pivoting needed.
 */

// Householder reflector zeroing column k of the M×N matrix R below the diagonal
// (M = R.length). Returns { v, vtv } (v length M, zero above row k), or null for
// a null column.
function _householderCol(R, k) {
    const M = R.length;
    let norm = 0;
    for (let i = k; i < M; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) return null;        // null column → leave x_k = 0
    const alpha = R[k][k] >= 0 ? -norm : norm;
    const v = new Array(M).fill(0);
    v[k] = R[k][k] - alpha;
    for (let i = k + 1; i < M; i++) v[i] = R[i][k];
    let vtv = 0;
    for (let i = k; i < M; i++) vtv += v[i] * v[i];
    if (vtv < 1e-300) return null;
    return { v, vtv };
}

// Apply Householder reflector ref = { v, vtv } to R columns k..N-1 and to c,
// in place (M = R.length, N = R[0].length).
function _applyHouseholder(R, c, ref, k) {
    const M = R.length, N = R[0].length, { v, vtv } = ref;
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

// Back-substitution on the upper-triangular N×N block of R (N = R[0].length):
// solve R x = c.
function _backSubUpper(R, c) {
    const N = R[0].length;
    const x = new Array(N).fill(0);
    for (let i = N - 1; i >= 0; i--) {
        let s = c[i];
        for (let j = i + 1; j < N; j++) s -= R[i][j] * x[j];
        x[i] = Math.abs(R[i][i]) < 1e-300 ? 0 : s / R[i][i];
    }
    return x;
}

export function solveLeastSquaresQR(A, b) {
    const N = A[0].length;
    const R = A.map(row => row.slice());   // operate on copies
    const c = b.slice();
    for (let k = 0; k < N; k++) {
        const ref = _householderCol(R, k);
        if (!ref) continue;                // null column → leave x_k = 0
        _applyHouseholder(R, c, ref, k);
    }
    return _backSubUpper(R, c);
}
