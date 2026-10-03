/**
 * The curve editor's plot, with the points draggable through the shared
 * target editor overlay. A dragged point keeps its wavelength and takes the
 * value it was dropped at.
 */
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { TargetEditorOverlay } from '../../../ui/TargetEditorOverlay.js';
import { curveChartOption, pointGeometry } from './chartModel.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function CurveChart({ table, backdrops, labels, dragOn, onDragPoint, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = { background: c.bg, paper: c.panel, grid: c.border, text: c.text, accent: c.accent };
    const option = curveChartOption(table, {
        colors, backdrops, labels, dragOn, errorColor: c.error || '#ef5350',
    });
    const geometry = useMemo(() => (dragOn ? pointGeometry(table) : []), [dragOn, table]);
    useEffect(() => { drawChart(divRef.current, chartRef, option); });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 160, overflow: 'hidden' } },
        h('div', { ref: divRef, style: { position: 'absolute', inset: 0 } }),
        h(TargetEditorOverlay, {
            chartRef, geometry, enabled: dragOn, tool: 'move', handleFill: c.panel, onEdit: onDragPoint,
        }),
    );
}
