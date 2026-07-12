/**
 * Gradual Evolution synthesis window.
 *
 * Algorithm (Dobrowolski):
 *   1. Run needle optimization until it stalls (no improving needle found).
 *   2. Insert a D_MIN-thick layer at the best (position, material) found by scanning
 *      all positions × candidate materials.  MF typically rises after this insertion —
 *      that is expected and intentional.
 *   3. Run DLS refinement until convergence.
 *   4. Repeat (1)–(3) until a termination criterion is met:
 *        • MF < targetMF
 *        • Layer count ≥ maxLayers
 *        • GE steps ≥ maxGeCycles
 *
 * References:
 *   - H.A. Macleod, Thin-Film Optical Filters 5th ed., §"Automatic Design" (Ch.13,
 *     p.91): "gradual evolution (Dobrowolski) … adds layers to either end of an
 *     existing layer sequence."
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { getCatalogs } from '../../../../utils/materials/catalogManager.js';

// Shared synthesis helpers (see synthesisHelpers.js). The two window-parameterized
// ones (verbose pool / cat-selection key) get thin same-named wrappers below so
// call sites are unchanged.
import {
    sideKeyFor, useCatSelection, minOmfOf,
    computePareto, TopDesignsPanel as SharedTopDesignsPanel,
    getPoolMaterials as getPoolMaterialsShared,
} from '../synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';

const { createElement: h, useState, useEffect, useRef, useCallback, useMemo } = React;

// Shared synthesis shell + GE's presentational panels.
import { SynthesisShell } from '../synthesisShell.js';
import { MFTrendChart, ControlBar, LeftSidebar, CyclesTable } from './gePanels.js';

// Run engine (worker-pool default; falls back to a main-thread engine) + run cache.
import { runGeWorker } from './runners/workerPool.js';
import { getCached, clearCached } from './geCache.js';

// ── Window-parameterized wrappers around the shared helpers ─────────────────────
const GE_CATS_KEY = 'tfstudio_ge_selectedCats';
// GE keeps its original quiet pool (no verbose diagnostics).
const getPoolMaterials = (selectedCatalogIds, excluded) => getPoolMaterialsShared(selectedCatalogIds, { excluded });

// ── Main GradualEvolution window ──────────────────────────────────────────────

export function GradualEvolution({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();
    const tg = t.gradualEvolution;

    // ── Settings state ────────────────────────────────────────────────────────
    // Defaults mirror Python gradual_evolution.py: max_layers=16, tol=5e-4,
    // dls_iter_per_step=80, D_MIN=15.0 nm (merit.py).
    // Persisted across window switches (localStorage-backed).
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

    // ── Display state ─────────────────────────────────────────────────────────
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

    // ── Optimization refs ─────────────────────────────────────────────────────
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
    const updateDesignRef  = useRef(updateDesign);
    const checkpointRef    = useRef(checkpoint);

    // Settings refs (read inside async loop)
    const maxLayersRef     = useRef(60);
    const maxGeCyclesRef   = useRef(16);
    const targetMFRef      = useRef(5e-4);
    const dlsIterRef       = useRef(80);
    const dMinRef          = useRef(15.0);
    // selectedCatsRef provided by useCatSelection()

    useEffect(() => { maxLayersRef.current     = maxLayers;     }, [maxLayers]);
    useEffect(() => { maxGeCyclesRef.current   = maxGeCycles;   }, [maxGeCycles]);
    useEffect(() => { targetMFRef.current      = targetMF;      }, [targetMF]);
    useEffect(() => { dlsIterRef.current       = dlsIter;       }, [dlsIter]);
    useEffect(() => { dMinRef.current          = dMin;          }, [dMin]);
    useEffect(() => { updateDesignRef.current  = updateDesign;  }, [updateDesign]);
    useEffect(() => { checkpointRef.current    = checkpoint;    }, [checkpoint]);
    useEffect(() => { designRef.current        = design;        }, [design]);

    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Smart default: initialize "Min thickness" from the strictest enabled MNT
    // constraint so GE respects the same manufacturability floor the MNT
    // penalty enforces. Re-derived on design switch; a manual edit sticks.
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
    // A persisted dMin counts as user-set, so the smart default doesn't clobber
    // it on remount. A genuine design switch still re-derives.
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    useEffect(() => {
        const id = design?.id ?? null;
        if (lastIdForDMin.current !== id) {
            const firstMount = lastIdForDMin.current === null;
            lastIdForDMin.current = id;
            if (!firstMount) dMinTouchedRef.current = false;   // real design switch → re-derive
        }
        if (runningRef.current || dMinTouchedRef.current) return;
        const def = maxMNT > 0 ? maxMNT : 15.0;
        if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
    }, [maxMNT, design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    // Update layer count display when not running
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear on design switch
    const lastDesignId = useRef(null);
    useEffect(() => {
        const prevId = lastDesignId.current;
        const newId  = design?.id ?? null;
        lastDesignId.current = newId;

        if (prevId && prevId !== newId) {
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
            setPhase('idle');
            setStatusMsg('');
        }

        const cached = getCached(newId);
        if (cached) {
            const cy      = cached.cycles;
            const bestMF  = cy.length ? Math.min(...cy.map(c => c.mf)) : null;
            const lastCy  = cy[cy.length - 1];
            cyclesRef.current     = cy;
            genCountRef.current   = lastCy?.genNum ?? 0;
            geStepsRef.current    = cached.geSteps ?? 0;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current  = cached.baseDesign;
            setCycles(cy.slice());
            setMf(lastCy?.mf ?? null);
            setMfBest(bestMF);
            setOmf(lastCy?.omf ?? null);
            setOmfBest(minOmfOf(cy));
            setGeneration(lastCy?.genNum ?? 0);
            setGeSteps(cached.geSteps ?? 0);
            setLayerCount(lastCy?.layerCount ?? 0);
            setCanReset(!!cached.savedDesign);
        } else {
            cyclesRef.current     = [];
            genCountRef.current   = 0;
            geStepsRef.current    = 0;
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            setCycles([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setGeSteps(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        // Sync the M12 edit-revision baseline to the switched-to design so the
        // switch itself doesn't read as a manual edit on the next Run.
        baseRevRef.current = getDesignRevision?.(newId) ?? 0;
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

    // ── Stop ──────────────────────────────────────────────────────────────────
    const stopOpt = useCallback((msg = '') => {
        runningRef.current = false;
        clearTimeout(timerRef.current);
        if (workerRef.current) {
            try { workerRef.current.terminate(); } catch (_) {}
            workerRef.current = null;
        }
        setPhase('idle');
        if (msg) setStatusMsg(msg);
    }, []);

    // M12: drop a stale cached base if the user manually edited the design (a
    // non-transient write bumps the revision) since it was snapshotted, so the
    // next Run restarts from the CURRENT design instead of overwriting the edits.
    // Synthesis's own transient previews don't bump the revision, so Stop→Run
    // with no edits still continues from where it left off.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(designRef.current?.id) ?? 0;
        if (rev !== baseRevRef.current) {
            baseDesignRef.current  = null;
            savedDesignRef.current = null;
            baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // ── Run engines ─────────────────────────────────────────────────────────────
    // The GE state machine lives in geRunners/. The window assembles a `ctx` bag
    // (refs + state setters + the reconcile / stop / pool helpers) that both the
    // default worker-pool engine and its main-thread fallback drive.
    const runOpt = useCallback(() => {
        runGeWorker({
            runningRef, timerRef, workerRef, dlsRef, baseDesignRef, savedDesignRef,
            designRef, operandsRef, cyclesRef, genCountRef, geStepsRef,
            updateDesignRef, checkpointRef,
            maxLayersRef, maxGeCyclesRef, targetMFRef, dlsIterRef, dMinRef,
            selectedCatsRef, excludedMatsRef,
            setPhase, setStatusMsg, setCanReset, setMf, setOmf, setMfBest, setOmfBest,
            setCycles, setGeneration, setLayerCount, setGeSteps,
            reconcileBaseWithEdits, stopOpt, getPoolMaterials, t,
        });
    }, [stopOpt, reconcileBaseWithEdits, t]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    // Default Reset wipes everything; resetOpt(side) does a per-side reset
    // (restore one side from the saved snapshot, drop that side's cycles,
    // leave the other side and its timeline alone).
    const resetOpt = useCallback((side) => {
        stopOpt('');
        dlsRef.current = null;
        if (savedDesignRef.current) {
            const patch = {};
            if (!side || side === 'front') patch.frontLayers = savedDesignRef.current.frontLayers;
            if (!side || side === 'back')  patch.backLayers  = savedDesignRef.current.backLayers;
            updateDesign(patch);
        }
        if (!side) {
            clearCached(designRef.current?.id);
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            cyclesRef.current      = [];
            genCountRef.current    = 0;
            geStepsRef.current     = 0;
            setCycles([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setGeSteps(0);
            setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
            setCanReset(false);
            setStatusMsg('');
        } else {
            // Per-side reset: keep the other side's timeline; drop this side's.
            cyclesRef.current = cyclesRef.current.filter(cy => cy.side !== side);
            setCycles(cyclesRef.current.slice());
            const survivors = cyclesRef.current.filter(cy => cy.layers);
            setMfBest(survivors.length ? Math.min(...survivors.map(cy => cy.mf)) : null);
            setOmfBest(minOmfOf(survivors));
            setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
            setCached(designRef.current?.id, {
                cycles: cyclesRef.current, geSteps: geStepsRef.current,
                savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
            });
        }
    }, [stopOpt, updateDesign]);

    // ── Jump to best ──────────────────────────────────────────────────────────
    const bestOpt = useCallback(() => {
        if (!cyclesRef.current.length) return;
        const bestCy = cyclesRef.current.filter(cy => cy.layers).reduce((a, b) => (a.mf <= b.mf ? a : b));
        stopOpt('');
        applyCycleSnapshot(bestCy);
        setMf(bestCy.mf);
        setOmf(bestCy.omf ?? null);
        setLayerCount(bestCy.layerCount);
        setGeneration(bestCy.genNum);
    }, [stopOpt, updateDesign]);

    // ── Restore specific cycle ────────────────────────────────────────────────
    const handleRestore = useCallback((cy) => {
        stopOpt('');
        applyCycleSnapshot(cy);
        setMf(cy.mf);
        setOmf(cy.omf ?? null);
        setLayerCount(cy.layerCount);
        setGeneration(cy.genNum);
    }, [stopOpt, updateDesign]);

    // Apply a cycle's snapshot. New cycles carry the full both-side snapshot
    // (frontSnap + backSnap); legacy cycles only had the active-side `layers`
    // — for those we write to the mode-active side and leave the other alone.
    function applyCycleSnapshot(cy) {
        const patch = {};
        if (cy.frontSnap || cy.backSnap) {
            if (cy.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(cy.frontSnap));
            if (cy.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(cy.backSnap));
        } else {
            const LK = cy.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
            patch[LK] = JSON.parse(JSON.stringify(cy.layers || []));
        }
        updateDesign(patch);
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    }

    // Catalog toggle/all/clear handlers come from useCatSelection().

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tg.noDesign);
    }

    const catalogs  = getCatalogs();
    const running   = phase !== 'idle';
    const bestMFVal = cyclesRef.current.filter(cy => cy.layers).length
        ? Math.min(...cyclesRef.current.filter(cy => cy.layers).map(cy => cy.mf))
        : (mf ?? Infinity);

    // Always show the merged timeline; the Side column tags which side each
    // cycle inserted on, and per-side reset lives in the ControlBar.
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';
    const renderableCycles = cycles.filter(cy => cy.type !== 'init');
    const topDesigns = useMemo(() => computePareto(cycles.filter(cy => cy.type !== 'init')), [cycles]);

    return h(SynthesisShell, {
        c, trendLabel: tg.mfTrend, tableLabel: tg.cycles,
        controlBar: h(ControlBar, {
            running, generation, layerCount, mf, mfBest, geSteps, canReset,
            onRun: runOpt, onStop: () => stopOpt(''),
            onReset: () => resetOpt(),
            onResetSide: (sd) => resetOpt(sd),
            onBest: bestOpt,
            statusMsg, design, t, c,
        }),
        sidebar: h(LeftSidebar, {
            catalogs, selectedCats, onToggleCat: handleToggleCat,
            onSelectAllCats: handleSelectAllCats, onClearCats: handleClearCats,
            excludedMats, onToggleMat: handleToggleMat,
            maxLayers, maxGeCycles, targetMF,
            dlsIter, dMin, maxMNT,
            onMaxLayers: setMaxLayers, onMaxGeCycles: setMaxGeCycles,
            onTargetMF: setTargetMF,
            onDlsIter: setDlsIter, onDMin: handleDMin,
            running, c, t,
        }),
        trend: h(MFTrendChart, { cycles, c, theme, emptyMsg: tg.noTrendYet }),
        table: h(CyclesTable, {
            cycles: renderableCycles,
            bestMF: bestMFVal, onRestore: handleRestore,
            showSide: showSideCol, c, t,
        }),
        topDesigns: h(SharedTopDesignsPanel, {
            topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, genPrefix: 'Gen ',
            labels: { topDesigns: tg.topDesigns, restore: tg.restore },
        }),
    });
}
