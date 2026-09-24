/**
 * The small dense least-squares solver behind the dispersion and film fits.
 */
import assert from 'node:assert/strict';
import { levenbergMarquardt, parameterSpread, sumSquares } from '../src/utils/math/leastSquares.js';

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

// ── A rejected step does not rebuild the Jacobian ────────────────────────────
//
// Rejection leaves the parameters unchanged, so the Jacobian is still exact and
// rebuilding it buys nothing at the price of one residual evaluation per
// parameter — and in the film fits one evaluation is a full transfer-matrix
// spectrum. The residual below is nearly flat at the start, so the first step
// overshoots and is rejected many times while the damping climbs; through all
// of it the start point must be probed for the Jacobian exactly once.
{
    const start = 5;
    const delta = 1e-6 * Math.max(1, Math.abs(start));
    let probesAtStart = 0;
    const residualAt = (parameters) => {
        if (parameters[0] === start + delta) probesAtStart += 1;
        return [10 * Math.tanh(parameters[0])];
    };

    const solution = levenbergMarquardt([start], residualAt, 80);
    assert.ok(Math.abs(solution[0]) < start, 'the fit still moves off the flat start');
    assert.equal(probesAtStart, 1,
        `the start point's Jacobian is built once, not per rejected step (${probesAtStart})`);
}

// ── Parameters in very different units ───────────────────────────────────────
//
// n(λ) = A + C/λ⁴ with λ in nm puts C near 3e9 nm⁴ and its Jacobian column near
// 1e-11, next to a column of ones for A. JᵀJ then holds entries of order 1e-19
// and, once A is eliminated, a pivot below any absolute threshold an unscaled
// solve could use: the fit never takes a step and the spread comes back null.
// Scaled to unit columns the two directions are plainly independent.
{
    const lambdas = Array.from({ length: 41 }, (_, i) => 400 + 10 * i);
    const x = lambdas.map(lambda => 1 / lambda ** 4);
    const truth = [1.45, 3e9];
    // Deterministic scatter of about 1e-4 in the index.
    const data = x.map((xi, i) => truth[0] + truth[1] * xi + 1e-4 * Math.sin(3.7 * i));
    const residualAt = ([a, c]) => x.map((xi, i) => a + c * xi - data[i]);

    const fit = levenbergMarquardt([1.4, 1e9], residualAt, 80);
    // The model is linear, so the least-squares answer has a closed form.
    const n = x.length;
    const sx = x.reduce((s, v) => s + v, 0), sy = data.reduce((s, v) => s + v, 0);
    const sxx = x.reduce((s, v) => s + v * v, 0), sxy = x.reduce((s, v, i) => s + v * data[i], 0);
    const cExact = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const aExact = (sy - cExact * sx) / n;
    assert.ok(Math.abs(fit[0] - aExact) < 1e-9 * aExact && Math.abs(fit[1] - cExact) < 1e-6 * cExact,
        `A and C fitted (${fit[0]}, ${fit[1]}; exact ${aExact}, ${cExact})`);

    // corr(A, C) = −Σx / √(n·Σx²) for this model; the standard errors follow
    // from s²(XᵀX)⁻¹ with s² = SSR/(n − 2).
    const spread = parameterSpread(fit, residualAt);
    assert.ok(spread, 'the spread is computed');
    const rho = -sx / Math.sqrt(n * sxx);
    assert.ok(Math.abs(spread.correlation[0][1] - rho) < 1e-9, `corr(A, C) ${spread.correlation[0][1]} vs ${rho}`);
    const s2 = sumSquares(residualAt(fit)) / (n - 2);
    const det = n * sxx - sx * sx;
    const seC = Math.sqrt(s2 * n / det);
    assert.ok(Math.abs(spread.standardErrors[1] - seC) < 1e-6 * seC, `σ(C) ${spread.standardErrors[1]} vs ${seC}`);
}

console.log('PASS: least_squares');
