import { makeCandidate } from './candidateBuilder.js';
import { tryImproveCompound, tryImproveJoint } from './descentMoves.js';

/** Accept a neighbour only when it improves the merit by more than round-off. */
const better = (m2, mf) => m2 < mf - 1e-12;

/** One mirror-vector improvement sweep: try ±1/±2 on each mirror. */
function tryImproveMirrors(mirrors, spacers, mf, { clampMirror, mfOf, symMirrors }) {
    let improved = false;
    for (let i = 0; i < mirrors.length; i++) {
        if (symMirrors && i > Math.floor(mirrors.length / 2)) continue; // mirrored half follows
        for (const delta of [1, -1, 2, -2]) {
            const cand = mirrors.slice(); cand[i] = clampMirror(cand[i] + delta);
            if (cand[i] === mirrors[i]) continue;
            const m2 = mfOf(cand, spacers);
            if (better(m2, mf)) { mirrors = cand; mf = m2; improved = true; }
        }
    }
    return { mirrors, spacers, mf, improved };
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
            if (better(m2, mf)) { spacers = cand; mf = m2; improved = true; }
        }
    }
    return { mirrors, spacers, mf, improved };
}

const SWEEPS = [tryImproveMirrors, tryImproveSpacers, tryImproveCompound, tryImproveJoint];

/**
 * Coordinate descent from a starting (mirrors, spacers) vector to a local
 * minimum of `ctx.mfOf`, running the four improvement sweeps in turn until
 * none improves (or the iteration guard trips). Both vectors move by ±1/±2;
 * the ±1 mirror move is what lets the descent change a mirror's parity, and so
 * the material of the spacers beside it. The compound and joint sweeps
 * (descentMoves.js) move a spacer against its mirrors, the trade the
 * single-variable sweeps cannot make.
 *
 * @param {number[]} mirrors0 @param {number[]} spacers0  starting vectors
 * @param {object} ctx  { clampMirror, clampOrder, mfOf, partsOf, symMirrors, symCavities, dH, dL }
 * @returns {{mirrors, spacers, mf, mf0, mfTilt, layers:number, thicknessNm:number}}
 */
export function descend(mirrors0, spacers0, ctx) {
    let mirrors = mirrors0.map(ctx.clampMirror);
    let spacers = spacers0.map(ctx.clampOrder);
    let mf = ctx.mfOf(mirrors, spacers);
    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
        improved = false;
        for (const sweep of SWEEPS) {
            const r = sweep(mirrors, spacers, mf, ctx);
            mirrors = r.mirrors; spacers = r.spacers; mf = r.mf;
            if (r.improved) improved = true;
        }
    }
    return makeCandidate(mirrors, spacers, ctx);
}
