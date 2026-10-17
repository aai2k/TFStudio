/**
 * Analytic Jacobian rows of the math rows (OPGT, OPLT, OPVA, ABSO, ABGT, ABLT,
 * DIFF, SUMM, PROD), by the chain rule through the rows they read.
 *
 * A math row's residual is √w·ρ(V)/σ, with V = f(V₁[, V₂]) its value, ρ its
 * miss against the target (one-sided for OPGT, OPLT, ABGT, ABLT) and σ the unit
 * scale of the rows it reads (evalCore/residualScale.js). Its Jacobian row is
 *
 *     √w·ρ'(V)/σ · Σₖ (∂f/∂Vₖ)·∂Vₖ/∂d
 *
 * where ∂Vₖ/∂d is the slope of the value of the row read, not of that row's
 * residual: the math row reads the value whatever the row itself scores, so
 * the row's own weight (often 0), σ and one-sided clipping stay out of it. A
 * row read through another math row follows the chain. The slopes come from
 * `slopeOf(op, index, jc)` (jacRows.js), which is null for a kind with no
 * slope, and a null anywhere on the chain declines the whole Jacobian.
 */

import { isInequality } from '../operandModel.js';
import { mathReferenceIds, mathResidualSlope, mathValuePartials } from '../evalCore/mathOperands.js';

// Row index of each id, the last row holding an id winning, as the reference
// resolver finds it (evalCore/evalContext.js). Built on the first math row of
// a Jacobian; a merit without math rows never needs it.
function rowIndexOf(jc, id) {
    jc.rowIndexById ??= new Map(jc.operands.map((row, index) => [row.id, index]));
    return jc.rowIndexById.get(id);
}

/**
 * Indices in jc.operands of the rows math row `op` reads, or null where its
 * value has nothing to chain through: a reference to no row, or an OPGT or
 * OPLT saved before references existed, which is evaluated as a virtual row
 * of its baseType whose extremum wavelength and sample deviations the
 * evaluation does not keep.
 */
export function mathReadIndices(op, jc) {
    if (isInequality(op.type) && !op.refId && op.baseType) return null;
    const indices = mathReferenceIds(op).map(id => rowIndexOf(jc, id));
    return indices.some(index => index === undefined) ? null : indices;
}

/** ∂V/∂d of math row i over the free variables, or null. */
export function mathValueSlope(op, i, jc, slopeOf) {
    const indices = mathReadIndices(op, jc);
    if (!indices) return null;
    const slopes = indices.map(index => slopeOf(jc.operands[index], index, jc));
    if (slopes.some(slope => !slope)) return null;
    const partials = mathValuePartials(op, indices.map(index => jc.comp[index]));
    const row = new Array(jc.nFree).fill(0);
    slopes.forEach((slope, k) => {
        for (let ci = 0; ci < jc.nFree; ci++) row[ci] += partials[k] * slope[ci];
    });
    return row;
}

/** The Jacobian row of math row i, or null where its chain has no slope. */
export function mathRow(op, i, jc, slopeOf) {
    const slope = slopeOf(op, i, jc);
    if (!slope) return null;
    const scale = Math.sqrt(op.weight) * mathResidualSlope(op, jc.comp[i]) / jc.residualScale(op);
    return slope.map(value => scale * value);
}
