/**
 * Needle Variation optimization engine (main-thread path).
 *
 * The standalone-needle synthesis loop, extracted from the window component so
 * the component holds only React state + render. The heavy default path runs on
 * a worker pool; this is the identical-math main-thread FALLBACK used only if
 * the worker pool fails before any progress. It blocks the UI thread, so it is
 * the fallback, not the default.
 *
 * All React state is reached through a `ctx` bundle of refs + setters + a few
 * window-specific helpers, supplied by the component. Per-run state lives on a
 * plain `run` object so the phase machine can be split into small module
 * functions instead of one nested closure.
 *
 * Phase machine (Sullivan & Dobrowolski 1996; Tikhonravov 1996):
 *   'scanning'  → needle scan → pick best improving needle → insert → make DLS.
 *   'refining'  → DLS.step() to convergence → accept-or-revert. A needle is
 *                 accepted only if it lowers the merit function after refinement;
 *                 otherwise revert to the best so far and try the next candidate.
 *                 With no outer forced-TOT loop (that is Gradual Evolution's
 *                 job), "no improving needle" is the correct stop condition.
 */

import {
    scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers, isConstraint,
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
} from '../../../utils/physics/optimizer.js';
import {
    densifyForRun, activeSide, resolveMat, computePareto, minOmfOf,
    chunkArray, poolSize, buildARSeedCandidates,
} from './synthesisHelpers.js';
import { makeEngine } from '../../../utils/optimizers/index.js';
import {
    getSynthesisInnerEngine, getNeedleSensFloor, cullMarginalNeedles,
    getSynthesisMaxBatches, getSynthesisSmartSeed,
} from '../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../utils/workers/tmmWasm.js';

const deepCopy = (x) => JSON.parse(JSON.stringify(x));

// Restore the active-side layers of the running design to the best-so-far.
// transient: a live synthesis preview, not a user commit — no undo entry per
// rejected candidate, and it does not bump the M12 user-edit revision mid-run.
function mtRevertToBest(run) {
    const { ctx, LK, best } = run;
    ctx.baseDesignRef.current = { ...ctx.baseDesignRef.current, [LK]: deepCopy(best.front) };
    ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
}

// Restore the best design, publish it, and stop the run with a status message.
function mtFinalize(run, msg) {
    const { ctx, LK, best } = run;
    if (best.front) {
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [LK]: deepCopy(best.front) };
        ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
        ctx.setMfBest(best.mf);
        ctx.setLayerCount(best.front.length);
    }
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}

