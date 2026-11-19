const { useCallback, useEffect, useRef, useState } = React;

const DRAG_THRESHOLD_PX = 4;
// A row scrolled out of view cannot be pointed at. Holding the pointer near an
// edge scrolls the list to bring the rest within reach; without it a layer can
// only be moved as far as the visible rows.
const EDGE_ZONE_PX = 28;
const MAX_SCROLL_PX_PER_FRAME = 18;

function edgeScrollStep(container, pointerY) {
    if (!container) return 0;
    const bounds = container.getBoundingClientRect();
    const above = bounds.top + EDGE_ZONE_PX - pointerY;
    if (above > 0) return -MAX_SCROLL_PX_PER_FRAME * Math.min(1, above / EDGE_ZONE_PX);
    const below = pointerY - (bounds.bottom - EDGE_ZONE_PX);
    if (below > 0) return MAX_SCROLL_PX_PER_FRAME * Math.min(1, below / EDGE_ZONE_PX);
    return 0;
}

function createRowGhost(row, c, count, pointerX, pointerY) {
    // The row's own document, not the global one: in a Design Editor torn off
    // into its own window the ghost would otherwise be built in the main window
    // and never appear under the cursor.
    const doc = row.ownerDocument;
    const bounds = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.removeAttribute('data-layer-id');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
        position: 'fixed', left: '0', top: '0', zIndex: '10000',
        width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0',
        display: 'none', pointerEvents: 'none', opacity: '0.96',
        backgroundColor: c.panel, border: `1px solid ${c.accent}`,
        borderRadius: '4px', boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
        willChange: 'transform',
    });
    if (count > 1) {
        const badge = doc.createElement('span');
        badge.textContent = `×${count}`;
        Object.assign(badge.style, {
            position: 'absolute', right: '5px', top: '3px', zIndex: '1',
            padding: '1px 5px', borderRadius: '8px', fontSize: '10px',
            color: c.bg, background: c.accent,
        });
        ghost.appendChild(badge);
    }
    doc.body.appendChild(ghost);
    return {
        element: ghost,
        sourceRow: row,
        sourceOpacity: row.style.opacity,
        offsetX: pointerX - bounds.left,
        offsetY: pointerY - bounds.top,
    };
}

