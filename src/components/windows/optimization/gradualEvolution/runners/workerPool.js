// Worker-POOL Gradual-Evolution engine — the default run path. The main thread
// orchestrates the GE state machine while a WorkerPool runs the heavy
// primitives: SCAN is fanned across the pool by candidate-material slice
// (bit-identical per candidate); the needle-optimization step deliberately
// refines a BATCH of top candidates in parallel and keeps the best (not
// first-improving in ΔMF order), so it is not bit-identical. Seed-DLS and the
// forced-TOT step are also pool jobs. Falls back to the synchronous main-thread
// engine (mainThread.js) if the pool fails before any progress.
//
// A plain function of the GradualEvolution window's `ctx` bag; see
// GradualEvolution.js which builds the ctx and owns the React state. The
// orchestration helpers are module-scope functions driven off a single run-state
// object `S`, so no giant nested closure builds up.

import {
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
} from '../../../../../utils/physics/optimizer.js';
import { WorkerPool } from '../../../../../utils/workers/workerPool.js';
import {
    getSynthesisInnerEngine, getSynthesisMaxBatches,
    getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    getSynthesisConsolidate, getSynthesisConsolidateTol,
    getSynthesisSmartSeed, getNeedleSensFloor, cullMarginalNeedles,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../../../workerUrls.js';
import {
    activeSide, densifyForRun, chunkArray, poolSize,
    resolveMat, minOmfOf, buildARSeedCandidates,
} from '../../synthesisHelpers.js';
import { setCached } from '../geCache.js';
import { runGeMainThread } from './mainThread.js';

const deep = x => JSON.parse(JSON.stringify(x));
const mkLayers = arr => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));

// Build a full design from the given both-side layer state. In both_independent
// each cycle re-snaps both sides from `best` so both evolve through the run.
const designSnap = (S, front, back) => ({ ...S.media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });

// The run is live only while this exact pool is the window's current pool.
const alive = (ctx, S) => ctx.runningRef.current && ctx.workerRef.current === S.workerPool;

// Throttled live-preview push of an in-worker tick (mf / omf / layers).
function onTick(ctx, S, _i, m) {
    if (!m || m.type !== 'tick') return;
    const now = Date.now();
    if (now - S.lastTick < 90) return;
    S.lastTick = now;
    if (m.mf != null) ctx.setMf(m.mf);
    if (m.omf != null) ctx.setOmf(m.omf);
    const patch = {};
    if (m.frontLayers) patch.frontLayers = m.frontLayers;
    if (m.backLayers)  patch.backLayers  = m.backLayers;
    if (Object.keys(patch).length) {
        ctx.updateDesignRef.current(patch, { transient: true });
        if (m.layers) ctx.setLayerCount(m.layers.length);
    }
}

function applyDesignPatch(ctx, S, frontLayers, backLayers) {
    const patch = {};
    if (frontLayers) patch.frontLayers = frontLayers;
    if (backLayers)  patch.backLayers  = backLayers;
    ctx.updateDesignRef.current(patch, { transient: true });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
}

