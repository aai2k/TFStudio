/**
 * Reusable SVG target editor.
 *
 * The editor knows nothing about ECharts options or optical operands. Its only
 * renderer contract is an instance that converts between data and pixel space.
 * The same layer can therefore be reused by GD/GDD once those target semantics
 * expose the same neutral line geometry.
 */

const { createElement: h, useCallback, useEffect, useRef, useState } = React;
const AXES = { xAxisIndex: 0, yAxisIndex: 0 };
const PLOT = { gridIndex: 0 };

function finitePoint(point) {
    return Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite);
}

function eventPixel(event, svg) {
    const rect = svg.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
}

export function dataPoint(chart, pixel) {
    // Axis models convert coordinates, but in ECharts 6 they do not own a
    // coordinate system and therefore can never contain a pixel. The grid owns
    // the Cartesian coordinate system, so containment and conversion need
    // different finders.
    if (chart?.containPixel && !chart.containPixel(PLOT, pixel)) return null;
    const point = chart?.convertFromPixel(AXES, pixel);
    return finitePoint(point) ? point : null;
}

function moveGeometry(source, start, current, part) {
    if (part === 'start') return { ...source, x0: current[0], y0: current[1] };
    if (part === 'end') return { ...source, x1: current[0], y1: current[1] };
    const dx = current[0] - start[0], dy = current[1] - start[1];
    return {
        ...source,
        x0: source.x0 + dx, x1: source.x1 + dx,
        y0: source.y0 + dy, y1: source.y1 + dy,
    };
}

export function hasPointerTravelled(start, end, minimum = 3) {
    return finitePoint(start) && finitePoint(end)
        && Math.hypot(end[0] - start[0], end[1] - start[1]) >= minimum;
}

export function targetGeometryChanged(source, result) {
    return ['x0', 'y0', 'x1', 'y1'].some(key => Number(source?.[key]) !== Number(result?.[key]));
}

