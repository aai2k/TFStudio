// Hook powering the Refinement window: run/stop/reset lifecycle, per-method
// worker dispatch, the per-design Reset/history cache (refinementCache.js), and
// merit-operand table edits. Branching logic lives in the standalone functions
// below so the hook itself stays a thin composition of useState/useRef/useEffect
// wiring — see operandEdits.js for the operand-array transforms it calls.

import { useDesign } from '../../../../state/DesignContext.js';
import {
    editOperand, addOperands, insertOperandAt, duplicateOperands, deleteOperands, moveOperand,
} from './operandEdits.js';
import { loadMethod, saveMethod, MAXITER_FOR, ALL_ORDER } from './refinementConfig.js';
import { _refineCache, _rc } from './refinementCache.js';
import { computeOperandDisplay } from './refinementUtils.js';
import { runDlsEvent } from './runners/dlsPool.js';
import { runMethodsFlow } from './runners/methodsFlow.js';

const { useState, useEffect, useRef, useCallback } = React;

// ── Worker-pool teardown ─────────────────────────────────────────────────────
// Hard-kill the whole optimizer worker pool. terminate() forcibly aborts a
// worker even mid-compute — this is what structurally removes the zombie-loop
// bug class.
function killAllWorkers(env) {
    const { poolRef, dePoolRef, flowWorkersRef } = env.refs;
    for (const w of poolRef.current) {
        try { w.terminate(); } catch (_) {}
    }
    poolRef.current = [];
    if (dePoolRef.current) { try { dePoolRef.current.terminate(); } catch (_) {} dePoolRef.current = null; }
    for (const w of flowWorkersRef.current) { try { w.terminate(); } catch (_) {} }
    flowWorkersRef.current.clear();
}

function stopRun(env) {
    const { refs, setters } = env;
    refs.runningRef.current = false;
    refs.runIdRef.current++;          // cancels any in-flight async method flow
    setters.setRunning(false);
    setters.setRestartIdx(0);
    clearTimeout(refs.timerRef.current);
    killAllWorkers(env);
}

// ── Per-design Reset/history cache (refinementCache.js) ─────────────────────
function commitBaselineTo(env, sd) {
    env.setters.setSavedDesign(sd);
    const rc = _rc(env.refs.designRef.current?.id);
    if (rc) rc.savedDesign = sd;
}

function addHistEntryTo(env, entry) {
    env.setters.setHistEntries(prev => {
        const next = [...prev, entry];
        const rc = _rc(env.refs.designRef.current?.id);
        if (rc) rc.histEntries = next;
        return next;
    });
}

function bumpRunCountOf(env) {
    const { histRunCount, designRef } = env.refs;
    histRunCount.current += 1;
    const rc = _rc(designRef.current?.id);
    if (rc) rc.histRunCount = histRunCount.current;
}

function clearRefineCacheOf(env) {
    const id = env.refs.designRef.current?.id;
    if (id && _refineCache[id]) {
        _refineCache[id] = { savedDesign: null, histEntries: [], histRunCount: 0 };
    }
}

// Rehydrate Reset/Best/history from the module cache for the current design id.
function hydrateFromCache(env, designId) {
    const { refs, setters } = env;
    const rc = _rc(designId);
    if (rc) {
        setters.setSavedDesign(rc.savedDesign);
        setters.setHistEntries(rc.histEntries);
        refs.histRunCount.current = rc.histRunCount;
        setters.setCanReset(!!rc.savedDesign && !refs.runningRef.current);
        refs.baselineRef.current = !!rc.savedDesign;
    } else {
        setters.setSavedDesign(null);
        setters.setHistEntries([]);
        refs.histRunCount.current = 0;
        setters.setCanReset(false);
        refs.baselineRef.current = false;
    }
}

// Merit-table display evaluation (only when not optimizing).
function evaluateDisplay(env, design, operands) {
    const r = computeOperandDisplay(design, operands);
    if (!r) return;
    env.setters.setComputed(r.computed); env.setters.setMf(r.mf); env.setters.setOmf(r.omf);
}

