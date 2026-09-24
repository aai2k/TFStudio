/**
 * Analytic-scan insertion descriptors and candidate assembly.
 *
 * A descriptor names one trial insertion (gap or intra) plus the accumulating
 * gradient numerator `num`; after accumulation it becomes a candidate in the
 * scanNeedlesPFunction contract.
 */

// Whether splitting a host of thickness `dk` (nm) at `frac` leaves both halves
// at least `dMin` thick. A split that leaves a half below the floor is not a
// position the synthesis can use: the refiner would lift that half to dMin
// before it could score the needle. The relative 1e-12 absorbs the rounding in
// frac·dk, so a split landing exactly on the floor is kept.
export function intraSplitFits(dk, frac, dMin) {
    if (!(dMin > 0)) return true;
    const floor = dMin * (1 - 1e-12);
    return frac * dk >= floor && (1 - frac) * dk >= floor;
}

// Candidate descriptors (gaps then intra) on the chosen side. Intra positions
// whose split would leave a half thinner than `dMin` (nm) are left out.
export function _buildDescriptors(N, candidateMats, targetLayers, fracs, dMin = 0) {
    const descs = [];
    for (let pos = 0; pos <= N; pos++)
        for (let ci = 0; ci < candidateMats.length; ci++)
            descs.push({ kind: 'gap', pos, ci, num: 0 });
    for (let k = 0; k < N; k++) _pushIntra(descs, { k, host: targetLayers[k], candidateMats, fracs, dMin });
    return descs;
}

// Intra descriptors of host layer k: every split that fits, with every
// candidate material other than the host's own (that insertion changes ~0).
function _pushIntra(descs, { k, host, candidateMats, fracs, dMin }) {
    fracs.forEach((frac, fi) => {
        if (!intraSplitFits(host.thickness || 0, frac, dMin)) return;
        candidateMats.forEach((m, ci) => {
            if (m.id !== host.material) descs.push({ kind: 'intra', k, fi, frac, ci, num: 0 });
        });
    });
}

// Turn the accumulated per-descriptor numerators into the candidate contract.
// `out` bundles { mf0, sumW, deltaNm, side }.
export function _buildCandidates(descs, candidateMats, out) {
    const { mf0, sumW, deltaNm, side } = out;
    const invF = 1 / (mf0 * sumW);
    return descs.map(d => {
        const grad = d.num * invF;                            // dF/dd  (P₁)
        const base = { materialId: candidateMats[d.ci].id, dMF: grad * deltaNm, grad, side };
        return d.kind === 'gap'
            ? { ...base, pos: d.pos }
            : { ...base, pos: d.k + d.frac, intra: true, layerK: d.k, frac: d.frac };
    });
}
