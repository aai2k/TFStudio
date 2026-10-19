// Refining a Structural proposal on a worker and scoring what comes back.

import {
    requiredLambdas, collectDesignMaterialIds, mirrorLayers, buildPresampledTable, isPhaseDispersion,
    buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../physics/optimizer.js';
import { tidyLayers } from '../synthesis/structuralOptimizer.js';
import { materialLookup } from '../../components/windows/optimization/synthesisShared/materialNames.js';
import { regridForDesign } from '../../components/windows/optimization/synthesisShared/runGrid.js';
import { deep, mkLayers } from './core.js';
import { refineGuarded } from './workers.js';

// Worker material tables for every material the design and the pool use, built
// as every other run builds them, so a worker refine scores the merit the main
// thread scores, stress and phase rows included.
export function presampleAll(design, operands, pool) {
    const resolveMat = materialLookup(design);
    const ids = new Set(collectDesignMaterialIds(design));
    for (const material of pool) ids.add(material.id);
    ids.add('Air');
    const pairs = [...ids].map(id => ({ id, mat: resolveMat(id) }));
    return buildPresampledTable(requiredLambdas(operands), pairs, {
        includeOmegaResponses: operands.some(op => op.enabled && isPhaseDispersion(op.type)),
    });
}

export function designFor(S, activeLayers, otherLayers) {
    const design = { ...S.media };
    design[S.layerKey] = mkLayers(activeLayers);
    if (S.surfaceMode === 'symmetric' && S.layerKey === 'frontLayers') {
        design.backLayers = mirrorLayers(design.frontLayers);
    } else {
        design[S.otherKey] = mkLayers(otherLayers);
    }
    return design;
}

export function trueEval(S, frontLayers, backLayers, fallbackMf, fallbackOmf) {
    try {
        const resolveMat = materialLookup(S.curDes);
        const design = { ...S.media, frontLayers: frontLayers || [], backLayers: backLayers || [] };
        const computed = evaluateOperands(S.fullOps, buildEvalContext(design, resolveMat));
        const mf = calcMF(S.fullOps, computed);
        const omf = calcOMF(S.fullOps, computed);
        if (Number.isFinite(mf)) {
            return { mf, omf: Number.isFinite(omf) ? omf : (fallbackOmf ?? null) };
        }
    } catch (_) {}
    return { mf: fallbackMf, omf: fallbackOmf ?? null };
}

// When the current design has outgrown the run's sampling grid (runGrid.js),
// move both operand lists onto a grid for it, re-sample the worker material
// tables, and re-score `current` and `best` so the Metropolis comparisons stay
// on one grid.
export function regridIfGrown(S) {
    const resolveMat = materialLookup(S.curDes);
    const design = { ...S.media, frontLayers: S.current.frontLayers || [], backLayers: S.current.backLayers || [] };
    const operands = regridForDesign(S.operands, design, resolveMat);
    if (!operands) return;
    S.operands = operands;
    S.fullOps = regridForDesign(S.fullOps, design, resolveMat) || S.fullOps;
    S.materials = presampleAll(S.curDes, operands, S.pool);
    for (const held of [S.current, S.best]) {
        if (!held.frontLayers && !held.backLayers) continue;
        Object.assign(held, trueEval(S, held.frontLayers, held.backLayers, held.mf, held.omf));
    }
    S.prevBestMF = S.best.mf;
    console.log(`[Structural] Grid re-sampled for the grown design: bestMF=${S.best.mf.toFixed(6)}`);
}

export function refineJob(S, design) {
    return {
        type: 'start', method: S.structEngine, operands: S.operands, design,
        materials: S.materials, opts: { maxIter: S.cfg.refineIter },
        engineOpts: { dMin: S.cfg.dMin, dMax: S.cfg.dMax }, wasmBytes: S.wasmBytes,
    };
}

export function normalizeResult(S, result) {
    const rawActive = S.layerKey === 'frontLayers' ? result.frontLayers : result.backLayers;
    const tidied = tidyLayers(rawActive || [], S.cfg.dMin);
    const frontLayers = S.layerKey === 'frontLayers' ? tidied : deep(result.frontLayers);
    const backLayers = S.layerKey === 'backLayers'
        ? tidied
        : (S.surfaceMode === 'symmetric' ? mirrorLayers(tidied) : deep(result.backLayers));
    const score = trueEval(S, frontLayers, backLayers, result.mf, result.omf ?? null);
    return { mf: score.mf, omf: score.omf, frontLayers, backLayers };
}

export async function refineScore(S, activeLayers, otherLayers, workerIndex = 0) {
    const result = await refineGuarded(
        S, workerIndex, refineJob(S, designFor(S, activeLayers, otherLayers)), null);
    return result ? normalizeResult(S, result) : null;
}
