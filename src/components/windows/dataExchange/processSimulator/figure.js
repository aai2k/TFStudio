function stepColor(index, count, alpha = 0.55) {
    const hue = count <= 1 ? 200 : 220 - (index / (count - 1)) * 220;
    return `hsla(${hue}, 70%, 55%, ${alpha})`;
}

export function spectraColors(c) {
    return {
        bg: c.bg || '#1e1e1e',
        panel: c.panel || '#252526',
        grid: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
        accent: c.accent || '#3aafff',
    };
}

function baselineTrace(data, colors, sp) {
    return {
        x: data.lambdas, y: data.baseline.map(value => value * 100),
        name: sp.legendBaseline,
        type: 'scatter', mode: 'lines',
        line: { color: colors.text, width: 1, dash: 'dot' },
        opacity: 0.55,
        hovertemplate: `%{x:.1f} nm<br>${data.quantity}: %{y:.3f}%<extra>${sp.legendBaseline}</extra>`,
    };
}

function stepTraces(data, sp) {
    const count = data.stepCurves.length;
    const traces = [];
    for (let index = 0; index < count; index++) {
        const current = index + 1 === data.currentStep;
        traces.push({
            x: data.lambdas, y: data.stepCurves[index].map(value => value * 100),
            name: sp.legendStep(index + 1),
            type: 'scatter', mode: 'lines',
            line: {
                color: stepColor(index, count, current ? 0.95 : 0.45),
                width: current ? 2 : 1.1,
            },
            hovertemplate: `%{x:.1f} nm<br>${data.quantity}: %{y:.3f}%<extra>${sp.legendStep(index + 1)}</extra>`,
        });
    }
    return traces;
}

function liveTrace(data, colors, sp) {
    return {
        x: data.lambdas, y: data.liveCurve.map(value => value * 100),
        name: sp.legendLive,
        type: 'scatter', mode: 'lines',
        line: { color: colors.accent, width: 2.6 },
        hovertemplate: `%{x:.1f} nm<br>${data.quantity}: %{y:.3f}%<extra>${sp.legendLive}</extra>`,
    };
}

export function spectraTraces(data, colors, sp) {
    const traces = [];
    if (data.baseline) traces.push(baselineTrace(data, colors, sp));
    if (data.showSteps && data.stepCurves) traces.push(...stepTraces(data, sp));
    if (data.liveCurve) traces.push(liveTrace(data, colors, sp));
    return traces;
}

export function spectraLayout(quantity, colors) {
    return {
        margin: { l: 52, r: 16, t: 12, b: 42 },
        paper_bgcolor: colors.panel,
        plot_bgcolor: colors.bg,
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Wavelength (nm)', standoff: 6 },
            gridcolor: colors.grid, gridwidth: 1, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
        yaxis: {
            title: { text: `${quantity} (%)`, standoff: 6 },
            range: [0, 100],
            gridcolor: colors.grid, gridwidth: 1, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
        legend: {
            bgcolor: colors.panel + 'cc', bordercolor: colors.grid, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top',
        },
        hovermode: 'x unified',
        autosize: true,
    };
}

export const SPECTRA_CONFIG = {
    displaylogo: false, responsive: true, displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    toImageButtonOptions: { format: 'png', filename: 'TFStudio_process', scale: 2 },
};
