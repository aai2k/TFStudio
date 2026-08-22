import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

const { createElement: h, useEffect, useRef } = React;
const toPercent = values => values.map(value => value * 100);

function corridorArrays(result, corridorSigma) {
    const k = corridorSigma > 0 ? corridorSigma : 1;
    const mean = result.mean || [];
    const sd = result.stdev || null;
    const lower = sd ? mean.map((value, i) => Math.max(0, value - k * sd[i])) : (result.lower || []);
    const upper = sd ? mean.map((value, i) => Math.min(1, value + k * sd[i])) : (result.upper || []);
    return { k, lower, upper };
}

export function buildErrorOption({
    result, char, c, corridorSigma = 1, showEnvelope = false,
    colors = ANALYSIS_DEFAULTS.errorAnalysis.colors,
}) {
    if (!result) return { series: [] };
    const background = c.bg || '#1e1e1e';
    const paper = c.panel || '#252526';
    const gridColor = c.border || '#3a3a3a';
    const text = c.text || '#cccccc';
    const color = colors[char] || colors.A;
    const { k, lower, upper } = corridorArrays(result, corridorSigma);
    const kLabel = Math.round(k * 100) / 100;
    const lowerPct = toPercent(lower);
    const corridorHeight = upper.map((value, i) => (value - lower[i]) * 100);
    const series = [
        lineSeries({
            x: result.lambda, y: lowerPct, name: '__corridor_base__', color: 'transparent',
            width: 0, stack: 'corridor', areaStyle: { color: 'transparent', opacity: 0 }, silent: true,
        }),
        lineSeries({
            x: result.lambda, y: corridorHeight, name: `Corridor (±${kLabel}σ)`, color,
            width: 0, stack: 'corridor', areaStyle: { color, opacity: 0.2 },
        }),
        lineSeries({ x: result.lambda, y: toPercent(result.mean), name: 'Exp (mean)', color, width: 1.5, dash: 'dot' }),
        lineSeries({ x: result.lambda, y: toPercent(result.theory), name: `${char} theoretical`, color, width: 2 }),
    ];
    if (showEnvelope && result.envLower && result.envUpper) {
        series.push(lineSeries({ x: result.lambda, y: toPercent(result.envLower), name: 'Envelope min', color, width: 1, dash: 'dash' }));
        series.push(lineSeries({ x: result.lambda, y: toPercent(result.envUpper), name: 'Min/max envelope', color, width: 1, dash: 'dash' }));
    }
    const legendNames = series.map(item => item.name).filter(name => name !== '__corridor_base__' && name !== 'Envelope min');
    return cartesianOption({
        colors: { background, paper, grid: gridColor, text },
        grid: plotMargin(),
        legend: { ...legendAbove({ color: text }), data: legendNames },
        fileName: 'montecarlo',
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'λ (nm)', color: text, gridColor }),
        yAxis: valueAxis({ name: '%', color: text, gridColor, min: 0, interval: 10 }),
        series,
    });
}

export function ErrorChart(props) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('errorAnalysis');
    useEffect(() => { drawChart(divRef.current, chartRef, buildErrorOption({ ...props, colors })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
