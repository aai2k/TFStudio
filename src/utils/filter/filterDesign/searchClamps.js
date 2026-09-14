/** Build a mirror-layer-count clamp: rounds and bounds to [minMirror,maxMirror]. */
export function makeClampMirror(minMirror, maxMirror) {
    return (g) => Math.max(minMirror, Math.min(maxMirror, Math.round(g)));
}

/** Build a spacer-order clamp: rounds and bounds to [minOrder,maxOrder]. */
export function makeClampOrder(minOrder, maxOrder) {
    return (s) => Math.max(minOrder, Math.min(maxOrder, Math.round(s)));
}
