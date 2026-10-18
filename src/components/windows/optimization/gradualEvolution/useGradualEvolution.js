/**
 * State/effects/engine-wiring for the Gradual Evolution window. See
 * GradualEvolution.js for the algorithm description; this hook owns the
 * settings, run refs, and the Run/Stop/Reset/Restore controller actions. The
 * run itself is utils/gradualEvolution/runGradualEvolution.js, started and
 * shown by windowRun.js.
 *
 * Split into cohesive sub-hooks (settings vs. run/cache state), with the
 * heavier branching logic pulled into module-scope helpers that take a ctx
 * bag of refs/setters, so the branching lives in a named, independently
 * readable function rather than inline inside a React effect/callback.
 */

import { poolCatalogs } from '../synthesisShared/synthesisHelpers.js';

// Shared synthesis helpers (see synthesisHelpers.js). The two window-parameterized
// ones (verbose pool / cat-selection key) get thin same-named wrappers below so
// call sites are unchanged.
import {
    sideKeyFor, useCatSelection,
    getPoolMaterials as getPoolMaterialsShared,
} from '../synthesisShared/synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { SYNTHESIS_WORKER_URL } from '../../../../workerUrls.js';
import { GE_DEFAULTS } from '../../../../utils/gradualEvolution/settings.js';

import { startWindowRun } from './windowRun.js';
import {
    restoreOrClearForDesign, performReset, clearRunHistory, applyCycleSnapshot,
} from './geStateHelpers.js';
import { teardownRun } from '../synthesisShared/teardownRun.js';
import { strictestMnt, deriveDMinDefault } from '../synthesisShared/minThickness.js';

const { useState, useEffect, useRef, useCallback } = React;

// ── Window-parameterized wrappers around the shared helpers ─────────────────────
const GE_CATS_KEY = 'tfstudio_ge_selectedCats';
// GE keeps its original quiet pool (no verbose diagnostics). The pool is bound to
// the live design so the design's own materials are always on offer, including
// embedded definitions that no local catalog can serve.
const makeGetPoolMaterials = (designRef) => (selectedCatalogIds, excluded) =>
    getPoolMaterialsShared(selectedCatalogIds, { excluded, design: designRef.current });

// The worker pool a run is built with. Its start, and a failure to build it, go
// to the app's diagnostics log.
function makeWorkerPool(K, initMessage) {
    const wasmBytes = initMessage?.wasmBytes;
    window.electronAPI?.diagLog?.(`GE start: poolSize=${K} wasmBytesForWorker=${wasmBytes ? (wasmBytes.byteLength ?? wasmBytes.length) : 0} workerURL=${String(SYNTHESIS_WORKER_URL)}`);
    try { return new WorkerPool(SYNTHESIS_WORKER_URL, K, initMessage); }
    catch (err) {
        window.electronAPI?.diagLog?.(`GE WorkerPool construction FAILED: ${err?.message || err}`);
        throw err;
    }
}

