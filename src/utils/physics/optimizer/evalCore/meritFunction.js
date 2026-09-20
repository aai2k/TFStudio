import { isManufacturability, isValidMeritWeight } from '../operandModel.js';
import { _meritDiff } from './residualScale.js';
import { operandEvaluationErrors } from './evalContext.js';

// Accumulate the weighted squared residuals over all contributing operands.
// Returns { sumWRes2, sumWopt, sumWcon, n, sawNonFinite }.
//
// Two weight accumulators: `sumWopt` (the optical/spec operands that define the
// merit's normalization) and `sumWcon` (manufacturability rows — MNT/MXT layer
// bounds, the TT total-thickness budget, the STR film force). The RMS is normalized by
// the OPTICAL weight only; constraints add their one-sided penalty to the
// NUMERATOR but never enter the denominator (keeps MF == OMF when satisfied).
function _accumMerit(operands, computed, skipConstraints) {
    let sumWRes2 = 0, sumWopt = 0, sumWcon = 0, n = 0;
    let sawNonFinite = false;   // a contributing operand evaluated to NaN/Inf
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || computed[i] == null) continue;
        const diff = _meritDiff(op, computed[i], skipConstraints);
        if (diff === null) continue;   // constraint dropped by skipConstraints
        // Guard against a non-finite residual poisoning the entire MF. A NaN/Inf
        // from a single operand (e.g. a material at a dispersion pole, a missing
        // material, or a cyclic math operand) would otherwise propagate through
        // sumWRes2 → Math.sqrt(NaN) and make the whole merit function NaN,
        // silently breaking every optimizer. Skip the bad operand instead.
        if (!Number.isFinite(diff)) { sawNonFinite = true; continue; }
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
    return { sumWRes2, sumWopt, sumWcon, n, sawNonFinite };
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

export function calcMF(operands, computed, opts = {}) {
    if (operandEvaluationErrors(computed).some(Boolean)) return Infinity;
    const skipConstraints = !!opts.skipConstraints;
    if (hasInvalidContributingWeight(operands, computed, skipConstraints)) return Infinity;
    const { sumWRes2, sumWopt, sumWcon, n, sawNonFinite } =
        _accumMerit(operands, computed, skipConstraints);
    // n === 0 means NO operand contributed. Two very different causes:
    //  (a) at least one operand evaluated to NaN/Inf and every operand was
    //      dropped — the H5 NaN-cascade: a genuinely degenerate design. Return
    //      Infinity so it can never masquerade as a perfect MF=0 and be accepted
    //      by `mfTry < mf` / trip isConverged().
    //  (b) no operand was degenerate — the list is empty, or every operand is a
    //      constraint skipped by skipConstraints (synthesis-scan / OMF), or all
    //      disabled. Nothing to score → trivially-perfect MF 0 (long-standing,
    //      tested behaviour the needle/GE scanners rely on).
    if (n === 0) return sawNonFinite ? Infinity : 0;
    // Normalize by the optical weight. Fall back to the constraint-weight sum for
    // a CONSTRAINTS-ONLY merit (e.g. a pure total-thickness target with no optical
    // operand to normalize against) so such a merit still scores its violations.
    // n > 0 but both sums 0: real, finite operands exist but all weight 0 —
    // trivially satisfied, established (tested) merit is 0.
    const denom = sumWopt > 0 ? sumWopt : sumWcon;
    if (denom <= 0) return 0;
    return Math.sqrt(sumWRes2 / denom);
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
