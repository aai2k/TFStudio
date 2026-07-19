/**
 * Analytic-scan insertion descriptors and candidate assembly.
 *
 * A descriptor names one trial insertion (gap or intra) plus the accumulating
 * gradient numerator `num`; after accumulation it becomes a candidate in the
 * scanNeedlesPFunction contract.
 */

// Candidate descriptors (gaps then intra) on the chosen side.
export function _buildDescriptors(N, candidateMats, targetLayers, fracs) {
    const descs = [];
    for (let pos = 0; pos <= N; pos++)
        for (let ci = 0; ci < candidateMats.length; ci++)
            descs.push({ kind: 'gap', pos, ci, num: 0 });
    for (let k = 0; k < N; k++)
        for (let fi = 0; fi < fracs.length; fi++)
            for (let ci = 0; ci < candidateMats.length; ci++) {
                if (candidateMats[ci].id === targetLayers[k].material) continue;  // host → ~0
                descs.push({ kind: 'intra', k, fi, frac: fracs[fi], ci, num: 0 });
            }
    return descs;
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
