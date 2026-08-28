/**
 * Solving a film's n and k at each measured wavelength, with its thickness held.
 *
 * At one wavelength a transmittance and a reflectance are two equations in the
 * two unknowns n and k, so they can be solved outright instead of being fitted.
 * That is the classic R and T pair extraction, and it gives a model-free n(λ)
 * and k(λ): useful to look at, and the starting point every dispersion model
 * here is seeded from.
 *
 * Macleod, Thin-Film Optical Filters, 5th ed., "Measurement of the Optical
 * Properties", is explicit that three parameters n, k and d are needed to
 * describe a film, and that the thickness has to come from somewhere else. Here
 * it comes from the fringe positions, and this routine is run over a range of
 * thicknesses to find the one that makes the extracted constants behave.
 *
 * Every wavelength is independent of every other one: the film's constants at λ
 * change nothing at any other λ. So one Newton step for the whole curve costs
 * three spectrum evaluations rather than three per point, because perturbing n
 * at every wavelength at once still leaves each point's derivative readable on
 * its own.
 */

import { griddedFilm, makeSampleEvaluator } from './sampleSpectrum.js';

// No deposited film has constants outside this. The bracket is not a fit
// constraint, it stops a near-singular Newton step throwing a point somewhere
// the transfer matrix returns nothing useful from, which would strand it.
const INDEX_MIN = 0.5;
const INDEX_MAX = 8;
const EXTINCTION_MAX = 10;

// Largest change either constant may take in one step. A trust region, not a
// tolerance: an undamped step near a turning point in T(n) overshoots into the
// next fringe and the point then converges onto the wrong branch.
const STEP_LIMIT = 0.25;

const INDEX_DELTA = 1e-5;
const EXTINCTION_DELTA = 1e-6;
const RESIDUAL_TOLERANCE = 1e-7;
const MAX_ITERATIONS = 40;

function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
}

function limitedStep(value) {
    if (!Number.isFinite(value)) return 0;
    return clamp(value, -STEP_LIMIT, STEP_LIMIT);
}

/** Solve a 2x2 system, or null when it is singular. */
function solve2x2(a11, a12, a21, a22, b1, b2) {
    const determinant = a11 * a22 - a12 * a21;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) return null;
    return [
        (b1 * a22 - b2 * a12) / determinant,
        (a11 * b2 - a21 * b1) / determinant,
    ];
}

/**
 * Extract n and k at every wavelength for one trial thickness.
 *
 * With two channels measured, n and k are solved together. With one, only n is
 * solved and k stays at its seed: a single measurement cannot separate them at a
 * point, and pretending otherwise is how a photometric error becomes an
 * absorption.
 *
 * Each channel carries its own conditions, so a transmittance taken at normal
 * incidence and a reflectance taken at eight degrees are still one solve.
 *
 * @param {{quantity:'T'|'R', conditions:object, values:number[]}[]} channels
 * @param {number} thicknessNm
 * @param {{n:number[], k:number[]}} seed
 * @returns {{ n:number[], k:number[], resolved:boolean[], resolvedCount:number,
 *             maxResidual:number, solvedExtinction:boolean }}
 */
