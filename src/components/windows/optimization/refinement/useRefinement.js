// Hook powering the Refinement window: run/stop/reset lifecycle, the
// per-design Reset/history state (sessionState.js), and merit-operand table
// edits. Branching logic lives in the standalone functions below so the hook
// itself stays a thin composition of useState/useRef/useEffect wiring. The
// operand-array transforms it calls are in operandEdits.js, and how a run
// reaches the window is in windowRun.js.

import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import {
    editOperand, addOperands, insertOperandAt, duplicateOperands, deleteOperands, moveOperand,
} from './operandEdits.js';
import { loadMethod, saveMethod } from './refinementConfig.js';
import { DEFAULT_SETTINGS, defaultMaxIter } from '../../../../utils/refinement/methods.js';
import { computeOperandDisplay, firstOperandErrorMessage } from '../../../../utils/refinement/operandCheck.js';
import { clearRefinement, readRefinement, writeRefinement } from './sessionState.js';
import { startWindowRun } from './windowRun.js';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Abort the run in flight: it stops every worker it has, terminating them even
// mid-compute, so no stopped run keeps stepping or writing the design.
function abortRun(env) {
    env.refs.abortRef.current?.abort();
    env.refs.abortRef.current = null;
}

function stopRun(env) {
    const { refs, setters } = env;
    refs.runningRef.current = false;
    setters.setRunning(false);
    setters.setRestartIdx(0);
    abortRun(env);
}

// Stop the run and let go of it: what it still reports while it unwinds no
// longer reaches the window. Reset, Restore, an operand edit, a design switch
// and closing the window do this; Stop and Best keep the run, so a method cut
// short by Stop still hands its best to Best.
function discardRun(env) {
    env.refs.activeRunRef.current = null;
    stopRun(env);
}

// ── Per-design Reset/history state (sessionState.js) ────────────────────────
function commitBaselineTo(env, sd) {
    env.setters.setSavedDesign(sd);
    writeRefinement(env.refs.designRef.current?.id, { savedDesign: sd });
}

function addHistEntryTo(env, entry) {
    env.setters.setHistEntries(prev => {
        const next = [...prev, entry];
        writeRefinement(env.refs.designRef.current?.id, { histEntries: next });
        return next;
    });
}

function bumpRunCountOf(env) {
    const { histRunCount, designRef } = env.refs;
    histRunCount.current += 1;
    writeRefinement(designRef.current?.id, { histRunCount: histRunCount.current });
}

function clearRefineCacheOf(env) {
    clearRefinement(env.refs.designRef.current?.id);
}

// What a run leaves on screen: iterations, end reason, merit trend, best and
// initial merit, and the layers Best applies. It is kept per design, so a
// design switch shows that design's own last run, or none, and Best acts on the
// result of the design on screen.
const NO_RUN = Object.freeze({
    iter: 0, stopReason: null, mfHistory: [], mfBest: null, mfInitial: null,
    omfBest: null, omfInitial: null, lastBest: null,
});

function showRun(env, designId, run) {
    const { refs, setters } = env;
    const shown = run || NO_RUN;
    setters.setIter(shown.iter);
    setters.setStopReason(shown.stopReason);
    setters.setMfHistory(shown.mfHistory);
    setters.setMfBest(shown.mfBest);
    setters.setMfInitial(shown.mfInitial);
    setters.setOmfBest(shown.omfBest);
    setters.setOmfInitial(shown.omfInitial);
    refs.lastBestRef.current = shown.lastBest;
    setters.setRunOwner(designId);
}

// Rehydrate Reset/Best/history and the last run for the current design id
// after a remount or a design change.
function hydrateFromCache(env, designId) {
    const { refs, setters } = env;
    const stored = readRefinement(designId);
    if (stored) {
        setters.setSavedDesign(stored.savedDesign);
        setters.setHistEntries(stored.histEntries);
        refs.histRunCount.current = stored.histRunCount;
        setters.setCanReset(!!stored.savedDesign && !refs.runningRef.current);
        refs.baselineRef.current = !!stored.savedDesign;
    } else {
        setters.setSavedDesign(null);
        setters.setHistEntries([]);
        refs.histRunCount.current = 0;
        setters.setCanReset(false);
        refs.baselineRef.current = false;
    }
    showRun(env, designId ?? null, stored?.lastRun);
}