function moveGhost(visual, pointerX, pointerY) {
    const x = pointerX - visual.offsetX;
    const y = pointerY - visual.offsetY;
    visual.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function activateGhost(visual) {
    visual.element.style.display = 'flex';
    visual.sourceRow.style.opacity = '0.28';
    visual.sourceRow.ownerDocument.documentElement.classList.add('tf-layer-dragging');
}

function releaseGhost(visual) {
    if (!visual) return;
    visual.element.remove();
    visual.sourceRow.style.opacity = visual.sourceOpacity;
    visual.sourceRow.ownerDocument.documentElement.classList.remove('tf-layer-dragging');
}

// The row under the pointer that a drag of `ids` may drop on, and the side of
// it the pointer is on; null over no row, or over a row being dragged.
function dropTargetAt(doc, x, y, ids) {
    const row = doc.elementFromPoint(x, y)?.closest?.('[data-layer-id]');
    const id = row?.dataset?.layerId;
    if (!id || ids.includes(id)) return null;
    const bounds = row.getBoundingClientRect();
    return { id, position: y < bounds.top + bounds.height / 2 ? 'before' : 'after' };
}

// Scrolls `container` a step toward the edge the pointer is held near; true
// when it moved.
function scrollTowardEdge(container, pointerY) {
    const step = edgeScrollStep(container, pointerY);
    if (!step) return false;
    const before = container.scrollTop;
    container.scrollTop += step;
    return container.scrollTop !== before;
}

const sameTarget = (a, b) => a?.id === b.id && a.position === b.position;

// One drag of the rows `ids` that began on `sourceRow` with `event`: its ghost,
// its listeners on the row's own window, and the drop on release. `drag` holds
// the drag in progress (a ref), and `reorder(target, ids)` carries out a drop,
// selecting the rows when the reorder moved them.
function beginRowDrag({ sourceRow, ids, event, c, scrollRef, drag, setDropIndicator, reorder }) {
    // The row's own window and document: in a Design Editor torn off into its
    // own window the pointer events and the hit test belong to it, not to the
    // main window.
    const doc = sourceRow.ownerDocument;
    const view = doc.defaultView;
    const visual = createRowGhost(sourceRow, c, ids.length, event.clientX, event.clientY);
    moveGhost(visual, event.clientX, event.clientY);
    const state = {
        ids, visual, startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY,
        active: false, target: null, cleanup: null, scrollFrame: 0,
    };
    drag.current = state;

    const refreshDropTarget = () => {
        const target = dropTargetAt(doc, state.lastX, state.lastY, ids);
        state.target = target;
        setDropIndicator(current => (target && !sameTarget(current, target) ? target : (target ? current : null)));
    };

    // Runs while the pointer is held near an edge, so the list keeps
    // scrolling without needing further pointer movement to drive it.
    const scrollStep = () => {
        state.scrollFrame = 0;
        if (!state.active) return;
        if (scrollTowardEdge(scrollRef?.current, state.lastY)) refreshDropTarget();
        state.scrollFrame = view.requestAnimationFrame(scrollStep);
    };

    const activate = () => {
        state.active = true;
        activateGhost(visual);
        state.scrollFrame = view.requestAnimationFrame(scrollStep);
    };

    const handleMove = moveEvent => {
        const moved = Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) >= DRAG_THRESHOLD_PX;
        if (!state.active && !moved) return;
        if (!state.active) activate();
        moveEvent.preventDefault();
        state.lastX = moveEvent.clientX;
        state.lastY = moveEvent.clientY;
        moveGhost(visual, moveEvent.clientX, moveEvent.clientY);
        refreshDropTarget();
    };

    const cleanup = () => {
        view.removeEventListener('pointermove', handleMove);
        view.removeEventListener('pointerup', handleUp);
        view.removeEventListener('pointercancel', handleCancel);
        if (state.scrollFrame) view.cancelAnimationFrame(state.scrollFrame);
        state.scrollFrame = 0;
        releaseGhost(visual);
        if (drag.current === state) drag.current = null;
        setDropIndicator(null);
    };

    const handleUp = () => {
        const target = state.target;
        cleanup();
        if (state.active && target) reorder(target, ids);
    };
    const handleCancel = () => cleanup();
    state.cleanup = cleanup;

    view.addEventListener('pointermove', handleMove, { passive: false });
    view.addEventListener('pointerup', handleUp, { once: true });
    view.addEventListener('pointercancel', handleCancel, { once: true });
}

/**
 * Pointer-driven sortable rows with a full-row drag ghost and one commit on
 * drop. The handle sits on the row number, so a drag selects the rows it moves
 * as rows, with `selectRows(ids, focusId)`.
 */
export function useLayerDrag({
    displayedLayers, selectedIds, scrollRef,
    reorderLayers, reversed, side, selectRows, c,
}) {
    const dragRef = useRef(null);
    const [dropIndicator, setDropIndicator] = useState(null);

    useEffect(() => () => dragRef.current?.cleanup?.(), []);

    const onPointerDownDrag = useCallback((id, event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current?.cleanup?.();

        const ids = selectedIds.has(id)
            ? displayedLayers.filter(layer => selectedIds.has(layer.id)).map(layer => layer.id)
            : [id];
        selectRows(ids, id);

        const sourceRow = event.currentTarget.closest('[data-layer-id]');
        if (!sourceRow) return;
        const reorder = (target, moved) => {
            if (reorderLayers(side, moved, target.id, target.position, reversed)) selectRows(moved, moved[moved.length - 1]);
        };
        beginRowDrag({ sourceRow, ids, event, c, scrollRef, drag: dragRef, setDropIndicator, reorder });
    }, [c, displayedLayers, reorderLayers, reversed, scrollRef, selectRows, selectedIds, side]);

    return { dropIndicator, onPointerDownDrag };
}
