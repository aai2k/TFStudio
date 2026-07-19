/**
 * Plain-array vector helpers shared by the matrix-free optimizer solvers.
 */

export function _vdot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function _vnorm(a) { return Math.sqrt(_vdot(a, a)); }
