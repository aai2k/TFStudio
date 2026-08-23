// Async orchestrator for methods cg / sa / de / all: picks + runs the engine for
// each method from the same baseline and keeps the global best. These reuse the
// validated engines via optimizerWorker (any method) and mfEvalWorker (parallel
// DE) — see engineRun.js / deEngine.js for the engine invocations themselves.
//
// A plain function of the Refinement component's `ctx` bag (see mainThread.js);
// this file additionally takes an `alive()` predicate so a Stop / run-id bump
// cancels an in-flight flow.

import { DLSOptimizer } from '../../../../../utils/physics/optimizer.js';
import { designMaterialLookup } from '../../../../../utils/materials/designMaterials.js';
import { appendMfSample, densifyForRun, presampleMaterials, buildPayload } from '../refinementUtils.js';
import { countFreeVars, METHOD_LABELS } from '../refinementConfig.js';
import { runOptMainThread } from './mainThread.js';
import { runEngineP } from './engineRun.js';
import { runParallelDEP, runMultiP } from './deEngine.js';

// Pick + run the engine for method m (F bundles the shared run config).
function runMethodOnce(ctx, m, F) {
    const mi = F.singleMethod ? ctx.maxIterRef.current : undefined;
    if (m === 'de' && F.HW > 2 && countFreeVars(F.curDes) >= 4)
        return runParallelDEP(ctx, { ops: F.ops, payload: F.payload, materials: F.materials, alive: F.alive, onProg: F.onProg, maxIterOverride: mi });
    if (m === 'dls-multi')
        return runMultiP(ctx, { ops: F.ops, payload: F.payload, materials: F.materials, N: ctx.nRestartsRef.current, pct: ctx.perturbPctRef.current, alive: F.alive, onProg: F.onProg });
    return runEngineP(ctx, m, { ops: F.ops, payload: F.payload, materials: F.materials, alive: F.alive, onProg: F.onProg, preview: true, maxIterOverride: mi });
}

// Track the global best across methods. Arms Best as soon as one method beats
// the start rather than at the end of the flow, so a Stop part-way through Try
// all can still hand back the best design found so far.
function trackGlobalBest(ctx, m, res, best) {
    if (!(res.mf < best.cur.mf)) return;
    best.cur = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
    ctx.setOmfBest(best.cur.omf);
    ctx.lastBestRef.current = {
        mfBest: best.cur.mf, omf: best.cur.omf,
        frontLayers: best.cur.frontLayers, backLayers: best.cur.backLayers,
    };
}

// Append one Design History row. Only a method that ran to its own stopping
// point gets one: the strip is a record of completed runs, and a row cut short
// by Stop would read as a result the method actually reached.
function recordMethodResult(ctx, F, m, res) {
    const layers = (F.layerSide === 'backLayers' ? res.backLayers : res.frontLayers) || [];
    ctx.addHistEntry({
        id: Math.random().toString(36).slice(2),
        label: METHOD_LABELS[m],
        iter: F.completedMethodIters, mf: res.mf, omf: res.omf, layers, layerCount: layers.length,
        layerSide: F.layerSide,
        mfHistory: [...F.methodHistory],
    });
}

// Apply the global best; set a synthetic optimizerRef so Best/Reset work. A run
// cut short by Stop keeps the design and the readout where the user stopped it —
// Best is the action that moves the design, not Stop — so only a run that got to
// the end of its method list publishes here.
function finalizeMethodsFlow(ctx, F, gb, methods) {
    const completed = F.alive();   // read before clearing the flag alive() tests
    ctx.runningRef.current = false; ctx.setRunning(false); ctx.setRestartIdx(0);
    if (!completed) return;
    ctx.updateDesignRef.current({ frontLayers: gb.frontLayers, backLayers: gb.backLayers }, { transient: true });
    ctx.lastBestRef.current = { mfBest: gb.mf, omf: gb.omf, frontLayers: gb.frontLayers, backLayers: gb.backLayers };
    ctx.optimizerRef.current = {
        iter: F.iterationOffset, mf: gb.mf, mfBest: gb.mf, layerSide: F.layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: gb.frontLayers, backLayers: gb.backLayers }),
        restoreBest: () => {},
    };
    ctx.setIter(F.iterationOffset);
    ctx.setMf(gb.mf); ctx.setMfBest(gb.mf); ctx.setOmf(gb.omf); ctx.setOmfBest(gb.omf);
    ctx.setStopReason(gb.mf < 1e-6 ? 'target' : (gb.method && methods.length > 1 ? `best: ${METHOD_LABELS[gb.method]}` : 'stalled'));
    if (methods.length > 1) console.log(`[Refine] Try-all done: best = ${gb.method} (MF=${gb.mf.toFixed(6)})`);
}

// Take the run checkpoint/baseline once, then evaluate the unperturbed start as
// the seed for the global best. Returns { baseMF, baseOMF }.
function seedBaseline(ctx, curDes, ops, payload) {
    if (!ctx.baselineRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        ctx.baselineRef.current = true;
    }
    let baseMF = Infinity, baseOMF = null;
    try {
        const b = new DLSOptimizer(ops, payload, designMaterialLookup(curDes));
        baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses);
        ctx.setMfInitial(b.mf); ctx.setOmfInitial(baseOMF);
    } catch (_) {}
    return { baseMF, baseOMF };
}

