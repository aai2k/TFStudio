import { buildEditableTargetShapes } from '../../../../utils/physics/spectrumTargets.js';
import { buildChartTraces, buildChartLayout, buildChartConfig } from './model.js';

const { createElement: h, useEffect, useCallback, useMemo, useRef } = React;

const SHAPE_COORDS = ['x0', 'x1', 'y0', 'y1'];

function shapeChanged(a, b) {
    return !b || SHAPE_COORDS.some(key => a[key] !== b[key]);
}

function deletedTargetId(eventShapes, state) {
    const present = new Set(eventShapes.map(shape => shape && shape.name).filter(Boolean));
    if (present.size > 0 || eventShapes.length === 0) {
        return (state.meta || []).find(meta => !present.has(meta.opId))?.opId || null;
    }

    const oldShapes = state.shapes || [];
    let index = eventShapes.length;
    for (let i = 0; i < eventShapes.length; i++) {
        if (shapeChanged(eventShapes[i], oldShapes[i])) { index = i; break; }
    }
    return state.meta?.[index]?.opId || null;
}

function createDrawnTarget(event, state) {
    const drawn = event.shapes[event.shapes.length - 1];
    if (drawn && drawn.type === 'line' && state.onCreateTarget) {
        state.onCreateTarget({ x0: drawn.x0, y0: drawn.y0, x1: drawn.x1, y1: drawn.y1 });
    }
}

function deleteErasedTarget(event, state) {
    const opId = deletedTargetId(event.shapes, state);
    if (opId && state.onDeleteTarget) state.onDeleteTarget(opId);
}

function editedShapeIndex(event) {
    let index = -1;
    for (const key in event) {
        const match = /^shapes\[(\d+)\]\./.exec(key);
        if (match) { index = +match[1]; break; }
    }
    return index;
}

function editDraggedTarget(event, state, plotDiv) {
    const index = editedShapeIndex(event);
    if (index < 0 || index >= (state.meta?.length ?? 0)) return;
    const shape = plotDiv.layout?.shapes?.[index];
    if (shape && state.onEditTarget) {
        state.onEditTarget(state.meta[index], { x0: shape.x0, x1: shape.x1, y0: shape.y0, y1: shape.y1 });
    }
}

function processRelayout(event, state, plotDiv) {
    if (Array.isArray(event.shapes) && event.shapes.length > state.metaCount) {
        createDrawnTarget(event, state);
    } else if (Array.isArray(event.shapes) && event.shapes.length < state.metaCount) {
        deleteErasedTarget(event, state);
    } else {
        editDraggedTarget(event, state, plotDiv);
    }
}

function observeChartParent(divRef, initializedRef) {
    const parent = divRef.current.parentElement;
    let rafId = 0;
    let lastW = 0;
    let lastH = 0;
    const observer = new ResizeObserver(entries => {
        const rect = entries[0] && entries[0].contentRect;
        if (!rect) return;
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (width === lastW && height === lastH) return;
        lastW = width;
        lastH = height;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            if (divRef.current && initializedRef.current) Plotly.Plots.resize(divRef.current);
        });
    });
    if (parent) observer.observe(parent);
    return () => {
        if (rafId) cancelAnimationFrame(rafId);
        observer.disconnect();
    };
}

function useLiveEditState(props, editable) {
    const editRef = useRef({});
    useEffect(() => {
        editRef.current = {
            editMode: props.editMode,
            editTool: props.editTool,
            meta: editable.meta,
            shapes: editable.shapes,
            metaCount: editable.shapes.length,
            onCreateTarget: props.onCreateTarget,
            onEditTarget: props.onEditTarget,
            onDeleteTarget: props.onDeleteTarget,
        };
    }, [props.editMode, props.editTool, editable, props.onCreateTarget, props.onEditTarget, props.onDeleteTarget]);
    return editRef;
}

function usePlotlyHandlers(divRef, editRef) {
    const handleRelayout = useCallback(event => {
        const state = editRef.current;
        if (state.editMode && divRef.current) processRelayout(event, state, divRef.current);
    }, []);
    const handlePlotClick = useCallback(event => {
        const state = editRef.current;
        const canDelete = state.editMode && state.editTool === 'delete' && event?.points?.length && state.onDeleteTarget;
        if (!canDelete) return;
        const point = event.points.find(item => item?.customdata != null);
        if (point && typeof point.customdata === 'string') state.onDeleteTarget(point.customdata);
    }, []);
    return { handleRelayout, handlePlotClick };
}

function usePlotlyLifecycle(opts) {
    const { divRef, initializedRef, buildTraces, layout, config, handleRelayout, handlePlotClick } = opts;
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        Plotly.newPlot(divRef.current, buildTraces(), layout, config);
        initializedRef.current = true;
        divRef.current.on('plotly_relayout', handleRelayout);
        divRef.current.on('plotly_click', handlePlotClick);
        const disconnectObserver = observeChartParent(divRef, initializedRef);

        return () => {
            disconnectObserver();
            if (divRef.current) Plotly.purge(divRef.current);
            initializedRef.current = false;
        };
    }, []);
}

function usePlotlyUpdates(opts) {
    const { divRef, initializedRef, buildTraces, layout, config, data, showCurves, colors } = opts;
    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.react(divRef.current, buildTraces(), layout, config);
    }, [data, showCurves, buildTraces, layout, config]);

    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.relayout(divRef.current, {
            paper_bgcolor: colors.paperColor,
            plot_bgcolor: colors.bgColor,
            'font.color': colors.textColor,
            'xaxis.gridcolor': colors.gridColor,
            'yaxis.gridcolor': colors.gridColor,
            'legend.bgcolor': colors.paperColor + 'cc',
            'legend.bordercolor': colors.gridColor
        });
    }, [colors.bgColor, colors.paperColor, colors.gridColor, colors.textColor]);
}

export function PlotlyChart(props) {
    const {
        data, showCurves, targets, showTargets, c,
        editMode = false, editTool = 'draw', editCurve = 'R', lamRange, yRange,
        spectralUnit = 'nm', overlays = [],
    } = props;
    const divRef = useRef(null);
    const initializedRef = useRef(false);
    const colors = {
        bgColor: c.bg || '#1e1e1e',
        paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a',
        textColor: c.text || '#cccccc',
    };
    const targetsVisible = showTargets || editMode;
    const handlesActive = editMode && editTool === 'draw';
    const editable = useMemo(
        () => handlesActive ? buildEditableTargetShapes(targets, lamRange) : { shapes: [], meta: [] },
        [handlesActive, targets, lamRange]
    );
    const editRef = useLiveEditState(props, editable);
    const buildTraces = useCallback(
        () => buildChartTraces({ data, showCurves, targets, targetsVisible, overlays }),
        [data, showCurves, targets, targetsVisible, overlays]
    );
    const layout = useMemo(() => buildChartLayout({
        ...colors, targets, targetsVisible, editMode, editTool, editCurve,
        editable, handlesActive, yRange, spectralUnit, lamRange,
    }), [colors.paperColor, colors.bgColor, colors.gridColor, colors.textColor, targets, targetsVisible, editMode, editTool, editCurve, editable, handlesActive, yRange, spectralUnit, lamRange]);
    const config = useMemo(() => buildChartConfig(editMode, editTool), [editMode, editTool]);
    const handlers = usePlotlyHandlers(divRef, editRef);
    usePlotlyLifecycle({ divRef, initializedRef, buildTraces, layout, config, ...handlers });
    usePlotlyUpdates({ divRef, initializedRef, buildTraces, layout, config, data, showCurves, colors });

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim }
        }, 'Plotly not loaded — check index.html');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
