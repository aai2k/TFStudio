import { unwrapPhase } from '../../../../utils/physics/thinFilmMath.js';
import { createDesignPhaseDispersionEvaluator } from '../../../../utils/physics/phaseDispersion.js';

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

// The wavelengths a spectrum is presented on: an automatic grid, refined
// around narrow coefficient minima unless this is a live preview.
function presentationGrid(lambdaStart, lambdaEnd, preview, evaluate) {
    const base = automaticWavelengthGrid(lambdaStart, lambdaEnd, preview);
    return { base, wavelengths: preview ? base : adaptiveWavelengthGrid(base, evaluate) };
}

function normalizeRadians(value) {
    return ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function averagePolarizations(sValue, pValue) {
    if (!sValue.valid || !pValue.valid) {
        return {
            valid: false,
            wavelengthNm: sValue.wavelengthNm,
            reason: sValue.valid ? pValue.reason : sValue.reason,
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
        knotSignature: `${sValue.knotSignature || '-'}|${pValue.knotSignature || '-'}`,
        discontinuityModels: [...new Set([
            ...(sValue.discontinuityModels || []),
            ...(pValue.discontinuityModels || []),
        ])],
    };
    return result;
}

export function computeGdGddSpectrum(design, options) {
    const { side, lambdaStart, lambdaEnd, thetaDeg, polarization, target, preview } = options;
    const valueCache = new Map();
    const pointEvaluators = Object.fromEntries(
        (polarization === 'avg' ? ['s', 'p'] : [polarization]).map(code => [
            code,
            createDesignPhaseDispersionEvaluator(design, {
                side,
                target,
                polarization: code,
                thetaDeg,
            }),
        ]));
    const evaluate = (wavelengthNm) => {
        if (!valueCache.has(wavelengthNm)) {
            const evaluatePolarization = polarizationCode =>
                pointEvaluators[polarizationCode](wavelengthNm);
            const value = polarization === 'avg'
                ? averagePolarizations(evaluatePolarization('s'), evaluatePolarization('p'))
                : evaluatePolarization(polarization);
            valueCache.set(wavelengthNm, value);
        }
        return valueCache.get(wavelengthNm);
    };
    const { base: baseWavelengths, wavelengths } =
        presentationGrid(lambdaStart, lambdaEnd, preview, evaluate);
    const values = wavelengths.map(evaluate);
    const phaseRadians = unwrapFiniteRuns(
        values.map(value => value.valid ? value.phaseRad : NaN));
    const phaseDeg = phaseRadians.map(value => value * 180 / Math.PI);
    return {
        lambda: wavelengths,
        phaseDeg,
        gd: values.map(value => value.valid ? value.gdFs : NaN),
        gdd: values.map(value => value.valid ? value.gddFs2 : NaN),
        tod: values.map(value => value.valid ? value.todFs3 : NaN),
        magnitudeSquared: values.map(value => value.valid ? value.magnitudeSquared : NaN),
        invalid: values
            .filter(value => !value.valid)
            .map(value => ({ wavelengthNm: value.wavelengthNm, reason: value.reason })),
        models: values.find(value => value.models)?.models || [],
        phaseContinuousOrder: Math.min(...values.map(value =>
            value.phaseContinuousOrder ?? 3)),
        knotSignatures: values.map(value => value.knotSignature || ''),
        discontinuityModels: [...new Set(values.flatMap(value =>
            value.discontinuityModels || []))],
        method: 'analytic Taylor jets',
        preview: !!preview,
        basePointCount: baseWavelengths.length,
        adaptivePointCount: wavelengths.length - baseWavelengths.length,
    };
}

function unwrapFiniteRuns(phases) {
    const result = phases.slice();
    let start = 0;
    while (start < result.length) {
        while (start < result.length && !Number.isFinite(result[start])) start++;
        let end = start;
        while (end < result.length && Number.isFinite(result[end])) end++;
        if (end > start) result.splice(start, end - start, ...unwrapPhase(result.slice(start, end)));
        start = end + 1;
    }
    return result;
}
