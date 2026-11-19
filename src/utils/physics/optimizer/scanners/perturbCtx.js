/**
 * Perturbed eval-context builders for one needle insertion (gap or intra-layer).
 *
 * Pure array transforms shared by the finite-difference scan, the optimal-
 * thickness search, and the GE boundary scan. `cfg` bundles { surfaceMode, side };
 * in symmetric mode the back stack is rebuilt as reverse(front).
 */

// The locked mask of a context after the `removed` layers at vector position
// `at` give way to `added` (a needle is free; the halves of a split host keep
// its lock). Null when the context carries none.
function lockedAfter(ctx, at, added, removed = 0) {
    const locked = ctx.fullLocked;
    if (!locked || locked.length !== (ctx.fullThicks || []).length) return null;
    return [...locked.slice(0, at), ...added, ...locked.slice(at + removed)];
}

// Where side position `pos` sits in the constraint vector: the back follows the
// front in both_independent mode.
const vectorAt = (ctx, cfg, pos) =>
    (cfg.side === 'back' && cfg.surfaceMode === 'both_independent' ? ctx.frontThicks.length + pos : pos);

// Insert a needle of `mat`/`deltaNm` at interface gap `pos` on the chosen side.
export function _perturbCtxGap(ctx, cfg, pos, mat, deltaNm) {
    const { surfaceMode, side } = cfg;
    const fullLocked = lockedAfter(ctx, vectorAt(ctx, cfg, pos), [false]);
    if (side === 'front') {
        const frontThicks = [...ctx.frontThicks.slice(0, pos), deltaNm, ...ctx.frontThicks.slice(pos)];
        const frontMats   = [...ctx.frontMats.slice(0, pos),   mat,     ...ctx.frontMats.slice(pos)];
        let backThicks = ctx.backThicks, backMats = ctx.backMats;
        if (surfaceMode === 'symmetric') {
            backThicks = [...frontThicks].reverse();
            backMats   = [...frontMats].reverse();
        }
        return { ...ctx, frontThicks, frontMats, backThicks, backMats, fullLocked,
            fullThicks: surfaceMode === 'both_independent'
                ? [...frontThicks, ...backThicks] : frontThicks };
    }
    const backThicks = [...ctx.backThicks.slice(0, pos), deltaNm, ...ctx.backThicks.slice(pos)];
    const backMats   = [...ctx.backMats.slice(0, pos),   mat,     ...ctx.backMats.slice(pos)];
    return { ...ctx, backThicks, backMats, fullLocked,
        fullThicks: surfaceMode === 'both_independent'
            ? [...ctx.frontThicks, ...backThicks] : backThicks };
}

// Split host layer `loc.k` at fraction `loc.frac` and insert a needle of
// `mat`/`deltaNm` between the halves (host halves floored at 1e-3 nm).
export function _perturbCtxIntra(ctx, cfg, loc, mat, deltaNm) {
    const { surfaceMode, side } = cfg;
    const { k, frac } = loc;
    const tKey = side === 'back' ? 'backThicks' : 'frontThicks';
    const mKey = side === 'back' ? 'backMats'   : 'frontMats';
    const dk = ctx[tKey][k];
    const d1 = Math.max(frac * dk, 1e-3);
    const d2 = Math.max((1 - frac) * dk, 1e-3);
    const hostMat = ctx[mKey][k];
    const thicksNew = [
        ...ctx[tKey].slice(0, k), d1, deltaNm, d2, ...ctx[tKey].slice(k + 1),
    ];
    const matsNew = [
        ...ctx[mKey].slice(0, k), hostMat, mat, hostMat, ...ctx[mKey].slice(k + 1),
    ];
    const at = vectorAt(ctx, cfg, k);
    const hostLocked = !!ctx.fullLocked?.[at];
    const fullLocked = lockedAfter(ctx, at, [hostLocked, false, hostLocked], 1);
    if (side === 'front') {
        let backThicks = ctx.backThicks, backMats = ctx.backMats;
        if (surfaceMode === 'symmetric') {
            backThicks = [...thicksNew].reverse();
            backMats   = [...matsNew].reverse();
        }
        return { ...ctx, frontThicks: thicksNew, frontMats: matsNew, backThicks, backMats, fullLocked,
            fullThicks: surfaceMode === 'both_independent'
                ? [...thicksNew, ...backThicks] : thicksNew };
    }
    return { ...ctx, backThicks: thicksNew, backMats: matsNew, fullLocked,
        fullThicks: surfaceMode === 'both_independent'
            ? [...ctx.frontThicks, ...thicksNew] : thicksNew };
}
