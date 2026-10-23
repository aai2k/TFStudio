/**
 * The cone node count at each wavelength the operands read, settled on the
 * design being evaluated.
 *
 * At every wavelength a row reads R, T or A at, the node count starts at the
 * spec's grid points and doubles until the row's average there settles within
 * CONE_AVERAGE_TOLERANCE (coneAngle/average.js, resolveConeNodes). Each row
 * settles its own counts (tmmEval.js, inConeRow), so a row reads the same
 * value whichever other rows are in the merit function. The count is settled
 * per wavelength because the angle integral is hard only where a resonance
 * narrower than the cone's shift sits, and one count for the whole band would
 * spend the largest on every sample.
 *
 * Too few rays leave a ripple on the averaged spectrum, and where that ripple
 * crosses zero two counts can agree at one sample by chance while the samples
 * beside it still disagree by far more than the tolerance. Each sample
 * therefore takes the largest count among itself and the samples on either
 * side of it in the same row.
 *
 * The node sets are stored on the context, so the evaluation that follows, the
 * analytic Jacobian and the needle function built on the same context all
 * average over the same rays. A context that already holds a set for a
 * wavelength keeps it: the least-squares engine shares one store across a run,
 * so the merit function does not move between node sets while it is being
 * minimized.
 */

import { isPPEF } from '../operandModel.js';
import { coneIsActive, resolveConeNodes } from '../coneAngle.js';
import { tmmPropSingle, coneAxisKey, coneAxisRays, inConeRow } from './tmmEval.js';
import { operandSpectrumReads } from './operands/index.js';
import { ppefSpectrumReads } from './operands/ppef.js';

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
 * Settle the node set at one wavelength `lam` (nm) on the cone axis `aoi` for
 * the { pol, char } pairs in `channels`, unless the row in force (inConeRow)
 * holds one. The
 * count is raised to the largest of the nearest settled wavelengths on either
 * side, as settleConeNodes raises its own. For a search that evaluates between
 * the wavelengths its row reads (bandExtremum.js). No effect without an active
 * cone.
 */
export function settleConeWavelength(ctx, aoi, lam, channels) {
    if (!(ctx && ctx.cone && coneIsActive(ctx.cone))) return;
    const axis = coneAxisKey(aoi);
    const rays = coneAxisRays(ctx, axis);
    if (rays.countByLambda.has(lam)) return;
    let count;
    try { count = settleWavelength(ctx, axis, rays, lam, channels); } catch { return; }
    let below = -Infinity, above = Infinity;
    for (const other of rays.countByLambda.keys()) {
        if (other < lam && other > below) below = other;
        if (other > lam && other < above) above = other;
    }
    for (const side of [below, above]) {
        if (rays.countByLambda.has(side)) count = Math.max(count, rays.countByLambda.get(side));
    }
    rays.countByLambda.set(lam, count);
    rays.byLambda.set(lam, rays.nodesFor(count));
}

/**
 * Give the wavelengths `lams` (nm) the node set the row in force holds at
 * `fromLam` on the cone axis `aoi`, so a difference taken across them averages over one
 * set of rays. A wavelength that holds a set already keeps it. No effect
 * without an active cone or a set at `fromLam`.
 */
export function shareConeNodes(ctx, aoi, fromLam, lams) {
    if (!(ctx && ctx.cone && coneIsActive(ctx.cone))) return;
    const rays = coneAxisRays(ctx, coneAxisKey(aoi));
    const count = rays.countByLambda.get(fromLam);
    if (count === undefined) return;
    for (const lam of lams) {
        if (rays.countByLambda.has(lam)) continue;
        rays.countByLambda.set(lam, count);
        rays.byLambda.set(lam, rays.nodesFor(count));
    }
}

// Settle the wavelengths of one row's `reads` (operandSpectrumReads) that the
// row in force does not hold yet.
function settleRow(ctx, { aoi, pol, char, lambdas }) {
    const axis = coneAxisKey(aoi);
    const rays = coneAxisRays(ctx, axis);
    const fresh = new Set();
    for (const lam of lambdas) {
        if (rays.countByLambda.has(lam)) continue;
        try {
            rays.countByLambda.set(lam, settleWavelength(ctx, axis, rays, lam, [{ pol, char }]));
            fresh.add(lam);
        } catch {
            // A row that cannot be evaluated reports that on its own row; the
            // wavelength then averages over the spec's grid points.
        }
    }
    if (fresh.size > 0) raiseToNeighbours(rays, fresh);
}

/**
 * Settle, for every enabled row of `operands` that reads R, T or A, the node
 * set of each wavelength it reads that the context does not hold yet for that
 * row. A PPEF row reads at its curve block's points. No effect without an
 * active cone.
 */
export function settleConeNodes(operands, ctx) {
    if (!(ctx && ctx.cone && coneIsActive(ctx.cone))) return;
    for (const op of operands) {
        if (!(op && op.enabled)) continue;
        const reads = isPPEF(op.type) ? ppefSpectrumReads(op, ctx) : operandSpectrumReads(op);
        if (reads) inConeRow(ctx, op, () => settleRow(ctx, reads));
    }
}