// Insert queue[idx] into the (reverted) best design at its optimal thickness
// (findOptimalNeedleThickness — golden-section MF minimum, Sullivan §3), spin up
// DLS, and hand off to the refine phase.
function mtStartCandidate(run, idx) {
    const { ctx, operands, side, LK, innerEngine, queue, pool } = run;
    mtRevertToBest(run);
    const cand = queue[idx];
    cand._mat = pool.find(p => p.id === cand.materialId)?.mat;

    let dOpt = ctx.dMinRef.current;
    try {
        dOpt = findOptimalNeedleThickness({
            operands, design: ctx.baseDesignRef.current, resolveMat,
            candidate: cand, deltaNm: ctx.dMinRef.current, maxNm: 500, tol: 0.5, side,
        });
        if (!(dOpt >= ctx.dMinRef.current)) dOpt = ctx.dMinRef.current;
    } catch (e) { dOpt = ctx.dMinRef.current; }

    const posLabel = cand.intra
        ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
    console.log(`[Needle Insert #${idx + 1}/${queue.length}] ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

    const newDesign = cand.intra
        ? insertNeedleIntra(ctx.baseDesignRef.current, cand.layerK, cand.frac, cand.materialId, dOpt, side)
        : insertNeedle(ctx.baseDesignRef.current, cand.pos, cand.materialId, dOpt, side);
    ctx.baseDesignRef.current = newDesign;
    ctx.updateDesignRef.current({ [LK]: newDesign[LK] }, { transient: true });

    try {
        ctx.dlsRef.current  = makeEngine(innerEngine, operands, newDesign, resolveMat, { dMin: ctx.dMinRef.current });
        ctx.lastBestRef.current = cand;
    } catch (err) {
        console.error('[Needle] DLS init failed:', err);
        ctx.dlsRef.current = null;
        mtFinalize(run, 'DLS init failed');
        return;
    }
    ctx.setPhase('refining');
    ctx.setStatusMsg('Refining…');
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}

// Scanning phase: scan all insertion positions × pool materials, build the
// improving-needle queue (best ΔMF first, marginal tail culled), and start the
// first candidate — or finalize if max-layers reached / no improving needle.
function mtScanStep(run) {
    const { ctx, operands, side, LK, best } = run;
    const layerCount = (ctx.baseDesignRef.current[LK] || []).length;

    if (layerCount >= ctx.maxLayersRef.current) {
        console.log(`[Needle] Max layers reached (${layerCount}) — restoring best`);
        mtFinalize(run, 'Max layers reached');
        return;
    }

    run.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!run.pool.length) {
        ctx.runningRef.current = false;
        ctx.setPhase('idle');
        ctx.setStatusMsg('No candidate materials');
        return;
    }

    console.log(`[Needle Scan] layers=${layerCount} pool=[${run.pool.map(p => p.name).join(', ')}]`);
    ctx.setPhase('scanning');
    ctx.setStatusMsg('Scanning needles…');

    const { candidates, mf0 } = scanNeedlesPFunction({
        operands, design: ctx.baseDesignRef.current, resolveMat,
        candidateMats: run.pool, deltaNm: ctx.deltaNmRef.current, side,
    });

    // First scan establishes the baseline best (current design).
    if (best.front === null) {
        best.mf    = mf0;
        best.front = deepCopy(ctx.baseDesignRef.current[LK] || []);
        ctx.setMfBest(mf0);
    }

    // All improving needles, best (most negative ΔMF) first, then cull the
    // marginal tail (H1 — needle sensitivity; no-op when 'off').
    run.queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
        getNeedleSensFloor());
    run.qIdx = 0;

    if (run.queue.length === 0) {
        console.log('[Needle Scan] No improving needle — needle-optimal, restoring best');
        mtFinalize(run, 'Needle-optimal (no improving needle)');
        return;
    }
    mtStartCandidate(run, 0);
}

// Record an accepted generation: append to history, recompute Pareto + best,
// push the display state, and cache for tab-switch survival.
function mtRecordGeneration(run, dls, prunedLayers, mfAfter) {
    const { ctx } = run;
    ctx.genCountRef.current += 1;
    const genNum     = ctx.genCountRef.current;
    const prevBestMF = ctx.gensRef.current.length ? Math.min(...ctx.gensRef.current.map(g => g.mf)) : Infinity;
    const dMF        = prevBestMF === Infinity ? null : mfAfter - prevBestMF;
    const gen = {
        id:         Math.random().toString(36).slice(2),
        genNum,
        mf:         mfAfter,
        omf:        dls.mfOpticalAt(dls.thicknesses),
        dMF,
        layerCount: prunedLayers.length,
        tMs:        performance.now() - run.runT0,
        insertMat:  ctx.lastBestRef.current?.materialId ?? null,
        layers:     deepCopy(prunedLayers),
    };
    ctx.gensRef.current = [...ctx.gensRef.current, gen];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(genNum);
    ctx.setLayerCount(prunedLayers.length);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmf(gen.omf);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Refining phase: one DLS step, then on convergence prune thin layers and
// accept (new global best → record generation) or reject (try next candidate,
// else needle-optimal).
function mtRefineStep(run) {
    const { ctx, LK, best } = run;
    const dls = ctx.dlsRef.current;
    if (!dls) { ctx.dlsRef.current = null; ctx.timerRef.current = setTimeout(() => mtTick(run), 0); return; }

    dls.step();
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));
    ctx.setLayerCount(dls.thicknesses.length);

    const converged = dls.isConverged() || dls.iter >= ctx.dlsIterRef.current;
    if (!converged) { ctx.timerRef.current = setTimeout(() => mtTick(run), 0); return; }

    // DLS done — prune thin layers (on the active side).
    const preDesign    = dls.applyToDesign(ctx.baseDesignRef.current);
    const prunedLayers = cleanupLayers(preDesign[LK] || [], ctx.dMinRef.current);
    const prunedDesign = { ...preDesign, [LK]: prunedLayers };
    const mfAfter      = dls.mf;
    console.log(`[Needle DLS] ${dls.iter} iters, MF=${mfAfter.toFixed(6)} layers=${prunedLayers.length}`);

    if (!(mfAfter < best.mf - 1e-9)) {
        // This needle didn't help → try the next-best candidate.
        ctx.dlsRef.current = null;
        run.qIdx += 1;
        if (run.qIdx < run.queue.length) {
            console.log(`[Needle] REJECT: MF=${mfAfter.toFixed(6)} ≥ best=${best.mf.toFixed(6)} → try next candidate (${run.qIdx + 1}/${run.queue.length})`);
            mtStartCandidate(run, run.qIdx);
            return;
        }
        console.log(`[Needle] All ${run.queue.length} improving candidates failed → needle-optimal, restoring best`);
        mtFinalize(run, 'Needle-optimal (all candidates exhausted)');
        return;
    }

    // Accept: new global best.
    best.mf    = mfAfter;
    best.front = deepCopy(prunedLayers);
    ctx.baseDesignRef.current = prunedDesign;
    ctx.updateDesignRef.current({ [LK]: prunedLayers }, { transient: true });

    mtRecordGeneration(run, dls, prunedLayers, mfAfter);

    if (best.mf < ctx.targetMFRef.current) {
        console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${ctx.targetMFRef.current}`);
        mtFinalize(run, `Converged MF=${best.mf.toFixed(6)}`);
        return;
    }

    // Next iteration: fresh scan on the improved design.
    ctx.dlsRef.current = null;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}