// ── Settings sub-hook: persisted run parameters + material-pool selection ──────
// Persisted across window switches (localStorage-backed), starting from the
// run's own defaults (utils/gradualEvolution/settings.js).
function useGeSettings(design) {
    const [maxLayers,     setMaxLayers]     = usePersistentNumber('tfstudio_ge_maxLayers', GE_DEFAULTS.maxLayers);
    const [maxGeCycles,   setMaxGeCycles]   = usePersistentNumber('tfstudio_ge_maxGeCycles', GE_DEFAULTS.maxGeCycles);
    const [targetMF,      setTargetMF]      = usePersistentNumber('tfstudio_ge_targetMF', GE_DEFAULTS.targetMF);
    const [dlsIter,       setDlsIter]       = usePersistentNumber('tfstudio_ge_dlsIter', GE_DEFAULTS.refineIter);
    const [dMin,          setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_ge_dMin', GE_DEFAULTS.dMin);
    // Deep search (utils/gradualEvolution/deepSearch.js): 1 = perturb the best
    // design when nothing is left to try, and run until Stop or the target.
    const [deepSearch,    setDeepSearch]    = usePersistentNumber('tfstudio_ge_deepSearch', GE_DEFAULTS.deepSearch ? 1 : 0);
    // M19: the "preemptive trigger" knobs (preemptiveN / preemptiveRel) were
    // declared, persisted and UI-exposed but never consumed by the tick loop —
    // removed rather than shipping dead controls that mislead the user.
    const {
        selectedCats, selectedCatsRef,
        handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(GE_CATS_KEY, design);

    const maxLayersRef   = useRef(60);
    const maxGeCyclesRef = useRef(16);
    const targetMFRef    = useRef(5e-4);
    const dlsIterRef     = useRef(80);
    const dMinRef        = useRef(15.0);
    const deepSearchRef  = useRef(false);
    useEffect(() => { maxLayersRef.current   = maxLayers;   }, [maxLayers]);
    useEffect(() => { maxGeCyclesRef.current = maxGeCycles; }, [maxGeCycles]);
    useEffect(() => { targetMFRef.current    = targetMF;    }, [targetMF]);
    useEffect(() => { dlsIterRef.current     = dlsIter;     }, [dlsIter]);
    useEffect(() => { dMinRef.current        = dMin;        }, [dMin]);
    useEffect(() => { deepSearchRef.current  = !!deepSearch; }, [deepSearch]);

    const maxMNT = strictestMnt(design?.meritOperands);

    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    return {
        maxLayers, maxGeCycles, targetMF, dlsIter, dMin, setDMin, maxMNT, deepSearch,
        setMaxLayers, setMaxGeCycles, setTargetMF, setDlsIter, handleDMin, setDeepSearch,
        maxLayersRef, maxGeCyclesRef, targetMFRef, dlsIterRef, dMinRef, deepSearchRef,
        dMinTouchedRef, lastIdForDMin,
        selectedCats, selectedCatsRef, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    };
}

// ── Run/cache sub-hook: display state, run refs, and the design-switch /
//    cleanup / live-preview-throttle effects. ──────────────────────────────────
function useGeRunState({ design, beginOptimization, endOptimization, getDesignRevision }) {
    const [phase,      setPhase]      = useState('idle');

    // While GE is active, flip the global isOptimizing flag so live-preview
    // consumers (OpticalEvaluation autoCalc) throttle their main-thread TMM +
    // chart redraw. Effect-cleanup also fires on unmount.
    useEffect(() => {
        if (phase === 'idle') return;
        beginOptimization();
        return () => endOptimization();
    }, [phase === 'idle', beginOptimization, endOptimization]);
    const [generation, setGeneration] = useState(0);
    const [geSteps,    setGeSteps]    = useState(0);
    const [cycles,     setCycles]     = useState([]);
    const [mf,         setMf]         = useState(null);
    const [mfBest,     setMfBest]     = useState(null);
    const [omf,        setOmf]        = useState(null);   // optical merit (display only)
    const [omfBest,    setOmfBest]    = useState(null);
    const [layerCount, setLayerCount] = useState(0);
    const [canReset,   setCanReset]   = useState(false);
    const [statusMsg,  setStatusMsg]  = useState('');

    const runningRef       = useRef(false);
    const activeRunRef     = useRef(null);    // the run the window shows (windowRun.js)
    const abortRef         = useRef(null);    // stops that run
    const baseDesignRef    = useRef(null);
    const savedDesignRef   = useRef(null);
    const baseRevRef       = useRef(0);      // design revision when baseDesignRef was cached (M12)
    const operandsRef      = useRef([]);
    const designRef        = useRef(design);
    const cyclesRef        = useRef([]);
    const runsRef          = useRef([]);     // run blocks — see synthesisShared/runBlocks.js
    const runOpenRef       = useRef(false);  // a block is open (Stop→Run continues it)
    const genCountRef      = useRef(0);
    const geStepsRef       = useRef(0);

    useEffect(() => { designRef.current = design; }, [design]);
    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Update layer count display when not running
    useEffect(() => {
        if (!runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear on design switch
    const lastDesignId = useRef(null);
    useEffect(() => {
        restoreOrClearForDesign(design, {
            lastDesignId, runningRef, activeRunRef, abortRef,
            cyclesRef, genCountRef, geStepsRef, savedDesignRef, baseDesignRef, baseRevRef,
            runsRef, runOpenRef, getDesignRevision,
            setPhase, setStatusMsg, setCycles, setMf, setMfBest, setOmf, setOmfBest,
            setGeneration, setGeSteps, setLayerCount, setCanReset,
        });
    }, [design?.id]);

    useEffect(() => {
        return () => teardownRun({ runningRef, activeRunRef, abortRef });
    }, []);

    return {
        phase, setPhase, generation, setGeneration, geSteps, setGeSteps,
        cycles, setCycles, cyclesRef, mf, setMf, mfBest, setMfBest,
        omf, setOmf, omfBest, setOmfBest, layerCount, setLayerCount,
        canReset, setCanReset, statusMsg, setStatusMsg,
        runningRef, activeRunRef, abortRef, baseDesignRef, savedDesignRef, baseRevRef,
        operandsRef, designRef, genCountRef, geStepsRef, runsRef, runOpenRef,
    };
}

export function useGradualEvolution({ design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision, t }) {
    const settings = useGeSettings(design);
    const run = useGeRunState({ design, beginOptimization, endOptimization, getDesignRevision });

    // Min thickness follows the strictest MNT row, so GE keeps the floor the
    // MNT penalty enforces; 15 nm without one (synthesisShared/minThickness.js).
    useEffect(() => {
        deriveDMinDefault(design, settings.maxMNT > 0 ? settings.maxMNT : GE_DEFAULTS.dMin, {
            dMinTouchedRef: settings.dMinTouchedRef, lastIdForDMin: settings.lastIdForDMin,
            runningRef: run.runningRef, dMinRef: settings.dMinRef, setDMin: settings.setDMin,
        });
    }, [settings.maxMNT, design?.id]);

    const updateDesignRef = useRef(updateDesign);
    const checkpointRef   = useRef(checkpoint);
    useEffect(() => { updateDesignRef.current = updateDesign; }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;   }, [checkpoint]);

    // ── Stop ──────────────────────────────────────────────────────────────────
    const stopOpt = useCallback((msg = '') => {
        const wasRunning = run.runningRef.current;
        teardownRun(run);
        run.setPhase('idle');
        // Stopping a run clears the phase text it was showing; a finished run's
        // reason stays when Best or Restore is pressed after it.
        if (msg || wasRunning) run.setStatusMsg(msg);
    }, []);

    // M12: drop a stale cached base if the user manually edited the design (a
    // non-transient write bumps the revision) since it was snapshotted, so the
    // next Run restarts from the CURRENT design instead of overwriting the edits.
    // Synthesis's own transient previews don't bump the revision, so Stop→Run
    // with no edits still continues from where it left off.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(run.designRef.current?.id) ?? 0;
        if (rev !== run.baseRevRef.current) {
            run.baseDesignRef.current  = null;
            run.runOpenRef.current     = false;
            run.baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // ── Run ─────────────────────────────────────────────────────────────────────
    // The window assembles a `ctx` bag (refs + state setters + the reconcile /
    // stop / pool helpers) a run is shown through (windowRun.js).
    const runOpt = useCallback(() => {
        startWindowRun({
            runningRef: run.runningRef, activeRunRef: run.activeRunRef, abortRef: run.abortRef,
            baseDesignRef: run.baseDesignRef, savedDesignRef: run.savedDesignRef,
            baseRevRef: run.baseRevRef,
            designRef: run.designRef, operandsRef: run.operandsRef, cyclesRef: run.cyclesRef,
            genCountRef: run.genCountRef, geStepsRef: run.geStepsRef,
            runsRef: run.runsRef, runOpenRef: run.runOpenRef,
            updateDesignRef, checkpointRef,
            maxLayersRef: settings.maxLayersRef, maxGeCyclesRef: settings.maxGeCyclesRef,
            targetMFRef: settings.targetMFRef, dlsIterRef: settings.dlsIterRef, dMinRef: settings.dMinRef,
            deepSearchRef: settings.deepSearchRef,
            selectedCatsRef: settings.selectedCatsRef, excludedMatsRef: settings.excludedMatsRef,
            setPhase: run.setPhase, setStatusMsg: run.setStatusMsg, setCanReset: run.setCanReset,
            setMf: run.setMf, setOmf: run.setOmf, setMfBest: run.setMfBest, setOmfBest: run.setOmfBest,
            setCycles: run.setCycles, setGeneration: run.setGeneration,
            setLayerCount: run.setLayerCount, setGeSteps: run.setGeSteps,
            reconcileBaseWithEdits, stopOpt, t,
            getPoolMaterials: makeGetPoolMaterials(run.designRef),
            makeWorkerPool,
        });
    }, [stopOpt, reconcileBaseWithEdits, t]);

    // ── Reset / Clear history ────────────────────────────────────────────────
    // Reset undoes ONE Run press; Clear history forgets every run and leaves the
    // design where it is (synthesisShared/runBlocks.js).
    const stateCtx = () => ({
        savedDesignRef: run.savedDesignRef, baseDesignRef: run.baseDesignRef,
        baseRevRef: run.baseRevRef,
        updateDesign, designRef: run.designRef, cyclesRef: run.cyclesRef,
        genCountRef: run.genCountRef, geStepsRef: run.geStepsRef,
        runsRef: run.runsRef, runOpenRef: run.runOpenRef,
        setCycles: run.setCycles, setMf: run.setMf, setMfBest: run.setMfBest,
        setOmf: run.setOmf, setOmfBest: run.setOmfBest, setGeneration: run.setGeneration,
        setGeSteps: run.setGeSteps, setLayerCount: run.setLayerCount,
        setCanReset: run.setCanReset, setStatusMsg: run.setStatusMsg, t,
    });

    const resetOpt = useCallback((side) => {
        stopOpt('');
        performReset(side, stateCtx());
    }, [stopOpt, updateDesign, t]);

    const clearHistoryOpt = useCallback(() => {
        stopOpt('');
        clearRunHistory(stateCtx());
    }, [stopOpt, updateDesign, t]);

    // ── Jump to best ──────────────────────────────────────────────────────────
    const bestOpt = useCallback(() => {
        if (!run.cyclesRef.current.length) return;
        const bestCy = run.cyclesRef.current.filter(cy => cy.layers).reduce((a, b) => (a.mf <= b.mf ? a : b));
        stopOpt('');
        applyCycleSnapshot(bestCy, { updateDesign, designRef: run.designRef, baseDesignRef: run.baseDesignRef });
        run.setMf(bestCy.mf);
        run.setOmf(bestCy.omf ?? null);
        run.setLayerCount(bestCy.layerCount);
        run.setGeneration(bestCy.genNum);
    }, [stopOpt, updateDesign]);

    // ── Restore specific cycle ────────────────────────────────────────────────
    const handleRestore = useCallback((cy) => {
        stopOpt('');
        applyCycleSnapshot(cy, { updateDesign, designRef: run.designRef, baseDesignRef: run.baseDesignRef });
        run.setMf(cy.mf);
        run.setOmf(cy.omf ?? null);
        run.setLayerCount(cy.layerCount);
        run.setGeneration(cy.genNum);
    }, [stopOpt, updateDesign]);

    // Catalog toggle/all/clear handlers come from useCatSelection() (in useGeSettings).

    return {
        phase: run.phase, generation: run.generation, geSteps: run.geSteps,
        cycles: run.cycles, cyclesRef: run.cyclesRef, mf: run.mf, mfBest: run.mfBest,
        layerCount: run.layerCount, canReset: run.canReset, statusMsg: run.statusMsg,
        catalogs: poolCatalogs(design, t.pool.designCatalog),
        selectedCats: settings.selectedCats, handleToggleCat: settings.handleToggleCat,
        handleSelectAllCats: settings.handleSelectAllCats, handleClearCats: settings.handleClearCats,
        excludedMats: settings.excludedMats, handleToggleMat: settings.handleToggleMat,
        maxLayers: settings.maxLayers, maxGeCycles: settings.maxGeCycles, targetMF: settings.targetMF,
        dlsIter: settings.dlsIter, dMin: settings.dMin, maxMNT: settings.maxMNT,
        deepSearch: settings.deepSearch, setDeepSearch: settings.setDeepSearch,
        setMaxLayers: settings.setMaxLayers, setMaxGeCycles: settings.setMaxGeCycles,
        setTargetMF: settings.setTargetMF, setDlsIter: settings.setDlsIter, handleDMin: settings.handleDMin,
        runOpt, stopOpt, resetOpt, bestOpt, handleRestore,
        clearHistoryOpt, hasHistory: run.cycles.length > 0,
    };
}
