import { buildSweepOption } from './sweepFigure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function SweepHeatmap({ sweepData, channel, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawChart(divRef.current, chartRef, buildSweepOption(sweepData, channel, {
        text: c.text, border: c.border, panel: c.panel, bg: c.bg,
    })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
