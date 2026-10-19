/**
 * Operand → sample-wavelength derivation + material presampling.
 *
 * This is the
 * SINGLE SOURCE OF TRUTH for the λ grid an operand evaluates on — shared
 * byte-for-byte by the optimizer core (evalOperand) and the Web Worker
 * pre-sampler. The arithmetic must stay bit-identical; see the
 * inline notes. Depends only on operand-model predicates.
 */

import {
    isDmfs, isBlank, isManufacturability, isMath, isRangeTarget,
    isIntegral, isArgwave, isMinmax, isGroupDelayFlat, isMeasuredCurve, isPPEF,
    bandSampleCount, bandFlagCount, isBandGridRow, logOperand,
} from './operandModel.js';
import { materialOmegaResponse } from '../../materials/materialDispersion.js';
import { workerMaterialFields } from '../../materials/designMaterials.js';
import { extremumBaseLambdas } from './extremumGrid.js';

export function isRangeAvg(type) { return type === 'TAV' || type === 'RAV' || type === 'AAV'; }
// All range-sampled operands — uniform N-point grid over [λStart, λEnd].
// Integral, minmax, and argwave operands share the same sampler so the worker
// pre-sampler (Approach A) can pre-compute materials' n,k on a single union
// grid. Inequality operands defer to their baseType (see operandSampleLambdas).
const BAND_SAMPLED = [isRangeAvg, isRangeTarget, isIntegral, isMinmax, isArgwave, isGroupDelayFlat];
function isBandSampled(type) {
    return BAND_SAMPLED.some(test => test(type));
}
// The channel ('T' | 'R' | 'A') a spectral row reads: its first letter, except
// for the dB and density rows, which name it in their type list (ODMN reads T).
export function charOf(type) { return logOperand(type)?.channel ?? type[0]; }

// Band operands whose default grid is bandSampleCount: averages, integrals,
// range targets and group-delay flatness. The extremum operands (argwave,
// worst-case min/max) search on their own grid (extremumGrid.js).
export function hasBandDensityGrid(type) {
    return isBandGridRow(type);
}

// The operand field that carries its own sample count: rampPoints for a range
// target, bandPoints for every other band operand.
export function sampleCountField(type) {
    return isRangeTarget(type) ? 'rampPoints' : 'bandPoints';
}

// The sample count the operand carries in that field (≥2, rounded), or null
// when it carries none and the default grid applies.
export function sampleCountOverride(op) {
    const v = op[sampleCountField(op.type)];
    return Number.isFinite(v) && v >= 2 ? Math.round(v) : null;
}

// The weights every band operand sums its samples with.
export { bandQuadratureWeights } from './bandQuadrature.js';

// A band row's sample count: the count it carries, or the default grid, and
// never fewer than its flag asks for.
function bandRowCount(op) {
    const own = sampleCountOverride(op);
    return own == null ? bandSampleCount(op) : Math.max(own, bandFlagCount(op));
}

// Continuous per-λ target line (TGT/RGT/AGT). Density-based default
// (~AVG_STEP_NM, same grid as band averages) so a steep ramp / structured
// spectral target is sampled finely enough that the RMS deviation is accurate —
// the old flat 21-point default was ~15 nm spacing on a 300 nm band and
// under-resolved steep edges. `op.rampPoints` (if ≥2) still overrides for a
// hand-tuned density, though never coarser than the row's flag asks.
function _rangeTargetLambdas(op, range) {
    const n = bandRowCount(op);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        out[i] = op.lambdaStart + range * f;
    }
    return out;
}

// Band averages, integrals and flatness rows on a uniform N-point grid:
// AVG_STEP_NM when no design is at hand; a run and the merit table set
// bandPoints from the design's fringe spacing (evalCore/fringeSampling.js).
// bandPoints is NOT stamped on operands by makeOperand, so a default change here
// reaches every operand on disk. A user can override it per operand, though
// never coarser than the row's flag asks.
function _bandLambdas(op, range) {
    const n = bandRowCount(op);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = op.lambdaStart + (range * i) / (n - 1);
    }
    return out;
}

// ── Centralized operand → sample-wavelength derivation ────────────────────────
//
// SINGLE SOURCE OF TRUTH for "which λ does this operand evaluate at". Used by
// evalOperand below AND by the Web Worker pre-sampler (Refinement). These two
// MUST be byte-identical: the worker ships a table-lookup
// getNK keyed by exactly these λ floats, so the optimizer (running in the
// worker) must request exactly these λ. The arithmetic here REPRODUCES
// evalOperand's expressions EXACTLY (`range*f` for ramp, `(range*i)/(n-1)` for
// avg) — do not "simplify" it; bit-identical IEEE-754 floats are the contract.
// Math operands reference other rows by id, so they contribute no λ of their
// own and requiredLambdas picks up the referenced rows naturally. Legacy shim:
// an OPGT/OPLT written before refId carries `baseType` and forwards to it.
function mathSampleLambdas(op) {
    if ((op.type === 'OPGT' || op.type === 'OPLT') && op.baseType && !op.refId) {
        return operandSampleLambdas({ ...op, type: op.baseType });
    }
    return [];
}

