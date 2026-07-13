import { useDesign } from '../../../../state/DesignContext.js';
import {
    editOperand, addOperands, insertOperandAt, duplicateOperands, deleteOperands, moveOperand,
} from './operandEdits.js';
import { MFTable } from '../meritFunctionEditor/mfTable/MFTable.js';
import { loadMethod, saveMethod, MAXITER_FOR, ALL_ORDER } from './refinementConfig.js';
import { _refineCache, _rc } from './refinementCache.js';
import { computeOperandDisplay } from './refinementUtils.js';
import { ControlBar } from './ControlBar.js';
import { HistoryPanel } from './HistoryPanel.js';
import { MFTrendPlot } from './MFTrendPlot.js';
import { runDlsEvent } from './runners/dlsPool.js';
import { runMethodsFlow } from './runners/methodsFlow.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── Main Refinement window ────────────────────────────────────────────────────

export function Refinement({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();

    const operands = design?.meritOperands || [];

    const [selectedId,  setSelectedId]  = useState(null);
    const [computed,    setComputed]    = useState([]);
    const [mf,          setMf]          = useState(null);
    const [mfBest,      setMfBest]      = useState(null);
    const [mfInitial,   setMfInitial]   = useState(null);
    // OMF (optical merit, no thickness constraints) — display-only, shown
    // alongside MF. The optimizer still minimizes the full MF.
    const [omf,         setOmf]         = useState(null);
    const [omfBest,     setOmfBest]     = useState(null);
    const [omfInitial,  setOmfInitial]  = useState(null);
    const [iter,        setIter]        = useState(0);
    const [mfHistory,   setMfHistory]   = useState([]);
    const [running,     setRunning]     = useState(false);
    const [stopReason,  setStopReason]  = useState(null);
    const [canReset,    setCanReset]    = useState(false);
    const [savedDesign, setSavedDesign] = useState(null);
    const [histEntries, setHistEntries] = useState([]);
    const histRunCount  = useRef(0);

    // Method selector (persisted as a global app setting) + multi-start params.
    const [method,      setMethod]      = useState(loadMethod);
    const [nRestarts,   setNRestarts]   = useState(20);
    const [perturbPct,  setPerturbPct]  = useState(30);
    const [restartIdx,  setRestartIdx]  = useState(0);
    // Max iterations — defaults to the method's natural budget (MAXITER_FOR); the
    // run still stops early at convergence, this is just the cap. Resets to the
    // method default when the method changes; the user can override per run.
    const [maxIter,     setMaxIter]     = useState(() => MAXITER_FOR[loadMethod()] || 500);

    const optimizerRef    = useRef(null);
    const runningRef      = useRef(false);
    const timerRef        = useRef(null);
    const poolRef         = useRef([]);     // active optimizer Web Worker pool
    const dePoolRef       = useRef(null);   // WorkerPool for parallel DE
    const flowWorkersRef  = useRef(new Set()); // live single-engine workers (flow paths)
    const runIdRef        = useRef(0);      // bumped to cancel the async flow
    const lastBestRef     = useRef(null);   // { mfBest, frontLayers, backLayers } for Best after Stop
    const baselineRef     = useRef(false);  // run baseline/checkpoint already taken this session
    const operandsRef     = useRef(operands);
    const designRef       = useRef(design);
    const updateDesignRef = useRef(updateDesign);

    // multiStartRef stays the signal the validated event-path runOpt reads; it is
    // now derived from the method selector ('dls-multi' ⇒ multistart).
    const multiStartRef  = useRef(false);
    const methodRef      = useRef(method);
    const nRestartsRef   = useRef(20);
    const perturbPctRef  = useRef(30);
    const maxIterRef     = useRef(maxIter);
    useEffect(() => { methodRef.current = method; multiStartRef.current = (method === 'dls-multi'); saveMethod(method); }, [method]);
    useEffect(() => { nRestartsRef.current  = nRestarts;  }, [nRestarts]);
    useEffect(() => { perturbPctRef.current = perturbPct; }, [perturbPct]);
    useEffect(() => { maxIterRef.current = maxIter; }, [maxIter]);
    // When the method changes, snap Max iterations back to that method's natural budget.
    useEffect(() => { setMaxIter(MAXITER_FOR[method] || 500); }, [method]);

    const checkpointRef = useRef(checkpoint);

    useEffect(() => { operandsRef.current     = operands;      }, [operands]);
    useEffect(() => { designRef.current       = design;        }, [design]);
    useEffect(() => { updateDesignRef.current = updateDesign;  }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;    }, [checkpoint]);

    // Stop on a real design switch, then (re)hydrate Reset/Best/history from the
    // module cache. This also runs on first mount, so switching docking windows
    // and coming back restores the run baseline instead of greying out Reset.
    const lastDesignId = useRef(null);
    useEffect(() => {
        const switched = lastDesignId.current && lastDesignId.current !== design?.id;
        if (switched) {
            stopOpt();
            optimizerRef.current = null;
        }
        lastDesignId.current = design?.id ?? null;

        const rc = _rc(design?.id);
        if (rc) {
            setSavedDesign(rc.savedDesign);
            setHistEntries(rc.histEntries);
            histRunCount.current = rc.histRunCount;
            setCanReset(!!rc.savedDesign && !runningRef.current);
            // A cached baseline means a run session is still "open" for this
            // design — next Run must NOT take a second checkpoint.
            baselineRef.current = !!rc.savedDesign;
        } else {
            setSavedDesign(null);
            setHistEntries([]);
            histRunCount.current = 0;
            setCanReset(false);
            baselineRef.current = false;
        }
    }, [design?.id]);

    // ── Cache-synced setters (survive unmount) ────────────────────────────────
    const commitBaseline = useCallback((sd) => {
        setSavedDesign(sd);
        const rc = _rc(designRef.current?.id);
        if (rc) rc.savedDesign = sd;
    }, []);
    const addHistEntry = useCallback((entry) => {
        setHistEntries(prev => {
            const next = [...prev, entry];
            const rc = _rc(designRef.current?.id);
            if (rc) rc.histEntries = next;
            return next;
        });
    }, []);
    const bumpRunCount = useCallback(() => {
        histRunCount.current += 1;
        const rc = _rc(designRef.current?.id);
        if (rc) rc.histRunCount = histRunCount.current;
    }, []);
    const clearRefineCache = useCallback(() => {
        const id = designRef.current?.id;
        if (id && _refineCache[id]) {
            _refineCache[id] = { savedDesign: null, histEntries: [], histRunCount: 0 };
        }
    }, []);

    // Evaluate operands for display (not during optimization)
    useEffect(() => {
        if (running) return;
        const r = computeOperandDisplay(design, operands);
        if (!r) return;
        setComputed(r.computed); setMf(r.mf); setOmf(r.omf);
    }, [operands, design, running]);

    // ── Run / Stop ─────────────────────────────────────────────────────────────
    // Hard-kill the whole optimizer worker pool. terminate() forcibly aborts a
    // worker even mid-compute — this is what structurally
    // removes the zombie-loop bug class.
    const killWorker = useCallback(() => {
        for (const w of poolRef.current) {
            try { w.terminate(); } catch (_) {}
        }
        poolRef.current = [];
        if (dePoolRef.current) { try { dePoolRef.current.terminate(); } catch (_) {} dePoolRef.current = null; }
        for (const w of flowWorkersRef.current) { try { w.terminate(); } catch (_) {} }
        flowWorkersRef.current.clear();
    }, []);

    const stopOpt = useCallback(() => {
        runningRef.current = false;
        runIdRef.current++;          // cancels any in-flight async method flow
        setRunning(false);
        setRestartIdx(0);
        clearTimeout(timerRef.current);
        killWorker();
    }, [killWorker]);

    // Stop the DLS loop when this component unmounts (docking-window/tab
    // switch). Without this, the chained setTimeout(tick) loop keeps running
    // against the unmounted closure — runningRef.current is still true there —
    // so it zombie-steps the optimizer and pushes transient design changes in
    // the background while the remounted instance shows a stale "Run" button.
    // The live optimizer can't be resumed (see _refineCache note above), so the
    // correct behavior is a clean stop; the design keeps the last applied
    // thicknesses and Reset/history persist via the cache.
    useEffect(() => () => {
        runningRef.current = false;
        runIdRef.current++;
        clearTimeout(timerRef.current);
        for (const w of poolRef.current) {
            try { w.terminate(); } catch (_) {}
        }
        poolRef.current = [];
        if (dePoolRef.current) { try { dePoolRef.current.terminate(); } catch (_) {} dePoolRef.current = null; }
        for (const w of flowWorkersRef.current) { try { w.terminate(); } catch (_) {} }
        flowWorkersRef.current.clear();
    }, []);

    // The `ctx` bag threaded into the optimizer-driver runners. It bundles the
    // component's refs, state setters, cache helpers, and the locale table so the
    // runners can stay plain functions in their own modules instead of closures
    // over this component's scope. Refs and useState setters are stable; the
    // memo only needs to refresh when the cache helpers or `t` change.
    const buildCtx = useCallback(() => ({
        // refs
        runningRef, designRef, operandsRef, maxIterRef, multiStartRef,
        nRestartsRef, perturbPctRef, checkpointRef, updateDesignRef, optimizerRef,
        timerRef, baselineRef, lastBestRef, poolRef, runIdRef, flowWorkersRef,
        dePoolRef, histRunCount,
        // cache/run helpers
        commitBaseline, bumpRunCount, addHistEntry, killWorker, stopOpt,
        // state setters
        setMf, setMfBest, setMfInitial, setOmf, setOmfBest, setOmfInitial,
        setIter, setMfHistory, setRunning, setCanReset, setRestartIdx, setStopReason,
        // locale
        t,
    }), [commitBaseline, bumpRunCount, addHistEntry, killWorker, stopOpt, t]);

    // While the DLS is running, flip the global isOptimizing flag so live-
    // preview consumers (OpticalEvaluation autoCalc) throttle their main-thread
    // TMM + Plotly redraw. Effect-cleanup also fires on unmount, so a tab
    // switch mid-run won't leave the counter stuck.
    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    // ── Run dispatcher (Run button + F5) ───────────────────────────────────────
    const runOpt = useCallback(() => {
        if (runningRef.current) return;
        const curDes = designRef.current;
        const enabled = (operandsRef.current || []).filter(op => op.enabled);
        if (!curDes || enabled.length === 0) { setStopReason('noOperands'); return; }
        const ctx = buildCtx();
        const m = methodRef.current;
        if (m === 'dls' || m === 'dls-multi') { runDlsEvent(ctx); return; }
        runMethodsFlow(ctx, m === 'all' ? ALL_ORDER : [m]);
    }, [buildCtx]);

    const resetOpt = useCallback(() => {
        stopOpt();
        optimizerRef.current = null;
        if (savedDesign) {
            // Committed (non-transient) so Reset itself is undoable.
            updateDesign({ frontLayers: savedDesign.frontLayers, backLayers: savedDesign.backLayers });
            setSavedDesign(null);
        }
        setIter(0);
        setMf(null);
        setMfBest(null);
        setMfInitial(null);
        setOmf(null);
        setOmfBest(null);
        setOmfInitial(null);
        setMfHistory([]);
        setStopReason(null);
        setCanReset(false);
        setComputed([]);
        setHistEntries([]);
        histRunCount.current = 0;
        clearRefineCache();
        baselineRef.current = false;
    }, [stopOpt, savedDesign, updateDesign, clearRefineCache]);

    const bestOpt = useCallback(() => {
        const opt = optimizerRef.current;
        if (!opt) return;
        stopOpt();
        opt.restoreBest();
        const updatedDesign = opt.applyToDesign(designRef.current);
        updateDesign({ [opt.layerSide]: updatedDesign[opt.layerSide] });
    }, [stopOpt, updateDesign]);

    const handleRestore = useCallback((entry) => {
        stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const side = entry.layerSide || 'frontLayers';
        updateDesign({ [side]: JSON.parse(JSON.stringify(entry.layers)) });
        setMfHistory([]);
        setIter(0);
        setMf(null);
        setMfBest(null);
        setMfInitial(null);
        setOmf(null);
        setOmfBest(null);
        setOmfInitial(null);
    }, [stopOpt, updateDesign]);

    // F5 shortcut
    useEffect(() => {
        const onKey = e => { if (e.key === 'F5') { e.preventDefault(); running ? stopOpt() : runOpt(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running, runOpt, stopOpt]);

    // ── Operand edits (shared design.meritOperands) ────────────────────────────
    // Any operand edit ends the current run session: stop, drop the live
    // optimizer, and clear the Reset baseline so the next Run re-checkpoints.
    const haltAndInvalidate = useCallback(() => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
    }, [stopOpt]);

    const handleEdit = useCallback((id, key, value) => {
        haltAndInvalidate();
        updateDesign({ meritOperands: editOperand(operandsRef.current, id, key, value) });
    }, [haltAndInvalidate, updateDesign]);

    const handleAdd = useCallback((data, atIndex) => {
        haltAndInvalidate();
        const res = addOperands(operandsRef.current, data, atIndex);
        if (!res) return;
        updateDesign({ meritOperands: res.next });
        setSelectedId(res.selectId);
    }, [haltAndInvalidate, updateDesign]);

    const handleInsertAt = useCallback((insertIdx, source) => {
        haltAndInvalidate();
        const res = insertOperandAt(operandsRef.current, insertIdx, source);
        updateDesign({ meritOperands: res.next });
        setSelectedId(res.selectId);
    }, [haltAndInvalidate, updateDesign]);

    const handleDuplicate = useCallback((ids) => {
        haltAndInvalidate();
        const res = duplicateOperands(operandsRef.current, ids);
        if (!res) return;
        updateDesign({ meritOperands: res.next });
        if (res.selectId) setSelectedId(res.selectId);
    }, [haltAndInvalidate, updateDesign]);

    const handleDelete = useCallback((ids) => {
        haltAndInvalidate();
        updateDesign({ meritOperands: deleteOperands(operandsRef.current, ids) });
        setSelectedId(null);
    }, [haltAndInvalidate, updateDesign]);

    const handleMoveUp = useCallback(() => {
        const next = moveOperand(operandsRef.current, selectedId, -1);
        if (next) updateDesign({ meritOperands: next });
    }, [selectedId, updateDesign]);

    const handleMoveDown = useCallback(() => {
        const next = moveOperand(operandsRef.current, selectedId, +1);
        if (next) updateDesign({ meritOperands: next });
    }, [selectedId, updateDesign]);

    // ── Render ─────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } },
            t.refinement.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden'
        }
    },
        h(ControlBar, {
            running, iter, mf, mfBest, mfInitial, omf, omfBest, canReset,
            method, nRestarts, perturbPct, restartIdx, maxIter, stopReason,
            surfaceMode: design?.surfaceMode || 'front_only',
            mfEvalMode:  design?.mfEvalMode  || 'side',
            onRun: runOpt, onStop: stopOpt, onReset: resetOpt, onBest: bestOpt,
            onMethod: setMethod, onNRestarts: setNRestarts, onPerturbPct: setPerturbPct, onMaxIter: setMaxIter,
            t, c,
        }),

        // Operand table — full width, takes all available space
        h('div', {
            style: {
                flex: 1, minHeight: 0,
                display: 'flex', flexDirection: 'column',
                background: c.panel, overflow: 'hidden'
            }
        },
            h(MFTable, {
                operands, computed, selectedId,
                noOperandsMsg: t.refinement.noOperands,
                onSelect: setSelectedId,
                onEdit:   handleEdit,
                onAdd:    handleAdd,
                onInsertAt: handleInsertAt,
                onDuplicate: handleDuplicate,
                onDelete: handleDelete,
                onMoveUp: handleMoveUp,
                onMoveDown: handleMoveDown,
                showToolbar: false,
                c, t
            })
        ),

        // Compact MF trend plot strip — only shown when running or has history
        mfHistory.length > 1 && h('div', {
            style: {
                height: 118, flexShrink: 0,
                borderTop: `1px solid ${c.border}`,
                padding: '2px 4px', background: c.bg, overflow: 'hidden'
            }
        },
            h(MFTrendPlot, { history: mfHistory, c, theme })
        ),

        h(HistoryPanel, { entries: histEntries, onRestore: handleRestore, c, t })
    );
}
