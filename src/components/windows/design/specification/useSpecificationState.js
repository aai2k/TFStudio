import {
    makeQualifier, evaluateQualifiers, aggregateVerdict, qualifiersToMFOperands,
} from '../../../../utils/synthesis/qualifiers.js';
import { applyPreset } from '../../../../utils/synthesis/qualifierPresets.js';
import { useTableShortcuts } from '../../../../hooks/useTableShortcuts.js';
import { resolveMat } from './model.js';

const { useCallback, useMemo, useRef, useState } = React;

function addQualifierTo(qualifiers, writeQualifiers, setSelectedId, kind) {
    const q = makeQualifier({ kind: kind || 'T_AVG' });
    writeQualifiers([...qualifiers, q]);
    setSelectedId(q.id);
}

function updateQualifierIn(qualifiers, writeQualifiers, id, patch) {
    writeQualifiers(qualifiers.map(q => q.id === id ? { ...q, ...patch } : q));
}

function removeQualifierFrom(qualifiers, writeQualifiers, setSelectedId, id) {
    writeQualifiers(qualifiers.filter(q => q.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
}

// Splice a fresh row at a specific index. `source` (if given) carries
// kind/cmp/channel/direction/level/lambda*/aoi/pol/target as defaults so
// the new row is a near-clone — only target / label still need editing.
function insertQualifierInto({ qualifiers, writeQualifiers, setSelectedId, containerRef }, insertIdx, source) {
    const seed = source
        ? {
            kind: source.kind, cmp: source.cmp,
            channel: source.channel, direction: source.direction,
            level: source.level,
            lambdaStart: source.lambdaStart, lambdaEnd: source.lambdaEnd,
            lambda: source.lambda,
            aoi: source.aoi, pol: source.pol,
            target: source.target,
            edgeSide: source.edgeSide,
            integralId: source.integralId,
            tolerance: source.tolerance,
        }
        : { kind: 'T_AVG' };
    const q = makeQualifier(seed);
    const pos = Math.max(0, Math.min(insertIdx, qualifiers.length));
    const next = [...qualifiers.slice(0, pos), q, ...qualifiers.slice(pos)];
    writeQualifiers(next);
    setSelectedId(q.id);
    containerRef.current?.focus();
    return q.id;
}

// Duplicate by id — each clone placed immediately AFTER its source. Used
// by Ctrl+D shortcut. The toolbar Add/Apply paths are independent.
function duplicateQualifierIn(qualifiers, writeQualifiers, setSelectedId, containerRef, id) {
    const idx = qualifiers.findIndex(q => q.id === id);
    if (idx < 0) return;
    const src = qualifiers[idx];
    const { id: _omit, ...rest } = src;
    const clone = makeQualifier(rest);
    const next = [...qualifiers.slice(0, idx + 1), clone, ...qualifiers.slice(idx + 1)];
    writeQualifiers(next);
    setSelectedId(clone.id);
    containerRef.current?.focus();
}

function buildShortcutHandlers({ qualifiers, insertQualifierAt, removeQualifier, duplicateQualifier, setSelectedId }) {
    return {
        onInsertAbove: (i) => {
            const src = i >= 0 ? qualifiers[i] : null;
            insertQualifierAt(i >= 0 ? i : qualifiers.length, src);
        },
        onInsertBelow: (i) => {
            const src = i >= 0 ? qualifiers[i] : null;
            insertQualifierAt(i >= 0 ? i + 1 : qualifiers.length, src);
        },
        onDelete: (i) => {
            if (i < 0 || i >= qualifiers.length) return;
            const victim = qualifiers[i];
            removeQualifier(victim.id);
            const newLen = qualifiers.length - 1;
            if (newLen <= 0) return;
            const newIdx = Math.min(i, newLen - 1);
            const remaining = qualifiers.filter((_, k) => k !== i);
            if (remaining[newIdx]) setSelectedId(remaining[newIdx].id);
        },
        onDuplicate: (i) => {
            if (i >= 0 && qualifiers[i]) duplicateQualifier(qualifiers[i].id);
        },
    };
}

function generateMFFrom(qualifiers, updateDesign, checkpoint) {
    if (typeof checkpoint === 'function') checkpoint();
    const ops = qualifiersToMFOperands(qualifiers);
    updateDesign({ meritOperands: ops });
}

function applyBuiltinPresetTo(qualifiers, writeQualifiers, checkpoint, presetId, mode) {
    const items = applyPreset(presetId);
    if (items.length === 0) return;
    if (typeof checkpoint === 'function') checkpoint();
    if (mode === 'append')   writeQualifiers([...qualifiers, ...items]);
    else                     writeQualifiers(items);   // replace
}

export function useSpecificationState({ design, updateDesign, checkpoint }) {
    // Source of truth: design.qualifiers (persisted in .tfs).
    const qualifiers = design?.qualifiers || [];

    // Live evaluation
    const results = useMemo(() => {
        if (!design) return [];
        try { return evaluateQualifiers(qualifiers, design, resolveMat); }
        catch { return qualifiers.map(() => ({ value: null, pass: null })); }
    }, [qualifiers, design]);

    const verdict = useMemo(() => aggregateVerdict(results), [results]);

    // ── Mutations ────────────────────────────────────────────────────────────
    const writeQualifiers = useCallback((next) => {
        updateDesign({ qualifiers: next });
    }, [updateDesign]);

    // ── Selection (used by Ins/Del/Ctrl+D keyboard shortcuts) ────────────────
    const [selectedId, setSelectedId] = useState(null);
    const containerRef = useRef(null);
    const selectAndFocus = useCallback((id) => {
        setSelectedId(id);
        containerRef.current?.focus();
    }, []);

    const addQualifier = useCallback((kind) =>
        addQualifierTo(qualifiers, writeQualifiers, setSelectedId, kind),
    [qualifiers, writeQualifiers]);

    const updateQualifier = useCallback((id, patch) =>
        updateQualifierIn(qualifiers, writeQualifiers, id, patch),
    [qualifiers, writeQualifiers]);

    const removeQualifier = useCallback((id) =>
        removeQualifierFrom(qualifiers, writeQualifiers, setSelectedId, id),
    [qualifiers, writeQualifiers]);

    const insertQualifierAt = useCallback((insertIdx, source) =>
        insertQualifierInto({ qualifiers, writeQualifiers, setSelectedId, containerRef }, insertIdx, source),
    [qualifiers, writeQualifiers]);

    const duplicateQualifier = useCallback((id) =>
        duplicateQualifierIn(qualifiers, writeQualifiers, setSelectedId, containerRef, id),
    [qualifiers, writeQualifiers]);

    // ── Wire keyboard shortcuts ──────────────────────────────────────────────
    const selectedIdx = selectedId ? qualifiers.findIndex(q => q.id === selectedId) : -1;
    const { onKeyDown: qualifierKeyDown } = useTableShortcuts({
        focusIdx: selectedIdx,
        rows: qualifiers,
        isLocked: () => false,
        ...buildShortcutHandlers({ qualifiers, insertQualifierAt, removeQualifier, duplicateQualifier, setSelectedId }),
    });

    const generateMF = useCallback(() =>
        generateMFFrom(qualifiers, updateDesign, checkpoint),
    [qualifiers, updateDesign, checkpoint]);

    // ── Built-in preset library ──────────────────────────────────────────────
    const onApplyBuiltinPreset = useCallback((presetId, mode) =>
        applyBuiltinPresetTo(qualifiers, writeQualifiers, checkpoint, presetId, mode),
    [qualifiers, writeQualifiers, checkpoint]);

    return {
        qualifiers, results, verdict,
        selectedId, containerRef, selectAndFocus,
        addQualifier, updateQualifier, removeQualifier, duplicateQualifier,
        writeQualifiers, qualifierKeyDown, generateMF, onApplyBuiltinPreset,
    };
}
