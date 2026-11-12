import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
import { plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';

const { createElement: h, useEffect, useRef } = React;

// Δ is drawn on a 0 to 360° axis. An instrument may write it in another range,
// CompleteEASE in -90 to 270°, and a reading of -12° is 348° on this axis
// rather than a point below it. A curve that runs past the top of the axis
// comes back at the bottom, measured and calculated alike.
const onDeltaAxis = values => (values || []).map(value => ((value % 360) + 360) % 360);

// A drawn curve's legend name. A fit target drawn from its snapshot is named as
// a target, not as a measurement. `names` is t.legendNames; without it a curve
// goes by its own name.
function overlayName(overlay, names) {
    if (!names) return overlay.name;
    const nameAt = overlay.fitTarget ? names.fitTargetAt : names.measuredAt;
    return nameAt(overlay.name, overlay.psi ? 'Ψ' : 'Δ', overlay.aoi);
}

// A measured Ψ or Δ, drawn the way Optical Evaluation draws a measured
// spectrum: the same colour as its calculated counterpart would use unless the
// curve carries one of its own, dotted, with the readings marked as hollow
// points so a measurement is never mistaken for a computed line.
function measuredSeries(overlays, curve, names) {
    return (overlays || []).map(overlay => lineSeries({
        x: overlay.x, y: overlay.psi ? overlay.y : onDeltaAxis(overlay.y),
        name: overlayName(overlay, names),
        color: overlay.color || (overlay.psi ? curve.psi : curve.delta),
        width: 1.4, dash: 'dotted', symbol: 'emptyCircle', symbolSize: 4,
        yAxisIndex: overlay.psi ? 0 : 1,
    }));
}

// The calculated curves: Ψ and Δ in their own colours, or under All (`sets`,
// each `{ env, data }`) Ψ solid and Δ dashed in each environment's colour,
// named after it for the readout.
function computedSeries(data, sets, curve, show) {
    if (!sets) {
        return [
            show.psi && lineSeries({ x: data.x, y: data.psi, name: 'Ψ', color: curve.psi, width: 2, yAxisIndex: 0 }),
            show.delta && lineSeries({ x: data.x, y: onDeltaAxis(data.delta), name: 'Δ', color: curve.delta, width: 2, yAxisIndex: 1 }),
        ];
    }
    return sets.flatMap(({ env, data: one }) => {
        const color = environmentColor(curve, env.number);
        return [
            show.psi && lineSeries({ x: one.x, y: one.psi, name: `Ψ (${env.label})`, color, width: 2, yAxisIndex: 0 }),
            show.delta && lineSeries({
                x: one.x, y: onDeltaAxis(one.delta), name: `Δ (${env.label})`, color, width: 2, dash: 'dashed', yAxisIndex: 1,
            }),
        ];
    });
}

/**
 * `spectral` says the x axis is wavelength in nm; otherwise it is the angle of
 * incidence. `sets`, under All, holds each environment's sweep, `{ env, data }`.
 */
export function buildEllipsometryOption(data, colors, xLabel, {
    curve = ANALYSIS_DEFAULTS.ellipsometryEvaluation.colors,
    show = { psi: true, delta: true },
    overlays = [],
    spectral = false,
    names,
    sets = null,
} = {}) {
    const series = [
        ...computedSeries(data, sets, curve, show),
        ...measuredSeries(overlays, curve, names),
    ].filter(Boolean);
    // Under All colour names environments, so the axes are named Ψ and Δ in
    // the text colour, and the legend above the plot names each environment.
    const key = sets ? environmentLegend(sets.map(set => set.env), curve, colors.text) : null;
    const axisNames = sets ? ['Ψ (°)', 'Δ (°)'] : ['°', '°'];
    const axisColors = sets ? [colors.text, colors.text] : [curve.psi, curve.delta];
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
        legend: key?.legend,
        tooltip: axisTooltip({ colors, valueSuffix: '°', series }),
        xAxis: valueAxis({ name: xLabel, color: colors.text, gridColor: colors.grid, wavelength: spectral }),
        yAxis: [
            valueAxis({ name: axisNames[0], color: axisColors[0], gridColor: colors.grid, min: 0, max: 90, interval: 10, position: 'left' }),
            { ...valueAxis({ name: axisNames[1], color: axisColors[1], gridColor: colors.grid, min: 0, max: 360, position: 'right' }), interval: 60 },
        ].map((axis, index) => ({
            ...axis,
            show: index === 0 ? !!show.psi : !!show.delta,
            splitLine: { ...axis.splitLine, show: index === gridAxis },
        })),
        series: key ? [...series, ...key.series] : series,
    });
}

export function EllipsometryChart({ data, sets, c, xLabel, spectral, show = { psi: true, delta: true }, overlays = [], names }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('ellipsometryEvaluation');
    const colors = {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    useEffect(() => {
        if (data) drawChart(divRef.current, chartRef, buildEllipsometryOption(data, colors, xLabel, { curve, show, overlays, spectral, names, sets }));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
