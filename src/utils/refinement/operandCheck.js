// Merit operands evaluated on a design, for the merit table and for the check
// a run makes before it starts.

import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    withFringeSampleCounts, buildEvalContext, evaluateOperands, calcMF, calcOMF,
    operandEvaluationErrors,
} from '../physics/optimizer.js';

// Returns { computed, errors, mf, omf }, or null if evaluation throws.
// Empty/absent design → cleared display. Band operands are sampled for this
// design's fringes, the grid a run launched from it would use.
export function computeOperandDisplay(design, operands) {
    if (!design || operands.length === 0) return { computed: [], mf: null, omf: null };
    try {
        const ctx  = buildEvalContext(design, designMaterialLookup(design));
        const sampled = withFringeSampleCounts(operands, ctx);
        const comp = evaluateOperands(sampled, ctx);
        const errors = operandEvaluationErrors(comp);
        const invalid = errors.some(Boolean);
        return {
            computed: comp, errors,
            mf: invalid ? null : calcMF(sampled, comp),
            omf: invalid ? null : calcOMF(sampled, comp),
        };
    } catch (_) {
        return null;
    }
}

// The first row that cannot be evaluated, as 'Row N TYPE: reason', or null.
export function firstOperandErrorMessage(operands, errors) {
    const index = (errors || []).findIndex(Boolean);
    if (index < 0) return null;
    return `Row ${index + 1} ${operands[index]?.type || ''}: ${errors[index]}`;
}
