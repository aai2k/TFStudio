// Main-thread refinement fallback. Used only if the Web Worker fails to
// construct or errors before producing any progress (e.g. a future Electron that
// blocks module workers from file://). Functionally identical to the worker
// path, but it blocks the UI thread — so it is the fallback, not the default.
//
// Like every runner in this folder it is a plain function of an explicit `ctx`
// bag assembled by the Refinement component (refs, state setters, cache helpers,
// and the locale table `t`) rather than a closure over component scope.

import { DLSOptimizer, mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { resolveMat, densifyForRun } from '../refinementUtils.js';

export function runOptMainThread(ctx) {
    const {
        runningRef, designRef, operandsRef, maxIterRef, multiStartRef,
        nRestartsRef, perturbPctRef, checkpointRef, updateDesignRef, optimizerRef, timerRef,
        commitBaseline, bumpRunCount, addHistEntry, histRunCount, t,
        setMfInitial, setOmfInitial, setRunning, setCanReset, setMfHistory,
        setMfBest, setOmfBest, setRestartIdx, setIter, setMf, setOmf,
    } = ctx;

    if (runningRef.current) return;

    const curDes = designRef.current;
    const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;

    const MAX_ITER = maxIterRef.current || 500;
    // Steps run per animation tick before touching React state / live
    // preview. The DLS step itself is cheap; the per-iteration cost is the
    // panel re-render + global-design update (which replots the whole
    // spectrum). Batching amortizes that ~UI_BATCH×. Pure UI throttle —
    // the optimizer math is untouched.
    const UI_BATCH = 25;

    // ── Multi-start path ──────────────────────────────────────────────────
    // Which stack(s) get perturbed depends on surfaceMode:
    //   front_only        → perturb frontLayers
    //   back_only         → perturb backLayers
    //   symmetric         → perturb frontLayers (back auto-syncs via DLS)
    //   both_independent  → perturb both
    const surfMode = curDes.surfaceMode || 'front_only';
    const hasFront = (curDes.frontLayers || []).length > 0;
    const hasBack  = (curDes.backLayers  || []).length > 0;
    const msEligible = (surfMode === 'back_only')
        ? hasBack
        : (surfMode === 'both_independent' ? (hasFront || hasBack) : hasFront);

    if (multiStartRef.current && msEligible) {
        const N    = Math.max(1, Math.floor(nRestartsRef.current));
        const pct  = Math.max(0, perturbPctRef.current) / 100;
        const D_MIN = 1.0;
        const D_MAX = 2000.0;

        // One undo checkpoint for the whole run, then save the Reset
        // baseline (cached so it survives a window switch).
        checkpointRef.current && checkpointRef.current();
        commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        const baselineFront = JSON.parse(JSON.stringify(curDes.frontLayers || []));
        const baselineBack  = JSON.parse(JSON.stringify(curDes.backLayers  || []));

        // Baseline MF (used as initial reference) + baseline optimization
        // vector, so the unperturbed starting design seeds the global best
        // (M7) and a perturbed restart is adopted only if it actually beats it.
        let mfInit = null;
        let baselineThicks = null, baselineOmf = null;
        try {
            const baseOpt = new DLSOptimizer(ops, curDes, resolveMat);
            mfInit = baseOpt.mf;
            baselineThicks = [...baseOpt.thicknesses];
            baselineOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
            setMfInitial(mfInit);
            setOmfInitial(baselineOmf);
        } catch (err) {
            console.error('[Multi-start] Initial eval failed:', err);
            return;
        }

        bumpRunCount();
        const runLabel = t.refinement.history.run(histRunCount.current);

        runningRef.current = true;
        setRunning(true);
        setCanReset(true);
        setMfHistory([]);
        setMfBest(null);
        setOmfBest(null);
        setRestartIdx(0);

        // M7: seed the global best with the UNPERTURBED starting design so a
        // run can never apply a perturbed restart that is worse than where we
        // started. (Every restart in this path perturbs the baseline; without
        // this seed the least-bad perturbation would be applied even if all
        // were worse than the original.)
        let globalBestMF      = mfInit ?? Infinity;
        let globalBestOMF     = baselineOmf;   // optical merit of the global-best design (display only)
        let globalBestThicks  = baselineThicks; // optimization vector (front, back, or front+back depending on mode)
        let restart           = 0;
        let totalIter         = 0;

        // Helper: perturb a layer array (skipping locked ones).
        const perturbLayers = (layers) => layers.map(l => {
            if (l.locked) return { ...l };
            const base = l.thickness || 0;
            const factor = 1 + pct * (Math.random() * 2 - 1);
            let tt = base * factor;
            if (tt < D_MIN) tt = D_MIN;
            if (tt > D_MAX) tt = D_MAX;
            return { ...l, thickness: tt };
        });

        // Helper: map an optimization vector back to design.frontLayers / backLayers
        // given the surfaceMode and baselines.
        const applyVecToDesign = (d, vec) => {
            if (surfMode === 'both_independent') {
                const nFront = baselineFront.length;
                const frontT = vec.slice(0, nFront);
                const backT  = vec.slice(nFront);
                return {
                    ...d,
                    frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: frontT[i] ?? l.thickness })),
                    backLayers:  baselineBack .map((l, i) => ({ ...l, thickness: backT [i] ?? l.thickness })),
                };
            }
            if (surfMode === 'symmetric') {
                const front = baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness }));
                return { ...d, frontLayers: front, backLayers: mirrorLayers(front) };
            }
            if (surfMode === 'back_only') {
                return { ...d, backLayers: baselineBack.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
            }
            // front_only
            return { ...d, frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
        };

        const runOne = () => {
            if (!runningRef.current) return;
            if (restart >= N) {
                // All restarts done — apply best and finish
                runningRef.current = false;
                setRunning(false);
                setRestartIdx(0);
                if (globalBestThicks) {
                    const finalDesign = applyVecToDesign(curDes, globalBestThicks);
                    updateDesignRef.current({
                        frontLayers: finalDesign.frontLayers,
                        backLayers:  finalDesign.backLayers,
                    }, { transient: true });
                    // Build a synthetic optimizer-like ref so Best/Reset still work
                    optimizerRef.current = {
                        iter: totalIter,
                        mf: globalBestMF, mfBest: globalBestMF,
                        thickBest: globalBestThicks,
                        layerSide: surfMode === 'back_only' ? 'backLayers' : 'frontLayers',
                        applyToDesign: (d) => applyVecToDesign(d, globalBestThicks),
                        restoreBest: () => {},
                    };
                    // History entry captures whichever stack was the optimization vector
                    const histLayers = surfMode === 'back_only' ? finalDesign.backLayers : finalDesign.frontLayers;
                    const entry = {
                        id: Math.random().toString(36).slice(2),
                        label: runLabel + ` (×${N})`,
                        iter:  totalIter,
                        mf:    globalBestMF,
                        omf:   globalBestOMF,
                        layers: histLayers,
                        layerCount: histLayers.length,
                        layerSide: surfMode === 'back_only' ? 'backLayers' : 'frontLayers',
                    };
                    addHistEntry(entry);
                }
                console.log(`[Multi-start] Done: ${N} restarts, best MF=${globalBestMF.toFixed(6)} (mode=${surfMode})`);
                return;
            }

            restart += 1;
            setRestartIdx(restart);

            // Build a perturbed design for this restart, perturbing only the stack(s)
            // that the surface mode marks as optimization variables.
            let perturbedDesign;
            if (surfMode === 'both_independent') {
                perturbedDesign = { ...curDes,
                    frontLayers: perturbLayers(baselineFront),
                    backLayers:  perturbLayers(baselineBack) };
            } else if (surfMode === 'back_only') {
                perturbedDesign = { ...curDes,
                    frontLayers: baselineFront,
                    backLayers:  perturbLayers(baselineBack) };
            } else if (surfMode === 'symmetric') {
                const front = perturbLayers(baselineFront);
                perturbedDesign = { ...curDes, frontLayers: front, backLayers: mirrorLayers(front) };
            } else {
                // front_only
                perturbedDesign = { ...curDes, frontLayers: perturbLayers(baselineFront) };
            }

            let opt;
            try {
                opt = new DLSOptimizer(ops, perturbedDesign, resolveMat);
            } catch (err) {
                console.error(`[Multi-start ${restart}/${N}] init failed:`, err);
                timerRef.current = setTimeout(runOne, 0);
                return;
            }
            optimizerRef.current = opt;

            const tickInner = () => {
                if (!runningRef.current) return;
                let done = false;
                for (let b = 0; b < UI_BATCH; b++) {
                    opt.step();
                    totalIter += 1;
                    if (opt.isConverged() || opt.iter >= MAX_ITER) { done = true; break; }
                }
                setIter(totalIter);
                setMf(opt.mf);
                setOmf(opt.mfOpticalAt(opt.thicknesses));
                setMfHistory(prev => [...prev, { iter: totalIter, mf: opt.mf }]);

                // Live preview — apply both stacks since applyToDesign already
                // honors surfaceMode (writes back, both, or just front).
                const updated = opt.applyToDesign(designRef.current);
                updateDesignRef.current({
                    frontLayers: updated.frontLayers,
                    backLayers:  updated.backLayers,
                }, { transient: true });

                if (done) {
                    // Record this restart's best
                    if (opt.mfBest < globalBestMF) {
                        globalBestMF     = opt.mfBest;
                        globalBestThicks = [...opt.thickBest];
                        globalBestOMF    = opt.mfOpticalAt(opt.thickBest);
                        setMfBest(globalBestMF);
                        setOmfBest(globalBestOMF);
                    }
                    console.log(`[Multi-start ${restart}/${N}] iter=${opt.iter} MF=${opt.mfBest.toFixed(6)} (global best=${globalBestMF.toFixed(6)})`);
                    timerRef.current = setTimeout(runOne, 0);
                    return;
                }
                timerRef.current = setTimeout(tickInner, 0);
            };
            tickInner();
        };

        runOne();
        return;
    }

    // ── Single-start path (original behavior) ────────────────────────────
    // Create optimizer if not already running a session
    if (!optimizerRef.current) {
        // One undo checkpoint for the whole run; baseline cached for Reset.
        checkpointRef.current && checkpointRef.current();
        commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        try {
            const opt = new DLSOptimizer(ops, curDes, resolveMat);
            optimizerRef.current = opt;
            setMfInitial(opt.mf);
            setMfBest(opt.mfBest);
            setOmfInitial(opt.mfOpticalAt(opt.thicknesses));
            setOmfBest(opt.mfOpticalAt(opt.thickBest));
            bumpRunCount();
        } catch (err) {
            console.error('[DLS] Failed to create optimizer:', err);
            return;
        }
    }

    runningRef.current = true;
    setRunning(true);
    setCanReset(true);

    const tick = () => {
        if (!runningRef.current) return;
        const opt = optimizerRef.current;
        if (!opt) return;

        let done = false;
        for (let b = 0; b < UI_BATCH; b++) {
            opt.step();
            if (opt.isConverged() || opt.iter >= MAX_ITER) { done = true; break; }
        }

        setIter(opt.iter);
        setMf(opt.mf);
        setOmf(opt.mfOpticalAt(opt.thicknesses));
        setOmfBest(opt.mfOpticalAt(opt.thickBest));
        // opt.mfBest is monotone non-increasing; show it directly. (The old
        // guard compared optimizerRef.current.mfBest against itself — opt IS
        // optimizerRef.current — so it was always false and Best never moved.)
        setMfBest(opt.mfBest);
        setMfHistory(prev => [...prev, { iter: opt.iter, mf: opt.mf }]);

        // Apply current thicknesses for live preview. applyToDesign honors
        // surfaceMode so back_only / symmetric / both_independent designs
        // see the correct stack(s) update.
        const updated = opt.applyToDesign(designRef.current);
        updateDesignRef.current({
            frontLayers: updated.frontLayers,
            backLayers:  updated.backLayers,
        }, { transient: true });

        if (done) {
            console.log(`[DLS] Converged: iter=${opt.iter} MF=${opt.mf.toFixed(6)} lamD=${opt.lamD.toExponential(2)}`);
            runningRef.current = false;
            setRunning(false);
            return;
        }

        timerRef.current = setTimeout(tick, 0);
    };

    timerRef.current = setTimeout(tick, 0);
}
