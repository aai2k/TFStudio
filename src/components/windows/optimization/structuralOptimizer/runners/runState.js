import { isConstraint } from '../../../../../utils/physics/optimizer.js';
import { makeRng, MUTATION_KINDS } from '../../../../../utils/synthesis/structuralOptimizer.js';
import {
    getSynthesisInnerEngine, getSynthesisSmartSeed, getThreadCount,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { activeSide, densifyForRun, getPoolMaterials } from '../../synthesisShared/synthesisHelpers.js';
import { presampleAll } from './refine.js';
import { createWorkers } from './workerLifecycle.js';

function applyConstraintBounds(cfg, enabled) {
    const minimums = enabled.filter(op => op.type === 'MNT' && Number.isFinite(op.target));
    const maximums = enabled.filter(op => op.type === 'MXT' && Number.isFinite(op.target));
    const minNm = minimums.length ? Math.max(...minimums.map(op => op.target)) : 0;
    const maxNm = maximums.length ? Math.min(...maximums.map(op => op.target)) : Infinity;
    cfg.dMin = Math.max(cfg.dMin, minNm);
    cfg.dMax = Math.max(cfg.dMin + 1, Math.min(2000, maxNm));
    if (minNm > 0 || Number.isFinite(maxNm)) {
        console.log(`[Structural] constraint-bound synthesis: dMin=${cfg.dMin} dMax=${cfg.dMax} (MNT=${minNm || '—'}, MXT=${Number.isFinite(maxNm) ? maxNm : '—'})`);
    }
}

function checkCurDes(state) {
    state.curDes = state.ctx.baseDesignRef.current || state.ctx.designRef.current;
    return !!state.curDes;
}

function checkOperands(state) {
    const { ctx, cfg, curDes } = state;
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    if (!operands.length) {
        ctx.setStatusMsg(ctx.ts.noOperands);
        return false;
    }
    applyConstraintBounds(cfg, enabled);
    state.operands = operands;
    return true;
}

function checkPool(state) {
    const { ctx, cfg, curDes } = state;
    const side = activeSide(curDes);
    const layerKey = side === 'back' ? 'backLayers' : 'frontLayers';
    const otherKey = layerKey === 'frontLayers' ? 'backLayers' : 'frontLayers';
    const pool = getPoolMaterials(ctx.selectedCatsRef.current, { excluded: ctx.excludedMatsRef.current });
    const needsPool = cfg.kinds.has('add') || cfg.kinds.has('split');
    const hasNonPool = cfg.kinds.has('remove') || cfg.kinds.has('merge') || cfg.kinds.has('perturb');
    if (needsPool && !pool.length && !hasNonPool) {
        ctx.setStatusMsg(ctx.ts.noMaterials);
        return false;
    }
    state.side = side;
    state.layerKey = layerKey;
    state.otherKey = otherKey;
    state.pool = pool;
    return true;
}

function checkMaterials(state) {
    const { ctx, curDes, operands, pool } = state;
    try {
        state.materials = presampleAll(curDes, operands, pool);
        return true;
    } catch (err) {
        console.error('[Structural] pre-sampling failed:', err);
        ctx.setStatusMsg('Pre-sampling failed');
        return false;
    }
}

function checkWorkers(state) {
    const { ctx, curDes } = state;
    if (!ctx.savedDesignRef.current) {
        if (ctx.checkpointRef.current) ctx.checkpointRef.current();
        ctx.savedDesignRef.current = {
            frontLayers: ctx.designRef.current.frontLayers,
            backLayers: ctx.designRef.current.backLayers,
        };
        ctx.baseDesignRef.current = curDes;
        ctx.setCanReset(true);
    }
    state.workerCount = getThreadCount();
    state.wasmBytes = getTmmWasmBytesForWorker();
    return createWorkers(ctx, state.workerCount);
}

function finalizeRunState(state) {
    const { ctx, cfg, curDes, operands, side, layerKey, otherKey, pool, materials, workerCount, wasmBytes } = state;
    const previousElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0)
        : 0;
    const runT0 = performance.now() - previousElapsed;
    const runId = ++ctx.runIdRef.current;
    const best = { mf: Infinity, omf: null, frontLayers: null, backLayers: null };
    const surfaceMode = curDes.surfaceMode || 'front_only';
    return {
        cfg, curDes, operands, fullOps: ctx.operandsRef.current.filter(op => op.enabled),
        side, layerKey, otherKey, surfaceMode, pool,
        poolLite: pool.map(material => ({ id: material.id, name: material.name })),
        materials, workerCount, wasmBytes, runId, runT0,
        media: {
            surfaceMode, mfEvalMode: curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air',
            exitMedium: curDes.exitMedium ?? 'Air',
            substrate: {
                material: curDes.substrate?.material ?? 'BK7',
                thickness: curDes.substrate?.thickness ?? 1.0,
            },
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        },
        structEngine: getSynthesisInnerEngine('structural'),
        smartSeed: getSynthesisSmartSeed('structural'),
        rng: makeRng((Date.now() ^ (ctx.genCountRef.current * 2654435761)) >>> 0),
        ts: ctx.ts, best, current: { ...best }, lastTick: 0,
        trendX: 0, accepts: 0, attempts: 0, prevBestMF: Infinity, noImprove: 0,
        patience: Math.max(15, Math.round(cfg.maxIter / 3)),
        kinds: MUTATION_KINDS.filter(kind => cfg.kinds.has(kind)),
        endTemperature: cfg.T0 * 0.005,
        coolPeriod: Math.max(40, cfg.maxIter),
        deepBudgetMs: cfg.deepMaxMin > 0 ? cfg.deepMaxMin * 60000 : 0,
        cycleStart: 1, reheatCount: 0,
    };
}

const RUN_STATE_STEPS = [checkCurDes, checkOperands, checkPool, checkMaterials, checkWorkers];

export function createRunState(ctx) {
    const state = { ctx, cfg: { ...ctx.cfgRef.current } };
    for (const step of RUN_STATE_STEPS) {
        if (!step(state)) return null;
    }
    return finalizeRunState(state);
}