// The `ctx` bag threaded into the optimizer-driver runners (runners/mainThread.js
// et al.). It bundles the refs, state setters, cache helpers, and the locale
// table so the runners can stay plain functions in their own modules instead of
// closures over this hook's scope.
function buildRunCtx(env, killWorker, stopOpt, t) {
    const { refs, setters } = env;
    return {
        ...refs,
        commitBaseline: (sd) => commitBaselineTo(env, sd),
        bumpRunCount:   () => bumpRunCountOf(env),
        addHistEntry:   (entry) => addHistEntryTo(env, entry),
        killWorker, stopOpt,
        setMf: setters.setMf, setMfBest: setters.setMfBest, setMfInitial: setters.setMfInitial,
        setOmf: setters.setOmf, setOmfBest: setters.setOmfBest, setOmfInitial: setters.setOmfInitial,
        setIter: setters.setIter, setMfHistory: setters.setMfHistory, setRunning: setters.setRunning,
        setCanReset: setters.setCanReset, setRestartIdx: setters.setRestartIdx, setStopReason: setters.setStopReason,
        t,
    };
}

// ── Run dispatch ──────────────────────────────────────────────────────────────
function dispatchMethod(runCtx, m) {
    if (m === 'dls' || m === 'dls-multi') { runDlsEvent(runCtx); return; }
    runMethodsFlow(runCtx, m === 'all' ? ALL_ORDER : [m]);
}

function startRun(env, buildCtx) {
    const { refs } = env;
    if (refs.runningRef.current) return;
    const curDes = refs.designRef.current;
    const enabled = (refs.operandsRef.current || []).filter(op => op.enabled);
    if (!curDes || enabled.length === 0) { env.setters.setStopReason('noOperands'); return; }
    dispatchMethod(buildCtx(), env.methodRef.current);
}

function performReset(env, savedDesign, updateDesign) {
    const { refs, setters } = env;
    stopRun(env);
    refs.optimizerRef.current = null;
    if (savedDesign) {
        // Committed (non-transient) so Reset itself is undoable.
        updateDesign({ frontLayers: savedDesign.frontLayers, backLayers: savedDesign.backLayers });
        setters.setSavedDesign(null);
    }
    setters.setIter(0);
    setters.setMf(null);
    setters.setMfBest(null);
    setters.setMfInitial(null);
    setters.setOmf(null);
    setters.setOmfBest(null);
    setters.setOmfInitial(null);
    setters.setMfHistory([]);
    setters.setStopReason(null);
    setters.setCanReset(false);
    setters.setComputed([]);
    setters.setHistEntries([]);
    refs.histRunCount.current = 0;
    clearRefineCacheOf(env);
    refs.baselineRef.current = false;
}

function applyBest(env, updateDesign) {
    const opt = env.refs.optimizerRef.current;
    if (!opt) return;
    stopRun(env);
    opt.restoreBest();
    const updatedDesign = opt.applyToDesign(env.refs.designRef.current);
    updateDesign({ [opt.layerSide]: updatedDesign[opt.layerSide] });
}

function restoreHistoryEntry(env, entry, updateDesign) {
    const { refs, setters } = env;
    stopRun(env);
    refs.optimizerRef.current = null;
    setters.setCanReset(false);
    refs.baselineRef.current = false;
    const side = entry.layerSide || 'frontLayers';
    updateDesign({ [side]: JSON.parse(JSON.stringify(entry.layers)) });
    setters.setMfHistory([]);
    setters.setIter(0);
    setters.setMf(null);
    setters.setMfBest(null);
    setters.setMfInitial(null);
    setters.setOmf(null);
    setters.setOmfBest(null);
}

// Any operand edit ends the current run session: stop, drop the live optimizer,
// and clear the Reset baseline so the next Run re-checkpoints.
function haltAndInvalidate(env) {
    if (env.refs.runningRef.current) stopRun(env);
    env.refs.optimizerRef.current = null;
    env.setters.setCanReset(false);
    env.refs.baselineRef.current = false;
}

