import { previewSpectrum } from './model.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

function drawPreview(divEl, data, c, refLambda) {
    // Invalid formula → purge any prior spectrum and bail (the overlay below
    // shows "no preview"). We must NOT unmount the plot div on error: Plotly
    // owns DOM inside it that React doesn't track, so swapping the div for a
    // text node makes React's reconciler throw on removeChild and the
    // preview never recovers ("disappears forever"). Keeping the div mounted
    // and only purging avoids that.
    if (data.error) {
        try { window.Plotly.purge(divEl); } catch { /* not yet plotted */ }
        return;
    }
    const traces = [
        { x: data.lambda, y: data.T.map(v => v * 100), type: 'scatter', mode: 'lines',
          name: 'T', line: { color: '#4fc3f7', width: 1.6 } },
        { x: data.lambda, y: data.R.map(v => v * 100), type: 'scatter', mode: 'lines',
          name: 'R', line: { color: '#ef5350', width: 1.6 } },
    ];
    const layout = {
        margin: { l: 44, r: 12, t: 6, b: 32 },
        xaxis: { title: { text: 'λ (nm)', font: { size: 10, color: c.textDim } },
                 color: c.text, gridcolor: c.border, tickfont: { size: 9 } },
        yaxis: { title: { text: 'T, R (%)', font: { size: 10, color: c.textDim } },
                 color: c.text, gridcolor: c.border, tickfont: { size: 9 }, range: [0, 105] },
        paper_bgcolor: c.panel, plot_bgcolor: c.bg, font: { color: c.text, size: 10 },
        showlegend: true, legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(0,0,0,0)' },
        shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: refLambda, x1: refLambda,
                   y0: 0, y1: 1, line: { color: c.textDim, width: 1, dash: 'dot' } }],
    };
    window.Plotly.react(divEl, traces, layout, { responsive: true, displayModeBar: false });
}

export function PreviewPlot({ compiled, incidentId, substrateId, refLambda, c, height = 220 }) {
    const divRef = useRef(null);

    const data = useMemo(
        () => previewSpectrum(compiled, incidentId, substrateId, refLambda),
        [compiled, incidentId, substrateId, refLambda]);

    useEffect(() => {
        if (!divRef.current || !window.Plotly) return;
        drawPreview(divRef.current, data, c, refLambda);
    }, [data, c, refLambda]);

    // Purge Plotly on unmount so the detached node is cleaned up.
    useEffect(() => () => {
        if (divRef.current && window.Plotly) { try { window.Plotly.purge(divRef.current); } catch { /* noop */ } }
    }, []);

    // The Plotly div is ALWAYS mounted (so React never tears out Plotly's DOM);
    // the "no preview" message is an overlay sibling shown only on error.
    return h('div', { style: { position: 'relative', width: '100%', height } },
        h('div', { ref: divRef, style: { width: '100%', height } }),
        data.error && h('div', {
            style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic',
                     background: c.panel, pointerEvents: 'none' } },
            '— no preview —'),
    );
}
