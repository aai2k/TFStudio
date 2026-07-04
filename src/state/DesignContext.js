/**
 * Shared React context for the active thin-film design.
 *
 * Supports multiple designs keyed by ID (one per project explorer item).
 * All tool windows call useDesign() to read/write the currently active design.
 */

const { createContext, useContext, useState, useCallback } = React;

import { resolveEvalMode } from '../utils/physics/optimizer.js';

// ── Default design factory ─────────────────────────────────────────────────────

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// Monotonic layer-id generator. `l-${Date.now()}` collided when two layers were
// created in the same millisecond (rapid add / addLayer-in-a-loop / duplicate),
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

// ── Provider ───────────────────────────────────────────────────────────────────
//
// Props:
//   activeDesignId  — which design is currently active (string)
//   designs         — { [id]: designObject } external map owned by App
//   onDesignChange  — (id, newDesign) => void   called whenever active design mutates
//
// When activeDesignId changes, the provider switches to that design (creating
// a default one on first access).

export function DesignProvider({ children, activeDesignId, designs, onDesignChange, onCheckpoint, historyView, onJumpToHistory }) {
    // Local fallback: if parent doesn't pass controlled props, manage state internally.
    const [localDesigns, setLocalDesigns] = useState(() => {
        const d = makeDefaultDesign();
        return { [d.id]: d };
    });
    const [localActiveId, setLocalActiveId] = useState(() => {
        const d = Object.values(localDesigns)[0];
        return d.id;
    });

    // Persistent optical-evaluation settings (λ range / step / AOI list).
    // Lifted out of OpticalEvaluation so they survive closing/switching the
    // window — the provider stays mounted at App level for the whole session.
    const [evalParams, setEvalParams] = useState({
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2,
        thetas: [0]
    });

    // Active-optimizer counter. Tool windows (Refinement / Needle / GE) call
    // beginOptimization() on Run and endOptimization() on stop/finalize/unmount.
    // Live-preview consumers (OpticalEvaluation) throttle their main-thread
    // TMM + Plotly redraw while isOptimizing is true so worker progress
    // messages don't saturate the UI thread.
    const [optimizerActive, setOptimizerActive] = useState(0);
    const beginOptimization = useCallback(() => setOptimizerActive(c => c + 1), []);
    const endOptimization   = useCallback(() => setOptimizerActive(c => Math.max(0, c - 1)), []);
    const isOptimizing = optimizerActive > 0;

    const controlled = activeDesignId != null && designs != null && onDesignChange != null;

    const _designs       = controlled ? designs       : localDesigns;
    const _activeId      = controlled ? activeDesignId : localActiveId;
    const _setDesigns    = controlled
        ? (updater, opts) => {
            const next = typeof updater === 'function' ? updater(_designs) : updater;
            Object.entries(next).forEach(([id, d]) => {
                if (_designs[id] !== d) onDesignChange(id, d, opts);
            });
        }
        : setLocalDesigns;

    // Stable fallback design when no item is selected yet
    const fallbackRef = React.useRef(null);
    if (!fallbackRef.current) fallbackRef.current = makeDefaultDesign();

    // Get (or lazily create) the active design
    const design = (_activeId != null && _designs[_activeId])
        ? _designs[_activeId]
        : fallbackRef.current;

    // Evaluation mode is DERIVED from the active design (surfaceMode + mfEvalMode),
    // not an independently-toggled state. This is the single source of truth that
    // every viewer / analysis window follows — see resolveEvalMode() in optimizer.js.
    // It is therefore per-design and persists with the project.
    const evalMode = resolveEvalMode(design);

    // Per-design "user edit" revision counter. Bumped ONLY on non-transient
    // writes (real user/tool edits), NOT on the transient live-preview stream a
    // long-running optimizer emits. Synthesis windows snapshot this at run start
    // and re-read the design if it changed, so a manual thickness edit between
    // runs is picked up instead of optimizing a stale cached stack (M12).
    const userEditSeqRef = React.useRef({});
    const getDesignRevision = useCallback(
        (id) => userEditSeqRef.current[id ?? _activeId] || 0, [_activeId]);

    const _setDesign = useCallback((updater, opts) => {
        // No active design (fresh install, nothing selected → the empty fallback
        // is shown). Editing it has no real target, so ignore the write instead
        // of creating a stray `designs[null]` entry the explorer never shows.
        // The user creates/selects a design first (the explorer invites it).
        if (_activeId == null) return;
        if (!opts || !opts.transient) {
            userEditSeqRef.current[_activeId] = (userEditSeqRef.current[_activeId] || 0) + 1;
        }
        _setDesigns(prev => {
            const current = prev[_activeId] ?? makeDefaultDesign('New Design', _activeId);
            let next      = typeof updater === 'function' ? updater(current) : updater;
            // Backfill missing/duplicate layer ids at this single chokepoint so
            // every layer producer (imports, wizards) is covered. Cheap no-op
            // when ids are already present & unique (the common path).
            if (next) {
                const f = ensureLayerIds(next.frontLayers);
                const b = ensureLayerIds(next.backLayers);
                if (f !== next.frontLayers || b !== next.backLayers) next = { ...next, frontLayers: f, backLayers: b };
            }
            return { ...prev, [_activeId]: next };
        }, opts);
    }, [_activeId, _setDesigns]);

    // ── Design-level updates ──────────────────────────────────────────────────
    //
    // updateDesign(patch, opts):
    //   opts.transient === true → live preview; no undo-history entry is
    //   created (long-running tools call checkpoint() once, then stream
    //   transient updates so a single Ctrl+Z reverts the whole run).

    const updateDesign = useCallback((patch, opts) =>
        _setDesign(prev => ({ ...prev, ...patch }), opts),
    [_setDesign]);

    // Push a single undo checkpoint for the active design (pre-run snapshot).
    const checkpoint = useCallback(() => {
        if (controlled && typeof onCheckpoint === 'function') onCheckpoint(_activeId);
    }, [controlled, onCheckpoint, _activeId]);

    // Undo/redo timeline for the active design + jump-to-state (History window).
    const history = historyView || { entries: [], currentIndex: -1 };
    const jumpToHistory = useCallback((index) => {
        if (controlled && typeof onJumpToHistory === 'function') onJumpToHistory(index);
    }, [controlled, onJumpToHistory]);

    // ── Layer operations (side = 'front' | 'back') ────────────────────────────

    const _layersKey = (side) => side === 'back' ? 'backLayers' : 'frontLayers';

    const addLayer = useCallback((side = 'front', afterIndex) => {
        const key = _layersKey(side);
        _setDesign(prev => {
            const newLayer = { id: newLayerId(), material: 'SiO2', thickness: 100, locked: false };
            const layers = [...prev[key]];
            const idx = afterIndex != null ? afterIndex + 1 : layers.length;
            layers.splice(idx, 0, newLayer);
            return { ...prev, [key]: layers };
        });
    }, [_setDesign]);

    const removeLayer = useCallback((side, layerId) => {
        const key = _layersKey(side);
        _setDesign(prev => ({
            ...prev,
            [key]: prev[key].filter(l => l.id !== layerId)
        }));
    }, [_setDesign]);

    const updateLayer = useCallback((side, layerId, patch) => {
        const key = _layersKey(side);
        _setDesign(prev => ({
            ...prev,
            [key]: prev[key].map(l => l.id === layerId ? { ...l, ...patch } : l)
        }));
    }, [_setDesign]);

    const moveLayer = useCallback((side, layerId, direction) => {
        const key = _layersKey(side);
        _setDesign(prev => {
            const layers = [...prev[key]];
            const idx = layers.findIndex(l => l.id === layerId);
            if (idx < 0) return prev;
            const target = direction === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= layers.length) return prev;
            [layers[idx], layers[target]] = [layers[target], layers[idx]];
            return { ...prev, [key]: layers };
        });
    }, [_setDesign]);

    const duplicateLayer = useCallback((side, layerId) => {
        const key = _layersKey(side);
        _setDesign(prev => {
            const idx = prev[key].findIndex(l => l.id === layerId);
            if (idx < 0) return prev;
            const copy = { ...prev[key][idx], id: newLayerId() };
            const layers = [...prev[key]];
            layers.splice(idx + 1, 0, copy);
            return { ...prev, [key]: layers };
        });
    }, [_setDesign]);

    return React.createElement(DesignContext.Provider, {
        value: {
            design,
            updateDesign,
            checkpoint,
            history, jumpToHistory,
            addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer,
            evalMode,
            evalParams, setEvalParams,
            isOptimizing, beginOptimization, endOptimization,
            getDesignRevision
        }
    }, children);
}