// Merit-table display evaluation (only when not optimizing).
function evaluateDisplay(env, design, operands) {
    const r = computeOperandDisplay(design, operands);
    if (!r) return;
    env.setters.setComputed(r.computed); env.setters.setEvaluationErrors(r.errors || []);
    env.setters.setMf(r.mf); env.setters.setOmf(r.omf);
}

// The `ctx` bag windowRun.js starts a run with. It bundles the refs, state
// setters, cache helpers, and the locale table so the run's window side can
// stay a plain function in its own module instead of a closure over this hook's
// scope.
function buildRunCtx(env, t) {
    const { refs, setters } = env;
    return {
        ...refs,
        methodRef: env.methodRef,
        commitBaseline: (sd) => commitBaselineTo(env, sd),
        bumpRunCount:   () => bumpRunCountOf(env),
        addHistEntry:   (entry) => addHistEntryTo(env, entry),
        setMf: setters.setMf, setMfBest: setters.setMfBest, setMfInitial: setters.setMfInitial,
        setOmf: setters.setOmf, setOmfBest: setters.setOmfBest, setOmfInitial: setters.setOmfInitial,
        setIter: setters.setIter, setMfHistory: setters.setMfHistory, setRunning: setters.setRunning,
        setCanReset: setters.setCanReset, setRestartIdx: setters.setRestartIdx, setStopReason: setters.setStopReason,
        setSeed: setters.setSeed,
        t,
    };
}

// ── Run start ─────────────────────────────────────────────────────────────────
function startRun(env, buildCtx) {
    const { refs } = env;
    if (refs.runningRef.current) return;
    const curDes = refs.designRef.current;
    const allOperands = refs.operandsRef.current || [];
    const enabled = allOperands.filter(op => op.enabled);
    if (!curDes || enabled.length === 0) { env.setters.setStopReason('noOperands'); return; }
    const preflight = computeOperandDisplay(curDes, allOperands);
    const operandError = firstOperandErrorMessage(allOperands, preflight?.errors);
    if (operandError) {
        env.setters.setComputed(preflight.computed);
        env.setters.setEvaluationErrors(preflight.errors);
        env.setters.setMf(null); env.setters.setOmf(null);
        env.setters.setStopReason(`invalidOperand:${operandError}`);
        return;
    }
    startWindowRun(buildCtx());
}

function performReset(env, savedDesign, updateDesign) {
    const { refs, setters } = env;
    discardRun(env);
    // Best has nothing to apply after Reset, also once the window shows this
    // design again.
    refs.lastBestRef.current = null;
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
    setters.setEvaluationErrors([]);
    setters.setHistEntries([]);
    refs.histRunCount.current = 0;
    clearRefineCacheOf(env);
    refs.baselineRef.current = false;
}

// Apply the best design the current run has produced. `optimizerRef` carries it
// once a run finishes; while a run is still in flight, or after a Stop cut one
// short, `lastBestRef` is the record that is kept up to date, so Best works from
// the moment the first improvement lands rather than only after the last method.
function applyBest(env, updateDesign) {
    const opt = env.refs.optimizerRef.current;
    if (opt) {
        stopRun(env);
        opt.restoreBest();
        const updatedDesign = opt.applyToDesign(env.refs.designRef.current);
        updateDesign({ [opt.layerSide]: updatedDesign[opt.layerSide] });
        return;
    }
    const best = env.refs.lastBestRef.current;
    if (!best || !best.frontLayers) return;
    stopRun(env);
    updateDesign({ frontLayers: best.frontLayers, backLayers: best.backLayers });
}

