import { buildSweepFigure } from './sweepFigure.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function SweepHeatmap({ sweepData, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const { data, layout } = useMemo(
        () => buildSweepFigure(sweepData, channel, { text: c.text, border: c.border, panel: c.panel, bg: c.bg }),
        [sweepData, channel, c]
    );

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout);
        }
    }, [data, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
