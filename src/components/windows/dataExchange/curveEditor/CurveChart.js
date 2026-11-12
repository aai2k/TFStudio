/**
 * The curve editor's plot, with the points draggable through the shared
 * target editor overlay. A dragged point keeps its wavelength and takes the
 * value it was dropped at.
 *
 * `yRange` is the left axis's range from the editor's Y fields. After each
 * draw, and after a zoom, the ends that axis was drawn with go to
 * `onAxisEnds`, for the fields to show while Auto is on.
 */
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { TargetEditorOverlay } from '../../../ui/TargetEditorOverlay.js';
import { curveChartOption, drawnAxisEnds, pointGeometry } from './chartModel.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

// Hands the axis ends to `onAxisEnds` when they differ from the last ones
// handed over, so a redraw that moves nothing sets no state.
function useAxisEndsReport(onAxisEnds) {
    const last = useRef(undefined);
    const report = useRef(null);
    report.current = chart => {
        const ends = drawnAxisEnds(chart);
        if (String(ends) === String(last.current)) return;
        last.current = ends;
        onAxisEnds(ends);
    };
    return report;
}

export function CurveChart({ table, backdrops, labels, dragOn, onDragPoint, yRange, onAxisEnds, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const zoomWatched = useRef(null);
    const colors = { background: c.bg, paper: c.panel, grid: c.border, text: c.text, accent: c.accent };
    const option = curveChartOption(table, {
        colors, backdrops, labels, dragOn, yRange, errorColor: c.error || '#ef5350',
    });
    const geometry = useMemo(() => (dragOn ? pointGeometry(table) : []), [dragOn, table]);
    const report = useAxisEndsReport(onAxisEnds);
    useEffect(() => {
        const chart = drawChart(divRef.current, chartRef, option);
        if (!chart) return;
        // A zoom moves the axis without a redraw.
        if (zoomWatched.current !== chart) {
            chart.on('datazoom', () => report.current(chart));
            zoomWatched.current = chart;
        }
        report.current(chart);
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 160, overflow: 'hidden' } },
        h('div', { ref: divRef, style: { position: 'absolute', inset: 0 } }),
        h(TargetEditorOverlay, {
            chartRef, geometry, enabled: dragOn, tool: 'move', handleFill: c.panel, onEdit: onDragPoint,
        }),
    );
}