/** The residual of every channel at every point, and the worst of them. */
function residualsOf(channels, calculated) {
    const rows = calculated[0].map((_, point) =>
        channels.map((channel, index) => calculated[index][point] - channel.values[point]));
    return {
        rows,
        worst: rows.map(row => Math.max(...row.map(Math.abs))),
    };
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
function newtonSweeps(evaluate, channels, n, k, solvedExtinction) {
    const active = n.map(() => true);
    const bestIndex = n.slice();
    const bestExtinction = k.slice();
    const bestWorst = n.map(() => Infinity);
    const settle = (point) => {
        active[point] = false;
        n[point] = bestIndex[point];
        k[point] = bestExtinction[point];
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const base = evaluate(n, k);
        const { rows, worst } = residualsOf(channels, base);
        let stepping = false;
        for (let point = 0; point < n.length; point++) {
            if (!active[point]) continue;
            if (!(worst[point] < bestWorst[point])) { settle(point); continue; }
            bestWorst[point] = worst[point];
            bestIndex[point] = n[point];
            bestExtinction[point] = k[point];
            if (worst[point] <= RESIDUAL_TOLERANCE) { active[point] = false; continue; }
            stepping = true;
        }
        if (!stepping) break;

        const shiftedIndex = evaluate(n.map(value => value + INDEX_DELTA), k);
        const shiftedExtinction = solvedExtinction
            ? evaluate(n, k.map(value => value + EXTINCTION_DELTA))
            : null;

        for (let point = 0; point < n.length; point++) {
            if (!active[point]) continue;
            const residuals = rows[point];
            const dIndex = channels.map((_, index) =>
                (shiftedIndex[index][point] - base[index][point]) / INDEX_DELTA);
            let stepIndex;
            let stepExtinction = 0;
            if (solvedExtinction) {
                const dExtinction = channels.map((_, index) =>
                    (shiftedExtinction[index][point] - base[index][point]) / EXTINCTION_DELTA);
                const step = solve2x2(
                    dIndex[0], dExtinction[0], dIndex[1], dExtinction[1],
                    -residuals[0], -residuals[1],
                );
                if (!step) { settle(point); continue; }
                [stepIndex, stepExtinction] = step;
            } else {
                if (!(Math.abs(dIndex[0]) > 1e-12)) { settle(point); continue; }
                stepIndex = -residuals[0] / dIndex[0];
            }
            n[point] = clamp(n[point] + limitedStep(stepIndex), INDEX_MIN, INDEX_MAX);
            k[point] = clamp(k[point] + limitedStep(stepExtinction), 0, EXTINCTION_MAX);
        }
    }
    for (let point = 0; point < n.length; point++) if (active[point]) settle(point);
}

/**
 * Re-solve each point starting from its neighbours' answer.
 *
 * A wavelength's own T and R can have more than one (n, k) that reproduces
 * them, and Newton returns whichever root it started nearest, so a point here
 * and there comes back on a different branch from the rest of the curve. A
 * film's constants do not jump between adjacent wavelengths, so the root that
 * continues the curve is the physical one.
 *
 * The restart is kept only where it reaches tolerance as well, so this chooses
 * between roots and never trades a solved point for a smoother unsolved one.
 */
function continueFromNeighbours(evaluate, channels, n, k, solvedExtinction) {
    const startIndex = n.map((value, point) =>
        (point > 0 && point < n.length - 1) ? (n[point - 1] + n[point + 1]) / 2 : value);
    const startExtinction = k.map((value, point) =>
        (point > 0 && point < k.length - 1) ? (k[point - 1] + k[point + 1]) / 2 : value);
    newtonSweeps(evaluate, channels, startIndex, startExtinction, solvedExtinction);

    const before = residualsOf(channels, evaluate(n, k)).worst;
    const after = residualsOf(channels, evaluate(startIndex, startExtinction)).worst;
    for (let point = 0; point < n.length; point++) {
        if (after[point] > RESIDUAL_TOLERANCE) continue;
        if (before[point] > RESIDUAL_TOLERANCE) continue;
        n[point] = startIndex[point];
        k[point] = startExtinction[point];
    }
}

export function invertPointwise(channels, thicknessNm, seed) {
    const { lambdas } = channels[0].conditions;
    const solvedExtinction = channels.length === 2;
    const n = seed.n.slice();
    const k = seed.k.slice();

    const sample = makeSampleEvaluator(channels);
    const evaluate = (indices, extinctions) =>
        sample(griddedFilm(lambdas, indices, extinctions), thicknessNm);

    newtonSweeps(evaluate, channels, n, k, solvedExtinction);
    if (n.length > 2) continueFromNeighbours(evaluate, channels, n, k, solvedExtinction);

    const { worst } = residualsOf(channels, evaluate(n, k));
    const resolved = worst.map((value, point) => value <= RESIDUAL_TOLERANCE
        // A point sitting on the edge of the physical bracket ran out of room
        // rather than being solved; carrying it would put a wall in n(λ).
        && n[point] > INDEX_MIN && n[point] < INDEX_MAX && k[point] < EXTINCTION_MAX);

    return {
        n, k, resolved, solvedExtinction,
        resolvedCount: resolved.filter(Boolean).length,
        maxResidual: Math.max(0, ...worst),
    };
}

/**
 * How much the extracted index wanders, per point.
 *
 * A film's index is a smooth function of wavelength. Extracted with the wrong
 * thickness, it is not: the fringes fall in the wrong places and n(λ) picks up
 * an oscillation at the fringe period, which is the same signal Macleod points
 * at in his Figure 14.10, where the extracted index from a mismatched model
 * "is not encouraging". Summing the squared second difference turns that into
 * one number, and the thickness that minimises it is the one to start from.
 *
 * Only resolved points contribute, and a run of three consecutive ones is
 * needed to form a difference at all.
 */
export function indexRoughness(lambdas, indices, resolved) {
    let total = 0;
    let count = 0;
    for (let point = 1; point < indices.length - 1; point++) {
        if (!resolved[point - 1] || !resolved[point] || !resolved[point + 1]) continue;
        const second = indices[point + 1] - 2 * indices[point] + indices[point - 1];
        total += second * second;
        count++;
    }
    return count > 0 ? total / count : Infinity;
}
