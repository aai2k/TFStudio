// The merit function as the Merit Function Editor shows it: each row's value
// and error, the band levels, and the total and optical merit.

import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    evaluateOperands, calcMF, calcOMF, buildEvalContext, operandEvaluationErrors,
    operandBandLevels, withFringeSampleCounts, withDesignSampleCounts, makeConeSpec, coneIsActive,
} from './optimizer.js';

function displayOf(operands, computed) {
    const errors = operandEvaluationErrors(computed);
    const invalid = errors.some(Boolean);
    return {
        computed: Array.from(computed), errors, bandLevels: operandBandLevels(computed),
        mf: invalid ? null : calcMF(operands, computed),
        omf: invalid ? null : calcOMF(operands, computed),
    };
}

/** The rows of `operands` on `design`, as given (the analysis worker's evaluation). */
export function meritDisplay(design, operands) {
    return displayOf(operands, evaluateOperands(operands, buildEvalContext(design, designMaterialLookup(design))));
}

/**
 * The rows of `operands` on `design` with band operands sampled for the
 * design's fringes, the grid a run launched from that design would use, so
 * the table shows each band's true value.
 */
export function evaluateForDisplay(design, operands) {
    const ctx = buildEvalContext(design, designMaterialLookup(design));
    const sampled = withFringeSampleCounts(operands, ctx);
    const computed = evaluateOperands(sampled, ctx);
    return { ...displayOf(sampled, computed), computed };
}

/**
 * What the Merit Function Editor shows for `design`: under a cone of
 * incidence the analysis worker's evaluation with the band sample counts the
 * editor sends it (useMeritOperands.js), otherwise evaluateForDisplay.
 */
export function meritTable(design, operands) {
    if (coneIsActive(makeConeSpec(design.cone || {}))) {
        return meritDisplay(design, withDesignSampleCounts(operands, design, designMaterialLookup(design)));
    }
    return evaluateForDisplay(design, operands);
}

