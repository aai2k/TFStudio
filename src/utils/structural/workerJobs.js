// The work of a Structural run its optimizer workers do besides refining
// (workers/optimizerJob.js): the needle scan, the insertion of one needle, and
// the tidied design and full merit of a refine. Materials come from the job's
// tables, which hold the values the run's own materials give at every
// wavelength (workers/resolveMat.js), so each merit here is the one the run's
// thread would compute.

import {
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
    mirrorLayers, buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../physics/optimizer.js';
import { tidyLayers } from '../synthesis/structuralOptimizer.js';
import { deep } from './core.js';

/**
 * The merit and optical merit of `design` on `operands`. `fallbackMf` stands in
 * when the merit cannot be evaluated or is not finite, and `fallbackOmf` for an
 * optical merit that is not finite.
 */
export function scoreDesign(operands, design, resolveMat, fallbackMf, fallbackOmf) {
    try {
        const computed = evaluateOperands(operands, buildEvalContext(design, resolveMat));
        const mf = calcMF(operands, computed);
        const omf = calcOMF(operands, computed);
        if (Number.isFinite(mf)) {
            return { mf, omf: Number.isFinite(omf) ? omf : (fallbackOmf ?? null) };
        }
    } catch (_) {}
    return { mf: fallbackMf, omf: fallbackOmf ?? null };
}

/**
 * A refined design as the run keeps it. The side the run works on (`layerKey`)
 * is tidied: same-material neighbours merged and layers under `dMin` nm taken
 * out (tidyLayers). A symmetric design's back side is the mirror of the tidied
 * front; otherwise the other side stays as refined.
 */
export function tidyRefined({ layerKey, dMin, surfaceMode }, frontLayers, backLayers) {
    const tidied = tidyLayers((layerKey === 'frontLayers' ? frontLayers : backLayers) || [], dMin);
    if (layerKey === 'backLayers') return { frontLayers: deep(frontLayers), backLayers: tidied };
    return { frontLayers: tidied, backLayers: surfaceMode === 'symmetric' ? mirrorLayers(tidied) : deep(backLayers) };
}

/**
 * The poster for a refine job that carries `structuralScore: { operands, tidy }`:
 * its 'done' message gains `scored`, the merit and optical merit on `operands`
 * of the best design, tidied when `tidy` ({ layerKey, dMin, surfaceMode }) is
 * given, with the tidied layers. When the merit cannot be evaluated the
 * refine's own best merit stands in.
 */
export function withStructuralScore(job, resolveMat, post) {
    const { operands, tidy } = job.structuralScore;
    return message => {
        if (message.type !== 'done') { post(message); return; }
        const front = message.bestFrontLayers, back = message.bestBackLayers;
        const layers = tidy ? tidyRefined(tidy, front, back) : null;
        const design = {
            ...job.design,
            frontLayers: (layers ? layers.frontLayers : front) || [],
            backLayers: (layers ? layers.backLayers : back) || [],
        };
        const score = scoreDesign(operands, design, resolveMat, message.mfBest, message.omfBest);
        post({ ...message, scored: layers ? { ...score, ...layers } : score });
    };
}

// The needle scan of the job's design: the insertions of its pool materials
// that lower the merit to first order, the best first, at most `count`.
function needleScan(job, resolveMat) {
    const candidateMats = job.pool.map(({ id, name }) => ({ id, name, mat: resolveMat(id) }));
    const { candidates } = scanNeedlesPFunction({
        operands: job.operands, design: job.design, resolveMat, candidateMats,
        deltaNm: job.deltaNm, side: job.side, dMin: job.dMin,
    });
    return (candidates || []).filter(candidate => candidate.dMF < 0)
        .sort((a, b) => a.dMF - b.dMF)
        .slice(0, job.count);
}

// One needle of the scan inserted into the job's design, at the thickness the
// line search finds between dMin and maxNm, or at dMin when it finds none.
// Returns the layers of the side the run works on and the mutation.
function placeNeedle(job, resolveMat) {
    const { candidate, design, side, dMin } = job;
    let thickness = dMin;
    try {
        thickness = findOptimalNeedleThickness({
            operands: job.operands, design, resolveMat, candidate,
            deltaNm: dMin, maxNm: job.maxNm, tol: 0.5, side,
        });
        if (!(thickness >= dMin)) thickness = dMin;
    } catch (_) {
        thickness = dMin;
    }
    const next = candidate.intra
        ? insertNeedleIntra(design, candidate, thickness, side)
        : insertNeedle(design, candidate.pos, candidate.materialId, thickness, side);
    return {
        layers: next[job.layerKey],
        mutation: {
            kind: candidate.intra ? 'split' : 'add',
            pos: candidate.intra ? candidate.layerK : candidate.pos,
            materialId: candidate.materialId,
            insertMat: candidate.materialId,
            thickness,
        },
    };
}

// Each answers with one { type: 'structural', result } message.
export const STRUCTURAL_JOBS = {
    structuralNeedleScan: needleScan,
    structuralNeedle: placeNeedle,
};