// ── Operand table edits (operandEdits.js transforms) ─────────────────────────
function applyEdit(env, updateDesign, edit) {
    haltAndInvalidate(env);
    updateDesign({ meritOperands: editOperand(env.refs.operandsRef.current, edit.id, edit.key, edit.value) });
}

function applyAdd(env, updateDesign, data, atIndex) {
    haltAndInvalidate(env);
    const res = addOperands(env.refs.operandsRef.current, data, atIndex);
    if (!res) return;
    updateDesign({ meritOperands: res.next });
    env.setters.setSelectedId(res.selectId);
}

function applyInsertAt(env, updateDesign, insertIdx, source) {
    haltAndInvalidate(env);
    const res = insertOperandAt(env.refs.operandsRef.current, insertIdx, source);
    updateDesign({ meritOperands: res.next });
    env.setters.setSelectedId(res.selectId);
}

function applyDuplicate(env, updateDesign, ids) {
    haltAndInvalidate(env);
    const res = duplicateOperands(env.refs.operandsRef.current, ids);
    if (!res) return;
    updateDesign({ meritOperands: res.next });
    if (res.selectId) env.setters.setSelectedId(res.selectId);
}

function applyDelete(env, updateDesign, ids) {
    haltAndInvalidate(env);
    updateDesign({ meritOperands: deleteOperands(env.refs.operandsRef.current, ids) });
    env.setters.setSelectedId(null);
}

function applyMove(env, updateDesign, selectedId, dir) {
    const next = moveOperand(env.refs.operandsRef.current, selectedId, dir);
    if (next) updateDesign({ meritOperands: next });
}

// ── Sub-hooks (each a real top-level closure, so its guards/branches don't
// roll up into the composing hook below) ────────────────────────────────────

