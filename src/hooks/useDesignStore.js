/**
 * The open designs and their undo/redo history.
 *
 * Holds every design the session has in memory, which one is active, which of
 * them differ from their last save on disk, and the per-design past/future
 * stacks. Edits arrive here from DesignContext; nothing in this file writes a
 * .tfs, only the debounced localStorage session.
 *
 * Each operation below takes the same `s`: the refs the stacks live in and the
 * state setters. The stacks are mutated in place and the setters run in one
 * step, so an edit cannot be seen half-applied.
 */

import { makeDefaultDesign } from '../state/DesignContext.js';
import { updateDirtyDesigns } from '../utils/io/projectPersistence.js';
import { sessionEntryFor } from '../utils/io/sessionMerge.js';
import { writeSessionEntry, MAX_HISTORY } from '../utils/io/appSession.js';
import { appendDistinctSnapshot } from '../utils/history.js';

const { useState, useEffect, useRef, useCallback } = React;

// The design's stacks, created empty the first time it is edited.
function historyFor(s, id) {
    if (!s.historyRef.current[id]) s.historyRef.current[id] = { past: [], future: [] };
    return s.historyRef.current[id];
}

/**
 * An explicit undo checkpoint. Long-running tools (Refinement / Needle /
 * Gradual Evolution) push ONE of these before they start, then stream their
 * per-iteration previews as transient changes, so a single Ctrl+Z returns to
 * the pre-run state instead of stepping through thousands of sub-nm
 * micro-iterations.
 */
function pushCheckpoint(s, id) {
    const hist = historyFor(s, id);
    const cur  = s.designsRef.current[id];
    if (!cur) return;
    hist.past   = appendDistinctSnapshot(hist.past, cur, MAX_HISTORY);
    hist.future = [];
    s.bumpHistory();
    s.scheduleSessionSave(id);
}

/**
 * A design change from DesignContext: push to the per-design undo history and
 * save the session. No disk write.
 *
 * `opts.transient` updates the working state only and creates no history entry;
 * that is what a live optimization preview is, and it pairs with a checkpoint
 * pushed before the run. `opts.compareDirty` compares a transient change with
 * the disk copy all the same, for an edit that can end where it began, such as
 * a thickness stepped up and back down.
 */
function applyDesignChange(s, id, newDesign, opts) {
    const hist = historyFor(s, id);
    const transient = !!(opts && opts.transient);
    // Functional updater so we always read the most-recent state, even when
    // several changes arrive before a React render cycle completes.
    s.setDesigns(d => {
        const prev = d[id];
        if (!transient && prev && prev !== newDesign) {
            hist.past = appendDistinctSnapshot(hist.past, prev, MAX_HISTORY);
            hist.future = [];
        }
        return { ...d, [id]: newDesign };
    });
    // A committed edit always grows `past`; bump so the History window
    // re-renders. (Transient previews don't touch the stacks.)
    if (!transient) s.bumpHistory();
    // A live optimization preview is always dirty vs the last disk save — skip
    // the per-iteration canonical compare and just flag it. The exact compare
    // runs on committed edits, undo, and redo.
    if (transient && !opts.compareDirty) s.setDirtyDesigns(d => (d[id] ? d : { ...d, [id]: true }));
    else s.recomputeDirty(id, newDesign);
    s.scheduleSessionSave(id);
}

// Make `target` the present and leave the stacks as `stacks` describes them.
// Undo, redo and a jump differ only in where they cut the timeline.
function moveHistory(s, id, target, stacks) {
    const hist = s.historyRef.current[id];
    hist.past   = stacks.past;
    hist.future = stacks.future;
    s.setDesigns(d => ({ ...d, [id]: target }));
    s.recomputeDirty(id, target);
    s.bumpHistory();
    s.scheduleSessionSave(id);
}

function undoStep(s, id) {
    const h = s.historyRef.current[id];
    if (!h?.past?.length) return;
    const present = s.designsRef.current[id];
    moveHistory(s, id, h.past[h.past.length - 1], {
        past:   h.past.slice(0, -1),
        future: [present, ...(h.future || [])].slice(0, MAX_HISTORY),
    });
}

function redoStep(s, id) {
    const h = s.historyRef.current[id];
    if (!h?.future?.length) return;
    const present = s.designsRef.current[id];
    moveHistory(s, id, h.future[0], {
        past:   [...(h.past || []), present].slice(-MAX_HISTORY),
        future: h.future.slice(1),
    });
}

// Jump to an arbitrary point in the timeline (History window).
// timeline = [...past, present, ...future];  index 0 = oldest.
function jumpTo(s, id, targetIndex) {
    const h = s.historyRef.current[id];
    if (!h) return;
    const past    = h.past   || [];
    const future  = h.future || [];
    const timeline = [...past, s.designsRef.current[id], ...future];
    const i = Math.max(0, Math.min(timeline.length - 1, targetIndex | 0));
    if (i === past.length) return;
    moveHistory(s, id, timeline[i], {
        past:   timeline.slice(0, i),
        future: timeline.slice(i + 1),
    });
}

