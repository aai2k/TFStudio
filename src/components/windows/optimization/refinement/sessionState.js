import { createWindowSession } from '../../windowSession.js';

// Reset/Best baseline, the run history and the last run's readout for one
// design. The live optimizer is not kept: it cannot be serialised, so Reset
// restores the saved baseline and undo returns to the checkpoint pushed when the
// run started.
export const refinementSession = createWindowSession({
    savedDesign: null,
    histEntries: [],
    histRunCount: 0,
    // Iterations, end reason, merit trend, best and initial merit, and the
    // layers Best applies; null before the design's first run.
    lastRun: null,
}, { scope: 'design' });

/** Values held for `designId`, or the defaults when there is no design. */
export function readRefinement(designId) {
    return designId ? refinementSession.read({ id: designId }) : null;
}

export function writeRefinement(designId, patch) {
    if (designId) refinementSession.write({ id: designId }, patch);
}

export function clearRefinement(designId) {
    if (designId) refinementSession.reset({ id: designId });
}
