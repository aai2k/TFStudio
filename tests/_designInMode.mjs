/**
 * `design` with the fields that make the app score it in `mode`: 'front' or
 * 'back' for that face alone, 'total' for the whole part. An analysis window
 * reads the mode off the design it shows (resolveEvalMode), as the app's
 * DesignContext does, so a test draws a window in a mode by giving the design
 * that mode rather than the context alone.
 */
export function designInMode(design, mode) {
    if (mode === 'total') return { ...design, mfEvalMode: 'total' };
    return { ...design, surfaceMode: mode === 'back' ? 'back_only' : 'front_only', mfEvalMode: 'side' };
}
