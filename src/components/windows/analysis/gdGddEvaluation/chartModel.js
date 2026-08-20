import { buildGdGddTargetOverlay } from './gdTargets.js';
import { plotMargin } from '../chrome/plot.js';

export function buildGDChartModel(options) {
    const { data, meta, referenceLambda, showReference, colors, targets = [], yRange } = options;
    const series = data.series || [{ name: meta.label, y: data.y, color: meta.color, width: 2 }];
    const traces = series.map(item => ({
        x: data.lambda, y: item.y, type: 'scatter', mode: 'lines',
        name: item.name, line: { color: item.color, width: item.width || 2 },
        hovertemplate: `%{y:.${meta.dp}f} ${meta.unit}<br>%{x:.2f} nm<extra>${series.length > 1 ? item.name : ''}</extra>`,
    }));
    const targetOverlay = buildGdGddTargetOverlay(targets, meta);
    traces.push(...targetOverlay.traces);
    const shapes = [...targetOverlay.shapes];
    if (showReference && referenceLambda >= Math.min(...data.lambda) &&
        referenceLambda <= Math.max(...data.lambda)) {
        shapes.push({
            type: 'line', x0: referenceLambda, x1: referenceLambda, yref: 'paper',
            y0: 0, y1: 1, line: { color: colors.text, width: 1, dash: 'dot' },
        });
    }
    const layout = {
        paper_bgcolor: colors.paper,
        plot_bgcolor: colors.background,
        margin: plotMargin(),
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        showlegend: series.length > 1,
        legend: { orientation: 'h', x: 0, y: 1.02, font: { color: colors.text, size: 10 } },
        shapes,
        xaxis: {
            title: { text: 'Wavelength (nm)', standoff: 8 },
            gridcolor: colors.grid, gridwidth: 1, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
        // Axis furniture stays in the text colour, as it is in Optical
        // Evaluation; the curve carries the quantity's colour on its own.
        yaxis: {
            title: { text: meta.label, standoff: 8 },
            ...(Array.isArray(yRange) && yRange.every(Number.isFinite) && yRange[0] < yRange[1]
                ? { range: [yRange[0], yRange[1]] }
                : { autorange: true }),
            gridcolor: colors.grid, gridwidth: 1, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
    };
    return { traces, layout };
}
