const COLORS = { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' };

export function buildOverlayTraces(baseline, perturbed, channel) {
    if (!perturbed) return [];
    const traces = [];
    const wantedKeys = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    const pct = values => values.map(value => value * 100);
    for (const key of wantedKeys) {
        if (baseline) {
            traces.push({
                x: baseline.lambda, y: pct(baseline[key]),
                type: 'scatter', mode: 'lines',
                name: `${key} homogeneous`,
                line: { color: COLORS[key], dash: 'dot', width: 1.4 },
                hoverinfo: 'skip',
                opacity: 0.55,
            });
        }
        traces.push({
            x: perturbed.lambda, y: pct(perturbed[key]),
            type: 'scatter', mode: 'lines',
            name: `${key} with interlayers`,
            line: { color: COLORS[key], width: 2 },
            hovertemplate: `λ=%{x:.1f} nm<br>${key}=%{y:.3f}%<extra></extra>`,
        });
    }
    return traces;
}

export function buildOverlayLayout(c) {
    return {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
        margin: { l: 56, r: 16, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'T / R / A (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102],
        },
        legend: {
            orientation: 'h', x: 0, y: 1.08,
            font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'x unified',
    };
}