function restoreHistoryEntry(env, entry, updateDesign) {
    const { refs, setters } = env;
    discardRun(env);
    // Best has nothing to apply over a restored row, also once the window shows
    // this design again.
    refs.lastBestRef.current = null;
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

// Any operand edit ends the current run session: stop, drop the finished run's
// result record, and clear the Reset baseline so the next Run re-checkpoints.
function haltAndInvalidate(env) {
    discardRun(env);
    env.refs.optimizerRef.current = null;
    env.setters.setCanReset(false);
    env.refs.baselineRef.current = false;
}

// ── Operand table edits (operandEdits.js transforms) ─────────────────────────
function applyEdit(env, updateDesign, edit) {
    haltAndInvalidate(env);
    updateDesign({ meritOperands: editOperand(env.refs.operandsRef.current, edit.id, edit.key, edit.value) });
}

// A paste over many cells is one change to the design. Applied one at a time,
// each edit would start from the operand list of the last render and undo the
// edit before it.
function applyEditMany(env, updateDesign, edits) {
    haltAndInvalidate(env);
    updateDesign({
        meritOperands: edits.reduce((list, edit) => editOperand(list, edit.id, edit.key, edit.value), env.refs.operandsRef.current),
    });
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

// Stop on a real design switch, then (re)hydrate Reset/Best/history and the
// last run from the module cache. This also runs on first mount, so switching
// docking windows and coming back restores the run baseline instead of greying
// out Reset.
function useDesignCacheSync({ design, env }) {
    const lastDesignId = useRef(null);
    useEffect(() => {
        const switched = lastDesignId.current && lastDesignId.current !== design?.id;
        if (switched) { discardRun(env); env.refs.optimizerRef.current = null; }
        lastDesignId.current = design?.id ?? null;
        hydrateFromCache(env, design?.id);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Store the run on screen as the last run of the design it belongs to. The
// owner changes only when a design's own run is put on screen, so a readout
// still showing the previous design is never stored under the next one.
function useRunRecord({ runOwner, run, env }) {
    useEffect(() => {
        writeRefinement(runOwner, { lastRun: { ...run, lastBest: env.refs.lastBestRef.current } });
    }, [runOwner, run]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Evaluate operands for the merit table display.
//
// Between runs the whole display is derived here. During a run the loop owns
// MF and OMF (it reports the optimizer's own values), so only the per-operand
// values are refreshed, from the sampled design at the live-preview cadence.
// That evaluation is a fraction of a millisecond for a normal operand set, so
// the table tracks the run without competing with it for the main thread.
function useOperandDisplaySync({ design, operands, running, env }) {
    const { design: liveDesign, preview } = useLiveDesign();

    useEffect(() => {
        if (running) return;
        evaluateDisplay(env, design, operands);
    }, [operands, design, running]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!running || !preview) return;
        const result = computeOperandDisplay(liveDesign, operands);
        if (!result) return;
        env.setters.setComputed(result.computed);
        env.setters.setEvaluationErrors(result.errors || []);
    }, [running, preview, liveDesign, operands]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useWorkerLifecycle({ env, running, beginOptimization, endOptimization }) {
    const stopOpt = useCallback(() => stopRun(env), []); // eslint-disable-line react-hooks/exhaustive-deps

    // Stop the run when this component unmounts (docking-window/tab switch).
    // Without this, its workers keep reporting to the unmounted closure, where
    // runningRef.current is still true, and push transient design changes in
    // the background while the remounted instance shows a stale "Run" button.
    // A run can't be resumed (see sessionState.js), so the correct behavior is
    // a clean stop; the design keeps the last applied thicknesses and
    // Reset/history persist via the cache.
    useEffect(() => () => {
        env.refs.runningRef.current = false;
        env.refs.activeRunRef.current = null;
        abortRun(env);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // While the DLS is running, flip the global isOptimizing flag so live-
    // preview consumers (OpticalEvaluation autoCalc) throttle their main-thread
    // TMM + chart redraw. Effect-cleanup also fires on unmount, so a tab
    // switch mid-run won't leave the counter stuck.
    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    return { stopOpt };
}

/**
 * F5 runs, or stops a run. A number box applies its value only when it is
 * left, so a run first takes the focus off whatever has it. The box applies
 * its value as it loses focus, and its setter writes the run's ref at once
 * (writeThrough), so the run starts with what was typed, as after a click on
 * Run.
 */
export function runShortcut(event, { running, runOpt, stopOpt }, doc = globalThis.document) {
    if (event.key !== 'F5') return;
    event.preventDefault();
    if (running) { stopOpt(); return; }
    doc?.activeElement?.blur?.();
    runOpt();
}

/** A setter that writes `ref` as well as the state, so a run reads the value at once. */
export const writeThrough = (ref, set) => (value) => { ref.current = value; set(value); };

// Run dispatcher (Run button + F5) plus Stop/Reset/Best/history-restore.
function useRunActions({ env, running, buildCtx, savedDesign, updateDesign, stopOpt }) {
    const runOpt = useCallback(() => startRun(env, buildCtx), [buildCtx]); // eslint-disable-line react-hooks/exhaustive-deps
    const resetOpt = useCallback(() => performReset(env, savedDesign, updateDesign), [savedDesign, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const bestOpt = useCallback(() => applyBest(env, updateDesign), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleRestore = useCallback((entry) => restoreHistoryEntry(env, entry, updateDesign), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onKey = e => runShortcut(e, { running, runOpt, stopOpt });
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running, runOpt, stopOpt]);

    return { runOpt, resetOpt, bestOpt, handleRestore };
}

// Merit-operand table edit handlers (shared design.meritOperands).
function useOperandHandlers({ env, updateDesign, selectedId }) {
    const handleEdit = useCallback((id, key, value) => applyEdit(env, updateDesign, { id, key, value }), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleEditMany = useCallback((edits) => applyEditMany(env, updateDesign, edits), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleAdd = useCallback((data, atIndex) => applyAdd(env, updateDesign, data, atIndex), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleInsertAt = useCallback((insertIdx, source) => applyInsertAt(env, updateDesign, insertIdx, source), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleDuplicate = useCallback((ids) => applyDuplicate(env, updateDesign, ids), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleDelete = useCallback((ids) => applyDelete(env, updateDesign, ids), [updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleMoveUp = useCallback(() => applyMove(env, updateDesign, selectedId, -1), [selectedId, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleMoveDown = useCallback(() => applyMove(env, updateDesign, selectedId, +1), [selectedId, updateDesign]); // eslint-disable-line react-hooks/exhaustive-deps
    return { handleEdit, handleEditMany, handleAdd, handleInsertAt, handleDuplicate, handleDelete, handleMoveUp, handleMoveDown };
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useRefinement({ t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();
    const operands = design?.meritOperands || [];

    const [selectedId,  setSelectedId]  = useState(null);
    const [computed,    setComputed]    = useState([]);
    const [evaluationErrors, setEvaluationErrors] = useState([]);
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
    const [selectedHistoryId, setSelectedHistoryId] = useState(null);
    // The design whose run the readout and trend show (useRunRecord).
    const [runOwner,    setRunOwner]    = useState(null);
    const histRunCount  = useRef(0);

    // Method selector (persisted as a global app setting) + multi-start params.
    const [method,      setMethod]      = useState(loadMethod);
    const [nRestarts,   setNRestarts]   = useState(DEFAULT_SETTINGS.nRestarts);
    const [perturbPct,  setPerturbPct]  = useState(DEFAULT_SETTINGS.perturbPct);
    const [restartIdx,  setRestartIdx]  = useState(0);
    // Max iterations: defaults to the method's natural budget (defaultMaxIter);
    // the run still stops early at convergence, this is just the cap. Resets to
    // the method default when the method changes; the user can override per run.
    const [maxIter,     setMaxIter]     = useState(() => defaultMaxIter(loadMethod()));
    // Seed of the stochastic methods, null to draw a fresh one; a run shows the
    // seed it drew here.
    const [seed,        setSeed]        = useState(null);

    const optimizerRef    = useRef(null);
    const runningRef      = useRef(false);
    const abortRef        = useRef(null);   // AbortController of the run in flight
    const activeRunRef    = useRef(null);   // the latest run started (windowRun.js)
    const lastBestRef     = useRef(null);   // { mfBest, frontLayers, backLayers } for Best after Stop
    const baselineRef     = useRef(false);  // run baseline/checkpoint already taken this session
    const operandsRef     = useRef(operands);
    const designRef       = useRef(design);
    const updateDesignRef = useRef(updateDesign);

    const methodRef      = useRef(method);
    const nRestartsRef   = useRef(DEFAULT_SETTINGS.nRestarts);
    const perturbPctRef  = useRef(DEFAULT_SETTINGS.perturbPct);
    const maxIterRef     = useRef(maxIter);
    const seedRef        = useRef(seed);
    useEffect(() => { seedRef.current = seed; }, [seed]);
    useEffect(() => { methodRef.current = method; saveMethod(method); }, [method]);
    useEffect(() => { nRestartsRef.current  = nRestarts;  }, [nRestarts]);
    useEffect(() => { perturbPctRef.current = perturbPct; }, [perturbPct]);
    useEffect(() => { maxIterRef.current = maxIter; }, [maxIter]);
    // When the method changes, snap Max iterations back to that method's natural budget.
    useEffect(() => { setMaxIter(defaultMaxIter(method)); }, [method]);

    const checkpointRef = useRef(checkpoint);

    useEffect(() => { operandsRef.current     = operands;      }, [operands]);
    useEffect(() => { designRef.current       = design;        }, [design]);
    useEffect(() => { updateDesignRef.current = updateDesign;  }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;    }, [checkpoint]);
    useEffect(() => { setSelectedHistoryId(null); }, [design?.id]);
    useEffect(() => { if (running) setSelectedHistoryId(null); }, [running]);

    // `env` bundles the refs and state setters the extracted step functions and
    // the runner `ctx` need. Rebuilt each render, but every property inside is
    // itself a stable ref or setState function, so callbacks that close over it
    // stay correct across renders regardless of which render's `env` they hold.
    const refs = {
        runningRef, designRef, operandsRef, maxIterRef,
        nRestartsRef, perturbPctRef, checkpointRef, updateDesignRef, optimizerRef,
        baselineRef, lastBestRef, abortRef, activeRunRef, histRunCount, seedRef,
    };
    const setters = {
        setMf, setMfBest, setMfInitial, setOmf, setOmfBest, setOmfInitial,
        setIter, setMfHistory, setRunning, setCanReset, setRestartIdx, setStopReason,
        setSelectedId, setSavedDesign, setHistEntries, setComputed, setEvaluationErrors, setSeed,
        setRunOwner,
    };
    const env = { refs, setters, methodRef };

    useDesignCacheSync({ design, env });
    const run = useMemo(() => ({ iter, stopReason, mfHistory, mfBest, mfInitial, omfBest, omfInitial }),
        [iter, stopReason, mfHistory, mfBest, mfInitial, omfBest, omfInitial]);
    useRunRecord({ runOwner, run, env });
    useOperandDisplaySync({ design, operands, running, env });

    const { stopOpt } = useWorkerLifecycle({ env, running, beginOptimization, endOptimization });

    const buildCtx = useCallback(() => buildRunCtx(env, t), [t]); // eslint-disable-line react-hooks/exhaustive-deps

    const { runOpt, resetOpt, bestOpt, handleRestore } = useRunActions({
        env, running, buildCtx, savedDesign, updateDesign, stopOpt,
    });

    const handleHistorySelect = useCallback((entry) => {
        if (entry?.mfHistory?.length)
            setSelectedHistoryId(current => current === entry.id ? null : entry.id);
    }, []);
    const handleHistoryRestore = useCallback((entry) => {
        if (entry?.mfHistory?.length) setSelectedHistoryId(entry.id);
        handleRestore(entry);
    }, [handleRestore]);

    const {
        handleEdit, handleEditMany, handleAdd, handleInsertAt, handleDuplicate, handleDelete, handleMoveUp, handleMoveDown,
    } = useOperandHandlers({ env, updateDesign, selectedId });

    const selectedHistory = histEntries.find(entry => entry.id === selectedHistoryId);
    const plotHistory = selectedHistory?.mfHistory?.length ? selectedHistory.mfHistory : mfHistory;

    return {
        design, operands, selectedId, setSelectedId, computed, evaluationErrors,
        running, iter, mf, mfBest, mfInitial, omf, omfBest, canReset,
        method, nRestarts, perturbPct, restartIdx, maxIter, stopReason, seed,
        mfHistory, plotHistory, histEntries, selectedHistoryId,
        onRun: runOpt, onStop: stopOpt, onReset: resetOpt, onBest: bestOpt,
        onMethod: setMethod, onNRestarts: writeThrough(nRestartsRef, setNRestarts),
        onPerturbPct: writeThrough(perturbPctRef, setPerturbPct), onMaxIter: writeThrough(maxIterRef, setMaxIter),
        onSeed: writeThrough(seedRef, setSeed),
        onEdit: handleEdit, onEditMany: handleEditMany, onAdd: handleAdd, onInsertAt: handleInsertAt, onDuplicate: handleDuplicate,
        onDelete: handleDelete, onMoveUp: handleMoveUp, onMoveDown: handleMoveDown,
        onSelectHistory: handleHistorySelect, onRestore: handleHistoryRestore,
    };
}
