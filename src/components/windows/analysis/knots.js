/**
 * Table knots in an analysis plot: where they are, what the curve does there.
 * Shared by the Group Delay / GDD window and the Material Dispersion window,
 * which draw the same four quantities off a stack and off one material.
 *
 * A tabulated material is piecewise, so an order high enough to see the seam
 * jumps at every knot of every table in the stack. PCHIP is C1, so GDD and TOD
 * jump; a linearly read table is C0, so GD jumps as well. This module puts a
 * sample on each knot and reads the two one-sided values there.
 *
 * The curve is never cut at a knot. A jump is drawn as a step: both one-sided
 * values at the knot wavelength, joined by the vertical between them, which is
 * what the function does and what Essential Macleod plots for the same design.
 * A gap means something else entirely, that there is no value at all, and stays
 * reserved for a wavelength the evaluator refuses.
 */

// A grid wavelength this close to a table knot is that knot, to the accuracy
// the grid is accumulated with; the knot replaces it so the sample sits exactly
// on the discontinuity instead of a rounding either side of it.
const KNOT_MATCH_TOLERANCE_NM = 1e-9;

function mergeSorted(wavelengths, knots) {
    const merged = [];
    let next = 0;
    for (const wavelength of wavelengths) {
        while (next < knots.length && knots[next] < wavelength - KNOT_MATCH_TOLERANCE_NM) {
            merged.push(knots[next++]);
        }
        const replaced = next < knots.length
            && Math.abs(knots[next] - wavelength) <= KNOT_MATCH_TOLERANCE_NM;
        if (!replaced) merged.push(wavelength);
    }
    while (next < knots.length) merged.push(knots[next++]);
    return merged;
}

// Sampling a knot costs two more stack evaluations than the grid point it sits
// on, so the band can only carry so many before the plot costs several times
// what it should. Past a knot every this many plotted points the table is also
// too fine to read: a step drawn at one of its knots would fall within a few
// samples of the next, so the picture would be the table rather than the
// design. The two limits point the same way, so one number serves both.
const PLOTTED_POINTS_PER_KNOT = 8;

/**
 * The presentation grid with a sample on every table knot inside it, or the
 * grid unchanged where the knots are too dense against it to be worth sampling.
 */
export function knotGrid(wavelengths, knotWavelengths, lambdaStart, lambdaEnd) {
    const low = Math.min(lambdaStart, lambdaEnd);
    const high = Math.max(lambdaStart, lambdaEnd);
    const inRange = (knotWavelengths || []).filter(knot => knot > low && knot < high);
    const dense = inRange.length * PLOTTED_POINTS_PER_KNOT > wavelengths.length;
    const knots = dense ? [] : inRange;
    return { wavelengths: knots.length ? mergeSorted(wavelengths, knots) : wavelengths, knots };
}

/**
 * The two one-sided values of each order at every sampled knot.
 *
 * The sample already on the grid there is the mean of the pair, which is what a
 * tabulated material reports at a node. These are what that mean was taken of,
 * so the curve can be drawn as a step through both of them and an exported row
 * can carry both rather than the midpoint alone.
 */
export function sampleKnots(wavelengths, knots, evaluateAt) {
    if (!knots.length) return [];
    const wanted = new Set(knots);
    const samples = [];
    wavelengths.forEach((wavelengthNm, index) => {
        if (!wanted.has(wavelengthNm)) return;
        const left = evaluateAt(wavelengthNm, 'left');
        const right = evaluateAt(wavelengthNm, 'right');
        if (!left.valid || !right.valid) return;
        samples.push({
            index,
            wavelengthNm,
            gd: [left.gdFs, right.gdFs],
            gdd: [left.gddFs2, right.gddFs2],
            tod: [left.todFs3, right.todFs3],
        });
    });
    return samples;
}

/**
 * The pair of one-sided values to draw at each sampled knot, by grid index.
 *
 * An order at or below the continuity of the stack's materials does not jump at
 * a knot at all, so it gets no steps: under PCHIP the GD difference across a
 * node is roundoff, and drawing a step for it would put two coincident points
 * in the curve for nothing.
 */
export function knotSteps(knotSamples, key, { order, continuousOrder = 3 } = {}) {
    const sides = new Map();
    if (order <= continuousOrder) return sides;
    for (const sample of knotSamples || []) {
        const pair = sample[key];
        if (!pair || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) continue;
        sides.set(sample.index, pair);
    }
    return sides;
}

/**
 * The curve with a step at each knot: the midpoint the grid sample carries is
 * replaced by the two one-sided values at that wavelength, so each branch runs
 * up to the discontinuity and the vertical between them is drawn.
 */
export function stepAtKnots(lambda, values, sides) {
    if (!sides.size) return { lambda, y: values };
    const steppedLambda = [];
    const y = [];
    for (let index = 0; index < lambda.length; index++) {
        const pair = sides.get(index);
        if (pair) {
            steppedLambda.push(lambda[index], lambda[index]);
            y.push(pair[0], pair[1]);
        } else {
            steppedLambda.push(lambda[index]);
            y.push(values[index]);
        }
    }
    return { lambda: steppedLambda, y };
}
