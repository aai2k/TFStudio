// Compact merit-function trend plot shown under the operand table while a
// refinement run is in progress (and after it, from history).

const { createElement: h, useRef, useEffect } = React;   // React is a window global

export function MFTrendPlot({ history, c, theme }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);
    const resizeFrameRef = useRef(null);

    const bgColor    = c.bg    || '#1e1e1e';
    const panelColor = c.panel || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text  || '#cccccc';

    const iters = history.map(hp => hp.iter);
    const mfs   = history.map(hp => hp.mf);

    const traces = [{
        x: iters, y: mfs,
        type: 'scatter', mode: history.length === 1 ? 'lines+markers' : 'lines',
        line: { color: '#ffa726', width: 1.5 },
        marker: { color: '#ffa726', size: 5 },
        name: 'MF', hovertemplate: 'Iter %{x}<br>MF: %{y:.6g}<extra></extra>'
    }];

    const layout = {
        autosize: true,
        margin: { l: 58, r: 8, t: 6, b: 28 },
        paper_bgcolor: panelColor, plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 10 },
        xaxis: { title: { text: 'Iteration', standoff: 4 }, gridcolor: gridColor, automargin: true },
        yaxis: {
            title: { text: 'MF', standoff: 4 }, gridcolor: gridColor, type: 'log',
            tickformat: '.0e', exponentformat: 'e', automargin: true,
        },
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

    // Plotly's responsive option listens to browser-window resizes, but the
    // Refinement panel can also change size when docking dividers move without
    // a window resize. Observe the plot element itself so both cases reflow.
    useEffect(() => {
        const plot = divRef.current;
        if (!plot || typeof Plotly === 'undefined') return;
        const resize = () => {
            if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
            resizeFrameRef.current = requestAnimationFrame(() => {
                resizeFrameRef.current = null;
                if (plot.isConnected !== false) Plotly.Plots.resize(plot);
            });
        };
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
        observer?.observe(plot);
        window.addEventListener('resize', resize);
        resize();
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', resize);
            if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
            resizeFrameRef.current = null;
            Plotly.purge(plot);
            initRef.current = false;
        };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
