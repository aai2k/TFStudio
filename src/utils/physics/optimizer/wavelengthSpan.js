/**
 * The wavelength span a merit function samples, from the ends of its rows'
 * grids (sampling.js operandSampleLambdas) without building them: a band row
 * at a fine Step has a million samples, and the span needs only the first and
 * the last. Each end is placed by the same arithmetic as the grid, so the span
 * is bit for bit the lowest and highest wavelength the optimizer samples.
 */
import { isArgwave, isMath, isMeasuredCurve, isMinmax, isRangeTarget } from './operandModel.js';
import { bandRowCount, isBandSampled, samplesNoWavelength } from './sampling.js';

// The lowest and highest finite wavelength of a list, or none.
function finiteEnds(lambdas) {
    let low = Infinity;
    let high = -Infinity;
    for (const lambda of lambdas) {
        if (!Number.isFinite(lambda)) continue;
        if (lambda < low) low = lambda;
        if (lambda > high) high = lambda;
    }
    return low <= high ? [low, high] : [];
}

// The first and last sample of a band row's grid. Each grid rises or falls
// steadily, so its ends are its extremes: an extremum row's grid runs from the
// low end of its band to the high end (extremumGrid.js bandGridOfCount), any
// other band row's from its start to its end (sampling.js endsOnBandEnd). Ends
// that are not numbers are read as the grids read them.
function bandSampledEnds(op) {
    const { lambdaStart: a, lambdaEnd: b } = op;
    if (isArgwave(op.type) || isMinmax(op.type)) {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        return Number.isFinite(hi - lo) ? [lo, hi] : [];
    }
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
    const range = b - a;
    const last = bandRowCount(op) - 1;
    return [a + range * 0, isRangeTarget(op.type) ? a + range * (last / last) : a + (range * last) / last];
}

// The first and last wavelength operandSampleLambdas gives `op`, or none. An
// OPGT or OPLT written before rows were referenced by id samples as its base
// type; any other math row samples none of its own.
function operandSampleEnds(op) {
    if (samplesNoWavelength(op.type)) return [];
    if (isMath(op.type)) {
        return (op.type === 'OPGT' || op.type === 'OPLT') && op.baseType && !op.refId
            ? operandSampleEnds({ ...op, type: op.baseType }) : [];
    }
    if (isMeasuredCurve(op.type)) return Array.isArray(op.sampleLambdas) ? op.sampleLambdas : [];
    if (isBandSampled(op.type)) return bandSampledEnds(op);
    return [op.lambdaStart];
}

/**
 * The wavelength span the enabled operands evaluate over, as `[minNm, maxNm]`,
 * or null when none of them samples a wavelength. Taken from the ends of the
 * same grids the optimizer scores on, so a check made against it cannot
 * disagree with what a run actually computes. A row whose λ pair is not a
 * wavelength (a layer range, a row reference, a comment) contributes nothing.
 */
export function operandWavelengthSpan(operands) {
    const ends = finiteEnds(operands.filter(op => op.enabled).flatMap(operandSampleEnds));
    return ends.length ? ends : null;
}
