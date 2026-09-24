import { isManufacturability, isValidMeritWeight } from '../operandModel.js';
import { _meritDiff } from './residualScale.js';
import { operandEvaluationErrors } from './evalContext.js';

// Accumulate the weighted squared residuals over all contributing operands.
// Returns { sumWRes2, sumWopt, sumWcon, n, nonFinite }.
//
// Two weight accumulators: `sumWopt` (the optical/spec operands that define the
// merit's normalization) and `sumWcon` (manufacturability rows — MNT/MXT layer
// bounds, the TT total-thickness budget, the STR film force). The RMS is normalized by
// the OPTICAL weight only; constraints add their one-sided penalty to the
// NUMERATOR but never enter the denominator (keeps MF == OMF when satisfied).
//
// A row whose residual is not a finite number stops the sum: dropping it would
// also drop its weight and report a merit that looks better than the design.
function _accumMerit(operands, computed, skipConstraints) {
    let sumWRes2 = 0, sumWopt = 0, sumWcon = 0, n = 0;
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || computed[i] == null) continue;
        const diff = _meritDiff(op, computed[i], skipConstraints);
        if (diff === null) continue;   // constraint dropped by skipConstraints
        if (!Number.isFinite(diff)) return { sumWRes2, sumWopt, sumWcon, n, nonFinite: true };
        const w = op.weight;
        sumWRes2 += w * diff * diff;
        // Denominator policy. Manufacturability rows (MNT/MXT layer bounds, the
        // TT total-thickness budget, the STR film force) add their penalty to
        // the numerator above, but their weight is kept OUT of the normalization
        // denominator (sumWopt). Everything else — optical T/R/A targets, ramps,
        // min/max spec operands and math operands (all of which express OPTICAL
        // performance and are also kept by calcOMF) — normalizes the RMS.
        //
        // Why: a SATISFIED constraint then contributes 0/0 → it leaves the MF
        // EXACTLY equal to the OMF, instead of diluting the RMS denominator and
        // deflating MF below OMF. A VIOLATED constraint raises the numerator from
        // 0 continuously, so MF climbs smoothly above OMF with no discontinuity.
        // Counting the penalty in the numerator at ALL times, satisfied or not,
        // is what gives both: continuity AND MF ≥ OMF. The needle scanner already
        // normalizes by optical weight only (scanners.js), so this also aligns
        // the reported MF with the scan.
        if (isManufacturability(op.type)) sumWcon += w;
        else sumWopt += w;
        n++;
    }
    return { sumWRes2, sumWopt, sumWcon, n, nonFinite: false };
}

function hasInvalidContributingWeight(operands, computed, skipConstraints) {
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || computed[i] == null) continue;
        if (skipConstraints && isManufacturability(op.type)) continue;
        if (!isValidMeritWeight(op.weight)) return true;
    }
    return false;
}

// The weight sum the merit is normalized by: the optical rows that were scored,
// or the constraint rows when a merit has nothing else. Rows the merit skips
// (disabled, unevaluated, comment rows) add nothing to it.
function _denominator({ sumWopt, sumWcon }) {
    return sumWopt > 0 ? sumWopt : sumWcon;
}

/**
 * The normalization denominator W of MF = √(SSR/W) for these evaluated values:
 * the weights of the rows calcMF scores (optical rows, or the constraint rows
 * when there are no others). Comment rows, disabled rows and rows without a
 * value carry no weight in it. The analytic gradient divides by this, since
 * MF = √(SSR/W) gives ∇MF = Jᵀr/(‖r‖·√W). 0 when no row contributes.
 */
export function mfWeightDenominator(operands, computed, { skipConstraints = false } = {}) {
    return _denominator(_accumMerit(operands, computed, skipConstraints));
}

export function calcMF(operands, computed, opts = {}) {
    const skipConstraints = !!opts.skipConstraints;
    if (operandEvaluationErrors(computed).some(Boolean)
        || hasInvalidContributingWeight(operands, computed, skipConstraints)) return Infinity;
    const acc = _accumMerit(operands, computed, skipConstraints);
    // A row that could not produce a finite residual (a material at a
    // dispersion pole, a math row whose reference has no value) leaves the
    // merit undefined. Infinity, not NaN: every accept test then rejects the
    // point, and a later finite trial can still replace it.
    if (acc.nonFinite) return Infinity;
    // Normalize by the optical weight. Fall back to the constraint-weight sum for
    // a CONSTRAINTS-ONLY merit (e.g. a pure total-thickness target with no optical
    // operand to normalize against) so such a merit still scores its violations.
    // The merit is 0 when nothing contributed (an empty list, every row a
    // constraint skipped by skipConstraints, all disabled; the needle/GE
    // scanners rely on it) and when the contributing rows all weigh 0.
    const denom = _denominator(acc);
    return acc.n > 0 && denom > 0 ? Math.sqrt(acc.sumWRes2 / denom) : 0;
}

// Optical merit function (OMF) — the SAME RMS as calcMF but excluding the
// non-optical manufacturability penalties (MNT/MXT per-layer bounds, the TT
// total-thickness budget, the STR film force). This is the canonical "optical MF" used by
// the needle/GE scanners, error analysis and the yield simulators, surfaced to
// the user alongside the full MF. Min/max spec operands and math operands stay
// IN the OMF because they express optical performance, not manufacturability.
// One place defines what OMF means — adjust the opts here to retune it globally.
export function calcOMF(operands, computed) {
    return calcMF(operands, computed, { skipConstraints: true });
}
