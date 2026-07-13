import { buildOverlayFigure } from './overlayFigure.js';

const { createElement: h, useEffect, useRef } = React;

function chartColors(c) {
    return {
        bg: c.bg || '#1e1e1e',
        panel: c.panel || '#252526',
        grid: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };
}

function updateChart(element, initialized, figure) {
    if (!element || typeof Plotly === 'undefined') return;
    const config = { responsive: true, displaylogo: false, displayModeBar: false };
    if (!initialized.current) {
        Plotly.newPlot(element, figure.data, figure.layout, config);
        initialized.current = true;
    } else {
        Plotly.react(element, figure.data, figure.layout, config);
    }
}

function observeChart(element, initialized) {
    if (!element) return undefined;
    const observer = new ResizeObserver(() => {
        if (!initialized.current) return;
        if (!element.isConnected || element.offsetParent === null) return;
        try { Plotly.Plots.resize(element); } catch (_) {}
    });
    observer.observe(element);
    return () => {
        observer.disconnect();
        if (element) Plotly.purge(element);
    };
}

export function OverlayChart(props) {
    const { spectrum, char, weighting, c, minMaxMarks } = props;
    const divRef = useRef(null);
    const initialized = useRef(false);
    const colors = chartColors(c);
    const figure = buildOverlayFigure(spectrum, char, weighting, minMaxMarks, colors);

    useEffect(() => {
        updateChart(divRef.current, initialized, figure);
    }, [spectrum, char, weighting, minMaxMarks, c.bg, c.panel, c.border, c.text]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => observeChart(divRef.current, initialized), []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
