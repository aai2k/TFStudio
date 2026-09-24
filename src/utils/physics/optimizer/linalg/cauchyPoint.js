/**
 * Cauchy point of the box QP  min q(Δ) = ½ ΔᵀHΔ + gᵀΔ,  lo ≤ Δ ≤ hi,  from
 * Δ = 0 (lo ≤ 0 ≤ hi): the first local minimizer of q along the projected
 * steepest-descent path Δ(t) = P[−t·g] (Nocedal & Wright 2e, §16.7). Between
 * breakpoints, where a variable reaches its bound and stops, the path is
 * straight and q along it is a one-dimensional quadratic. H must be symmetric
 * positive definite.
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

export function boxCauchyPoint(H, g, lo, hi) {
    const along = t => g.map((gi, i) => Math.min(hi[i], Math.max(lo[i], -t * gi)));
    const breaks = breakpoints(g, lo, hi);
    const stops = [...new Set([...breaks.filter(t => t > 0), Infinity])].sort((a, b) => a - b);
    let tPrev = 0;
    for (const tNext of stops) {
        const p = g.map((gi, i) => (breaks[i] > tPrev ? -gi : 0));
        const { slope, curve } = slopeAndCurvature(H, g, along(tPrev), p);
        if (slope >= 0) break;
        const sMin = -slope / curve;
        if (sMin < tNext - tPrev) return along(tPrev + sMin);
        tPrev = tNext;
    }
    return along(tPrev);
}
