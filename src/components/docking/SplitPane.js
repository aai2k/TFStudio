const { createElement: h, useRef, useCallback } = React;

const DIVIDER_SIZE = 5; // px

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

    const onMove = (e) => {
      const coord = isH ? e.clientX : e.clientY;
      const deltaPct = ((coord - startCoord) / totalPx) * 100;
      const next = [...startSizes];
      next[dividerIdx]     = Math.max(5, startSizes[dividerIdx]     + deltaPct);
      next[dividerIdx + 1] = Math.max(5, startSizes[dividerIdx + 1] - deltaPct);
      // Clamp so total stays at 100
      const overflow = next[dividerIdx] + next[dividerIdx + 1] - (startSizes[dividerIdx] + startSizes[dividerIdx + 1]);
      if (overflow !== 0) {
        next[dividerIdx]     -= overflow / 2;
        next[dividerIdx + 1] += overflow / 2;
      }
      onSizesChange(next);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = isH ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
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
      const sizeVal = `calc(${node.sizes[idx] ?? 50}% - ${(node.children.length - 1) * DIVIDER_SIZE / node.children.length}px)`;
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
