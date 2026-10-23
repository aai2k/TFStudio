import {
    chromaticDispersionCoefficient, unwrapPhase,
} from '../../../../utils/physics/thinFilmMath.js';
import {
    createDesignPhaseDispersionEvaluator, createTotalTransmissionDispersionEvaluator,
} from '../../../../utils/physics/phaseDispersion.js';
import { KNOT_MATCH_TOLERANCE_NM, knotGrid, sampleKnots } from '../knots.js';

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

function adaptiveWavelengthGrid(baseWavelengths, evaluate) {
    const wavelengths = new Set(baseWavelengths);
    const maximumAdditional = Math.min(2048, baseWavelengths.length * 2);
    let added = 0;

    for (let level = 0; level < 12 && added < maximumAdditional; level++) {
        const ordered = [...wavelengths].sort((left, right) => left - right);
        const values = ordered.map(evaluate);
        const candidates = new Set();
        for (let index = 1; index < ordered.length - 1; index++) {
            const left = values[index - 1];
            const center = values[index];
            const right = values[index + 1];
            if (!left.valid || !center.valid || !right.valid) continue;
            const localMinimum = center.magnitudeSquared <= left.magnitudeSquared
                && center.magnitudeSquared <= right.magnitudeSquared;
            const pronounced = center.magnitudeSquared < 0.05
                || center.magnitudeSquared * 2 < Math.min(
                    left.magnitudeSquared,
                    right.magnitudeSquared,
                );
            if (!localMinimum || !pronounced) continue;
            if (ordered[index] - ordered[index - 1] > AUTOMATIC_REFINEMENT_WIDTH_NM) {
                candidates.add((ordered[index - 1] + ordered[index]) / 2);
            }
            if (ordered[index + 1] - ordered[index] > AUTOMATIC_REFINEMENT_WIDTH_NM) {
                candidates.add((ordered[index] + ordered[index + 1]) / 2);
            }
        }
        if (!candidates.size) break;
        for (const wavelength of candidates) {
            if (added >= maximumAdditional) break;
            if (!wavelengths.has(wavelength)) {
                wavelengths.add(wavelength);
                added++;
            }
        }
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
function presentationGrid(lambdaStart, lambdaEnd, { preview, stepNm }, evaluate, pointEvaluator) {
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

function normalizeRadians(value) {
    return ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function averagePolarizations(sValue, pValue) {
    // Both polarizations read the same materials at the same wavelength, so
    // either one answers for the pair on whether it was taken outside the data.
    const outsideRange = sValue.outsideRange ?? pValue.outsideRange ?? null;
    if (!sValue.valid || !pValue.valid) {
        return {
            valid: false,
            wavelengthNm: sValue.wavelengthNm,
            reason: sValue.valid ? pValue.reason : sValue.reason,
            outsideRange,
        };
    }
    const average = key => Number.isFinite(sValue[key]) && Number.isFinite(pValue[key])
        ? (sValue[key] + pValue[key]) / 2
        : NaN;
    const result = {
        wavelengthNm: sValue.wavelengthNm,
        valid: true,
        phaseRad: sValue.phaseRad + normalizeRadians(pValue.phaseRad - sValue.phaseRad) / 2,
        gdFs: average('gdFs'),
        gddFs2: average('gddFs2'),
        todFs3: average('todFs3'),
        magnitudeSquared: average('magnitudeSquared'),
        models: [...new Set([...(sValue.models || []), ...(pValue.models || [])])],
        phaseContinuousOrder: Math.min(
            sValue.phaseContinuousOrder ?? 3,
            pValue.phaseContinuousOrder ?? 3,
        ),
        onKnot: !!(sValue.onKnot || pValue.onKnot),
        outsideRange,
        // The same for s and p, so either one answers for the pair.
        substratePhaseRad: sValue.substratePhaseRad,
    };
    return result;
}

// One polarization's evaluator. Side 'whole' is Pulse Analysis's whole part,
// transmission only: the front coating, one transit of the substrate at the
// design's thickness and the back coating, the first pulse to come out. It
// reads no table knot on one side, so none is sampled there. Its values carry
// the substrate's propagation phase apart, for unwrapWholePartPhase.
function polarizationEvaluator(design, { side, target, thetaDeg }, polarization) {
    if (side !== 'whole') return createDesignPhaseDispersionEvaluator(design, { side, target, polarization, thetaDeg });
    const evaluate = createTotalTransmissionDispersionEvaluator(design, { polarization, thetaDeg });
    return wavelengthNm => {
        const value = evaluate(wavelengthNm);
        return { ...value, substratePhaseRad: value.components.substrate.phaseRad };
    };
}

/**
 * Phase, GD, GDD, TOD and CDC of one side of `design`, as the GD/GDD window
 * shows them. `stepNm`, which the window never passes, asks for a uniform grid
 * in place of the window's own.
 */
export function computeGdGddSpectrum(design, options) {
    const { lambdaStart, lambdaEnd, polarization, preview } = options;
    const valueCache = new Map();
    const pointEvaluators = Object.fromEntries(
        (polarization === 'avg' ? ['s', 'p'] : [polarization]).map(code => [
            code, polarizationEvaluator(design, options, code),
        ]));
    const evaluateAt = (wavelengthNm, knotSide) => {
        const evaluatePolarization = polarizationCode =>
            pointEvaluators[polarizationCode](wavelengthNm, knotSide);
        return polarization === 'avg'
            ? averagePolarizations(evaluatePolarization('s'), evaluatePolarization('p'))
            : evaluatePolarization(polarization);
    };
    const evaluate = (wavelengthNm) => {
        if (!valueCache.has(wavelengthNm)) valueCache.set(wavelengthNm, evaluateAt(wavelengthNm));
        return valueCache.get(wavelengthNm);
    };
    const grid = presentationGrid(
        lambdaStart, lambdaEnd, options, evaluate,
        pointEvaluators[polarization === 'avg' ? 's' : polarization]);
    const { wavelengths, knots } = grid;
    const values = wavelengths.map(evaluate);
    const phaseRadians = options.side === 'whole'
        ? unwrapWholePartPhase(values)
        : unwrapFiniteRuns(values.map(value => value.valid ? value.phaseRad : NaN));
    const phaseDeg = phaseRadians.map(value => value * 180 / Math.PI);
    return {
        lambda: wavelengths,
        phaseDeg,
        gd: values.map(value => value.valid ? value.gdFs : NaN),
        gdd: values.map(value => value.valid ? value.gddFs2 : NaN),
        tod: values.map(value => value.valid ? value.todFs3 : NaN),
        // CDC is GDD against wavelength rather than angular frequency, so the
        // conversion depends only on the wavelength both polarizations share.
        // Converting the average is therefore the average of the conversions,
        // and `averagePolarizations` has nothing to do for this one.
        cdc: values.map((value, index) => value.valid
            ? chromaticDispersionCoefficient(value.gddFs2, wavelengths[index])
            : NaN),
        magnitudeSquared: values.map(value => value.valid ? value.magnitudeSquared : NaN),
        // The material each sample was taken outside the data range of, or null.
        // The plot shades those wavelengths; the table and its export name them.
        outsideRange: values.map(value => value.outsideRange ?? null),
        invalid: values
            .filter(value => !value.valid)
            .map(value => ({ wavelengthNm: value.wavelengthNm, reason: value.reason })),
        models: values.find(value => value.models)?.models || [],
        // A reduce, as a spread of a few hundred thousand values exceeds the
        // call stack.
        phaseContinuousOrder: values.reduce((lowest, value) =>
            Math.min(lowest, value.phaseContinuousOrder ?? 3), Infinity),
        knotSamples: sampleKnots(wavelengths, knots, evaluateAt),
        method: 'analytic Taylor jets',
        preview: !!preview,
        basePointCount: grid.basePointCount,
        adaptivePointCount: grid.adaptivePointCount,
    };
}

function unwrapFiniteRuns(phases) {
    const result = phases.slice();
    let start = 0;
    while (start < result.length) {
        while (start < result.length && !Number.isFinite(result[start])) start++;
        let end = start;
        while (end < result.length && Number.isFinite(result[end])) end++;
        // Copied back one by one: spread into splice, a run of a few hundred
        // thousand values exceeds the call stack.
        unwrapPhase(result.slice(start, end)).forEach((value, i) => { result[start + i] = value; });
        start = end + 1;
    }
    return result;
}

// The whole part's phase. The substrate's own propagation phase,
// −2πd·Re(N cosθ)/λ, turns by π over about 0.1 nm of wavelength for 1 mm of
// glass in the visible, less in a high-index substrate, finer than any
// practical step, and is continuous by its formula. So only the coatings' phase is unwrapped along
// the grid, and the substrate's is added back as it is.
function unwrapWholePartPhase(values) {
    const coatings = unwrapFiniteRuns(values.map(value => (value.valid ? value.phaseRad - value.substratePhaseRad : NaN)));
    return coatings.map((phase, i) => phase + values[i].substratePhaseRad);
}
