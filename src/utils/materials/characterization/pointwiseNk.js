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
 * The damped Newton solver the extraction runs on is in newton.js.
 */

import { channelDifference, griddedFilm, makeSampleEvaluator } from './sampleSpectrum.js';
import {
    EXTINCTION_MAX,
    INDEX_MAX,
    INDEX_MIN,
    RESIDUAL_TOLERANCE,
    newtonSweeps,
    residualsOf,
} from './newton.js';

export { EXTINCTION_MAX } from './newton.js';

/**
 * Re-solve each point starting from its neighbours' answer.
 *
 * A wavelength's own T and R can have more than one (n, k) that reproduces
 * them, and Newton returns whichever root it started nearest, so a point here
 * and there comes back on a different branch from the rest of the curve. A
 * film's constants do not jump between adjacent wavelengths, so the root that
 * continues the curve is the physical one.
 *
 * The restart is kept wherever it reaches tolerance: where both solves reach it
 * this chooses the root that continues the curve, and where only the restart
 * does it rescues a point the seeded solve missed. A restart that falls short
 * is discarded, so a solved point is never traded for a smoother unsolved one.
 */
function continueFromNeighbours(evaluate, channels, n, k, solvedExtinction) {
    const startIndex = n.map((value, point) =>
        (point > 0 && point < n.length - 1) ? (n[point - 1] + n[point + 1]) / 2 : value);
    const startExtinction = k.map((value, point) =>
        (point > 0 && point < k.length - 1) ? (k[point - 1] + k[point + 1]) / 2 : value);
    newtonSweeps(evaluate, channels, startIndex, startExtinction, solvedExtinction);

    const after = residualsOf(channels, evaluate(startIndex, startExtinction)).worst;
    for (let point = 0; point < n.length; point++) {
        if (after[point] > RESIDUAL_TOLERANCE) continue;
        n[point] = startIndex[point];
        k[point] = startExtinction[point];
    }
}

/**
 * Extract n and k at every wavelength for one trial thickness.
 *
 * With two channels measured, n and k are solved together. With one, only n is
 * solved and k stays at its seed: a single measurement cannot separate them at a
 * point, and pretending otherwise is how a photometric error becomes an
 * absorption.
 *
 * `heldExtinctionFloor` holds k at its seed even when two channels were
 * measured, and n is then solved against every channel in least squares. The
 * exact root at the fitted thickness can want an extinction the physical
 * bracket excludes: on a film the model calls transparent it is negative about
 * half the time. So a held point is judged against the movement an extinction
 * at the given floor would produce in each channel, rather than against the
 * exact tolerance, which an n-only solve cannot meet.
 *
 * Each channel carries its own conditions, so a transmittance taken at normal
 * incidence and a reflectance taken at eight degrees are still one solve.
 *
 * @param {{quantity:'T'|'R', conditions:object, values:number[]}[]} channels
 * @param {number} thicknessNm
 * @param {{n:number[], k:number[]}} seed
 * @param {{heldExtinctionFloor?:(lambdaNm:number)=>number}} [options]
 * @returns {{ n:number[], k:number[], resolved:boolean[], resolvedCount:number,
 *             maxResidual:number, solvedExtinction:boolean }}
 */
export function invertPointwise(channels, thicknessNm, seed, { heldExtinctionFloor } = {}) {
    const { lambdas } = channels[0].conditions;
    const solvedExtinction = channels.length >= 2 && !heldExtinctionFloor;
    const n = seed.n.slice();
    const k = seed.k.slice();

    const sample = makeSampleEvaluator(channels);
    const evaluate = (indices, extinctions) =>
        sample(griddedFilm(lambdas, indices, extinctions), thicknessNm);

    newtonSweeps(evaluate, channels, n, k, solvedExtinction);
    // With k held, the restart's acceptance test cannot pass, and the seed is a
    // refined model whose points all start on one branch already, so the
    // neighbour continuation has nothing to choose between.
    if (n.length > 2 && !heldExtinctionFloor) {
        continueFromNeighbours(evaluate, channels, n, k, solvedExtinction);
    }

    const base = evaluate(n, k);
    const { worst } = residualsOf(channels, base);
    let allowance = worst.map(() => RESIDUAL_TOLERANCE);
    if (heldExtinctionFloor) {
        const atFloor = evaluate(n, k.map((value, point) =>
            value + heldExtinctionFloor(lambdas[point])));
        allowance = allowance.map((minimum, point) => Math.max(minimum,
            ...channels.map((channel, index) => Math.abs(channelDifference(
                channel.quantity, atFloor[index][point], base[index][point])))));
    }
    const resolved = worst.map((value, point) => value <= allowance[point]
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
