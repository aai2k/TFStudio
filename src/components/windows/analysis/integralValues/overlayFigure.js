function overlayCharColor(char) {
    return char === 'T' ? '#4fc3f7' : char === 'R' ? '#ef5350' : '#66bb6a';
}

function overlayWeightValues(lambda, weighting) {
    const sampler = weighting && weighting.kind !== 'photopic' ? weighting.sampler : null;
    if (!sampler) return null;
    const raw = lambda.map(value =>
        (value >= weighting.lamMin && value <= weighting.lamMax) ? sampler(value) : 0);
    const maximum = Math.max(...raw, 1e-30);
    return raw.map(value => 100 * value / maximum);
}

function spectrumTrace(spectrum, char) {
    return {
        x: spectrum.lambda,
        y: (spectrum[char] || []).map(value => value * 100),
        type: 'scatter', mode: 'lines',
        name: `${char}(λ)`,
        line: { color: overlayCharColor(char), width: 2 },
        hovertemplate: `%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function weightingTrace(lambda, weighting, values) {
    return {
        x: lambda, y: values,
        type: 'scatter', mode: 'lines',
        name: `${weighting?.label || ''} (norm.)`,
        line: { color: '#ffd54f', width: 1, dash: 'dot' },
        yaxis: 'y',
        hovertemplate: `%{x:.1f} nm<br>w(λ): %{y:.1f}%<extra></extra>`,
    };
}

function minimumTrace(char, marks) {
    return {
        x: [marks.lamAtMin], y: [marks.min * 100],
        type: 'scatter', mode: 'markers',
        name: `min ${(marks.min * 100).toFixed(2)}% @ ${marks.lamAtMin.toFixed(0)} nm`,
        marker: { color: '#ef5350', size: 9, symbol: 'triangle-down', line: { color: '#fff', width: 1 } },
        hovertemplate: `min<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function maximumTrace(char, marks) {
    return {
        x: [marks.lamAtMax], y: [marks.max * 100],
        type: 'scatter', mode: 'markers',
        name: `max ${(marks.max * 100).toFixed(2)}% @ ${marks.lamAtMax.toFixed(0)} nm`,
        marker: { color: '#66bb6a', size: 9, symbol: 'triangle-up', line: { color: '#fff', width: 1 } },
        hovertemplate: `max<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function overlayTraces(spectrum, char, weighting, marks) {
    const traces = [spectrumTrace(spectrum, char)];
    const weightValues = overlayWeightValues(spectrum.lambda, weighting);
    if (weightValues) traces.push(weightingTrace(spectrum.lambda, weighting, weightValues));
    if (marks && Number.isFinite(marks.lamAtMin)) traces.push(minimumTrace(char, marks));
    if (marks && Number.isFinite(marks.lamAtMax)) traces.push(maximumTrace(char, marks));
    return traces;
}

function overlayLayout(char, colors) {
    return {
        paper_bgcolor: colors.panel,
        plot_bgcolor: colors.bg,
        margin: { l: 52, r: 16, t: 16, b: 44 },
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Wavelength (nm)', standoff: 8 },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
        yaxis: {
            title: { text: `${char} (%)  /  w(λ) (% max)`, standoff: 8 },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
            rangemode: 'tozero',
        },
        legend: {
            x: 1, xanchor: 'right', y: 1, yanchor: 'top',
            bgcolor: colors.panel + 'cc', bordercolor: colors.grid, borderwidth: 1,
            font: { size: 10 },
        },
        hovermode: 'x unified',
    };
}

export function buildOverlayFigure(spectrum, char, weighting, minMaxMarks, colors) {
    if (!spectrum?.lambda) return { data: [], layout: {} };
    return {
        data: overlayTraces(spectrum, char, weighting, minMaxMarks),
        layout: overlayLayout(char, colors),
    };
}
