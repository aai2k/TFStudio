import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { squareGrid } from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { plotMargin } from '../chrome/plot.js';
import { ADMITTANCE_ZOOM_IDS, buildAdmittanceOption } from './chartFigure.js';

const { createElement: h, useEffect, useRef } = React;
const progressivelyZoomable = new WeakSet();
const DOMAIN_GROWTH = 2;
const AFTER_GROW_START = 22.5;
const AFTER_GROW_END = 77.5;
const MIN_ZOOM_SPAN = 0.01;
const WHEEL_ZOOM_FACTOR = 1.18;

function first(component) {
    return Array.isArray(component) ? component[0] : component;
}

function expandedAxis(axis) {
    const min = Number(axis?.min), max = Number(axis?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
    const center = (min + max) / 2;
    const half = (max - min) * DOMAIN_GROWTH / 2;
    if (!Number.isFinite(center - half) || !Number.isFinite(center + half)) return null;
    return { min: center - half, max: center + half };
}

function boundedWindow(center, span) {
    const width = Math.min(100, Math.max(MIN_ZOOM_SPAN, span));
    let start = center - width / 2;
    let end = center + width / 2;
    if (start < 0) { end -= start; start = 0; }
    if (end > 100) { start -= end - 100; end = 100; }
    return { start: Math.max(0, start), end: Math.min(100, end) };
}

function axisZooms(zooms) {
    const source = Array.isArray(zooms) ? zooms : zooms ? [zooms] : [];
    const byId = new Map(source.map(zoom => [zoom?.id, zoom]));
    const x = byId.get(ADMITTANCE_ZOOM_IDS.x);
    const y = byId.get(ADMITTANCE_ZOOM_IDS.y);
    if (!x || !y) return null;
    return { x, y };
}

function zoomSpan(zoom) {
    return Math.max(MIN_ZOOM_SPAN, Number(zoom.end) - Number(zoom.start));
}

function zoomPatch(id, range) {
    return { dataZoomId: id, start: range.start, end: range.end };
}

/** Lock Re(Y) and Im(Y) to the same visible span, containing a box selection. */
export function lockAdmittanceZoom(zooms) {
    const axes = axisZooms(zooms);
    if (!axes) return null;
    const span = Math.max(zoomSpan(axes.x), zoomSpan(axes.y));
    return [
        zoomPatch(ADMITTANCE_ZOOM_IDS.x,
            boundedWindow((Number(axes.x.start) + Number(axes.x.end)) / 2, span)),
        zoomPatch(ADMITTANCE_ZOOM_IDS.y,
            boundedWindow((Number(axes.y.start) + Number(axes.y.end)) / 2, span)),
    ];
}

export function panAdmittanceZoom(zooms, dxFraction, dyFraction) {
    const locked = lockAdmittanceZoom(zooms);
    if (!locked) return null;
    const span = zoomSpan(locked[0]);
    const xCenter = (locked[0].start + locked[0].end) / 2 - dxFraction * span;
    const yCenter = (locked[1].start + locked[1].end) / 2 + dyFraction * span;
    return [
        zoomPatch(ADMITTANCE_ZOOM_IDS.x, boundedWindow(xCenter, span)),
        zoomPatch(ADMITTANCE_ZOOM_IDS.y, boundedWindow(yCenter, span)),
    ];
}

export function zoomAdmittanceAt(zooms, xFraction, yFraction, factor) {
    const locked = lockAdmittanceZoom(zooms);
    if (!locked) return null;
    const oldSpan = zoomSpan(locked[0]);
    const newSpan = Math.min(100, Math.max(MIN_ZOOM_SPAN, oldSpan * factor));
    const anchorX = locked[0].start + xFraction * oldSpan;
    const anchorY = locked[1].start + yFraction * oldSpan;
    return [
        zoomPatch(ADMITTANCE_ZOOM_IDS.x,
            boundedWindow(anchorX + (0.5 - xFraction) * newSpan, newSpan)),
        zoomPatch(ADMITTANCE_ZOOM_IDS.y,
            boundedWindow(anchorY + (0.5 - yFraction) * newSpan, newSpan)),
    ];
}

/** Grow the Re(Y)/Im(Y) navigation domain without changing its square shape. */
export function expandAdmittanceNavigation(option) {
    const xAxis = expandedAxis(first(option?.xAxis));
    const yAxis = expandedAxis(first(option?.yAxis));
    if (!xAxis || !yAxis) return null;
    return {
        xAxis: [xAxis], yAxis: [yAxis],
        // Show a little more immediately, but leave room on both sides for the
        // next ordinary wheel gestures before another expansion is needed.
        dataZoom: [
            { id: ADMITTANCE_ZOOM_IDS.x, start: AFTER_GROW_START, end: AFTER_GROW_END },
            { id: ADMITTANCE_ZOOM_IDS.y, start: AFTER_GROW_START, end: AFTER_GROW_END },
        ],
    };
}

function isOutwardWheel(event) {
    // `deltaY` has consistent physical direction across platforms; fall back
    // to zrender's normalized delta for legacy mousewheel events.
    const deltaY = Number(event?.event?.deltaY);
    return Number.isFinite(deltaY) && deltaY !== 0 ? deltaY > 0 : event?.wheelDelta < 0;
}

function currentZooms(chart) {
    const option = chart.getOption();
    return Array.isArray(option?.dataZoom) ? option.dataZoom : option?.dataZoom ? [option.dataZoom] : [];
}

function gridRect(chart) {
    return chart.getModel?.().getComponent?.('grid', 0)?.coordinateSystem?.getRect?.() || null;
}

function dispatchZoom(chart, batch) {
    if (!batch?.length) return;
    chart.dispatchAction({
        type: 'dataZoom',
        animation: { duration: 0 },
        batch,
    });
}

function sameZoomSpan(zooms) {
    const axes = axisZooms(zooms);
    return !!axes && Math.abs(zoomSpan(axes.x) - zoomSpan(axes.y)) < 1e-7;
}

function bindProgressiveZoom(chart) {
    if (!chart || progressivelyZoomable.has(chart)) return;
    progressivelyZoomable.add(chart);
    let rectangleActive = false;
    let correctingAspect = false;
    let pan = null;
    let panFrame = 0;

    chart.on('globalcursortaken', event => {
        if (event?.key === 'dataZoomSelect') rectangleActive = !!event.dataZoomSelectActive;
    });
    chart.on('datazoom', () => {
        if (correctingAspect) { correctingAspect = false; return; }
        const zooms = currentZooms(chart);
        if (sameZoomSpan(zooms)) return;
        const locked = lockAdmittanceZoom(zooms);
        if (!locked) return;
        correctingAspect = true;
        dispatchZoom(chart, locked);
    });

    const zr = chart.getZr();
    chart.getZr().on('mousewheel', event => {
        if (chart.containPixel && !chart.containPixel('grid', [event.offsetX, event.offsetY])) return;
        const outward = isOutwardWheel(event);
        const option = chart.getOption();
        const zooms = currentZooms(chart);
        // ECharts dataZoom is bounded to 0–100. Reaching that boundary grows
        // the underlying domain, then recentres the old domain inside it. The
        // next outward gesture can therefore continue instead of hitting a
        // fixed Re(Y)/Im(Y) limit.
        const atBoundary = zooms.length && zooms.every(zoom => (
            Number(zoom?.start) <= 1e-7 && Number(zoom?.end) >= 100 - 1e-7
        ));
        if (outward && atBoundary) {
            const expanded = expandAdmittanceNavigation(option);
            if (expanded) chart.setOption(expanded, { notMerge: false, lazyUpdate: false });
            return;
        }
        const rect = gridRect(chart);
        if (!rect?.width || !rect?.height) return;
        const xFraction = Math.min(1, Math.max(0, (event.offsetX - rect.x) / rect.width));
        const yFraction = Math.min(1, Math.max(0, 1 - (event.offsetY - rect.y) / rect.height));
        dispatchZoom(chart, zoomAdmittanceAt(
            zooms, xFraction, yFraction,
            outward ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR,
        ));
        event.event?.preventDefault?.();
    });

    const applyPan = () => {
        panFrame = 0;
        if (!pan) return;
        dispatchZoom(chart, panAdmittanceZoom(
            pan.zooms,
            (pan.x - pan.startX) / pan.rect.width,
            (pan.y - pan.startY) / pan.rect.height,
        ));
    };
    zr.on('mousedown', event => {
        const button = Number(event?.event?.button);
        if (rectangleActive || (Number.isFinite(button) && button !== 0)) return;
        if (chart.containPixel && !chart.containPixel('grid', [event.offsetX, event.offsetY])) return;
        const rect = gridRect(chart);
        if (!rect?.width || !rect?.height) return;
        pan = {
            startX: event.offsetX, startY: event.offsetY,
            x: event.offsetX, y: event.offsetY,
            rect, zooms: currentZooms(chart),
        };
        zr.setCursorStyle?.('grabbing');
    });
    zr.on('mousemove', event => {
        if (!pan) return;
        pan.x = event.offsetX; pan.y = event.offsetY;
        if (!panFrame) panFrame = requestAnimationFrame(applyPan);
    });
    const finishPan = event => {
        if (!pan) return;
        if (Number.isFinite(event?.offsetX)) { pan.x = event.offsetX; pan.y = event.offsetY; }
        if (panFrame) cancelAnimationFrame(panFrame);
        applyPan();
        pan = null;
        zr.setCursorStyle?.('default');
    };
    zr.on('mouseup', finishPan);
    zr.on('globalout', finishPan);
}

export function AdmittanceChart({ series, matColorMap, matName, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = {
        bg: c.bg || '#1e1e1e', panel: c.panel || '#252526',
        border: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    const marks = useAnalysisColors('admittanceDiagram');
    useEffect(() => {
        const chart = drawChart(divRef.current, chartRef,
            buildAdmittanceOption(series, matColorMap, matName, colors, marks,
                squareGrid(divRef.current, plotMargin())));
        bindProgressiveZoom(chart);
    });
    useChartTeardown(divRef, chartRef, () => {
        drawChart(divRef.current, chartRef,
            buildAdmittanceOption(series, matColorMap, matName, colors, marks,
                squareGrid(divRef.current, plotMargin())));
    });
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
