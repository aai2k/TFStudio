import { isConstraint } from '../../../../../utils/physics/optimizer.js';
import { normalizeSeed, randomSeed } from '../../../../../utils/physics/errorAnalysis/mcConfig.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { makeEvaluator, DEFAULT_ENGINE } from '../../../../../utils/synthesis/deepSynthesis/evaluator.js';
import { DEFAULT_TARGET_MF } from '../../../../../utils/synthesis/deepSynthesis/trace.js';
import { blockedReason, deepSynthesisParts } from '../../../../../utils/synthesis/deepSynthesis/capabilities.js';
import { DEEP_SYNTHESIS_DEFAULTS } from '../../../../../utils/synthesis/deepSynthesis/index.js';
import { activeSide, densifyForRun, serializableMedia } from '../../synthesisShared/synthesisMath.js';
import { getPoolMaterials } from '../../synthesisShared/catalogPool.js';
import { presampleSynthesisMaterials } from '../../synthesisShared/runGrid.js';
import { embedDesignMaterials, isBuiltinId } from '../../../../../utils/materials/designMaterials.js';
import { stripGetNK } from '../../../../../utils/materials/catalogManager/persistence.js';
import { activeBaseline, openRunBlock } from '../../synthesisShared/runBlocks.js';
import { applyConstraintBounds } from '../../structuralOptimizer/runners/runState.js';
import { reconcileWithEdits } from '../historyActions.js';

const toLayers = layers => (layers || []).map(({ material, thickness }) => ({ material, thickness }));
const layerKeyOf = side => (side === 'back' ? 'backLayers' : 'frontLayers');

// The method's constants, with any section the caller overrides merged over
// DEEP_SYNTHESIS_DEFAULTS. The window passes none; the guard test passes a
// smaller search budget (rounds and children).
function methodOptions(overrides = {}) {
    const merged = { ...DEEP_SYNTHESIS_DEFAULTS };
    for (const [key, value] of Object.entries(overrides)) {
        merged[key] = value && typeof value === 'object' ? { ...merged[key], ...value } : value;
    }
    return merged;
}

function checkDesign(state) {
    state.curDes = state.ctx.hist.baseDesign || state.ctx.designRef.current;
    return !!state.curDes;
}

// A locked layer, an empty pool or no optical operand refuses the run, with
// the reason in the status line.
function checkBlocked(state) {
    const { ctx, curDes } = state;
    state.enabled = ctx.operandsRef.current.filter(op => op.enabled);
    state.pool = getPoolMaterials(ctx.selectedCatsRef.current, { excluded: ctx.excludedMatsRef.current, design: curDes });
    const reason = blockedReason(curDes, {
        pool: state.pool.map(material => material.id),
        operands: state.enabled.filter(op => !isConstraint(op.type)),
    });
    if (reason) ctx.publish({ statusMsg: ctx.td.blocked[reason] });
    return !reason;
}

// MNT and MXT leave the operands and become the floor and the upper bound
// (nm), the rule Structural applies.
function checkOperands(state) {
    const { cfg, curDes, enabled } = state;
    state.operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    applyConstraintBounds(cfg, enabled);
    return true;
}

function otherLayersOf(design, side) {
    if (design.surfaceMode === 'symmetric') return [];
    return toLayers(design[side === 'back' ? 'frontLayers' : 'backLayers']);
}

function buildSpec({ cfg, curDes, operands, pool, method }) {
    const side = activeSide(curDes);
    return {
        operands, base: serializableMedia(curDes), referenceWavelength: curDes.referenceWavelength,
        side, otherLayers: otherLayersOf(curDes, side),
        pool: pool.map(material => material.id),
        dMin: cfg.dMin, dMax: cfg.dMax, maxLayers: cfg.maxLayers,
        engine: DEFAULT_ENGINE, refine: method.refine, targetMf: DEFAULT_TARGET_MF,
    };
}

// The run's evaluator. Its spec and presampled tables go to the run worker,
// which builds its own from them, and to every job, so every merit of the run
// comes from one set of tables; this copy names the parts in use and rescores
// the best recorded design when the run regrids (runWorker.js).
function checkEvaluator(state) {
    try {
        state.materials = presampleSynthesisMaterials(state.curDes, state.operands, state.pool);
        state.ev = makeEvaluator(buildSpec(state), { materials: state.materials });
        return true;
    } catch (err) {
        console.error('[DeepSynthesis] pre-sampling failed:', err);
        state.ctx.publish({ statusMsg: state.ctx.td.statusPresampleFailed });
        return false;
    }
}

// Open a run block for this press unless one is still open from a Stop. The
// block records the design the press started from, which Reset restores.
export function openBlock(ctx, S) {
    const hist = ctx.hist;
    if (hist.runOpen) return;
    ctx.checkpoint?.();
    hist.runs = openRunBlock(hist.runs, ctx.designRef.current);
    Object.assign(hist, { savedDesign: activeBaseline(hist.runs), baseDesign: S.curDes, genCount: 0, runOpen: true });
    ctx.publish({ canReset: true });
}

// What the run worker samples materials from when the run regrids: the design
// with its non-built-in materials embedded, and the pool's non-built-in
// materials as records (the form a .tfs file carries them in). Built-in
// materials resolve by id in the worker.
function materialSource(curDes, pool) {
    const records = pool.filter(material => !isBuiltinId(material.id))
        .map(material => [material.id, stripGetNK(material.mat)]);
    return { design: embedDesignMaterials(curDes), pool: Object.fromEntries(records) };
}

const lastOf = list => list[list.length - 1];

function finalizeRunState(state) {
    const { ctx, cfg, curDes, ev } = state;
    const seed = normalizeSeed(cfg.seed) ?? randomSeed();
    const side = activeSide(curDes);
    const layerKey = layerKeyOf(side);
    return {
        cfg, curDes, ev, pool: state.pool, method: state.method, seed, source: materialSource(curDes, state.pool),
        side, layerKey, surfaceMode: curDes.surfaceMode || 'front_only', start: toLayers(curDes[layerKey]),
        runId: ++ctx.runIdRef.current, threads: cfg.threads ?? getThreadCount(),
        runT0: performance.now() - (lastOf(ctx.hist.rows)?.tMs || 0),
        trendX: lastOf(ctx.hist.trend)?.iter ?? 0,
        parts: deepSynthesisParts(ev), phase: null, steps: 0,
        bestMf: Infinity, bestLayers: null,
    };
}

const RUN_STATE_STEPS = [checkDesign, checkBlocked, checkOperands, checkEvaluator];

// Everything a run needs, or null when it cannot start (the status says why).
// The run block is opened once the run worker has loaded (runWorker.js).
export function createRunState(ctx) {
    reconcileWithEdits(ctx);
    const cfg = { ...ctx.cfgRef.current };
    const state = { ctx, cfg, method: methodOptions(cfg.method) };
    for (const step of RUN_STATE_STEPS) {
        if (!step(state)) return null;
    }
    return finalizeRunState(state);
}