export function useDesignStore() {
    const [designs,        setDesigns]        = useState({});
    const [activeDesignId, setActiveDesignId] = useState(null);
    const [dirtyDesigns,   setDirtyDesigns]   = useState({});
    // Bumped whenever the past/future stacks change (checkpoint / undo / redo /
    // jump). The History window re-renders off this; the "present" entry moves
    // with `designs` state, so transient previews need no bump.
    const [historyVersion, setHistoryVersion] = useState(0);
    const bumpHistory = useCallback(() => setHistoryVersion(v => (v + 1) % 1e9), []);

    const designsRef      = useRef({});   // current in-memory designs
    const historyRef      = useRef({});   // { [id]: { past: [...], future: [...] } }
    const diskDesignsRef  = useRef({});   // last-saved-to-disk snapshot per id (dirty baseline)
    const sessionTimerRef = useRef(null); // debounce for session save
    const sessionDueRef   = useRef(new Set()); // designs changed since the last session save

    useEffect(() => { designsRef.current = designs; }, [designs]);

    // ── Session save (debounced 500 ms) ────────────────────────────────────────
    // Persists the working copy of each design that changed, with its undo/redo
    // history, so unsaved edits and Ctrl+Z / Ctrl+Y survive an app restart. Only
    // the designs named since the last save are written; the others' entries
    // are already current. A design is named again when its file is saved or
    // renamed, since its entry records which file it started from.
    const scheduleSessionSave = useCallback((id) => {
        if (id) sessionDueRef.current.add(id);
        clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = setTimeout(() => {
            const due = [...sessionDueRef.current];
            sessionDueRef.current.clear();
            for (const dueId of due) {
                writeSessionEntry(dueId, sessionEntryFor(
                    designsRef.current[dueId], historyRef.current[dueId], diskDesignsRef.current[dueId]));
            }
        }, 500);
    }, []);

    // Designs gone from the project tree leave the store, their history and the
    // session with them; otherwise a deleted design would stay in the session
    // for good.
    const dropDesigns = useCallback((ids) => {
        setDesigns(prev => {
            const next = { ...prev };
            ids.forEach(id => delete next[id]);
            return next;
        });
        ids.forEach(id => {
            delete historyRef.current[id];
            sessionDueRef.current.delete(id);
            writeSessionEntry(id, null);
        });
        bumpHistory();
    }, [bumpHistory]);

    // Dirty = working design differs (canonically) from the last disk save.
    // Re-evaluated on every change so that undoing back to the saved state
    // correctly clears the ● indicator.
    const recomputeDirty = useCallback((id, design) => {
        setDirtyDesigns(d => updateDirtyDesigns(d, id, design, diskDesignsRef.current[id]));
    }, []);

    const s = useRef({});
    s.current = {
        designsRef, historyRef, setDesigns, setDirtyDesigns,
        bumpHistory, scheduleSessionSave, recomputeDirty,
    };

    const handleDesignChange = useCallback(
        (id, newDesign, opts) => applyDesignChange(s.current, id, newDesign, opts), []);
    const pushCheckpointFor = useCallback((id) => {
        const tid = id ?? activeDesignId;
        if (tid) pushCheckpoint(s.current, tid);
    }, [activeDesignId]);
    const undo = useCallback(() => {
        if (activeDesignId) undoStep(s.current, activeDesignId);
    }, [activeDesignId]);
    const redo = useCallback(() => {
        if (activeDesignId) redoStep(s.current, activeDesignId);
    }, [activeDesignId]);
    const jumpToHistory = useCallback((targetIndex) => {
        if (activeDesignId) jumpTo(s.current, activeDesignId, targetIndex);
    }, [activeDesignId]);

    // History view for the active design (consumed by the History window).
    const historyView = React.useMemo(() => {
        const h = activeDesignId ? historyRef.current[activeDesignId] : null;
        const past    = h?.past   || [];
        const future  = h?.future || [];
        const present = activeDesignId ? designs[activeDesignId] : null;
        if (!present && past.length === 0 && future.length === 0) {
            return { entries: [], currentIndex: -1 };
        }
        return { entries: [...past, present, ...future], currentIndex: past.length };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDesignId, designs, historyVersion]);

    // The selected design becomes the active one; a design the store has never
    // seen starts from the default.
    const activateDesign = useCallback((item) => {
        setActiveDesignId(item.id);
        setDesigns(prev => (prev[item.id]
            ? prev
            : { ...prev, [item.id]: makeDefaultDesign(item.name, item.id) }));
    }, []);

    // A design that is shown but never written: it is put in the store and made
    // active without reaching the project tree or the disk.
    const showTransientDesign = useCallback((design) => {
        setDesigns(prev => ({ ...prev, [design.id]: design }));
        setActiveDesignId(design.id);
    }, []);

    return {
        designs, setDesigns, designsRef,
        activeDesignId, setActiveDesignId, activateDesign, showTransientDesign,
        dirtyDesigns, setDirtyDesigns, diskDesignsRef,
        historyRef, historyView,
        handleDesignChange, pushCheckpoint: pushCheckpointFor,
        undo, redo, jumpToHistory,
        scheduleSessionSave, dropDesigns,
    };
}
