import { buildTargetTraces, buildTargetShapes } from '../../../../utils/physics/spectrumTargets.js';

const { createElement: h, useEffect, useRef, useMemo } = React;

function buildTraces(data, targets, showTargets) {
    if (!data?.lambda) return [];
    const out = [];
    if (data.T) out.push({
        x: data.lambda, y: data.T.map(v => v * 100),
        name: 'T', type: 'scatter', mode: 'lines',
        line: { color: '#4fc3f7', width: 1.6 },
        hovertemplate: '%{x:.1f} nm<br>T %{y:.3f}%<extra></extra>'
    });
    if (data.R) out.push({
        x: data.lambda, y: data.R.map(v => v * 100),
        name: 'R', type: 'scatter', mode: 'lines',
        line: { color: '#ef5350', width: 1.6 },
        hovertemplate: '%{x:.1f} nm<br>R %{y:.3f}%<extra></extra>'
    });
    if (data.Tbase) out.push({
        x: data.lambda, y: data.Tbase.map(v => v * 100),
        name: 'T (baseline)', type: 'scatter', mode: 'lines',
        line: { color: '#4fc3f7', width: 1, dash: 'dot' },
        opacity: 0.55,
        hovertemplate: '%{x:.1f} nm<br>T₀ %{y:.3f}%<extra></extra>'
    });
    if (data.Rbase) out.push({
        x: data.lambda, y: data.Rbase.map(v => v * 100),
        name: 'R (baseline)', type: 'scatter', mode: 'lines',
        line: { color: '#ef5350', width: 1, dash: 'dot' },
        opacity: 0.55,
        hovertemplate: '%{x:.1f} nm<br>R₀ %{y:.3f}%<extra></extra>'
    });
    if (showTargets) {
        for (const tr of buildTargetTraces(targets)) out.push(tr);
    }
    return out;
}

function buildLayout(colors, targets, showTargets) {
    const { paperColor, bgColor, gridColor, textColor } = colors;
    return {
        margin: { l: 52, r: 16, t: 16, b: 44 },
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: { title: { text: 'Wavelength (nm)', standoff: 8 }, gridcolor: gridColor, zerolinecolor: gridColor },
        yaxis: { title: { text: '(%)', standoff: 8 }, range: [0, 100], gridcolor: gridColor, zerolinecolor: gridColor },
        legend: { bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1, font: { size: 10 },
                  x: 1, xanchor: 'right', y: 1, yanchor: 'top' },
        hovermode: 'x unified',
        autosize: true,
        shapes: showTargets ? buildTargetShapes(targets) : [],
    };
}

function usePlotlyMount(divRef, initRef, traces, layout, config) {
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        Plotly.newPlot(divRef.current, traces, layout, config);
        initRef.current = true;
        const ro = new ResizeObserver(() => {
            if (divRef.current && initRef.current) Plotly.Plots.resize(divRef.current);
        });
        ro.observe(divRef.current);
        return () => {
            ro.disconnect();
            if (divRef.current) Plotly.purge(divRef.current);
            initRef.current = false;
        };
    }, []);
}

function usePlotlyUpdate(divRef, initRef, traces, layout, config) {
    useEffect(() => {
        if (!divRef.current || !initRef.current) return;
        Plotly.react(divRef.current, traces, layout, config);
    }, [traces, layout]);
}

export function SpectrumPlot({ data, c, theme, targets, showTargets }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const colors = {
        bgColor:    c.bg     || '#1e1e1e',
        paperColor: c.panel  || '#252526',
        gridColor:  c.border || '#3a3a3a',
        textColor:  c.text   || '#cccccc',
    };

    const traces = useMemo(() => buildTraces(data, targets, showTargets), [data, targets, showTargets]);
    const layout = useMemo(() => buildLayout(colors, targets, showTargets),
        [colors.paperColor, colors.bgColor, colors.gridColor, colors.textColor, targets, showTargets]);
    const config = { displaylogo: false, responsive: true, displayModeBar: true,
                     modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] };

    usePlotlyMount(divRef, initRef, traces, layout, config);
    usePlotlyUpdate(divRef, initRef, traces, layout, config);

    if (typeof Plotly === 'undefined') {
        return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim } },
            'Plotly not loaded');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
