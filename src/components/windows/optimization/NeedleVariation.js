/**
 * Needle Variation synthesis window.
 *
 * Implements the Tikhonravov needle optimization cycle:
 *   1. Scan all insertion positions × catalog materials (δ = 1 nm needle)
 *   2. Insert the needle that gives the largest MF improvement
 *   3. Run DLS refinement until convergence
 *   4. Record the generation and repeat
 *
 * The Top Designs panel shows the Pareto-optimal generations: designs not
 * dominated simultaneously in layer count and MF value.
 *
 * Reference: Tikhonravov et al., Applied Optics 35(28), 1996.
 */

import { useDesign } from '../../../state/DesignContext.js';
import { getCatalogs } from '../../../utils/materials/catalogManager.js';

// Shared synthesis helpers (see synthesisHelpers.js). The two window-
// parameterized ones (verbose pool / cat-selection key) get thin same-named
// wrappers below so call sites are unchanged.
import {
    sideKeyFor, useCatSelection, minOmfOf,
    computePareto, getPoolMaterials as getPoolMaterialsShared,
} from './synthesisHelpers.js';
import { WorkerPool } from '../../../utils/workers/workerPool.js';
import { usePersistentNumber } from '../../ui/usePersistentState.js';

// Synthesis worker URL from the central registry (works unbundled + bundled).
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../workerUrls.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// Presentational panels (control bar, sidebar, tables, MF-trend chart) + the
// optimization engine (worker-pool orchestration + main-thread fallback).
import { SynthesisShell } from './synthesisShell.js';
import { runNeedleWorkerPool } from './needleEngine.js';
import {
    MFTrendChart, ControlBar, LeftSidebar, GenerationsTable, TopDesignsPanel,
} from './needlePanels.js';

// ── Window-parameterized wrappers around the shared helpers ─────────────────────
const NEEDLE_CATS_KEY = 'tfstudio_needle_selectedCats';

// ── Per-session optimization state cache (survives tab switches) ───────────────
const _needleCache = {};   // designId → { generations, savedDesign, baseDesign }
const getCachedOptState   = (id) => (id && _needleCache[id]) || null;
const setCachedOptState   = (id, state) => { if (id) _needleCache[id] = state; };
const clearCachedOptState = (id) => { if (id) delete _needleCache[id]; };
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => clearCachedOptState(e.detail?.id));

// Needle keeps its original verbose pool diagnostics.
const getPoolMaterials = (selectedCatalogIds, excluded) => getPoolMaterialsShared(selectedCatalogIds, { verbose: true, excluded });

// ── Main NeedleVariation window ───────────────────────────────────────────────

