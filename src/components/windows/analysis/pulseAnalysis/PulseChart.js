import { buildPulseChartOption } from './chartModel.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function PulseChart({ view, mode, timeAxis, labels, c, curveColors, materialBands }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => {
        drawChart(divRef.current, chartRef, buildPulseChartOption({
            view, mode, timeAxis, labels, curveColors, materialBands,
            colors: {
                background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
                grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
            },
        }));
    }, [view, mode, timeAxis, labels, c, curveColors, materialBands]);
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' } },
        h('div', { ref: divRef, style: { position: 'absolute', inset: 0 } }));
}
