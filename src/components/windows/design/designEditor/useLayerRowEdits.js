const { useCallback } = React;

/**
 * Adding and removing rows of the layer table: + Layer, Insert, the context
 * menu's Insert and Delete, and Delete on a selection. Indices are table rows.
 * `reveal(container, id)` scrolls a row into view.
 */
export function useLayerRowEdits({
    side, reversed, displayedLayers, selectedId, selectedIds, selectOnly,
    addLayerAtDisplayIndex, removeLayers, containerRef, reveal,
}) {
    // `follows` is the side of the new row the stack is built from: 'above' for
    // a row added below another, 'below' for one added above. The new layer is
    // selected, so adding again the same way carries the pattern on.
    const addLayerAt = useCallback((displayIndex, follows) => {
        const id = addLayerAtDisplayIndex(side, displayIndex, { reversed, follows });
        selectOnly(id);
        containerRef.current?.focus();
        requestAnimationFrame(() => reveal(containerRef.current, id));
    }, [addLayerAtDisplayIndex, containerRef, reveal, reversed, selectOnly, side]);

    // + Layer adds below the selected row, or at the bottom of the table.
    const addBelowSelection = useCallback(() => {
        const selected = displayedLayers.findIndex(layer => layer.id === selectedId);
        addLayerAt(selected >= 0 ? selected + 1 : displayedLayers.length, 'above');
    }, [addLayerAt, displayedLayers, selectedId]);

    // Remove `ids` in one update and select the row that takes `targetId`'s place.
    const deleteRows = useCallback((ids, targetId) => {
        if (!ids.length) return;
        const removed = new Set(ids);
        const targetIndex = displayedLayers.findIndex(layer => layer.id === targetId);
        const remaining = displayedLayers.filter(layer => !removed.has(layer.id));
        if (!removeLayers(side, ids)) return;
        const next = remaining[Math.min(Math.max(targetIndex, 0), remaining.length - 1)];
        selectOnly(next?.id || null);
    }, [displayedLayers, removeLayers, selectOnly, side]);

    // Delete with the focused row among several selected removes the selection,
    // all but its locked rows: from the keyboard a lock keeps a row, as it does
    // when the row is alone. False when the focused row is selected on its own.
    const deleteSelection = useCallback(displayIndex => {
        const focused = displayedLayers[displayIndex];
        if (!focused || selectedIds.size < 2 || !selectedIds.has(focused.id)) return false;
        deleteRows(displayedLayers.filter(layer => selectedIds.has(layer.id) && !layer.locked)
            .map(layer => layer.id), focused.id);
        return true;
    }, [deleteRows, displayedLayers, selectedIds]);

    return { addLayerAt, addBelowSelection, deleteRows, deleteSelection };
}