export function NeedleVariation({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();
    const tn = t.needle;

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
    // thread TMM + Plotly redraw. Effect-cleanup also fires on unmount.
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
    const savedDesignRef  = useRef(null);    // snapshot at Run start (for Reset)
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

    // Standalone Needle is a SYNTHESIS step (find structure with thin needles).
    // dMin here is the *synthesis* floor — it controls (a) the needle
    // line-search lower bound, (b) the post-DLS prune threshold. It MUST stay
    // small (default 1 nm) regardless of the user's MNT setting, otherwise
    // every "needle" is force-fed at MNT thickness and synthesis collapses.
    // GE uses the MNT-coupled dMin because its forced-TOT step escapes the
    // resulting local minimum; Needle has no such escape, so it can't.
    // Manufacturability is restored later by the Refinement + Cleaner loop.
    // (`maxMNT` is still computed below for the UI hint.)
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
    // A persisted dMin counts as user-set (skip the synthesis-floor default on
    // remount); a genuine design switch still re-derives.
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    useEffect(() => {
        const id = design?.id ?? null;
        if (lastIdForDMin.current !== id) {
            const firstMount = lastIdForDMin.current === null;
            lastIdForDMin.current = id;
            if (!firstMount) dMinTouchedRef.current = false;
        }
        if (runningRef.current || dMinTouchedRef.current) return;
        const def = 1.0;   // synthesis floor — thin needles by design
        if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
    }, [design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    // Layer count display — read from whichever side is active for the current
    // surface mode (back for back_only, front otherwise).
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear state on mount and when the active design changes
    const lastDesignId = useRef(null);
    useEffect(() => {
        const prevId = lastDesignId.current;
        const newId  = design?.id ?? null;
        lastDesignId.current = newId;

        if (prevId && prevId !== newId) {
            // Actual design switch: stop any running optimization
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
            setPhase('idle');
            setStatusMsg('');
        }

        // Restore cached optimization state for the new design (or clear if none)
        const cached = getCachedOptState(newId);
        if (cached) {
            const gens    = cached.generations;
            const lastGen = gens[gens.length - 1];
            const bestMF  = gens.length ? Math.min(...gens.map(g => g.mf)) : null;
            const bestOMFv = minOmfOf(gens);
            gensRef.current        = gens;
            genCountRef.current    = lastGen?.genNum ?? 0;
            lastBestRef.current    = null;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current  = cached.baseDesign;
            setGenerations(gens.slice());
            setTopDesigns(computePareto(gens));
            setMf(lastGen?.mf ?? null);
            setMfBest(bestMF);
            setOmf(lastGen?.omf ?? null);
            setOmfBest(bestOMFv);
            setGeneration(lastGen?.genNum ?? 0);
            setLayerCount(lastGen?.layerCount ?? 0);
            setCanReset(!!cached.savedDesign);
        } else {
            gensRef.current        = [];
            genCountRef.current    = 0;
            lastBestRef.current    = null;
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            setGenerations([]);
            setTopDesigns([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        // Sync the M12 edit-revision baseline to the design we just switched to,
        // so switching designs doesn't read as a "manual edit" on the next Run.
        baseRevRef.current = getDesignRevision?.(newId) ?? 0;
    }, [design?.id]);

    // ── Unmount cleanup — stop any running optimization to prevent orphaned timers ──
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

    // M12: if the user manually edited the design (a non-transient write bumps
    // the revision) since baseDesignRef was cached, drop the stale base + saved
    // snapshot so the next Run restarts from the CURRENT design instead of
    // optimizing (and then overwriting) the cached pre-edit stack. Synthesis's
    // own transient previews do NOT bump the revision, so a Stop→Run with no
    // edits still continues from where it left off.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(designRef.current?.id) ?? 0;
        if (rev !== baseRevRef.current) {
            baseDesignRef.current  = null;
            savedDesignRef.current = null;
            baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // Build the ctx bundle the engine reaches React state through (refs +
    // setters + a few window helpers). The same bundle drives both the default
    // worker-pool path and the identical-math main-thread fallback.
    const buildEngineCtx = useCallback(() => ({
        runningRef, timerRef, workerRef, dlsRef, baseDesignRef, savedDesignRef, designRef,
        operandsRef, gensRef, genCountRef, lastBestRef,
        maxLayersRef, deltaNmRef, dMinRef, dlsIterRef, targetMFRef,
        selectedCatsRef, excludedMatsRef, updateDesignRef, checkpointRef,
        setPhase, setStatusMsg, setMf, setMfBest, setOmf, setOmfBest,
        setLayerCount, setCanReset, setGeneration, setGenerations, setTopDesigns,
        reconcileBaseWithEdits, getPoolMaterials, setCachedOptState, t, stopOpt,
        // Pool factory: the component wires the real WorkerPool + worker URL; a
        // test can inject an in-process fake pool (tests/needle_worker_pool.mjs).
        makeWorkerPool: (K, initMessage) => new WorkerPool(SYNTH_WORKER_URL, K, initMessage),
    }), [reconcileBaseWithEdits, stopOpt, t]);

    // Default path: main thread orchestrates a WorkerPool of stateless synthesis
    // primitives (scan / candidate). The full loop lives in needleEngine.js
    // (runNeedleWorkerPool); on any pre-progress failure it falls back to the
    // main-thread loop in the same module.
    const runOpt = useCallback(() => {
        runNeedleWorkerPool(buildEngineCtx());
    }, [buildEngineCtx]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    // Default Reset wipes everything (full restore + clear history). The
    // ControlBar exposes Front / Back side resets in both_independent mode,
    // which call resetOpt(side) to restore only that side and drop that side's
    // generations from history.
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
            // Full reset: clear cache, history, and all in-memory state.
            clearCachedOptState(designRef.current?.id);
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            gensRef.current        = [];
            genCountRef.current    = 0;
            lastBestRef.current    = null;
            setGenerations([]);
            setTopDesigns([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
            setCanReset(false);
            setStatusMsg('');
        } else {
            // Per-side reset: drop this side's generations, keep the other
            // (and keep saved snapshot + baseDesign so subsequent runs can
            // continue against the unreset side).
            gensRef.current = gensRef.current.filter(g => g.side !== side);
            setGenerations(gensRef.current.slice());
            setTopDesigns(computePareto(gensRef.current));
            const remainBest = gensRef.current.length
                ? Math.min(...gensRef.current.map(g => g.mf)) : null;
            setMfBest(remainBest);
            setOmfBest(minOmfOf(gensRef.current));
            setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
            setCachedOptState(designRef.current?.id, {
                generations: gensRef.current,
                savedDesign: savedDesignRef.current,
                baseDesign:  baseDesignRef.current,
            });
        }
    }, [stopOpt, updateDesign]);

    // ── Jump to best seen generation ──────────────────────────────────────────
    const bestOpt = useCallback(() => {
        if (!gensRef.current.length) return;
        const bestGen = gensRef.current.reduce((a, b) => (a.mf <= b.mf ? a : b));
        stopOpt('');
        applyGenSnapshot(bestGen);
        setMf(bestGen.mf);
        setOmf(bestGen.omf ?? null);
        setLayerCount(bestGen.layerCount);
        setGeneration(bestGen.genNum);
    }, [stopOpt, updateDesign]);

    // ── Restore a specific generation ─────────────────────────────────────────
    const handleRestore = useCallback((gen) => {
        stopOpt('');
        applyGenSnapshot(gen);
        setMf(gen.mf);
        setOmf(gen.omf ?? null);
        setLayerCount(gen.layerCount);
        setGeneration(gen.genNum);
    }, [stopOpt, updateDesign]);

    // Apply a generation's snapshot to the design. New gens carry the full
    // both-side snapshot (frontSnap + backSnap); legacy gens only had the
    // active-side `layers` — for those we write to the surface-mode-active
    // side and leave the other untouched.
    function applyGenSnapshot(gen) {
        const patch = {};
        if (gen.frontSnap || gen.backSnap) {
            if (gen.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(gen.frontSnap));
            if (gen.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(gen.backSnap));
        } else {
            const LK = gen.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
            patch[LK] = JSON.parse(JSON.stringify(gen.layers || []));
        }
        updateDesign(patch);
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    }

    // Catalog toggle/all/clear handlers come from useCatSelection().

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tn.noDesign);
    }

    const catalogs   = getCatalogs();
    const running    = phase !== 'idle';
    const bestMFVal  = gensRef.current.length
        ? Math.min(...gensRef.current.map(g => g.mf))
        : (mf ?? Infinity);
    // For both_independent each generation has a `side` tag — surfaced in the
    // table via a Side column. We always show the merged timeline; per-side
    // reset is exposed in the ControlBar instead of a filter tab.
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h(SynthesisShell, {
        c, trendLabel: tn.mfTrend, tableLabel: tn.generations,
        controlBar: h(ControlBar, {
            running, phase, generation, layerCount, mf, mfBest, canReset,
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
            maxLayers, deltaNm, dMin, dlsIter, targetMF, maxMNT,
            onMaxLayers: setMaxLayers, onDeltaNm: setDeltaNm, onDMin: handleDMin, onDlsIter: setDlsIter,
            onTargetMF: setTargetMF,
            running, c, t,
        }),
        trend: h(MFTrendChart, { generations, c, theme, emptyMsg: tn.noTrendYet }),
        table: h(GenerationsTable, {
            generations, bestMF: bestMFVal,
            onRestore: handleRestore, showSide: showSideCol, c, t
        }),
        topDesigns: h(TopDesignsPanel, { topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, t }),
    });
}
