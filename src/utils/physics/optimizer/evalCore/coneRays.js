/**
 * A cone's rays at one wavelength computed together, for a read of the mean of
 * s and p. One ray at a time (tmmPropSingle, tmmEval.js) takes a kernel call
 * per angle, coherent pass and polarization; here each pass of the context's
 * surface model takes one call for all the angles, and the kernel's grid call
 * returns s and p together. Each ray's result is bit-identical to
 * tmmPropSingle's: the kernel runs the same computation on the same inputs for
 * every angle, and the passes are combined with the same arithmetic.
 */

import { rtaRaysEval, kernelPol } from './kernels.js';
import {
    nkOf, layersAt, _rtaChar, surfaceModel, substrateAngle, bulkTransmittance, combineFullSystem,
} from './surfaceModel.js';

// Results { s, p } of one coherent pass of `stack` ({ n0, ns, layers }) at
// each angle in `angles`, from one kernel call. At normal incidence p is s, as
// tmmEval.js keys it (kernelPol).
function passRays(lam, angles, stack) {
    const r = rtaRaysEval(lam, angles, stack);
    return angles.map((aoi, i) => {
        const s = { R: r.Rs[i], T: r.Ts[i], A: r.As[i] };
        return { s, p: kernelPol(aoi, 'p') === 's' ? s : { R: r.Rp[i], T: r.Tp[i], A: r.Ap[i] } };
    });
}

// Full-system results { s, p } at each angle in `angles`: each of the three
// passes in one kernel call, the reverse and back passes at the angles inside
// the substrate, combined per ray as tmmFullSystem combines them.
function fullSystemRays(ctx, lam, angles, thicknesses, mats) {
    const n0 = nkOf(ctx, ctx.n0mat, lam);
    const ns = nkOf(ctx, ctx.nsmat, lam);
    const ne = nkOf(ctx, (ctx.neMat || ctx.n0mat), lam);
    const fLayers = layersAt(ctx, ctx.frontMats || mats, ctx.frontThicks || thicknesses, lam).filter(l => l.d > 0);
    const bLayers = layersAt(ctx, ctx.backMats || [], ctx.backThicks || [], lam).filter(l => l.d > 0);
    const inside = angles.map(aoi => substrateAngle(aoi, n0, ns));
    const subAngles = inside.map(at => at.aoiSub);
    const fwd = passRays(lam, angles, { n0, ns, layers: fLayers });
    const rev = passRays(lam, subAngles, { n0: ns, ns: n0, layers: [...fLayers].reverse() });
    const bck = passRays(lam, subAngles, { n0: ns, ns: ne, layers: bLayers });
    return inside.map(({ cosTs }, i) => {
        const P = bulkTransmittance(ctx, lam, ns, cosTs);
        return {
            s: combineFullSystem(fwd[i].s, rev[i].s, bck[i].s, P),
            p: combineFullSystem(fwd[i].p, rev[i].p, bck[i].p, P),
        };
    });
}

// Results { s, p } of the context's surface model at each angle in `angles`
// at λ, on the stacks tmmPropSingle reads.
function modelRays(ctx, lam, angles, thicknesses, mats) {
    const model = surfaceModel(ctx);
    if (model === 'full') return fullSystemRays(ctx, lam, angles, thicknesses, mats);
    if (model === 'back') {
        const layers = layersAt(ctx, ctx.backMats || [], ctx.backThicks || [], lam).reverse();
        return passRays(lam, angles, { n0: nkOf(ctx, ctx.neMat || ctx.n0mat, lam), ns: nkOf(ctx, ctx.nsmat, lam), layers });
    }
    return passRays(lam, angles,
        { n0: nkOf(ctx, ctx.n0mat, lam), ns: nkOf(ctx, ctx.nsmat, lam), layers: layersAt(ctx, mats, thicknesses, lam) });
}

/**
 * The cone average over `nodes` ({ aoiDeg, weight }) at wavelength `lam` (nm)
 * of the mean of s and p of the read `read`, { char, thicknesses, mats }: the
 * property and the front stack tmmPropSingle reads. It is the weighted sum of
 * tmmPropSingle with pol 'avg' over the nodes, bit for bit, in the same order.
 *
 * The rays at this wavelength that the context does not hold yet are computed
 * together and kept for the rest of the evaluation (ctx._coneRayCache). Node
 * counts are nested (coneAngle/nodes.js), so each doubling of a count computes
 * only its new angles, and rows reading the same wavelength share the angles
 * they have in common.
 */
export function coneAverage(ctx, lam, nodes, read) {
    const store = ctx._coneRayCache;
    let held = store && store.get(lam);
    if (!held) {
        held = new Map();
        if (store) store.set(lam, held);
    }
    const missing = nodes.map(node => node.aoiDeg).filter(aoi => !held.has(aoi));
    if (missing.length > 0) {
        const rays = modelRays(ctx, lam, missing, read.thicknesses, read.mats);
        missing.forEach((aoi, i) => held.set(aoi, rays[i]));
    }
    let acc = 0;
    for (let i = 0; i < nodes.length; i++) {
        const ray = held.get(nodes[i].aoiDeg);
        acc += nodes[i].weight * ((_rtaChar(ray.s, read.char) + _rtaChar(ray.p, read.char)) * 0.5);
    }
    return acc;
}
