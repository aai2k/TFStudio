// Main-thread Gradual-Evolution engine — the fallback used only when the
// synthesis worker pool fails before any progress. Identical GE math to the
// worker path (workerPool.js) but run synchronously via a setTimeout-driven
// `tick` state machine, so it blocks the UI thread (the lag the worker removes).
//
// A plain function of the GradualEvolution window's `ctx` bag (refs + state
// setters + the reconcile / pool helpers); see GradualEvolution.js which builds
// the ctx and owns the React state these refs/setters point at.

import {
    scanNeedlesPFunction, scanGEInsertions, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers,
} from '../../../../utils/physics/optimizer.js';
import { makeEngine } from '../../../../utils/optimizers/index.js';
import {
    getSynthesisInnerEngine, getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    getNeedleSensFloor, cullMarginalNeedles,
} from '../../../../utils/synthesis/synthesisConfig.js';
import { activeSide, densifyForRun, resolveMat, minOmfOf, matFriendlyName } from '../synthesisHelpers.js';
import { setCached } from '../geCache.js';

export function runGeMainThread(ctx) {
    const {
        runningRef, timerRef, dlsRef, baseDesignRef, savedDesignRef, designRef,
        operandsRef, cyclesRef, genCountRef, geStepsRef, updateDesignRef, checkpointRef,
        maxLayersRef, maxGeCyclesRef, targetMFRef, dlsIterRef, dMinRef,
        selectedCatsRef, excludedMatsRef,
        setPhase, setStatusMsg, setCanReset, setMf, setOmf, setMfBest, setOmfBest,
        setCycles, setGeneration, setLayerCount, setGeSteps,
        reconcileBaseWithEdits, getPoolMaterials,
    } = ctx;

    if (runningRef.current) return;
    reconcileBaseWithEdits();

    const curDes  = baseDesignRef.current || designRef.current;
    const operands = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) return;

    // Surface-mode-aware active side. insertNeedle / insertNeedleIntra and
    // the DLS optimizer all take side; symmetric mode is mirror-handled at
    // the layer-mutator helpers.
    const side = activeSide(curDes);
    const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

    if (!savedDesignRef.current) {
        // One undo checkpoint for the whole GE run; the per-step design
        // writes below are transient previews (no per-iteration history).
        checkpointRef.current && checkpointRef.current();
        savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
        baseDesignRef.current  = curDes;
        setCanReset(true);
    }

    runningRef.current = true;
    setPhase('refining');
    setStatusMsg('');

    // ── GE state (per run, stored in refs) ────────────────────────────────
    // phaseRef: 'seed_dls' | 'needle_scan' | 'dls1' | 'dls2'
    // Initial 'seed_dls' refines the current design before any needle
    // scanning — matches Python gradual_evolution.py lines 151-156.
    const phaseRef    = { current: 'seed_dls' };
    const dlsIter1Ref = { current: 0 };
    const dlsIter2Ref = { current: 0 };
    const seedIterRef = { current: 0 };
    let prePruneCount = 0;

    // Preserve-bulk mirrors the worker path: skip the bare-seed refine and
    // refine each step gently (see runOpt + synthesisConfig).
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const gentleIter = () => Math.min(dlsIterRef.current, PRESERVE_BULK_GENTLE_ITER);
    const _prevElapsed = cyclesRef.current.length
        ? (cyclesRef.current[cyclesRef.current.length - 1].tMs || 0) : 0;
    const runT0 = performance.now() - _prevElapsed;

    // Initialize seed refiner on the starting design (CG/DLS per setting).
    const innerEngine = getSynthesisInnerEngine('ge');
    try {
        dlsRef.current = makeEngine(innerEngine, operands, baseDesignRef.current, resolveMat, { dMin: dMinRef.current });
        seedIterRef.current = 0;
        setStatusMsg('Seed refinement…');
    } catch (err) {
        console.error('[GE] Seed DLS init failed:', err);
        runningRef.current = false; setPhase('idle'); return;
    }

    // ── Canonical GE state (Tikhonravov, Trubetskov & DeBell 2007,
    //    Appl. Opt. 46(5):704): inner needle-optimization loop +
    //    outer forced total-optical-thickness "GE step", keep-best. ──
    // `work` = current working design (accumulates: only changes via an
    // accepted needle or a forced TOT step — never snaps back). `best` =
    // lowest-MF design seen, restored at the end + highlighted in history.
    const best       = { mf: Infinity, front: null };
    const work       = { mf: Infinity, front: null };
    const curMF      = { v: null };
    const lastInsert = { mat: null };
    const geStagn    = { n: 0 };                       // consecutive GE steps with no new global best
    let   queue      = [];                             // improving needle candidates for current `work`
    let   qIdx       = 0;
    let   pool       = [];

    const deepActive = d => JSON.parse(JSON.stringify(d[LK] || []));
    const setBase   = front => {
        baseDesignRef.current = { ...(baseDesignRef.current || {}), [LK]: JSON.parse(JSON.stringify(front)) };
        updateDesignRef.current({ [LK]: JSON.parse(JSON.stringify(front)) }, { transient: true });
    };

    // Insert queue[idx] into `work` at its optimal thickness, spin up DLS1.
    const startNeedleCandidate = (idx) => {
        setBase(work.front);
        const design = baseDesignRef.current;
        const cand   = queue[idx];
        cand._mat    = pool.find(p => p.id === cand.materialId)?.mat;
        lastInsert.mat = cand.materialId;

        let dOpt = dMinRef.current;
        try {
            dOpt = findOptimalNeedleThickness({
                operands, design, resolveMat,
                candidate: cand, deltaNm: dMinRef.current, maxNm: 500, tol: 0.5, side,
            });
            if (!(dOpt >= dMinRef.current)) dOpt = dMinRef.current;
        } catch (e) { dOpt = dMinRef.current; }

        const posLabel = cand.intra
            ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
        console.log(`[GE Insert #${idx + 1}/${queue.length}] NEEDLE ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

        const newDesign = cand.intra
            ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, side)
            : insertNeedle(design, cand.pos, cand.materialId, dOpt, side);
        baseDesignRef.current = newDesign;
        updateDesignRef.current({ [LK]: newDesign[LK] }, { transient: true });

        try {
            dlsRef.current      = makeEngine(innerEngine, operands, newDesign, resolveMat, { dMin: dMinRef.current });
            dlsIter1Ref.current = 0;
        } catch (err) {
            console.error('[GE] DLS1 init failed:', err);
            finalize('DLS init failed'); return;
        }
        phaseRef.current = 'dls1';
        setPhase('refining');
        setStatusMsg('DLS refine 1…');
        timerRef.current = setTimeout(tick, 0);
    };

    // Restore the global best design and finish.
    const finalize = (msg) => {
        if (best.front) {
            baseDesignRef.current = { ...(baseDesignRef.current || {}), [LK]: JSON.parse(JSON.stringify(best.front)) };
            updateDesignRef.current({ [LK]: JSON.parse(JSON.stringify(best.front)) }, { transient: true });
            setMfBest(best.mf);
            setLayerCount(best.front.length);
        }
        runningRef.current = false;
        setPhase('idle');
        setStatusMsg(msg);
    };

    const recordCycle = (type, mf, layerCount, insertMat, omf) => {
        genCountRef.current += 1;
        const genNum = genCountRef.current;
        const prevBest = cyclesRef.current.length ? Math.min(...cyclesRef.current.map(c => c.mf)) : Infinity;
        cyclesRef.current = [...cyclesRef.current, {
            id: Math.random().toString(36).slice(2),
            genNum, type, mf, omf,
            dMF: prevBest === Infinity ? null : mf - prevBest,
            layerCount, insertMat,
            tMs: performance.now() - runT0,
            layers: JSON.parse(JSON.stringify(baseDesignRef.current[LK] || [])),
        }];
        setCycles(cyclesRef.current.slice());
        setGeneration(genNum);
        setLayerCount(layerCount);
        setMfBest(Math.min(best.mf, ...cyclesRef.current.map(c => c.mf)));
        if (omf != null) setOmf(omf);
        setOmfBest(minOmfOf(cyclesRef.current));
        setCached(designRef.current?.id, {
            cycles: cyclesRef.current, geSteps: geStepsRef.current,
            savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
        });
    };

    const tick = () => {
        if (!runningRef.current) return;

        // ── Seed DLS phase (initial refinement of seed design) ────────────
        if (phaseRef.current === 'seed_dls') {
            const dls     = dlsRef.current;
            const maxIter = preserveBulk ? 0 : dlsIterRef.current;
            // preserve-bulk: don't step the bare seed at all (one layer can't
            // lower a broadband merit; stepping only thins it). Just evaluate.
            if (!preserveBulk) {
                dls.step();
                seedIterRef.current++;
                setMf(dls.mf);
                setOmf(dls.mfOpticalAt(dls.thicknesses));
            }

            const done = preserveBulk || dls.isConverged() || seedIterRef.current >= maxIter;
            if (!done) { timerRef.current = setTimeout(tick, 0); return; }

            const seedDesign = dls.applyToDesign(baseDesignRef.current);
            baseDesignRef.current = seedDesign;
            updateDesignRef.current({ [LK]: seedDesign[LK] }, { transient: true });

            // Seed-refined design is the first work AND best.
            work.mf    = dls.mf;
            work.front = deepActive(seedDesign);
            best.mf    = dls.mf;
            best.front = deepActive(seedDesign);
            curMF.v    = dls.mf;
            setMfBest(dls.mf);
            { const o = dls.mfOpticalAt(dls.thicknesses); setOmf(o); setOmfBest(o); }

            const thicksStr = dls.thicknesses.map(t => t.toFixed(1)).join(', ');
            const seedNames = (seedDesign[LK] || []).map(l => matFriendlyName(l.material)).join(', ');
            console.log(`[GE Seed] ${seedNames} → DLS ${seedIterRef.current} iters, MF=${dls.mf.toFixed(6)} thicknesses=[${thicksStr}]`);
            console.log('');

            phaseRef.current = 'needle_scan';
            setPhase('scanning');
            setStatusMsg('');
            timerRef.current = setTimeout(tick, 0);
            return;
        }

        // ── Needle scan phase (inner needle-optimization loop) ────────────
        if (phaseRef.current === 'needle_scan') {
            setBase(work.front);                       // operate on current work
            const design = baseDesignRef.current;
            const layers = design[LK] || [];

            if (layers.length >= maxLayersRef.current) {
                console.log(`[GE] Max layers reached (${layers.length}) — restoring best MF=${best.mf.toFixed(6)}`);
                finalize('Max layers reached'); return;
            }

            const thickStr = layers.map(l => `${(l.thickness||0).toFixed(1)}nm ${l.material}`).join(', ');
            console.log(`[GE NeedleScan] geStep=${geStepsRef.current} workMF=${work.mf.toFixed(6)} bestMF=${best.mf.toFixed(6)} layers=${layers.length} [${thickStr}]`);

            pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
            console.log(`[GE NeedleScan] pool=[${pool.map(p => p.name).join(', ')}]`);
            setStatusMsg('Needle scan…');
            if (!pool.length) { finalize('No candidate materials'); return; }

            const { candidates } = scanNeedlesPFunction({
                operands, design, resolveMat, candidateMats: pool, deltaNm: 0.5, side,
            });
            // All improving needles, best (most negative ΔMF) first, then cull
            // the marginal tail (H1 — needle sensitivity; no-op when 'off').
            queue = cullMarginalNeedles(
                candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
                getNeedleSensFloor());
            qIdx  = 0;

            if (queue.length === 0) {
                console.log('[GE] Needle-optimal (no improving needle) → forced GE step');
                phaseRef.current = 'ge_step';
                timerRef.current = setTimeout(tick, 0);
                return;
            }
            startNeedleCandidate(0);

        // ── DLS-1 refinement phase ────────────────────────────────────────
        } else if (phaseRef.current === 'dls1') {
            const dls     = dlsRef.current;
            const maxIter = preserveBulk ? gentleIter() : dlsIterRef.current;

            dls.step();
            dlsIter1Ref.current++;
            setMf(dls.mf);
            setOmf(dls.mfOpticalAt(dls.thicknesses));

            const done = dls.isConverged() || dlsIter1Ref.current >= maxIter;
            if (!done) { timerRef.current = setTimeout(tick, 0); return; }

            console.log(`[GE DLS1] ${dlsIter1Ref.current} iters, MF=${dls.mf.toFixed(6)} layers=${dls.thicknesses.length}`);

            const postDls1 = dls.applyToDesign(baseDesignRef.current);
            prePruneCount  = (postDls1[LK] || []).length;
            const pruned   = cleanupLayers(postDls1[LK] || [], dMinRef.current);
            if (pruned.length < prePruneCount) {
                console.log(`[GE Prune] ${prePruneCount}→${pruned.length} layers (removed ${prePruneCount - pruned.length})`);
            }
            if (pruned.length === 0) { finalize('All layers pruned'); return; }

            const prunedDesign = { ...postDls1, [LK]: pruned };
            baseDesignRef.current = prunedDesign;
            updateDesignRef.current({ [LK]: pruned }, { transient: true });

            try {
                dlsRef.current      = makeEngine(innerEngine, operands, prunedDesign, resolveMat, { dMin: dMinRef.current });
                dlsIter2Ref.current = 0;
            } catch (err) {
                console.error('[GE] DLS2 init failed:', err);
                finalize('DLS init failed'); return;
            }
            phaseRef.current = 'dls2';
            setStatusMsg('DLS refine 2…');
            timerRef.current = setTimeout(tick, 0);

        // ── DLS-2 refinement phase (accept-or-revert) ─────────────────────
        } else if (phaseRef.current === 'dls2') {
            const dls     = dlsRef.current;
            const maxIter = Math.max(1, Math.floor((preserveBulk ? gentleIter() : dlsIterRef.current) / 2));

            dls.step();
            dlsIter2Ref.current++;
            setMf(dls.mf);
            setOmf(dls.mfOpticalAt(dls.thicknesses));

            const done = dls.isConverged() || dlsIter2Ref.current >= maxIter;
            if (!done) { timerRef.current = setTimeout(tick, 0); return; }

            const mfNow       = dls.mf;
            const mfNowOmf    = dls.mfOpticalAt(dls.thicknesses);
            const finalDesign = dls.applyToDesign(baseDesignRef.current);
            const nLayers     = (finalDesign[LK] || []).length;
            console.log(`[GE DLS2] ${dlsIter2Ref.current} iters, MF=${mfNow.toFixed(6)} layers=${nLayers}`);
            dlsRef.current = null;

            // Accept if this needle improves the CURRENT working design
            // (needle-opt progresses even when work is above the global
            // best — e.g. just after a forced TOT step).
            if (mfNow < work.mf - 1e-9) {
                work.mf    = mfNow;
                work.front = deepActive(finalDesign);
                curMF.v    = mfNow;
                baseDesignRef.current = finalDesign;
                updateDesignRef.current({ [LK]: finalDesign[LK] }, { transient: true });

                const newGlobalBest = mfNow < best.mf - 1e-9;
                if (newGlobalBest) {
                    best.mf = mfNow;
                    best.front = deepActive(finalDesign);
                    geStagn.n = 0;
                }
                recordCycle('needle', mfNow, nLayers, lastInsert.mat, mfNowOmf);
                console.log(`[GE] ACCEPT needle: workMF=${mfNow.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${best.mf.toFixed(6)})`} layers=${nLayers}`);
                console.log('');

                if (best.mf < targetMFRef.current) {
                    console.log(`[GE] Converged: best MF=${best.mf.toFixed(6)} < tol=${targetMFRef.current}`);
                    finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                }
                phaseRef.current = 'needle_scan';
                setPhase('scanning');
                setStatusMsg('');
                timerRef.current = setTimeout(tick, 0);
            } else {
                // This needle didn't help the working design → try the
                // next-best candidate; only when all fail is `work`
                // needle-optimal and we do the forced TOT step.
                qIdx += 1;
                if (qIdx < queue.length) {
                    console.log(`[GE] REJECT needle: MF=${mfNow.toFixed(6)} ≥ workMF=${work.mf.toFixed(6)} → try next (${qIdx + 1}/${queue.length})`);
                    startNeedleCandidate(qIdx);
                    return;
                }
                console.log(`[GE] All ${queue.length} needles failed → needle-optimal → forced GE step`);
                console.log('');
                setBase(work.front);
                curMF.v = work.mf;
                phaseRef.current = 'ge_step';
                setPhase('scanning');
                timerRef.current = setTimeout(tick, 0);
            }

        // ── Forced GE step: deliberately increase total optical thickness ──
        //    (Tikhonravov 2007 §2: forced TOT increase between needle
        //    optimizations; MF typically rises and is then recovered by the
        //    subsequent needle optimization.)
        } else if (phaseRef.current === 'ge_step') {
            // Forced TOT increase applied to `work` (NOT the global best):
            // work accumulates, so consecutive GE steps act on ever-larger
            // designs (Tikhonravov 2007 §2) — no identical-loop.
            setBase(work.front);
            const design = baseDesignRef.current;
            const layers = design[LK] || [];

            if (geStepsRef.current >= maxGeCyclesRef.current) {
                console.log(`[GE] Max GE steps reached (${geStepsRef.current}) — restoring best MF=${best.mf.toFixed(6)}`);
                finalize('Max GE steps reached'); return;
            }
            if (layers.length >= maxLayersRef.current) {
                finalize('Max layers reached'); return;
            }

            pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
            if (!pool.length) { finalize('No candidate materials'); return; }

            const { candidates: geC, mf0: geMf0 } = scanGEInsertions({
                operands, design, resolveMat, candidateMats: pool, thickNm: dMinRef.current, side,
            });
            if (!geC.length) { finalize('Converged (stuck)'); return; }
            const bestGe = geC.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geC[0]);

            const _geIns = insertNeedle(design, bestGe.pos, bestGe.materialId, dMinRef.current, side);
            // Merge adjacent same-material layers — a forced insert next to the
            // same material thickens it, not stacks a separate layer (optically
            // identical, so mfNew is unchanged). Fixes "N×same-material in a row".
            const geDesign = { ..._geIns,
                frontLayers: cleanupLayers(_geIns.frontLayers || [], dMinRef.current),
                backLayers:  cleanupLayers(_geIns.backLayers  || [], dMinRef.current) };
            // `work` becomes the TOT-increased design (accumulates).
            work.mf    = bestGe.mfNew;
            work.front = deepActive(geDesign);
            baseDesignRef.current = geDesign;
            updateDesignRef.current({ [LK]: geDesign[LK] }, { transient: true });

            geStepsRef.current += 1;
            geStagn.n += 1;
            setGeSteps(geStepsRef.current);
            curMF.v = bestGe.mfNew;
            const nLayers = (geDesign[LK] || []).length;
            console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${nLayers}`);
            recordCycle('ge', bestGe.mfNew, nLayers, bestGe.materialId, bestGe.mfNew);

            // Stagnation guard: many GE steps with no new GLOBAL best.
            if (geStagn.n > 6) {
                console.log('[GE] No new best after repeated GE steps — restoring best, stopping');
                finalize('Converged (stuck)'); return;
            }

            phaseRef.current = 'needle_scan';
            dlsRef.current   = null;
            setPhase('scanning');
            setStatusMsg('');
            timerRef.current = setTimeout(tick, 0);
        }
    };

    timerRef.current = setTimeout(tick, 0);
}
