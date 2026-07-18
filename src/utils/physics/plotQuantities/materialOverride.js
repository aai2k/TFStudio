// n / k sweeps replace a layer with a NON-dispersive constant-index material
// (the un-swept member of the n,k pair is taken from the layer's nominal value
// at the probe λ for optical, or at 550 nm for MF). This is an explicit
// what-if — the real material's dispersion is bypassed for the swept layer only.

/** A constant-index ("what-if") pseudo-material: getNK returns [n,k] for all λ. */
function constMaterial(n, k) {
    const nk = [n, k];
    return { name: `n=${n.toFixed(3)} k=${k.toFixed(3)}`, getNK: () => nk };
}

/** Apply n/k overrides to a resolved material, sampling un-swept member at λ. */
export function overrideMaterial(baseMat, ov, refLambda) {
    if (ov.n == null && ov.k == null) return baseMat;
    const nk0 = baseMat.getNK(refLambda);
    const n = ov.n != null ? ov.n : nk0[0];
    const k = ov.k != null ? ov.k : nk0[1];
    return constMaterial(n, k);
}
