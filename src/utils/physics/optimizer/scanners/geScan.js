/**
 * GE boundary-position scan.
 *
 * "Forced insertion" fallback (Sullivan & Dobrowolski 1996): when no needle
 * gradient is negative, try inserting a D_MIN-thick layer at the entry (pos=0)
 * and exit (pos=N) boundaries for every candidate material. Returns the raw
 * boundary candidates; the caller DLS-refines and keeps the best. On a design
 * with environments each insertion goes into every environment's stack and is
 * scored by the total optical merit (needleScene.js).
 */

import { needleScene } from './needleScene.js';

export function scanGEInsertions({ operands, design, resolveMat, candidateMats, thickNm = 15.0, side = 'front' }) {
    const scene = needleScene({ operands, design, resolveMat, side });
    side = scene.side;

    const sourceLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const N = sourceLayers.length;

    // Optical-only: GE forced insertions are sub-floor probes; the bound is
    // enforced by the post-insert DLS refine + cleanupLayers, not this scan.
    const mf0 = scene.merit();

    const candidates = [];
    for (const pos of [0, N]) {
        for (const { id: matId, mat } of candidateMats) {
            const mfNew  = scene.gap(pos, matId, mat, thickNm);
            candidates.push({ pos, materialId: matId, dMF: mfNew - mf0, mfNew, side });
        }
    }

    return { candidates, mf0 };
}
