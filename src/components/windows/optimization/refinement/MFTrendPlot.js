// Compact merit-function trend plot shown under the operand table while a
// refinement run is in progress (and after it, from history).

const { createElement: h, useRef, useEffect } = React;   // React is a window global

export function MFTrendPlot({ history, c, theme }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg    || '#1e1e1e';
    const panelColor = c.panel || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text  || '#cccccc';

    const iters = history.map(hp => hp.iter);
    const mfs   = history.map(hp => hp.mf);

    const traces = [{
        x: iters, y: mfs,
        type: 'scatter', mode: 'lines',
        line: { color: '#ffa726', width: 1.5 },
        name: 'MF', hovertemplate: 'Iter %{x}<br>MF: %{y:.6f}<extra></extra>'
    }];

    const layout = {
        margin: { l: 52, r: 8, t: 6, b: 28 },
        paper_bgcolor: panelColor, plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 10 },
        xaxis: { title: { text: 'Iteration', standoff: 4 }, gridcolor: gridColor },
        yaxis: { title: { text: 'MF', standoff: 4 }, gridcolor: gridColor, type: 'log' },
        showlegend: false,
    };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [history, theme]);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