// One phase-machine step, scheduled via setTimeout so the UI thread can breathe.
function mtTick(run) {
    if (!run.ctx.runningRef.current) return;
    if (run.ctx.dlsRef.current) mtRefineStep(run);
    else mtScanStep(run);
}

// Entry point: set up the run (snapshot + checkpoint on first run) and kick the
// phase machine. Standalone Needle is a SYNTHESIS step — thickness constraints
// are dropped (the caller re-enables them for the post-synthesis Refinement).
export function runNeedleMainThread(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();

    const curDes  = ctx.baseDesignRef.current || ctx.designRef.current;
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    if (!curDes || operands.length === 0) return;
    const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'

    // Which layer array this run targets (forced by surfaceMode; for
    // both_independent defaults to 'front'). insertNeedle handles symmetric
    // mirroring automatically.
    const side = activeSide(curDes);
    const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

    // Snapshot on first run + one undo checkpoint for the whole synthesis run
    // (per-iteration design writes are transient previews).
    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    ctx.runningRef.current = true;
    ctx.setPhase('scanning');

    // Cumulative wallclock, continuous across stop/resume.
    const prevElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0) : 0;
    const run = {
        ctx, operands, innerEngine, side, LK,
        best: { mf: Infinity, front: null },
        queue: [], qIdx: 0, pool: [],
        runT0: performance.now() - prevElapsed,
    };
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}

// ── Worker-POOL run (default path) ─────────────────────────────────────────
// Main thread orchestrates; a WorkerPool runs the heavy primitives:
//  • SCAN is fanned across the pool by candidate-material slice — each
//    candidate's gradient is computed in the same op→λ→pol order as a single
//    scan, so that part stays bit-identical.
//  • CANDIDATE refinement runs a BATCH of the top improving candidates in
//    parallel and keeps the best post-refinement. Deliberate: keeps best of
//    top-K candidates (not first-improving in ΔMF order); NOT bit-identical,
//    but uses many threads.
//
// The pool is injected via ctx.makeWorkerPool(K, initMessage) so the component
// supplies a real WorkerPool while a test can supply an in-process fake pool
// (see tests/needle_worker_pool.mjs). The orchestration is split into small
// module functions operating on a per-run `run` object (mirroring the
// main-thread mt* machine above); on any pre-progress failure it falls back to
// the identical-math main-thread loop.

