/**
 * Finding the interference fringes in a measured curve.
 *
 * The envelope method needs the turning points of the transmittance and
 * nothing else, so the whole job here is to separate real fringes from the
 * ripple a photometric measurement always carries.
 */

// How shallow a ripple may be, against the deepest fringe in the same curve,
// and still be treated as a fringe.
//
// Real measurements ripple. At the 0.1% a careful photometric measurement
// reaches, a fringe pattern with six extrema in it has hundreds of turning
// points, nearly all of them noise, and a pair of them two nanometres apart
// implies a film tens of micrometres thick. Interference fringes in one
// spectrum are all of comparable depth, while noise ripples are orders of
// magnitude shallower, so the cut goes at a fraction of the deepest fringe and
// its exact value is not critical.
//
// It is set to prune rather than to keep. Losing a real but shallow fringe
// costs one point of the envelope, and the thickness still comes from the
// others; keeping a false one costs the thickness outright.
const FRINGE_DEPTH_FRACTION = 0.1;

/**
 * Turning points of a curve, alternating maximum and minimum.
 *
 * Detection is by sign change of the forward difference, with no smoothing, so
 * the wavelength of each extremum stays exactly where the data puts it. A flat
 * top reports its midpoint.
 */
export function alternatingExtrema(lambdas, values) {
    const extrema = [];
    let direction = 0;
    for (let index = 1; index < values.length; index++) {
        const delta = values[index] - values[index - 1];
        if (delta === 0) continue;
        const next = delta > 0 ? 1 : -1;
        if (direction !== 0 && next !== direction) {
            let start = index - 1;
            while (start > 0 && values[start - 1] === values[index - 1]) start--;
            const at = Math.floor((start + index - 1) / 2);
            extrema.push({
                index: at,
                lambda: lambdas[at],
                value: values[at],
                kind: direction > 0 ? 'max' : 'min',
            });
        }
        direction = next;
    }
    return extrema;
}

/** Consecutive turning points of the same kind reduced to the most extreme. */
function collapseAlternation(extrema) {
    const kept = [];
    for (const item of extrema) {
        const last = kept[kept.length - 1];
        if (!last || last.kind !== item.kind) { kept.push(item); continue; }
        const deeper = item.kind === 'max' ? item.value > last.value : item.value < last.value;
        if (deeper) kept[kept.length - 1] = item;
    }
    return kept;
}

/**
 * Drop the shallowest turning point pair, over and over, until every remaining
 * one is a fringe.
 *
 * Removing a pair can leave two neighbours of the same kind, which then collapse
 * to the deeper of the two, so a whole run of ripples inside one fringe
 * disappears into that fringe rather than surviving as a shallower one.
 */
export function significantExtrema(extrema) {
    let kept = collapseAlternation(extrema);
    if (kept.length < 2) return kept;
    const contrastAt = (list, index) => Math.abs(list[index].value - list[index + 1].value);
    const deepest = Math.max(...kept.map((_, index) =>
        index + 1 < kept.length ? contrastAt(kept, index) : 0));
    const minimum = deepest * FRINGE_DEPTH_FRACTION;
    while (kept.length >= 2) {
        let at = -1;
        let shallowest = Infinity;
        for (let index = 0; index + 1 < kept.length; index++) {
            const contrast = contrastAt(kept, index);
            if (contrast < shallowest) { shallowest = contrast; at = index; }
        }
        if (at < 0 || shallowest >= minimum) break;
        kept.splice(at, 2);
        kept = collapseAlternation(kept);
    }
    return kept;
}
