/**
 * Which thicknesses are tried, and which of them earn a full model fit.
 *
 * The scan brackets whichever first thickness there is, from the fringe
 * envelope or from the operator, and the pointwise extraction runs at every
 * point of it. Fitting a dispersion model at each point costs far more than
 * the extraction does, so only a shortlist of them gets that far.
 */

// Thicknesses tried around the envelope's value. The envelope has already
// pinned the interference order, so this only has to cover the error in it.
const SCAN_SPAN = 0.2;
const SCAN_STEPS = 24;
// Thicknesses tried when the envelope found no fringes and the operator gave an
// approximate value instead. Wider, because nothing has pinned anything.
const BLIND_SPAN = 0.5;
const BLIND_STEPS = 40;
// Trial thicknesses carried through to a full model fit. The roughness ranking
// is a good guide, not a decision, so the best few are each fitted properly and
// compared on the residual that actually matters.
//
// They are taken one per basin (see roughnessBasins). Roughness dips once per
// interference order, and the scan spans half the entered thickness either way,
// so a film with fringes in the measured range offers a handful of basins and
// this covers them.
const REFINED_CANDIDATES = 8;
// Scan points nearest the entered thickness, tried alongside the basins. Enough
// to cover the grid step either side of it, so a value entered between two
// points is not missed by rounding.
const NEAR_ENTERED_CANDIDATES = 3;
// A metal's scan has no basins to spread over, so it keeps the smoothest few
// and leans harder on the thickness the operator entered.
const METAL_CANDIDATES = 3;
const METAL_NEAR_ENTERED = 5;

function thicknessCandidates(centreNm, span, steps) {
    const candidates = [];
    for (let step = 0; step <= steps; step++) {
        candidates.push(centreNm * (1 - span + (2 * span * step) / steps));
    }
    return candidates.filter(value => value > 0);
}

/**
 * The trial thicknesses the scan runs over, or an error naming what stopped it.
 *
 * With fringes the envelope has already pinned the interference order and the
 * scan only has to cover the error in it. Without them the operator's estimate
 * is all there is, so the scan is wider. With neither, the measurement holds no
 * thickness at all: n and d enter it almost entirely as the product n·d, and
 * saying so beats returning one of the infinitely many pairs that fit.
 */
export function scanThicknesses({ fixThickness, thicknessNm, envelope }) {
    if (fixThickness) {
        return Number.isFinite(thicknessNm) && thicknessNm > 0
            ? { candidates: [thicknessNm] }
            : { error: 'noThickness' };
    }
    if (envelope && !envelope.error) {
        return { candidates: thicknessCandidates(envelope.thicknessNm, SCAN_SPAN, SCAN_STEPS) };
    }
    if (Number.isFinite(thicknessNm) && thicknessNm > 0) {
        return { candidates: thicknessCandidates(thicknessNm, BLIND_SPAN, BLIND_STEPS) };
    }
    return { error: 'thicknessUndetermined' };
}

/**
 * One trial thickness from each basin of the roughness scan, smoothest first.
 *
 * Roughness dips near every thickness that puts the fringes in about the right
 * place, once per interference order, and rises between them. Its few smallest
 * values are therefore neighbouring points inside whichever dip is deepest, and
 * ranking on them alone spends every model fit on one interference order while
 * the rest of the scan is never tried. The deepest dip is not reliably the
 * right one: the extracted index is smooth at any thickness that keeps a point
 * on one branch, whether or not that branch is the film.
 *
 * Taking each dip's own minimum spends the same number of fits on thicknesses
 * an order apart, and the measured residual then decides between them, which is
 * the comparison that can tell interference orders apart.
 */
function roughnessBasins(scanned, limit) {
    const byThickness = [...scanned].sort((left, right) => left.thicknessNm - right.thicknessNm);
    return byThickness
        .filter((entry, index) =>
            (index === 0 || byThickness[index - 1].roughness > entry.roughness)
            && (index === byThickness.length - 1 || byThickness[index + 1].roughness >= entry.roughness))
        .sort((left, right) => left.roughness - right.roughness)
        .slice(0, limit);
}

/**
 * The trial thicknesses one seed contributes to the shortlist.
 *
 * Basins are interference orders, and a metal spectrum has none: over the range
 * where a metal film is worth measuring it absorbs rather than interferes, so
 * its roughness scan holds one broad trend instead of a dip per order. A metal
 * is ranked on the smoothest few instead.
 *
 * Either way the thicknesses nearest the entered value are added. The
 * operator's estimate is evidence in its own right and the search bracket was
 * built around it, but roughness need not dip anywhere near it, so it is tried
 * whether or not it is a basin and the measured residual decides.
 */
export function shortlistForSeed(scanned, { fixThickness, metallic, enteredNm }) {
    const ranked = [...scanned].sort((left, right) => left.roughness - right.roughness);
    if (ranked.length === 0) return [];
    if (fixThickness) return ranked.slice(0, 1);
    const selected = metallic
        ? ranked.slice(0, METAL_CANDIDATES)
        : roughnessBasins(ranked, REFINED_CANDIDATES);
    if (!Number.isFinite(enteredNm) || !(enteredNm > 0)) return selected;
    const nearEntered = [...ranked]
        .sort((left, right) => Math.abs(left.thicknessNm - enteredNm)
            - Math.abs(right.thicknessNm - enteredNm))
        .slice(0, metallic ? METAL_NEAR_ENTERED : NEAR_ENTERED_CANDIDATES);
    for (const entry of nearEntered) if (!selected.includes(entry)) selected.push(entry);
    return selected;
}
