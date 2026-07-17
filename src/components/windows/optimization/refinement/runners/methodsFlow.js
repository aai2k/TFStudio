// Async orchestrator for methods cg / sa / de / all: picks + runs the engine for
// each method from the same baseline and keeps the global best. These reuse the
// validated engines via optimizerWorker (any method) and mfEvalWorker (parallel
// DE) — see engineRun.js / deEngine.js for the engine invocations themselves.
//
// A plain function of the Refinement component's `ctx` bag (see mainThread.js);
// this file additionally takes an `alive()` predicate so a Stop / run-id bump
// cancels an in-flight flow.

import { DLSOptimizer } from '../../../../../utils/physics/optimizer.js';
import { resolveMat, densifyForRun, presampleMaterials, buildPayload } from '../refinementUtils.js';
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

// Record one method's result: append a history row; track the global best.
function recordMethodResult(ctx, F, m, res, best) {
    const layers = (F.layerSide === 'backLayers' ? res.backLayers : res.frontLayers) || [];
    ctx.addHistEntry({
        id: Math.random().toString(36).slice(2),
        label: METHOD_LABELS[m],
        iter: res.iters || 0, mf: res.mf, omf: res.omf, layers, layerCount: layers.length,
        layerSide: F.layerSide,
    });
    if (res.mf < best.cur.mf) {
        best.cur = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
        ctx.setOmfBest(best.cur.omf);
    }
}

// Apply the global best; set a synthetic optimizerRef so Best/Reset work.
function finalizeMethodsFlow(ctx, F, gb, methods) {
    ctx.runningRef.current = false; ctx.setRunning(false); ctx.setRestartIdx(0);
    ctx.updateDesignRef.current({ frontLayers: gb.frontLayers, backLayers: gb.backLayers }, { transient: true });
    ctx.lastBestRef.current = { mfBest: gb.mf, omf: gb.omf, frontLayers: gb.frontLayers, backLayers: gb.backLayers };
    ctx.optimizerRef.current = {
        iter: 0, mf: gb.mf, mfBest: gb.mf, layerSide: F.layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: gb.frontLayers, backLayers: gb.backLayers }),
        restoreBest: () => {},
    };
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
        const b = new DLSOptimizer(ops, payload, resolveMat);
        baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses);
        ctx.setMfInitial(b.mf); ctx.setOmfInitial(baseOMF);
    } catch (_) {}
    return { baseMF, baseOMF };
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
    ctx.setMfHistory([]); ctx.setIter(0); ctx.setStopReason(null); ctx.setRestartIdx(0);
    ctx.setMf(baseMF); ctx.setMfBest(baseMF); ctx.setOmf(baseOMF); ctx.setOmfBest(baseOMF);

    const best = { cur: { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null } };
    const F = {
        ops, payload, materials, layerSide, curDes, alive,
        singleMethod: methods.length === 1,
        HW: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
        onProg: (mfNow, _iters, omfNow) => {
            const y = Math.min(best.cur.mf, mfNow);
            ctx.setMf(mfNow); ctx.setMfBest(y);
            if (omfNow != null) ctx.setOmf(omfNow);
            ctx.setOmfBest(best.cur.omf);
            ctx.setMfHistory(prev => [...prev, { iter: prev.length, mf: y }]);
        },
    };

    try {
        for (const m of methods) {
            if (!alive()) break;
            ctx.bumpRunCount();
            if (methods.length > 1) ctx.setRestartIdx(methods.indexOf(m) + 1);
            const res = await runMethodOnce(ctx, m, F);
            if (res) recordMethodResult(ctx, F, m, res, best);
        }
    } catch (err) { console.error('[Refine] method flow error:', err); }

    finalizeMethodsFlow(ctx, F, best.cur, methods);
}
