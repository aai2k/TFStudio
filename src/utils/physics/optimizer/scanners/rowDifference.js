/**
 * Needle-scan contribution of one merit row with no exact needle slope (phase,
 * group delay, ellipsometric and field rows, a curve block read whole, and the
 * math rows reading any of them or a thickness row), from a difference of that
 * row alone.
 *
 * At each descriptor a needle of deltaNm nm goes in, as scanNeedlesFD inserts
 * it, and only the row is evaluated on the perturbed stack, with the rows it
 * reads (evaluateOperandRows). Its term in the sum of squares, t = w·(r/σ)²,
 * gives Σ rₛ·∂rₛ/∂d ≈ (t(δ) − t(0)) / 2δ, the numerator gradientAccum.js sums
 * for every other row. A row with no finite value on the perturbed stack makes
 * the candidate's numerator +Infinity, as the merit scanNeedlesFD reads there
 * is Infinity.
 */

import { _operandResidual, evaluateOperandRows } from '../evalCore.js';
import { _perturbCtxGap, _perturbCtxIntra } from './perturbCtx.js';

// w·(r/σ)² of row `op` at `value`, the term calcMF adds; Infinity when the row
// has no finite value.
function squaredTerm(op, value, sigma) {
    if (value == null) return Infinity;
    const miss = _operandResidual(op, value) / sigma;
    const term = op.weight * miss * miss;
    return Number.isFinite(term) ? term : Infinity;
}

/**
 * Add row i's differenced numerator to every descriptor. `scan` bundles
 * { operands, comp, ctx0, cfg, descs, candidateMats, deltaNm, sigma }, with
 * comp the values on ctx0 and sigma the row's unit scale.
 */
export function _accumRowDifference(scan, i) {
    const { operands, comp, ctx0, cfg, descs, candidateMats, deltaNm, sigma } = scan;
    const op = operands[i];
    const base = squaredTerm(op, comp[i], sigma);
    for (const d of descs) {
        const mat = candidateMats[d.ci].mat;
        const ctx = d.kind === 'gap'
            ? _perturbCtxGap(ctx0, cfg, d.pos, mat, deltaNm)
            : _perturbCtxIntra(ctx0, cfg, d, mat, deltaNm);
        const term = squaredTerm(op, evaluateOperandRows(operands, ctx, [i])[i], sigma);
        d.num += term === Infinity ? Infinity : (term - base) / (2 * deltaNm);
    }
}
