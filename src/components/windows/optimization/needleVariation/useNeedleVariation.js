/**
 * Needle Variation window state hook.
 *
 * Implements the Tikhonravov needle optimization cycle:
 *   1. Scan all insertion positions × catalog materials (δ = 1 nm needle)
 *   2. Insert the needle that gives the largest MF improvement
 *   3. Run DLS refinement until convergence
 *   4. Record the generation and repeat
 *
 * Reference: Tikhonravov et al., Applied Optics 35(28), 1996.
 *
 * Owns all persisted settings, run refs/state, and the design-switch
 * lifecycle. The heavy branching logic (design-switch restore, reset,
 * generation snapshot/jump) lives in sibling modules so this hook stays a
 * thin composition of React state; the run engine itself lives in runners/.
 */

import { useDesign } from '../../../../state/DesignContext.js';

import {
    sideKeyFor, useCatSelection,
    getPoolMaterials as getPoolMaterialsShared,
} from '../synthesisShared/synthesisHelpers.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../../workerUrls.js';

import { runNeedleWorkerPool } from './runners/workerPool.js';
import { setCachedOptState } from './sessionState.js';
import { teardownRun, syncOnDesignSwitch } from './needleLifecycle.js';
import { performReset, clearRunHistory, findBestGeneration, jumpToGeneration } from './needleActions.js';
import { deriveDMinDefault } from './needleSettings.js';

const { useState, useEffect, useRef, useCallback } = React;

const NEEDLE_CATS_KEY = 'tfstudio_needle_selectedCats';

// Needle keeps its original verbose pool diagnostics. The pool is bound to the
// live design so the design's own materials are always on offer, including
// embedded definitions that no local catalog can serve.
const makeGetPoolMaterials = (designRef) => (selectedCatalogIds, excluded) =>
    getPoolMaterialsShared(selectedCatalogIds, {
        verbose: true, excluded, design: designRef.current,
    });

// bestMFVal reads gensRef (the live ref, not the `generations` state) so it
// reflects the freshest accepted generation even mid-run; showSideCol tags
// whether the surface mode needs the history table's Side column.
function computeDerived(design, mf, gens) {
    const bestMFVal = gens.length ? Math.min(...gens.map(g => g.mf)) : (mf ?? Infinity);
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';
    return { bestMFVal, showSideCol };
}

