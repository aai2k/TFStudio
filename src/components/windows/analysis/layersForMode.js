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

/**
 * What a window shows in place of its result when the sides it computes have
 * no layers, or null when they have some. A design coated on the other side
 * alone is told which side is bare, since "no layers" would not be true of it.
 */
export function noLayersMessage(design, evalMode, t) {
    if (hasLayersForMode(design, evalMode)) return null;
    const empty = t.analysisChrome;
    if (evalMode === 'back' && design?.frontLayers?.length) return empty.noBackLayers;
    if (evalMode === 'front' && design?.backLayers?.length) return empty.noFrontLayers;
    return empty.noLayers;
}
