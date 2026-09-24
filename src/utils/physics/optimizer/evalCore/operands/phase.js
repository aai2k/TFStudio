/**
 * Phase operands: reflected / transmitted phase shift, group delay, GDD and TOD
 * at a point, group-delay flatness across a band, and their exact thickness
 * derivatives. Values come from the validated stack phase-dispersion routine.
 */

import { evaluateStackPhaseDispersion } from '../../../phaseDispersion.js';
import { isGroupDelayFlat } from '../../operandModel.js';
import { operandSampleLambdas, bandQuadratureWeights } from '../../sampling.js';
import { _normalizeDegrees } from '../angles.js';
import { OperandEvaluationError } from './errors.js';

// ── Phase / field operand evaluators ──────────────────────────────────────────
// These bypass tmmProp and call the validated thinFilmMath phase/field routines
// directly on the FRONT stack (single-surface reflection / internal-field
// quantities). Per-λ complex indices come from nkOf so dispersion is honoured;
// results match the Ellipsometry / GD-GDD / E-field analysis windows (front side).

// Clear the per-context phase-dispersion memo. Called at the start of an
// evaluation pass so a reused context cannot serve a result from the previous
// thicknesses.
export function resetPhaseDispersionCache(ctx) {
    ctx._phaseDispersionCache = new Map();
}

// The phase operand kinds measured on the transmitted beam; every other kind
// is measured on the reflected beam.
const _TRANSMISSION_PHASE_TYPES = new Set([
    'PT', 'DPT', 'GDT', 'GDDT', 'TODT', 'GDTFLAT', 'GDDTFLAT', 'TODTFLAT',
]);

function _phaseTarget(type) {
    return _TRANSMISSION_PHASE_TYPES.has(type) ? 'T' : 'R';
}

function _phaseQuantity(type) {
    if (type === 'PR' || type === 'PT' || type === 'DPR' || type === 'DPT') return 'phaseDeg';
    if (type.startsWith('TOD')) return 'todFs3';
    if (type.startsWith('GDD')) return 'gddFs2';
    return 'gdFs';
}

function _phaseOperandSide(ctx) {
    return (ctx.surfaceMode || 'front_only') === 'back_only' ? 'back' : 'front';
}

function _phaseDispersionPolResult(op, ctx, wavelengthNm, polCode, withThicknessJacobian = false) {
    if (!ctx._phaseDispersionCache) ctx._phaseDispersionCache = new Map();
    const side = _phaseOperandSide(ctx);
    const key = `${wavelengthNm}|${op.aoi}|${polCode}|${_phaseTarget(op.type)}|${side}|${withThicknessJacobian}`;
    let result = ctx._phaseDispersionCache.get(key);
    if (result) return result;
    const back = side === 'back';
    const sourceMaterials = back ? ctx.backMats : ctx.frontMats;
    const sourceThicknesses = back ? ctx.backThicks : ctx.frontThicks;
    const layerIndices = sourceMaterials.map((_, index) => index);
    if (back) layerIndices.reverse();
    result = evaluateStackPhaseDispersion({
        wavelengthNm,
        target: _phaseTarget(op.type),
        polarization: polCode,
        thetaDeg: op.aoi,
        incidentMaterial: back ? (ctx.neMat || ctx.n0mat) : ctx.n0mat,
        substrateMaterial: ctx.nsmat,
        layers: layerIndices.map(index => ({
            material: sourceMaterials[index],
            thicknessNm: sourceThicknesses[index],
        })),
        withThicknessJacobian,
    });
    if (!result.valid) throw new OperandEvaluationError(result.reason);
    // A value taken outside a material's data range is drawn by the analysis
    // windows, with the band shaded to say what it is. Scoring one is different:
    // a target is not looked at, it sets what the optimizer moves the design
    // towards, so the row is an error instead.
    if (result.outsideRange) {
        throw new OperandEvaluationError(
            `${result.outsideRange}: wavelength is outside the material model range`);
    }
    ctx._phaseDispersionCache.set(key, result);
    return result;
}

function _phaseDispersionPolValue(op, ctx, wavelengthNm, polCode) {
    return _phaseDispersionPolResult(op, ctx, wavelengthNm, polCode)[_phaseQuantity(op.type)];
}

