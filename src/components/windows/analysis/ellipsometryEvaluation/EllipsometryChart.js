const { createElement: h, useEffect, useRef } = React;

const PSI_COLOR = '#4fc3f7';
const DELTA_COLOR = '#ef5350';

export function buildEllipsometryFigure(data, colors) {
    const traces = [
        {
            x: data.x, y: data.psi, type: 'scatter', mode: 'lines',
            name: 'Ψ', yaxis: 'y',
            line: { color: PSI_COLOR, width: 2 },
            hovertemplate: 'Ψ: %{y:.3f}°<br>%{x:.3f}<extra></extra>',
        },
        {
            x: data.x, y: data.delta, type: 'scatter', mode: 'lines',
            name: 'Δ', yaxis: 'y2',
            line: { color: DELTA_COLOR, width: 2 },
            hovertemplate: 'Δ: %{y:.3f}°<br>%{x:.3f}<extra></extra>',
        },
    ];
    const layout = {
        paper_bgcolor: colors.paper,
        plot_bgcolor: colors.background,
        margin: { l: 56, r: 56, t: 12, b: 46 },
        showlegend: true,
        legend: { x: 0.5, xanchor: 'center', y: 1.0, orientation: 'h',
                  font: { size: 11, color: colors.text }, bgcolor: 'transparent' },
        xaxis: {
            title: { text: data.xLabel, font: { color: colors.text, size: 12 } },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { color: colors.text, size: 11 },
        },
        yaxis: {
            title: { text: 'Ψ (°)', font: { color: PSI_COLOR, size: 12 } },
            range: [0, 90], color: PSI_COLOR, gridcolor: colors.grid,
            zerolinecolor: colors.grid, tickfont: { color: PSI_COLOR, size: 11 },
        },
        yaxis2: {
            title: { text: 'Δ (°)', font: { color: DELTA_COLOR, size: 12 } },
            range: [0, 360], dtick: 60, overlaying: 'y', side: 'right',
            color: DELTA_COLOR, tickfont: { color: DELTA_COLOR, size: 11 },
            showgrid: false,
        },
    };
    return { traces, layout };
}

export function EllipsometryChart({ data, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = {
        background: c.bg || '#1e1e1e',
        paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };

    useEffect(() => {
        if (!divRef.current || !data) return;
        const { traces, layout } = buildEllipsometryFigure(data, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [data, colors.background, colors.paper, colors.grid, colors.text]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