function updateFlowProgress(F, mfNow, iters, omfNow) {
    const { ctx, best } = F;
    const reportedIter = Number(iters);
    const localIter = Number.isFinite(reportedIter) ? Math.max(0, reportedIter) : F.lastMethodIter;
    F.lastMethodIter = Math.max(F.lastMethodIter, localIter);
    F.methodHistory = appendMfSample(F.methodHistory, localIter, mfNow);
    const y = Math.min(best.cur.mf, mfNow);
    ctx.setMf(mfNow); ctx.setMfBest(y);
    if (omfNow != null) ctx.setOmf(omfNow);
    ctx.setOmfBest(best.cur.omf);
    const totalIter = F.iterationOffset + localIter;
    F.aggregateHistory = appendMfSample(F.aggregateHistory, totalIter, y);
    ctx.setIter(totalIter);
    ctx.setMfHistory(F.aggregateHistory);
}

function beginMethod(F, methodIndex) {
    const { ctx, best, baseMF, methodCount } = F;
    F.lastMethodIter = 0;
    F.methodHistory = [{ iter: 0, mf: baseMF }];
    F.aggregateHistory = appendMfSample(F.aggregateHistory, F.iterationOffset, best.cur.mf);
    ctx.setMfHistory(F.aggregateHistory);
    ctx.bumpRunCount();
    if (methodCount > 1) ctx.setRestartIdx(methodIndex + 1);
}

function completeMethod(F, method, result) {
    const { ctx, best } = F;
    const reportedIter = Number(result?.iters);
    const resultIters = Number.isFinite(reportedIter) ? Math.max(0, reportedIter) : 0;
    F.completedMethodIters = Math.max(F.lastMethodIter, resultIters);
    if (result) {
        F.methodHistory = appendMfSample(F.methodHistory, F.completedMethodIters, result.mf);
        trackGlobalBest(ctx, method, result, best);
        // A method interrupted by Stop still contributes whatever it found to the
        // global best, but leaves no history row (see recordMethodResult).
        if (F.alive()) recordMethodResult(ctx, F, method, result);
    }
    F.iterationOffset += F.completedMethodIters;
    ctx.setIter(F.iterationOffset);
}

async function executeMethods(F, methods) {
    try {
        for (let i = 0; i < methods.length; i++) {
            if (!F.alive()) break;
            const method = methods[i];
            beginMethod(F, i);
            const result = await runMethodOnce(F.ctx, method, F);
            completeMethod(F, method, result);
        }
    } catch (err) { console.error('[Refine] method flow error:', err); }
}

// Each method runs from the SAME baseline; the global best across methods is
// kept and applied at the end. INDEPENDENT (not a relay): a relay variant tended
// to dip on the first improving method and then stall — the local methods can't
// escape that basin and the globals have nothing left to improve.
export async function runMethodsFlow(ctx, methods) {
    if (ctx.runningRef.current) return;
    const curDes = ctx.designRef.current;
    const ops    = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;
    let materials;
    try { materials = presampleMaterials(curDes, ops); }
    catch (err) { console.error('[Refine] presample failed:', err); runOptMainThread(ctx); return; }

    const payload   = buildPayload(curDes);
    const layerSide = payload.surfaceMode === 'back_only' ? 'backLayers' : 'frontLayers';

    const { baseMF, baseOMF } = seedBaseline(ctx, curDes, ops, payload);

    const myRun = ++ctx.runIdRef.current;
    const alive = () => ctx.runningRef.current && ctx.runIdRef.current === myRun;
    ctx.runningRef.current = true; ctx.setRunning(true); ctx.setCanReset(true);
    // Drop the previous run's result so Best cannot hand back a design from a run
    // this one has already replaced (matches runDlsEvent).
    ctx.lastBestRef.current = null;
    ctx.optimizerRef.current = null;
    ctx.setMfHistory([{ iter: 0, mf: baseMF }]); ctx.setIter(0); ctx.setStopReason(null); ctx.setRestartIdx(0);
    ctx.setMf(baseMF); ctx.setMfBest(baseMF); ctx.setOmf(baseOMF); ctx.setOmfBest(baseOMF);

    const best = { cur: { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null } };
    const F = {
        ctx, best, baseMF, methodCount: methods.length,
        ops, payload, materials, layerSide, curDes, alive,
        singleMethod: methods.length === 1,
        HW: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
        iterationOffset: 0, lastMethodIter: 0, completedMethodIters: 0,
        methodHistory: [], aggregateHistory: [{ iter: 0, mf: baseMF }],
    };
    F.onProg = (mfNow, iters, omfNow) => updateFlowProgress(F, mfNow, iters, omfNow);

    await executeMethods(F, methods);

    finalizeMethodsFlow(ctx, F, best.cur, methods);
}
