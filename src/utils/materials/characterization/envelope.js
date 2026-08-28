/**
 * Envelope extraction of a film's index, thickness and absorption from the
 * interference fringes in its transmittance.
 *
 * Reference: Macleod, Thin-Film Optical Filters, 5th ed., "Measurement of the
 * Optical Properties", Eq. 14.12 to 14.15. Writing n₀ = 1 reduces Eq. 14.15 to
 * the form published by Swanepoel, J. Phys. E 16, 1214 (1983), which is the
 * same method under its more common name.
 *
 * With T_max and T_min the two fringe envelopes at one wavelength,
 *
 *   N   = (n₀² + n_m²)/2 + 2 n₀ n_m (T_max − T_min)/(T_max T_min)     (14.15)
 *   n_f = [ N + (N² − n₀² n_m²)^½ ]^½
 *   α   = C₁[1 − (T_max/T_min)^½] / (C₂[1 + (T_max/T_min)^½])          (14.12)
 *   α   = exp(−4π k_f d_f / λ),   4π n_f d_f / λ = mπ                  (14.13)
 *
 * with C₁ = (n_f + n₀)(n_m + n_f) and C₂ = (n_f − n₀)(n_m − n_f).
 *
 * What it assumes, and why the result is only ever a starting point here: the
 * film is homogeneous, the substrate is transparent and thick, and absorption is
 * weak enough that the fringes keep distinct peaks. The final answer in this
 * module comes from fitting the exact transfer-matrix model to the measurement;
 * this supplies the seed and an independent value to compare it against.
 */

// An interference order derived from a trial thickness is accepted when it is
// closer to one integer than to any other. Past a quarter of an order there is
// no telling which fringe a point belongs to, so the point carries no thickness
// information rather than the wrong one.
const ORDER_TOLERANCE = 0.25;

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

/**
 * The opposing envelope at one extremum, interpolated between the two
 * neighbouring extrema of the other kind, which bracket it by construction.
 */
function opposingEnvelope(extrema, position) {
    const before = extrema[position - 1];
    const after = extrema[position + 1];
    const span = after.lambda - before.lambda;
    if (!(span > 0)) return null;
    const fraction = (extrema[position].lambda - before.lambda) / span;
    return before.value + (after.value - before.value) * fraction;
}

/** Eq. 14.15. Returns null when the envelopes admit no real index. */
export function envelopeIndex(tMax, tMin, incidentIndex, substrateIndex) {
    if (!(tMax > 0) || !(tMin > 0) || tMax <= tMin) return null;
    const product = incidentIndex * substrateIndex;
    const n2 = (incidentIndex ** 2 + substrateIndex ** 2) / 2
        + 2 * product * (tMax - tMin) / (tMax * tMin);
    const discriminant = n2 * n2 - product * product;
    if (!(discriminant >= 0)) return null;
    const squared = n2 + Math.sqrt(discriminant);
    return squared > 0 ? Math.sqrt(squared) : null;
}

/** Eq. 14.12. Returns the single-pass amplitude factor α, or null. */
export function envelopeAbsorption(tMax, tMin, filmIndex, incidentIndex, substrateIndex) {
    const c1 = (filmIndex + incidentIndex) * (substrateIndex + filmIndex);
    const c2 = (filmIndex - incidentIndex) * (substrateIndex - filmIndex);
    if (!(Math.abs(c2) > 0)) return 1;
    const ratio = Math.sqrt(tMax / tMin);
    const alpha = (c1 * (1 - ratio)) / (c2 * (1 + ratio));
    return alpha > 0 && alpha <= 1 ? alpha : null;
}

/**
 * Thickness from the wavelengths of the extrema.
 *
 * Adjacent extrema differ by one interference order, which fixes the thickness
 * without knowing any order outright. The median of those pair estimates then
 * assigns an integer order to every point, and the thickness is the
 * least-squares slope of order against 4n/λ through the origin, so all the
 * fringes contribute rather than just the neighbouring ones.
 */
function thicknessFromOrders(points) {
    const pairEstimates = [];
    for (let index = 1; index < points.length; index++) {
        const previous = points[index - 1];
        const current = points[index];
        if (current.position !== previous.position + 1) continue;
        const slope = previous.index / previous.lambda - current.index / current.lambda;
        if (slope > 0) pairEstimates.push(1 / (4 * slope));
    }
    if (pairEstimates.length === 0) return null;
    pairEstimates.sort((left, right) => left - right);
    const first = pairEstimates[Math.floor(pairEstimates.length / 2)];

    const ordered = [];
    for (const point of points) {
        const raw = 4 * point.index * first / point.lambda;
        const order = Math.round(raw);
        if (order >= 1 && Math.abs(raw - order) <= ORDER_TOLERANCE) ordered.push({ point, order });
    }
    if (ordered.length < 2) return null;
    let numerator = 0;
    let denominator = 0;
    for (const { point, order } of ordered) {
        const u = 4 * point.index / point.lambda;
        numerator += order * u;
        denominator += u * u;
    }
    if (!(denominator > 0)) return null;
    return { thicknessNm: numerator / denominator, points: ordered.map(entry => entry.point) };
}

/**
 * Run the envelope method over one transmittance curve.
 *
 * @param {object} input
 *   input.lambdas          nm, ascending
 *   input.transmittance    fraction, index-aligned to lambdas
 *   input.incidentIndexAt  λ → n of the medium the light arrives from
 *   input.substrateIndexAt λ → n of the substrate
 * @returns {{ thicknessNm:number, points:{lambda,index,extinction}[],
 *             extrema:object[] } | { error:string, extrema:object[] }}
 */
export function extractEnvelope(input) {
    const { lambdas, transmittance, incidentIndexAt, substrateIndexAt } = input;
    const extrema = significantExtrema(alternatingExtrema(lambdas, transmittance));
    if (extrema.length < 4) {
        return { error: 'fringes', extrema, extremaCount: extrema.length };
    }

    const points = [];
    for (let position = 1; position < extrema.length - 1; position++) {
        const here = extrema[position];
        const other = opposingEnvelope(extrema, position);
        if (other == null) continue;
        const tMax = here.kind === 'max' ? here.value : other;
        const tMin = here.kind === 'max' ? other : here.value;
        const incidentIndex = incidentIndexAt(here.lambda);
        const substrateIndex = substrateIndexAt(here.lambda);
        const index = envelopeIndex(tMax, tMin, incidentIndex, substrateIndex);
        if (index == null) continue;
        points.push({
            position, lambda: here.lambda, index,
            alpha: envelopeAbsorption(tMax, tMin, index, incidentIndex, substrateIndex),
        });
    }

    const solved = thicknessFromOrders(points);
    if (!solved || !(solved.thicknessNm > 0)) {
        return { error: 'orders', extrema, extremaCount: extrema.length };
    }
    return {
        thicknessNm: solved.thicknessNm,
        extrema,
        extremaCount: extrema.length,
        points: solved.points.map(point => ({
            lambda: point.lambda,
            index: point.index,
            // α = exp(−4π k d / λ) rearranged for k, Eq. 14.13. An α the
            // envelopes could not produce leaves k unknown rather than zero.
            extinction: point.alpha == null
                ? null
                : Math.max(0, -point.lambda * Math.log(point.alpha)
                    / (4 * Math.PI * solved.thicknessNm)),
        })),
    };
}
