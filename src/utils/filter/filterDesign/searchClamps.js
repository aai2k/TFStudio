/**
 * Bounds the integer search moves within. They are also the range the step-4
 * prototype table and its input fields may offer: a row outside them would be
 * clamped the moment the search started, so the design the user picked and the
 * one the search ran would differ with nothing on screen to say so.
 */
export const MIRROR_BOUNDS = { min: 1, max: 41 };
export const ORDER_BOUNDS = { min: 1, max: 400 };

/** Build a mirror-layer-count clamp: rounds and bounds to [minMirror,maxMirror]. */
export function makeClampMirror(minMirror, maxMirror) {
    return (g) => Math.max(minMirror, Math.min(maxMirror, Math.round(g)));
}

/** Build a spacer-order clamp: rounds and bounds to [minOrder,maxOrder]. */
export function makeClampOrder(minOrder, maxOrder) {
    return (s) => Math.max(minOrder, Math.min(maxOrder, Math.round(s)));
}
