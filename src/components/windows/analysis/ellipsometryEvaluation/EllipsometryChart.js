import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

const { createElement: h, useEffect, useRef } = React;

// A measured Ψ or Δ, drawn the way Optical Evaluation draws a measured
// spectrum: the same colour as its calculated counterpart would use unless the
// curve carries one of its own, dotted, with the readings marked as hollow
// points so a measurement is never mistaken for a computed line.
function measuredSeries(overlays, curve) {
    return (overlays || []).map(overlay => lineSeries({
        x: overlay.x, y: overlay.y,
        name: `${overlay.name} (${overlay.psi ? 'Ψ' : 'Δ'} meas @ ${overlay.aoi}°)`,
        color: overlay.color || (overlay.psi ? curve.psi : curve.delta),
        width: 1.4, dash: 'dotted', symbol: 'emptyCircle', symbolSize: 4,
        yAxisIndex: overlay.psi ? 0 : 1,
    }));
}

export function buildEllipsometryOption(
    data, colors,
    curve = ANALYSIS_DEFAULTS.ellipsometryEvaluation.colors,
    show = { psi: true, delta: true },
    overlays = [],
) {
    const series = [
        show.psi && lineSeries({ x: data.x, y: data.psi, name: 'Ψ', color: curve.psi, width: 2, yAxisIndex: 0 }),
        show.delta && lineSeries({ x: data.x, y: data.delta, name: 'Δ', color: curve.delta, width: 2, yAxisIndex: 1 }),
        ...measuredSeries(overlays, curve),
    ].filter(Boolean);
    // Ψ and Δ have different ranges and need an axis each, but two sets of grid
    // lines across one plot read as neither. The grid belongs to Ψ while both are
    // drawn, and to whichever one is actually on screen otherwise: a hidden axis
    // draws no lines, so leaving it on Ψ would leave a Δ-only plot with no grid
    // at all.
    const gridAxis = show.psi ? 0 : 1;
    return cartesianOption({
        colors,
        grid: plotMargin({ rightAxis: !!show.delta }),
        fileName: 'ellipsometry',
        tooltip: axisTooltip({ colors, valueSuffix: '°', series }),
        xAxis: valueAxis({ name: data.xLabel, color: colors.text, gridColor: colors.grid }),
        yAxis: [
            valueAxis({ name: '°', color: curve.psi, gridColor: colors.grid, min: 0, max: 90, interval: 10, position: 'left' }),
            { ...valueAxis({ name: '°', color: curve.delta, gridColor: colors.grid, min: 0, max: 360, position: 'right' }), interval: 60 },
        ].map((axis, index) => ({
            ...axis,
            show: index === 0 ? !!show.psi : !!show.delta,
            splitLine: { ...axis.splitLine, show: index === gridAxis },
        })),
        series,
    });
}

export function EllipsometryChart({ data, c, show = { psi: true, delta: true }, overlays = [] }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('ellipsometryEvaluation');
    const colors = {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    useEffect(() => {
        if (data) drawChart(divRef.current, chartRef, buildEllipsometryOption(data, colors, curve, show, overlays));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
