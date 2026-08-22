import { buildGDChartOption } from './chartModel.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function GDChart({ data, meta, refLambda, showRef, targets = [], yRange, yInterval, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    useEffect(() => {
        if (data) drawChart(divRef.current, chartRef, buildGDChartOption({
            data, meta, referenceLambda: refLambda, showReference: showRef,
            targets, yRange, yInterval, colors,
        }));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
