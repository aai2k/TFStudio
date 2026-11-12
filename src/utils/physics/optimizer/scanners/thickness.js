/**
 * Optimal-needle-thickness search.
 *
 * After scanNeedlesPFunction identifies the best position+material, this searches
 * for the thickness that minimises the MF (golden-section search over
 * [deltaNm, maxNm]). On a design with environments the needle goes into every
 * environment's stack and the total optical merit is minimised
 * (needleScene.js).
 */

import { needleScene } from './needleScene.js';

export function findOptimalNeedleThickness({ operands, design, resolveMat, candidate, deltaNm = 0.5, maxNm = 200, tol = 0.5, side = 'front' }) {
    const scene = needleScene({ operands, design, resolveMat, side });
    const mat  = candidate._mat;
    const loc = { k: candidate.layerK, frac: candidate.frac };

    function mfAt(d) {
        // Optical-only, consistent with the scan that selected this candidate;
        // the thickness floor is enforced by the subsequent DLS refine + prune.
        return candidate.intra
            ? scene.intra(loc, candidate.materialId, mat, d)
            : scene.gap(candidate.pos, candidate.materialId, mat, d);
    }

    // A needle is a THIN perturbation (Tikhonravov 1996; Sullivan §3): the
    // line search only tunes it near the thin end, then DLS grows it. The
    // static-MF surface over a wide range is multimodal — an unbounded search
    // can land on a huge "needle" (a design-destroying slab) that lowers the
    // frozen-stack MF but ruins synthesis. So clamp the upper bound to needle
    // scale and only accept the optimized thickness if it actually beats the
    // thin insert; otherwise insert thin and let DLS do the work.
    const bMax = Math.min(maxNm, Math.max(4 * deltaNm, 60));
    const fMin = mfAt(deltaNm);

    const phi = (Math.sqrt(5) - 1) / 2;
    let a = deltaNm, b = bMax;
    let c = b - phi * (b - a);
    let fd = a + phi * (b - a);
    let fc = mfAt(c), ffd = mfAt(fd);
    for (let i = 0; i < 50 && (b - a) > tol; i++) {
        if (fc < ffd) { b = fd; fd = c; ffd = fc; c = b - phi * (b - a); fc = mfAt(c); }
        else          { a = c;  c = fd; fc = ffd;  fd = a + phi * (b - a); ffd = mfAt(fd); }
    }
    const dOpt = (a + b) / 2;
    // Guard: never return a thickness that isn't strictly better (statically)
    // than the thin insert — keeps it a genuine needle.
    return (mfAt(dOpt) < fMin - 1e-12) ? dOpt : deltaNm;
}
