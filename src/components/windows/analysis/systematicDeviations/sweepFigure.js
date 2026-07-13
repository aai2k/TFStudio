const COLOR_SCALES = {
    R: [[0, '#1e1e1e'], [0.3, '#7a2222'], [0.6, '#d04545'], [1, '#fff5f5']],
    A: [[0, '#1e1e1e'], [0.3, '#2a5a2a'], [0.6, '#4caf50'], [1, '#e8f5e8']],
    T: [[0, '#1e1e1e'], [0.3, '#1a3a5a'], [0.6, '#4fc3f7'], [1, '#e8f4fc']],
};

const DATA_KEYS = { R: 'R2D', A: 'A2D', T: 'T2D' };
const percent2D = (values) => values.map(row => row.map(value => value * 100));

export function sweepHeatmapTraces(sweepData, channels, colors) {
    const count = channels.length;
    return channels.map((channel, index) => {
        const suffix = index === 0 ? '' : String(index + 1);
        const top = 1 - index / count;
        const bottom = 1 - (index + 1) / count;
        return {
            x: sweepData.lambda,
            y: sweepData.paramValues,
            z: percent2D(sweepData[DATA_KEYS[channel]]),
            type: 'heatmap',
            colorscale: COLOR_SCALES[channel],
            zmin: 0, zmax: 100,
            xaxis: 'x' + suffix,
            yaxis: 'y' + suffix,
            colorbar: {
                title: { text: `${channel} (%)`, font: { color: colors.text, size: 11 } },
                tickfont: { color: colors.text, size: 9 },
                outlinecolor: colors.border, bgcolor: 'rgba(0,0,0,0)',
                len: count > 1 ? (1 / count) * 0.82 : 0.85, thickness: 12,
                y: (top + bottom) / 2, yanchor: 'middle',
            },
            hovertemplate: `λ=%{x:.1f} nm<br>param=%{y:.4g}<br>${channel}=%{z:.3f}%<extra></extra>`,
        };
    });
}

export function sweepHeatmapLayout(sweepData, channels, colors) {
    const count = channels.length;
    const layout = {
        paper_bgcolor: colors.panel || '#252526',
        plot_bgcolor: colors.bg || '#1e1e1e',
        margin: { l: 64, r: 16, t: 16, b: 44 },
        grid: count > 1 ? { rows: count, columns: 1, pattern: 'independent', roworder: 'top to bottom' } : undefined,
    };
    channels.forEach((channel, index) => {
        addAxes(layout, sweepData, channel, { index, count, colors });
    });
    return layout;
}

function addAxes(layout, sweepData, channel, axis) {
    const { index, count, colors } = axis;
    const suffix = index === 0 ? '' : String(index + 1);
    layout['xaxis' + suffix] = {
        title: index === count - 1 ? { text: 'λ (nm)', font: { color: colors.text, size: 12 } } : undefined,
        color: colors.text, gridcolor: colors.border, zerolinecolor: colors.border,
        tickfont: { color: colors.text, size: 10 },
    };
    layout['yaxis' + suffix] = {
        title: { text: count > 1 ? channel : (sweepData.paramName || 'Parameter'), font: { color: colors.text, size: 12 } },
        color: colors.text, gridcolor: colors.border, zerolinecolor: colors.border,
        tickfont: { color: colors.text, size: 10 },
    };
}

export function buildSweepFigure(sweepData, channel, colors) {
    if (!sweepData?.lambda?.length) return { data: [], layout: {} };
    const channels = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    return {
        data: sweepHeatmapTraces(sweepData, channels, colors),
        layout: sweepHeatmapLayout(sweepData, channels, colors),
    };
}
