import { useTableShortcuts } from '../../../../hooks/useTableShortcuts.js';
import { isEditingInside } from '../../../../utils/misc/keyChords.js';
import { isPrintableEditKey } from '../../../ui/grid/gridKeys.js';
import { MATERIAL, isCellColumn } from './layerCells.js';

// Display-index insert/delete/duplicate for one side's layer list, wired to
// Insert / Shift+Insert / Delete / Ctrl+D (see useTableShortcuts). All indices
// the caller deals with are DISPLAY-ORDER indices; the mapping to underlying
// array splice positions accounts for the front-side reverse (front is shown
// substrate-first).
function displayToUnderlying(reversed, layersLength, di) {
    return reversed ? layersLength - 1 - di : di;
}

// Insert goes in above the focused row and so follows the rows below it;
// Shift+Insert goes in below and follows the rows above.
function insertAtDisplayPos({ di, below, layers, addLayerAt }) {
    const focused = (di != null && di >= 0 && di < layers.length) ? di : 0;
    addLayerAt(Math.min(below ? focused + 1 : focused, layers.length), below ? 'above' : 'below');
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

// The keys the row shortcuts leave alone. Any key typed on the Material cell
// opens its picker with the key in the search box, as the merit table's Type
// cell does; the shortcuts only start an edit on what a number begins with.
// Escape gives up a rectangle of cells for its focused cell. True when the key
// was taken here.
function cellKey(event, { activeColumn, row, requestCellEdit, collapseCells }) {
    if (event.key === 'Escape') {
        if (!collapseCells()) return false;
        event.preventDefault();
        return true;
    }
    if (activeColumn !== MATERIAL || !row || !isPrintableEditKey(event)) return false;
    event.preventDefault();
    requestCellEdit(row.id, MATERIAL, event.key);
    return true;
}

/**
 * The layer table's keys. `activeColumn` is the focused column: the row
 * number, Material or a thickness unit. `moveColumn(delta, { extend })` moves
 * it sideways, and `focusDisplayIndex(index, { extend })` moves the focused
 * row; with `extend` both stretch the selection instead. Enter, F2 or a typed
 * key opens the focused cell: the material picker, or a thickness editor seeded
 * with what was typed.
 */
export function useLayerKeyboard({ layers, side, reversed, displayedLayers,
    selectedId, setSelectedId, containerRef,
    addLayerAt, removeLayerAt, deleteSelection, duplicateLayerAt,
    activeColumn, moveColumn, collapseCells, focusDisplayIndex, requestCellEdit, onCopy, onPaste }) {

    const selectedDisplayIdx = selectedId
        ? displayedLayers.findIndex(l => l.id === selectedId) : -1;

    const { onKeyDown: shortcutKeyDown } = useTableShortcuts({
        focusIdx: selectedDisplayIdx,
        rows: displayedLayers,
        isLocked: isLayerLocked,
        onInsertAbove: (i) => insertAtDisplayPos({ di: i, below: false, layers, addLayerAt }),
        onInsertBelow: (i) => insertAtDisplayPos({ di: i, below: true,  layers, addLayerAt }),
        onDelete:      (i) => deleteSelection(i)
            || deleteAtDisplayPos({ di: i, layers, side, reversed, displayedLayers, setSelectedId, removeLayerAt }),
        onDuplicate:   (i) => duplicateAtDisplayPos({ di: i, layers, side, reversed, setSelectedId, containerRef, duplicateLayerAt }),
        onMoveFocus: (delta, options) => {
            if (!displayedLayers.length) return;
            const start = selectedDisplayIdx >= 0
                ? selectedDisplayIdx
                : (delta > 0 ? -1 : displayedLayers.length);
            focusDisplayIndex(
                Math.max(0, Math.min(displayedLayers.length - 1, start + delta)),
                options,
            );
        },
        onMoveColumn: moveColumn,
        onActivate: (index, typedChar) => {
            const row = displayedLayers[index >= 0 ? index : 0];
            if (row && isCellColumn(activeColumn)) requestCellEdit(row.id, activeColumn, typedChar);
        },
        onCopy,
        onPaste,
    });

    const onKeyDown = event => {
        const row = displayedLayers[selectedDisplayIdx];
        if (isEditingInside(event) || !cellKey(event, { activeColumn, row, requestCellEdit, collapseCells })) {
            shortcutKeyDown(event);
        }
    };
    return { onKeyDown };
}
