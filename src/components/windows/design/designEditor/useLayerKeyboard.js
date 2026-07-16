import { useTableShortcuts } from '../../../../hooks/useTableShortcuts.js';

// Display-index insert/delete/duplicate for one side's layer list, wired to
// Insert / Shift+Insert / Delete / Ctrl+D (see useTableShortcuts). All indices
// the caller deals with are DISPLAY-ORDER indices; the mapping to underlying
// array splice positions accounts for the front-side reverse (front is shown
// substrate-first).
function displayToUnderlying(reversed, layersLength, di) {
    return reversed ? layersLength - 1 - di : di;
}

function insertAtDisplayPos({ di, below, layers, side, reversed, setSelectedId, containerRef, insertLayerAt }) {
    if (layers.length === 0) {
        const newId = insertLayerAt(side, 0, null);
        if (newId) setSelectedId(newId);
        containerRef.current?.focus();
        return;
    }
    const clamped = (di != null && di >= 0 && di < layers.length) ? di : 0;
    const underlyingIdx = displayToUnderlying(reversed, layers.length, clamped);
    // "Above" in DISPLAY order maps to:
    //   reversed     → splice AFTER focused in underlying (idx+1)
    //   not reversed → splice BEFORE focused in underlying (idx)
    // "Below" in display flips that.
    let splicePos;
    if (below) splicePos = reversed ? underlyingIdx : underlyingIdx + 1;
    else       splicePos = reversed ? underlyingIdx + 1 : underlyingIdx;
    const source = layers[underlyingIdx];
    const newId = insertLayerAt(side, splicePos, source);
    if (newId) setSelectedId(newId);
    containerRef.current?.focus();
}

function deleteAtDisplayPos({ di, layers, side, reversed, displayedLayers, setSelectedId, removeLayerAt }) {
    if (di == null || di < 0 || di >= layers.length) return;
    const underlyingIdx = displayToUnderlying(reversed, layers.length, di);
    const ok = removeLayerAt(side, underlyingIdx);
    if (!ok) return;
    // Re-focus the row above (or below if was first). All in display order.
    const newLen = layers.length - 1;
    if (newLen <= 0) { setSelectedId(null); return; }
    const newDi = Math.min(di, newLen - 1);
    const remainingDisplay = displayedLayers.filter((_, i) => i !== di);
    const nextId = remainingDisplay[newDi]?.id;
    if (nextId) setSelectedId(nextId);
    else setSelectedId(null);
}

function duplicateAtDisplayPos({ di, layers, side, reversed, setSelectedId, containerRef, duplicateLayerAt }) {
    if (di == null || di < 0 || di >= layers.length) return;
    const underlyingIdx = displayToUnderlying(reversed, layers.length, di);
    const newId = duplicateLayerAt(side, underlyingIdx);
    if (newId) setSelectedId(newId);
    containerRef.current?.focus();
}

const isLayerLocked = (row) => !!(row && row.locked);

export function useLayerKeyboard({ layers, side, reversed, displayedLayers,
    selectedId, setSelectedId, containerRef,
    insertLayerAt, removeLayerAt, duplicateLayerAt }) {

    const selectedDisplayIdx = selectedId
        ? displayedLayers.findIndex(l => l.id === selectedId) : -1;

    return useTableShortcuts({
        focusIdx: selectedDisplayIdx,
        rows: displayedLayers,
        isLocked: isLayerLocked,
        onInsertAbove: (i) => insertAtDisplayPos({ di: i, below: false, layers, side, reversed, setSelectedId, containerRef, insertLayerAt }),
        onInsertBelow: (i) => insertAtDisplayPos({ di: i, below: true,  layers, side, reversed, setSelectedId, containerRef, insertLayerAt }),
        onDelete:      (i) => deleteAtDisplayPos({ di: i, layers, side, reversed, displayedLayers, setSelectedId, removeLayerAt }),
        onDuplicate:   (i) => duplicateAtDisplayPos({ di: i, layers, side, reversed, setSelectedId, containerRef, duplicateLayerAt }),
    });
}
