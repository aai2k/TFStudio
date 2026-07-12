// Main-thread Gradual-Evolution engine — the fallback used only when the
// synthesis worker pool fails before any progress. Identical GE math to the
// worker path (workerPool.js) but run synchronously via a setTimeout-driven
// `tick` state machine, so it blocks the UI thread (the lag the worker removes).
//
// A plain function of the GradualEvolution window's `ctx` bag (refs + state
// setters + the reconcile / pool helpers); see GradualEvolution.js which builds
// the ctx and owns the React state these refs/setters point at. The per-phase
// tick handlers are module-scope functions driven off a single run-state object
// `S`, so no giant nested closure builds up.

import {
    scanNeedlesPFunction, scanGEInsertions, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers,
} from '../../../../../utils/physics/optimizer.js';
import { makeEngine } from '../../../../../utils/optimizers/index.js';
import {
    getSynthesisInnerEngine, getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    getNeedleSensFloor, cullMarginalNeedles,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { activeSide, densifyForRun, resolveMat, minOmfOf, matFriendlyName } from '../../synthesisHelpers.js';
import { setCached } from '../geCache.js';

// Per-step inner-refine cap when seed mode = 'preserve-bulk' (see synthesisConfig).
const gentleIter = (ctx) => Math.min(ctx.dlsIterRef.current, PRESERVE_BULK_GENTLE_ITER);
const scheduleTick = (ctx, S) => { ctx.timerRef.current = setTimeout(S.tick, 0); };
const deepActive = (S, d) => JSON.parse(JSON.stringify(d[S.LK] || []));

// Write `front` into both the base-design ref and the live (transient) design.
function setBase(ctx, S, front) {
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [S.LK]: JSON.parse(JSON.stringify(front)) };
    ctx.updateDesignRef.current({ [S.LK]: JSON.parse(JSON.stringify(front)) }, { transient: true });
}

function recordCycle(ctx, S, { type, mf, layerCount, insertMat, omf }) {
    ctx.genCountRef.current += 1;
    const genNum = ctx.genCountRef.current;
    const prevBest = ctx.cyclesRef.current.length ? Math.min(...ctx.cyclesRef.current.map(c => c.mf)) : Infinity;
    ctx.cyclesRef.current = [...ctx.cyclesRef.current, {
        id: Math.random().toString(36).slice(2),
        genNum, type, mf, omf,
        dMF: prevBest === Infinity ? null : mf - prevBest,
        layerCount, insertMat,
        tMs: performance.now() - S.runT0,
        layers: JSON.parse(JSON.stringify(ctx.baseDesignRef.current[S.LK] || [])),
    }];
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setGeneration(genNum);
    ctx.setLayerCount(layerCount);
    ctx.setMfBest(Math.min(S.best.mf, ...ctx.cyclesRef.current.map(c => c.mf)));
    if (omf != null) ctx.setOmf(omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: ctx.geStepsRef.current,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
}

// Restore the global best design and finish.
function finalize(ctx, S, msg) {
    if (S.best.front) {
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [S.LK]: JSON.parse(JSON.stringify(S.best.front)) };
        ctx.updateDesignRef.current({ [S.LK]: JSON.parse(JSON.stringify(S.best.front)) }, { transient: true });
        ctx.setMfBest(S.best.mf);
        ctx.setLayerCount(S.best.front.length);
    }
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}

