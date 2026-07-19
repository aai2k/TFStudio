/**
 * Validated finite-difference needle scan (Sullivan & Dobrowolski numerical
 * variant). Surface-mode-aware: evaluation runs through buildEvalContext /
 * tmmFullSystem (Macleod §2.6.4) so back coating + substrate bulk are included
 * for non-front_only modes. Retained as the analytic-path fallback (handles
 * ramp / weighted-integral / minmax operands the analytic scan cannot).
 */

import { calcMF, evaluateOperands, buildEvalContext } from '../evalCore.js';
import { resolveScanSide } from './sides.js';
import { _perturbCtxGap, _perturbCtxIntra } from './perturbCtx.js';

export function scanNeedlesFD({ operands, design, resolveMat, candidateMats, deltaNm = 0.5, nIntra = 4, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);
    const cfg = { surfaceMode, side };

    // Build the base eval context (symmetric auto-mirrors back from front).
    const ctx0 = buildEvalContext(design, resolveMat);
    const sourceLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const N = sourceLayers.length;

    // Synthesis gradient uses the optical MF only — the virtual probe is
    // sub-floor by construction; the min-thickness bound is handled by the
    // post-insert DLS refine + pruning, not this scan.
    const MF_OPT = { skipConstraints: true };
    const mf0   = calcMF(operands, evaluateOperands(operands, ctx0), MF_OPT);

    const candidates = [];

    // A. Interface gap positions (N+1 gaps, indices 0…N)
    for (let pos = 0; pos <= N; pos++) {
        for (const { id: matId, mat } of candidateMats) {
            const ctxNew = _perturbCtxGap(ctx0, cfg, pos, mat, deltaNm);
            const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
            const grad   = (mfNew - mf0) / deltaNm;
            candidates.push({ pos, materialId: matId, dMF: grad * deltaNm, grad, side });
        }
    }

    // B. Intra-layer positions (nIntra fractions per layer)
    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));
    for (let k = 0; k < N; k++) {
        const hostId = sourceLayers[k].material;
        for (const frac of fracs) {
            for (const { id: matId, mat } of candidateMats) {
                if (matId === hostId) continue;   // same material → zero net effect
                const ctxNew = _perturbCtxIntra(ctx0, cfg, { k, frac }, mat, deltaNm);
                const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
                const grad   = (mfNew - mf0) / deltaNm;
                candidates.push({
                    pos: k + frac, materialId: matId,
                    dMF: grad * deltaNm, grad,
                    intra: true, layerK: k, frac, side,
                });
            }
        }
    }

    return { candidates, mf0 };
}