export function useNeedleVariation(t) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();

    // ── Settings ──────────────────────────────────────────────────────────────
    // deltaNm = gradient probe thickness (small, like Python _NEEDLE_EPS=0.5)
    // dMin    = physical min layer thickness, used for INSERTION + DLS floor + prune
    //           (matches Python D_MIN=15 from merit.py)
    // Persisted across window switches (localStorage-backed).
    // Balanced default preset: CG + full refine +
    // dMin 1 are fixed by the GUI 2×2×2 data; 60 iter / 60 layers balances
    // MF-per-layer vs speed (~0.065 @ ~35 s) — bump iters for a final polish run.
    const [maxLayers,    setMaxLayers]    = usePersistentNumber('tfstudio_needle_maxLayers', 60);
    const [deltaNm,      setDeltaNm]      = usePersistentNumber('tfstudio_needle_deltaNm', 0.5);
    const [dMin,         setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_needle_dMin', 1.0);
    const [dlsIter,      setDlsIter]      = usePersistentNumber('tfstudio_needle_dlsIter', 60);
    const [targetMF,     setTargetMF]     = usePersistentNumber('tfstudio_needle_targetMF', 5e-4);
    const {
        selectedCats, setSelectedCats, selectedCatsRef,
        handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(NEEDLE_CATS_KEY);

    // ── Display state ─────────────────────────────────────────────────────────
    const [phase,       setPhase]       = useState('idle');   // 'idle'|'scanning'|'refining'

    // While Needle/scan/refine is active, flip the global isOptimizing flag so
    // live-preview consumers (OpticalEvaluation autoCalc) throttle their main-
    // thread TMM + chart redraw. Effect-cleanup also fires on unmount.
    useEffect(() => {
        if (phase === 'idle') return;
        beginOptimization();
        return () => endOptimization();
    }, [phase === 'idle', beginOptimization, endOptimization]);
    const [generation,  setGeneration]  = useState(0);
    const [generations, setGenerations] = useState([]);
    const [topDesigns,  setTopDesigns]  = useState([]);
    const [mf,          setMf]          = useState(null);
    const [mfBest,      setMfBest]      = useState(null);
    const [omf,         setOmf]         = useState(null);   // optical merit (display only)
    const [omfBest,     setOmfBest]     = useState(null);
    const [layerCount,  setLayerCount]  = useState(0);
    const [canReset,    setCanReset]    = useState(false);
    const [statusMsg,   setStatusMsg]   = useState('');

    // ── Refs (optimization state) ─────────────────────────────────────────────
    const runningRef      = useRef(false);
    const timerRef        = useRef(null);
    const workerRef       = useRef(null);    // synthesis Web Worker
    const dlsRef          = useRef(null);
    const baseDesignRef   = useRef(null);    // design being worked on (updated each cycle)
    const savedDesignRef  = useRef(null);    // baseline of the open run block (for Reset)
    const runsRef         = useRef([]);      // run blocks — see synthesisShared/runBlocks.js
    const runOpenRef      = useRef(false);   // a block is open (Stop→Run continues it)
    const baseRevRef      = useRef(0);       // design revision when baseDesignRef was cached (M12)
    const operandsRef     = useRef([]);
    const designRef       = useRef(design);
    const gensRef         = useRef([]);
    const genCountRef     = useRef(0);
    const lastBestRef     = useRef(null);    // best needle candidate from last scan
    const maxLayersRef    = useRef(30);
    const deltaNmRef      = useRef(0.5);
    const dMinRef         = useRef(15.0);
    const dlsIterRef      = useRef(80);
    const targetMFRef     = useRef(5e-4);
    // selectedCatsRef provided by useCatSelection()
    const updateDesignRef = useRef(updateDesign);
    const checkpointRef   = useRef(checkpoint);

    // Sync refs
    useEffect(() => { maxLayersRef.current = maxLayers; }, [maxLayers]);
    useEffect(() => { deltaNmRef.current   = deltaNm;   }, [deltaNm]);
    useEffect(() => { dMinRef.current      = dMin;      }, [dMin]);
    useEffect(() => { dlsIterRef.current   = dlsIter;   }, [dlsIter]);
    useEffect(() => { targetMFRef.current  = targetMF;  }, [targetMF]);
    useEffect(() => { updateDesignRef.current = updateDesign; }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;   }, [checkpoint]);
    useEffect(() => { designRef.current = design; }, [design]);

    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // dMin's smart default (see needleSettings.js) is a fixed synthesis floor
    // for standalone Needle, unlike GE's MNT-coupled default. `maxMNT` is still
    // computed here for the UI hint.
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    useEffect(() => {
        deriveDMinDefault({ design, lastIdForDMin, dMinTouchedRef, runningRef, dMinRef, setDMin });
    }, [design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    // Layer count display — read from whichever side is active for the current
    // surface mode (back for back_only, front otherwise).
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear state on mount and when the active design changes.
    const lastDesignId = useRef(null);
    useEffect(() => {
        syncOnDesignSwitch({
            lastDesignId, runningRef, timerRef, workerRef, setPhase, setStatusMsg,
            gensRef, genCountRef, lastBestRef, savedDesignRef, baseDesignRef,
            runsRef, runOpenRef,
            setGenerations, setTopDesigns, setMf, setMfBest, setOmf, setOmfBest,
            setGeneration, setLayerCount, setCanReset, baseRevRef,
        }, design, getDesignRevision);
    }, [design?.id]);

    // ── Unmount cleanup — stop any running optimization to prevent orphaned timers ──
    useEffect(() => {
        return () => teardownRun({ runningRef, timerRef, workerRef });
    }, []);

    // ── Stop ──────────────────────────────────────────────────────────────────
    const stopOpt = useCallback((msg = '') => {
        teardownRun({ runningRef, timerRef, workerRef });
        setPhase('idle');
        if (msg) setStatusMsg(msg);
    }, []);

    // M12: if the user manually edited the design (a non-transient write bumps
    // the revision) since baseDesignRef was cached, drop the stale base so the
    // next Run restarts from the CURRENT design instead of optimizing (and then
    // overwriting) the cached pre-edit stack, and close the open run block so
    // that Run opens a new one against what is on screen now. Earlier blocks and
    // their rows survive, so Reset can still step back through them. Synthesis's
    // own transient previews do NOT bump the revision, so a Stop→Run with no
    // edits still continues from where it left off, in the same block.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(designRef.current?.id) ?? 0;
        if (rev !== baseRevRef.current) {
            baseDesignRef.current  = null;
            runOpenRef.current     = false;
            baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // Build the ctx bundle the engine reaches React state through (refs +
    // setters + a few window helpers). The same bundle drives both the default
    // worker-pool path and the identical-math main-thread fallback.
    const buildEngineCtx = useCallback(() => ({
        runningRef, timerRef, workerRef, dlsRef, baseDesignRef, savedDesignRef, designRef,
        runsRef, runOpenRef,
        operandsRef, gensRef, genCountRef, lastBestRef,
        maxLayersRef, deltaNmRef, dMinRef, dlsIterRef, targetMFRef,
        selectedCatsRef, excludedMatsRef, updateDesignRef, checkpointRef,
        setPhase, setStatusMsg, setMf, setMfBest, setOmf, setOmfBest,
        setLayerCount, setCanReset, setGeneration, setGenerations, setTopDesigns,
        reconcileBaseWithEdits, setCachedOptState, t, stopOpt,
        getPoolMaterials: makeGetPoolMaterials(designRef),
        // Pool factory: the component wires the real WorkerPool + worker URL; a
        // test can inject an in-process fake pool (tests/needle_worker_pool.mjs).
        makeWorkerPool: (K, initMessage) => new WorkerPool(SYNTH_WORKER_URL, K, initMessage),
    }), [reconcileBaseWithEdits, stopOpt, t]);

    // Default path: main thread orchestrates a WorkerPool of stateless synthesis
    // primitives (scan / candidate). The full loop lives in runners/workerPool.js
    // (runNeedleWorkerPool); on any pre-progress failure it falls back to the
    // main-thread loop in runners/mainThread.js.
    const runOpt = useCallback(() => {
        runNeedleWorkerPool(buildEngineCtx());
    }, [buildEngineCtx]);

    // ── Reset / Clear history ────────────────────────────────────────────────
    // Reset undoes ONE Run press: it restores the design that press started from
    // and drops its rows, leaving earlier runs alone, so pressing it again steps
    // back another run. Clear history forgets every run and leaves the design
    // where it is, which is how a synthesis result is kept and the timeline
    // started over. The ControlBar also exposes Front / Back side resets in
    // both_independent mode, which restore one side of the current run only.
    const actionCtx = () => ({
        stopOpt, dlsRef, savedDesignRef, baseDesignRef, designRef,
        gensRef, genCountRef, lastBestRef, runsRef, runOpenRef,
        setGenerations, setTopDesigns, setMf, setMfBest, setOmf, setOmfBest,
        setGeneration, setLayerCount, setCanReset, setStatusMsg, t,
    });

    const resetOpt = useCallback((side) => {
        performReset(actionCtx(), updateDesign, side);
    }, [stopOpt, updateDesign, t]);

    const clearHistoryOpt = useCallback(() => {
        clearRunHistory(actionCtx());
    }, [stopOpt, t]);

    // ── Jump to best seen generation / restore a specific one ────────────────
    const bestOpt = useCallback(() => {
        const best = findBestGeneration(gensRef.current);
        if (!best) return;
        stopOpt('');
        jumpToGeneration({ designRef, baseDesignRef, setMf, setOmf, setLayerCount, setGeneration }, updateDesign, best);
    }, [stopOpt, updateDesign]);

    const handleRestore = useCallback((gen) => {
        stopOpt('');
        jumpToGeneration({ designRef, baseDesignRef, setMf, setOmf, setLayerCount, setGeneration }, updateDesign, gen);
    }, [stopOpt, updateDesign]);

    // Catalog toggle/all/clear handlers come from useCatSelection().

    const { bestMFVal, showSideCol } = computeDerived(design, mf, gensRef.current);

    return {
        design, tn: t.needle,
        running: phase !== 'idle', phase,
        generation, generations, topDesigns, mf, mfBest, layerCount, canReset, statusMsg,
        bestMFVal, showSideCol,
        maxLayers, setMaxLayers, deltaNm, setDeltaNm, dMin, handleDMin, dlsIter, setDlsIter,
        targetMF, setTargetMF, maxMNT,
        selectedCats, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, handleToggleMat,
        runOpt, stopOpt, resetOpt, bestOpt, handleRestore,
        clearHistoryOpt, hasHistory: generations.length > 0,
    };
}
