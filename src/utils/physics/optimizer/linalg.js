/**
 * Linear-algebra solvers for the optimizer (DLS / Newton / SQP steps).
 *
 * PURE and dependency-free. Each solver family lives in its own module under
 * `linalg/`; this barrel re-exports the public surface:
 *   • Householder-QR damped least squares  (linalg/qr.js)
 *   • Cholesky (PD) solve                   (linalg/cholesky.js)
 *   • Steihaug truncated-CG (matrix-free)   (linalg/steihaugCG.js)
 *   • primal active-set box QP              (linalg/boxQP.js)
 * References: Golub & Van Loan §5.3; Nocedal & Wright 2e Alg. 7.2.
 */

export { solveLeastSquaresQR } from './linalg/qr.js';
export { choleskySolve } from './linalg/cholesky.js';
export { steihaugCG } from './linalg/steihaugCG.js';
export { solveBoxQP } from './linalg/boxQP.js';
export { _vdot, _vnorm } from './linalg/vector.js';
