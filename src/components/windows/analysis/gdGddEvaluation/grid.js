import { KNOT_MATCH_TOLERANCE_NM, knotGrid } from '../knots.js';

export const AUTOMATIC_GD_GDD_FINE_STEP_NM = 0.2;
const AUTOMATIC_GRID_MAX_INTERVALS = 2000;
// Live preview grid, used while an optimizer run is driving the design. The
// curve is being watched for its shape as it moves, not read for knot detail,
// so a coarse grid with no local refinement keeps the redraw far below the
// preview interval and leaves the interface responsive.
const PREVIEW_GRID_MAX_INTERVALS = 300;
const PREVIEW_FINE_STEP_NM = 1;
const AUTOMATIC_REFINEMENT_WIDTH_NM = 0.01;

function wavelengthGrid(start, end, step) {
    const count = Math.floor((end - start) / step + 1e-12) + 1;
    const wavelengths = Array.from({ length: count }, (_, index) => start + index * step);
    if (end - wavelengths[wavelengths.length - 1] > 1e-9) wavelengths.push(end);
    return wavelengths;
}

function automaticWavelengthGrid(start, end, preview) {
    const span = Math.abs(end - start);
    const step = preview
        ? Math.max(PREVIEW_FINE_STEP_NM, span / PREVIEW_GRID_MAX_INTERVALS)
        : Math.max(AUTOMATIC_GD_GDD_FINE_STEP_NM, span / AUTOMATIC_GRID_MAX_INTERVALS);
    return wavelengthGrid(start, end, step);
}

// Whether the coefficient at `center` is a local minimum between its two
// neighbours, and a pronounced one: below 0.05, or under half of the lower
// neighbour.
function pronouncedMinimum(left, center, right) {
    if (!left.valid || !center.valid || !right.valid) return false;
    const localMinimum = center.magnitudeSquared <= left.magnitudeSquared
        && center.magnitudeSquared <= right.magnitudeSquared;
    const pronounced = center.magnitudeSquared < 0.05
        || center.magnitudeSquared * 2 < Math.min(
            left.magnitudeSquared,
            right.magnitudeSquared,
        );
    return localMinimum && pronounced;
}

// The midpoints on either side of each pronounced minimum, where the interval
// there is still wider than the refinement width.
function refinementCandidates(ordered, values) {
    const candidates = new Set();
    const addMidpoint = (low, high) => {
        if (high - low > AUTOMATIC_REFINEMENT_WIDTH_NM) candidates.add((low + high) / 2);
    };
    for (let index = 1; index < ordered.length - 1; index++) {
        if (!pronouncedMinimum(values[index - 1], values[index], values[index + 1])) continue;
        addMidpoint(ordered[index - 1], ordered[index]);
        addMidpoint(ordered[index], ordered[index + 1]);
    }
    return candidates;
}

// Adds the candidates `wavelengths` does not hold yet, at most `room` of them,
// and returns how many it added.
function addCandidates(wavelengths, candidates, room) {
    let added = 0;
    for (const wavelength of candidates) {
        if (added >= room) break;
        if (!wavelengths.has(wavelength)) {
            wavelengths.add(wavelength);
            added++;
        }
    }
    return added;
}

function adaptiveWavelengthGrid(baseWavelengths, evaluate) {
    const wavelengths = new Set(baseWavelengths);
    const maximumAdditional = Math.min(2048, baseWavelengths.length * 2);
    let added = 0;

    for (let level = 0; level < 12 && added < maximumAdditional; level++) {
        const ordered = [...wavelengths].sort((left, right) => left - right);
        const candidates = refinementCandidates(ordered, ordered.map(evaluate));
        if (!candidates.size) break;
        added += addCandidates(wavelengths, candidates, maximumAdditional - added);
    }
    return [...wavelengths].sort((left, right) => left - right);
}

// A grid every `stepNm` from lambdaStart, the last point at lambdaEnd, with no
// point added at a coefficient minimum or a table knot. A table knot that is
// one of its points, under the knot rule's density limit, is still read on
// both sides, so a value there is not a silent midpoint.
function uniformGrid(lambdaStart, lambdaEnd, stepNm, pointEvaluator) {
    const wavelengths = wavelengthGrid(lambdaStart, lambdaEnd, stepNm);
    const indexOf = knot => Math.round((knot - lambdaStart) / stepNm);
    const { knots } = knotGrid(wavelengths, pointEvaluator.knotWavelengths, lambdaStart, lambdaEnd);
    const onGrid = knots.filter(knot => Math.abs(wavelengths[indexOf(knot)] - knot) <= KNOT_MATCH_TOLERANCE_NM);
    for (const knot of onGrid) wavelengths[indexOf(knot)] = knot;
    return { wavelengths, knots: onGrid, basePointCount: wavelengths.length, adaptivePointCount: 0 };
}

// The wavelengths a spectrum is presented on: an automatic grid, refined around
// narrow coefficient minima and carrying a sample on every table knot, unless
// this is a live preview or a uniform step is asked for.
export function presentationGrid(lambdaStart, lambdaEnd, { preview, stepNm }, evaluate, pointEvaluator) {
    if (stepNm) return uniformGrid(lambdaStart, lambdaEnd, stepNm, pointEvaluator);
    const base = automaticWavelengthGrid(lambdaStart, lambdaEnd, preview);
    const counts = { basePointCount: base.length, adaptivePointCount: 0 };
    // A preview asks for no knots, so it must not read knotWavelengths either:
    // gathering them walks every table the stack uses.
    if (preview) return { wavelengths: base, knots: [], ...counts };
    const refined = adaptiveWavelengthGrid(base, evaluate);
    counts.adaptivePointCount = refined.length - base.length;
    const knots = knotGrid(refined, pointEvaluator.knotWavelengths, lambdaStart, lambdaEnd);
    return { ...knots, ...counts };
}