// Reconcile edits, drop synthesis-incompatible thickness constraints, resolve
// the scan sides and candidate pool. Returns the run seed or null on a guard
// (no operands / no pool), after posting the reason to the status line.
function wpPrepare(ctx) {
    ctx.reconcileBaseWithEdits();   // M12: pick up manual edits made between runs
    const curDes = ctx.baseDesignRef.current || ctx.designRef.current;
    // Standalone Needle is a SYNTHESIS step: it has no +TOT escape, so an active
    // MNT/MXT penalty can wipe out every improving candidate and make the
    // algorithm declare "needle-optimal" prematurely. Drop thickness constraints
    // here; the user re-enables them for the post-synthesis Refinement / Cleaner
    // loop (the canonical synthesis-then-manufacturability workflow).
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    const dropped = enabled.length - operands.length;
    if (!curDes || operands.length === 0) { ctx.setStatusMsg(ctx.t.needle.noOperands); return null; }
    if (dropped > 0) {
        console.log(`[Needle] Ignoring ${dropped} MNT/MXT operand${dropped > 1 ? 's' : ''} for synthesis (re-enable for Refinement after)`);
    }
    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side) each generation.
    // Mode-forced cases (front_only / symmetric / back_only) scan just one side.
    const scanSides = (curDes.surfaceMode || 'front_only') === 'both_independent'
        ? ['front', 'back'] : [activeSide(curDes)];
    const pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!pool.length) { ctx.setStatusMsg('No candidate materials'); return null; }
    return { curDes, operands, scanSides, pool };
}

// Approach-A pre-sampling of every material (design + candidate pool) onto the
// operand λ grid, so the workers rebuild an exact-λ table-lookup getNK. Returns
// the table or null (caller falls back to the main-thread loop).
function wpPresample(curDes, operands, pool) {
    try {
        const lambdas = requiredLambdas(operands);
        const pairs = collectDesignMaterialIds(curDes).map(id => ({ id, mat: resolveMat(id) }))
            .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
        return buildPresampledTable(lambdas, pairs);
    } catch (err) {
        console.error('[Needle] Pre-sampling failed, main-thread fallback:', err);
        return null;
    }
}

