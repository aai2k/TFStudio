/**
 * The bar under a scrolling box, dragged to set how tall the box may grow. The
 * page the box sits on scrolls past it as usual.
 */

import { startDividerDrag } from './dividerDrag.js';

const { createElement: h, useCallback } = React;

/**
 * `boxRef` is the box, sized by its max-height. `onHeightChange` is told the
 * height in px where the bar is dropped; the bar never takes the box below
 * `minHeight`.
 */
export function ResizeBar({ c, boxRef, minHeight, onHeightChange }) {
    const startResize = useCallback((event) => {
        const box = boxRef.current;
        if (!box) return;
        const startY = event.clientY;
        const startHeight = box.getBoundingClientRect().height;
        // See dividerDrag.js for why the drag resizes the box itself.
        startDividerDrag(event, {
            axis: 'v',
            track: (move) => {
                const next = Math.max(minHeight, Math.round(startHeight + move.clientY - startY));
                box.style.maxHeight = `${next}px`;
                return next;
            },
            commit: value => onHeightChange?.(value),
        });
    }, [boxRef, minHeight, onHeightChange]);
    return h('div', {
        onMouseDown: startResize,
        style: {
            height: 5, borderRadius: 2, cursor: 'row-resize',
            backgroundColor: c.border, transition: 'background-color 0.12s',
        },
        onMouseEnter: (hover) => { hover.currentTarget.style.backgroundColor = c.accent; },
        onMouseLeave: (hover) => { hover.currentTarget.style.backgroundColor = c.border; },
    });
}
