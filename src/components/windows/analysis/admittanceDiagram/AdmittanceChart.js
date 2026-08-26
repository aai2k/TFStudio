import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { squareGrid } from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { plotMargin } from '../chrome/plot.js';
import { buildAdmittanceOption } from './chartFigure.js';

const { createElement: h, useEffect, useRef } = React;
const progressivelyZoomable = new WeakSet();
const DOMAIN_GROWTH = 2;
const AFTER_GROW_START = 22.5;
const AFTER_GROW_END = 77.5;

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

/** Grow the Re(Y)/Im(Y) navigation domain without changing its square shape. */
export function expandAdmittanceNavigation(option) {
    const xAxis = expandedAxis(first(option?.xAxis));
    const yAxis = expandedAxis(first(option?.yAxis));
    if (!xAxis || !yAxis) return null;
    return {
        xAxis: [xAxis], yAxis: [yAxis],
        // Show a little more immediately, but leave room on both sides for the
        // next ordinary wheel gestures before another expansion is needed.
        dataZoom: [{ start: AFTER_GROW_START, end: AFTER_GROW_END }],
    };
}

function isOutwardWheel(event) {
    // `deltaY` has consistent physical direction across platforms; fall back
    // to zrender's normalized delta for legacy mousewheel events.
    const deltaY = Number(event?.event?.deltaY);
    return Number.isFinite(deltaY) && deltaY !== 0 ? deltaY > 0 : event?.wheelDelta < 0;
}

function bindProgressiveZoom(chart) {
    if (!chart || progressivelyZoomable.has(chart)) return;
    progressivelyZoomable.add(chart);
    chart.getZr().on('mousewheel', event => {
        if (!isOutwardWheel(event)) return;
        if (chart.containPixel && !chart.containPixel('grid', [event.offsetX, event.offsetY])) return;
        const option = chart.getOption();
        const zoom = first(option?.dataZoom);
        // ECharts dataZoom is bounded to 0–100. Reaching that boundary grows
        // the underlying domain, then recentres the old domain inside it. The
        // next outward gesture can therefore continue instead of hitting a
        // fixed Re(Y)/Im(Y) limit.
        if (Number(zoom?.start) > 1e-7 || Number(zoom?.end) < 100 - 1e-7) return;
        const expanded = expandAdmittanceNavigation(option);
        if (expanded) chart.setOption(expanded, { notMerge: false, lazyUpdate: false });
    });
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
