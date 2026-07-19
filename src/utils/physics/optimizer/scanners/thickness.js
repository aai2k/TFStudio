/**
 * Optimal-needle-thickness search.
 *
 * After scanNeedlesPFunction identifies the best position+material, this searches
 * for the thickness that minimises the MF (golden-section search over
 * [deltaNm, maxNm]).
 */

import { calcMF, evaluateOperands, buildEvalContext } from '../evalCore.js';
import { resolveScanSide } from './sides.js';
import { _perturbCtxGap, _perturbCtxIntra } from './perturbCtx.js';

export function findOptimalNeedleThickness({ operands, design, resolveMat, candidate, deltaNm = 0.5, maxNm = 200, tol = 0.5, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);
    const cfg = { surfaceMode, side };

    const ctx0 = buildEvalContext(design, resolveMat);
    const mat  = candidate._mat;

    function mfAt(d) {
        const ctxNew = candidate.intra
            ? _perturbCtxIntra(ctx0, cfg, { k: candidate.layerK, frac: candidate.frac }, mat, d)
            : _perturbCtxGap(ctx0,   cfg, candidate.pos, mat, d);
        // Optical-only, consistent with the scan that selected this candidate;
        // the thickness floor is enforced by the subsequent DLS refine + prune.
        return calcMF(operands, evaluateOperands(operands, ctxNew), { skipConstraints: true });
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
