/** Build a mirror-layer-count clamp: rounds to nearest odd, then bounds to [minMirror,maxMirror]. */
export function makeClampMirror(minMirror, maxMirror) {
    return (g) => {
        let v = Math.round(g);
        if (v % 2 === 0) v += 1;             // keep odd
        return Math.max(minMirror, Math.min(maxMirror, v));
    };
}

/** Build a spacer-order clamp: rounds and bounds to [minOrder,maxOrder]. */
export function makeClampOrder(minOrder, maxOrder) {
    return (s) => Math.max(minOrder, Math.min(maxOrder, Math.round(s)));
}
