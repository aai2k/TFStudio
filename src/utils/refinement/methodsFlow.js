// The method flow: every method but 'dls' or 'dls-multi' alone, and any list
// of two or more methods ('all' is ALL_ORDER). Each method runs from the same
// start and the best result across them is kept. The engines run in optimizer workers
// (engineRun.js) or, for parallel DE, in a pool of MF-evaluation workers
// (deEngine.js).

import { DLSOptimizer } from '../physics/optimizer.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { randomSeed } from '../physics/errorAnalysis/mcConfig.js';
import { STOCHASTIC_METHODS, countFreeVars, endReasonFor } from './methods.js';
import { appendMfSample } from './meritTrend.js';
import { runEngineP } from './engineRun.js';
import { runParallelDEP } from './deEngine.js';
import { runMultiP } from './listMultiStart.js';

// Pick + run the engine for method m (F bundles the shared run config).
function runMethodOnce(R, m, F) {
    const mi = F.singleMethod ? R.plan.maxIter : undefined;
    const seed = F.seed;
    if (m === 'de' && R.makeEvalPool && countFreeVars(F.curDes) >= 4)
        return runParallelDEP(R, { ops: F.ops, payload: F.payload, materials: F.materials, alive: F.alive, onProg: F.onProg, maxIterOverride: mi, seed });
    if (m === 'dls-multi')
        return runMultiP(R, { ops: F.ops, payload: F.payload, materials: F.materials, N: R.plan.nRestarts, pct: R.plan.perturbPct, alive: F.alive, onProg: F.onProg, seed });
    return runEngineP(R, m, { ops: F.ops, payload: F.payload, materials: F.materials, alive: F.alive, onProg: F.onProg, preview: true, maxIterOverride: mi, seed });
}

// Track the global best across methods. Reports it as soon as one method beats
// the start rather than at the end of the flow, so a Stop part-way through a
// list can still hand back the best design found so far.
function trackGlobalBest(R, m, res, best) {
    if (!(res.mf < best.cur.mf)) return;
    best.cur = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
    R.onProgress({
        omfBest: best.cur.omf,
        best: { mf: best.cur.mf, omf: best.cur.omf, frontLayers: best.cur.frontLayers, backLayers: best.cur.backLayers },
    });
}

// One Design History row. Only a method that ran to its own stopping point gets
// one: the strip is a record of completed runs, and a row cut short by Stop
// would read as a result the method actually reached. A stochastic method's row
// keeps the seed it drew from.
function recordMethodResult(R, F, m, res) {
    R.onRecord({
        method: m,
        iter: F.completedMethodIters, mf: res.mf, omf: res.omf,
        frontLayers: res.frontLayers, backLayers: res.backLayers, layerSide: F.layerSide,
        mfHistory: [...F.methodHistory],
        ...(STOCHASTIC_METHODS.has(m) ? { seed: F.seed } : {}),
    });
}

// How the flow ended: a single method reports how it ended (endReasonFor); a
// list names the method whose result it kept.
function flowStopReason(gb, methods, lastReason) {
    if (methods.length === 1) return endReasonFor(gb.mf, lastReason);
    if (gb.mf < 1e-6) return 'target';
    return gb.method ? `best:${gb.method}` : 'stalled';
}

// A run whose every method had its worker fail produced nothing: it ends as the
// DLS pool does, 'workerFailed' when no method got as far as a result, and
// 'workerError' when one failed after reporting progress.
function failedRunReason(F) {
    if (F.produced > 0 || F.failed === 0) return null;
    return F.failedAfterProgress ? 'workerError' : 'workerFailed';
}

// The flow's result. A run cut short by Stop, or one whose workers all failed,
// leaves the end-of-run readout alone; only a run that got to the end of its
// method list reports its final readout.
function finalizeMethodsFlow(R, F, gb, methods) {
    const completed = F.alive();
    const result = {
        completed, stopReason: 'stopped',
        mf: gb.mf, omf: gb.omf, mfInitial: F.baseMF, omfInitial: F.baseOMF,
        iter: F.iterationOffset,
        frontLayers: gb.frontLayers, backLayers: gb.backLayers,
        seed: F.seed,
    };
    if (!completed) return result;
    const failure = failedRunReason(F);
    if (failure) return { ...result, completed: false, stopReason: failure };
    R.onProgress({ iter: F.iterationOffset, mf: gb.mf, mfBest: gb.mf, omf: gb.omf, omfBest: gb.omf });
    if (methods.length > 1) console.log(`[Refine] Try-all done: best = ${gb.method} (MF=${gb.mf.toFixed(6)})`);
    return { ...result, stopReason: flowStopReason(gb, methods, F.lastReason) };
}

// The unperturbed start, evaluated on the calling thread, seeds the global best.
function evalStart(R, ops, payload) {
    let baseMF = Infinity, baseOMF = null;
    try {
        const b = new DLSOptimizer(ops, payload, designMaterialLookup(R.design));
        baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses);
        R.onProgress({ mfInitial: b.mf, omfInitial: baseOMF });
    } catch (_) {}
    return { baseMF, baseOMF };
}

