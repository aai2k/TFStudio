/**
 * The small dense least-squares solver behind the dispersion and film fits.
 */
import assert from 'node:assert/strict';
import { levenbergMarquardt, sumSquares } from '../src/utils/math/leastSquares.js';

// ── A fit that has converged stops, instead of spending its iteration budget ──
//
// Levenberg-Marquardt answers a rejected step by raising the damping, and the
// damping has a ceiling. At the ceiling the state stops moving: the same
// parameters, residual and damping give the same Jacobian, the same step and the
// same rejection on every remaining iteration. A film fit reaches that point
// about halfway through its budget and used to spend the rest of it there, at
// several thousand transfer-matrix evaluations an iteration.
//
// The residual below cannot be driven under one, and its derivative at the
// minimum is zero, so every step is rejected from the start.
{
    let evaluations = 0;
    const residualAt = (parameters) => {
        evaluations += 1;
        return [parameters[0] * parameters[0] + 1];
    };

    const solution = levenbergMarquardt([0], residualAt, 500);
    assert.deepEqual(solution, [0], 'the answer is the point it started from');
    assert.equal(sumSquares(residualAt(solution)), 1);
    assert.ok(evaluations < 80,
        `a stalled fit must stop rather than run its budget out (${evaluations} evaluations)`);
}

// ── Stopping early changes no answer ─────────────────────────────────────────
//
// A budget large enough to reach the ceiling must give exactly what a budget
// several times larger gives, or the stop is discarding a step that would have
// been taken.
{
    const xs = [0.1, 0.4, 0.9, 1.6, 2.5];
    const data = xs.map(x => [x, 2 + 0.85 * x * x]);
    const residualAt = ([a, b]) => data.map(([x, y]) => a + b * x * x - y);
    const short = levenbergMarquardt([1, 1], residualAt, 60);
    const long = levenbergMarquardt([1, 1], residualAt, 600);
    assert.deepEqual(long, short, 'a longer budget reaches the same solution');
    assert.ok(sumSquares(residualAt(short)) < 1e-12, 'and that solution fits the data');
}

console.log('PASS: least_squares');
