import { efieldLayout, efieldTraces } from './chartModel.js';

const { createElement: h, useEffect, useRef } = React;

export function EFieldChart({ profileData, pol, matColorMap, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = {
        bgColor: c.bg || '#1e1e1e',
        paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a',
        textColor: c.text || '#cccccc',
        accentColor: c.accent || '#007acc',
    };

    useEffect(() => {
        if (!divRef.current) return;
        const traces = efieldTraces(profileData, pol);
        const layout = efieldLayout(profileData, pol, matColorMap, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [profileData, pol, matColorMap, c]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