function recordCycle(ctx, S, { type, mf, layerCount, insertMat, side, activeLayers, omf }) {
    S.genNum += 1;
    const dMF = S.prevBestMF === Infinity ? null : mf - S.prevBestMF;
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    const fSnap = deep(S.work.frontLayers);
    const bSnap = deep(S.work.backLayers);
    // Total physical thickness (nm) of the whole design — the "TOT" column
    // (cf. OTF needle history): the thick seed holds the bulk budget and needles
    // redistribute it, so TOT should stay roughly flat (≈ seed), not balloon. A
    // runaway TOT signals over-forcing.
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    const tot = sumD(fSnap) + sumD(bSnap);
    const cy = {
        id: Math.random().toString(36).slice(2),
        genNum: S.genNum, type, mf, omf, dMF, layerCount, insertMat, side, tot,
        tMs: performance.now() - S.runT0,
        layers:    deep(activeLayers),                 // active-side snapshot
        frontSnap: fSnap,
        backSnap:  bSnap,
    };
    ctx.cyclesRef.current   = [...ctx.cyclesRef.current, cy];
    ctx.genCountRef.current = S.genNum;
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setGeneration(S.genNum);
    ctx.setLayerCount(layerCount);
    ctx.setMfBest(Math.min(S.best.mf, S.prevBestMF));
    if (omf != null) ctx.setOmf(omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: S.geSteps,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
}

// Merit-aware consolidation on the BEST design before committing (Macleod,
// "Automatic Design": needle/GE thin+redundant layers "must then be processed to
// remove them"). Trial-deletes each layer and re-refines on the worker; keeps
// deletions that don't worsen MF beyond `tol`. No-op when disabled, when best is
// ≤1 layer, or if the pool was already torn down. Updates `best` in place and
// records a 'clean' row.
async function consolidateBest(ctx, S) {
    if (!getSynthesisConsolidate()) return;
    if (ctx.workerRef.current !== S.workerPool) return;
    const total = (S.best.frontLayers?.length || 0) + (S.best.backLayers?.length || 0);
    if (total <= 1) return;
    ctx.setPhase('refining');
    ctx.setStatusMsg('Consolidating layers…');
    let res;
    try {
        res = await S.workerPool.run({
            type: 'removePass', operands: S.operands,
            design: designSnap(S, S.best.frontLayers, S.best.backLayers),
            materials: S.materials, dMin: S.dMin, side: S.scanSides[0], engine: S.innerEngine,
            tol: getSynthesisConsolidateTol(), minLayers: 1, maxIter: S.dlsIter,
        }, (m) => onTick(ctx, S, 0, m));   // run() calls onProgress(m); onTick expects (i, m)
    } catch (_) { return; }                // pool terminated / errored → skip silently
    if (!alive(ctx, S) || !res) return;
    if ((res.removed || 0) <= 0) return;          // nothing redundant
    S.best.mf = res.mf;
    S.best.frontLayers = deep(res.frontLayers || S.best.frontLayers);
    S.best.backLayers  = deep(res.backLayers  || S.best.backLayers);
    S.work.mf = res.mf;
    S.work.frontLayers = deep(S.best.frontLayers);
    S.work.backLayers  = deep(S.best.backLayers);
    const cleanSide = S.scanSides[0];
    const activeLayers = cleanSide === 'back' ? S.best.backLayers : S.best.frontLayers;
    recordCycle(ctx, S, { type: 'clean', mf: res.mf, layerCount: res.nLayers, insertMat: null, side: cleanSide, activeLayers, omf: res.omf });
    console.log(`[GE] Consolidate: removed ${res.removed} layer(s), ${res.baseLayers}→${res.nLayers}, MF ${res.baseMf?.toFixed?.(6)} → ${res.mf.toFixed(6)}`);
}

async function finalize(ctx, S, reason) {
    if (ctx.workerRef.current !== S.workerPool) return;
    await consolidateBest(ctx, S);
    if (ctx.workerRef.current !== S.workerPool) return;   // stopped during consolidation
    if (S.best.frontLayers || S.best.backLayers) {
        applyDesignPatch(ctx, S, S.best.frontLayers, S.best.backLayers);
        ctx.setMfBest(S.best.mf);
        const totalLayers =
            (S.best.frontLayers ? S.best.frontLayers.length : 0) +
            (S.best.backLayers  ? S.best.backLayers.length  : 0);
        ctx.setLayerCount(totalLayers);
    }
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: S.geSteps,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(reason || '');
    ctx.setCanReset(true);
    try { S.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === S.workerPool) ctx.workerRef.current = null;
}

function fallback(ctx, S, why, err) {
    console.error(`[GE] Pool ${why}, main-thread fallback:`, err);
    window.electronAPI?.diagLog?.(`GE pool ${why} → main-thread fallback: ${err?.message || err}`);
    try { S.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === S.workerPool) ctx.workerRef.current = null;
    ctx.runningRef.current = false;
    runGeMainThread(ctx);
}

// Per-side accept helper. Scans ONE side on the current `work`, top-K DLS-refines
// improving candidates until one beats work.mf or the queue is exhausted. Returns
// true if a needle was accepted (work + best updated, cycle recorded). For
// both_independent this is called once per side per outer iteration so both
// stacks grow; for single-side modes it is called once with the forced side.
async function tryAcceptOnSide(ctx, S, sd) {
    const sideLen = (sd === 'front' ? S.work.frontLayers : S.work.backLayers).length;
    if (sideLen >= S.maxLayers) return false;
    ctx.setPhase('scanning');
    ctx.setStatusMsg(S.scanSides.length > 1 ? `Needle scan side=${sd}…` : 'Needle scan…');
    // ── timing (per-generation cost breakdown) ──
    const _genT0 = performance.now();
    const snap = designSnap(S, S.work.frontLayers, S.work.backLayers);
    const sideScanJobs = S.poolSlices.map(slice => ({
        type: 'scan', operands: S.operands, design: snap,
        materials: S.materials, poolSlice: slice, deltaNm: 0.5, side: sd }));
    const sideScanRes = await S.workerPool.map(sideScanJobs);
    if (!alive(ctx, S)) return false;
    const _scanMs = performance.now() - _genT0;
    let _refMs = 0, _nCand = 0;
    let candidates = [];
    for (const r of sideScanRes) candidates = candidates.concat(r.candidates || []);
    // Improving needles best-first, then cull the marginal tail (H1 — needle
    // sensitivity; no-op when 'off' ⇒ bit-identical).
    const queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) =>
            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
        getNeedleSensFloor());
    if (queue.length === 0) return false;

    // Cap how many K-batches we refine per step. The long tail of marginal
    // P-candidates was the 9–21 s/gen stall cost (45–56 candidates = 6–7 rounds);
    // OTF inserts the best few and moves on. When the capped batches don't
    // improve we fall through to forced-TOT (which re-scans) sooner.
    let _batchN = 0;
    for (let i = 0; i < queue.length && _batchN < S.maxBatches && alive(ctx, S); i += S.K, _batchN++) {
        const batch = queue.slice(i, i + S.K);
        ctx.setPhase('refining');
        ctx.setStatusMsg(`${S.innerEngine.toUpperCase()} refine ${batch.length} candidate${batch.length > 1 ? 's' : ''}${S.scanSides.length > 1 ? ` (side=${sd})` : ''}…`);
        const bsnap = designSnap(S, deep(S.work.frontLayers), deep(S.work.backLayers));
        const _rT0 = performance.now();
        const results = await S.workerPool.map(batch.map((cand, bi) => ({
            type: 'candidate', pipeline: 'ge',
            operands: S.operands, design: bsnap, materials: S.materials,
            cand: { ...cand, _cid: bi },
            dMin: S.dMin, dlsIter: S.stepIter, jobId: `g_${sd}_${i}_${bi}`,
            side: cand.side || sd, engine: S.innerEngine,
        })), (bi, m) => onTick(ctx, S, bi, m));
        _refMs += performance.now() - _rT0; _nCand += batch.length;
        if (!alive(ctx, S)) return false;

        let bIdx = -1, bMf = Infinity;
        for (let r = 0; r < results.length; r++) {
            const rr = results[r];
            if (rr.allPruned || rr.mfNow == null) continue;
            if (rr.mfNow < bMf) { bMf = rr.mfNow; bIdx = r; }
        }
        if (bIdx >= 0 && bMf < S.work.mf - 1e-9) {
            const res  = results[bIdx];
            const cand = batch[bIdx];
            const candSide = cand.side || sd;
            S.work.mf = bMf;
            S.work.frontLayers = deep(res.frontLayers || S.work.frontLayers);
            S.work.backLayers  = deep(res.backLayers  || S.work.backLayers);
            applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
            ctx.setMf(bMf);
            if (res.omf != null) ctx.setOmf(res.omf);
            const newGlobalBest = bMf < S.best.mf - 1e-9;
            if (newGlobalBest) {
                S.best.mf = bMf;
                S.best.frontLayers = deep(S.work.frontLayers);
                S.best.backLayers  = deep(S.work.backLayers);
                S.geStagn.n = 0;
            }
            const activeLayers = candSide === 'back' ? S.work.backLayers : S.work.frontLayers;
            recordCycle(ctx, S, { type: 'needle', mf: bMf, layerCount: res.nLayers, insertMat: cand.materialId, side: candSide, activeLayers, omf: res.omf });
            console.log(`[GE] ACCEPT needle (best of ${batch.length}, side=${candSide}): workMF=${bMf.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${S.best.mf.toFixed(6)})`} layers=${res.nLayers}`);
            console.log(`[GE timing] engine=${S.innerEngine} ACCEPT layers=${res.nLayers} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand} gen=${(performance.now() - _genT0).toFixed(0)}ms (scan ${(100*_scanMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}% / refine ${(100*_refMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}%)`);
            return true;
        }
        console.log(`[GE] side=${sd} batch ${i}-${i + batch.length - 1}: none beat workMF=${S.work.mf.toFixed(6)} → next`);
    }
    // Distinguish a TRUE needle-optimum (queue exhausted) from a batch-CAP early
    // exit (more candidates remain, but the cap reached → go to forced-TOT, which
    // re-scans).
    const _capped = _batchN >= S.maxBatches && _batchN * S.K < queue.length;
    console.log(`[GE timing] ${_capped ? `CAPPED@${S.maxBatches}b` : 'NEEDLE-OPTIMAL'} side=${sd} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand}/${queue.length}`);
    return false;
}

// One forced total-optical-thickness step (Tikhonravov 2007 §2). Returns false
// once the GE-step budget or a stagnation guard says stop (caller finalizes).
async function forcedGeStep(ctx, S) {
    if (S.geSteps >= S.maxGeCycles) {
        console.log(`[GE] Max GE steps reached (${S.geSteps})`);
        await finalize(ctx, S, 'Max GE steps reached'); return false;
    }
    // Pick the side with room; in both_independent prefer whichever has fewer
    // layers (balance growth).
    const eligible = S.scanSides.filter(sd =>
        (sd === 'front' ? S.work.frontLayers : S.work.backLayers).length < S.maxLayers);
    if (eligible.length === 0) { await finalize(ctx, S, 'Max layers reached'); return false; }
    const geSide = eligible.length === 1 ? eligible[0]
        : (S.work.frontLayers.length <= S.work.backLayers.length ? 'front' : 'back');
    ctx.setPhase('scanning'); ctx.setStatusMsg('Forced GE step…');
    const _geT0 = performance.now();
    const gres = await S.workerPool.run({
        type: 'geStep', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, pool: S.poolLite, dMin: S.dMin, side: geSide,
    });
    if (!alive(ctx, S)) return false;
    console.log(`[GE timing] FORCED-TOT geStep=${(performance.now() - _geT0).toFixed(0)}ms`);
    if (gres.empty) { await finalize(ctx, S, 'Converged (stuck)'); return false; }
    S.work.mf = gres.mfNew;
    S.work.frontLayers = deep(gres.frontLayers || S.work.frontLayers);
    S.work.backLayers  = deep(gres.backLayers  || S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(gres.mfNew);
    ctx.setOmf(gres.mfNew);
    S.geSteps += 1; S.geStagn.n += 1;
    ctx.geStepsRef.current = S.geSteps; ctx.setGeSteps(S.geSteps);
    const geActive = gres.side === 'back' ? S.work.backLayers : S.work.frontLayers;
    console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: gres.mfNew, layerCount: gres.nLayers, insertMat: gres.materialId, side: gres.side, activeLayers: geActive, omf: gres.mfNew });
    if (S.geStagn.n > 6) {
        console.log('[GE] No new best after repeated GE steps — stopping');
        await finalize(ctx, S, 'Converged (stuck)'); return false;
    }
    return true;
}

// Seed refinement → seed the global best + record the baseline/seed row.
async function seedPhase(ctx, S) {
    const seedSide = S.scanSides[0];
    // preserve-bulk: dlsIter:0 → evaluate the seed MF only, leave the thick bulk
    // intact (refining the bare seed collapses it).
    const seedIter = S.preserveBulk ? 0 : S.dlsIter;
    ctx.setPhase('refining');
    let sres;
    // Smart seed: when enabled, generate the canonical QW/HW antireflection
    // starting designs from the pool PLUS the current design, refine them ALL IN
    // PARALLEL on the worker pool (off the UI thread — never blocks, and scales
    // with the pool), then begin synthesis from whichever scores best. The
    // current design is a candidate, so the seed can only match or improve the
    // starting point. Disabled in preserve-bulk (that mode deliberately keeps the
    // user's thick seed intact and must not be replaced).
    if (getSynthesisSmartSeed('ge') && !S.preserveBulk) {
        const cands = buildARSeedCandidates({ design: S.curDes, pool: S.pool, maxLayers: S.maxLayers });
        ctx.setStatusMsg(S.tg.smartSeeding(cands.length));
        const seedJobs = cands.map(cd => ({
            type: 'seedDls', operands: S.operands,
            design: designSnap(S, mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
            materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
        }));
        const seedResults = await S.workerPool.map(seedJobs, (i, m) => onTick(ctx, S, i, m));
        if (!alive(ctx, S)) return null;
        let bi = -1;
        for (let i = 0; i < seedResults.length; i++) {
            const r = seedResults[i];
            if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
        }
        if (bi >= 0) {
            sres = seedResults[bi];
            console.log('[GE] Smart seed:', cands.map((cd, i) =>
                `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
                `→ best "${cands[bi].name}" ${sres.mf.toFixed(6)}`);
        }
    }
    if (!sres) {
        ctx.setStatusMsg(S.preserveBulk ? 'Seed (bulk preserved)…' : 'Seed refinement…');
        sres = await S.workerPool.run({
            type: 'seedDls', operands: S.operands,
            design: designSnap(S, mkLayers(S.curDes.frontLayers), mkLayers(S.curDes.backLayers)),
            materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
        }, (m) => onTick(ctx, S, 0, m));
    }
    if (!alive(ctx, S)) return null;
    S.gotProgress = true;
    S.work.mf = sres.mf;
    S.work.frontLayers = deep(sres.frontLayers || []);
    S.work.backLayers  = deep(sres.backLayers  || []);
    S.best.mf = sres.mf;
    S.best.frontLayers = deep(S.work.frontLayers);
    S.best.backLayers  = deep(S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(sres.mf); ctx.setMfBest(sres.mf);
    if (sres.omf != null) { ctx.setOmf(sres.omf); ctx.setOmfBest(sres.omf); }
    const seedTotal = S.work.frontLayers.length + S.work.backLayers.length;
    ctx.setLayerCount(seedTotal);
    console.log(`[GE Seed] ${S.innerEngine.toUpperCase()} ${sres.iters} iters, MF=${sres.mf.toFixed(6)}`);
    // Record the seed/baseline as the first history row so its contribution is
    // visible — otherwise a strong smart-seed (or a refined start) leaves the
    // cycles table empty and the run looks like "nothing happened" when the seed
    // WAS the win. Fresh runs only (resume carries cycles).
    if (!ctx.cyclesRef.current.length) {
        const seedActive = (seedSide === 'back' ? S.work.backLayers : S.work.frontLayers);
        recordCycle(ctx, S, {
            type: (getSynthesisSmartSeed('ge') && !S.preserveBulk) ? 'seed' : 'baseline',
            mf: sres.mf, layerCount: seedTotal, insertMat: null, side: seedSide, activeLayers: seedActive, omf: sres.omf ?? null,
        });
    }
    return sres;
}

