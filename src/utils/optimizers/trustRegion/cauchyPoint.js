/**
 * Cauchy point of the box QP  min q(Δ) = ½ ΔᵀHΔ + gᵀΔ,  lo ≤ Δ ≤ hi,  from
 * Δ = 0 (lo ≤ 0 ≤ hi): the first local minimizer of q along the projected
 * steepest-descent path Δ(t) = P[−t·g] (Nocedal & Wright 2e, §16.7). Between
 * breakpoints, where a variable reaches its bound and stops, the path is
 * straight and q along it is a one-dimensional quadratic. H must be symmetric.
 * On a segment of non-positive curvature q falls all the way to the next
 * breakpoint (Nocedal & Wright 2e, p. 555), so with an indefinite H every
 * variable with g_i ≠ 0 needs a finite bound on its side; the trust-region box
 * of trustRegionNewton.js gives it one. With H positive definite every segment
 * has positive curvature and that rule never applies.
 *
 * A port of refine.c's cauchy. SQP keeps linalg/cauchyPoint.js, which
 * assumes H positive definite, so its results do not move.
 */

// t at which each variable reaches its bound along −g (Infinity for g_i = 0).
function breakpoints(g, lo, hi) {
    return g.map((gi, i) => {
        if (gi > 0) return -lo[i] / gi;
        return gi < 0 ? -hi[i] / gi : Infinity;
    });
}

// dq/ds and d²q/ds² at s = 0 along D + s·p.
function slopeAndCurvature(H, g, D, p) {
    let slope = 0, curve = 0;
    for (let i = 0; i < g.length; i++) {
        if (p[i] === 0) continue;
        let hp = 0, hd = 0;
        for (let j = 0; j < g.length; j++) { hp += H[i][j] * p[j]; hd += H[i][j] * D[j]; }
        slope += p[i] * (g[i] + hd);
        curve += p[i] * hp;
    }
    return { slope, curve };
}

// The breakpoints and the path Δ(t). A variable whose breakpoint the path has
// passed sits exactly on its bound, since −t·g_i at t = breakpoint can round
// to within 1 ulp of it and the subspace minimization would then take the
// variable as free.
function projectedPath(g, lo, hi) {
    const breaks = breakpoints(g, lo, hi);
    const along = t => g.map((gi, i) => {
        if (breaks[i] <= t) return gi > 0 ? lo[i] : hi[i];
        return Math.min(hi[i], Math.max(lo[i], -t * gi));
    });
    return { breaks, along };
}

export function boxCauchyPoint(H, g, lo, hi) {
    const { breaks, along } = projectedPath(g, lo, hi);
    const stops = [...new Set([...breaks.filter(t => t > 0), Infinity])].sort((a, b) => a - b);
    let tPrev = 0;
    for (const tNext of stops) {
        const p = g.map((gi, i) => (breaks[i] > tPrev ? -gi : 0));
        const { slope, curve } = slopeAndCurvature(H, g, along(tPrev), p);
        if (slope >= 0) break;
        const sMin = curve > 0 ? -slope / curve : Infinity;
        if (sMin < tNext - tPrev) return along(tPrev + sMin);
        if (tNext === Infinity) break;
        tPrev = tNext;
    }
    return along(tPrev);
}
