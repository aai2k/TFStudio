/**
 * State/effects/engine-wiring for the Gradual Evolution window. See
 * GradualEvolution.js for the algorithm description; this hook owns the
 * settings, run refs, and the Run/Stop/Reset/Restore controller actions that
 * drive the worker-pool (or main-thread fallback) GE engine.
 *
 * Split into cohesive sub-hooks (settings vs. run/cache state), with the
 * heavier branching logic pulled into module-scope helpers that take a ctx
 * bag of refs/setters — the same ctx-bag convention the run engines in
 * runners/ use, so the branching lives in a named, independently readable
 * function rather than inline inside a React effect/callback.
 */

import { getCatalogs } from '../../../../utils/materials/catalogManager.js';

// Shared synthesis helpers (see synthesisHelpers.js). The two window-parameterized
// ones (verbose pool / cat-selection key) get thin same-named wrappers below so
// call sites are unchanged.
import {
    sideKeyFor, useCatSelection,
    getPoolMaterials as getPoolMaterialsShared,
} from '../synthesisShared/synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';

// Run engine (worker-pool default; falls back to a main-thread engine).
import { runGeWorker } from './runners/workerPool.js';
import { deriveDMinDefault, restoreOrClearForDesign, performReset, applyCycleSnapshot } from './geStateHelpers.js';

const { useState, useEffect, useRef, useCallback } = React;

// ── Window-parameterized wrappers around the shared helpers ─────────────────────
const GE_CATS_KEY = 'tfstudio_ge_selectedCats';
// GE keeps its original quiet pool (no verbose diagnostics).
const getPoolMaterials = (selectedCatalogIds, excluded) => getPoolMaterialsShared(selectedCatalogIds, { excluded });

