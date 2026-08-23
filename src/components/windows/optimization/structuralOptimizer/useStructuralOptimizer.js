import {
    sideKeyFor, useCatSelection, minOmfOf, computePareto,
} from '../synthesisShared/synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { activeBaseline, undoRunBlock } from '../synthesisShared/runBlocks.js';
import { getCached, setCached, clearCached } from './sessionState.js';
import { STRUCT_CATS_KEY, loadKinds, saveKinds } from './structuralSettings.js';
import { runStructuralWorker } from './runners/workerPool.js';

const { useCallback, useEffect, useRef, useState } = React;

function terminateWorkers(workersRef) {
    for (const worker of workersRef.current) {
        try { worker.terminate(); } catch (_) {}
    }
    workersRef.current = [];
}

function persistCache(refs) {
    setCached(refs.designRef.current?.id, {
        generations: refs.gensRef.current,
        runs: refs.runsRef.current,
        savedDesign: refs.savedDesignRef.current,
        baseDesign: refs.baseDesignRef.current,
        trend: refs.trendRef.current,
    });
}

function applySnapshotToDesign(generation, refs, updateDesign) {
    const patch = {};
    if (generation.frontSnap || generation.backSnap) {
        if (generation.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(generation.frontSnap));
        if (generation.backSnap) patch.backLayers = JSON.parse(JSON.stringify(generation.backSnap));
    } else {
        const layerKey = generation.side === 'back' ? 'backLayers' : sideKeyFor(refs.designRef.current);
        patch[layerKey] = JSON.parse(JSON.stringify(generation.layers || []));
    }
    updateDesign(patch);
    refs.baseDesignRef.current = { ...(refs.baseDesignRef.current || refs.designRef.current), ...patch };
}

function applyCachedRun(ctx, cached) {
    const { gensRef, genCountRef, savedDesignRef, baseDesignRef, trendRef, runsRef, runOpenRef, design } = ctx;
    gensRef.current = cached.generations;
    runsRef.current = cached.runs || [];
    // A remount is not a Stop: the run that filled this cache is over, so its
    // block is closed and the next Run press opens a new one.
    runOpenRef.current = false;
    genCountRef.current = cached.generations.length
        ? cached.generations[cached.generations.length - 1].genNum
        : 0;
    savedDesignRef.current = cached.savedDesign;
    baseDesignRef.current = cached.baseDesign;
    trendRef.current = cached.trend || [];
    const bestMFv = cached.generations.length
        ? Math.min(...cached.generations.map(generation => generation.mf))
        : null;
    ctx.setGenerations(cached.generations.slice());
    ctx.setTopDesigns(computePareto(cached.generations));
    ctx.setTrend(trendRef.current.slice());
    ctx.setMfBest(bestMFv);
    ctx.setMf(cached.generations.length ? cached.generations[cached.generations.length - 1].mf : null);
    ctx.setOmf(cached.generations.length ? (cached.generations[cached.generations.length - 1].omf ?? null) : null);
    ctx.setOmfBest(minOmfOf(cached.generations));
    ctx.setLayerCount(cached.generations.length
        ? cached.generations[cached.generations.length - 1].layerCount
        : (design?.[sideKeyFor(design)] || []).length);
    ctx.setCanReset(!!cached.savedDesign);
}

function applyFreshRun(ctx) {
    const { gensRef, genCountRef, savedDesignRef, baseDesignRef, trendRef, runsRef, runOpenRef, design } = ctx;
    gensRef.current = [];
    runsRef.current = [];
    runOpenRef.current = false;
    genCountRef.current = 0;
    trendRef.current = [];
    savedDesignRef.current = null;
    baseDesignRef.current = null;
    ctx.setGenerations([]);
    ctx.setTopDesigns([]);
    ctx.setTrend([]);
    ctx.setMf(null);
    ctx.setMfBest(null);
    ctx.setOmf(null);
    ctx.setOmfBest(null);
    ctx.setIter(0);
    ctx.setLayerCount((design?.[sideKeyFor(design)] || []).length);
    ctx.setCanReset(false);
}

function loadDesignSwitch(ctx) {
    const { design, lastDesignId, stopOpt, baseRevRef, getDesignRevision } = ctx;
    const prevId = lastDesignId.current;
    const newId = design?.id ?? null;
    lastDesignId.current = newId;
    if (prevId && prevId !== newId) stopOpt('');
    const cached = getCached(newId);
    if (cached) applyCachedRun(ctx, cached);
    else applyFreshRun(ctx);
    baseRevRef.current = getDesignRevision?.(newId) ?? 0;
    ctx.setStatusMsg('');
}

// Drop a cached optimizer base after a real editor write. Optimizer previews are
// transient and do not bump the design revision, so Stop -> Run still resumes
// the open block when the user has not edited the stack.
export function reconcileStructuralBaseWithEdits(refs, getDesignRevision) {
    const rev = getDesignRevision?.(refs.designRef.current?.id) ?? 0;
    if (rev === refs.baseRevRef.current) return false;
    refs.baseDesignRef.current = null;
    refs.runOpenRef.current = false;
    refs.baseRevRef.current = rev;
    return true;
}

