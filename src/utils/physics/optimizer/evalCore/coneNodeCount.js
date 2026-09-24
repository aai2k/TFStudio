/**
 * The cone node count at each wavelength the operands read, settled on the
 * design being evaluated.
 *
 * At every (cone axis, wavelength) the rows read R, T or A at, the node count
 * starts at the spec's grid points and doubles until the averages of every
 * polarization and channel read there change by no more than
 * CONE_AVERAGE_TOLERANCE (coneAngle/average.js, resolveConeNodes). The count is
 * settled per wavelength because the angle integral is hard only where a
 * resonance narrower than the cone's shift sits: on a 200-layer TiO2/SiO2
 * stack under a 7.5° cone about the normal, 2 % of the band samples need 120
 * rays and 96 % settle at 30, and one count for the whole band would spend the
 * largest on every sample.
 *
 * Too few rays leave a ripple on the averaged spectrum, and where that ripple
 * crosses zero two counts can agree at one sample by chance while the samples
 * beside it still disagree by far more than the tolerance. Each sample
 * therefore takes the largest count among itself and the samples on either
 * side of it on the same axis.
 *
 * The node sets are stored on the context, so the evaluation that follows, the
 * analytic Jacobian and the needle function built on the same context all
 * average over the same rays. A context that already holds a set for a
 * wavelength keeps it: the least-squares engine shares one store across a run,
 * so the merit function does not move between node sets while it is being
 * minimized.
 */

import { coneIsActive, resolveConeNodes } from '../coneAngle.js';
import { tmmPropSingle, coneAxisKey, coneAxisRays } from './tmmEval.js';
import { operandSpectrumReads } from './operands/index.js';

// The Map stored under `key`, created empty on first use.
function mapAt(map, key) {
    let inner = map.get(key);
    if (!inner) { inner = new Map(); map.set(key, inner); }
    return inner;
}

// Axis key → wavelength → the (polarization, channel) pairs read there.
function readsByAxis(operands) {
    const byAxis = new Map();
    for (const op of operands) {
        const reads = op && op.enabled ? operandSpectrumReads(op) : null;
        if (!reads) continue;
        const byLambda = mapAt(byAxis, coneAxisKey(reads.aoi));
        const channel = { pol: reads.pol, char: reads.char };
        const key = `${reads.pol}|${reads.char}`;
        for (const lam of reads.lambdas) mapAt(byLambda, lam).set(key, channel);
    }
    return byAxis;
}

function maxDifference(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
        const e = Math.abs(a[i] - b[i]);
        if (e > d) d = e;
    }
    return d;
}

// Settle one wavelength by doubling; returns the node count kept.
function settleWavelength(ctx, axis, rays, lam, channels) {
    const averageAt = nodes => channels.map(({ pol, char }) => {
        let acc = 0;
        for (let i = 0; i < nodes.length; i++) {
            acc += nodes[i].weight *
                tmmPropSingle(lam, nodes[i].aoiDeg, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        }
        return acc;
    });
    return resolveConeNodes(ctx.cone, axis, averageAt, maxDifference,
        { nodesFor: count => rays.nodesFor(count) }).count;
}

// Raise each newly settled wavelength to the largest count among itself and
// its neighbours in wavelength order.
function raiseToNeighbours(rays, fresh) {
    const lams = [...rays.countByLambda.keys()].sort((a, b) => a - b);
    const raised = new Map();
    lams.forEach((lam, i) => {
        if (!fresh.has(lam)) return;
        let count = rays.countByLambda.get(lam);
        if (i > 0) count = Math.max(count, rays.countByLambda.get(lams[i - 1]));
        if (i + 1 < lams.length) count = Math.max(count, rays.countByLambda.get(lams[i + 1]));
        raised.set(lam, count);
    });
    for (const [lam, count] of raised) {
        rays.countByLambda.set(lam, count);
        rays.byLambda.set(lam, rays.nodesFor(count));
    }
}

/**
 * Settle the node set of every (cone axis, wavelength) `operands` read on
 * `ctx` that the context does not hold yet. No effect without an active cone.
 */
export function settleConeNodes(operands, ctx) {
    if (!(ctx && ctx.cone && coneIsActive(ctx.cone))) return;
    for (const [axis, byLambda] of readsByAxis(operands)) {
        const rays = coneAxisRays(ctx, axis);
        const fresh = new Set();
        for (const [lam, channelMap] of byLambda) {
            if (rays.countByLambda.has(lam)) continue;
            try {
                rays.countByLambda.set(lam, settleWavelength(ctx, axis, rays, lam, [...channelMap.values()]));
                fresh.add(lam);
            } catch {
                // A row that cannot be evaluated reports that on its own row; the
                // wavelength then averages over the spec's grid points.
            }
        }
        if (fresh.size > 0) raiseToNeighbours(rays, fresh);
    }
}
