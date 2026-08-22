import { buildSpectraOption, spectraColors } from './figure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function SpectraChart({ c, data, t }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildSpectraOption(data, spectraColors(c), t.processSim)); });
    useChartTeardown(divRef, chartRef);
    if (typeof echarts === 'undefined') return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
    }, 'ECharts not loaded');
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
