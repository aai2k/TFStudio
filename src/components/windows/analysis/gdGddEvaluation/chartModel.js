export function buildGDChartModel(options) {
    const { data, meta, referenceLambda, showReference, colors } = options;
    const traces = [{
        x: data.lambda, y: data.y, type: 'scatter', mode: 'lines',
        name: meta.label, line: { color: meta.color, width: 2 },
        hovertemplate: `%{y:.${meta.dp}f} ${meta.unit}<br>%{x:.2f} nm<extra></extra>`,
    }];
    const shapes = [];
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
        margin: { l: 64, r: 16, t: 12, b: 46 },
        showlegend: false,
        shapes,
        xaxis: {
            title: { text: 'Wavelength (nm)', font: { color: colors.text, size: 12 } },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { color: colors.text, size: 11 },
        },
        yaxis: {
            title: { text: meta.label, font: { color: meta.color, size: 12 } },
            color: meta.color, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { color: meta.color, size: 11 },
        },
    };
    return { traces, layout };
}
