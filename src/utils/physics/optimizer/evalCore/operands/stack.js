/**
 * The front stack at one wavelength, for the operands that call the phase,
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