function ActiveTargetEditorOverlay({
    chartRef, geometry = [], enabled = false, tool = 'draw', drawColor = '#ef5350',
    handleFill = '#1e1e1e', onCreate, onEdit, onDelete,
}) {
    const svgRef = useRef(null);
    const dragRef = useRef(null);
    const previewRef = useRef(null);
    const frameRef = useRef(0);
    const [view, setView] = useState({ width: 1, height: 1, lines: [] });
    const [preview, setPreview] = useState(null);
    const [focused, setFocused] = useState(null);
    const showPreview = value => { previewRef.current = value; setPreview(value); };

    const refresh = useCallback(() => {
        const chart = chartRef.current;
        const element = svgRef.current;
        if (!chart || chart.isDisposed?.() || !element) return;
        const rect = element.getBoundingClientRect();
        const lines = geometry.map(item => {
            const start = chart.convertToPixel(AXES, [item.x0, item.y0]);
            const end = chart.convertToPixel(AXES, [item.x1, item.y1]);
            return finitePoint(start) && finitePoint(end) ? { ...item, start, end } : null;
        }).filter(Boolean);
        setView({ width: Math.max(1, rect.width), height: Math.max(1, rect.height), lines });
    }, [chartRef, geometry]);

    useEffect(() => {
        let chart = null;
        let observer = null;
        let cancelled = false;
        const scheduleRefresh = () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; refresh(); });
        };
        const attach = () => {
            if (cancelled) return;
            chart = chartRef.current;
            if (!chart || chart.isDisposed?.()) {
                frameRef.current = requestAnimationFrame(attach);
                return;
            }
            chart.on('datazoom', scheduleRefresh);
            chart.on('finished', scheduleRefresh);
            observer = new ResizeObserver(scheduleRefresh);
            if (svgRef.current) observer.observe(svgRef.current);
            scheduleRefresh();
        };
        attach();
        return () => {
            cancelled = true;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            observer?.disconnect();
            if (chart && !chart.isDisposed?.()) {
                chart.off('datazoom', scheduleRefresh);
                chart.off('finished', scheduleRefresh);
            }
        };
    }, [refresh]);

    const startHandleDrag = (event, item, part) => {
        event.preventDefault();
        event.stopPropagation();
        if (tool === 'delete') {
            onDelete?.(item.opId);
            return;
        }
        if (tool !== 'draw') return;
        const chart = chartRef.current;
        const pixel = eventPixel(event, svgRef.current);
        const startData = dataPoint(chart, pixel);
        if (!startData) return;
        dragRef.current = {
            mode: 'edit', source: item, part, startData, startPixel: pixel,
            pointerId: event.pointerId, captureTarget: event.currentTarget,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        showPreview(item);
    };

    const startDrawing = event => {
        if (!enabled || tool !== 'draw' || event.target !== svgRef.current) return;
        event.preventDefault();
        const pixel = eventPixel(event, svgRef.current);
        const point = dataPoint(chartRef.current, pixel);
        if (!point) return;
        dragRef.current = { mode: 'create', startData: point, startPixel: pixel, pointerId: event.pointerId, captureTarget: event.currentTarget };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        showPreview({ x0: point[0], y0: point[1], x1: point[0], y1: point[1], color: drawColor });
    };

    const updateDrag = event => {
        const drag = dragRef.current;
        if (!drag) return;
        const current = dataPoint(chartRef.current, eventPixel(event, svgRef.current));
        if (!current) return;
        if (drag.mode === 'create') {
            showPreview({ x0: drag.startData[0], y0: drag.startData[1], x1: current[0], y1: current[1], color: drawColor });
        } else {
            showPreview(moveGeometry(drag.source, drag.startData, current, drag.part));
        }
    };

    const finishDrag = event => {
        const drag = dragRef.current;
        if (!drag) return;
        const result = previewRef.current;
        dragRef.current = null;
        showPreview(null);
        drag.captureTarget?.releasePointerCapture?.(drag.pointerId);
        if (!result) return;
        const endPixel = eventPixel(event, svgRef.current);
        if (!hasPointerTravelled(drag.startPixel, endPixel)) return;
        if (drag.mode === 'create') {
            onCreate?.(result);
        } else if (targetGeometryChanged(drag.source, result)) {
            onEdit?.({ opId: drag.source.opId, kind: drag.source.kind, type: drag.source.type }, result);
        }
    };

    const cancelDrag = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        showPreview(null);
        drag?.captureTarget?.releasePointerCapture?.(drag.pointerId);
    };

    const previewPixels = (() => {
        if (!preview || !chartRef.current) return null;
        const start = chartRef.current.convertToPixel(AXES, [preview.x0, preview.y0]);
        const end = chartRef.current.convertToPixel(AXES, [preview.x1, preview.y1]);
        return finitePoint(start) && finitePoint(end) ? { start, end, color: preview.color || drawColor } : null;
    })();

    const lineElements = [];
    for (const item of view.lines) {
        const key = item.opId;
        const active = focused === key;
        const common = { x1: item.start[0], y1: item.start[1], x2: item.end[0], y2: item.end[1] };
        lineElements.push(h('line', {
            key: `${key}-visible`, ...common,
            stroke: item.color, strokeWidth: active ? 4 : 3, strokeDasharray: item.dash === 'dotted' ? '2 4' : item.dash === 'dashed' ? '8 5' : undefined,
            opacity: 0.95, pointerEvents: 'none',
        }));
        lineElements.push(h('line', {
            key: `${key}-hit`, ...common,
            stroke: 'transparent', strokeWidth: 16, pointerEvents: enabled ? 'stroke' : 'none',
            tabIndex: 0, role: 'button', 'aria-label': `${item.type} target`,
            style: { cursor: tool === 'delete' ? 'pointer' : 'move', outline: 'none' },
            onFocus: () => setFocused(key), onBlur: () => setFocused(null),
            onKeyDown: event => {
                if ((event.key === 'Delete' || event.key === 'Backspace' || event.key === 'Enter') && tool === 'delete') onDelete?.(item.opId);
            },
            onPointerDown: event => startHandleDrag(event, item, 'move'),
        }));
        for (const [part, point] of [['start', item.start], ['end', item.end]]) lineElements.push(h('circle', {
            key: `${key}-${part}`, cx: point[0], cy: point[1], r: active ? 6 : 5,
            fill: handleFill, stroke: item.color, strokeWidth: 2,
            pointerEvents: enabled ? 'all' : 'none',
            style: { cursor: tool === 'delete' ? 'pointer' : 'crosshair' },
            onPointerDown: event => startHandleDrag(event, item, part),
        }));
    }

    return h('svg', {
        ref: svgRef,
        viewBox: `0 0 ${view.width} ${view.height}`,
        preserveAspectRatio: 'none',
        onPointerDown: startDrawing,
        onPointerMove: updateDrag,
        onPointerUp: finishDrag,
        onPointerCancel: cancelDrag,
        style: {
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            zIndex: 4, pointerEvents: enabled && tool === 'draw' ? 'auto' : 'none',
            touchAction: enabled && tool === 'draw' ? 'none' : 'auto',
            cursor: enabled && tool === 'draw' ? 'crosshair' : 'default',
        },
    },
        ...lineElements,
        previewPixels && h('line', {
            x1: previewPixels.start[0], y1: previewPixels.start[1],
            x2: previewPixels.end[0], y2: previewPixels.end[1],
            stroke: previewPixels.color, strokeWidth: 3, strokeDasharray: '6 4', pointerEvents: 'none',
        }),
    );
}

/**
 * Keep the editor completely out of the chart while editing is off.
 *
 * Besides avoiding a transparent SVG over a read-only plot, this is important
 * for large spectra: the active editor listens for `datazoom` so its handles
 * follow the axes. A disabled editor used to listen too, update React state on
 * the first brush event, and make the large-data chart rebuild in the middle of
 * the brush. ECharts then interpreted the remainder against the new range and
 * applied a second, much smaller zoom.
 */
export function TargetEditorOverlay(props) {
    return props.enabled ? h(ActiveTargetEditorOverlay, props) : null;
}