// ── Settings sub-hook: persisted run parameters + material-pool selection ──────
// Defaults mirror Python gradual_evolution.py: max_layers=16, tol=5e-4,
// dls_iter_per_step=80, D_MIN=15.0 nm (merit.py). Persisted across window
// switches (localStorage-backed).
function useGeSettings(design) {
    const [maxLayers,     setMaxLayers]     = usePersistentNumber('tfstudio_ge_maxLayers', 50);
    const [maxGeCycles,   setMaxGeCycles]   = usePersistentNumber('tfstudio_ge_maxGeCycles', 16);
    const [targetMF,      setTargetMF]      = usePersistentNumber('tfstudio_ge_targetMF', 5e-4);
    const [dlsIter,       setDlsIter]       = usePersistentNumber('tfstudio_ge_dlsIter', 30);
    const [dMin,          setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_ge_dMin', 15.0);
    // M19: the "preemptive trigger" knobs (preemptiveN / preemptiveRel) were
    // declared, persisted and UI-exposed but never consumed by the tick loop —
    // removed rather than shipping dead controls that mislead the user.
    const {
        selectedCats, setSelectedCats, selectedCatsRef,
        handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(GE_CATS_KEY);

    const maxLayersRef   = useRef(60);
    const maxGeCyclesRef = useRef(16);
    const targetMFRef    = useRef(5e-4);
    const dlsIterRef     = useRef(80);
    const dMinRef        = useRef(15.0);
    useEffect(() => { maxLayersRef.current   = maxLayers;   }, [maxLayers]);
    useEffect(() => { maxGeCyclesRef.current = maxGeCycles; }, [maxGeCycles]);
    useEffect(() => { targetMFRef.current    = targetMF;    }, [targetMF]);
    useEffect(() => { dlsIterRef.current     = dlsIter;     }, [dlsIter]);
    useEffect(() => { dMinRef.current        = dMin;        }, [dMin]);

    const operands = design?.meritOperands || [];
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);

    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    return {
        maxLayers, maxGeCycles, targetMF, dlsIter, dMin, setDMin, maxMNT,
        setMaxLayers, setMaxGeCycles, setTargetMF, setDlsIter, handleDMin,
        maxLayersRef, maxGeCyclesRef, targetMFRef, dlsIterRef, dMinRef,
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
    // Plotly redraw. Effect-cleanup also fires on unmount.
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
    const timerRef         = useRef(null);
    const workerRef        = useRef(null);    // synthesis Web Worker
    const dlsRef           = useRef(null);
    const baseDesignRef    = useRef(null);
    const savedDesignRef   = useRef(null);
    const baseRevRef       = useRef(0);      // design revision when baseDesignRef was cached (M12)
    const operandsRef      = useRef([]);
    const designRef        = useRef(design);
    const cyclesRef        = useRef([]);
    const genCountRef      = useRef(0);
    const geStepsRef       = useRef(0);

    useEffect(() => { designRef.current = design; }, [design]);
    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Update layer count display when not running
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear on design switch
    const lastDesignId = useRef(null);
    useEffect(() => {
        restoreOrClearForDesign(design, {
            lastDesignId, runningRef, timerRef, workerRef,
            cyclesRef, genCountRef, geStepsRef, savedDesignRef, baseDesignRef, baseRevRef,
            getDesignRevision,
            setPhase, setStatusMsg, setCycles, setMf, setMfBest, setOmf, setOmfBest,
            setGeneration, setGeSteps, setLayerCount, setCanReset,
        });
    }, [design?.id]);

    useEffect(() => {
        return () => {
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
        };
    }, []);

    return {
        phase, setPhase, generation, setGeneration, geSteps, setGeSteps,
        cycles, setCycles, cyclesRef, mf, setMf, mfBest, setMfBest,
        omf, setOmf, omfBest, setOmfBest, layerCount, setLayerCount,
        canReset, setCanReset, statusMsg, setStatusMsg,
        runningRef, timerRef, workerRef, dlsRef, baseDesignRef, savedDesignRef, baseRevRef,
        operandsRef, designRef, genCountRef, geStepsRef,
    };
}

export function useGradualEvolution({ design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision, t }) {
    const settings = useGeSettings(design);
    const run = useGeRunState({ design, beginOptimization, endOptimization, getDesignRevision });

    useEffect(() => {
        deriveDMinDefault(design, settings.maxMNT, {
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
        run.runningRef.current = false;
        clearTimeout(run.timerRef.current);
        if (run.workerRef.current) {
            try { run.workerRef.current.terminate(); } catch (_) {}
            run.workerRef.current = null;
        }
        run.setPhase('idle');
        if (msg) run.setStatusMsg(msg);
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
            run.savedDesignRef.current = null;
            run.baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // ── Run engines ─────────────────────────────────────────────────────────────
    // The GE state machine lives in runners/. The window assembles a `ctx` bag
    // (refs + state setters + the reconcile / stop / pool helpers) that both the
    // default worker-pool engine and its main-thread fallback drive.
    const runOpt = useCallback(() => {
        runGeWorker({
            runningRef: run.runningRef, timerRef: run.timerRef, workerRef: run.workerRef,
            dlsRef: run.dlsRef, baseDesignRef: run.baseDesignRef, savedDesignRef: run.savedDesignRef,
            designRef: run.designRef, operandsRef: run.operandsRef, cyclesRef: run.cyclesRef,
            genCountRef: run.genCountRef, geStepsRef: run.geStepsRef,
            updateDesignRef, checkpointRef,
            maxLayersRef: settings.maxLayersRef, maxGeCyclesRef: settings.maxGeCyclesRef,
            targetMFRef: settings.targetMFRef, dlsIterRef: settings.dlsIterRef, dMinRef: settings.dMinRef,
            selectedCatsRef: settings.selectedCatsRef, excludedMatsRef: settings.excludedMatsRef,
            setPhase: run.setPhase, setStatusMsg: run.setStatusMsg, setCanReset: run.setCanReset,
            setMf: run.setMf, setOmf: run.setOmf, setMfBest: run.setMfBest, setOmfBest: run.setOmfBest,
            setCycles: run.setCycles, setGeneration: run.setGeneration,
            setLayerCount: run.setLayerCount, setGeSteps: run.setGeSteps,
            reconcileBaseWithEdits, stopOpt, getPoolMaterials, t,
        });
    }, [stopOpt, reconcileBaseWithEdits, t]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    const resetOpt = useCallback((side) => {
        stopOpt('');
        performReset(side, {
            dlsRef: run.dlsRef, savedDesignRef: run.savedDesignRef, baseDesignRef: run.baseDesignRef,
            updateDesign, designRef: run.designRef, cyclesRef: run.cyclesRef,
            genCountRef: run.genCountRef, geStepsRef: run.geStepsRef,
            setCycles: run.setCycles, setMf: run.setMf, setMfBest: run.setMfBest,
            setOmf: run.setOmf, setOmfBest: run.setOmfBest, setGeneration: run.setGeneration,
            setGeSteps: run.setGeSteps, setLayerCount: run.setLayerCount,
            setCanReset: run.setCanReset, setStatusMsg: run.setStatusMsg,
        });
    }, [stopOpt, updateDesign]);

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
        catalogs: getCatalogs(),
        selectedCats: settings.selectedCats, handleToggleCat: settings.handleToggleCat,
        handleSelectAllCats: settings.handleSelectAllCats, handleClearCats: settings.handleClearCats,
        excludedMats: settings.excludedMats, handleToggleMat: settings.handleToggleMat,
        maxLayers: settings.maxLayers, maxGeCycles: settings.maxGeCycles, targetMF: settings.targetMF,
        dlsIter: settings.dlsIter, dMin: settings.dMin, maxMNT: settings.maxMNT,
        setMaxLayers: settings.setMaxLayers, setMaxGeCycles: settings.setMaxGeCycles,
        setTargetMF: settings.setTargetMF, setDlsIter: settings.setDlsIter, handleDMin: settings.handleDMin,
        runOpt, stopOpt, resetOpt, bestOpt, handleRestore,
    };
}
