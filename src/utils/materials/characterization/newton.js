/**
 * Damped Newton on n and k at every measured wavelength at once.
 *
 * Every wavelength is independent of every other one: the film's constants at λ
 * change nothing at any other λ. So one Newton step for the whole curve costs
 * three spectrum evaluations rather than three per point, because perturbing n
 * at every wavelength at once still leaves each point's derivative readable on
 * its own.
 *
 * Each wavelength is also its own solve, so it decides for itself when it is
 * finished, and the best answer each one reached is tracked separately.
 */

import { channelDifference } from './sampleSpectrum.js';

// Numerical guardrails for Newton steps, not a range of dielectric indices.
// Metals such as gold have n well below 0.5 in the visible; excluding those
// values discards the very measurements needed to seed their dispersion fit.
export const INDEX_MIN = 0;
export const INDEX_MAX = 8;
export const EXTINCTION_MAX = 10;

// Largest change either constant may take in one step. A trust region, not a
// tolerance: an undamped step near a turning point in T(n) overshoots into the
// next fringe and the point then converges onto the wrong branch.
const STEP_LIMIT = 0.25;

const INDEX_DELTA = 1e-5;
const EXTINCTION_DELTA = 1e-6;
export const RESIDUAL_TOLERANCE = 1e-7;
const MAX_ITERATIONS = 40;

function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
}

function limitedStep(value) {
    if (!Number.isFinite(value)) return 0;
    return clamp(value, -STEP_LIMIT, STEP_LIMIT);
}

/**
 * Solve a 2x2 system, or null when it is singular.
 *
 * @param {number[][]} matrix [[a11, a12], [a21, a22]]
 * @param {number[]}   rhs    [b1, b2]
 */
function solve2x2([[a11, a12], [a21, a22]], [b1, b2]) {
    const determinant = a11 * a22 - a12 * a21;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) return null;
    return [
        (b1 * a22 - b2 * a12) / determinant,
        (a11 * b2 - a21 * b1) / determinant,
    ];
}

/** The residual of every channel at every point, and the worst of them. */
export function residualsOf(channels, calculated) {
    const rows = calculated[0].map((_, point) =>
        channels.map((channel, index) => channelDifference(
            channel.quantity, calculated[index][point], channel.values[point])));
    return {
        rows,
        worst: rows.map(row => Math.max(...row.map(Math.abs))),
    };
}

/**
 * The Newton step in n and k at one wavelength, or null where it is singular.
 *
 * With two channels the system is square and solved outright. With more it is
 * solved in least squares, which is the same thing when there are two.
 */
function solvedStep(dIndex, dExtinction, residuals) {
    if (dIndex.length === 2) {
        return solve2x2(
            [[dIndex[0], dExtinction[0]], [dIndex[1], dExtinction[1]]],
            [-residuals[0], -residuals[1]]);
    }
    let nn = 0, nk = 0, kk = 0, nr = 0, kr = 0;
    for (let channel = 0; channel < dIndex.length; channel++) {
        nn += dIndex[channel] ** 2;
        nk += dIndex[channel] * dExtinction[channel];
        kk += dExtinction[channel] ** 2;
        nr -= dIndex[channel] * residuals[channel];
        kr -= dExtinction[channel] * residuals[channel];
    }
    return solve2x2([[nn, nk], [nk, kk]], [nr, kr]);
}

/**
 * The step in n alone, with k held.
 *
 * Against one channel this is Newton's step; against two it is the
 * least-squares step, because one unknown cannot zero both residuals.
 */
function indexOnlyStep(dIndex, residuals) {
    let curvature = 0;
    let gradient = 0;
    for (let channel = 0; channel < dIndex.length; channel++) {
        curvature += dIndex[channel] ** 2;
        gradient -= dIndex[channel] * residuals[channel];
    }
    return curvature > 1e-24 ? [gradient / curvature, 0] : null;
}

/** The derivative of every channel at one point, from a shifted evaluation. */
function derivativesAt(channels, base, shifted, point, delta) {
    return channels.map((channel, index) => channelDifference(
        channel.quantity, shifted[index][point], base[index][point]) / delta);
}

/**
 * One damped Newton pass over every still-active wavelength.
 *
 * Returns the points that ran out of gradient and have to be settled, rather
 * than settling them here, so the caller keeps the bookkeeping in one place.
 */
function newtonPass({ evaluate, channels, n, k, solvedExtinction, active, rows, base }) {
    const shiftedIndex = evaluate(n.map(value => value + INDEX_DELTA), k);
    const shiftedExtinction = solvedExtinction
        ? evaluate(n, k.map(value => value + EXTINCTION_DELTA))
        : null;

    const stalled = [];
    for (let point = 0; point < n.length; point++) {
        if (!active[point]) continue;
        const residuals = rows[point];
        const dIndex = derivativesAt(channels, base, shiftedIndex, point, INDEX_DELTA);
        const step = solvedExtinction
            ? solvedStep(
                dIndex,
                derivativesAt(channels, base, shiftedExtinction, point, EXTINCTION_DELTA),
                residuals)
            : indexOnlyStep(dIndex, residuals);
        if (!step) { stalled.push(point); continue; }
        n[point] = clamp(n[point] + limitedStep(step[0]), INDEX_MIN, INDEX_MAX);
        k[point] = clamp(k[point] + limitedStep(step[1]), 0, EXTINCTION_MAX);
    }
    return stalled;
}

/** The best n and k each wavelength has reached, and whether it is still going. */
function trackBest(n, k) {
    return {
        active: n.map(() => true),
        index: n.slice(),
        extinction: k.slice(),
        worst: n.map(() => Infinity),
    };
}

/** Stop one wavelength and put back the best n and k it reached. */
function settlePoint(best, n, k, point) {
    best.active[point] = false;
    n[point] = best.index[point];
    k[point] = best.extinction[point];
}

/**
 * Take in one pass's residuals: keep each active point's answer if it improved,
 * and stop the points that reached tolerance or stopped improving.
 *
 * Returns whether any wavelength is still worth stepping.
 */
function recordPass(best, n, k, worst) {
    let stepping = false;
    for (let point = 0; point < n.length; point++) {
        if (!best.active[point]) continue;
        if (!(worst[point] < best.worst[point])) { settlePoint(best, n, k, point); continue; }
        best.worst[point] = worst[point];
        best.index[point] = n[point];
        best.extinction[point] = k[point];
        if (worst[point] <= RESIDUAL_TOLERANCE) { best.active[point] = false; continue; }
        stepping = true;
    }
    return stepping;
}

/**
 * Damped Newton on every wavelength at once.
 *
 * Each wavelength is its own solve, so each one decides for itself when it is
 * finished: a point stops when it reaches tolerance, and it also stops when a
 * step fails to improve it, keeping the best answer it reached. That second rule
 * is what ends the loop in reasonable time. At a fringe turning point the index
 * has no first-order effect on either channel and the system there is singular,
 * so a handful of points never converge; measured globally they would hold every
 * other point in the loop for nothing.
 */
export function newtonSweeps(evaluate, channels, n, k, solvedExtinction) {
    const best = trackBest(n, k);
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const base = evaluate(n, k);
        const { rows, worst } = residualsOf(channels, base);
        if (!recordPass(best, n, k, worst)) break;

        const stalled = newtonPass({
            evaluate, channels, n, k, solvedExtinction, active: best.active, rows, base,
        });
        for (const point of stalled) settlePoint(best, n, k, point);
    }
    for (let point = 0; point < n.length; point++) {
        if (best.active[point]) settlePoint(best, n, k, point);
    }
}