// Per-run design snapshot + layer helpers. designSnap builds a full design from
// the CURRENT both-side state; for both_independent every cycle re-snaps both
// sides from `best`, so both stacks evolve through the run.
function wpDesignHelpers(curDes, poolSlices) {
    const media = {
        surfaceMode:    curDes.surfaceMode || 'front_only',
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging: ship to the synthesis workers so the scan (FD
        // fallback) + DLS refine are cone-averaged like the eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
    const mkLayers = arr => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    const designSnap = (front, back) => ({ ...media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });
    return { mkLayers, designSnap, deep: x => JSON.parse(JSON.stringify(x)), poolSlices };
}

// Live-preview throttle: apply the worker's in-flight design tick (~≤90 ms).
function wpOnTick(run, _i, m) {
    if (m.type !== 'tick') return;
    const t = Date.now();
    if (t - run.lastTick < 90) return;
    run.lastTick = t;
    const { ctx } = run;
    if (m.mf != null) ctx.setMf(m.mf);
    if (m.omf != null) ctx.setOmf(m.omf);
    // both_independent live preview applies both sides; other modes have one.
    const patch = {};
    if (m.frontLayers) patch.frontLayers = m.frontLayers;
    if (m.backLayers)  patch.backLayers  = m.backLayers;
    if (Object.keys(patch).length) {
        ctx.updateDesignRef.current(patch, { transient: true });
        if (m.layers) ctx.setLayerCount(m.layers.length);
    }
}

// True while this run still owns the pool (a Stop swaps workerRef → the run is
// stale and must unwind without publishing).
const wpAlive = (run) => run.ctx.runningRef.current && run.ctx.workerRef.current === run.workerPool;

// Restore the best design, publish it, cache for tab-switch survival, and stop
// the run with a status message. No-op if the run no longer owns the pool.
function wpFinalize(run, reason) {
    const { ctx, best } = run;
    if (ctx.workerRef.current !== run.workerPool) return;
    if (best.frontLayers || best.backLayers) {
        const patch = {};
        if (best.frontLayers) patch.frontLayers = best.frontLayers;
        if (best.backLayers)  patch.backLayers  = best.backLayers;
        ctx.updateDesignRef.current(patch, { transient: true });
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
        ctx.setMfBest(best.mf);
        // Display layer count of whichever side was most recently active; for
        // both_independent show the total across both sides.
        ctx.setLayerCount((best.frontLayers ? best.frontLayers.length : 0) +
                          (best.backLayers  ? best.backLayers.length  : 0));
    }
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(reason || '');
    ctx.setCanReset(true);
    try { run.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === run.workerPool) ctx.workerRef.current = null;
}

// Tear down the pool and hand off to the identical-math main-thread loop.
function wpFallback(run, why, err) {
    const { ctx } = run;
    console.error(`[Needle] Pool ${why}, main-thread fallback:`, err);
    try { run.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === run.workerPool) ctx.workerRef.current = null;
    ctx.runningRef.current = false;
    runNeedleMainThread(ctx);
}

// Smart seed: refine the canonical QW/HW AR starting designs (plus the current
// design) in parallel on the pool and begin from whichever scores best. Seeds
// `best`; returns false if a Stop tore the run down mid-seed.
async function wpSmartSeed(run) {
    const { ctx, best } = run;
    const cands = buildARSeedCandidates({ design: run.curDes, pool: run.pool, maxLayers: run.maxLayers });
    ctx.setPhase('refining'); ctx.setStatusMsg(ctx.t.needle.smartSeeding(cands.length));
    const seedJobs = cands.map(cd => ({
        type: 'seedDls', operands: run.operands,
        design: run.designSnap(run.mkLayers(cd.frontLayers), run.mkLayers(cd.backLayers)),
        materials: run.materials, dMin: run.dMin, dlsIter: run.dlsIter,
        jobId: 'seed', side: run.scanSides[0], engine: run.innerEngine,
    }));
    const seedResults = await run.workerPool.map(seedJobs, (i, m) => wpOnTick(run, i, m));
    if (!wpAlive(run)) return false;
    let bi = -1;
    for (let i = 0; i < seedResults.length; i++) {
        const r = seedResults[i];
        if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
    }
    if (bi >= 0) {
        const r = seedResults[bi];
        best.mf = r.mf;
        best.frontLayers = run.deep(r.frontLayers || []);
        best.backLayers  = run.deep(r.backLayers  || []);
        ctx.updateDesignRef.current(
            { frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
        ctx.setMf(r.mf); ctx.setMfBest(r.mf);
        ctx.setLayerCount((best.frontLayers.length || 0) + (best.backLayers.length || 0));
        console.log('[Needle] Smart seed:', cands.map((cd, i) =>
            `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
            `→ best "${cands[bi].name}" ${r.mf.toFixed(6)}`);
    }
    return true;
}

// One parallel scan cycle: cap check → fan the needle scan across sides × pool
// slices → merge, seed the baseline best, and build the improving-needle queue
// (best ΔMF first, marginal tail culled). Returns a signal for wpRun.
async function wpScanCycle(run) {
    const { ctx, best } = run;
    const baseFront = best.frontLayers || run.mkLayers(run.curDes.frontLayers);
    const baseBack  = best.backLayers  || run.mkLayers(run.curDes.backLayers);
    // Max-layers stop: in both_independent each side caps independently; if
    // EITHER still has room we continue.
    const remainingSides = run.scanSides.filter(sd =>
        (sd === 'front' ? baseFront.length : baseBack.length) < run.maxLayers);
    if (remainingSides.length === 0) return { done: true, reason: 'Max layers reached' };

    ctx.setPhase('scanning'); ctx.setStatusMsg('Scanning needles…');
    const snap = run.designSnap(baseFront, baseBack);
    const scanJobs = [];
    for (const sd of remainingSides) {
        for (const slice of run.poolSlices) {
            scanJobs.push({ type: 'scan', operands: run.operands, design: snap,
                materials: run.materials, poolSlice: slice, deltaNm: run.deltaNm, side: sd });
        }
    }
    const scanRes = await run.workerPool.map(scanJobs);
    if (!wpAlive(run)) return { aborted: true };
    run.gotProgress = true;
    let candidates = [];
    for (const r of scanRes) candidates = candidates.concat(r.candidates || []);
    const mf0 = scanRes.length ? scanRes[0].mf0 : Infinity;
    if (best.frontLayers === null && best.backLayers === null) {
        best.mf = mf0;
        best.frontLayers = run.deep(baseFront);
        best.backLayers  = run.deep(baseBack);
    }
    // Global best needle: most negative ΔMF wins regardless of side. Then cull
    // the marginal tail (H1 — sensitivity; no-op when 'off').
    const queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) =>
            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
        getNeedleSensFloor());
    if (queue.length === 0) return { done: true, reason: 'Needle-optimal (no improving needle)' };
    return { queue };
}

// Index of the lowest post-refine MF in a candidate batch (−1 if none valid).
function wpBestOfBatch(results) {
    let idx = -1, mf = Infinity;
    for (let r = 0; r < results.length; r++) {
        const a = results[r].mfAfter;
        if (a != null && a < mf) { mf = a; idx = r; }
    }
    return { idx, mf };
}

// Record an accepted generation: append to history, recompute Pareto + best,
// push display state, and cache for tab-switch survival.
function wpRecordGeneration(run, res, cand, candSide, candLK) {
    const { ctx, best } = run;
    run.genNum += 1;
    const dMF = run.prevBestMF === Infinity ? null : best.mf - run.prevBestMF;
    run.prevBestMF = Math.min(run.prevBestMF, best.mf);
    const activeLayers = best[candLK];
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    const gen = {
        id: Math.random().toString(36).slice(2),
        genNum: run.genNum, mf: best.mf, omf: res.omf, dMF,
        side:       candSide,
        layerCount: activeLayers.length,
        tot:        sumD(best.frontLayers) + sumD(best.backLayers),
        tMs:        performance.now() - run.runT0,
        insertMat:  cand.materialId ?? null,
        layers:     run.deep(activeLayers),         // active-side snapshot
        frontSnap:  run.deep(best.frontLayers),     // full-design snapshot
        backSnap:   run.deep(best.backLayers),
    };
    ctx.gensRef.current     = [...ctx.gensRef.current, gen];
    ctx.genCountRef.current = run.genNum;
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(run.genNum);
    ctx.setLayerCount(activeLayers.length);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmf(res.omf ?? null);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Accept the best-of-batch candidate as the new global best: publish the full
// post-DLS+prune design, record the generation, and report a convergence reason
// (or null to keep going).
function wpAcceptCandidate(run, batch, results, pick) {
    const { ctx, best } = run;
    const res  = results[pick.idx];
    const cand = batch[pick.idx];
    const candSide = cand.side || run.scanSides[0];
    const candLK   = candSide === 'back' ? 'backLayers' : 'frontLayers';
    best.mf = pick.mf;
    // Worker returns the full post-DLS+prune design; accept both sides.
    best.frontLayers = run.deep(res.frontLayers || best.frontLayers);
    best.backLayers  = run.deep(res.backLayers  || best.backLayers);
    const patch = { frontLayers: best.frontLayers, backLayers: best.backLayers };
    ctx.updateDesignRef.current(patch, { transient: true });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
    wpRecordGeneration(run, res, cand, candSide, candLK);
    console.log(`[Needle] ACCEPT (best of ${batch.length}, side=${candSide}): MF=${best.mf.toFixed(6)} layers=${best[candLK].length} mat=${cand.materialId}`);
    if (best.mf < ctx.targetMFRef.current) {
        console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${ctx.targetMFRef.current}`);
        return `Converged MF=${best.mf.toFixed(6)}`;
    }
    return null;
}

// Refine up to maxBatches batches of the top-K improving candidates in
// parallel, accepting the first batch that beats the best. Returns a signal for
// wpRun ({done+reason} on convergence, {accepted} otherwise).
async function wpRefineBatches(run, queue) {
    const { ctx, best } = run;
    let accepted = false, batchN = 0;
    for (let i = 0; i < queue.length && batchN < run.maxBatches && wpAlive(run); i += run.K, batchN++) {
        const batch = queue.slice(i, i + run.K);
        ctx.setPhase('refining');
        ctx.setStatusMsg(`Refining ${batch.length} candidate${batch.length > 1 ? 's' : ''} (parallel)…`);
        const bsnap = run.designSnap(run.deep(best.frontLayers), run.deep(best.backLayers));
        const results = await run.workerPool.map(batch.map((cand, bi) => ({
            type: 'candidate', pipeline: 'needle',
            operands: run.operands, design: bsnap, materials: run.materials,
            cand: { ...cand, _cid: bi },
            dMin: run.dMin, dlsIter: run.stepIter, jobId: `n${i}_${bi}`, engine: run.innerEngine,
            // The worker honors cand.side; job.side is the fallback for legacy
            // single-side mode.
            side: cand.side || run.scanSides[0],
        })), (idx, m) => wpOnTick(run, idx, m));
        if (!wpAlive(run)) return { aborted: true };

        const pick = wpBestOfBatch(results);
        if (pick.idx >= 0 && pick.mf < best.mf - 1e-9) {
            const conv = wpAcceptCandidate(run, batch, results, pick);
            accepted = true;
            if (conv) return { done: true, reason: conv };
            break;
        }
        console.log(`[Needle] batch ${i}-${i + batch.length - 1}: none beat best=${best.mf.toFixed(6)} → next batch`);
    }
    return { accepted };
}

// Expected teardown vs a real error: a Stop rejects the in-flight job with
// 'pool terminated' (clean stop, stopOpt already ran) → bail silently.
function wpHandleLoopError(run, err) {
    if (!wpAlive(run) || String(err && err.message) === 'pool terminated') return;
    if (!run.gotProgress) { wpFallback(run, 'errored before progress', err); return; }
    console.error('[Needle] Pool error:', err);
    run.ctx.stopOpt(String(err && err.message || err));
}

// Async driver: optional smart-seed, then scan → refine cycles until a stop
// condition (max layers / needle-optimal / converged / exhausted).
async function wpRun(run) {
    try {
        if (getSynthesisSmartSeed('needle') && !(await wpSmartSeed(run))) return;
        while (wpAlive(run)) {
            const scan = await wpScanCycle(run);
            if (scan.aborted) return;
            // reason === null means "keep cycling"; a string means finalize.
            let reason = scan.done ? scan.reason : null;
            if (reason === null) {
                const ref = await wpRefineBatches(run, scan.queue);
                if (ref.aborted) return;
                if (ref.done) reason = ref.reason;
                else if (!ref.accepted) reason = 'Needle-optimal (all candidates exhausted)';
            }
            if (reason !== null) { wpFinalize(run, reason); return; }
        }
    } catch (err) {
        wpHandleLoopError(run, err);
    }
}

export function runNeedleWorkerPool(ctx) {
    if (ctx.runningRef.current) return;
    const prep = wpPrepare(ctx);
    if (!prep) return;
    const { curDes, operands, scanSides, pool } = prep;

    // Snapshot on first run + one undo checkpoint for the whole synthesis run.
    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    const materials = wpPresample(curDes, operands, pool);
    if (!materials) { runNeedleMainThread(ctx); return; }

    const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'
    const K = poolSize();
    let workerPool;
    const wasmBytes = getTmmWasmBytesForWorker();
    try { workerPool = ctx.makeWorkerPool(K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
    catch (err) {
        console.error('[Needle] WorkerPool construction failed, main-thread fallback:', err);
        runNeedleMainThread(ctx);
        return;
    }
    ctx.workerRef.current = workerPool;

    const poolSlices = chunkArray(pool.map(p => ({ id: p.id, name: p.name })), K);
    // Cumulative wallclock, continuous across stop/resume; genNum + ΔMF baseline
    // continue across Stop→Run (M4) rather than resetting.
    const prevElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0) : 0;
    const run = {
        ctx, curDes, operands, scanSides, pool, materials, workerPool,
        ...wpDesignHelpers(curDes, poolSlices),
        maxLayers: ctx.maxLayersRef.current, deltaNm: ctx.deltaNmRef.current,
        dMin: ctx.dMinRef.current, dlsIter: ctx.dlsIterRef.current,
        // Needle always uses the full per-step refine (preserve-bulk is GE-only;
        // the GUI 2×2 showed more iters help Needle), so stepIter == dlsIter.
        stepIter: ctx.dlsIterRef.current,
        innerEngine, maxBatches: getSynthesisMaxBatches(), K,
        best: { mf: Infinity, frontLayers: null, backLayers: null },
        genNum: ctx.genCountRef.current,
        prevBestMF: ctx.gensRef.current.length ? Math.min(...ctx.gensRef.current.map(g => g.mf)) : Infinity,
        runT0: performance.now() - prevElapsed,
        gotProgress: false, lastTick: 0,
    };

    ctx.runningRef.current = true;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    wpRun(run);
}
