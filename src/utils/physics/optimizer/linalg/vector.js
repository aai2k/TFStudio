/**
 * Plain-array vector helpers shared by the optimizer solvers.
 */

export function _vdot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function _vnorm(a) { return Math.sqrt(_vdot(a, a)); }
// A·v for a matrix A given as an array of rows.
export function _matVec(A, v) { return A.map(row => _vdot(row, v)); }
