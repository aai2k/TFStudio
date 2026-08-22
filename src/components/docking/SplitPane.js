import { resizeAdjacentSizes } from './treeUtils.js';

const { createElement: h, useRef, useCallback } = React;

const DIVIDER_SIZE = 5; // px

// Panes and dividers alternate in the container, so pane i is at 2i.
const paneAt = (container, idx) => container?.children?.[idx * 2] || null;

const paneSize = (sizes, idx, count) =>
  `calc(${sizes[idx] ?? 50}% - ${(count - 1) * DIVIDER_SIZE / count}px)`;

export function SplitPane({ node, c, onSizesChange, children }) {
  const containerRef = useRef(null);
  const isH = node.direction === 'h';
  const childArray = Array.isArray(children) ? children : [children];

  const startResize = useCallback((dividerIdx, e) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const totalPx = isH ? rect.width : rect.height;
    const startCoord = isH ? e.clientX : e.clientY;
    const startSizes = [...node.sizes];

    // React is kept out of the drag. Routing every mouse move through state
    // means the panes cannot move until a render commits, which lands a frame
    // or more after the cursor and is what makes the divider trail it. The two
    // adjacent panes are sized directly instead, which the browser lays out on
    // the very next frame, and the resulting layout change is what drives each
    // plot's ResizeObserver. State is caught up once per frame purely so the
    // tree stays consistent and the sizes persist.
    const sizeProp = isH ? 'width' : 'height';
    const count = node.children.length;
    let latestSizes = startSizes;
    let committedSizes = startSizes;
    let frame = 0;

    const commit = () => {
      frame = 0;
      if (latestSizes.every((size, idx) => size === committedSizes[idx])) return;
      committedSizes = latestSizes;
      onSizesChange(latestSizes);
    };

    const onMove = (e) => {
      const coord = isH ? e.clientX : e.clientY;
      const deltaPct = ((coord - startCoord) / totalPx) * 100;
      const next = resizeAdjacentSizes(startSizes, dividerIdx, deltaPct);
      // Past a pane's minimum the clamp returns the same sizes however much
      // further the cursor travels, so there is nothing to move or re-render.
      if (next.every((size, idx) => size === latestSizes[idx])) return;
      latestSizes = next;
      for (const idx of [dividerIdx, dividerIdx + 1]) {
        const pane = paneAt(container, idx);
        if (pane) pane.style[sizeProp] = paneSize(next, idx, count);
      }
      if (!frame) frame = requestAnimationFrame(commit);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (frame) cancelAnimationFrame(frame);
      commit();
      document.documentElement.classList.remove('tf-split-resizing-h', 'tf-split-resizing-v');
    };

    // A plain `body { cursor }` loses to any element under the pointer that
    // sets its own, so the cursor flickers as the drag crosses the plots and
    // the toolbars. The class wins everywhere, as layer dragging already does.
    document.documentElement.classList.add(isH ? 'tf-split-resizing-h' : 'tf-split-resizing-v');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [node, isH, onSizesChange]);

  return h('div', {
    ref: containerRef,
    style: {
      display: 'flex',
      flexDirection: isH ? 'row' : 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      flex: 1
    }
  },
    node.children.map((child, idx) => {
      // Same helper the drag writes with, so a render mid-drag reproduces the
      // pane exactly rather than snapping it.
      const sizeVal = paneSize(node.sizes, idx, node.children.length);
      return [
        h('div', {
          key: child.id,
          style: {
            [isH ? 'width' : 'height']: sizeVal,
            [isH ? 'minWidth' : 'minHeight']: '80px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            flexGrow: 0
          }
        }, childArray[idx]),

        idx < node.children.length - 1 && h('div', {
          key: `d${idx}`,
          onMouseDown: (e) => startResize(idx, e),
          style: {
            [isH ? 'width' : 'height']: DIVIDER_SIZE,
            [isH ? 'minWidth' : 'minHeight']: DIVIDER_SIZE,
            flexShrink: 0,
            cursor: isH ? 'col-resize' : 'row-resize',
            backgroundColor: c.border,
            zIndex: 2,
            transition: 'background-color 0.12s',
            position: 'relative'
          },
          onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.accent; },
          onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = c.border; }
        })
      ];
    })
  );
}
