/**
 * Reusable SVG target editor.
 *
 * The editor knows nothing about ECharts options or optical operands. Its only
 * renderer contract is an instance that converts between data and pixel space,
 * so every plot that edits targets on its curve shares it: spectral targets on
 * Optical Evaluation, GD/GDD targets, and the points of a curve in the curve
 * editor. What it draws and what a drag does are in targetEditorGeometry.js.
 *
 *   tool  'draw'    handles drag, and a drag on empty plot area draws a target
 *         'move'    handles drag and nothing is drawn; the plot under the
 *                   overlay keeps its own pointer, for zoom and readout
 *         'delete'  a click on a target removes it
 */

import { observeResize } from './observeResize.js';
import {
    clampToPlot, dataPoint, dropOutcome, finitePoint, hasPointerTravelled, isPointItem, itemAxes, moveGeometry,
    nearestPoint, projectGeometry, projectItem,
} from './targetEditorGeometry.js';

const { createElement: h, useCallback, useEffect, useRef, useState } = React;

function eventPixel(event, svg) {
    const rect = svg.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
}

const DRAGGING_TOOLS = new Set(['draw', 'move']);

/**
 * The items in pixels, kept in step with the chart: after every redraw and
 * zoom of the chart and every resize of the overlay.
 */
function useProjectedItems(chartRef, svgRef, geometry) {
    const frameRef = useRef(0);
    const [view, setView] = useState({ width: 1, height: 1, items: [] });
    const refresh = useCallback(() => {
        const chart = chartRef.current;
        const element = svgRef.current;
        if (!chart || chart.isDisposed?.() || !element) return;
        const rect = element.getBoundingClientRect();
        const items = projectGeometry(chart, geometry, rect.width);
        setView({ width: Math.max(1, rect.width), height: Math.max(1, rect.height), items });
    }, [chartRef, svgRef, geometry]);

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
            observer = observeResize(svgRef.current, scheduleRefresh);
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
    return view;
}

function beginCapture(event, drag, dragRef) {
    dragRef.current = { ...drag, pointerId: event.pointerId, captureTarget: event.currentTarget };
    event.currentTarget.setPointerCapture?.(event.pointerId);
}

// The preview an in-progress drag shows, from the pointer's current pixel. A
// pointer past the plot's edge holds the dragged end at the edge.
function dragPreview(chart, drag, pixel, drawColor) {
    const current = dataPoint(chart, clampToPlot(chart, pixel), drag.axes);
    if (!current) return null;
    if (drag.mode === 'create') {
        return { x0: drag.startData[0], y0: drag.startData[1], x1: current[0], y1: current[1], color: drawColor };
    }
    const shift = [pixel[0] - drag.startPixel[0], pixel[1] - drag.startPixel[1]];
    return moveGeometry(chart, drag.source, drag.part, current, shift);
}

// The pointer handlers below take the overlay's drag state as `ctx`: its
// props, the chart and svg refs, the drag in progress and its preview.

function startHandleDrag(ctx, event, item, part) {
    event.preventDefault();
    event.stopPropagation();
    if (ctx.tool === 'delete') ctx.onDelete?.(item.opId);
    if (!DRAGGING_TOOLS.has(ctx.tool)) return;
    const pixel = eventPixel(event, ctx.svgRef.current);
    const axes = itemAxes(item);
    if (!dataPoint(ctx.chartRef.current, clampToPlot(ctx.chartRef.current, pixel), axes)) return;
    beginCapture(event, { mode: 'edit', source: item, part, startPixel: pixel, axes }, ctx.dragRef);
    ctx.showPreview(item);
}

function startDrawing(ctx, event) {
    if (!ctx.enabled || ctx.tool !== 'draw' || event.target !== ctx.svgRef.current) return;
    event.preventDefault();
    const pixel = eventPixel(event, ctx.svgRef.current);
    const point = dataPoint(ctx.chartRef.current, pixel);
    if (!point) return;
    beginCapture(event, { mode: 'create', startData: point, startPixel: pixel }, ctx.dragRef);
    ctx.showPreview({ x0: point[0], y0: point[1], x1: point[0], y1: point[1], color: ctx.drawColor });
}

function updateDrag(ctx, event) {
    const drag = ctx.dragRef.current;
    const pixel = drag && eventPixel(event, ctx.svgRef.current);
    const next = drag && dragPreview(ctx.chartRef.current, drag, pixel, ctx.drawColor);
    if (next) ctx.showPreview(next);
}

function endDrag(ctx) {
    const drag = ctx.dragRef.current;
    ctx.dragRef.current = null;
    ctx.showPreview(null);
    drag?.captureTarget?.releasePointerCapture?.(drag.pointerId);
    return drag;
}

function finishDrag(ctx, event) {
    if (!ctx.dragRef.current) return;
    const result = ctx.previewRef.current;
    const drag = endDrag(ctx);
    const travelled = hasPointerTravelled(drag.startPixel, eventPixel(event, ctx.svgRef.current));
    const outcome = dropOutcome(drag, result, travelled, ctx.createOnClick);
    if (outcome?.create) ctx.onCreate?.(outcome.create);
    else if (outcome?.edit) {
        ctx.onEdit?.({ opId: drag.source.opId, kind: drag.source.kind, type: drag.source.type }, outcome.edit);
    }
}

