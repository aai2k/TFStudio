/**
 * Fit targets whose curve is not on the design, and the curves rebuilt from them.
 *
 * A merit function saved as a preset carries its measured blocks but not the
 * curves they were generated from, so loading one into another design leaves
 * blocks that still score correctly, from their own snapshot, with nothing in
 * the curve list to look at. Deleting a curve and keeping its block does the
 * same. Each block holds everything a curve needs, so it can be given back.
 *
 * A photometric block goes back to the spectrum list and an ellipsometric one
 * to the Ψ/Δ list. Each import window names the list it owns and which blocks
 * belong to it.
 */
import { makeMeasuredCurve, X_UNITS } from '../../../utils/io/spectrumTable.js';
import { isMeasuredCurve } from '../../../utils/physics/optimizer.js';

/** Fit blocks that belong to `listKey` and whose curve is not in that list. */
export function orphanFitBlocksIn(design, listKey, belongs) {
    const known = new Set((design?.[listKey] || []).map(curve => curve.id));
    return (design?.meritOperands || []).filter(
        operand => isMeasuredCurve(operand.type)
            && belongs(operand)
            && operand.sampleLambdas?.length
            && !known.has(operand.curveId),
    );
}

/** The curve a fit block was generated from, rebuilt from its snapshot. */
export function curveFromFitBlock(block) {
    return makeMeasuredCurve({
        name: block.curveName || 'Measured curve',
        x: block.sampleLambdas,
        xUnit: X_UNITS.NM,
        y: block.sampleTargets,
        quantity: block.quantity || 'R',
        aoi: block.aoi ?? 0,
        pol: block.pol || 'avg',
        side: block.side || 'front',
        deltaConvention: block.deltaConvention,
        source: 'fit target',
    });
}

/**
 * Restore the curves for every orphaned block of `listKey`, and point each
 * block at the curve it now has, so restoring twice cannot make a second copy.
 */
export function restoredFitCurvesIn(design, listKey, belongs) {
    const orphans = orphanFitBlocksIn(design, listKey, belongs);
    if (!orphans.length) return null;
    const curveByBlockId = new Map(orphans.map(block => [block.id, curveFromFitBlock(block)]));
    return {
        [listKey]: [...(design[listKey] || []), ...curveByBlockId.values()],
        meritOperands: (design.meritOperands || []).map(operand => (
            curveByBlockId.has(operand.id)
                ? { ...operand, curveId: curveByBlockId.get(operand.id).id }
                : operand
        )),
    };
}
