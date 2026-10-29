// Refining a Structural proposal on a worker and scoring what comes back.

import {
    requiredLambdas, collectDesignMaterialIds, mirrorLayers, buildPresampledTable, isPhaseDispersion,
} from '../physics/optimizer.js';
import { materialLookup } from '../../components/windows/optimization/synthesisShared/materialNames.js';
import { regridForDesign } from '../../components/windows/optimization/synthesisShared/runGrid.js';
import { mkLayers } from './core.js';
import { scoreDesign } from './workerJobs.js';
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

// The merit and optical merit of a design on every row the run scores with,
// computed on this thread.
export function trueEval(S, frontLayers, backLayers, fallbackMf, fallbackOmf) {
    const design = { ...S.media, frontLayers: frontLayers || [], backLayers: backLayers || [] };
    return scoreDesign(S.fullOps, design, materialLookup(S.curDes), fallbackMf, fallbackOmf);
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

/**
 * The refine job for `design`. Its answer carries `scored`, the merit and
 * optical merit on every row the run scores with (structural/workerJobs.js):
 * of the refined design tidied as the run keeps it, or with `tidy` false of
 * the refined design as it is.
 */
export function refineJob(S, design, tidy = true) {
    return {
        type: 'start', method: S.structEngine, operands: S.operands, design,
        materials: S.materials, opts: { maxIter: S.cfg.refineIter },
        engineOpts: { dMin: S.cfg.dMin, dMax: S.cfg.dMax }, wasmBytes: S.wasmBytes,
        structuralScore: {
            operands: S.fullOps,
            tidy: tidy ? { layerKey: S.layerKey, dMin: S.cfg.dMin, surfaceMode: S.surfaceMode } : null,
        },
    };
}

// The tidied design of a refine and its merit, as the worker scored it.
export function normalizeResult(result) {
    const { mf, omf, frontLayers, backLayers } = result.scored;
    return { mf, omf, frontLayers, backLayers };
}

export async function refineScore(S, activeLayers, otherLayers, workerIndex = 0) {
    const result = await refineGuarded(
        S, workerIndex, refineJob(S, designFor(S, activeLayers, otherLayers)), null);
    return result ? normalizeResult(result) : null;
}
