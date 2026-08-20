import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { axisTitle, chartConfig, plotMargin, TICK_FONT } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

const { createElement: h, useEffect, useRef } = React;

const CHART_CONFIG = chartConfig('ellipsometry');

/**
 * Ψ and Δ are read against their own vertical axis, so hiding one curve hides
 * its axis with it rather than leaving an unused scale on that edge.
 *
 * @param {object} data
 * @param {object} colors  theme colours (background, paper, grid, text)
 * @param {object} [curve] configured curve colours; factory defaults when absent
 * @param {object} [show]  which curves are plotted, { psi, delta }
 */
export function buildEllipsometryFigure(
    data, colors,
    curve = ANALYSIS_DEFAULTS.ellipsometryEvaluation.colors,
    show = { psi: true, delta: true },
) {
    const PSI_COLOR = curve.psi;
    const DELTA_COLOR = curve.delta;
    const traces = [
        show.psi && {
            x: data.x, y: data.psi, type: 'scatter', mode: 'lines',
            name: 'Ψ', yaxis: 'y',
            line: { color: PSI_COLOR, width: 2 },
            hovertemplate: 'Ψ: %{y:.3f}°<br>%{x:.3f}<extra></extra>',
        },
        show.delta && {
            x: data.x, y: data.delta, type: 'scatter', mode: 'lines',
            name: 'Δ', yaxis: 'y2',
            line: { color: DELTA_COLOR, width: 2 },
            hovertemplate: 'Δ: %{y:.3f}°<br>%{x:.3f}<extra></extra>',
        },
    ].filter(Boolean);
    const layout = {
        paper_bgcolor: colors.paper,
        plot_bgcolor: colors.background,
        margin: plotMargin({ rightAxis: !!show.delta }),
        showlegend: true,
        // Left-anchored above the plot, as in GD/GDD: the modebar occupies the
        // right-hand end of that strip.
        legend: { x: 0, y: 1.02, orientation: 'h',
                  font: { size: 10, color: colors.text }, bgcolor: 'transparent' },
        xaxis: {
            title: axisTitle(data.xLabel, { color: colors.text }),
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { color: colors.text, ...TICK_FONT },
        },
        yaxis: {
            title: axisTitle('Ψ (°)', { color: PSI_COLOR }),
            range: [0, 90], color: PSI_COLOR, gridcolor: colors.grid,
            zerolinecolor: colors.grid, tickfont: { color: PSI_COLOR, ...TICK_FONT },
            visible: !!show.psi,
        },
        yaxis2: {
            title: axisTitle('Δ (°)', { color: DELTA_COLOR }),
            range: [0, 360], dtick: 60, overlaying: 'y', side: 'right',
            color: DELTA_COLOR, tickfont: { color: DELTA_COLOR, ...TICK_FONT },
            showgrid: false, visible: !!show.delta,
        },
    };
    return { traces, layout };
}

export function EllipsometryChart({ data, c, show = { psi: true, delta: true } }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('ellipsometryEvaluation');
    const colors = {
        background: c.bg || '#1e1e1e',
        paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };

    // No dependency list: see plotSurface.js for why every render redraws.
    useEffect(() => {
        if (!data) return;
        const { traces, layout } = buildEllipsometryFigure(data, colors, curve, show);
        drawPlot(divRef.current, initRef, traces, layout,
            CHART_CONFIG);
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
