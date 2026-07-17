import { cleanupDesign } from '../../../../utils/synthesis/designCleaner.js';
import {
    DLSOptimizer,
    evaluateOperands,
    calcMF,
    buildEvalContext,
} from '../../../../utils/physics/optimizer.js';

export function computeCleanupPreview(design, opts) {
    if (!design?.frontLayers) return null;
    return cleanupDesign(design, opts);
}

// Merit-function value of a design tree, or null if there is nothing to
// score against (no operands) or the evaluation throws.
export function computeMeritValue(targetDesign, meritOperands, resolveMat) {
    if (!targetDesign || !meritOperands?.length) return null;
    try {
        const ctx = buildEvalContext(targetDesign, resolveMat);
        return calcMF(meritOperands, evaluateOperands(meritOperands, ctx));
    } catch {
        return null;
    }
}

// Runs the optional post-clean DLS refinement pass and builds the applied
// result message. Never touches app/undo state directly.
export function applyCleanup(preview, design, dc, { reoptimize, reoptIters, dMin }, resolveMat) {
    let nextDesign = preview.design;
    let refineMfBefore = null, refineMfAfter = null;

    if (reoptimize && design.meritOperands?.length) {
        try {
            const opt = new DLSOptimizer(
                design.meritOperands, nextDesign, resolveMat,
                { dMin: Math.max(dMin, 1.0) }
            );
            refineMfBefore = opt.mf;
            const iters = Math.max(1, Math.min(500, reoptIters));
            for (let i = 0; i < iters && !opt.isConverged(); i++) opt.step();
            opt.restoreBest();
            nextDesign = opt.applyToDesign(nextDesign);
            refineMfAfter = opt.mfBest;
        } catch (e) {
            console.error('[Cleaner] post-clean DLS failed', e);
        }
    }

    let msg = dc.appliedMsg(preview.removedCount, preview.mergedCount);
    if (refineMfAfter != null && refineMfBefore != null) {
        msg += `  •  ${dc.mfRefineMsg(refineMfBefore, refineMfAfter)}`;
    }
    return { nextDesign, msg };
}
