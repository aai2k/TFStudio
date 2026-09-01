/**
 * Whether the evaluation mode a window is drawing in has any layers to draw.
 *
 * A design can carry layers on one side only, so "the design has layers" and
 * "this evaluation has layers" are different questions: a front-only stack read
 * in back mode evaluates a bare substrate, which is a valid spectrum but not
 * what the window was opened to show. Windows that key their empty state off
 * this ask the second question.
 */
export function hasLayersForMode(design, evalMode) {
    const hasFront = !!design?.frontLayers?.length;
    const hasBack = !!design?.backLayers?.length;
    if (evalMode === 'back') return hasBack;
    if (evalMode === 'front') return hasFront;
    return hasFront || hasBack;
}
