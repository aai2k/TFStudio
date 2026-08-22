const { useCallback, useEffect, useRef, useState } = React;

const DRAG_THRESHOLD_PX = 4;
// The list is virtualized, so a row outside the viewport has no element to drop
// onto. Holding the pointer near an edge scrolls the list to bring the rest
// within reach; without it a layer can only be moved as far as the visible rows.
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
        const badge = document.createElement('span');
        badge.textContent = `×${count}`;
        Object.assign(badge.style, {
            position: 'absolute', right: '5px', top: '3px', zIndex: '1',
            padding: '1px 5px', borderRadius: '8px', fontSize: '10px',
            color: c.bg, background: c.accent,
        });
        ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
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
    document.documentElement.classList.add('tf-layer-dragging');
}

function releaseGhost(visual) {
    if (!visual) return;
    visual.element.remove();
    visual.sourceRow.style.opacity = visual.sourceOpacity;
    document.documentElement.classList.remove('tf-layer-dragging');
}

/** Pointer-driven sortable rows with a full-row drag ghost and one commit on drop. */
export function useLayerDrag({
    displayedLayers, selectedIds, selectOnly, scrollRef,
    reorderLayers, reversed, side, setSelectedIds, setSelectedId, c,
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
        if (!selectedIds.has(id)) selectOnly(id);

        const sourceRow = event.currentTarget.closest('[data-layer-id]');
        if (!sourceRow) return;
        const visual = createRowGhost(sourceRow, c, ids.length, event.clientX, event.clientY);
        moveGhost(visual, event.clientX, event.clientY);
        const state = {
            ids, visual, startX: event.clientX, startY: event.clientY,
            lastX: event.clientX, lastY: event.clientY,
            active: false, target: null, cleanup: null, scrollFrame: 0,
        };
        dragRef.current = state;

        const refreshDropTarget = () => {
            const row = document.elementFromPoint(state.lastX, state.lastY)
                ?.closest?.('[data-layer-id]');
            const targetId = row?.dataset?.layerId;
            if (!targetId || ids.includes(targetId)) {
                state.target = null;
                setDropIndicator(null);
                return;
            }
            const bounds = row.getBoundingClientRect();
            const position = state.lastY < bounds.top + bounds.height / 2 ? 'before' : 'after';
            state.target = { id: targetId, position };
            setDropIndicator(current => current?.id === targetId && current.position === position
                ? current : { id: targetId, position });
        };

        // Runs while the pointer is held near an edge, so the list keeps
        // scrolling without needing further pointer movement to drive it.
        const scrollStep = () => {
            state.scrollFrame = 0;
            if (!state.active) return;
            const container = scrollRef?.current;
            const step = edgeScrollStep(container, state.lastY);
            if (step) {
                const before = container.scrollTop;
                container.scrollTop += step;
                if (container.scrollTop !== before) refreshDropTarget();
            }
            state.scrollFrame = requestAnimationFrame(scrollStep);
        };

        const handleMove = moveEvent => {
            const distance = Math.hypot(
                moveEvent.clientX - state.startX,
                moveEvent.clientY - state.startY,
            );
            if (!state.active && distance < DRAG_THRESHOLD_PX) return;
            if (!state.active) {
                state.active = true;
                activateGhost(visual);
                state.scrollFrame = requestAnimationFrame(scrollStep);
            }
            moveEvent.preventDefault();
            state.lastX = moveEvent.clientX;
            state.lastY = moveEvent.clientY;
            moveGhost(visual, moveEvent.clientX, moveEvent.clientY);
            refreshDropTarget();
        };

        const cleanup = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleCancel);
            if (state.scrollFrame) cancelAnimationFrame(state.scrollFrame);
            state.scrollFrame = 0;
            releaseGhost(visual);
            if (dragRef.current === state) dragRef.current = null;
            setDropIndicator(null);
        };

        const handleUp = () => {
            const target = state.target;
            cleanup();
            if (state.active && target
                && reorderLayers(side, ids, target.id, target.position, reversed)) {
                setSelectedIds(new Set(ids));
                setSelectedId(ids[ids.length - 1]);
            }
        };
        const handleCancel = () => cleanup();
        state.cleanup = cleanup;

        window.addEventListener('pointermove', handleMove, { passive: false });
        window.addEventListener('pointerup', handleUp, { once: true });
        window.addEventListener('pointercancel', handleCancel, { once: true });
    }, [c, displayedLayers, reorderLayers, reversed, scrollRef, selectOnly, selectedIds,
        setSelectedId, setSelectedIds, side]);

    return { dropIndicator, onPointerDownDrag };
}
