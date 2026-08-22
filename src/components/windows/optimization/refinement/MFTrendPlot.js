// Compact merit-function trend plot used during and after refinement.
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { cartesianOption, itemTooltip, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

const { createElement: h, useRef, useEffect } = React;

export function MFTrendPlot({ history, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => {
        const series = lineSeries({
            x: history.map(point => point.iter), y: history.map(point => point.mf),
            name: 'MF', color: '#ffa726', width: 1.5,
            symbol: history.length === 1 ? 'circle' : 'none', symbolSize: 5,
        });
        drawChart(divRef.current, chartRef, cartesianOption({
            colors: c,
            grid: { left: 58, right: 8, top: 6, bottom: 28 },
            tooltip: itemTooltip(),
            xAxis: valueAxis({ name: 'Iteration', color: c.text, gridColor: c.border, nameGap: 22 }),
            yAxis: { ...valueAxis({ name: 'MF', color: c.text, gridColor: c.border, nameGap: 34 }), type: 'log' },
            series: [series],
        }));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
