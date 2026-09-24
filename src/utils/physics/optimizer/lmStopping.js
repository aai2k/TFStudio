/**
 * Stopping tests for the Levenberg-Marquardt refiner (LSQEngine.step).
 *
 * Damping that saturates is not enough on its own. Near a minimum with a
 * nonzero residual an LM step keeps being accepted with gains of a few parts in
 * a billion, every acceptance halves the damping, and the damping reaches its
 * ceiling only after hundreds of further iterations. The ftol and xtol tests
 * of MINPACK-1 lmder (J. J. Moré, B. S. Garbow and K. E. Hillstrom, User Guide
 * for MINPACK-1, Argonne ANL-80-74, 1980, §2.2 and the lmder source) end the
 * run there instead. Both are judged on an accepted step:
 *
 *   'reduction'  the actual and the predicted relative reductions of the sum
 *                of squares are both at most LM_FTOL, and the actual one is at
 *                most twice the predicted one. The prediction is the linear
 *                model's, 1 − ‖r + JΔ‖²/‖r‖², so the test fires only when the
 *                model itself sees nothing left to gain, not when a slow crawl
 *                happens to make a small step.
 *   'step'       the step moved the design by at most LM_XTOL of itself in the
 *                Marquardt scaling D = diag(JᵀJ)^½: ‖DΔ‖ ≤ LM_XTOL·‖Dd‖.
 *                lmder applies this bound to its trust-region radius; this
 *                refiner has no radius, so the accepted step itself is tested.
 *
 * LM_FTOL = LM_XTOL = √ε: MINPACK's lmder1 driver passes one tolerance as
 * both, and its documentation recommends the square root of the machine
 * precision for it. On the refinement benchmark cases a run stopped by them is
 * within one part in a million of the merit the same run reaches 2000
 * iterations later.
 *
 * The other two tests are 'target', the merit under the engine's tolerance,
 * and 'damping', the damping at its ceiling.
 */

export const LM_FTOL = Math.sqrt(Number.EPSILON);
export const LM_XTOL = Math.sqrt(Number.EPSILON);
export const LM_MAX_DAMPING = 1e8;

/**
 * ‖DΔ‖ / ‖Dd‖ for a step `move` taken from `point`, both per variable in nm,
 * with `scale2` the squared Marquardt scale D² of each variable. Infinity when
 * the point has no scaled size.
 */
export function scaledStepRatio(move, point, scale2) {
    let step = 0, size = 0;
    for (let c = 0; c < move.length; c++) {
        step += scale2[c] * move[c] * move[c];
        size += scale2[c] * point[c] * point[c];
    }
    return size > 0 ? Math.sqrt(step / size) : Infinity;
}

/**
 * Relative reduction of the sum of squares the linear model predicts for the
 * step `move`: 1 − ‖r + J·move‖²/‖r‖², J the m × n Jacobian over the moved
 * variables. 0 when r is zero.
 */
export function predictedReduction(J, r, move) {
    let before = 0, after = 0;
    for (let i = 0; i < r.length; i++) {
        let v = r[i];
        for (let c = 0; c < move.length; c++) v += J[i][c] * move[c];
        before += r[i] * r[i];
        after += v * v;
    }
    return before > 0 ? 1 - after / before : 0;
}

/**
 * The test that ends the run after this iteration, or null to go on. `step`
 * describes the accepted step, null when the trial was rejected: `actual` and
 * `predicted` relative reductions of the sum of squares and the scaled step
 * `ratio` (scaledStepRatio).
 */
export function lmStopReason({ mf, tol, lamD, step }) {
    if (mf < tol) return 'target';
    if (lamD >= LM_MAX_DAMPING) return 'damping';
    if (!step) return null;
    const { actual, predicted, ratio } = step;
    if (Math.abs(actual) <= LM_FTOL && predicted <= LM_FTOL && actual <= 2 * predicted) return 'reduction';
    return ratio <= LM_XTOL ? 'step' : null;
}
