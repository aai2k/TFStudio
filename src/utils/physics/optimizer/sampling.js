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
    isDmfs, isBlank, isConstraint, isTotalThickness, isMath, isRangeTarget,
    isIntegral, isArgwave, isMinmax, bandSampleCount, ARGWAVE_DEFAULT_POINTS,
} from './operandModel.js';

export function isRangeAvg(type) { return type === 'TAV' || type === 'RAV' || type === 'AAV'; }
// All range-sampled operands — uniform N-point grid over [λStart, λEnd].
// Integral, minmax, and argwave operands share the same sampler so the worker
// pre-sampler (Approach A) can pre-compute materials' n,k on a single union
// grid. Inequality operands defer to their baseType (see operandSampleLambdas).
function isBandSampled(type) {
    return isRangeAvg(type) || isRangeTarget(type) || isIntegral(type) || isMinmax(type) || isArgwave(type);
}
export function charOf(type) { return type[0]; }

// Continuous per-λ target line (TGT/RGT/AGT). Density-based default
// (~AVG_STEP_NM, same grid as band averages) so a steep ramp / structured
// spectral target is sampled finely enough that the RMS deviation is accurate —
// the old flat 21-point default was ~15 nm spacing on a 300 nm band and
// under-resolved steep edges. `op.rampPoints` (if ≥2) still overrides for a
// hand-tuned density.
function _rangeTargetLambdas(op, range) {
    const userN = Number.isFinite(op.rampPoints) && op.rampPoints >= 2
        ? Math.round(op.rampPoints)
        : null;
    const n = userN ?? bandSampleCount(op);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        out[i] = op.lambdaStart + range * f;
    }
    return out;
}

// Range-sampled band operands (averages / integrals / minmax / argwave) on a
// uniform N-point grid. Runtime defaults for sampling density: bandPoints is NOT
// stamped on operands by makeOperand — it lives only at evaluation time, so a
// default change here automatically upgrades every existing operand on disk (no
// migration / "remake" needed).
//   • Argwave (MXW*/MNW*) AND worst-case min/max (TMN/RMN/AMN/TMX/RMX/AMX):
//     ARGWAVE_DEFAULT_POINTS (301 = 1 nm grid). Both report a band EXTREMUM, so
//     coarse sampling can latch onto the wrong peak / miss a narrow dip —
//     precision matters most here, and minmax now returns the TRUE extremum (not
//     a smooth surrogate), so a dense grid is a pure accuracy win (the Jacobian
//     only differentiates the single argmax sample, so cost stays ~O(nFree), not
//     O(n·nFree)).
//   • TAV/RAV/AAV + TIW/RIW/AIW: density-based (~AVG_STEP_NM) — fine for smooth
//     averages and band integrals.
// User can override via op.bandPoints for a single operand (e.g. to sample a
// structured weighting more finely).
function _bandLambdas(op, range) {
    const userN = Number.isFinite(op.bandPoints) && op.bandPoints >= 2
        ? Math.round(op.bandPoints)
        : null;
    // Extremum operators (argwave + minmax) get the dense fixed grid;
    // band-average/integral operands use the ~AVG_STEP_NM density. User
    // op.bandPoints wins for either.
    const defaultN = (isArgwave(op.type) || isMinmax(op.type))
        ? ARGWAVE_DEFAULT_POINTS
        : bandSampleCount(op);
    const n = userN ?? defaultN;
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
export function operandSampleLambdas(op) {
    // DMFS / BLNK are inert; constraints & TT act on layer thicknesses, not λ.
    if (isDmfs(op.type) || isBlank(op.type) || isConstraint(op.type) || isTotalThickness(op.type)) return [];
    // Math operands reference other rows by id; the referenced operands carry
    // their own λ grid, so math operands contribute zero λs themselves and
    // requiredLambdas() picks up the referenced operands' λs naturally.
    // (Legacy shim: an old OPGT/OPLT with `op.baseType` set forwards to the
    // baseType operand for backward compat with files written by the
    // pre-refId build.)
    if (isMath(op.type)) {
        if ((op.type === 'OPGT' || op.type === 'OPLT') && op.baseType && !op.refId) {
            return operandSampleLambdas({ ...op, type: op.baseType });
        }
        return [];
    }
    if (isBandSampled(op.type)) {
        const range = op.lambdaEnd - op.lambdaStart;
        return isRangeTarget(op.type) ? _rangeTargetLambdas(op, range) : _bandLambdas(op, range);
    }
    return [op.lambdaStart];
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

// Build the worker materials table (Approach A): sample each {id, mat} pair's
// [n,k] on the exact λ grid. Shared by Refinement (DLS) and the synthesis
// worker (needle/GE — must also pre-sample the candidate pool).
// `pairs` = [{ id, mat }]; later duplicates of an id are ignored.
export function buildPresampledTable(lambdas, pairs) {
    const materials = {};
    for (const { id, mat } of pairs) {
        if (id == null || materials[id] || !mat) continue;
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0]; k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
}