/** The pointer handlers of the overlay, and the preview of the drag in progress. */
function useTargetDrag(props, chartRef, svgRef) {
    const dragRef = useRef(null);
    const previewRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const showPreview = value => { previewRef.current = value; setPreview(value); };
    const ctx = { ...props, chartRef, svgRef, dragRef, previewRef, showPreview };
    return {
        preview,
        startHandleDrag: (event, item, part) => startHandleDrag(ctx, event, item, part),
        startDrawing: event => startDrawing(ctx, event),
        updateDrag: event => updateDrag(ctx, event),
        finishDrag: event => finishDrag(ctx, event),
        cancelDrag: () => endDrag(ctx),
    };
}

const dashArray = dash => (dash === 'dotted' ? '2 4' : dash === 'dashed' ? '8 5' : undefined);

function lineElements(item, context) {
    const { enabled, tool, handleFill, focused, setFocused, onDelete, startHandleDrag } = context;
    const key = item.opId;
    const active = focused === key;
    const common = { x1: item.start[0], y1: item.start[1], x2: item.end[0], y2: item.end[1] };
    const handles = [['start', item.start], ['end', item.end]].map(([part, point]) => h('circle', {
        key: `${key}-${part}`, cx: point[0], cy: point[1], r: active ? 6 : 5,
        fill: handleFill, stroke: item.color, strokeWidth: 2,
        pointerEvents: enabled ? 'all' : 'none',
        style: { cursor: tool === 'delete' ? 'pointer' : 'crosshair' },
        onPointerDown: event => startHandleDrag(event, item, part),
    }));
    return [
        h('line', {
            key: `${key}-visible`, ...common,
            stroke: item.color, strokeWidth: active ? 4 : 3, strokeDasharray: dashArray(item.dash),
            opacity: 0.95, pointerEvents: 'none',
        }),
        h('line', {
            key: `${key}-hit`, ...common,
            stroke: 'transparent', strokeWidth: 16, pointerEvents: enabled ? 'stroke' : 'none',
            tabIndex: 0, role: 'button', 'aria-label': `${item.type} target`,
            style: { cursor: tool === 'delete' ? 'pointer' : 'move', outline: 'none' },
            onFocus: () => setFocused(key), onBlur: () => setFocused(null),
            onKeyDown: event => {
                if (['Delete', 'Backspace', 'Enter'].includes(event.key) && tool === 'delete') onDelete?.(item.opId);
            },
            onPointerDown: event => startHandleDrag(event, item, 'move'),
        }),
        ...handles,
    ];
}

// The radius a point answers a press within, in pixels: the drawn circle is
// 4 px, too small to catch reliably by hand.
const POINT_HIT_RADIUS = 9;

function pointElements(item, context) {
    const { enabled, handleFill, pressPoint } = context;
    const center = { cx: item.start[0], cy: item.start[1] };
    return [
        h('circle', {
            key: `${item.opId}-point`, ...center, r: 4,
            fill: handleFill, stroke: item.color, strokeWidth: 1.5, pointerEvents: 'none',
        }),
        h('circle', {
            key: `${item.opId}-hit`, ...center, r: POINT_HIT_RADIUS, fill: 'transparent',
            pointerEvents: enabled ? 'all' : 'none',
            style: { cursor: 'ns-resize' },
            onPointerDown: event => pressPoint(event, item),
        }),
    ];
}

// The drag in progress, drawn over everything else.
function previewElement(chart, preview, drawColor) {
    if (!preview || !chart) return null;
    const projected = projectItem(chart, preview);
    if (!projected) return null;
    const color = preview.color || drawColor;
    if (isPointItem(projected)) {
        return h('circle', {
            cx: projected.start[0], cy: projected.start[1], r: 5,
            fill: color, stroke: color, pointerEvents: 'none',
        });
    }
    return finitePoint(projected.end) && h('line', {
        x1: projected.start[0], y1: projected.start[1], x2: projected.end[0], y2: projected.end[1],
        stroke: color, strokeWidth: 3, strokeDasharray: '6 4', pointerEvents: 'none',
    });
}

function ActiveTargetEditorOverlay(props) {
    const {
        chartRef, geometry = [], enabled = false, tool = 'draw', drawColor = '#ef5350', handleFill = '#1e1e1e',
    } = props;
    const svgRef = useRef(null);
    const [focused, setFocused] = useState(null);
    const view = useProjectedItems(chartRef, svgRef, geometry);
    const drag = useTargetDrag({ ...props, enabled, tool, drawColor }, chartRef, svgRef);
    const pressPoint = (event, item) => {
        const nearest = nearestPoint(view.items, eventPixel(event, svgRef.current));
        drag.startHandleDrag(event, nearest || item, 'point');
    };
    const context = {
        enabled, tool, handleFill, focused, setFocused, onDelete: props.onDelete,
        startHandleDrag: drag.startHandleDrag, pressPoint,
    };
    const drawing = enabled && tool === 'draw';
    const elementsOf = item => (isPointItem(item) ? pointElements(item, context) : lineElements(item, context));
    return h('svg', {
        ref: svgRef,
        viewBox: `0 0 ${view.width} ${view.height}`,
        preserveAspectRatio: 'none',
        onPointerDown: drag.startDrawing,
        onPointerMove: drag.updateDrag,
        onPointerUp: drag.finishDrag,
        onPointerCancel: drag.cancelDrag,
        style: {
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            zIndex: 4, pointerEvents: drawing ? 'auto' : 'none',
            touchAction: drawing ? 'none' : 'auto',
            cursor: drawing ? 'crosshair' : 'default',
        },
    },
        ...view.items.flatMap(elementsOf),
        previewElement(chartRef.current, drag.preview, drawColor),
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