// The async orchestration: seed, then the outer per-side GE loop.
async function runGeLoop(ctx, S) {
    try {
        if (await seedPhase(ctx, S) == null) return;

        // ── Outer GE loop ────────────────────────────────────────────
        // Option 1 (per-side acceptance): each outer iteration processes every
        // eligible side independently. The side with fewer layers is tried first
        // so growth stays roughly balanced; if a side accepts, the next side
        // re-scans on the updated `work`. Forced GE only fires when NO side could
        // find an improving needle.
        while (alive(ctx, S)) {
            // Max-layers stop: each scan-side caps independently.
            const remainingSides = S.scanSides.filter(sd =>
                (sd === 'front' ? S.work.frontLayers : S.work.backLayers).length < S.maxLayers);
            if (remainingSides.length === 0) {
                console.log(`[GE] Max layers reached on all scan sides`);
                await finalize(ctx, S, 'Max layers reached'); return;
            }
            // Smaller side first (tiebreak: front).
            const orderedSides = [...remainingSides].sort((a, b) => {
                const la = (a === 'front' ? S.work.frontLayers : S.work.backLayers).length;
                const lb = (b === 'front' ? S.work.frontLayers : S.work.backLayers).length;
                return (la - lb) || (a === 'front' ? -1 : 1);
            });

            let needleAccepted = false;
            for (const sd of orderedSides) {
                if (!alive(ctx, S)) return;
                const ok = await tryAcceptOnSide(ctx, S, sd);
                if (ok) {
                    needleAccepted = true;
                    if (S.best.mf < S.targetMF) {
                        console.log(`[GE] Converged: best MF=${S.best.mf.toFixed(6)} < tol=${S.targetMF}`);
                        await finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`); return;
                    }
                }
            }
            if (needleAccepted) continue;

            // ── Forced total-optical-thickness step ──────────────────
            console.log('[GE] Needle-optimal on all eligible sides → forced GE step');
            if (!(await forcedGeStep(ctx, S))) return;
        }
    } catch (err) {
        // Expected: a Stop tears down the pool, which rejects the in-flight job
        // with 'pool terminated'. That's a clean stop, not an error — stopOpt
        // already ran, so just bail silently.
        if (!alive(ctx, S) || String(err && err.message) === 'pool terminated') return;
        if (!S.gotProgress) fallback(ctx, S, 'errored before progress', err);
        else { console.error('[GE] Pool error:', err); ctx.stopOpt(String(err && err.message || err)); }
    }
}

export function runGeWorker(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();   // M12: pick up manual edits made between runs

    const curDes   = ctx.baseDesignRef.current || ctx.designRef.current;
    const operands  = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) { ctx.setStatusMsg(ctx.t.gradualEvolution.noOperands); return; }

    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side); for forced modes we
    // scan one side. Seed DLS / candidate-DLS in both_independent vary BOTH sides
    // simultaneously regardless.
    const surfaceMode = curDes.surfaceMode || 'front_only';
    const scanSides = surfaceMode === 'both_independent' ? ['front', 'back'] : [activeSide(curDes)];

    const pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!pool.length) { ctx.setStatusMsg('No candidate materials'); return; }

    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    let materials;
    try {
        const lambdas = requiredLambdas(operands);
        const pairs = collectDesignMaterialIds(curDes).map(id => ({ id, mat: resolveMat(id) }))
            .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
        materials = buildPresampledTable(lambdas, pairs);
    } catch (err) {
        console.error('[GE] Pre-sampling failed, main-thread fallback:', err);
        runGeMainThread(ctx);
        return;
    }

    const innerEngine = getSynthesisInnerEngine('ge');   // GE default 'cg' (user-selectable)
    // Preserve-bulk + gentle refine (gated; default 'refine'). 'preserve-bulk':
    // skip the bare-seed refine (else a lone thick seed collapses 7k→2k nm for
    // zero MF gain) and refine each step GENTLY so the bulk persists and TOT
    // grows organically.
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const dlsIter = ctx.dlsIterRef.current;
    const K = poolSize();

    let workerPool;
    const wasmBytes = getTmmWasmBytesForWorker();
    window.electronAPI?.diagLog?.(`GE start: poolSize=${K} wasmBytesForWorker=${wasmBytes ? (wasmBytes.byteLength ?? wasmBytes.length) : 0} workerURL=${String(SYNTH_WORKER_URL)}`);
    try { workerPool = new WorkerPool(SYNTH_WORKER_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
    catch (err) {
        console.error('[GE] WorkerPool construction failed, main-thread fallback:', err);
        window.electronAPI?.diagLog?.(`GE WorkerPool construction FAILED → main-thread fallback: ${err?.message || err}`);
        runGeMainThread(ctx);
        return;
    }
    ctx.workerRef.current = workerPool;

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
    const poolLite = pool.map(p => ({ id: p.id, name: p.name }));

    ctx.runningRef.current = true;
    ctx.setPhase('refining');
    ctx.setStatusMsg('');

    // Whole-run state: config + mutable aggregation, threaded through the
    // module-scope orchestration handlers. best / work carry the FULL design
    // (front + back layers); either side may change in any cycle for
    // both_independent. genNum / geSteps / prevBestMF continue across Stop→Run
    // (M4) so gen numbering + the GE-step budget don't reset while history
    // persists; runT0 offsets the elapsed-time column by the last cycle's time.
    const S = {
        workerPool, operands, materials, media, curDes, pool, poolLite,
        poolSlices: chunkArray(poolLite, K), K,
        scanSides, innerEngine, preserveBulk, dlsIter,
        stepIter: preserveBulk ? Math.min(dlsIter, PRESERVE_BULK_GENTLE_ITER) : dlsIter,
        maxLayers: ctx.maxLayersRef.current, maxGeCycles: ctx.maxGeCyclesRef.current,
        targetMF: ctx.targetMFRef.current, dMin: ctx.dMinRef.current,
        maxBatches: getSynthesisMaxBatches(),      // cap candidate escalation
        tg: ctx.t.gradualEvolution,
        best: { mf: Infinity, frontLayers: null, backLayers: null },
        work: { mf: Infinity, frontLayers: null, backLayers: null },
        geStagn: { n: 0 },
        genNum: ctx.genCountRef.current, geSteps: ctx.geStepsRef.current,
        prevBestMF: ctx.cyclesRef.current.length ? Math.min(...ctx.cyclesRef.current.map(c => c.mf)) : Infinity,
        runT0: performance.now() - (ctx.cyclesRef.current.length
            ? (ctx.cyclesRef.current[ctx.cyclesRef.current.length - 1].tMs || 0) : 0),
        gotProgress: false, lastTick: 0,
    };

    runGeLoop(ctx, S);
}
