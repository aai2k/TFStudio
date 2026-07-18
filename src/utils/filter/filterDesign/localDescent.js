import { structureLayerCount, structureThickness, applySymmetry } from './structureMetrics.js';

/** One mirror-vector improvement sweep: try ±2/±4 (odd-preserving) on each mirror. */
function tryImproveMirrors(mirrors, spacers, mf, { clampMirror, mfOf, symMirrors }) {
    let improved = false;
    for (let i = 0; i < mirrors.length; i++) {
        if (symMirrors && i > Math.floor(mirrors.length / 2)) continue; // mirrored half follows
        for (const delta of [2, -2, 4, -4]) {
            const cand = mirrors.slice(); cand[i] = clampMirror(cand[i] + delta);
            if (cand[i] === mirrors[i]) continue;
            const m2 = mfOf(cand, spacers);
            if (m2 < mf - 1e-12) { mirrors = cand; mf = m2; improved = true; }
        }
    }
    return { mirrors, mf, improved };
}

/** One spacer-vector improvement sweep: try ±1/±2 on each spacer order. */
function tryImproveSpacers(mirrors, spacers, mf, { clampOrder, mfOf, symCavities }) {
    let improved = false;
    for (let i = 0; i < spacers.length; i++) {
        if (symCavities && i > Math.floor(spacers.length / 2)) continue;
        for (const delta of [1, -1, 2, -2]) {
            const cand = spacers.slice(); cand[i] = clampOrder(cand[i] + delta);
            if (cand[i] === spacers[i]) continue;
            const m2 = mfOf(mirrors, cand);
            if (m2 < mf - 1e-12) { spacers = cand; mf = m2; improved = true; }
        }
    }
    return { spacers, mf, improved };
}

/**
 * Coordinate descent from a starting (mirrors, spacers) vector to a local
 * minimum of `ctx.mfOf`, alternating mirror and spacer improvement sweeps until
 * neither improves (or the iteration guard trips). Mirror counts stay odd
 * (±2/±4 moves); spacer orders move by ±1/±2.
 *
 * @param {number[]} mirrors0 @param {number[]} spacers0  starting vectors
 * @param {object} ctx  { clampMirror, clampOrder, mfOf, symMirrors, symCavities, dH, dL, spacerIsL }
 * @returns {{mirrors, spacers, mf, layers:number, thicknessNm:number}}
 */
export function descend(mirrors0, spacers0, ctx) {
    const { clampMirror, clampOrder, mfOf, symMirrors, symCavities, dH, dL, spacerIsL } = ctx;
    let mirrors = mirrors0.map(clampMirror);
    let spacers = spacers0.map(clampOrder);
    let mf = mfOf(mirrors, spacers);
    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
        improved = false;
        const rm = tryImproveMirrors(mirrors, spacers, mf, { clampMirror, mfOf, symMirrors });
        mirrors = rm.mirrors; mf = rm.mf; if (rm.improved) improved = true;
        const rs = tryImproveSpacers(mirrors, spacers, mf, { clampOrder, mfOf, symCavities });
        spacers = rs.spacers; mf = rs.mf; if (rs.improved) improved = true;
    }
    const sym = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
    return {
        mirrors: sym.mirrors, spacers: sym.spacers, mf,
        layers: structureLayerCount(sym.mirrors, sym.spacers),
        thicknessNm: structureThickness(sym.mirrors, sym.spacers, dH, dL, spacerIsL),
    };
}
