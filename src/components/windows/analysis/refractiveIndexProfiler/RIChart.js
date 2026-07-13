const { createElement: h, useEffect, useRef } = React;

export function riChartTraces(profile, quantity) {
    if (!profile) return [];
    const traces = [];
    if (quantity === 'n' || quantity === 'both') {
        traces.push({
            x: profile.z, y: profile.n,
            type: 'scatter', mode: 'lines',
            name: 'n',
            line: { color: '#4fc3f7', width: 2, shape: 'hv' },
            hovertemplate: 'n<br>z: %{x:.1f} nm<br>n: %{y:.4f}<extra></extra>',
        });
    }
    if (quantity === 'k' || quantity === 'both') {
        traces.push({
            x: profile.z, y: profile.k,
            type: 'scatter', mode: 'lines',
            name: 'k',
            yaxis: quantity === 'both' ? 'y2' : 'y',
            line: { color: '#ef5350', width: 2, shape: 'hv',
                    dash: quantity === 'both' ? 'dash' : 'solid' },
            hovertemplate: 'k<br>z: %{x:.1f} nm<br>k: %{y:.5f}<extra></extra>',
        });
    }
    return traces;
}

export function riChartLayout(profile, quantity, matColorMap, colors) {
    const { bgColor, paperColor, gridColor, textColor } = colors;
    const bounds = profile?.layerBounds || [];
    const totalZ = profile?.totalThk || 0;
    const z0 = profile?.z?.[0] ?? 0;
    const zEnd = profile?.z?.[profile.z.length - 1] ?? totalZ;
    const shapes = [];

    const validLayers = profile?.validLayers || [];
    for (let kk = 0; kk < validLayers.length && kk + 1 < bounds.length; kk++) {
        const color = matColorMap[validLayers[kk]?.materialId] || '#555555';
        shapes.push({
            type: 'rect',
            x0: bounds[kk], x1: bounds[kk + 1], xref: 'x',
            y0: 0, y1: 1, yref: 'paper',
            fillcolor: color, opacity: 0.14,
            layer: 'below', line: { width: 0 },
        });
    }
    for (const b of bounds.slice(1, -1)) {
        shapes.push({
            type: 'line', x0: b, x1: b, y0: 0, y1: 1, yref: 'paper',
            line: { color: gridColor, width: 1, dash: 'dot' },
        });
    }

    const showN = quantity === 'n' || quantity === 'both';
    const layout = {
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        margin: { l: 56, r: quantity === 'both' ? 56 : 16, t: 10, b: 45 },
        showlegend: quantity === 'both',
        legend: { x: 1, xanchor: 'right', y: 1,
                  font: { size: 11, color: textColor }, bgcolor: 'transparent' },
        xaxis: {
            range: [z0, zEnd],
            title: { text: 'Depth (nm)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 },
        },
        yaxis: {
            title: { text: showN ? 'n' : 'k', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 },
            rangemode: 'tozero',
        },
        shapes,
    };
    if (quantity === 'both') {
        layout.yaxis2 = {
            title: { text: 'k', font: { color: '#ef5350', size: 12 } },
            color: '#ef5350', overlaying: 'y', side: 'right',
            tickfont: { color: '#ef5350', size: 11 },
            showgrid: false, rangemode: 'tozero',
        };
    }
    return layout;
}

export function RIChart({ profile, quantity, matColorMap, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = {
        bgColor: c.bg || '#1e1e1e',
        paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a',
        textColor: c.text || '#cccccc',
    };

    useEffect(() => {
        if (!divRef.current) return;
        const traces = riChartTraces(profile, quantity);
        const layout = riChartLayout(profile, quantity, matColorMap, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [profile, quantity, matColorMap, c]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
