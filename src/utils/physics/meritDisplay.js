// The merit function as the Merit Function Editor shows it: each row's value
// and error, the band levels, and the total and optical merit.

import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    evaluateOperands, calcMF, calcOMF, buildEvalContext, operandEvaluationErrors,
    operandBandLevels, withFringeSampleCounts, withDesignSampleCounts, makeConeSpec, coneIsActive,
    takesStepFlag, isBandGridRow, bandFlagStepNm, extremumFlag, isMath, withRowNotes,
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
 * A meritDisplay result copied back from the analysis worker, its values again
 * carrying the rows' errors and band levels (withRowNotes), which the copy
 * drops, so the share column and the band levels read from them as from an
 * evaluation on the window's thread.
 */
export function receivedDisplay(display) {
    return { ...display, computed: withRowNotes(Array.from(display.computed), display.errors, display.bandLevels) };
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
 * Whether a row's Step reads its band otherwise than its default step does,
 * by the rule a Specification check follows (qualifiers hasOwnStep): a band
 * row with any Step, its default being the design's fringe grid, or a peak row
 * finer than 1 nm.
 */
export function rowHasOwnStep(op) {
    if (!takesStepFlag(op)) return false;
    return isBandGridRow(op.type) ? bandFlagStepNm(op) != null : extremumFlag(op) > 1;
}

// An enabled row with a Step of its own. A disabled row has no value at any step.
const readsOwnStep = op => op.enabled !== false && rowHasOwnStep(op);

/**
 * `operands` with every enabled row of a Step of its own (rowHasOwnStep) at its
 * default step, or `operands` itself when there is none. A peak row then
 * searches at 1 nm and a band row on the design's fringe grid, which takes
 * milliseconds where a fine Step over a wide band takes seconds.
 */
export function atDefaultSteps(operands) {
    if (!operands.some(readsOwnStep)) return operands;
    return operands.map(op => (readsOwnStep(op) ? { ...op, flag: null } : op));
}

// An enabled math row reading a row in `changed`.
const readsChanged = (op, changed) => op.enabled !== false && isMath(op.type)
    && [op.refId, op.refId1, op.refId2].some(id => id && changed.has(id));

/**
 * For each row, whether atDefaultSteps changes its value: an enabled row with a
 * Step of its own, or an enabled math row reading one, directly or through
 * other math rows. Null when no row has a Step of its own.
 */
export function provisionalRows(operands) {
    if (!operands.some(readsOwnStep)) return null;
    const changed = new Set(operands.filter(readsOwnStep).map(op => op.id));
    let size;
    do {
        size = changed.size;
        for (const op of operands) if (readsChanged(op, changed)) changed.add(op.id);
    } while (changed.size !== size);
    return operands.map(op => changed.has(op.id));
}

/** Whether the MF and OMF can change with the rows `marks` (provisionalRows) marks: one of them has a weight. */
export function provisionalMerit(operands, marks) {
    return !!marks?.some((marked, i) => marked && operands[i].weight > 0);
}

/**
 * What the Merit Function Editor shows for `design` once every row is read at
 * its own Step: under a cone of incidence the analysis worker's evaluation
 * with the band sample counts the editor sends it (useMeritValues.js),
 * otherwise evaluateForDisplay.
 */
export function meritTable(design, operands) {
    if (coneIsActive(makeConeSpec(design.cone || {}))) {
        return meritDisplay(design, withDesignSampleCounts(operands, design, designMaterialLookup(design)));
    }
    return evaluateForDisplay(design, operands);
}