function updateFlowProgress(F, mfNow, iters, omfNow) {
    const { R, best } = F;
    const reportedIter = Number(iters);
    const localIter = Number.isFinite(reportedIter) ? Math.max(0, reportedIter) : F.lastMethodIter;
    F.lastMethodIter = Math.max(F.lastMethodIter, localIter);
    F.methodHistory = appendMfSample(F.methodHistory, localIter, mfNow);
    const y = Math.min(best.cur.mf, mfNow);
    const patch = { mf: mfNow, mfBest: y };
    if (omfNow != null) patch.omf = omfNow;
    patch.omfBest = best.cur.omf;
    const totalIter = F.iterationOffset + localIter;
    F.aggregateHistory = appendMfSample(F.aggregateHistory, totalIter, y);
    patch.iter = totalIter;
    patch.mfHistory = F.aggregateHistory;
    R.onProgress(patch);
}

function beginMethod(F, method, methodIndex) {
    const { R, best, baseMF, methodCount } = F;
    F.lastMethodIter = 0;
    F.methodHistory = [{ iter: 0, mf: baseMF }];
    F.aggregateHistory = appendMfSample(F.aggregateHistory, F.iterationOffset, best.cur.mf);
    R.onProgress({ mfHistory: F.aggregateHistory });
    R.onMethodStart(method, methodIndex);
    if (methodCount > 1) R.onProgress({ restartIdx: methodIndex + 1 });
}

// Counts how a method ended: with a result, or with its worker failing (after
// progress or not). A Stop before any progress hands back no result at all.
function countOutcome(F, result) {
    if (!result) return;
    if (!result.failed) { F.produced += 1; return; }
    F.failed += 1;
    if (result.mf != null) F.failedAfterProgress = true;
}

function completeMethod(F, method, result) {
    const { R, best } = F;
    const reportedIter = Number(result?.iters);
    const resultIters = Number.isFinite(reportedIter) ? Math.max(0, reportedIter) : 0;
    F.completedMethodIters = Math.max(F.lastMethodIter, resultIters);
    F.lastReason = result?.reason;
    countOutcome(F, result);
    if (result && result.mf != null) {
        F.methodHistory = appendMfSample(F.methodHistory, F.completedMethodIters, result.mf);
        trackGlobalBest(R, method, result, best);
        // A method interrupted by Stop, or whose worker failed, still contributes
        // whatever it found to the global best, but leaves no history row (see
        // recordMethodResult).
        if (F.alive() && !result.failed) recordMethodResult(R, F, method, result);
    }
    F.iterationOffset += F.completedMethodIters;
    R.onProgress({ iter: F.iterationOffset });
}

async function executeMethods(F, methods) {
    try {
        for (let i = 0; i < methods.length; i++) {
            if (!F.alive()) break;
            const method = methods[i];
            beginMethod(F, method, i);
            const result = await runMethodOnce(F.R, method, F);
            completeMethod(F, method, result);
        }
    } catch (err) { console.error('[Refine] method flow error:', err); }
}

/**
 * Runs `prep` (runRefinement's prepared operands, materials and payload) with
 * each method of the plan in turn. Each method runs from the SAME start and the
 * global best across methods is kept. INDEPENDENT (not a relay): a relay variant
 * tended to dip on the first improving method and then stall, because the local
 * methods can't escape that basin and the globals have nothing left to improve.
 */
export async function runMethodsFlow(R, prep) {
    const methods = R.plan.methods;
    const { ops, materials, payload } = prep;
    const seed = methods.some(m => STOCHASTIC_METHODS.has(m)) ? (R.plan.seed ?? randomSeed()) : null;
    R.onStart({ seed });
    const { baseMF, baseOMF } = evalStart(R, ops, payload);
    R.onProgress({
        mfHistory: [{ iter: 0, mf: baseMF }], iter: 0, restartIdx: 0,
        mf: baseMF, mfBest: baseMF, omf: baseOMF, omfBest: baseOMF,
    });

    const best = { cur: { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null } };
    const F = {
        R, best, baseMF, baseOMF, methodCount: methods.length,
        ops, payload, materials, curDes: R.design,
        layerSide: payload.surfaceMode === 'back_only' ? 'backLayers' : 'frontLayers',
        alive: () => !R.aborted(),
        seed,
        singleMethod: methods.length === 1,
        iterationOffset: 0, lastMethodIter: 0, completedMethodIters: 0,
        produced: 0, failed: 0, failedAfterProgress: false,
        methodHistory: [], aggregateHistory: [{ iter: 0, mf: baseMF }],
    };
    F.onProg = (mfNow, iters, omfNow) => updateFlowProgress(F, mfNow, iters, omfNow);

    await executeMethods(F, methods);

    return finalizeMethodsFlow(R, F, best.cur, methods);
}
