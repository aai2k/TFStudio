/**
 * Pick the best seed by refining each candidate and comparing merit.
 *
 * @param {Array}    seeds      from generateARSeeds()
 * @param {Function} refineFn   (design) → { mf, design }  (caller supplies the
 *                              production refiner — worker seedDls or makeEngine)
 * @returns {{ best, ranked }}  best = lowest-MF refined seed; ranked = all,
 *                              ascending MF, each { ...seed, mf, refinedDesign }.
 */
export function rankSeeds(seeds, refineFn) {
    const ranked = (seeds || []).map(seed => {
        const r = refineFn(seed.design);
        return { ...seed, mf: r.mf, refinedDesign: r.design };
    }).sort((a, b) => a.mf - b.mf);
    return { best: ranked[0] || null, ranked };
}