export function useStructuralOptimizer({
    design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision, t,
}) {
    const ts = t.structural;

    const [maxIter,    setMaxIter]    = usePersistentNumber('tfstudio_struct_maxIter', 80);
    const [targetMF,   setTargetMF]   = usePersistentNumber('tfstudio_struct_targetMF', 5e-4);
    const [T0,         setT0]         = usePersistentNumber('tfstudio_struct_T0', 0.08);
    const [jitterPct,  setJitterPct]  = usePersistentNumber('tfstudio_struct_jitter', 0.15);
    const [refineIter, setRefineIter] = usePersistentNumber('tfstudio_struct_refineIter', 60);
    const [dMin,       setDMin]       = usePersistentNumber('tfstudio_struct_dMin', 1.0);
    const [addMaxNm,   setAddMax]     = usePersistentNumber('tfstudio_struct_addMax', 120);
    const [maxLayers,  setMaxLayers]  = usePersistentNumber('tfstudio_struct_maxLayers', 80);
    const [deepMode,   setDeepMode]   = usePersistentNumber('tfstudio_struct_deepMode', 0);
    const [deepMaxMin, setDeepMaxMin] = usePersistentNumber('tfstudio_struct_deepMaxMin', 0);
    const [reheats,    setReheats]    = useState(0);
    const [kinds,      setKinds]      = useState(loadKinds);
    const {
        selectedCats, selectedCatsRef, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(STRUCT_CATS_KEY);

    const [running,    setRunning]    = useState(false);
    const [iter,       setIter]       = useState(0);
    const [temp,       setTemp]       = useState(null);
    const [accRate,    setAccRate]    = useState(null);
    const [mf,         setMf]         = useState(null);
    const [mfBest,     setMfBest]     = useState(null);
    const [omf,        setOmf]        = useState(null);
    const [omfBest,    setOmfBest]    = useState(null);
    const [layerCount, setLayerCount] = useState(0);
    const [generations, setGenerations] = useState([]);
    const [topDesigns, setTopDesigns] = useState([]);
    const [trend,      setTrend]      = useState([]);
    const [canReset,   setCanReset]   = useState(false);
    const [statusMsg,  setStatusMsg]  = useState('');

    const runningRef   = useRef(false);
    const workersRef   = useRef([]);
    const runIdRef     = useRef(0);
    const designRef    = useRef(design);
    const operandsRef  = useRef([]);
    const savedDesignRef = useRef(null);
    const baseDesignRef  = useRef(null);
    const baseRevRef     = useRef(0);
    const gensRef      = useRef([]);
    const runsRef      = useRef([]);     // run blocks — see synthesisShared/runBlocks.js
    const runOpenRef   = useRef(false);  // a block is open (Stop→Run continues it)
    const genCountRef  = useRef(0);
    const trendRef     = useRef([]);
    const updateDesignRef = useRef(updateDesign);
    const checkpointRef   = useRef(checkpoint);

    const cfgRef = useRef({});
    useEffect(() => {
        cfgRef.current = {
            maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds,
            deepMode: !!deepMode, deepMaxMin,
        };
    }, [maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds, deepMode, deepMaxMin]);

    useEffect(() => { updateDesignRef.current = updateDesign; }, [updateDesign]);
    useEffect(() => { checkpointRef.current = checkpoint; }, [checkpoint]);
    useEffect(() => { designRef.current = design; }, [design]);
    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    const lastDesignId = useRef(null);
    useEffect(() => {
        loadDesignSwitch({
            design, lastDesignId, stopOpt,
            gensRef, genCountRef, savedDesignRef, baseDesignRef, baseRevRef, trendRef, runsRef, runOpenRef,
            getDesignRevision,
            setGenerations, setTopDesigns, setTrend, setMfBest, setMf, setOmf, setOmfBest,
            setLayerCount, setCanReset, setIter, setStatusMsg,
        });
    }, [design?.id]);

    useEffect(() => () => {
        runningRef.current = false;
        killWorkers();
        saveCache();
    }, []);

    function killWorkers() {
        terminateWorkers(workersRef);
    }

    function saveCache() {
        persistCache({ designRef, gensRef, savedDesignRef, baseDesignRef, trendRef, runsRef });
    }

    const stopOpt = useCallback((message) => {
        const wasRunning = runningRef.current;
        runningRef.current = false;
        runIdRef.current += 1;
        killWorkers();
        setRunning(false);
        setTemp(null);
        setStatusMsg(message != null ? message : (wasRunning ? ts.statusStopped : ''));
    }, [ts]);

    const reconcileBaseWithEdits = useCallback(() => {
        reconcileStructuralBaseWithEdits({ designRef, baseDesignRef, baseRevRef, runOpenRef }, getDesignRevision);
    }, [getDesignRevision]);

    const runOpt = useCallback(() => {
        runStructuralWorker({
            cfgRef, runningRef, workersRef, runIdRef, designRef, operandsRef,
            savedDesignRef, baseDesignRef, gensRef, genCountRef, trendRef, runsRef, runOpenRef,
            updateDesignRef, checkpointRef, selectedCatsRef, excludedMatsRef,
            killWorkers, saveCache, stopOpt, reconcileBaseWithEdits, ts,
            setRunning, setIter, setTemp, setAccRate, setMf, setMfBest,
            setOmf, setOmfBest, setLayerCount, setGenerations, setTopDesigns,
            setTrend, setCanReset, setStatusMsg, setReheats,
        });
    }, [stopOpt, reconcileBaseWithEdits, t]);

    // Push the display state that follows from the current generation list.
    function syncFromGens() {
        const gens = gensRef.current;
        setGenerations(gens.slice());
        setTopDesigns(computePareto(gens));
        setMfBest(gens.length ? Math.min(...gens.map(g => g.mf)) : null);
        setOmfBest(minOmfOf(gens));
        setTrend(trendRef.current.slice());
    }

    // Reset undoes ONE Run press: it restores the design that press started from
    // and drops its rows, leaving earlier runs alone, so pressing it again steps
    // back another run (synthesisShared/runBlocks.js).
    const resetOpt = useCallback(() => {
        stopOpt('');
        const undone = undoRunBlock(runsRef.current, gensRef.current);
        if (!undone) return;
        runsRef.current = undone.runs;
        gensRef.current = undone.gens;
        updateDesign({
            frontLayers: undone.baseline.frontLayers,
            backLayers: undone.baseline.backLayers,
        });
        const prev = activeBaseline(runsRef.current);
        savedDesignRef.current = prev;
        baseDesignRef.current = null;
        runOpenRef.current = false;
        const last = gensRef.current[gensRef.current.length - 1] || null;
        genCountRef.current = last?.genNum ?? 0;
        // The trend is one curve over the whole session, so an undone run takes
        // its samples with it.
        trendRef.current = trendRef.current.filter(point => point.runNum !== undone.runNum);
        syncFromGens();
        setMf(last?.mf ?? null);
        setOmf(last?.omf ?? null);
        setIter(0);
        setTemp(null);
        setAccRate(null);
        setLayerCount(last?.layerCount
            ?? (undone.baseline.frontLayers.length + undone.baseline.backLayers.length));
        setCanReset(!!prev);
        setStatusMsg(ts.runSeparator(undone.runNum) + ' ✕');
        if (runsRef.current.length) saveCache(); else clearCached(designRef.current?.id);
    }, [stopOpt, updateDesign, ts]);

    // Clear history: forget every run block and every row, and leave the design
    // exactly where it is.
    const clearHistoryOpt = useCallback(() => {
        stopOpt('');
        clearCached(designRef.current?.id);
        runsRef.current = [];
        runOpenRef.current = false;
        savedDesignRef.current = null;
        baseDesignRef.current = null;
        gensRef.current = [];
        genCountRef.current = 0;
        trendRef.current = [];
        syncFromGens();
        setMf(null);
        setOmf(null);
        setIter(0);
        setTemp(null);
        setAccRate(null);
        setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
        setCanReset(false);
        setStatusMsg('');
    }, [stopOpt]);

    const handleRestore = useCallback((generation) => {
        stopOpt('');
        applySnapshotToDesign(generation, { designRef, baseDesignRef }, updateDesign);
        setMf(generation.mf);
        setOmf(generation.omf ?? null);
        setLayerCount(generation.layerCount);
    }, [stopOpt, updateDesign]);

    const bestOpt = useCallback(() => {
        if (!gensRef.current.length) return;
        const best = gensRef.current.reduce((a, b) => (a.mf <= b.mf ? a : b));
        handleRestore(best);
    }, [handleRestore]);

    const onToggleKind = useCallback((kind) => {
        setKinds(previous => {
            const next = new Set(previous);
            if (next.has(kind)) next.delete(kind);
            else next.add(kind);
            if (next.size === 0) next.add(kind);
            saveKinds(next);
            return next;
        });
    }, []);

    const bestMFVal = gensRef.current.length ? Math.min(...gensRef.current.map(g => g.mf)) : (mf ?? Infinity);

    return {
        ts,
        maxIter, setMaxIter, targetMF, setTargetMF, T0, setT0, jitterPct, setJitterPct,
        refineIter, setRefineIter, dMin, setDMin, addMaxNm, setAddMax, maxLayers, setMaxLayers,
        deepMode, setDeepMode, deepMaxMin, setDeepMaxMin, reheats, kinds, onToggleKind,
        selectedCats, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, handleToggleMat,
        running, iter, temp, accRate, mf, mfBest, omf, omfBest, layerCount,
        generations, topDesigns, trend, canReset, statusMsg, bestMFVal,
        runOpt, stopOpt, resetOpt, handleRestore, bestOpt,
        clearHistoryOpt, hasHistory: generations.length > 0,
    };
}
