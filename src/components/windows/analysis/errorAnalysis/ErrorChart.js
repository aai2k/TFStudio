import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { axisTitle, chartConfig, legendAbove, plotMargin, TICK_FONT } from '../chrome/plot.js';

const { createElement: h, useEffect, useRef } = React;

const toPercent = (values) => values.map((value) => value * 100);

function corridorArrays(result, corridorSigma) {
    const k = corridorSigma > 0 ? corridorSigma : 1;
    const mean = result.mean || [];
    const sd = result.stdev || null;
    const lower = sd
        ? mean.map((value, i) => Math.max(0, value - k * sd[i]))
        : (result.lower || []);
    const upper = sd
        ? mean.map((value, i) => Math.min(1, value + k * sd[i]))
        : (result.upper || []);
    return { k, mean, lower, upper };
}

function baseTraces({ result, char, charColor, corridorSigma }) {
    const lam = result.lambda;
    const { k, lower, upper } = corridorArrays(result, corridorSigma);
    const kLabel = Math.round(k * 100) / 100;
    return [
        {
            x: lam, y: toPercent(lower),
            type: 'scatter', mode: 'lines',
            line: { color: charColor, width: 0 },
            showlegend: false,
            hovertemplate: `%{x:.1f} nm<br>lower (−${kLabel}σ): %{y:.3f}%<extra></extra>`,
        },
        {
            x: lam, y: toPercent(upper),
            type: 'scatter', mode: 'lines',
            fill: 'tonexty', fillcolor: charColor + '33',
            line: { color: charColor, width: 0 },
            name: `Corridor (±${kLabel}σ)`,
            hovertemplate: `%{x:.1f} nm<br>upper (+${kLabel}σ): %{y:.3f}%<extra></extra>`,
        },
        {
            x: lam, y: toPercent(result.mean),
            type: 'scatter', mode: 'lines',
            line: { color: charColor, width: 1.5, dash: 'dot' },
            name: 'Exp (mean)',
            hovertemplate: `%{x:.1f} nm<br>Exp: %{y:.3f}%<extra></extra>`,
        },
        {
            x: lam, y: toPercent(result.theory),
            type: 'scatter', mode: 'lines',
            line: { color: charColor, width: 2 },
            name: `${char} theoretical`,
            hovertemplate: `%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
        },
    ];
}

function appendEnvelope(traces, { result, charColor, showEnvelope }) {
    if (!showEnvelope || !result.envLower || !result.envUpper) return;
    const lam = result.lambda;
    traces.push({
        x: lam, y: toPercent(result.envLower),
        type: 'scatter', mode: 'lines', opacity: 0.6,
        line: { color: charColor, width: 1, dash: 'dash' },
        showlegend: false,
        hovertemplate: `%{x:.1f} nm<br>min: %{y:.3f}%<extra></extra>`,
    });
    traces.push({
        x: lam, y: toPercent(result.envUpper),
        type: 'scatter', mode: 'lines', opacity: 0.6,
        line: { color: charColor, width: 1, dash: 'dash' },
        name: 'Min/max envelope',
        hovertemplate: `%{x:.1f} nm<br>max: %{y:.3f}%<extra></extra>`,
    });
}

/**
 * @param {object} [colors] configured curve colours; factory defaults when absent
 */
export function buildErrorFigure({
    result, char, c, corridorSigma = 1, showEnvelope = false,
    colors = ANALYSIS_DEFAULTS.errorAnalysis.colors,
}) {
    if (!result) return { data: [], layout: {} };
    const bgColor = c.bg || '#1e1e1e';
    const paperColor = c.panel || '#252526';
    const gridColor = c.border || '#3a3a3a';
    const textColor = c.text || '#cccccc';
    const charColor = colors[char] || colors.A;
    const data = baseTraces({ result, char, charColor, corridorSigma });
    appendEnvelope(data, { result, charColor, showEnvelope });
    const layout = {
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        margin: plotMargin(),
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: axisTitle('λ (nm)'),
            gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: TICK_FONT, color: textColor,
        },
        yaxis: {
            title: axisTitle(`${char} (%)`),
            gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: TICK_FONT, color: textColor,
            rangemode: 'tozero',
        },
        legend: legendAbove({ color: textColor }),
        hovermode: 'x unified',
    };
    return { data, layout };
}

export function ErrorChart(props) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = useAnalysisColors('errorAnalysis');
    // No dependency list, and the figure is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        const figure = buildErrorFigure({ ...props, colors });
        drawPlot(divRef.current, initRef, figure.data, figure.layout, chartConfig('montecarlo'));
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
