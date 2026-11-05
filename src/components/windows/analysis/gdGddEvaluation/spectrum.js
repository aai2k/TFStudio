import {
    chromaticDispersionCoefficient, unwrapPhase,
} from '../../../../utils/physics/thinFilmMath.js';
import {
    createDesignPhaseDispersionEvaluator, createTotalTransmissionDispersionEvaluator,
} from '../../../../utils/physics/phaseDispersion.js';
import { sampleKnots } from '../knots.js';
import { presentationGrid } from './grid.js';

export { AUTOMATIC_GD_GDD_FINE_STEP_NM } from './grid.js';

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
function polarizationEvaluator(design, { side, target, thetaDeg, resolveMaterial }, polarization) {
    if (side !== 'whole') {
        return createDesignPhaseDispersionEvaluator(design, { side, target, polarization, thetaDeg, resolveMaterial });
    }
    const evaluate = createTotalTransmissionDispersionEvaluator(design, { polarization, thetaDeg, resolveMaterial });
    return wavelengthNm => {
        const value = evaluate(wavelengthNm);
        return { ...value, substratePhaseRad: value.components.substrate.phaseRad };
    };
}

/**
 * The window's values at one wavelength: `evaluateAt(wavelengthNm, knotSide)`
 * gives phase, GD, GDD and TOD of one side in one polarization, or the mean of
 * s and p for 'avg'. `options` as computeGdGddSpectrum takes them, with
 * `resolveMaterial` mapping a material id to its material, the design's own
 * materials when left out. `knotSource` is the evaluator whose table knots the
 * window samples.
 */
export function gdGddPointEvaluator(design, options) {
    const { polarization } = options;
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
    return { evaluateAt, knotSource: pointEvaluators[polarization === 'avg' ? 's' : polarization] };
}

/**
 * The phase of a run of point values in degrees, unwrapped along their order
 * as the window unwraps it along wavelength. NaN where a value is invalid.
 */
export function unwrappedPhaseDeg(values, side) {
    const phaseRadians = side === 'whole'
        ? unwrapWholePartPhase(values)
        : unwrapFiniteRuns(values.map(value => value.valid ? value.phaseRad : NaN));
    return phaseRadians.map(value => value * 180 / Math.PI);
}

/**
 * Phase, GD, GDD, TOD and CDC of one side of `design`, as the GD/GDD window
 * shows them. `stepNm`, which the window never passes, asks for a uniform grid
 * in place of the window's own.
 */
export function computeGdGddSpectrum(design, options) {
    const { lambdaStart, lambdaEnd, preview } = options;
    const valueCache = new Map();
    const { evaluateAt, knotSource } = gdGddPointEvaluator(design, options);
    const evaluate = (wavelengthNm) => {
        if (!valueCache.has(wavelengthNm)) valueCache.set(wavelengthNm, evaluateAt(wavelengthNm));
        return valueCache.get(wavelengthNm);
    };
    const grid = presentationGrid(lambdaStart, lambdaEnd, options, evaluate, knotSource);
    const { wavelengths, knots } = grid;
    const values = wavelengths.map(evaluate);
    const phaseDeg = unwrappedPhaseDeg(values, options.side);
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
