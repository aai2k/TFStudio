import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

const { createElement: h, useEffect, useRef } = React;

export function buildEllipsometryOption(
    data, colors,
    curve = ANALYSIS_DEFAULTS.ellipsometryEvaluation.colors,
    show = { psi: true, delta: true },
) {
    const series = [
        show.psi && lineSeries({ x: data.x, y: data.psi, name: 'Ψ', color: curve.psi, width: 2, yAxisIndex: 0 }),
        show.delta && lineSeries({ x: data.x, y: data.delta, name: 'Δ', color: curve.delta, width: 2, yAxisIndex: 1 }),
    ].filter(Boolean);
    return cartesianOption({
        colors,
        grid: plotMargin({ rightAxis: !!show.delta }),
        fileName: 'ellipsometry',
        tooltip: axisTooltip({ colors, valueSuffix: '°' }),
        xAxis: valueAxis({ name: data.xLabel, color: colors.text, gridColor: colors.grid }),
        yAxis: [
            valueAxis({ name: '°', color: curve.psi, gridColor: colors.grid, min: 0, max: 90, interval: 10, position: 'left' }),
            { ...valueAxis({ name: '°', color: curve.delta, gridColor: colors.grid, min: 0, max: 360, position: 'right', splitLine: false }), interval: 60 },
        ].map((axis, index) => ({ ...axis, show: index === 0 ? !!show.psi : !!show.delta })),
        series,
    });
}

export function EllipsometryChart({ data, c, show = { psi: true, delta: true } }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('ellipsometryEvaluation');
    const colors = {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    useEffect(() => {
        if (data) drawChart(divRef.current, chartRef, buildEllipsometryOption(data, colors, curve, show));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