// Stop on a real design switch, then (re)hydrate Reset/Best/history from the
// module cache. This also runs on first mount, so switching docking windows
// and coming back restores the run baseline instead of greying out Reset.
function useDesignCacheSync({ design, env }) {
    const lastDesignId = useRef(null);
    useEffect(() => {
        const switched = lastDesignId.current && lastDesignId.current !== design?.id;
        if (switched) { stopRun(env); env.refs.optimizerRef.current = null; }
        lastDesignId.current = design?.id ?? null;
        hydrateFromCache(env, design?.id);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Evaluate operands for the merit table display (skipped while optimizing —
// the run loop drives mf/omf/computed itself).
function useOperandDisplaySync({ design, operands, running, env }) {
    useEffect(() => {
        if (running) return;
        evaluateDisplay(env, design, operands);
    }, [operands, design, running]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useWorkerLifecycle({ env, running, beginOptimization, endOptimization }) {
    const killWorker = useCallback(() => killAllWorkers(env), []); // eslint-disable-line react-hooks/exhaustive-deps
    const stopOpt    = useCallback(() => stopRun(env), []); // eslint-disable-line react-hooks/exhaustive-deps

    // Stop the DLS loop when this component unmounts (docking-window/tab
    // switch). Without this, the chained setTimeout(tick) loop keeps running
    // against the unmounted closure — runningRef.current is still true there —
    // so it zombie-steps the optimizer and pushes transient design changes in
    // the background while the remounted instance shows a stale "Run" button.
    // The live optimizer can't be resumed (see _refineCache note above), so the
    // correct behavior is a clean stop; the design keeps the last applied
    // thicknesses and Reset/history persist via the cache.
    useEffect(() => () => {
        env.refs.runningRef.current = false;
        env.refs.runIdRef.current++;
        clearTimeout(env.refs.timerRef.current);
        killAllWorkers(env);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // While the DLS is running, flip the global isOptimizing flag so live-
    // preview consumers (OpticalEvaluation autoCalc) throttle their main-thread
    // TMM + Plotly redraw. Effect-cleanup also fires on unmount, so a tab
    // switch mid-run won't leave the counter stuck.
    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    return { killWorker, stopOpt };
}

// Run dispatcher (Run button + F5) plus Stop/Reset/Best/history-restore.
function useRunActions({ env, running, buildCtx, savedDesign, updateDesign, stopOpt }) {
    const runOpt = useCallback(() => startRun(env, buildCtx), [buildCtx]); // eslint-disable-line react-hooks/exhaustive-deps
    const resetOpt = useCallback(() => performReset(env, savedDesign, updateDesign), [savedDesign, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const bestOpt = useCallback(() => applyBest(env, updateDesign), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleRestore = useCallback((entry) => restoreHistoryEntry(env, entry, updateDesign), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onKey = e => { if (e.key === 'F5') { e.preventDefault(); running ? stopOpt() : runOpt(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running, runOpt, stopOpt]);

    return { runOpt, resetOpt, bestOpt, handleRestore };
}

// Merit-operand table edit handlers (shared design.meritOperands).
function useOperandHandlers({ env, updateDesign, selectedId }) {
    const handleEdit = useCallback((id, key, value) => applyEdit(env, updateDesign, { id, key, value }), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleAdd = useCallback((data, atIndex) => applyAdd(env, updateDesign, data, atIndex), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleInsertAt = useCallback((insertIdx, source) => applyInsertAt(env, updateDesign, insertIdx, source), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleDuplicate = useCallback((ids) => applyDuplicate(env, updateDesign, ids), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleDelete = useCallback((ids) => applyDelete(env, updateDesign, ids), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleMoveUp = useCallback(() => applyMove(env, updateDesign, selectedId, -1), [selectedId, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleMoveDown = useCallback(() => applyMove(env, updateDesign, selectedId, +1), [selectedId, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    return { handleEdit, handleAdd, handleInsertAt, handleDuplicate, handleDelete, handleMoveUp, handleMoveDown };
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useRefinement({ t }) {
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

    // `env` bundles the refs and state setters the extracted step functions and
    // the runner `ctx` need. Rebuilt each render, but every property inside is
    // itself a stable ref or setState function, so callbacks that close over it
    // stay correct across renders regardless of which render's `env` they hold.
    const refs = {
        runningRef, designRef, operandsRef, maxIterRef, multiStartRef,
        nRestartsRef, perturbPctRef, checkpointRef, updateDesignRef, optimizerRef,
        timerRef, baselineRef, lastBestRef, poolRef, runIdRef, flowWorkersRef,
        dePoolRef, histRunCount,
    };
    const setters = {
        setMf, setMfBest, setMfInitial, setOmf, setOmfBest, setOmfInitial,
        setIter, setMfHistory, setRunning, setCanReset, setRestartIdx, setStopReason,
        setSelectedId, setSavedDesign, setHistEntries, setComputed,
    };
    const env = { refs, setters, methodRef };

    useDesignCacheSync({ design, env });
    useOperandDisplaySync({ design, operands, running, env });

    const { killWorker, stopOpt } = useWorkerLifecycle({ env, running, beginOptimization, endOptimization });

    const buildCtx = useCallback(() => buildRunCtx(env, killWorker, stopOpt, t), [killWorker, stopOpt, t]); // eslint-disable-line react-hooks/exhaustive-deps

    const { runOpt, resetOpt, bestOpt, handleRestore } = useRunActions({
        env, running, buildCtx, savedDesign, updateDesign, stopOpt,
    });

    const {
        handleEdit, handleAdd, handleInsertAt, handleDuplicate, handleDelete, handleMoveUp, handleMoveDown,
    } = useOperandHandlers({ env, updateDesign, selectedId });

    return {
        design, operands, selectedId, setSelectedId, computed,
        running, iter, mf, mfBest, mfInitial, omf, omfBest, canReset,
        method, nRestarts, perturbPct, restartIdx, maxIter, stopReason, mfHistory, histEntries,
        onRun: runOpt, onStop: stopOpt, onReset: resetOpt, onBest: bestOpt,
        onMethod: setMethod, onNRestarts: setNRestarts, onPerturbPct: setPerturbPct, onMaxIter: setMaxIter,
        onEdit: handleEdit, onAdd: handleAdd, onInsertAt: handleInsertAt, onDuplicate: handleDuplicate,
        onDelete: handleDelete, onMoveUp: handleMoveUp, onMoveDown: handleMoveDown,
        onRestore: handleRestore,
    };
}
