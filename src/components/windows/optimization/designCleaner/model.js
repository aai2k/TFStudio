import { cleanupDesign } from '../../../../utils/synthesis/designCleaner.js';
import { DEFAULT_REFINE_METHOD } from '../../../../utils/optimizers/index.js';
import { densifyForRun } from '../../../../utils/refinement/workerInputs.js';
import { refineOffThread, refineInTicks } from '../synthesisShared/workerRefine.js';

/**
 * Whether the window offers a choice of side: on a design with layers on both
 * sides that is not symmetric, whose back mirrors its front. On any other
 * design it cleans whichever side has layers.
 */
export function offersSide(design) {
    return design?.surfaceMode !== 'symmetric'
        && (design?.frontLayers?.length ?? 0) > 0 && (design?.backLayers?.length ?? 0) > 0;
}

export function computeCleanupPreview(design, opts) {
    if (!design?.frontLayers) return null;
    return cleanupDesign(design, opts);
}

// The post-clean refinement: the chosen refiner, the app's default unless one
// is set, on the cleaned stack, its merit rows sampled as a Refinement run
// samples them at launch, so a feature narrower than a row's grid is seen, the
// step budget clamped to 1..500 and the thickness floor to at least 1 nm.
function refineJob(cleaned, design, { reoptIters, dMin, reoptMethod }) {
    return {
        method: reoptMethod || DEFAULT_REFINE_METHOD,
        operands: densifyForRun(design.meritOperands, cleaned),
        design: cleaned,
        iters: Math.max(1, Math.min(500, reoptIters)),
        dMin: Math.max(dMin, 1.0),
    };
}

// Runs the optional post-clean refinement pass, with `reoptMethod` or the app's
// default refiner, and builds the applied result message. Never touches app/undo state directly.
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
            const job = refineJob(nextDesign, design, settings);
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
