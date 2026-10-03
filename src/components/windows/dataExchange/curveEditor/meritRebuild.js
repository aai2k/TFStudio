/**
 * Merit blocks built from a curve, and rebuilding them after the curve's
 * points have changed.
 *
 * A measured block is a snapshot of its curve, so a curve edited afterwards
 * and its target would disagree with nothing to show it. A rebuild runs the
 * block back through the Fit dialog's own builder, measuredFitSnapshot or its
 * ellipsometric twin, with the settings the block was made with: its grid,
 * its range, its weight and its channel, a block fitted in dB staying in dB.
 * It keeps its id, its enabled switch and what the curve does not hold: a free
 * level, and the Ψ/Δ pair a block saved with one belongs to. The material clip
 * is not applied again: the block's range is already the one that was decided.
 */
import { measuredCurveSpacing } from '../../../../utils/io/spectrumTable.js';
import { isMeasuredCurve } from '../../../../utils/physics/optimizer.js';
import { ellipsometryFitSnapshot } from '../measuredEllipsometry/fitModel.js';
import { measuredFitSnapshot } from '../spectrumExchange/model.js';

/** The measured blocks in the design's merit function built from curve `curveId`. */
export function curveBlocks(design, curveId) {
    return (design?.meritOperands || []).filter(op => isMeasuredCurve(op.type) && op.curveId === curveId);
}

/**
 * The Fit dialog settings a block was made with. A block stores its grid and
 * range; a uniform step is the spacing of its own points, and a thinning is
 * that spacing over the spacing of the curve it was thinned from.
 */
export function blockFitOptions(block) {
    const spacing = measuredCurveSpacing({ x: block.sampleLambdas || [], y: block.sampleTargets || [] });
    const options = {
        mode: block.gridMode || 'measured',
        rangeMin: block.lambdaStart,
        rangeMax: block.lambdaEnd,
        weight: block.weight,
        scale: block.quantity === 'TDB' ? 'dB' : 'linear',
        clipToCoverage: false,
    };
    if (spacing) options.stepNm = spacing;
    if (spacing && block.sourceSpacingNm > 0) {
        options.thinEvery = Math.max(1, Math.round(spacing / block.sourceSpacingNm));
    }
    return options;
}

// The fields a block carries that its curve does not: a free level, written by
// the gain flattening wizard, and a Ψ/Δ pair id.
const BLOCK_OWN_FIELDS = ['levelFree', 'pairId'];
function blockOwnFields(op) {
    return Object.fromEntries(BLOCK_OWN_FIELDS.filter(key => op[key] != null).map(key => [key, op[key]]));
}

/**
 * The design's merit operands with every block built from `curve` rebuilt
 * from it, and how many were rebuilt and how many were left as they were
 * because the curve no longer yields a block on the same channel.
 */
export function rebuiltMeritOperands(design, curve, kind) {
    const snapshot = kind === 'ellipsometry' ? ellipsometryFitSnapshot : measuredFitSnapshot;
    let rebuilt = 0;
    let kept = 0;
    const meritOperands = (design.meritOperands || []).map(op => {
        if (!isMeasuredCurve(op.type) || op.curveId !== curve.id) return op;
        const { operand } = snapshot(design, curve, blockFitOptions(op));
        if (!operand || operand.quantity !== op.quantity) { kept++; return op; }
        rebuilt++;
        return { ...operand, ...blockOwnFields(op), id: op.id, enabled: op.enabled !== false };
    });
    return { meritOperands, rebuilt, kept };
}
