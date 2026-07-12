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
// GradualEvolution.js which builds the ctx and owns the React state.

import {
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
} from '../../../../utils/physics/optimizer.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import {
    getSynthesisInnerEngine, getSynthesisMaxBatches,
    getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    getSynthesisConsolidate, getSynthesisConsolidateTol,
    getSynthesisSmartSeed, getNeedleSensFloor, cullMarginalNeedles,
} from '../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../utils/workers/tmmWasm.js';
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../../workerUrls.js';
import {
    activeSide, densifyForRun, chunkArray, poolSize,
    resolveMat, minOmfOf, buildARSeedCandidates,
} from '../synthesisHelpers.js';
import { setCached } from '../geCache.js';
import { runGeMainThread } from './mainThread.js';

export function runGeWorker(ctx) {
    const {
        runningRef, workerRef, baseDesignRef, designRef, operandsRef, savedDesignRef,
        checkpointRef, cyclesRef, genCountRef, geStepsRef, updateDesignRef,
        selectedCatsRef, excludedMatsRef,
        maxLayersRef, maxGeCyclesRef, targetMFRef, dlsIterRef, dMinRef,
        setPhase, setStatusMsg, setCanReset, setMf, setOmf, setMfBest, setOmfBest,
        setCycles, setGeneration, setLayerCount, setGeSteps,
        reconcileBaseWithEdits, stopOpt, getPoolMaterials, t,
    } = ctx;
    const tg = t.gradualEvolution;

    if (runningRef.current) return;
    reconcileBaseWithEdits();   // M12: pick up manual edits made between runs

    const curDes   = baseDesignRef.current || designRef.current;
    const operands  = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) { setStatusMsg(t.gradualEvolution.noOperands); return; }

    // Sides to scan per cycle. For both_independent we scan BOTH front and
    // back and pick the global best needle (regardless of side); for
    // forced modes we scan one side. Seed DLS / candidate-DLS in
    // both_independent vary BOTH sides simultaneously regardless.
    const surfaceMode = curDes.surfaceMode || 'front_only';
    const scanSides = surfaceMode === 'both_independent'
        ? ['front', 'back']
        : [activeSide(curDes)];

    const pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
    if (!pool.length) { setStatusMsg('No candidate materials'); return; }

    if (!savedDesignRef.current) {
        checkpointRef.current && checkpointRef.current();
        savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
        baseDesignRef.current  = curDes;
        setCanReset(true);
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

    const maxLayers = maxLayersRef.current, maxGeCycles = maxGeCyclesRef.current,
          targetMF = targetMFRef.current, dlsIter = dlsIterRef.current, dMin = dMinRef.current;
    const innerEngine = getSynthesisInnerEngine('ge');   // GE default 'cg' (user-selectable)
    const maxBatches = getSynthesisMaxBatches();      // cap candidate escalation
    // Preserve-bulk + gentle refine (gated; default 'refine').
    // 'preserve-bulk': skip the bare-seed refine (else a lone thick seed
    // collapses 7k→2k nm for zero MF gain) and refine each step GENTLY so the
    // bulk persists and TOT grows organically.
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const stepIter = preserveBulk ? Math.min(dlsIter, PRESERVE_BULK_GENTLE_ITER) : dlsIter;
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
    workerRef.current = workerPool;

    const media = {
        surfaceMode:    curDes.surfaceMode || 'front_only',
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging: ship to the synthesis workers so
        // the scan (FD fallback) + DLS refine are cone-averaged like the eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
    const mkLayers = arr => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    // designSnap builds a full design from the CURRENT both-side state.
    // In both_independent each cycle re-snaps both sides from `best` so both
    // evolve through the run.
    const designSnap = (front, back) => ({
        ...media,
        frontLayers: mkLayers(front),
        backLayers:  mkLayers(back),
    });
    const deep = x => JSON.parse(JSON.stringify(x));
    const poolLite = pool.map(p => ({ id: p.id, name: p.name }));
    const poolSlices = chunkArray(poolLite, K);

    runningRef.current = true;
    setPhase('refining');
    setStatusMsg('');

    let gotProgress = false, lastTick = 0;
    const onTick = (_i, m) => {
        if (!m || m.type !== 'tick') return;
        const t = Date.now();
        if (t - lastTick < 90) return;
        lastTick = t;
        if (m.mf != null) setMf(m.mf);
        if (m.omf != null) setOmf(m.omf);
        const patch = {};
        if (m.frontLayers) patch.frontLayers = m.frontLayers;
        if (m.backLayers)  patch.backLayers  = m.backLayers;
        if (Object.keys(patch).length) {
            updateDesignRef.current(patch, { transient: true });
            if (m.layers) setLayerCount(m.layers.length);
        }
    };

    // best / work now carry the FULL design (front + back layers); either
    // side may change in any cycle for both_independent.
    const best = { mf: Infinity, frontLayers: null, backLayers: null };
    const work = { mf: Infinity, frontLayers: null, backLayers: null };
    const geStagn = { n: 0 };
    // M4: continue gen numbering, the GE-step budget, and the ΔMF baseline
    // across Stop→Run instead of resetting (which duplicated Gen numbers and
    // reset the maxGeCycles budget every Run while history persisted). Seed
    // from the continuous refs, matching the main-thread path.
    let genNum = genCountRef.current;
    let geSteps = geStepsRef.current;
    let prevBestMF = cyclesRef.current.length ? Math.min(...cyclesRef.current.map(c => c.mf)) : Infinity;
    // Elapsed-time column: cumulative wallclock since run start, continuous
    // across stop/resume (offset by the last recorded cycle's time).
    const _prevElapsed = cyclesRef.current.length
        ? (cyclesRef.current[cyclesRef.current.length - 1].tMs || 0) : 0;
    const runT0 = performance.now() - _prevElapsed;

    const alive = () => runningRef.current && workerRef.current === workerPool;

    const applyDesignPatch = (frontLayers, backLayers) => {
        const patch = {};
        if (frontLayers) patch.frontLayers = frontLayers;
        if (backLayers)  patch.backLayers  = backLayers;
        updateDesignRef.current(patch, { transient: true });
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    };

    const recordCycle = (type, mf, layerCount, insertMat, side, activeLayers, omf) => {
        genNum += 1;
        const dMF = prevBestMF === Infinity ? null : mf - prevBestMF;
        prevBestMF = Math.min(prevBestMF, mf);
        const fSnap = deep(work.frontLayers);
        const bSnap = deep(work.backLayers);
        // Total physical thickness (nm) of the whole design — the "TOT" column
        // (cf. OTF needle history): the thick seed holds the bulk budget and
        // needles redistribute it, so TOT should stay roughly flat (≈ seed),
        // not balloon. A runaway TOT signals over-forcing.
        const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
        const tot = sumD(fSnap) + sumD(bSnap);
        const cy = {
            id: Math.random().toString(36).slice(2),
            genNum, type, mf, omf, dMF, layerCount, insertMat, side, tot,
            tMs: performance.now() - runT0,
            layers:    deep(activeLayers),                 // active-side snapshot
            frontSnap: fSnap,
            backSnap:  bSnap,
        };
        cyclesRef.current   = [...cyclesRef.current, cy];
        genCountRef.current = genNum;
        setCycles(cyclesRef.current.slice());
        setGeneration(genNum);
        setLayerCount(layerCount);
        setMfBest(Math.min(best.mf, prevBestMF));
        if (omf != null) setOmf(omf);
        setOmfBest(minOmfOf(cyclesRef.current));
        setCached(designRef.current?.id, {
            cycles: cyclesRef.current, geSteps,
            savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
        });
    };

    // Merit-aware consolidation on the BEST design before committing
    // (Macleod, "Automatic Design": needle/GE thin+redundant layers "must
    // then be processed to remove them"). Trial-deletes each layer and
    // re-refines on the worker; keeps deletions that don't worsen MF beyond
    // `tol`. No-op when disabled, when best is ≤1 layer, or if the pool was
    // already torn down. Updates `best` in place and records a 'clean' row.
    const consolidateBest = async () => {
        if (!getSynthesisConsolidate()) return;
        if (workerRef.current !== workerPool) return;
        const total = (best.frontLayers?.length || 0) + (best.backLayers?.length || 0);
        if (total <= 1) return;
        setPhase('refining');
        setStatusMsg('Consolidating layers…');
        let res;
        try {
            res = await workerPool.run({
                type: 'removePass', operands,
                design: designSnap(best.frontLayers, best.backLayers),
                materials, dMin, side: scanSides[0], engine: innerEngine,
                tol: getSynthesisConsolidateTol(), minLayers: 1, maxIter: dlsIter,
            }, (m) => onTick(0, m));   // run() calls onProgress(m); onTick expects (i, m)
        } catch (_) { return; }       // pool terminated / errored → skip silently
        if (!alive() || !res) return;
        if ((res.removed || 0) <= 0) return;          // nothing redundant
        best.mf = res.mf;
        best.frontLayers = deep(res.frontLayers || best.frontLayers);
        best.backLayers  = deep(res.backLayers  || best.backLayers);
        work.mf = res.mf;
        work.frontLayers = deep(best.frontLayers);
        work.backLayers  = deep(best.backLayers);
        const cleanSide = scanSides[0];
        const activeLayers = cleanSide === 'back' ? best.backLayers : best.frontLayers;
        recordCycle('clean', res.mf, res.nLayers, null, cleanSide, activeLayers, res.omf);
        console.log(`[GE] Consolidate: removed ${res.removed} layer(s), ${res.baseLayers}→${res.nLayers}, MF ${res.baseMf?.toFixed?.(6)} → ${res.mf.toFixed(6)}`);
    };

    const finalize = async (reason) => {
        if (workerRef.current !== workerPool) return;
        await consolidateBest();
        if (workerRef.current !== workerPool) return;   // stopped during consolidation
        if (best.frontLayers || best.backLayers) {
            applyDesignPatch(best.frontLayers, best.backLayers);
            setMfBest(best.mf);
            const totalLayers =
                (best.frontLayers ? best.frontLayers.length : 0) +
                (best.backLayers  ? best.backLayers.length  : 0);
            setLayerCount(totalLayers);
        }
        setCached(designRef.current?.id, {
            cycles: cyclesRef.current, geSteps,
            savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
        });
        runningRef.current = false;
        setPhase('idle');
        setStatusMsg(reason || '');
        setCanReset(true);
        try { workerPool.terminate(); } catch (_) {}
        if (workerRef.current === workerPool) workerRef.current = null;
    };

    const fallback = (why, err) => {
        console.error(`[GE] Pool ${why}, main-thread fallback:`, err);
        window.electronAPI?.diagLog?.(`GE pool ${why} → main-thread fallback: ${err?.message || err}`);
        try { workerPool.terminate(); } catch (_) {}
        if (workerRef.current === workerPool) workerRef.current = null;
        runningRef.current = false;
        runGeMainThread(ctx);
    };

    (async () => {
        try {
            // ── Seed DLS ─────────────────────────────────────────────────
            // DLS in both_independent already varies both sides; in
            // forced-side modes only one side moves. We pass side as a
            // hint for tick streaming.
            const seedSide = scanSides[0];
            // preserve-bulk: dlsIter:0 → evaluate the seed MF only, leave the
            // thick bulk intact (refining the bare seed collapses it).
            const seedIter = preserveBulk ? 0 : dlsIter;
            setPhase('refining');
            let sres;
            // Smart seed: when enabled, generate the canonical
            // QW/HW antireflection starting designs from the pool PLUS the
            // current design, refine them ALL IN PARALLEL on the worker pool
            // (off the UI thread — never blocks, and scales with the pool),
            // then begin synthesis from whichever scores best. The current
            // design is a candidate, so the seed can only match or improve the
            // starting point. Disabled in preserve-bulk (that mode deliberately
            // keeps the user's thick seed intact and must not be replaced).
            if (getSynthesisSmartSeed('ge') && !preserveBulk) {
                const cands = buildARSeedCandidates({ design: curDes, pool, maxLayers });
                setStatusMsg(tg.smartSeeding(cands.length));
                const seedJobs = cands.map(cd => ({
                    type: 'seedDls', operands,
                    design: designSnap(mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
                    materials, dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: innerEngine,
                }));
                const seedResults = await workerPool.map(seedJobs, onTick);
                if (!alive()) return;
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
                setStatusMsg(preserveBulk ? 'Seed (bulk preserved)…' : 'Seed refinement…');
                sres = await workerPool.run({
                    type: 'seedDls', operands,
                    design: designSnap(mkLayers(curDes.frontLayers), mkLayers(curDes.backLayers)),
                    materials, dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: innerEngine,
                }, onTick);
            }
            if (!alive()) return;
            gotProgress = true;
            work.mf = sres.mf;
            work.frontLayers = deep(sres.frontLayers || []);
            work.backLayers  = deep(sres.backLayers  || []);
            best.mf = sres.mf;
            best.frontLayers = deep(work.frontLayers);
            best.backLayers  = deep(work.backLayers);
            applyDesignPatch(work.frontLayers, work.backLayers);
            setMf(sres.mf); setMfBest(sres.mf);
            if (sres.omf != null) { setOmf(sres.omf); setOmfBest(sres.omf); }
            const seedTotal = work.frontLayers.length + work.backLayers.length;
            setLayerCount(seedTotal);
            console.log(`[GE Seed] ${innerEngine.toUpperCase()} ${sres.iters} iters, MF=${sres.mf.toFixed(6)}`);
            // Record the seed/baseline as the first history row so its contribution
            // is visible — otherwise a strong smart-seed (or a refined start) leaves
            // the cycles table empty and the run looks like "nothing happened" when
            // the seed WAS the win. Fresh runs only (resume carries cycles).
            if (!cyclesRef.current.length) {
                const seedActive = (seedSide === 'back' ? work.backLayers : work.frontLayers);
                recordCycle((getSynthesisSmartSeed('ge') && !preserveBulk) ? 'seed' : 'baseline',
                    sres.mf, seedTotal, null, seedSide, seedActive, sres.omf ?? null);
            }

            // Per-side accept helper. Scans ONE side on the current `work`,
            // top-K DLS-refines improving candidates until one beats work.mf
            // or the queue is exhausted. Returns true if a needle was
            // accepted (work + best updated, cycle recorded). For
            // both_independent this is called once per side per outer
            // iteration so both stacks grow; for single-side modes it is
            // called once with the forced side.
            const tryAcceptOnSide = async (sd) => {
                const sideLen = (sd === 'front' ? work.frontLayers : work.backLayers).length;
                if (sideLen >= maxLayers) return false;
                setPhase('scanning');
                setStatusMsg(scanSides.length > 1 ? `Needle scan side=${sd}…` : 'Needle scan…');
                // ── timing (per-generation cost breakdown) ──
                const _genT0 = performance.now();
                const snap = designSnap(work.frontLayers, work.backLayers);
                const sideScanJobs = poolSlices.map(slice => ({
                    type: 'scan', operands, design: snap,
                    materials, poolSlice: slice, deltaNm: 0.5, side: sd }));
                const sideScanRes = await workerPool.map(sideScanJobs);
                if (!alive()) return false;
                const _scanMs = performance.now() - _genT0;
                let _refMs = 0, _nCand = 0;
                let candidates = [];
                for (const r of sideScanRes) candidates = candidates.concat(r.candidates || []);
                // Improving needles best-first, then cull the marginal tail
                // (H1 — needle sensitivity; no-op when 'off' ⇒ bit-identical).
                const queue = cullMarginalNeedles(
                    candidates.filter(c => c.dMF < 0).sort((a, b) =>
                        (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
                        (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
                    getNeedleSensFloor());
                if (queue.length === 0) return false;

                // Cap how many K-batches we refine per step. The
                // long tail of marginal P-candidates was the 9–21 s/gen stall
                // cost (45–56 candidates = 6–7 rounds); OTF inserts the best
                // few and moves on. When the capped batches don't improve we
                // fall through to forced-TOT (which re-scans) sooner.
                let _batchN = 0;
                for (let i = 0; i < queue.length && _batchN < maxBatches && alive(); i += K, _batchN++) {
                    const batch = queue.slice(i, i + K);
                    setPhase('refining');
                    setStatusMsg(`${innerEngine.toUpperCase()} refine ${batch.length} candidate${batch.length > 1 ? 's' : ''}${scanSides.length > 1 ? ` (side=${sd})` : ''}…`);
                    const bsnap = designSnap(deep(work.frontLayers), deep(work.backLayers));
                    const _rT0 = performance.now();
                    const results = await workerPool.map(batch.map((cand, bi) => ({
                        type: 'candidate', pipeline: 'ge',
                        operands, design: bsnap, materials,
                        cand: { ...cand, _cid: bi },
                        dMin, dlsIter: stepIter, jobId: `g_${sd}_${i}_${bi}`,
                        side: cand.side || sd, engine: innerEngine,
                    })), onTick);
                    _refMs += performance.now() - _rT0; _nCand += batch.length;
                    if (!alive()) return false;

                    let bIdx = -1, bMf = Infinity;
                    for (let r = 0; r < results.length; r++) {
                        const rr = results[r];
                        if (rr.allPruned || rr.mfNow == null) continue;
                        if (rr.mfNow < bMf) { bMf = rr.mfNow; bIdx = r; }
                    }
                    if (bIdx >= 0 && bMf < work.mf - 1e-9) {
                        const res  = results[bIdx];
                        const cand = batch[bIdx];
                        const candSide = cand.side || sd;
                        work.mf = bMf;
                        work.frontLayers = deep(res.frontLayers || work.frontLayers);
                        work.backLayers  = deep(res.backLayers  || work.backLayers);
                        applyDesignPatch(work.frontLayers, work.backLayers);
                        setMf(bMf);
                        if (res.omf != null) setOmf(res.omf);
                        const newGlobalBest = bMf < best.mf - 1e-9;
                        if (newGlobalBest) {
                            best.mf = bMf;
                            best.frontLayers = deep(work.frontLayers);
                            best.backLayers  = deep(work.backLayers);
                            geStagn.n = 0;
                        }
                        const activeLayers = candSide === 'back' ? work.backLayers : work.frontLayers;
                        recordCycle('needle', bMf, res.nLayers, cand.materialId, candSide, activeLayers, res.omf);
                        console.log(`[GE] ACCEPT needle (best of ${batch.length}, side=${candSide}): workMF=${bMf.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${best.mf.toFixed(6)})`} layers=${res.nLayers}`);
                        console.log(`[GE timing] engine=${innerEngine} ACCEPT layers=${res.nLayers} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand} gen=${(performance.now() - _genT0).toFixed(0)}ms (scan ${(100*_scanMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}% / refine ${(100*_refMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}%)`);
                        return true;
                    }
                    console.log(`[GE] side=${sd} batch ${i}-${i + batch.length - 1}: none beat workMF=${work.mf.toFixed(6)} → next`);
                }
                // Distinguish a TRUE needle-optimum (queue exhausted) from a
                // batch-CAP early exit (more candidates remain, but the cap
                // reached → go to forced-TOT, which re-scans).
                const _capped = _batchN >= maxBatches && _batchN * K < queue.length;
                console.log(`[GE timing] ${_capped ? `CAPPED@${maxBatches}b` : 'NEEDLE-OPTIMAL'} side=${sd} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand}/${queue.length}`);
                return false;
            };

            // ── Outer GE loop ────────────────────────────────────────────
            // Option 1 (per-side acceptance): each outer iteration processes
            // every eligible side independently. The side with fewer layers
            // is tried first so growth stays roughly balanced; if a side
            // accepts, the next side re-scans on the updated `work`. Forced
            // GE only fires when NO side could find an improving needle.
            while (alive()) {
                // Max-layers stop: each scan-side caps independently.
                const remainingSides = scanSides.filter(sd =>
                    (sd === 'front' ? work.frontLayers : work.backLayers).length < maxLayers);
                if (remainingSides.length === 0) {
                    console.log(`[GE] Max layers reached on all scan sides`);
                    await finalize('Max layers reached'); return;
                }
                // Smaller side first (tiebreak: front).
                const orderedSides = [...remainingSides].sort((a, b) => {
                    const la = (a === 'front' ? work.frontLayers : work.backLayers).length;
                    const lb = (b === 'front' ? work.frontLayers : work.backLayers).length;
                    return (la - lb) || (a === 'front' ? -1 : 1);
                });

                let needleAccepted = false;
                for (const sd of orderedSides) {
                    if (!alive()) return;
                    const ok = await tryAcceptOnSide(sd);
                    if (ok) {
                        needleAccepted = true;
                        if (best.mf < targetMF) {
                            console.log(`[GE] Converged: best MF=${best.mf.toFixed(6)} < tol=${targetMF}`);
                            await finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                        }
                    }
                }
                const goForced = !needleAccepted;
                if (goForced) {
                    console.log('[GE] Needle-optimal on all eligible sides → forced GE step');
                }
                if (needleAccepted) continue;

                // ── Forced total-optical-thickness step ──────────────────
                if (goForced) {
                    if (geSteps >= maxGeCycles) {
                        console.log(`[GE] Max GE steps reached (${geSteps})`);
                        await finalize('Max GE steps reached'); return;
                    }
                    // Pick the side with room; in both_independent prefer
                    // whichever has fewer layers (balance growth).
                    const eligible = remainingSides.filter(sd =>
                        (sd === 'front' ? work.frontLayers : work.backLayers).length < maxLayers);
                    if (eligible.length === 0) { await finalize('Max layers reached'); return; }
                    const geSide = eligible.length === 1 ? eligible[0]
                        : (work.frontLayers.length <= work.backLayers.length ? 'front' : 'back');
                    setPhase('scanning'); setStatusMsg('Forced GE step…');
                    const _geT0 = performance.now();
                    const gres = await workerPool.run({
                        type: 'geStep', operands,
                        design: designSnap(work.frontLayers, work.backLayers),
                        materials, pool: poolLite, dMin, side: geSide,
                    });
                    if (!alive()) return;
                    console.log(`[GE timing] FORCED-TOT geStep=${(performance.now() - _geT0).toFixed(0)}ms`);
                    if (gres.empty) { await finalize('Converged (stuck)'); return; }
                    work.mf = gres.mfNew;
                    work.frontLayers = deep(gres.frontLayers || work.frontLayers);
                    work.backLayers  = deep(gres.backLayers  || work.backLayers);
                    applyDesignPatch(work.frontLayers, work.backLayers);
                    setMf(gres.mfNew);
                    setOmf(gres.mfNew);
                    geSteps += 1; geStagn.n += 1;
                    geStepsRef.current = geSteps; setGeSteps(geSteps);
                    const geActive = gres.side === 'back' ? work.backLayers : work.frontLayers;
                    console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
                    recordCycle('ge', gres.mfNew, gres.nLayers, gres.materialId, gres.side, geActive, gres.mfNew);
                    if (geStagn.n > 6) {
                        console.log('[GE] No new best after repeated GE steps — stopping');
                        await finalize('Converged (stuck)'); return;
                    }
                }
            }
        } catch (err) {
            // Expected: a Stop tears down the pool, which rejects the
            // in-flight job with 'pool terminated'. That's a clean stop, not
            // an error — stopOpt already ran, so just bail silently.
            if (!alive() || String(err && err.message) === 'pool terminated') return;
            if (!gotProgress) fallback('errored before progress', err);
            else { console.error('[GE] Pool error:', err); stopOpt(String(err && err.message || err)); }
        }
    })();
}
