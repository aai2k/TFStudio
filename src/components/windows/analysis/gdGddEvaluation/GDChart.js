import { buildGDChartModel } from './chartModel.js';

const { createElement: h, useEffect, useRef } = React;

export function GDChart({ data, meta, refLambda, showRef, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const background = c.bg || '#1e1e1e';
    const paper = c.panel || '#252526';
    const grid = c.border || '#3a3a3a';
    const text = c.text || '#cccccc';

    useEffect(() => {
        if (!divRef.current || !data) return;
        const { traces, layout } = buildGDChartModel({
            data, meta, referenceLambda: refLambda, showReference: showRef,
            colors: { background, paper, grid, text },
        });
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [data, meta, refLambda, showRef, background, paper, grid, text]);

    useEffect(() => {
        const element = divRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            if (initRef.current) Plotly.Plots.resize(element);
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (element) Plotly.purge(element);
        };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