// Insert queue[idx] into `work` at its optimal thickness, spin up DLS1.
function startNeedleCandidate(ctx, S, idx) {
    setBase(ctx, S, S.work.front);
    const design = ctx.baseDesignRef.current;
    const cand   = S.queue[idx];
    cand._mat    = S.pool.find(p => p.id === cand.materialId)?.mat;
    S.lastInsert.mat = cand.materialId;

    let dOpt = ctx.dMinRef.current;
    try {
        dOpt = findOptimalNeedleThickness({
            operands: S.operands, design, resolveMat,
            candidate: cand, deltaNm: ctx.dMinRef.current, maxNm: 500, tol: 0.5, side: S.side,
        });
        if (!(dOpt >= ctx.dMinRef.current)) dOpt = ctx.dMinRef.current;
    } catch (e) { dOpt = ctx.dMinRef.current; }

    const posLabel = cand.intra
        ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
    console.log(`[GE Insert #${idx + 1}/${S.queue.length}] NEEDLE ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

    const newDesign = cand.intra
        ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, S.side)
        : insertNeedle(design, cand.pos, cand.materialId, dOpt, S.side);
    ctx.baseDesignRef.current = newDesign;
    ctx.updateDesignRef.current({ [S.LK]: newDesign[S.LK] }, { transient: true });

    try {
        ctx.dlsRef.current = makeEngine(S.innerEngine, S.operands, newDesign, resolveMat, { dMin: ctx.dMinRef.current });
        S.dlsIter1 = 0;
    } catch (err) {
        console.error('[GE] DLS1 init failed:', err);
        finalize(ctx, S, 'DLS init failed'); return;
    }
    S.phase = 'dls1';
    ctx.setPhase('refining');
    ctx.setStatusMsg('DLS refine 1…');
    scheduleTick(ctx, S);
}

// ── Seed DLS phase (initial refinement of seed design) ────────────────────────
function phaseSeedDls(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = S.preserveBulk ? 0 : ctx.dlsIterRef.current;
    // preserve-bulk: don't step the bare seed at all (one layer can't lower a
    // broadband merit; stepping only thins it). Just evaluate.
    if (!S.preserveBulk) {
        dls.step();
        S.seedIter++;
        ctx.setMf(dls.mf);
        ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));
    }

    const done = S.preserveBulk || dls.isConverged() || S.seedIter >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    const seedDesign = dls.applyToDesign(ctx.baseDesignRef.current);
    ctx.baseDesignRef.current = seedDesign;
    ctx.updateDesignRef.current({ [S.LK]: seedDesign[S.LK] }, { transient: true });

    // Seed-refined design is the first work AND best.
    S.work.mf    = dls.mf;
    S.work.front = deepActive(S, seedDesign);
    S.best.mf    = dls.mf;
    S.best.front = deepActive(S, seedDesign);
    S.curMF.v    = dls.mf;
    ctx.setMfBest(dls.mf);
    { const o = dls.mfOpticalAt(dls.thicknesses); ctx.setOmf(o); ctx.setOmfBest(o); }

    const thicksStr = dls.thicknesses.map(t => t.toFixed(1)).join(', ');
    const seedNames = (seedDesign[S.LK] || []).map(l => matFriendlyName(l.material)).join(', ');
    console.log(`[GE Seed] ${seedNames} → DLS ${S.seedIter} iters, MF=${dls.mf.toFixed(6)} thicknesses=[${thicksStr}]`);
    console.log('');

    S.phase = 'needle_scan';
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    scheduleTick(ctx, S);
}

// ── Needle scan phase (inner needle-optimization loop) ────────────────────────
function phaseNeedleScan(ctx, S) {
    setBase(ctx, S, S.work.front);                     // operate on current work
    const design = ctx.baseDesignRef.current;
    const layers = design[S.LK] || [];

    if (layers.length >= ctx.maxLayersRef.current) {
        console.log(`[GE] Max layers reached (${layers.length}) — restoring best MF=${S.best.mf.toFixed(6)}`);
        finalize(ctx, S, 'Max layers reached'); return;
    }

    const thickStr = layers.map(l => `${(l.thickness||0).toFixed(1)}nm ${l.material}`).join(', ');
    console.log(`[GE NeedleScan] geStep=${ctx.geStepsRef.current} workMF=${S.work.mf.toFixed(6)} bestMF=${S.best.mf.toFixed(6)} layers=${layers.length} [${thickStr}]`);

    S.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    console.log(`[GE NeedleScan] pool=[${S.pool.map(p => p.name).join(', ')}]`);
    ctx.setStatusMsg('Needle scan…');
    if (!S.pool.length) { finalize(ctx, S, 'No candidate materials'); return; }

    const { candidates } = scanNeedlesPFunction({
        operands: S.operands, design, resolveMat, candidateMats: S.pool, deltaNm: 0.5, side: S.side,
    });
    // All improving needles, best (most negative ΔMF) first, then cull the
    // marginal tail (H1 — needle sensitivity; no-op when 'off').
    S.queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
        getNeedleSensFloor());
    S.qIdx  = 0;

    if (S.queue.length === 0) {
        console.log('[GE] Needle-optimal (no improving needle) → forced GE step');
        S.phase = 'ge_step';
        scheduleTick(ctx, S);
        return;
    }
    startNeedleCandidate(ctx, S, 0);
}

// ── DLS-1 refinement phase ────────────────────────────────────────────────────
function phaseDls1(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current;

    dls.step();
    S.dlsIter1++;
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));

    const done = dls.isConverged() || S.dlsIter1 >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    console.log(`[GE DLS1] ${S.dlsIter1} iters, MF=${dls.mf.toFixed(6)} layers=${dls.thicknesses.length}`);

    const postDls1 = dls.applyToDesign(ctx.baseDesignRef.current);
    const prePruneCount = (postDls1[S.LK] || []).length;
    const pruned   = cleanupLayers(postDls1[S.LK] || [], ctx.dMinRef.current);
    if (pruned.length < prePruneCount) {
        console.log(`[GE Prune] ${prePruneCount}→${pruned.length} layers (removed ${prePruneCount - pruned.length})`);
    }
    if (pruned.length === 0) { finalize(ctx, S, 'All layers pruned'); return; }

    const prunedDesign = { ...postDls1, [S.LK]: pruned };
    ctx.baseDesignRef.current = prunedDesign;
    ctx.updateDesignRef.current({ [S.LK]: pruned }, { transient: true });

    try {
        ctx.dlsRef.current = makeEngine(S.innerEngine, S.operands, prunedDesign, resolveMat, { dMin: ctx.dMinRef.current });
        S.dlsIter2 = 0;
    } catch (err) {
        console.error('[GE] DLS2 init failed:', err);
        finalize(ctx, S, 'DLS init failed'); return;
    }
    S.phase = 'dls2';
    ctx.setStatusMsg('DLS refine 2…');
    scheduleTick(ctx, S);
}

// ── DLS-2 refinement phase (accept-or-revert) ─────────────────────────────────
function phaseDls2(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = Math.max(1, Math.floor((S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current) / 2));

    dls.step();
    S.dlsIter2++;
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));

    const done = dls.isConverged() || S.dlsIter2 >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    const mfNow       = dls.mf;
    const mfNowOmf    = dls.mfOpticalAt(dls.thicknesses);
    const finalDesign = dls.applyToDesign(ctx.baseDesignRef.current);
    const nLayers     = (finalDesign[S.LK] || []).length;
    console.log(`[GE DLS2] ${S.dlsIter2} iters, MF=${mfNow.toFixed(6)} layers=${nLayers}`);
    ctx.dlsRef.current = null;

    // Accept if this needle improves the CURRENT working design (needle-opt
    // progresses even when work is above the global best — e.g. just after a
    // forced TOT step).
    if (mfNow < S.work.mf - 1e-9) {
        S.work.mf    = mfNow;
        S.work.front = deepActive(S, finalDesign);
        S.curMF.v    = mfNow;
        ctx.baseDesignRef.current = finalDesign;
        ctx.updateDesignRef.current({ [S.LK]: finalDesign[S.LK] }, { transient: true });

        const newGlobalBest = mfNow < S.best.mf - 1e-9;
        if (newGlobalBest) {
            S.best.mf = mfNow;
            S.best.front = deepActive(S, finalDesign);
            S.geStagn.n = 0;
        }
        recordCycle(ctx, S, { type: 'needle', mf: mfNow, layerCount: nLayers, insertMat: S.lastInsert.mat, omf: mfNowOmf });
        console.log(`[GE] ACCEPT needle: workMF=${mfNow.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${S.best.mf.toFixed(6)})`} layers=${nLayers}`);
        console.log('');

        if (S.best.mf < ctx.targetMFRef.current) {
            console.log(`[GE] Converged: best MF=${S.best.mf.toFixed(6)} < tol=${ctx.targetMFRef.current}`);
            finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`); return;
        }
        S.phase = 'needle_scan';
        ctx.setPhase('scanning');
        ctx.setStatusMsg('');
        scheduleTick(ctx, S);
    } else {
        // This needle didn't help the working design → try the next-best
        // candidate; only when all fail is `work` needle-optimal and we do the
        // forced TOT step.
        S.qIdx += 1;
        if (S.qIdx < S.queue.length) {
            console.log(`[GE] REJECT needle: MF=${mfNow.toFixed(6)} ≥ workMF=${S.work.mf.toFixed(6)} → try next (${S.qIdx + 1}/${S.queue.length})`);
            startNeedleCandidate(ctx, S, S.qIdx);
            return;
        }
        console.log(`[GE] All ${S.queue.length} needles failed → needle-optimal → forced GE step`);
        console.log('');
        setBase(ctx, S, S.work.front);
        S.curMF.v = S.work.mf;
        S.phase = 'ge_step';
        ctx.setPhase('scanning');
        scheduleTick(ctx, S);
    }
}

// ── Forced GE step: deliberately increase total optical thickness ─────────────
//    (Tikhonravov 2007 §2: forced TOT increase between needle optimizations; MF
//    typically rises and is then recovered by the subsequent needle optimization.)
function phaseGeStep(ctx, S) {
    // Forced TOT increase applied to `work` (NOT the global best): work
    // accumulates, so consecutive GE steps act on ever-larger designs
    // (Tikhonravov 2007 §2) — no identical-loop.
    setBase(ctx, S, S.work.front);
    const design = ctx.baseDesignRef.current;
    const layers = design[S.LK] || [];

    if (ctx.geStepsRef.current >= ctx.maxGeCyclesRef.current) {
        console.log(`[GE] Max GE steps reached (${ctx.geStepsRef.current}) — restoring best MF=${S.best.mf.toFixed(6)}`);
        finalize(ctx, S, 'Max GE steps reached'); return;
    }
    if (layers.length >= ctx.maxLayersRef.current) {
        finalize(ctx, S, 'Max layers reached'); return;
    }

    S.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!S.pool.length) { finalize(ctx, S, 'No candidate materials'); return; }

    const { candidates: geC, mf0: geMf0 } = scanGEInsertions({
        operands: S.operands, design, resolveMat, candidateMats: S.pool, thickNm: ctx.dMinRef.current, side: S.side,
    });
    if (!geC.length) { finalize(ctx, S, 'Converged (stuck)'); return; }
    const bestGe = geC.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geC[0]);

    const _geIns = insertNeedle(design, bestGe.pos, bestGe.materialId, ctx.dMinRef.current, S.side);
    // Merge adjacent same-material layers — a forced insert next to the same
    // material thickens it, not stacks a separate layer (optically identical, so
    // mfNew is unchanged). Fixes "N×same-material in a row".
    const geDesign = { ..._geIns,
        frontLayers: cleanupLayers(_geIns.frontLayers || [], ctx.dMinRef.current),
        backLayers:  cleanupLayers(_geIns.backLayers  || [], ctx.dMinRef.current) };
    // `work` becomes the TOT-increased design (accumulates).
    S.work.mf    = bestGe.mfNew;
    S.work.front = deepActive(S, geDesign);
    ctx.baseDesignRef.current = geDesign;
    ctx.updateDesignRef.current({ [S.LK]: geDesign[S.LK] }, { transient: true });

    ctx.geStepsRef.current += 1;
    S.geStagn.n += 1;
    ctx.setGeSteps(ctx.geStepsRef.current);
    S.curMF.v = bestGe.mfNew;
    const nLayers = (geDesign[S.LK] || []).length;
    console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: bestGe.mfNew, layerCount: nLayers, insertMat: bestGe.materialId, omf: bestGe.mfNew });

    // Stagnation guard: many GE steps with no new GLOBAL best.
    if (S.geStagn.n > 6) {
        console.log('[GE] No new best after repeated GE steps — restoring best, stopping');
        finalize(ctx, S, 'Converged (stuck)'); return;
    }

    S.phase = 'needle_scan';
    ctx.dlsRef.current = null;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    scheduleTick(ctx, S);
}

// Dispatch one tick to the current phase handler.
function tickMain(ctx, S) {
    if (!ctx.runningRef.current) return;
    if (S.phase === 'seed_dls')    { phaseSeedDls(ctx, S); return; }
    if (S.phase === 'needle_scan') { phaseNeedleScan(ctx, S); return; }
    if (S.phase === 'dls1')        { phaseDls1(ctx, S); return; }
    if (S.phase === 'dls2')        { phaseDls2(ctx, S); return; }
    if (S.phase === 'ge_step')     { phaseGeStep(ctx, S); }
}

export function runGeMainThread(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();

    const curDes  = ctx.baseDesignRef.current || ctx.designRef.current;
    const operands = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) return;

    // Surface-mode-aware active side. insertNeedle / insertNeedleIntra and the
    // DLS optimizer all take side; symmetric mode is mirror-handled at the
    // layer-mutator helpers.
    const side = activeSide(curDes);
    const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

    if (!ctx.savedDesignRef.current) {
        // One undo checkpoint for the whole GE run; the per-step design writes
        // below are transient previews (no per-iteration history).
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    ctx.runningRef.current = true;
    ctx.setPhase('refining');
    ctx.setStatusMsg('');

    // Preserve-bulk mirrors the worker path: skip the bare-seed refine and refine
    // each step gently (see workerPool.js + synthesisConfig).
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const _prevElapsed = ctx.cyclesRef.current.length
        ? (ctx.cyclesRef.current[ctx.cyclesRef.current.length - 1].tMs || 0) : 0;
    const innerEngine = getSynthesisInnerEngine('ge');

    // ── Whole-run state (Tikhonravov, Trubetskov & DeBell 2007, Appl. Opt.
    //    46(5):704): inner needle-optimization loop + outer forced total-
    //    optical-thickness "GE step", keep-best. ──
    // `work` = current working design (accumulates: only changes via an accepted
    // needle or a forced TOT step — never snaps back). `best` = lowest-MF design
    // seen, restored at the end + highlighted in history. `phase` is the tick
    // state machine: 'seed_dls' | 'needle_scan' | 'dls1' | 'dls2' | 'ge_step'
    // ('seed_dls' refines the current design before any needle scanning).
    const S = {
        side, LK, operands, innerEngine, preserveBulk,
        runT0: performance.now() - _prevElapsed,
        phase: 'seed_dls', seedIter: 0, dlsIter1: 0, dlsIter2: 0,
        best: { mf: Infinity, front: null }, work: { mf: Infinity, front: null },
        curMF: { v: null }, lastInsert: { mat: null }, geStagn: { n: 0 },
        queue: [], qIdx: 0, pool: [],
        tick: null,
    };
    S.tick = () => tickMain(ctx, S);

    // Initialize seed refiner on the starting design (CG/DLS per setting).
    try {
        ctx.dlsRef.current = makeEngine(innerEngine, operands, ctx.baseDesignRef.current, resolveMat, { dMin: ctx.dMinRef.current });
        ctx.setStatusMsg('Seed refinement…');
    } catch (err) {
        console.error('[GE] Seed DLS init failed:', err);
        ctx.runningRef.current = false; ctx.setPhase('idle'); return;
    }

    scheduleTick(ctx, S);
}