function _phaseDispersionValue(op, ctx, wavelengthNm) {
    const sValue = () => _phaseDispersionPolValue(op, ctx, wavelengthNm, 's');
    const pValue = () => _phaseDispersionPolValue(op, ctx, wavelengthNm, 'p');
    if (op.type === 'DPR' || op.type === 'DPT') {
        return _normalizeDegrees(pValue() - sValue());
    }
    if (op.pol === 'avg') {
        const s = sValue();
        const p = pValue();
        return _phaseQuantity(op.type) === 'phaseDeg'
            ? _normalizeDegrees(s + _normalizeDegrees(p - s) / 2)
            : (s + p) / 2;
    }
    return op.pol === 'p' ? pValue() : sValue();
}

function _phaseDerivativeVector(ctx, derivative) {
    const side = _phaseOperandSide(ctx);
    const sideThicknesses = side === 'back' ? ctx.backThicks : ctx.frontThicks;
    const size = side === 'back'
        ? sideThicknesses.length
        : (ctx.fullThicks?.length ?? sideThicknesses.length);
    const out = new Array(size).fill(0);
    for (let index = 0; index < sideThicknesses.length; index++) {
        const sourceIndex = side === 'back' ? sideThicknesses.length - 1 - index : index;
        out[index] = derivative[sourceIndex] ?? 0;
    }
    return out;
}

function _combineThicknessValues(left, right, leftWeight, rightWeight) {
    return left.map((value, index) => value * leftWeight + right[index] * rightWeight);
}

// One polarization's value and thickness derivative, or null where the phase
// routine carries no Jacobian for the quantity asked for.
function _phasePolarizationThicknessPoint(op, ctx, wavelengthNm, quantity, polCode) {
    const result = _phaseDispersionPolResult(op, ctx, wavelengthNm, polCode, true);
    const thicknessJacobian = result.thicknessJacobian?.[quantity];
    if (!thicknessJacobian) return null;
    return {
        value: result[quantity],
        derivative: _phaseDerivativeVector(ctx, thicknessJacobian),
    };
}

/** Value and exact active-coating thickness derivative for a phase operand point. */
export function phaseDispersionThicknessPoint(op, ctx, wavelengthNm) {
    const quantity = _phaseQuantity(op.type);
    const s = () => _phasePolarizationThicknessPoint(op, ctx, wavelengthNm, quantity, 's');
    const p = () => _phasePolarizationThicknessPoint(op, ctx, wavelengthNm, quantity, 'p');
    if (op.type === 'DPR' || op.type === 'DPT') {
        const sValue = s();
        const pValue = p();
        if (!sValue || !pValue) return null;
        return {
            value: _normalizeDegrees(pValue.value - sValue.value),
            derivative: _combineThicknessValues(pValue.derivative, sValue.derivative, 1, -1),
        };
    }
    if (op.pol === 'avg') {
        const sValue = s();
        const pValue = p();
        if (!sValue || !pValue) return null;
        return {
            value: quantity === 'phaseDeg'
                ? _normalizeDegrees(sValue.value + _normalizeDegrees(pValue.value - sValue.value) / 2)
                : (sValue.value + pValue.value) / 2,
            derivative: _combineThicknessValues(sValue.derivative, pValue.derivative, 0.5, 0.5),
        };
    }
    return op.pol === 'p' ? p() : s();
}

export function _evalPhaseDispersionPoint(op, ctx) {
    return _phaseDispersionValue(op, ctx, op.lambdaStart);
}

// RMS deviation of GD / GDD / TOD from the target across the band, with the
// trapezoid weights of the band grid (sampling.js bandQuadratureWeights).
export function _evalGroupDelayFlat(op, ctx) {
    const wavelengths = operandSampleLambdas(op);
    const q = bandQuadratureWeights(wavelengths.length);
    let sumSquared = 0;
    for (let i = 0; i < wavelengths.length; i++) {
        const difference = _phaseDispersionValue(op, ctx, wavelengths[i]) - op.target;
        sumSquared += q[i] * difference * difference;
    }
    return wavelengths.length ? Math.sqrt(sumSquared) : 0;
}

/**
 * Mean GD / GDD / TOD a flatness operand actually achieves across its band, in
 * the same unit as its target. The operand's own value is an RMS deviation, so
 * it cannot be read against the target level; this is the number that can. Both
 * come from the same per-wavelength evaluations, so this reuses the context's
 * phase cache and costs nothing after the operand has been evaluated once.
 */
export function groupDelayFlatBandLevel(op, ctx) {
    if (!isGroupDelayFlat(op.type)) return null;
    const wavelengths = operandSampleLambdas(op);
    if (!wavelengths.length) return null;
    const q = bandQuadratureWeights(wavelengths.length);
    let sum = 0;
    for (let i = 0; i < wavelengths.length; i++) sum += q[i] * _phaseDispersionValue(op, ctx, wavelengths[i]);
    return sum;
}