// Rows that sample no wavelength of their own: DMFS / BLNK are inert, the
// manufacturability rows act on layer thicknesses, and a PPEF row reads at its
// curve block's points, which the block brings.
const NO_OWN_LAMBDAS = [isDmfs, isBlank, isManufacturability, isPPEF];

export function operandSampleLambdas(op) {
    if (NO_OWN_LAMBDAS.some(test => test(op.type))) return [];
    // Math operands reference other rows by id; the referenced operands carry
    // their own λ grid, so math operands contribute zero λs themselves and
    // requiredLambdas() picks up the referenced operands' λs naturally.
    // (Legacy shim: an old OPGT/OPLT with `op.baseType` set forwards to the
    // baseType operand for backward compat with files written by the
    // pre-refId build.)
    if (isMath(op.type)) return mathSampleLambdas(op);
    // A measured block owns its grid as persisted data. Do not derive or
    // resample it here: this exact array is shared by direct evaluation and the
    // worker material pre-sampler, and is expanded point-for-point at run time.
    if (isMeasuredCurve(op.type)) {
        return Array.isArray(op.sampleLambdas) ? op.sampleLambdas.slice() : [];
    }
    if (isBandSampled(op.type)) return bandSampledLambdas(op);
    return [op.lambdaStart];
}

// A band-extremum row starts its search from its own grid, or from the count
// a run fixed on it; the search adds the wavelengths it refines at
// (evalCore/bandExtremum.js).
function bandSampledLambdas(op) {
    if (isArgwave(op.type) || isMinmax(op.type)) return extremumBaseLambdas(op, sampleCountOverride(op));
    const range = op.lambdaEnd - op.lambdaStart;
    return isRangeTarget(op.type) ? _rangeTargetLambdas(op, range) : _bandLambdas(op, range);
}

// Sorted unique union of every λ the enabled operands will sample. This is the
// exact grid the worker pre-samples each material on (Approach A).
export function requiredLambdas(operands) {
    const set = new Set();
    for (const op of operands) {
        if (!op.enabled) continue;
        for (const lam of operandSampleLambdas(op)) set.add(lam);
    }
    return Array.from(set).sort((a, b) => a - b);
}

/**
 * The wavelength span the enabled operands evaluate over, as `[minNm, maxNm]`,
 * or null when none of them samples a wavelength. Taken from the same grid the
 * optimizer scores on, so a check made against it cannot disagree with what a
 * run actually computes. A row whose λ pair is not a wavelength (a layer range,
 * a row reference, a comment) contributes nothing.
 */
export function operandWavelengthSpan(operands) {
    let low = Infinity;
    let high = -Infinity;
    for (const lambda of requiredLambdas(operands)) {
        if (!Number.isFinite(lambda)) continue;
        if (lambda < low) low = lambda;
        if (lambda > high) high = lambda;
    }
    return low <= high ? [low, high] : null;
}

// Build the worker materials table (Approach A): sample each {id, mat} pair's
// [n,k] on the exact λ grid. Shared by Refinement (DLS) and the synthesis
// worker (needle/GE — must also pre-sample the candidate pool).
// `pairs` = [{ id, mat }]; later duplicates of an id are ignored.
//
// The mechanical block rides along unsampled: it holds constants, not a
// dispersion, and the STR operand reads it in the worker exactly as the main
// thread reads it off the material record. Without it a worker run would score
// a merit function containing STR as though every film were unstressed.
//
// A non-built-in material also carries its definition (`record`), so a worker
// asked for a wavelength off the grid computes it from the same dispersion
// model instead of the nearest sample (src/utils/workers/resolveMat.js).
export function buildPresampledTable(lambdas, pairs, { includeOmegaResponses = true } = {}) {
    const materials = {};
    for (const { id, mat } of pairs) {
        if (id == null || materials[id] || !mat) continue;
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        const omegaResponses = includeOmegaResponses ? new Array(lambdas.length) : null;
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0]; k[i] = nk[1];
            if (omegaResponses) omegaResponses[i] = materialOmegaResponse(mat, lambdas[i]);
        }
        materials[id] = {
            lambdas, n, k,
            ...(omegaResponses ? { omegaResponses } : {}),
            ...(mat.mechanical ? { mechanical: mat.mechanical } : {}),
            ...workerMaterialFields(id, mat),
        };
    }
    return materials;
}
