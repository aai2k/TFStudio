import {
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
} from '../../../../../utils/physics/optimizer.js';
import { proposeMutation, metropolisAccept } from '../../../../../utils/synthesis/structuralOptimizer.js';
import { resolveMat } from '../../synthesisShared/synthesisHelpers.js';
import { alive } from './runUtils.js';
import { designFor, refineJob, onTick, normalizeResult } from './refine.js';
import { refineGuarded } from './workerLifecycle.js';

const SCAN_DELTA = 0.5;

export function needleProposals(S, current, count) {
    if (!S.pool.length || count <= 0) return [];
    const design = {
        ...S.media,
        [S.layerKey]: current[S.layerKey],
        [S.otherKey]: current[S.otherKey],
    };
    let candidates;
    try {
        ({ candidates } = scanNeedlesPFunction({
            operands: S.operands, design, resolveMat, candidateMats: S.pool,
            deltaNm: SCAN_DELTA, side: S.side,
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
    const randomKinds = enabledKinds.filter(kind => kind !== 'add' && kind !== 'split');
    const fillKinds = randomKinds.length ? randomKinds : enabledKinds;
    for (let index = proposals.length; index < S.workerCount; index++) {
        const proposal = proposeMutation(currentLayers, {
            rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
            addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct, kinds: fillKinds,
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
    let best = null;
    for (const item of results) {
        if (!item || item.result.mf == null) continue;
        if (!best || item.result.mf < best.result.mf) best = item;
    }
    return best;
}

/** Applies the metropolis test to the best refined proposal and, on a new best, hands
 * it to `recordBest` (injected by the caller to avoid a dependency on the iteration loop). */
export function acceptProposal(ctx, S, bestResult, temperature, recordBest) {
    if (!bestResult) {
        S.noImprove += 1;
        return false;
    }
    S.attempts += 1;
    const candidate = normalizeResult(S, bestResult.result);
    const isNewBest = candidate.mf < S.best.mf - 1e-12;
    if (metropolisAccept(S.current.mf, candidate.mf, temperature, S.rng)) {
        S.accepts += 1;
        S.current = candidate;
    }
    if (isNewBest) return recordBest(ctx, S, candidate, bestResult.proposal.mutation);
    S.noImprove += 1;
    return false;
}
