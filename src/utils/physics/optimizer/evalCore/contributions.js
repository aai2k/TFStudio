import { isConstraint, isTotalThickness, isValidMeritWeight } from '../operandModel.js';
import { _meritDiff } from './residualScale.js';
import { operandEvaluationErrors } from './evalContext.js';

// Weighted squared residual per row, aligned with `operands`, plus their sum.
// A row that puts nothing into the sum is left null.
function _contributionTerms(operands, computed, skipConstraints) {
    const terms = new Array(operands.length).fill(null);
    let total = 0;
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || computed[i] == null) continue;
        if (!isValidMeritWeight(op.weight)) continue;
        const diff = _meritDiff(op, computed[i], skipConstraints);
        if (diff === null || !Number.isFinite(diff)) continue;
        const term = op.weight * diff * diff;
        terms[i] = term;
        total += term;
    }
    return { terms, total };
}

// Per-operand share of the merit function, as a fraction summing to 1 across
// every row that contributes.
//
// MF = √(Σ wᵢ(rᵢ/σᵢ)² / denom), so each operand puts wᵢ(rᵢ/σᵢ)² into the sum and
// its share of that sum is what the merit table shows. Taken over the SAME terms
// _accumMerit adds, by calling the same _meritDiff, so a row's contribution can
// never disagree with the merit it is a share of. `denom` is common to every row
// and cancels in the ratio, which is why constraints belong in the same
// percentage even though their weight stays out of the denominator: they raise
// the numerator like everything else.
//
// A row that contributes nothing to the sum gets null — disabled, unevaluated,
// non-finite, invalid weight, or a constraint dropped by skipConstraints. A row
// sitting exactly on its target gets 0.
export function operandContributions(operands, computed, { skipConstraints = false } = {}) {
    if (!computed) return new Array(operands.length).fill(null);
    // Same first guard calcMF uses. With an operand that could not be evaluated
    // the merit is Infinity, so there is no total to take a share of; reporting
    // the surviving rows as a tidy 100% would claim a complete table when one
    // row is missing entirely.
    if (operandEvaluationErrors(computed).some(Boolean)) return new Array(operands.length).fill(null);
    const { terms, total } = _contributionTerms(operands, computed, skipConstraints);
    // Every contributing row is exactly on target: nothing is holding the merit
    // up, so every share is 0 rather than an arbitrary split of zero.
    if (!(total > 0)) return terms.map(term => (term == null ? null : 0));
    return terms.map(term => (term == null ? null : term / total));
}

// The weighted-RMS NORMALIZATION denominator used by calcMF — the optical weight
// sum (everything except MNT/MXT/TT manufacturability constraints), with a
// constraints-only fallback. Exported so the analytic-gradient path (gradMF in
// dls.js) divides by the SAME quantity calcMF does: MF = √(SSR/denom) ⇒
// ∇MF = (Jᵀr)/(‖r‖·√denom). Keep this byte-consistent with calcMF's denom logic.
export function mfWeightDenominator(operands, { skipConstraints = false } = {}) {
    let sumWopt = 0, sumWcon = 0;
    for (const op of operands) {
        if (!op.enabled) continue;
        if (isConstraint(op.type) || isTotalThickness(op.type)) {
            if (skipConstraints) continue;
            sumWcon += op.weight;
        } else {
            sumWopt += op.weight;
        }
    }
    return sumWopt > 0 ? sumWopt : sumWcon;
}
