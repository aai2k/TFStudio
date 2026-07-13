const { createElement: h, useEffect, useRef } = React;

export function placeTotalRegions(regions) {
    const coatW = (regions || [])
        .filter(r => r.key !== 'substrate')
        .map(r => r.totalThk || 1);
    const avgCoat = coatW.length ? coatW.reduce((a, b) => a + b, 0) / coatW.length : 200;
    const subPlotW = Math.max(80, avgCoat * 0.5);
    const GAP = Math.max(20, avgCoat * 0.08);
    let cursor = 0;
    const placed = (regions || []).map(r => {
        const span = r.totalThk || 1;
        const w = r.key === 'substrate' ? subPlotW : span;
        const start = cursor;
        const plotX = (r.z || []).map(v => start + (v / span) * w);
        cursor = start + w + GAP;
        return { ...r, start, end: start + w, w, span, plotX };
    });
    const totalW = placed.length ? placed[placed.length - 1].end : 1;
    return { placed, totalW };
}

const mapX = (r, v) => r.start + (v / r.span) * r.w;

export function riTotalTraces(placed, quantity) {
    const showBoth = quantity === 'both';
    const traces = [];
    placed.forEach((r, idx) => {
        const cd = (r.z || []).map(v => [v, r.unit]);
        const showInLegend = idx === 0;
        if (quantity === 'n' || showBoth) {
            traces.push({
                x: r.plotX, y: r.n, customdata: cd,
                type: 'scatter', mode: 'lines',
                name: 'n', legendgroup: 'n', showlegend: showBoth && showInLegend,
                xaxis: 'x', yaxis: 'y',
                line: { color: '#4fc3f7', width: 2, shape: 'hv' },
                hovertemplate: `n<br>${r.label}<br>z: %{customdata[0]:.3f} %{customdata[1]}<br>n: %{y:.4f}<extra></extra>`,
            });
        }
        if (quantity === 'k' || showBoth) {
            traces.push({
                x: r.plotX, y: r.k, customdata: cd,
                type: 'scatter', mode: 'lines',
                name: 'k', legendgroup: 'k', showlegend: showBoth && showInLegend,
                xaxis: 'x', yaxis: showBoth ? 'y2' : 'y',
                line: { color: '#ef5350', width: 2, shape: 'hv',
                        dash: showBoth ? 'dash' : 'solid' },
                hovertemplate: `k<br>${r.label}<br>z: %{customdata[0]:.3f} %{customdata[1]}<br>k: %{y:.5f}<extra></extra>`,
            });
        }
    });
    return traces;
}

function buildShapes(placed, matColorMap, colors) {
    const { gridColor, textColor } = colors;
    const shapes = [];
    placed.forEach(r => {
        if (r.key === 'substrate') {
            shapes.push({
                type: 'rect', x0: r.start, x1: r.end, xref: 'x',
                y0: 0, y1: 1, yref: 'paper',
                fillcolor: gridColor, opacity: 0.10, layer: 'below', line: { width: 0 },
            });
        }
        const bounds = r.layerBounds || [];
        const validLayers = r.validLayers || [];
        for (let k = 0; k < validLayers.length && k + 1 < bounds.length; k++) {
            const color = matColorMap[validLayers[k]?.materialId] || '#555555';
            shapes.push({
                type: 'rect',
                x0: mapX(r, bounds[k]), x1: mapX(r, bounds[k + 1]), xref: 'x',
                y0: 0, y1: 1, yref: 'paper',
                fillcolor: color, opacity: 0.14, layer: 'below', line: { width: 0 },
            });
        }
        for (const b of bounds.slice(1, -1)) {
            shapes.push({
                type: 'line', x0: mapX(r, b), x1: mapX(r, b), xref: 'x',
                y0: 0, y1: 1, yref: 'paper',
                line: { color: gridColor, width: 1, dash: 'dot' },
            });
        }
    });
    for (let i = 0; i < placed.length - 1; i++) {
        const gx = (placed[i].end + placed[i + 1].start) / 2;
        shapes.push({
            type: 'line', x0: gx, x1: gx, xref: 'x', y0: 0, y1: 1, yref: 'paper',
            line: { color: textColor, width: 1, dash: 'dashdot' },
        });
    }
    return shapes;
}

function buildAnnotations(placed, textColor) {
    return placed.map(r => ({
        x: (r.start + r.end) / 2, xref: 'x', y: 1.02, yref: 'paper', yanchor: 'bottom',
        text: r.key === 'substrate'
            ? `${r.label} · ${(r.totalThk).toFixed(2)} mm`
            : `${r.label} · ${Math.round(r.totalThk)} nm`,
        showarrow: false, font: { color: textColor, size: 11 },
    }));
}

export function riTotalFigure(regions, quantity, matColorMap, colors) {
    const { placed, totalW } = placeTotalRegions(regions);
    if (!placed.length) return { traces: [], layout: {} };

    const { bgColor, paperColor, gridColor, textColor } = colors;
    const showBoth = quantity === 'both';
    const showN = quantity === 'n' || showBoth;
    const layout = {
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        margin: { l: 56, r: showBoth ? 56 : 16, t: 24, b: 30 },
        showlegend: showBoth,
        legend: { x: 1, xanchor: 'right', y: 1.08, orientation: 'h',
                  font: { size: 11, color: textColor }, bgcolor: 'transparent' },
        xaxis: {
            range: [0, totalW],
            showticklabels: false, showgrid: false, zeroline: false,
            color: textColor,
        },
        yaxis: {
            title: { text: showN ? 'n' : 'k', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 },
            rangemode: 'tozero',
        },
        shapes: buildShapes(placed, matColorMap, colors),
        annotations: buildAnnotations(placed, textColor),
    };
    if (showBoth) {
        layout.yaxis2 = {
            title: { text: 'k', font: { color: '#ef5350', size: 12 } },
            color: '#ef5350', overlaying: 'y', side: 'right',
            tickfont: { color: '#ef5350', size: 11 },
            showgrid: false, rangemode: 'tozero',
        };
    }
    return { traces: riTotalTraces(placed, quantity), layout };
}

export function RITotalChart({ regions, quantity, matColorMap, c }) {
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
        const { traces, layout } = riTotalFigure(regions, quantity, matColorMap, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [regions, quantity, matColorMap, c]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
