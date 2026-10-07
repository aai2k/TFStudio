/**
 * Shared React context for the active thin-film design.
 *
 * Supports multiple designs keyed by ID (one per project explorer item).
 * All tool windows call useDesign() to read/write the currently active design.
 */

const { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } = React;

import { resolveEvalMode, mirrorLayers } from '../utils/physics/optimizer.js';
import { designMaterialIds, isBuiltinId, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { useCatalogRevision } from '../utils/materials/useCatalogRevision.js';
import { useAnalysisDefaults, useAnalysisSettings } from './AnalysisSettingsContext.js';

// ── Default design factory ─────────────────────────────────────────────────────

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// Monotonic layer-id generator. `l-${Date.now()}` collided when two layers were
// created in the same millisecond (rapid duplicate, or ids backfilled in a loop),
// producing duplicate React keys and making updateLayer/removeLayer/moveLayer
// target the wrong (or both) layers. The counter guarantees uniqueness.
let _layerSeq = 0;
function newLayerId() { return `l-${Date.now()}-${(_layerSeq++).toString(36)}`; }

// Guarantee every layer carries a unique `id`. Layers that arrive from a loaded
// or imported design (e.g. a Zemax COATING.DAT import, where coatToTfLayers
// emits `{material,thickness,locked}` with no id) — or that share an id — would
// otherwise produce React "duplicate/undefined key" warnings in the layer list
// and make updateLayer/removeLayer target the wrong row. Backfills ONLY the
// missing/duplicate ids and preserves the array reference when nothing changes,
// so the optimizer's transient-update streaming (layers already have ids) is a
// no-op and triggers no extra re-render.
export function ensureLayerIds(layers) {
    if (!Array.isArray(layers) || layers.length === 0) return layers;
    const seen = new Set();
    let changed = false;
    const out = layers.map((l) => {
        let id = l && l.id;
        if (id == null || id === '' || seen.has(id)) { id = newLayerId(); changed = true; }
        seen.add(id);
        return (l && l.id === id) ? l : { ...l, id };
    });
    return changed ? out : layers;
}

/**
 * In symmetric mode the two coatings are one physical stack: the same coating on
 * both substrate faces (Macleod §2.6.4), so the stored back layers must remain
 * the mirror of the front. Optimizers derive that mirror on the fly, but save,
 * report and export paths read the stored back stack — if it is left stale, two
 * windows evaluate different designs.
 *
 * The mirror is recomputed whenever the layers or the mode change. Any back
 * stack supplied by the caller is replaced: in this mode the back side is
 * derived, not edited. `mirrorLayers` is deterministic (ids are the front ids
 * under a `b-` prefix), so repeated writes produce identical content.
 */
function withSymmetricBack(previous, next) {
    if (next.surfaceMode !== 'symmetric') return next;
    const unchanged = previous.surfaceMode === 'symmetric'
        && next.frontLayers === previous.frontLayers
        && next.backLayers === previous.backLayers;
    if (unchanged) return next;
    return { ...next, backLayers: mirrorLayers(next.frontLayers || []) };
}

export function makeDefaultDesign(name = 'New Design', id = null) {
    const ts = uid();
    return {
        id: id ?? `design-${ts}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },  // thickness in mm
        exitMedium: 'Air',
        // surfaceMode controls how optimizers see the design:
        //   'front_only'       — back is bare substrate, optimize frontLayers only (default)
        //   'both_independent' — front + back both have design variables, merit on full system
        //   'symmetric'        — backLayers is auto-mirrored from frontLayers (identical
        //                        deposition sequence on both sides); merit on full system
        surfaceMode: 'front_only',
        // mfEvalMode controls how the merit function is SCORED, independently of
        // which side is optimized (only meaningful for front_only / back_only):
        //   'side'  — single-surface MF (legacy default)
        //   'total' — full-system MF (this side + substrate + the fixed other coating)
        // symmetric / both_independent are always full-system regardless.
        mfEvalMode: 'side',
        // A new design starts as a BARE SUBSTRATE (no layers). The user adds
        // layers, imports, or runs synthesis from scratch. (Previously seeded a
        // fixed 2-layer TiO2/SiO2 BBAR; that seed was also what the no-selection
        // fallback served, so a fresh install showed a "phantom" 2-layer design
        // absent from the explorer.)
        frontLayers: [],
        backLayers: [],
        referenceWavelength: 550,
        notes: ''
    };
}

// ── Context ────────────────────────────────────────────────────────────────────

export const DesignContext = createContext(null);

export function useDesign() {
    const ctx = useContext(DesignContext);
    if (!ctx) throw new Error('useDesign must be used inside DesignProvider');
    return ctx;
}

/**
 * The design as windows receive it: the same object until a catalog changes,
 * then a copy, when the design uses a material a catalog can hold.
 *
 * A window computes from material data but keys its memos on the design, and
 * a catalog edit leaves the design as it was, so without this the window keeps
 * the old n,k (and any lookup it memoized) until the design itself is edited.
 * The copy is only what windows see: the store, the undo history and the
 * unsaved state keep the stored object.
 */
function useCatalogFollowing(stored, catalogRevision) {
    return useMemo(() => (
        catalogRevision > 0 && designMaterialIds(stored).some(id => !isBuiltinId(id)) ? { ...stored } : stored
    ), [stored, catalogRevision]);
}

// ── Provider state ─────────────────────────────────────────────────────────────

// The provider's own design, for a parent that passes no designs.
function useLocalDesigns() {
    const [designs, setDesigns] = useState(() => {
        const d = makeDefaultDesign();
        return { [d.id]: d };
    });
    const [activeId] = useState(() => Object.keys(designs)[0]);
    return { designs, setDesigns, activeId };
}

// Where the provider reads and writes designs, and which one is active: the
// parent's, when it owns them, with `activeDesignId` null while none is open;
// otherwise the provider's own.
function useDesignSource({ activeDesignId, designs, onDesignChange }) {
    const local = useLocalDesigns();
    if (designs == null || onDesignChange == null) return { controlled: false, ...local };
    const setDesigns = (updater, opts) => {
        const next = typeof updater === 'function' ? updater(designs) : updater;
        Object.entries(next).forEach(([id, d]) => {
            if (designs[id] !== d) onDesignChange(id, d, opts);
        });
    };
    return { controlled: true, designs, setDesigns, activeId: activeDesignId ?? null };
}

// Active-optimizer counter. Tool windows (Refinement / Needle / GE) call
// beginOptimization() on Run and endOptimization() on stop/finalize/unmount.
// Live-preview consumers (OpticalEvaluation) throttle their main-thread
// TMM + chart redraw while isOptimizing is true so worker progress
// messages don't saturate the UI thread.
function useOptimizerCount() {
    const [optimizerActive, setOptimizerActive] = useState(0);
    const beginOptimization = useCallback(() => setOptimizerActive(c => c + 1), []);
    const endOptimization   = useCallback(() => setOptimizerActive(c => Math.max(0, c - 1)), []);
    return { isOptimizing: optimizerActive > 0, beginOptimization, endOptimization };
}

// Per-design "user edit" revision counter. Bumped ONLY on non-transient
// writes (real user/tool edits), NOT on the transient live-preview stream a
// long-running optimizer emits. Synthesis windows snapshot this at run start
// and re-read the design if it changed, so a manual thickness edit between
// runs is picked up instead of optimizing a stale cached stack (M12).
function useEditRevisions(activeId) {
    const seqRef = React.useRef({});
    const getDesignRevision = useCallback(
        (id) => seqRef.current[id ?? activeId] || 0, [activeId]);
    const countEdit = useCallback((opts) => {
        if (opts && opts.transient) return;
        seqRef.current[activeId] = (seqRef.current[activeId] || 0) + 1;
    }, [activeId]);
    return { getDesignRevision, countEdit };
}

// What a write stores: the updater applied to `current`, with missing or
// duplicate layer ids backfilled at this single chokepoint so every layer
// producer (imports, wizards) is covered, and in symmetric mode the back stack
// derived from the front. The backfill is a cheap no-op when ids are already
// present and unique (the common path).
function storedDesign(current, updater) {
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (!next) return next;
    const f = ensureLayerIds(next.frontLayers);
    const b = ensureLayerIds(next.backLayers);
    const withIds = f !== next.frontLayers || b !== next.backLayers ? { ...next, frontLayers: f, backLayers: b } : next;
    return withSymmetricBack(current, withIds);
}

// The undo checkpoint and the History window's jump, for the active design.
// The placeholder shown while no design is active has no history, so with no
// active design both do nothing.
function useHistoryActions({ hasTarget, activeId, onCheckpoint, onJumpToHistory }) {
    // Push a single undo checkpoint for the active design (pre-run snapshot).
    const checkpoint = useCallback(() => {
        if (hasTarget && typeof onCheckpoint === 'function') onCheckpoint(activeId);
    }, [hasTarget, onCheckpoint, activeId]);
    const jumpToHistory = useCallback((index) => {
        if (hasTarget && typeof onJumpToHistory === 'function') onJumpToHistory(index);
    }, [hasTarget, onJumpToHistory]);
    return { checkpoint, jumpToHistory };
}

// ── Layer operations (side = 'front' | 'back') ────────────────────────────────

// Apply `edit` to one side's layers. An edit that hands back the same array
// leaves the design as it was.
function editLayers(setDesign, side, edit) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    setDesign(prev => {
        const layers = edit(prev[key]);
        return layers === prev[key] ? prev : { ...prev, [key]: layers };
    });
}

// `layers` with one layer swapped with its neighbour above or below, or the
// same array when there is none there.
function movedLayers(layers, layerId, direction) {
    const idx = layers.findIndex(l => l.id === layerId);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= layers.length) return layers;
    const out = [...layers];
    [out[idx], out[target]] = [out[target], out[idx]];
    return out;
}

// `layers` with a copy of one layer inserted below it, or the same array when
// no layer has that id.
function duplicatedLayers(layers, layerId) {
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx < 0) return layers;
    const out = [...layers];
    out.splice(idx + 1, 0, { ...layers[idx], id: newLayerId() });
    return out;
}

function useLayerOperations(setDesign) {
    const removeLayer = useCallback((side, layerId) =>
        editLayers(setDesign, side, layers => layers.filter(l => l.id !== layerId)), [setDesign]);
    const updateLayer = useCallback((side, layerId, patch) =>
        editLayers(setDesign, side, layers => layers.map(l => (l.id === layerId ? { ...l, ...patch } : l))), [setDesign]);
    const moveLayer = useCallback((side, layerId, direction) =>
        editLayers(setDesign, side, layers => movedLayers(layers, layerId, direction)), [setDesign]);
    const duplicateLayer = useCallback((side, layerId) =>
        editLayers(setDesign, side, layers => duplicatedLayers(layers, layerId)), [setDesign]);
    return { removeLayer, updateLayer, moveLayer, duplicateLayer };
}

// ── Provider ───────────────────────────────────────────────────────────────────
//
// Props:
//   activeDesignId:  which design is currently active (string), or null while
//                    the explorer has none selected
//   designs:         { [id]: designObject } external map owned by App
//   onDesignChange:  (id, newDesign) => void, called whenever active design mutates
//
// When activeDesignId changes, the provider switches to that design (creating
// a default one on first access).
//
// A parent that passes `designs` and `onDesignChange` owns the designs whether
// or not one is active. With none active, windows get a placeholder design that
// nothing keeps: every write to it is ignored and `hasActiveDesign` is false, so
// an import or an edit has no design to land in until the user opens one. A
// provider missing either keeps one design of its own and makes it active.

export function DesignProvider({ children, activeDesignId, designs, folders, onDesignChange, onCheckpoint, historyView, onJumpToHistory }) {
    const { controlled, designs: _designs, setDesigns: _setDesigns, activeId: _activeId } =
        useDesignSource({ activeDesignId, designs, onDesignChange });
    const { isOptimizing, beginOptimization, endOptimization } = useOptimizerCount();

    // Whether open windows follow a run as it proceeds (see useLiveDesign).
    // Off, they hold the design as it was when the run started and update once
    // when it stops; ordinary edits still redraw either way. One setting for
    // every window, so the switch reads the same wherever it is shown.
    const [liveUpdate, setLiveUpdate] = useState(true);

    // Stable fallback design when no item is selected yet
    const fallbackRef = React.useRef(null);
    if (!fallbackRef.current) fallbackRef.current = makeDefaultDesign();

    // The design the explorer has selected, and the placeholder shown instead
    // while it has none.
    const activeDesign = _activeId != null ? _designs[_activeId] : null;
    const catalogRevision = useCatalogRevision();
    // A Herpin layer's material, which older files lack, is put back here, where
    // every window reads the design (see withHerpinRecords).
    const repaired = useMemo(() => withHerpinRecords(activeDesign || fallbackRef.current), [activeDesign]);
    const design = useCatalogFollowing(repaired, catalogRevision);

    // Evaluation mode is DERIVED from the active design (surfaceMode + mfEvalMode),
    // not an independently-toggled state. This is the single source of truth that
    // every viewer / analysis window follows — see resolveEvalMode() in optimizer.js.
    // It is therefore per-design and persists with the project.
    const evalMode = resolveEvalMode(design);

    const { getDesignRevision, countEdit } = useEditRevisions(_activeId);

    const _setDesign = useCallback((updater, opts) => {
        // No active design (fresh install, nothing selected → the empty fallback
        // is shown). Editing it has no real target, so ignore the write instead
        // of creating a stray `designs[null]` entry the explorer never shows.
        // The user creates/selects a design first (the explorer invites it).
        if (_activeId == null) return;
        countEdit(opts);
        _setDesigns(prev => ({
            ...prev,
            [_activeId]: storedDesign(prev[_activeId] ?? makeDefaultDesign('New Design', _activeId), updater),
        }), opts);
    }, [_activeId, _setDesigns, countEdit]);

    // ── Design-level updates ──────────────────────────────────────────────────
    //
    // updateDesign(patch, opts):
    //   opts.transient === true → live preview; no undo-history entry is
    //   created (long-running tools call checkpoint() once, then stream
    //   transient updates so a single Ctrl+Z reverts the whole run).

    const updateDesign = useCallback((patch, opts) =>
        _setDesign(prev => ({ ...prev, ...patch }), opts),
    [_setDesign]);

    const { checkpoint, jumpToHistory } = useHistoryActions({
        hasTarget: controlled && _activeId != null, activeId: _activeId, onCheckpoint, onJumpToHistory,
    });
    // Undo/redo timeline for the active design + jump-to-state (History window).
    const history = historyView || { entries: [], currentIndex: -1 };

    const { removeLayer, updateLayer, moveLayer, duplicateLayer } = useLayerOperations(_setDesign);

    return React.createElement(DesignContext.Provider, {
        value: {
            design,
            // Every open design, the project folders they sit in, and which one
            // is active, for a window that reports on several designs at once.
            designs: _designs,
            // Changes whenever a catalog does; a window that computes from
            // several designs at once takes it as a dependency.
            catalogRevision,
            folders: folders || null,
            activeDesignId: _activeId,
            // Whether `design` is a real design rather than the placeholder.
            // The placeholder is a design nothing keeps, so a window that would
            // write to it, an import for instance, has nothing real to write to.
            hasActiveDesign: !!activeDesign,
            updateDesign,
            checkpoint,
            history, jumpToHistory,
            removeLayer, updateLayer, moveLayer, duplicateLayer,
            evalMode,
            isOptimizing, beginOptimization, endOptimization,
            liveUpdate, setLiveUpdate,
            getDesignRevision
        }
    }, children);
}
