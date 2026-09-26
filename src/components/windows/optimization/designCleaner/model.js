import { cleanupDesign } from '../../../../utils/synthesis/designCleaner.js';
import {
    evaluateOperands,
    calcMF,
    buildEvalContext,
    withFringeSampleCounts,
    withDesignSampleCounts,
} from '../../../../utils/physics/optimizer.js';
import { DEFAULT_REFINE_METHOD } from '../../../../utils/optimizers/index.js';
import { refineOffThread, refineInTicks } from '../synthesisShared/workerRefine.js';

export function computeCleanupPreview(design, opts) {
    if (!design?.frontLayers) return null;
    return cleanupDesign(design, opts);
}

// Merit-function value of a design tree, or null if there is nothing to
// score against (no operands) or the evaluation throws. Band operands are
// sampled for that design's fringes, as the merit table samples them.
export function computeMeritValue(targetDesign, meritOperands, resolveMat) {
    if (!targetDesign || !meritOperands?.length) return null;
    try {
        const ctx = buildEvalContext(targetDesign, resolveMat);
        const sampled = withFringeSampleCounts(meritOperands, ctx);
        return calcMF(sampled, evaluateOperands(sampled, ctx));
    } catch {
        return null;
    }
}

// The post-clean refinement: the app's default refiner on the cleaned stack,
// band operands sampled for its fringes, the step budget clamped to 1..500 and
// the thickness floor to at least 1 nm.
function refineJob(cleaned, design, { reoptIters, dMin }, resolveMat) {
    return {
        method: DEFAULT_REFINE_METHOD,
        operands: withDesignSampleCounts(design.meritOperands, cleaned, resolveMat),
        design: cleaned,
        iters: Math.max(1, Math.min(500, reoptIters)),
        dMin: Math.max(dMin, 1.0),
    };
}

// Runs the optional post-clean refinement pass, with the app's default refiner,
// and builds the applied result message. Never touches app/undo state directly.
// `inWorker` runs the pass in the optimizer worker, falling back to this thread
// when none starts. Aborting `signal` ends the pass early on the best point so
// far, or before the worker's first point with the cleaned design unrefined.
// `onProgress` gets { step, iters, mf }, mf the best merit so far. A
// refinement that throws leaves the cleaned design unrefined.
export async function applyCleanup(preview, design, dc, settings, resolveMat) {
    const { reoptimize, inWorker, signal, onProgress } = settings;
    let nextDesign = preview.design;
    let refined = null;

    if (reoptimize && design.meritOperands?.length) {
        try {
            const job = refineJob(nextDesign, design, settings, resolveMat);
            refined = inWorker
                ? await refineOffThread(job, resolveMat, { signal, onProgress })
                : await refineInTicks(job, resolveMat, { signal, onProgress });
            if (refined) nextDesign = refined.design;
        } catch (e) {
            console.error('[Cleaner] post-clean refinement failed', e);
        }
    }

    let msg = dc.appliedMsg(preview.removedCount, preview.mergedCount);
    if (refined) {
        msg += `  •  ${dc.mfRefineMsg(refined.mfInitial, refined.mfBest)}`;
    }
    return { nextDesign, msg };
}
