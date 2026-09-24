/**
 * Intra-layer needle candidates reduced to the minima of the needle function.
 *
 * The needle method inserts a needle where the needle function P has its
 * minimum (Tikhonravov, Trubetskov & DeBell, Appl. Opt. 35, 5493 (1996)).
 * A scan samples P at evenly spaced positions inside every layer; with more
 * than a few samples, neighbouring positions on one slope of the same minimum
 * all show up as improving candidates, and a synthesis that refines the best K
 * candidates then spends its batch on near copies of one insertion. Kept here
 * per layer, material and side: each sample whose predicted merit change dMF
 * is no higher than that of the samples on either side of it. Gap candidates
 * pass through unchanged.
 */
export function intraMinima(candidates) {
    const out = candidates.filter(c => !c.intra);
    const groups = new Map();
    for (const c of candidates.filter(x => x.intra)) {
        const key = `${c.side}|${c.layerK}|${c.materialId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    for (const g of groups.values()) out.push(...localMinima(g));
    return out;
}

// The samples of one layer, ordered by position, whose dMF is no higher than
// that of either neighbour.
function localMinima(samples) {
    const g = [...samples].sort((a, b) => a.frac - b.frac);
    const dMF = i => (i >= 0 && i < g.length ? g[i].dMF : Infinity);
    return g.filter((c, i) => c.dMF <= dMF(i - 1) && c.dMF <= dMF(i + 1));
}
