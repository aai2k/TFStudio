/**
 * The node count rule and the averaging of per-angle results over a cone.
 *
 * `resolveConeNodes` doubles the node count from the spec's grid points until
 * two doublings in a row each change the average by no more than
 * CONE_AVERAGE_TOLERANCE, and keeps the count before the last doubling;
 * `coneAverageResult` applies it to whole spectra for the plot windows. The
 * merit function applies it per wavelength (evalCore/coneNodeCount.js).
 */

import { coneIsActive } from './spec.js';
import { coneNodes } from './nodes.js';

/**
 * Largest change in an averaged R, T or A (as a fraction) accepted when the
 * node count is doubled: 1e-4, one unit in the last place of the percentage
 * the merit table shows (0.01 %).
 */
export const CONE_AVERAGE_TOLERANCE = 1e-4;

/**
 * Node counts are doubled only while they stay at or below 480, five doublings
 * of the default 15 grid points. A narrow passband moves by
 * Δλ/λ = sin²θ / (2 n*²) at incidence θ (Macleod, Thin-Film Optical Filters
 * 5e, §8.2.5.4, p. 314, eq. 8.39), so at one wavelength its transmission
 * across the cone is a peak far narrower than the cone; a 7+7-pair TiO2/SiO2
 * Fabry-Perot under a 20° cone needs 240 to 480 nodes to average it within the
 * tolerance.
 */
export const MAX_CONE_NODES = 480;

/**
 * The node set a cone average uses at axis `axisDeg`, and the average itself.
 * Starting from the spec's grid points, the Clenshaw-Curtis count (Clenshaw &
 * Curtis, Numer. Math. 2, 197, 1960) is doubled until two doublings in a row
 * each change the average by no more than the tolerance, and the count before
 * the last doubling is kept. The last change estimates that count's error; the
 * one before it shows the doubling has reached counts that resolve the
 * integrand. A single agreement does not show that: where a resonance is
 * narrower than the spacing of the rays, two coarse counts can miss it alike
 * and agree by chance (30 and 60 nodes agreeing to 2e-9 while both are 0.3 %
 * off). A change no larger than the rounding of the sums, nodes × 2^-52 for
 * averages of at most 1 (Higham, Accuracy and Stability of Numerical
 * Algorithms, 2nd ed., §4.2), settles the coarser count on its own: the two
 * counts then agree to the precision the sums carry, as on a smooth spectrum,
 * and no chance agreement on the measured passbands came that close. Doubling
 * stops at MAX_CONE_NODES, keeping the last count.
 *
 *   averageAt(nodes)   → the cone average over those nodes, any shape
 *   differenceOf(a, b) → the largest absolute difference between two averages
 *   options.tolerance  → CONE_AVERAGE_TOLERANCE unless given
 *   options.nodesFor   → count → node set, coneNodes(spec, axisDeg, count)
 *                        unless given (a caller that settles many wavelengths
 *                        passes a memoized one)
 *
 * An inactive cone returns its single node with no comparison.
 */
export function resolveConeNodes(spec, axisDeg, averageAt, differenceOf, options = {}) {
    const tolerance = options.tolerance ?? CONE_AVERAGE_TOLERANCE;
    const nodesFor = options.nodesFor || (count => coneNodes(spec, axisDeg, count));
    let count = coneIsActive(spec) ? Math.min(spec.gridPoints, MAX_CONE_NODES) : 1;
    let nodes = nodesFor(count);
    let average = averageAt(nodes);
    if (nodes.length <= 1) return { nodes, average, count };
    let agreed = false;
    while (2 * count <= MAX_CONE_NODES) {
        const finer = 2 * count;
        const finerNodes = nodesFor(finer);
        const finerAverage = averageAt(finerNodes);
        const change = differenceOf(average, finerAverage);
        if (change <= finerNodes.length * Number.EPSILON || (agreed && change <= tolerance)) break;
        agreed = change <= tolerance;
        count = finer;
        nodes = finerNodes;
        average = finerAverage;
    }
    return { nodes, average, count };
}

// Fold one node's result `r` into the weighted accumulator. The first node
// (acc === null) seeds acc from a shallow copy of r with each averaged array
// scaled by the node weight; later nodes add their weighted contribution in
// place. Returns the (possibly newly created) accumulator.
function _accumWeighted(acc, r, arrayKeys, weight) {
    if (!acc) {
        acc = { ...r };
        for (const k of arrayKeys) acc[k] = r[k] ? r[k].map(v => v * weight) : r[k];
        return acc;
    }
    for (const k of arrayKeys) {
        if (acc[k] && r[k]) for (let i = 0; i < acc[k].length; i++) acc[k][i] += r[k][i] * weight;
    }
    return acc;
}

// Largest element-wise difference between two averaged results over the
// listed array fields.
function _maxArrayDifference(a, b, arrayKeys) {
    let d = 0;
    for (const k of arrayKeys) {
        const x = a[k], y = b[k];
        if (!x || !y) continue;
        for (let i = 0; i < x.length; i++) {
            const e = Math.abs(x[i] - y[i]);
            if (e > d) d = e;
        }
    }
    return d;
}

/**
 * Cone-average a "result-like" object whose numeric-array fields (listed in
 * `arrayKeys`) are spectra to be averaged element-wise over the illumination
 * cone. `computeAt(theta)` returns such an object for a single incidence angle
 * (the spectra share the same, angle-independent, λ grid). Non-listed fields are
 * taken from the first node (e.g. `lambda`). The node count follows
 * resolveConeNodes, judged on every listed array.
 *
 * Shared by the spectrum-based viewers (Optical Evaluation, Color, Integral
 * Values) so they cone-average by the same rule as the merit function.
 *
 * No active cone → a single computeAt(axisDeg) call, so the caller is
 * byte-identical to the pre-cone behavior.
 */
export function coneAverageResult(spec, axisDeg, computeAt, arrayKeys) {
    if (!coneIsActive(spec)) return computeAt(axisDeg);
    // Each count's rays include the previous count's, so every angle is
    // computed once however many times the count doubles.
    const byAngle = new Map();
    const at = theta => {
        let r = byAngle.get(theta);
        if (!r) { r = computeAt(theta); byAngle.set(theta, r); }
        return r;
    };
    const averageAt = nodes => {
        if (nodes.length <= 1) return at(axisDeg);
        let acc = null;
        for (const nd of nodes) acc = _accumWeighted(acc, at(nd.aoiDeg), arrayKeys, nd.weight);
        return acc;
    };
    return resolveConeNodes(spec, axisDeg, averageAt,
        (a, b) => _maxArrayDifference(a, b, arrayKeys)).average;
}
