import {
    requiredLambdas, collectDesignMaterialIds, mirrorLayers,
    buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../../../../../utils/physics/optimizer.js';
import { tidyLayers } from '../../../../../utils/synthesis/structuralOptimizer.js';
import { materialLookup } from '../../synthesisShared/materialNames.js';
import { regridForDesign } from '../../synthesisShared/runGrid.js';
import { deep, mkLayers } from './runUtils.js';
import { refineGuarded } from './workerLifecycle.js';

export function presampleAll(design, operands, pool) {
    const resolveMat = materialLookup(design);
    const lambdas = requiredLambdas(operands);
    const ids = new Set(collectDesignMaterialIds(design));
    for (const material of pool) ids.add(material.id);
    ids.add('Air');
    const materials = {};
    for (const id of ids) {
        const mat = resolveMat(id);
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0];
            k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
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

export function onTick(ctx, S, message) {
    const now = Date.now();
    if (now - S.lastTick < 100) return;
    S.lastTick = now;
    if (message.mf != null) ctx.setMf(message.mf);
    if (message.omf != null) ctx.setOmf(message.omf);
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

export async function refineScore(ctx, S, activeLayers, otherLayers, workerIndex = 0) {
    const result = await refineGuarded(
        ctx, S, workerIndex, refineJob(S, designFor(S, activeLayers, otherLayers)), null);
    return result ? normalizeResult(S, result) : null;
}
