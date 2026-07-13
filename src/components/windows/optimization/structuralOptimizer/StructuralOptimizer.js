/**
 * Structural Optimizer synthesis window.
 *
 * Random structural mutations vary the number and arrangement of layers. Each
 * proposal is locally refined off-thread and accepted with a simulated-annealing
 * criterion. The live editor always receives the best design found.
 *
 * References: Macleod §9; Kirkpatrick et al., Science 220, 671 (1983);
 * Tikhonravov & Trubetskov, Appl. Opt. 51, 7319 (2012).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import {
    sideKeyFor, useCatSelection, minOmfOf, computePareto,
} from '../synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { SynthesisShell } from '../synthesisShell.js';
import { TrendPlot, ControlBar, LeftSidebar, HistoryTable, TopDesignsPanel } from './structuralPanels.js';
import { getCached, setCached, clearCached } from './structuralCache.js';
import { STRUCT_CATS_KEY, loadKinds, saveKinds } from './structuralSettings.js';
import { runStructuralWorker } from './runners/workerPool.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

export function StructuralOptimizer({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();
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
    const gensRef      = useRef([]);
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
        const prevId = lastDesignId.current;
        const newId = design?.id ?? null;
        lastDesignId.current = newId;
        if (prevId && prevId !== newId) stopOpt('');
        const cached = getCached(newId);
        if (cached) {
            gensRef.current = cached.generations;
            genCountRef.current = cached.generations.length
                ? cached.generations[cached.generations.length - 1].genNum
                : 0;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current = cached.baseDesign;
            trendRef.current = cached.trend || [];
            const bestMFv = cached.generations.length
                ? Math.min(...cached.generations.map(generation => generation.mf))
                : null;
            setGenerations(cached.generations.slice());
            setTopDesigns(computePareto(cached.generations));
            setTrend(trendRef.current.slice());
            setMfBest(bestMFv);
            setMf(cached.generations.length ? cached.generations[cached.generations.length - 1].mf : null);
            setOmf(cached.generations.length ? (cached.generations[cached.generations.length - 1].omf ?? null) : null);
            setOmfBest(minOmfOf(cached.generations));
            setLayerCount(cached.generations.length
                ? cached.generations[cached.generations.length - 1].layerCount
                : (design?.[sideKeyFor(design)] || []).length);
            setCanReset(!!cached.savedDesign);
        } else {
            gensRef.current = [];
            genCountRef.current = 0;
            trendRef.current = [];
            savedDesignRef.current = null;
            baseDesignRef.current = null;
            setGenerations([]);
            setTopDesigns([]);
            setTrend([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setIter(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        setStatusMsg('');
    }, [design?.id]);

    useEffect(() => () => {
        runningRef.current = false;
        killWorkers();
        saveCache();
    }, []);

    function killWorkers() {
        for (const worker of workersRef.current) {
            try { worker.terminate(); } catch (_) {}
        }
        workersRef.current = [];
    }

    function saveCache() {
        setCached(designRef.current?.id, {
            generations: gensRef.current,
            savedDesign: savedDesignRef.current,
            baseDesign: baseDesignRef.current,
            trend: trendRef.current,
        });
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

    const runOpt = useCallback(() => {
        runStructuralWorker({
            cfgRef, runningRef, workersRef, runIdRef, designRef, operandsRef,
            savedDesignRef, baseDesignRef, gensRef, genCountRef, trendRef,
            updateDesignRef, checkpointRef, selectedCatsRef, excludedMatsRef,
            killWorkers, saveCache, stopOpt, ts,
            setRunning, setIter, setTemp, setAccRate, setMf, setMfBest,
            setOmf, setOmfBest, setLayerCount, setGenerations, setTopDesigns,
            setTrend, setCanReset, setStatusMsg, setReheats,
        });
    }, [stopOpt, t]);

    const resetOpt = useCallback(() => {
        stopOpt('');
        if (savedDesignRef.current) {
            updateDesign({
                frontLayers: savedDesignRef.current.frontLayers,
                backLayers: savedDesignRef.current.backLayers,
            });
        }
        clearCached(designRef.current?.id);
        savedDesignRef.current = null;
        baseDesignRef.current = null;
        gensRef.current = [];
        genCountRef.current = 0;
        trendRef.current = [];
        setGenerations([]);
        setTopDesigns([]);
        setTrend([]);
        setMf(null);
        setMfBest(null);
        setOmf(null);
        setOmfBest(null);
        setIter(0);
        setTemp(null);
        setAccRate(null);
        setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
        setCanReset(false);
        setStatusMsg('');
    }, [stopOpt, updateDesign]);

    function applySnapshot(generation) {
        const patch = {};
        if (generation.frontSnap || generation.backSnap) {
            if (generation.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(generation.frontSnap));
            if (generation.backSnap) patch.backLayers = JSON.parse(JSON.stringify(generation.backSnap));
        } else {
            const layerKey = generation.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
            patch[layerKey] = JSON.parse(JSON.stringify(generation.layers || []));
        }
        updateDesign(patch);
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    }

    const handleRestore = useCallback((generation) => {
        stopOpt('');
        applySnapshot(generation);
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

    if (!design) return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, ts.noDesign);

    const catalogs = getCatalogs();
    const bestMFVal = gensRef.current.length ? Math.min(...gensRef.current.map(g => g.mf)) : (mf ?? Infinity);
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h(SynthesisShell, {
        c, trendLabel: ts.trendTitle, tableLabel: ts.generations,
        controlBar: h(ControlBar, {
            running, iter, maxIter, deepMode: !!deepMode, reheats, temp, layerCount, mf, mfBest, omf, omfBest, accRate, canReset,
            onRun: runOpt, onStop: () => stopOpt(), onReset: resetOpt, onBest: bestOpt,
            statusMsg, design, t, c,
        }),
        sidebar: h(LeftSidebar, {
            catalogs, selectedCats, onToggleCat: handleToggleCat,
            onSelectAllCats: handleSelectAllCats, onClearCats: handleClearCats,
            excludedMats, onToggleMat: handleToggleMat,
            maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds,
            deepMode, onDeepMode: setDeepMode, deepMaxMin, onDeepMaxMin: setDeepMaxMin,
            onToggleKind,
            onMaxIter: setMaxIter, onTargetMF: setTargetMF, onT0: setT0, onJitter: setJitterPct,
            onRefineIter: setRefineIter, onDMin: setDMin, onAddMax: setAddMax, onMaxLayers: setMaxLayers,
            running, c, t,
        }),
        trend: h(TrendPlot, { trend, c, theme, t }),
        table: h(HistoryTable, { generations, bestMF: bestMFVal, onRestore: handleRestore, showSide: showSideCol, c, t }),
        topDesigns: h(TopDesignsPanel, { topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, t }),
    });
}
