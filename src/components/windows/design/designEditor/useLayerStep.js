import { stepTargets } from './layerActions.js';

const { useCallback, useRef } = React;

/**
 * Click handler for the up and down arrows on a layer row, as `(id, delta)`.
 * `reveal(container, id)` scrolls a row into view once it has moved.
 */
export function useLayerStep({
    displayedLayers, selectedIds, selectOnly, moveLayersByStep,
    reversed, side, containerRef, reveal,
}) {
    // A step shifts the rows under a pointer that stays put, so the arrows in
    // the slot just clicked now belong to the neighbour swapped into it. The
    // last step is remembered so that clicking again in place keeps moving the
    // same layers instead of swapping them back.
    const lastStepRef = useRef(null);

    return useCallback((id, delta) => {
        const slot = displayedLayers.findIndex(layer => layer.id === id);
        let ids = stepTargets(id, slot, lastStepRef.current, selectedIds, displayedLayers);
        if (!ids) {
            ids = [id];
            selectOnly(id);
        }
        lastStepRef.current = { slot, ids };
        containerRef.current?.focus();
        if (!moveLayersByStep(side, ids, delta, reversed)) return;
        const lead = delta < 0 ? ids[0] : ids[ids.length - 1];
        requestAnimationFrame(() => reveal(containerRef.current, lead));
    }, [containerRef, displayedLayers, moveLayersByStep, reveal, reversed, selectOnly, selectedIds, side]);
}
