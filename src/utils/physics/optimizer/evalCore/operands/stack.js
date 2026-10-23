/**
 * A coated side's stack at one wavelength, for the operands that call the phase,
 * ellipsometry and field routines directly instead of going through tmmProp.
 */

import { nkOf } from '../tmmEval.js';

// Build front-stack (n0, ns, layers) at one wavelength from the eval context.
// Per-λ complex indices come from nkOf so dispersion is honoured.
export function _frontStackAt(ctx, lam) {
    const n0 = nkOf(ctx, ctx.n0mat, lam);
    const ns = nkOf(ctx, ctx.nsmat, lam);
    const layers = ctx.frontMats.map((m, i) => ({ n: nkOf(ctx, m, lam), d: ctx.frontThicks[i] }));
    return { n0, ns, layers };
}

// The coated side a one-side row reads, as (n0, ns, layers) at one wavelength:
// the back stack on a back-only design, as the phase and ellipsometry rows read
// it, and the front stack otherwise. The back is lit from the exit medium, so
// its layers run in reverse deposition order, from that medium to the substrate.
export function _scoredSideStackAt(ctx, lam) {
    if ((ctx.surfaceMode || 'front_only') !== 'back_only') return _frontStackAt(ctx, lam);
    const n0 = nkOf(ctx, ctx.neMat || ctx.n0mat, lam);
    const ns = nkOf(ctx, ctx.nsmat, lam);
    const layers = ctx.backMats.map((m, i) => ({ n: nkOf(ctx, m, lam), d: ctx.backThicks[i] })).reverse();
    return { n0, ns, layers };
}
