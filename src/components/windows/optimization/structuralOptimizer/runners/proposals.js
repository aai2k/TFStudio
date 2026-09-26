import {
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
} from '../../../../../utils/physics/optimizer.js';
import { proposeMutation, pickAcceptedMove } from '../../../../../utils/synthesis/structuralOptimizer.js';
import { materialLookup } from '../../synthesisShared/materialNames.js';
import { alive } from './runUtils.js';
import { designFor, refineJob, onTick, normalizeResult } from './refine.js';
import { refineGuarded } from './workerLifecycle.js';
import { splitRefined, adoptPolish, isSameDesign } from './sameDesign.js';

const SCAN_DELTA = 0.5;

export function needleProposals(S, current, count) {
    if (!S.pool.length || count <= 0) return [];
    const design = {
        ...S.media,
        [S.layerKey]: current[S.layerKey],
        [S.otherKey]: current[S.otherKey],
    };
    const resolveMat = materialLookup(S.curDes);
    let candidates;
    try {
        ({ candidates } = scanNeedlesPFunction({
            operands: S.operands, design, resolveMat, candidateMats: S.pool,
            deltaNm: SCAN_DELTA, side: S.side, dMin: S.cfg.dMin,
        }));
    } catch (err) {
        console.warn('[Structural] needle scan failed:', err);
        return [];
    }
    const improving = (candidates || []).filter(candidate => candidate.dMF < 0)
        .sort((a, b) => a.dMF - b.dMF);
    const proposals = [];
    for (let i = 0; i < improving.length && proposals.length < count; i++) {
        const candidate = improving[i];
        let thickness = S.cfg.dMin;
        try {
            thickness = findOptimalNeedleThickness({
                operands: S.operands, design, resolveMat, candidate,
                deltaNm: S.cfg.dMin, maxNm: Math.min(500, S.cfg.dMax), tol: 0.5, side: S.side,
            });
            if (!(thickness >= S.cfg.dMin)) thickness = S.cfg.dMin;
        } catch (_) {
            thickness = S.cfg.dMin;
        }
        const nextDesign = candidate.intra
            ? insertNeedleIntra(design, candidate, thickness, S.side)
            : insertNeedle(design, candidate.pos, candidate.materialId, thickness, S.side);
        proposals.push({
            layers: nextDesign[S.layerKey],
            mutation: {
                kind: candidate.intra ? 'split' : 'add',
                pos: candidate.intra ? candidate.layerK : candidate.pos,
                materialId: candidate.materialId,
                insertMat: candidate.materialId,
                thickness,
            },
        });
    }
    return proposals;
}

export function generateProposals(S) {
    const currentLayers = S.current[S.layerKey] || [];
    const atCap = currentLayers.filter(layer => !layer.locked).length >= S.cfg.maxLayers;
    const enabledKinds = atCap
        ? S.kinds.filter(kind => kind !== 'add' && kind !== 'split')
        : S.kinds;
    if (!enabledKinds.length) return { reason: S.ts.statusCap, proposals: [] };

    const proposals = [];
    if (enabledKinds.includes('add') || enabledKinds.includes('split')) {
        proposals.push(...needleProposals(S, S.current, Math.ceil(S.workerCount / 2)));
    }
    // The needles are the insertions that improve the merit to first order; the
    // remaining slots take random mutations of every enabled kind, so layers too
    // thick for a needle (at a high Min thickness) still get proposed.
    for (let index = proposals.length; index < S.workerCount; index++) {
        const proposal = proposeMutation(currentLayers, {
            rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
            addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct, kinds: enabledKinds,
        });
        if (proposal) proposals.push(proposal);
    }
    return { reason: proposals.length ? null : S.ts.statusNoMut, proposals };
}

export async function refineProposals(ctx, S, proposals) {
    ctx.setStatusMsg(S.ts.statusRefining(proposals.length));
    const otherLayers = S.current[S.otherKey];
    const results = await Promise.all(proposals.map((proposal, index) => refineGuarded(
        ctx, S, index, refineJob(S, designFor(S, proposal.layers, otherLayers)),
        index === 0 ? message => onTick(ctx, S, message) : null)
        .then(result => (result ? { result, proposal } : null))));
    if (!alive(ctx, S)) return null;
    return splitRefined(S, results);
}

// The move the chain takes from a batch. When the lowest move beats the best
// design so far, and is not that same design refined a little further, the
// chain takes it: while the search is still descending most moves pass the
// test, and a random pick would throw away the lower designs the batch found.
// Otherwise the chain takes one of the accepted moves at random
// (pickAcceptedMove), so a downhill step back to a design already found cannot
// win every batch over an uphill step that leads on.
function takenMove(S, moves, lowest, temperature) {
    if (lowest.candidate.mf < S.best.mf - 1e-12 && !isSameDesign(S, lowest.item.result, S.best)) return lowest;
    const index = pickAcceptedMove(S.current.mf, moves.map(move => move.candidate.mf), temperature, S.rng);
    return index >= 0 ? moves[index] : null;
}

/** Takes a refined batch into the annealing chain (takenMove). The lowest move
 * of the batch, when it is a new best, goes to `recordBest` (injected by the
 * caller to avoid a dependency on the iteration loop) whether or not the chain
 * took it. Returns true when the target merit is reached. */
export function acceptProposal(ctx, S, batch, temperature, recordBest) {
    if (batch?.polish && adoptPolish(ctx, S, batch.polish, recordBest)) return true;
    const moves = (batch?.moves || []).map(item => ({ item, candidate: normalizeResult(S, item.result) }))
        .filter(move => Number.isFinite(move.candidate.mf));
    if (!moves.length) {
        S.noImprove += 1;
        return false;
    }
    S.attempts += 1;
    const lowest = moves.reduce((low, move) => (move.candidate.mf < low.candidate.mf ? move : low));
    const taken = takenMove(S, moves, lowest, temperature);
    if (taken) {
        S.accepts += 1;
        S.current = taken.candidate;
    }
    if (lowest.candidate.mf < S.best.mf - 1e-12) {
        return recordBest(ctx, S, lowest.candidate, lowest.item.proposal.mutation);
    }
    S.noImprove += 1;
    return false;
}
