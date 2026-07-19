/**
 * GE boundary-position scan.
 *
 * "Forced insertion" fallback (Sullivan & Dobrowolski 1996): when no needle
 * gradient is negative, try inserting a D_MIN-thick layer at the entry (pos=0)
 * and exit (pos=N) boundaries for every candidate material. Returns the raw
 * boundary candidates; the caller DLS-refines and keeps the best.
 */

import { calcMF, evaluateOperands, buildEvalContext } from '../evalCore.js';
import { resolveScanSide } from './sides.js';
import { _perturbCtxGap } from './perturbCtx.js';

export function scanGEInsertions({ operands, design, resolveMat, candidateMats, thickNm = 15.0, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);
    const cfg = { surfaceMode, side };

    const sourceLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const N = sourceLayers.length;

    // Optical-only: GE forced insertions are sub-floor probes; the bound is
    // enforced by the post-insert DLS refine + cleanupLayers, not this scan.
    const MF_OPT = { skipConstraints: true };
    const ctx0   = buildEvalContext(design, resolveMat);
    const mf0    = calcMF(operands, evaluateOperands(operands, ctx0), MF_OPT);

    const candidates = [];
    for (const pos of [0, N]) {
        for (const { id: matId, mat } of candidateMats) {
            const ctxNew = _perturbCtxGap(ctx0, cfg, pos, mat, thickNm);
            const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
            candidates.push({ pos, materialId: matId, dMF: mfNew - mf0, mfNew, side });
        }
    }

    return { candidates, mf0 };
}
